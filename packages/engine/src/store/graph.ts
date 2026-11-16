/**
 * Reading the components and references of one snapshot.
 *
 * `SnapshotGraph` is the one interface an engine reads them through. `sqlGraph` answers each question with a
 * statement on the database. An engine that walks many references can be given another implementation, such as
 * an index held in memory, and does not know the difference (decision record 0040).
 */
import { EngineError, type JsonValue } from '../core/errors.ts';
import type { ComponentKey } from '../core/keys.ts';
import type { Reference } from '../core/references.ts';
import { REFERENCE_NAMES } from './analysis.ts';
import type { SqlRow } from './driver.ts';
import type { Store } from './open.ts';

/** A component as one snapshot knows it. */
export interface GraphComponent {
  /** The id of the key in the database. It is the same in every snapshot. */
  readonly id: number;
  readonly key: ComponentKey;
  /** The component that contains this one, as the key says it. It need not be known to the snapshot. */
  readonly parentId: number | null;
  /**
   * What the snapshot holds for the component. `null`: the snapshot does not hold it, and a component of the
   * snapshot refers to it.
   */
  readonly version: {
    /** The name as the source spells it. */
    readonly name: string;
    /** The file that defines it. `null`: the source names the component and does not define it. */
    readonly path: string | null;
    readonly attrs: Readonly<Record<string, JsonValue>> | null;
  } | null;
}

/** A reference of a snapshot, with the ids of its two ends. */
export interface GraphReference extends Reference {
  readonly fromId: number;
  /** `null` for a target that could not be given a key. */
  readonly toId: number | null;
}

export interface SnapshotGraph {
  readonly snapshotId: number;
  /**
   * The component with this key: one the snapshot holds, or one that a component of the snapshot refers to.
   * `undefined` for a key the snapshot does not know.
   */
  find(key: ComponentKey): GraphComponent | undefined;
  /** The same, by id. */
  component(id: number): GraphComponent | undefined;
  /** The components the snapshot knows that this one contains directly, sorted by key. */
  childrenOf(id: number): GraphComponent[];
  /** The references of the snapshot that point at the component, sorted by the key they start from, then by place. */
  referencesTo(id: number): GraphReference[];
  /** The references that start from the component, sorted by place. */
  referencesFrom(id: number): GraphReference[];
}

const COMPONENT = `SELECT c.id AS id, c.key AS key, c.parent_id AS parent_id, m.version_id AS version_id,
       v.name AS name, p.path AS path, v.attrs AS attrs
  FROM component c
  LEFT JOIN snapshot_component m ON m.component_id = c.id AND m.snapshot_id = ?
  LEFT JOIN component_version v ON v.id = m.version_id
  LEFT JOIN file_path p ON p.id = v.path_id`;

/*
 * The order of the tables in the statements below is fixed with CROSS JOIN, which SQLite never reorders. A
 * question about one component must start from that component. Left to itself, SQLite starts some of them
 * from the list of the snapshot and walks all of it, which takes a second where a millisecond is enough.
 */

/** Finds a reference of the snapshot that points at a component. It takes the snapshot, then the component. */
const REFERRING = `SELECT 1 AS found FROM reference r
   CROSS JOIN snapshot_component s ON s.version_id = r.version_id AND s.snapshot_id = ?
  WHERE r.target_id = `;

const REFERENCE_COLUMNS = `m.component_id AS from_id, f.key AS from_key, r.target_id AS to_id, t.key AS to_key,
       r.target_type AS target_type, r.raw_name AS raw_name, r.kind AS kind, r.origin AS origin,
       r.confidence AS confidence, r.resolution AS resolution, p.path AS path, r.line AS line, r.col AS col,
       r.attrs AS attrs`;

const REFERENCE_ENDS = `JOIN component f ON f.id = m.component_id
  LEFT JOIN component t ON t.id = r.target_id
  LEFT JOIN file_path p ON p.id = r.path_id`;

/** From the references that point at a component to the versions of the snapshot that hold them. */
const REFERENCES_TO = `SELECT ${REFERENCE_COLUMNS}
  FROM reference r
  CROSS JOIN snapshot_component m ON m.version_id = r.version_id AND m.snapshot_id = ?
  ${REFERENCE_ENDS}
 WHERE r.target_id = ? ORDER BY f.key, r.seq`;

/** From the version the snapshot holds of a component to its references. */
const REFERENCES_FROM = `SELECT ${REFERENCE_COLUMNS}
  FROM snapshot_component m
  CROSS JOIN reference r ON r.version_id = m.version_id
  ${REFERENCE_ENDS}
 WHERE m.snapshot_id = ? AND m.component_id = ? ORDER BY r.seq`;

const object = (value: unknown): Readonly<Record<string, JsonValue>> | null =>
  typeof value === 'string' ? (JSON.parse(value) as Record<string, JsonValue>) : null;

/** The value of the vocabulary a number of the database stands for. */
function nameOf<T>(names: readonly (T | undefined)[], code: unknown): T {
  const name = names[Number(code)];
  if (name === undefined) {
    throw new EngineError(
      'INTERNAL',
      'The database holds a number of the reference vocabulary this version does not know.',
    );
  }
  return name;
}

function componentOf(row: SqlRow): GraphComponent {
  return {
    id: Number(row['id']),
    key: String(row['key']) as ComponentKey,
    parentId: row['parent_id'] === null ? null : Number(row['parent_id']),
    version:
      row['version_id'] === null
        ? null
        : {
            name: String(row['name']),
            path: typeof row['path'] === 'string' ? row['path'] : null,
            attrs: object(row['attrs']),
          },
  };
}

function referenceOf(row: SqlRow): GraphReference {
  const to = typeof row['to_key'] === 'string' ? (row['to_key'] as ComponentKey) : null;
  const attrs = object(row['attrs']);
  return {
    fromId: Number(row['from_id']),
    toId: row['to_id'] === null ? null : Number(row['to_id']),
    from: String(row['from_key']) as ComponentKey,
    to,
    // The type of a key is what stands before its first colon.
    toType: to === null ? String(row['target_type']) : to.slice(0, to.indexOf(':')),
    toNameRaw: String(row['raw_name']),
    kind: nameOf(REFERENCE_NAMES.kind, row['kind']),
    origin: nameOf(REFERENCE_NAMES.origin, row['origin']),
    confidence: nameOf(REFERENCE_NAMES.confidence, row['confidence']),
    resolution: nameOf(REFERENCE_NAMES.resolution, row['resolution']),
    ...(typeof row['path'] === 'string' && typeof row['line'] === 'number'
      ? {
          location: {
            file: row['path'],
            line: row['line'],
            ...(typeof row['col'] === 'number' ? { column: row['col'] } : {}),
          },
        }
      : {}),
    ...(attrs === null ? {} : { attrs }),
  };
}

/** The components and references of one snapshot, read from the database with one statement per question. */
export function sqlGraph(store: Store, snapshotId: number): SnapshotGraph {
  /** A component the snapshot holds, or one that it refers to. */
  const known = (row: SqlRow | undefined): GraphComponent | undefined => {
    if (row === undefined) return undefined;
    if (row['version_id'] !== null) return componentOf(row);
    const referred = store.get(`${REFERRING} ? LIMIT 1`, snapshotId, Number(row['id']));
    return referred === undefined ? undefined : componentOf(row);
  };
  return {
    snapshotId,
    find: (key) => known(store.get(`${COMPONENT} WHERE c.key = ?`, snapshotId, key)),
    component: (id) => known(store.get(`${COMPONENT} WHERE c.id = ?`, snapshotId, id)),
    childrenOf: (id) =>
      store
        .all(
          `${COMPONENT} WHERE c.parent_id = ? AND (m.version_id IS NOT NULL OR EXISTS (${REFERRING} c.id)) ORDER BY c.key`,
          snapshotId,
          id,
          snapshotId,
        )
        .map(componentOf),
    referencesTo: (id) => store.all(REFERENCES_TO, snapshotId, id).map(referenceOf),
    referencesFrom: (id) => store.all(REFERENCES_FROM, snapshotId, id).map(referenceOf),
  };
}
