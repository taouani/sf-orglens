/**
 * The rows of the Dependency API of Salesforce that a snapshot of an org holds (decision record 0045).
 *
 * They are stored as Salesforce wrote them, beside the snapshot. They are no references: no version of a
 * component holds them, and the graph of a snapshot (`graph.ts`) does not read these tables.
 */
import type { DependencyReading, DependencyRow, FlowVersionIds } from '../sources/dependency-api.ts';
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
 * It is called inside a write of the caller, as the other writers of a snapshot are. How many of the queries
 * that were cut off another answer showed to be (`disagreed`) is not stored: no column holds it.
 */
export function writeDependencies(
  store: Store,
  snapshotId: number,
  reading: Omit<DependencyReading, 'disagreed'>,
  readAt: string,
): void {
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
  /**
   * The name the snapshot holds the component under: the name it came back with where that is another than the
   * listed one, such as the name of a component of a package without its prefix (decision record 0076), and else
   * the listed name.
   */
  readonly fullName: string;
  /** The name the org listed the component with, where the snapshot holds it under another. */
  readonly listedAs?: string;
  /** `null` for a component the org listed without an id, such as a standard object. */
  readonly id: string | null;
}

/** What the org listed for a snapshot: every component with its id. Empty for a snapshot of a repository. */
export function readListedIds(store: Store, snapshotId: number): ListedId[] {
  return store
    .all(
      `SELECT type, COALESCE(came_back_as, full_name) AS name, full_name, came_back_as, salesforce_id
         FROM inventory_item WHERE snapshot_id = ? AND listed = 1 ORDER BY type, name`,
      snapshotId,
    )
    .map((row) => ({
      type: String(row['type']),
      fullName: String(row['name']),
      ...(row['came_back_as'] === null ? {} : { listedAs: String(row['full_name']) }),
      id: text(row['salesforce_id']),
    }));
}

/**
 * Stores the versions of the flows the org named when the Dependency API was read for a snapshot (decision records
 * 0067 and 0078). It is called inside a write of the caller, after `writeDependencies`, which takes away what the
 * snapshot held of them before.
 */
export function writeFlowVersions(store: Store, snapshotId: number, flows: readonly FlowVersionIds[]): void {
  for (const { flow, active, latest, others } of flows) {
    store.run(
      'INSERT INTO snapshot_flow_version (snapshot_id, flow, active_id, latest_id) VALUES (?, ?, ?, ?)',
      snapshotId,
      flow,
      active,
      latest,
    );
    for (const id of new Set(others)) {
      store.run(
        'INSERT INTO snapshot_flow_other_version (snapshot_id, flow, version_id) VALUES (?, ?, ?)',
        snapshotId,
        flow,
        id,
      );
    }
  }
}

/** The versions of the flows of a snapshot, sorted by flow. Empty where the org was not asked or did not answer. */
export function readFlowVersionIds(store: Store, snapshotId: number): FlowVersionIds[] {
  const others = new Map<string, string[]>();
  for (const row of store.all(
    'SELECT flow, version_id FROM snapshot_flow_other_version WHERE snapshot_id = ? ORDER BY flow, version_id',
    snapshotId,
  )) {
    const flow = String(row['flow']);
    const ofFlow = others.get(flow);
    if (ofFlow === undefined) others.set(flow, [String(row['version_id'])]);
    else ofFlow.push(String(row['version_id']));
  }
  return store
    .all('SELECT flow, active_id, latest_id FROM snapshot_flow_version WHERE snapshot_id = ? ORDER BY flow', snapshotId)
    .map((row) => ({
      flow: String(row['flow']),
      active: text(row['active_id']),
      latest: text(row['latest_id']),
      others: others.get(String(row['flow'])) ?? [],
    }));
}
