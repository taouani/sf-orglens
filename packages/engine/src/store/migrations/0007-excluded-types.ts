import type { Migration } from './migration.ts';

/**
 * A type that a snapshot of an org leaves out (decision record 0048).
 *
 * The configuration of a source can name types that a snapshot does not read. Such a type is kept in the
 * coverage of the snapshot with the listing `excluded`, so that a report and an answer can say that it was not
 * read. SQLite cannot change the check of a column, so the table is built again with the rows it holds. No
 * other table refers to it.
 */
export const migration0007: Migration = {
  version: 7,
  name: 'excluded-types',
  sql: `
-- Per metadata type: how many components were listed, retrieved and analysed, and whether the source could say
-- which components of the type it has.
--   ok: it listed them.  failed: it refused, so the count is not known.  unlistable: it never lists this type.
--   excluded: the configuration of the source leaves the type out, and the source was not asked.
CREATE TABLE snapshot_type_coverage_v7 (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type <> ''),
  listed      INTEGER NOT NULL DEFAULT 0 CHECK (listed >= 0),
  retrieved   INTEGER NOT NULL DEFAULT 0 CHECK (retrieved >= 0),
  analysed    INTEGER NOT NULL DEFAULT 0 CHECK (analysed >= 0),
  note        TEXT,
  listing     TEXT NOT NULL DEFAULT 'ok' CHECK (listing IN ('ok', 'failed', 'unlistable', 'excluded')),
  PRIMARY KEY (snapshot_id, type)
) STRICT, WITHOUT ROWID;

INSERT INTO snapshot_type_coverage_v7 (snapshot_id, type, listed, retrieved, analysed, note, listing)
SELECT snapshot_id, type, listed, retrieved, analysed, note, listing FROM snapshot_type_coverage;

DROP TABLE snapshot_type_coverage;

ALTER TABLE snapshot_type_coverage_v7 RENAME TO snapshot_type_coverage;
`,
};
