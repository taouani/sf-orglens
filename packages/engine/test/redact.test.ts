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
const authUrl = ['force', '://', 'PlatformCLI::', '5Aep861', 'x'.repeat(30), '@example.my.salesforce.com'].join('');

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
    expect(redactText('Authorization: Basic dXNlcjpwYXNz')).toBe(`Authorization: ${REDACTED}`);
    expect(redactText(`authorization: Bearer ${sessionId}`)).toBe(`authorization: ${REDACTED}`);
  });

  it('masks secrets passed as parameters, in a URL and in JSON text', () => {
    expect(redactText('https://login.example/token?grant_type=x&refresh_token=5Aep8abc&v=1')).toBe(
      `https://login.example/token?grant_type=x&refresh_token=${REDACTED}&v=1`,
    );
    expect(redactText('{"access_token":"abc123","instance_url":"https://example.my.salesforce.com"}')).toBe(
      `{"access_token":"${REDACTED}","instance_url":"https://example.my.salesforce.com"}`,
    );
    expect(redactText('password: hunter2, sid=abc; client_secret = xyz')).toBe(
      `password: ${REDACTED}, sid=${REDACTED}; client_secret = ${REDACTED}`,
    );
  });

  it('leaves ordinary text alone', () => {
    const harmless = [
      'Basic information about the bearer of this message',
      'Retrieved 1,204 components in 3 chunks (exit code=0)',
      'CustomField:account.industry is read by ApexClass:accountservice#method:run()',
      'org 00D5g00000AbCdE on https://example.my.salesforce.com',
      'inside the side panel, considered valid',
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
});

describe('redact', () => {
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
      byName: [['a', { secret: REDACTED }]],
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
