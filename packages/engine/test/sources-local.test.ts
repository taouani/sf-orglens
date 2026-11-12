import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitSource } from '../src/core/config/config.ts';
import { readLocalSource, type LocalReading } from '../src/sources/local.ts';
import { withEnvironment, withoutGit } from './helpers/environment.ts';
import { createRepo, folderFingerprint, PROJECT_JSON, projectFiles, type TestRepo } from './helpers/git-repo.ts';
import { canLoseAccess, tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const source = (overrides: Partial<GitSource> = {}): GitSource => ({
  kind: 'git',
  name: 'repo',
  description: null,
  repo: '.',
  ref: null,
  paths: null,
  tracks: null,
  ...overrides,
});

/** A repository with the small project, its project file, and one commit. */
function projectRepo(extra: Record<string, string> = {}): { repo: TestRepo; commit: string } {
  const repo = createRepo(temp.next());
  for (const [path, content] of Object.entries({ ...projectFiles(), 'sfdx-project.json': PROJECT_JSON, ...extra })) {
    repo.write(path, content);
  }
  return { repo, commit: repo.commit() };
}

const names = (reading: LocalReading): string[] =>
  reading.components.map((component) => `${component.type}:${component.fullName}`);
const codes = (reading: LocalReading): string[] => reading.issues.map((issue) => `${issue.severity} ${issue.code}`);
const hashes = (reading: LocalReading): Record<string, string> =>
  Object.fromEntries(
    reading.tree.files.map((file) => [file, createHash('sha256').update(reading.tree.read(file)).digest('hex')]),
  );

async function failure(run: () => Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  try {
    await run();
  } catch (error) {
    const { code, details } = error as { code?: string; details?: { reason?: unknown } };
    return { code: code ?? String(error), reason: details?.reason };
  }
  return { code: 'did not throw', reason: undefined };
}

/** The message of what `run` throws. */
async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return 'did not throw';
}

/** Adds a symbolic link to the index of a repository, so that the next commit holds one. Needs no right to create links. */
function stageLink(repo: TestRepo, path: string, target: string): void {
  // The content of a link is the path it points to. It is stored through a file that is removed again.
  repo.write('.link-target', target);
  const object = repo.git('hash-object', '-w', '--no-filters', '.link-target');
  rmSync(join(repo.dir, '.link-target'));
  repo.git('update-index', '--add', '--cacheinfo', `120000,${object},${path}`);
}

const COMPONENTS = ['ApexClass:Greeter', 'CustomField:Parcel__c.Weight__c', 'CustomObject:Parcel__c'];

describe('reading a Git source', () => {
  it('reads the folders from disk and names the commit when they hold exactly that commit', async () => {
    const { repo, commit } = projectRepo();
    const reading = await readLocalSource(repo.dir, source());
    expect(reading.dirs).toEqual(['force-app']);
    expect(reading.commit).toBe(commit);
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.tree.files).toHaveLength(4);
    expect(reading.issues).toEqual([]);
  });

  it('reads a commit to the same components, the same files and the same bytes as the folder it was made from', async () => {
    const { repo, commit } = projectRepo();
    const fromDisk = await readLocalSource(repo.dir, source());
    const fromCommit = await readLocalSource(repo.dir, source({ ref: 'main' }));
    expect(fromCommit.commit).toBe(commit);
    expect(fromCommit.components).toEqual(fromDisk.components);
    expect(hashes(fromCommit)).toEqual(hashes(fromDisk));
    expect(fromCommit.issues).toEqual([]);
  });

  it('reads the commit and not the working tree when a ref is set', async () => {
    const { repo, commit } = projectRepo();
    repo.write('force-app/main/default/classes/Greeter.cls', 'public class Greeter { /* changed */ }\n');
    repo.write('force-app/main/default/classes/New.cls', 'public class New {}\n');
    repo.write('force-app/main/default/classes/New.cls-meta.xml', '<ApexClass/>\n');
    rmSync(join(repo.dir, 'force-app', 'main', 'default', 'objects'), { recursive: true });

    const fromCommit = await readLocalSource(repo.dir, source({ ref: commit.slice(0, 12) }));
    expect(fromCommit.commit).toBe(commit);
    expect(names(fromCommit)).toEqual(COMPONENTS);
    expect(new TextDecoder().decode(fromCommit.tree.read('force-app/main/default/classes/Greeter.cls'))).toContain(
      "return 'hello'",
    );

    const fromDisk = await readLocalSource(repo.dir, source());
    expect(names(fromDisk)).toEqual(['ApexClass:Greeter', 'ApexClass:New']);
    // What is on disk is not what the commit holds, so the snapshot must not claim the commit.
    expect(fromDisk.commit).toBeNull();
    expect(fromDisk.issues).toEqual([
      {
        severity: 'info',
        code: 'WORKING_TREE_MODIFIED',
        message: expect.stringContaining('5 files differ from the commit that is checked out') as string,
        details: {
          count: 5,
          paths: [
            'force-app/main/default/classes/Greeter.cls',
            'force-app/main/default/classes/New.cls',
            'force-app/main/default/classes/New.cls-meta.xml',
            'force-app/main/default/objects/Parcel__c/Parcel__c.object-meta.xml',
            'force-app/main/default/objects/Parcel__c/fields/Weight__c.field-meta.xml',
          ],
          onlyLineEndings: false,
        },
      },
    ]);
  });

  it('names no commit when what decides the reading differs from the commit: the project file, a .forceignore', async () => {
    const changes: [string, string][] = [
      ['sfdx-project.json', `${PROJECT_JSON}\n`],
      ['.forceignore', '# nothing\n'],
      ['force-app/.forceignore', '# nothing\n'],
    ];
    for (const [path, content] of changes) {
      const { repo } = projectRepo();
      repo.write(path, content);
      const reading = await readLocalSource(repo.dir, source());
      expect(reading.commit, path).toBeNull();
      expect(reading.issues.at(-1), path).toMatchObject({ code: 'WORKING_TREE_MODIFIED', details: { paths: [path] } });
    }
    // With "paths" the project file is not read, so it does not count.
    const { repo, commit } = projectRepo();
    repo.write('sfdx-project.json', `${PROJECT_JSON}\n`);
    expect((await readLocalSource(repo.dir, source({ paths: ['force-app'] }))).commit).toBe(commit);
  });

  it('names the commit when the only files that differ are left out by .forceignore', async () => {
    const { repo, commit } = projectRepo({ '.forceignore': '**/*.log\n' });
    repo.write('force-app/main/default/classes/debug.log', 'not in the commit\n');
    repo.write('force-app/main/default/.DS_Store', 'not in the commit\n');
    const reading = await readLocalSource(repo.dir, source());
    expect(reading.commit).toBe(commit);
    expect(codes(reading)).toEqual(['info FILES_IGNORED']);
  });

  it('names no commit when Git converted line endings on checkout, and says that this is the difference', async () => {
    const { repo } = projectRepo();
    // What a machine that converts line endings does on checkout.
    rmSync(join(repo.dir, 'force-app'), { recursive: true });
    repo.git('-c', 'core.autocrlf=true', 'checkout', '--', 'force-app');
    // Git itself calls this working tree clean.
    expect(repo.git('-c', 'core.autocrlf=true', 'status', '--porcelain')).toBe('');

    const reading = await readLocalSource(repo.dir, source());
    expect(reading.commit).toBeNull();
    expect(reading.issues).toHaveLength(1);
    expect(reading.issues[0]).toMatchObject({
      severity: 'info',
      code: 'WORKING_TREE_MODIFIED',
      details: { count: 4, onlyLineEndings: true },
    });
    expect(reading.issues[0]?.message).toContain('line endings');
    expect(reading.issues[0]?.message).toContain('"ref"');
  });

  it('names no commit in a repository that has none yet', async () => {
    const repo = createRepo(temp.next());
    for (const [path, content] of Object.entries({ ...projectFiles(), 'sfdx-project.json': PROJECT_JSON })) {
      repo.write(path, content);
    }
    const reading = await readLocalSource(repo.dir, source());
    expect(reading.commit).toBeNull();
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.issues).toEqual([
      {
        severity: 'info',
        code: 'COMMIT_UNKNOWN',
        message: 'The snapshot names no commit: the repository has no commit yet.',
        details: { reason: 'NO_COMMIT' },
      },
    ]);
  });

  it('names no commit for a folder that is not in a repository', async () => {
    const { repo } = projectRepo();
    rmSync(join(repo.dir, '.git'), { recursive: true });
    const reading = await readLocalSource(repo.dir, source());
    expect(reading.commit).toBeNull();
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.issues).toEqual([
      {
        severity: 'info',
        code: 'COMMIT_UNKNOWN',
        message: 'The snapshot names no commit: the folder is not in a Git repository.',
        details: { reason: 'NOT_A_REPOSITORY' },
      },
    ]);
  });

  it('reads the folders without a git program, and names no commit', async () => {
    const { repo } = projectRepo();
    const reading = await withoutGit(temp.next(), () => readLocalSource(repo.dir, source()));
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.tree.files).toHaveLength(4);
    expect(reading.commit).toBeNull();
    expect(reading.issues).toEqual([
      {
        severity: 'info',
        code: 'COMMIT_UNKNOWN',
        message: 'The snapshot names no commit: no "git" program was found.',
        details: { reason: 'GIT_NOT_INSTALLED' },
      },
    ]);
    // A commit cannot be read without Git, and the error says that.
    expect(
      await withoutGit(temp.next(), () => failure(() => readLocalSource(repo.dir, source({ ref: 'main' })))),
    ).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'GIT_NOT_INSTALLED',
    });
  });

  it('says why no commit is named when Git refuses a repository of another user', async (context) => {
    const { repo } = projectRepo();
    const reading = await withEnvironment({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' }, () => {
      // Git has this switch for its own tests. A setting of the machine that trusts every folder overrules it.
      const probe = spawnSync('git', ['rev-parse', '--git-dir'], { cwd: repo.dir, encoding: 'utf8' });
      return probe.stderr.includes('dubious ownership') ? readLocalSource(repo.dir, source()) : null;
    });
    if (reading === null) {
      context.skip();
      return;
    }
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.commit).toBeNull();
    expect(reading.issues).toMatchObject([{ code: 'COMMIT_UNKNOWN', details: { reason: 'NOT_TRUSTED' } }]);
    expect(reading.issues[0]?.message).toContain('safe.directory');
    // Nothing of this machine is in what will be stored.
    expect(JSON.stringify(reading.issues)).not.toContain(repo.dir);
  });

  it('reads its own repository when the environment points Git at another one', async () => {
    const { repo, commit } = projectRepo();
    const other = createRepo(temp.next());
    other.write('sfdx-project.json', PROJECT_JSON);
    other.write('force-app/main/default/classes/Other.cls', 'public class Other {}\n');
    other.write('force-app/main/default/classes/Other.cls-meta.xml', '<ApexClass/>\n');
    other.commit();

    // This is what a program inherits that Git starts as a hook of the other repository.
    const inherited = {
      GIT_DIR: join(other.dir, '.git'),
      GIT_WORK_TREE: other.dir,
      GIT_INDEX_FILE: join(other.dir, '.git', 'index'),
    };
    for (const ref of [null, 'main']) {
      const reading = await withEnvironment(inherited, () => readLocalSource(repo.dir, source({ ref })));
      expect(names(reading), String(ref)).toEqual(COMPONENTS);
      expect(reading.commit, String(ref)).toBe(commit);
      expect(reading.issues, String(ref)).toEqual([]);
    }
  });

  it('finds the repository relative to the workspace, and the folders from "paths" before the project file', async () => {
    const workspace = temp.next();
    const repo = createRepo(join(workspace, 'repos', 'billing'));
    for (const [path, content] of Object.entries({
      ...projectFiles('core'),
      'extra/classes/Other.cls': 'public class Other {}\n',
      'extra/classes/Other.cls-meta.xml': '<ApexClass/>\n',
      'sfdx-project.json': '{ this is not read }',
    })) {
      repo.write(path, content);
    }
    repo.commit();
    for (const ref of [null, 'main']) {
      const reading = await readLocalSource(
        workspace,
        source({ repo: 'repos/billing', paths: ['extra', 'core'], ref }),
      );
      expect(reading.dirs).toEqual(['extra', 'core']);
      expect(names(reading)).toEqual(['ApexClass:Greeter', 'ApexClass:Other', ...COMPONENTS.slice(1)]);
    }
  });

  it('leaves out what .forceignore excludes, and says how many files that were', async () => {
    const { repo } = projectRepo({
      '.forceignore': '**/objects/**\n',
      'force-app/main/default/classes/.hidden': 'x',
    });
    for (const ref of [null, 'main']) {
      const reading = await readLocalSource(repo.dir, source({ ref }));
      expect(names(reading)).toEqual(['ApexClass:Greeter']);
      expect(reading.tree.files).toHaveLength(2);
      expect(reading.issues).toEqual([
        {
          severity: 'info',
          code: 'FILES_IGNORED',
          message: '3 files are left out by .forceignore.',
          details: {
            count: 3,
            paths: [
              'force-app/main/default/classes/.hidden',
              'force-app/main/default/objects/Parcel__c/Parcel__c.object-meta.xml',
              'force-app/main/default/objects/Parcel__c/fields/Weight__c.field-meta.xml',
            ],
          },
        },
      ]);
    }
  });

  it('follows the .forceignore of the commit when it reads a commit, and the one on disk when it reads the disk', async () => {
    const { repo } = projectRepo({ '.forceignore': '**/classes/**\n' });
    repo.write('.forceignore', '**/objects/**\n');
    expect(names(await readLocalSource(repo.dir, source({ ref: 'main' })))).toEqual(COMPONENTS.slice(1));
    const fromDisk = await readLocalSource(repo.dir, source());
    expect(names(fromDisk)).toEqual(['ApexClass:Greeter']);
    // The file that decides what is read has changed, so the reading is not the commit.
    expect(fromDisk.commit).toBeNull();
  });

  it('follows the nearest .forceignore for each folder, and none without one', async () => {
    const repo = createRepo(temp.next());
    for (const [path, content] of Object.entries({
      ...projectFiles('one/main'),
      ...projectFiles('two/main'),
      'one/.forceignore': 'main/classes/**\n',
    })) {
      repo.write(path, content);
    }
    repo.commit();
    const reading = await readLocalSource(repo.dir, source({ paths: ['one', 'two'] }));
    expect(reading.tree.files.filter((file) => file.includes('/classes/'))).toEqual([
      'two/main/classes/Greeter.cls',
      'two/main/classes/Greeter.cls-meta.xml',
    ]);
    // The two files of the class, and the .forceignore itself: with the file come the default rules, and they
    // exclude every file whose name starts with a dot.
    // The object and its field are in both folders. An object may be, a field is one definition too many.
    expect(reading.issues.map((issue) => [issue.severity, issue.code, issue.details?.['count']])).toEqual([
      ['info', 'FILES_IGNORED', 3],
      ['warning', 'COMPONENT_DEFINED_TWICE', 1],
    ]);
    expect(reading.issues[1]?.details?.['components']).toEqual([
      {
        type: 'CustomField',
        fullName: 'Parcel__c.Weight__c',
        paths: [
          'one/main/objects/Parcel__c/fields/Weight__c.field-meta.xml',
          'two/main/objects/Parcel__c/fields/Weight__c.field-meta.xml',
        ],
      },
    ]);
    expect(reading.issues[1]?.message).toContain('CustomField Parcel__c.Weight__c');
  });

  it('does not look for a .forceignore above the folder that "repo" names', async () => {
    const repo = createRepo(temp.next());
    for (const [path, content] of Object.entries({
      ...Object.fromEntries(Object.entries(projectFiles()).map(([path, content]) => [`salesforce/${path}`, content])),
      'salesforce/sfdx-project.json': PROJECT_JSON,
      // At the top of the repository, above the source. The Salesforce CLI would apply it. OrgLens does not.
      '.forceignore': '**/classes/**\n',
    })) {
      repo.write(path, content);
    }
    const commit = repo.commit();
    for (const ref of [null, 'main']) {
      const reading = await readLocalSource(repo.dir, source({ repo: 'salesforce', ref }));
      expect(names(reading)).toEqual(COMPONENTS);
      expect(reading.commit).toBe(commit);
      expect(reading.issues).toEqual([]);
    }
    // The same file inside the source is applied.
    repo.write('salesforce/.forceignore', '**/classes/**\n');
    const inside = await readLocalSource(repo.dir, source({ repo: 'salesforce' }));
    expect(names(inside)).toEqual(COMPONENTS.filter((name) => !name.startsWith('ApexClass')));
  });

  it('reports files that are no metadata, and counts an Apex file without a component as an error', async () => {
    const { repo } = projectRepo({
      'force-app/main/default/classes/Lost.cls': 'public class Lost {}\n',
      'force-app/main/default/triggers/Lost.trigger': 'trigger Lost on Account (before insert) {}\n',
      'force-app/README.md': '# notes\n',
    });
    const reading = await readLocalSource(repo.dir, source());
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.tree.files).toHaveLength(4);
    expect(reading.issues).toMatchObject([
      {
        severity: 'error',
        code: 'APEX_FILE_UNRESOLVED',
        details: {
          count: 2,
          paths: ['force-app/main/default/classes/Lost.cls', 'force-app/main/default/triggers/Lost.trigger'],
        },
      },
      { severity: 'warning', code: 'FILES_NOT_METADATA', details: { count: 1, paths: ['force-app/README.md'] } },
    ]);
  });

  it('loses one file, not the package directory, to a -meta.xml file without its class', async () => {
    const orphan = 'force-app/main/default/classes/Orphan.cls-meta.xml';
    const { repo, commit } = projectRepo({ [orphan]: '<ApexClass/>\n' });
    for (const ref of [null, 'main']) {
      const reading = await readLocalSource(repo.dir, source({ ref }));
      expect(names(reading)).toEqual(COMPONENTS);
      expect(reading.tree.files).toHaveLength(4);
      expect(reading.commit).toBe(commit);
      // One issue, about the one file. Nothing claims that the classes beside it have no -meta.xml file.
      expect(reading.issues).toMatchObject([{ severity: 'error', code: 'RESOLVE_FAILED', details: { at: orphan } }]);
      expect(reading.issues).toHaveLength(1);
    }
  });

  it('does not take a link, a submodule or a file for a folder of the source', async () => {
    const { repo } = projectRepo({ 'plain-file': 'not a folder\n' });
    stageLink(repo, 'linked', 'force-app');
    repo.git('update-index', '--add', '--cacheinfo', `160000,${repo.git('rev-parse', 'HEAD')},vendor`);
    repo.git('commit', '--quiet', '-m', 'A link and a submodule');

    const reading = await readLocalSource(
      repo.dir,
      source({ ref: 'main', paths: ['force-app', 'linked', 'vendor', 'plain-file'] }),
    );
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.issues).toMatchObject([
      { severity: 'error', code: 'FOLDER_MISSING', details: { count: 3, paths: ['linked', 'plain-file', 'vendor'] } },
      { severity: 'warning', code: 'LINK_SKIPPED', details: { count: 2, paths: ['linked', 'vendor'] } },
    ]);
    // With no folder left to read, there is no snapshot to take: not an empty one that calls itself complete.
    for (const paths of [['linked'], ['vendor'], ['plain-file'], ['linked', 'vendor', 'plain-file', 'nowhere']]) {
      expect(await failure(() => readLocalSource(repo.dir, source({ ref: 'main', paths })))).toEqual({
        code: 'SOURCE_READ_FAILED',
        reason: 'FOLDERS_MISSING',
      });
    }
    expect(await failure(() => readLocalSource(repo.dir, source({ paths: ['plain-file'] })))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'FOLDERS_MISSING',
    });
  });

  it('does not take a folder on disk that is a link for a folder of the source', async (context) => {
    const { repo } = projectRepo();
    try {
      symlinkSync(join(repo.dir, 'force-app'), join(repo.dir, 'linked'), 'dir');
    } catch {
      // Windows lets only some users create links.
      context.skip();
    }
    const reading = await readLocalSource(repo.dir, source({ paths: ['force-app', 'linked'] }));
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.issues).toMatchObject([
      { severity: 'error', code: 'FOLDER_MISSING', details: { count: 1, paths: ['linked'] } },
      { severity: 'warning', code: 'LINK_SKIPPED', details: { count: 1, paths: ['linked'] } },
    ]);
    expect(reading.issues).toHaveLength(2);
    expect(await failure(() => readLocalSource(repo.dir, source({ paths: ['linked'] })))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'FOLDERS_MISSING',
    });
  });

  it('does not follow a .forceignore or a project file that is a link, and says so', async () => {
    const { repo } = projectRepo({ 'shared.ignore': '**/classes/**\n', 'real-project.json': PROJECT_JSON });
    stageLink(repo, '.forceignore', 'shared.ignore');
    repo.git('commit', '--quiet', '-m', 'A linked .forceignore');
    const reading = await readLocalSource(repo.dir, source({ ref: 'main' }));
    // The rules of the link are not applied: the class is read. The issue names the file, so this is no surprise.
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.issues).toMatchObject([
      { severity: 'warning', code: 'LINK_SKIPPED', details: { count: 1, paths: ['.forceignore'] } },
    ]);
    expect(reading.issues[0]?.message).toContain('.forceignore, so its rules are not applied');

    repo.git('rm', '--quiet', '--cached', 'sfdx-project.json');
    stageLink(repo, 'sfdx-project.json', 'real-project.json');
    repo.git('commit', '--quiet', '-m', 'A linked project file');
    const run = (): Promise<unknown> => readLocalSource(repo.dir, source({ ref: 'main' }));
    expect(await failure(run)).toEqual({ code: 'SOURCE_READ_FAILED', reason: 'PROJECT_FILE_MISSING' });
    expect(await messageOf(run)).toContain('is a symbolic link');
  });

  it('does the same for links on disk', async (context) => {
    const { repo } = projectRepo({ 'shared.ignore': '**/classes/**\n' });
    try {
      symlinkSync(join(repo.dir, 'shared.ignore'), join(repo.dir, '.forceignore'));
    } catch {
      context.skip();
    }
    const reading = await readLocalSource(repo.dir, source());
    expect(names(reading)).toEqual(COMPONENTS);
    expect(reading.issues).toMatchObject([
      { severity: 'warning', code: 'LINK_SKIPPED', details: { count: 1, paths: ['.forceignore'] } },
    ]);
    // The link is not in the commit, and it is treated on disk as it would be in one: no file is there.
    expect(reading.commit).not.toBeNull();
  });

  it('reports files whose name is not UTF-8 as missing, and does not let two of them become one', async (context) => {
    const { repo } = projectRepo();
    const classes = `${repo.dir}/force-app/main/default/classes/`;
    try {
      // Only Linux keeps such names. The two classes differ in one byte that is not UTF-8.
      for (const name of ['latin\xe9.cls', 'latin\xe8.cls']) {
        writeFileSync(Buffer.concat([Buffer.from(classes), Buffer.from(name, 'latin1')]), 'public class X {}\n');
        writeFileSync(
          Buffer.concat([Buffer.from(classes), Buffer.from(`${name}-meta.xml`, 'latin1')]),
          '<ApexClass/>\n',
        );
      }
    } catch {
      context.skip();
    }
    const commit = repo.commit('Names that are not text');
    const fromCommit = await readLocalSource(repo.dir, source({ ref: 'main' }));
    if (!fromCommit.issues.some((issue) => issue.code === 'NAME_NOT_UTF8')) context.skip();

    expect(names(fromCommit)).toEqual(COMPONENTS);
    expect(fromCommit.commit).toBe(commit);
    expect(fromCommit.issues).toMatchObject([{ severity: 'error', code: 'NAME_NOT_UTF8', details: { count: 4 } }]);
    // From disk the same four are missing, so the folders do not hold the commit.
    const fromDisk = await readLocalSource(repo.dir, source());
    expect(names(fromDisk)).toEqual(COMPONENTS);
    expect(fromDisk.commit).toBeNull();
    expect(fromDisk.issues).toMatchObject([
      { severity: 'error', code: 'NAME_NOT_UTF8', details: { count: 4 } },
      { severity: 'info', code: 'WORKING_TREE_MODIFIED', details: { count: 4 } },
    ]);
  });

  it('leaves out a repository inside a package directory, from disk as from a commit', async () => {
    const { repo } = projectRepo();
    const inner = createRepo(join(repo.dir, 'force-app', 'vendor'));
    inner.write('classes/Vendored.cls', 'public class Vendored {}\n');
    inner.write('classes/Vendored.cls-meta.xml', '<ApexClass/>\n');
    inner.commit();
    // Git records a repository inside a repository as a submodule would be: by its commit, without its files.
    const commit = repo.commit('With a repository inside');

    const fromDisk = await readLocalSource(repo.dir, source());
    const fromCommit = await readLocalSource(repo.dir, source({ ref: 'main' }));
    for (const reading of [fromDisk, fromCommit]) {
      expect(names(reading)).toEqual(COMPONENTS);
      expect(reading.commit).toBe(commit);
      expect(reading.issues).toMatchObject([
        { severity: 'warning', code: 'LINK_SKIPPED', details: { count: 1, paths: ['force-app/vendor'] } },
      ]);
    }
    expect(hashes(fromDisk)).toEqual(hashes(fromCommit));
  });

  it.runIf(canLoseAccess)('reads the rest when a folder may not be listed, and says which one', async () => {
    const { repo } = projectRepo();
    const classes = join(repo.dir, 'force-app', 'main', 'default', 'classes');
    chmodSync(classes, 0o000);
    try {
      const reading = await readLocalSource(repo.dir, source());
      expect(names(reading)).toEqual(COMPONENTS.filter((name) => !name.startsWith('ApexClass')));
      expect(reading.commit).toBeNull();
      expect(reading.issues).toMatchObject([
        {
          severity: 'error',
          code: 'FOLDER_UNREADABLE',
          details: { count: 1, paths: ['force-app/main/default/classes'], reasons: ['EACCES'] },
        },
        { severity: 'info', code: 'WORKING_TREE_MODIFIED' },
      ]);
      expect(JSON.stringify(reading.issues)).not.toContain(repo.dir);

      chmodSync(join(repo.dir, 'force-app'), 0o000);
      expect(await failure(() => readLocalSource(repo.dir, source()))).toEqual({
        code: 'SOURCE_READ_FAILED',
        reason: 'FOLDERS_MISSING',
      });
    } finally {
      chmodSync(join(repo.dir, 'force-app'), 0o755);
      chmodSync(classes, 0o755);
    }
  });

  it.runIf(canLoseAccess)(
    'fails as a source that cannot be read when a file that decides the reading may not be read',
    async () => {
      for (const path of ['sfdx-project.json', '.forceignore']) {
        const { repo } = projectRepo({ '.forceignore': '**/classes/**\n' });
        chmodSync(join(repo.dir, path), 0o000);
        const run = (): Promise<unknown> => readLocalSource(repo.dir, source());
        expect(await failure(run), path).toEqual({ code: 'SOURCE_READ_FAILED', reason: 'FILE_UNREADABLE' });
        // The message names the file inside the source, not by its path on this machine.
        expect(await messageOf(run), path).toBe(`${path} could not be read (EACCES).`);
      }
    },
  );

  it('names no commit when a file that is in no component is on disk only, and names the file', async () => {
    const { repo } = projectRepo();
    repo.write('force-app/main/default/notes.txt', 'not in the commit, and not metadata\n');
    const reading = await readLocalSource(repo.dir, source());
    // The files that are stored are those of the commit. The folders as a whole are not: that is the claim.
    expect(reading.commit).toBeNull();
    expect(reading.issues).toMatchObject([
      { code: 'FILES_NOT_METADATA', details: { paths: ['force-app/main/default/notes.txt'] } },
      { code: 'WORKING_TREE_MODIFIED', details: { paths: ['force-app/main/default/notes.txt'] } },
    ]);
  });

  it('reports a folder that is missing and reads the others', async () => {
    const { repo } = projectRepo();
    for (const ref of [null, 'main']) {
      const reading = await readLocalSource(repo.dir, source({ paths: ['force-app', 'gone'], ref }));
      expect(names(reading)).toEqual(COMPONENTS);
      expect(reading.issues).toMatchObject([
        { severity: 'error', code: 'FOLDER_MISSING', details: { count: 1, paths: ['gone'] } },
      ]);
    }
  });

  it.each([
    ['the repository is not a folder', { repo: 'nowhere' }, 'REPO_NOT_FOUND'],
    ['no folder of the source exists', { paths: ['gone', 'also-gone'] }, 'FOLDERS_MISSING'],
    ['no folder of the source exists in the commit', { paths: ['gone'], ref: 'main' }, 'FOLDERS_MISSING'],
    ['the ref does not exist', { ref: 'no-such-branch' }, 'REF_NOT_FOUND'],
  ] as const)('fails when %s', async (_name, overrides, reason) => {
    const { repo } = projectRepo();
    expect(await failure(() => readLocalSource(repo.dir, source(overrides)))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason,
    });
  });

  it('fails when there are no "paths" and no usable project file, on disk and in a commit', async () => {
    const repo = createRepo(temp.next());
    for (const [path, content] of Object.entries(projectFiles())) repo.write(path, content);
    repo.commit();
    for (const ref of [null, 'main']) {
      expect(await failure(() => readLocalSource(repo.dir, source({ ref })))).toEqual({
        code: 'SOURCE_READ_FAILED',
        reason: 'PROJECT_FILE_MISSING',
      });
    }
    repo.write('sfdx-project.json', '{}');
    expect(await failure(() => readLocalSource(repo.dir, source()))).toEqual({
      code: 'SOURCE_READ_FAILED',
      reason: 'PROJECT_FILE_INVALID',
    });
  });

  it('changes nothing in the repository', async () => {
    const { repo } = projectRepo();
    repo.write('force-app/main/default/classes/Greeter.cls', 'changed\n');
    const before = folderFingerprint(join(repo.dir, '.git'));
    const status = repo.git('status', '--porcelain=v2', '--branch');
    await readLocalSource(repo.dir, source());
    await readLocalSource(repo.dir, source({ ref: 'main' }));
    // Not one file of the repository is new, gone or different: no index refreshed, no object added, no lock left.
    expect(folderFingerprint(join(repo.dir, '.git'))).toBe(before);
    expect(repo.git('status', '--porcelain=v2', '--branch')).toBe(status);
  });
});
