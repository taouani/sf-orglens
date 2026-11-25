# impact-times

Numbers from `pnpm run bench:store` ([`bench/store.mjs`](../../../bench/README.md)), recorded on 25 November 2026
for work package 6 of the [Phase 2 plan](../../plans/phase-2.md), which asks for the impact times of the synthetic
org to be measured again with the tables as they then are. Phase 1 measured them on 16 November 2026, in the
section "The impact question" of [its note](../phase-1/store-benchmark.md).

## Conditions

- One machine: Linux x64, a 4-core virtual machine, warm file cache. Node.js v24.22.3, SQLite 3.54.1 with the
  default driver, and `better-sqlite3` once at each size. Windows and macOS were not measured.
- Two versions of the engine, on the same machine on the same day: `main` at `231fcc6`, after pull request 83,
  and the close of Phase 1 at `e86de72`. `bench/store.mjs` is the same file in both, so only the engine differs.
- The synthetic org of Phase 0, from the same seed, at factor 1 (147,323 components, 602,458 references) and
  factor 2 (295,286 components, 1,206,592 references). Two snapshots, the last one asked, as in Phase 1.
- Each case gets a database that was just opened for reading. The time of the first call and the median of the
  next three are given. Starting Node.js, loading the engine and writing the answer are not in the time.
- Six runs of each version at factor 1 and three at factor 2 with the default driver. The first three runs at
  factor 1 ran one version after the other, three runs each. The second three alternated between the versions.
- The benchmark writes no coverage and no inventory. So the list of types an answer does not cover is empty, and
  the narrowing of record [0073](../../adr/0073-an-answer-leaves-out-a-type-that-can-name-nothing-of-it.md) has
  nothing to narrow. What it costs is not in these times.
- The outputs of the runs are not in the repository.

## The impact question

Factor 1, six runs of each version:

| Question | Results | Results at the close of Phase 1 | First call | First call, Phase 1 | Median of the next three | Median, Phase 1 |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary field, five levels | 57 | 57 | 8.2 to 11.7 ms | 8.0 to 9.6 ms | 2.3 to 4.2 ms | 2.3 to 2.7 ms |
| Ordinary field, no limit | 52,340, up to 19 away | 52,340 | 0.82 to 1.00 s | 0.76 to 1.03 s | 0.91 to 0.99 s | 0.78 to 0.99 s |
| Hub field, five levels | 58,893 | 57,951 | 0.96 to 1.18 s | 0.79 to 1.11 s | 0.92 to 1.00 s | 0.89 to 1.03 s |
| Hub field, no limit | 59,131, up to 7 away | 58,189 | 0.91 to 1.38 s | 0.89 to 1.04 s | 0.94 to 1.15 s | 0.90 to 1.04 s |
| Hub field, confirmed references only | 56,316 | 55,374 | 0.86 to 1.05 s | 0.77 to 1.03 s | 0.85 to 0.94 s | 0.83 to 0.98 s |

Factor 2, three runs of each version:

| Question | Results | Results at the close of Phase 1 | First call | First call, Phase 1 | Median of the next three | Median, Phase 1 |
| --- | --- | --- | --- | --- | --- | --- |
| Ordinary field, five levels | 76 | 76 | 9.6 to 11.1 ms | 8.1 to 12.4 ms | 2.7 to 3.2 ms | 2.3 to 3.2 ms |
| Ordinary field, no limit | 104,760, up to 21 away | 104,760 | 2.28 to 2.39 s | 2.20 to 2.46 s | 2.13 to 2.43 s | 2.27 to 2.44 s |
| Hub field, five levels | 117,548 | 115,708 | 2.35 to 2.42 s | 2.17 to 2.56 s | 2.36 to 2.57 s | 2.36 to 2.50 s |
| Hub field, no limit | 117,940, up to 9 away | 116,100 | 2.40 to 2.52 s | 2.42 to 2.61 s | 2.35 to 2.50 s | 2.35 to 2.52 s |
| Hub field, confirmed references only | 111,878 | 110,038 | 2.07 to 2.23 s | 2.13 to 2.29 s | 2.18 to 2.28 s | 2.17 to 2.28 s |

With `better-sqlite3`, one run of `main` at each size: 0.80 to 1.08 seconds at factor 1 and 2.29 to 2.69 seconds
at factor 2 for the first call and the median of the four large answers, and 9.7 and 2.9 milliseconds at factor 1
and 14.5 and 4.5 milliseconds at factor 2 for the small one.

## What the numbers say

- **The times have not changed beyond the spread of the runs.** In every case the range of `main` overlaps the
  range of the close of Phase 1. In the first three runs at factor 1, which did not alternate, the median of the
  ordinary field without a limit was 0.91 to 0.93 seconds on `main` and 0.78 to 0.85 seconds at the close of
  Phase 1. In the three runs that alternated it was 0.91 to 0.99 and 0.94 to 0.99 seconds. So the machine changed
  more between the two series than the engine between the two versions. One median of the small answer on
  `main` was 4.2 milliseconds, in the last run. The other five were 2.3 to 2.7.
- **The answers from the hub field hold more results:** 942 more at factor 1 and 1,840 more at factor 2. At factor
  1, one more run of each version counted the results by type: the 942 are flows, all at depth 1. An element of a
  flow that refers to the hub brings its flow, as a result of the same depth (record
  [0066](../../adr/0066-an-answer-takes-a-flow-with-its-elements.md)): 3,784 flows are results on `main` and 2,842
  were at the close of Phase 1. At factor 2 the results were not counted by type. The answers from the ordinary
  field hold no flow, and are the same in both versions. As JSON, an answer from the hub field is 31.0 to 31.1 MB
  at factor 1, 0.4 to 0.5 MB more than at the close of Phase 1, and 62.3 to 62.5 MB at factor 2, 1.0 MB more.
- **The target of record [0037](../../adr/0037-performance-targets.md)** is an impact query under 5 seconds for
  an org of 100,000 components. Factor 2 is how the Phase 1 plan reads that size, and every case is under 2.7
  seconds. How the 100,000 components are counted is still open with the maintainer.
- The numbers of 16 November 2026 in the note of Phase 1 lie in the same ranges: 0.90 to 1.10 seconds at factor 1
  and 2.16 to 2.76 seconds at factor 2 for the large answers.

## What this does not say

- The org is synthetic, and it has no coverage: the part of an answer that names what it does not cover was not
  timed with anything in it.
- Nothing was measured on Windows, on macOS or on a real org, with a cold file cache, with more than two snapshots,
  or at factor 10.
- The whole command, with the start of Node.js and the printing of the answer, is not in these times. Work package
  9 times the commands on the public codebases.
