/**
 * The descriptions of the objects of an org that a snapshot holds (decision records 0085 and 0086).
 *
 * They are stored as the reading kept them, beside the snapshot, so that every analysis of the snapshot checks
 * names against the org without the org. They are no references and no components.
 */
import type { DescribedChild, DescribedField, DescriptionReading, ObjectDescription } from '../sources/describe.ts';
import type { Store } from './open.ts';

/** How the descriptions were read for a snapshot. */
export interface StoredDescriptionReading {
  readonly state: DescriptionReading['state'];
  /** When the first request was sent, and when the reading ended. UTC, as `Date.prototype.toISOString` writes it. */
  readonly startedAt: string;
  readonly readAt: string;
  readonly requests: number;
  /** The objects that were asked for, those the org did not know, and those for which no description came. */
  readonly asked: number;
  readonly unknown: number;
  readonly failed: number;
  readonly code: string | null;
}

/**
 * Stores what was read of the descriptions for a snapshot. What the snapshot held of them before is replaced. It is
 * called inside a write of the caller, as the other writers of a snapshot are.
 */
export function writeDescriptions(
  store: Store,
  snapshotId: number,
  reading: DescriptionReading,
  times: { readonly startedAt: string; readonly readAt: string },
): void {
  store.run('DELETE FROM snapshot_description_reading WHERE snapshot_id = ?', snapshotId);
  store.run(
    `INSERT INTO snapshot_description_reading
       (snapshot_id, state, started_at, read_at, requests, asked, unknown, failed, code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    snapshotId,
    reading.state,
    times.startedAt,
    times.readAt,
    reading.requests,
    reading.descriptions.length + reading.unknown.length + reading.failed.length,
    reading.unknown.length,
    reading.failed.length,
    reading.code,
  );
  for (const description of reading.descriptions) {
    // Two names that were asked for can be described as one object, by a name the org writes in other capitals:
    // the first description is kept, and both count as described.
    store.run(
      `INSERT INTO snapshot_object_description (snapshot_id, object, description) VALUES (?, ?, ?)
       ON CONFLICT (snapshot_id, object) DO NOTHING`,
      snapshotId,
      description.name,
      JSON.stringify(description),
    );
  }
}

/** How the descriptions were read for a snapshot, or `undefined` for a snapshot they were not asked for. */
export function readDescriptionReading(store: Store, snapshotId: number): StoredDescriptionReading | undefined {
  const row = store.get(
    `SELECT state, started_at, read_at, requests, asked, unknown, failed, code
       FROM snapshot_description_reading WHERE snapshot_id = ?`,
    snapshotId,
  );
  if (row === undefined) return undefined;
  const state = String(row['state']);
  return {
    state: state === 'whole' || state === 'partial' ? state : 'none',
    startedAt: String(row['started_at']),
    readAt: String(row['read_at']),
    requests: Number(row['requests']),
    asked: Number(row['asked']),
    unknown: Number(row['unknown']),
    failed: Number(row['failed']),
    code: typeof row['code'] === 'string' ? row['code'] : null,
  };
}

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** A stored description as the reading kept it. What the store holds was written by `writeDescriptions`. */
function described(name: string, json: string): ObjectDescription {
  const stored = record(JSON.parse(json));
  const fields = (Array.isArray(stored['fields']) ? stored['fields'] : []).map((one): DescribedField => {
    const field = record(one);
    return {
      name: String(field['name']),
      type: String(field['type']),
      referenceTo: texts(field['referenceTo']),
      relationshipName: typeof field['relationshipName'] === 'string' ? field['relationshipName'] : null,
    };
  });
  const childRelationships = (Array.isArray(stored['childRelationships']) ? stored['childRelationships'] : []).map(
    (one): DescribedChild => {
      const child = record(one);
      return {
        relationshipName: String(child['relationshipName']),
        childSObject: String(child['childSObject']),
        field: String(child['field']),
      };
    },
  );
  return { name, fields, childRelationships };
}

/** The descriptions a snapshot holds, sorted by the name of the object. Empty where none were read. */
export function readDescriptions(store: Store, snapshotId: number): ObjectDescription[] {
  return store
    .all(
      'SELECT object, description FROM snapshot_object_description WHERE snapshot_id = ? ORDER BY object',
      snapshotId,
    )
    .map((row) => described(String(row['object']), String(row['description'])));
}

/**
 * The objects of which a snapshot of an org holds a file, by the name the org listed them with, sorted: those the
 * org is asked to describe. An object of a package that came back without its prefix is asked for with it, as the
 * org knows it (decision record 0076).
 */
export function objectsWithFiles(store: Store, snapshotId: number): string[] {
  return store
    .all(
      `SELECT DISTINCT full_name FROM inventory_item
        WHERE snapshot_id = ? AND type = 'CustomObject' AND retrieved = 1 ORDER BY full_name`,
      snapshotId,
    )
    .map((row) => String(row['full_name']));
}
