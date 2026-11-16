# store-benchmark

Numbers from `pnpm run bench:store` ([`bench/store.mjs`](../../../bench/README.md)), recorded on 16 November 2026
when the tables for components and references were built (work package 3 of the
[Phase 1 plan](../../plans/phase-1.md), decision record
[0040](../../adr/0040-components-and-references-in-the-database.md)). The benchmark of Phase 0 used tables of its
own and the SQLite bindings directly ([store-benchmark.md](../phase-0/store-benchmark.md)). This one goes through
the engine: `openStore`, `writeAnalysis` and `sqlGraph`.

## Conditions

- One machine: Linux x64, a 4-core virtual machine, warm file cache. Node.js v24.22.3, SQLite 3.54.1 with the
  default driver, SQLite 3.53.4 with `better-sqlite3`. Windows and macOS were not measured.
- The synthetic org of Phase 0, from the same seed, at two sizes. Factor 1 is the org of Phase 0: 147,323
  components in the first snapshot (about 10,000 of them top-level) and 602,458 references. Factor 2 has twice
  the top-level components and references: 295,286 components and 1,206,592 references. Between snapshots 2
  percent of the top-level components change, 0.3 percent are removed and 0.3 percent are added. A change to a
  top-level component changes everything it contains, as in Phase 0.
- The keys are keys of the engine, built with `buildKey`. Every reference has a file, a line and a column, except
  the ones the generator gives the origin `dependency-api`, which have no place.
- The benchmark makes the components in memory first, and then measures `writeAnalysis` alone. Making them took
  0.7 seconds at factor 1 and 1.5 seconds at factor 2. In the engine an analyser makes them, and how long that
  takes is not measured here.
- Each command was run once or twice. The figures are indications, not statistics. Read times are the median of
  five runs, and of three for the walk from the hub field.
- The benchmark of Phase 0 was run again on the same day on this machine, for a number to hold the times
  against: it loaded its first snapshot in 3.4 seconds, where the note of Phase 0 recorded 4.0.

## The three numbers the plan asks for

`pnpm run bench:store node 1 10` and `pnpm run bench:store node 2 10`.

| Measurement | Phase 0, own tables | Real store, factor 1 | Real store, factor 2 |
| --- | --- | --- | --- |
| Database size after the first snapshot | 105.8 MB | 94.0 MB | 189.6 MB |
| Database size after ten snapshots | 159.0 MB | 145.5 MB | 293.2 MB |
| Time to write the first snapshot | 4.0 s | 6.8 s | 15.1 s |
| Time to write a later snapshot (average of nine) | 0.37 s | 3.0 s | 6.7 s |

- **Size.** The real store is smaller than the tables of Phase 0, by 11 percent after one snapshot and by 8
  percent after ten. It holds more for every reference (the column, the resolution, the name as written, the
  file) and less text: kind, origin, confidence and resolution are numbers, and a path is stored once. The
  tables of Phase 0 also held an index for the lookup by name, which the real store does not have yet.
- **The first write** takes 1.7 times as long as in Phase 0 by the recorded number, and 2.0 times as long by the
  number of the same day. Both are within the limit the plan set, which was twice the recorded 4 seconds. About 3
  of the 6.8 seconds are work the benchmark of Phase 0 did not do: the store checks every key, writes every
  reference as text in one fixed order, and takes a SHA-256 of every version. About 3.8 seconds are spent inside
  SQLite, which writes 1.04 million rows.
- **A later write is not comparable.** The benchmark of Phase 0 knew from its own memory which components had
  changed and skipped the others. The store is handed every component of the snapshot and finds out by itself
  that 97.6 percent of them have a version already: it takes the digest of each and looks it up. That is what a
  second snapshot costs when the analyser hands over everything. It adds about 5.7 MB per snapshot at factor 1.

The second driver, with two snapshots at factor 1 (`pnpm run bench:store bs3 1 2`): the same sizes (94.0 MB and
99.7 MB), 8.1 seconds for the first write and 2.9 for the second. The default driver took 7.3 and 3.0 seconds in
the run next to it.

## Where the space goes

Factor 1, after ten snapshots, in MB.

| Table or index | Rows | MB |
| --- | --- | --- |
| `reference` | 721,025 | 38.1 |
| `component_version` | 177,791 | 21.9 |
| `snapshot_component` | 1,476,242 | 21.1 |
| index of `snapshot_component` by version | | 20.9 |
| index of `component` by key | | 11.3 |
| index of `reference` by target | | 10.1 |
| `component` | 151,060 | 10.0 |
| index of `component_version` by component and digest | | 8.7 |
| index of `component` by parent | | 1.8 |
| `file_path` and its index | 10,198 | 1.5 |

The list of a snapshot and its index take 4.2 MB per snapshot. After ten snapshots that is more than the table
of references takes.

## What was changed because of the benchmark

- **The order of the tables in the statements that read.** The first run did not end: SQLite answered "which
  references point at this component" by walking the list of the snapshot, 147,000 rows for every question. The
  statements of `sqlGraph` now fix the order of their tables, and a test reads the query plan of each of them.
  With that, the references to the hub field come back in 160 milliseconds.
- **The page cache.** With the default of SQLite, 2 MiB, the first write took 9.4 seconds. With 16 MiB or more
  it took 7.4. `openStore` now sets 64 MiB for every connection. SQLite takes the memory only as it reads pages.
- **The digest.** Taking it over one text of lines, and not over a list of texts that is written as JSON a
  second time, brought the first write from 7.4 to 6.8 seconds.
- Two things were tried and not kept. Without the check of foreign keys the first write took 6.7 seconds and not
  7.4, and the check stays. Not looking for a version of a component whose key is new made no difference that
  could be measured.

## Reading, through the interface of the engines

Factor 1 after ten snapshots, on the last snapshot, with the default driver.

| Measurement | Time |
| --- | --- |
| Find a component by its key | 0.05 ms |
| The 21,995 references to the hub field, each with both keys, file, line and column | 160 ms |
| The one reference to an ordinary field | 0.13 ms |
| Everything within five steps of an ordinary field (5 components) | 0.22 ms |
| Everything within five steps of the hub field (57,934 components), one question per component | 3.5 s |

At factor 2 the hub field has 40,003 references, they come back in 330 milliseconds, and the walk of five steps
reaches 115,025 components in 7.6 seconds. With `better-sqlite3` the walk at factor 1 took 1.2 seconds and not
3.3: reading many rows through the driver port is slower with the default driver, as the note of Phase 0 said it
would be.

The walk asks one question per component and builds an object for every reference it reads. It is the slowest
way to answer an impact question, and it is here to say what that way costs. The target of record
[0037](../../adr/0037-performance-targets.md) is an impact query under 5 seconds for an org of 100,000
components. From the worst field of the org of factor 2 this way does not meet it. Phase 0 measured the same
walk at 3 milliseconds on an index held in memory, after 300 milliseconds to load it, and at 0.8 seconds as one
recursive statement. Which of them the impact engine uses is decided in work package 7, with these numbers. The
interface `SnapshotGraph` is there so that the engine does not have to know.

## What this does not say

- Nothing was measured on Windows, on macOS or on a real org.
- The org is synthetic. A real org can have many more references per component.
- How the 100,000 components of the targets are counted is still open with the maintainer. Factor 2 is the
  reading of the plan: components as an org lists them, fields included. If top-level components are meant, the
  size is factor 10, and that run was not made.
- The time an analyser takes is not in these numbers, and neither is the time to read the files of a snapshot.
