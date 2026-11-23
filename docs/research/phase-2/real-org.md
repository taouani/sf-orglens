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
- The org lists and hands out all 118. No engine code was changed for the metadata types that are new in the
  project.
- The Dependency API reports 76 of the 149 pairs of the answer key that come from the files of Phase 2, and 206
  of all 343. From a flow to a custom field it reports 47 of 49. It reports nothing from a workflow rule, from a
  record type, from an email alert, from an outbound message or from a task, and nothing a record of a custom
  metadata type says in a value.
- **A row of the Dependency API from a flow carries the id of a version of the flow, not of the flow.**
- **When a flow has an active version and a newer draft, the org hands out the draft.** The plan of Phase 2 and
  decision record 0057 expected the active version. The Dependency API holds the rows of both versions, each
  under the id of its version, and the org lists the id of the latest one only. Which version OrgLens analyses is
  back with the maintainer, as the plan says, before the analyser of flows is built.
- The cross-check of the engine for the types of Phase 1 holds on the larger project: of 57 pairs Salesforce
  reports, the analysis has 55, has 2 through a part of the object, and missed none.
- Read in parts, the rows of flows are whole before the draft and partial after it: the reader of the engine
  does not ask per component once a row comes from a version the org did not list. It says so. The cross-check
  of flows has to be designed for it.
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

Run 16 is the login the workflow makes once a week by itself.

## 1. The deploys

A deploy is all or nothing, so the org was as before until run 19.

| Run | Counted | Without an error | Refused | New | Changed | As they were |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | 118 | 116 | `Invoice_Before_Save`, `Invoice_Review_Screen` | 27 | 11 | 78 |
| 18 | 118 | 117 | `Invoice_Before_Save` | 28 | 11 | 78 |
| 19 | 118 | 118 | none | 29 | 11 | 78 |

The last three columns count the components Salesforce found no error in. Each deploy ended in under a minute.

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
- The metadata types that are new in the project came back: `Flow` (7 listed, 7 retrieved, one of them not of the
  project), `FlowDefinition` (7), `Workflow` (3) with its parts `WorkflowRule` (4), `WorkflowFieldUpdate` (4),
  `WorkflowAlert` (1), `WorkflowOutboundMessage` (1) and `WorkflowTask` (1), `FieldSet` (1), `CustomMetadata`
  (4), and the record types and the email template of the project among those of the org.

What Salesforce rewrote in the files of Phase 2 `[run 19]`. The log names 80 of the 91 files that differ, in the
order of their folders, so what it did to the files of the workflow rules is not in it:

- **Every flow** got the element `areMetricsLoggedToDataCloud`. The flow that runs after the save got
  `nameSegment`, the process got `filterLogic`.
- **The screen flow** got `styleProperties` with a vertical alignment and a width for five fields of its screens.
  The file grew from 12,193 to 13,649 bytes. So the lines of a flow from an org are not the lines of the file
  that was deployed.
- **The three records of the custom metadata type** that leave a field out got a `values` element for each such
  field.
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

Of the 206, 195 are matched by the ids of both ends and 11 by a name, where the probe reads no id for the type:
an email template, a part of the workflow rules, a field set. All 11 are among the 76.

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
  actions it starts. Of a field update, the three custom fields its formula reads are reported. The field it
  writes is not, nor the relationship field that leads to the parent it writes on. Of an email alert, an outbound
  message and a task, nothing.
- **A record of a custom metadata type.** The type it is a record of is reported. Nothing else is: not the fields
  of the type it gives a value for, not a field or an object named through a relationship field, not a name in a
  text.
- **An email template.** The three custom fields of its merge fields, and not the standard ones.
- **A field set.** Its four custom fields, also the one across a relationship, and not the standard one.
- **A record type.** Nothing: not the picklist fields whose values it limits.

Pairs the API reports and the key does not hold: 21 `[run 20]`. Twenty are the 20 of Phase 1, from an Apex class
or trigger to a class or an object, and from a validation rule to the object of a field it reads. The new one is
from the email template to the object `Invoice__c`, whose fields its merge fields name. The key holds the fields
and not the object. Each of the 21 is a relation that exists, so no row between two components of the project is
wrong.

Of the 13 fields the key calls unreferenced, the API reports a reference to none `[run 20]`.

## 4. Flows and their versions

The probe reads two objects of the Tooling API that describe metadata, `FlowDefinition` and `Flow`. The org
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

### What follows

- **The expectation of decision record 0057 was wrong for a flow with a newer draft.** The record says that the
  version the org hands out is analysed, and its author expected that to be the active one. With a newer draft it
  is the draft, which does not run. The question is back with the maintainer. Nothing in the record is changed
  before the answer.
- **The active version can be asked for by its number**, with a name such as `Invoice_Recalculate-1`, as the
  reference of the Metadata API describes it. `[unverified]`: no run asked that way.
- **A snapshot can tell that it holds a draft of a flow that has an active version.** The file of the flow says
  `Draft`, and the file of its `FlowDefinition`, which the org hands out too, names the number of the active
  version. `[unverified]`: the run did not print that file.
- **The cross-check cannot match every row of a flow by an id the org listed.** The rows of the latest version
  can be matched that way. The rows of another version carry an id the org did not list. Record 0045 allows a
  name only where there is no id, and the engine reads no object of the Tooling API but the one of the
  dependencies. How the cross-check treats flows is designed with the analyser of flows, after the answer of the
  maintainer.
- **The answer key does not describe `Invoice_Recalculate` as the test org hands it out now.** It is about the
  file of the project, which is version 1. The org hands out version 2, which reads one field more.
- **No tool takes the draft out.** A version of a flow is deleted by hand, in Setup under Flows. What a later
  run of "deploy" does to the two versions is `[unverified]`.

## 5. The cross-check of the engine

The engine analyses the types of Phase 1 only, so it compares rows from a custom field or a validation rule.

| | Run 19 | Run 21 |
| --- | --- | --- |
| Rows of the org | 335 | 351 |
| Rows from a component of a type that is not analysed | 278 | 294 |
| Rows compared, which are as many pairs | 57 | 57 |
| The analysis has the pair | 55 | 55 |
| The analysis has it through a part of the object Salesforce names | 2 | 2 |
| Missed by the analysis | 0 | 0 |
| Rows with an end the org did not list | 0 | 0 |

- The rows from a flow are not compared, so the 15 rows of a version the org did not list are not counted as
  rows with an end the org did not list `[run 21]`.
- Read once more with every answer cut off at 30 rows, the parts gave the same 335 rows as the one query, in 72
  requests, and the engine called the reading whole `[run 19]`.
- **After the draft the same reading lacked 30 rows, all from a flow to a custom field, and the engine called it
  partial** `[run 21]`. That is the reader as it is built (`sources/dependency-api.ts`): a part that is at the
  limit is asked for again per component, by the ids the org listed. If a row of the part comes from an id that
  is not among them, asking per id would leave its rows out without a trace, so the reader does not ask and
  counts the part as cut off. The row here is one of the active version of `Invoice_Recalculate`, whose id the
  org no longer lists. That this is the cause is my reading of the code and of the counts, not something the log
  says.
- What that means for a real org: the limit of Salesforce is 2,000 rows per query. An org whose flows give more
  rows than that to one type of target, and that has one flow with an active version and a newer draft, gets a
  partial reading of the rows of its flows. The engine says so and compares what it has. To read them whole it
  needs the ids of the versions, or another way to split. That belongs to the design of the cross-check of
  flows.

## 6. The symbol tables

`[run 20]`. The 13 classes of the project all have a symbol table. The tables hold 0 places of use and 0
external references, as in Phase 0 and Phase 1. Nothing in them names a custom field. The decision that the
Dependency API alone is the cross-check for Apex stands.

## What was not measured

- Any other org, edition or API version.
- Why Salesforce refused the two flows, beyond the words it gave.
- A retrieve of a flow by a version number, and the file of a `FlowDefinition`.
- A flow with more than two versions, and one whose active version is newer than a draft.
- What "deploy" does to a flow that has a draft.
- The analysis of the files of Phase 2: no analyser reads them yet. The numbers of section 3 are the answer key
  against the Dependency API, not against OrgLens.
