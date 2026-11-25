# impact-times

Numbers from `pnpm run bench:store` ([`bench/store.mjs`](../../../bench/README.md)), recorded on 24 and 25 November
2026 (UTC) for work package 6 of the [Phase 2 plan](../../plans/phase-2.md), which asks for the impact times of the
synthetic org to be measured again with the tables as they then are. Phase 1 measured them on 16 November 2026, in
the section "The impact question" of [its note](../phase-1/store-benchmark.md).

## Conditions

- One machine: Linux x64, a 4-core virtual machine, warm file cache. Node.js v24.22.3, SQLite 3.54.1 with the
  default driver, and `better-sqlite3` 13.2.0, with SQLite 3.54.1, once at each size. The note of Phase 1 had
  SQLite 3.53.4 with `better-sqlite3`. Windows and macOS were not measured.
- Two versions of the engine, on the same machine in one session: `main` at `231fcc6`, after pull request 83, and
  the close of Phase 1 at `e86de72`. `bench/store.mjs` is the same file in both, so only the engine differs in the
  timed runs.
- The synthetic org of Phase 0, from the same seed, at factor 1 (147,323 components and 602,458 references in the
  first snapshot, 147,447 and 602,870 in the last) and factor 2 (295,286 and 1,206,592 in the first, 295,451 and
  1,206,498 in the last). Two snapshots, the last one asked, as in Phase 1. The hub field, with 22,021 direct
  references at factor 1 and 40,123 at factor 2, and the ordinary field, with 3, are the same fields in every run
  of both versions.
- Each case gets a database that was just opened for reading. The time of the first call and the median of the
  next three are given. Starting Node.js, loading the engine and writing the answer are not in the time.
- Six runs of each version at factor 1 and three at factor 2 with the default driver. The first three runs at
  factor 1 ran one version after the other, three runs each. The second three alternated between the versions. At
  factor 2 the three runs of `main` ran before the three of the close of Phase 1.
- The benchmark writes no coverage and no inventory. So the list of types an answer does not cover is empty, and
  the narrowing of record [0073](../../adr/0073-an-answer-leaves-out-a-type-that-can-name-nothing-of-it.md) has
  nothing to narrow. What it costs is not in these times.
- The outputs of the runs are not in the repository.

## The impact question

Factor 1, six runs of each version:

| Question | Results | Results at `e86de72` | First call | First call at `e86de72` | Median of the next three | Median at `e86de72` |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary field, five levels | 57 | 57 | 8.2 to 11.7 ms | 8.0 to 9.6 ms | 2.3 to 4.2 ms | 2.3 to 2.7 ms |
| Ordinary field, no limit | 52,340, up to 19 away | 52,340 | 0.82 to 1.00 s | 0.76 to 1.03 s | 0.91 to 0.99 s | 0.78 to 0.99 s |
| Hub field, five levels | 58,893 | 57,951 | 0.96 to 1.18 s | 0.79 to 1.11 s | 0.92 to 1.00 s | 0.89 to 1.03 s |
| Hub field, no limit | 59,131, up to 7 away | 58,189 | 0.91 to 1.38 s | 0.89 to 1.04 s | 0.94 to 1.15 s | 0.90 to 1.04 s |
| Hub field, confirmed references only | 56,316 | 55,374 | 0.86 to 1.05 s | 0.77 to 1.03 s | 0.85 to 0.94 s | 0.83 to 0.98 s |

Factor 2, three runs of each version:

| Question | Results | Results at `e86de72` | First call | First call at `e86de72` | Median of the next three | Median at `e86de72` |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary field, five levels | 76 | 76 | 9.6 to 11.1 ms | 8.1 to 12.4 ms | 2.7 to 3.2 ms | 2.3 to 3.2 ms |
| Ordinary field, no limit | 104,760, up to 21 away | 104,760 | 2.28 to 2.39 s | 2.20 to 2.46 s | 2.13 to 2.43 s | 2.27 to 2.44 s |
| Hub field, five levels | 117,548 | 115,708 | 2.35 to 2.42 s | 2.17 to 2.56 s | 2.36 to 2.57 s | 2.36 to 2.50 s |
| Hub field, no limit | 117,940, up to 9 away | 116,100 | 2.40 to 2.52 s | 2.42 to 2.61 s | 2.35 to 2.50 s | 2.35 to 2.52 s |
| Hub field, confirmed references only | 111,878 | 110,038 | 2.07 to 2.23 s | 2.13 to 2.29 s | 2.18 to 2.28 s | 2.17 to 2.28 s |

With `better-sqlite3`, one run of `main` at each size: 0.80 to 1.08 seconds at factor 1 and 2.29 to 2.69 seconds
at factor 2 for the first call and the median of the four large answers, and 9.7 and 2.9 milliseconds at factor 1
and 14.5 and 4.5 milliseconds at factor 2 for the small one.

To answer once more and turn the answer into JSON took 0.87 to 1.24 seconds on `main` and 0.83 to 1.19 seconds at
`e86de72` at factor 1, and 2.44 to 2.83 and 2.32 to 2.94 seconds at factor 2, for the four large answers.

## What the numbers say

- **The times have not changed beyond the spread of the runs.** In every case the range of `main` overlaps the
  range of the close of Phase 1. In the first three runs at factor 1, which did not alternate, the median of the
  ordinary field without a limit was 0.91 to 0.93 seconds on `main` and 0.78 to 0.85 seconds at the close of
  Phase 1. In the three runs that alternated it was 0.91 to 0.99 and 0.94 to 0.99 seconds. That answer holds no
  flow, so record [0066](../../adr/0066-an-answer-takes-a-flow-with-its-elements.md) cannot change it. So a
  difference of 0.1 seconds between the versions can come from the order of the runs alone, and the runs cannot
  show a change smaller than about that. In the cases record 0066 does change, the differences of the means go
  both ways and lie within the spread. At about 20 microseconds a result (note of Phase 1), the 942 more results
  at factor 1 would cost about 20 milliseconds.
- **The sixth run of `main` at factor 1 was the slowest.** It has the largest value of `main` in every case and in
  both measures, among them the first call of 1.38 seconds for the hub field without a limit and the median of
  4.2 milliseconds for the small answer, where the other five medians were 2.3 to 2.7. Without that run the
  ranges of the two versions still overlap in every case.
- **The answers from the hub field hold more results:** 942 more at factor 1 and 1,840 more at factor 2, at the
  same depths. An element of a flow that refers to the hub brings its flow, as a result of the same depth (record
  0066). One more run of each version at factor 1, with a copy of `bench/store.mjs` changed to count the results
  by the type of their key, showed it: on `main`, 3,784 results have a key of the type `Flow`, which are the
  2,842 elements that refer to the hub, results at the close of Phase 1 as well, and the 942 flows they belong
  to. Every other type has the same count in both versions. The change to the copy is not in the repository. At
  factor 2 the results were not counted by type. By the generator of the synthetic org, 5,434 elements of 1,840
  flows refer to the hub there. The answers from the ordinary field hold no flow, and hold the same number of
  results, to the same depth, in both versions. As JSON, an answer from the hub field is 29.7 to 31.1 MB at
  factor 1, 0.4 to 0.5 MB more than at the close of Phase 1, and 59.4 to 62.5 MB at factor 2, 1.0 MB more.
- **The target of record [0037](../../adr/0037-performance-targets.md)** is an impact query under 5 seconds for
  an org of 100,000 components. Factor 2 is how the Phase 1 plan reads that size, and every case is under 2.7
  seconds. How the 100,000 components are counted is still open with the maintainer.
- The numbers of 16 November 2026 in the note of Phase 1 overlap these: 0.90 to 1.10 seconds at factor 1 and 2.16
  to 2.76 seconds at factor 2 for the large answers, against 0.76 to 1.38 and 2.07 to 2.61 seconds here.

## What this does not say

- The org is synthetic, and it has no coverage: the part of an answer that names what it does not cover was not
  timed with anything in it.
- The synthetic org does not use what Phase 2 added to an answer. Nothing in it refers to a flow, so the walk
  that goes on from a flow that was found never finds anything. The benchmark writes no issue and no note, so the
  warnings an answer counts and the flows with a newer version are read from empty tables. What refers to a
  component was timed, and what a component refers to (`--outgoing`) was not. The narrowing of the warnings an
  answer counts, which is what is left of work package 6, was not built yet, and it would have nothing to narrow
  here. The made-up source with flows of work package 9 is where the first of these can be timed.
- Nothing was measured on Windows, on macOS or on a real org, with a cold file cache, with more than two snapshots,
  or at factor 10.
- The whole command, with the start of Node.js and the printing of the answer, is not in these times. Work package
  9 times the commands on the public codebases.
