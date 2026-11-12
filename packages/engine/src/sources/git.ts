/**
 * Reads a Git repository through the `git` program, without changing it.
 *
 * Only commands that read are used: `rev-parse`, `ls-tree` and `cat-file`.
 * The content of a commit is taken from the object database, so a branch
 * that is not checked out can be read, and what is read is exactly what the
 * commit holds: no line-ending conversion, no filters.
 *
 * Git is started with an environment of its own. The variables that point
 * Git at another repository, index or object store are removed, because a
 * program that Git itself started (a hook, for example) inherits them. Git
 * is told not to prompt, not to take optional locks, not to honour
 * replacement objects, not to fetch missing objects from a remote, and to
 * read every path as it is written.
 *
 * Git 2.30 or newer is needed to read a commit.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EngineError } from '../core/errors.ts';
import { byCodeUnit, type SourceTree, type TreeReading } from './tree.ts';

/**
 * Variables that are never handed on to Git. The first group is what
 * `git rev-parse --local-env-vars` lists: they belong to one repository.
 * The others change how a path or a remote is read.
 */
const NEVER_INHERITED = new Set([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_NAMESPACE',
  'GIT_ALLOW_PROTOCOL',
  'GIT_GLOB_PATHSPECS',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_ICASE_PATHSPECS',
]);

const ALWAYS_SET = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_NO_REPLACE_OBJECTS: '1',
  GIT_NO_LAZY_FETCH: '1',
  GIT_LITERAL_PATHSPECS: '1',
  // Messages in English, so that the few that are read here are recognised.
  LC_ALL: 'C',
};

/** The environment Git is started with, made from the environment of this process. */
export function gitEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(inherited)) {
    // Windows does not tell upper case from lower case in the name of a variable.
    if (!NEVER_INHERITED.has(name.toUpperCase())) environment[name] = value;
  }
  return { ...environment, ...ALWAYS_SET };
}

/**
 * Options before the command. No monitor program of the repository is run,
 * and no remote is contacted: `GIT_NO_LAZY_FETCH` is unknown to a Git from
 * before May 2024, and this setting holds for every version.
 */
const GIT_OPTIONS = ['-c', 'core.fsmonitor=false', '-c', 'protocol.allow=never'];

/** The oldest Git that can read a commit for OrgLens: `rev-parse` knows `--end-of-options` from this version on. */
const MINIMUM_GIT = [2, 30] as const;

/** More output than this from one call of Git is a failure. Contents are asked for in batches far below it. */
const MAX_OUTPUT_BYTES = 1024 * 1024 * 1024;

/** How the contents of a commit are read: in batches of about `batchBytes`, of which `cacheBytes` are kept in memory. */
export interface ReadLimits {
  readonly batchBytes: number;
  readonly cacheBytes: number;
}
const DEFAULT_LIMITS: ReadLimits = { batchBytes: 32 * 1024 * 1024, cacheBytes: 256 * 1024 * 1024 };

interface GitResult {
  /** `null` if the program could not be started, or was stopped. */
  readonly status: number | null;
  readonly stdout: Buffer;
  /** What Git wrote as its message, on one line. */
  readonly stderr: string;
  /** True if there is no `git` program on this machine. */
  readonly notInstalled: boolean;
  /** The code of the system error that kept the program from running to its end, such as `EACCES`. */
  readonly startError: string | null;
}

const NOTHING = Buffer.alloc(0);

/** The error for a file of a commit that is not in the object database of this machine. */
function missing(repoDir: string, object: string | null): EngineError {
  return new EngineError('SOURCE_READ_FAILED', 'A file of the commit is not in the repository on this machine.', {
    hint: 'A partial clone does not hold every file, and OrgLens fetches nothing: fetch the commit completely. If the clone is complete, "git fsck" says more.',
    details: { reason: 'OBJECT_MISSING', repo: repoDir, object },
  });
}

function git(repoDir: string, args: readonly string[], input?: string): GitResult {
  const result = spawnSync('git', [...GIT_OPTIONS, ...args], {
    cwd: repoDir,
    env: gitEnvironment(process.env),
    input,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  });
  // A program that could not be started has no output at all, not an empty one.
  const output = result as { stdout: Buffer | null; stderr: Buffer | null };
  const code = (result.error as { code?: unknown } | undefined)?.code;
  return {
    status: result.error === undefined ? result.status : null,
    stdout: output.stdout ?? NOTHING,
    stderr: (output.stderr ?? NOTHING)
      .toString('utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' '),
    notInstalled: code === 'ENOENT',
    startError: result.error === undefined ? null : typeof code === 'string' ? code : 'UNKNOWN',
  };
}

/** The version of the `git` program as numbers, or `null` if it does not say. */
export function parseGitVersion(output: string): number[] | null {
  const match = /^git version (\d+)\.(\d+)/.exec(output);
  return match === null ? null : [Number(match[1]), Number(match[2])];
}

function failed(repoDir: string, doing: string, result: GitResult): EngineError {
  if (result.notInstalled) {
    return new EngineError('SOURCE_READ_FAILED', `Git is needed to ${doing}, and no "git" program was found.`, {
      hint: 'Install Git, or remove "ref" from the source to read the folder as it is on disk.',
      details: { reason: 'GIT_NOT_INSTALLED', repo: repoDir },
    });
  }
  if (result.startError !== null) {
    return new EngineError(
      'SOURCE_READ_FAILED',
      `Git could not ${doing}: the program did not run (${result.startError}).`,
      {
        details: { reason: 'GIT_FAILED', repo: repoDir, status: null },
      },
    );
  }
  // A partial clone holds a commit without all of its files, and nothing is fetched here.
  if (/promisor remote|lazy fetching disabled/.test(result.stderr)) return missing(repoDir, null);
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
  if (result.status === null) throw failed(repoDir, `read "${ref}"`, result);
  // Asked without `--quiet`, Git says why: there is no repository, or it belongs to another user.
  const inside = git(repoDir, ['rev-parse', '--git-dir']);
  if (inside.status !== 0) throw failed(repoDir, 'read the repository', inside);
  // An older Git does not know the end of the options and finds no commit under any name.
  const version = parseGitVersion(git(repoDir, ['version']).stdout.toString('utf8'));
  if (version !== null && byVersion(version, MINIMUM_GIT) < 0) {
    throw new EngineError(
      'SOURCE_READ_FAILED',
      `Git ${version.join('.')} is too old to read a commit. OrgLens needs Git ${MINIMUM_GIT.join('.')} or newer.`,
      {
        hint: 'Install a newer Git, or remove "ref" from the source to read the folder as it is on disk.',
        details: { reason: 'GIT_TOO_OLD', repo: repoDir, version: version.join('.') },
      },
    );
  }
  throw new EngineError('SOURCE_READ_FAILED', `The repository has no branch, tag or commit "${ref}".`, {
    hint: 'A branch of a remote is named with the remote, for example "origin/main". Fetch it first.',
    details: { reason: 'REF_NOT_FOUND', repo: repoDir, ref },
  });
}

const byVersion = (a: readonly number[], b: readonly number[]): number =>
  (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0);

/**
 * What Git says is checked out: a commit, or why it names none.
 *
 * - `NO_COMMIT`: the repository has no commit yet.
 * - `NOT_A_REPOSITORY`: the folder is not in a Git repository.
 * - `NOT_TRUSTED`: Git refuses the repository, because it belongs to another user.
 * - `GIT_NOT_INSTALLED`: there is no `git` program.
 * - `GIT_FAILED`: Git failed in a way that is not one of the above.
 */
export type CheckedOut =
  | { readonly commit: string }
  | {
      readonly commit: null;
      readonly why: 'NO_COMMIT' | 'NOT_A_REPOSITORY' | 'NOT_TRUSTED' | 'GIT_NOT_INSTALLED' | 'GIT_FAILED';
    };

/**
 * The commit that is checked out in the repository a folder is in. Reading
 * from disk does not need Git, so this never throws: without an answer, it
 * says why there is none.
 */
export function checkedOut(repoDir: string): CheckedOut {
  const head = git(repoDir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const commit = head.stdout.toString('utf8').trim();
  if (head.status === 0 && /^[0-9a-f]{40,64}$/.test(commit)) return { commit };
  if (head.notInstalled) return { commit: null, why: 'GIT_NOT_INSTALLED' };
  if (head.status === null) return { commit: null, why: 'GIT_FAILED' };
  const inside = git(repoDir, ['rev-parse', '--git-dir']);
  if (inside.status === 0) return { commit: null, why: 'NO_COMMIT' };
  if (inside.stderr.includes('not a git repository')) return { commit: null, why: 'NOT_A_REPOSITORY' };
  if (inside.stderr.includes('dubious ownership')) return { commit: null, why: 'NOT_TRUSTED' };
  return { commit: null, why: 'GIT_FAILED' };
}

interface Entry {
  readonly object: string;
  readonly size: number;
  readonly batch: number;
}

const MODE_LINK = '120000';
const UTF8 = new TextDecoder('utf-8', { fatal: true });

interface Listing {
  /** The files, by their path, with the id of their content and its size in bytes. The size is 0 if it was not asked for. */
  readonly files: Map<string, { readonly object: string; readonly size: number }>;
  /** Entries that are not files: symbolic links and submodules. */
  readonly skipped: string[];
  /** Entries whose path is not UTF-8, with a replacement character where it is not. */
  readonly undecodable: string[];
}

/**
 * Lists what a commit holds at and below the given paths, relative to
 * `repoDir`. The sizes need every file of the commit to be in the
 * repository on this machine. The list without sizes does not.
 */
function listCommit(repoDir: string, commit: string, paths: readonly string[], sizes: boolean): Listing {
  // The paths are relative to the folder Git runs in, which need not be the top of the repository.
  const listing = git(repoDir, ['ls-tree', '-r', '-z', ...(sizes ? ['-l'] : []), commit, '--', ...paths]);
  if (listing.status !== 0) throw failed(repoDir, 'list the files of the commit', listing);

  const files: Listing['files'] = new Map();
  const skipped: string[] = [];
  const undecodable: string[] = [];
  const out = listing.stdout;
  for (let at = 0; at < out.length;) {
    // <mode> <type> <object>[ <size>]\t<path>\0. The size of an entry that is not a file is a hyphen.
    const end = out.indexOf(0, at);
    const stop = end === -1 ? out.length : end;
    const tab = out.indexOf(0x09, at);
    const [mode, type, object, size] = (tab === -1 || tab > stop ? '' : out.toString('latin1', at, tab)).split(/ +/);
    if (mode === undefined || type === undefined || object === undefined || (sizes && size === undefined)) {
      throw new EngineError('INTERNAL', 'Git listed a file in a form OrgLens does not know.', {
        details: { line: out.toString('latin1', at, stop) },
      });
    }
    const name = out.subarray(tab + 1, stop);
    at = stop + 1;
    let path: string;
    try {
      path = UTF8.decode(name);
    } catch {
      // Two such names can read the same once the bytes that are not UTF-8 are replaced, so none is kept.
      undecodable.push(name.toString('utf8'));
      continue;
    }
    if (type !== 'blob' || mode === MODE_LINK) skipped.push(path);
    // Git writes no number where it cannot find the file in the repository. Depending on its version it goes on.
    else if (sizes && !/^\d+$/.test(size ?? '')) throw missing(repoDir, object);
    else files.set(path, { object, size: sizes ? Number(size) : 0 });
  }
  return { files, skipped, undecodable };
}

/**
 * Reads files of the object database by their ids, in one call of Git.
 * Fails with `OBJECT_MISSING` if one of them is not in the repository on
 * this machine.
 */
function readObjects(repoDir: string, objects: readonly string[]): Map<string, Uint8Array> {
  const result = git(repoDir, ['cat-file', '--batch'], objects.map((object) => `${object}\n`).join(''));
  if (result.status !== 0) throw failed(repoDir, 'read the files of the commit', result);
  const contents = new Map<string, Uint8Array>();
  const out = result.stdout;
  let at = 0;
  for (const object of objects) {
    // <object> blob <size>\n<content>\n, or <object> missing\n
    const end = out.indexOf(0x0a, at);
    const header = end === -1 ? '' : out.toString('latin1', at, end);
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(header);
    if (match?.[1] !== object) throw missing(repoDir, object);
    const size = Number(match[2]);
    // Copied out, so that the large output of the call can be freed when its contents are no longer kept.
    contents.set(object, new Uint8Array(out.subarray(end + 1, end + 1 + size)));
    at = end + 1 + size + 1;
  }
  return contents;
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
  const listing = listCommit(repoDir, commit, dirs, true);
  const entries = new Map<string, Entry>();
  const { skipped, undecodable } = listing;
  // A folder that was asked for and is a file in the commit is not a folder of the commit.
  const files = [...listing.files].filter(([path]) => !dirs.includes(path));
  const batchObjects: string[][] = [[]];
  let batchBytes = 0;
  for (const [path, { object, size }] of files) {
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
    const contents = readObjects(repoDir, batchObjects[batch] ?? []);
    let bytes = 0;
    for (const content of contents.values()) bytes += content.byteLength;
    while (loadedBytes + bytes > limits.cacheBytes && loaded.size > 0) {
      const [oldest, entry] = loaded.entries().next().value as [number, { bytes: number }];
      loaded.delete(oldest);
      loadedBytes -= entry.bytes;
    }
    loaded.set(batch, { contents, bytes });
    loadedBytes += bytes;
    return contents;
  };

  const found = [...entries.keys(), ...skipped, ...undecodable];
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
    missing: dirs.filter((dir) => !found.some((path) => path === dir || path.startsWith(`${dir}/`))).sort(byCodeUnit),
    skipped: skipped.sort(byCodeUnit),
    unreadable: [],
    undecodable: undecodable.sort(byCodeUnit),
  };
}

/**
 * The content of one file of a commit. `null` if the commit has nothing at
 * that path, or a folder. `'link'` if it has a symbolic link there, which
 * is not followed.
 */
export function readCommitFile(repoDir: string, commit: string, path: string): Uint8Array | 'link' | null {
  const entry = listCommit(repoDir, commit, [path], false);
  if (entry.skipped.includes(path)) return 'link';
  const object = entry.files.get(path)?.object;
  if (object === undefined) return null;
  return readObjects(repoDir, [object]).get(object) ?? null;
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
  /** Whether a content is, byte for byte, what the commit holds at a path. For a second look at a file that is read again. */
  readonly holds: (path: string, content: Uint8Array) => boolean;
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
  const listing = listCommit(repoDir, commit, paths, false);
  const inCommit = listing.files;
  const holds = (path: string, content: Uint8Array): boolean => {
    const object = inCommit.get(path)?.object;
    return object !== undefined && blobId(content, object) === object;
  };
  const differing: string[] = [];
  let onlyLineEndings = true;
  for (const path of onDisk.files) {
    let content: Uint8Array | undefined;
    try {
      content = onDisk.read(path);
    } catch {
      // A file that was listed and cannot be read is not known to be the same.
    }
    if (content !== undefined && holds(path, content)) continue;
    differing.push(path);
    onlyLineEndings &&= content !== undefined && holds(path, withoutCarriageReturns(content));
  }
  const read = new Set(onDisk.files);
  for (const path of inCommit.keys()) {
    if (read.has(path) || !keep(path)) continue;
    differing.push(path);
    onlyLineEndings = false;
  }
  // A file of the commit whose name cannot be read as text cannot be on disk under a name that was read.
  for (const path of listing.undecodable) {
    differing.push(path);
    onlyLineEndings = false;
  }
  return { paths: differing.sort(byCodeUnit), onlyLineEndings: differing.length > 0 && onlyLineEndings, holds };
}
