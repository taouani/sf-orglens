/**
 * The journal of a snapshot of an org: what the org listed, the chunks of
 * the retrieve with the state of each, and what came back.
 *
 * A snapshot of an org is written in many small transactions over minutes.
 * After each of them the database says exactly how far the snapshot is, so
 * that a process that was stopped anywhere is picked up by the next one.
 */
import type { Store } from './open.ts';

/** A component to retrieve. */
export interface ChunkMember {
  readonly type: string;
  readonly fullName: string;
}

/** A component the org listed. */
export interface InventoryRow extends ChunkMember {
  readonly salesforceId: string | null;
  readonly lastModifiedAt: string | null;
  readonly namespacePrefix: string | null;
  readonly manageableState: string | null;
}

/** Stores what the org listed. */
export function addInventory(store: Store, snapshotId: number, items: readonly InventoryRow[]): void {
  for (const item of items) {
    store.run(
      `INSERT INTO inventory_item
         (snapshot_id, type, full_name, salesforce_id, last_modified_at, namespace_prefix, manageable_state)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      snapshotId,
      item.type,
      item.fullName,
      item.salesforceId,
      item.lastModifiedAt,
      item.namespacePrefix,
      item.manageableState,
    );
  }
}

/**
 * Notes the components that came back in a retrieve. One that the org had
 * not listed gets a row of its own, marked as not listed.
 */
export function markRetrieved(store: Store, snapshotId: number, components: readonly ChunkMember[]): void {
  for (const component of components) {
    store.run(
      `INSERT INTO inventory_item (snapshot_id, type, full_name, listed, retrieved) VALUES (?, ?, ?, 0, 1)
       ON CONFLICT (snapshot_id, type, full_name) DO UPDATE SET retrieved = 1`,
      snapshotId,
      component.type,
      component.fullName,
    );
  }
}

/** Per type: how many components the org listed, how many of those came back, and how many came back unlisted. */
export function countInventory(
  store: Store,
  snapshotId: number,
): Map<string, { listed: number; retrieved: number; unlisted: number }> {
  const counts = new Map<string, { listed: number; retrieved: number; unlisted: number }>();
  const rows = store.all(
    `SELECT type, SUM(listed) AS listed, SUM(listed AND retrieved) AS retrieved, SUM(NOT listed) AS unlisted
       FROM inventory_item WHERE snapshot_id = ? GROUP BY type`,
    snapshotId,
  );
  for (const row of rows) {
    counts.set(String(row['type']), {
      listed: Number(row['listed']),
      retrieved: Number(row['retrieved']),
      unlisted: Number(row['unlisted']),
    });
  }
  return counts;
}

/** The components of a type that the org listed and that did not come back, sorted by name. */
export function missingComponents(store: Store, snapshotId: number, type: string): string[] {
  return store
    .all(
      `SELECT full_name FROM inventory_item
        WHERE snapshot_id = ? AND type = ? AND listed = 1 AND retrieved = 0 ORDER BY full_name`,
      snapshotId,
      type,
    )
    .map((row) => String(row['full_name']));
}

/** The components of a type that came back although the org had not listed them, sorted by name. */
export function unlistedComponents(store: Store, snapshotId: number, type: string): string[] {
  return store
    .all(
      'SELECT full_name FROM inventory_item WHERE snapshot_id = ? AND type = ? AND listed = 0 ORDER BY full_name',
      snapshotId,
      type,
    )
    .map((row) => String(row['full_name']));
}

type ChunkStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Chunk {
  readonly seq: number;
  readonly status: ChunkStatus;
  readonly members: readonly ChunkMember[];
  /** How often a retrieve was started for the chunk. */
  readonly attempts: number;
  /** The job at Salesforce that retrieves the chunk, if one was started and its result is not stored yet. */
  readonly jobId: string | null;
}

/** The members of a chunk, as they are stored: grouped by type, to keep thousands of names short. */
function packMembers(members: readonly ChunkMember[]): string {
  const byType = new Map<string, string[]>();
  for (const { type, fullName } of members) {
    const names = byType.get(type);
    if (names === undefined) byType.set(type, [fullName]);
    else names.push(fullName);
  }
  return JSON.stringify([...byType].map(([type, names]) => ({ type, members: names })));
}

function unpackMembers(text: string): ChunkMember[] {
  const groups = JSON.parse(text) as { type: string; members: string[] }[];
  return groups.flatMap(({ type, members }) => members.map((fullName) => ({ type, fullName })));
}

/** Stores the plan of a retrieve: its chunks in order, none started. */
export function addChunks(store: Store, snapshotId: number, chunks: readonly (readonly ChunkMember[])[]): void {
  chunks.forEach((members, seq) => {
    store.run(
      "INSERT INTO retrieve_chunk (snapshot_id, seq, status, members) VALUES (?, ?, 'pending', ?)",
      snapshotId,
      seq,
      packMembers(members),
    );
  });
}

/**
 * The chunk to work on next: one that was started and not finished, or
 * else the first that was not started. `undefined` when none is left.
 */
export function nextChunk(store: Store, snapshotId: number): Chunk | undefined {
  const row = store.get(
    `SELECT seq, status, members, attempts, job_id FROM retrieve_chunk
      WHERE snapshot_id = ? AND status IN ('running', 'pending')
      ORDER BY status = 'running' DESC, seq LIMIT 1`,
    snapshotId,
  );
  if (row === undefined) return undefined;
  return {
    seq: Number(row['seq']),
    status: String(row['status']) as ChunkStatus,
    members: unpackMembers(String(row['members'])),
    attempts: Number(row['attempts']),
    jobId: typeof row['job_id'] === 'string' ? row['job_id'] : null,
  };
}

/** How many chunks a snapshot has in each state. */
export function countChunks(store: Store, snapshotId: number): Record<ChunkStatus, number> & { total: number } {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, total: 0 };
  for (const row of store.all(
    'SELECT status, COUNT(*) AS n FROM retrieve_chunk WHERE snapshot_id = ? GROUP BY status',
    snapshotId,
  )) {
    counts[String(row['status']) as ChunkStatus] = Number(row['n']);
    counts.total += Number(row['n']);
  }
  return counts;
}

/** A retrieve was started for the chunk. From now on its job is what a resumed snapshot asks for. */
export function chunkStarted(store: Store, snapshotId: number, seq: number, jobId: string, at: string): void {
  store.run(
    `UPDATE retrieve_chunk SET status = 'running', job_id = ?, attempts = attempts + 1, started_at = ?, error = NULL
      WHERE snapshot_id = ? AND seq = ?`,
    jobId,
    at,
    snapshotId,
    seq,
  );
}

/** The chunk ended: its files are stored, or it failed for good. */
export function chunkEnded(
  store: Store,
  snapshotId: number,
  seq: number,
  end: { readonly status: 'done' | 'failed'; readonly at: string; readonly error: string | null },
): void {
  store.run(
    'UPDATE retrieve_chunk SET status = ?, job_id = NULL, finished_at = ?, error = ? WHERE snapshot_id = ? AND seq = ?',
    end.status,
    end.at,
    end.error,
    snapshotId,
    seq,
  );
}

/** The job of the chunk is gone. The chunk is to be started again. */
export function chunkForgotten(store: Store, snapshotId: number, seq: number): void {
  store.run(
    "UPDATE retrieve_chunk SET status = 'pending', job_id = NULL WHERE snapshot_id = ? AND seq = ?",
    snapshotId,
    seq,
  );
}

/**
 * Replaces a chunk by two: it keeps the first members, and a new chunk at
 * the end gets the others. Both are to be started.
 */
export function splitChunk(
  store: Store,
  snapshotId: number,
  seq: number,
  halves: readonly [readonly ChunkMember[], readonly ChunkMember[]],
): void {
  store.run(
    "UPDATE retrieve_chunk SET status = 'pending', job_id = NULL, attempts = 0, members = ? WHERE snapshot_id = ? AND seq = ?",
    packMembers(halves[0]),
    snapshotId,
    seq,
  );
  store.run(
    `INSERT INTO retrieve_chunk (snapshot_id, seq, status, members)
     SELECT ?, MAX(seq) + 1, 'pending', ? FROM retrieve_chunk WHERE snapshot_id = ?`,
    snapshotId,
    packMembers(halves[1]),
    snapshotId,
  );
}

/**
 * Sets the number of retrieved components of every type of a snapshot to what the inventory says now: the
 * components the source listed that came back.
 */
export function refreshCoverage(store: Store, snapshotId: number): void {
  store.run(
    `UPDATE snapshot_type_coverage SET retrieved = (
       SELECT COUNT(*) FROM inventory_item i
        WHERE i.snapshot_id = snapshot_type_coverage.snapshot_id AND i.type = snapshot_type_coverage.type
          AND i.listed = 1 AND i.retrieved = 1)
      WHERE snapshot_id = ?`,
    snapshotId,
  );
}
