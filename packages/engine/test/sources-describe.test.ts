/**
 * The descriptions of the objects of an org, read through its REST API (`sources/describe.ts`, decision record
 * 0085), against a mock org on this machine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource } from '../src/core/config/config.ts';
import {
  describeAddress,
  describeLimits,
  describeObjects,
  type DescribeOptions,
  type DescriptionReading,
} from '../src/sources/describe.ts';
import { connectToOrg } from '../src/sources/org.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';

const ORG_ID = '00Dxx0000000001EAA';
const source: OrgSource = {
  name: 'prod',
  kind: 'org',
  description: null,
  orgId: ORG_ID,
  loginUrl: null,
  excludeTypes: [],
};
const FAST = { requestMs: 2_000, repeats: 1, repeatAfterMs: 10 };
const ADDRESS = /^\/services\/data\/v\d+\.\d\/sobjects\/([^/]+)\/describe$/;

/**
 * Descriptions as the REST API gives them, with what the engine drops: labels, the values of picklists, and a child
 * relationship without a name. The fields and the child relationships are out of order, and so are the objects of a
 * polymorphic lookup.
 */
const ANSWERS: Readonly<Record<string, unknown>> = {
  Parcel__c: {
    name: 'Parcel__c',
    label: 'Parcel',
    custom: true,
    fields: [
      {
        name: 'Weight__c',
        type: 'double',
        label: 'Weight',
        referenceTo: [],
        relationshipName: null,
        picklistValues: [],
      },
      {
        name: 'Depot__c',
        type: 'reference',
        label: 'Depot',
        referenceTo: ['Depot__c'],
        relationshipName: 'Depot__r',
        inlineHelpText: 'Where the parcel waits.',
      },
      { name: 'Id', type: 'id', label: 'Record ID', referenceTo: [], relationshipName: null },
      {
        name: 'Kind__c',
        type: 'picklist',
        label: 'Kind',
        referenceTo: [],
        relationshipName: null,
        picklistValues: [{ value: 'Box', label: 'Box', active: true }],
      },
    ],
    childRelationships: [
      { relationshipName: 'Scans__r', childSObject: 'Scan__c', field: 'Parcel__c', cascadeDelete: true },
      { relationshipName: null, childSObject: 'ParcelHistory', field: 'ParentId', cascadeDelete: true },
      { relationshipName: 'Histories', childSObject: 'Parcel__History', field: 'ParentId', cascadeDelete: true },
    ],
  },
  Task: {
    name: 'Task',
    fields: [
      { name: 'WhatId', type: 'reference', referenceTo: ['Opportunity', 'Account'], relationshipName: 'What' },
      { name: 'Subject', type: 'combobox', referenceTo: [], relationshipName: null },
    ],
    childRelationships: [],
  },
};

let mock: MockOrg;

/** Asks the mock org to describe `objects`. Its answers are those of `ANSWERS`, unless a test intercepts them. */
async function read(objects: readonly string[], options: DescribeOptions = {}): Promise<DescriptionReading> {
  await seedCliLogin({ username: 'dev@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'the-session' });
  mock.sessions.add('the-session');
  const session = await connectToOrg(source, undefined, {});
  mock.requests.length = 0;
  return describeObjects(session, objects, { ...options, limits: { ...FAST, ...options.limits } });
}

/** The objects the mock org was asked to describe, in the order of the requests. */
const asked = (): string[] =>
  mock.requests.flatMap((request) => {
    const object = ADDRESS.exec(request.path)?.[1];
    return object === undefined ? [] : [object];
  });

beforeAll(async () => {
  mock = await startMockOrg({ versions: ['65.0', '66.0'] });
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.intercept = null;
  mock.stall = false;
  await forgetCliLogins();
});

/**
 * Answers the descriptions of `ANSWERS`, and a 404 for any other object, as an org does. A request with a session
 * the org does not accept is left to the mock org, which refuses it.
 */
const answering = (): void => {
  mock.intercept = (request) => {
    const object = ADDRESS.exec(request.path)?.[1];
    if (object === undefined || !mock.sessions.has(request.session ?? '')) return undefined;
    const answer = ANSWERS[object];
    return answer === undefined
      ? {
          status: 404,
          body: JSON.stringify([{ errorCode: 'NOT_FOUND', message: 'The requested resource does not exist' }]),
        }
      : { status: 200, body: JSON.stringify(answer) };
  };
};

describe('reading the descriptions of objects', () => {
  it('asks once for each object, at the address of its description, and keeps only what the resolver reads', async () => {
    answering();
    const progress: string[] = [];
    const reading = await read(['Parcel__c', 'Task', 'Parcel__c'], {
      onProgress: (done, total) => progress.push(`${String(done)}/${String(total)}`),
    });
    expect(reading).toEqual({
      descriptions: [
        {
          name: 'Parcel__c',
          // Sorted by name, without labels, help texts and the values of picklists.
          fields: [
            { name: 'Depot__c', type: 'reference', referenceTo: ['Depot__c'], relationshipName: 'Depot__r' },
            { name: 'Id', type: 'id', referenceTo: [], relationshipName: null },
            { name: 'Kind__c', type: 'picklist', referenceTo: [], relationshipName: null },
            { name: 'Weight__c', type: 'double', referenceTo: [], relationshipName: null },
          ],
          // Those with a name, sorted by it.
          childRelationships: [
            { relationshipName: 'Histories', childSObject: 'Parcel__History', field: 'ParentId' },
            { relationshipName: 'Scans__r', childSObject: 'Scan__c', field: 'Parcel__c' },
          ],
        },
        {
          name: 'Task',
          fields: [
            { name: 'Subject', type: 'combobox', referenceTo: [], relationshipName: null },
            // The objects of a polymorphic lookup, sorted.
            { name: 'WhatId', type: 'reference', referenceTo: ['Account', 'Opportunity'], relationshipName: 'What' },
          ],
          childRelationships: [],
        },
      ],
      state: 'whole',
      requests: 2,
      unknown: [],
      failed: [],
      code: null,
    });
    // An object that is named twice is asked for once.
    expect(asked().sort()).toEqual(['Parcel__c', 'Task']);
    expect(progress).toEqual(['1/2', '2/2']);
    // Nothing else is asked, and nothing is written: every request is a GET of the address of a description.
    expect(new Set(mock.asked())).toEqual(
      new Set([
        'GET /services/data/v66.0/sobjects/Parcel__c/describe',
        'GET /services/data/v66.0/sobjects/Task/describe',
      ]),
    );
    expect(describeAddress('66.0', 'Parcel__c')).toBe('/services/data/v66.0/sobjects/Parcel__c/describe');
  });

  it('asks with the version it is given, and makes no request for no object', async () => {
    answering();
    expect((await read(['Task'], { apiVersion: '65.0' })).state).toBe('whole');
    expect(mock.asked()).toEqual(['GET /services/data/v65.0/sobjects/Task/describe']);

    expect(await read([])).toEqual({
      descriptions: [],
      state: 'whole',
      requests: 0,
      unknown: [],
      failed: [],
      code: null,
    });
    expect(mock.asked()).toEqual([]);
  });

  it('says which objects the org does not know, and that none is described where it knows none', async () => {
    answering();
    const reading = await read(['Missing__c', 'Parcel__c', 'Gone__c']);
    expect(reading).toMatchObject({ state: 'partial', unknown: ['Missing__c', 'Gone__c'], failed: [], code: null });
    expect(reading.descriptions.map((one) => one.name)).toEqual(['Parcel__c']);

    expect(await read(['Missing__c'])).toMatchObject({ descriptions: [], state: 'none', unknown: ['Missing__c'] });
  });

  it('goes on after a request the org refuses, an answer that is no description and a name that is none', async () => {
    answering();
    const answer = mock.intercept;
    mock.intercept = (request) =>
      request.path.endsWith('/sobjects/Refused__c/describe')
        ? { status: 400, body: JSON.stringify([{ errorCode: 'INVALID_TYPE', message: 'No such column.' }]) }
        : request.path.endsWith('/sobjects/Odd__c/describe')
          ? { status: 200, body: JSON.stringify({ name: 'Odd__c', fields: [{ name: 'Id' }] }) }
          : answer?.(request);
    const reading = await read(['Refused__c', 'Odd__c', 'Not a name', 'Parcel__c'], { limits: { parallel: 1 } });
    expect(reading).toMatchObject({
      state: 'partial',
      unknown: [],
      failed: ['Refused__c', 'Odd__c', 'Not a name'],
      // The code of the first failure.
      code: 'INVALID_TYPE',
      requests: 3,
    });
    expect(reading.descriptions.map((one) => one.name)).toEqual(['Parcel__c']);
    // A name that cannot be one of an object is not sent.
    expect(asked()).toEqual(['Refused__c', 'Odd__c', 'Parcel__c']);

    mock.intercept = (request) =>
      ADDRESS.test(request.path) ? { status: 200, body: JSON.stringify([1, 2]) } : undefined;
    expect(await read(['Task'])).toMatchObject({ state: 'none', failed: ['Task'], code: 'NOT_A_DESCRIPTION' });
    expect(await read(['Task?x=1'])).toMatchObject({ state: 'none', failed: ['Task?x=1'], code: 'INVALID_NAME' });
  });

  it('stops without failing when the org no longer accepts the session', async () => {
    answering();
    const answer = mock.intercept;
    let answered = 0;
    mock.intercept = (request) => {
      if (ADDRESS.test(request.path)) {
        answered += 1;
        if (answered === 2) mock.sessions.clear();
      }
      return answer?.(request);
    };
    const reading = await read(['Parcel__c', 'Task', 'A__c', 'B__c'], { limits: { parallel: 1 } });
    expect(reading).toMatchObject({ state: 'partial', unknown: [], failed: ['Task', 'A__c', 'B__c'] });
    expect(reading.code).toBe('INVALID_SESSION_ID');
    // No request after the one that was refused for the session. The Salesforce library tried to renew it once.
    expect(asked()).toEqual(['Parcel__c', 'Task']);
  });

  it('stops without failing when the org does not answer, after asking again', async () => {
    mock.intercept = (request) =>
      ADDRESS.test(request.path) ? { status: 200, body: '{"name": "Task", "fields": [', halfway: 'stall' } : undefined;
    const reading = await read(['Task', 'Parcel__c', 'A__c'], {
      limits: { requestMs: 200, repeats: 1, parallel: 1 },
    });
    expect(reading).toEqual({
      descriptions: [],
      state: 'none',
      // The first object was asked for twice, and the others not at all.
      requests: 2,
      unknown: [],
      failed: ['Task', 'Parcel__c', 'A__c'],
      code: 'TIMEOUT',
    });
    expect(asked()).toEqual(['Task', 'Task']);
  });

  it('never follows a redirect', async () => {
    mock.intercept = (request) =>
      ADDRESS.test(request.path)
        ? { status: 302, body: '', headers: { location: 'http://127.0.0.1:9/elsewhere' } }
        : undefined;
    expect(await read(['Task'])).toMatchObject({ state: 'none', failed: ['Task'], code: 'REDIRECT' });
  });

  it('has at most as many requests under way as its limit says', async () => {
    let underWay = 0;
    let most = 0;
    mock.intercept = async (request) => {
      const object = ADDRESS.exec(request.path)?.[1];
      if (object === undefined) return undefined;
      underWay += 1;
      most = Math.max(most, underWay);
      await new Promise((resolve) => setTimeout(resolve, 30));
      underWay -= 1;
      return { status: 200, body: JSON.stringify({ name: object, fields: [], childRelationships: [] }) };
    };
    const objects = Array.from({ length: 12 }, (_, at) => `Object_${String(at)}__c`);
    const reading = await read(objects);
    expect(reading.state).toBe('whole');
    // In the order they were asked for, whatever order the answers came in.
    expect(reading.descriptions.map((one) => one.name)).toEqual(objects);
    expect(most).toBe(describeLimits().parallel);
    expect(describeLimits()).toEqual({ requestMs: 60_000, repeats: 2, repeatAfterMs: 1_000, parallel: 4 });

    most = 0;
    await read(objects.slice(0, 4), { limits: { parallel: 1 } });
    expect(most).toBe(1);
  });
});
