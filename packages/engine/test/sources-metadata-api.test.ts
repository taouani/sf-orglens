import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource } from '../src/core/config/config.ts';
import { isAboutTheOrg, metadataApi, MetadataRequestError, type MetadataApi } from '../src/sources/metadata-api.ts';
import { connectToOrg } from '../src/sources/org.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { metadataFromSource, soapFault } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/billing-sfdx/force-app');
const ORG_ID = '00Dxx0000000001EAA';
const source: OrgSource = { name: 'prod', kind: 'org', description: null, orgId: ORG_ID, loginUrl: null };
const FAST = { requestMs: 2_000, zipMs: 2_000, repeats: 1, repeatAfterMs: 10 };

let mock: MockOrg;
const opened: MetadataApi[] = [];

async function api(limits = FAST): Promise<MetadataApi> {
  await seedCliLogin({ username: 'dev@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'the-session' });
  mock.sessions.add('the-session');
  const session = await connectToOrg(source, undefined, {});
  const one = await metadataApi(session.connection, session.apiVersion, limits);
  opened.push(one);
  return one;
}

async function failure(work: () => Promise<unknown>): Promise<MetadataRequestError> {
  try {
    await work();
  } catch (error) {
    if (error instanceof MetadataRequestError) return error;
    throw error;
  }
  throw new Error('Expected a failure.');
}

beforeAll(async () => {
  mock = await startMockOrg({ versions: ['65.0', '66.0'] });
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  await Promise.all(opened.splice(0).map((one) => one.close()));
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.intercept = null;
  mock.metadata = null;
  await forgetCliLogins();
});

describe('the requests to the Metadata API', () => {
  it('asks which types the org has, with the parts of each', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    mock.metadata.emptyTypes.push('Report');
    const metadata = await api();
    expect(metadata.apiVersion).toBe('66.0');
    const types = await metadata.describe();
    expect(types.map((type) => type.name).sort()).toEqual(['ApexClass', 'ApexTrigger', 'CustomObject', 'Report']);
    expect(types.find((type) => type.name === 'CustomObject')?.children).toContain('CustomField');
    expect(types.find((type) => type.name === 'Report')?.inFolder).toBe(true);
    expect(types.find((type) => type.name === 'ApexClass')).toEqual({
      name: 'ApexClass',
      inFolder: false,
      children: [],
    });
    expect(mock.requests.at(-1)?.path).toBe('/services/Soap/m/66.0');
  });

  it('lists the components of a type as the org states them', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    const triggers = await metadata.list('ApexTrigger');
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      type: 'ApexTrigger',
      fullName: 'InvoiceTrigger',
      namespacePrefix: null,
      manageableState: 'unmanaged',
    });
    expect(triggers[0]?.id).toMatch(/^0A/);
    expect(triggers[0]?.lastModifiedAt).toMatch(/^2026-02-0\dT08:30:00\.000Z$/);
    const fields = await metadata.list('CustomField');
    expect(fields.map((field) => field.fullName)).toContain('Invoice__c.Amount__c');
    expect(await metadata.list('Report')).toEqual([]);
  });

  it('says that the org refused, with the code of the org', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    mock.metadata.failing.add('ApexClass');
    const metadata = await api();
    const error = await failure(() => metadata.list('ApexClass'));
    expect(error).toMatchObject({ kind: 'refused', code: 'INVALID_TYPE' });
    // The org begins its sentence with the code. The code is said once, in its own field.
    expect(error.message).toBe('Cannot use: ApexClass in this organization');
  });

  it('says that the session is not accepted', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    mock.sessions.clear();
    expect(await failure(() => metadata.describe())).toMatchObject({ kind: 'session', code: 'INVALID_SESSION_ID' });
  });

  it('starts a retrieve of named members and reads its state, with and without the zip file', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    const id = await metadata.startRetrieve([
      { type: 'ApexTrigger', fullName: 'InvoiceTrigger' },
      { type: 'CustomObject', fullName: 'Invoice__c' },
      { type: 'CustomObject', fullName: 'Gone__c' },
    ]);
    expect(id).toMatch(/^09S/);
    expect(mock.metadata.retrieves).toEqual([
      ['ApexTrigger:InvoiceTrigger', 'CustomObject:Invoice__c', 'CustomObject:Gone__c'],
    ]);
    expect(await metadata.retrieveState(id, false)).toMatchObject({ done: false, status: 'InProgress', zip: null });
    const done = await metadata.retrieveState(id, false);
    expect(done).toMatchObject({ done: true, status: 'Succeeded', succeeded: true, zip: null, errorCode: null });
    expect(done.problems).toEqual(["Entity of type 'CustomObject' named 'Gone__c' cannot be found"]);
    const withZip = await metadata.retrieveState(id, true);
    // A zip file starts with the letters PK.
    expect(
      Buffer.from(withZip.zip ?? [])
        .subarray(0, 2)
        .toString('latin1'),
    ).toBe('PK');
  });

  it('reports a retrieve that Salesforce failed, with its code', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    mock.metadata.maxFiles = 1;
    mock.metadata.pollsBeforeDone = 0;
    const metadata = await api();
    const id = await metadata.startRetrieve([
      { type: 'ApexTrigger', fullName: 'InvoiceTrigger' },
      { type: 'CustomObject', fullName: 'Invoice__c' },
    ]);
    const state = await metadata.retrieveState(id, false);
    expect(state).toMatchObject({ done: true, status: 'Failed', succeeded: false, errorCode: 'LIMIT_EXCEEDED' });
    expect(state.errorMessage).toContain('Too many files');
  });

  it('follows no redirect: the session goes to the org and nowhere else', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    const before = mock.requests.length;
    mock.intercept = (request) =>
      request.path.startsWith('/services/Soap/')
        ? { status: 302, body: '', type: 'text/plain', headers: { location: `${mock.url}/elsewhere` } }
        : undefined;
    expect(await failure(() => metadata.describe())).toMatchObject({ kind: 'refused', code: 'REDIRECT' });
    expect(mock.requests.slice(before).map((request) => request.path)).toEqual(['/services/Soap/m/66.0']);
  });

  it('gives up on a request that gets no answer in time, after asking once more', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    const before = mock.requests.length;
    mock.stall = true;
    try {
      expect(await failure(() => metadata.list('ApexClass'))).toMatchObject({ kind: 'unreachable', code: 'TIMEOUT' });
    } finally {
      mock.stall = false;
    }
    expect(mock.requests.slice(before)).toHaveLength(2);
  }, 20_000);

  it('limits the time of the whole answer, not only the time until it starts', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api({ requestMs: 300, zipMs: 300, repeats: 0, repeatAfterMs: 10 });
    const { metadata: held } = mock;
    // The org starts its answer at once and never ends it.
    mock.intercept = async (request) =>
      request.path.startsWith('/services/Soap/')
        ? { ...(await held.answer(request.body)), halfway: 'stall' }
        : undefined;
    const started = Date.now();
    expect(await failure(() => metadata.describe())).toMatchObject({ kind: 'unreachable', code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  it('reports a connection that is cut in the middle of an answer, after asking once more', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    const { metadata: held } = mock;
    const before = mock.requests.length;
    mock.intercept = async (request) =>
      request.path.startsWith('/services/Soap/') ? { ...(await held.answer(request.body)), halfway: 'cut' } : undefined;
    const error = await failure(() => metadata.list('ApexClass'));
    expect(error.kind).toBe('unreachable');
    // The code is the one of the system or of the HTTP client, which differs between systems.
    expect(error.code).toMatch(/^[A-Z_]+$/);
    expect(mock.requests.slice(before)).toHaveLength(2);

    // The next request is answered: nothing of the cut one is left behind.
    mock.intercept = null;
    expect(await metadata.list('ApexTrigger')).toHaveLength(1);
  });

  it('takes the answer of a gateway for an org that is not there, and asks again', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api();
    const before = mock.requests.length;
    let answers = 0;
    mock.intercept = (request) => {
      if (!request.path.startsWith('/services/Soap/')) return undefined;
      answers += 1;
      return answers === 1
        ? { status: 503, type: 'text/html', body: '<html><body>Service Unavailable</body></html>' }
        : undefined;
    };
    expect(await metadata.list('ApexTrigger')).toHaveLength(1);
    expect(mock.requests.slice(before)).toHaveLength(2);

    mock.intercept = (request) =>
      request.path.startsWith('/services/Soap/')
        ? { status: 503, type: 'text/html', body: '<html><body>Service Unavailable</body></html>' }
        : undefined;
    expect(await failure(() => metadata.list('ApexTrigger'))).toMatchObject({
      kind: 'unreachable',
      code: 'HTTP_503',
      message: 'The org could not be reached (HTTP_503).',
    });
  });

  it('tells a refusal that holds for the whole org from one that is about what was asked for', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    mock.metadata.failing.add('ApexClass');
    const metadata = await api();
    expect(isAboutTheOrg(await failure(() => metadata.list('ApexClass')))).toBe(false);

    mock.intercept = (request) =>
      request.path.startsWith('/services/Soap/')
        ? soapFault('REQUEST_LIMIT_EXCEEDED', 'TotalRequests Limit exceeded.')
        : undefined;
    const limit = await failure(() => metadata.list('ApexTrigger'));
    expect(limit).toMatchObject({
      kind: 'refused',
      code: 'REQUEST_LIMIT_EXCEEDED',
      message: 'TotalRequests Limit exceeded.',
    });
    expect(isAboutTheOrg(limit)).toBe(true);
    // The org is not asked again: it has answered.
    expect(mock.requests.filter((request) => request.path.startsWith('/services/Soap/'))).toHaveLength(2);
  });

  it('ends a request that is under way when it is closed, and makes no further one', async () => {
    mock.metadata = await metadataFromSource(FIXTURE);
    const metadata = await api({ requestMs: 10_000, zipMs: 10_000, repeats: 0, repeatAfterMs: 10 });
    mock.stall = true;
    try {
      const underWay = failure(() => metadata.list('ApexClass'));
      while (!mock.requests.some((request) => request.path.startsWith('/services/Soap/'))) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await metadata.close();
      expect((await underWay).kind).toBe('unreachable');
    } finally {
      mock.stall = false;
    }
    const asked = mock.requests.length;
    expect(await failure(() => metadata.describe())).toMatchObject({ kind: 'unreachable', code: 'CLOSED' });
    expect(mock.requests).toHaveLength(asked);
  });
});
