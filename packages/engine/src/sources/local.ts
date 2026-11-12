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
import { filterTree, pathDetails, type SourceIssue, type SourceTree } from './tree.ts';

export interface LocalReading {
  /** The folders that were read, relative to the repository. */
  readonly dirs: readonly string[];
  /**
   * The commit whose content the tree holds. `null` if the folders were
   * read from disk and differ from the commit that is checked out, or if
   * Git could not tell.
   */
  readonly commit: string | null;
  readonly components: readonly ResolvedComponent[];
  /** The files of the components, by their path in the repository. */
  readonly tree: SourceTree;
  readonly issues: readonly SourceIssue[];
}

const APEX_FILE = /\.(?:cls|trigger)$/;

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;

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

  /** One file of the source that is read before the tree is: the project file, a `.forceignore`. */
  const readOne = (path: string): Uint8Array | null => {
    if (fromCommit !== null) return readCommitFile(repoDir, fromCommit, path);
    const onDisk = join(repoDir, ...path.split('/'));
    return lstatSync(onDisk, { throwIfNoEntry: false })?.isFile() === true ? readFileSync(onDisk) : null;
  };

  let dirs = source.paths;
  if (dirs === null) {
    const project = readOne(PROJECT_FILE);
    if (project === null) {
      throw new EngineError(
        'SOURCE_READ_FAILED',
        `The repository of the source "${source.name}" has no ${PROJECT_FILE}.`,
        {
          hint: 'Name the folders of the source with "paths" in orglens.toml.',
          details: { reason: 'PROJECT_FILE_MISSING', source: source.name, repo: repoDir },
        },
      );
    }
    dirs = packageDirectories(project);
  }

  const reading = fromCommit === null ? readFolders(repoDir, dirs) : readCommit(repoDir, fromCommit, dirs);
  const below = (dir: string, path: string): boolean => path.startsWith(`${dir}/`);
  const { missing } = reading;
  if (missing.length === dirs.length) {
    throw new EngineError(
      'SOURCE_READ_FAILED',
      `None of the folders of the source "${source.name}" exists${fromCommit === null ? '' : ' in the commit'}: ${dirs.join(', ')}.`,
      { details: { reason: 'FOLDERS_MISSING', source: source.name, repo: repoDir, folders: [...dirs] } },
    );
  }
  if (missing.length > 0) {
    issues.push({
      severity: 'error',
      code: 'FOLDER_MISSING',
      message: `${plural(missing.length, 'folder of the source does', 'folders of the source do')} not exist: ${missing.join(', ')}.`,
      details: pathDetails(missing),
    });
  }
  if (reading.skipped.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'LINK_SKIPPED',
      message: `${plural(reading.skipped.length, 'entry is', 'entries are')} not read, because they are symbolic links, submodules or special files.`,
      details: pathDetails(reading.skipped),
    });
  }

  // Each folder follows the nearest `.forceignore`: its own, or the one of the nearest folder above it.
  const rules = new Map<string, (path: string) => boolean>();
  const excludes = dirs.map((dir) => {
    for (const candidate of ignoreFileCandidates(dir)) {
      let rule = rules.get(candidate);
      if (rule === undefined) {
        const content = readOne(candidate);
        if (content === null) continue;
        rules.set(candidate, (rule = ignoreRules(candidate, content)));
      }
      return { dir, rule };
    }
    return { dir, rule: (): boolean => false };
  });
  const excluded = (path: string): boolean => excludes.some(({ dir, rule }) => below(dir, path) && rule(path));
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
  if (fromCommit === null) {
    const head = checkedOut(repoDir);
    if (head === null) {
      issues.push({
        severity: 'info',
        code: 'COMMIT_UNKNOWN',
        message: 'The snapshot names no commit: the folder is not in a Git repository, or Git is not installed.',
      });
    } else if (head.commit === null) {
      issues.push({
        severity: 'info',
        code: 'COMMIT_UNKNOWN',
        message: 'The snapshot names no commit: the repository has no commit yet.',
      });
    } else {
      // The project file and every place a `.forceignore` can be at decide what is read, so they count as well.
      const candidates = new Set([
        ...(source.paths === null ? [PROJECT_FILE] : []),
        ...dirs.flatMap(ignoreFileCandidates),
      ]);
      const deciding = new Map<string, Uint8Array>();
      for (const path of candidates) {
        const content = readOne(path);
        if (content !== null) deciding.set(path, content);
      }
      const difference = differencesFromCommit(
        repoDir,
        head.commit,
        [...dirs, ...candidates],
        (path) => candidates.has(path) || !excluded(path),
        {
          files: [...new Set([...considered.files, ...deciding.keys()])],
          read: (path) => deciding.get(path) ?? considered.read(path),
        },
      );
      if (difference.paths.length === 0) {
        commit = head.commit;
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
    components: resolution.components,
    tree: filterTree(considered, (path) => owned.has(path)),
    issues,
  };
}
