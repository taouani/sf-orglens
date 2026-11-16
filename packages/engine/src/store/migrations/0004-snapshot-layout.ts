import type { Migration } from './migration.ts';

/**
 * How the files of a snapshot are laid out (decision record 0043).
 *
 * The project file of a repository can change which files make up which component. It is not a file of the
 * snapshot, so what it said is kept with the snapshot. An analysis reads the files with it, whenever it runs
 * and from whatever folder.
 */
export const migration0004: Migration = {
  version: 4,
  name: 'snapshot-layout',
  sql: `
-- The settings of the project file that change the layout, as JSON: {"presets": [...], "customizations": {...}}.
-- NULL: the files are laid out as Salesforce hands them out. That holds for every snapshot of an org, and for a
-- snapshot of a repository whose project asks for nothing, or that was stored before this column was there.
ALTER TABLE snapshot ADD COLUMN layout TEXT CHECK (layout IS NULL OR (json_valid(layout) AND json_type(layout) = 'object'));
`,
};
