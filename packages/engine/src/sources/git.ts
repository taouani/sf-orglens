/**
 * Reads a Git repository through the `git` program, without changing it.
 *
 * Only commands that read are used: `rev-parse`, `ls-tree` and `cat-file`. The content of a commit is taken from the object database, so
 * a branch that is not checked out can be read, and what is read is exactly
 * what the commit holds: no line-ending conversion, no filters.
 *
 * Git is told not to prompt, not to take optional locks, not to honour
 * replacement objects, and not to fetch missing objects from a remote.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EngineError } from '../core/errors.ts';
import { byCodeUnit, type SourceTree, type TreeReading } from './tree.ts';

const GIT_ENVIRONMENT = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
  LC_ALL: 'C',
};

/** Options before the command: paths are printed as they are, and no monitor program of the repository is run. */
const GIT_OPTIONS = ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false'];

/** More output than this from one call of Git is a failure. Contents are asked for in batches far below it. */
const MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;

/** How the contents of a commit are read: in batches of about `batchBytes`, of which `cacheBytes` are kept in memory. */
export interface ReadLimits {
  readonly batchBytes: number;
  readonly cacheBytes: number;
}
const DEFAULT_LIMITS: ReadLimits = { batchBytes: 32 * 1024 * 1024, cacheBytes: 256 * 1024 * 1024 };

interface GitResult {
  /** `null` if the program could not be started. */
  readonly status: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  /** True if there is no `git` program on this machine. */
  readonly notInstalled: boolean;
}

function git(repoDir: string, args: readonly string[], input?: string): GitResult {
  const result = spawnSync('git', [...GIT_OPTIONS, ...args], {
    cwd: repoDir,
    env: { ...process.env, ...GIT_ENVIRONMENT },
    input,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr.toString('utf8').trim(),
    notInstalled: (result.error as { code?: unknown } | undefined)?.code === 'ENOENT',
  };
}

function failed(repoDir: string, doing: string, result: GitResult): EngineError {
  if (result.notInstalled) {
    return new EngineError('SOURCE_READ_FAILED', `Git is needed to ${doing}, and no "git" program was found.`, {
      hint: 'Install Git, or remove "ref" from the source to read the folder as it is on disk.',
      details: { reason: 'GIT_NOT_INSTALLED', repo: repoDir },
    });
  }
  return new EngineError('SOURCE_READ_FAILED', `Git could not ${doing}. It says: ${result.stderr || 'nothing'}`, {
    details: { reason: 'GIT_FAILED', repo: repoDir, status: result.status },
  });
}

/** The full id of the commit a branch, tag or commit id names. */
export function commitOf(repoDir: string, ref: string): string {
  // The ref is one argument after the end of the options, so it is never read as an option.
  const result = git(repoDir, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]);
  const commit = result.stdout.toString('utf8').trim();
  if (result.status === 0 && /^[0-9a-f]{40,64}$/.test(commit)) return commit;
  if (result.notInstalled) throw failed(repoDir, `read "${ref}"`, result);
  // Asked without `--quiet`, Git says why: there is no repository, or it belongs to another user.
  const inside = git(repoDir, ['rev-parse', '--git-dir']);
  if (inside.status !== 0) throw failed(repoDir, 'read the repository', inside);
  throw new EngineError('SOURCE_READ_FAILED', `The repository has no branch, tag or commit "${ref}".`, {
    hint: 'A branch of a remote is named with the remote, for example "origin/main". Fetch it first.',
    details: { reason: 'REF_NOT_FOUND', repo: repoDir, ref },
  });
}

/**
 * The commit that is checked out in the repository a folder is in. The
 * commit is `null` if the repository has none yet. The result is `null` if
 * Git cannot tell: the folder is not in a repository, or there is no `git`
 * program. Reading from disk does not need Git, so this never throws.
 */
export function checkedOut(repoDir: string): { readonly commit: string | null } | null {
  const head = git(repoDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (head.status === null) return null;
  const commit = head.stdout.toString('utf8').trim();
  if (head.status === 0 && /^[0-9a-f]{40,64}$/.test(commit)) return { commit };
  return git(repoDir, ['rev-parse', '--git-dir']).status === 0 ? { commit: null } : null;
}

interface Entry {
  readonly object: string;
  readonly size: number;
  readonly batch: number;
}

const MODE_LINK = '120000';

interface Listing {
  /** The files, by their path, with the id of their content and its size in bytes. */
  readonly files: Map<string, { readonly object: string; readonly size: number }>;
  /** Entries that are not files: symbolic links and submodules. */
  readonly skipped: string[];
}

/** Lists what a commit holds at and below the given paths, relative to `repoDir`. */
function listCommit(repoDir: string, commit: string, paths: readonly string[]): Listing {
  // The paths are relative to the folder Git runs in, which need not be the top of the repository.
  const listing = git(repoDir, ['ls-tree', '-r', '-z', '-l', commit, '--', ...paths]);
  if (listing.status !== 0) throw failed(repoDir, 'list the files of the commit', listing);

  const files: Listing['files'] = new Map();
  const skipped: string[] = [];
  for (const line of listing.stdout.toString('utf8').split('\0')) {
    if (line === '') continue;
    // <mode> <type> <object> <size>\t<path>. The size of an entry that is not a file is a hyphen.
    const tab = line.indexOf('\t');
    const [mode, type, object, size] = line.slice(0, tab).split(/ +/);
    const path = line.slice(tab + 1);
    if (tab === -1 || mode === undefined || object === undefined || size === undefined) {
      throw new EngineError('INTERNAL', 'Git listed a file in a form OrgLens does not know.', { details: { line } });
    }
    if (type !== 'blob' || mode === MODE_LINK) skipped.push(path);
    else files.set(path, { object, size: Number(size) });
  }
  return { files, skipped };
}

/**
 * Lists the files a commit holds below the given folders, relative to
 * `repoDir`. Contents are read from the object database when the tree is
 * asked for them, a batch at a time.
 */
export function readCommit(
  repoDir: string,
  commit: string,
  dirs: readonly string[],
  limits: ReadLimits = DEFAULT_LIMITS,
): TreeReading {
  const listing = listCommit(repoDir, commit, dirs);
  const entries = new Map<string, Entry>();
  const { skipped } = listing;
  const batchObjects: string[][] = [[]];
  let batchBytes = 0;
  for (const [path, { object, size }] of listing.files) {
    if (batchBytes > 0 && batchBytes + size > limits.batchBytes) {
      batchObjects.push([]);
      batchBytes = 0;
    }
    batchBytes += size;
    batchObjects.at(-1)?.push(object);
    entries.set(path, { object, size, batch: batchObjects.length - 1 });
  }

  // Batches that were read, the most recently used last, and the sum of their sizes.
  const loaded = new Map<number, { readonly contents: Map<string, Uint8Array>; readonly bytes: number }>();
  let loadedBytes = 0;

  const load = (batch: number): Map<string, Uint8Array> => {
    const hit = loaded.get(batch);
    if (hit !== undefined) {
      loaded.delete(batch);
      loaded.set(batch, hit);
      return hit.contents;
    }
    const objects = batchObjects[batch] ?? [];
    const result = git(repoDir, ['cat-file', '--batch'], objects.map((object) => `${object}\n`).join(''));
    if (result.status !== 0) throw failed(repoDir, 'read the files of the commit', result);
    const contents = new Map<string, Uint8Array>();
    const out = result.stdout;
    let at = 0;
    let bytes = 0;
    for (const object of objects) {
      // <object> blob <size>\n<content>\n
      const end = out.indexOf(0x0a, at);
      const header = end === -1 ? '' : out.toString('latin1', at, end);
      const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
      if (match?.[1] !== object) {
        throw new EngineError('SOURCE_READ_FAILED', 'A file of the commit is not in the repository on this machine.', {
          hint: 'A shallow or partial clone does not hold every file. Fetch the commit completely.',
          details: { reason: 'OBJECT_MISSING', repo: repoDir, object },
        });
      }
      const size = Number(match[2]);
      // Copied out, so that the large output of the batch can be freed when the batch leaves the cache.
      contents.set(object, new Uint8Array(out.subarray(end + 1, end + 1 + size)));
      at = end + 1 + size + 1;
      bytes += size;
    }
    while (loadedBytes + bytes > limits.cacheBytes && loaded.size > 0) {
      const [oldest, entry] = loaded.entries().next().value as [number, { bytes: number }];
      loaded.delete(oldest);
      loadedBytes -= entry.bytes;
    }
    loaded.set(batch, { contents, bytes });
    loadedBytes += bytes;
    return contents;
  };

  return {
    tree: {
      files: [...entries.keys()].sort(byCodeUnit),
      read: (path) => {
        const entry = entries.get(path);
        const content = entry === undefined ? undefined : load(entry.batch).get(entry.object);
        if (content === undefined) throw new Error(`"${path}" is not a file of this tree.`);
        return content;
      },
    },
    missing: dirs
      .filter((dir) => ![...entries.keys(), ...skipped].some((path) => path === dir || path.startsWith(`${dir}/`)))
      .sort(byCodeUnit),
    skipped: skipped.sort(byCodeUnit),
  };
}

/** The content of one file of a commit, or `null` if the commit has no file at that path. */
export function readCommitFile(repoDir: string, commit: string, path: string): Uint8Array | null {
  const listing = git(repoDir, ['ls-tree', '-z', commit, '--', path]);
  if (listing.status !== 0) throw failed(repoDir, 'list the files of the commit', listing);
  const line = listing.stdout.toString('utf8').split('\0')[0] ?? '';
  const [mode, type, object] = line.slice(0, Math.max(line.indexOf('\t'), 0)).split(/ +/);
  if (type !== 'blob' || mode === MODE_LINK || object === undefined) return null;
  const result = git(repoDir, ['cat-file', 'blob', object]);
  if (result.status !== 0) throw failed(repoDir, `read "${path}" of the commit`, result);
  return new Uint8Array(result.stdout);
}

/** The id Git gives a file with this content. The length of another id of the repository says which hash it uses. */
function blobId(content: Uint8Array, like: string): string {
  return createHash(like.length === 64 ? 'sha256' : 'sha1')
    .update(`blob ${String(content.byteLength)}\0`)
    .update(content)
    .digest('hex');
}

/** The content with every CR LF turned into LF, as Git stores a text file that it converts on checkout. */
function withoutCarriageReturns(content: Uint8Array): Uint8Array {
  const out = new Uint8Array(content.byteLength);
  let length = 0;
  for (let at = 0; at < content.byteLength; at += 1) {
    if (content[at] === 0x0d && content[at + 1] === 0x0a) continue;
    out[length] = content[at] ?? 0;
    length += 1;
  }
  return out.subarray(0, length);
}

/** Where files that were read from disk differ from a commit. */
export interface CommitDifference {
  /** The files that are on one side only, or whose content is not the same byte for byte. Sorted. */
  readonly paths: readonly string[];
  /** True if every one of them is on both sides and differs only in CR LF where the commit has LF. */
  readonly onlyLineEndings: boolean;
}

/**
 * Compares files read from disk with what a commit holds at `paths`, by the
 * id Git gives their content. Of the commit, only the files that pass `keep`
 * count.
 *
 * Git is not asked whether the working tree is clean, because its answer
 * is about something else: it calls a file unchanged whose line endings it
 * converted on checkout, a file it was told to assume unchanged, and a file
 * that a sparse checkout left out.
 */
export function differencesFromCommit(
  repoDir: string,
  commit: string,
  paths: readonly string[],
  keep: (path: string) => boolean,
  onDisk: SourceTree,
): CommitDifference {
  const inCommit = listCommit(repoDir, commit, paths).files;
  const differing: string[] = [];
  let onlyLineEndings = true;
  for (const path of onDisk.files) {
    const object = inCommit.get(path)?.object;
    let content: Uint8Array | undefined;
    try {
      content = onDisk.read(path);
    } catch {
      // A file that was listed and cannot be read is not known to be the same.
    }
    if (object !== undefined && content !== undefined && blobId(content, object) === object) continue;
    differing.push(path);
    onlyLineEndings &&=
      object !== undefined && content !== undefined && blobId(withoutCarriageReturns(content), object) === object;
  }
  const read = new Set(onDisk.files);
  for (const path of inCommit.keys()) {
    if (read.has(path) || !keep(path)) continue;
    differing.push(path);
    onlyLineEndings = false;
  }
  return { paths: differing.sort(byCodeUnit), onlyLineEndings: differing.length > 0 && onlyLineEndings };
}
