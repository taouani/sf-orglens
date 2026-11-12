import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { GitSource } from '../src/core/config/config.ts';
import { readLocalSource, type LocalReading } from '../src/sources/local.ts';
import { createRepo, PROJECT_JSON, projectFiles, type TestRepo } from './helpers/git-repo.ts';
import { tempDirs } from './helpers/store.ts';

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
      },
    ]);
  });

  it('names no commit for a folder that is not in a repository', async () => {
    const { repo } = projectRepo();
    rmSync(join(repo.dir, '.git'), { recursive: true });
    const reading = await readLocalSource(repo.dir, source());
    expect(reading.commit).toBeNull();
    expect(names(reading)).toEqual(COMPONENTS);
    expect(codes(reading)).toEqual(['info COMMIT_UNKNOWN']);
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
    expect(reading.issues.map((issue) => [issue.code, issue.details?.['count']])).toEqual([['FILES_IGNORED', 3]]);
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
    const before = repo.git('status', '--porcelain=v2', '--branch');
    await readLocalSource(repo.dir, source());
    await readLocalSource(repo.dir, source({ ref: 'main' }));
    expect(repo.git('status', '--porcelain=v2', '--branch')).toBe(before);
  });
});
