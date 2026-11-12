/**
 * A stand-in for a Salesforce org: a small HTTP server on this machine that
 * answers the few requests a login and an identity check make.
 *
 * It issues sessions for a login with a key (it checks the signature, the
 * audience, the app and the user, as Salesforce does) and for a refresh
 * token, lists API versions, and says who is logged in. It knows no
 * metadata. Every request is recorded, so a test can say what was asked.
 */
import { createVerify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

interface MockRequest {
  readonly method: string;
  readonly path: string;
  /** The session the request was made with, or `null`. */
  readonly session: string | null;
  readonly form: URLSearchParams;
}

interface MockAnswer {
  readonly status: number;
  readonly body: string;
  readonly type?: string;
}

export interface MockOrg {
  /** Scheme, host and port. */
  readonly url: string;
  /** The id of the org, with 18 characters. */
  readonly orgId: string;
  readonly requests: MockRequest[];
  /** The sessions the org accepts. A test adds the session of a login it has seeded, and removes one to let it expire. */
  readonly sessions: Set<string>;
  /** The refresh tokens the org accepts. */
  readonly refreshTokens: Set<string>;
  /** The login with a key the org accepts. `null`: none. */
  key: {
    readonly username: string;
    readonly clientId: string;
    readonly publicKey: string;
    /** The audiences the org accepts. Default: its own address. */
    readonly audiences?: readonly string[];
  } | null;
  /** Set by a test to answer a request in another way. Returning `undefined` leaves the request to the org. */
  intercept: ((request: MockRequest) => MockAnswer | undefined) | null;
  /** The requests so far as `METHOD path`, without the ones for the list of versions. */
  asked(): string[];
  close(): Promise<void>;
}

const json = (value: unknown, status = 200): MockAnswer => ({ status, body: JSON.stringify(value) });
const refused = (description: string): MockAnswer =>
  json({ error: 'invalid_grant', error_description: description }, 400);

export async function startMockOrg(options: { orgId?: string; versions?: readonly string[] } = {}): Promise<MockOrg> {
  const orgId = options.orgId ?? '00Dxx0000000001EAA';
  const userId = '005xx000000001AAAA';
  const versions = options.versions ?? ['65.0', '66.0', '9.0'];
  let issued = 0;
  let url = '';

  const session = (scope: string): MockAnswer => {
    issued += 1;
    const accessToken = `session-${String(issued)}`;
    org.sessions.add(accessToken);
    return json({
      access_token: accessToken,
      instance_url: url,
      id: `${url}/id/${orgId}/${userId}`,
      token_type: 'Bearer',
      scope,
    });
  };

  const token = (form: URLSearchParams): MockAnswer => {
    if (form.get('grant_type') === 'refresh_token') {
      return org.refreshTokens.has(form.get('refresh_token') ?? '')
        ? session('api refresh_token')
        : refused('expired access/refresh token');
    }
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      return json({ error: 'unsupported_grant_type', error_description: 'grant type not supported' }, 400);
    }
    const [head = '', claims = '', signature = ''] = (form.get('assertion') ?? '').split('.');
    const { key } = org;
    if (key === null) return json({ error: 'invalid_client_id', error_description: 'client identifier invalid' }, 400);
    let said: { iss?: unknown; sub?: unknown; aud?: unknown; exp?: unknown };
    try {
      said = JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as typeof said;
    } catch {
      return refused('invalid assertion');
    }
    if (said.iss !== key.clientId) {
      return json({ error: 'invalid_client_id', error_description: 'client identifier invalid' }, 400);
    }
    if (!createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(key.publicKey, signature, 'base64url')) {
      return refused('invalid assertion');
    }
    if (!(key.audiences ?? [url]).includes(String(said.aud))) return refused('audience is invalid');
    if (typeof said.exp !== 'number' || said.exp * 1000 <= Date.now()) return refused('expired authorization code');
    if (said.sub !== key.username) return refused("user hasn't approved this consumer");
    return session('api');
  };

  const answer = (request: MockRequest): MockAnswer => {
    const intercepted = org.intercept?.(request);
    if (intercepted !== undefined) return intercepted;
    if (request.path === '/services/oauth2/token' && request.method === 'POST') return token(request.form);
    if (request.path === '/services/data' || request.path === '/services/data/') {
      return json(
        versions.map((version) => ({ label: `Release ${version}`, url: `/services/data/v${version}`, version })),
      );
    }
    if (request.session === null || !org.sessions.has(request.session)) {
      return json([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }], 401);
    }
    if (/^\/services\/data\/v\d+\.\d\/?$/.test(request.path)) {
      return json({ identity: `${url}/id/${orgId}/${userId}`, metadata: `${request.path}/metadata` });
    }
    // After it has renewed a session, the Salesforce library itself asks the org about the org.
    if (/\/query\/?$/.test(request.path)) {
      return json({
        totalSize: 1,
        done: true,
        records: [
          {
            attributes: { type: 'Organization' },
            Name: 'Mock Org',
            InstanceName: 'MOCK',
            IsSandbox: false,
            TrialExpirationDate: null,
            NamespacePrefix: null,
            OrganizationType: 'Developer Edition',
          },
        ],
      });
    }
    return json([{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }], 404);
  };

  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const address = new URL(incoming.url ?? '/', url);
      const request: MockRequest = {
        method: incoming.method ?? '',
        path: address.pathname,
        session: /^Bearer (.+)$/.exec(incoming.headers.authorization ?? '')?.[1] ?? null,
        form: new URLSearchParams(Buffer.concat(chunks).toString('utf8')),
      };
      org.requests.push(request);
      const { status, body, type } = answer(request);
      outgoing.writeHead(status, { 'content-type': type ?? 'application/json' });
      outgoing.end(body);
    });
  });

  const org: MockOrg = {
    get url() {
      return url;
    },
    orgId,
    requests: [],
    sessions: new Set(),
    refreshTokens: new Set(),
    key: null,
    intercept: null,
    asked: () =>
      org.requests
        .filter((request) => !/^\/services\/data\/?$/.test(request.path))
        .map((request) => `${request.method} ${request.path}`),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return org;
}
