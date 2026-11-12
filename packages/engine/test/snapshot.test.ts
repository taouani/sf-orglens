import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { initWorkspace, openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { getBlob } from '../src/store/blobs.ts';
import { openStore } from '../src/store/open.ts';
import { createRepo, PROJECT_JSON, projectFiles, type TestRepo } from './helpers/git-repo.ts';
import { canLoseAccess, DRIVERS, tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CLASS = 'force-app/main/default/classes/Greeter.cls';
const FILES = Object.keys(projectFiles()).sort();

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code: string; message: string; hint?: string; details?: Record<string, unknown> }> {
  try {
    await run();
  } catch (error) {
    return (error as { toJSON: () => { code: string; message: string } }).toJSON();
  }
  throw new Error('did not throw');
}

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))('snapshots with %s', (driverName, driver) => {
  const env = { ORGLENS_SQLITE_DRIVER: driverName };

  /**
   * A repository that is also the workspace: the small project with one commit, and a configuration that declares
   * the folder as `work`, its branch as `main`, and an org as `prod`.
   */
  async function setUp(
    extra: Record<string, string> = {},
  ): Promise<{ repo: TestRepo; commit: string; workspace: Workspace; database: string }> {
    const repo = createRepo(temp.next());
    for (const [path, content] of Object.entries({ ...projectFiles(), 'sfdx-project.json': PROJECT_JSON, ...extra })) {
      repo.write(path, content);
    }
    const commit = repo.commit();
    repo.write(
      'orglens.toml',
      [
        'schema_version = 1',
        '[sources.work]',
        'kind = "git"',
        '[sources.main]',
        'kind = "git"',
        'ref = "main"',
        '[sources.prod]',
        'kind = "org"',
        '',
      ].join('\n'),
    );
    const workspace = await openWorkspace({ root: repo.dir, env });
    return { repo, commit, workspace, database: join(repo.dir, '.orglens', 'orglens.db') };
  }

  /** The files a snapshot holds in the database, with the SHA-256 of what is stored for each. */
  function stored(database: string, snapshot: number): Record<string, string> {
    const store = openStore({ path: database, driver, readOnly: true });
    try {
      const rows = store.all('SELECT path, blob_id FROM snapshot_file WHERE snapshot_id = ? ORDER BY path', snapshot);
      return Object.fromEntries(
        rows.map((row) => [
          String(row['path']),
          createHash('sha256')
            .update(getBlob(store, Number(row['blob_id'])))
            .digest('hex'),
        ]),
      );
    } finally {
      store.close();
    }
  }

  const count = (database: string, table: string): number => {
    const store = openStore({ path: database, driver, readOnly: true });
    try {
      return Number(store.get(`SELECT COUNT(*) AS n FROM ${table}`)?.['n']);
    } finally {
      store.close();
    }
  };

  const onDisk = (repo: TestRepo): Record<string, string> =>
    Object.fromEntries(
      FILES.map((path) => [
        path,
        createHash('sha256')
          .update(readFileSync(join(repo.dir, ...path.split('/'))))
          .digest('hex'),
      ]),
    );

  it('stores the folders as they are on disk, creates the database for it, and reports what it stored', async () => {
    const { repo, commit, workspace, database } = await setUp();
    expect(existsSync(database)).toBe(false);

    const report = await workspace.snapshot('work');
    expect(report).toEqual({
      snapshot: {
        id: 1,
        source: 'work',
        kind: 'git',
        status: 'complete',
        startedAt: expect.stringMatching(UTC) as string,
        finishedAt: expect.stringMatching(UTC) as string,
        engineVersion: expect.stringMatching(/^\d+\.\d+\.\d+/) as string,
        commit,
        files: 4,
        bytes: FILES.reduce((sum, path) => sum + readFileSync(join(repo.dir, ...path.split('/'))).byteLength, 0),
      },
      types: [
        { type: 'ApexClass', listed: 1, retrieved: 1, analysed: 0, note: null },
        { type: 'CustomField', listed: 1, retrieved: 1, analysed: 0, note: null },
        { type: 'CustomObject', listed: 1, retrieved: 1, analysed: 0, note: null },
      ],
      issues: [],
    });
    // Plain data: nothing is lost on the way through JSON.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(stored(database, 1)).toEqual(onDisk(repo));
    expect(readFileSync(join(repo.dir, '.orglens', '.gitignore'), 'utf8')).toBe('*\n');

    // The same report again from the database, and the source in the status.
    expect(await workspace.coverage('work')).toEqual(report);
    expect(await workspace.coverage('work', { snapshot: 1 })).toEqual(report);
    const status = await workspace.status();
    expect(status.sources.find((source) => source.name === 'work')).toMatchObject({
      snapshots: 1,
      latestSnapshot: { id: 1, status: 'complete' },
    });
  });

  it('stores a commit to the same files as the folder it was made from, and shares their content', async () => {
    const { commit, workspace, database } = await setUp();
    const fromDisk = await workspace.snapshot('work');
    const blobs = count(database, 'blob');
    const fromCommit = await workspace.snapshot('main');

    expect(fromCommit.snapshot).toMatchObject({ id: 2, source: 'main', status: 'complete', commit, files: 4 });
    expect(fromCommit.snapshot.bytes).toBe(fromDisk.snapshot.bytes);
    expect(fromCommit.types).toEqual(fromDisk.types);
    expect(stored(database, 2)).toEqual(stored(database, 1));
    expect(count(database, 'blob')).toBe(blobs);
  });

  it('keeps earlier snapshots as they are, and stores only what changed', async () => {
    const { repo, commit, workspace, database } = await setUp();
    await workspace.snapshot('work');
    const before = stored(database, 1);
    const blobs = count(database, 'blob');

    repo.write(CLASS, 'public class Greeter {}\n');
    const second = await workspace.snapshot('work');
    // The folder no longer holds exactly the commit, so the snapshot does not name it.
    expect(second.snapshot).toMatchObject({ id: 2, status: 'complete', commit: null, files: 4 });
    expect(second.issues.map((issue) => `${issue.severity} ${issue.code}`)).toEqual(['info WORKING_TREE_MODIFIED']);
    expect(count(database, 'blob')).toBe(blobs + 1);
    expect(stored(database, 1)).toEqual(before);
    expect(stored(database, 2)).toEqual(onDisk(repo));
    expect(stored(database, 2)[CLASS]).not.toBe(before[CLASS]);

    // The branch still gives what was committed.
    const third = await workspace.snapshot('main');
    expect(third.snapshot).toMatchObject({ id: 3, commit });
    expect(stored(database, 3)).toEqual(before);

    expect((await workspace.coverage('work')).snapshot.id).toBe(2);
    expect((await workspace.coverage('work', { snapshot: 1 })).snapshot).toMatchObject({ id: 1, commit });
  });

  it('stores a reading with something missing as partial, and says what is missing', async () => {
    const { repo, workspace } = await setUp();
    // The body of the class is gone. Its description is still there.
    rmSync(join(repo.dir, ...CLASS.split('/')));
    const report = await workspace.snapshot('work');
    expect(report.snapshot.status).toBe('partial');
    const errors = report.issues.filter((issue) => issue.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    for (const issue of errors) {
      expect(issue.code).toMatch(/^[A-Z][A-Z_]+$/);
      expect(issue.message).not.toBe('');
      // No path of this machine is stored: the place is given inside the source.
      expect(JSON.stringify(issue)).not.toContain(repo.dir);
    }
    expect((await workspace.coverage('work')).snapshot.status).toBe('partial');
  });

  it.runIf(canLoseAccess)(
    'stores what it can when a file may not be read, and counts the component as not retrieved',
    async () => {
      const { repo, workspace, database } = await setUp();
      const file = join(repo.dir, ...CLASS.split('/'));
      chmodSync(file, 0o000);
      try {
        const report = await workspace.snapshot('work');
        expect(report.snapshot).toMatchObject({ status: 'partial', files: 3 });
        expect(report.types.find((one) => one.type === 'ApexClass')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(report.types.find((one) => one.type === 'CustomObject')).toMatchObject({ listed: 1, retrieved: 1 });
        const issue = report.issues.find((one) => one.code === 'FILE_UNREADABLE');
        expect(issue).toMatchObject({
          severity: 'error',
          message: `${CLASS} could not be read (EACCES).`,
          details: { path: CLASS, reason: 'EACCES' },
        });
        expect(issue?.message).not.toContain(repo.dir);
        expect(Object.keys(stored(database, 1))).toEqual(FILES.filter((path) => path !== CLASS));
      } finally {
        chmodSync(file, 0o644);
      }
    },
  );

  it('stores every file once when one package directory lies in another', async () => {
    const { workspace, database } = await setUp({
      'sfdx-project.json': '{ "packageDirectories": [{ "path": "force-app" }, { "path": "force-app/main" }] }\n',
    });
    const report = await workspace.snapshot('work');
    expect(report.snapshot).toMatchObject({ status: 'complete', files: 4 });
    expect(Object.keys(stored(database, 1))).toEqual(FILES);
    expect((await workspace.snapshot('main')).snapshot).toMatchObject({ status: 'complete', files: 4 });
  });

  it('leaves the database as it was when the source cannot be read', async () => {
    const { repo, workspace, database } = await setUp();
    rmSync(join(repo.dir, 'sfdx-project.json'));
    const failed = await failure(() => workspace.snapshot('work'));
    expect(failed).toMatchObject({ code: 'SOURCE_READ_FAILED', details: { reason: 'PROJECT_FILE_MISSING' } });
    // Not even the file is created for a snapshot that was not taken.
    expect(existsSync(database)).toBe(false);

    writeFileSync(join(repo.dir, 'sfdx-project.json'), PROJECT_JSON);
    await workspace.snapshot('work');
    rmSync(join(repo.dir, 'sfdx-project.json'));
    expect((await failure(() => workspace.snapshot('work'))).code).toBe('SOURCE_READ_FAILED');
    expect(count(database, 'snapshot')).toBe(1);
  });

  it('stores nothing of a snapshot that fails while it is written', async () => {
    const { workspace, database } = await setUp();
    await initWorkspace({ dir: workspace.root, env });
    // The name `work` belongs to an org in this database: it was declared as one when its snapshots were taken.
    const store = openStore({ path: database, driver });
    store.run("INSERT INTO source (name, kind, created_at) VALUES ('work', 'org', '2026-01-31T09:30:00.000Z')");
    store.close();

    const failed = await failure(() => workspace.snapshot('work'));
    expect(failed.code).toBe('SOURCE_INVALID');
    expect(count(database, 'snapshot')).toBe(0);
    expect(count(database, 'snapshot_file')).toBe(0);
    expect(count(database, 'blob')).toBe(0);
  });

  it('says that an org cannot be read yet, and that a source is not declared', async () => {
    const { workspace, database } = await setUp();
    expect(await failure(() => workspace.snapshot('prod'))).toMatchObject({
      code: 'SOURCE_READ_FAILED',
      details: { reason: 'KIND_NOT_READABLE', source: 'prod', kind: 'org' },
    });
    expect(await failure(() => workspace.snapshot('nowhere'))).toMatchObject({
      code: 'SOURCE_NOT_FOUND',
      details: { source: 'nowhere' },
    });
    expect(await failure(() => workspace.coverage('nowhere'))).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(existsSync(database)).toBe(false);
  });

  it('says that there is no snapshot: without a database, in an empty one, and for a number that is not there', async () => {
    const { workspace, database } = await setUp();
    const none = {
      code: 'SNAPSHOT_NOT_FOUND',
      message: 'There is no snapshot of the source "work" yet.',
      hint: 'Take one with: orglens snapshot work',
      details: { source: 'work', snapshot: null },
    };
    expect(await failure(() => workspace.coverage('work'))).toMatchObject(none);
    // Asking does not create the database.
    expect(existsSync(database)).toBe(false);

    await initWorkspace({ dir: workspace.root, env });
    expect(await failure(() => workspace.coverage('work'))).toMatchObject(none);

    await workspace.snapshot('work');
    expect(await failure(() => workspace.coverage('work', { snapshot: 7 }))).toMatchObject({
      code: 'SNAPSHOT_NOT_FOUND',
      message: 'The source "work" has no snapshot 7.',
      details: { source: 'work', snapshot: 7 },
    });
    // A snapshot belongs to its source. The number of another source's snapshot does not find it.
    await workspace.snapshot('main');
    expect((await failure(() => workspace.coverage('work', { snapshot: 2 }))).code).toBe('SNAPSHOT_NOT_FOUND');
    expect((await workspace.coverage('main', { snapshot: 2 })).snapshot.source).toBe('main');
  });

  it('never changes the source: not the working tree, not the repository', async () => {
    const { repo, workspace } = await setUp({ '.gitignore': '.orglens/\norglens.toml\n' });
    const head = repo.git('rev-parse', 'HEAD');
    const objects = repo.git('count-objects', '-v');
    await workspace.snapshot('work');
    await workspace.snapshot('main');
    expect(repo.git('status', '--porcelain')).toBe('');
    expect(repo.git('rev-parse', 'HEAD')).toBe(head);
    expect(repo.git('count-objects', '-v')).toBe(objects);
    expect(repo.git('stash', 'list')).toBe('');
  });
});

describe('a snapshot of a repository folder', () => {
  it('writes nothing into the home folder of the user', () => {
    const repo = createRepo(temp.next());
    for (const [path, content] of Object.entries({ ...projectFiles(), 'sfdx-project.json': PROJECT_JSON })) {
      repo.write(path, content);
    }
    repo.commit();
    repo.write(
      'orglens.toml',
      'schema_version = 1\n[sources.work]\nkind = "git"\n[sources.main]\nkind = "git"\nref = "main"\n',
    );

    // The process gets an empty home folder, and nothing that tells the Salesforce libraries to stay quiet.
    const home = temp.next();
    const environment: Record<string, string | undefined> = { ...process.env, HOME: home, USERPROFILE: home };
    for (const name of Object.keys(environment)) {
      if (/^(SF_|SFDX_|XDG_)/.test(name)) environment[name] = undefined;
    }
    const helper = fileURLToPath(new URL('./helpers/take-snapshot.ts', import.meta.url));
    for (const source of ['work', 'main']) {
      const run = spawnSync(process.execPath, [helper, repo.dir, source], { env: environment, encoding: 'utf8' });
      expect(`${run.stdout}${run.stderr}`).toBe('complete 4\n');
      expect(run.status).toBe(0);
    }
    expect(readdirSync(home)).toEqual([]);
  }, 60_000);
});
