import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readFolders } from '../src/sources/folder.ts';
import {
  checkedOut,
  commitOf,
  differencesFromCommit,
  gitEnvironment,
  parseGitVersion,
  readCommit,
  readCommitFile,
} from '../src/sources/git.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { withEnvironment, withoutGit as withoutGitIn } from './helpers/environment.ts';
import { createRepo, folderFingerprint, testGitEnvironment, type TestRepo } from './helpers/git-repo.ts';
import { tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const text = (content: Uint8Array): string => new TextDecoder().decode(content);

/** What `readCommitFile` gave: the text of a file, or what it says instead. */
const fileText = (content: Uint8Array | 'link' | null): string | null =>
  content instanceof Uint8Array ? text(content) : content;

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
    // One file per batch, and Git is started once per batch. Starting a program is slow on Windows, so few files.
    const paths = Array.from({ length: 8 }, (_, index) => `app/f${String(index)}.cls`);
    for (const path of paths) repo.write(path, `content of ${path}\n`.repeat(3));
    const commit = repo.commit();

    const { tree } = readCommit(repo.dir, commit, ['app'], { batchBytes: 100, cacheBytes: 150 });
    // Forwards, backwards and one file twice: every batch is read again after it left the cache.
    for (const path of [...paths, ...paths.toReversed(), paths[3] ?? '']) {
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
    expect(fileText(readCommitFile(below, commit, 'sfdx-project.json'))).toBe('{}\n');
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
    // A link is told apart from nothing, so that whoever asked can say that a link was not followed.
    expect(readCommitFile(repo.dir, commit, 'app/classes/link.cls')).toBe('link');
    expect(readCommitFile(repo.dir, commit, 'app/vendor')).toBe('link');
  });

  it('does not take a file for a folder, or a link or a submodule', () => {
    const { repo } = repoWithOneCommit();
    const target = repo.git('rev-parse', 'HEAD:README.md');
    repo.git('update-index', '--add', '--cacheinfo', `120000,${target},linked`);
    repo.git('update-index', '--add', '--cacheinfo', `160000,${repo.git('rev-parse', 'HEAD')},vendor`);
    repo.git('commit', '--quiet', '-m', 'A link and a submodule');
    const commit = repo.git('rev-parse', 'HEAD');

    const reading = readCommit(repo.dir, commit, ['README.md', 'linked', 'vendor', 'app']);
    expect(reading.tree.files).toEqual(['app/classes/A.cls', 'app/classes/B.cls']);
    // The file is not there as a folder. The link and the submodule are there and are not read.
    expect(reading.missing).toEqual(['README.md']);
    expect(reading.skipped).toEqual(['linked', 'vendor']);
  });

  it('leaves out a file whose name is not UTF-8, and says so, where two such names would become one', (context) => {
    const repo = createRepo(temp.next());
    repo.write('app/classes/A.cls', 'class A {}\n');
    // Only Linux keeps a name that is not text. The two names differ in one byte that is not UTF-8.
    const names = [
      Buffer.from('app/classes/latin\xe9.cls', 'latin1'),
      Buffer.from('app/classes/latin\xe8.cls', 'latin1'),
    ];
    try {
      for (const name of names) writeFileSync(Buffer.concat([Buffer.from(`${repo.dir}/`), name]), 'x\n');
    } catch {
      context.skip();
    }
    if (readFolders(repo.dir, ['app']).undecodable.length !== 2) context.skip();
    const commit = repo.commit();

    const reading = readCommit(repo.dir, commit, ['app']);
    expect(reading.tree.files).toEqual(['app/classes/A.cls']);
    expect(reading.undecodable).toEqual(['app/classes/latin\ufffd.cls', 'app/classes/latin\ufffd.cls']);
    // The same from disk, and the comparison with the commit does not call the two sides equal.
    const disk = readFolders(repo.dir, ['app']);
    expect(disk.tree.files).toEqual(['app/classes/A.cls']);
    expect(disk.undecodable).toEqual(reading.undecodable);
    expect(differencesFromCommit(repo.dir, commit, ['app'], () => true, disk.tree).paths).toEqual(reading.undecodable);
  });

  it('fetches nothing in a partial clone, and says that a file of the commit is not there', () => {
    const origin = createRepo(temp.next());
    origin.write('app/classes/A.cls', 'class A {}\n');
    origin.commit();
    origin.git('config', 'uploadpack.allowFilter', 'true');
    const dir = temp.next();
    const cloned = spawnSync(
      'git',
      ['clone', '--quiet', '--no-checkout', '--filter=blob:none', pathToFileURL(origin.dir).href, dir],
      { env: testGitEnvironment(), encoding: 'utf8' },
    );
    expect(cloned.status, cloned.stderr).toBe(0);
    const before = folderFingerprint(join(dir, '.git'));

    const commit = commitOf(dir, 'HEAD');
    expect(failure(() => readCommit(dir, commit, ['app']))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'OBJECT_MISSING',
    });
    expect(failure(() => readCommitFile(dir, commit, 'app/classes/A.cls'))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'OBJECT_MISSING',
    });
    // Which files the commit has is known without their content, so the folders can still be compared with it.
    const onDiskOnly: SourceTree = { files: [], read: () => new Uint8Array() };
    expect(differencesFromCommit(dir, commit, ['app'], () => true, onDiskOnly).paths).toEqual(['app/classes/A.cls']);
    expect(folderFingerprint(join(dir, '.git'))).toBe(before);
  });

  it('says that a file of the commit is not there when the repository has lost it', () => {
    const { repo, commit } = repoWithOneCommit();
    const reading = readCommit(repo.dir, commit, ['app']);
    const object = repo.git('rev-parse', `${commit}:app/classes/A.cls`);
    const file = join(repo.dir, '.git', 'objects', object.slice(0, 2), object.slice(2));
    // Git writes its files read-only, and Windows does not delete such a file.
    chmodSync(file, 0o666);
    rmSync(file);

    const lost = { code: 'SOURCE_READ_FAILED', reason: 'OBJECT_MISSING' };
    // The file was listed before it was lost, and is read after.
    expect(failure(() => reading.tree.read('app/classes/A.cls'))).toEqual(lost);
    expect(failure(() => readCommit(repo.dir, commit, ['app']))).toEqual(lost);
    expect(failure(() => readCommitFile(repo.dir, commit, 'app/classes/A.cls'))).toEqual(lost);
    expect(fileText(readCommitFile(repo.dir, commit, 'app/classes/B.cls'))).toBe('class B {}\n');
  });

  it('reads the object a commit names, not one a replacement points to', () => {
    const { repo, commit } = repoWithOneCommit();
    const original = repo.git('rev-parse', `${commit}:app/classes/A.cls`);
    repo.git('replace', original, repo.git('rev-parse', `${commit}:app/classes/B.cls`));
    // Git itself now shows the content of B for A. The reading does not.
    expect(repo.git('cat-file', 'blob', original)).toBe('class B {}');
    expect(text(readCommit(repo.dir, commit, ['app']).tree.read('app/classes/A.cls'))).toBe('class A {}\n');
    expect(fileText(readCommitFile(repo.dir, commit, 'app/classes/A.cls'))).toBe('class A {}\n');
    expect(differencesFromCommit(repo.dir, commit, ['app'], () => true, onDisk(repo)).paths).toEqual([]);
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
    expect(fileText(readCommitFile(repo.dir, commit, 'README.md'))).toBe('# readme\n');
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
    expect(checkedOut(repo.dir)).toEqual({ commit: null, why: 'NO_COMMIT' });
  });

  it('says that a folder is not in a repository', () => {
    const dir = temp.next();
    mkdirSync(join(dir, 'app'));
    expect(checkedOut(dir)).toEqual({ commit: null, why: 'NOT_A_REPOSITORY' });
  });

  it('says that Git refuses a repository of another user', (context) => {
    const { repo } = repoWithOneCommit();
    // Git has this switch for its own tests. A setting of the machine that trusts every folder overrules it.
    const refused = withEnvironment({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }, () => {
      const probe = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: repo.dir, encoding: 'utf8' });
      if (!probe.stderr.includes('dubious ownership')) return null;
      return {
        fromDisk: checkedOut(repo.dir),
        byName: failure(() => commitOf(repo.dir, 'main')),
      };
    });
    if (refused === null) context.skip();
    expect(refused).toEqual({
      fromDisk: { commit: null, why: 'NOT_TRUSTED' },
      byName: { code: 'SOURCE_READ_FAILED', reason: 'GIT_FAILED' },
    });
  });
});

describe('without a git program', () => {
  const withoutGit = <T>(work: () => T): T => withoutGitIn(temp.next(), work);

  it('still answers what is checked out: nothing that Git could tell', () => {
    const { repo } = repoWithOneCommit();
    expect(withoutGit(() => checkedOut(repo.dir))).toEqual({ commit: null, why: 'GIT_NOT_INSTALLED' });
  });

  it('says that Git is needed to read a commit', () => {
    const { repo, commit } = repoWithOneCommit();
    const notInstalled = { code: 'SOURCE_READ_FAILED', reason: 'GIT_NOT_INSTALLED' };
    expect(withoutGit(() => failure(() => commitOf(repo.dir, 'main')))).toEqual(notInstalled);
    expect(withoutGit(() => failure(() => readCommit(repo.dir, commit, ['app'])))).toEqual(notInstalled);
    expect(withoutGit(() => failure(() => readCommitFile(repo.dir, commit, 'README.md')))).toEqual(notInstalled);
  });
});

describe('the environment Git is started with', () => {
  it('reads the repository of the folder, whatever repository the environment points at', () => {
    const { repo, commit } = repoWithOneCommit();
    const other = createRepo(temp.next());
    other.write('app/classes/Other.cls', 'class Other {}\n');
    const otherCommit = other.commit();
    expect(otherCommit).not.toBe(commit);

    // What Git hands to a hook it runs for the other repository, and more of the kind.
    const pointingElsewhere = {
      GIT_DIR: join(other.dir, '.git'),
      GIT_WORK_TREE: other.dir,
      GIT_INDEX_FILE: join(other.dir, '.git', 'index'),
      GIT_OBJECT_DIRECTORY: join(other.dir, '.git', 'objects'),
      GIT_COMMON_DIR: join(other.dir, '.git'),
      GIT_PREFIX: 'app/',
      GIT_NAMESPACE: 'elsewhere',
    };
    withEnvironment(pointingElsewhere, () => {
      expect(commitOf(repo.dir, 'main')).toBe(commit);
      expect(checkedOut(repo.dir)).toEqual({ commit });
      expect(readCommit(repo.dir, commit, ['app']).tree.files).toEqual(['app/classes/A.cls', 'app/classes/B.cls']);
      expect(fileText(readCommitFile(repo.dir, commit, 'README.md'))).toBe('# readme\n');
      expect(differencesFromCommit(repo.dir, commit, ['app'], () => true, onDisk(repo)).paths).toEqual([]);
    });
  });

  it('reads a path as it is written, whatever the environment says about paths', () => {
    const repo = createRepo(temp.next());
    repo.write('app/classes/A.cls', 'class A {}\n');
    // A folder whose name is also a pattern that matches the other folder.
    repo.write('a[pq]p/classes/Pattern.cls', 'class Pattern {}\n');
    const commit = repo.commit();
    for (const name of ['GIT_ICASE_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS']) {
      withEnvironment({ [name]: '1' }, () => {
        expect(readCommit(repo.dir, commit, ['a[pq]p']).tree.files, name).toEqual(['a[pq]p/classes/Pattern.cls']);
        expect(readCommit(repo.dir, commit, ['APP']).missing, name).toEqual(['APP']);
      });
    }
    // A folder name that Git would otherwise read as an instruction is a name.
    expect(readCommit(repo.dir, commit, [':(glob)**']).missing).toEqual([':(glob)**']);
    expect(readCommit(repo.dir, commit, ['a[pq]p']).tree.files).toEqual(['a[pq]p/classes/Pattern.cls']);
  });

  it('removes what belongs to one repository and sets what keeps Git from asking, locking, replacing and fetching', () => {
    const made = gitEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/someone',
      GIT_DIR: '/elsewhere/.git',
      git_work_tree: '/elsewhere',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_PARAMETERS: "'core.fsmonitor=evil'",
      GIT_ALLOW_PROTOCOL: 'file:ssh',
      GIT_NO_REPLACE_OBJECTS: '0',
      GIT_SSH_COMMAND: 'kept',
    });
    expect(made).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/someone',
      GIT_SSH_COMMAND: 'kept',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_NO_LAZY_FETCH: '1',
      GIT_LITERAL_PATHSPECS: '1',
      LC_ALL: 'C',
    });
  });

  it('removes every variable Git itself calls local to a repository', () => {
    const local = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env: testGitEnvironment() });
    const names = local.stdout.split('\n').filter((name) => name !== '');
    expect(names).toContain('GIT_DIR');
    const made = gitEnvironment(Object.fromEntries(names.map((name) => [name, 'x'])));
    // The one it sets itself is on Git's list too.
    expect(Object.keys(made).filter((name) => names.includes(name))).toEqual(['GIT_NO_REPLACE_OBJECTS']);
  });

  it('reads the version of Git', () => {
    expect(parseGitVersion('git version 2.43.0\n')).toEqual([2, 43]);
    expect(parseGitVersion('git version 2.47.1.windows.2\n')).toEqual([2, 47]);
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)\n')).toEqual([2, 39]);
    expect(parseGitVersion('something else')).toBeNull();
  });
});

describe('comparing files on disk with a commit', () => {
  const all = (): boolean => true;
  const same = { paths: [], onlyLineEndings: false, holds: expect.any(Function) as unknown };

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
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toMatchObject({
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
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toMatchObject({
      paths: ['app/classes/A.cls'],
      onlyLineEndings: true,
    });

    repo.write('app/classes/B.cls', 'class B { }\r\n');
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toMatchObject({
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
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, unreadable)).toMatchObject({
      paths: ['app/classes/B.cls'],
      onlyLineEndings: false,
    });
  });

  it('works in a repository that names its objects with SHA-256', ({ skip }) => {
    let repo: TestRepo;
    try {
      repo = createRepo(temp.next(), { sha256: true });
    } catch {
      // Older versions of Git cannot create such a repository.
      skip();
      return;
    }
    repo.write('app/classes/A.cls', 'class A {}\n');
    const commit = repo.commit();
    expect(commit).toHaveLength(64);
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo))).toEqual(same);
    repo.write('app/classes/A.cls', 'class A { }\n');
    expect(differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo)).paths).toEqual(['app/classes/A.cls']);
    expect(text(readCommit(repo.dir, commit, ['app']).tree.read('app/classes/A.cls'))).toBe('class A {}\n');
  });

  it('tells for a content read later whether it is the content of the commit', () => {
    const { repo, commit } = repoWithOneCommit();
    const { holds } = differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo));
    const bytes = (content: string): Uint8Array => new TextEncoder().encode(content);
    expect(holds('app/classes/A.cls', bytes('class A {}\n'))).toBe(true);
    expect(holds('app/classes/A.cls', bytes('class A { }\n'))).toBe(false);
    expect(holds('app/classes/A.cls', bytes('class B {}\n'))).toBe(false);
    expect(holds('app/classes/New.cls', bytes('class A {}\n'))).toBe(false);
  });

  it('leaves the repository as it was, down to every file of it', () => {
    const { repo, commit } = repoWithOneCommit();
    repo.write('app/classes/A.cls', 'changed, so that Git would have an index to refresh\n');
    const before = folderFingerprint(join(repo.dir, '.git'));
    checkedOut(repo.dir);
    commitOf(repo.dir, 'main');
    differencesFromCommit(repo.dir, commit, ['app'], all, onDisk(repo));
    readCommit(repo.dir, commit, ['app']).tree.read('app/classes/A.cls');
    readCommitFile(repo.dir, commit, 'README.md');
    expect(folderFingerprint(join(repo.dir, '.git'))).toBe(before);
  });
});
