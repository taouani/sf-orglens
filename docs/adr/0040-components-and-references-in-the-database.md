# 0040. Components and references in the workspace database

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (the tables of work package 3 of the Phase 1 plan)

## Context

Until now the workspace database held what a snapshot read: its files, what the source listed and what went
wrong ([0026](0026-workspace-database.md), [0032](0032-reading-an-org.md)). What an analysis finds in those files
had no tables. Records [0007](0007-immutable-snapshots.md) and [0010](0010-data-model-and-identity.md) say what
they must hold: components with keys that do not contain the org, references with origin, confidence and place,
and content that is stored once and shared between snapshots.

The research of Phase 0 measured three layouts on a synthetic org of 147,000 components and 600,000 references
([sqlite-store.md](../research/phase-0/sqlite-store.md)). The layout with shared versions was seven times smaller
after ten snapshots than a full copy per snapshot. The [Phase 1 plan](../plans/phase-1.md) asks for that layout
in work package 3, for coverage per origin, and for one interface to read through.

The maintainer approved the plan and so the layout. What follows under "Decision" fills it in, and the points
marked as choices of the author are the maintainer's to strike.

## Decision

Migration 3 adds eight tables. `packages/engine/test/golden/schema.sql` holds them as SQLite does.

- **`component`** has one row for every key an analysis ever named, as a component of a snapshot or as the
  target of a reference. It holds the key and the component that contains it, as the key says it. It holds
  nothing that can differ between snapshots.
- **`component_version`** is what one analysis found for a component: its name as the source spells it, the
  file that defines it, its attributes, and its references. Two snapshots in which the component is the same
  share the row.
- **`reference`** holds the references of a version, in the order of their places. A reference points at a row
  of `component`, which need not be a component of any snapshot: `CustomField:account.name` is a target in a
  repository that has no file for it. A target that could not be given a key has no row there. Its type and its
  name as written stand in the reference.
- **`snapshot_component`** is the list of a snapshot: for each of its components, the version it holds.
- **`snapshot_analysis`** says that a snapshot was analysed, when, and by which version of the engine. A
  snapshot without a row there was read and not analysed. That is what every snapshot of a database of schema
  version 2 is after the migration.
- **`snapshot_origin_coverage`** holds, for each origin that looked at a snapshot, how many components its
  analyser looked at, how many files it could not read, how many references it found and how many of them name
  a target that was not found. The analyser says the first two. The store counts the last two itself.
- **`file_path`** and **`reference_vocabulary`** are the two tables the next points explain.
- `snapshot_issue` gets a column `stage`, `read` or `analysis`. The issues a database held before are of the
  stage `read`.

A version is the same only if everything it holds is the same. The store takes a SHA-256 over the name, the path
of the file, the hash of the content that defines the component, the attributes with their keys in order, and
every reference with its place. A second snapshot of an unchanged source adds a list and no version. A formula
that stays as it is while the field it reads through now points elsewhere gets a new version, because its
references changed.

An analysis is written by `writeAnalysis` in one transaction, and read through the interface `SnapshotGraph`:
find a component by key or id, what it contains, the references that point at it, the references that start from
it. `sqlGraph` answers each question with one statement. An engine can be given another implementation of the
interface.

A snapshot has one analysis. Writing a second one replaces the first as a whole, with its coverage and its
issues of the stage `analysis`, and removes the versions that only the first one held. The files of a snapshot
never change (record 0007). What is found in them can be found again by a newer engine, which
[0038](0038-a-snapshot-reads-every-type.md) needs: a snapshot reads every type, and the analysers come phase by
phase.

These are choices of the author:

1. **No column for the type.** A key starts with its type, so the components of one type are a range of keys
   in the index the table has anyway.
2. **The name as written, the file and the attributes belong to the version**, not to the key. A component can
   be spelled or filed differently in two sources.
3. **The place of a reference is part of the version.** A component whose references move by a line gets a new
   version, also when nothing else changed. Two different versions therefore do not mean that a component
   changed in a way a user cares about. The comparison engine has to look at what differs.
4. **The hash of the content is part of the digest and is not stored.** Nothing reads it.
5. **References lie with their version.** The table has no row ids. Its primary key is the version and a
   running number, so the references of a version are next to each other on disk, and the one index is the one
   by target.
6. **Kind, origin, confidence and resolution are stored as numbers.** `reference_vocabulary` says what each
   number means, so the database can be read with any SQLite tool. The tables do not limit the numbers from
   above: a new value is one new row in that table, by a later migration, and no table is rebuilt.
   `writeAnalysis` refuses a value that is not in the lists of `core/references.ts`, and a test holds the table
   and the lists together.
7. **A path is stored once**, in `file_path`, and components and references hold its number.
8. **The store does not check a reference again.** It trusts that the reference passed `validateReference`, and
   checks only that it starts from the component it is stored with and that its four values are in the lists.
   The constraints of the tables refuse the rest, and then nothing of the analysis is written.
9. **Versions that no snapshot holds are removed only when an analysis is replaced.** No command deletes a
   snapshot yet. The one that will has to remove the versions it leaves behind.
10. **The statements that read fix the order of their tables.** SQLite, left to choose, answered a question
    about one component by walking the whole list of the snapshot. A test reads the query plan of every
    statement of `sqlGraph`.
11. **Every connection gets a page cache of 64 MiB** in place of the 2 MiB of SQLite. SQLite takes the memory
    only as it reads pages.

## Consequences

- Measured through the real store on the synthetic org of Phase 0, on one Linux machine
  ([store-benchmark.md](../research/phase-1/store-benchmark.md)): 94 MB after one snapshot and 146 MB after ten,
  where the tables of the Phase 0 benchmark took 106 MB and 159 MB. Writing the first snapshot takes 6.8
  seconds, where that benchmark took 4.0. For an org of twice the size: 190 MB, 293 MB and 15 seconds.
- A later snapshot of the same source takes 3 seconds to write and adds about 6 MB. The store is handed every
  component and finds by the digest that most have a version already.
- The list of a snapshot costs about 4 MB per snapshot at that size, with its index. After ten snapshots the
  lists are larger than the table of references. A retention policy is still needed (record 0007).
- Reading the 22,000 references to the most used field takes 160 milliseconds. Walking five steps from that
  field one question at a time takes 3.5 seconds, and 7.6 seconds in the org of twice the size, which is above
  the target of 5 seconds of record [0037](0037-performance-targets.md). The impact engine of work package 7
  needs a faster way for such a field: an index in memory or one recursive statement. Phase 0 measured both.
- A process that reads much of a large database can now hold up to 64 MiB of it in memory.
- `readIssues` gives the issues of both stages. The code that decides whether a snapshot is complete counts
  every issue that is an error. Work package 6, which writes the first analysis into a snapshot, has to make
  that count look at the stage.
- The tables have no lookup by name with full-text search. The benchmark of Phase 0 had one. It comes with the
  command that needs it.
- A released migration is never edited. A fault in these tables is corrected by migration 4.
- Not measured: Windows, macOS, a real org, and an org of ten times the size of Phase 0's, which is what the
  targets mean if the maintainer counts top-level components only.
