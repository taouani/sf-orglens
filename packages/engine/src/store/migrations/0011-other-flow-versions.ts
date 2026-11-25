import type { Migration } from './migration.ts';

/**
 * The other versions of the flows of an org: those that are neither active nor the latest, as the Tooling API named
 * them when the Dependency API was read for a snapshot (decision record 0078).
 *
 * The Dependency API keeps the rows of a version of a flow that a deploy left behind, and a row carries the id of
 * the version. The ids are kept with the rows, as those of the active and of the latest version are (migration 9),
 * so that every analysis of the snapshot counts such a row as one of another version without the org. A snapshot
 * from before this migration has none: such a row names a component the org did not list.
 */
export const migration0011: Migration = {
  version: 11,
  name: 'other-flow-versions',
  sql: `
-- One version of a flow of the org. No row: the org was not asked, did not answer, or named none.
CREATE TABLE snapshot_flow_other_version (
  snapshot_id INTEGER NOT NULL,
  -- The full name of the flow, as in snapshot_flow_version.
  flow        TEXT NOT NULL,
  -- The id of the version.
  version_id  TEXT NOT NULL CHECK (version_id <> ''),
  PRIMARY KEY (snapshot_id, flow, version_id),
  FOREIGN KEY (snapshot_id, flow) REFERENCES snapshot_flow_version (snapshot_id, flow) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;
`,
};
