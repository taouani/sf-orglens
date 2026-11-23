import type { Migration } from './migration.ts';

/**
 * The versions of the flows of an org, as the Tooling API named them when the Dependency API was read for a
 * snapshot (decision record 0067).
 *
 * A row of the Dependency API from a flow carries the id of a version of the flow, and the org lists a flow with
 * the id of its latest version only. The ids of the active and of the latest version are kept with the rows, so
 * that every analysis of the snapshot matches the rows of a flow to its versions without the org.
 */
export const migration0009: Migration = {
  version: 9,
  name: 'flow-versions',
  sql: `
-- One flow of the org. No row for a flow: the org was not asked, did not answer, or did not name it.
CREATE TABLE snapshot_flow_version (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot_dependency_reading (snapshot_id) ON DELETE CASCADE,
  -- The full name of the flow, with the prefix of its package before two underscores.
  flow        TEXT NOT NULL CHECK (flow <> ''),
  -- The id of the active version. NULL: no version of the flow is active.
  active_id   TEXT CHECK (active_id IS NULL OR active_id <> ''),
  -- The id of the latest version. NULL: the org named none.
  latest_id   TEXT CHECK (latest_id IS NULL OR latest_id <> ''),
  PRIMARY KEY (snapshot_id, flow)
) STRICT, WITHOUT ROWID;
`,
};
