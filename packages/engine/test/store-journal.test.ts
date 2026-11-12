import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addChunks,
  addInventory,
  chunkEnded,
  chunkForgotten,
  chunkStarted,
  countChunks,
  countInventory,
  markRetrieved,
  missingComponents,
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
