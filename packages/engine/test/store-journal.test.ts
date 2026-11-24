import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addChunk,
  addChunks,
  addInventory,
  chunkEnded,
  chunkForgotten,
  chunkStarted,
  countChunks,
  countInventory,
  markRetrieved,
  missingComponents,
  missingPartsOf,
  nextChunk,
  refreshCoverage,
  splitChunk,
  unlistedComponents,
  type InventoryRow,
} from '../src/store/journal.ts';
import { openStore } from '../src/store/open.ts';
import { addCoverage, ensureSource, insertSnapshot, readCoverage } from '../src/store/snapshots.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const T1 = '2026-01-31T09:30:05.250Z';

const listed = (type: string, fullName: string): InventoryRow => ({
  type,
  fullName,
  salesforceId: `id-of-${fullName}`,
  lastModifiedAt: T0,
  namespacePrefix: null,
  manageableState: 'unmanaged',
});
const member = (type: string, fullName: string): { type: string; fullName: string } => ({ type, fullName });

describe.each(DRIVERS)('the journal of an org snapshot with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = () => openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });

  const begin = (store: ReturnType<typeof open>, name = 'prod'): number =>
    insertSnapshot(store, {
      sourceId: ensureSource(store, { name, kind: 'org', createdAt: T0 }),
      status: 'running',
      startedAt: T0,
      finishedAt: null,
      engineVersion: '1.2.3',
      apiVersion: '66.0',
      gitCommit: null,
    });

  it('keeps what the org listed, notes what came back, and counts both per type', () => {
    const store = open();
    const id = begin(store);
    addInventory(store, id, [
      listed('ApexClass', 'A'),
      listed('ApexClass', 'B'),
      listed('ApexClass', 'C'),
      listed('CustomField', 'Account.Tier__c'),
    ]);
    expect(countInventory(store, id)).toEqual(
      new Map([
        ['ApexClass', { listed: 3, retrieved: 0, unlisted: 0 }],
        ['CustomField', { listed: 1, retrieved: 0, unlisted: 0 }],
      ]),
    );

    // Two of the three classes come back, one of them twice, and an object nobody listed.
    markRetrieved(store, id, [member('ApexClass', 'A'), member('ApexClass', 'C'), member('CustomObject', 'Account')]);
    markRetrieved(store, id, [member('ApexClass', 'A')]);
    expect(countInventory(store, id)).toEqual(
      new Map([
        ['ApexClass', { listed: 3, retrieved: 2, unlisted: 0 }],
        ['CustomField', { listed: 1, retrieved: 0, unlisted: 0 }],
        ['CustomObject', { listed: 0, retrieved: 0, unlisted: 1 }],
      ]),
    );
    expect(missingComponents(store, id, 'ApexClass')).toEqual(['B']);
    expect(missingComponents(store, id, 'CustomObject')).toEqual([]);
    expect(unlistedComponents(store, id, 'CustomObject')).toEqual(['Account']);
    expect(unlistedComponents(store, id, 'ApexClass')).toEqual([]);
    // What the org said about a component stays with it. An unlisted one has nothing of that.
    expect(
      store.all(
        'SELECT full_name, salesforce_id, listed, retrieved FROM inventory_item WHERE snapshot_id = ? ORDER BY type, full_name',
        id,
      ),
    ).toEqual([
      { full_name: 'A', salesforce_id: 'id-of-A', listed: 1, retrieved: 1 },
      { full_name: 'B', salesforce_id: 'id-of-B', listed: 1, retrieved: 0 },
      { full_name: 'C', salesforce_id: 'id-of-C', listed: 1, retrieved: 1 },
      { full_name: 'Account.Tier__c', salesforce_id: 'id-of-Account.Tier__c', listed: 1, retrieved: 0 },
      { full_name: 'Account', salesforce_id: null, listed: 0, retrieved: 1 },
    ]);

    // Another snapshot is another count.
    expect(countInventory(store, begin(store, 'uat'))).toEqual(new Map());
    store.close();
  });

  it('takes a component that came back without the prefix of its package for the one the org listed', () => {
    const store = open();
    const id = begin(store);
    const of = (prefix: string, row: InventoryRow): InventoryRow => ({ ...row, namespacePrefix: prefix });
    addInventory(store, id, [
      of('pkg', listed('LightningComponentBundle', 'pkg__tile')),
      // The org lists the short name as well: what comes back under it is that one.
      of('pkg', listed('LightningComponentBundle', 'pkg__card')),
      listed('LightningComponentBundle', 'card'),
      // Two packages with the same short name: nothing says which of them came back.
      of('one', listed('LightningComponentBundle', 'one__grid')),
      of('two', listed('LightningComponentBundle', 'two__grid')),
      // A name that only looks like one with a prefix: the org states no package for it.
      listed('LightningComponentBundle', 'pkg__lone'),
      // The prefix of another package than the name starts with.
      of('other', listed('LightningComponentBundle', 'pkg__odd')),
      // The same short name in another type.
      of('pkg', listed('AuraDefinitionBundle', 'pkg__tile')),
    ]);
    const bundle = (name: string): { type: string; fullName: string } => member('LightningComponentBundle', name);
    // The retrieve asked for every name the org lists, as a retrieve does.
    const asked = ['pkg__tile', 'pkg__card', 'card', 'one__grid', 'two__grid', 'pkg__lone', 'pkg__odd'].map(bundle);
    const cameBack = ['tile', 'card', 'grid', 'lone', 'odd', 'pkg__card'].map(bundle);
    expect(markRetrieved(store, id, cameBack, { asked, notFound: [] })).toEqual([
      { ...bundle('pkg__tile'), rule: 'prefix' },
    ]);
    // A second retrieve with the same component says nothing new.
    expect(markRetrieved(store, id, [bundle('tile')], { asked, notFound: [] })).toEqual([]);
    expect(
      store
        .all(
          `SELECT full_name, listed, retrieved FROM inventory_item
            WHERE snapshot_id = ? AND type = 'LightningComponentBundle' ORDER BY full_name`,
          id,
        )
        .map((row) => [row['full_name'], row['listed'], row['retrieved']]),
    ).toEqual([
      ['card', 1, 1],
      ['grid', 0, 1],
      ['lone', 0, 1],
      ['odd', 0, 1],
      ['one__grid', 1, 0],
      ['pkg__card', 1, 1],
      ['pkg__lone', 1, 0],
      ['pkg__odd', 1, 0],
      ['pkg__tile', 1, 1],
      ['two__grid', 1, 0],
    ]);
    expect(missingComponents(store, id, 'AuraDefinitionBundle')).toEqual(['pkg__tile']);
    store.close();
  });

  it('takes a component for a listed one with a prefix only when the retrieve leaves no other reading', () => {
    const store = open();
    const id = begin(store);
    const of = (prefix: string, row: InventoryRow): InventoryRow => ({ ...row, namespacePrefix: prefix });
    const object = (name: string): { type: string; fullName: string } => member('CustomObject', name);
    addInventory(store, id, [
      of('pkg', listed('CustomObject', 'pkg__Asked__c')),
      of('pkg', listed('CustomObject', 'pkg__Elsewhere__c')),
      of('pkg', listed('CustomObject', 'pkg__Gone__c')),
      of('pkg', listed('CustomObject', 'pkg__Plain__c')),
      // The org lists a field of an object it does not list. The object is asked for by its name for the field.
      listed('CustomField', 'Asked__c.Total__c'),
    ]);
    const asked = ['pkg__Asked__c', 'Asked__c', 'pkg__Gone__c', 'pkg__Plain__c'].map(object);
    const cameBack = ['Asked__c', 'Elsewhere__c', 'Gone__c', 'Plain__c'].map(object);

    // Nothing is known of the retrieve: every component is what its name says.
    const other = begin(store, 'uat');
    addInventory(store, other, [of('pkg', listed('CustomObject', 'pkg__Plain__c'))]);
    expect(markRetrieved(store, other, [object('Plain__c')])).toEqual([]);
    expect(missingComponents(store, other, 'CustomObject')).toEqual(['pkg__Plain__c']);

    expect(
      markRetrieved(store, id, cameBack, { asked, notFound: [object('pkg__Gone__c'), object('Other__c')] }),
    ).toEqual([{ ...object('pkg__Plain__c'), rule: 'prefix' }]);
    expect(missingComponents(store, id, 'CustomObject')).toEqual([
      // The retrieve asked for the short name too, and that is what came back.
      'pkg__Asked__c',
      // This retrieve did not ask for the listed name.
      'pkg__Elsewhere__c',
      // Salesforce remarked that it cannot find the listed name.
      'pkg__Gone__c',
    ]);
    expect(unlistedComponents(store, id, 'CustomObject')).toEqual(['Asked__c', 'Elsewhere__c', 'Gone__c']);
    store.close();
  });

  it('does not take a short name for the listed one that came back itself in the same retrieve', () => {
    const store = open();
    const id = begin(store);
    const bundle = (name: string): { type: string; fullName: string } => member('LightningComponentBundle', name);
    addInventory(store, id, [{ ...listed('LightningComponentBundle', 'pkg__tile'), namespacePrefix: 'pkg' }]);
    // Both names came back for the one that was asked for: the short one is a component of its own.
    expect(
      markRetrieved(store, id, [bundle('tile'), bundle('pkg__tile')], { asked: [bundle('pkg__tile')], notFound: [] }),
    ).toEqual([]);
    expect(missingComponents(store, id, 'LightningComponentBundle')).toEqual([]);
    expect(unlistedComponents(store, id, 'LightningComponentBundle')).toEqual(['tile']);
    store.close();
  });

  it('takes a document that came back without the ending of its file for the one the org listed', () => {
    const store = open();
    const id = begin(store);
    const document = (name: string): { type: string; fullName: string } => member('Document', name);
    const template = (name: string): { type: string; fullName: string } => member('EmailTemplate', name);
    addInventory(store, id, [
      listed('Document', 'Assets/Logo.png'),
      // The name of the file is cut at its first dot.
      listed('Document', 'Assets/Terms.v2.txt'),
      // A dot in the name of the folder is none of the file.
      listed('Document', 'My.Files/Logo.png'),
      // Two documents whose names differ in the ending only: nothing says which of them came back.
      listed('Document', 'Assets/Twin.png'),
      listed('Document', 'Assets/Twin.txt'),
      // The org lists the name without an ending as well: what comes back under it is that one.
      listed('Document', 'Assets/Both.png'),
      listed('Document', 'Assets/Both'),
      // Salesforce remarks that it cannot find this one.
      listed('Document', 'Assets/Gone.png'),
      // This retrieve does not ask for this one.
      listed('Document', 'Assets/Elsewhere.png'),
      // This one comes back under the listed name itself, and another component under the name without the ending.
      listed('Document', 'Assets/Same.png'),
      // A name without an ending is not cut, and neither is a name whose file starts with the dot.
      listed('Document', 'Assets/Plain'),
      listed('Document', 'Assets/.hidden'),
      // Only a document is listed with the ending of its file.
      listed('EmailTemplate', 'Mail/Welcome.html'),
      listed('DocumentFolder', 'Assets'),
    ]);
    const asked = [
      // The folder is asked for under the type of what it holds.
      document('Assets'),
      ...[
        'Assets/Logo.png',
        'Assets/Terms.v2.txt',
        'My.Files/Logo.png',
        'Assets/Twin.png',
        'Assets/Twin.txt',
        'Assets/Both.png',
        'Assets/Both',
        'Assets/Gone.png',
        'Assets/Same.png',
        'Assets/Plain',
        'Assets/.hidden',
      ].map(document),
      template('Mail/Welcome.html'),
    ];
    const cameBack = [
      member('DocumentFolder', 'Assets'),
      ...[
        'Assets/Logo',
        'Assets/Terms',
        'My.Files/Logo',
        'Assets/Twin',
        'Assets/Both',
        'Assets/Gone',
        'Assets/Elsewhere',
        'Assets/Same.png',
        'Assets/Same',
        'Assets/Plain',
        'Assets/',
      ].map(document),
      template('Mail/Welcome'),
    ];
    const retrieve = { asked, notFound: [document('Assets/Gone.png')] };
    expect(markRetrieved(store, id, cameBack, retrieve)).toEqual(
      ['Assets/Logo.png', 'Assets/Terms.v2.txt', 'My.Files/Logo.png'].map((name) => ({
        ...document(name),
        rule: 'file-ending',
      })),
    );
    // A second retrieve with the same document says nothing new.
    expect(markRetrieved(store, id, [document('Assets/Logo')], retrieve)).toEqual([]);
    expect(missingComponents(store, id, 'Document')).toEqual([
      'Assets/.hidden',
      'Assets/Both.png',
      'Assets/Elsewhere.png',
      'Assets/Gone.png',
      'Assets/Twin.png',
      'Assets/Twin.txt',
    ]);
    expect(unlistedComponents(store, id, 'Document')).toEqual([
      'Assets/',
      'Assets/Elsewhere',
      'Assets/Gone',
      'Assets/Same',
      'Assets/Twin',
    ]);
    expect(missingComponents(store, id, 'EmailTemplate')).toEqual(['Mail/Welcome.html']);
    expect(unlistedComponents(store, id, 'EmailTemplate')).toEqual(['Mail/Welcome']);
    expect(countInventory(store, id).get('Document')).toEqual({ listed: 12, retrieved: 6, unlisted: 5 });
    store.close();
  });

  it('takes what came back under the object PersonAccount for what the org listed under the object Account', () => {
    const store = open();
    const id = begin(store);
    const rule = (name: string): { type: string; fullName: string } => member('DuplicateRule', name);
    const recordType = (name: string): { type: string; fullName: string } => member('RecordType', name);
    addInventory(store, id, [
      // A type that is retrieved by its own name: the retrieve asks for the listed name.
      listed('DuplicateRule', 'Account.Same_Person'),
      // Salesforce remarks that it cannot find this one.
      listed('DuplicateRule', 'Account.Gone'),
      // This retrieve asks for rules, and not for this one.
      listed('DuplicateRule', 'Account.Elsewhere'),
      // Parts, which come with their parent: the retrieve asks for nothing of their type.
      listed('RecordType', 'Account.Client'),
      listed('MatchingRule', 'Account.Person_By_Name'),
      // The org lists the name under PersonAccount as well: what comes back under it is that one.
      listed('RecordType', 'Account.Both'),
      listed('RecordType', 'PersonAccount.Both'),
      // This one comes back under the listed name itself, and another component under PersonAccount.
      listed('RecordType', 'Account.Twin'),
      // A part of the business account, which comes back under its own name.
      listed('RecordType', 'Account.Business'),
      // Only the object Account stands for PersonAccount.
      listed('RecordType', 'Contact.Client'),
      listed('CustomObject', 'Account'),
      listed('CustomObject', 'PersonAccount'),
      listed('MatchingRules', 'PersonAccount'),
    ]);
    // A record type that came back before under a name the org did not list is no listed name.
    expect(markRetrieved(store, id, [recordType('Account.Unlisted')], { asked: [], notFound: [] })).toEqual([]);

    const asked = [
      rule('Account.Same_Person'),
      rule('Account.Gone'),
      member('CustomObject', 'Account'),
      member('CustomObject', 'PersonAccount'),
      member('MatchingRules', 'PersonAccount'),
    ];
    const cameBack = [
      rule('PersonAccount.Same_Person'),
      rule('PersonAccount.Gone'),
      rule('PersonAccount.Elsewhere'),
      member('CustomObject', 'Account'),
      member('CustomObject', 'PersonAccount'),
      member('MatchingRules', 'PersonAccount'),
      member('MatchingRule', 'PersonAccount.Person_By_Name'),
      ...[
        'PersonAccount.Client',
        'PersonAccount.Both',
        'Account.Twin',
        'PersonAccount.Twin',
        'Account.Business',
        'PersonAccount.Unlisted',
        'PersonAccount.Lone',
        'PersonContact.Client',
      ].map(recordType),
    ];
    const retrieve = { asked, notFound: [rule('Account.Gone')] };
    expect(markRetrieved(store, id, cameBack, retrieve)).toEqual([
      { ...rule('Account.Same_Person'), rule: 'person-account' },
      { ...member('MatchingRule', 'Account.Person_By_Name'), rule: 'person-account' },
      { ...recordType('Account.Client'), rule: 'person-account' },
    ]);
    // A second retrieve with the same components says nothing new.
    expect(markRetrieved(store, id, [recordType('PersonAccount.Client')], retrieve)).toEqual([]);

    expect(missingComponents(store, id, 'DuplicateRule')).toEqual(['Account.Elsewhere', 'Account.Gone']);
    expect(unlistedComponents(store, id, 'DuplicateRule')).toEqual(['PersonAccount.Elsewhere', 'PersonAccount.Gone']);
    expect(missingComponents(store, id, 'MatchingRule')).toEqual([]);
    expect(unlistedComponents(store, id, 'MatchingRule')).toEqual([]);
    expect(missingComponents(store, id, 'RecordType')).toEqual(['Account.Both', 'Contact.Client']);
    expect(unlistedComponents(store, id, 'RecordType')).toEqual([
      'Account.Unlisted',
      'PersonAccount.Lone',
      'PersonAccount.Twin',
      'PersonAccount.Unlisted',
      'PersonContact.Client',
    ]);

    // Nothing is known of the retrieve: every component is what its name says.
    const other = begin(store, 'uat');
    addInventory(store, other, [listed('RecordType', 'Account.Client'), listed('Document', 'Assets/Logo.png')]);
    expect(
      markRetrieved(store, other, [recordType('PersonAccount.Client'), member('Document', 'Assets/Logo')]),
    ).toEqual([]);
    expect(missingComponents(store, other, 'RecordType')).toEqual(['Account.Client']);
    expect(missingComponents(store, other, 'Document')).toEqual(['Assets/Logo.png']);

    // A retrieve that asks for one rule, without a remark: what it asked for decides, and another rule of the
    // type that it did not ask for is not taken.
    const third = begin(store, 'dev');
    addInventory(store, third, [
      listed('DuplicateRule', 'Account.Asked'),
      listed('DuplicateRule', 'Account.Elsewhere'),
    ]);
    expect(
      markRetrieved(store, third, [rule('PersonAccount.Asked'), rule('PersonAccount.Elsewhere')], {
        asked: [rule('Account.Asked')],
        notFound: [],
      }),
    ).toEqual([{ ...rule('Account.Asked'), rule: 'person-account' }]);
    expect(missingComponents(store, third, 'DuplicateRule')).toEqual(['Account.Elsewhere']);
    expect(unlistedComponents(store, third, 'DuplicateRule')).toEqual(['PersonAccount.Elsewhere']);
    store.close();
  });

  it('takes a report, a dashboard or a folder that came back under its whole path for the one the org listed', () => {
    const store = open();
    const id = begin(store);
    const report = (name: string): { type: string; fullName: string } => member('Report', name);
    const folder = (name: string): { type: string; fullName: string } => member('ReportFolder', name);
    addInventory(store, id, [
      // A folder that lies in no folder, and a report in it: both come back under the name the org lists.
      listed('ReportFolder', 'Finance'),
      listed('Report', 'Finance/Totals'),
      // A folder inside it and one inside that: the org lists each by its own name, and a report with its folder.
      listed('ReportFolder', 'Quarterly'),
      listed('ReportFolder', 'Archive'),
      listed('Report', 'Quarterly/Revenue'),
      listed('Report', 'Archive/Old_Revenue'),
      // Salesforce remarks that it cannot find this one.
      listed('Report', 'Quarterly/Gone'),
      // This retrieve asks for reports, and not for this one.
      listed('Report', 'Quarterly/Elsewhere'),
      // The org lists the whole path as well: what comes back under it is that one.
      listed('Report', 'Quarterly/Both'),
      listed('Report', 'Finance/Quarterly/Both'),
      // This one comes back under the listed name itself, and another report under a longer path.
      listed('Report', 'Quarterly/Twin'),
      // Two listed names are an end of the path that came back: nothing says which one it is.
      listed('Report', 'Archive/Split'),
      listed('Report', 'Quarterly/Archive/Split'),
      // Dashboards and their folders are listed the same way.
      listed('DashboardFolder', 'Inner'),
      listed('Dashboard', 'Inner/Overview'),
      // No other type is: an email template, a document and their folders are what their names say.
      listed('EmailTemplate', 'Inner/Welcome'),
      listed('EmailFolder', 'Inner'),
      listed('Document', 'Inner/Notes'),
      listed('DocumentFolder', 'Inner'),
      // Salesforce remarks that it cannot find this folder, under the type of what it holds.
      listed('ReportFolder', 'Hidden'),
      // Two folders of this name come back: nothing says which one it is.
      listed('ReportFolder', 'Shared'),
    ]);
    const asked = [
      // A folder is asked for under the type of what it holds.
      ...['Finance', 'Quarterly', 'Archive', 'Finance/Totals', 'Quarterly/Revenue', 'Archive/Old_Revenue'].map(report),
      ...['Quarterly/Gone', 'Quarterly/Both', 'Finance/Quarterly/Both', 'Quarterly/Twin'].map(report),
      ...['Archive/Split', 'Quarterly/Archive/Split'].map(report),
      member('Dashboard', 'Inner'),
      member('Dashboard', 'Inner/Overview'),
      member('EmailTemplate', 'Inner/Welcome'),
      // Asked for under their own types, so that only the type keeps them from being taken.
      member('EmailFolder', 'Inner'),
      member('Document', 'Inner/Notes'),
      member('DocumentFolder', 'Inner'),
      report('Hidden'),
      report('Shared'),
    ];
    const cameBack = [
      folder('Finance'),
      folder('Finance/Quarterly'),
      folder('Finance/Quarterly/Archive'),
      // A folder the org does not list, in a folder it lists.
      folder('Finance/Unlisted'),
      ...[
        'Finance/Totals',
        'Finance/Quarterly/Revenue',
        'Finance/Quarterly/Archive/Old_Revenue',
        'Finance/Quarterly/Gone',
        'Finance/Quarterly/Elsewhere',
        'Finance/Quarterly/Both',
        'Quarterly/Twin',
        'Finance/Quarterly/Twin',
        'Finance/Quarterly/Archive/Split',
      ].map(report),
      member('DashboardFolder', 'Board/Inner'),
      member('Dashboard', 'Board/Inner/Overview'),
      member('EmailTemplate', 'Mails/Inner/Welcome'),
      member('EmailFolder', 'Mails/Inner'),
      member('Document', 'Files/Inner/Notes'),
      member('DocumentFolder', 'Files/Inner'),
      folder('Finance/Hidden'),
      folder('Finance/Shared'),
      folder('Finance/Quarterly/Shared'),
    ];
    const retrieve = { asked, notFound: [report('Quarterly/Gone'), report('Hidden')] };
    expect(markRetrieved(store, id, cameBack, retrieve)).toEqual([
      { ...folder('Quarterly'), rule: 'folder-path' },
      { ...folder('Archive'), rule: 'folder-path' },
      { ...report('Quarterly/Revenue'), rule: 'folder-path' },
      { ...report('Archive/Old_Revenue'), rule: 'folder-path' },
      { ...member('DashboardFolder', 'Inner'), rule: 'folder-path' },
      { ...member('Dashboard', 'Inner/Overview'), rule: 'folder-path' },
    ]);
    // A second retrieve with the same components says nothing new.
    expect(markRetrieved(store, id, [report('Finance/Quarterly/Revenue')], retrieve)).toEqual([]);

    expect(missingComponents(store, id, 'ReportFolder')).toEqual(['Hidden', 'Shared']);
    expect(unlistedComponents(store, id, 'ReportFolder')).toEqual([
      'Finance/Hidden',
      'Finance/Quarterly/Shared',
      'Finance/Shared',
      'Finance/Unlisted',
    ]);
    expect(missingComponents(store, id, 'Report')).toEqual([
      'Archive/Split',
      'Quarterly/Archive/Split',
      'Quarterly/Both',
      'Quarterly/Elsewhere',
      'Quarterly/Gone',
    ]);
    expect(unlistedComponents(store, id, 'Report')).toEqual([
      'Finance/Quarterly/Archive/Split',
      'Finance/Quarterly/Elsewhere',
      'Finance/Quarterly/Gone',
      'Finance/Quarterly/Twin',
    ]);
    expect(countInventory(store, id).get('Report')).toEqual({ listed: 10, retrieved: 5, unlisted: 4 });
    for (const type of ['Dashboard', 'DashboardFolder']) {
      expect(countInventory(store, id).get(type)).toEqual({ listed: 1, retrieved: 1, unlisted: 0 });
    }
    expect(missingComponents(store, id, 'EmailTemplate')).toEqual(['Inner/Welcome']);
    expect(unlistedComponents(store, id, 'EmailTemplate')).toEqual(['Mails/Inner/Welcome']);
    for (const [type, name] of [
      ['EmailFolder', 'Mails/Inner'],
      ['Document', 'Files/Inner/Notes'],
      ['DocumentFolder', 'Files/Inner'],
    ] as const) {
      expect(countInventory(store, id).get(type)).toEqual({ listed: 1, retrieved: 0, unlisted: 1 });
      expect(unlistedComponents(store, id, type)).toEqual([name]);
    }

    // A retrieve that asks for a folder by the type of folders and not for this one: the folder is not taken.
    const second = begin(store, 'uat');
    addInventory(store, second, [
      listed('ReportFolder', 'Lone'),
      listed('ReportFolder', 'Other'),
      listed('ReportFolder', 'Solo'),
      listed('Report', 'Solo/Weekly'),
      listed('Report', 'Solo/Monthly'),
    ]);
    const others = { asked: [folder('Other')], notFound: [] };
    expect(markRetrieved(store, second, [folder('Finance/Lone')], others)).toEqual([]);
    // A folder that comes back with a report of it is taken, though the retrieve did not ask for the folder.
    const weekly = { asked: [report('Solo/Weekly')], notFound: [] };
    expect(markRetrieved(store, second, [folder('Finance/Solo'), report('Finance/Solo/Weekly')], weekly)).toEqual([
      { ...folder('Solo'), rule: 'folder-path' },
      { ...report('Solo/Weekly'), rule: 'folder-path' },
    ]);
    // A report is taken only where the retrieve asked for it, also where the retrieve asked for no report at all.
    const board = { asked: [member('Dashboard', 'Board/Overview')], notFound: [] };
    expect(markRetrieved(store, second, [report('Finance/Solo/Monthly')], board)).toEqual([]);
    expect(missingComponents(store, second, 'Report')).toEqual(['Solo/Monthly']);
    expect(unlistedComponents(store, second, 'Report')).toEqual(['Finance/Solo/Monthly']);
    expect(missingComponents(store, second, 'ReportFolder')).toEqual(['Lone', 'Other']);
    // Nothing is known of the retrieve: every component is what its name says.
    expect(markRetrieved(store, second, [folder('Finance/Other')])).toEqual([]);
    expect(unlistedComponents(store, second, 'ReportFolder')).toEqual(['Finance/Lone', 'Finance/Other']);
    store.close();
  });

  it('sets the retrieved components of every type from the inventory, and counts no unlisted one', () => {
    const store = open();
    const id = begin(store);
    addInventory(store, id, [listed('ApexClass', 'A'), listed('ApexClass', 'B')]);
    for (const type of ['ApexClass', 'CustomObject', 'Flow']) {
      addCoverage(store, id, {
        type,
        listed: type === 'ApexClass' ? 2 : 0,
        retrieved: 0,
        analysed: 0,
        listing: 'ok',
        note: null,
      });
    }
    markRetrieved(store, id, [member('ApexClass', 'B'), member('CustomObject', 'Account')]);
    refreshCoverage(store, id);
    expect(readCoverage(store, id).map((row) => [row.type, row.listed, row.retrieved])).toEqual([
      ['ApexClass', 2, 1],
      ['CustomObject', 0, 0],
      ['Flow', 0, 0],
    ]);
    store.close();
  });

  it('names the parts of a parent the org does not list that did not come back, and none of a parent it lists', () => {
    const store = open();
    const id = begin(store);
    addInventory(store, id, [
      listed('CustomField', 'Per_son.A__c'),
      listed('CustomField', 'Per_son.B__c'),
      listed('CustomField', 'Per_son.Back__c'),
      // An underscore in the name of the parent stands for itself, and a longer name is another parent.
      listed('CustomField', 'Per-son.C__c'),
      listed('CustomField', 'Per_sonAccount.D__c'),
      listed('CustomField', 'Per_son'),
      listed('RecordType', 'Per_son.Main'),
      listed('QuickAction', 'Per_son.Call'),
      listed('CustomObject', 'Invoice__c'),
      listed('CustomField', 'Invoice__c.Amount__c'),
    ]);
    // One part came back, and one came back that the org had not listed.
    markRetrieved(store, id, [member('CustomField', 'Per_son.Back__c'), member('CustomField', 'Per_son.Extra__c')]);
    const parts = ['RecordType', 'CustomField'];

    expect(missingPartsOf(store, id, member('CustomObject', 'Per_son'), parts)).toEqual([
      member('CustomField', 'Per_son.A__c'),
      member('CustomField', 'Per_son.B__c'),
      member('RecordType', 'Per_son.Main'),
    ]);
    expect(missingPartsOf(store, id, member('CustomObject', 'Per_son'), ['RecordType'])).toEqual([
      member('RecordType', 'Per_son.Main'),
    ]);
    expect(missingPartsOf(store, id, member('CustomObject', 'Per_son'), [])).toEqual([]);
    expect(missingPartsOf(store, id, member('CustomObject', 'Nobody'), parts)).toEqual([]);
    // The org lists this parent. It is what is missing, and its part is not asked for alone.
    expect(missingPartsOf(store, id, member('CustomObject', 'Invoice__c'), parts)).toEqual([]);
    // A parent that came back, although the org does not list it: its file is in the snapshot.
    markRetrieved(store, id, [member('CustomObject', 'Per_son')]);
    expect(missingPartsOf(store, id, member('CustomObject', 'Per_son'), parts)).toEqual([]);
    expect(missingPartsOf(store, begin(store, 'uat'), member('CustomObject', 'Per_son'), parts)).toEqual([]);
    store.close();
  });

  it('adds a chunk at the end of the plan, also to a plan without a chunk', () => {
    const store = open();
    const id = begin(store);
    addChunk(store, id, [member('CustomField', 'Person.A__c')]);
    addChunks(store, begin(store, 'uat'), [[member('ApexClass', 'A')]]);
    addChunk(store, id, [member('RecordType', 'Person.Main'), member('CustomField', 'Person.B__c')]);
    expect(
      store.all('SELECT seq, status, members, attempts FROM retrieve_chunk WHERE snapshot_id = ? ORDER BY seq', id),
    ).toEqual([
      { seq: 0, status: 'pending', members: '[{"type":"CustomField","members":["Person.A__c"]}]', attempts: 0 },
      {
        seq: 1,
        status: 'pending',
        members: '[{"type":"RecordType","members":["Person.Main"]},{"type":"CustomField","members":["Person.B__c"]}]',
        attempts: 0,
      },
    ]);
    expect(nextChunk(store, id)).toMatchObject({ seq: 0, status: 'pending', attempts: 0, jobId: null });
    store.close();
  });

  it('hands out the chunks in order, a started one first, and keeps the job of a retrieve until it has ended', () => {
    const store = open();
    const id = begin(store);
    const plan = [
      [member('ApexClass', 'A'), member('ApexClass', 'B'), member('ApexTrigger', 'T')],
      [member('CustomObject', 'Account')],
      [member('Report', 'Sales/Won & "lost"')],
    ];
    addChunks(store, id, plan);
    expect(countChunks(store, id)).toEqual({ pending: 3, running: 0, done: 0, failed: 0, total: 3 });
    expect(nextChunk(store, id)).toEqual({ seq: 0, status: 'pending', members: plan[0], attempts: 0, jobId: null });
    // The members are stored by type, so that thousands of names do not repeat the type.
    expect(store.get('SELECT members FROM retrieve_chunk WHERE snapshot_id = ? AND seq = 0', id)).toEqual({
      members: '[{"type":"ApexClass","members":["A","B"]},{"type":"ApexTrigger","members":["T"]}]',
    });

    chunkStarted(store, id, 0, 'job-1', T0);
    expect(nextChunk(store, id)).toEqual({ seq: 0, status: 'running', members: plan[0], attempts: 1, jobId: 'job-1' });
    chunkEnded(store, id, 0, { status: 'done', at: T1, error: null });
    expect(
      store.get(
        'SELECT status, job_id, started_at, finished_at FROM retrieve_chunk WHERE snapshot_id = ? AND seq = 0',
        id,
      ),
    ).toEqual({
      status: 'done',
      job_id: null,
      started_at: T0,
      finished_at: T1,
    });

    // A chunk that was started is what a resumed snapshot works on, before a chunk with a lower number.
    chunkStarted(store, id, 2, 'job-2', T0);
    expect(nextChunk(store, id)).toMatchObject({ seq: 2, jobId: 'job-2', members: plan[2] });
    chunkEnded(store, id, 2, { status: 'failed', at: T1, error: 'UNKNOWN_EXCEPTION' });
    expect(store.get('SELECT status, job_id, error FROM retrieve_chunk WHERE snapshot_id = ? AND seq = 2', id)).toEqual(
      {
        status: 'failed',
        job_id: null,
        error: 'UNKNOWN_EXCEPTION',
      },
    );
    expect(nextChunk(store, id)).toMatchObject({ seq: 1, status: 'pending' });
    chunkStarted(store, id, 1, 'job-3', T0);
    chunkEnded(store, id, 1, { status: 'done', at: T1, error: null });
    expect(nextChunk(store, id)).toBeUndefined();
    expect(countChunks(store, id)).toEqual({ pending: 0, running: 0, done: 2, failed: 1, total: 3 });
    expect(nextChunk(store, begin(store, 'uat'))).toBeUndefined();
    store.close();
  });

  it('starts a chunk again whose job is gone, and counts the starts', () => {
    const store = open();
    const id = begin(store);
    addChunks(store, id, [[member('ApexClass', 'A')]]);
    chunkStarted(store, id, 0, 'job-1', T0);
    chunkForgotten(store, id, 0);
    expect(nextChunk(store, id)).toMatchObject({ seq: 0, status: 'pending', attempts: 1, jobId: null });
    chunkStarted(store, id, 0, 'job-2', T1);
    expect(nextChunk(store, id)).toMatchObject({ seq: 0, status: 'running', attempts: 2, jobId: 'job-2' });
    store.close();
  });

  it('splits a chunk in two: it keeps the first members, and a new chunk at the end gets the others', () => {
    const store = open();
    const id = begin(store);
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name) => member('ApexClass', name));
    addChunks(store, id, [[a, b, c], [d]] as { type: string; fullName: string }[][]);
    chunkStarted(store, id, 0, 'job-1', T0);
    splitChunk(store, id, 0, [[a, b], [c]] as [
      { type: string; fullName: string }[],
      { type: string; fullName: string }[],
    ]);
    expect(nextChunk(store, id)).toEqual({ seq: 0, status: 'pending', members: [a, b], attempts: 0, jobId: null });
    expect(
      store.all('SELECT seq, status, members, attempts FROM retrieve_chunk WHERE snapshot_id = ? ORDER BY seq', id),
    ).toEqual([
      { seq: 0, status: 'pending', members: '[{"type":"ApexClass","members":["A","B"]}]', attempts: 0 },
      { seq: 1, status: 'pending', members: '[{"type":"ApexClass","members":["D"]}]', attempts: 0 },
      { seq: 2, status: 'pending', members: '[{"type":"ApexClass","members":["C"]}]', attempts: 0 },
    ]);
    expect(countChunks(store, id)).toEqual({ pending: 3, running: 0, done: 0, failed: 0, total: 3 });
    store.close();
  });
});
