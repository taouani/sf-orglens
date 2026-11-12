CREATE TABLE source (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE CHECK (name <> ''),
  kind       TEXT NOT NULL CHECK (kind IN ('org', 'sandbox', 'git')),
  -- The Salesforce org id of an org or a sandbox. It identifies the org and is not a credential.
  org_id     TEXT,
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TABLE snapshot (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id      INTEGER NOT NULL REFERENCES source (id),
  status         TEXT NOT NULL CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  started_at     TEXT NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  finished_at    TEXT CHECK (finished_at IS NULL OR finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  engine_version TEXT NOT NULL,
  -- The Salesforce API version used for an org, and the commit that was read for a Git source.
  api_version    TEXT,
  git_commit     TEXT
) STRICT;

CREATE INDEX snapshot_by_source ON snapshot (source_id, id);

CREATE TABLE blob (
  id       INTEGER PRIMARY KEY,
  sha256   BLOB NOT NULL UNIQUE CHECK (length(sha256) = 32),
  -- 0: the body is stored as it is. 1: the body is compressed with deflate.
  encoding INTEGER NOT NULL CHECK (encoding IN (0, 1)),
  raw_size INTEGER NOT NULL CHECK (raw_size >= 0),
  body     BLOB NOT NULL,
  CHECK (encoding <> 0 OR raw_size = length(body))
) STRICT;

CREATE TABLE snapshot_file (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  path        TEXT NOT NULL CHECK (path <> ''),
  blob_id     INTEGER NOT NULL REFERENCES blob (id),
  PRIMARY KEY (snapshot_id, path)
) STRICT, WITHOUT ROWID;

CREATE INDEX snapshot_file_by_blob ON snapshot_file (blob_id);

CREATE TABLE inventory_item (
  snapshot_id      INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type <> ''),
  full_name        TEXT NOT NULL CHECK (full_name <> ''),
  salesforce_id    TEXT,
  -- As the org reported it.
  last_modified_at TEXT,
  namespace_prefix TEXT,
  manageable_state TEXT,
  PRIMARY KEY (snapshot_id, type, full_name)
) STRICT, WITHOUT ROWID;

CREATE TABLE retrieve_chunk (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL CHECK (seq >= 0),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  -- A JSON array of the members the chunk asks for.
  members     TEXT NOT NULL CHECK (json_valid(members) AND json_type(members) = 'array'),
  attempts    INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  started_at  TEXT CHECK (started_at IS NULL OR started_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  finished_at TEXT CHECK (finished_at IS NULL OR finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  error       TEXT,
  PRIMARY KEY (snapshot_id, seq)
) STRICT, WITHOUT ROWID;

CREATE TABLE snapshot_type_coverage (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type <> ''),
  listed      INTEGER NOT NULL DEFAULT 0 CHECK (listed >= 0),
  retrieved   INTEGER NOT NULL DEFAULT 0 CHECK (retrieved >= 0),
  analysed    INTEGER NOT NULL DEFAULT 0 CHECK (analysed >= 0),
  note        TEXT,
  PRIMARY KEY (snapshot_id, type)
) STRICT, WITHOUT ROWID;

CREATE TABLE snapshot_issue (
  id            INTEGER PRIMARY KEY,
  snapshot_id   INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  severity      TEXT NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  code          TEXT NOT NULL,
  component_key TEXT,
  message       TEXT NOT NULL,
  -- A JSON object.
  details       TEXT CHECK (details IS NULL OR (json_valid(details) AND json_type(details) = 'object'))
) STRICT;

CREATE INDEX snapshot_issue_by_snapshot ON snapshot_issue (snapshot_id, severity);
