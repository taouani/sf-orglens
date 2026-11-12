/**
 * The login step of the live-org workflow (`scripts/live-org-login.mjs`),
 * run against a mock org. Its output goes to the public log of a workflow,
 * so the tests are about what it must never print.
 */
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';

const script = fileURLToPath(new URL('../../../scripts/live-org-login.mjs', import.meta.url));
const bin = fileURLToPath(new URL('../src/bin.ts', import.meta.url));

/** A key pair made for the test. No key is ever kept in the repository. */
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const USERNAME = 'ci-user@example.com';
const CLIENT_ID = '3MVG9-made-up-consumer-key-0123456789';

/**
 * A program that stands in for `orglens`, for the answers the real one
 * does not give. It notes which command it was started for and which
 * variables of OrgLens it was handed, in the file `STANDIN_SEEN`. It
 * answers `init` and `source add` with success, unless `STANDIN_INIT` holds
 * another answer, and `source check` with `STANDIN_CHECK`. It ends with the
 * exit code `STANDIN_EXIT`.
 */
const STANDIN = `
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
const name = args.includes('init') ? 'init' : args.includes('add') ? 'add' : 'check';
const handed = Object.keys(process.env).filter((key) => /^ORGLENS_/i.test(key)).sort();
appendFileSync(process.env.STANDIN_SEEN, JSON.stringify({ name, handed, workspace: args.includes('--workspace') }) + '\\n');
const answers = { init: process.env.STANDIN_INIT, check: process.env.STANDIN_CHECK };
process.stdout.write(answers[name] ?? '{"ok":true,"data":{}}');
process.stderr.write(process.env.STANDIN_NOISE ?? '');
process.exitCode = name === 'check' ? Number(process.env.STANDIN_EXIT ?? 0) : answers[name] === undefined ? 0 : 1;
`;

let mock: MockOrg;
let scratch: string;
let standin: string;
let seen: string;
beforeAll(async () => {
  mock = await startMockOrg(pair.publicKey);
  scratch = mkdtempSync(join(tmpdir(), 'orglens-standin-'));
  standin = join(scratch, 'standin.cjs');
  seen = join(scratch, 'seen.jsonl');
  writeFileSync(standin, STANDIN);
});
afterAll(async () => {
  await mock.close();
  rmSync(scratch, { recursive: true, force: true });
});
afterEach(() => {
  mock.paths.length = 0;
  mock.refusal = null;
  rmSync(seen, { force: true });
});

/** Runs the script with the stand-in for `orglens`. */
const withStandin = (env: Readonly<Record<string, string>>): Promise<Run> =>
  login({ ...secrets(), STANDIN_SEEN: seen, ...env }, [process.execPath, standin]);

/** What the stand-in noted, one entry per start. */
const starts = (): { name: string; handed: string[]; workspace: boolean }[] =>
  readFileSync(seen, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { name: string; handed: string[]; workspace: boolean });

const secrets = (): Record<string, string> => ({
  ORGLENS_JWT_TEST_ORG_LOGIN_URL: mock.url,
  ORGLENS_JWT_TEST_ORG_USERNAME: USERNAME,
  ORGLENS_JWT_TEST_ORG_CLIENT_ID: CLIENT_ID,
  ORGLENS_JWT_TEST_ORG_KEY: pair.privateKey,
});

interface Run {
  readonly code: number | null;
  readonly output: string;
}

/**
 * Runs the script with the CLI from source. Not with `spawnSync`: the mock
 * org lives in this process and could not answer while it waits.
 */
function login(env: Readonly<Record<string, string>>, command?: readonly string[]): Promise<Run> {
  const orglens = command ?? [process.execPath, '--conditions=@sf-orglens/source', bin];
  // The stand-in must not be told what to do by a variable left from another run.
  const machine = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('STANDIN_')));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--', ...orglens], {
      env: { ...machine, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, output: output.replaceAll('\r\n', '\n') });
    });
  });
}

/** Nothing that names the org or the user, and nothing of the key. */
function expectNoSecret(output: string): void {
  const address = new URL(mock.url);
  for (const secret of [
    USERNAME,
    'example.com',
    CLIENT_ID,
    mock.url,
    address.host,
    mock.orgId,
    mock.orgId.slice(0, 15),
  ]) {
    expect(output).not.toContain(secret);
  }
  for (const line of pair.privateKey.split('\n').filter((one) => one !== '' && !one.startsWith('-----'))) {
    expect(output).not.toContain(line);
  }
  expect(output).not.toContain('the-session');
}

// Every run starts the CLI three times from source, which takes seconds each on the Windows runners of CI.
describe('the login step of the live-org workflow', { timeout: 90_000 }, () => {
  it('says that the login worked, and the API version, and nothing about the org', async () => {
    const run = await login(secrets());
    expect(run).toEqual({
      code: 0,
      output: [
        'The login to the test org worked.',
        'Login: with the key from the secrets of the workflow',
        'API version of the org: 66.0',
        '',
      ].join('\n'),
    });
    expect(mock.paths).toEqual(['/services/oauth2/token', '/services/data', '/services/data/v66.0/']);
  });

  it('says which secrets are missing and starts nothing', async () => {
    const run = await login({ ...secrets(), ORGLENS_JWT_TEST_ORG_CLIENT_ID: '', ORGLENS_JWT_TEST_ORG_KEY: ' ' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('::error::The login to the test org was not tried: secrets are missing.');
    expect(run.output).toContain(
      'Not set in the environment "live-org": ORGLENS_TEST_ORG_CLIENT_ID, ORGLENS_TEST_ORG_JWT_KEY.',
    );
    expect(mock.paths).toEqual([]);
    expectNoSecret(run.output);
  });

  it('names the answer of Salesforce to a refused login, if it is one of the known texts', async () => {
    mock.refusal = "user hasn't approved this consumer";
    const run = await login(secrets());
    expect(run.code).toBe(1);
    expect(run.output).toContain('::error::The login to the test org failed: LOGIN_FAILED (JWT_REJECTED).');
    expect(run.output).toContain("Answer of Salesforce: invalid_grant (user hasn't approved this consumer)");
    expect(run.output).toContain('The message of OrgLens is not shown here.');
    expectNoSecret(run.output);
  });

  it('shows no word of an answer of Salesforce that is not one of the known texts', async () => {
    mock.refusal = `user ${USERNAME} of ${mock.url}/path (org ${mock.orgId}, also ${mock.orgId.slice(0, 15)}) has not approved the consumer ${CLIENT_ID} at acme--uat.sandbox.my.salesforce.com`;
    const run = await login(secrets());
    expect(run.code).toBe(1);
    expect(run.output).toContain('::error::The login to the test org failed: LOGIN_FAILED (JWT_REJECTED).');
    expect(run.output).toContain(
      'Answer of Salesforce: invalid_grant. Its description is not shown, because it is not one of the known texts.',
    );
    expect(run.output).not.toContain('approved');
    expect(run.output).not.toContain('acme');
    expectNoSecret(run.output);
  });

  it('says that the key is not one, and names the variable', async () => {
    const run = await login({ ...secrets(), ORGLENS_JWT_TEST_ORG_KEY: 'not a key' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('The login to the test org failed: LOGIN_FAILED (JWT_INVALID).');
    expect(run.output).toContain('Variable: ORGLENS_JWT_TEST_ORG_KEY');
    expect(run.output).not.toContain('not a key');
    expect(mock.paths).toEqual([]);
    expectNoSecret(run.output);
  });

  it('says that the org cannot be reached, without its address', async () => {
    const closed = await startMockOrg(pair.publicKey);
    await closed.close();
    const run = await login({ ...secrets(), ORGLENS_JWT_TEST_ORG_LOGIN_URL: closed.url });
    expect(run.code).toBe(1);
    expect(run.output).toContain('The login to the test org failed: LOGIN_FAILED (ORG_UNREACHABLE).');
    expect(run.output).toMatch(/^Network: [A-Z_]+$/m);
    expect(run.output).not.toContain(new URL(closed.url).host);
    expectNoSecret(run.output);
  });

  it('shows nothing of an answer it does not understand', async () => {
    const run = await withStandin({ STANDIN_CHECK: `token 00Dxx0000000001EAA!abc for ${USERNAME}` });
    expect(run.code).toBe(1);
    expect(run.output).toContain('"orglens source check" did not answer as expected.');
    expect(run.output).toContain('It ended with the exit code 0. What it printed is not shown here.');
    expectNoSecret(run.output);
  });

  it('prints no value of a failure that is not a code or a name it knows, wherever the value stands', async () => {
    const address = new URL(mock.url);
    const token = `${mock.orgId}!AQEAQFakeTokenFakeTokenFakeToken`;
    const run = await withStandin({
      STANDIN_EXIT: '4',
      STANDIN_NOISE: `warning: ${token}`,
      STANDIN_CHECK: JSON.stringify({
        ok: false,
        error: {
          code: mock.orgId,
          message: `Salesforce refused: ${token} for ci-user%40example.com at acme-dev-ed.develop.my.salesforce.mil, user 005xx000000001AAAA, ${mock.orgId}_1, ${CLIENT_ID.slice(0, 30)}`,
          hint: `Check ${USERNAME} and ${CLIENT_ID}`,
          details: {
            reason: address.host,
            error: mock.orgId,
            network: 'acme-dev-ed.develop.my.salesforce.mil',
            variable: USERNAME,
            missing: [CLIENT_ID, 'ORGLENS_JWT_TEST_ORG_KEY'],
          },
        },
      }),
    });
    expect(run).toEqual({
      code: 1,
      output: [
        '::error::The login to the test org failed: unknown error.',
        'Answer of Salesforce: not shown, because it is not one of the known error codes.',
        'Not set: ORGLENS_JWT_TEST_ORG_KEY',
        'The message of OrgLens is not shown here. docs/live-org-setup.md, section 5, says what each of these codes means.',
        'The variables ORGLENS_JWT_TEST_ORG_… come from the secrets ORGLENS_TEST_ORG_… of the environment "live-org".',
        '',
      ].join('\n'),
    });
  });

  it('does not take a reported success for one if the command ended with a failure', async () => {
    const answer = JSON.stringify({ ok: true, data: { login: { via: 'jwt-env' }, org: { apiVersion: '66.0' } } });
    const run = await withStandin({ STANDIN_CHECK: answer, STANDIN_EXIT: '7' });
    expect(run.code).toBe(1);
    expect(run.output).toContain('reported success and ended with the exit code 7.');
    expect(run.output).not.toContain('worked');
    expect((await withStandin({ STANDIN_CHECK: answer })).output).toContain('The login to the test org worked.');
  });

  it('fails if the org was logged in to by another route than the key of the workflow', async () => {
    const run = await withStandin({
      STANDIN_CHECK: JSON.stringify({ ok: true, data: { login: { via: 'org-id' }, org: { apiVersion: '66.0' } } }),
    });
    expect(run.code).toBe(1);
    expect(run.output).toContain('was not logged in to with the key of the workflow');
  });

  it('prints an API version only if it is one', async () => {
    const run = await withStandin({
      STANDIN_CHECK: JSON.stringify({ ok: true, data: { login: { via: 'jwt-env' }, org: { apiVersion: mock.orgId } } }),
    });
    expect(run.output).toContain('API version of the org: unknown');
    expectNoSecret(run.output);
  });

  it('hands the secrets to the command that logs in and to no other, and no setting of the machine to any', async () => {
    const run = await withStandin({
      ORGLENS_WORKSPACE: join(scratch, 'the-workspace-of-a-developer'),
      ORGLENS_SQLITE_DRIVER: 'sqlite9',
      STANDIN_CHECK: JSON.stringify({ ok: true, data: { login: { via: 'jwt-env' }, org: { apiVersion: '66.0' } } }),
    });
    expect(run.code).toBe(0);
    expect(starts()).toEqual([
      { name: 'init', handed: [], workspace: false },
      { name: 'add', handed: [], workspace: true },
      {
        name: 'check',
        handed: [
          'ORGLENS_JWT_TEST_ORG_CLIENT_ID',
          'ORGLENS_JWT_TEST_ORG_KEY',
          'ORGLENS_JWT_TEST_ORG_LOGIN_URL',
          'ORGLENS_JWT_TEST_ORG_USERNAME',
        ],
        workspace: true,
      },
    ]);
  });

  it('follows no workspace and no database driver that the machine sets for OrgLens', async () => {
    const run = await login({ ...secrets(), ORGLENS_WORKSPACE: scratch, ORGLENS_SQLITE_DRIVER: 'sqlite9' });
    expect(run.output).toContain('The login to the test org worked.');
    expect(() => readFileSync(join(scratch, 'orglens.toml'))).toThrow();
  });

  it('says that the workspace could not be set up, with the code of the error and nothing that was printed', async () => {
    const run = await withStandin({
      STANDIN_NOISE: `::warning::${USERNAME}`,
      STANDIN_INIT: JSON.stringify({ ok: false, error: { code: 'WORKSPACE_IO', message: `no ${mock.url}` } }),
    });
    expect(run).toEqual({
      code: 1,
      output: [
        '::error::The login to the test org was not tried: "orglens init" failed.',
        'It ended with the exit code 1 and the error WORKSPACE_IO. What it printed is not shown here.',
        '',
      ].join('\n'),
    });
    expect(starts().map((start) => start.name)).toEqual(['init']);
  });

  it('says so if no command follows the two dashes', async () => {
    const run = await login(secrets(), []);
    expect(run).toEqual({
      code: 1,
      output: '::error::The login to the test org was not tried: no command follows "--".\n',
    });
  });
});
