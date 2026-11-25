/**
 * Which components of a snapshot are of a managed package installed in the org (decision record 0076): the org
 * says so in its listing, under the listed name and under the name the component came back with.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import { validateReference } from '../src/core/references.ts';
import { writeAnalysis } from '../src/store/analysis.ts';
import { addInventory, markNotRetrieved, markRetrieved, type InventoryRow } from '../src/store/journal.ts';
import { MIGRATIONS } from '../src/store/migrate.ts';
import { openStore, type Store } from '../src/store/open.ts';
import {
  countMissingOfPackages,
  countMissingOfPackagesNothingNames,
  countPackaged,
  missingOfPackages,
  readPackages,
} from '../src/store/packages.ts';
import { ensureSource, insertSnapshot } from '../src/store/snapshots.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';

const listed = (
  type: string,
  fullName: string,
  namespacePrefix: string | null = null,
  manageableState: string | null = 'unmanaged',
): InventoryRow => ({
  type,
  fullName,
  salesforceId: `id-of-${fullName}`,
  lastModifiedAt: T0,
  namespacePrefix,
  manageableState,
});

const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });

describe.each(DRIVERS)('the packages of the components of a snapshot with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = (path = join(temp.next(), 'orglens.sqlite'), migrations = MIGRATIONS): Store =>
    openStore({ path, driver, migrations });
  const begin = (store: Store, name = 'prod'): number =>
    insertSnapshot(store, {
      sourceId: ensureSource(store, { name, kind: 'org', createdAt: T0 }),
      status: 'running',
      startedAt: T0,
      finishedAt: null,
      engineVersion: '1.2.3',
      apiVersion: '66.0',
      gitCommit: null,
    });

  it('takes a component for one of a package where the org lists it with a prefix and a state of an installed one', () => {
    const store = open();
    const id = begin(store);
    store.write(() => {
      addInventory(store, id, [
        // The four states of a component of an installed package.
        listed('ApexClass', 'pkg__Billing', 'pkg', 'installed'),
        listed('ApexClass', 'pkg__Ledger', 'pkg', 'installedEditable'),
        listed('CustomObject', 'pkg__Invoice__c', 'pkg', 'deprecated'),
        listed('CustomField', 'pkg__Invoice__c.pkg__Amount__c', 'two', 'deprecatedEditable'),
        // A field the org added to an object of a package is the org's own.
        listed('CustomField', 'pkg__Invoice__c.Note__c'),
        // The org's own namespace: a prefix, and another state.
        listed('ApexClass', 'own__Released', 'own', 'released'),
        listed('ApexClass', 'own__Beta', 'own', 'beta'),
        // A tab carries the name of the object of a package and is the org's own.
        listed('CustomTab', 'pkg__Invoice__c'),
        // A state of a package without a prefix, and a prefix without a state: neither is taken.
        listed('ApexClass', 'Stateless', null, 'installed'),
        listed('ApexClass', 'pkg__Unstated', 'pkg', null),
        // A name that cannot be a key is passed over.
        listed('ApexClass', 'pkg__Bad\u0001', 'pkg', 'installed'),
      ]);
      // A component that came back and that the org did not list is the org's own, whatever its name.
      markRetrieved(store, id, [{ type: 'ApexClass', fullName: 'pkg__Unlisted' }]);
    });
    const packages = readPackages(store, id);
    expect(packages.of(key('ApexClass', 'pkg__Billing'))).toBe('pkg');
    expect(packages.of(key('ApexClass', 'pkg__Ledger'))).toBe('pkg');
    expect(packages.of(key('CustomObject', 'pkg__Invoice__c'))).toBe('pkg');
    // The package is the prefix the org lists the component with, not the one its name starts with.
    expect(packages.of(key('CustomField', 'pkg__Invoice__c.pkg__Amount__c'))).toBe('two');
    for (const [type, name] of [
      ['CustomField', 'pkg__Invoice__c.Note__c'],
      ['ApexClass', 'own__Released'],
      ['ApexClass', 'own__Beta'],
      ['CustomTab', 'pkg__Invoice__c'],
      ['ApexClass', 'Stateless'],
      ['ApexClass', 'pkg__Unstated'],
      ['ApexClass', 'pkg__Unlisted'],
      ['ApexClass', 'Nothing'],
    ] as const) {
      expect(packages.of(key(type, name)), `${type}:${name}`).toBeNull();
    }
    // Names are keys: the case of the key does not matter.
    expect(packages.of(key('apexclass', 'PKG__BILLING'))).toBe('pkg');

    expect(countPackaged(store, id)).toEqual(
      new Map([
        ['ApexClass', 3],
        ['CustomField', 1],
        ['CustomObject', 1],
      ]),
    );
    // None came back: they are missing, and only those of a package are named as such.
    expect(missingOfPackages(store, id, 'ApexClass')).toEqual(['pkg__Bad\u0001', 'pkg__Billing', 'pkg__Ledger']);
    expect(missingOfPackages(store, id, 'CustomTab')).toEqual([]);
    expect(countMissingOfPackages(store, id)).toEqual(countPackaged(store, id));
    // Another snapshot has none of them.
    const other = begin(store, 'uat');
    expect(readPackages(store, other).of(key('ApexClass', 'pkg__Billing'))).toBeNull();
    expect(countPackaged(store, other)).toEqual(new Map());
    expect(missingOfPackages(store, other, 'ApexClass')).toEqual([]);
    expect(countMissingOfPackages(store, other)).toEqual(new Map());
    store.close();
  });

  it('takes a component that came back without its prefix, and a part the analysis makes of one, for the package', () => {
    const store = open();
    const id = begin(store);
    const flow = (fullName: string) => ({ type: 'Flow', fullName });
    store.write(() => {
      addInventory(store, id, [
        listed('Flow', 'pkg__Route', 'pkg', 'installed'),
        listed('Flow', 'pkg__Gone', 'pkg', 'installed'),
        listed('Flow', 'Own_Flow'),
      ]);
      const asked = [flow('pkg__Route'), flow('pkg__Gone'), flow('Own_Flow')];
      markRetrieved(store, id, [flow('Route'), flow('Gone'), flow('Own_Flow')], { asked, notFound: [] });
    });
    const packages = readPackages(store, id);
    expect(packages.of(key('Flow', 'pkg__Route'))).toBe('pkg');
    expect(packages.of(key('Flow', 'Route'))).toBe('pkg');
    expect(
      packages.of(buildKey({ type: 'Flow', fullName: 'Route', subs: [{ kind: 'element', name: 'Decide' }] })),
    ).toBe('pkg');
    expect(
      packages.of(buildKey({ type: 'Flow', fullName: 'Own_Flow', subs: [{ kind: 'element', name: 'Decide' }] })),
    ).toBeNull();
    // A component that the snapshot does not hold after all keeps no name it came back with.
    store.write(() => {
      markNotRetrieved(store, id, flow('pkg__Gone'));
    });
    const after = readPackages(store, id);
    expect(after.of(key('Flow', 'Gone'))).toBeNull();
    expect(after.of(key('Flow', 'pkg__Gone'))).toBe('pkg');
    expect(after.of(key('Flow', 'Route'))).toBe('pkg');
    expect(missingOfPackages(store, id, 'Flow')).toEqual(['pkg__Gone']);
    expect(countMissingOfPackages(store, id)).toEqual(new Map([['Flow', 1]]));
    // A part is of its component, and no more: a field is a component of its own, which the org lists.
    expect(countPackaged(store, id)).toEqual(new Map([['Flow', 2]]));
    store.close();
  });

  it('counts a component of a package that did not come back where no reference of the snapshot names it', () => {
    const store = open();
    const id = begin(store);
    const other = begin(store, 'sandbox');
    const own = key('ApexClass', 'Own');
    store.write(() => {
      for (const snapshot of [id, other]) {
        addInventory(store, snapshot, [
          listed('ApexClass', 'Own'),
          // Named by its key.
          listed('CustomLabel', 'pkg__Greeting', 'pkg', 'installed'),
          // Named by a reference without a target, by its name without the prefix, in other letters.
          listed('Flow', 'pkg__Route', 'pkg', 'installed'),
          // Named by nothing.
          listed('Flow', 'pkg__Gone', 'pkg', 'installed'),
        ]);
        markRetrieved(store, snapshot, [{ type: 'ApexClass', fullName: 'Own' }]);
      }
    });
    const at = { file: 'classes/Own.cls', line: 3, column: 5 };
    const references = [
      validateReference({
        from: own,
        to: key('CustomLabel', 'pkg__Greeting'),
        toType: 'CustomLabel',
        toNameRaw: 'pkg__Greeting',
        kind: 'reads',
        origin: 'parser:apex',
        confidence: 'confirmed',
        resolution: 'external',
        location: at,
      }),
      validateReference({
        from: own,
        to: null,
        toType: 'Flow',
        toNameRaw: 'route',
        kind: 'calls',
        origin: 'parser:apex',
        confidence: 'confirmed',
        resolution: 'unresolved',
        location: at,
      }),
    ];
    writeAnalysis(store, id, {
      engineVersion: '1.2.3',
      analysedAt: T0,
      types: ['ApexClass'],
      components: [{ key: own, name: 'Own', definition: null, attrs: null, references }],
      work: [{ origin: 'parser:apex', components: 1, failedFiles: 0 }],
      issues: [],
    });
    expect(countMissingOfPackagesNothingNames(store, id)).toEqual(new Map([['Flow', 1]]));
    // What a component of another snapshot refers to names nothing of this one.
    expect(countMissingOfPackagesNothingNames(store, other)).toEqual(countMissingOfPackages(store, other));
    expect(countMissingOfPackages(store, other)).toEqual(
      new Map([
        ['CustomLabel', 1],
        ['Flow', 2],
      ]),
    );
    store.close();
  });

  it('migrates a database of schema version 9: its components of a package are known under their listed names', () => {
    const path = join(temp.next(), 'orglens.sqlite');
    const old = open(path, MIGRATIONS.slice(0, 9));
    const id = begin(old);
    old.write(() => {
      // The flow came back as `Route`, and the rule of the prefix took it for the listed one.
      addInventory(old, id, [listed('Flow', 'pkg__Route', 'pkg', 'installed')]);
      old.run(`UPDATE inventory_item SET retrieved = 1 WHERE snapshot_id = ? AND full_name = 'pkg__Route'`, id);
    });
    old.close();

    const store = open(path);
    expect(store.migrated).toEqual({ from: 9, to: MIGRATIONS.length });
    const packages = readPackages(store, id);
    expect(packages.of(key('Flow', 'pkg__Route'))).toBe('pkg');
    // Which name it came back with was not kept, until the snapshot is taken again.
    expect(packages.of(key('Flow', 'Route'))).toBeNull();
    // An empty name is refused.
    expect(
      codeOf(() =>
        store.write(() => store.run(`UPDATE inventory_item SET came_back_as = '' WHERE snapshot_id = ?`, id)),
      ),
    ).toBe('STORE_FAILED');
    store.close();
  });
});
