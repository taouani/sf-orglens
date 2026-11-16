import type { Migration } from './migration.ts';

/**
 * Components and references: what the analysis of a snapshot finds (decision record 0040).
 *
 * A component has one row for its key, whatever snapshot names it. What a snapshot found for it is a version:
 * its name as written, the file that defines it, its attributes and its references. A version is stored once
 * and shared by every snapshot in which the component is the same, so a snapshot is a list of versions.
 *
 * The table of references is the large one. Its four values from fixed lists are numbers, and
 * `reference_vocabulary` says what each number means, so that the database can still be read with any SQLite
 * tool.
 */
const utc = (column: string): string =>
  `${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'`;

export const migration0003: Migration = {
  version: 3,
  name: 'components',
  sql: `
-- Every key that an analysis ever named: a component of a snapshot, or the target of a reference. The key holds
-- the type, so the components of one type are a range of keys.
CREATE TABLE component (
  id        INTEGER PRIMARY KEY,
  key       TEXT NOT NULL UNIQUE CHECK (key <> ''),
  -- The component that contains this one, as the key says it: the object of a field, the class of a method.
  parent_id INTEGER REFERENCES component (id)
) STRICT;
CREATE INDEX component_by_parent ON component (parent_id) WHERE parent_id IS NOT NULL;

-- The paths of the files that components and references name, each stored once.
CREATE TABLE file_path (
  id   INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE CHECK (path <> '')
) STRICT;

-- What one analysis found for a component. Two snapshots in which the component is the same share the row.
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

-- The meaning of the numbers in the table of references.
CREATE TABLE reference_vocabulary (
  family TEXT NOT NULL CHECK (family IN ('kind', 'origin', 'confidence', 'resolution')),
  code   INTEGER NOT NULL CHECK (code >= 1),
  name   TEXT NOT NULL CHECK (name <> ''),
  PRIMARY KEY (family, code),
  UNIQUE (family, name)
) STRICT, WITHOUT ROWID;
INSERT INTO reference_vocabulary (family, code, name) VALUES
  ('kind', 1, 'reads'), ('kind', 2, 'writes'), ('kind', 3, 'calls'), ('kind', 4, 'extends'),
  ('kind', 5, 'implements'), ('kind', 6, 'uses-type'), ('kind', 7, 'triggers-on'), ('kind', 8, 'grants'),
  ('kind', 9, 'references'),
  ('origin', 1, 'parser:xml'), ('origin', 2, 'parser:formula'), ('origin', 3, 'parser:flow'),
  ('origin', 4, 'parser:apex'), ('origin', 5, 'symboltable'), ('origin', 6, 'dependency-api'),
  ('confidence', 1, 'confirmed'), ('confidence', 2, 'probable'), ('confidence', 3, 'possible'),
  ('resolution', 1, 'resolved'), ('resolution', 2, 'unresolved'), ('resolution', 3, 'external'),
  ('resolution', 4, 'dynamic');

-- The references of a version, in the order of their places. The rows of a version lie together.
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
  CHECK ((path_id IS NULL) = (line IS NULL)),
  CHECK (col IS NULL OR line IS NOT NULL)
) STRICT, WITHOUT ROWID;
CREATE INDEX reference_by_target ON reference (target_id, version_id) WHERE target_id IS NOT NULL;

-- The components of a snapshot, each with the version the analysis found.
CREATE TABLE snapshot_component (
  snapshot_id  INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES component (id),
  version_id   INTEGER NOT NULL REFERENCES component_version (id),
  PRIMARY KEY (snapshot_id, component_id)
) STRICT, WITHOUT ROWID;
-- From a version to the snapshots that hold it: for the walk from a reference to its component in one
-- snapshot, and to find the versions that no snapshot holds any more.
CREATE INDEX snapshot_component_by_version ON snapshot_component (version_id, snapshot_id);

-- The analysis of a snapshot. A snapshot without a row was not analysed. The files of a snapshot never change,
-- and its analysis belongs to the version of the engine that made it: it is replaced as a whole.
CREATE TABLE snapshot_analysis (
  snapshot_id    INTEGER PRIMARY KEY REFERENCES snapshot (id) ON DELETE CASCADE,
  engine_version TEXT NOT NULL CHECK (engine_version <> ''),
  analysed_at    TEXT NOT NULL CHECK (${utc('analysed_at')}),
  components     INTEGER NOT NULL CHECK (components >= 0),
  refs           INTEGER NOT NULL CHECK (refs >= 0)
) STRICT;

-- Per origin of references: what the analysis of a snapshot looked at and what it found.
CREATE TABLE snapshot_origin_coverage (
  snapshot_id  INTEGER NOT NULL REFERENCES snapshot (id) ON DELETE CASCADE,
  origin       INTEGER NOT NULL CHECK (origin >= 1),
  -- Components the analyser of this origin looked at, and files it could not read.
  components   INTEGER NOT NULL CHECK (components >= 0),
  failed_files INTEGER NOT NULL CHECK (failed_files >= 0),
  -- References it found, and how many of them name a target that was not found.
  refs         INTEGER NOT NULL CHECK (refs >= 0),
  unresolved   INTEGER NOT NULL CHECK (unresolved >= 0 AND unresolved <= refs),
  PRIMARY KEY (snapshot_id, origin)
) STRICT, WITHOUT ROWID;

-- An issue belongs to the reading of a snapshot or to its analysis. Those of the analysis are replaced with it.
ALTER TABLE snapshot_issue ADD COLUMN stage TEXT NOT NULL DEFAULT 'read' CHECK (stage IN ('read', 'analysis'));
`,
};
