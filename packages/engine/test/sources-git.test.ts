import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFolders } from '../src/sources/folder.ts';
import { checkedOut, commitOf, differencesFromCommit, readCommit, readCommitFile } from '../src/sources/git.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { createRepo, type TestRepo } from './helpers/git-repo.ts';
import { tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const text = (content: Uint8Array): string => new TextDecoder().decode(content);

/** The details of the engine error `run` throws. */
function failure(run: () => unknown): { code: string; reason: unknown } {
  try {
    run();
  } catch (error) {
    const { code, details } = error as { code?: string; details?: { reason?: unknown } };
    return { code: code ?? String(error), reason: details?.reason };
  }
  return { code: 'did not throw', reason: undefined };
}

function repoWithOneCommit(): { repo: TestRepo; commit: string } {
  const repo = createRepo(temp.next());
  repo.write('app/classes/A.cls', 'class A {}\n');
  repo.write('app/classes/B.cls', 'class B {}\n');
  repo.write('other/C.cls', 'class C {}\n');
  repo.write('README.md', '# readme\n');
  return { repo, commit: repo.commit() };
}

describe('naming a commit', () => {
  it('resolves a branch, a tag, a full and a short commit id to the full id', () => {
    const { repo, commit } = repoWithOneCommit();
    repo.git('tag', 'v1');
    repo.git('branch', 'release/1.0');
    for (const ref of ['main', 'v1', 'release/1.0', 'HEAD', commit, commit.slice(0, 10)]) {
      expect(commitOf(repo.dir, ref)).toBe(commit);
    }
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('says so when the repository has no such branch, tag or commit', () => {
    const { repo } = repoWithOneCommit();
    expect(failure(() => commitOf(repo.dir, 'no-such-branch'))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'REF_NOT_FOUND',
    });
  });

  it('never reads a ref as an option of Git', () => {
    const { repo } = repoWithOneCommit();
    for (const ref of ['--help', '-h', '--git-dir=/tmp', '--output=x']) {
      expect(failure(() => commitOf(repo.dir, ref))).toEqual({ code: 'SOURCE_READ_FAILED', reason: 'REF_NOT_FOUND' });
    }
  });

  it('says so when the folder is not in a repository', () => {
    expect(failure(() => commitOf(temp.next(), 'main'))).toEqual({ code: 'SOURCE_READ_FAILED', reason: 'GIT_FAILED' });
  });
});

describe('reading a commit', () => {
  it('lists the files of the commit below the folders, whatever the working tree holds', () => {
    const { repo, commit } = repoWithOneCommit();
    // After the commit: one file changed, one deleted, one added. None of this is in the commit.
    repo.write('app/classes/A.cls', 'changed\n');
    rmSync(join(repo.dir, 'app', 'classes', 'B.cls'));
    repo.write('app/classes/New.cls', 'new\n');

    const reading = readCommit(repo.dir, commit, ['app']);
    expect(reading).toMatchObject({ missing: [], skipped: [] });
    expect(reading.tree.files).toEqual(['app/classes/A.cls', 'app/classes/B.cls']);
    expect(text(reading.tree.read('app/classes/A.cls'))).toBe('class A {}\n');
    expect(() => reading.tree.read('other/C.cls')).toThrow('not a file of this tree');
  });

  it('returns exactly the bytes the commit holds', () => {
    const repo = createRepo(temp.next());
    const contents: Record<string, Uint8Array> = {
      'app/crlf.cls': new TextEncoder().encode('line one\r\nline two\r\n'),
      'app/binary.resource': new Uint8Array([0, 1, 2, 255, 254, 10, 10, 0]),
      'app/empty.cls': new Uint8Array(0),
      'app/no-line-end.cls': new TextEncoder().encode('no line end'),
      'app/mit leerzeichen/größe.cls': new TextEncoder().encode('ß\n'),
    };
    for (const [path, content] of Object.entries(contents)) repo.write(path, content);
    const commit = repo.commit();

    const { tree } = readCommit(repo.dir, commit, ['app']);
    expect(tree.files).toEqual(Object.keys(contents).sort((a, b) => (a < b ? -1 : 1)));
    for (const [path, content] of Object.entries(contents)) expect(new Uint8Array(tree.read(path))).toEqual(content);
  });

  it('gives the same contents when it reads in many small batches and keeps almost none of them', () => {
    const repo = createRepo(temp.next());
    const paths = Array.from({ length: 40 }, (_, index) => `app/f${String(index).padStart(2, '0')}.cls`);
    for (const path of paths) repo.write(path, `content of ${path}\n`.repeat(3));
    const commit = repo.commit();

    const { tree } = readCommit(repo.dir, commit, ['app'], { batchBytes: 100, cacheBytes: 150 });
    // Forwards, backwards and one file twice: every batch is read again after it left the cache.
    for (const path of [...paths, ...paths.toReversed(), paths[7] ?? '']) {
      expect(text(tree.read(path))).toBe(`content of ${path}\n`.repeat(3));
    }
  });

  it('reads paths relative to the folder it is given, which need not be the top of the repository', () => {
    const repo = createRepo(temp.next());
    repo.write('salesforce/app/A.cls', 'a\n');
    repo.write('salesforce/sfdx-project.json', '{}\n');
    repo.write('app/Top.cls', 'top\n');
    const commit = repo.commit();
    const below = join(repo.dir, 'salesforce');

    expect(commitOf(below, 'main')).toBe(commit);
    expect(readCommit(below, commit, ['app']).tree.files).toEqual(['app/A.cls']);
    expect(text(readCommitFile(below, commit, 'sfdx-project.json') ?? new Uint8Array())).toBe('{}\n');
    expect(readCommitFile(below, commit, 'app/Top.cls')).toBeNull();
  });

  it('skips symbolic links and submodules, and reports them', () => {
    const { repo } = repoWithOneCommit();
    // Both are written into the index directly, so the test needs no right to create links.
    const target = repo.git('rev-parse', 'HEAD:README.md');
    repo.git('update-index', '--add', '--cacheinfo', `120000,${target},app/classes/link.cls`);
    repo.git('update-index', '--add', '--cacheinfo', `160000,${repo.git('rev-parse', 'HEAD')},app/vendor`);
    repo.git('commit', '--quiet', '-m', 'A link and a submodule');
    const commit = repo.git('rev-parse', 'HEAD');

    const reading = readCommit(repo.dir, commit, ['app']);
    expect(reading.tree.files).toEqual(['app/classes/A.cls', 'app/classes/B.cls']);
    expect(reading.skipped).toEqual(['app/classes/link.cls', 'app/vendor']);
    expect(readCommitFile(repo.dir, commit, 'app/classes/link.cls')).toBeNull();
  });

  it('reports a folder the commit does not have', () => {
    const { repo, commit } = repoWithOneCommit();
    mkdirSync(join(repo.dir, 'only-on-disk'));
    writeFileSync(join(repo.dir, 'only-on-disk', 'x.cls'), 'x');
    expect(readCommit(repo.dir, commit, ['app', 'only-on-disk', 'nowhere'])).toMatchObject({
      tree: { files: ['app/classes/A.cls', 'app/classes/B.cls'] },
      missing: ['nowhere', 'only-on-disk'],
    });
  });

  it('reads one file of a commit, and gives null for a folder or for nothing', () => {
    const { repo, commit } = repoWithOneCommit();
    expect(text(readCommitFile(repo.dir, commit, 'README.md') ?? new Uint8Array())).toBe('# readme\n');
    expect(readCommitFile(repo.dir, commit, 'app')).toBeNull();
    expect(readCommitFile(repo.dir, commit, 'nowhere.txt')).toBeNull();
  });
});

/** The files of the folder `app` as they are on disk, in the shape the comparison reads. */
function onDisk(repo: TestRepo, dir = 'app'): SourceTree {
  return readFolders(repo.dir, [dir]).tree;
}

describe('the commit that is checked out', () => {
  it('names it, also from a folder below the top of the repository', () => {
    const { repo, commit } = repoWithOneCommit();
    expect(checkedOut(repo.dir)).toEqual({ commit });
    expect(checkedOut(join(repo.dir, 'app'))).toEqual({ commit });
  });

  it('names none in a repository that has none', () => {
    const repo = createRepo(temp.next());
    repo.write('app/A.cls', 'a\n');
    expect(checkedOut(repo.dir)).toEqual({ commit: null });
  });

  it('gives null for a folder that is not in a repository', () => {
    const dir = temp.next();
    mkdirSync(join(dir, 'app'));
    expect(checkedOut(dir)).toBeNull();
  });
});

describe('comparing files on disk with a commit', () => {
  const all = (): boolean => true;
  const same = { paths: [], onlyLineEndings: false };

  it('finds no difference when the folders hold exactly what the commit holds', () => {
    const { repo, commit } = repoWithOneCommit();
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual(same);
  });

  it.each<[string, (repo: TestRepo) => void, string]>([
    [
      'a changed file',
      (repo) => {
        repo.write('app/classes/A.cls', 'changed\n');
      },
      'app/classes/A.cls',
    ],
    [
      'a deleted file',
      (repo) => {
        rmSync(join(repo.dir, 'app', 'classes', 'B.cls'));
      },
      'app/classes/B.cls',
    ],
    [
      'a new file',
      (repo) => {
        repo.write('app/classes/New.cls', 'new\n');
      },
      'app/classes/New.cls',
    ],
    [
      'a file Git ignores',
      (repo) => {
        repo.write('.git/info/exclude', '*.log\n');
        repo.write('app/debug.log', 'ignored by Git, and still a file of the folder\n');
      },
      'app/debug.log',
    ],
    [
      'a changed file that is staged',
      (repo) => {
        repo.write('app/classes/A.cls', 'staged\n');
        repo.git('add', '--all');
      },
      'app/classes/A.cls',
    ],
    [
      'a changed file Git was told to assume unchanged',
      (repo) => {
        repo.git('update-index', '--assume-unchanged', 'app/classes/A.cls');
        repo.write('app/classes/A.cls', 'changed all the same\n');
      },
      'app/classes/A.cls',
    ],
    [
      'a file a sparse checkout would leave out',
      (repo) => {
        repo.git('update-index', '--skip-worktree', 'app/classes/B.cls');
        rmSync(join(repo.dir, 'app', 'classes', 'B.cls'));
      },
      'app/classes/B.cls',
    ],
  ])('sees %s', (_name, change, path) => {
    const { repo, commit } = repoWithOneCommit();
    change(repo);
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual({
      paths: [path],
      onlyLineEndings: false,
    });
  });

  it('does not count a change outside the paths, or a file of the commit that is not kept', () => {
    const { repo, commit } = repoWithOneCommit();
    repo.write('other/C.cls', 'changed\n');
    repo.write('untracked.txt', 'new\n');
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual(same);
    expect(differencesFromCommit(repo.dir, commit, ['app', 'other'], all, onDisk(repo)).paths).toEqual(['other/C.cls']);
    expect(
      differencesFromCommit(repo.dir, commit, ['app', 'other'], (path) => !path.startsWith('other/'), onDisk(repo)),
    ).toEqual(same);
  });

  it('says so when the only difference is the line endings Git converts on checkout', () => {
    const { repo, commit } = repoWithOneCommit();
    // What a machine that converts line endings does on checkout.
    rmSync(join(repo.dir, 'app', 'classes', 'A.cls'));
    repo.git('-c', 'core.autocrlf=true', 'checkout', '--', 'app/classes/A.cls');
    expect(readFileSync(join(repo.dir, 'app', 'classes', 'A.cls'), 'utf8')).toBe('class A {}\r\n');
    // Git itself calls this working tree clean.
    expect(repo.git('-c', 'core.autocrlf=true', 'status', '--porcelain')).toBe('');
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual({
      paths: ['app/classes/A.cls'],
      onlyLineEndings: true,
    });

    repo.write('app/classes/B.cls', 'class B { }\r\n');
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual({
      paths: ['app/classes/A.cls', 'app/classes/B.cls'],
      onlyLineEndings: false,
    });
  });

  it('counts a file that cannot be read as a difference', () => {
    const { repo, commit } = repoWithOneCommit();
    const tree = onDisk(repo);
    const unreadable: SourceTree = {
      files: tree.files,
      read: (path) => {
        if (path === 'app/classes/B.cls') throw new Error('EACCES');
        return tree.read(path);
      },
    };
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, unreadable)).toEqual({
      paths: ['app/classes/B.cls'],
      onlyLineEndings: false,
    });
  });

  it('works in a repository that names its objects with SHA-256', ({ skip }) => {
    const dir = temp.next();
    // Older versions of Git cannot create such a repository.
    if (spawnSync('git', ['init', '--quiet', '--object-format=sha256', dir]).status !== 0) skip();
    const repo = createRepo(dir);
    repo.write('app/classes/A.cls', 'class A {}\n');
    const commit = repo.commit();
    expect(commit).toHaveLength(64);
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual(same);
    repo.write('app/classes/A.cls', 'class A { }\n');
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo)).paths).toEqual(['app/classes/A.cls']);
    expect(text(readCommit(repo.dir, commit, ['app']).tree.read('app/classes/A.cls'))).toBe('class A {}\n');
  });

  it('leaves the repository as it was', () => {
    const { repo, commit } = repoWithOneCommit();
    const before = repo.git('status', '--porcelain=v2', '--branch');
    checkedOut(repo.dir);
    differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo));
    readCommit(repo.dir, commit, ['app']).tree.read('app/classes/A.cls');
    expect(repo.git('status', '--porcelain=v2', '--branch')).toBe(before);
    expect(repo.git('stash', 'list')).toBe('');
  });
});
