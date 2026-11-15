# 0036. A snapshot of an org reads the logic tier by default, and is complete when all of it came back

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (an answer of the maintainer to the Phase 1 plan)

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

**A snapshot is complete when every listed component of the types it reads came back and could be read.**

The note of the maintainer with this answer: "the goal is all metadata except those coming from managed
packages".

That is all the maintainer decided.

## What goes further than the answer of the maintainer

Six statements of this record are readings or conclusions of its author. The maintainer was told the first two
on the same day and can strike any of them.

- **Three types are added to the default.** The default list is the logic tier of record 0004, with custom
  labels, custom permissions and global value sets added. A formula can refer to each of them, and record 0004
  names none. The question said that option (a) needs a yes to them. The maintainer answered "(a)", and the
  author reads that as the yes.
- **The note is the goal for later phases, not a change to Phase 1.** Until a later record says otherwise, a
  snapshot reads the components of an installed package in the types it reads, as it does today. The note goes
  further than decision F3, which ends at the presentation tier with reports as opt-in. The author reads F3 as
  still setting the order in which types are built.
- **A type that is left out is named in the output of `coverage` as not read.** It does not make a snapshot
  partial.
- **The other causes of "partial" stay.** The option names only listed components. A type the snapshot reads
  whose listing the org refuses still makes the snapshot partial, and so does a retrieve that fails, as record
  0032 says.
- **A snapshot of a Git source is not changed.** It reads what the folders hold
  ([0030](0030-reading-a-git-source.md)).
- **The list is given here in words.** Which Metadata API type names it holds is set with the feature. The
  count of thirteen below assumes that list views, matching rules and the one component of the type
  `WorkflowFlowAutomation` are outside it.

## Consequences

- "Partial" gets its meaning back: something the snapshot set out to read is missing. An impact answer inherits
  that state for the types it covers.
- The first snapshot of a large org reads fewer types. That it is shorter is expected and not measured.
- Not decided: whether a snapshot still asks the org to list the types it does not read. The column `LISTED` of
  `coverage` depends on it, and record [0037](0037-performance-targets.md) may count the size of an org by that
  column.
- The names of the keys in `orglens.toml` are not set here. The Phase 1 plan, which is not approved yet,
  proposes to set them in its work package 9, with the feature that reads them, and to document them in
  `docs/configuration.md`.
- A reference can point at a component of a type that was not read. The target is then named and marked as not
  read, never dropped.
- Not decided: how the components of a managed package are left out, and from which phase. References from the
  maintainer's own metadata into a package point at fields and classes of the package. If packages are left out
  entirely, those references point at nothing. This is put to the maintainer when the phase that widens the
  types is planned, with the open question "Managed packages" of the overall plan.
- Thirteen components of the test org in logic-tier types do not come back, and the custom labels with them.
  Three files came back and could not be read, and in which types they are is not known. Work package 9 of the
  Phase 1 plan proposes to look at each. Until they are explained, a snapshot of the test org can stay partial
  under this record too. Seven of the thirteen are bundles of an installed package. If the maintainer strikes
  the second reading above, they are not read at all.
