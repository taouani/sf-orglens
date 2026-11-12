/**
 * A stand-in for a Salesforce org for the tests of the CLI: an HTTP server
 * on this machine that accepts a login with a key, lists API versions and
 * says who is logged in. Given Apex classes, it also answers the Metadata
 * API: it describes one type, lists the classes and hands them out in a
 * zip file. The tests of the engine have a larger one. A client may not
 * reach into the engine, and that holds for its tests too.
 */
import { createVerify } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32 } from 'node:zlib';

const NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

/** A zip file of the files, each stored as it is. Enough of the format for a reader to accept it. */
function zip(files: Readonly<Record<string, string>>): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path, 'utf8');
    const data = Buffer.from(text, 'utf8');
    // The fields both headers share: version, flags, method, time, date, checksum, both sizes, length of the name.
    const shared = Buffer.alloc(26);
    shared.writeUInt16LE(20, 0);
    shared.writeUInt16LE(0x21, 8);
    shared.writeUInt32LE(crc32(data), 10);
    shared.writeUInt32LE(data.length, 14);
    shared.writeUInt32LE(data.length, 18);
    shared.writeUInt16LE(name.length, 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), shared, name, data]);
    // The rest of an entry of the directory: five fields left at zero, then where the file starts.
    const entry = Buffer.alloc(14);
    entry.writeUInt32LE(offset, 10);
    directory.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), shared, entry, name]));
    parts.push(local);
    offset += local.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(directory.length, 8);
  end.writeUInt16LE(directory.length, 10);
  end.writeUInt32LE(Buffer.concat(directory).length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

const soap = (inner: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="${NAMESPACE}"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;

const fault = (code: string, message: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="${NAMESPACE}"><soapenv:Body><soapenv:Fault><faultcode>sf:${code}</faultcode><faultstring>${code}: ${message}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

const CLASS_META = `<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="${NAMESPACE}">\n    <apiVersion>66.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n`;

export interface MockOrg {
  /** Scheme, host and port. */
  readonly url: string;
  readonly orgId: string;
  /** The paths that were asked for. */
  readonly paths: string[];
  /** If set, every login is refused, and this is what the org says about it. */
  refusal: string | null;
  /** The Apex classes the org holds, by name, with their source. `null`: the org does not answer the Metadata API. */
  classes: Record<string, string> | null;
  /** Classes the org lists and does not hand out. */
  withheld: string[];
  /** Classes the org does not list and hands out with every retrieve. */
  unlisted: string[];
  /** If set, a retrieve is refused with this code. */
  retrieveFault: string | null;
  /** The operations of the Metadata API that were asked for. */
  readonly operations: string[];
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
    classes: null,
    withheld: [],
    unlisted: [],
    retrieveFault: null,
    operations: [],
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
  /** Answers one request to the Metadata API. */
  const metadata = (body: string, classes: Readonly<Record<string, string>>): { status: number; body: string } => {
    if (!body.includes('<sessionId>the-session</sessionId>')) {
      return { status: 500, body: fault('INVALID_SESSION_ID', 'Invalid Session ID found in SessionHeader') };
    }
    const operation = /<soapenv:Body[^>]*>\s*<(\w+)/.exec(body)?.[1] ?? '';
    org.operations.push(operation);
    const names = Object.keys(classes).sort();
    if (operation === 'describeMetadata') {
      return {
        status: 200,
        body: soap(
          '<describeMetadataResponse><result><metadataObjects><directoryName>classes</directoryName><inFolder>false</inFolder>' +
            '<metaFile>true</metaFile><suffix>cls</suffix><xmlName>ApexClass</xmlName></metadataObjects>' +
            '<organizationNamespace></organizationNamespace><partialSaveAllowed>true</partialSaveAllowed>' +
            '<testRequired>false</testRequired></result></describeMetadataResponse>',
        ),
      };
    }
    if (operation === 'listMetadata') {
      const results = names
        .filter((name) => !org.unlisted.includes(name))
        .map(
          (name, index) =>
            `<result><fileName>classes/${name}.cls</fileName><fullName>${name}</fullName><id>01pxx${String(index).padStart(10, '0')}AAA</id>` +
            `<lastModifiedDate>2026-02-01T08:30:00.000Z</lastModifiedDate><manageableState>unmanaged</manageableState><type>ApexClass</type></result>`,
        );
      return { status: 200, body: soap(`<listMetadataResponse>${results.join('')}</listMetadataResponse>`) };
    }
    if (operation === 'retrieve') {
      if (org.retrieveFault !== null) return { status: 500, body: fault(org.retrieveFault, 'The org is busy') };
      return {
        status: 200,
        body: soap(
          '<retrieveResponse><result><done>false</done><id>09Sxx0000000001AAA</id><state>Queued</state></result></retrieveResponse>',
        ),
      };
    }
    if (operation === 'checkRetrieveStatus') {
      const files: Record<string, string> = { 'unpackaged/package.xml': `<Package xmlns="${NAMESPACE}"/>` };
      for (const name of names.filter((one) => !org.withheld.includes(one))) {
        files[`unpackaged/classes/${name}.cls`] = classes[name] ?? '';
        files[`unpackaged/classes/${name}.cls-meta.xml`] = CLASS_META;
      }
      const messages = org.withheld.map(
        (name) =>
          `<messages><fileName>unpackaged/package.xml</fileName><problem>Entity of type 'ApexClass' named '${name}' cannot be found</problem></messages>`,
      );
      const file = body.includes('<includeZip>true</includeZip>')
        ? `<zipFile>${zip(files).toString('base64')}</zipFile>`
        : '';
      return {
        status: 200,
        body: soap(
          `<checkRetrieveStatusResponse><result><done>true</done><id>09Sxx0000000001AAA</id>${messages.join('')}` +
            `<status>Succeeded</status><success>true</success>${file}</result></checkRetrieveStatusResponse>`,
        ),
      };
    }
    return { status: 500, body: fault('UNKNOWN_EXCEPTION', `The mock org does not know the operation ${operation}`) };
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
      if (path.startsWith('/services/Soap/m/') && org.classes !== null) {
        const answered = metadata(Buffer.concat(chunks).toString('utf8'), org.classes);
        outgoing.writeHead(answered.status, { 'content-type': 'text/xml' });
        outgoing.end(answered.body);
        return;
      }
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
