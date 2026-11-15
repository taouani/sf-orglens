# 0037. Performance targets, for an org of 100,000 components

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (an answer of the maintainer to the Phase 1 plan)
- Followed by: [0038](0038-a-snapshot-reads-every-type.md), after which a snapshot does not read fewer types. The first of the two things this record names as a help for the first snapshot is gone. The Phase 1 plan, which this record calls not approved, was approved with one change on the same day

## Context

The goal statement asks for "acceptable ingest and query times" on a large org, and the
[overall plan](../plans/re-architecture-plan.md) left "acceptable" open. It proposed numbers for an org of
10,000 components and asked the maintainer to confirm or replace them. The question came back as Q4 of the
[Phase 1 plan](../plans/phase-1.md), because that plan proposes to build the first thing the numbers apply to,
the impact query.

The maintainer replaced the numbers on 15 November 2026.

## Decision

The targets are, for an org of 100,000 components:

| What                   | Target           |
| ---------------------- | ---------------- |
| The first snapshot     | under 60 minutes |
| An impact query        | under 5 seconds  |
| A comparison           | under 10 seconds |
| An incremental refresh | under 5 minutes  |

That is all the maintainer decided.

## How a component is counted is open

The project has counted components in three ways, and the answer does not say which is meant.

| Count                                                                    | The synthetic org of the Phase 0 benchmark | 100,000 components is    |
| ------------------------------------------------------------------------ | ------------------------------------------ | ------------------------ |
| 1. Top-level only: objects, classes, flows and the like, without fields  | about 10,000                               | about ten times that org |
| 2. As the org lists them, the column `LISTED` of `orglens coverage`      | about 50,000                               | about twice that org     |
| 3. Every row: fields, Apex methods and the elements of flows are counted | 147,000                                    | smaller than that org    |

Record [0006](0006-sqlite-single-store.md) counts in the first way: it calls 10,000 components "150,000 or so
rows". So did the question as it was put to the maintainer, which named an org of 10,000 components and measured
on the synthetic org of 147,000 rows. In the second way a field counts, and an Apex method and an element of a
flow do not.

The author of this record first told the maintainer only the second count, and that the target is about twice
the synthetic org. That left out that the question counted in the first way. The maintainer was told so on the
same day and asked which count is meant. **Until the answer is there, the Phase 1 plan works with the second
count, as a reading of the author.**

Which count the "10,000 or more" of the goal statement and of record [0021](0021-correctness-proof.md) means is
not decided either. By the second count, such an org is a fifth of the synthetic org.

## What goes further than the answer of the maintainer

Two more statements are readings of the author. The maintainer was told both on the same day and can strike
either one.

- **The org of the gate.** Level 3 of the proof stays "one real org of 10,000 or more components" (0021). The
  targets do not make the gate wait for an org of 100,000.
- **Which impact query.** The target holds for a query from a field that much of the org refers to, on the
  first query after the command starts, and not only for an ordinary field. To what depth, and whether the time
  is that of the whole command or of the query inside it, is not set.

## Consequences

- **By the second count the impact query is likely within its target, and that is not shown.** At about half
  that size the benchmark of Phase 0 took 0.8 seconds in SQL and 3 milliseconds in memory after 0.3 seconds of
  loading, from a field with many references and to a depth of five levels, in tables of its own
  ([store-benchmark.md](../research/phase-0/store-benchmark.md)). The Phase 1 plan, which is not approved yet,
  proposes to measure it through the store of the engine at the target size.
- **By the first count nothing that was measured supports any of the four targets.** The target is then ten
  times the synthetic org, about 1.5 million rows. Scaled straight, the impact query takes about 8 seconds in
  SQL, or about 3 seconds with the references loaded into memory first.
- **Nothing that was measured supports 60 minutes for a first snapshot, by either count.** The one real org
  gave 1,668 listed components in two to three minutes, nearly all of it the time Salesforce takes to build a
  zip file. Scaled straight that is two to three hours by the second count and ten hours or more by the first.
  One small org is a weak base for scaling: its two chunks took very different times for their size. Two things
  can help. A snapshot reads fewer types by default ([0036](0036-what-a-snapshot-of-an-org-reads.md)). Chunks
  could be retrieved side by side, which is not built and not measured, and how many retrieves Salesforce runs
  at once for one org was not looked up.
- The first snapshot can be measured only on a large real org. None is named (open question of the overall
  plan). Until one is, this target is a number without a measurement.
- A comparison and an incremental refresh are planned for Phase 4. The benchmark of Phase 0 took 0.14 seconds
  for the difference of two snapshots of the synthetic org, in tables of its own. Nothing else is known.
- On which machine the targets hold is not set. The numbers of the benchmark are from one Linux virtual machine
  with four cores. The times of the real org are from runners of GitHub Actions.
- The targets are measured at the gate and the benchmark is published (0021). On a synthetic org that is
  possible at any size. On a real org it is possible only up to the size of the org that is found.
