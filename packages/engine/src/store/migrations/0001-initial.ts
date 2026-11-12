import type { Migration } from './migration.ts';

/**
 * The first schema: what a snapshot is made of before anything is analysed.
 *
 * Tables for components and references come with the phase that extracts
 * them. Every table is STRICT, ids are integers, and times are ISO 8601
 * text in UTC.
 */
export const migration0001: Migration = {
  version: 1,
  name: 'initial',
  sql: `
-- A declared source: a live org, a sandbox, or a Git repository.
CREATE TABLE source (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('org', 'sandbox', 'git')),
  -- The Salesforce org id of an org or a sandbox. It identifies the org and is not a credential.
  org_id     TEXT,
  created_at TEXT NOT NULL
) STRICT;

-- One immutable reading of a source.
CREATE TABLE snapshot (
  id             INTEGER PRIMARY KEY,
  source_id      INTEGER NOT NULL REFERENCES source (id),
  status         TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  started_at     TEXT NOT NULL,
  finished_at    TEXT,
  engine_version TEXT NOT NULL,
  -- The Salesforce API version used for an org, and the commit that was read for a Git source.
  api_version    TEXT,
  git_commit     TEXT
) STRICT;
CREATE INDEX snapshot_by_source ON snapshot (source_id, id);

-- File contents, stored once per distinct content and shared between snapshots.
CREATE TABLE blob (
  id       INTEGER PRIMARY KEY,
  sha256   BLOB NOT NULL UNIQUE CHECK (length(sha256) = 32),
  -- 0: the body is stored as it is. 1: the body is compressed with deflate.
  encoding INTEGER NOT NULL CHECK (encoding IN (0, 1)),
  raw_size INTEGER NOT NULL CHECK (raw_size >= 0),
  body     BLOB NOT NULL
) STRICT;

-- The files of a snapshot, by their path inside the source, with forward slashes.
CREATE TABLE snapshot_file (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  blob_id     INTEGER NOT NULL REFERENCES blob (id),
  PRIMARY KEY (snapshot_id, path)
) STRICT, WITHOUT ROWID;
CREATE INDEX snapshot_file_by_blob ON snapshot_file (blob_id);

-- What the org listed when it was asked what exists. Coverage is measured against this.
CREATE TABLE inventory_item (
  snapshot_id      INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  full_name        TEXT NOT NULL,
  salesforce_id    TEXT,
  last_modified_at TEXT,
  namespace_prefix TEXT,
  manageable_state TEXT,
  PRIMARY KEY (snapshot_id, type, full_name)
) STRICT, WITHOUT ROWID;

-- The journal of a chunked retrieve. An interrupted snapshot resumes from the chunks that are not done.
CREATE TABLE retrieve_chunk (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  -- A JSON array of the members the chunk asks for.
  members     TEXT NOT NULL CHECK (json_valid(members)),
  attempts    INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT,
  error       TEXT,
  PRIMARY KEY (snapshot_id, seq)
) STRICT, WITHOUT ROWID;

-- Per metadata type: how many components were listed, retrieved and analysed.
CREATE TABLE snapshot_type_coverage (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  listed      INTEGER NOT NULL DEFAULT 0,
  retrieved   INTEGER NOT NULL DEFAULT 0,
  analysed    INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  PRIMARY KEY (snapshot_id, type)
) STRICT, WITHOUT ROWID;

-- Everything that went wrong or is uncertain in a snapshot, so that nothing is dropped silently.
CREATE TABLE snapshot_issue (
  id            INTEGER PRIMARY KEY,
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  severity      TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  code          TEXT NOT NULL,
  component_key TEXT,
  message       TEXT NOT NULL,
  details       TEXT CHECK (details IS NULL OR json_valid(details))
) STRICT;
CREATE INDEX snapshot_issue_by_snapshot ON snapshot_issue (snapshot_id, severity);
`,
};
