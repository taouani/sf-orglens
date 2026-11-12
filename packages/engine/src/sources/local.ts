/**
 * Reads a Git source: folders of a repository, as they are on disk or as a
 * commit holds them.
 *
 * The result is the same in both cases: the commit that was read if there is
 * one, the components, a tree of exactly the files that belong to them, and
 * every observation made on the way. Nothing here writes to the repository.
 */
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GitSource } from '../core/config/config.ts';
import { EngineError } from '../core/errors.ts';
import { readFolders } from './folder.ts';
import { FORCEIGNORE_FILE, ignoreFileCandidates, ignoreRules } from './forceignore.ts';
import { checkedOut, commitOf, differencesFromCommit, readCommit, readCommitFile } from './git.ts';
import { packageDirectories, PROJECT_FILE } from './project.ts';
import { resolveComponents, type ResolvedComponent } from './resolve.ts';
import { byCodeUnit, filterTree, pathDetails, systemCode, type SourceIssue, type SourceTree } from './tree.ts';

export interface LocalReading {
  /** The folders that were read, relative to the repository. */
  readonly dirs: readonly string[];
  /**
   * The commit whose content the tree holds. `null` if the folders were
   * read from disk and differ from the commit that is checked out, or if
   * Git could not tell.
   */
  readonly commit: string | null;
  /**
   * For folders read from disk that name a commit: whether a content is
   * what the commit holds at a path. The files are read once more when they
   * are stored, and what is stored must pass this for the commit to stand.
   * `null` in every other case.
   */
  readonly holds: ((path: string, content: Uint8Array) => boolean) | null;
  readonly components: readonly ResolvedComponent[];
  /** The files of the components, by their path in the repository. */
  readonly tree: SourceTree;
  readonly issues: readonly SourceIssue[];
}

const APEX_FILE = /\.(?:cls|trigger)$/;

/** At most this many components are listed in the details of the issue about components that are defined twice. */
const COMPONENTS_PER_ISSUE = 50;

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;

/** Why a snapshot of the folders names no commit, for each answer Git can give. */
const NO_COMMIT_BECAUSE = {
  NO_COMMIT: 'the repository has no commit yet.',
  NOT_A_REPOSITORY: 'the folder is not in a Git repository.',
  NOT_TRUSTED:
    'Git refuses the repository, because it belongs to another user. Git accepts it once it is listed in its setting "safe.directory".',
  GIT_NOT_INSTALLED: 'no "git" program was found.',
  GIT_FAILED: 'Git could not say which commit is checked out. "git rev-parse HEAD" in the repository says why.',
} as const;

/** Reads the folders of a Git source. `workspaceRoot` is what the `repo` of the source is relative to. */
export async function readLocalSource(workspaceRoot: string, source: GitSource): Promise<LocalReading> {
  const repoDir = resolve(workspaceRoot, ...source.repo.split('/'));
  if (statSync(repoDir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new EngineError('SOURCE_READ_FAILED', `The repository of the source "${source.name}" is not a folder.`, {
      hint: 'Correct "repo" of the source in orglens.toml. It is relative to the workspace.',
      details: { reason: 'REPO_NOT_FOUND', source: source.name, repo: repoDir },
    });
  }
  const issues: SourceIssue[] = [];
  const fromCommit = source.ref === null ? null : commitOf(repoDir, source.ref);

  /**
   * One file of the source that decides what is read: the project file, a
   * `.forceignore`. Each is read once, so that what was applied is what is
   * compared with the commit later. `'link'` is a symbolic link, which is
   * not followed.
   */
  const deciding = new Map<string, Uint8Array | 'link' | null>();
  const readOne = (path: string): Uint8Array | 'link' | null => {
    let content = deciding.get(path);
    if (content !== undefined) return content;
    if (fromCommit !== null) {
      content = readCommitFile(repoDir, fromCommit, path);
    } else {
      const onDisk = join(repoDir, ...path.split('/'));
      try {
        const stat = lstatSync(onDisk, { throwIfNoEntry: false });
        content = stat?.isSymbolicLink() === true ? 'link' : stat?.isFile() === true ? readFileSync(onDisk) : null;
      } catch (error) {
        // The message of the system names the file by its path on this machine, so only its code is kept.
        const code = systemCode(error);
        throw new EngineError('SOURCE_READ_FAILED', `${path} could not be read${code === null ? '' : ` (${code})`}.`, {
          hint: 'The file decides what the source holds, so nothing is read without it.',
          details: { reason: 'FILE_UNREADABLE', source: source.name, repo: repoDir, path, code },
        });
      }
    }
    deciding.set(path, content);
    return content;
  };

  let dirs = source.paths;
  if (dirs === null) {
    const project = readOne(PROJECT_FILE);
    if (project === null || project === 'link') {
      throw new EngineError(
        'SOURCE_READ_FAILED',
        project === null
          ? `The repository of the source "${source.name}" has no ${PROJECT_FILE}.`
          : `The ${PROJECT_FILE} of the source "${source.name}" is a symbolic link, and OrgLens follows no links.`,
        {
          hint: 'Name the folders of the source with "paths" in orglens.toml.',
          details: { reason: 'PROJECT_FILE_MISSING', source: source.name, repo: repoDir },
        },
      );
    }
    dirs = packageDirectories(project);
  }
  const declared = new Set(dirs);

  const reading = fromCommit === null ? readFolders(repoDir, dirs) : readCommit(repoDir, fromCommit, dirs);
  const below = (dir: string, path: string): boolean => path.startsWith(`${dir}/`);
  // A folder that is a link, a submodule or a file is not a folder that can be read, whatever is there.
  const notFolders = [...reading.missing, ...reading.skipped.filter((path) => declared.has(path))].sort(byCodeUnit);
  const notRead = new Set([...notFolders, ...reading.unreadable.map(({ path }) => path)]);
  if (dirs.every((dir) => notRead.has(dir))) {
    throw new EngineError(
      'SOURCE_READ_FAILED',
      `None of the folders of the source "${source.name}" could be read${fromCommit === null ? '' : ' from the commit'}: ${dirs.join(', ')}.`,
      {
        hint: 'Each must exist and be a folder. Links and submodules are not followed.',
        details: { reason: 'FOLDERS_MISSING', source: source.name, repo: repoDir, folders: [...dirs] },
      },
    );
  }
  if (notFolders.length > 0) {
    issues.push({
      severity: 'error',
      code: 'FOLDER_MISSING',
      message: `${plural(notFolders.length, 'folder of the source does not exist, or is', 'folders of the source do not exist, or are')} a link, a submodule or a file: ${notFolders.join(', ')}.`,
      details: pathDetails(notFolders),
    });
  }
  if (reading.unreadable.length > 0) {
    const paths = reading.unreadable.map(({ path }) => path);
    const reasons = [...new Set(reading.unreadable.map(({ reason }) => reason ?? 'unknown'))].sort(byCodeUnit);
    issues.push({
      severity: 'error',
      code: 'FOLDER_UNREADABLE',
      message: `${plural(paths.length, 'folder', 'folders')} could not be listed (${reasons.join(', ')}), and nothing below ${paths.length === 1 ? 'it' : 'them'} is in the snapshot.`,
      details: { ...pathDetails(paths), reasons },
    });
  }
  if (reading.undecodable.length > 0) {
    issues.push({
      severity: 'error',
      code: 'NAME_NOT_UTF8',
      message: `${plural(reading.undecodable.length, 'entry has a name that is not UTF-8 and is', 'entries have a name that is not UTF-8 and are')} not in the snapshot.`,
      details: pathDetails(reading.undecodable),
    });
  }

  // Each folder follows the nearest `.forceignore`: its own, or the one of the nearest folder above it.
  const rules = new Map<string, (path: string) => boolean>();
  const excludes = dirs.map((dir) => {
    for (const candidate of ignoreFileCandidates(dir)) {
      let rule = rules.get(candidate);
      if (rule === undefined) {
        const content = readOne(candidate);
        if (content === null || content === 'link') continue;
        rules.set(candidate, (rule = ignoreRules(candidate, content)));
      }
      return { dir, rule };
    }
    return { dir, rule: (): boolean => false };
  });
  const excluded = (path: string): boolean => excludes.some(({ dir, rule }) => below(dir, path) && rule(path));

  const links = [...deciding].filter(([, content]) => content === 'link').map(([path]) => path);
  const skipped = [...reading.skipped, ...links].sort(byCodeUnit);
  if (skipped.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'LINK_SKIPPED',
      message:
        `${plural(skipped.length, 'entry is', 'entries are')} not read. Symbolic links, submodules, other repositories inside the source and special files are left out.` +
        (links.length > 0 ? ` That includes ${links.join(', ')}, so its rules are not applied.` : ''),
      details: pathDetails(skipped),
    });
  }

  const ignored = reading.tree.files.filter(excluded);
  if (ignored.length > 0) {
    issues.push({
      severity: 'info',
      code: 'FILES_IGNORED',
      message: `${plural(ignored.length, 'file is', 'files are')} left out by ${FORCEIGNORE_FILE}.`,
      details: pathDetails(ignored),
    });
  }
  const considered = filterTree(reading.tree, (path) => !excluded(path));

  const resolution = await resolveComponents(considered, dirs);
  for (const problem of resolution.problems) {
    issues.push({
      severity: 'error',
      code: 'RESOLVE_FAILED',
      message: `${problem.at} could not be read as metadata: ${problem.message}`,
      details: { at: problem.at },
    });
  }
  if (resolution.duplicates.length > 0) {
    const count = resolution.duplicates.length;
    const first = resolution.duplicates[0];
    // A warning, not an error: nothing is missing from the snapshot. Repositories that hold several packages
    // have such components on purpose.
    issues.push({
      severity: 'warning',
      code: 'COMPONENT_DEFINED_TWICE',
      message: `${plural(count, 'component is', 'components are')} defined in more than one place. The files of every definition are in the snapshot, and which definition counts is not known. The first: ${first?.type ?? ''} ${first?.fullName ?? ''} in ${(first?.paths ?? []).join(' and ')}.`,
      details: {
        count,
        components: resolution.duplicates
          .slice(0, COMPONENTS_PER_ISSUE)
          .map(({ type, fullName, paths }) => ({ type, fullName, paths: [...paths] })),
      },
    });
  }
  const apex = resolution.unresolved.filter((path) => APEX_FILE.test(path));
  const other = resolution.unresolved.filter((path) => !APEX_FILE.test(path));
  if (apex.length > 0) {
    issues.push({
      severity: 'error',
      code: 'APEX_FILE_UNRESOLVED',
      message: `${plural(apex.length, 'Apex file belongs', 'Apex files belong')} to no component. An Apex file needs its -meta.xml file beside it, in a folder named "classes" or "triggers".`,
      details: pathDetails(apex),
    });
  }
  if (other.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'FILES_NOT_METADATA',
      message: `${plural(other.length, 'file is', 'files are')} not part of a metadata component and not in the snapshot.`,
      details: pathDetails(other),
    });
  }

  let commit = fromCommit;
  let holds: LocalReading['holds'] = null;
  if (fromCommit === null) {
    const head = checkedOut(repoDir);
    if (head.commit === null) {
      issues.push({
        severity: 'info',
        code: 'COMMIT_UNKNOWN',
        message: `The snapshot names no commit: ${NO_COMMIT_BECAUSE[head.why]}`,
        details: { reason: head.why },
      });
    } else {
      // The project file and every place a `.forceignore` can be at decide what is read, so they count as well.
      const candidates = new Set([
        ...(source.paths === null ? [PROJECT_FILE] : []),
        ...dirs.flatMap(ignoreFileCandidates),
      ]);
      const applied = new Map<string, Uint8Array>();
      for (const path of candidates) {
        const content = readOne(path);
        if (content !== null && content !== 'link') applied.set(path, content);
      }
      const difference = differencesFromCommit(
        repoDir,
        head.commit,
        [...dirs, ...candidates],
        (path) => candidates.has(path) || !excluded(path),
        {
          files: [...new Set([...considered.files, ...applied.keys()])],
          read: (path) => applied.get(path) ?? considered.read(path),
        },
      );
      if (difference.paths.length === 0) {
        commit = head.commit;
        holds = difference.holds;
      } else {
        const count = difference.paths.length;
        issues.push({
          severity: 'info',
          code: 'WORKING_TREE_MODIFIED',
          message: difference.onlyLineEndings
            ? `The snapshot names no commit: ${plural(count, 'file differs', 'files differ')} from the commit that is checked out in line endings, which Git converts on this machine. To read the commit itself, set "ref" of the source.`
            : `The snapshot names no commit: ${plural(count, 'file differs', 'files differ')} from the commit that is checked out, or ${count === 1 ? 'is' : 'are'} on one side only.`,
          details: { ...pathDetails(difference.paths), onlyLineEndings: difference.onlyLineEndings },
        });
      }
    }
  }

  const owned = new Set(resolution.components.flatMap((component) => component.files));
  return {
    dirs,
    commit,
    holds,
    components: resolution.components,
    tree: filterTree(considered, (path) => owned.has(path)),
    issues,
  };
}
