/**
 * The login step of the live-org workflow (`scripts/live-org-login.mjs`),
 * run against a mock org. Its output goes to the public log of a workflow,
 * so the tests are about what it must never print.
 */
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
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

let mock: MockOrg;
beforeAll(async () => {
  mock = await startMockOrg(pair.publicKey);
});
afterAll(async () => {
  await mock.close();
});
afterEach(() => {
  mock.paths.length = 0;
  mock.refusal = null;
});

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
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, '--', ...orglens], {
      env: { ...process.env, ...env },
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

  it('says why Salesforce refused the login, without what Salesforce says about the org or the user', async () => {
    mock.refusal = `user ${USERNAME} of ${mock.url}/path (org ${mock.orgId}, also ${mock.orgId.slice(0, 15)}) has not approved the consumer ${CLIENT_ID} at acme--uat.sandbox.my.salesforce.com`;
    const run = await login(secrets());
    expect(run.code).toBe(1);
    expect(run.output).toContain('::error::The login to the test org failed: LOGIN_FAILED (JWT_REJECTED).');
    expect(run.output).toContain('Answer of Salesforce: invalid_grant');
    expect(run.output).toContain('has not approved the consumer');
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
    const leak = `console.log(process.argv.includes('check') ? 'token 00Dxx0000000001EAA!abc for ${USERNAME}' : '')`;
    const run = await login(secrets(), [process.execPath, '-e', leak, '--']);
    expect(run.code).toBe(1);
    expect(run.output).toContain('"orglens source check" did not answer as expected.');
    expect(run.output).toContain('It ended with the exit code 0. What it printed is not shown here.');
    expectNoSecret(run.output);
  });
});
