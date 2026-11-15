# 0035. The correctness gate has a second half for what Salesforce cannot confirm

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (an answer of the maintainer to the Phase 1 plan)

## Context

The gate of [0021](0021-correctness-proof.md) says that no dependency Salesforce confirms may be missing from
OrgLens. Record 0021 also says that the gate is looked at again after the measurements of Phase 0, and that a
change to it is a new record.

Phase 0 measured what Salesforce confirms ([real-org.md](../research/phase-0/real-org.md), record
[0034](0034-dependency-api-is-the-cross-check.md)). The Dependency API reports references to custom fields and
custom objects. It has no row for a standard field, for a name in text, or for the target of a lookup, and of a
roll-up summary it reports the field in the filter and nothing else. For these kinds the gate as written asks
for nothing, because there is nothing that Salesforce confirms.

The question was put to the maintainer as Q3 of the [Phase 1 plan](../plans/phase-1.md), with two options: add
a second half to the gate now, or decide when Phase 3 is planned. The maintainer chose the first on 15 November 2026.

## Decision

The gate of record 0021 stays as it is and gets a second half.

**For standard fields, names in text, lookups and roll-up summaries, the gate asks for two things.**

1. Every entry of the answer key of the fixture project for these kinds is found.
2. A random sample from the public codebases is checked by hand for references of these kinds. No reference
   that OrgLens reports in the sample is wrong, and the list of what it missed is published.

The size of the sample is set in the phase that runs the gate.

That is all the maintainer decided.

## What goes further than the answer of the maintainer

Three statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **The pass marks of a phase do not replace the gate.** A phase can ask for more than the gate. It cannot ask
  for less in its place.
- **"Published" means a file in this repository.** A sample from a public codebase can be published. Nothing
  from a real org can (the data rules of `CLAUDE.md`), so the real org of level 3 is not a source of the sample.
- **The rule of record 0034 for a pair without a row stays.** Record 0034 says that a pair OrgLens found and the
  Dependency API does not have is a difference only where the API could have seen it, and that the answer to Q3
  may change that rule. The option the maintainer chose does not speak of it, so the author leaves it as it is.

## Consequences

- Every phase from Phase 1 on knows what it works towards for the kinds Salesforce does not see.
- The second half rests on the answer key and on checks by hand. Both were written and done by the author of the
  analysers so far (risk 12 of the [overall plan](../plans/re-architecture-plan.md)). A second person reads a
  part of the key in every test plan, and that is the only outside check for these kinds.
- "Checked by hand" does not say by whom. It is not decided whether the sample of the gate is checked by the
  maintainer, by the author, or by both.
- The Dependency API is blind to more than the four kinds the question named. Record 0034 and the note of the
  real org also name a validation rule that is not active, a lookup filter, and a field that is named only in a
  describe call or through a token kept in another class. The second half does not cover them by this record.
  They are put to the maintainer when the gate is planned.
- The estimate of the gate in the overall plan, two to three weeks, was made before the second half existed and
  was not looked at again.
