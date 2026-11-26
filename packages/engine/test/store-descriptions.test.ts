/**
 * The descriptions of the objects of an org in the store (decision record 0086): written with a snapshot, read back
 * as they were written, and the objects a snapshot asks the org to describe.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DescriptionReading, ObjectDescription } from '../src/sources/describe.ts';
import {
  objectsWithFiles,
  readDescriptionReading,
  readDescriptions,
  writeDescriptions,
} from '../src/store/descriptions.ts';
import { addInventory, markRetrieved } from '../src/store/journal.ts';
import { MIGRATIONS } from '../src/store/migrate.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { ensureSource, insertSnapshot } from '../src/store/snapshots.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const T1 = '2026-01-31T09:31:10.500Z';
const T2 = '2026-01-31T09:40:00.000Z';

const PARCEL: ObjectDescription = {
  name: 'Parcel__c',
  fields: [
    { name: 'Depot__c', type: 'reference', referenceTo: ['Depot__c'], relationshipName: 'Depot__r' },
    { name: 'Id', type: 'id', referenceTo: [], relationshipName: null },
  ],
  childRelationships: [{ relationshipName: 'Scans__r', childSObject: 'Scan__c', field: 'Parcel__c' }],
};
const ACCOUNT: ObjectDescription = {
  name: 'Account',
  fields: [{ name: 'Name', type: 'string', referenceTo: [], relationshipName: null }],
  childRelationships: [],
};

const reading = (more: Partial<DescriptionReading> = {}): DescriptionReading => ({
  descriptions: [PARCEL, ACCOUNT],
  state: 'whole',
  requests: 2,
  unknown: [],
  failed: [],
  code: null,
  ...more,
});

describe.each(DRIVERS)('the descriptions of the objects of a snapshot with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = (): Store => openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });
  const snapshot = (store: Store, name = 'prod'): number =>
    store.write(() =>
      insertSnapshot(store, {
        sourceId: ensureSource(store, { name, kind: 'org', createdAt: T0 }),
        status: 'complete',
        startedAt: T0,
        finishedAt: T0,
        engineVersion: '0.2.0',
        gitCommit: null,
      }),
    );
  const count = (store: Store, table: string): number => Number(store.get(`SELECT count(*) AS n FROM ${table}`)?.['n']);

  it('reads back what was written: how the org was asked, and each description, sorted by object', () => {
    const store = open();
    const id = snapshot(store);
    // A snapshot the org was not asked for has neither.
    expect(readDescriptionReading(store, id)).toBeUndefined();
    expect(readDescriptions(store, id)).toEqual([]);

    store.write(() => {
      writeDescriptions(
        store,
        id,
        reading({ state: 'partial', unknown: ['Gone__c'], failed: ['Slow__c'], code: 'TIMEOUT' }),
        T1,
      );
    });
    expect(readDescriptionReading(store, id)).toEqual({
      state: 'partial',
      readAt: T1,
      requests: 2,
      asked: 4,
      unknown: 1,
      failed: 1,
      code: 'TIMEOUT',
    });
    expect(readDescriptions(store, id)).toEqual([ACCOUNT, PARCEL]);
    store.close();
  });

  it('replaces what a snapshot held when it is written again, and leaves another snapshot alone', () => {
    const store = open();
    const id = snapshot(store);
    const other = snapshot(store, 'sandbox');
    store.write(() => {
      writeDescriptions(store, id, reading(), T1);
      writeDescriptions(store, other, reading(), T1);
    });
    store.write(() => {
      writeDescriptions(store, id, reading({ descriptions: [ACCOUNT], requests: 1 }), T2);
    });
    expect(readDescriptionReading(store, id)).toMatchObject({ readAt: T2, requests: 1, asked: 1 });
    expect(readDescriptions(store, id)).toEqual([ACCOUNT]);
    expect(readDescriptions(store, other)).toEqual([ACCOUNT, PARCEL]);
    store.close();
  });

  it('keeps that the org described nothing, and refuses what is no reading', () => {
    const store = open();
    const id = snapshot(store);
    store.write(() => {
      writeDescriptions(
        store,
        id,
        reading({ descriptions: [], state: 'none', requests: 3, failed: ['A__c', 'B__c'], code: 'INVALID_SESSION_ID' }),
        T1,
      );
    });
    expect(readDescriptionReading(store, id)).toEqual({
      state: 'none',
      readAt: T1,
      requests: 3,
      asked: 2,
      unknown: 0,
      failed: 2,
      code: 'INVALID_SESSION_ID',
    });
    expect(readDescriptions(store, id)).toEqual([]);
    // A state the table does not know, and a description that is no object, are refused by it.
    expect(
      codeOf(() => {
        store.write(() => {
          writeDescriptions(store, id, reading({ state: 'most' as never }), T1);
        });
      }),
    ).toBe('STORE_FAILED');
    store.write(() => {
      writeDescriptions(store, id, reading(), T1);
    });
    expect(
      codeOf(() =>
        store.write(() =>
          store.run("UPDATE snapshot_object_description SET description = '[1]' WHERE snapshot_id = ?", id),
        ),
      ),
    ).toBe('STORE_FAILED');
    expect(
      codeOf(() =>
        store.write(() =>
          store.run("UPDATE snapshot_object_description SET description = 'not json' WHERE snapshot_id = ?", id),
        ),
      ),
    ).toBe('STORE_FAILED');
    expect(readDescriptions(store, id)).toEqual([ACCOUNT, PARCEL]);
    store.close();
  });

  it('keeps one description of an object that two names were described as, and counts both', () => {
    const store = open();
    const id = snapshot(store);
    store.write(() => {
      writeDescriptions(store, id, reading({ descriptions: [ACCOUNT, PARCEL, { ...ACCOUNT, fields: [] }] }), T1);
    });
    expect(readDescriptionReading(store, id)).toMatchObject({ state: 'whole', asked: 3, unknown: 0, failed: 0 });
    expect(readDescriptions(store, id)).toEqual([ACCOUNT, PARCEL]);
    store.close();
  });

  it('is written inside the write of its caller: a write that fails afterwards leaves nothing of it', () => {
    const store = open();
    const id = snapshot(store);
    expect(() =>
      store.write(() => {
        writeDescriptions(store, id, reading(), T1);
        throw new Error('the step failed');
      }),
    ).toThrow('the step failed');
    expect(readDescriptionReading(store, id)).toBeUndefined();
    expect(readDescriptions(store, id)).toEqual([]);
    store.close();
  });

  it('goes with its snapshot when the snapshot is removed', () => {
    const store = open();
    const id = snapshot(store);
    const other = snapshot(store, 'sandbox');
    store.write(() => {
      writeDescriptions(store, id, reading(), T1);
      writeDescriptions(store, other, reading(), T1);
    });
    store.write(() => store.run('DELETE FROM snapshot WHERE id = ?', id));
    expect(count(store, 'snapshot_description_reading')).toBe(1);
    expect(count(store, 'snapshot_object_description')).toBe(2);
    expect(readDescriptions(store, other)).toEqual([ACCOUNT, PARCEL]);
    store.close();
  });

  it('asks for every object of which the snapshot holds a file, by the name the org listed it with', () => {
    const store = open();
    const id = snapshot(store);
    const listed = (type: string, fullName: string, namespacePrefix: string | null = null) => ({
      type,
      fullName,
      salesforceId: null,
      lastModifiedAt: null,
      namespacePrefix,
      manageableState: namespacePrefix === null ? null : 'installed',
    });
    store.write(() => {
      addInventory(store, id, [
        listed('CustomObject', 'Parcel__c'),
        listed('CustomObject', 'Account'),
        // Listed and not handed out: the snapshot holds no file of it.
        listed('CustomObject', 'Withheld__c'),
        listed('CustomObject', 'pkg__Route__c', 'pkg'),
        listed('CustomField', 'Parcel__c.Weight__c'),
      ]);
      markRetrieved(store, id, [
        { type: 'CustomObject', fullName: 'Parcel__c' },
        { type: 'CustomObject', fullName: 'Account' },
        { type: 'CustomField', fullName: 'Parcel__c.Weight__c' },
        // Handed out although the org had not listed it.
        { type: 'CustomObject', fullName: 'Depot__c' },
      ]);
      // An object of a package that came back without its prefix is asked for with it, as the org listed it.
      const route = { type: 'CustomObject', fullName: 'pkg__Route__c' };
      markRetrieved(store, id, [{ type: 'CustomObject', fullName: 'Route__c' }], { asked: [route], notFound: [] });
    });
    expect(objectsWithFiles(store, id)).toEqual(['Account', 'Depot__c', 'Parcel__c', 'pkg__Route__c']);
    expect(objectsWithFiles(store, snapshot(store, 'repo'))).toEqual([]);
    store.close();
  });

  it('migrates a database of schema version 11: its snapshots are there, without descriptions', () => {
    const path = join(temp.next(), 'orglens.sqlite');
    const old = openStore({ path, driver, migrations: MIGRATIONS.slice(0, 11) });
    const id = snapshot(old);
    old.close();

    const store = openStore({ path, driver });
    expect(store.migrated).toEqual({ from: 11, to: MIGRATIONS.length });
    expect(readDescriptionReading(store, id)).toBeUndefined();
    expect(readDescriptions(store, id)).toEqual([]);
    store.write(() => {
      writeDescriptions(store, id, reading(), T1);
    });
    expect(readDescriptions(store, id)).toEqual([ACCOUNT, PARCEL]);
    store.close();
  });
});
