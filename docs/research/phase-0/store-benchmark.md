# store-benchmark

Numbers from the benchmark in [`bench/`](../../../bench/README.md), recorded on 12 November 2026 when the store was
built. They repeat the measurements of [sqlite-store.md](sqlite-store.md) with the code that is now in the
repository, and they agree with it.

## Conditions

- One machine: Linux x64, a 4-core virtual machine, warm file cache. Node.js v24.22.3, SQLite 3.54.1 with
  the default driver, SQLite 3.53.4 with `better-sqlite3` 13.0.3. Windows and macOS were not measured.
- A synthetic org from a fixed seed: 147,323 components (about 10,000 of them top-level) and
  602,458 references in the first snapshot. Between snapshots 2 percent of the top-level
  components change, 0.3 percent are removed and 0.3 percent are added.
- The benchmark uses its own tables. The engine has no tables for components and references yet.
- Times are the median of five runs unless stated otherwise. Each command was run once, so the figures are
  indications, not statistics.

## Ten snapshots: shared versions against full copies

`pnpm run bench -- node cas 10` and `pnpm run bench -- node int 10`.

| Measurement | Shared versions (`cas`) | Full copy per snapshot (`int`) |
| --- | --- | --- |
| Database size after 10 snapshots | 159 MB | 1102.9 MB |
| Database size after the first snapshot | 105.8 MB | 107.2 MB |
| Load time, first snapshot | 4.0 s | 5.4 s |
| Load time, later snapshots (average) | 0.37 s | 6.55 s |
| Impact from a hub field, 5 levels, recursive SQL | 779.13 ms | 479.53 ms |
| Impact from an ordinary field, 5 levels, recursive SQL | 0.19 ms | 0.04 ms |
| Direct references to the hub field, with file and line | 43.04 ms | 63.07 ms |
| Load the adjacency list of one snapshot into memory | 297 ms | 212 ms |
| Impact from the hub field, 5 levels, in memory | 2.72 ms | 3.34 ms |
| Lookup by name, trigram search, first 50 hits | 2.03 ms | 6.27 ms |
| Lookup by name with `LIKE` | 19.92 ms | 75.36 ms |
| Diff of the last two snapshots | 136.73 ms | 320.31 ms |
| Delete the oldest snapshot | 0.32 s | 5.05 s |

The hub field has 21,995 direct references and reaches 57,934 components within five levels.
The ordinary field has one direct reference.

## The two drivers

`pnpm run bench -- node cas 2` and `pnpm run bench -- bs3 cas 2`.

| Measurement | `node:sqlite` | `better-sqlite3` |
| --- | --- | --- |
| SQLite version | 3.54.1 | 3.53.4 |
| Database size after 2 snapshots | 111.5 MB | 107.2 MB |
| Load time, first snapshot | 3.7 s | 4.4 s |
| Impact from a hub field, 5 levels, recursive SQL | 714.13 ms | 818.19 ms |
| Impact from the hub field, 5 levels, in memory | 3.13 ms | 2.73 ms |
| Diff of two snapshots | 124.28 ms | 131.72 ms |

The two drivers carry different SQLite versions here, which is the likely reason the file sizes differ by a few
megabytes. The research note compared them on the same SQLite version and found identical sizes.

## What the numbers say

- Sharing unchanged versions between snapshots makes ten snapshots about 7 times smaller than full copies, and
  later snapshots load in a fraction of the time of the first.
- An impact query from an ordinary field is far below a millisecond either way. From a hub field the recursive query
  takes most of a second, and the same traversal in memory takes a few milliseconds once the adjacency list is loaded.
  Which of the two a command uses is decided with the impact engine.
- The driver makes little difference.
- None of this has been measured on Windows, on macOS or on a real org.
