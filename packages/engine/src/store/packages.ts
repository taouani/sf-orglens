/**
 * Which components of a snapshot are of a managed package installed in the org (decision records 0056 and 0076).
 *
 * The org says so: it lists a component of an installed package with the prefix of the package and a state of
 * one (`manageableState`). A component of the org's own namespace has a prefix too, and another state. Nothing
 * else is taken: not the prefix of a name, which a component can carry for the component it belongs to, as a tab
 * carries the name of its object. A snapshot of a repository has no listing, so nothing of it is of a package. A
 * component of a package that the org lists and does not hand out makes no snapshot partial.
 */
import { EngineError } from '../core/errors.ts';
import { buildKey, parentKey, type ComponentKey } from '../core/keys.ts';
import type { Store } from './open.ts';

/**
 * The states the org lists a component of an installed managed package with: installed, and deleted from the
 * package after it was installed, each also where the org may change the component. A component of the org's
 * own namespace is `released` or `beta`, and one of no package `unmanaged`.
 */
const INSTALLED_STATES: readonly string[] = ['installed', 'installedEditable', 'deprecated', 'deprecatedEditable'];

/** The rows of `inventory_item` the org listed as components of an installed package. */
const OF_PACKAGE = `listed = 1 AND namespace_prefix IS NOT NULL
  AND manageable_state IN (${INSTALLED_STATES.map((state) => `'${state}'`).join(', ')})`;

/** What a snapshot knows of the packages of its components. */
export interface Packages {
  /**
   * The prefix of the installed package a component is of, or `null` for a component of the org's own. A part
   * that the analysis makes of a component, such as an element of a flow, is of the package of the component.
   */
  of(key: ComponentKey): string | null;
}

/** The key of a listed name, or `null` for a name that cannot be one. */
function keyOf(type: string, fullName: string): ComponentKey | null {
  try {
    return buildKey({ type, fullName });
  } catch (error) {
    if (error instanceof EngineError && error.code === 'KEY_INVALID') return null;
    throw error;
  }
}

/**
 * Reads which components of a snapshot are of an installed package: each component the org listed as one, under
 * the name it listed and under the name it came back with, where that is another.
 */
export function readPackages(store: Store, snapshotId: number): Packages {
  const packages = new Map<ComponentKey, string>();
  const rows = store.all(
    `SELECT type, full_name, came_back_as, namespace_prefix FROM inventory_item WHERE snapshot_id = ? AND ${OF_PACKAGE}
      ORDER BY type, full_name`,
    snapshotId,
  );
  // Two components of two packages can come back under one name where they came back in two retrieves (record
  // 0047). The row read last is taken, in the order of the names, so that the answer is the same every time.
  for (const row of rows) {
    const type = String(row['type']);
    const prefix = String(row['namespace_prefix']);
    for (const name of [row['full_name'], row['came_back_as']]) {
      if (typeof name !== 'string') continue;
      const key = keyOf(type, name);
      if (key !== null) packages.set(key, prefix);
    }
  }
  return {
    of(key) {
      let at: ComponentKey | undefined = key;
      // A part the analysis makes of a component is not listed: it is of the package of the component.
      while (at !== undefined) {
        const prefix = packages.get(at);
        if (prefix !== undefined) return prefix;
        at = at.includes('#') ? parentKey(at) : undefined;
      }
      return null;
    },
  };
}

/** Per type, how many of the components the org listed are of an installed package. Types without one are left out. */
export function countPackaged(store: Store, snapshotId: number): Map<string, number> {
  const counts = new Map<string, number>();
  const rows = store.all(
    `SELECT type, COUNT(*) AS packaged FROM inventory_item WHERE snapshot_id = ? AND ${OF_PACKAGE}
      GROUP BY type ORDER BY type`,
    snapshotId,
  );
  for (const row of rows) counts.set(String(row['type']), Number(row['packaged']));
  return counts;
}

/**
 * The components of a type that the org listed as of an installed package and that did not come back, sorted by
 * name. They do not make a snapshot partial (decision record 0076).
 */
export function missingOfPackages(store: Store, snapshotId: number, type: string): string[] {
  return store
    .all(
      `SELECT full_name FROM inventory_item
        WHERE snapshot_id = ? AND type = ? AND retrieved = 0 AND ${OF_PACKAGE} ORDER BY full_name`,
      snapshotId,
      type,
    )
    .map((row) => String(row['full_name']));
}

/**
 * Per type, how many of the components the org listed as of an installed package did not come back. As a target,
 * such a component is one the snapshot does not hold.
 */
export function countMissingOfPackages(store: Store, snapshotId: number): Map<string, number> {
  const counts = new Map<string, number>();
  const rows = store.all(
    `SELECT type, COUNT(*) AS missing FROM inventory_item WHERE snapshot_id = ? AND retrieved = 0 AND ${OF_PACKAGE}
      GROUP BY type ORDER BY type`,
    snapshotId,
  );
  for (const row of rows) counts.set(String(row['type']), Number(row['missing']));
  return counts;
}

/**
 * Per type, how many of the components the org listed as of an installed package did not come back and that no
 * reference of the snapshot names: by its key or, for a reference whose target has no key, by its type and its
 * name. A name is the one the org listed or that name without the prefix of the package, as a component can come
 * back. A reference that names one can lead through it to what an answer is about, and what the component refers
 * to is not known. Such a component counts as missing for an answer (decision record 0076).
 */
export function countMissingOfPackagesNothingNames(store: Store, snapshotId: number): Map<string, number> {
  const counts = new Map<string, number>();
  const rows = store.all(
    `SELECT type, full_name, namespace_prefix FROM inventory_item
      WHERE snapshot_id = ? AND retrieved = 0 AND ${OF_PACKAGE} ORDER BY type, full_name`,
    snapshotId,
  );
  for (const row of rows) {
    const type = String(row['type']);
    const fullName = String(row['full_name']);
    const prefix = `${String(row['namespace_prefix'])}__`;
    const names = fullName.startsWith(prefix) ? [fullName, fullName.slice(prefix.length)] : [fullName];
    if (!names.some((name) => isNamed(store, snapshotId, type, name))) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

/**
 * True if a reference of a component of the snapshot names the component of this type and name. The joins go
 * from the target to the references that name it, and then to the snapshot: a snapshot holds many more
 * components than one is named by.
 */
function isNamed(store: Store, snapshotId: number, type: string, name: string): boolean {
  const key = keyOf(type, name);
  const byKey =
    key !== null &&
    store.get(
      `SELECT 1 AS named FROM component AS target
         CROSS JOIN reference ON reference.target_id = target.id AND reference.target_id IS NOT NULL
         CROSS JOIN snapshot_component AS holder
           ON holder.version_id = reference.version_id AND holder.snapshot_id = ?
        WHERE target.key = ? LIMIT 1`,
      snapshotId,
      key,
    ) !== undefined;
  return (
    byKey ||
    store.get(
      `SELECT 1 AS named FROM reference
         CROSS JOIN snapshot_component AS holder
           ON holder.version_id = reference.version_id AND holder.snapshot_id = ?
        WHERE reference.target_id IS NULL AND reference.target_type = ? AND reference.raw_name = ? COLLATE NOCASE
        LIMIT 1`,
      snapshotId,
      type,
      name,
    ) !== undefined
  );
}
