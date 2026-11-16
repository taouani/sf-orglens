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

`pnpm run bench:store` is the second benchmark. It writes the same org through the store of the engine and reads
it through the interface of the engines (decision record
[0040](../docs/adr/0040-components-and-references-in-the-database.md)):

```sh
pnpm run bench:store                # default driver, the org of Phase 0, 2 snapshots
pnpm run bench:store node 1 10      # 10 snapshots
pnpm run bench:store node 2 10      # an org of twice the size
pnpm run bench:store bs3 1 2        # with the fallback driver
pnpm run bench:store node 1 2 --out result.json
```

A run with 2 snapshots takes about 20 seconds, and one with 10 snapshots of the org of twice the size about two
minutes.

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

`store.mjs` writes every snapshot with `writeAnalysis` and measures:

- the time to write a snapshot and the size of the database after each, the size of each table, and the time to
  write the analysis of the last snapshot again;
- the time to find a component, to read the references to a hub field and to an ordinary field, and to walk five
  steps from each, one question at a time through `sqlGraph`.

The time to make the components in memory is given apart, because an analyser makes them and not the store.

## Limits

The org is synthetic. A real org can have many more references, above all if permission grants are stored as
references. `bench.mjs` uses its own tables, not the schema of the engine, because the tables for components and
references did not exist when it was written. It also uses the two SQLite bindings directly and not the store of the engine: it
reads rows as arrays and keeps its statements prepared. The store prepares a statement once and keeps it, but it
returns rows as objects and checks every value, so reading many rows through it is slower than the figures here.
`store.mjs` measures that. Numbers from one machine say little about another: the recorded ones are from Linux.
The numbers of `bench.mjs` are in
[docs/research/phase-0/store-benchmark.md](../docs/research/phase-0/store-benchmark.md), and those of `store.mjs` in
[docs/research/phase-1/store-benchmark.md](../docs/research/phase-1/store-benchmark.md).
