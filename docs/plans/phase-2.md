# Phase 2 plan: Flows and configuration

Status: **approved** on 22 November 2026. The maintainer answered the six questions of section 4 and said to start
building. The answers are written in below section 4, and four of them have decision records (0055 to 0058). The
plan was written for the recommended answers, which are the ones the maintainer gave, so its work packages stand
as they were drafted, with one exception: when a person reads the ten entries of the key (work package 1, and the
first reading below the answers). Nothing of it is built yet.
Date: 2026-11-17, with the answers and the approval written in on 2026-11-22
Parent document: [OrgLens re-architecture plan](re-architecture-plan.md)
Before it: [Phase 1 plan](phase-1.md), [Phase 1 report](../reports/phase-1.md)

This plan is written by the AI assistant that builds the project, addressed to the maintainer. "I" is the
assistant and "you" is the maintainer.

## 1. Outcome

At the end of Phase 2, an impact answer for a field or an object holds the declarative automation of an org,
not only its formulas:

1. `orglens snapshot` analyses flows. Every element of a flow is a component of its own, with a key, so an
   answer names the element and not only the flow. An element that reads, filters by or writes a field gets a
   reference of the kind `reads` or `writes`, with the line it stands on.
2. It analyses workflow rules and their actions, record types, field sets, and custom metadata types with
   their records.
3. `orglens impact Account.Industry` then says which formula fields and validation rules read the field, as
   today, and which flow elements, field updates and workflow rules read or write it, which field sets show it,
   and which custom metadata records name it.
4. The cross-check with the Dependency API covers the new types, as far as Salesforce reports them. How far
   that is, is measured in the first work package.
5. Every answer still says what it does not cover. After this phase that is Apex, Lightning components,
   permissions and everything of the presentation tier.
6. The results are proven in the ways of section 6.

Phase 2 does **not** analyse Apex. A flow that calls an Apex action gets a reference to the class, and the
class is a component that is named and not analysed, as a custom label is today.

## 2. What Phase 1 and the preparation of this plan found

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Consequence                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Public codebases hold few flows, and almost nothing else of this phase.** I counted on 17 November 2026. The four pinned codebases hold 13 flows: Nebula Logger 10, PMM 2, Apex Recipes 1, NPSP none. Two more that I looked at hold 11: `coral-cloud` 10 and `dreamhouse-lwc` 1. Of the 24, three are processes of the Process Builder, one is triggered by a record, one by a schedule and one by a platform event. None calls a subflow. One file of workflow rules exists, in NPSP. No pinned codebase holds a record type. EDA holds 8. The counts of the two codebases and of EDA are from clones that are not pinned, and cannot be repeated from the repository. | As in Phase 1, the public codebases cannot carry the proof. The fixture project carries the hard cases, the test org says whether Salesforce accepts them, and an org of yours carries the scale. |
| 2   | **What the Dependency API reports for a flow was never measured.** The fixture project has no flow. On the test org, 201 of its 257 rows are from types Phase 1 does not analyse, 94 of them from Apex. The overall plan lists flows under the open question about the scope of the API.                                                                                                                                                                                                                                                                                                                                                                                   | The first work package deploys flows to the test org and asks. Pass mark 3 of this phase can only be as wide as what that shows.                                                                  |
| 3   | **Which version of a flow an org hands out is not verified.** An org keeps every version of a flow. As far as I know, a retrieve by name gives the active version, and the latest one when none is active. I did not see it on an org.                                                                                                                                                                                                                                                                                                                                                                                                                                     | Measured in the first work package, with a flow that has an active version and a newer draft. Question Q3.                                                                                        |
| 4   | **The code that turns the names of a formula into references is inside the analyser of objects** (`extraction/objects.ts`). Flows and workflow rules hold formulas too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | It moves out first, without a change of what it does. The tests of Phase 1 hold it.                                                                                                               |
| 5   | **A flow writes names in three ways**: as the value of an element (`<field>Status__c</field>` beside `<object>Invoice__c</object>`), as a reference to a resource (`Get_Invoice.Account__r.Name`), and as a merge field in text (`{!$Record.Amount__c}`). The second and third need to know what kind of record a resource holds.                                                                                                                                                                                                                                                                                                                                          | A model of the resources of a flow, as Phase 1 has a model of objects. Where the kind of a resource is not known, the path is not followed and is counted.                                        |
| 6   | **Salesforce refused the validation rule with `$RecordType`** in Phase 1, most likely because the object has no record type. The fixture project has no record type, no field set and one record of a custom metadata type.                                                                                                                                                                                                                                                                                                                                                                                                                                                | The fixture gets them in the first work package.                                                                                                                                                  |
| 7   | **The logic tier names `Workflow` and `WorkflowRule` and not the actions of a rule.** A field update writes a field. Record 0046 lists the 21 names as a choice of mine, and the overall plan says that it is not decided whether a type counts for "complete" once it has an analyser.                                                                                                                                                                                                                                                                                                                                                                                    | Question Q4.                                                                                                                                                                                      |
| 8   | **An impact answer lists every type that is not analysed, whatever the component is.** On a snapshot of PMM that is 35 types, also for a field nothing refers to. Phase 2 takes five types off that list. Nothing says yet which type can refer to which.                                                                                                                                                                                                                                                                                                                                                                                                                  | Work package 6 narrows the list where it can be shown, as a choice of mine that you can strike.                                                                                                   |
| 9   | **Phase 1 was not run on an org you know.** Part H of its test plan is that run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | What it shows comes first. A defect of Phase 1 is corrected before the analysers of this phase are built on it.                                                                                   |

Two smaller ones:

- The key of an element exists since Phase 0: `Flow:Invoice_After_Save#element:Update_Account`. No snapshot
  holds such a key yet, and `orglens impact` finds one only in its exact spelling.
- The origin `parser:flow` is in the reference vocabulary since Phase 0, and so is the kind `triggers-on`.

## 3. Scope

### In scope

| Work package                                  | Summary                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WP1 Fixture v2 and its key                    | Flows, workflow rules, record types, a field set and custom metadata records, keyed before any analyser and deployed to the test org. What Salesforce reports and hands out for them |
| WP2 Names in text                             | The formula references as code of their own, and a reader for merge fields                                                                                                           |
| WP3 Flows                                     | Flows and their elements as components, the model of resources, and the references                                                                                                   |
| WP4 Workflow rules                            | Rules, field updates, alerts, outbound messages and tasks                                                                                                                            |
| WP5 Record types, field sets, custom metadata | Their references, and the names a custom metadata record holds                                                                                                                       |
| WP6 The answers                               | `impact` and `coverage` with elements and the new types, the cross-check for them, and what an answer does not cover                                                                 |
| WP7 Managed packages (Q2)                     | What of a package is read, analysed and shown                                                                                                                                        |
| WP8 What Q1 adds                              | Email templates, report types and quick actions                                                                                                                                      |
| WP9 Proof                                     | Every flow of the public codebases checked by hand, and the measurements                                                                                                             |
| WP10 Phase close                              | Updated overall plan, test plan, phase report, the next pre-release, draft of the Phase 3 plan                                                                                       |

### Deliberately not in Phase 2

- Apex, Lightning components and Visualforce (Phase 3). A flow that calls an Apex action, or a screen that
  shows a component, gets a reference to it by name.
- Comparison of snapshots, change sets, permissions and incremental refresh (Phase 4). Which profile may use a
  record type is a grant, and belongs there.
- Rules about a specific change. Phase 2 answers by reachability, as Phase 1 does.
- Approval processes, assignment, escalation and auto-response rules, sharing rules, duplicate and matching
  rules. Each can name a field. None is in the logic tier, and the roadmap has them in no phase. I name them
  here so that their absence is a decision and not an oversight. An answer names them as not analysed.
- Layouts, list views, Lightning pages, dashboards and the rest of the presentation tier, and reports: by your
  answer to Q1 they stay in Phase 6.
- Running a flow, or saying in which order the automation of an object runs. That is the first rider, after
  the gate.
- The language model, the web UI, and any rider.

## 4. Questions for you

Six questions. Each has my recommendation. The plan below is written for the recommended answers, and says
where another answer changes it. Your answers get decision records, as those of the Phase 1 plan did. An answer
to Q1 or Q2 that moves a type into a phase, or changes what a snapshot reads, also changes the roadmap of the
overall plan, in the pull request that records it.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                       | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Recommendation                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | **Where are email templates, report types, reports and quick actions analysed?** With your approval of the Phase 1 plan you named email templates, report types and reports among what OrgLens should cover. A snapshot reads them. No phase analyses report types, and the roadmap has email templates and reports in Phase 6, after the gate. Quick actions hold formulas that Phase 1 left out: 11 in the public codebases. | (a) Email templates, report types and quick actions join Phase 2, as work package 8, about 3 days. Reports stay where they are. (b) Reports join too. A report names fields in the words of its report type, so it needs the report types first. About 3 days more, and an org can hold tens of thousands of reports, which nothing has measured. (c) None of them now. Phase 2 stays as the roadmap has it.                                                                                                                                                                                                                                                                                                                                   | (a). The three are small and name fields plainly. For reports I would first see the time of a snapshot with them on an org of yours.                               |
| Q2  | **How are managed packages left out?** You noted that the goal is all metadata except what comes from managed packages. Today a snapshot reads the components of a package and analyses them like any other. Their code is hidden, their fields and objects are not.                                                                                                                                                           | (a) Read and keep them, mark each component with its package, and leave them out of an answer as the thing that refers. A field of a package stays a target: "what of mine refers to this field of the package" keeps working. An option of `impact` shows them. (b) Do not retrieve them at all. A snapshot is faster and smaller, by an amount nobody measured. A reference of yours into a package then names something the snapshot does not hold. (c) Leave it as it is until Phase 4.                                                                                                                                                                                                                                                    | (a). It loses nothing and can be undone by an option. (b) is the one that can help with your 60 minutes, and I would decide it with a number from an org of yours. |
| Q3  | **Which version of a flow is analysed?** An org keeps every version.                                                                                                                                                                                                                                                                                                                                                           | (a) The one the org hands out for the flow, which I expect to be the active version, or the latest when none is active. A reference from a flow that is not active says so, as one from an inactive validation rule does. (b) Every version, read through the Tooling API. More requests, and several components for one flow.                                                                                                                                                                                                                                                                                                                                                                                                                 | (a). The active version is what runs. Work package 1 measures what the org hands out, and I come back to you if it is not what I expect.                           |
| Q4  | **Does a type count for "complete" once it is analysed?** Today a snapshot is complete when everything of the 21 types of the logic tier came back. The actions of a workflow rule are not among them, and neither are the types of Q1. If something of an analysed type is missing, an answer can miss a reference without the snapshot saying `partial`.                                                                     | (a) Yes: every type that has an analyser joins the list. (b) No: the list stays, and an impact answer says for itself that an analysed type is not whole, which it does today (`mayMiss`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | (a). An answer that may miss something should come from a snapshot that says so. The cost: more orgs with a snapshot that is `partial`.                            |
| Q5  | **Pass marks for this phase.**                                                                                                                                                                                                                                                                                                                                                                                                 | Proposed: (1) every entry of the new answer key for flows, workflow rules, record types, field sets and custom metadata records that is not marked as stretch is found, nothing is reported that the key does not hold, no negative case is hit, and the marks of Phase 1 still hold. (2) Every flow and every file of workflow rules of the public codebases is read without an error. (3) On the test org, no pair that the Dependency API reports from a flow or a workflow rule is missing, for the kinds work package 1 shows that it reports. (4) Every flow of the pinned public codebases is checked by hand: no reference at the tier `confirmed` is wrong, and every reference that was missed is corrected or named with its cause. | Accept as proposed. If a mark is missed, the phase reports the gap and we decide together, as in Phase 1.                                                          |
| Q6  | **Who is the second reader?** In Phase 1 I made the check by hand, and the agent that reviewed the pull request repeated it. No person read an entry, and your reading of ten entries of the key is still open.                                                                                                                                                                                                                | (a) You read ten entries of the new key and five flows of the check by hand, in the test plan. About 40 minutes. (b) A colleague of yours does. (c) Nobody until the gate: the review agent stays the second reader, and the reports say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | (a) or (b). A flow is where I am most likely to misread what Salesforce does, because I can deploy one and cannot run one.                                         |

### Your answers, 22 November 2026

You answered all six in one message and said to start building.

| #   | Your answer                  | What it means                                                                                                                                                                                 | Where it is recorded                                                                    |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Q1  | (a)                          | Email templates, report types and quick actions join Phase 2, as work package 8. Reports stay where the roadmap has them.                                                                     | Record [0055](../adr/0055-email-templates-report-types-and-quick-actions-in-phase-2.md) |
| Q2  | (a)                          | The components of a managed package are read and kept, each marked with its package, and left out of an answer as the thing that refers. They stay targets. An option of `impact` shows them. | Record [0056](../adr/0056-components-of-a-managed-package.md)                           |
| Q3  | (a)                          | The version of a flow that the org hands out is analysed. Work package 1 measures which one that is.                                                                                          | Record [0057](../adr/0057-the-version-of-a-flow-that-is-analysed.md)                    |
| Q4  | (a)                          | Every type that has an analyser counts for "complete".                                                                                                                                        | Record [0058](../adr/0058-a-type-counts-for-complete-once-it-is-analysed.md)            |
| Q5  | "ok for your recommendation" | The four pass marks as proposed. If one is missed, the phase reports the gap and we decide together.                                                                                          | Here                                                                                    |
| Q6  | (a)                          | You read ten entries of the new key and five flows of the check by hand, in the test plan.                                                                                                    | Here                                                                                    |

**Q3 changed on 23 November 2026.** Work package 1 measured that an org hands out the draft of a flow that has
an active version and a newer draft. You were asked again and chose: the active version is analysed, and a newer
draft is reported as present and not analysed. Record
[0057](../adr/0057-the-version-of-a-flow-that-is-analysed.md) holds the answer until a record of its own replaces
it, with what the test org says about asking for a version by its number.

Two things I read into the answers, for you to strike:

- **Q6 and work package 1.** Answer (a) puts your reading in the test plan, at the end of the phase. Work package
  1 and section 10 of this plan asked for the ten entries when the pull request of the key is up. I take the
  answer: the pull request of the key is merged on the review of the agent, and I tell you when the key is up, so
  that you can read the ten entries then if you want to. What this gives up: no person reads the key before the
  analysers are built against it. That order is the reason record 0021 gives for writing the key first, so that
  it is not shaped by what an analyser happens to find. The review of the agent is then the only reading before
  the analysers, as it was in Phase 1. Until a person has read the entries, the reports say that none has.
- **Phase 1 is not accepted yet.** You said to start, and the test plan of Phase 1 is not run as far as I know.
  Work package 1 does not rest on it. Work package 2 moves the code of Phase 1 that reads the names of a formula
  and does not change what it does: a defect that part H shows in it is corrected in the moved code. The plan
  asks for part H before work package 3, the analyser of flows, is built (finding 9, and the last risk of section
  8). Work package 3 does not wait for it by itself. When work package 2 is merged and part H is not run, I ask
  you once whether work package 3 waits, and I build on until you answer. A defect that part H shows after that
  is corrected before anything else is built.

One number of Q1 was too low. The question says that the public codebases hold 11 formulas in quick actions.
That is PMM alone. The package folders of the pinned codebases hold 16: 11 in PMM and 5 in NPSP
([note of Phase 1](../research/phase-1/public-codebases.md)). The question is left as you answered it, and
record 0055 has the number that is right.

## 5. Work packages

Each package lists what is built and how it is accepted. "CI" means the checks run on Linux, macOS and Windows.
What I say here about the format of flows and workflow rules is from the documentation of the Metadata API and
from the files of the public codebases. Where the test org can confirm it, work package 1 asks.

### WP1 Fixture v2 and its key

The key is written before the analysers it scores, and is reviewed before they exist (records 0021 and 0029).

Build:

- Flows in `fixtures/billing-sfdx`, each for hard cases:
  - a flow that runs before a record is saved and assigns fields of `$Record`,
  - a flow that runs after a save, with a condition on `$Record__Prior`, a lookup of other records with a
    filter and a sort field, an update of related records, and a scheduled path on a date field,
  - a screen flow with input fields bound to a record variable, a choice set that reads records, display text
    with merge fields, and a text template,
  - an autolaunched flow that is called as a subflow, with variables for input and output, a loop over a
    collection, a formula resource, and a decision with several outcomes,
  - an action that calls an invocable method of a class of the fixture, an action that sends an email alert of
    a workflow, and a custom error,
  - a path through two relationships from a resource, a path through a relationship of a standard object, and
    a path from a resource whose kind is not known,
  - `$Label`, `$Setup`, `$Permission`, `$Profile`, `$User`, `$Organization`, `$Api` and `$Flow` in a formula
    and in a condition,
  - a flow with an active version and a newer draft, and a flow that is not active,
  - one process of the Process Builder, if Salesforce still accepts the deploy of one.
- A file of workflow rules for `Invoice__c`: a rule with criteria, a rule with a formula, a rule that is not
  active, a field update with a formula, one with a literal value, one that writes a field of the parent
  record, an email alert whose recipient is a field, an outbound message with a list of fields, and a
  time trigger.
- Two record types of `Invoice__c`, with the picklist values each allows. The validation rule with
  `$RecordType` that Salesforce refused in Phase 1 comes back. A business process is not in the fixture: only
  a few standard objects have one, and the fixture customises none of them. A test with a file written for it
  covers that reference.
- A field set of `Invoice__c` with a field of the object and a field through a relationship.
- Three more records of the custom metadata type, and two more fields on it: one that names a field through a
  relationship to the definition of a field, and a text field that holds the name of a field as text.
- The entries of all of these in `fixtures/expected/answer-key.v2.yaml`, with negatives: a name in a label, in
  a description, in the text of a custom error that is no merge field, and in a literal value. `answer-key.v1.yaml`
  stays as the key Phase 1 was scored with.
- A folder beside the project for what cannot be deployed: a flow that names a field that does not exist, an
  element of a kind that does not exist, a flow whose XML is cut off.
- A deploy of the new fixture to the test org, and one run of the workflow "Live org" that reads it and asks
  the Dependency API.

Accepted when:

- Salesforce accepts the deploy. What it refuses is corrected by reading, as in Phase 1, and the report says
  which and why, as far as the log says.
- `fixture-key.test.ts` passes with the new key, and still with the old ones.
- The run is recorded in a note: which of the new pairs the Dependency API reports, by kind. Which id a row
  from a flow carries, and whether it is an id the org listed. Which version of a flow the org hands out, and
  what it hands out for the flow with a draft.
- The pull request with the fixture and the key is merged before the pull request of WP3 is opened.

Not a condition of this package: your reading of ten entries of the new key against their files. By your answer
to Q6 it is in the test plan of the phase. I tell you when the key is up.

### WP2 Names in text

Build:

- The code that turns the names of a formula into references moves out of `extraction/objects.ts`, so that a
  flow and a workflow rule can use it. What it gives for a field or a rule does not change.
- A reader for merge fields: `{!Resource.Path}` in a text, with what stands between two of them left alone.
- The formula language as a flow writes it: merge fields where a field formula has names.
- A function that resolves a path from a known object, shared by formulas, flows, field sets and custom
  metadata records. It exists in Phase 1 for formulas (`walkPath`).

Accepted when:

- No golden file and no test of Phase 1 changes, and the digests of the four listings of the public codebases
  are the ones the test of work package 10 of Phase 1 holds.
- The formula probes of Phase 1 pass, and new probes for merge fields: a merge field at the start and the end
  of a text, two in a row, one that is not closed, a brace that is no merge field.

### WP3 Flows

Build:

- **Components.** A flow is a component. Each element and each resource of it is a component below it, with
  the key `Flow:<name>#element:<name of the element>` and an attribute for its kind: a decision, an assignment,
  a lookup, a create, an update or a delete of records, a screen, a loop, an action, a subflow, a wait, a
  custom error, a variable, a constant, a formula, a text template, a choice. The start of a flow is an element
  with a fixed name.
- **The model of resources.** For each resource that holds a record or a list of records, the object it is of:
  `$Record` and `$Record__Prior` from the object of the start, a variable from its declared object, a lookup
  from the object it reads, a loop from the list it goes over. An output of an Apex action or of a subflow has
  no known object in this phase.
- **References.**
  - The object of a start that is triggered by a record: `triggers-on`.
  - A field in a filter, a sort, a list of fields to read, or on the right of an assignment: `reads`.
  - A field that a create or an update of records sets, and a field of a record resource that an assignment
    sets: `writes`. For a flow that runs before the save, the assignment to `$Record` is the write.
  - The object of a lookup, a create, an update or a delete: `references`, with what the element does to it as
    an attribute.
  - A merge field in a formula, a condition, a text template or the text of a screen: `reads`, through the
    model of resources and the paths of work package 2.
  - A subflow: `calls` to the flow. An Apex action: `calls` to the class, which is not analysed. An email
    alert: `references` to the alert of work package 4.
  - `$Label`, `$Setup`, `$Permission` and the other global variables, as in a formula.
  - A value that is compared with `RecordType.DeveloperName` and is the name of a record type of that object:
    a reference to the record type at the tier `probable`. It is a name in text.
- **What is not known says so.** A path from a resource without a known object is not followed, and is counted
  like a path a formula could not follow. An element of a kind the reader does not know gives a warning, and
  the merge fields and field names in it are still read, at the tier `probable`. A flow whose XML cannot be
  read is an error of the analysis, as for any file.
- A reference from a flow that is not active carries that, as one from an inactive validation rule does.

Accepted when:

- The analysis finds every entry of the key for flows that is not marked as stretch, at the line the key says,
  and no other. No negative case is hit.
- A snapshot of the fixture folder and one of the mock org give the same components and references for flows.
- Every flow of the public codebases is read without an error. The number of elements of a kind the reader does
  not know, of paths not followed and of names not resolved is reported per codebase.
- The three processes of the Process Builder in the public codebases are read as flows. What of them is not
  found is named.

### WP4 Workflow rules

Build:

- The rules, field updates, alerts, outbound messages and tasks of a file of workflow rules as components,
  each under the name Salesforce gives it (`WorkflowRule:Invoice__c.Mark_Overdue`). An org lists them as types
  of their own.
- References: the fields in the criteria of a rule and the names in its formula (`reads`), the actions of a
  rule and of its time triggers (`references`), the field a field update sets (`writes`, on the object or on
  the parent it names), the names in its formula (`reads`), the fields an outbound message sends and the field
  that is the recipient of an alert (`reads`), and the email template of an alert (`references`, to a component
  that is named and not analysed until work package 8).
- A rule that is not active carries that on its references.
- A file of workflow rules is a component with the name of its object (`Workflow:Invoice__c`). Since the
  fixture of work package 1 has such files, `orglens impact Invoice__c` ends with `COMPONENT_AMBIGUOUS` there, as
  it does on every org with workflow rules, and a test pins that. This work package decides what the bare name
  of an object means, and the pull request says what was chosen. If the choice changes what a command answers
  for a name, it is a change to a public contract and comes to you first.

Accepted when:

- The analysis finds every entry of the key for workflow rules, and no other.
- The one file of the public codebases is read without an error, and its references are listed in the note of
  work package 9.

### WP5 Record types, field sets, custom metadata

Build:

- **Record types.** The picklist fields a record type names, with the values it allows as an attribute, and
  its business process: `references`.
- **Field sets.** Each field, also through a relationship: `reads`.
- **Custom metadata records.** A record refers to its type and to each field it gives a value (`references`).
  A value in a field that is a relationship to the definition of an object or of a field is a reference to
  that object or field, at the tier `confirmed`. The value of a relationship to the definition of a field is
  the name of the field alone: its object is the value the same record gives the controlling field of the
  relationship, which the file of the field names. A value in a text field that is exactly the name of a field
  of an object the same record names, or exactly `Object.Field`, is a reference at the tier `probable`: this
  is the second step of the sequence of decision D7. A text that only holds such a name among other words is
  no reference.
- The row of the Dependency API from a record to its type is compared from this phase on, as you decided on
  16 November 2026.

Accepted when:

- The analysis finds every entry of the key for the three, and no other. The negatives for text in a record
  are not hit.
- The 335 records of custom metadata types in the four public codebases are read without an error. How many
  references at the tier `probable` they give, and three of them read by hand per codebase, are in the note.

### WP6 The answers

Build:

- `orglens impact` shows an element of a flow as a result, with the flow it is of. An answer for a flow is
  about its elements too, as an answer for an object is about its fields.
- A name finds an element without its exact key: `Invoice_After_Save.Update_Account`.
- `coverage` counts the new types as analysed, and the new origin `parser:flow`.
- The cross-check compares the rows of the types this phase analyses, as far as work package 1 shows that the
  ids of the rows are ids the org listed.
- The types of this phase join the judgement of "complete" (Q4, record 0058). The list in `docs/cli.md` and the
  record that replaces the list of record 0046 follow.
- **A choice of mine, for you to strike:** the list of types an answer does not cover is narrowed. A type is
  taken off it for a question only where its files cannot name the component asked about: a custom label
  cannot name a field. The table that says so is in one file, with the source of each line, and a type that is
  not in the table stays on the list.
- The JSON Schema and `docs/cli.md`, in the same pull request. Fields are added, none is removed.

Accepted when:

- Golden files for six new questions: a field a flow writes, a field a flow reads through a relationship, a
  field a field update writes, a record type, a flow, and an element.
- The test that works out the answer of every component from the key alone passes with the new key.
- Against the mock org, a pair that is taken out of a flow on purpose is the error `REFERENCE_MISSED`.
- The impact times of the synthetic org are measured again with the tables as they then are.

### WP7 Managed packages (Q2)

Written for answer (a), which you gave (record 0056).

Build:

- A component knows the namespace it is of, from what the org lists and from the prefix of its name, and
  whether that namespace is the org's own.
- `impact` leaves out results that are components of a package, counts them in a line, and shows them with an
  option. A component of a package stays a target.
- `coverage` shows per type how many components are of a package.

Accepted when:

- Against the mock org with a package, an answer names what was left out, and the option brings it back.
- A repository of a package project, such as NPSP, is not treated as a package: its components are its own.

With answer (b) this package would have been a key of `orglens.toml` that leaves a namespace out of a snapshot,
like the key that leaves a type out, after a measurement on an org of yours.

### WP8 What Q1 adds

Written for answer (a), which you gave (record 0055).

Build:

- **Email templates**: the merge fields of the subject and the body, in the forms of the classic and the
  Lightning templates, as `reads` from the template. A field of the recipient or of the organisation is
  resolved, a field of "the related record" only where the template says which object that is.
- **Report types**: the objects it joins and the fields it lists: `references`.
- **Quick actions**: the names in the formula of a predefined value (`reads`), and the field it sets
  (`writes`).

Accepted when:

- The key has entries for one of each, and the analysis finds them and no other.
- The 31 email templates, 4 report types and 51 quick actions of the public codebases I counted are read
  without an error. The counts are of the pinned codebases, of Volunteers for Salesforce and of Outbound
  Funds. The last two are not pinned yet: this work package pins them by commit in `fixtures/corpora.toml`
  after a look at their licences, and the counts are taken again at those commits.

### WP9 Proof on public codebases, and measurements

Build:

- `coral-cloud` joins `fixtures/corpora.toml`, pinned by commit, for its ten flows. Its licence is CC0. EDA
  joins for its record types if its licence, which I have not read to the end, allows it.
- The listing of Phase 1 (`pnpm run corpora:listing`) gets the entries of this phase: every flow with its
  elements, every workflow rule and action, every record type and field set, each with the references and the
  issues OrgLens reports.
- The check by hand of every flow of the pinned codebases, and of the one file of workflow rules. A test holds
  what was checked by its digest, as in Phase 1.
- The times of the commands on the codebases, and a made-up source at the size of your targets with flows in
  it.

Accepted when:

- A note states the counts, names each wrong and each missed reference, and says what was done.
- Pass mark 4 of Q5 holds.

### WP10 Phase close

- The overall plan updated, `docs/test-plans/phase-2.md`, a phase report, and the draft of the Phase 3 plan for
  your approval.
- The next pre-release, made by the workflow of records 0050 and 0053, under the next number that is free then.
  That is `0.1.0-next.2`, unless another one is made before it: `0.1.0-next.1` is a version without a change,
  which was published on 17 November 2026 to try trusted publishing (record 0054). It went through, so nothing
  should have to be set up on npm for this one: by the page of npm the first publish validates a publisher, and
  nobody has looked yet whether the two still show "Pending validation" (`docs/releases/publishing.md`).

Accepted when:

- The four documents are merged, and the report says for every acceptance criterion of this plan whether it is
  met.
- The pre-release is published on your word, or the report says what it waits for.

## 6. How the results are proven

| Proof                                              | What it shows                                                                           | Its weakness                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| The answer key of the fixture, v2                  | Every hard case I could think of is handled, and no negative case is hit                | I wrote the fixture, the key and the analyser                                |
| The deploy of the fixture to the test org          | Every flow, rule and record type of the fixture is valid Salesforce                     | Says nothing about what OrgLens finds. A flow is deployed and never run      |
| The Dependency API on the test org                 | For what it reports of flows and workflow rules, whether Salesforce agrees pair by pair | How much it reports is not known before work package 1. The fixture is small |
| Every flow of the public codebases                 | Code I did not write, checked one by one                                                | About 23 flows, 3 of them of the Process Builder. Checked by me              |
| The Dependency API on an org of yours              | Scale: flows that neither of us wrote                                                   | Only you see the result                                                      |
| Entries of the key and flows read by a person (Q6) | A second person                                                                         | Ten entries and five flows                                                   |

## 7. Pull requests and review

About ten pull requests, each from its own branch, each with a code review by a separate agent, merged when CI
is green on the three systems and every finding is resolved. Phase 1 planned twelve and needed more than
twenty: a run of the test org and a review each brought pull requests of their own. I expect the same here.

## 8. Risks in this phase

| Risk                                                                                                                                | Handling                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The format of a flow is large, and Salesforce adds kinds of elements with every release.                                            | An element of a kind the reader does not know is a warning and is counted, and its names are still read as `probable`. Nothing is dropped without a word.                                                                                      |
| I can deploy a flow and cannot run one. What an element does at run time is my reading of the documentation.                        | The key marks every entry that rests on such a reading. Q6 asks for a person. The Dependency API is the second opinion where it reports.                                                                                                       |
| The kind of record a resource holds is not always known: outputs of Apex actions and of subflows.                                   | Such a path is not followed and is counted. The count on the public codebases and on an org of yours says whether more is needed.                                                                                                              |
| The ids of the rows the Dependency API has for a flow may be ids of versions, which the org does not list.                          | Measured in work package 1. If so, the rows of flows cannot be compared by id, and record 0045 allows a name only where there is no id. I then put the choice to you.                                                                          |
| The public codebases cannot carry the proof (finding 1).                                                                            | The fixture, the test org, and an org of yours in the test plan.                                                                                                                                                                               |
| A file of workflow rules can hold the user name of a person, as the user an outbound message runs as or as a recipient of an alert. | It is in the snapshot, on the machine of the user, as every file is. No reference is made of it, and the public log of the workflow "Live org" prints no name that is not of the fixture project (record 0033). The fixture uses no user name. |
| Phase 2 grows. Approval processes and sharing rules are close, and an org of yours will show ten things.                            | The list "not in Phase 2" is the boundary. What an org shows goes to the Phase 3 plan unless it breaks an outcome of this one.                                                                                                                 |
| Phase 1 has not been run on an org you know (finding 9).                                                                            | Work package 1 can start without it. I ask for part H of the Phase 1 test plan before work package 3 is built.                                                                                                                                 |

## 9. Effort

The roadmap estimated Phase 2 at 3 to 4 weeks. This plan is about 5. Three things account for the difference:
managed packages, which no phase of the roadmap held, the types of Q1, and the elements of a flow as
components of their own. Without work packages 7 and 8 it is about 4.

| Work package                                  | Rough effort      |
| --------------------------------------------- | ----------------- |
| WP1 Fixture v2 and its key                    | 3 days            |
| WP2 Names in text                             | 2 days            |
| WP3 Flows                                     | 6 days            |
| WP4 Workflow rules                            | 2 days            |
| WP5 Record types, field sets, custom metadata | 3 days            |
| WP6 The answers                               | 2 days            |
| WP7 Managed packages                          | 2 days            |
| WP8 What Q1 adds                              | 3 days            |
| WP9 Proof                                     | 2 days            |
| WP10 Phase close                              | 1.5 days          |
| **Total**                                     | **about 27 days** |

These are developer-days as the overall plan counts them. Phase 1 was estimated at 33 and was built in three
calendar days. Elapsed time depends on how fast you can answer, review the key and run the test plans.

## 10. What you will be asked to do

1. Answer Q1 to Q6 and approve this plan, or change it. Done on 22 November 2026.
2. Run the test plan of Phase 1, at least its part H, before work package 3 is built.
3. Read ten entries of the new answer key against their files and five flows of the check by hand, in the test
   plan (Q6). About 40 minutes. I tell you when the key is up, in case you want to read the entries earlier.
4. Review the pull requests you want to look at. Merging is done by the assistant under the rule of Phase 0.
5. At the end, run the Phase 2 test plan. Its main step is `orglens impact` on an org you know, for fields
   whose flows you know. If that org is a client's, the client's permission comes first, and nothing of it goes
   into an issue or a chat.
