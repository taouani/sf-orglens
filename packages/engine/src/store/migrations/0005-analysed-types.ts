import type { Migration } from './migration.ts';

/**
 * The metadata types an analysis reads (decision record 0044).
 *
 * The coverage per type says how many components of a type were analysed. For a type of which the snapshot
 * holds nothing, that number is zero whether an analyser reads the type or not. An answer has to tell the two
 * apart: a type that is read and missing may hide something the answer claims to cover.
 */
export const migration0005: Migration = {
  version: 5,
  name: 'analysed-types',
  sql: `
-- The types the analysers of this analysis read, as a JSON list of their names.
-- NULL: the analysis was written before this column was there, and what it read is told by the counts alone.
ALTER TABLE snapshot_analysis ADD COLUMN types TEXT CHECK (types IS NULL OR (json_valid(types) AND json_type(types) = 'array'));
`,
};
