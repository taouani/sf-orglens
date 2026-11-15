# 0035. The correctness gate has a second half for what Salesforce cannot confirm

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (made during the build)

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
2. A random sample of references of these kinds from the public codebases is checked by hand. No reference in
   the sample is wrong, and the list of what was missed is published.

The size of the sample is set in the phase that runs the gate.

That is all the maintainer decided.

## Consequences

- Every phase from Phase 1 on knows what it works towards for the kinds Salesforce does not see. The pass marks
  of a phase can be stricter than the gate. They cannot replace it.
- The second half rests on the answer key and on checks by hand. Both were written and done by the author of the
  analysers so far (risk 12 of the [overall plan](../plans/re-architecture-plan.md)). A second person reads a
  part of the key in every test plan, and that is the only outside check for these kinds.
- "Checked by hand" does not say by whom. It is not decided whether the sample of the gate is checked by the
  maintainer, by the author, or by both.
- Record 0034 names a fifth kind the Dependency API does not report: a validation rule that is not active. The
  question to the maintainer did not name it, so the second half does not cover it by this record. It is put to
  the maintainer when the gate is planned.
- "Published" means a file in this repository. A sample from a public codebase can be published. Nothing from a
  real org can (the data rules of `CLAUDE.md`), so the real org of level 3 is not a source of the sample.
