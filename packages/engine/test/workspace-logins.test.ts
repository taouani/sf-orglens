import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { doctor } from '../src/api/doctor.ts';
import { openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { createRepo, PROJECT_JSON, projectFiles } from './helpers/git-repo.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { tempDirs } from './helpers/store.ts';

const ORG_ID = '00Dxx0000000001EAA';
const OTHER_ORG_ID = '00Dxx0000000002EAA';

const CONFIG = `# The sources of the team.
schema_version = 1

[sources.prod]
kind = "org"
org_id = "${ORG_ID}"

[sources.uat]
kind = "sandbox"

[sources.repo]
kind = "git"
`;

const dirs = tempDirs();
let mock: MockOrg;

beforeAll(async () => {
  mock = await startMockOrg();
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.refreshTokens.clear();
  mock.key = null;
  await forgetCliLogins();
  dirs.cleanUp();
});

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

/** A workspace with the configuration above. No variable of this process reaches it. */
async function workspaceIn(dir: string, env: Record<string, string> = {}): Promise<Workspace> {
  writeFileSync(join(dir, 'orglens.toml'), CONFIG);
  return openWorkspace({ root: dir, env });
}

const local = (dir: string): string => readFileSync(join(dir, '.orglens', 'local.toml'), 'utf8');

async function seed(fields: Partial<Parameters<typeof seedCliLogin>[0]> = {}): Promise<void> {
  mock.sessions.add('valid-session');
  await seedCliLogin({
    username: 'zoe@example.com',
    alias: 'main',
    orgId: ORG_ID,
    instanceUrl: mock.url,
    accessToken: 'valid-session',
    ...fields,
  });
}

describe('sources.link', () => {
  it('writes the login to the personal file, which it creates, and leaves the shared file alone', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    expect(await workspace.sources.link('prod', 'main')).toEqual({
      source: 'prod',
      login: 'main',
      username: 'zoe@example.com',
      orgId: ORG_ID,
      declaredOrgId: ORG_ID,
    });
    expect(local(dir)).toBe(
      '# .orglens/local.toml: the personal settings of this OrgLens workspace. This file is not committed.\n' +
        '# It never holds a password, a token or a key.\n\n[sources.prod]\nlogin = "main"\n',
    );
    expect(readFileSync(join(dir, 'orglens.toml'), 'utf8')).toBe(CONFIG);
    expect(readFileSync(join(dir, '.orglens', '.gitignore'), 'utf8')).toBe('*\n');
    expect(mock.requests).toEqual([]);
    expect(
      readdirSync(join(dir, '.orglens')).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock')),
    ).toEqual([]);
  });

  it('changes a login that is set and keeps every other line of the personal file', async () => {
    await seed();
    await seed({ username: 'adam@example.com', alias: 'second' });
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    mkdirSync(join(dir, '.orglens'));
    writeFileSync(
      join(dir, '.orglens', 'local.toml'),
      '# mine\n[store]\ndriver = "node:sqlite"\n\n[sources.prod]\nlogin = "main" # for now\n',
    );
    await workspace.sources.link('prod', 'adam@example.com');
    await workspace.sources.link('uat', 'second');
    expect(local(dir)).toBe(
      '# mine\n[store]\ndriver = "node:sqlite"\n\n[sources.prod]\nlogin = "adam@example.com" # for now\n\n[sources.uat]\nlogin = "second"\n',
    );
  });

  it('refuses a login that is not there, one of another org, and a source without logins, and writes nothing', async () => {
    await seed({ orgId: OTHER_ORG_ID });
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);

    const unknown = await failure(() => workspace.sources.link('prod', 'nobody'));
    expect(unknown).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'LOGIN_UNKNOWN', source: 'prod' } });
    expect(unknown.hint).toContain('sf org list');

    const mismatch = await failure(() => workspace.sources.link('prod', 'main'));
    expect(mismatch).toMatchObject({ code: 'ORG_MISMATCH', details: { declared: ORG_ID, found: OTHER_ORG_ID } });

    expect(await failure(() => workspace.sources.link('repo', 'main'))).toMatchObject({ code: 'SOURCE_INVALID' });
    expect(await failure(() => workspace.sources.link('nothing', 'main'))).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    expect(existsSync(join(dir, '.orglens', 'local.toml'))).toBe(false);

    // A source that declares no org takes any login.
    await workspace.sources.link('uat', 'main');
    expect(local(dir)).toContain('[sources.uat]\nlogin = "main"\n');
  });

  it('is undone when the source is removed, so that the personal file stays valid', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    await workspace.sources.link('prod', 'main');
    await workspace.sources.link('uat', 'main');
    await workspace.sources.remove('prod');
    expect(local(dir)).not.toContain('prod');
    expect(local(dir)).toContain('[sources.uat]\nlogin = "main"\n');
    expect((await (await openWorkspace({ root: dir, env: {} })).sources.list()).map((source) => source.name)).toEqual([
      'uat',
      'repo',
    ]);
  });

  it('keeps the login of a source that could not be removed from the shared file', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    await workspace.sources.link('prod', 'main');
    const linked = local(dir);
    // The shared file cannot be replaced: its folder takes no new file. The personal file could be written.
    chmodSync(dir, 0o555);
    try {
      const probe = join(dir, 'probe');
      let writable = true;
      try {
        writeFileSync(probe, '');
      } catch {
        writable = false;
      }
      // An administrator writes anywhere. The test says nothing there.
      if (writable) return;
      expect(await failure(() => workspace.sources.remove('prod'))).toMatchObject({ code: 'WORKSPACE_IO' });
      expect(local(dir)).toBe(linked);
      expect(readFileSync(join(dir, 'orglens.toml'), 'utf8')).toBe(CONFIG);
    } finally {
      chmodSync(dir, 0o755);
      rmSync(join(dir, 'probe'), { force: true });
    }
  });

  it('does not remove a source whose login it cannot remove', async () => {
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    mkdirSync(join(dir, '.orglens'));
    const dotted = 'sources.prod.login = "main"\n';
    writeFileSync(join(dir, '.orglens', 'local.toml'), dotted);
    expect(await failure(() => workspace.sources.remove('prod'))).toMatchObject({ code: 'CONFIG_NOT_EDITABLE' });
    expect(local(dir)).toBe(dotted);
    expect(readFileSync(join(dir, 'orglens.toml'), 'utf8')).toBe(CONFIG);
  });
});

describe('sources.check', () => {
  it('connects with the login of the declared org and says what it found', async () => {
    await seed();
    const workspace = await workspaceIn(dirs.next());
    expect(await workspace.sources.check('prod')).toEqual({
      source: 'prod',
      kind: 'org',
      login: { via: 'org-id', alias: 'main', username: 'zoe@example.com' },
      org: { id: ORG_ID, instanceUrl: mock.url, apiVersion: '66.0' },
      declaredOrgId: ORG_ID,
    });
  });

  it('connects with the linked login for a source that declares no org', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    expect(await failure(() => workspace.sources.check('uat'))).toMatchObject({
      code: 'LOGIN_FAILED',
      details: { reason: 'NO_LOGIN', source: 'uat' },
    });
    await workspace.sources.link('uat', 'main');
    expect(await workspace.sources.check('uat')).toMatchObject({
      kind: 'sandbox',
      login: { via: 'linked', alias: 'main' },
      org: { id: ORG_ID },
      declaredOrgId: null,
    });
    expect(
      readFileSync(join(dir, '.orglens', 'logs', readdirSync(join(dir, '.orglens', 'logs'))[0] ?? ''), 'utf8'),
    ).not.toContain('zoe@example.com');
  });

  it('keeps its log out of Git in a folder that has the configuration and nothing else', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    expect(existsSync(join(dir, '.orglens'))).toBe(false);
    await workspace.sources.check('prod');
    expect(readFileSync(join(dir, '.orglens', '.gitignore'), 'utf8')).toBe('*\n');
    expect(readdirSync(join(dir, '.orglens')).sort()).toEqual(['.gitignore', 'logs']);
  });

  it('reads the folders of a repository as a snapshot would, and stores nothing', async () => {
    const dir = dirs.next();
    const repo = createRepo(dir);
    for (const [path, content] of Object.entries({ 'sfdx-project.json': PROJECT_JSON, ...projectFiles() })) {
      repo.write(path, content);
    }
    const commit = repo.commit('first');
    const workspace = await workspaceIn(dir);
    const check = await workspace.sources.check('repo');
    expect(check).toMatchObject({
      source: 'repo',
      kind: 'git',
      complete: true,
      commit,
      dirs: ['force-app'],
      issues: [],
    });
    if (check.kind !== 'git') throw new Error('not a git check');
    expect(check.components).toBeGreaterThan(0);
    expect(check.files).toBeGreaterThanOrEqual(check.components);
    expect(check.bytes).toBeGreaterThan(0);
    expect(existsSync(join(dir, '.orglens', 'orglens.db'))).toBe(false);
  });
});

describe('a login with a key, in a process of its own', () => {
  const walk = (dir: string, root = dir): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path, root) : [relative(root, path).split('\\').join('/')];
    });

  /** Runs a program to its end while this process goes on answering as the mock org. */
  const run = (args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', reject);
      child.on('close', () => {
        resolve({ stdout, stderr });
      });
    });

  it('works twice in a row and leaves no login, no session and no log in the home folder', async () => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    mock.key = { username: 'ci@example.com', clientId: 'client-id', publicKey: pair.publicKey };
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), CONFIG);
    const home = dirs.next();
    const environment: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ORGLENS_JWT_PROD_LOGIN_URL: mock.url,
      ORGLENS_JWT_PROD_USERNAME: 'ci@example.com',
      ORGLENS_JWT_PROD_CLIENT_ID: 'client-id',
      ORGLENS_JWT_PROD_KEY: pair.privateKey.trim().split('\n').join('\\n'),
      // The library warns about an address without TLS, which is what a test server on this machine has.
      NODE_NO_WARNINGS: '1',
    };
    const helper = fileURLToPath(new URL('./helpers/check-source.ts', import.meta.url));
    for (let round = 0; round < 2; round += 1) {
      const result = await run([helper, dir, 'prod'], environment);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        source: 'prod',
        kind: 'org',
        login: { via: 'jwt-env', alias: null, username: null },
        org: { id: ORG_ID, instanceUrl: null, apiVersion: '66.0' },
        declaredOrgId: ORG_ID,
      });
    }
    expect(mock.sessions.size).toBe(2);
    // What the library creates on its way: an empty list of aliases, and the key it would encrypt logins with.
    expect(walk(home).sort()).toEqual(['.sfdx/alias.json', '.sfdx/key.json']);
    for (const file of [
      ...walk(home).map((name) => join(home, name)),
      ...walk(join(dir, '.orglens')).map((name) => join(dir, '.orglens', name)),
    ]) {
      const content = readFileSync(file, 'utf8');
      for (const secret of [...mock.sessions, 'ci@example.com', 'PRIVATE KEY', 'client-id']) {
        expect(content, file).not.toContain(secret);
      }
    }
    rmSync(home, { recursive: true, force: true });
  }, 60_000);
});

describe('doctor', () => {
  it('says how many logins there are and how each org would be logged in, without connecting or naming anyone', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    const before = await doctor({ root: dir, env: {} });
    expect(before.ok).toBe(true);
    expect(before.checks.find((check) => check.id === 'logins')).toEqual({
      id: 'logins',
      status: 'warning',
      summary:
        '1 Salesforce CLI login on this machine. 1 of 2 org and sandbox sources cannot be logged in. "uat": No login is linked to the source, and it declares no org_id. Link one with: orglens source link uat <alias>',
      details: {
        cliLogins: 1,
        sources: [
          { source: 'prod', via: 'org-id', problem: null },
          {
            source: 'uat',
            via: 'none',
            problem:
              'No login is linked to the source, and it declares no org_id. Link one with: orglens source link uat <alias>',
          },
        ],
        unreadVariables: [],
        unusedLogins: [],
      },
    });

    await workspace.sources.link('uat', 'zoe@example.com');
    const after = await doctor({ root: dir, env: { ORGLENS_JWT_PROD_USERNAME: 'ci@example.com' } });
    const logins = after.checks.find((check) => check.id === 'logins');
    expect(logins).toMatchObject({
      status: 'warning',
      details: {
        sources: [
          { source: 'prod', via: 'jwt-env' },
          { source: 'uat', via: 'linked', problem: null },
        ],
      },
    });
    expect(logins?.summary).toContain('ORGLENS_JWT_PROD_CLIENT_ID');
    expect(JSON.stringify(after)).not.toContain('example.com');

    const linked = await doctor({ root: dir, env: {} });
    expect(linked.checks.find((check) => check.id === 'logins')).toMatchObject({
      status: 'ok',
      summary:
        '1 Salesforce CLI login on this machine. Every org and sandbox of the workspace has a login. Whether it still works shows: orglens source check <name>',
    });
    expect(mock.requests).toEqual([]);
  });

  it('names a variable that no source reads, and a login for a source that is no longer declared', async () => {
    await seed();
    const dir = dirs.next();
    const workspace = await workspaceIn(dir);
    await workspace.sources.link('uat', 'main');
    // A colleague removes the source from the shared file. The personal file still names its login.
    writeFileSync(join(dir, 'orglens.toml'), CONFIG.replace('[sources.uat]\nkind = "sandbox"\n', ''));
    const env = {
      ORGLENS_JWT_PROD_CLIENTID: 'misspelled',
      ORGLENS_JWT_UAT_USERNAME: 'ci@example.com',
      ORGLENS_JWT_OTHER_KEY: '',
    };
    const report = await doctor({ root: dir, env });
    expect(report.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'config')).toMatchObject({ status: 'ok' });
    const logins = report.checks.find((check) => check.id === 'logins');
    expect(logins).toMatchObject({
      status: 'warning',
      details: {
        sources: [{ source: 'prod', via: 'org-id', problem: null }],
        unreadVariables: ['ORGLENS_JWT_PROD_CLIENTID', 'ORGLENS_JWT_UAT_USERNAME'],
        unusedLogins: ['uat'],
      },
    });
    expect(logins?.summary).toContain(
      'No source reads the variables ORGLENS_JWT_PROD_CLIENTID, ORGLENS_JWT_UAT_USERNAME.',
    );
    expect(logins?.summary).toContain(
      '.orglens/local.toml names a login for "uat", which orglens.toml does not declare. It is not used.',
    );
    expect(JSON.stringify(report)).not.toContain('example.com');
    expect(JSON.stringify(report)).not.toContain('misspelled');

    // Every command still works, and the source that is left is checked as before.
    const again = await openWorkspace({ root: dir, env: {} });
    expect((await again.sources.list()).map((source) => source.name)).toEqual(['prod', 'repo']);
    expect(await again.sources.check('prod')).toMatchObject({ login: { via: 'org-id' } });
  });

  it('says that the user of a key also has a login of the Salesforce CLI', async () => {
    await seed({ username: 'ci@example.com' });
    const dir = dirs.next();
    await workspaceIn(dir);
    const env = {
      ORGLENS_JWT_PROD_USERNAME: 'ci@example.com',
      ORGLENS_JWT_PROD_CLIENT_ID: 'client-id',
      ORGLENS_JWT_PROD_KEY: 'a key',
    };
    const report = await doctor({ root: dir, env });
    expect(report.checks.find((check) => check.id === 'logins')).toMatchObject({
      status: 'warning',
      details: {
        sources: [
          {
            source: 'prod',
            via: 'jwt-env',
            problem: 'The user of the key also has a login of the Salesforce CLI on this machine.',
          },
          { source: 'uat', via: 'none' },
        ],
      },
    });
    expect(JSON.stringify(report)).not.toContain('example.com');
  });

  it('has nothing to say about logins for a workspace without an org', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n\n[sources.repo]\nkind = "git"\n');
    const report = await doctor({ root: dir, env: {} });
    expect(report.checks.find((check) => check.id === 'logins')).toEqual({
      id: 'logins',
      status: 'ok',
      summary: '0 Salesforce CLI logins on this machine. The workspace declares no org or sandbox.',
      details: { cliLogins: 0, sources: [], unreadVariables: [], unusedLogins: [] },
    });
  });
});
