/**
 * Writing into a database of an older schema, the way the engine of that time did.
 */
import type { Store } from '../../src/store/open.ts';
import type { NewSnapshot } from '../../src/store/snapshots.ts';

/**
 * The row of a snapshot as the engine wrote it up to schema version 3, before a snapshot kept the layout of its
 * files. The statement of today names that column, which a database of an older schema does not have.
 */
export function insertSnapshotBeforeLayout(store: Store, snapshot: Omit<NewSnapshot, 'layout'>): number {
  return store.run(
    `INSERT INTO snapshot (source_id, status, started_at, finished_at, engine_version, api_version, git_commit)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    snapshot.sourceId,
    snapshot.status,
    snapshot.startedAt,
    snapshot.finishedAt,
    snapshot.engineVersion,
    snapshot.apiVersion ?? null,
    snapshot.gitCommit,
  ).lastInsertRowid;
}
