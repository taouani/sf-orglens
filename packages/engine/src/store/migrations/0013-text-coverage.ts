import type { Migration } from './migration.ts';

/**
 * What the names in texts of an analyser came to (decision record 0093): for the origin `parser:apex`, the names that
 * each step of decision record 0012 found, the `possible` references where a part of a text is not known, and the
 * paths not followed that a text leads to.
 */
export const migration0013: Migration = {
  version: 13,
  name: 'text-coverage',
  sql: `
-- NULL in all five: the origin reads no names in texts, or the analysis was written before these columns were there.
ALTER TABLE snapshot_origin_coverage ADD COLUMN texts_written INTEGER CHECK (texts_written >= 0);
ALTER TABLE snapshot_origin_coverage ADD COLUMN texts_metadata INTEGER CHECK (texts_metadata >= 0);
ALTER TABLE snapshot_origin_coverage ADD COLUMN texts_built INTEGER CHECK (texts_built >= 0);
ALTER TABLE snapshot_origin_coverage ADD COLUMN texts_possible INTEGER CHECK (texts_possible >= 0);
-- The last says that the five are written together.
ALTER TABLE snapshot_origin_coverage ADD COLUMN texts_not_followed INTEGER CHECK (
  (texts_not_followed IS NULL OR texts_not_followed >= 0)
  AND (texts_not_followed IS NULL) = (texts_written IS NULL)
  AND (texts_not_followed IS NULL) = (texts_metadata IS NULL)
  AND (texts_not_followed IS NULL) = (texts_built IS NULL)
  AND (texts_not_followed IS NULL) = (texts_possible IS NULL)
);
`,
};
