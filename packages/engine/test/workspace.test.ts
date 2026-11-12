import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { doctor } from '../src/api/doctor.ts';
import { workspacePaths } from '../src/api/layout.ts';
import { initWorkspace, inspectConfig, inspectStore, openWorkspace } from '../src/api/workspace.ts';
import { openStore } from '../src/store/open.ts';
import { canLoseAccess, DRIVERS, tempDirs } from './helpers/store.ts';

/** Links and file permissions as on Linux and macOS. Windows has neither in this form. */
const posix = process.platform !== 'win32';

const dirs = tempDirs();
afterEach(dirs.cleanUp);

/** The engine error thrown by `run`, as its JSON form. */
async function failure(run: () => Promise<unknown>): Promise<{ code: string; message: string; hint?: string }> {
  try {
    await run();
  } catch (error) {
    return (error as { toJSON: () => { code: string; message: string; hint?: string } }).toJSON();
  }
  throw new Error('did not throw');
}

const read = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8');

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))('workspace with %s', (driverName, driver) => {
  const env = { ORGLENS_SQLITE_DRIVER: driverName };

  it('creates a workspace in an empty folder', async () => {
    const dir = join(dirs.next(), 'client-a');
    const result = await initWorkspace({ dir, env });
    expect(result).toEqual({
      root: dir,
      created: ['orglens.toml', '.orglens/.gitignore', '.orglens/orglens.db'],
      existing: false,
    });
    expect(read(dir, 'orglens.toml')).toContain('name = "client-a"');
    expect(read(dir, '.orglens/.gitignore')).toBe('*\n');

    const status = await (await openWorkspace({ root: dir, env })).status();
    expect(status).toEqual({
      root: dir,
      name: 'client-a',
      configFiles: ['orglens.toml'],
      store: {
        file: '.orglens/orglens.db',
        state: 'ready',
        driver: driverName,
        schemaVersion: 1,
        sizeBytes: expect.any(Number) as number,
        problem: null,
      },
      sources: [],
    });
  });

  it('completes a workspace that has only its configuration, and changes nothing the second time', async () => {
    const dir = dirs.next();
    const config = '# ours\nschema_version = 1\n\n[sources.prod]\nkind = "org"\n';
    writeFileSync(join(dir, 'orglens.toml'), config);
    const first = await initWorkspace({ dir, env });
    expect(first).toEqual({ root: dir, created: ['.orglens/.gitignore', '.orglens/orglens.db'], existing: true });
    expect(read(dir, 'orglens.toml')).toBe(config);
    const second = await initWorkspace({ dir, env });
    expect(second).toEqual({ root: dir, created: [], existing: true });
    expect(read(dir, 'orglens.toml')).toBe(config);
    // A name cannot be given to a workspace that has its configuration: the file is never changed by init.
    const named = await failure(() => initWorkspace({ dir, name: 'other', env }));
    expect(named).toMatchObject({
      code: 'WORKSPACE_EXISTS',
      message: expect.stringContaining('already a workspace') as string,
    });
    expect(read(dir, 'orglens.toml')).toBe(config);
  });

  it('tells a database of a newer version from a broken one', async () => {
    const dir = dirs.next();
    await initWorkspace({ dir, env });
    const paths = workspacePaths(dir);
    const config = inspectConfig(paths, env);
    if (!config.ok) throw new Error('The configuration must be valid.');
    const database = new DatabaseSync(paths.databaseFile);
    database.exec('PRAGMA user_version = 99');
    database.close();
    const newer = (await inspectStore(paths, config.config)).store;
    expect(newer).toMatchObject({
      state: 'newer',
      schemaVersion: null,
      problem: expect.stringContaining('schema version 99') as string,
    });
    const status = await (await openWorkspace({ root: dir, env })).status();
    expect(status.store.state).toBe('newer');
  });

  it('reports the snapshots of each source', async () => {
    const dir = dirs.next();
    await initWorkspace({ dir, env });
    const workspace = await openWorkspace({ root: dir, env });
    await workspace.sources.add({ name: 'prod', kind: 'org' });
    await workspace.sources.add({ name: 'repo', kind: 'git', paths: ['force-app'] });

    const store = openStore({ path: join(dir, '.orglens', 'orglens.db'), driver });
    store.write(() => {
      store.run(
        `INSERT INTO source (id, name, kind, created_at) VALUES (1, 'prod', 'org', '2026-01-01T00:00:00.000Z')`,
      );
      for (const [status, finished] of [
        ['complete', '2026-01-02T00:05:00.000Z'],
        ['running', null],
      ] as const) {
        store.run(
          `INSERT INTO snapshot (source_id, status, started_at, finished_at, engine_version) VALUES (1, ?, ?, ?, '0.0.0')`,
          status,
          '2026-01-02T00:00:00.000Z',
          finished,
        );
      }
    });
    store.close();

    const status = await workspace.status();
    expect(status.sources).toEqual([
      {
        name: 'prod',
        kind: 'org',
        description: null,
        orgId: null,
        loginUrl: null,
        snapshots: 2,
        latestSnapshot: { id: 2, status: 'running', startedAt: '2026-01-02T00:00:00.000Z', finishedAt: null },
      },
      {
        name: 'repo',
        kind: 'git',
        description: null,
        repo: '.',
        ref: null,
        paths: ['force-app'],
        tracks: null,
        snapshots: 0,
        latestSnapshot: null,
      },
    ]);
  });

  it('reports a database that is missing or is not one of OrgLens', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n');
    const workspace = await openWorkspace({ root: dir, env });
    const missing = await workspace.status();
    expect(missing.store).toMatchObject({ state: 'missing', schemaVersion: null, sizeBytes: null });
    expect(missing.store.problem).not.toBeNull();
    expect(existsSync(join(dir, '.orglens'))).toBe(false);

    mkdirSync(join(dir, '.orglens'));
    writeFileSync(join(dir, '.orglens', 'orglens.db'), 'This is a text file, not a database. '.repeat(40));
    const foreign = await workspace.status();
    expect(['foreign', 'unusable']).toContain(foreign.store.state);
    expect(foreign.store.sizeBytes).toBeGreaterThan(1000);

    const report = await doctor({ root: dir, env });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'store')?.status).toBe('failed');
  });

  it('gives a full doctor report for a healthy workspace', async () => {
    const dir = dirs.next();
    await initWorkspace({ dir, name: 'Client A', env });
    const report = await doctor({ root: dir, env });
    expect(report.ok).toBe(true);
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['node', 'ok'],
      ['sqlite', 'ok'],
      ['sqlite-fallback', 'ok'],
      ['workspace', 'ok'],
      ['config', 'ok'],
      ['store', 'ok'],
    ]);
    expect(report.checks[4]?.details).toEqual({ sources: [], driver: driverName });
    expect(report.checks[5]?.summary).toBe('The database is at schema version 1.');
    // The report is plain data.
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe('initWorkspace', () => {
  it('refuses a folder inside another workspace', async () => {
    const outer = dirs.next();
    await initWorkspace({ dir: outer });
    const inner = join(outer, 'packages', 'sales');
    mkdirSync(inner, { recursive: true });
    const error = await failure(() => initWorkspace({ dir: inner }));
    expect(error.code).toBe('WORKSPACE_EXISTS');
    // The workspace above is named by its real path: on macOS the folder for temporary files is a link.
    expect(error.message).toBe(`This folder is inside the workspace at ${realpathSync(outer)}.`);
    expect(existsSync(join(inner, 'orglens.toml'))).toBe(false);
  });

  it('refuses a name the configuration does not allow, and writes nothing', async () => {
    const dir = join(dirs.next(), 'new');
    const error = await failure(() => initWorkspace({ dir, name: 'x'.repeat(65) }));
    expect(error).toMatchObject({
      code: 'CONFIG_INVALID',
      message: 'The name cannot be used. A workspace name has 1 to 64 characters.',
    });
    expect(existsSync(dir)).toBe(false);
  });

  it('writes a name with quotes and backslashes so that it reads back unchanged', async () => {
    const dir = dirs.next();
    const name = 'North "A" \\ South';
    await initWorkspace({ dir, name });
    expect((await openWorkspace({ root: dir })).name).toBe(name);
  });

  it('checks the environment before it writes anything', async () => {
    const dir = join(dirs.next(), 'new');
    const error = await failure(() => initWorkspace({ dir, env: { ORGLENS_SQLITE_DRIVER: 'bogus' } }));
    expect(error).toMatchObject({
      code: 'CONFIG_INVALID',
      message: expect.stringContaining('ORGLENS_SQLITE_DRIVER') as string,
    });
    expect(existsSync(dir)).toBe(false);
  });

  it.skipIf(!posix)(
    'refuses a folder that lies inside another workspace when it is reached through a link',
    async () => {
      const outer = dirs.next();
      await initWorkspace({ dir: outer, env: {} });
      mkdirSync(join(outer, 'sub', 'deep'), { recursive: true });
      const link = join(dirs.next(), 'link');
      symlinkSync(join(outer, 'sub', 'deep'), link);
      expect(await failure(() => initWorkspace({ dir: link, env: {} }))).toMatchObject({ code: 'WORKSPACE_EXISTS' });
      expect(existsSync(join(outer, 'sub', 'deep', 'orglens.toml'))).toBe(false);
    },
  );

  it('stops at an invalid configuration and leaves the folder as it is', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\nsurprise = true\n');
    const error = await failure(() => initWorkspace({ dir }));
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.message).toMatch(/^orglens\.toml:2:1: surprise: /);
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });
});

describe('openWorkspace', () => {
  it('finds the workspace from a folder below it', async () => {
    const root = dirs.next();
    await initWorkspace({ dir: root });
    const below = join(root, 'force-app', 'main');
    mkdirSync(below, { recursive: true });
    expect((await openWorkspace({ cwd: below, env: {} })).root).toBe(root);
  });

  it('fails with a hint where there is no workspace', async () => {
    const error = await failure(() => openWorkspace({ cwd: dirs.next(), env: {} }));
    expect(error).toEqual({
      code: 'WORKSPACE_NOT_FOUND',
      message: 'No orglens.toml in this folder or in a folder above it.',
      hint: 'Create a workspace with: orglens init',
    });
  });

  it('takes the folder from ORGLENS_WORKSPACE, and the folder that is passed wins over it', async () => {
    const one = dirs.next();
    const two = dirs.next();
    await initWorkspace({ dir: one, name: 'one' });
    await initWorkspace({ dir: two, name: 'two' });
    const env = { ORGLENS_WORKSPACE: one };
    expect((await openWorkspace({ cwd: two, env })).name).toBe('one');
    expect((await openWorkspace({ root: two, env })).name).toBe('two');
    // An empty variable is the same as none: the workspace is searched from the current folder upwards.
    const below = join(two, 'force-app');
    mkdirSync(below);
    expect((await openWorkspace({ cwd: below, env: { ORGLENS_WORKSPACE: '' } })).name).toBe('two');
  });

  it('does not search upwards from a folder that was named', async () => {
    const root = dirs.next();
    await initWorkspace({ dir: root });
    const below = join(root, 'below');
    mkdirSync(below);
    const error = await failure(() => openWorkspace({ root: below }));
    expect(error.code).toBe('WORKSPACE_NOT_FOUND');
    expect(error.message).toBe(`There is no orglens.toml in ${below}.`);
  });

  it('reports every problem of the configuration with its position', async () => {
    const dir = dirs.next();
    writeFileSync(
      join(dir, 'orglens.toml'),
      'schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "x"\nextra = 1\n',
    );
    try {
      await openWorkspace({ root: dir });
      expect.unreachable();
    } catch (error) {
      const json = (
        error as { toJSON: () => { code: string; message: string; details: { diagnostics: unknown[] } } }
      ).toJSON();
      expect(json.code).toBe('CONFIG_INVALID');
      expect(json.message).toMatch(/^orglens\.toml:4:1: sources\.prod\.org_id: .* \(and 1 more\)$/);
      expect(json.details.diagnostics).toHaveLength(2);
      expect(json.details.diagnostics[1]).toMatchObject({ file: 'orglens.toml', line: 5, column: 1 });
    }
  });

  it('does not take a folder named orglens.toml for a workspace', async () => {
    const dir = dirs.next();
    mkdirSync(join(dir, 'orglens.toml'));
    mkdirSync(join(dir, 'below'));
    expect(await failure(() => openWorkspace({ root: dir, env: {} }))).toMatchObject({ code: 'WORKSPACE_NOT_FOUND' });
    expect(await failure(() => openWorkspace({ cwd: join(dir, 'below'), env: {} }))).toMatchObject({
      code: 'WORKSPACE_NOT_FOUND',
    });
    // A workspace can be created below it: the folder above is none.
    expect((await initWorkspace({ dir: join(dir, 'below'), env: {} })).existing).toBe(false);
  });

  it('reports a failure of the file system as a problem of the workspace, without what looks like a secret', async () => {
    const dir = dirs.next();
    // Made up, and assembled from pieces so that no scanner takes this file for a leak.
    const token = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJtYWRlLXVwIn0', 'bm90LWEtc2lnbmF0dXJl'].join('.');
    writeFileSync(join(dir, token), 'a file where a folder is expected');
    const error = await failure(() => initWorkspace({ dir: join(dir, token, 'workspace'), env: {} }));
    expect(error.code).toBe('WORKSPACE_IO');
    expect(error.message).toMatch(/ENOTDIR|EEXIST|ENOENT/);
    expect(error.message).not.toContain(token);
  });

  it.skipIf(!canLoseAccess)('reports a configuration that cannot be read', async () => {
    const dir = dirs.next();
    await initWorkspace({ dir, env: {} });
    chmodSync(join(dir, 'orglens.toml'), 0o000);
    try {
      expect(await failure(() => openWorkspace({ root: dir, env: {} }))).toMatchObject({ code: 'WORKSPACE_IO' });
      const report = await doctor({ root: dir, env: {} });
      expect(report.ok).toBe(false);
      expect(report.checks.find((check) => check.id === 'config')?.summary).toMatch(
        /^The configuration could not be read\. EACCES/,
      );
    } finally {
      chmodSync(join(dir, 'orglens.toml'), 0o600);
    }
  });

  it('refuses a configuration that is not UTF-8, and does not rewrite it', async () => {
    const dir = dirs.next();
    await initWorkspace({ dir, env: {} });
    // "café" in Latin-1: the byte E9 is not UTF-8.
    const bytes = Buffer.concat([Buffer.from('# caf'), Buffer.from([0xe9]), Buffer.from('\nschema_version = 1\n')]);
    writeFileSync(join(dir, 'orglens.toml'), bytes);
    const error = await failure(() => openWorkspace({ root: dir, env: {} }));
    expect(error).toMatchObject({
      code: 'CONFIG_INVALID',
      message: 'orglens.toml: The file is not UTF-8 text. Save it as UTF-8.',
    });
    expect(readFileSync(join(dir, 'orglens.toml')).equals(bytes)).toBe(true);
    const report = await doctor({ root: dir, env: {} });
    expect(report.checks.find((check) => check.id === 'config')).toMatchObject({ status: 'failed' });
  });

  it('reads the personal settings and names both files', async () => {
    const dir = dirs.next();
    await initWorkspace({ dir });
    writeFileSync(join(dir, '.orglens', 'local.toml'), '[store]\ndriver = "better-sqlite3"\n');
    const status = await (await openWorkspace({ root: dir, env: {} })).status();
    expect(status.configFiles).toEqual(['orglens.toml', '.orglens/local.toml']);
    expect(status.store).toMatchObject({ state: 'ready', driver: 'better-sqlite3' });
  });
});

describe('workspace sources', () => {
  async function workspaceIn(dir: string): ReturnType<typeof openWorkspace> {
    await initWorkspace({ dir, name: 'test' });
    return openWorkspace({ root: dir });
  }

  it('adds sources to the file and lists them', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    const before = read(dir, 'orglens.toml');
    const prod = await workspace.sources.add({ name: 'prod', kind: 'org', orgId: '00D000000000009' });
    expect(prod).toEqual({ name: 'prod', kind: 'org', description: null, orgId: '00D000000000009', loginUrl: null });
    await workspace.sources.add({ name: 'uat', kind: 'sandbox', sandboxOf: 'prod', sandboxName: 'uat' });
    await workspace.sources.add({ name: 'repo', kind: 'git', ref: 'main', paths: ['force-app'], tracks: 'prod' });

    const text = read(dir, 'orglens.toml');
    expect(text.startsWith(before)).toBe(true);
    expect(text).toContain('[sources.uat]\nkind = "sandbox"\nsandbox_of = "prod"\nsandbox_name = "uat"\n');
    expect((await workspace.sources.list()).map((source) => source.name)).toEqual(['prod', 'uat', 'repo']);
    // A second reader of the same folder sees the same.
    expect((await (await openWorkspace({ root: dir })).sources.list()).map((source) => source.kind)).toEqual([
      'org',
      'sandbox',
      'git',
    ]);
    expect(readdirSync(dir).sort()).toEqual(['.orglens', 'orglens.toml']);
  });

  it('refuses a source that exists, one that breaks a rule and one that is in use, and leaves the file alone', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    await workspace.sources.add({ name: 'prod', kind: 'org' });
    await workspace.sources.add({ name: 'repo', kind: 'git', tracks: 'prod' });
    const text = read(dir, 'orglens.toml');

    expect((await failure(() => workspace.sources.add({ name: 'prod', kind: 'org' }))).code).toBe('SOURCE_EXISTS');
    expect((await failure(() => workspace.sources.add({ name: 'Bad Name', kind: 'org' }))).code).toBe('SOURCE_INVALID');
    expect((await failure(() => workspace.sources.add({ name: 'x', kind: 'org', orgId: 'nope' }))).code).toBe(
      'SOURCE_INVALID',
    );
    expect((await failure(() => workspace.sources.remove('prod'))).code).toBe('SOURCE_IN_USE');
    expect((await failure(() => workspace.sources.remove('nobody'))).code).toBe('SOURCE_NOT_FOUND');
    expect(read(dir, 'orglens.toml')).toBe(text);
    expect(readdirSync(dir).sort()).toEqual(['.orglens', 'orglens.toml']);
  });

  it('removes a source and keeps every other line', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    const before = read(dir, 'orglens.toml');
    await workspace.sources.add({ name: 'prod', kind: 'org', description: 'Production' });
    expect(await workspace.sources.remove('prod')).toEqual({ removed: 'prod' });
    expect(read(dir, 'orglens.toml')).toBe(before);
    expect(await workspace.sources.list()).toEqual([]);
  });

  it('works on the file as it is now, not as it was when the workspace was opened', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    writeFileSync(join(dir, 'orglens.toml'), `${read(dir, 'orglens.toml')}\n[sources.byhand]\nkind = "org"\n`);
    await workspace.sources.add({ name: 'second', kind: 'org' });
    expect((await workspace.sources.list()).map((source) => source.name)).toEqual(['byhand', 'second']);
  });

  it('writes what it did to the log of the workspace, without throwing when the log cannot be written', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    await workspace.sources.add({ name: 'prod', kind: 'org' });
    const logs = readdirSync(join(dir, '.orglens', 'logs'));
    expect(logs).toHaveLength(1);
    const lines = read(dir, `.orglens/logs/${logs[0] ?? ''}`)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { msg?: string; message?: string; source?: string });
    expect(lines.at(-1)).toMatchObject({ source: 'prod' });

    // A file stands where the log folder should be: the command still does its work.
    const blocked = dirs.next();
    writeFileSync(join(blocked, 'orglens.toml'), 'schema_version = 1\n');
    mkdirSync(join(blocked, '.orglens'));
    writeFileSync(join(blocked, '.orglens', 'logs'), 'not a folder');
    const second = await openWorkspace({ root: blocked, env: {} });
    expect(await second.sources.add({ name: 'prod', kind: 'org' })).toMatchObject({ name: 'prod' });
    expect(read(blocked, '.orglens/logs')).toBe('not a folder');
  });

  it('keeps the data folder out of Git before it writes anything into it', async () => {
    // A fresh clone: the configuration is there, the data folder is not.
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n');
    const workspace = await openWorkspace({ root: dir, env: {} });
    await workspace.sources.add({ name: 'repo', kind: 'git', paths: ['force-app/'] });
    expect(read(dir, '.orglens/.gitignore')).toBe('*\n');
    expect(readdirSync(dir).sort()).toEqual(['.orglens', 'orglens.toml']);
    // The default repository is not written, and a folder is written as the configuration returns it.
    expect(read(dir, 'orglens.toml')).toBe(
      'schema_version = 1\n\n[sources.repo]\nkind = "git"\npaths = ["force-app"]\n',
    );
  });

  it('does not change the file while another command holds the lock, and takes over a lock that was left behind', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    const before = read(dir, 'orglens.toml');
    const lock = join(dir, '.orglens', 'config.lock');
    writeFileSync(lock, '1\n');
    const error = await failure(() => workspace.sources.add({ name: 'prod', kind: 'org' }));
    expect(error).toMatchObject({ code: 'WORKSPACE_IO', message: 'Another OrgLens command is changing orglens.toml.' });
    expect(error.hint).toContain(lock);
    expect(read(dir, 'orglens.toml')).toBe(before);

    // A lock from a minute ago belongs to a command that did not end properly.
    const past = new Date(Date.now() - 60_000);
    utimesSync(lock, past, past);
    await workspace.sources.add({ name: 'prod', kind: 'org' });
    expect(existsSync(lock)).toBe(false);
    expect((await workspace.sources.list()).map((source) => source.name)).toEqual(['prod']);
  });

  it('loses no source when several processes add one at the same moment', async () => {
    const dir = dirs.next();
    await workspaceIn(dir);
    const helper = fileURLToPath(new URL('./helpers/add-source.ts', import.meta.url));
    const names = Array.from({ length: 8 }, (_unused, index) => `s${String(index)}`);
    const results = await Promise.all(
      names.map(
        (name) =>
          new Promise<string>((done) => {
            const child = spawn(process.execPath, [helper, dir, name], { stdio: ['ignore', 'ignore', 'pipe'] });
            let errors = '';
            child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
            child.on('close', (code) => {
              done(code === 0 ? '' : errors);
            });
          }),
      ),
    );
    expect(results).toEqual(names.map(() => ''));
    const workspace = await openWorkspace({ root: dir, env: {} });
    expect((await workspace.sources.list()).map((source) => source.name).sort()).toEqual(names);
    expect(readdirSync(dir).sort()).toEqual(['.orglens', 'orglens.toml']);
  }, 30_000);

  it('replaces the file in one step and leaves no other file behind', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    const file = join(dir, 'orglens.toml');
    // A byte order mark at the start of the file stays where it is.
    writeFileSync(file, `\ufeff${read(dir, 'orglens.toml')}`);
    const before = statSync(file);
    await workspace.sources.add({ name: 'prod', kind: 'org' });
    expect(readdirSync(dir).sort()).toEqual(['.orglens', 'orglens.toml']);
    expect(readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    // A new file was moved over the old one. Writing into the old one could leave half a file after a crash.
    if (posix) expect(statSync(file).ino).not.toBe(before.ino);
  });

  it.skipIf(!posix)('keeps the permissions of the file, and a link that leads to it', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    const real = join(dirs.next(), 'shared.toml');
    writeFileSync(real, read(dir, 'orglens.toml'), { mode: 0o600 });
    chmodSync(real, 0o600);
    const link = join(dir, 'orglens.toml');
    rmSync(link);
    symlinkSync(real, link);
    await workspace.sources.add({ name: 'prod', kind: 'org' });
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toContain('[sources.prod]');
    expect(statSync(real).mode & 0o777).toBe(0o600);
  });
});

describe('doctor', () => {
  it('skips the workspace checks where there is no workspace', async () => {
    const report = await doctor({ cwd: dirs.next(), env: {} });
    expect(report.ok).toBe(true);
    expect(report.checks.slice(3).map((check) => [check.id, check.status])).toEqual([
      ['workspace', 'skipped'],
      ['config', 'skipped'],
      ['store', 'skipped'],
    ]);
    expect(report.checks[0]?.details).toMatchObject({ version: process.versions.node, required: '24.15' });
  });

  it('fails the workspace check for a named folder that is no workspace', async () => {
    const dir = dirs.next();
    const report = await doctor({ root: dir });
    expect(report.ok).toBe(false);
    expect(report.checks.find((check) => check.id === 'workspace')).toMatchObject({
      status: 'failed',
      summary: `There is no orglens.toml in ${dir}.`,
    });
  });

  it('reports the problems of the configuration and skips the database', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 2\n');
    const report = await doctor({ root: dir });
    expect(report.ok).toBe(false);
    const config = report.checks.find((check) => check.id === 'config');
    expect(config?.status).toBe('failed');
    expect(config?.summary).toMatch(/^1 problem in the configuration\. First: orglens\.toml:1:1: schema_version: /);
    expect(report.checks.find((check) => check.id === 'store')?.status).toBe('skipped');
  });

  it('warns about a database that does not exist yet', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n');
    const report = await doctor({ root: dir });
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'store')).toMatchObject({
      status: 'warning',
      summary: 'The database does not exist yet. Create it with: orglens init',
    });
  });
});
