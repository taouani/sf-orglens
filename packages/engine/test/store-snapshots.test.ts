import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../src/store/open.ts';
import {
  addCoverage,
  addIssue,
  addSnapshotFile,
  ensureSource,
  finishSnapshot,
  insertSnapshot,
  readCoverage,
  readIssues,
  readSnapshot,
} from '../src/store/snapshots.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const T1 = '2026-01-31T09:30:05.250Z';
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe.each(DRIVERS)('snapshots with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = () => openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });

  const begin = (store: ReturnType<typeof open>, name = 'repo'): number =>
    insertSnapshot(store, {
      sourceId: ensureSource(store, { name, kind: 'git', createdAt: T0 }),
      status: 'running',
      startedAt: T0,
      finishedAt: null,
      engineVersion: '1.2.3',
      gitCommit: 'a'.repeat(40),
    });

  it('creates the row of a source once and finds it again', () => {
    const store = open();
    const first = ensureSource(store, { name: 'repo', kind: 'git', createdAt: T0 });
    expect(ensureSource(store, { name: 'repo', kind: 'git', createdAt: T1 })).toBe(first);
    expect(ensureSource(store, { name: 'other', kind: 'git', createdAt: T1 })).not.toBe(first);
    expect(store.all('SELECT name, kind, created_at FROM source ORDER BY id')).toEqual([
      { name: 'repo', kind: 'git', created_at: T0 },
      { name: 'other', kind: 'git', created_at: T1 },
    ]);
    store.close();
  });

  it('refuses a name that belongs to a source of another kind', () => {
    const store = open();
    ensureSource(store, { name: 'prod', kind: 'org', createdAt: T0 });
    expect(codeOf(() => ensureSource(store, { name: 'prod', kind: 'git', createdAt: T0 }))).toBe('SOURCE_INVALID');
    store.close();
  });

  it('stores a snapshot with its files, and reads it back with their number and size', () => {
    const store = open();
    const id = begin(store);
    addSnapshotFile(store, id, 'force-app/classes/A.cls', text('class A {}'));
    addSnapshotFile(store, id, 'force-app/classes/B.cls', text('class B { }'));
    addSnapshotFile(store, id, 'force-app/classes/Empty.cls', new Uint8Array(0));
    expect(readSnapshot(store, 'repo')).toEqual({
      id,
      source: 'repo',
      kind: 'git',
      status: 'running',
      startedAt: T0,
      finishedAt: null,
      engineVersion: '1.2.3',
      apiVersion: null,
      gitCommit: 'a'.repeat(40),
      files: 3,
      bytes: 21,
    });
    finishSnapshot(store, id, 'complete', T1);
    expect(readSnapshot(store, 'repo')).toMatchObject({ status: 'complete', finishedAt: T1 });
    store.close();
  });

  it('refuses the same path twice in one snapshot', () => {
    const store = open();
    const id = begin(store);
    addSnapshotFile(store, id, 'a.cls', text('one'));
    expect(
      codeOf(() => {
        addSnapshotFile(store, id, 'a.cls', text('two'));
      }),
    ).toBe('STORE_FAILED');
    store.close();
  });

  it('stores the content of a file once for all snapshots that hold it', () => {
    const store = open();
    const first = begin(store);
    const second = begin(store);
    for (const id of [first, second]) {
      addSnapshotFile(store, id, 'a.cls', text('the same content'));
      addSnapshotFile(store, id, 'copy.cls', text('the same content'));
    }
    addSnapshotFile(store, second, 'b.cls', text('other content'));
    expect(store.get('SELECT COUNT(*) AS blobs FROM blob')).toEqual({ blobs: 2 });
    expect(readSnapshot(store, 'repo', first)).toMatchObject({ files: 2, bytes: 32 });
    expect(readSnapshot(store, 'repo', second)).toMatchObject({ files: 3, bytes: 45 });
    store.close();
  });

  it('reads the latest snapshot of a source, or the one with a given id, and none of another source', () => {
    const store = open();
    const first = begin(store);
    const second = begin(store);
    const other = begin(store, 'other');
    expect(readSnapshot(store, 'repo')?.id).toBe(second);
    expect(readSnapshot(store, 'repo', first)?.id).toBe(first);
    expect(readSnapshot(store, 'repo', other)).toBeUndefined();
    expect(readSnapshot(store, 'repo', 999)).toBeUndefined();
    expect(readSnapshot(store, 'unknown')).toBeUndefined();
    store.close();
  });

  it('stores coverage and reads it sorted by type', () => {
    const store = open();
    const id = begin(store);
    addCoverage(store, id, { type: 'CustomField', listed: 31, retrieved: 30, analysed: 0, note: null });
    addCoverage(store, id, { type: 'ApexClass', listed: 12, retrieved: 12, analysed: 0, note: 'a note' });
    expect(readCoverage(store, id)).toEqual([
      { type: 'ApexClass', listed: 12, retrieved: 12, analysed: 0, note: 'a note' },
      { type: 'CustomField', listed: 31, retrieved: 30, analysed: 0, note: null },
    ]);
    expect(readCoverage(store, begin(store))).toEqual([]);
    store.close();
  });

  it('stores issues and reads them in the order they were recorded, with their details', () => {
    const store = open();
    const id = begin(store);
    const issues = [
      {
        severity: 'warning' as const,
        code: 'FILES_NOT_METADATA',
        message: '2 files are not part of a metadata component.',
        componentKey: null,
        details: { count: 2, paths: ['a.txt', 'b.txt'] },
      },
      {
        severity: 'error' as const,
        code: 'FILE_UNREADABLE',
        message: 'x could not be read.',
        componentKey: 'ApexClass:x',
        details: null,
      },
    ];
    for (const issue of issues) addIssue(store, id, issue);
    expect(readIssues(store, id)).toEqual(issues);
    store.close();
  });

  it('removes files, coverage and issues with their snapshot, and keeps the contents', () => {
    const store = open();
    const id = begin(store);
    addSnapshotFile(store, id, 'a.cls', text('content'));
    addCoverage(store, id, { type: 'ApexClass', listed: 1, retrieved: 1, analysed: 0, note: null });
    addIssue(store, id, { severity: 'info', code: 'X', message: 'x', componentKey: null, details: null });
    store.run('DELETE FROM snapshot WHERE id = ?', id);
    expect(readCoverage(store, id)).toEqual([]);
    expect(readIssues(store, id)).toEqual([]);
    expect(store.get('SELECT COUNT(*) AS files FROM snapshot_file')).toEqual({ files: 0 });
    expect(store.get('SELECT COUNT(*) AS blobs FROM blob')).toEqual({ blobs: 1 });
    store.close();
  });
});
