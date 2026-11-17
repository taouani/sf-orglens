/**
 * The rows of the Dependency API of Salesforce that a snapshot of an org holds (decision record 0045).
 *
 * They are stored as Salesforce wrote them, beside the snapshot. They are no references: no version of a
 * component holds them, and the graph of a snapshot (`graph.ts`) does not read these tables.
 */
import type { DependencyReading, DependencyRow } from '../sources/dependency-api.ts';
import type { Store } from './open.ts';

/** How the Dependency API was read for a snapshot. */
export interface StoredDependencyReading {
  readonly state: DependencyReading['state'];
  /** UTC, as `Date.prototype.toISOString` writes it. */
  readonly readAt: string;
  readonly requests: number;
  readonly cutOff: number;
  readonly failed: number;
  readonly unproven: number;
  readonly code: string | null;
  /** How many rows the snapshot holds. */
  readonly rows: number;
}

/**
 * Stores what was read of the Dependency API for a snapshot. What the snapshot held of it before is replaced.
 * It is called inside a write of the caller, as the other writers of a snapshot are.
 */
export function writeDependencies(store: Store, snapshotId: number, reading: DependencyReading, readAt: string): void {
  store.run('DELETE FROM snapshot_dependency_reading WHERE snapshot_id = ?', snapshotId);
  store.run(
    `INSERT INTO snapshot_dependency_reading (snapshot_id, state, read_at, requests, cut_off, failed, unproven, code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshotId,
    reading.state,
    readAt,
    reading.requests,
    reading.cutOff,
    reading.failed,
    reading.unproven,
    reading.code,
  );
  reading.rows.forEach(({ from, to }, seq) => {
    store.run(
      `INSERT INTO snapshot_dependency
         (snapshot_id, seq, from_type, from_id, from_name, from_namespace, to_type, to_id, to_name, to_namespace)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      snapshotId,
      seq,
      from.type,
      from.id,
      from.name,
      from.namespace,
      to.type,
      to.id,
      to.name,
      to.namespace,
    );
  });
}

/** How the Dependency API was read for a snapshot, or `undefined` for a snapshot it was not asked for. */
export function readDependencyReading(store: Store, snapshotId: number): StoredDependencyReading | undefined {
  const row = store.get(
    `SELECT state, read_at, requests, cut_off, failed, unproven, code,
            (SELECT COUNT(*) FROM snapshot_dependency held WHERE held.snapshot_id = reading.snapshot_id) AS held
       FROM snapshot_dependency_reading reading WHERE snapshot_id = ?`,
    snapshotId,
  );
  if (row === undefined) return undefined;
  const state = String(row['state']);
  return {
    state: state === 'whole' || state === 'partial' ? state : 'none',
    readAt: String(row['read_at']),
    requests: Number(row['requests']),
    cutOff: Number(row['cut_off']),
    failed: Number(row['failed']),
    unproven: Number(row['unproven']),
    code: typeof row['code'] === 'string' ? row['code'] : null,
    rows: Number(row['held']),
  };
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The rows of the Dependency API a snapshot holds, in the order they were stored in. */
export function readDependencyRows(store: Store, snapshotId: number): DependencyRow[] {
  return store
    .all(
      `SELECT from_type, from_id, from_name, from_namespace, to_type, to_id, to_name, to_namespace
         FROM snapshot_dependency WHERE snapshot_id = ? ORDER BY seq`,
      snapshotId,
    )
    .map((row) => ({
      from: {
        type: String(row['from_type']),
        id: String(row['from_id']),
        name: String(row['from_name']),
        namespace: text(row['from_namespace']),
      },
      to: {
        type: String(row['to_type']),
        id: String(row['to_id']),
        name: String(row['to_name']),
        namespace: text(row['to_namespace']),
      },
    }));
}

/** A component the org listed, with the id the org gave it. */
export interface ListedId {
  readonly type: string;
  readonly fullName: string;
  /** `null` for a component the org listed without an id, such as a standard object. */
  readonly id: string | null;
}

/** What the org listed for a snapshot: every component with its id. Empty for a snapshot of a repository. */
export function readListedIds(store: Store, snapshotId: number): ListedId[] {
  return store
    .all(
      'SELECT type, full_name, salesforce_id FROM inventory_item WHERE snapshot_id = ? AND listed = 1 ORDER BY type, full_name',
      snapshotId,
    )
    .map((row) => ({
      type: String(row['type']),
      fullName: String(row['full_name']),
      id: text(row['salesforce_id']),
    }));
}
