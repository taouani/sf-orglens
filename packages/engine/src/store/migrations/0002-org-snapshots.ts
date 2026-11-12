import type { Migration } from './migration.ts';

/**
 * What a snapshot of an org needs beyond the first schema. A snapshot of
 * an org is taken in steps over minutes, and has to be picked up again
 * after the process was stopped.
 */
export const migration0002: Migration = {
  version: 2,
  name: 'org-snapshots',
  sql: `
-- The job at Salesforce that retrieves the chunk, from the moment it is started. A snapshot that is resumed asks
-- for this job again and starts no second one.
ALTER TABLE retrieve_chunk ADD COLUMN job_id TEXT;

-- A row of the inventory is a component of the snapshot of an org. The org listed it, or it came back in a
-- retrieve, or both. A component that was listed and did not come back is what a partial snapshot is missing.
ALTER TABLE inventory_item ADD COLUMN listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1));
ALTER TABLE inventory_item ADD COLUMN retrieved INTEGER NOT NULL DEFAULT 0 CHECK (retrieved IN (0, 1));

-- Whether the source could say which components of the type it has.
--   ok: it listed them.  failed: it refused, so the count is not known.  unlistable: it never lists this type.
ALTER TABLE snapshot_type_coverage ADD COLUMN listing TEXT NOT NULL DEFAULT 'ok' CHECK (listing IN ('ok', 'failed', 'unlistable'));

-- At most one snapshot of a source is being taken at a time.
CREATE UNIQUE INDEX snapshot_one_running ON snapshot (source_id) WHERE status = 'running';
`,
};
