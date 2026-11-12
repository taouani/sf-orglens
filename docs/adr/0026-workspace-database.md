# 0026. The workspace database: how it is opened, migrated and what its first schema holds

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

A workspace keeps everything in one SQLite file ([0006](0006-sqlite-single-store.md)) that holds immutable snapshots
([0007](0007-immutable-snapshots.md)). The file outlives any one version of OrgLens, several processes can use it
at once (a snapshot in one terminal, a query in another, later a local web server), and a user may point OrgLens at
a folder that already holds some other database. The research note
[sqlite-store.md](../research/phase-0/sqlite-store.md) measured the options. The benchmark is in `bench/`, and
[store-benchmark.md](../research/phase-0/store-benchmark.md) holds its current numbers.

## Decision

**Identity and version.** The `application_id` field of the file is set to the bytes `OLNS`, and `user_version` is
the schema version.

**Opening.** Every connection waits for a lock for the busy timeout (5 seconds by default). The steps run in this
order:

1. A file that exists is first looked at through a connection that cannot write. A file that is not an OrgLens
   database, and a file written by a newer version, are refused here. A connection that can write would complete
   what a crashed program left behind (move a write-ahead log into the file, roll back a journal), and that would
   change a file before it is identified. A file shorter than the smallest SQLite database (512 bytes) and not
   empty is refused by its size, because SQLite takes it for an empty database and would overwrite it.
2. The connection the store works with is opened, and the application id and the schema version are checked again,
   because the file can have changed in between. The three values that describe a file (whether it has tables, its
   application id, its version) are read in one read transaction, so that a migration another process commits at
   that moment cannot show a state that never existed.
3. Only then is write-ahead logging switched on and are the missing migrations run.

SQLite waits for most locks, but in a few moments it reports "busy" at once, for example while the last other
connection closes and tidies up. Opening is safe to repeat, so an open that is told "busy" tries again until the
busy timeout has passed. Eight processes that open one new database at the same moment all succeed, and exactly one
of them migrates (measured on Linux with both drivers, 960 opens).

Opening a database that is already current changes nothing in it. A read-only open never changes the database, and
it refuses a database that still needs a migration. An empty file is a database that is yet to be created.

What this does not promise: SQLite itself creates the `-wal` and `-shm` files next to a database in write-ahead
mode, also for a connection that only reads. So a read-only open needs a folder it can write to unless those files
are there, and it can leave them behind. A refused file keeps its bytes, and the files next to it can be created or
rewritten. A refused database in the older journal mode that a program left in the middle of a change cannot be
looked at without changing it: it is reported as a database that cannot be written, and is not touched. That case
has no test. The tests that take the right to write away run on Linux and macOS and are skipped for an
administrator, and the one for a folder that cannot be written runs on Linux only.

**Migrations.** Migrations are numbered from 1 without gaps and live in the code as SQL text. Each one runs in a
single transaction together with its version bump, so a failed migration changes nothing, and the migrations
before it stay applied. After taking the write lock a migration checks the identity and the version again, because
another process may have run it in the meantime. A released migration is never edited. A change is a new
migration.

Foreign keys are switched off while migrations run and on again afterwards. SQLite cannot change a constraint in
place: a migration that adds an allowed value builds a new table, copies the rows, drops the old table and renames
the new one. With foreign keys on, the drop would delete every row that refers to the old table. Before a migration
commits, all references are checked as a whole, and a migration that leaves a dangling one is rolled back.

**Concurrency.** One process writes at a time. Every write transaction takes the write lock at its start. A second
writer waits for the busy timeout and then fails with the error `STORE_BUSY`, "Another snapshot is running in this
workspace." Readers are never blocked by a writer and see the last committed state. A write transaction takes a
synchronous function: an asynchronous one is refused, because the transaction would end before its work does. The
store offers a checkpoint that moves the write-ahead log into the main file. The command that writes a snapshot
calls it after its large write. Nothing calls it yet.

The workspace should be on a local disk, because write-ahead logging is not safe on a network file system. Nothing
detects a network disk. Opening fails with an explanation only where SQLite itself refuses write-ahead logging.
Network and synced folders have not been tried.

**Statements.** The store keeps the statements it has prepared (the 64 most recent), so a statement that runs once
per row of a large write is prepared once.

**Schema conventions.** Tables are STRICT. Ids are integers, and the id of a source or a snapshot is never used
again after a delete, because a person or a saved result can hold one. A time that OrgLens writes is UTC in the one
form `2026-01-31T09:30:00.000Z`, which a constraint enforces, so that times compare and sort as text. Foreign keys
are enforced, and rows that belong to a snapshot are removed with it. A column that holds JSON is checked to be an
array or an object as its comment says. Counts are not negative. Values from a short fixed list, such as a status,
are text with a constraint and not integer codes as the research note suggested: the tables that have them are
small, and the database stays readable with any SQLite tool. The large tables for references decide this again for
themselves.

Names are stored as they were given. The inventory holds what the org listed, in the org's spelling, and nothing
folds case there: component keys do that ([0024](0024-component-key-grammar.md)). A path is not checked for
backslashes, because a file name on Linux may contain one. The reader that writes paths is responsible for forward
slashes.

**First schema.** Migration 1 holds what a snapshot consists of before anything is analysed: `source`, `snapshot`,
`blob`, `snapshot_file` (the files of a snapshot), `inventory_item` (what the org listed), `retrieve_chunk` (the
journal that lets an interrupted retrieve resume), `snapshot_type_coverage` and `snapshot_issue`.

**File contents.** A file body is stored once per distinct content, addressed by its SHA-256, and shared by every
snapshot that contains it. It is compressed with deflate when that makes it smaller, and its hash is checked when
it is read.

**Components and references** are not in the first schema. They come with the phase that extracts them, in the
shared-version layout the research measured: an identity row per component, a version row per distinct content, a
membership row per snapshot, and references attached to versions. One requirement is recorded here so that it is not
lost: the identity of a version has to cover the references extracted from it, not only the file body, because the
resolution of an Apex reference can depend on other files.

## Consequences

- OrgLens never changes the content of a database it did not create or cannot fully understand.
- Whatever a connection throws leaves the store as an error with one of seven `STORE_` codes: also a statement
  that fails outside a write transaction, a commit that fails, and a write to a file the user may not write. "Busy"
  is recognised at every step, also while a new database is being created by another process. An error has a hint
  where the user can do something. A failure that should not happen, such as a broken constraint, carries what
  SQLite said in its message and its details.
- The ids of sources and snapshots only grow. SQLite keeps a small table (`sqlite_sequence`) for that.
- Deleting a snapshot leaves file bodies that no snapshot uses any more. Removing those, and a retention policy,
  come with the commands that delete snapshots.
- Storing file bodies in the database makes comparison and re-analysis possible without the org. Research estimated
  the cost at about 40 MB compressed for 150 MB of source (a stand-in corpus, Linux only). The real figure is
  measured with the first real retrieve.
- Deflate was chosen because it is stable in every supported Node.js. The `encoding` column leaves room for another
  compression later.
- Both drivers are synchronous. A query that takes long blocks the process that runs it, which matters for the
  later web server and is decided with the impact engine ([0006](0006-sqlite-single-store.md)).
