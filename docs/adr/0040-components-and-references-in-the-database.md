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
it. `sqlGraph` answers each question with one statement, and with up to two more for a component the snapshot
does not hold. An engine can be given another implementation of the interface.

A snapshot knows a component that it holds, one that a component of it refers to, and one that contains a
component it knows. So the parent of a component the snapshot knows is always known to it: a repository that
reads `Account.Name` and holds no file for the object knows the field and the object, both without a version.
A key that only another snapshot of the database knows is not known.

A snapshot has one analysis. Writing a second one replaces the first as a whole, with its coverage and its
issues of the stage `analysis`, and removes the versions that only the first one held. The files of a snapshot
never change (record 0007). What is found in them can be found again by a newer engine, which
[0038](0038-a-snapshot-reads-every-type.md) needs: a snapshot reads every type, and the analysers come phase by
phase.

These are choices of the author, thirteen in number:

1. **No column for the type.** A key starts with its type, so the components of one type are a range of keys
   in the index the table has anyway.
2. **The name as written, the file and the attributes belong to the version**, not to the key. A component can
   be spelled or filed differently in two sources.
3. **The place of a reference is part of the version.** A component whose references move by a line gets a new
   version, also when nothing else changed. Two different versions therefore do not mean that a component
   changed in a way a user cares about. This has a cost that the benchmark does not show, because all its
   snapshots are of one source: an org rewrites almost every file, and the lines and columns of the same
   formula differ between an org and a repository (finding 3 of the Phase 1 plan). A snapshot of an org and one
   of the repository of the same project will share few versions. The comparison of the two cannot rest on
   "the same version", and has to compare what the versions hold. What "the same" means for a comparison is
   decided with the comparison engine, and not here. If that engine wants a second digest, over what a
   comparison cares about, a later migration adds the column and a snapshot gets it when it is analysed again:
   the files of every snapshot are kept, so every version can be made again.
4. **The hash of the content is part of the digest and is not stored.** Nothing reads it, and it can be taken
   again from the files of the snapshot.
5. **References lie with their version.** The table has no row ids. Its primary key is the version and a
   running number, so the references of a version are next to each other on disk, and the one index is the one
   by target.
6. **Kind, origin, confidence and resolution are stored as numbers.** `reference_vocabulary` says what each
   number means, so the database can be read with any SQLite tool. The tables do not limit the numbers from
   above: a new value is one new row in that table, by a later migration, and no table is rebuilt.
   `writeAnalysis` refuses a value that is not in the lists of `core/references.ts`, and a test holds the table
   and the lists together.
7. **A path is stored once**, in `file_path`, and components and references hold its number.
8. **The store does not run `validateReference` again.** It trusts that a reference passed it, and checks
   only that the reference starts from the component it is stored with and that its four values are in the
   lists. The tables refuse a line or a column below 1, an empty name, attributes that are no object, a
   resolved or a possible reference without a target, an unresolved one with a target, and a dynamic one that
   is confirmed. Then nothing of the analysis is written. Four things neither checks, so a reference that did
   not pass `validateReference` can be stored with them: a parser's reference without a place or without a
   column, a path with a backslash, and a type of a target without a key that is no type name. A stated type that differs from the type of the target key is ignored: the key decides. Running
   `validateReference` in the store costs 1.1 to 1.5 seconds for 600,000 references, as the review of the pull
   request measured.
9. **Versions that no snapshot holds are removed only when an analysis is replaced**, and then all of them,
   also those a deleted snapshot left. Keys and paths are never removed. No command deletes a snapshot yet.
   The one that will has to remove the versions it leaves behind, and it will need indexes that the tables do
   not have: no index starts with the path of a reference or of a version, so removing a path means walking
   those tables. The id of a removed version can be given to a later one.
10. **The statements that read fix the order of their tables.** SQLite, left to choose, answered a question
    about one component by walking the whole list of the snapshot. A test reads the query plan of every
    statement of `sqlGraph`.
11. **Every connection gets a page cache of 64 MiB** in place of the 2 MiB of SQLite. SQLite takes the memory
    only as it reads pages.
12. **Nothing in the tables ties the version in the list of a snapshot to the component it is listed for.**
    Only `writeAnalysis` writes the list, and a test holds that it never gives a component the version of
    another. A constraint for it would cost one more index on the versions.
13. **The text a digest is taken over starts with the number of its form.** A change to what the text holds
    gives every component a new version in the next snapshot, and the database grows by a full snapshot. A
    test writes the text out, so that such a change is made knowingly.

## Consequences

- Measured through the real store on the synthetic org of Phase 0, on one Linux machine, with ten snapshots of
  one source ([store-benchmark.md](../research/phase-1/store-benchmark.md)): 94 MB after one snapshot and 146 MB
  after ten, where the tables of the Phase 0 benchmark took 106 MB and 159 MB. Those tables held an index for
  the lookup by name of 9 MB that the store does not have. Without it the store is 3 percent smaller. For an
  org of twice the size: 190 MB and 293 MB.
- Writing the first snapshot takes 7.0 to 8.0 seconds, where the benchmark of Phase 0 took 3.5 to 3.6 seconds
  on the same day and 4.0 seconds when it was recorded. That is about twice as long, which is the limit the
  plan set, and the maintainer is told. The two times do not hold the same work: the store checks every key
  and takes a digest of every version, and the benchmark of Phase 0 wrote an index for names. For an org of
  twice the size the first write takes 15 seconds.
- A later snapshot of the same source takes 3 seconds to write and adds about 6 MB. The store is handed every
  component and finds by the digest that most have a version already. Writing the analysis of a snapshot again
  takes about as long.
- A snapshot of another source of the same project shares few versions (choice 3). It is estimated to cost
  about 70 MB at that size, and was not measured.
- The list of a snapshot costs about 4 MB per snapshot at that size, with its index, whatever changed. After ten
  snapshots the lists are larger than the table of references. A retention policy is still needed (record 0007).
- Reading the 22,000 references to the most used field takes 180 milliseconds. The statement reads the
  references to a component in every version the database holds and then keeps those of the snapshot, so its
  time grows with the history of the components that refer to it. With ten snapshots it took as long as with
  two.
- Walking five steps from the most used field one question at a time takes 3.5 to 4.2 seconds, and 8 to 10
  seconds in the org of twice the size, which is above the target of 5 seconds of record
  [0037](0037-performance-targets.md). The impact engine of work package 7 needs a faster way for such a field:
  an index in memory or one recursive statement. Phase 0 measured both.
- Two snapshots that different versions of the engine analysed can differ for reasons that are no changes of
  the source: an engine that finds more references makes new versions. `snapshot_analysis` says which engine
  analysed a snapshot, so a comparison can say so or analyse the older one again first.
- A process that reads much of a large database can now hold up to 64 MiB of it in memory.
- `readIssues` gives the issues of both stages. The code that decides whether a snapshot is complete counts
  every issue that is an error. Work package 6, which writes the first analysis into a snapshot, has to make
  that count look at the stage. It also has to keep the column `analysed` of the coverage per type in step
  with the analysis, which `writeAnalysis` does not touch.
- The vocabulary table gives every origin of `core/references.ts` a number, also `symboltable`. No reference
  has that origin today: the symbol table of a saved class holds no reference (record
  [0034](0034-dependency-api-is-the-cross-check.md)). A value that leaves the list keeps its number, unused.
- The tables have no lookup by name with full-text search. The benchmark of Phase 0 had one. It comes with the
  command that needs it.
- A released migration is never edited. A fault in these tables is corrected by migration 4. A constraint
  cannot be added to the table of references later without writing the table again, which is why the four
  rules of the vocabulary that tie two columns together are constraints from the start.
- Not measured: Windows, macOS, a real org, an org and a repository of one project in one database, and an org
  of ten times the size of Phase 0's, which is what the targets mean if the maintainer counts top-level
  components only.
