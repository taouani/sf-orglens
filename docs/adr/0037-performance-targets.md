# 0037. Performance targets, for an org of 100,000 components

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (made during the build)

## Context

The goal statement asks for "acceptable ingest and query times" on a large org, and the
[overall plan](../plans/re-architecture-plan.md) left "acceptable" open. It proposed numbers for an org of
10,000 components and asked the maintainer to confirm or replace them. The question came back as Q4 of the
[Phase 1 plan](../plans/phase-1.md), because Phase 1 builds the first thing the numbers apply to, the impact
query.

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

## What goes further than the answer of the maintainer

Three statements are readings of the author of this record. The maintainer was told the first two on the same
day and can strike any of them.

- **What counts as a component.** A component is counted as the org lists it, which is the column `LISTED` of
  `orglens coverage`. A field counts. An Apex method and an element of a flow do not, although the store holds a
  row for each. By that count the synthetic org of the Phase 0 benchmark, with 147,000 rows, has about 50,000
  components, so the target size is about twice that org.
- **The org of the gate.** Level 3 of the proof stays "one real org of 10,000 or more components"
  ([0021](0021-correctness-proof.md)). The targets do not make the gate wait for an org of 100,000.
- **Which impact query.** The target holds for a query from a field that much of the org refers to, on the
  first query after the command starts, and not only for an ordinary field.

## Consequences

- **The impact query is likely within its target, and that is not shown yet.** At about half the target size
  the benchmark of Phase 0 took 0.8 seconds in SQL and 3 milliseconds in memory after 0.3 seconds of loading,
  in tables of its own ([store-benchmark.md](../research/phase-0/store-benchmark.md)). Phase 1 measures it
  through the store of the engine at the target size. The generator of the benchmark gets a setting for the
  size.
- **Nothing that was measured supports 60 minutes for a first snapshot.** The one real org gave 1,668 listed
  components in two to three minutes, nearly all of it the time Salesforce takes to build a zip file. Scaled
  straight that is two to three hours, and one small org is a weak base for scaling: its two chunks took very
  different times for their size. Two things can help. A snapshot reads fewer types by default
  ([0036](0036-what-a-snapshot-of-an-org-reads.md)). Chunks could be retrieved side by side, which is not built
  and not measured, and how many retrieves Salesforce runs at once for one org was not looked up.
- The first snapshot can be measured only on a large real org. None is named (open question of the overall
  plan). Until one is, this target is a number without a measurement.
- A comparison and an incremental refresh are built in Phase 4. The benchmark of Phase 0 took 0.14 seconds for
  the difference of two snapshots at about half the target size, in tables of its own. Nothing else is known.
- On which machine the targets hold is not set. Every number so far is from one Linux virtual machine with four
  cores.
- The targets are measured at the gate and the benchmark is published (0021). On a synthetic org that is
  possible at any size. On a real org it is possible only up to the size of the org that is found.
