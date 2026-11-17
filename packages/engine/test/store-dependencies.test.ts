/**
 * The rows of the Dependency API in the store: written with a snapshot, read back as they were written, and
 * kept apart from the references of the analysis.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DependencyReading, DependencyRow } from '../src/sources/dependency-api.ts';
import { readAnalysis, writeAnalysis } from '../src/store/analysis.ts';
import {
  readDependencyReading,
  readDependencyRows,
  readListedIds,
  writeDependencies,
} from '../src/store/dependencies.ts';
import { addInventory, markRetrieved } from '../src/store/journal.ts';
import { MIGRATIONS } from '../src/store/migrate.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { ensureSource, insertSnapshot } from '../src/store/snapshots.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const T1 = '2026-01-31T09:31:10.500Z';
const T2 = '2026-01-31T09:40:00.000Z';

const row = (from: readonly [string, string, string], to: readonly [string, string, string]): DependencyRow => ({
  from: { type: from[0], id: from[1], name: from[2], namespace: null },
  to: { type: to[0], id: to[1], name: to[2], namespace: null },
});

const ROWS: DependencyRow[] = [
  row(['ValidationRule', '03dxx0000000001AAA', 'Amount_Positive'], ['CustomField', '00Nxx0000000001AAA', 'Amount']),
  // A standard object has its name in the place of an id.
  row(['CustomField', '00Nxx0000000002AAA', 'Total'], ['StandardEntity', 'Account', 'Account']),
  {
    from: { type: 'ApexClass', id: '01pxx0000000001AAA', name: 'Billing', namespace: 'pkg' },
    to: { type: 'CustomField', id: '00Nxx0000000001AAA', name: 'Amount', namespace: null },
  },
];

const reading = (more: Partial<DependencyReading> = {}): DependencyReading => ({
  rows: ROWS,
  state: 'whole',
  requests: 1,
  cutOff: 0,
  failed: 0,
  unproven: 0,
  code: null,
  ...more,
});

describe.each(DRIVERS)('the rows of the Dependency API of a snapshot with $name', (driver) => {
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

  it('reads back what was written: how the API was read, and the rows in their order', () => {
    const store = open();
    const id = snapshot(store);
    // A snapshot the API was not asked for has neither.
    expect(readDependencyReading(store, id)).toBeUndefined();
    expect(readDependencyRows(store, id)).toEqual([]);

    store.write(() => {
      writeDependencies(
        store,
        id,
        reading({ state: 'partial', requests: 12, cutOff: 2, failed: 1, unproven: 3, code: 'TIMEOUT' }),
        T1,
      );
    });
    expect(readDependencyReading(store, id)).toEqual({
      state: 'partial',
      readAt: T1,
      requests: 12,
      cutOff: 2,
      failed: 1,
      unproven: 3,
      code: 'TIMEOUT',
      rows: 3,
    });
    expect(readDependencyRows(store, id)).toEqual(ROWS);
    store.close();
  });

  it('replaces what a snapshot held when it is written again, and leaves another snapshot alone', () => {
    const store = open();
    const first = snapshot(store);
    const second = snapshot(store, 'sandbox');
    store.write(() => {
      writeDependencies(store, first, reading(), T1);
      writeDependencies(store, second, reading({ rows: ROWS.slice(0, 2) }), T1);
    });
    // A snapshot that was interrupted while the API was read asks again when it is continued.
    store.write(() => {
      writeDependencies(store, first, reading({ rows: ROWS.slice(2), requests: 4 }), T2);
    });
    expect(readDependencyReading(store, first)).toMatchObject({ readAt: T2, requests: 4, rows: 1 });
    expect(readDependencyRows(store, first)).toEqual(ROWS.slice(2));
    expect(readDependencyReading(store, second)).toMatchObject({ readAt: T1, rows: 2 });
    expect(readDependencyRows(store, second)).toEqual(ROWS.slice(0, 2));
    store.close();
  });

  it('keeps that the org gave no answer, with the code, and no row', () => {
    const store = open();
    const id = snapshot(store);
    store.write(() => {
      writeDependencies(
        store,
        id,
        reading({ rows: [], state: 'none', requests: 3, failed: 2, code: 'INVALID_TYPE' }),
        T1,
      );
    });
    expect(readDependencyReading(store, id)).toEqual({
      state: 'none',
      readAt: T1,
      requests: 3,
      cutOff: 0,
      failed: 2,
      unproven: 0,
      code: 'INVALID_TYPE',
      rows: 0,
    });
    // A state the table does not know is refused by it.
    expect(
      codeOf(() => {
        store.write(() => {
          writeDependencies(store, id, reading({ state: 'most' as never }), T1);
        });
      }),
    ).toBe('STORE_FAILED');
    expect(readDependencyReading(store, id)?.state).toBe('none');
    store.close();
  });

  it('is written inside the write of its caller: a write that fails afterwards leaves nothing of it', () => {
    const store = open();
    const id = snapshot(store);
    // The caller writes the issues of the reading in the same step.
    expect(() =>
      store.write(() => {
        writeDependencies(store, id, reading(), T1);
        throw new Error('the step failed');
      }),
    ).toThrow('the step failed');
    expect(readDependencyReading(store, id)).toBeUndefined();
    expect(readDependencyRows(store, id)).toEqual([]);
    store.close();
  });

  it('holds the rows apart from the references: no component, no version and no reference is written for them', () => {
    const store = open();
    const id = snapshot(store);
    store.write(() => {
      writeDependencies(store, id, reading(), T1);
    });
    for (const table of ['component', 'component_version', 'reference', 'snapshot_component']) {
      expect(count(store, table), table).toBe(0);
    }
    // An analysis that replaces the one before does not touch them.
    const analysis = { engineVersion: '0.2.0', analysedAt: T1, types: [], components: [], work: [], issues: [] };
    writeAnalysis(store, id, analysis);
    writeAnalysis(store, id, { ...analysis, analysedAt: T2 });
    expect(readDependencyRows(store, id)).toEqual(ROWS);
    expect(readDependencyReading(store, id)?.rows).toBe(3);
    store.close();
  });

  it('goes with its snapshot when the snapshot is removed', () => {
    const store = open();
    const id = snapshot(store);
    const other = snapshot(store, 'sandbox');
    store.write(() => {
      writeDependencies(store, id, reading(), T1);
      writeDependencies(store, other, reading(), T1);
    });
    store.write(() => store.run('DELETE FROM snapshot WHERE id = ?', id));
    expect(count(store, 'snapshot_dependency_reading')).toBe(1);
    expect(count(store, 'snapshot_dependency')).toBe(3);
    expect(readDependencyRows(store, other)).toEqual(ROWS);
    store.close();
  });

  it('gives what the org listed with the id of each component, and nothing that only came back', () => {
    const store = open();
    const id = snapshot(store);
    const listed = (type: string, fullName: string, salesforceId: string | null) => ({
      type,
      fullName,
      salesforceId,
      lastModifiedAt: null,
      namespacePrefix: null,
      manageableState: null,
    });
    store.write(() => {
      addInventory(store, id, [
        listed('CustomField', 'Invoice__c.Total__c', '00Nxx0000000002AAA'),
        listed('CustomField', 'Invoice__c.Amount__c', '00Nxx0000000001AAA'),
        // A standard object is listed without an id.
        listed('CustomObject', 'Account', null),
      ]);
      // A component that came back although the org had not listed it has no id of the org.
      markRetrieved(store, id, [{ type: 'CustomObject', fullName: 'Invoice__c' }]);
    });
    expect(readListedIds(store, id)).toEqual([
      { type: 'CustomField', fullName: 'Invoice__c.Amount__c', id: '00Nxx0000000001AAA' },
      { type: 'CustomField', fullName: 'Invoice__c.Total__c', id: '00Nxx0000000002AAA' },
      { type: 'CustomObject', fullName: 'Account', id: null },
    ]);
    expect(readListedIds(store, snapshot(store, 'repo'))).toEqual([]);
    store.close();
  });

  it('keeps the comparison with the analysis it was made for, and loses it with the next analysis that has none', () => {
    const store = open();
    const id = snapshot(store);
    const analysis = { engineVersion: '0.2.0', analysedAt: T1, types: [], components: [], work: [], issues: [] };
    const comparison = { rows: 3, missed: [{ from: 'ValidationRule:a.b', to: 'CustomField:a.c' }], agreed: 0 };
    writeAnalysis(store, id, { ...analysis, crossCheck: comparison });
    expect(readAnalysis(store, id)?.crossCheck).toEqual(comparison);
    writeAnalysis(store, id, analysis);
    expect(readAnalysis(store, id)?.crossCheck).toBeNull();
    // What is stored is an object. The table refuses anything else.
    expect(
      codeOf(() =>
        store.write(() => store.run(`UPDATE snapshot_analysis SET cross_check = '[1]' WHERE snapshot_id = ?`, id)),
      ),
    ).toBe('STORE_FAILED');
    store.close();
  });

  it('migrates a database of schema version 5: its snapshots and analyses are there, without a cross-check', () => {
    const path = join(temp.next(), 'orglens.sqlite');
    const old = openStore({ path, driver, migrations: MIGRATIONS.slice(0, 5) });
    const id = snapshot(old);
    writeAnalysisBeforeCrossCheck(old, id);
    old.close();

    const store = openStore({ path, driver });
    expect(store.migrated).toEqual({ from: 5, to: MIGRATIONS.length });
    expect(readAnalysis(store, id)).toMatchObject({ engineVersion: '0.2.0', crossCheck: null });
    expect(readDependencyReading(store, id)).toBeUndefined();
    expect(readDependencyRows(store, id)).toEqual([]);
    store.write(() => {
      writeDependencies(store, id, reading(), T1);
    });
    expect(readDependencyRows(store, id)).toEqual(ROWS);
    store.close();
  });
});

/** The row of an analysis as the engine wrote it at schema version 5, before an analysis kept a comparison. */
function writeAnalysisBeforeCrossCheck(store: Store, snapshotId: number): void {
  store.write(() =>
    store.run(
      `INSERT INTO snapshot_analysis (snapshot_id, engine_version, analysed_at, components, refs, types)
       VALUES (?, '0.2.0', ?, 0, 0, '[]')`,
      snapshotId,
      T1,
    ),
  );
}
