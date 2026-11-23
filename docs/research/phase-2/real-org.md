# real-org, with the fixture project of Phase 2

What the runs against the test org showed after the fixture project grew from 87 to 118 components, recorded on
23 November 2026. The runs are the ones of the workflow "Live org" (`.github/workflows/live-org.yml`), whose log is
public. Every number here is taken from such a log. Nothing was read from the org in another way, and no file of
the org was kept.

The notes of the earlier phases, [of Phase 0](../phase-0/real-org.md) and [of Phase 1](../phase-1/real-org.md),
describe the org, the steps and the earlier runs. This note says what is new. Claims are marked `[run N]` with the
run they come from, or `[unverified]`.

In short:

- Salesforce refused the first two deploys of the larger project, each time for a flow, and accepted the third
  after two flows were corrected by reading. All 118 components are in the test org.
- The org lists and hands out all 118. Nothing the engine does was changed for the metadata types that are new
  in the project.
- The Dependency API reports 76 of the 149 pairs of the answer key that come from the files of Phase 2, and 206
  of all 343. From a flow to a custom field it reports 47 of 49. It reports nothing from a workflow rule, from a
  record type, from an email alert, from an outbound message or from a task, and nothing a record of a custom
  metadata type says in a value.
- **A row of the Dependency API from a flow carries the id of a version of the flow, not of the flow.**
- **When a flow has an active version and a newer draft, the org hands out the draft.** The plan of Phase 2 and
  decision record 0057 expected the active version. The Dependency API holds the rows of both versions, each
  under the id of its version, and the org lists the id of the latest one only. Which version OrgLens analyses
  went back to the maintainer, as the plan says, who chose the active one on 23 November 2026.
- **Asked for by the name of the flow with the number of its active version, the org hands out the active
  version.** That is run 22, which was made after the answer of the maintainer. Decision record
  [0060](../../adr/0060-the-active-version-of-a-flow-is-analysed.md) holds the answer and what follows from the
  run.
- The cross-check of the engine for the types of Phase 1 holds on the larger project: of 57 pairs Salesforce
  reports, the analysis has 55, has 2 through a part of the object, and missed none.
- Read in parts, the rows of flows are whole before the draft and partial after it. By my reading of the code,
  the reader of the engine does not ask per component once a row it was given comes from a version the org did
  not list. It says that the reading is partial. The cross-check of flows has to be designed for it.
- The symbol tables are as in Phase 0 and Phase 1: no reference in any of them.

## Conditions

- The same org as before: one Developer Edition org, API version 68.0. No other edition, no sandbox and no org
  with a namespace was measured.
- One runner per run: `ubuntu-latest` of GitHub Actions, Node.js from `.node-version`.
- Every step ran once in the state it describes. The times are indications, not statistics.
- The steps print no name of a component that is not of the fixture project (decision record 0033). What is said
  here about the other components of the org is said in counts, types and forms of names.

| Run | Steps | Commit | Result |
| --- | --- | --- | --- |
| [17](https://github.com/taouani/sf-orglens/actions/runs/45091806191) | deploy and read | `9a7cc0d` | red: Salesforce refused the deploy for two flows, and the org was not read |
| [18](https://github.com/taouani/sf-orglens/actions/runs/45096200532) | deploy | `fcb563e` | red: Salesforce refused the deploy for one flow |
| [19](https://github.com/taouani/sf-orglens/actions/runs/45099692734) | deploy and read | `f563174` | green, with a warning for the partial snapshot |
| [20](https://github.com/taouani/sf-orglens/actions/runs/45100332744) | probe | `f563174` | green |
| [21](https://github.com/taouani/sf-orglens/actions/runs/45100823619) | draft, read and probe | `f563174` | green, with the same warning |
| [22](https://github.com/taouani/sf-orglens/actions/runs/45120017211) | probe | `5b9fb0b` | green |
| [23](https://github.com/taouani/sf-orglens/actions/runs/45182733256) | read and probe | `3732f2d` | green, with the same warning |
| [24](https://github.com/taouani/sf-orglens/actions/runs/45199698754) | read | `f5bb7fe` | green, with the same warning |

Run 16 is the login the workflow makes once a week by itself.

## 1. The deploys

A deploy is all or nothing, so the org was as before until run 19.

| Run | Counted | Without an error | Refused | New | Changed | As they were |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | 118 | 116 | `Invoice_Before_Save`, `Invoice_Review_Screen` | 27 | 11 | 78 |
| 18 | 118 | 117 | `Invoice_Before_Save` | 28 | 11 | 78 |
| 19 | 118 | 118 | none | 29 | 11 | 78 |

The last three columns count the components Salesforce found no error in. Each deploy ended in under a minute.
The project grew by 31 components, from 87 to 118, and Salesforce counted 29 as new in run 19. No log says which
two of the 31 it counted as changed or as they were.

**`Invoice_Review_Screen`** `[run 17]`. Of the problem only the everyday words came out: "field … unknown (A …
field of type … reference the field … because its … type … supported on this object. … or … the …". The field of
a record on the screen was bound to a currency field and had a name of its own. It was bound to a text field and
its name was taken out, as in the one public example found, and run 18 found no error in the flow. Which of the
two changes it was, the runs do not say `[unverified]`.

**`Invoice_Before_Save`** `[run 18]`. Run 17 gave everyday words only. A form was written from them (decision
record 0033), and run 18 printed the problem:

`field integrity exception: unknown (When the TriggerType field is set to "RecordBeforeSave", the $Record.Account__r.Is_Key_Account__c field isn't supported.)`

The path stood in a formula of the flow and nowhere else in it. The formula was changed to read a text field of
the invoice itself, and run 19 accepted the flow. Why Salesforce does not support that path is `[unverified]`.
Two readings are left:

- a formula of a flow that runs before the save may not cross a relationship from `$Record`;
- a path in such a flow may not end at a formula field, which `Account.Is_Key_Account__c` is.

A third reading is ruled out by run 19: that no path across a relationship is supported in such a flow. The flow
still holds three of them, in two assignments and in a decision, to a currency field, to `OwnerId` and through a
second relationship to a field of the user, and Salesforce accepted it.

What Salesforce accepted without a remark `[run 19]`, as far as one org of one edition says anything: a process of
the Process Builder and workflow rules, which the setup pages no longer create, a time trigger of a workflow rule,
a scheduled path of a flow, a custom error in a flow that runs before the save, a formula as the condition such a
flow starts by, and an outbound message that names the user of the login.

## 2. The snapshot

`[run 19]`, before the draft.

- The org lists 1,753 components, of which 118 are the fixture project. All 118 are listed and retrieved. The 122
  files of the project are in the snapshot: 31 are the same byte for byte and 91 differ.
- The snapshot is partial, for components of the org that are not of the project. Six components of the logic
  tier are listed and do not come back, two objects, two fields and two record types, as in the last run of
  Phase 1. Outside the tier, about 215 do not come back.
- Reading took 183 seconds, with 389 requests to the Metadata API, in three chunks.
- The metadata types that are new in the project came back: `Flow` (7 listed, 7 retrieved), `FlowDefinition`
  (7), `Workflow` (3) with its parts `WorkflowRule` (4), `WorkflowFieldUpdate` (4), `WorkflowAlert` (1),
  `WorkflowOutboundMessage` (1) and `WorkflowTask` (1), `FieldSet` (1), `CustomMetadata` (4), and the record
  types and the email template of the project among those of the org. The counts are those of the org: one
  `Flow`, one `FlowDefinition`, one `Workflow` and one `WorkflowFieldUpdate` are not of the project, which has
  6, 6, 2 and 3.
- The org lists 7 components of `WorkflowFlowAutomation` and hands out none `[run 23]`. The Salesforce library
  knows the type apart from the file of workflow rules, in a folder of its own. The note of Phase 1 counted 1 of
  them. The fixture project holds none, and why there are more is not known.

What Salesforce rewrote in the files of Phase 2 `[run 19]`. The log names 80 of the 91 files that differ, in the
order of their folders, so what it did to the other 11, the files of the workflow rules among them, is not in
it:

- **Every flow** got the element `areMetricsLoggedToDataCloud`. The flow that runs after the save got
  `nameSegment`, the process got `filterLogic`.
- **The screen flow** got `styleProperties` five times, each with a vertical alignment and a width. The log does
  not say where they stand. The file grew from 12,193 to 13,649 bytes. So the lines of a flow from an org are
  not the lines of the file that was deployed.
- **The three records of the custom metadata type** that leave a field out got a `values` element, with a `field`
  and a `value`, for each such field. The log counts the elements that were added by their names, and does not show
  what a `value` holds.
- **The two record types** each got the values of one more picklist.
- **The two relationship fields of the custom metadata type** lost `externalId`.

Every flow came back with the state its file names: five `Active` and one `Draft`.

## 3. The Dependency API and the files of Phase 2

`[run 19]` for the pairs of the files of Phase 2, `[run 20]` for all pairs. Both before the draft. A pair is a
component and a component it refers to.

The org gave 335 rows. 227 are between two components of the fixture project, and they are 227 pairs.

| | Pairs of the key | Reported |
| --- | --- | --- |
| From the files of Phase 2 | 149 | 76 |
| From the other files | 194 | 130 |
| All | 343 | 206 |

The number 206 is in no log. The probe of run 20 counts 195 pairs as reported, each matched by the ids of both
ends. It finds 11 more by a name alone, because it reads no id for an email template, a field set or a part of
the workflow rules, and does not count them `[run 20]`. The read step of run 19 matched those 11 pairs by the
ids the org listed the components with: its table of pairs has 3 of the email template, 4 of the field set, 3 of
the field updates and 1 to the email alert as reported `[run 19]`. So 206 are reported, and all 11 are among the
76.

The pairs of the files of Phase 2, by the types of their ends:

| From | To | In the key | Reported |
| --- | --- | --- | --- |
| Flow | CustomField, custom | 49 | 47 |
| Flow | CustomField, standard | 13 | 0 |
| Flow | CustomObject, custom | 10 | 10 |
| Flow | CustomObject, standard | 1 | 0 |
| Flow | ApexClass | 1 | 1 |
| Flow | CustomLabel | 2 | 2 |
| Flow | CustomPermission | 2 | 1 |
| Flow | WorkflowAlert | 1 | 1 |
| Flow | Flow | 1 | 0 |
| Flow | RecordType | 1 | 0 |
| CustomMetadata | CustomObject | 6 | 4 |
| CustomMetadata | CustomField | 13 | 0 |
| EmailTemplate | CustomField | 7 | 3 |
| FieldSet | CustomField | 5 | 4 |
| WorkflowFieldUpdate | CustomField | 8 | 3 |
| WorkflowRule | anything | 18 | 0 |
| WorkflowAlert | anything | 3 | 0 |
| WorkflowOutboundMessage | CustomField | 3 | 0 |
| WorkflowTask | CustomField | 1 | 0 |
| RecordType | CustomField | 4 | 0 |

What the rows say, read against the list of every pair in the log:

- **A flow.** Every pair to a custom field of an object is reported, whatever names the field: a path, a filter,
  a sort field, an assignment, an output, a formula, the date of a scheduled path, also across a relationship and
  in the flow that is a draft. The key has no pair to such a field that a merge field in a text makes alone. A
  custom label that only a merge field names is reported.
- **Missed from a flow, of what is custom:** two pairs to a field of a custom setting that a formula of the flow
  reads through `$Setup` and nothing else in the flow names. Another field of the same setting is reported where
  a condition reads it too. A custom permission read through `$Permission` is reported from a condition and
  missed from a formula.
- **Not reported from a flow:** every standard field and the one standard object, the subflow, and the record
  type a condition names as text.
- **Workflow.** Nothing is reported from a rule: not the fields of its criteria or of its formula, not the
  actions it starts. Of the field updates, the three custom fields their formulas read are reported, two of one
  and one of another. The field an update writes is not, nor the relationship field that leads to the parent it
  writes on. Of an email alert, an outbound message and a task, nothing.
- **A record of a custom metadata type.** The type it is a record of is reported. Nothing else is: not the fields
  of the type it gives a value for, not a field or an object named through a relationship field, not a name in a
  text.
- **An email template.** The three custom fields of its merge fields, and not the standard ones.
- **A field set.** Its four custom fields, also the one across a relationship, and not the standard one.
- **A record type.** Nothing: not the picklist fields whose values it limits.

Pairs the API reports and the key does not hold: 21 `[run 20]`. Twenty are the 20 of Phase 1, from an Apex class
or trigger to a class or an object, and from a validation rule to the object of a field it reads. The new one is
from the email template to the object `Invoice__c`, whose fields its merge fields name. The key holds the fields
and not the object. By my reading of the files, each of the 21 is a relation that exists, so no row between two
components of the project is wrong.

Of the 13 fields the key calls unreferenced, the API reports a reference to none `[run 20]`.

## 4. Flows and their versions

The probe reads two more objects of the Tooling API that describe metadata, `FlowDefinition` and `Flow`. The org
answered both queries with the fields the tool names `[run 20]`, which was not verified before.

### Before the draft

`[run 20]`

| Flow | Versions | Active | Latest | State of the latest |
| --- | --- | --- | --- | --- |
| `Invoice_After_Save` | 1 | 1 | 1 | Active |
| `Invoice_Before_Save` | 1 | 1 | 1 | Active |
| `Invoice_Purge_Void` | 1 | none | 1 | Draft |
| `Invoice_Recalculate` | 1 | 1 | 1 | Active |
| `Invoice_Review_Screen` | 1 | 1 | 1 | Active |
| `Invoice_Sent_Process` | 1 | 1 | 1 | Active |

- The three deploys left one version of each flow. A refused deploy adds none.
- **Every row from a flow carries the id of a version.** The API gave 62 rows from a flow: 59 with the id of the
  active version of a flow and 3 with the id of the one version of the flow that is a draft. No row carries the id
  of a flow as `FlowDefinition` has it. The type the row writes is `Flow`.
- The org lists each flow, in the Metadata API, with the id of that one version, so every one of the 62 rows has
  an end the org listed `[run 19]`.
- A flow that is a draft and was never active is reported like an active one.
- No row points at a flow.

### After the draft

The step "draft" sent `Invoice_Recalculate` once more with the status `Draft`. It differs from the file of the
project in three places, and reads `Paid_Date__c` where the file reads `Due_Date__c`. Salesforce took it in six
seconds and counted one component, changed `[run 21]`.

| Flow | Versions | Active | Latest | State of the latest |
| --- | --- | --- | --- | --- |
| `Invoice_Recalculate` | 2 | 1 | 2 | Draft |

The other five flows are as before. All of the following is `[run 21]`.

- **A deploy of a draft adds a version and leaves the active version active.**
- **The org hands out the draft.** The file of the flow in the snapshot has the state `Draft`, and the read
  step, which holds it against the three places the draft differs in, says that it is the draft. It has 11,408
  bytes, where the active version came back with 11,361. A retrieve that names a flow without a version gives
  the latest version, as the reference of the Metadata API says, and not the active one.
- **The org lists the flow with the id of the latest version.** Of the 78 rows from a flow, 63 have an id the org
  listed and 15 have not, which fits the 15 rows of the active version of `Invoice_Recalculate`.
- **The Dependency API holds the rows of both versions**: 15 with the id of version 1, which is active, and 16
  with the id of version 2, the draft. The one row more is from the flow to `Invoice__c.Paid_Date__c`. Before the
  draft there was no such row.
- The org gave 351 rows in all, 16 more than before. The pairs between components of the project went from 227
  to 228: a pair that both versions have is two rows.

### Asked for by the number of a version

The maintainer chose on 23 November 2026 that the active version of a flow is analysed. The probe then got a part
that asks the Metadata API for `Invoice_Recalculate` in every way a version of it could be named, each name in a
retrieve of its own (`packages/engine/test/live/flow-versions.ts`). The org was in the state the step "draft"
left: version 1 active, version 2 a draft. All of the following is `[run 22]`.

| Asked for | The retrieve | What came back |
| --- | --- | --- |
| `Flow`, `Invoice_Recalculate` | Succeeded | `flows/Invoice_Recalculate.flow`, 11,408 bytes, state `Draft`: the draft |
| `FlowDefinition`, `Invoice_Recalculate` | Succeeded | `flowDefinitions/Invoice_Recalculate.flowDefinition`, 171 bytes, which names version 1 as the active one |
| `Flow`, `Invoice_Recalculate-1` | Succeeded | `flows/Invoice_Recalculate-1.flow`, 11,361 bytes, state `Active`: the version that was sent as active |
| `Flow`, `Invoice_Recalculate-2` | Succeeded | `flows/Invoice_Recalculate.flow`, 11,408 bytes, state `Draft`: the draft |
| `Flow`, `Invoice_Recalculate-3` | Succeeded, with the remark that it cannot be found | No file |

- **The org hands out the active version when it is asked for by the name of the flow with the number of that
  version.** The number 3, for which the org holds no version, was asked as a control and gave no file, so the
  number plays a part: the org does not hand out the same file whatever the number is.
- **The file of the active version has the number in its name**, `Invoice_Recalculate-1.flow`. The file of the
  latest version has not, also when it is asked for by its number.
- **The file of the `FlowDefinition` names the number of the active version.** It is the number the Tooling API
  gives. So a snapshot can learn the number from a file it already reads, without the Tooling API.
- The two sizes are the ones of run 21 and of the runs before the draft: 11,408 bytes for the draft and 11,361
  for the active version.
- The part took 22 requests to the Metadata API and about eleven seconds, for five retrieves.

The reference of the Metadata API says of the full name of a flow that the name held the version number up to
API version 43 and no longer holds it from version 44. The org was asked with version 68.0 and handed out
version 1 for the name with `-1` all the same. The same paragraph says that a version can be retrieved by its
number, and that without a number "the flow is the latest version". Record 0060 quotes it as a tool read the
page for me on 23 November 2026. I read the sentence about version 44 as being about the name a flow comes back
with. The page does not say so.

### What follows

- **The expectation of decision record 0057 was wrong for a flow with a newer draft.** The record said that the
  version the org hands out is analysed, and its author expected that to be the active one. With a newer draft it
  is the draft, which does not run. The maintainer chose the active version, and record
  [0060](../../adr/0060-the-active-version-of-a-flow-is-analysed.md) replaces 0057.
- **Whether the active version can be asked for by its number is not known.** The reference of the Metadata API
  says of the full name of a flow that a version can be deployed or retrieved by its number, with a name such as
  `Invoice_Recalculate-1`. The same paragraph says that the name held the version number up to API version 43
  and no longer holds it from version 44. The org is read with version 68.0. `[unverified]`: no run asked that
  way, and I did not read the paragraph in full. Measured on 23 November 2026 `[run 22]`: it can, on the test
  org. The paragraph was then read in full, and record 0060 quotes it.
- **A snapshot can tell that it holds a draft of a flow that has an active version.** The file of the flow says
  `Draft`, and the file of its `FlowDefinition`, which the org hands out too, names the number of the active
  version. `[unverified]`: the run did not print that file. Measured on 23 November 2026 `[run 22]`: the file
  names version 1 as the active one.
- **A snapshot can get the active version of a flow that has a newer draft.** One more retrieve, for the name
  with the number the definition names, gives the file `[run 22]`. That was not built when this note was
  written. Record [0062](../../adr/0062-the-active-version-of-a-flow-is-fetched-by-its-number.md) builds it.
- **The cross-check cannot match every row of a flow by an id the org listed.** The rows of the latest version
  can be matched that way. The rows of another version carry an id the org did not list. Record 0045 allows a
  name only where there is no id, and the engine reads no object of the Tooling API but the one of the
  dependencies. How the cross-check treats flows is put to the maintainer with a design in work package 6 of the
  plan. From the moment flows are analysed, in work package 3, their rows are counted and not compared (record
  0060).
- **The answer key does not describe `Invoice_Recalculate` as the test org hands it out for its name.** It is
  about the file of the project, which is version 1. For the name alone the org hands out version 2, which reads
  one field more.
- **No tool takes the draft out.** A version of a flow is deleted by hand, in Setup under Flows. What a later
  run of "deploy" does to the two versions is `[unverified]`.

### After the fetch was built

Run 23 read the org with the engine of `main` once record 0062 was built, in the state the step "draft" left:
version 1 of `Invoice_Recalculate` active, version 2 a draft. All of the following is `[run 23]`.

- **The snapshot holds the active version.** After the last chunk it found one flow whose latest version is not
  active, and asked for the active version of it by its number. The file it holds for `Invoice_Recalculate` is
  the version that was sent as active, and the note `FLOW_NEWER_VERSION` is there once.
- The other five flows of the project came back in the state their files name: four active, and
  `Invoice_Purge_Void` a draft. The org holds 7 flows with 8 versions, so the draft is its only version.
- The snapshot is partial, with the error `NOT_RETRIEVED` for 6 components of the org of the types `CustomField`,
  `CustomObject` and `RecordType`. The fixture project is whole in it.
- The cross-check of the types of Phase 1 is as in run 21: of 57 pairs Salesforce reports, the analysis has 55,
  has 2 through a part of the object, and missed none.

## 5. The cross-check of the engine

In runs 19 and 21 the engine analyses the types of Phase 1 only, so it compares rows from a custom field or a
validation rule. Run 24 read the org with the reader of workflow rules (record
[0063](../../adr/0063-the-parts-of-a-file-of-workflow-rules.md)), so it compares the rows of the workflow rules as
well.

| | Run 19 | Run 21 | Run 24 |
| --- | --- | --- | --- |
| Rows of the org | 335 | 351 | 351 |
| Rows from a component of a type that is not analysed, or of a flow | 278 | 294 | 291 |
| Rows compared, which are as many pairs | 57 | 57 | 60 |
| The analysis has the pair | 55 | 55 | 58 |
| The analysis has it through a part of the object Salesforce names | 2 | 2 | 2 |
| Missed by the analysis | 0 | 0 | 0 |
| Rows with an end the org did not list | 0 | 0 | 0 |

- **The three rows of the workflow rules, from the formulas of field updates, are compared, and the analysis has
  all three** `[run 24]`. Of the pairs the analysis has and no row reports, it counts 18 with the reason
  `workflow-rule`, 7 with `workflow-action` and 4 with `field-update`. Those are the pairs of the key for these
  files that the API does not report (section 3): the 18 of the rules, the 7 of the alert, the outbound message
  and the task, and 5 of the field updates, of which one is to a standard field and counted as one.
- The rows from records of the custom metadata type and from the field set, 4 each, are still counted as not
  compared in run 24: their readers were built after it (record
  [0065](../../adr/0065-record-types-field-sets-and-records-of-custom-metadata.md)).

- The rows from a flow are not compared, so the 15 rows of a version the org did not list are not counted as
  rows with an end the org did not list `[run 21]`.
- Read once more with every answer cut off at 30 rows, the parts gave the same 335 rows as the one query, in 72
  requests, and the engine called the reading whole `[run 19]`.
- **After the draft the same reading lacked 30 rows, all from a flow to a custom field, and the engine called it
  partial** `[run 21]`. That is the reader as it is built (`sources/dependency-api.ts`): a part that is at the
  limit is asked for again per component, by the ids the org listed. If a row the cut-off answer gave comes from
  an id that is not among them, the reader takes the ids for the wrong ones, does not ask per id and counts the
  part as cut off. The row here is one of the active version of `Invoice_Recalculate`, whose id the org no
  longer lists. That this is the cause is my reading of the code and of the counts, not something the log says.
  Run 24 gave the same: the cut-off reading lacked 30 rows from a flow to a custom field, in 68 requests, and was
  partial `[run 24]`.
- What that means for a real org: the limit of Salesforce is 2,000 rows per query. An org whose flows give that
  many rows or more to one type of target, and that has one flow with an active version and a newer draft, can
  get a partial reading of the rows of its flows. It does when a row of the version the org does not list is
  among the rows the cut-off answer gives, and the query asks for no order, so that is not fixed. When none is,
  the reader asks per id and then once for the rows of every component that is not among the ids, which brings
  the rows of that version. An org that lists more than 200 flows gets a reading that is not whole for another
  reason, draft or not: that last query cannot name every id. The engine says what it could not read and
  compares what it has. That belongs to the design of the cross-check of flows.

## 6. The symbol tables

`[run 20]`. The 13 classes of the project all have a symbol table. The tables hold 0 places of use and 0
external references, as in Phase 0 and Phase 1. Nothing in them names a custom field. The decision that the
Dependency API alone is the cross-check for Apex stands.

## What was not measured

- Any other org, edition or API version.
- Why Salesforce refused the two flows, beyond the words it gave.
- A flow with more than two versions, one whose active version is the latest of several, one with versions
  that are obsolete, and one whose latest version is obsolete while an older one is active.
- A process of the Process Builder asked for by a number.
- Several flows asked for by their numbers in one retrieve, and a flow of a managed package asked for that way.
- What the file of a `FlowDefinition` says for a flow without an active version. The Tooling API says "none" for
  `Invoice_Purge_Void`, and no run printed its file.
- What the Salesforce library makes of a file named `Invoice_Recalculate-1.flow`. Record
  [0062](../../adr/0062-the-active-version-of-a-flow-is-fetched-by-its-number.md) tried it with a zip file
  written for the purpose, not with an org.
- What "deploy" does to a flow that has a draft.
- What the analysers of Phase 2 make of the files the test org hands out. The rows from a flow are counted and
  not compared (record [0060](../../adr/0060-the-active-version-of-a-flow-is-analysed.md)), and the reader of
  workflow rules was built after run 23. Run 24 read the org with it (section 5). The readers of record types,
  field sets and records of custom metadata types were built after run 24. The numbers of section 3 are the
  answer key against the Dependency API, not against OrgLens.
