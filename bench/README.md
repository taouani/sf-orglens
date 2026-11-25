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

A run with 2 snapshots takes about 35 seconds, and one with 10 snapshots of the org of twice the size about two
and a half minutes.

`pnpm run bench:corpora` is the third. It times the commands of OrgLens on the public codebases of
`fixtures/corpora.toml`, as a person runs them: the built command line, a new process for every command.

```sh
pnpm run build && pnpm run corpora:fetch       # it needs both
pnpm run bench:corpora                         # every codebase that was downloaded, 5 runs each
pnpm run bench:corpora pmm --runs 3            # the named ones
pnpm run bench:corpora npsp --copies 98        # also a made-up source: NPSP with every object copied 98 times
pnpm run bench:corpora coral-cloud --copies 580 # Coral Cloud with every object and every flow copied 580 times
pnpm run bench:corpora npsp --copies 98 --out result.json
```

Without `--copies` it takes a few minutes, most of them to find the field of NPSP that most components refer
to. With `--copies 98` it takes a few minutes more, and half a gigabyte in the temporary folder while it runs.

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
  steps from each, one question at a time through `sqlGraph`;
- the impact question as a command asks it, with `impactOf` on a database that was just opened: from an
  ordinary field and from the hub field, to a depth of five and without a limit, and from the hub field over
  confirmed references only. For each case it gives the time of the first call, the median of the next three,
  the number of results, the size of the answer as JSON, and the time to answer once more and turn the answer
  into text. The ordinary field is the one in the middle of all fields that something refers to, by how many
  do.

The time to make the components in memory is given apart, because an analyser makes them and not the store.

`corpora.mjs` gives every run of a codebase a new workspace with one source, the package folders of the
codebase read from the disk, and measures the whole time of each command, with the start of Node.js and the
printing:

- `snapshot`, which reads the files, stores them and analyses them, and `analyse`, which analyses them again;
- `coverage`;
- `impact` from the field most components refer to, as text and as JSON, and from the first field that exactly
  one component refers to. It finds the two by asking `impact` for every field, up to 1,000.

It prints the least and the most of the runs, the count of files, components and references, and the size of
the database. With `--copies n` it also builds a source that is not real: the first named codebase, or the
first of the manifest when none is named, with every folder of an object and every flow copied `n` times under
another name. A copy of a flow names the copies of the objects of the codebase where it names them as its
objects (`object`, `objectType`), so that its records are those of the copy, and keeps every other name. The
copy is a Git repository with one commit, with the project file and the `.forceignore` of the codebase, so that
it is read the way the codebase is. It stands for a repository with very many objects, fields and flows, and it
is asked the same two questions as the codebase it is made of. It is no org: its files are small, most of its
components are of the few types the analysis reads, and the copy of a standard object keeps formulas and flows
that name fields the copy cannot have. Only fields in files of their own are asked about, so a codebase in the
metadata format, such as V4S, gets no impact question.

## Limits

The org is synthetic. A real org can have many more references, above all if permission grants are stored as
references. `bench.mjs` uses its own tables, not the schema of the engine, because the tables for components and
references did not exist when it was written. It also uses the two SQLite bindings directly and not the store of the engine: it
reads rows as arrays and keeps its statements prepared. The store prepares a statement once and keeps it, but it
returns rows as objects and checks every value, so reading many rows through it is slower than the figures here.
`store.mjs` measures that. Numbers from one machine say little about another: the recorded ones are from Linux.
`corpora.mjs` measures folders on a disk and no org, and it does not measure memory.
The numbers of `bench.mjs` are in
[docs/research/phase-0/store-benchmark.md](../docs/research/phase-0/store-benchmark.md), those of `store.mjs` in
[docs/research/phase-1/store-benchmark.md](../docs/research/phase-1/store-benchmark.md), and those of
`corpora.mjs` in [docs/research/phase-1/public-codebases.md](../docs/research/phase-1/public-codebases.md) and
[docs/research/phase-2/public-codebases.md](../docs/research/phase-2/public-codebases.md).
