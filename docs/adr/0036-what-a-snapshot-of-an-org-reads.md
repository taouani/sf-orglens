# 0036. A snapshot of an org reads the logic tier by default, and is complete when all of it came back

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (made during the build)

## Context

Since Phase 0 a snapshot of an org reads every metadata type the org lists, reports included, and it is
`partial` when anything that was listed did not come back ([0032](0032-reading-an-org.md)). Both snapshots of
the test org are partial: the org lists 223 components that Salesforce does not hand out
([real-org.md](../research/phase-0/real-org.md)). A status that is always `partial` teaches a user to ignore it
(risk 13 of the [overall plan](../plans/re-architecture-plan.md)).

Decision F3 ([0004](0004-metadata-coverage-tiers.md)) says that the logic tier comes first, that the
presentation tier follows after the gate, and that reports are opt-in. Nothing in the code does that yet.

The question was put to the maintainer as Q2 of the [Phase 1 plan](../plans/phase-1.md), with three options.
The maintainer chose option (a) on 15 November 2026 and added a note, which is given below in the maintainer's
words.

## Decision

**A snapshot of an org reads the logic tier by default.** Other types are read when `orglens.toml` asks for
them.

The default list is the logic tier of record 0004, with three types added that a formula can refer to and that
record 0004 does not name: custom labels, custom permissions and global value sets.

**A snapshot is complete when every listed component of the types it reads came back and could be read.** A
type that is left out is named in the output of `coverage` as not read. It does not make a snapshot partial.

A snapshot of a Git source is not changed by this record: it reads what the folders hold
([0030](0030-reading-a-git-source.md)).

The note of the maintainer with this answer: "the goal is all metadata except those coming from managed
packages".

## What goes further than the answer of the maintainer

Two statements of this record are readings of its author. The maintainer was told both on the same day and
can strike either one.

- The three added types. The question said that option (a) needs a yes to them. The maintainer answered "(a)",
  and the author reads that as the yes.
- The note is read as the goal for later phases, not as a change to Phase 1. Until a later record says
  otherwise, a snapshot reads the components of an installed package in the types it reads, as it does today.
  The note goes further than decision F3, which ends at the presentation tier with reports as opt-in. F3 still
  sets the order in which types are built.

## Consequences

- "Partial" gets its meaning back: something the snapshot set out to read is missing. An impact answer inherits
  that state for the types it covers.
- The first snapshot of a large org reads fewer types. That it is shorter is expected and not measured.
- The names of the keys in `orglens.toml` are not set here. They are set with the feature that reads them, in
  work package 9 of the Phase 1 plan, and documented in `docs/configuration.md`.
- A reference can point at a component of a type that was not read. The target is then named and marked as not
  read, never dropped.
- Not decided: how the components of a managed package are left out, and from which phase. References from the
  maintainer's own metadata into a package point at fields and classes of the package. If packages are left out
  entirely, those references point at nothing. This is put to the maintainer when the phase that widens the
  types is planned, with the open question "Managed packages" of the overall plan.
- Thirteen components of the test org in logic-tier types still do not come back, and the custom labels with
  them. Work package 9 of the Phase 1 plan looks at each. Until they are explained, a snapshot of the test org
  can stay partial under this record too.
