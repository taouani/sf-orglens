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

**Opening.** The steps run in this order:

1. Set the busy timeout (5 seconds by default).
2. Read the application id and the schema version. A file that is not an OrgLens database, and a file written by a
   newer version, are refused. Nothing has been written at this point.
3. Only then switch to write-ahead logging and run the migrations that are missing.

Opening a database that is already current writes nothing. A read-only open never writes, and it refuses a database
that still needs a migration.

**Migrations.** Migrations are numbered from 1 without gaps and live in the code as SQL text. Each one runs in a
single transaction together with its version bump, so a failed migration leaves the file as it was. After taking the
write lock a migration checks the version again, because another process may have run it in the meantime. A
released migration is never edited. A change is a new migration.

**Concurrency.** One process writes at a time. Every write transaction takes the write lock at its start. A second
writer waits for the busy timeout and then fails with the error `STORE_BUSY`, "Another snapshot is running in this
workspace." Readers are never blocked by a writer and see the last committed state. The write-ahead log is moved
into the main file after a large write. The workspace has to be on a local disk: if write-ahead logging cannot be
switched on, opening fails with an explanation.

**Schema conventions.** Tables are STRICT. Ids are integers. Times are ISO 8601 text in UTC. Foreign keys are
enforced, and rows that belong to a snapshot are removed with it. A column that holds JSON is checked to be JSON.

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

- OrgLens never changes a database it did not create or cannot fully understand.
- Every failure of the database reaches the user as one of seven `STORE_` error codes with a hint, not as a raw
  SQLite message.
- Deleting a snapshot leaves file bodies that no snapshot uses any more. Removing those, and a retention policy,
  come with the commands that delete snapshots.
- Storing file bodies in the database makes comparison and re-analysis possible without the org. Research estimated
  the cost at about 40 MB compressed for 150 MB of source (a stand-in corpus, Linux only). The real figure is
  measured with the first real retrieve.
- Deflate was chosen because it is stable in every supported Node.js. The `encoding` column leaves room for another
  compression later.
- Both drivers are synchronous. A query that takes long blocks the process that runs it, which matters for the
  later web server and is decided with the impact engine ([0006](0006-sqlite-single-store.md)).
