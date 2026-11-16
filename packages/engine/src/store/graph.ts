/**
 * Reading the components and references of one snapshot.
 *
 * `SnapshotGraph` is the one interface an engine reads them through. `sqlGraph` answers each question with a
 * statement on the database. An engine that walks many references can be given another implementation, such as
 * an index held in memory, and does not know the difference (decision record 0040).
 */
import { EngineError, type JsonValue } from '../core/errors.ts';
import type { ComponentKey } from '../core/keys.ts';
import type { ConfidenceTier, Reference } from '../core/references.ts';
import { REFERENCE_CODES, REFERENCE_NAMES } from './analysis.ts';
import type { SqlRow } from './driver.ts';
import type { Store } from './open.ts';

/** A component as one snapshot knows it. */
export interface GraphComponent {
  /** The id of the key in the database. It is the same in every snapshot. */
  readonly id: number;
  readonly key: ComponentKey;
  /** The component that contains this one, as the key says it. The snapshot knows it, as it knows this one. */
  readonly parentId: number | null;
  /**
   * What the snapshot holds for the component. `null`: the snapshot does not hold it. A component of the
   * snapshot refers to it, or to something it contains.
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

/**
 * A reference as a walk over many of them needs it first: the ids of its two ends, and how certain it is. A
 * walk reads hundreds of thousands of these and keeps a few. `edges` reads the rest of those.
 */
export interface GraphLink {
  readonly fromId: number;
  /** `null` for a target that could not be given a key. */
  readonly toId: number | null;
  readonly confidence: ConfidenceTier;
  /** Where the store holds the reference: the version it belongs to, and its number among those of the version. */
  readonly versionId: number;
  readonly seq: number;
}

/** A reference with everything but the keys of its two ends and its attributes. */
export interface GraphEdge extends Omit<Reference, 'from' | 'to' | 'attrs'> {
  readonly fromId: number;
  /** `null` for a target that could not be given a key. */
  readonly toId: number | null;
}

export interface SnapshotGraph {
  readonly snapshotId: number;
  /**
   * The component with this key, if the snapshot knows it. It knows a component that it holds, one that a
   * component of it refers to, and one that contains a component it knows: a repository that reads
   * `Account.Name` knows the field and, through it, the object. `undefined` for a key the snapshot does not
   * know, also when another snapshot of the database does.
   */
  find(key: ComponentKey): GraphComponent | undefined;
  /** The same, by id. */
  component(id: number): GraphComponent | undefined;
  /**
   * The ids of everything the database has below a component, at any depth, in no order. Whether the snapshot
   * knows each of them is not asked: one it does not know has no reference in it, at either end.
   */
  below(id: number): number[];
  /** The components the snapshot knows that this one contains directly, sorted by key. */
  childrenOf(id: number): GraphComponent[];
  /** The references of the snapshot that point at the component, sorted by the key they start from, then by place. */
  referencesTo(id: number): GraphReference[];
  /** The references that start from the component, sorted by place. */
  referencesFrom(id: number): GraphReference[];
  /**
   * The components with these ids, in no order. An id the database does not know is left out. Whether the
   * snapshot knows a component is not asked: the ids come from references of the snapshot.
   */
  components(ids: readonly number[]): GraphComponent[];
  /**
   * The references of the snapshot that point at any of the components, in no order. With `weakest`, only
   * those that are at least that certain.
   */
  linksTo(ids: readonly number[], weakest?: ConfidenceTier): GraphLink[];
  /** The references that start from any of the components, in no order, with the same limit. */
  linksFrom(ids: readonly number[], weakest?: ConfidenceTier): GraphLink[];
  /** The references behind links, in the order of the links. */
  edges(links: readonly GraphLink[]): GraphEdge[];
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

/**
 * Finds, among everything a component contains at any depth, one component that the snapshot holds or refers
 * to. It takes the component, then the snapshot twice.
 */
const CONTAINS_KNOWN = `WITH RECURSIVE below (id) AS (
    SELECT c.id FROM component c WHERE c.parent_id = ?
    UNION ALL
    SELECT c.id FROM below b CROSS JOIN component c ON c.parent_id = b.id
  )
  SELECT 1 AS found FROM below b
   WHERE EXISTS (SELECT 1 FROM snapshot_component m WHERE m.snapshot_id = ? AND m.component_id = b.id)
      OR EXISTS (${REFERRING} b.id)
   LIMIT 1`;

/** Everything a component contains, at any depth. It takes the component. */
const BELOW = `WITH RECURSIVE below (id) AS (
    SELECT c.id FROM component c WHERE c.parent_id = ?
    UNION ALL
    SELECT c.id FROM below b CROSS JOIN component c ON c.parent_id = b.id
  )
  SELECT b.id AS id FROM below b`;

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

/*
 * The statements for many components at once take the ids as one JSON list, so that a list of any length is
 * one statement. `j` is that list, and every statement starts from it.
 *
 * A walk reads the references of a whole level at once, and most of them lead to a component it has already
 * found. Handing each one out as a row costs more than everything else in the walk. So these statements put
 * all they find into one JSON text, a list of values for each, which is read in one go.
 */

const COMPONENTS = `SELECT json_group_array(
         json_array(c.id, c.key, c.parent_id, m.version_id, v.name, p.path, json(v.attrs))) AS list
  FROM json_each(?) j
  CROSS JOIN component c ON c.id = j.value
  LEFT JOIN snapshot_component m ON m.component_id = c.id AND m.snapshot_id = ?
  LEFT JOIN component_version v ON v.id = m.version_id
  LEFT JOIN file_path p ON p.id = v.path_id`;

const LINK = 'json_group_array(json_array(m.component_id, r.target_id, r.confidence, r.version_id, r.seq)) AS list';

/** From the references that point at the components to the versions of the snapshot that hold them. */
const LINKS_TO = `SELECT ${LINK}
  FROM json_each(?) j
  CROSS JOIN reference r ON r.target_id = j.value
  CROSS JOIN snapshot_component m ON m.version_id = r.version_id AND m.snapshot_id = ?
 WHERE r.confidence <= ?`;

/** From the versions the snapshot holds of the components to their references. */
const LINKS_FROM = `SELECT ${LINK}
  FROM json_each(?) j
  CROSS JOIN snapshot_component m ON m.snapshot_id = ? AND m.component_id = j.value
  CROSS JOIN reference r ON r.version_id = m.version_id
 WHERE r.confidence <= ?`;

/** The references with the given versions and numbers. `j` is a list of pairs. */
const EDGES = `SELECT json_group_array(
         json_array(r.version_id, r.seq, r.target_type, substr(t.key, 1, instr(t.key, ':') - 1), r.raw_name,
                    r.kind, r.origin, r.resolution, p.path, r.line, r.col)) AS list
  FROM json_each(?) j
  CROSS JOIN reference r ON r.version_id = json_extract(j.value, '$[0]') AND r.seq = json_extract(j.value, '$[1]')
  LEFT JOIN component t ON t.id = r.target_id
  LEFT JOIN file_path p ON p.id = r.path_id`;

/** At most this many ids go into one statement. A longer list is asked for in parts. */
const IDS_PER_STATEMENT = 2_000;

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

/** What a statement found that puts all of it into one JSON text: a list of values for each. */
function listOf<T extends readonly unknown[]>(rows: readonly SqlRow[]): T[] {
  const text = rows[0]?.['list'];
  return typeof text === 'string' ? (JSON.parse(text) as T[]) : [];
}

type ComponentValues = readonly [
  id: number,
  key: string,
  parentId: number | null,
  versionId: number | null,
  name: string | null,
  path: string | null,
  attrs: Readonly<Record<string, JsonValue>> | null,
];

function componentOfValues([id, key, parentId, versionId, name, path, attrs]: ComponentValues): GraphComponent {
  return {
    id,
    key: key as ComponentKey,
    parentId,
    version: versionId === null ? null : { name: String(name), path, attrs },
  };
}

type LinkValues = readonly [fromId: number, toId: number | null, confidence: number, versionId: number, seq: number];

function linkOf([fromId, toId, confidence, versionId, seq]: LinkValues): GraphLink {
  return { fromId, toId, confidence: nameOf(REFERENCE_NAMES.confidence, confidence), versionId, seq };
}

type EdgeValues = readonly [
  versionId: number,
  seq: number,
  targetType: string,
  toType: string | null,
  rawName: string,
  kind: number,
  origin: number,
  resolution: number,
  path: string | null,
  line: number | null,
  col: number | null,
];

function edgeOf(link: GraphLink, values: EdgeValues): GraphEdge {
  const [, , targetType, toType, rawName, kind, origin, resolution, path, line, col] = values;
  return {
    fromId: link.fromId,
    toId: link.toId,
    toType: link.toId === null || toType === null ? targetType : toType,
    toNameRaw: rawName,
    kind: nameOf(REFERENCE_NAMES.kind, kind),
    origin: nameOf(REFERENCE_NAMES.origin, origin),
    confidence: link.confidence,
    resolution: nameOf(REFERENCE_NAMES.resolution, resolution),
    ...(path !== null && line !== null
      ? { location: { file: path, line, ...(col === null ? {} : { column: col }) } }
      : {}),
  };
}

/**
 * The components and references of one snapshot, read from the database. A question takes one statement. For
 * a component the snapshot does not hold, up to two more find out whether the snapshot knows it.
 */
export function sqlGraph(store: Store, snapshotId: number): SnapshotGraph {
  /** Asks for a list of ids in parts, each as one JSON list, and puts the answers together. */
  const inParts = <T>(ids: readonly number[], ask: (list: string) => T[]): T[] => {
    const found: T[] = [];
    for (let at = 0; at < ids.length; at += IDS_PER_STATEMENT) {
      for (const one of ask(JSON.stringify(ids.slice(at, at + IDS_PER_STATEMENT)))) found.push(one);
    }
    return found;
  };
  /** The component of a row, if the snapshot knows it. */
  const known = (row: SqlRow | undefined): GraphComponent | undefined => {
    if (row === undefined) return undefined;
    if (row['version_id'] !== null) return componentOf(row);
    const id = Number(row['id']);
    const referred =
      store.get(`${REFERRING} ? LIMIT 1`, snapshotId, id) ?? store.get(CONTAINS_KNOWN, id, snapshotId, snapshotId);
    return referred === undefined ? undefined : componentOf(row);
  };
  return {
    snapshotId,
    find: (key) => known(store.get(`${COMPONENT} WHERE c.key = ?`, snapshotId, key)),
    component: (id) => known(store.get(`${COMPONENT} WHERE c.id = ?`, snapshotId, id)),
    below: (id) => store.all(BELOW, id).map((row) => Number(row['id'])),
    childrenOf: (id) =>
      store
        .all(`${COMPONENT} WHERE c.parent_id = ? ORDER BY c.key`, snapshotId, id)
        .map(known)
        .filter((child) => child !== undefined),
    referencesTo: (id) => store.all(REFERENCES_TO, snapshotId, id).map(referenceOf),
    referencesFrom: (id) => store.all(REFERENCES_FROM, snapshotId, id).map(referenceOf),
    components: (ids) =>
      inParts(ids, (list) => listOf<ComponentValues>(store.all(COMPONENTS, list, snapshotId)).map(componentOfValues)),
    linksTo: (ids, weakest = 'possible') =>
      inParts(ids, (list) =>
        listOf<LinkValues>(store.all(LINKS_TO, list, snapshotId, REFERENCE_CODES.confidence[weakest])).map(linkOf),
      ),
    linksFrom: (ids, weakest = 'possible') =>
      inParts(ids, (list) =>
        listOf<LinkValues>(store.all(LINKS_FROM, list, snapshotId, REFERENCE_CODES.confidence[weakest])).map(linkOf),
      ),
    edges: (links) => {
      const found = new Map<string, EdgeValues>();
      const at = (versionId: number, seq: number): string => `${String(versionId)} ${String(seq)}`;
      for (let from = 0; from < links.length; from += IDS_PER_STATEMENT) {
        const pairs = links.slice(from, from + IDS_PER_STATEMENT).map((link) => [link.versionId, link.seq]);
        for (const values of listOf<EdgeValues>(store.all(EDGES, JSON.stringify(pairs)))) {
          found.set(at(values[0], values[1]), values);
        }
      }
      return links.map((link) => {
        const values = found.get(at(link.versionId, link.seq));
        if (values === undefined) throw new EngineError('INTERNAL', 'A reference of a walk is no longer there.');
        return edgeOf(link, values);
      });
    },
  };
}
