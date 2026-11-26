import type { Migration } from './migration.ts';

/**
 * The descriptions of the objects of an org that a snapshot asked for (decision records 0085 and 0086).
 *
 * A snapshot of an org asks the org to describe every object of which it holds a file, so that every analysis of
 * the snapshot checks names against the org without the org. A description is kept as the fields, the lookups and
 * the child relationships of the object, as a JSON object: the resolver reads it whole, and no query looks into it.
 * A snapshot from before this migration, and a snapshot of a repository, has none.
 */
export const migration0012: Migration = {
  version: 12,
  name: 'object-descriptions',
  sql: `
-- How the descriptions of the objects were read for a snapshot. No row: they were not asked for.
CREATE TABLE snapshot_description_reading (
  snapshot_id INTEGER PRIMARY KEY REFERENCES snapshot (id) ON DELETE CASCADE,
  -- whole: every object asked for is described. partial: some are not. none: objects were asked for, none is described.
  state       TEXT NOT NULL CHECK (state IN ('whole', 'partial', 'none')),
  -- When the first request was sent and when the reading ended, so that its time is known.
  started_at  TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  read_at     TEXT NOT NULL CHECK (read_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
                                   AND read_at >= started_at),
  requests    INTEGER NOT NULL CHECK (requests >= 0),
  -- The objects that were asked for, those the org does not know, and those for which no description came otherwise.
  asked       INTEGER NOT NULL CHECK (asked >= 0),
  unknown     INTEGER NOT NULL CHECK (unknown >= 0),
  failed      INTEGER NOT NULL CHECK (failed >= 0),
  -- The code of the first failure.
  code        TEXT
) STRICT;

-- The description of one object, as a JSON object with its name, its fields and its child relationships.
CREATE TABLE snapshot_object_description (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot_description_reading (snapshot_id) ON DELETE CASCADE,
  -- The name of the object, as the org writes it.
  object      TEXT NOT NULL CHECK (object <> ''),
  description TEXT NOT NULL CHECK (json_valid(description) AND json_type(description) = 'object'),
  PRIMARY KEY (snapshot_id, object)
) STRICT, WITHOUT ROWID;
`,
};
