# 0058. A type counts for a complete snapshot once it is analysed

- Status: Accepted
- Date: 2026-11-22
- Decisions: none (an answer of the maintainer to the Phase 2 plan)
- Changed by: [0068](0068-every-analysed-type-is-of-the-logic-tier.md), which builds it in work package 6: the four actions of a workflow rule that are analysed join the list, `WorkflowFlowAutomation` does not, the list keeps its name, `exclude_types` refuses the four, and a snapshot that an older version took keeps its judgement

## Context

A snapshot of an org is `complete` when every listed component of the logic tier came back and could be read
(record [0038](0038-a-snapshot-reads-every-type.md)). The tier is a list of 21 names of the Metadata API (record
[0046](0046-complete-over-the-logic-tier.md)). What is missing of another type is a warning and leaves the snapshot
complete.

Phase 2 analyses types that are not on the list: the field updates, alerts, outbound messages and tasks of a
workflow rule, and by record
[0055](0055-email-templates-report-types-and-quick-actions-in-phase-2.md) email templates, report types and quick
actions. If something of such a type is missing, an impact answer can miss a reference while the snapshot says
`complete`. The answer itself says so today (`mayMiss`, record [0044](0044-an-impact-answer.md)). The
[overall plan](../plans/re-architecture-plan.md#open-questions) held it as not decided whether a type outside the
logic tier counts for "complete" once it has an analyser.

The question was put to the maintainer as Q4 of the [Phase 2 plan](../plans/phase-2.md), with two options: (a)
yes, every type that has an analyser joins the list, (b) no, the list stays and an impact answer says for itself
that an analysed type is not whole. The maintainer chose (a) on 22 November 2026.

## Decision

**Every type that has an analyser counts for the judgement of "complete".** What an org lists of such a type and
does not hand out, or hands out in a form that cannot be read, is an error of the snapshot and makes it `partial`,
as it does for a type of the logic tier today.

That is all the maintainer decided.

## What goes further than the answer of the maintainer

Three statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **The list of record 0046 stays in force until the change is built.** That is work package 6 of the plan. The
  record written with it names the types that join and replaces the list of record 0046. Until then a snapshot is
  judged as it is today. The three types of work package 8 join after that, with their analysers, in the pull
  request of that work package (record
  [0055](0055-email-templates-report-types-and-quick-actions-in-phase-2.md)).
- **No type leaves the list.** The 21 names stay, also those no phase analyses yet, such as Apex classes: record
  0038 names them, and this answer adds to the list.
- **A type joins with the version that analyses it**, not before. A snapshot is never changed (record
  [0007](0007-immutable-snapshots.md)), so one that an older version stored keeps the judgement it was given. What
  an analysis of it by a newer version says about a type that joined since is settled with work package 6. An
  impact answer says today that it may miss something in that case (`mayMiss`).

## Consequences

- More orgs get a snapshot that is `partial`. On the test org it changes nothing as the types stand: 209 of 222
  components that do not come back are warnings today, and none of them is of a type the Phase 2 plan analyses.
  They are of ten types, 171 of them list views and 24 reports
  ([note of the test org](../research/phase-1/real-org.md)). Two of the ten are close to a type that is
  analysed: `EmailFolder`, the folder of email templates, and `WorkflowFlowAutomation`, a part of the file of
  workflow rules that the plan does not name. Whether such a type joins with the type it belongs to is not
  decided. For the first it is put to the maintainer with work package 8, for the second it is settled with work
  package 6. One org says little about others.
- The exit code of `orglens snapshot` follows the judgement, and `docs/cli.md` holds the list. Both change with
  work package 6, in the same pull request, and with the version of the pre-release that carries it. No name and
  no output is fixed before the first version without a pre-release part (record
  [0053](0053-a-pre-release-is-published-on-npm.md)).
- The list is no longer the logic tier in the words of records 0004 and 0038: it is the logic tier and whatever
  else is analysed. What it is called in the code and in the documents is settled with work package 6.
- The key `exclude_types` refuses a type of the logic tier (record
  [0048](0048-types-a-snapshot-leaves-out.md)). Whether it also refuses a type that joined by this record is
  settled with work package 6. Until it is, the key behaves as it does today.
- `mayMiss` of an impact answer stays as record [0044](0044-an-impact-answer.md) defines it.
