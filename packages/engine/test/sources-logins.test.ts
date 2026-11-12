import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource, SandboxSource } from '../src/core/config/config.ts';
import { isEngineError, type EngineError } from '../src/core/errors.ts';
import {
  audiences,
  jwtVariables,
  loginWithKey,
  originOf,
  readJwtSettings,
  type JwtSettings,
} from '../src/sources/jwt.ts';
import { chooseCliLogin, cliStateDir, listCliLogins, sameOrg, type CliLogin } from '../src/sources/logins.ts';
import { connectToOrg, planLogin } from '../src/sources/org.ts';
import { isFailedRenewal, networkCode, saidBy } from '../src/sources/org-errors.ts';
import { forgetCliLogins, homeFiles, loginsOfLibrary, seedCliLogin } from './helpers/cli-logins.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { tempDirs } from './helpers/store.ts';

const ORG_ID = '00Dxx0000000001EAA';
const OTHER_ORG_ID = '00Dxx0000000002EAA';

const org = (fields: Partial<OrgSource> = {}): OrgSource => ({
  name: 'prod',
  kind: 'org',
  description: null,
  orgId: ORG_ID,
  loginUrl: null,
  ...fields,
});

const sandbox: SandboxSource = {
  name: 'uat',
  kind: 'sandbox',
  description: null,
  orgId: null,
  loginUrl: null,
  sandboxOf: null,
  sandboxName: null,
};

async function failure(work: () => unknown): Promise<EngineError> {
  try {
    await work();
  } catch (error) {
    if (isEngineError(error)) return error;
    throw error;
  }
  throw new Error('Expected a failure.');
}

/** A key pair made for the test. No key is ever kept in the repository. */
const keys = (): { privateKey: string; publicKey: string } =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

const dirs = tempDirs();
let mock: MockOrg;
const pair = keys();

beforeAll(async () => {
  mock = await startMockOrg();
});
afterAll(async () => {
  await mock.close();
  dirs.cleanUp();
});
afterEach(async () => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.refreshTokens.clear();
  mock.key = null;
  mock.intercept = null;
  await forgetCliLogins();
});

describe('the home folder of the tests', () => {
  it('is not the home folder of the person who runs them', () => {
    expect(homedir()).toContain('orglens-home-');
    expect(homeFiles()).toEqual([]);
  });

  it('is where the Salesforce library keeps its logins', async () => {
    const { Global } = await import('@salesforce/core');
    expect(Global.DIR).toBe(cliStateDir());
  });
});

describe('listCliLogins', () => {
  it('lists nothing and creates nothing where the Salesforce CLI was never used', () => {
    expect(listCliLogins()).toEqual([]);
    expect(homeFiles()).toEqual([]);
  });

  it('lists the logins the Salesforce library lists, without their tokens and without changing a file', async () => {
    await seedCliLogin({
      username: 'zoe@example.com',
      alias: 'prod',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'token-of-zoe',
      refreshToken: 'refresh-of-zoe',
    });
    await seedCliLogin({ username: 'adam@example.com', orgId: OTHER_ORG_ID, instanceUrl: mock.url, accessToken: 'x' });
    const { StateAggregator } = await import('@salesforce/core');
    await (await StateAggregator.getInstance()).aliases.setAndSave('main', 'zoe@example.com');
    StateAggregator.clearInstance();

    const before = homeFiles().map((file) => [file, readFileSync(join(homedir(), file), 'utf8')]);
    const logins = listCliLogins();
    expect(logins).toEqual([
      { username: 'adam@example.com', aliases: [], orgId: OTHER_ORG_ID, instanceUrl: mock.url },
      { username: 'zoe@example.com', aliases: ['main', 'prod'], orgId: ORG_ID, instanceUrl: mock.url },
    ]);
    expect(JSON.stringify(logins)).not.toContain('token');
    expect(homeFiles().map((file) => [file, readFileSync(join(homedir(), file), 'utf8')])).toEqual(before);

    expect(logins.map(({ username, aliases, orgId }) => ({ username, aliases, orgId }))).toEqual(
      await loginsOfLibrary(),
    );
  });

  it('leaves out files that are no login', async () => {
    await seedCliLogin({ username: 'zoe@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'x' });
    const dir = cliStateDir();
    writeFileSync(join(dir, 'broken@example.com.json'), '{ "username": ');
    writeFileSync(join(dir, 'list@example.com.json'), '[]');
    writeFileSync(join(dir, 'other@example.com.json'), JSON.stringify({ username: 'someone@example.com' }));
    writeFileSync(join(dir, 'zoe@example.com.sandbox.json'), JSON.stringify({ sandboxUsername: 'zoe@example.com' }));
    writeFileSync(join(dir, 'notes.json'), JSON.stringify({ username: 'notes' }));
    mkdirSync(join(dir, 'folder@example.com.json'));
    expect(listCliLogins().map((login) => login.username)).toEqual(['zoe@example.com']);
  });

  it('lists logins without aliases when the alias file is not what it should be', async () => {
    await seedCliLogin({
      username: 'zoe@example.com',
      alias: 'prod',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'x',
    });
    writeFileSync(join(cliStateDir(), 'alias.json'), JSON.stringify({ orgs: { prod: 7, other: 'adam@example.com' } }));
    expect(listCliLogins()).toMatchObject([{ username: 'zoe@example.com', aliases: [] }]);
    writeFileSync(join(cliStateDir(), 'alias.json'), 'not json');
    expect(listCliLogins()).toMatchObject([{ username: 'zoe@example.com', aliases: [] }]);
  });
});

describe('chooseCliLogin', () => {
  const zoe: CliLogin = {
    username: 'zoe@example.com',
    aliases: ['main', 'prod'],
    orgId: ORG_ID,
    instanceUrl: 'https://a',
  };
  const adam: CliLogin = { username: 'adam@example.com', aliases: [], orgId: OTHER_ORG_ID, instanceUrl: 'https://b' };
  // A login whose user name is the alias of another one.
  const odd: CliLogin = { username: 'prod', aliases: [], orgId: OTHER_ORG_ID, instanceUrl: 'https://c' };

  it('compares org ids by their first 15 characters', () => {
    expect(sameOrg('00Dxx0000000001', '00Dxx0000000001EAA')).toBe(true);
    expect(sameOrg('00Dxx0000000001EAA', '00Dxx0000000002EAA')).toBe(false);
    expect(sameOrg('00Dxx000000000a', '00Dxx000000000A')).toBe(false);
  });

  it('takes the linked login by alias or by user name, an alias first', () => {
    expect(chooseCliLogin(org(), 'main', [adam, zoe])).toEqual({ via: 'linked', login: zoe, alias: 'main' });
    expect(chooseCliLogin(org(), 'zoe@example.com', [adam, zoe])).toEqual({ via: 'linked', login: zoe, alias: 'main' });
    expect(chooseCliLogin(org(), 'adam@example.com', [adam, zoe])).toEqual({ via: 'linked', login: adam, alias: null });
    expect(chooseCliLogin(org(), 'prod', [odd, zoe])).toMatchObject({ login: zoe, alias: 'prod' });
  });

  it('does not fall back to the org id when the linked login is gone', () => {
    const gone = chooseCliLogin(org(), 'gone', [zoe]);
    expect(gone).toMatchObject({ via: 'none', reason: 'LOGIN_UNKNOWN' });
    expect(gone).toMatchObject({ hint: expect.stringContaining('sf org login web --alias gone)') as unknown });
    // A user name is not proposed as an alias.
    const user = chooseCliLogin(org(), 'eve@example.com', [zoe]);
    expect(user).toMatchObject({ hint: expect.stringContaining('(sf org login web)') as unknown });
  });

  it('takes the one login of the declared org', () => {
    expect(chooseCliLogin(org(), undefined, [adam, zoe])).toEqual({ via: 'org-id', login: zoe, alias: 'main' });
    expect(chooseCliLogin(org({ orgId: '00Dxx0000000002' }), undefined, [adam, zoe])).toMatchObject({ login: adam });
  });

  it('chooses none where nothing or too much fits', () => {
    expect(chooseCliLogin(org({ orgId: null }), undefined, [zoe])).toMatchObject({ via: 'none', reason: 'NO_LOGIN' });
    expect(chooseCliLogin(org(), undefined, [adam])).toMatchObject({ via: 'none', reason: 'NO_LOGIN' });
    expect(chooseCliLogin(org(), undefined, [])).toMatchObject({ via: 'none', reason: 'NO_LOGIN' });
    const twin = { ...adam, orgId: '00Dxx0000000001' };
    const choice = chooseCliLogin(org(), undefined, [twin, zoe]);
    expect(choice).toMatchObject({ via: 'none', reason: 'LOGIN_AMBIGUOUS' });
    expect(JSON.stringify(choice)).not.toContain('example.com');
  });
});

describe('the variables for a login with a key', () => {
  const names = jwtVariables('prod');
  const complete = { [names.username]: 'ci@example.com', [names.clientId]: 'client', [names.key]: 'KEY' };

  it('carry the name of the source', () => {
    expect(jwtVariables('uat-eu-1')).toEqual({
      loginUrl: 'ORGLENS_JWT_UAT_EU_1_LOGIN_URL',
      username: 'ORGLENS_JWT_UAT_EU_1_USERNAME',
      clientId: 'ORGLENS_JWT_UAT_EU_1_CLIENT_ID',
      key: 'ORGLENS_JWT_UAT_EU_1_KEY',
      keyFile: 'ORGLENS_JWT_UAT_EU_1_KEY_FILE',
    });
  });

  it('are not there for a source when none of them is set', () => {
    expect(readJwtSettings(org(), {})).toBeUndefined();
    expect(readJwtSettings(org(), { [names.username]: '', [names.key]: '  ' })).toBeUndefined();
    expect(readJwtSettings(org(), { ORGLENS_JWT_UAT_USERNAME: 'ci@example.com' })).toBeUndefined();
  });

  it('are read with the login address of Salesforce for the kind of the source', () => {
    expect(readJwtSettings(org(), { ...complete, [names.username]: ' ci@example.com ' })).toEqual({
      source: 'prod',
      loginUrl: 'https://login.salesforce.com',
      username: 'ci@example.com',
      clientId: 'client',
      key: { text: 'KEY' },
    });
    const ofSandbox = jwtVariables('uat');
    expect(
      readJwtSettings(sandbox, {
        [ofSandbox.username]: 'ci@example.com',
        [ofSandbox.clientId]: 'client',
        [ofSandbox.keyFile]: 'ci.key',
      }),
    ).toMatchObject({ loginUrl: 'https://test.salesforce.com', key: { file: 'ci.key' } });
  });

  it('take the login address from the variable, then from the source', () => {
    const declared = org({ loginUrl: 'https://acme.my.salesforce.com/' });
    expect(readJwtSettings(declared, complete)?.loginUrl).toBe('https://acme.my.salesforce.com');
    expect(readJwtSettings(declared, { ...complete, [names.loginUrl]: 'http://127.0.0.1:8080' })?.loginUrl).toBe(
      'http://127.0.0.1:8080',
    );
  });

  it('are an error when some are set and others are missing', async () => {
    const error = await failure(() => readJwtSettings(org(), { [names.loginUrl]: 'https://login.salesforce.com' }));
    expect(error).toMatchObject({
      code: 'LOGIN_FAILED',
      details: { reason: 'JWT_INCOMPLETE', source: 'prod', missing: [names.username, names.clientId, names.key] },
    });
    expect(error.hint).toContain('ORGLENS_JWT_PROD_');
    const noKey = await failure(() =>
      readJwtSettings(org(), { [names.username]: 'ci@example.com', [names.clientId]: 'client' }),
    );
    expect(noKey.details).toMatchObject({ missing: [names.key] });
  });

  it('are an error when both a key and a key file are given', async () => {
    const error = await failure(() => readJwtSettings(org(), { ...complete, [names.keyFile]: 'ci.key' }));
    expect(error).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'JWT_INVALID', variable: names.keyFile } });
  });

  it.each([
    'http://login.salesforce.com',
    'https://user:secret@login.salesforce.com',
    'https://login.salesforce.com/?x=1',
    'https://login.salesforce.com/#x',
    'login.salesforce.com',
    'ftp://127.0.0.1',
  ])('refuse the login address %s', async (address) => {
    expect(originOf(address)).toBeNull();
    const error = await failure(() => readJwtSettings(org(), { ...complete, [names.loginUrl]: address }));
    expect(error.details).toMatchObject({ reason: 'JWT_INVALID', variable: names.loginUrl });
    expect(error.message).not.toContain('secret');
  });

  it('accept https, and http for this machine only', () => {
    expect(originOf('https://acme.my.salesforce.com/some/path')).toBe('https://acme.my.salesforce.com');
    expect(originOf('http://localhost:1234')).toBe('http://localhost:1234');
    expect(originOf('http://[::1]:1234')).toBe('http://[::1]:1234');
  });

  it('name the general addresses of Salesforce as audience, and a foreign host only itself', () => {
    expect(audiences('https://login.salesforce.com', 'org')).toEqual([
      'https://login.salesforce.com',
      'https://test.salesforce.com',
    ]);
    expect(audiences('https://acme--uat.sandbox.my.salesforce.com', 'sandbox')).toEqual([
      'https://test.salesforce.com',
      'https://login.salesforce.com',
      'https://acme--uat.sandbox.my.salesforce.com',
    ]);
    expect(audiences('http://127.0.0.1:8080', 'org')).toEqual(['http://127.0.0.1:8080']);
    expect(audiences('https://notsalesforce.com', 'org')).toEqual(['https://notsalesforce.com']);
    expect(audiences('https://salesforce.com.example.org', 'sandbox')).toEqual(['https://salesforce.com.example.org']);
  });
});

describe('loginWithKey', () => {
  const settings = (fields: Partial<JwtSettings> = {}): JwtSettings => ({
    source: 'prod',
    loginUrl: mock.url,
    username: 'ci@example.com',
    clientId: 'client-id',
    key: { text: pair.privateKey },
    ...fields,
  });
  const accept = (audienceList?: readonly string[]): void => {
    mock.key = {
      username: 'ci@example.com',
      clientId: 'client-id',
      publicKey: pair.publicKey,
      ...(audienceList === undefined ? {} : { audiences: audienceList }),
    };
  };

  it('returns a session of the org and writes nothing', async () => {
    accept();
    const token = await loginWithKey(settings(), [mock.url]);
    expect(token).toEqual({ accessToken: [...mock.sessions][0], instanceUrl: mock.url, orgId: ORG_ID });
    expect(mock.sessions.size).toBe(1);
    expect(mock.asked()).toEqual(['POST /services/oauth2/token']);
    expect(homeFiles()).toEqual([]);
  });

  it('reads a key given in one line, and a key in a file', async () => {
    accept();
    const oneLine = pair.privateKey.trim().split('\n').join('\\n');
    expect(oneLine).not.toContain('\n');
    await loginWithKey(settings({ key: { text: oneLine } }), [mock.url]);
    const file = join(dirs.next(), 'ci.key');
    writeFileSync(file, pair.privateKey);
    await loginWithKey(settings({ key: { file } }), [mock.url]);
    expect(mock.sessions.size).toBe(2);
  });

  it('reads a key as a pasted secret often arrives', async () => {
    accept();
    const lines = pair.privateKey.trim().split('\n');
    for (const text of [
      `${lines.join('\\n')}\n`,
      `  ${lines.join('\\n')}  `,
      lines.join('\\r\\n'),
      `\n${lines.join('\r\n')}\r\n`,
    ]) {
      await loginWithKey(settings({ key: { text } }), [mock.url]);
    }
    expect(mock.sessions.size).toBe(4);
  });

  it('says which variable holds no usable key, and nothing about the key', async () => {
    const names = jwtVariables('prod');
    const notAKey = await failure(() => loginWithKey(settings({ key: { text: 'not a key at all' } }), [mock.url]));
    expect(notAKey).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'JWT_INVALID', variable: names.key } });
    expect(notAKey.message).not.toContain('not a key at all');

    const elliptic = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const wrongKind = await failure(() => loginWithKey(settings({ key: { text: elliptic.privateKey } }), [mock.url]));
    expect(wrongKind.message).toContain('not an RSA key');

    const noFile = await failure(() =>
      loginWithKey(settings({ key: { file: join(dirs.next(), 'missing.key') } }), [mock.url]),
    );
    expect(noFile.details).toMatchObject({ reason: 'JWT_INVALID', variable: names.keyFile });
    expect(noFile.message).toContain('ENOENT');
    expect(mock.requests).toEqual([]);
  });

  it('tries the next audience when Salesforce refuses one', async () => {
    accept(['https://test.salesforce.com']);
    const token = await loginWithKey(settings(), [
      'https://login.salesforce.com',
      'https://test.salesforce.com',
      mock.url,
    ]);
    expect(mock.sessions.has(token.accessToken)).toBe(true);
    expect(mock.asked()).toHaveLength(2);
  });

  it('reports the refusal that says most when every audience is refused', async () => {
    accept(['https://test.salesforce.com']);
    const error = await failure(() =>
      loginWithKey(settings({ username: 'someone@example.com' }), [
        'https://login.salesforce.com',
        'https://test.salesforce.com',
      ]),
    );
    expect(error).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'JWT_REJECTED', error: 'invalid_grant' } });
    expect(error.message).toContain("user hasn't approved this consumer");
    expect(error.message).not.toContain('someone@example.com');
    expect(error.hint).toContain('ORGLENS_JWT_PROD_CLIENT_ID');

    const audienceOnly = await failure(() => loginWithKey(settings(), ['https://login.salesforce.com']));
    expect(audienceOnly.message).toContain('audience is invalid');
  });

  it('stops at an answer that is not about the grant', async () => {
    accept();
    const error = await failure(() =>
      loginWithKey(settings({ clientId: 'another-app' }), [mock.url, 'https://x.invalid']),
    );
    expect(error.details).toMatchObject({ reason: 'JWT_REJECTED', error: 'invalid_client_id' });
    expect(mock.asked()).toHaveLength(1);
  });

  it('refuses a key that does not belong to the certificate of the app', async () => {
    accept();
    const error = await failure(() => loginWithKey(settings({ key: { text: keys().privateKey } }), [mock.url]));
    expect(error.message).toContain('invalid assertion');
  });

  it('says so when the address does not answer like Salesforce', async () => {
    mock.intercept = () => ({ status: 503, type: 'text/html', body: '<html>Maintenance</html>' });
    const html = await failure(() => loginWithKey(settings(), [mock.url]));
    expect(html.details).toMatchObject({ reason: 'REQUEST_FAILED' });

    // With a character set in the header, the library passes the whole page on as its message.
    const page = `<!DOCTYPE html><html><head><title>Down</title></head><body>${'x'.repeat(5000)} ci@example.com</body></html>`;
    mock.intercept = () => ({ status: 503, type: 'text/html; charset=UTF-8', body: page });
    const charset = await failure(() => loginWithKey(settings(), [mock.url]));
    expect(charset.details).toMatchObject({ reason: 'REQUEST_FAILED' });
    expect(charset.message).toContain('The answer was a page, not data.');
    expect(charset.message).not.toContain('xxxx');
    expect(charset.message).not.toContain('example.com');

    mock.intercept = () => ({ status: 200, body: JSON.stringify({ access_token: 'x', instance_url: 'ftp://x' }) });
    const incomplete = await failure(() => loginWithKey(settings(), [mock.url]));
    expect(incomplete.details).toMatchObject({ reason: 'REQUEST_FAILED' });
  });

  it('masks a user name and an address in what Salesforce says about a refusal', async () => {
    mock.intercept = () => ({
      status: 400,
      body: JSON.stringify({
        error: 'invalid_grant',
        error_description: `user ci@example.com hasn't approved this consumer at ${mock.url}/setup or acme.my.salesforce.com`,
      }),
    });
    const error = await failure(() => loginWithKey(settings(), [mock.url]));
    expect(error.details).toMatchObject({ reason: 'JWT_REJECTED', error: 'invalid_grant' });
    expect(error.message).toContain("user [user] hasn't approved this consumer at [address] or [address]");
    expect(JSON.stringify(error)).not.toContain('example.com');
    expect(JSON.stringify(error)).not.toContain('127.0.0.1');
    expect(JSON.stringify(error)).not.toContain('acme');
  });

  it('says that the org cannot be reached when nothing listens at the address', async () => {
    const gone = await startMockOrg();
    await gone.close();
    const error = await failure(() => loginWithKey(settings({ loginUrl: gone.url }), [gone.url]));
    expect(error).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'ORG_UNREACHABLE', source: 'prod' } });
    expect(error.message).not.toContain('127.0.0.1');
  });
});

describe('networkCode', () => {
  it('finds the code of a failed connection in what was thrown or in its cause', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(networkCode(refused)).toBe('ECONNREFUSED');
    expect(networkCode(new TypeError('fetch failed', { cause: refused }))).toBe('ECONNREFUSED');
    expect(networkCode(new TypeError('fetch failed'))).toBe('FETCH_FAILED');
    expect(networkCode(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('TIMEOUT');
    expect(networkCode(Object.assign(new Error('no such host'), { name: 'DomainNotFoundError' }))).toBe('ENOTFOUND');
    expect(networkCode(Object.assign(new Error('x'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }))).toBe(
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    );
  });

  it('finds none in an answer of Salesforce or in anything else', () => {
    expect(networkCode(Object.assign(new Error('expired'), { errorCode: 'INVALID_SESSION_ID' }))).toBeNull();
    expect(networkCode(new Error('something'))).toBeNull();
    expect(networkCode('text')).toBeNull();
    const circle: { cause?: unknown; message: string } = { message: 'round' };
    circle.cause = circle;
    expect(networkCode(circle)).toBeNull();
  });
});

describe('what Salesforce or a library says', () => {
  it('is shown in one line, without tokens, addresses and user names, and cut to a length', () => {
    expect(saidBy(new Error('first\n  second'))).toBe('first second');
    expect(saidBy(new Error('see https://acme.my.salesforce.com/x?y=1, or acme--uat.sandbox.my.salesforce.com'))).toBe(
      'see [address] or [address]',
    );
    expect(saidBy(new Error('user zoe@example.com (zoe+ci@example.co.uk) is not allowed'))).toBe(
      'user [user] ([user]) is not allowed',
    );
    expect(saidBy(new Error('y'.repeat(1000)))).toBe(`${'y'.repeat(300)}…`);
    expect(saidBy('<html><body>zoe@example.com</body></html>')).toBe('The answer was a page, not data.');
    expect(
      saidBy(new Error('session 00Dxx0000000001!AQEAQabcdefghijklmnopqrstuvwxyz0123456789 is gone')),
    ).not.toContain('AQEAQabcdefghijklmnop');
  });

  it('counts as a failed renewal only when the library says so itself', () => {
    expect(isFailedRenewal(new Error('Unable to refresh session due to: expired access/refresh token'))).toBe(true);
    // The answer of an org that happens to hold the word.
    expect(isFailedRenewal(new Error('<meta http-equiv="Refresh" content="0">'))).toBe(false);
    expect(isFailedRenewal(Object.assign(new Error('Unable to refresh session'), { name: 'ERROR_HTTP_404' }))).toBe(
      false,
    );
    expect(isFailedRenewal('Unable to refresh session')).toBe(false);
  });
});

describe('connectToOrg with a login of the Salesforce CLI', () => {
  const seed = async (fields: Partial<Parameters<typeof seedCliLogin>[0]> = {}): Promise<void> => {
    mock.sessions.add('valid-session');
    mock.refreshTokens.add('valid-refresh');
    await seedCliLogin({
      username: 'zoe@example.com',
      alias: 'main',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'valid-session',
      refreshToken: 'valid-refresh',
      ...fields,
    });
  };
  const contents = (): [string, string][] =>
    homeFiles().map((file) => [file, readFileSync(join(homedir(), file), 'utf8')]);

  it('uses the one login of the declared org, with the newest API version, and changes no file', async () => {
    await seed();
    const before = contents();
    const session = await connectToOrg(org(), undefined, {});
    expect(session).toMatchObject({
      via: 'org-id',
      alias: 'main',
      username: 'zoe@example.com',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      apiVersion: '66.0',
    });
    expect(session.connection.getApiVersion()).toBe('66.0');
    expect(mock.asked()).toEqual(['GET /services/data/v66.0/']);
    expect(contents()).toEqual(before);
  });

  it('uses the linked login, also for a source that declares no org', async () => {
    await seed();
    await seed({ username: 'adam@example.com', alias: 'other' });
    const session = await connectToOrg(org({ orgId: null }), 'other', {});
    expect(session).toMatchObject({ via: 'linked', alias: 'other', username: 'adam@example.com', orgId: ORG_ID });
  });

  it('renews a session that has expired, and the library then asks the org about the org', async () => {
    // An org that lists its versions as Salesforce does. The other mock also lists 9.0, to show that OrgLens
    // compares versions as numbers. The library compares them as text, and would take 9.0 for the newest.
    const plain = await startMockOrg({ versions: ['64.0', '65.0', '66.0'] });
    try {
      plain.refreshTokens.add('valid-refresh');
      await seed({ instanceUrl: plain.url, accessToken: 'expired-session' });
      const session = await connectToOrg(org(), undefined, {});
      expect(session).toMatchObject({ orgId: ORG_ID, apiVersion: '66.0' });
      expect(session.connection.accessToken).toMatch(/^session-\d+$/);
      // Everything after the renewal and before the last request is the library's own, made when it stores the
      // renewed session: whether the org is a Dev Hub, the versions of the org, and the name and kind of the org.
      // Record 0031 names these requests. A change here is a change to that record.
      expect(plain.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
        'GET /services/data',
        'GET /services/data/v66.0/',
        'POST /services/oauth2/token',
        'GET /services/data/v51.0/query',
        'GET /services/data',
        'GET /services/data/v66.0/query',
        'GET /services/data/v66.0/',
      ]);
      const stored = readFileSync(join(cliStateDir(), 'zoe@example.com.json'), 'utf8');
      expect(stored).not.toContain('expired-session');
      expect(stored).not.toMatch(/session-\d/);
      expect(stored).not.toContain('valid-refresh');
      expect(JSON.parse(stored)).toMatchObject({ instanceApiVersion: '66.0' });
    } finally {
      await plain.close();
    }
  });

  it('does not take the answer of an org for a session that could not be renewed', async () => {
    await seed();
    mock.intercept = (request) =>
      request.path === '/services/data/v66.0/'
        ? {
            status: 404,
            type: 'text/html; charset=UTF-8',
            body: '<html><head><meta http-equiv="Refresh" content="0; url=https://example.com/"></head></html>',
          }
        : undefined;
    const error = await failure(() => connectToOrg(org(), undefined, {}));
    expect(error.details).toMatchObject({ reason: 'REQUEST_FAILED' });
    expect(error.message).toContain('The answer was a page, not data.');
    expect(error.message).not.toContain('meta');
  });

  it('says to log in again when the session cannot be renewed', async () => {
    await seed({ accessToken: 'expired-session', refreshToken: 'revoked-refresh' });
    const error = await failure(() => connectToOrg(org(), undefined, {}));
    expect(error).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'SESSION_EXPIRED', source: 'prod' } });
    expect(error.hint).toContain(`sf org login web --alias main --instance-url ${mock.url}`);
    expect(JSON.stringify(error)).not.toContain('revoked-refresh');
  });

  it('refuses a login of another org before it connects', async () => {
    await seed({ orgId: OTHER_ORG_ID });
    const error = await failure(() => connectToOrg(org(), 'main', {}));
    expect(error).toMatchObject({
      code: 'ORG_MISMATCH',
      details: { source: 'prod', declared: ORG_ID, found: OTHER_ORG_ID },
    });
    expect(mock.requests).toEqual([]);
  });

  it('refuses an org that says it is another one than the login file states', async () => {
    const other = await startMockOrg({ orgId: OTHER_ORG_ID });
    try {
      other.sessions.add('valid-session');
      await seed({ instanceUrl: other.url });
      const error = await failure(() => connectToOrg(org(), undefined, {}));
      expect(error).toMatchObject({ code: 'ORG_MISMATCH', details: { declared: ORG_ID, found: OTHER_ORG_ID } });
    } finally {
      await other.close();
    }
  });

  it('fails without a login, with several, and with a link to a login that is gone', async () => {
    const none = await failure(() => connectToOrg(org(), undefined, {}));
    expect(none).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'NO_LOGIN', source: 'prod' } });
    await seed();
    await seed({ username: 'adam@example.com', alias: 'other' });
    const several = await failure(() => connectToOrg(org(), undefined, {}));
    expect(several.details).toMatchObject({ reason: 'LOGIN_AMBIGUOUS' });
    expect(several.hint).toContain('orglens source link prod');
    const gone = await failure(() => connectToOrg(org(), 'nobody', {}));
    expect(gone.details).toMatchObject({ reason: 'LOGIN_UNKNOWN' });
    expect(mock.requests).toEqual([]);
  });

  it('says that the org cannot be reached when nothing listens at its address', async () => {
    const gone = await startMockOrg();
    await gone.close();
    await seed({ instanceUrl: gone.url });
    const error = await failure(() => connectToOrg(org(), undefined, {}));
    expect(error).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'ORG_UNREACHABLE' } });
  });

  it('says so when the org lists no API versions', async () => {
    await seed();
    mock.intercept = (request) => (request.path === '/services/data' ? { status: 200, body: '{}' } : undefined);
    const error = await failure(() => connectToOrg(org(), undefined, {}));
    expect(error.details).toMatchObject({ reason: 'REQUEST_FAILED' });
  });
});

describe('connectToOrg with a key from the environment', () => {
  const names = jwtVariables('prod');
  const env = (): Record<string, string> => ({
    [names.loginUrl]: mock.url,
    [names.username]: 'ci@example.com',
    [names.clientId]: 'client-id',
    [names.key]: pair.privateKey,
  });
  const accept = (): void => {
    mock.key = { username: 'ci@example.com', clientId: 'client-id', publicKey: pair.publicKey };
  };

  it('works twice in a row and leaves no login and no session in the home folder', async () => {
    accept();
    const sessions = new Set<string>();
    for (let round = 0; round < 2; round += 1) {
      const session = await connectToOrg(org(), undefined, env());
      expect(session).toMatchObject({
        via: 'jwt-env',
        alias: null,
        username: 'ci@example.com',
        orgId: ORG_ID,
        instanceUrl: mock.url,
        apiVersion: '66.0',
      });
      sessions.add(session.connection.accessToken ?? '');
    }
    expect([...sessions].sort()).toEqual([...mock.sessions].sort());
    expect(sessions.size).toBe(2);
    expect(mock.asked()).toEqual([
      'POST /services/oauth2/token',
      'GET /services/data/v66.0/',
      'POST /services/oauth2/token',
      'GET /services/data/v66.0/',
    ]);
    expect(listCliLogins()).toEqual([]);
    for (const file of homeFiles()) {
      const content = readFileSync(join(homedir(), file), 'utf8');
      expect(content, file).not.toContain('session-');
      expect(content, file).not.toContain('ci@example.com');
      expect(content, file).not.toContain('PRIVATE KEY');
    }
    expect(homeFiles().filter((file) => file.includes('@'))).toEqual([]);
  });

  it('comes before a login of the Salesforce CLI, and leaves that login as it is', async () => {
    accept();
    mock.sessions.add('valid-session');
    await seedCliLogin({
      username: 'zoe@example.com',
      alias: 'main',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'valid-session',
      refreshToken: 'valid-refresh',
    });
    const file = join(cliStateDir(), 'zoe@example.com.json');
    const before = readFileSync(file, 'utf8');
    const session = await connectToOrg(org(), 'main', env());
    expect(session.via).toBe('jwt-env');
    expect(session.username).toBe('ci@example.com');
    expect(session.connection.accessToken).toMatch(/^session-\d+$/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('is refused for a user who also has a login of the Salesforce CLI, before anything is sent', async () => {
    // The library would take over the refresh token of that login, renew a session of the key with it, and
    // write the login file. A login with a key must not turn into another login.
    accept();
    mock.refreshTokens.add('valid-refresh');
    await seedCliLogin({
      username: 'ci@example.com',
      alias: 'main',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'expired-session',
      refreshToken: 'valid-refresh',
    });
    const file = join(cliStateDir(), 'ci@example.com.json');
    const before = readFileSync(file, 'utf8');
    for (const username of ['ci@example.com', 'CI@Example.com']) {
      const error = await failure(() => connectToOrg(org(), undefined, { ...env(), [names.username]: username }));
      expect(error).toMatchObject({
        code: 'LOGIN_FAILED',
        details: { reason: 'JWT_USER_HAS_LOGIN', source: 'prod' },
      });
      expect(error.hint).toContain(names.username);
      expect(JSON.stringify(error)).not.toContain('example.com');
    }
    expect(mock.requests).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('refuses a key that logs in to another org than the declared one', async () => {
    accept();
    const error = await failure(() => connectToOrg(org({ orgId: OTHER_ORG_ID }), undefined, env()));
    expect(error).toMatchObject({ code: 'ORG_MISMATCH', details: { declared: OTHER_ORG_ID, found: ORG_ID } });
    expect(mock.asked()).toEqual(['POST /services/oauth2/token']);
  });

  it('does not fall back to a login of the Salesforce CLI when the variables are incomplete', async () => {
    mock.sessions.add('valid-session');
    await seedCliLogin({
      username: 'zoe@example.com',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'valid-session',
    });
    const error = await failure(() => connectToOrg(org(), undefined, { [names.username]: 'ci@example.com' }));
    expect(error.details).toMatchObject({ reason: 'JWT_INCOMPLETE' });
    expect(mock.requests).toEqual([]);
  });

  it('says so when the org does not accept the session it issued', async () => {
    accept();
    mock.intercept = (request) =>
      request.path === '/services/data/v66.0/'
        ? {
            status: 401,
            body: JSON.stringify([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }]),
          }
        : undefined;
    const error = await failure(() => connectToOrg(org(), undefined, env()));
    expect(error.details).toMatchObject({ reason: 'SESSION_EXPIRED' });
  });
});

describe('planLogin', () => {
  const zoe: CliLogin = { username: 'zoe@example.com', aliases: ['main'], orgId: ORG_ID, instanceUrl: 'https://a' };
  const names = jwtVariables('prod');

  it('says by which route a source would be logged in', () => {
    expect(planLogin(org(), undefined, [zoe], {})).toEqual({ source: 'prod', via: 'org-id', problem: null });
    expect(planLogin(org({ orgId: null }), 'main', [zoe], {})).toEqual({
      source: 'prod',
      via: 'linked',
      problem: null,
    });
    const complete = { [names.username]: 'ci@example.com', [names.clientId]: 'client', [names.key]: 'KEY' };
    expect(planLogin(org(), 'main', [zoe], complete)).toEqual({ source: 'prod', via: 'jwt-env', problem: null });
  });

  it('says what stands in the way, without naming a login or a user', () => {
    const plans = [
      planLogin(org(), undefined, [], {}),
      planLogin(org({ orgId: null }), undefined, [zoe], {}),
      planLogin(org(), 'zoe@example.com', [], {}),
      planLogin(org(), undefined, [zoe, { ...zoe, username: 'adam@example.com' }], {}),
      planLogin(org({ orgId: OTHER_ORG_ID }), 'main', [zoe], {}),
      planLogin(org(), undefined, [zoe], { [names.username]: 'ci@example.com' }),
    ];
    expect(plans.map((plan) => plan.via)).toEqual(['none', 'none', 'none', 'none', 'linked', 'jwt-env']);
    for (const plan of plans) {
      expect(plan.problem).not.toBeNull();
      expect(plan.problem).not.toContain('example.com');
    }
  });
});
