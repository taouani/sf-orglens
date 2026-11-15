# 0038. A snapshot of an org reads every type, and references are found phase by phase

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (a change of the maintainer to the Phase 1 plan, made with its approval)

## Context

Record [0036](0036-what-a-snapshot-of-an-org-reads.md) holds the answer of the maintainer to question Q2 of the
[Phase 1 plan](../plans/phase-1.md): a snapshot of an org reads the logic tier by default, and other types when
`orglens.toml` asks for them. With that answer came a note: "the goal is all metadata except those coming from
managed packages". The author of record 0036 read the note as the goal for later phases.

The maintainer was asked to approve the plan and chose "Approve with changes" on 15 November 2026. The change,
in the maintainer's words:

> metadata to index/retrieve should cover almost everything in the org: Custom objects/fields, flows and their
> elements, Apex classes and their methods, email templates, report types, reports, permission sets, permissin
> set groups, ....

The author put two readings of it to the maintainer, with a third option for anything else. The first: from
Phase 1 a snapshot reads every type, and the references inside a type are found in the phase that builds its
analyser. The second: the answer to Q2 stays, and the list is written down as the goal. The maintainer was told
three things with them. Analysing all of the list in Phase 1 is not possible. Reading everything works against
the target of 60 minutes for a first snapshot (record [0037](0037-performance-targets.md)). Report types are in
no phase of the roadmap, and email templates and reports come after the gate.

The maintainer chose the first reading on the same day.

## Decision

The option the maintainer chose, as it was put:

**From Phase 1 a snapshot reads every type. Complete is judged over the logic tier. References are found phase
by phase. This replaces the answer (a) to Q2, and it replaces reports as opt-in.**

That is all the maintainer decided.

## What goes further than the choice of the maintainer

Seven statements of this record are readings or conclusions of its author. The maintainer can strike any of
them.

- **"Every type" is every type the org lists.** That is what a snapshot of an org reads since Phase 0 (record
  [0032](0032-reading-an-org.md)). Nothing is left out by default, reports included.
- **"Almost" in the words of the maintainer is read as the managed packages of the earlier note.** Until a later
  record says otherwise, a snapshot still reads the components of an installed package, as it does today. How
  they are left out is not decided.
- **"The logic tier" is the list of record 0004 with the three types record 0036 adds**: custom labels, custom
  permissions and global value sets. That the three belong to it is itself a reading of the author of record 0036.
- **What is missing outside the logic tier is a warning.** A snapshot is complete when every listed component of
  the logic tier came back and could be read. A component of another type that is listed and does not come
  back, a file of another type that cannot be read, a type outside the logic tier whose listing the org refuses
  and a retrieve that fails for such types only are named in the output and do not make the snapshot partial.
  The same causes inside the logic tier make it partial, as record 0032 says. This follows option (b) of
  question Q2, which the option the maintainer chose now matches.
- **"Indexed" has two steps.** Every component that was read gets a row with its type and name and keeps its
  file, from Phase 1 on. It can be found by name and can be the target of a reference. The parts inside a
  component, such as the elements of a flow and the methods of a class, and the references out of it exist only
  once the analyser of its type is built.
- **The order of the analysers stays that of the roadmap**: objects, fields, formulas and validation rules in
  Phase 1, flows in Phase 2, Apex in Phase 3, permission sets and groups in Phase 4, the presentation tier after
  the gate. Where email templates, report types and reports go is put to the maintainer when Phase 2 is planned.
- **A snapshot of a Git source is not changed.** It reads what the folders hold
  ([0030](0030-reading-a-git-source.md)).

## Consequences

- What record 0036 decided about the default list no longer holds. Its rule that a snapshot is complete when
  what it set out to read came back stays, with the logic tier as the measure.
- Decision F3 ([0004](0004-metadata-coverage-tiers.md)) is changed in one point: reports are read by default.
  They are not analysed before the phase that builds an analyser for them.
- Until a type has its analyser, an impact answer names it as read and not analysed. Such an answer is not
  complete. For an org with many flows and classes that is most of the logic until Phase 3 is built.
- Nothing that was measured supports 60 minutes for a first snapshot (record 0037), and this decision takes away
  one of the two things that record names as a help: a snapshot does not read fewer types. The one measurement,
  1,668 listed components in two to three minutes, was taken while reading every type, so the times record 0037
  scales from it are times for this decision.
- Reports can number in the tens of thousands in a large org. How long such an org takes, and how large its
  database gets, is not measured.
- Of the 30 reports the test org lists, 24 do not come back, and the cause is not known
  ([real-org.md](../research/phase-0/real-org.md)). With this record that is a warning and no longer a reason
  for "partial". It is still not explained.
- The question record 0036 left open, whether a snapshot still asks the org to list the types it does not read,
  is gone: every type is listed and read. The column `LISTED` of `coverage` counts the whole org.
- Whether `orglens.toml` gets a key to leave types out is not decided. The Phase 1 plan proposes one in its work
  package 9, because of the reports of a large org.
- The components of a managed package are still read. The note of the maintainer names leaving them out as the
  goal. How, and from which phase, is still open (open question "Managed packages" of the
  [overall plan](../plans/re-architecture-plan.md)).
