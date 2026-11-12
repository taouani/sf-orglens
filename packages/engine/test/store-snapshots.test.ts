import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../src/store/open.ts';
import {
  addCoverage,
  addIssue,
  addSnapshotFile,
  checkSource,
  ensureSource,
  finishSnapshot,
  insertSnapshot,
  putSnapshotFile,
  readCoverage,
  readIssues,
  readRunningSnapshot,
  readSnapshot,
} from '../src/store/snapshots.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const T1 = '2026-01-31T09:30:05.250Z';
const ORG = '00Dxx0000000001EAA';
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe.each(DRIVERS)('snapshots with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = () => openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });

  /** A snapshot that is finished, as every snapshot of a Git source is by the end of its transaction. */
  const begin = (store: ReturnType<typeof open>, name = 'repo', status: 'running' | 'complete' = 'complete'): number =>
    insertSnapshot(store, {
      sourceId: ensureSource(store, { name, kind: 'git', createdAt: T0 }),
      status,
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
    const id = begin(store, 'repo', 'running');
    addSnapshotFile(store, id, 'force-app/classes/A.cls', text('class A {}'));
    addSnapshotFile(store, id, 'force-app/classes/B.cls', text('class B { }'));
    addSnapshotFile(store, id, 'force-app/classes/Empty.cls', new Uint8Array(0));
    // Until it has ended, it is found by its number and as the snapshot that is being taken.
    expect(readSnapshot(store, 'repo')).toBeUndefined();
    expect(readRunningSnapshot(store, 'repo')).toEqual(readSnapshot(store, 'repo', id));
    expect(readSnapshot(store, 'repo', id)).toEqual({
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
    // How it ended is set at the end, and so is the commit: whether it holds one is known only then.
    finishSnapshot(store, id, { status: 'complete', finishedAt: T1, gitCommit: 'c'.repeat(40) });
    expect(readSnapshot(store, 'repo')).toMatchObject({
      status: 'complete',
      finishedAt: T1,
      gitCommit: 'c'.repeat(40),
    });
    expect(readRunningSnapshot(store, 'repo')).toBeUndefined();
    finishSnapshot(store, id, { status: 'partial', finishedAt: T1, gitCommit: null });
    expect(readSnapshot(store, 'repo')).toMatchObject({ status: 'partial', gitCommit: null });
    store.close();
  });

  it('takes the latest finished snapshot for the latest, not one that is being taken or was given up', () => {
    const store = open();
    const finished = begin(store);
    const givenUp = begin(store, 'repo', 'running');
    finishSnapshot(store, givenUp, { status: 'failed', finishedAt: T1, gitCommit: null });
    const running = begin(store, 'repo', 'running');
    expect(readSnapshot(store, 'repo')?.id).toBe(finished);
    expect(readRunningSnapshot(store, 'repo')?.id).toBe(running);
    expect(readSnapshot(store, 'repo', givenUp)?.status).toBe('failed');
    // A source has one snapshot that is being taken at most. Another source has its own.
    expect(codeOf(() => begin(store, 'repo', 'running'))).toBe('STORE_FAILED');
    begin(store, 'other', 'running');
    finishSnapshot(store, running, { status: 'complete', finishedAt: T1, gitCommit: null });
    expect(readSnapshot(store, 'repo')?.id).toBe(running);
    begin(store, 'repo', 'running');
    store.close();
  });

  it('records the API version an org was read with', () => {
    const store = open();
    const id = insertSnapshot(store, {
      sourceId: ensureSource(store, { name: 'prod', kind: 'org', createdAt: T0, orgId: ORG }),
      status: 'complete',
      startedAt: T0,
      finishedAt: T1,
      engineVersion: '1.2.3',
      apiVersion: '66.0',
      gitCommit: null,
    });
    expect(readSnapshot(store, 'prod', id)).toMatchObject({ kind: 'org', apiVersion: '66.0', gitCommit: null });
    store.close();
  });

  it('ties the name of an org source to the org of its first snapshot', () => {
    const store = open();
    // Nothing is known about a name that has no row, and looking changes nothing.
    expect(checkSource(store, { name: 'prod', kind: 'org', orgId: ORG })).toBeUndefined();
    expect(store.get('SELECT COUNT(*) AS sources FROM source')).toEqual({ sources: 0 });

    const id = ensureSource(store, { name: 'prod', kind: 'org', createdAt: T0, orgId: ORG });
    expect(checkSource(store, { name: 'prod', kind: 'org', orgId: ORG })).toEqual({ id, orgId: ORG });
    expect(ensureSource(store, { name: 'prod', kind: 'org', createdAt: T1, orgId: ORG })).toBe(id);
    const other = '00Dxx0000000002EAA';
    for (const refused of [
      () => checkSource(store, { name: 'prod', kind: 'org', orgId: other }),
      () => ensureSource(store, { name: 'prod', kind: 'org', createdAt: T1, orgId: other }),
    ]) {
      expect(codeOf(refused)).toBe('ORG_MISMATCH');
    }
    expect(store.get("SELECT org_id FROM source WHERE name = 'prod'")).toEqual({ org_id: ORG });

    // A row that names no org yet takes the org of the first snapshot that states one.
    const late = ensureSource(store, { name: 'uat', kind: 'sandbox', createdAt: T0 });
    expect(checkSource(store, { name: 'uat', kind: 'sandbox', orgId: other })).toEqual({ id: late, orgId: null });
    expect(ensureSource(store, { name: 'uat', kind: 'sandbox', createdAt: T1, orgId: other })).toBe(late);
    expect(store.get("SELECT org_id FROM source WHERE name = 'uat'")).toEqual({ org_id: other });
    expect(codeOf(() => checkSource(store, { name: 'uat', kind: 'org', orgId: other }))).toBe('SOURCE_INVALID');
    store.close();
  });

  it('adds a file to a snapshot that is being taken, or replaces it, and says which', () => {
    const store = open();
    const id = begin(store, 'repo', 'running');
    expect(putSnapshotFile(store, id, 'classes/A.cls', text('one'))).toBe(false);
    expect(putSnapshotFile(store, id, 'classes/B.cls', text('one'))).toBe(false);
    expect(putSnapshotFile(store, id, 'classes/A.cls', text('three'))).toBe(true);
    expect(readSnapshot(store, 'repo', id)).toMatchObject({ files: 2, bytes: 8 });
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
    addCoverage(store, id, { type: 'CustomField', listed: 31, retrieved: 30, analysed: 0, listing: 'ok', note: null });
    addCoverage(store, id, {
      type: 'ApexClass',
      listed: 12,
      retrieved: 12,
      analysed: 0,
      listing: 'ok',
      note: 'a note',
    });
    expect(readCoverage(store, id)).toEqual([
      { type: 'ApexClass', listed: 12, retrieved: 12, analysed: 0, listing: 'ok', note: 'a note' },
      { type: 'CustomField', listed: 31, retrieved: 30, analysed: 0, listing: 'ok', note: null },
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
    addCoverage(store, id, { type: 'ApexClass', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null });
    addIssue(store, id, { severity: 'info', code: 'X', message: 'x', componentKey: null, details: null });
    store.run('DELETE FROM snapshot WHERE id = ?', id);
    expect(readCoverage(store, id)).toEqual([]);
    expect(readIssues(store, id)).toEqual([]);
    expect(store.get('SELECT COUNT(*) AS files FROM snapshot_file')).toEqual({ files: 0 });
    expect(store.get('SELECT COUNT(*) AS blobs FROM blob')).toEqual({ blobs: 1 });
    store.close();
  });
});
