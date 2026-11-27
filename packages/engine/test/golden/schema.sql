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
, layout TEXT CHECK (layout IS NULL OR (json_valid(layout) AND json_type(layout) = 'object'))) STRICT;

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
  manageable_state TEXT, listed INTEGER NOT NULL DEFAULT 1 CHECK (listed IN (0, 1)), retrieved INTEGER NOT NULL DEFAULT 0 CHECK (retrieved IN (0, 1)), came_back_as TEXT CHECK (came_back_as IS NULL OR came_back_as <> ''),
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
  error       TEXT, job_id TEXT,
  PRIMARY KEY (snapshot_id, seq)
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
, stage TEXT NOT NULL DEFAULT 'read' CHECK (stage IN ('read', 'analysis'))) STRICT;

CREATE INDEX snapshot_issue_by_snapshot ON snapshot_issue (snapshot_id, severity);

CREATE UNIQUE INDEX snapshot_one_running ON snapshot (source_id) WHERE status = 'running';

CREATE TABLE component (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE CHECK (key <> ''),
  -- The component that contains this one, as the key says it: the object of a field, the class of a method.
  parent_id INTEGER REFERENCES component (id)
) STRICT;

CREATE INDEX component_by_parent ON component (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE file_path (
  id   INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE CHECK (path <> '')
) STRICT;

CREATE TABLE component_version (
  id           INTEGER PRIMARY KEY,
  component_id INTEGER NOT NULL REFERENCES component (id),
  -- SHA-256 over everything the version holds: the columns of this row, the content of what defines the
  -- component in the source, and its references with their places.
  digest       BLOB NOT NULL CHECK (length(digest) = 32),
  -- The name as the source spells it.
  name         TEXT NOT NULL CHECK (name <> ''),
  -- The file that defines the component. NULL: the source names the component and does not define it, as a
  -- repository does with a standard object of which it holds only fields.
  path_id      INTEGER REFERENCES file_path (id),
  -- A JSON object, with its keys in order.
  attrs        TEXT CHECK (attrs IS NULL OR (json_valid(attrs) AND json_type(attrs) = 'object')),
  UNIQUE (component_id, digest)
) STRICT;

CREATE TABLE reference_vocabulary (
  family TEXT NOT NULL CHECK (family IN ('kind', 'origin', 'confidence', 'resolution')),
  code   INTEGER NOT NULL CHECK (code >= 1),
  name   TEXT NOT NULL CHECK (name <> ''),
  PRIMARY KEY (family, code),
  UNIQUE (family, name)
) STRICT, WITHOUT ROWID;

CREATE TABLE reference (
  version_id  INTEGER NOT NULL REFERENCES component_version (id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL CHECK (seq >= 0),
  -- The component the reference points at. It need not be a component of any snapshot. NULL: the target was
  -- named and could not be given a key. Its type is then in target_type.
  target_id   INTEGER REFERENCES component (id),
  target_type TEXT CHECK (target_type <> ''),
  -- The target as the source wrote it.
  raw_name    TEXT NOT NULL CHECK (raw_name <> ''),
  -- Four numbers of reference_vocabulary. A list can get a new value with one row there, so no upper bound
  -- stands here: the code that writes checks the number against the list.
  kind        INTEGER NOT NULL CHECK (kind >= 1),
  origin      INTEGER NOT NULL CHECK (origin >= 1),
  confidence  INTEGER NOT NULL CHECK (confidence >= 1),
  resolution  INTEGER NOT NULL CHECK (resolution >= 1),
  -- Where the reference was found. What Salesforce reports can have no place.
  path_id     INTEGER REFERENCES file_path (id),
  line        INTEGER CHECK (line >= 1),
  col         INTEGER CHECK (col >= 1),
  -- A JSON object, with its keys in order.
  attrs       TEXT CHECK (attrs IS NULL OR (json_valid(attrs) AND json_type(attrs) = 'object')),
  PRIMARY KEY (version_id, seq),
  CHECK ((target_id IS NULL) <> (target_type IS NULL)),
  -- The rules of the vocabulary that tie two columns together. A resolved reference (1) has a target and an
  -- unresolved one (2) has none. A possible one (confidence 3) has a target. A dynamic one (resolution 4) is
  -- never confirmed (confidence 1).
  CHECK (resolution <> 1 OR target_id IS NOT NULL),
  CHECK (resolution <> 2 OR target_id IS NULL),
  CHECK (confidence <> 3 OR target_id IS NOT NULL),
  CHECK (resolution <> 4 OR confidence <> 1),
  CHECK ((path_id IS NULL) = (line IS NULL)),
  CHECK (col IS NULL OR line IS NOT NULL)
) STRICT, WITHOUT ROWID;

CREATE INDEX reference_by_target ON reference (target_id, version_id) WHERE target_id IS NOT NULL;

CREATE TABLE snapshot_component (
  snapshot_id  INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES component (id),
  version_id   INTEGER NOT NULL REFERENCES component_version (id),
  PRIMARY KEY (snapshot_id, component_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX snapshot_component_by_version ON snapshot_component (version_id, snapshot_id);

CREATE TABLE snapshot_analysis (
  snapshot_id    INTEGER PRIMARY KEY REFERENCES snapshot (id) ON DELETE CASCADE,
  engine_version TEXT NOT NULL CHECK (engine_version <> ''),
  analysed_at    TEXT NOT NULL CHECK (analysed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
  components     INTEGER NOT NULL CHECK (components >= 0),
  refs           INTEGER NOT NULL CHECK (refs >= 0)
, types TEXT CHECK (types IS NULL OR (json_valid(types) AND json_type(types) = 'array')), cross_check TEXT CHECK (cross_check IS NULL OR (json_valid(cross_check) AND json_type(cross_check) = 'object'))) STRICT;

CREATE TABLE snapshot_origin_coverage (
  snapshot_id  INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  origin       INTEGER NOT NULL CHECK (origin >= 1),
  -- Components the analyser of this origin looked at, and files it could not read.
  components   INTEGER NOT NULL CHECK (components >= 0),
  failed_files INTEGER NOT NULL CHECK (failed_files >= 0),
  -- References it found, and how many of them name a target that was not found.
  refs         INTEGER NOT NULL CHECK (refs >= 0),
  unresolved   INTEGER NOT NULL CHECK (unresolved >= 0 AND unresolved <= refs), texts_written INTEGER CHECK (texts_written >= 0), texts_metadata INTEGER CHECK (texts_metadata >= 0), texts_built INTEGER CHECK (texts_built >= 0), texts_possible INTEGER CHECK (texts_possible >= 0), texts_not_followed INTEGER CHECK (
  (texts_not_followed IS NULL OR texts_not_followed >= 0)
  AND (texts_not_followed IS NULL) = (texts_written IS NULL)
  AND (texts_not_followed IS NULL) = (texts_metadata IS NULL)
  AND (texts_not_followed IS NULL) = (texts_built IS NULL)
  AND (texts_not_followed IS NULL) = (texts_possible IS NULL)
),
  PRIMARY KEY (snapshot_id, origin)
) STRICT, WITHOUT ROWID;

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

CREATE TABLE "snapshot_type_coverage" (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type <> ''),
  listed      INTEGER NOT NULL DEFAULT 0 CHECK (listed >= 0),
  retrieved   INTEGER NOT NULL DEFAULT 0 CHECK (retrieved >= 0),
  analysed    INTEGER NOT NULL DEFAULT 0 CHECK (analysed >= 0),
  note        TEXT,
  listing     TEXT NOT NULL DEFAULT 'ok' CHECK (listing IN ('ok', 'failed', 'unlistable', 'excluded')),
  PRIMARY KEY (snapshot_id, type)
) STRICT, WITHOUT ROWID;

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

CREATE INDEX reference_by_unresolved_target ON reference (target_type, raw_name COLLATE NOCASE)
  WHERE target_id IS NULL;

CREATE TABLE snapshot_flow_other_version (
  snapshot_id INTEGER NOT NULL,
  -- The full name of the flow, as in snapshot_flow_version.
  flow        TEXT NOT NULL,
  -- The id of the version.
  version_id  TEXT NOT NULL CHECK (version_id <> ''),
  PRIMARY KEY (snapshot_id, flow, version_id),
  FOREIGN KEY (snapshot_id, flow) REFERENCES snapshot_flow_version (snapshot_id, flow) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

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

CREATE TABLE snapshot_object_description (
  snapshot_id INTEGER NOT NULL REFERENCES snapshot_description_reading (snapshot_id) ON DELETE CASCADE,
  -- The name of the object, as the org writes it.
  object      TEXT NOT NULL CHECK (object <> ''),
  description TEXT NOT NULL CHECK (json_valid(description) AND json_type(description) = 'object'),
  PRIMARY KEY (snapshot_id, object)
) STRICT, WITHOUT ROWID;
