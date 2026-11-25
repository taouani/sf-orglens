import type { Migration } from './migration.ts';

/**
 * The name under which a component the org listed came back, where it is another name (decision record 0076).
 *
 * A component can come back under another name than the org lists it with, such as a component of a package
 * without the prefix of its package (decision records 0047, 0071 and 0072). The row of the listed name is marked
 * as retrieved, and the snapshot names the component after what came back. That name is kept with the row, so
 * that what the org says of the listed component, its package and its id, is known of the component the snapshot
 * holds. A row from before this migration has none: the snapshot is to be taken again for it.
 */
export const migration0010: Migration = {
  version: 10,
  name: 'came-back-as',
  sql: `
-- NULL: the component came back under its listed name, or did not come back.
ALTER TABLE inventory_item ADD COLUMN came_back_as TEXT CHECK (came_back_as IS NULL OR came_back_as <> '');
`,
};
