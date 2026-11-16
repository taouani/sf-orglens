/**
 * What the analysis of a snapshot left in the database, read with plain statements: the tests of the commands
 * that analyse look at the tables, not at what the engine says about them.
 */
import type { JsonValue } from '../../src/core/errors.ts';
import { REFERENCE_NAMES } from '../../src/store/analysis.ts';
import type { Store } from '../../src/store/open.ts';

export interface StoredComponent {
  readonly key: string;
  readonly name: string;
  /** The file that defines the component, or `null` for one the snapshot names and does not define. */
  readonly path: string | null;
  readonly attrs: Readonly<Record<string, JsonValue>> | null;
}

export interface StoredReference {
  readonly from: string;
  /** `null` for a target that has no key. */
  readonly to: string | null;
  readonly raw: string;
  readonly kind: string;
  readonly origin: string;
  readonly confidence: string;
  readonly resolution: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly attrs: Readonly<Record<string, JsonValue>> | null;
}

const json = (value: unknown): Readonly<Record<string, JsonValue>> | null =>
  typeof value === 'string' ? (JSON.parse(value) as Record<string, JsonValue>) : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const number = (value: unknown): number | null => (typeof value === 'number' ? value : null);

/** The components of a snapshot, sorted by key. */
export function storedComponents(store: Store, snapshotId: number): StoredComponent[] {
  return store
    .all(
      `SELECT c.key AS key, v.name AS name, p.path AS path, v.attrs AS attrs
         FROM snapshot_component m
         JOIN component c ON c.id = m.component_id
         JOIN component_version v ON v.id = m.version_id
         LEFT JOIN file_path p ON p.id = v.path_id
        WHERE m.snapshot_id = ? ORDER BY c.key`,
      snapshotId,
    )
    .map((row) => ({
      key: String(row['key']),
      name: String(row['name']),
      path: text(row['path']),
      attrs: json(row['attrs']),
    }));
}

/** The references of a snapshot, sorted by the key they start from and then by their place. */
export function storedReferences(store: Store, snapshotId: number): StoredReference[] {
  return store
    .all(
      `SELECT c.key AS from_key, t.key AS to_key, r.raw_name AS raw, r.kind AS kind, r.origin AS origin,
              r.confidence AS confidence, r.resolution AS resolution, p.path AS path, r.line AS line, r.col AS col,
              r.attrs AS attrs
         FROM snapshot_component m
         JOIN component c ON c.id = m.component_id
         JOIN reference r ON r.version_id = m.version_id
         LEFT JOIN component t ON t.id = r.target_id
         LEFT JOIN file_path p ON p.id = r.path_id
        WHERE m.snapshot_id = ? ORDER BY c.key, r.seq`,
      snapshotId,
    )
    .map((row) => ({
      from: String(row['from_key']),
      to: text(row['to_key']),
      raw: String(row['raw']),
      kind: REFERENCE_NAMES.kind[Number(row['kind'])] ?? '?',
      origin: REFERENCE_NAMES.origin[Number(row['origin'])] ?? '?',
      confidence: REFERENCE_NAMES.confidence[Number(row['confidence'])] ?? '?',
      resolution: REFERENCE_NAMES.resolution[Number(row['resolution'])] ?? '?',
      file: text(row['path']),
      line: number(row['line']),
      column: number(row['col']),
      attrs: json(row['attrs']),
    }));
}

/** A reference without its place: what two snapshots of the same metadata have in common. */
export const withoutPlace = (reference: StoredReference): string =>
  `${reference.from} ${reference.kind} ${String(reference.to)} [${reference.raw}] ${reference.origin} ${reference.confidence} ${JSON.stringify(reference.attrs)}`;
