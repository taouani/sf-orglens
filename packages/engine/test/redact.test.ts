import { describe, expect, it } from 'vitest';
import { redact, REDACTED, redactText } from '../src/core/redact.ts';

// Every secret below is made up, and is assembled from pieces so that no
// scanner mistakes this file for a leak.
const sessionId = ['00D5g00000', 'AbCdE', '!', 'AQEAQ', 'x'.repeat(40)].join('');
const jwt = ['eyJhbGciOiJSUzI1NiJ9', 'eyJpc3MiOiJmYWtlIn0', 'c2lnbmF0dXJl'].join('.');
const pem = [
  '-----BEGIN',
  ' PRIVATE KEY-----\n',
  'TUlJRXZRSUJBREFOQmdrcWhraUc5\n',
  '-----END',
  ' PRIVATE KEY-----',
].join('');
const refreshToken = ['5Aep', '861', 'q'.repeat(40)].join('');
const basic = Buffer.from(['someone', 'made-up-pass'].join(':')).toString('base64');
const authUrl = ['force', '://', 'PlatformCLI::', '5Aep861', 'x'.repeat(30), '@acme.my.salesforce.example'].join('');

describe('redactText', () => {
  it('masks a Salesforce session id', () => {
    expect(redactText(`session ${sessionId} expired`)).toBe(`session ${REDACTED} expired`);
  });

  it('masks a JSON Web Token', () => {
    expect(redactText(`assertion was ${jwt}.`)).toBe(`assertion was ${REDACTED}.`);
  });

  it('masks a private key block, finished or not', () => {
    expect(redactText(`key:\n${pem}\nend`)).toBe(`key:\n${REDACTED}\nend`);
    expect(redactText(`key:\n${pem.slice(0, 50)}`)).toBe(`key:\n${REDACTED}`);
  });

  it('masks a Salesforce CLI auth URL', () => {
    expect(redactText(`url=${authUrl} next`)).toBe(`url=${REDACTED} next`);
  });

  it('masks a bearer token and an authorization header', () => {
    expect(redactText(`Bearer ${'t'.repeat(20)}`)).toBe(REDACTED);
    expect(redactText(`BEARER ${'t'.repeat(20)}~tail`)).toBe(REDACTED);
    expect(redactText('Authorization: Basic dXNlcjpwYXNz')).toBe(`Authorization: ${REDACTED}`);
    expect(redactText(`authorization: Bearer ${sessionId}`)).toBe(`authorization: ${REDACTED}`);
    expect(redactText('Cookie: sid=abc; other=1\nnext line')).toBe(`Cookie: ${REDACTED}\nnext line`);
  });

  it('masks basic credentials without a label, and leaves the word "Basic" in prose alone', () => {
    expect(redactText(`sent Basic ${basic} to the proxy`)).toBe(`sent ${REDACTED} to the proxy`);
    expect(redact(['Authorization', `Basic ${basic}`])).toEqual(['Authorization', REDACTED]);
    expect(redactText('Basic authenticationrequiredhere')).toBe('Basic authenticationrequiredhere');
  });

  it('masks a refresh token wherever it stands', () => {
    expect(redactText(`got ${refreshToken} from server`)).toBe(`got ${REDACTED} from server`);
  });

  it('masks a session id whose "!" is encoded for a URL', () => {
    const encoded = sessionId.replace('!', '%21');
    expect(redactText(`https://x.example/start?next=${encoded}&v=1`)).toBe(
      `https://x.example/start?next=${REDACTED}&v=1`,
    );
  });

  it('masks a session id of an org id in the 15 and in the 18 character form', () => {
    const tail = ['!', 'AQEAQ', 'y'.repeat(30)].join('');
    expect(redactText(`a 00D5g00000AbCdE${tail} b`)).toBe(`a ${REDACTED} b`);
    expect(redactText(`a 00D5g00000AbCdEFGH${tail} b`)).toBe(`a ${REDACTED} b`);
  });

  it('masks the user and password of a URL and keeps the host', () => {
    expect(redactText('fatal: https://x-access-token:made-up@git.example/o/r.git not found')).toBe(
      `fatal: https://${REDACTED}@git.example/o/r.git not found`,
    );
    expect(redactText('https://git.example:8443/o/r.git')).toBe('https://git.example:8443/o/r.git');
  });

  it.each([
    'access_token',
    'refresh_token',
    'id_token',
    'client_secret',
    'assertion',
    'password',
    'session_id',
    'sessionId',
    'sid',
    'token',
    'secret',
    'api_key',
    'x-api-key',
    'security_token',
    'consumer_secret',
    'refreshToken',
    'clientSecret',
    'privateKey',
    'passphrase',
    'pwd',
    'SF_CLIENT_SECRET',
    'MY_PASSWORD',
    'ORGLENS_SF_PRIVATE_KEY',
    'X-SFDC-Session',
  ])('masks the value behind the label %s', (label) => {
    expect(redactText(`a ${label}=made-up-1 b`)).toBe(`a ${label}=${REDACTED} b`);
    expect(redactText(`{"${label}":"made up, 2"}`)).toBe(`{"${label}":"${REDACTED}"}`);
    expect(redactText(`${label}: made-up-3`)).toBe(`${label}: ${REDACTED}`);
  });

  it('masks a quoted value up to its closing quote, also in JSON inside a JSON string', () => {
    expect(redactText('password: "correct horse made-up", user: "someone"')).toBe(
      `password: "${REDACTED}", user: "someone"`,
    );
    expect(redactText("password='a b' next")).toBe(`password='${REDACTED}' next`);
    expect(redactText('password: "never closed made-up\nnext line')).toBe(`password: "${REDACTED}\nnext line`);
    const inner = JSON.stringify({ refresh_token: 'made up 1', access_token: 'made-up-2', instance: 'x' });
    expect(redactText(JSON.stringify({ body: inner }))).toBe(
      String.raw`{"body":"{\"refresh_token\":\"${REDACTED}\",\"access_token\":\"${REDACTED}\",\"instance\":\"x\"}"}`,
    );
  });

  it('masks an unquoted value with all of its punctuation', () => {
    expect(redactText('password: abc,made-up;more next')).toBe(`password: ${REDACTED} next`);
  });

  it('masks the text of an XML element whose name says it holds a secret', () => {
    expect(redactText('<password>made up</password><clientSecret>x</clientSecret><name>kept</name>')).toBe(
      `<password>${REDACTED}</password><clientSecret>${REDACTED}</clientSecret><name>kept</name>`,
    );
  });

  it('finds a secret label inside the value of a harmless one', () => {
    expect(redactText('message="login failed: password=made-up"')).toBe(`message="login failed: password=${REDACTED}"`);
  });

  it('masks secrets passed as parameters, in a URL and in JSON text', () => {
    expect(redactText('https://login.example/token?grant_type=x&refresh_token=5Aep8abc&v=1')).toBe(
      `https://login.example/token?grant_type=x&refresh_token=${REDACTED}&v=1`,
    );
    expect(redactText('{"access_token":"abc123","instance_url":"https://acme.my.salesforce.example"}')).toBe(
      `{"access_token":"${REDACTED}","instance_url":"https://acme.my.salesforce.example"}`,
    );
    expect(redactText('password: hunter2, sid=abc; client_secret = xyz')).toBe(
      `password: ${REDACTED} sid=${REDACTED} client_secret = ${REDACTED}`,
    );
  });

  it('leaves ordinary text alone', () => {
    const harmless = [
      'Basic information about the bearer of this message',
      'Retrieved 1,204 components in 3 chunks (exit code=0)',
      'CustomField:account.industry is read by ApexClass:accountservice#method:run()',
      'org 00D5g00000AbCdE on https://acme.my.salesforce.example',
      'inside the side panel, considered valid',
      'NamedCredential:billing and ExternalCredential:erp are read by ApexClass:tokenservice#method:refreshtoken(string)',
      'ProfilePasswordPolicy:standard OauthTokenExchangeHandler:partner',
      'token_type=Bearer tokens: 12 key=CustomField:account.industry',
      'see https://docs.example/a/b?page=2 and https://docs.example:8443/c',
      '<fullName>Account.Industry</fullName>',
    ];
    for (const text of harmless) expect(redactText(text)).toBe(text);
  });

  it('changes nothing when applied twice', () => {
    const text = `a ${sessionId} b ${jwt} c ${authUrl} d Authorization: Bearer ${sessionId} e access_token=${sessionId}&x=1\n${pem}`;
    const once = redactText(text);
    expect(once).not.toContain('AQEAQ');
    expect(once).not.toContain('eyJ');
    expect(once).not.toContain('5Aep861');
    expect(once).not.toContain('TUlJRXZ');
    expect(redactText(once)).toBe(once);
  });

  it('stays fast on text built to slow a pattern down', () => {
    const hostile = [
      'eyJ'.repeat(60_000),
      'token'.repeat(40_000),
      'a_'.repeat(100_000),
      `${'a'.repeat(200_000)}=`,
      'x://'.repeat(50_000),
      '<a>'.repeat(60_000),
      `password="${'\\"'.repeat(50_000)}`,
    ];
    const started = performance.now();
    for (const text of hostile) redactText(text);
    // The whole list takes a few milliseconds. The limit only has to catch a pattern that went quadratic.
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('cuts a very long string, and never leaves half a token at the cut', () => {
    const long = `${'word '.repeat(4_000)}${sessionId.repeat(40)}`;
    const cut = redactText(long);
    expect(cut.length).toBeLessThan(17_000);
    expect(cut).toMatch(/\[cut, \d+ characters\]$/);
    expect(cut).not.toContain('AQEAQ');
    expect(redactText(cut)).toBe(cut);
  });
});

describe('redact', () => {
  it.each([
    'token',
    'secret',
    'password',
    'passwd',
    'passphrase',
    'authorization',
    'cookie',
    'sessionId',
    'session',
    'X-SFDC-Session',
    'apiKey',
    'api_key',
    'privateKey',
    'assertion',
    'credential',
    'credentials',
    'sfdxAuthUrl',
    'sid',
    'jwt',
    'pem',
    'pwd',
    'auth',
    'bearer',
  ])('masks a field named %s when it holds text or a structure', (name) => {
    expect(redact({ [name]: 'made up' })).toEqual({ [name]: REDACTED });
    expect(redact({ [name]: { inner: 'made up' } })).toEqual({ [name]: REDACTED });
    expect(redact({ [name]: ['made up'] })).toEqual({ [name]: REDACTED });
  });

  it('keeps the diagnostics of this product readable', () => {
    const diagnostics = {
      key: 'CustomField:account.industry',
      hasToken: false,
      tokens: 0,
      sessionCount: 3,
      byType: { NamedCredential: 3, ExternalCredential: 1, ProfilePasswordPolicy: 2, OauthTokenExchangeHandler: 0 },
      type: 'NamedCredential',
      inside: 'kept',
      authority: 'kept',
    };
    expect(redact(diagnostics)).toEqual(diagnostics);
  });

  it('treats a map with text keys as a record, and boxed values as what they hold', () => {
    expect(
      redact(
        new Map<string, unknown>([
          ['accessToken', 'made up'],
          ['count', 2],
        ]),
      ),
    ).toEqual({
      accessToken: REDACTED,
      count: 2,
    });
    expect(redact(new Map<unknown, unknown>([[1, sessionId]]))).toEqual([[1, REDACTED]]);
    // Boxed values are rare, and a boxed string must not be written one character per field.
    expect(redact({ note: new String(`x ${sessionId}`), n: new Number(4), b: new Boolean(true) })).toEqual({
      note: `x ${REDACTED}`,
      n: 4,
      b: true,
    });
  });

  it('never throws, whatever it is given', () => {
    const throwing = {
      get bad(): string {
        throw new Error('no');
      },
    };
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('no');
        },
      },
    );
    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(redact({ ok: 1, throwing, proxy, revoked })).toEqual({
      ok: 1,
      throwing: '[unreadable]',
      proxy: '[unreadable]',
      revoked: '[unreadable]',
    });
  });

  it('bounds the depth and the size of what it copies', () => {
    let deep: Record<string, unknown> = {};
    const top = deep;
    for (let level = 0; level < 5_000; level += 1) {
      const next: Record<string, unknown> = {};
      deep['next'] = next;
      deep = next;
    }
    expect(JSON.stringify(redact(top))).toContain('[too deep]');

    let chain = new Error('first');
    for (let link = 0; link < 20_000; link += 1) chain = new Error('next', { cause: chain });
    expect(JSON.stringify(redact(chain))).toContain('[too deep]');

    // 23 levels that each use the level below twice: more than eight million values if every one were copied.
    let shared: unknown = { leaf: 1 };
    for (let level = 0; level < 23; level += 1) shared = { a: shared, b: shared };
    const line = JSON.stringify(redact(shared));
    expect(line).toContain('[too large]');
    expect(line.length).toBeLessThan(1_000_000);
  });

  it('masks the name of an error as well', () => {
    const error = new Error('x');
    error.name = `Failure ${sessionId}`;
    expect((redact(error) as Record<string, unknown>)['name']).toBe(`Failure ${REDACTED}`);
  });

  it('masks fields whose name says they hold a secret, whatever the value', () => {
    expect(
      redact({
        accessToken: 'abc',
        refresh_token: 'def',
        'Client-Secret': 'ghi',
        password: 'jkl',
        Authorization: 'mno',
        privateKey: 'pqr',
        sid: 'stu',
        sfdxAuthUrl: 'vwx',
        jwt: 'yz',
        username: 'someone@example.com',
        inside: 'kept',
        keyFile: '/home/someone/server.key',
        tokenIsNull: null,
      }),
    ).toEqual({
      accessToken: REDACTED,
      refresh_token: REDACTED,
      'Client-Secret': REDACTED,
      password: REDACTED,
      Authorization: REDACTED,
      privateKey: REDACTED,
      sid: REDACTED,
      sfdxAuthUrl: REDACTED,
      jwt: REDACTED,
      username: 'someone@example.com',
      inside: 'kept',
      keyFile: '/home/someone/server.key',
      tokenIsNull: null,
    });
  });

  it('masks secrets in strings at any depth, and in arrays, maps and sets', () => {
    expect(
      redact({
        request: { url: `https://x.example/?sid=${sessionId}`, headers: [['x-note', `Bearer ${'t'.repeat(24)}`]] },
        seen: new Set([jwt]),
        byName: new Map([['a', { secret: 's' }]]),
      }),
    ).toEqual({
      request: { url: `https://x.example/?sid=${REDACTED}`, headers: [['x-note', REDACTED]] },
      seen: [REDACTED],
      byName: { a: { secret: REDACTED } },
    });
  });

  it('turns an error into a plain object with masked message, stack, fields and cause', () => {
    const cause = new Error(`login failed for ${sessionId}`);
    const error = Object.assign(new Error(`request with ${jwt} failed`, { cause }), {
      code: 'ERR_X',
      refreshToken: 'abc',
    });
    const safe = redact(error) as Record<string, unknown>;
    expect(safe['name']).toBe('Error');
    expect(safe['message']).toBe(`request with ${REDACTED} failed`);
    expect(safe['code']).toBe('ERR_X');
    expect(safe['refreshToken']).toBe(REDACTED);
    expect(safe['stack']).toEqual(expect.stringContaining('redact.test.ts'));
    expect(JSON.stringify(safe)).not.toContain('eyJ');
    expect(JSON.stringify(safe)).not.toContain('AQEAQ');
    expect((safe['cause'] as Record<string, unknown>)['message']).toBe(`login failed for ${REDACTED}`);
  });

  it('returns something JSON can always write', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    const value = {
      circular,
      big: 12345678901234567890n,
      when: new Date('2026-11-12T00:00:00Z'),
      never: new Date(Number.NaN),
      bytes: new Uint8Array(4),
      buffer: new ArrayBuffer(8),
      run: () => 1,
      mark: Symbol('m'),
      nothing: undefined,
      none: null,
      count: 3,
      ok: true,
    };
    expect(JSON.parse(JSON.stringify(redact(value)))).toEqual({
      circular: { name: 'loop', self: '[circular]' },
      big: '12345678901234567890',
      when: '2026-11-12T00:00:00.000Z',
      never: null,
      bytes: '[binary, 4 bytes]',
      buffer: '[binary, 8 bytes]',
      run: '[function]',
      mark: '[symbol]',
      none: null,
      count: 3,
      ok: true,
    });
  });

  it('does not treat a value that appears twice as a cycle', () => {
    const shared = { n: 1 };
    expect(redact({ a: shared, b: shared, list: [shared, shared] })).toEqual({
      a: { n: 1 },
      b: { n: 1 },
      list: [{ n: 1 }, { n: 1 }],
    });
  });

  it('does not change its input', () => {
    const input = { token: 'abc', nested: { message: `x ${jwt}` } };
    const copy = structuredClone(input);
    redact(input);
    expect(input).toEqual(copy);
  });
});
