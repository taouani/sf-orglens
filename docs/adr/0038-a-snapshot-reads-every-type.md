# 0038. A snapshot of an org reads every type, and references are found phase by phase

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (a change the maintainer made when approving the Phase 1 plan)
- Changed by: [0047](0047-types-a-snapshot-leaves-out.md), in the one point this record leaves undecided: `orglens.toml` gets a key that leaves types outside the logic tier out of a snapshot. A type that is left out is not listed

## Context

Record [0036](0036-what-a-snapshot-of-an-org-reads.md) held the answer of the maintainer to question Q2 of the
[Phase 1 plan](../plans/phase-1.md): a snapshot of an org reads the logic tier by default, and other types when
`orglens.toml` asks for them. With that answer came a note: "the goal is all metadata except those coming from
managed packages". The author of record 0036 read the note as the goal for later phases.

The maintainer was asked to approve the plan and chose the option "Approve with changes" on 15 November 2026.
The option said: "Tell me which reading or part to change. I correct the plan first and then start Phase 1."
The change, in the maintainer's words:

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

**What the approval rests on.** The approval was given with the option "Approve with changes", before the
change was written into the plan. The author told the maintainer that it takes the plan as approved with this
change. The maintainer did not answer that and has not read the changed text.

## Decision

The option the maintainer chose, word for word. Its name was "Read everything now, analyse by phase", and it
said:

> From Phase 1 a snapshot reads every type. Complete is judged over the logic tier. References are found phase
> by phase. Replaces your (a) to Q2 and reports as opt-in.

That is all the maintainer decided.

## What goes further than the choice of the maintainer

Eight statements of this record are readings or conclusions of its author. The maintainer can strike any of
them. The maintainer was told the second, the fourth and the sixth on the same day, and the proposal of a key
that the consequences name. The others have not been put to the maintainer.

1. **"Every type" is every type the org lists.** That is what a snapshot of an org reads since Phase 0 (record
   [0032](0032-reading-an-org.md)). No type is left out by default, reports included. It is not every
   component: the consequences say what does not come back.
2. **"Almost" in the words of the maintainer is read as the managed packages of the earlier note.** Until a
   later record says otherwise, a snapshot still reads the components of an installed package, as it does today.
   How they are left out is not decided. It is put to the maintainer when Phase 2 is planned.
3. **"The logic tier" is the list of record 0004 with three types added**: custom labels, custom permissions
   and global value sets. A formula can refer to each of them, and record 0004 names none. Question Q2 said that
   its option (a) needs a yes to them, and the maintainer answered "(a)". The author of record 0036 read that as
   the yes. The option the maintainer chose now does not speak of them, and the author keeps the reading.
4. **What is missing outside the logic tier is a warning.** A snapshot is complete when every listed component
   of the logic tier came back and could be read. A component of another type that is listed and does not come
   back, a file of another type that cannot be read, a type outside the logic tier whose listing the org refuses
   and a retrieve that fails for such types only are named in the output and do not make the snapshot partial.
   The same causes inside the logic tier make it partial, as record 0032 says. This follows option (b) of
   question Q2, which the option the maintainer chose now matches.
5. **A file whose type cannot be told counts against the logic tier** until it is explained. The test org has
   three such files.
6. **The order of the analysers stays that of the roadmap**: objects, fields, formulas and validation rules in
   Phase 1, flows in Phase 2, Apex in Phase 3, permission sets and groups in Phase 4, the presentation tier after
   the gate. Where email templates, report types and reports go is put to the maintainer when Phase 2 is planned.
7. **"Indexed" has two steps.** Every component that was read gets a row with its type and name and keeps its
   file, from Phase 1 on. It can be found by name and can be the target of a reference. The parts inside a
   component, such as the elements of a flow and the methods of a class, and the references out of it exist only
   once the analyser of its type is built.
8. **A snapshot of a Git source is not changed.** It reads what the folders hold
   ([0030](0030-reading-a-git-source.md)).

## Consequences

- **Record 0036 is superseded.** Both sentences it decided are replaced. Three things of it are carried here:
  the note of the maintainer, the reading that adds three types to the logic tier, and the open points of the
  test org below.
- Decision F3 ([0004](0004-metadata-coverage-tiers.md)) is changed in one point: reports are read by default.
  They are not analysed before the phase that builds an analyser for them.
- Until a type has its analyser, an impact answer names it as read and not analysed. Such an answer is not
  complete. For an org with many flows and classes that is most of the logic until Phase 3 is built.
- **"Every type" is not every component.** Standard value sets are described and never listed, so they are not
  read. Parts that Salesforce hands out only when they are named do not come back: 171 of the 224 list views of
  the test org. A component in a folder the org does not list is never asked for, and nothing can say so.
  Newer orgs have folders inside folders for reports and dashboards, and whether the listing shows them is not
  verified (record 0032). With reports read by default that matters from Phase 1 on.
- **Every snapshot of the test org will carry warnings.** The org lists 223 components that it does not hand
  out ([real-org.md](../research/phase-0/real-org.md)). Thirteen are in types of the logic tier and one is the
  custom labels. The other 209 are outside it, 24 of the 30 reports among them, for which the cause is not
  known. Risk 13 of the [overall plan](../plans/re-architecture-plan.md) moves from a status that is always
  "partial" to warnings that are always there. A user can learn to ignore those as well.
- Thirteen components of the test org in types of the logic tier do not come back, and the custom labels with
  them. Seven of the thirteen are bundles of an installed package. Until they are explained, a snapshot of the
  test org can stay partial under this record too.
- Profiles and permission sets are in the logic tier, and a snapshot of an org reads them incompletely (record
  0032, warning `ACCESS_INCOMPLETE`). "Complete" does not cover that. It is not changed by this record.
- When a type outside the logic tier gets an analyser, whether it then counts for "complete" is not decided.
  Until then an impact answer names the missing components of every type it analyses, whatever its tier.
- Nothing that was measured supports 60 minutes for a first snapshot (record 0037), and this decision takes away
  one of the two things that record names as a help: a snapshot does not read fewer types. The one measurement,
  1,668 listed components in two to three minutes, was taken while reading every type, so the times record 0037
  scales from it are times for this decision.
- Reports can number in the tens of thousands in a large org. How long such an org takes, and how large its
  database gets, is not measured.
- Whether `orglens.toml` gets a key to leave types out is not decided. The Phase 1 plan proposes one in its work
  package 9, for types that are not of the logic tier, because of the reports of a large org. With such a key
  the question record 0036 left open comes back: whether a type that is left out is still listed, and counted
  in the column `LISTED` of `coverage`. A reference can point at a component of a type that was left out. The
  target is then named and marked as not read, never dropped.
- The components of a managed package are still read. The note of the maintainer names leaving them out as the
  goal. References from the maintainer's own metadata into a package point at fields and classes of the
  package. If packages are left out entirely, those references point at nothing (open question "Managed
  packages" of the overall plan).
- The effort of the Phase 1 plan was not estimated again for this change.
