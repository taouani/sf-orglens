# 0082. What Phase 2 left open about flows is done first in Phase 3

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (an answer of the maintainer to the Phase 3 plan)

## Context

Phase 2 closed with five things open that touch the reader of flows and the name of a flow
([Phase 2 report](../reports/phase-2.md)):

- The check by hand of the public codebases found seven names that the reader of flows misses, and no warning names
  them ([note](../research/phase-2/public-codebases.md)). One is the flow of a package that a flow of Coral Cloud
  overrides (`overriddenFlow`). Six are the objects that flows of Nebula Logger hand to a generic Apex action
  (`dataTypeMappings`). Record [0061](0061-the-elements-of-a-flow.md) does not name either among what is not read.
- The warning for `Id` at the end of a path says that a path was not followed where nothing stands behind it to
  miss. 10 of the 24 paths that are not followed in PMM end at `Id`.
- The flows of PMM write the token of its build tool (`%%%NAMESPACE%%%`) before names, and no name behind it is
  read. The token stands only in the source of PMM before its build, and no org holds it.
- In a snapshot of an org, the name alone of a flow fits the flow and its definition (`FlowDefinition`), which the
  org lists under the same name. `orglens impact Invoice_After_Save` ends with `COMPONENT_AMBIGUOUS`. Record
  [0064](0064-a-name-alone-that-fits-an-object-means-the-object.md) takes the object for a name that fits an
  object and more, and says nothing of a flow. The release notes of `0.1.0-next.2` say how to name a flow until
  then.

The question was put to the maintainer as Q6 of the [Phase 3 plan](../plans/phase-3.md), with three options: (a) as
the report recommends, in the first pull request of the phase, (b) only the two kinds of missed names, (c) none of
them in this phase. The maintainer chose (a) on 26 November 2026, with the recommended answers to the other five
questions of the plan.

## Decision

In the first pull request of Phase 3:

1. **The reader of flows reads `overriddenFlow`**: a flow refers to the flow it overrides.
2. **The reader of flows reads `dataTypeMappings`**: an action of a generic Apex class refers to the object it is
   given records of.
3. **The warning for `Id` at the end of a path goes.**
4. **A name alone that fits a flow and its definition means the flow**, and the answer names the definition beside it
   (`sameName`), as for an object since record 0064.
5. **The token of PMM stays unread**, with its warnings.

That is all the maintainer decided. Points 1 and 2 change record 0061, and point 4 changes record 0064.

## What goes further than the answer of the maintainer

Five statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **The kinds and tiers of the two new references are set in the pull request that builds them**, with a line in
  record 0061 for each. A value of `dataTypeMappings` names its object outright, so the author expects `confirmed`.
  The flow that `overriddenFlow` names is of a package in the one case found, which the codebase does not hold, so
  that reference is `external` there.
- **Only `Id` loses its warning.** A path that is not followed for any other reason keeps it.
- **A name that fits a flow, its definition and something else stays as it is.** If one of the others is an object,
  record 0064 takes the object. If none is, the name is still `COMPONENT_AMBIGUOUS`.
- **The proof of points 1 and 2 is the public codebases**: the seven names are found there, and the listing of Phase 2
  changes only there. The key of the fixture gets entries for them in work package 1 where the test org can hold
  them. A flow that overrides another needs a flow of a package, which the test org does not have. So the key is not
  written before this reader, as records [0021](0021-correctness-proof.md) and
  [0029](0029-fixture-and-answer-key.md) ask for an analyser. For two small additions to a reader that has its
  key, the author takes that.
- **The test plan of Phase 2 is not run yet.** These changes to the reader of flows do not wait for it. A defect it
  shows is corrected before the next package that builds on the reader.

## Consequences

- `orglens impact Invoice_After_Save` answers about the flow in a snapshot of an org, where it was an error with the
  exit code `2`. That changes what a command answers for a name, which `docs/cli.md` and a changeset say in the pull
  request that builds it.
- The seven missed names of Phase 2 are found, and an answer about `Account`, `User` or `Organization` holds the
  actions of Nebula Logger that are given their records.
- PMM still gives its warnings for the token. They name where it stands, and nothing of an org is affected.
- The two open questions of the overall plan that came at the close of Phase 2 are answered.
