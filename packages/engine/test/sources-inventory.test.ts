import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource } from '../src/core/config/config.ts';
import { membersOf, planChunks, splitMembers } from '../src/sources/chunks.ts';
import { takeInventory, type Inventory } from '../src/sources/inventory.ts';
import {
  metadataApi,
  MetadataRequestError,
  type DescribedType,
  type ListedComponent,
  type MetadataApi,
} from '../src/sources/metadata-api.ts';
import { connectToOrg } from '../src/sources/org.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { metadataFromSource } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/billing-sfdx/force-app');

const type = (name: string, fields: Partial<DescribedType> = {}): DescribedType => ({
  name,
  inFolder: false,
  children: [],
  ...fields,
});

const item = (ofType: string, fullName: string): ListedComponent => ({
  type: ofType,
  fullName,
  id: null,
  lastModifiedAt: null,
  namespacePrefix: null,
  manageableState: null,
});

/** An org that describes the types and lists the names it is given, by type or by `Type/folder`. */
function fakeApi(
  described: readonly DescribedType[],
  listed: Readonly<Record<string, readonly string[] | MetadataRequestError>>,
): MetadataApi & { asked: string[] } {
  const asked: string[] = [];
  return {
    apiVersion: '66.0',
    asked,
    describe: () => Promise.resolve([...described]),
    list: (ofType, folder) => {
      const key = folder === undefined ? ofType : `${ofType}/${folder}`;
      asked.push(key);
      const answer = listed[key] ?? [];
      if (answer instanceof MetadataRequestError) return Promise.reject(answer);
      return Promise.resolve(answer.map((fullName) => item(ofType, fullName)));
    },
    startRetrieve: () => Promise.reject(new Error('not used')),
    retrieveState: () => Promise.reject(new Error('not used')),
  };
}

const names = (inventory: Inventory): string[] => inventory.items.map((one) => `${one.type}:${one.fullName}`);

describe('the inventory of an org', () => {
  it('lists every type the org describes, and the parts of a type as types of their own', async () => {
    const api = fakeApi([type('ApexClass'), type('CustomObject', { children: ['CustomField', 'ValidationRule'] })], {
      ApexClass: ['B', 'A'],
      CustomObject: ['Invoice__c'],
      CustomField: ['Invoice__c.Amount__c', 'Account.Tier__c'],
    });
    const inventory = await takeInventory(api);
    expect(inventory.types).toEqual([
      { type: 'ApexClass', role: 'top', of: null, listing: 'ok', reason: null },
      { type: 'CustomField', role: 'part', of: 'CustomObject', listing: 'ok', reason: null },
      { type: 'CustomObject', role: 'top', of: null, listing: 'ok', reason: null },
      { type: 'ValidationRule', role: 'part', of: 'CustomObject', listing: 'ok', reason: null },
    ]);
    expect(names(inventory)).toEqual([
      'ApexClass:A',
      'ApexClass:B',
      'CustomField:Account.Tier__c',
      'CustomField:Invoice__c.Amount__c',
      'CustomObject:Invoice__c',
    ]);
    expect(api.asked.sort()).toEqual(['ApexClass', 'CustomField', 'CustomObject', 'ValidationRule']);
    expect(inventory.requests).toBe(5);
  });

  it('records a type the org refuses to list as failed, with what the org said, and never as empty', async () => {
    const api = fakeApi([type('ApexClass'), type('Flow')], {
      ApexClass: ['A'],
      Flow: new MetadataRequestError('refused', 'INVALID_TYPE', 'Cannot use: Flow in this organization'),
    });
    const inventory = await takeInventory(api);
    expect(inventory.types).toEqual([
      { type: 'ApexClass', role: 'top', of: null, listing: 'ok', reason: null },
      {
        type: 'Flow',
        role: 'top',
        of: null,
        listing: 'failed',
        reason: 'INVALID_TYPE: Cannot use: Flow in this organization',
      },
    ]);
    expect(names(inventory)).toEqual(['ApexClass:A']);
  });

  it('lists the folders of a folder type, then each folder, and the folder for what is in none', async () => {
    const api = fakeApi([type('Report', { inFolder: true }), type('EmailTemplate', { inFolder: true })], {
      ReportFolder: ['Sales', 'Finance'],
      'Report/Sales': ['Sales/Pipeline'],
      'Report/Finance': ['Finance/Overdue'],
      'Report/unfiled$public': ['unfiled$public/Mine'],
      EmailFolder: ['Billing'],
      'EmailTemplate/Billing': ['Billing/Reminder'],
    });
    const inventory = await takeInventory(api);
    expect(api.asked.slice(0, 2).sort()).toEqual(['EmailFolder', 'ReportFolder']);
    expect(api.asked.slice(2).sort()).toEqual([
      'EmailTemplate/Billing',
      'EmailTemplate/unfiled$public',
      'Report/Finance',
      'Report/Sales',
      'Report/unfiled$public',
    ]);
    expect(inventory.types.map((one) => `${one.type} ${one.role} ${one.of ?? '-'}`)).toEqual([
      'EmailFolder folder EmailTemplate',
      'EmailTemplate top -',
      'Report top -',
      'ReportFolder folder Report',
    ]);
    expect(names(inventory)).toEqual([
      'EmailFolder:Billing',
      'EmailTemplate:Billing/Reminder',
      'Report:Finance/Overdue',
      'Report:Sales/Pipeline',
      'Report:unfiled$public/Mine',
      'ReportFolder:Finance',
      'ReportFolder:Sales',
    ]);
  });

  it('takes the type of the folders for a folder type also when the org describes it on its own', async () => {
    const api = fakeApi([type('ReportFolder'), type('Report', { inFolder: true })], {
      ReportFolder: ['Sales'],
      'Report/Sales': ['Sales/Pipeline'],
    });
    const inventory = await takeInventory(api);
    expect(inventory.types.map((one) => `${one.type} ${one.role} ${one.of ?? '-'}`)).toEqual([
      'Report top -',
      'ReportFolder folder Report',
    ]);
    expect(api.asked).toContain('Report/Sales');
    expect(names(inventory)).toContain('Report:Sales/Pipeline');
    // The folder is asked for under the type of what it holds.
    expect(membersOf(inventory).map(({ member }) => `${member.type}:${member.fullName}`)).toEqual([
      'Report:Sales',
      'Report:Sales/Pipeline',
    ]);
  });

  it('marks a folder type as failed if one of its folders or the list of its folders could not be read', async () => {
    const refused = new MetadataRequestError('refused', 'INSUFFICIENT_ACCESS', 'insufficient access rights');
    const one = await takeInventory(
      fakeApi([type('Report', { inFolder: true })], {
        ReportFolder: ['Sales', 'Finance'],
        'Report/Sales': ['Sales/Pipeline'],
        'Report/Finance': refused,
      }),
    );
    expect(one.types.find((entry) => entry.type === 'Report')).toMatchObject({
      listing: 'failed',
      reason: 'Folder Finance: INSUFFICIENT_ACCESS: insufficient access rights',
    });
    expect(names(one)).toContain('Report:Sales/Pipeline');

    const all = await takeInventory(fakeApi([type('Dashboard', { inFolder: true })], { DashboardFolder: refused }));
    expect(all.types.map((entry) => `${entry.type} ${entry.listing}`)).toEqual([
      'Dashboard failed',
      'DashboardFolder failed',
    ]);
    expect(all.types[0]?.reason).toBe(
      'Its folders could not be listed: INSUFFICIENT_ACCESS: insufficient access rights',
    );
  });

  it('does not ask for a type Salesforce never lists, and says so', async () => {
    const api = fakeApi([type('StandardValueSet')], {});
    const inventory = await takeInventory(api);
    expect(api.asked).toEqual([]);
    expect(inventory.types).toEqual([
      {
        type: 'StandardValueSet',
        role: 'top',
        of: null,
        listing: 'unlistable',
        reason: 'Salesforce does not list standard value sets. They are not read yet.',
      },
    ]);
  });

  it('gives up when the org cannot be reached or does not accept the session', async () => {
    for (const error of [
      new MetadataRequestError('unreachable', 'TIMEOUT', 'The org did not answer in time.'),
      new MetadataRequestError('session', 'INVALID_SESSION_ID', 'The org does not accept the session.'),
    ]) {
      const api = fakeApi(
        Array.from({ length: 30 }, (_, index) => type(`Type${String(index).padStart(2, '0')}`)),
        { Type03: error },
      );
      await expect(takeInventory(api, { concurrency: 2 })).rejects.toBe(error);
      // The listings that had not started are not started.
      expect(api.asked.length).toBeLessThan(10);
    }
  });

  it('reports its progress', async () => {
    const seen: string[] = [];
    await takeInventory(fakeApi([type('ApexClass'), type('Report', { inFolder: true })], { ReportFolder: ['Sales'] }), {
      concurrency: 1,
      onProgress: (done, total) => seen.push(`${String(done)}/${String(total)}`),
    });
    expect(seen).toEqual(['1/2', '2/2', '3/4', '4/4']);
  });
});

describe('the plan of a retrieve', () => {
  const inventory = (
    described: readonly DescribedType[],
    listed: Record<string, readonly string[]>,
  ): Promise<Inventory> => takeInventory(fakeApi(described, listed));

  it('names every component of a type that is retrieved by its own name, and no part', async () => {
    const plan = planChunks(
      await inventory([type('ApexClass'), type('CustomObject', { children: ['CustomField'] })], {
        ApexClass: ['B', 'A'],
        CustomObject: ['Invoice__c'],
        CustomField: ['Invoice__c.Amount__c'],
      }),
    );
    expect(plan).toEqual([
      [
        { type: 'ApexClass', fullName: 'A' },
        { type: 'ApexClass', fullName: 'B' },
        { type: 'CustomObject', fullName: 'Invoice__c' },
      ],
    ]);
  });

  it('names the parent of a part the org lists without its parent, such as a standard object', async () => {
    const members = membersOf(
      await inventory(
        [type('CustomObject', { children: ['CustomField'] }), type('CustomLabels', { children: ['CustomLabel'] })],
        {
          CustomObject: ['Invoice__c'],
          CustomField: ['Account.Tier__c', 'Account.Region__c', 'Invoice__c.Amount__c'],
          CustomLabels: ['CustomLabels'],
          CustomLabel: ['Greeting'],
        },
      ),
    );
    expect(members).toEqual([
      { member: { type: 'CustomLabels', fullName: 'CustomLabels' }, weight: 2 },
      { member: { type: 'CustomObject', fullName: 'Account' }, weight: 4 },
      { member: { type: 'CustomObject', fullName: 'Invoice__c' }, weight: 3 },
    ]);
  });

  it('names a folder under the type of what it holds', async () => {
    const members = membersOf(
      await inventory([type('Report', { inFolder: true })], {
        ReportFolder: ['Sales'],
        'Report/Sales': ['Sales/Pipeline'],
      }),
    );
    expect(members.map(({ member }) => `${member.type}:${member.fullName}`)).toEqual([
      'Report:Sales',
      'Report:Sales/Pipeline',
    ]);
  });

  it('fills a chunk up to the weight, in an order that is the same every time', async () => {
    const classes = Array.from({ length: 25 }, (_, index) => `C${String(index).padStart(2, '0')}`);
    const listed = await inventory([type('ApexClass'), type('StaticResource')], {
      ApexClass: classes,
      StaticResource: ['Big'],
    });
    const plan = planChunks(listed, 20);
    expect(plan.map((chunk) => chunk.length)).toEqual([10, 10, 5, 1]);
    expect(plan.flat().map((member) => member.fullName)).toEqual([...classes, 'Big']);
    expect(planChunks(listed, 20)).toEqual(plan);
    expect(planChunks(await inventory([], {}))).toEqual([]);
  });

  it('splits the members of a chunk in two halves', () => {
    const members = ['A', 'B', 'C'].map((fullName) => ({ type: 'ApexClass', fullName }));
    expect(splitMembers(members).map((half) => half.map((member) => member.fullName))).toEqual([['A', 'B'], ['C']]);
  });
});

describe('the inventory of the mock org', () => {
  const ORG_ID = '00Dxx0000000001EAA';
  const source: OrgSource = { name: 'prod', kind: 'org', description: null, orgId: ORG_ID, loginUrl: null };
  let mock: MockOrg;

  beforeAll(async () => {
    mock = await startMockOrg({ versions: ['66.0'] });
    mock.metadata = await metadataFromSource(FIXTURE);
  });
  afterAll(async () => {
    await mock.close();
    await forgetCliLogins();
  });

  it('holds the components of the fixture project, and plans to retrieve each object with its parts', async () => {
    await seedCliLogin({
      username: 'dev@example.com',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'the-session',
    });
    mock.sessions.add('the-session');
    mock.metadata?.unlistedParents.add('CustomObject:Account');
    const session = await connectToOrg(source, undefined, {});
    const inventory = await takeInventory(await metadataApi(session.connection, session.apiVersion));
    expect(inventory.types.filter((one) => one.listing !== 'ok')).toEqual([]);
    expect(inventory.types.filter((one) => one.role === 'top').map((one) => one.type)).toEqual([
      'ApexClass',
      'ApexTrigger',
      'CustomObject',
    ]);
    const counts = new Map<string, number>();
    for (const one of inventory.items) counts.set(one.type, (counts.get(one.type) ?? 0) + 1);
    expect(Object.fromEntries(counts)).toMatchObject({ ApexTrigger: 1, CustomObject: 2 });
    expect(counts.get('CustomField')).toBeGreaterThan(10);
    const objects = planChunks(inventory)
      .flat()
      .filter((member) => member.type === 'CustomObject')
      .map((member) => member.fullName);
    expect(objects).toEqual(['Account', 'Invoice_Line__c', 'Invoice__c']);
  });
});
