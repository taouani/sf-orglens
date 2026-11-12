import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

const ORG_ID = '00Dxx0000000001EAA';

/** A key pair made for the test. No key is ever kept in the repository. */
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const dirs = tempDirs();
let mock: MockOrg;

beforeAll(async () => {
  mock = await startMockOrg(pair.publicKey);
});
afterAll(async () => {
  await mock.close();
});
afterEach(() => {
  mock.paths.length = 0;
  // The home folder of the test process is an empty folder of its own (tools/vitest-setup.js).
  rmSync(join(homedir(), '.sfdx'), { recursive: true, force: true });
  dirs.cleanUp();
});

/** A workspace with an org that declares its id, a sandbox that does not, and folders of a repository. */
function workspace(files: Readonly<Record<string, string>> = {}): string {
  const dir = dirs.next();
  const all = {
    'orglens.toml': `schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n[sources.uat]\nkind = "sandbox"\n[sources.work]\nkind = "git"\n`,
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split('/')), content);
  }
  return dir;
}

/** The variables of a job that logs in to `prod` with a key. */
const withKey = (): Record<string, string> => ({
  ORGLENS_JWT_PROD_LOGIN_URL: mock.url,
  ORGLENS_JWT_PROD_USERNAME: 'ci@example.com',
  ORGLENS_JWT_PROD_CLIENT_ID: 'client-id',
  ORGLENS_JWT_PROD_KEY: pair.privateKey,
});

/** A login as the Salesforce CLI keeps it, without a session: enough to be listed and linked. */
function cliLogin(username: string, alias: string, orgId: string): void {
  const dir = join(homedir(), '.sfdx');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${username}.json`), JSON.stringify({ username, orgId, instanceUrl: mock.url }));
  writeFileSync(join(dir, 'alias.json'), JSON.stringify({ orgs: { [alias]: username } }));
}

describe('orglens source check', () => {
  it('logs in with a key from the environment and shows no user and no address', async () => {
    const dir = workspace();
    const run = await orglens(dir, ['source', 'check', 'prod'], withKey());
    expect(run).toEqual({
      code: 0,
      stderr: '',
      stdout: [
        'The source "prod" can be reached.',
        'Login        a private key from the environment',
        `Org          ${ORG_ID}`,
        'API version  66.0',
        '',
      ].join('\n'),
    });
    expect(mock.paths).toEqual(['/services/oauth2/token', '/services/data', '/services/data/v66.0/']);

    const json = await orglensJson(dir, ['source', 'check', 'prod'], withKey());
    expect(json).toMatchObject({
      code: 0,
      command: 'source check',
      ok: true,
      data: {
        source: 'prod',
        kind: 'org',
        login: { via: 'jwt-env', alias: null, username: null },
        org: { id: ORG_ID, instanceUrl: null, apiVersion: '66.0' },
        declaredOrgId: ORG_ID,
      },
    });
  });

  it('ends with 4 when there is no login, when the key is refused and when the org is another one', async () => {
    const dir = workspace();
    const none = await orglens(dir, ['source', 'check', 'prod']);
    expect(none.code).toBe(4);
    expect(none.stdout).toBe('');
    expect(none.stderr).toContain(
      'No login of the Salesforce CLI on this machine belongs to the org of the source "prod"',
    );

    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const refused = await orglensJson(dir, ['source', 'check', 'prod'], {
      ...withKey(),
      ORGLENS_JWT_PROD_KEY: other.privateKey,
    });
    expect(refused).toMatchObject({
      code: 4,
      ok: false,
      error: { code: 'LOGIN_FAILED', details: { reason: 'JWT_REJECTED', source: 'prod', error: 'invalid_grant' } },
    });
    expect(JSON.stringify(refused)).not.toContain('PRIVATE KEY');

    const incomplete = await orglensJson(dir, ['source', 'check', 'prod'], {
      ORGLENS_JWT_PROD_USERNAME: 'ci@example.com',
    });
    expect(incomplete).toMatchObject({
      code: 4,
      error: {
        code: 'LOGIN_FAILED',
        details: { reason: 'JWT_INCOMPLETE', missing: ['ORGLENS_JWT_PROD_CLIENT_ID', 'ORGLENS_JWT_PROD_KEY'] },
      },
    });

    writeFileSync(
      join(dir, 'orglens.toml'),
      'schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "00Dxx0000000002EAA"\n',
    );
    const mismatch = await orglensJson(dir, ['source', 'check', 'prod'], withKey());
    expect(mismatch).toMatchObject({
      code: 4,
      error: { code: 'ORG_MISMATCH', details: { source: 'prod', declared: '00Dxx0000000002EAA', found: ORG_ID } },
    });
  });

  it('reads the folders of a repository, stores nothing, and ends with 5 if a snapshot would be partial', async () => {
    const project = {
      'sfdx-project.json': '{ "packageDirectories": [{ "path": "force-app" }] }\n',
      'force-app/main/default/classes/Hello.cls': 'public class Hello {}\n',
      'force-app/main/default/classes/Hello.cls-meta.xml':
        '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>65.0</apiVersion>\n</ApexClass>\n',
    };
    const dir = workspace(project);
    const run = await orglens(dir, ['source', 'check', 'work']);
    expect(run.stderr).toBe('');
    expect(run.stdout.split('\n')).toEqual([
      'The source "work" can be read: 1 component in 2 files (168 bytes). Nothing was stored.',
      '',
      'SEVERITY  CODE            WHAT',
      'info      COMMIT_UNKNOWN  The snapshot names no commit: the folder is not in a Git repository.',
      '',
    ]);
    expect(run.code).toBe(0);
    expect(existsSync(join(dir, '.orglens', 'orglens.db'))).toBe(false);

    const partial = workspace({
      ...project,
      'sfdx-project.json': '{ "packageDirectories": [{ "path": "force-app" }, { "path": "gone" }] }\n',
    });
    const json = await orglensJson(partial, ['source', 'check', 'work']);
    expect(json).toMatchObject({
      code: 5,
      command: 'source check',
      ok: true,
      data: {
        source: 'work',
        kind: 'git',
        complete: false,
        commit: null,
        dirs: ['force-app', 'gone'],
        components: 1,
        files: 2,
      },
    });
    const text = await orglens(partial, ['source', 'check', 'work']);
    expect(text.stdout).toContain(
      'The source "work" can be read in part, something is missing: 1 component in 2 files',
    );
    expect(text.code).toBe(5);
  });

  it('needs a source that is declared', async () => {
    const run = await orglensJson(workspace(), ['source', 'check', 'nothing']);
    expect(run).toMatchObject({ code: 2, error: { code: 'SOURCE_NOT_FOUND' } });
    expect((await orglens(workspace(), ['source', 'check'])).code).toBe(2);
  });
});

describe('orglens source link', () => {
  it('sets the login of a source in the personal file and says how to check it', async () => {
    cliLogin('zoe@example.com', 'main', ORG_ID);
    const dir = workspace();
    const run = await orglens(dir, ['source', 'link', 'prod', 'main']);
    expect(run).toEqual({
      code: 0,
      stderr: '',
      stdout: [
        'The source "prod" now uses the Salesforce CLI login "main" on this machine.',
        'Check the login with: orglens source check prod',
        '',
      ].join('\n'),
    });
    expect(readFileSync(join(dir, '.orglens', 'local.toml'), 'utf8')).toContain('[sources.prod]\nlogin = "main"\n');
    expect(mock.paths).toEqual([]);

    // A source without an org id takes any login, and the command says which id to add.
    const json = await orglensJson(dir, ['source', 'link', 'uat', 'zoe@example.com']);
    expect(json).toMatchObject({
      code: 0,
      command: 'source link',
      data: {
        source: 'uat',
        login: 'zoe@example.com',
        username: 'zoe@example.com',
        orgId: ORG_ID,
        declaredOrgId: null,
      },
    });
    const text = await orglens(dir, ['source', 'link', 'uat', 'main']);
    expect(text.stdout).toContain(`Add org_id = "${ORG_ID}" to the source in orglens.toml.`);

    // Removing the source removes its login, and the configuration stays valid.
    expect((await orglens(dir, ['source', 'remove', 'prod'])).code).toBe(0);
    expect(readFileSync(join(dir, '.orglens', 'local.toml'), 'utf8')).not.toContain('prod');
    expect((await orglens(dir, ['status'])).code).toBe(0);
  });

  it('ends with 4 for a login that is not there or belongs to another org, and with 2 for a repository', async () => {
    cliLogin('zoe@example.com', 'main', '00Dxx0000000002EAA');
    const dir = workspace();
    const unknown = await orglensJson(dir, ['source', 'link', 'prod', 'nobody']);
    expect(unknown).toMatchObject({
      code: 4,
      error: { code: 'LOGIN_FAILED', details: { reason: 'LOGIN_UNKNOWN', source: 'prod' } },
    });
    const mismatch = await orglensJson(dir, ['source', 'link', 'prod', 'main']);
    expect(mismatch).toMatchObject({ code: 4, error: { code: 'ORG_MISMATCH' } });
    const repository = await orglensJson(dir, ['source', 'link', 'work', 'main']);
    expect(repository).toMatchObject({ code: 2, error: { code: 'SOURCE_INVALID' } });
    expect(existsSync(join(dir, '.orglens', 'local.toml'))).toBe(false);
    expect((await orglens(dir, ['source', 'link', 'prod'])).code).toBe(2);
  });
});

describe('orglens doctor', () => {
  it('says how the orgs of the workspace would be logged in, without naming a login', async () => {
    cliLogin('zoe@example.com', 'main', ORG_ID);
    const dir = workspace();
    const run = await orglens(dir, ['doctor']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(
      'warning  logins           1 Salesforce CLI login on this machine. 1 of 2 org and sandbox sources cannot be logged in. "uat": No login is linked to the source, and it declares no org_id.',
    );
    expect(run.stdout).not.toContain('zoe@example.com');
    const json = await orglensJson(dir, ['doctor'], withKey());
    const logins = (json.data as { checks: { id: string; details: unknown }[] }).checks.find(
      (check) => check.id === 'logins',
    );
    expect(logins?.details).toMatchObject({
      cliLogins: 1,
      sources: [
        { source: 'prod', via: 'jwt-env' },
        { source: 'uat', via: 'none' },
      ],
    });
    expect(mock.paths).toEqual([]);
  });
});
