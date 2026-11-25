/**
 * Which components of a snapshot are of a managed package installed in the org (decision records 0056 and 0076).
 *
 * The org says so: it lists a component of an installed package with the prefix of the package and a state of
 * one (`manageableState`). A component of the org's own namespace has a prefix too, and another state. Nothing
 * else is taken: not the prefix of a name, which a component can carry for the component it belongs to, as a tab
 * carries the name of its object. A snapshot of a repository has no listing, so nothing of it is of a package.
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

const INSTALLED = INSTALLED_STATES.map((state) => `'${state}'`).join(', ');

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
    `SELECT type, full_name, came_back_as, namespace_prefix FROM inventory_item
      WHERE snapshot_id = ? AND listed = 1 AND namespace_prefix IS NOT NULL AND manageable_state IN (${INSTALLED})`,
    snapshotId,
  );
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
    `SELECT type, COUNT(*) AS packaged FROM inventory_item
      WHERE snapshot_id = ? AND listed = 1 AND namespace_prefix IS NOT NULL AND manageable_state IN (${INSTALLED})
      GROUP BY type ORDER BY type`,
    snapshotId,
  );
  for (const row of rows) counts.set(String(row['type']), Number(row['packaged']));
  return counts;
}
