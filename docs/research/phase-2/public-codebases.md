# public-codebases

What the analysis of Phase 2 reports for the flows, the workflow rules and their actions, the record types, the
field sets and the records of custom metadata types of the public codebases of `fixtures/corpora.toml`, held
against their files, and how long the commands take on them. Recorded on 25 November 2026 (work package 9 of the
[Phase 2 plan](../../plans/phase-2.md)), with the code of the pull request that holds this note and the codebases
at the commits the manifest pins. The note of Phase 1 ([public-codebases.md](../phase-1/public-codebases.md)) did
the same for formulas, rules and lookups. Its digests did not move, so its check still holds and is not repeated.

## In short

- **Every flow of the codebases was read by hand, element by element, with its references**: 23 flows, 3 of them
  processes of the Process Builder, with 151 elements, in Apex Recipes, Nebula Logger, PMM and Coral Cloud. So
  were the 9 files of workflow rules in the package folders (1 of NPSP, 8 of V4S) with their 23 rules and actions,
  and the 9 record types (8 of EDA, 1 of V4S). The 41 field sets, with 1,424 fields, were held against their files
  by scripts. `[read]`
- OrgLens reports 1,725 references for them. **None is wrong.** All are at the tier `confirmed`. `[read]`
- **Seven names are missed**, and the analysis says nothing about them: one flow of Coral Cloud names the flow of
  a package that it overrides, and six actions of Nebula Logger name the object they hand to a generic Apex
  action. Nothing was corrected. Both causes are below. `[read]`
- Some names give no reference on purpose, by rules of decision records
  [0061](../../adr/0061-the-elements-of-a-flow.md) and
  [0065](../../adr/0065-record-types-field-sets-and-records-of-custom-metadata.md), such as the component of a
  screen and the object a variable declares. They are listed below, so that the maintainer can strike the rules.
- **The two processes of PMM give 102 warnings and no reference.** They write the token `%%%NAMESPACE%%%` before
  every name of the package, and the analysis reads no name with a token in it. So they were checked for their
  warnings, not for their references.
- **The listing of Phase 1 missed three formulas, and is corrected.** Coral Cloud writes three tags with the
  bracket on the next line (`<formula` and `>` below it). The analysis read them, and the listing and the scan of
  the test of the codebases did not. `[run]`
- The fourth pass mark of the phase holds: no reference at the tier `confirmed` is wrong, and every missed one is
  named with its cause.
- The 339 records of custom metadata types are read without an error, as record 0065 found for 335 of them. Their
  numbers and the values read by hand move here from that record, as the plan asks.
- **The check was made by the author of the analysers**, the assistant that builds OrgLens with the maintainer,
  once. The sub-agent that reviews the pull request reads the flows again. No person read an entry: the reading by
  the maintainer of five flows (answer 6 of the plan) goes into the test plan of the phase.
- A first snapshot of the largest codebase, NPSP with 11,722 components, takes 3.2 to 4.3 seconds as a command, as
  it did in Phase 1, and an impact question 0.1 to 0.2 seconds. A made-up source of 100,072 components, Coral Cloud
  with its objects and flows copied 580 times, has 5,810 flows: its snapshot takes 11.6 to 12.2 seconds and an
  impact question with 2,915 results 0.15 to 0.19 seconds. `[run]` These are repositories on a disk. **No org was
  measured**, and the time of a snapshot of an org is the time Salesforce takes to hand out the files.

## Conditions

- The eight codebases of `fixtures/corpora.toml`, each at its pinned commit. This work package pins two more:
  Coral Cloud, a sample app of Salesforce, for its ten flows, and EDA, the Education Data Architecture of
  Salesforce.org, for its record types. Coral Cloud is under CC0-1.0 and EDA under BSD-3-Clause, as their
  repositories state it. Salesforce retired Coral Cloud on 3 November 2026: the pinned commit is its last, and the
  repository stays readable.
- The folders: the package folders the manifest names, and for Nebula Logger and PMM the folders of their flows
  outside the package (`FLOW_FOLDERS` in `packages/engine/test/corpora/listing.ts`). Nebula Logger keeps its flows
  in recipes, tests and a plugin, and PMM its two processes in the settings of a developer org
  (`unpackaged/config/dev`). Each such folder is read together with the package folder that holds the objects its
  flows name.
- Nothing of the codebases is in this repository. The names of their components in this note are names, not
  content. The listings are printed and read, and not kept, because they hold the text of the codebases.
- The analysis reads flows, workflow rules and their actions, record types, field sets and records of custom
  metadata types since work packages 3 to 5. What was read is its output at the commit of this pull request.
- One machine for the times: Linux x64, a 4-core virtual machine, warm file cache, Node.js v24.22.3. Windows and
  macOS were not measured.

## The listing

`pnpm run corpora:listing` prints, after the listing of Phase 1, a second listing for each codebase, headed
`flows and configuration`. Its entries are components:

- a flow, with the values of the flow itself (its type, its status, its start where the flow has no start element,
  and the values of the builder of a process), and each element of the flow as an entry of its own, the start
  element too, under the key the analysis gives it (`Flow:<flow>#element:<name>`);
- each rule and action of a file of workflow rules (`WorkflowRule:`, `WorkflowFieldUpdate:` and the others);
- each record type and each field set, from a file of its own in the source format, or from the file of its object
  in the metadata format.

Each entry shows the XML of its component, read by a scanner of the listing's own and not by the reader of the
engine: a value as `tag: text`, a group of values on one line, and the positions of the builder on the canvas
left out. Under it stand the references and the issues the analysis reports for that component, each reference
with its kind, target, tier, resolution, way, the text as written and its line and column.

| Entries | Apex Recipes | Nebula Logger | PMM | Coral Cloud | NPSP | V4S | EDA | All |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Flows | 1 | 10 | 2 | 10 | 0 | 0 | 0 | 23 |
| Elements of flows | 3 | 42 | 21 | 85 | 0 | 0 | 0 | 151 |
| Rules and actions of workflow rules | 0 | 0 | 0 | 0 | 6 | 17 | 0 | 23 |
| Record types | 0 | 0 | 0 | 0 | 0 | 1 | 8 | 9 |
| Field sets | 0 | 1 | 7 | 0 | 18 | 15 | 0 | 41 |
| All | 4 | 53 | 30 | 95 | 24 | 33 | 8 | 247 |
| References | 1 | 38 | 384 | 49 | 727 | 504 | 22 | 1,725 |
| Issues | 0 | 0 | 102 | 0 | 0 | 0 | 0 | 102 |

Outbound Funds has none of these, and its listing is empty.

- **The flows.** Apex Recipes: one screen flow. Nebula Logger: two screen flows, seven flows without a screen
  (`AutoLaunchedFlow`, started by a change of a record, a schedule, an event or a call) and one process. PMM: two
  processes. Coral Cloud: seven flows without a screen, one of which overrides a flow of a package, a screen flow
  and two flows that route work (`RoutingFlow`). These are the 23 flows of the plan, and all the flows the eight
  repositories hold anywhere.
- **The workflow rules.** NPSP: the file of `Opportunity`, with 2 rules, 3 field updates and an email alert.
  V4S: 8 files, of which 3 hold parts: `Contact` and `Lead` with 2 email alerts, a rule and a task each, and
  `Volunteer_Hours__c` with 3 email alerts, 2 field updates and 4 rules. The other 5 files hold no part. The file
  itself (`Workflow:Contact`) is a component without a reference, which a test holds.
- **The record types.** EDA: 3 of `Academic_Certification__c`, 2 of `Attribute__c` and 3 of `Credential__c`.
  V4S: `Campaign.Volunteers_Campaign`, in the file of its object.
- **The field sets.** Nebula Logger 1, NPSP 18, PMM 7 and V4S 15.

## What the analysis reports

`[run]` The listing prints these numbers to the error output, and `extraction-corpora-checked.test.ts` holds
them by codebase.

| References of the flows | Apex Recipes | Nebula Logger | Coral Cloud |
| --- | --- | --- | --- |
| via `object`: the object of a start, of a record element or of a process | 1 | 8 | 12 |
| via `record`: the object of a record variable that a create or an update writes | 0 | 1 | 1 |
| via `action`: an Apex class or a flow that an action calls | 0 | 11 | 0 |
| via `output`: a field that a lookup reads | 0 | 3 | 12 |
| via `filter`: a field in the condition of a lookup | 0 | 0 | 10 |
| via `assignment`: a field that a create or an update writes | 0 | 2 | 10 |
| via `path`: a field behind a record, such as `$Record.Name` | 0 | 7 | 4 |
| All | 1 | 32 | 49 |
| Resolution `resolved` | 1 | 16 | 30 |
| Resolution `external` | 0 | 16 | 19 |

PMM has no reference of a flow (below). Every reference of a flow starts at an element, except one: the object
of the process of Nebula Logger, which starts at the flow, as record 0061 says (choice 11). Of the 82, 3 are
`triggers-on` (the object of a start on a change of a record or on an event, and of the process), 11 `calls`, 31
`reads`, 17 `writes` and 20 `references`. `external` is a target that no file of the codebase defines: a standard
object, field or event, such as `User`, `Organization`, `Case`, `MessagingSession`, `FlowExecutionErrorEvent` or
`Contact.Email`.

| References of the configuration | NPSP | V4S | EDA | PMM | Nebula Logger |
| --- | --- | --- | --- | --- | --- |
| Rules and actions of workflow rules | 24 | 37 | 0 | 0 | 0 |
| Record types: a picklist and the values it allows | 0 | 3 | 22 | 0 | 0 |
| Field sets: a field it lists | 703 | 464 | 0 | 384 | 6 |
| of them `resolved` | 139 | 140 | 0 | 230 | 5 |
| of them `external` | 564 | 324 | 0 | 154 | 1 |

- **Names not resolved: none.** No reference of the listing is `unresolved`, and none is at the tier `probable` or
  `possible`.
- **Issues: 102, all of PMM**, 78 `NAME_NOT_READ` and 24 `PATH_NOT_FOLLOWED`. No codebase has an error, and no
  element is of a kind the reader does not know (`FLOW_ELEMENT_UNKNOWN`).
- The field sets of NPSP name mostly fields of the packages NPSP builds on (`npe01__`, `npo02__` and others), which
  is why four fifths of their references are `external`.

## The check

**How.** The listing of each codebase was printed and read from the first entry to the last. For every element of
a flow, every value that can hold a name was held against the lines of references below it: is every name there,
does every line name the right target, is the kind right (`reads`, `writes`, `calls`, `triggers-on`), is the way
right, is the place the place of the name. For a lookup, the object of the lookup was held against the fields it
filters on and reads. For a record that a later element uses (`Get_Booking_Record.Experience_Name__c`), the
element that made the record was looked up and its object held against the field. For a create or an update, the
fields it assigns were held against its object. A process of the Process Builder was read with the values of its
builder, which say which object it starts on. The rules and actions of the 9 files of workflow rules, and the
record types, were read the same way.

**Three checks by scripts.** None of the scripts is in the repository, so none can be repeated from it. `[run]`

- For each of the 1,725 references, the first opened the file of its component at the line and column the
  reference gives, and checked that the text written there is the name as written in the reference. All 1,725
  stand where they say.
- The second held the record types against their files: each picklist of a record type gives one reference to
  its field, in the order of the file, with the values the record type allows, the same in number and in order.
  All 9 match.
- The third held the field sets against their files: each field a field set lists gives one reference to that
  field of the object of the field set, and a field behind a relationship (`Program__r.Name`) gives one to the
  lookup and one to the field behind it, on the object the `<referenceTo>` of the lookup names. Of the 1,424 fields
  listed, 1,413 give their reference, 11 are `Id` (7 in NPSP, 4 in V4S), which gives no reference by rule, and
  144 are behind a relationship: all 142 of PMM lead where the file of their lookup says, and the 2 of V4S
  (`Volunteer_Job__r.Name`) as well.

**Wrong references: 0.** No reference names a target the file does not name, none has the wrong kind or the wrong
way, and none stands at a place where its name is not written.

**Missed references: 7.** The analysis reports nothing for them, and no warning says it.

| # | Codebase | Where | Written | What is missed |
| --- | --- | --- | --- | --- |
| 1 | Coral Cloud | the flow `Send_Verification_Code` | `<overriddenFlow>SvcCopilotTmpl__SendVerificationCode</overriddenFlow>` | the flow of a package that this flow overrides |
| 2, 3 | Nebula Logger | two actions of `Account_Flow_Logger_Example` | `<dataTypeMappings>` with `<typeValue>Account</typeValue>` | the object `Account`, which the action is given records of |
| 4 | Nebula Logger | an action of `Account_Record_Launched_Flow_Example` | the same | the same |
| 5 | Nebula Logger | an action of `LogEntryHandler_Screen_Tests_For_Flow` | the same, `User` | the object `User` |
| 6 | Nebula Logger | an action of `LogEntryHandler_Tests_Flow` | the same, `User` | the same |
| 7 | Nebula Logger | an action of `LogEntryHandler_Tests_Scheduled_Flow` | the same, `Organization` | the object `Organization` |

- **Cause of 1.** `overriddenFlow` is a value of the flow, not of an element, and the reader of flows does not
  read it. Record 0061 does not name it among what is not read: it was not thought of. The flow it names is of a
  managed package (the prefix `SvcCopilotTmpl__`) that Coral Cloud does not hold, so the reference would be
  `external`. An org that has the package would show whether the Dependency API reports the pair.
- **Cause of 2 to 7.** An action of a generic Apex class says, in `dataTypeMappings`, which object stands for the
  type of the class (`T__record`). The reader does not read the element. In each of the six flows the records the
  action is given come from an element that reads that object (a lookup, or the start of the flow), and that
  element refers to the object. So an answer about `Account`, `User` or `Organization` holds the flow, through
  another element, and misses only the action. By the rule of record 0061 for the object a variable declares,
  which gives no reference, such a type would give none either. That is for the maintainer to say.
- **What was done: nothing.** Both are additions to the reader of flows, which work package 3 built, and both need
  a line in record 0061. They are named here so that the maintainer can decide whether they are built.

**Names that give no reference, on purpose.** The file holds them and the analysis reports nothing, by a rule.
They are no misses by the rules as they stand.

| Codebase | Where | Name | Rule |
| --- | --- | --- | --- |
| Nebula Logger | 4 components of screens | `c:loggerLWCGetLoggerImportDemo`, `c:loggerLWCCreateLoggerImportDemo`, `c:loggerLWCEmbedDemo`, `c:loggerAuraEmbedDemo` in `extensionName` | the component of a screen is not read (record 0061) |
| Coral Cloud | an action of `PersonalizedSchedule` | the prompt template `Generate_Personalized_Schedule`, of the action type `generatePromptResponse`, which `cc-employee-app` holds | an action that is no Apex class, no flow and no alert is not read (record 0061, choice 18) |
| Coral Cloud | 4 more actions | `routeWork` twice, `emailSimple`, `generateVerificationCode` | standard actions, which name no component |
| Nebula Logger, PMM, Coral Cloud | 17 variables: 6, 4 and 7 | the object a variable declares (`objectType`) | not read (record 0061) |
| Nebula Logger | 2 variables of plugins | the Apex types `LoggerBatchableContext` and `LoggerTriggerableContext` (`apexClass`) | not read (record 0061) |
| Apex Recipes, Nebula Logger, PMM, Coral Cloud | values of the builder | `processMetadataValues` | not read beyond the object of a process (record 0061) |
| EDA | all 8 record types | the compact layout of a record type (`compactLayoutAssignment`) | not read (record 0065) |
| NPSP, V4S | 11 fields of field sets | `Id` | gives no reference |
| Coral Cloud | lookups and their conditions | `Id`, as a field read or filtered on | the same |

**PMM.** Both processes stand in `unpackaged/config/dev`, outside the package, and name every object and field of
PMM with the token of its build tool: `%%%NAMESPACE%%%ProgramEngagement__c`. Record 0061 (choice 10) reads no such
value as a name and gives the warning `NAME_NOT_READ` where an object or a field is read: 78 times. A path from a
record of no known object gives `PATH_NOT_FOLLOWED`: 24 times. So nothing of the two processes is found, and every
name of them is a warning that `coverage` counts and that makes an answer about the objects of PMM say it may miss
something. One message quotes the path cut at the second token:
`myVariable_current.%%%NAMESPACE%%%Program__r.%%%NAMESPACE%%%`. It is a fault of the words, not of the analysis.
Reading such a token as an empty prefix is not built and is not in the plan.

**What the listing can hide, and the defect that was found.** The listing shows the references of a component
under its entry, so a reference of a flow element cannot stand under another element. A test holds that the
entries are exactly the components of these types the analysis reports, that the file of workflow rules itself
has no reference, that the issues are the issues of these components, and that every reference is `confirmed`.
The listing of Phase 1, which this work package extends, cut its entries out of the files with patterns that
wanted `>` right after the name of a tag. Coral Cloud writes `<formula` with the bracket on the next line in three
fields (`Booking__c.Status__c`, `Session__c.End_Time__c`, `Session__c.Status__c`), as a formatter writes long
tags. The analysis read the three. The listing and the scan of the test of the codebases did not, and the counts
did not agree. Both now allow white space before the bracket, the three were read, and their references are
right. The four codebases of Phase 1 do not write a tag that way, and their digests did not move.

**The entries of Phase 1 in the two new codebases.** The listing of Phase 1 of Coral Cloud and EDA was read the
same way as in Phase 1, by the same author. Coral Cloud: 19 formula fields, 2 default values and 4 roll-up
summaries, with 49 references. EDA: 10 formula fields, 2 validation rules and 78 default values, with 76
references. 79 of the default values are literals and have no reference, and one is `now()`. **None of the 125
references is wrong**, all are `confirmed`, and none is missed. The lookups of their paths lead where the files of
the lookups say.

## The records of custom metadata types

The plan asks for the numbers and the values read by hand of work package 5 in this note. Record 0065 holds them
for the four codebases of Phase 1; they are taken over here, with the four records of EDA. V4S, Outbound Funds and
Coral Cloud hold no record.

| | Apex Recipes | Nebula Logger | NPSP | PMM | EDA | All |
| --- | --- | --- | --- | --- | --- | --- |
| Files of records | 11 | 100 | 193 | 31 | 4 | 339 |
| Records | 11 | 93 | 193 | 31 | 4 | 332 |
| References to its type (`record-of`) | 11 | 100 | 193 | 31 | 4 | 339 |
| References to a field it gives a value (`listed-field`) | 19 | 306 | 1,258 | 40 | 10 | 1,633 |
| References in a value of a relationship (`value`) | 12 | 40 | 318 | 25 | 0 | 395 |
| References at the tier `probable` | 0 | 0 | 0 | 0 | 0 | 0 |
| Warnings | 0 | 0 | 0 | 4 | 8 | 12 |

`[run]` `extraction-corpora.test.ts` holds these numbers, with the folders it reads.

- **Read without an error.** Every type, field and value of a relationship they name is found, except in the
  records outside the packages that name their type and fields with the tokens of the build tool,
  `___NAMESPACE___` and `%%%NAMESPACE%%%`: the four of PMM in `unpackaged/config/cmdts`, with one field each, and
  the two of EDA in `unpackaged/config/settings_product` and `unpackaged/config/release_gating`, with five fields
  each, of which four are warnings and the fifth has an empty value, which is no value. Their type is `external`.
- Seven records of Nebula Logger stand in two folders of its tests as the same file, and both files are read: 100
  files, 93 records. Nebula Logger has 136 values that are nil and NPSP 139, which give nothing.
- **No value of a text field gives a reference at the tier `probable`.** So there are none to read by hand.
  Instead, values of text fields that look like names were read by hand, three of each codebase where it has
  three, to see why none is taken (record 0065, rule 10: one name is a field only of an object that the same
  record names in a relationship, and `Object.Field` only where a file defines that field).
  - Apex Recipes: its two values that are one name are the names of Apex classes
    (`Metadata_Driven_Trigger.MDTAccountTriggerHandler`, `Class__c = MDTAccountTriggerHandler`), and the record
    names `Account` in its relationship to an object, which has no field of that name.
  - Nebula Logger: `LoggerSObjectHandler.SomeExample` names an object in a text
    (`SObjectTypeOverride__c = Account`), not a field. `LoggerSObjectHandler.LogEntryHandler` names a class
    (`SObjectHandlerApexClass__c = LogEntryHandler`). `LogRetentionRuleCondition.Sample_Rule_1_condition` holds the
    path `Log__r.TotalERRORLogEntries__c`, whose first name is a relationship and not an object: no record names
    the object the path starts at, the code of the plugin does.
  - NPSP: its 135 records of `Data_Import_Field_Mapping` name fields in texts as one name, with the prefix of the
    package (`Data_Import_Field_Mapping.Account_1_City`, `Source_Field_API_Name__c = npsp__Account1_City__c`), and
    name no object: the object stands in a text of another record, of `Data_Import_Object_Mapping`, which the
    first one names in a relationship. `Data_Import_Object_Mapping.GAU_Allocation_1` shows why an object in a text
    is not taken for the object of the other texts of the record: it has `Object_API_Name__c =
    npsp__Allocation__c` beside `Imported_Record_Field_Name__c = npsp__GAU_Allocation_1_Imported__c`, a field of
    the object of the data to import and not of the allocation, and `Custom_Mapping_Logic_Class__c =
    npsp.BDI_CustObjMappingGAUAllocation`, a class with its namespace. Its 34 records of `GetStartedChecklistItem`
    have two names that are the name of a file, such as `Image__c = add_users.svg`. None of them is taken.
  - PMM: its six values that are one name are values of picklists, such as `BucketedValue.Active` and
    `BucketedValue.Enrolled` (`Value__c = Active`, `Enrolled`, values of `ProgramEngagement__c.Stage__c`) and
    `BucketedValue.ServiceSessionStatusPending` (`Pending`, of `ServiceSession__c.Status__c`). A record of these
    names the picklist only through two relationships: to its bucket, and from there to the record that names the
    field.
  - EDA: the two records in its package, `Product_Registry.EDAProductInformation` and
    `Product_Registry.EDAReleaseGate`, give one name each in `Class_Name__c`, the names of Apex classes
    (`EDASettingsProductInformationAPIService`, `EDAReleaseGateProvider`), and `hed`, the namespace of EDA, in
    `Namespace__c`. Their type has no relationship to an object, so no one name of them can be a field.
- Following a relationship to another record, taking a text there for an object, and reading a name with the
  prefix of the package that holds it are not built.

## The 24 references of the workflow rules of NPSP

Record [0063](../../adr/0063-the-parts-of-a-file-of-workflow-rules.md) checked them by hand on the day it was
written and left the list to this note. They were read again for it. All are `confirmed`. The file is
`force-app/main/default/workflows/Opportunity.workflow-meta.xml`.

| # | From | Kind | To | Way | Resolution | Line:column |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | the email alert `Opportunity_Email_Acknowledgment` | reads | `Opportunity.Primary_Contact__c`, its recipient field | `listed-field` | resolved | 8:20 |
| 2 | the same | references | the email template `NPSP_Email_Templates/NPSP_Opportunity_Acknowledgment` | `template` | resolved | 12:40 |
| 3 | the field update `Opportunity_AcknowledgmentStatus_Update` | writes | `Opportunity.Acknowledgment_Status__c` | `assignment` | resolved | 17:16 |
| 4 | the field update `Opportunity_Acknowledgment_Date_Update` | writes | `Opportunity.Acknowledgment_Date__c` | `assignment` | resolved | 27:16 |
| 5 | the field update `Opportunity_Copy_FMV_to_Amount` | writes | `Opportunity.Amount` | `assignment` | external | 37:16 |
| 6 | the same | reads | `Opportunity.Fair_Market_Value__c`, in its formula | `formula` | resolved | 38:18 |
| 7 | the rule `Opportunity Copy FMV to Amount` | reads | `Opportunity.Amount` | `filter` | external | 53:32 |
| 8 | the same | reads | `Opportunity.Amount` | `filter` | external | 58:32 |
| 9 | the same | reads | `Opportunity.Fair_Market_Value__c` | `filter` | resolved | 62:32 |
| 10 | the same | reads | `Opportunity.Fair_Market_Value__c` | `filter` | resolved | 67:32 |
| 11 | the same | references | the field update `Opportunity_Copy_FMV_to_Amount` | `action` | resolved | 47:19 |
| 12 | the rule `Opportunity Email Acknowledgment` | references | the email alert `Opportunity_Email_Acknowledgment` | `action` | resolved | 76:19 |
| 13 | the same | references | the field update `Opportunity_AcknowledgmentStatus_Update` | `action` | resolved | 80:19 |
| 14 | the same | references | the field update `Opportunity_Acknowledgment_Date_Update` | `action` | resolved | 84:19 |
| 15 | the same | reads | `Opportunity.Acknowledgment_Status__c`, in its formula | `formula` | resolved | 89:23 |
| 16 | the same | references | the custom label `sendAcknowledgmentFireStatus` | `formula` | resolved | 89:58 |
| 17 | the same | reads | `Opportunity.Primary_Contact__c`, as `Primary_Contact__r` | `formula` | resolved | 89:99 |
| 18 | the same | reads | `Contact.Email` | `formula` | external | 89:118 |
| 19 | the same | reads | `Opportunity.Primary_Contact__c`, as `Primary_Contact__r` | `formula` | resolved | 89:150 |
| 20 | the same | reads | `Contact.Do_Not_Contact__c` | `formula` | resolved | 89:169 |
| 21 | the same | reads | `Opportunity.Primary_Contact__c`, as `Primary_Contact__r` | `formula` | resolved | 89:213 |
| 22 | the same | reads | `Contact.HasOptedOutOfEmail` | `formula` | external | 89:232 |
| 23 | the same | reads | `Opportunity.Primary_Contact__c`, as `Primary_Contact__r` | `formula` | resolved | 89:277 |
| 24 | the same | reads | `Contact.Deceased__c` | `formula` | resolved | 89:296 |

The formula of the second rule names `Primary_Contact__r` four times, and each gives the lookup and the field
behind it. The lookup leads to `Contact`, as its file says.

## How the check is held

`extraction-corpora-checked.test.ts` holds, for each codebase, the count of entries of the second listing by kind,
of its references and of its issues by code, and the SHA-256 of the whole listing as it was read. When the
analysis reports another reference, another place, another tier or another issue for one of these components, or
another component, the digest moves and the test fails. The test then asks for a new check by hand of what moved,
as in Phase 1. It also holds that the entries are exactly the components of these types, that every reference is
`confirmed`, and that the file of workflow rules itself has none. Like the other tests on the public codebases it
is skipped where the codebases are not downloaded, so CI does not run it. The digests of the listing of Phase 1
did not move; the two new codebases have their own.

| Codebase | SHA-256 of the second listing that was read |
| --- | --- |
| apex-recipes | `9a83f4d69329e5a22fcd4b4d9ac1c02c8e20a62f2991064234481944381eacbe` |
| nebula-logger | `911c3ffdd9ec2d64e323504f156ef78cda966bf3981500954fbb3e4852371817` |
| npsp | `0e250f0d56e8ea3b158b508eb5b004de9911c5cbea3bd7b522ef93e7a680f074` |
| pmm | `201a2c57978cbdda732b967853b1508390a7a4fceee9eed6ad1830a97fedd488` |
| volunteers-for-salesforce | `974423621c8314343787e90b5006bb0ba5a6c36195a868a9438d25a37f497579` |
| outbound-funds | `a386af5c01d065a6a878d1194a6ef6c05202cc46f0c5660fb2df5c8f1b14e217` |
| coral-cloud | `8f44188697a6560bcd755e7522127e9d549cc9ea29148347c86c23fdc9426e07` |
| eda | `e76a0baedb4cc9ff0c3f9d55ecc0d7d783253e82eb621e0910bfc278851726cf` |

| Codebase | SHA-256 of the listing of Phase 1 that was read |
| --- | --- |
| coral-cloud | `21690bb65eeed086ac8c412acab71c5f6a029b4edb34623d205bc6152f709a15` |
| eda | `3f523cba8de935d2d90752200c425a2c36fe74c04879b765bcb5fde145bc682b` |

## The times

`pnpm run bench:corpora npsp nebula-logger pmm apex-recipes volunteers-for-salesforce outbound-funds coral-cloud
eda --runs 5 --copies 98`, then `pnpm run bench:corpora coral-cloud --runs 5 --copies 580`
([`bench/corpora.mjs`](../../../bench/README.md)). Each time is that of a whole command of the built command line:
a new process, with the start of Node.js, the opening of the database and the printing. Every run has a new
workspace, so every snapshot is a first snapshot. The tables give the least and the most of five runs, in seconds.
`[run]` The first command timed Coral Cloud as well, at 0.83 to 0.91 seconds for its snapshot; the table has the
second. A test of two seconds ran while the first command timed Apex Recipes and Nebula Logger, so the largest of
their times may hold it.

| | Apex Recipes | Nebula Logger | PMM | NPSP | V4S | Outbound Funds | Coral Cloud | EDA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Files in the snapshot | 506 | 1,021 | 1,719 | 12,056 | 466 | 646 | 429 | 6,438 |
| Size of the files | 1.5 MB | 3.5 MB | 2.3 MB | 31.3 MB | 6.4 MB | 0.8 MB | 5.9 MB | 13.4 MB |
| Components | 258 | 894 | 1,666 | 11,722 | 660 | 655 | 312 | 6,081 |
| Analysed components | 59 | 680 | 182 | 1,065 | 195 | 72 | 165 | 491 |
| References | 52 | 661 | 906 | 2,986 | 1,302 | 211 | 110 | 191 |
| Database after the snapshot | 1.0 MB | 1.7 MB | 2.2 MB | 19.9 MB | 4.8 MB | 1.0 MB | 4.2 MB | 8.2 MB |
| `snapshot`, with its analysis | 0.60 to 0.74 | 0.77 to 1.05 | 0.98 to 1.05 | 3.19 to 4.27 | 0.91 to 1.08 | 0.72 to 0.80 | 0.75 to 0.80 | 1.93 to 2.10 |
| `analyse`, the analysis again | 0.50 to 0.62 | 0.60 to 0.75 | 0.71 to 0.80 | 1.54 to 1.84 | 0.63 to 0.82 | 0.52 to 0.74 | 0.55 to 0.62 | 1.20 to 1.27 |
| `coverage` | 0.09 to 0.12 | 0.09 to 0.09 | 0.10 to 0.11 | 0.09 to 0.11 | 0.09 to 0.11 | 0.09 to 0.15 | 0.09 to 0.10 | 0.09 to 0.15 |
| `impact`, the field most refer to | 0.09 to 0.12 | 0.09 to 0.11 | 0.10 to 0.12 | 0.10 to 0.14 | | 0.09 to 0.12 | 0.09 to 0.11 | 0.10 to 0.12 |
| the same with `--json` | 0.09 to 0.13 | 0.09 to 0.10 | 0.10 to 0.12 | 0.10 to 0.13 | | 0.09 to 0.12 | 0.09 to 0.11 | 0.10 to 0.13 |
| `impact`, a field one component refers to | 0.09 to 0.13 | 0.09 to 0.10 | 0.10 to 0.13 | 0.10 to 0.13 | | 0.09 to 0.16 | 0.09 to 0.10 | 0.10 to 0.12 |
| Results of the first impact question | 9 | 40 | 21 | 148 | | 7 | 15 | 4 |

- **The four codebases of Phase 1 take the times they took then**, within the spread of the runs: the snapshot of
  NPSP took 3.51 to 3.87 seconds then, and its analysis again 1.72 to 1.85. They now hold more references
  (NPSP 2,986 where it had 155, PMM 906 where it had 164), from the records of custom metadata types, the field
  sets, the email templates, the quick actions and the flows that Phase 2 reads.
- **The field most components refer to** is now a field of a custom metadata type in four of them, such as
  `Data_Import_Object_Mapping__mdt.Data_Import_Object_Mapping_Set__c` in NPSP with 148 results, because every
  record that gives it a value refers to it.
- V4S has no impact question: the benchmark asks about the fields that have a file of their own, and V4S keeps its
  fields in the files of its objects, in the metadata format.

**The made-up sources.** Both are repositories with one commit, built by the benchmark from a codebase, with the
project file and the `.forceignore` of the codebase, and asked the same two questions as the codebase. Nothing of
them is real, and neither is an org.

- **NPSP with every one of its 66 object folders copied 98 times**, as in Phase 1. NPSP has no flow, so this one has
  none. It is the source of Phase 1, read by the analysis of Phase 2.
- **Coral Cloud with every one of its 6 object folders and 10 flows copied 580 times**, which this work package
  adds. A copy of a flow names the copies of the objects where it names its objects (`object`, `objectType`), so
  that `$Record` and the records it reads and writes are those of the copy: a reference of a copy of a flow leads
  to the copy of the field. Every other name in it stays as it is, so a subflow or an Apex class of a copy is the
  one of the codebase. A check on a source with one copy, before the run, showed the copy of `Create_Booking`
  writing `Booking_1__c.Session__c`.

| | NPSP, 98 copies | Coral Cloud, 580 copies |
| --- | --- | --- |
| Files in the snapshot | 99,080 | 50,889 |
| Size of the files | 104.4 MB | 92.0 MB |
| Components | 100,216 | 100,072 |
| of them flows and their elements | 0 | 55,195 |
| Analysed components | 83,091 | 95,285 |
| References | 88,246 | 63,330 |
| Database after the snapshot | 94.3 MB | 64.2 MB |
| `snapshot`, with its analysis | 17.94 to 20.22 | 11.56 to 12.24 |
| `analyse`, the analysis again | 10.02 to 11.25 | 6.89 to 8.11 |
| `coverage` | 0.11 to 0.14 | 0.10 to 0.12 |
| `impact`, the field most refer to | 0.12 to 0.15 | 0.15 to 0.16 |
| the same with `--json` | 0.11 to 0.16 | 0.15 to 0.19 |
| `impact`, a field one component refers to | 0.11 to 0.16 | 0.11 to 0.14 |
| Results of the first impact question | 148 | 2,915 |

- **NPSP with copies takes what it took in Phase 1**, 18.42 to 19.69 seconds for the snapshot then, though it has
  88,246 references where it had 15,345: the field sets and the file of workflow rules stand in the object folders,
  so every copy has them.
- **5,810 flows with 49,385 elements are snapshotted and analysed in 11.6 to 12.2 seconds**, with about 45,000
  other components. Each copy gives the 109 references that the objects and the flows of Coral Cloud give, so the
  source has the 110 of Coral Cloud and 109 more for each copy.
- **The question about `Booking__c.Session__c` has 2,915 results in the copy and 15 in Coral Cloud.** A copy of an
  object keeps its files as they are, so the roll-up summary `Booked_Slots__c` of each copy of `Session__c` still
  counts the bookings of the codebase through `Booking__c.Session__c`. Two formulas of the copy read the summary,
  and the copy of the flow `Get_Sessions` reads one of them, with its element: five results for each copy, as a
  source with one copy showed. The answer of 2,915 results takes 0.15 to 0.19 seconds as a command, with the
  printing.

**They are unlike an org of their size**, in the ways Phase 1 named and in one more:

- 55 percent of the components of the copy of Coral Cloud are flows and their elements. An org of 100,000
  components has far fewer, and more Apex, layouts and permissions, which the analysis does not read yet.
- Their files are small, and flows of an org are often larger than those of a sample app. By how much was not
  measured.
- Some references cannot exist in an org: the copy of a standard object, such as `Contact_1__c`, keeps formulas
  and flows that name standard fields the copy cannot have, and the analysis reports those as `external`.
- They are repositories on a disk. A snapshot of an org spends its time waiting for Salesforce.

**Against the targets** (decision record [0037](../../adr/0037-performance-targets.md): for an org of 100,000
components, a first snapshot under 60 minutes and an impact query under 5 seconds). Both sources are that size when a
component is counted as a snapshot counts it, with fields and elements of flows. How the maintainer counts is still
open. An impact question takes under 0.2 seconds on both, with an answer of 2,915 results. Reading, storing and
analysing 100,000 components in 50,889 small files, with 5,810 flows, takes about 12 seconds, and that is far from 60
minutes. It says nothing about the time Salesforce takes, nor about the analysis of Apex, which is not built. It does
not show that 60 minutes can be met: that needs an org.

## Not measured, and not verified

- **A person as reader.** The author of the analysers read every entry, once, and the sub-agent of the review
  reads the flows again. A name the reader overlooked in a file is overlooked in the analysis as easily: the same
  head wrote both. The listing guards against one kind of that, because it shows the file through a scanner of its
  own. The maintainer reads five flows by hand in the test plan of the phase (answer 6 of the plan).
- **Whether Salesforce agrees.** The codebases are in no org, so the Dependency API was not asked about them. For
  flows and workflow rules the test org is that proof, for the fixture project only ([real-org.md](real-org.md)).
- **The field sets were not read one by one.** The scripts held each of their 1,424 fields against the files, and
  that is all.
- **PMM's processes.** With the tokens, nothing of them is found, so the reader of flows was not tested on them
  beyond its warnings. A project built with such tokens gets nothing from its flows. The maintainer is told at the
  close of the phase.
- **Files outside the folders that were read.** Three field sets of PMM in `unpackaged/config/alternate_field_sets`,
  under an object named with the token (`___NAMESPACE___ServiceDelivery__c`), one field set of a Slack plugin of
  Nebula Logger, and two files of workflow rules of NPSP for a trial org (`unpackaged/config/trial` and
  `unpackaged/config/trial_tso`), in the metadata format, with 11 and 26 rules and actions on fields of other
  packages. None of them is in a package folder or beside a flow, so none was read. Every flow of the eight
  repositories was.
- **Coral Cloud is retired.** Its flows use newer features of Salesforce (a prompt template, routing, an override
  of a flow of a package), which makes them worth reading, and nobody maintains them now.
- **Windows and macOS** were not measured.
