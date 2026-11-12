/**
 * A stand-in for a Salesforce org for the tests of the CLI: an HTTP server
 * on this machine that accepts a login with a key, lists API versions and
 * says who is logged in. The tests of the engine have a larger one. A
 * client may not reach into the engine, and that holds for its tests too.
 */
import { createVerify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockOrg {
  /** Scheme, host and port. */
  readonly url: string;
  readonly orgId: string;
  /** The paths that were asked for. */
  readonly paths: string[];
  /** If set, every login is refused, and this is what the org says about it. */
  refusal: string | null;
  close(): Promise<void>;
}

/** Starts an org that accepts a login signed with the private key of `publicKey`. */
export async function startMockOrg(publicKey: string): Promise<MockOrg> {
  const orgId = '00Dxx0000000001EAA';
  const paths: string[] = [];
  let url = '';
  const org: MockOrg = {
    url: '',
    orgId,
    paths,
    refusal: null,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const path = new URL(incoming.url ?? '/', url).pathname;
      paths.push(path);
      const answer = (status: number, value: unknown): void => {
        outgoing.writeHead(status, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify(value));
      };
      if (path === '/services/oauth2/token') {
        const assertion = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('assertion') ?? '';
        const [head = '', claims = '', signature = ''] = assertion.split('.');
        const signed = createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, signature, 'base64url');
        if (!signed || org.refusal !== null) {
          answer(400, { error: 'invalid_grant', error_description: org.refusal ?? 'invalid assertion' });
          return;
        }
        answer(200, { access_token: 'the-session', instance_url: url, id: `${url}/id/${orgId}/005xx000000001AAAA` });
      } else if (path === '/services/data') {
        answer(200, [{ version: '66.0', label: 'Release', url: '/services/data/v66.0' }]);
      } else if (path === '/services/data/v66.0/' && incoming.headers.authorization === 'Bearer the-session') {
        answer(200, { identity: `${url}/id/${orgId}/005xx000000001AAAA` });
      } else {
        answer(401, [{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }]);
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return Object.assign(org, { url });
}
