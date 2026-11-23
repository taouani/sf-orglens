# 0068. Every type the engine analyses is of the logic tier, and the actions of a workflow rule join it

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (it builds the answer of the maintainer of record 0058, in work package 6 of the Phase 2 plan,
  with the choices the author made in building it)

## Context

Record [0058](0058-a-type-counts-for-complete-once-it-is-analysed.md) holds what the maintainer answered to Q4 of
the [Phase 2 plan](../plans/phase-2.md) on 22 November 2026: every type that has an analyser counts for the
judgement of "complete". What an org lists of such a type and does not hand out, or hands out in a form that
cannot be read, makes the snapshot `partial`. The author of that record added that the list of record
[0046](0046-complete-over-the-logic-tier.md) stays in force until work package 6 builds the change, and that the
record written then names the types that join and replaces that list. Four points were left to that record: what
the list is called, whether the key `exclude_types` refuses a type that joined, what an analysis by a newer
version says of a snapshot that an older version took, and whether `WorkflowFlowAutomation`, an action of a
workflow rule that no analyser reads, joins with the actions that are read.

By the time of this record, Phase 2 analyses flows, workflow rules with their actions, record types, field sets
and the records of custom metadata types (records [0061](0061-the-elements-of-a-flow.md),
[0063](0063-the-parts-of-a-file-of-workflow-rules.md) and
[0065](0065-record-types-field-sets-and-records-of-custom-metadata.md)). The list of record 0046 names every one
of these types but four, the actions of a workflow rule that are read: `WorkflowAlert`, `WorkflowFieldUpdate`,
`WorkflowOutboundMessage` and `WorkflowTask`. Until this record, an org could list one of them and not hand it out,
and the snapshot stayed `complete`, with a warning. An impact answer from it had the type in `notCovered.partial`
and said that it may miss something (`mayMiss`). And `exclude_types` accepted the four names. Record 0063 says that
the key can then leave out a type the analysis reads. For the four it could not: an action comes in the file of the
workflow rules of its object, so a snapshot read it all the same and said so with the warning `TYPE_NOT_EXCLUDED`.

## Decision

**The four actions of a workflow rule that are analysed join the list of the types a snapshot of an org is
judged by:** `WorkflowAlert`, `WorkflowFieldUpdate`, `WorkflowOutboundMessage` and `WorkflowTask`. The list has 25
names and replaces the list of record 0046. Each of the four issues that say that something is missing,
`LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED` and `RESOLVE_FAILED`, is an error when it counts against one
of the four, and makes the snapshot `partial`, as for every type of the list. Two cases change in practice: an
action that the org lists and does not hand out, and a listing of actions that the org refuses. The other two
counted against the list before. A retrieve asks for the file of the workflow rules of an object, `Workflow`, and
never for an action by its own name (record [0049](0049-a-part-by-its-own-name.md)), and a file under `workflows`
counts by the types of that folder, `Workflow` among them.

The statements below are choices of the author of this record. The maintainer can strike any of them.

1. **One list, and every type an analyser reads is on it.** The list stays in `core/tiers.ts`. A test holds the
   types the analysis reads (`analyseSource`) against it, and fails when an analyser reads a type that the list
   lacks, so that a type joins in the pull request that analyses it. `core/` imports nothing else of the engine,
   so the list names the types itself and is not made from the analysers.
2. **The list keeps its name, the logic tier**, and the issues keep the values `logic` and `other` of
   `details.tier`. A new name would change messages, the JSON and a script that reads `details.tier`, for a list
   that is the logic tier of records [0004](0004-metadata-coverage-tiers.md) and
   [0038](0038-a-snapshot-reads-every-type.md) with the types that are analysed beside it. `docs/cli.md` says that
   every type an analyser reads is on it.
3. **The other actions of a workflow rule do not join, and neither does `FlowDefinition`.** None of them has an
   analyser. A flow action (`WorkflowFlowAction`), an action that publishes an article (`WorkflowKnowledgePublish`)
   and an action that sends (`WorkflowSend`) are components with a row and nothing read (record 0063, point 2).
   `WorkflowFlowAutomation` is not read either: the Salesforce library knows it only as a type of its own, in a
   folder of its own, and what a file of workflow rules holds of it is no component (record 0063, point 9). The
   test org lists 7 components of it and hands out none, in runs 23 and 27 of "Live org". In run 27 that is as
   many as it lists flows, and what such a component stands for is not verified. In the same run the org lists no
   component of `WorkflowKnowledgePublish` and `WorkflowSend`, and does not describe `WorkflowFlowAction`. If the
   type joined, a snapshot would be `partial` for a type that nothing reads, while a rule that names one of its
   components refers to it by its name either way.
   `FlowDefinition` names the active version of a flow, and a snapshot reads it to fetch that version. Where it is
   missing or left out, a flow whose file is not active is kept as it came, with the warning
   `FLOW_VERSION_UNKNOWN`, which an impact answer that covers flows counts (record
   [0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md)).
4. **`exclude_types` refuses the four**, as it refuses every type of the list (record
   [0048](0048-types-a-snapshot-leaves-out.md)): the file `orglens.toml` is refused, and the message names the
   type. A snapshot read them all the same before, so the refusal takes nothing away, and it says so before the
   org is asked.
5. **A snapshot keeps the judgement it was given** (record [0007](0007-immutable-snapshots.md)). One that an older
   version took, in which an action did not come back, stays `complete`, and its issue stays a warning, also when
   this version analyses it again. For such a snapshot, `orglens analyse` and `orglens coverage` still say that it
   is complete for the logic tier, as the version that took it judged. An impact answer from it says that it may
   miss something where its analysis read the actions, as one by this version does: the counts of the type put it
   in `notCovered.partial`, whatever the severity of the issue (record [0044](0044-an-impact-answer.md)). The rule
   of record 0046 that counts a warning outside the tier in `readErrors`, when it names a type the answer covers,
   is one for later again: every type this version analyses is of the list. No snapshot is known to hold such a
   warning about an action either. An older version wrote a file under `workflows` that could not be read, and a
   retrieve that failed, with `Workflow` among their types, so as an error. The one way to such a warning was a
   failure of the Salesforce library while it reads a part of a file of workflow rules, which no test reaches.
6. **The three types of work package 8**, email templates, report types and quick actions, join with their
   analysers, in the pull request of that work package (record 0058). The test of point 1 fails that pull request
   until they do.

## Consequences

- A snapshot of an org that lists an action of a workflow rule and does not hand it out is `partial` where it was
  `complete`, and `orglens snapshot` ends with `5` where it ended with `0`. A test against the mock org takes a
  task out of a file of workflow rules and finds the error `NOT_RETRIEVED` with `details.tier` set to `logic`. An
  impact answer from such a snapshot names the status `partial` where it named `complete`. That it may miss
  something it said before as well, since the actions are analysed (record 0063): the counts of the type put the
  type in `notCovered.partial`.
- On the test org nothing changes. In
  [run 27 of "Live org"](https://github.com/taouani/sf-orglens/actions/runs/45256396281) it listed and handed out
  every action of its files of workflow rules: 1 email alert, 4 field updates, of which the fixture project has 3,
  1 outbound message and 1 task. Its snapshot stays `partial` for the six components of objects, fields and record
  types that do not come back (record 0049).
- A file `orglens.toml` that names one of the four in `exclude_types` is refused where it was read with a warning.
- Records 0046 and 0048 say that every analysed type is of the logic tier. That holds again: record 0063 had made
  it untrue for the four actions. The rule of record 0046 that counts a warning outside the tier for an impact
  answer is one for later again, as that record says of it.
- `docs/cli.md` lists the 25 names and says that every type an analyser reads is among them. The JSON Schema of
  the output names no type of the list: only the description of `readErrors` changes. `docs/configuration.md`
  refers to the list in `docs/cli.md` and does not change.
- The database is not changed. A snapshot keeps the issues it has: only issues written from this version on about
  the four have the severity `error` and `details.tier` set to `logic`.
- Not measured: an org that lists an action and does not hand it out, which only the mock org of the tests does,
  and an org that refuses to list the actions, which no test shows. No real org but the test org was read.
