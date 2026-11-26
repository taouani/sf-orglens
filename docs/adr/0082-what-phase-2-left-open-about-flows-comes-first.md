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

That is all the maintainer decided. Points 1 to 3 change record 0061, point 3 also changes records 0041 and 0074,
and point 4 changes record 0064.

## What goes further than the answer of the maintainer

Six statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **The two new references have the kind `references` and the tier `confirmed`**, since each value names its
  component outright. A flow refers to the flow it overrides, with a way of its own (`override`). The flow is of a
  package in the one case found, which the codebase does not hold, so that reference is `external` there. An action
  refers to the object of a value of `dataTypeMappings` with the way `object`, as a record element does. The details
  stay in this record, and record 0061 gets a line that points here, as record
  [0074](0074-a-warning-counts-where-it-can-bear-on-the-answer.md) did.
- **The warning goes only where `Id` is the only name that was not followed** (`details.notFollowed` is `["Id"]`),
  whether a path stopped before it or the field stands where no object is named. That covers the 10 cases of PMM:
  5 of each. `Id` gives no reference where its object is known, so nothing is missed where it is not. A path that
  ends at another name, or holds more names than `Id`, keeps its warning: in `Var.Account__r.Id` the relationship
  before `Id` is a read that was missed.
- **The rule is in the code that resolves the names of every reader**, the only code that gives the warning
  (`extraction/raw-references.ts`). So it holds for formulas, workflow rules, records of custom metadata types,
  email templates, report types and quick actions as for flows. The reason holds for each because `Id` gives no
  reference in any of them: a path skipped it already, and the value `Id` of a record of a custom metadata type in a
  relationship to the definition of a field, which referred to the field `Id` where the record named its object, no
  longer does. The tests hold the rule for flows and for such records.
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
- The 10 warnings of PMM about `Id` go, and its other 14 paths that are not followed keep theirs. An answer that
  counted only such warnings can become complete.
- PMM still gives its warnings for the token. They name where it stands, and nothing of an org is affected.
- The two open questions of the overall plan that came at the close of Phase 2 are answered.
