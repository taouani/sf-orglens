# Benchmark of the workspace database

This folder holds the benchmark that the storage decisions rest on
([0006](../docs/adr/0006-sqlite-single-store.md), [0007](../docs/adr/0007-immutable-snapshots.md),
[0026](../docs/adr/0026-workspace-database.md)). It is kept so that the numbers can be measured again whenever the
schema changes, and on other machines.

```sh
pnpm run bench                      # default driver, shared-version layout, 2 snapshots
pnpm run bench node cas 10          # 10 snapshots
pnpm run bench node int 10          # the same data as full copies per snapshot
pnpm run bench bs3 cas 2            # with the fallback driver
pnpm run bench node cas 2 --out result.json
```

It needs no org and no network. It builds its database in a temporary folder, prints its measurements as JSON and
removes the folder, also when it fails. An interrupted run leaves its folder, and the next run removes such
folders once they are an hour old. A run with 2 snapshots takes about 15 seconds. With 10
snapshots the shared-version layout takes about 20 seconds and the full-copy layout about a minute and a half.

## What it measures

`generate.mjs` builds a synthetic org from a fixed seed: about 10,000 top-level components (objects, classes,
triggers, flows, layouts and others), about 147,000 components once fields, methods and flow elements are counted,
and about 600,000 references. Popular fields and methods get many more references than others, as in a real org.
Between snapshots, 2 percent of the top-level components change, 0.3 percent are removed and 0.3 percent are added.

`bench.mjs` loads the snapshots in one of three layouts and measures:

- load time and database size per snapshot, and the size of each table;
- impact queries in SQL (a recursive query, five levels deep and unbounded) from a hub field and from an ordinary
  field;
- the same traversals on an adjacency list held in memory, with the time to load it;
- lookup by name with full-text search, compared with `LIKE`;
- the diff of two snapshots, and the time to delete the oldest snapshot.

The layouts are `cas` (an identity row per component, a version row per distinct content, a membership row per
snapshot), `int` (a full copy of every row per snapshot, with integer ids) and `text` (a full copy with text keys).

## Limits

The org is synthetic. A real org can have many more references, above all if permission grants are stored as
references. The benchmark uses its own tables, not the schema of the engine, because the tables for components and
references do not exist yet. It also uses the two SQLite bindings directly and not the store of the engine: it
reads rows as arrays and keeps its statements prepared. The store prepares a statement once and keeps it, but it
returns rows as objects and checks every value, so reading many rows through it is slower than the figures here.
What the engine itself reaches is measured when the first command writes and reads components. Numbers from one machine say little about another: the recorded ones are from Linux.
The current numbers are in
[docs/research/phase-0/store-benchmark.md](../docs/research/phase-0/store-benchmark.md).
