import type { Migration } from './migration.ts';

/**
 * What the Dependency API of Salesforce said about an org when a snapshot was taken (decision record 0045).
 *
 * The rows are a second opinion on the references OrgLens finds, and are kept apart from them: they belong to
 * the snapshot and to no version of a component, and no answer about a component is made from them. They are
 * kept as Salesforce wrote them. Which components the two ends are is worked out with every analysis, which
 * also compares them with what it found and keeps the result.
 */
export const migration0006: Migration = {
  version: 6,
  name: 'dependency-rows',
  sql: `
-- How the Dependency API was read for a snapshot. No row: it was not asked.
CREATE TABLE snapshot_dependency_reading (
  snapshot_id INTEGER PRIMARY KEY REFERENCES snapshot (id) ON DELETE CASCADE,
  -- whole: no query left a row out. partial: rows are missing, or may be. none: the org answered no query.
  state       TEXT NOT NULL CHECK (state IN ('whole', 'partial', 'none')),
  read_at     TEXT NOT NULL CHECK (read_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  requests    INTEGER NOT NULL CHECK (requests >= 0),
  -- Queries that reached the limit of rows and could not be asked in smaller parts, and queries that failed.
  cut_off     INTEGER NOT NULL CHECK (cut_off >= 0),
  failed      INTEGER NOT NULL CHECK (failed >= 0),
  -- Queries at the limit that were asked again per component, for more components than one query can name: a
  -- row of a component the org did not list would be missing.
  unproven    INTEGER NOT NULL CHECK (unproven >= 0),
  -- The code of the first failure.
  code        TEXT
) STRICT;

-- One row of the Dependency API: a component, and a component it refers to, as Salesforce names them.
CREATE TABLE snapshot_dependency (
  snapshot_id    INTEGER NOT NULL REFERENCES snapshot_dependency_reading (snapshot_id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL CHECK (seq >= 0),
  from_type      TEXT NOT NULL,
  from_id        TEXT NOT NULL,
  from_name      TEXT NOT NULL,
  from_namespace TEXT,
  to_type        TEXT NOT NULL,
  to_id          TEXT NOT NULL,
  to_name        TEXT NOT NULL,
  to_namespace   TEXT,
  PRIMARY KEY (snapshot_id, seq)
) STRICT, WITHOUT ROWID;

-- What the comparison of the rows with an analysis found, as a JSON object. NULL: nothing was compared.
ALTER TABLE snapshot_analysis ADD COLUMN cross_check TEXT CHECK (cross_check IS NULL OR (json_valid(cross_check) AND json_type(cross_check) = 'object'));
`,
};
