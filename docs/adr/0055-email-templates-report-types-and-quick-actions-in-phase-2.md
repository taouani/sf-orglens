# 0055. Email templates, report types and quick actions are analysed in Phase 2, and reports stay after the gate

- Status: Accepted
- Date: 2026-11-22
- Decisions: none (an answer of the maintainer to the Phase 2 plan)

## Context

With the approval of the Phase 1 plan the maintainer named email templates, report types and reports among what
OrgLens should cover (record [0038](0038-a-snapshot-reads-every-type.md)). A snapshot of an org reads all of them
since Phase 1. Reading is not analysing: the roadmap of the
[overall plan](../plans/re-architecture-plan.md#roadmap) had email templates and reports in Phase 6, after the
correctness gate, and report types in no phase. That order comes from decision F3 (record
[0004](0004-metadata-coverage-tiers.md)), which has email templates in the presentation tier, built after the
gate. Record 0038 left the order of the analysers as it was and said that the place of these types is put to the
maintainer when Phase 2 is planned.

Quick actions were not among the types the maintainer named. Phase 1 left out the formulas they hold: the package
folders of the pinned public codebases hold 16 of them, 11 in PMM and 5 in NPSP
([note of Phase 1](../research/phase-1/public-codebases.md)). The question as it was put to the maintainer said 11,
which is PMM alone.

The question was put to the maintainer as Q1 of the [Phase 2 plan](../plans/phase-2.md), with three options: (a)
email templates, report types and quick actions join Phase 2 and reports stay where they are, (b) reports join too,
(c) none of them now. The maintainer chose (a) on 22 November 2026.

## Decision

**Email templates, report types and quick actions are analysed in Phase 2**, as work package 8 of its plan.

**Reports stay where the roadmap has them**, in Phase 6. A snapshot still reads them.

That is all the maintainer decided. Decision F3 is changed in one point by it: email templates are analysed before
the gate.

## What goes further than the answer of the maintainer

Four statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **What is read of each type is what work package 8 says**: the merge fields of an email template, the objects
  and fields of a report type, and the formula and the field of a predefined value of a quick action. The build
  may change a detail of it.
- **The three types join the judgement of "complete" with their analysers.** The maintainer answered Q4 of the
  same plan on the same day: a type counts once it is analysed (record
  [0058](0058-a-type-counts-for-complete-once-it-is-analysed.md)). The author reads the two answers together. An
  org that lists an email template, a report type or a quick action and does not hand it out then has a snapshot
  that is `partial`. Work package 6 builds that change for the types analysed by then and writes the record with
  the list. Work package 8 is built after it, so it adds its three types to that list and to `docs/cli.md` in
  the pull request that builds their analysers. The list changes twice within the phase. A user sees one change
  if no pre-release is made between the two.
- **Whether the folder of an email template counts is not decided.** Email templates are kept in folders, as
  reports are, and an org lists the folder as a type of its own (`EmailFolder`). On the test org the one
  component of that type is among those that do not come back. The author puts the choice to the maintainer
  with work package 8, before the three types join the list.
- **Work package 8 is built after the flows and the workflow rules**, in the order of the plan. An email alert of
  a workflow rule refers to an email template, which is a named component until then.

## Consequences

- The row of Phase 2 in the roadmap gets the three types, the row of Phase 6 loses email templates, and report
  types leave the list "Later". The estimate of Phase 2 is about 5 weeks, where the roadmap had 3 to 4, with work
  package 8 at about 3 days of it.
- The counts work package 8 rests on, 31 email templates, 4 report types and 51 quick actions, are from codebases
  of which two are not pinned yet. They are taken again when the two are pinned.
- A report names its fields in the words of its report type. With report types analysed in Phase 2, the analysis
  of reports in Phase 6 has what it needs.
- Nothing has measured a snapshot of an org with tens of thousands of reports, neither its time nor its size. That
  is not changed by this record. The key `exclude_types` of record
  [0048](0048-types-a-snapshot-leaves-out.md) leaves reports out of a snapshot where they are too many.
- An email template of an org can hold the name of a person or an address in its text. The text is in the
  snapshot, on the machine of the user, as every file is. No reference is made of it.
