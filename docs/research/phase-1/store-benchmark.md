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
- All snapshots are of one source. An org and a repository of the same project were not measured, and they
  would not share versions the way two snapshots of one source do (see the end of this note).
- The keys are keys of the engine, built with `buildKey`. Every reference has a file, a line and a column, except
  the ones the generator gives the origin `dependency-api`, which have no place.
- The benchmark makes the components in memory first, and then measures `writeAnalysis` alone. Making them took
  0.7 to 0.8 seconds at factor 1 and 1.6 seconds at factor 2. In the engine an analyser makes them, and how long
  that takes is not measured here.
- All numbers are from runs made after the review of the pull request, with the code as it was merged. A time
  was measured in one run unless the text gives a range. The times of equal runs differ by up to a second, so a
  difference of a few tenths of a second between two single runs says nothing. The outputs of the runs are not
  in the repository.
- The benchmark of Phase 0 was run again on the same day on this machine, three times with one snapshot
  (`pnpm run bench node cas 1`), so that the times have a number of the same day to stand against.

## The three numbers the plan asks for

`pnpm run bench:store node 1 10` and `pnpm run bench:store node 2 10`, and for the first write also three runs
of `pnpm run bench:store node 1 1` and one of `node 1 2`.

| Measurement | Phase 0, as recorded | Phase 0, run again | Real store, factor 1 | Real store, factor 2 |
| --- | --- | --- | --- | --- |
| Database size after the first snapshot | 105.8 MB | 105.8 MB | 94.0 MB | 189.6 MB |
| Database size after ten snapshots | 159.0 MB | not run again | 145.5 MB | 293.2 MB |
| Time to write the first snapshot | 4.0 s | 3.5 to 3.6 s | 7.0 to 8.0 s, median 7.2 | 15.4 s |
| Time to write a later snapshot | 0.37 s | not run again | 2.9 to 3.5 s, average 3.1 | 6.1 to 7.0 s, average 6.6 |

- **Size.** The database of the real store is 11.8 MB smaller after the first snapshot. Of that, 9.0 MB is the
  index for the lookup by name that the tables of Phase 0 held and the real store does not have yet. Without
  that index the tables of Phase 0 take 96.8 MB, and the real store is 3 percent smaller. It holds more for
  every reference (the column, the resolution, the name as written, the file) in about the same space, because
  kind, origin, confidence and resolution are numbers and a path is stored once.
- **The first write takes about twice as long as in Phase 0**: 2.0 times by the medians of the same day (7.2
  against 3.6 seconds), between 1.9 and 2.3 times across the runs, and 1.8 times the 4.0 seconds that Phase 0
  recorded. The plan set the limit at "more than twice", so this is at the limit, and it is reported to the
  maintainer as the plan says.
- **The two times do not measure the same work.** The time of Phase 0 includes a SHA-256 of every content, the
  making of every attribute text and 147,000 rows of the index for the lookup by name. `store.mjs` does the
  first two before the clock starts (the 0.7 seconds above) and has no such index. The time of the real store
  includes what Phase 0 did not do at all: every key is checked, the references of every component are put in
  order and written as text, and a SHA-256 is taken of every version. A profile of one run, which was not kept,
  put a little more than half of the time inside SQLite and the rest in that work.
- **A later write is not comparable.** The benchmark of Phase 0 knew from its own memory which components had
  changed and skipped the others. The store is handed every component of the snapshot and finds out by itself
  that 97.6 percent of them have a version already: it takes the digest of each and looks it up. That is what a
  second snapshot costs when the analyser hands over everything. It adds about 5.7 MB per snapshot at factor 1.
- **Writing the analysis of a snapshot again** took 3.2 seconds at factor 1 after ten snapshots and 6.2 seconds
  at factor 2. It is the path a snapshot takes that a newer engine analyses again. It finds every version there
  already and then looks through all versions for those that nothing holds any more.

The second driver, with two snapshots at factor 1 (`pnpm run bench:store bs3 1 2`): the same sizes (94.0 MB and
99.7 MB), 8.3 seconds for the first write and 3.0 for the second. The default driver took 8.0 and 2.9 seconds in
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

The list of a snapshot and its index take 4.2 MB per snapshot, whatever changed in it. After ten snapshots that
is more than the table of references takes.

## What was changed because of the benchmark

- **The order of the tables in the statements that read.** The first run did not end: SQLite answered "which
  references point at this component" by walking the list of the snapshot, 147,000 rows for every question. The
  statements of `sqlGraph` now fix the order of their tables, and a test reads the query plan of each of them.
- **The page cache.** With the default of SQLite, 2 MiB, the first write took 8.4 to 8.8 seconds in three runs.
  With 64 MiB it took 7.0 to 7.6 seconds in the three runs next to them, about 15 percent less. `openStore` now
  sets 64 MiB for every connection. SQLite takes the memory only as it reads pages. Sizes between the two were
  tried once each, before the review, and 16 MiB did as well as 64 in that one run.
- **The digest** is taken over one text of lines, and not over a list of texts that is written as JSON a second
  time. One run before and one after differed by 0.6 seconds. That is inside the spread of equal runs, so it is
  not shown that this made the write faster. It is kept because it is the simpler text.
- Three things were tried and not kept. Writing eight references with one statement was slower in three runs of
  three (7.7 to 8.3 seconds against 6.9 to 7.4). Without the check of foreign keys one run took 0.7 seconds
  less, which is inside the spread, and the check stays. Not looking for a version of a component whose key is
  new made no difference in two runs.

## Reading, through the interface of the engines

Factor 1 after ten snapshots, on the last snapshot, with the default driver. The first time is that of the first
call in the process, with the file in the cache of the system. A command is one run in a new process, so the
first time is the one a user sees. Nothing was measured with a cold file cache.

| Measurement | First call | Median of the next five |
| --- | --- | --- |
| Find a component by its key | 0.5 ms | 0.06 ms |
| The 21,995 references to the hub field, each with both keys, file, line and column | 179 ms | 166 ms |
| The one reference to an ordinary field | 0.5 ms | 0.2 ms |
| Everything within five steps of an ordinary field (5 components) | 0.6 ms | 0.3 ms |
| Everything within five steps of the hub field (57,934 components), one question per component | 4.2 s | 4.2 s |

The median of the walk from the hub field is that of the next three calls. The same walk took 3.5 seconds in
another run of the same day, with two snapshots. At factor 2 the hub field has 40,003 references, they come back
in 365 milliseconds the first time, and the walk of five steps reaches 115,025 components in 9.9 seconds the
first time and 7.9 seconds after that. With `better-sqlite3` the walk at factor 1 took 1.4 seconds the first
time: reading many rows through the driver port is slower with the default driver, as the note of Phase 0 said
it would be.

The walk asks one question per component and builds an object for every reference it reads. It is the slowest
way to answer an impact question, and it is here to say what that way costs. The target of record
[0037](../../adr/0037-performance-targets.md) is an impact query under 5 seconds for an org of 100,000
components. From the worst field of the org of factor 2 this way does not meet it. Phase 0 measured the same
walk at 3 milliseconds on an index held in memory, after 300 milliseconds to load it, and at 0.8 seconds as one
recursive statement. Which of them the impact engine uses is decided in work package 7, with these numbers. The
interface `SnapshotGraph` is there so that the engine does not have to know.

The statement that reads the references to a component reads them in every version the database holds, and
then keeps those of the snapshot. Its time therefore grows with the number of versions the components that
refer to it have had. With two snapshots and with ten it took the same 165 milliseconds for the hub field. More
snapshots were not measured.

## The impact question

Added on 16 November 2026 with the impact engine (work package 7, decision record
[0044](../../adr/0044-an-impact-answer.md)). The benchmark asks `impactOf`, as the command `orglens impact`
does: the snapshot and its analysis are looked up, the component is found by its key, the references are walked
level by level, and what the answer does not cover is read.

Every case gets a database that was just opened for reading: no statement is prepared and the page cache of
SQLite is empty. The file is in the cache of the system. Starting Node.js, loading the engine and writing the
answer are not in the time. Two snapshots, the last one asked, three runs with the default driver. The ordinary
field is the one in the middle of all fields that something refers to, by how many do: three references point
at it. The hub field has 22,021 direct references at factor 1 and 40,123 at factor 2.

| Question | Factor 1: results | First call | Median of the next three | Factor 2: results | First call | Median of the next three |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary field, five levels | 57 | 8 to 12 ms | 2.3 to 2.7 ms | 76 | 8 to 9 ms | 2.5 to 2.8 ms |
| Ordinary field, no limit | 52,340, up to 19 away | 0.91 to 1.10 s | 0.90 to 1.00 s | 104,760, up to 21 away | 2.16 to 2.34 s | 2.24 to 2.36 s |
| Hub field, five levels | 57,951 | 1.00 to 1.08 s | 0.99 to 1.01 s | 115,708 | 2.37 to 2.54 s | 2.27 to 2.73 s |
| Hub field, no limit | 58,189, up to 7 away | 1.01 to 1.06 s | 1.00 to 1.08 s | 116,100, up to 9 away | 2.29 to 2.76 s | 2.32 to 2.54 s |
| Hub field, confirmed references only | 55,374 | 0.90 to 1.01 s | 0.91 to 0.94 s | 110,038 | 2.24 to 2.40 s | 2.17 to 2.19 s |

With `better-sqlite3`, one run at each size: 0.87 to 1.02 seconds and 2.16 to 2.73 seconds for the four large
answers, and 8 milliseconds for the small one.

The target of record [0037](../../adr/0037-performance-targets.md) is 5 seconds for an org of 100,000
components. Factor 2 is how the plan reads that size, and every case that was measured is under it. The walk
of five steps with one question per component, which the section above measures, took 4.0 to 4.2 seconds at
factor 1 and 7.6 to 10.3 seconds at factor 2 in the same runs.

**Where the time goes.** A large answer costs about 20 microseconds per result. In one run before the last
change below, the time was in three parts of about the same size: reading the two ends of every reference of a
level, reading the components that were found, and reading the rest of the references that are kept. Two
changes were made because of a profile:

- The first version read every reference of a level as a row with twelve columns. Handing out the rows through
  the driver took most of the time: 1.5 to 1.6 seconds for the large answers at factor 1, in one run. A level
  now reads
  five numbers per reference, and the rest only for the references that are kept.
- The statements for many components hand back one JSON text and not one row per component or reference.
  That took the large answers at factor 1 from 1.2 to 1.4 seconds to 1.0 to 1.2, in single runs.

**The size of an answer.** As JSON, a large answer is 28 to 31 MB at factor 1 and 56 to 62 MB at factor 2.
Answering once more and turning the answer into JSON text took 1.0 to 1.2 seconds at factor 1 and 2.5 to 3.0
seconds at factor 2. An earlier version held the whole chain of references in every result. The answer from
the ordinary field at factor 2 then had 1,361,153 references on its chains and was 443 MB of JSON, which took
1.9 seconds to turn into text alone and is close to the longest text Node.js can hold. From the hub field it
was 103 MB. That is why a result holds one reference (record 0044).

These answers are far larger than one a person reads. The generator ties the org together: from an ordinary
field, a third of all components is reached. Whether a real org looks like that is not known.

Not measured: the whole command with the start of Node.js and the printing of the text output, a cold file
cache, more than two snapshots, and factor 10.

## What this does not say

- Nothing was measured on Windows, on macOS or on a real org.
- The org is synthetic. A real org can have many more references per component.
- **Two sources of one project.** A version is shared only when its content and the places of its references
  are the same. An org rewrites almost every file, and the lines and columns of the same formula differ between
  an org and a repository (finding 3 of the Phase 1 plan). So a snapshot of an org and one of the repository of
  the same project will share few versions. The second then costs what a first snapshot costs but for the
  keys and the paths, which are shared: about 70 MB more at factor 1, not 6 MB. That was not measured. It is
  an estimate from the table sizes above.
- How the 100,000 components of the targets are counted is still open with the maintainer. Factor 2 is the
  reading of the plan: components as an org lists them, fields included. If top-level components are meant, the
  size is factor 10, and that run was not made.
- The time an analyser takes is not in these numbers, and neither is the time to read the files of a snapshot.
