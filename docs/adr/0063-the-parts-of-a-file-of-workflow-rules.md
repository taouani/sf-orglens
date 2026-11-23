# 0063. The parts of a file of workflow rules are components, and what they name is of the object of the file

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (the analyser of workflow rules of work package 4 of the Phase 2 plan)

## Context

Work package 4 of the [Phase 2 plan](../plans/phase-2.md) asks for workflow rules: the rules, field updates,
email alerts, outbound messages and tasks of a file of workflow rules as components, and the references they
make. The plan names the kinds of reference. It does not say which element of the file holds what, nor what
becomes of a part of the file that it does not name.

Salesforce keeps the workflow rules of an object and the actions they start in one file, named after the object:
`workflows/Invoice__c.workflow-meta.xml`. It names each rule and each action `<object>.<name>`. An org lists them
as types of their own, such as `WorkflowRule` and `WorkflowFieldUpdate`, and the Salesforce library of the engine
knows them as the parts of the type `Workflow`, each in a group of the file: `rules`, `fieldUpdates`, `alerts`,
`outboundMessages`, `tasks`, and three more. The type of an action that a rule starts is one of the nine values of
`WorkflowActionType` in `@salesforce/types`, which that library brings.

Work package 1 measured what the Dependency API of the test org reports of these files
([research note](../research/phase-2/real-org.md), section 3): the custom fields that the formula of a field
update reads, and nothing else. Not the fields of the criteria or of the formula of a rule, not the actions it
starts, not the field an update writes nor the relationship field that leads to the parent it writes on, and
nothing of an alert, an outbound message or a task.

The file of the workflow rules of an object has the name of the object, so a name alone such as `Invoice__c` fits
both. Record [0064](0064-a-name-alone-that-fits-an-object-means-the-object.md) holds what the maintainer chose
for it.

What follows under "Decision" are choices of the author. The maintainer can strike any of them.

## Decision

The reader is `extraction/workflows.ts`. It reads one element of a file and nothing else, with the reader of
values of `extraction/objects.ts`. `analyseSource` makes the components and resolves the names against the model
of objects when every file was read, as for a field, a validation rule or a flow (record
[0041](0041-components-and-names-written-in-xml.md)).

Components:

1. **The file is a component, `Workflow:<object>`, and so is each part of it**, under the type and the name
   Salesforce gives it: `WorkflowRule:Invoice__c.Remind_When_Sent`. A part is defined by its own element of the
   file, with a hash of its own. **The file contains its parts**, as an object contains its fields: the file
   itself names nothing, and an impact answer about it is about its rules and actions, which are no result of
   each other. The key of any type that a group of the file holds in the types of the Metadata API has the file
   for its parent, also of the two that the Salesforce library does not know as parts (point 9). The database
   stores the parent of a component once, when its key is first named, so its migration 8 gives the rules and
   actions it already holds their file, and adds a row for the file where there is none. A project laid out with
   the preset `decomposeWorkflowBeta`, a file for each part, gives the same components and the same references,
   each at its place in the file of its part.
2. **Five types of part are read**: rules, field updates, email alerts, outbound messages and tasks. The three
   other parts the Salesforce library knows, a flow action (`WorkflowFlowAction`), an action that publishes an
   article (`WorkflowKnowledgePublish`) and an action that sends (`WorkflowSend`), are components with a row and
   nothing read, like a component of any type that is not analysed.
3. **A rule says whether it is active** (`active`), as a validation rule does. A reference carries that through
   the rule it starts at.
4. **The work of the reader is counted in the row of the reader of XML** (`parser:xml`): it reads names written
   in XML, as the reader of objects does.

References:

5. **The criteria of a rule read their fields.** The `field` and the `valueField` of each criterion are a path
   that starts with the name of an object, and are read as the field of a filter of a lookup is:
   `Invoice__c.Amount__c` `reads` the field `Amount__c` of `Invoice__c`, and `User.Department` a field of the user.
   The object itself gets no reference. The way is `filter`.
6. **The formula of a rule is read by the reader of formulas**, against the object of the file. Its references
   have the origin `parser:formula`. Every other reference of these files has the origin `parser:xml`.
7. **A rule `references` each action it starts**, at once (`actions`) and in each of its time triggers
   (`workflowTimeTriggers`), with the way `action`. The type of the component follows the type the rule gives the
   action: an `Alert` is a `WorkflowAlert`, a `FieldUpdate` a `WorkflowFieldUpdate`, and so on for the nine values
   of `WorkflowActionType`. A test holds the nine against that type and the parts against the library, so that a
   newer version of the library that adds one fails it. The name of the target is the object of the rule and the
   name of the action: an action is a part of the file of the same object. The date field a time trigger counts
   from (`offsetFromField`) `reads`, with the way `time`.
8. **An action of a type that is not among the nine, or of no type, is not read.** The warning `NAME_NOT_READ`
   says which, and no reference is made. Salesforce refuses an action without a type. An empty action, with
   neither a name nor a type, names nothing and is passed over without a warning.
9. **Two of the nine are no part of a file of workflow rules that the library knows**, though the types of the
   Metadata API give the file a group for each, `flowAutomation` and `notifications`. The library knows no
   `WorkflowNotification` at all, and `WorkflowFlowAutomation` only as a type of its own, in a folder of its own.
   So what such a group of a file holds is no component, and nothing says so. An action of either type is a
   reference to a component of that type, which is not resolved where the snapshot holds none, also without a
   warning. The test org lists 7 components of `WorkflowFlowAutomation` and hands out none
   ([research note](../research/phase-2/real-org.md), section 2).
10. **A field update `writes` its field** (`field`), with the way `assignment`. Where it names a parent
    (`targetObject`), it writes a field of the record that a relationship field of the record leads to, and
    `targetObject` is taken for the name of that relationship field: `Invoice__c` on an invoice line, or a
    standard field such as `AccountId`. An empty `targetObject` names no parent. The relationship field `reads`,
    with the way `path`, and the field is written on the object it leads to. The relationship is found by the
    name of the field, in any case: a custom field `Invoice__c` is the relationship `Invoice__r`, and a standard
    field `AccountId` or `accountid` the relationship `Account`. Any other name is taken for the name of a
    relationship as it stands. A name that is no relationship of the object gives the warning
    `PATH_NOT_FOLLOWED`, and the field is not written anywhere: its object is not guessed. So does a relationship
    that leads to the object of the record itself, for two reasons. The model of objects takes the standard
    relationship `Parent`, of the field `ParentId`, for the hierarchy of the object, which is wrong for an email
    message or a comment of a case, whose parent is the case. And the reader takes it that an update does not
    write on another record of its own object. A standard name is a relationship of every object to the model:
    `Account` on an invoice whose lookup is `Account__c` reads the field `AccountId` of the invoice, which it does
    not have, and writes on the account, without a warning.
11. **The formula of a field update is about the record of the object of the file**, also where the update
    writes on the parent. The fixture has such an update, and the key holds it so.
12. **An email alert reads the fields that hold its recipients.** A recipient that names a `field`, such as a
    lookup to a user or a contact, `reads` it, with the way `listed-field`. A recipient named by itself, such as a
    group, a role or a person, is not read. **Its template is a reference to the email template**, named with its
    folder (`Billing/Invoice_Overdue`), with the way `template`. The reference stands at the name after the
    folder. A folder can hold a `$`, as `unfiled$public` does. A template written without a folder is not read,
    with the warning `NAME_NOT_READ`. Email templates are not analysed before work package 8: the reference is
    resolved where the snapshot holds the template, and not resolved where it does not.
13. **An outbound message reads each field it sends** (`fields`), with the way `listed-field`. The field `Id`
    gives no reference, as at the end of a path of a formula: every message sends it.
14. **A task reads the date field its due date counts from** (`offsetFromField`), with the way `time`.

The cross-check:

15. **A row of the Dependency API from a rule or an action is compared as a row of any type the analysis
    reads, and a pair of the analysis that no row reports is excused where the API is not known to report it.**
    Of a file of workflow rules, the API reports the custom fields that the formula of a field update reads, and
    nothing else. Every other pair is counted, with a reason, among the pairs the API does not report:
    `workflow-rule` for a reference of a rule, `workflow-action` for a reference of an email alert, an outbound
    message or a task, and `field-update` for a reference of a field update that is not in its formula. A pair to
    a standard field or a standard object has the reason it has from any component. The mock org of the tests
    reports what the test org reports.

## Consequences

- The fixture project has 2 files of workflow rules with 4 rules, 3 field updates, an email alert, an outbound
  message and a task: 12 components. The analysis finds all 33 references the answer key holds for them, each
  from the rule or the action the key says, at the line and column, with the way and the tier the key says, and
  no other. None of the 5 places where the key forbids a reference is hit, and the files give no issue.
- The one file of workflow rules of the public codebases, in NPSP, is read without an issue: 2 rules, 3 field
  updates and an email alert, with 24 references. Each of them was checked by hand against the file on the day
  of this record. The plan asks for them in the note of work package 9, which does not exist yet: they are listed
  there with it.
- The six impact answers of the golden files of the engine and of the command line change. None of them names
  the types of workflow rules among those that are not analysed, and four have the rules and the actions that
  refer to the component among the results, each checked against the key. The answers about a field at the end
  of a chain of formulas and about a field that nothing refers to gain no result.
- The workspace database moves to schema version 8 (point 1). `orglens analyse` or `orglens snapshot` migrates a
  database of an older version, which `impact` refuses until then, as it does for every migration.
- The actions of a workflow rule are analysed and are not of the logic tier. Two things follow that could not
  happen before. A warning of a snapshot of an org that something of such a type is missing counts for an impact
  answer that covers the type, which every answer does: the answer says that it may miss something (`mayMiss`),
  as record [0044](0044-an-impact-answer.md), changed by record [0046](0046-complete-over-the-logic-tier.md), says.
  A test holds it for an email alert. And a type that `exclude_types` leaves out can be one the analysis reads,
  which record [0048](0048-types-a-snapshot-leaves-out.md) says cannot happen: the answer then has the type in
  `notCovered.partial` and may miss something. That rule of the answer is tested with a type of its own, and not
  with a snapshot of an org that leaves out an action. On the test org, none of the components that do not come
  back was of a type the analysis reads, by the count of record 0058 in Phase 1. Those of
  `WorkflowFlowAutomation`, 7 in run 23, are of a type that an action can name and the analysis does not read
  (point 9).
- Until work package 6 builds record 0058, what an org lists of the actions and does not hand out leaves the
  snapshot `complete`. The actions join the list of "complete" with work package 6, and the question whether
  `WorkflowFlowAutomation` joins it is settled there.
- The output of `impact` does not show whether a rule is active, as it does not for a validation rule or a flow:
  the database keeps it with the component.
- Not read, and no reference: a recipient named by itself, the addresses an alert copies (`ccEmails`) and sends
  from (`senderAddress`), the user an outbound message runs as (`integrationUser`) and the address it sends to
  (`endpointUrl`), the user or the queue a field update sets (`lookupValue`), the person a task is assigned to
  (`assignedTo`), and what a flow action, an action that publishes an article and an action that sends hold. A
  flow action names the flow it starts: a flow that only a workflow rule starts is not shown as referred to.
- Not verified: whether Salesforce writes in `targetObject` the name of the relationship field or the name of
  the object it leads to. In the fixture both are `Invoice__c`, and the test org accepted it. The documentation
  of the Metadata API, as read for this record, does not say which. If it is the object, an update that goes
  through a custom relationship field named otherwise gets the warning `PATH_NOT_FOLLOWED` and no reference to
  the field it writes, and one to a standard object reads a field of that name on the record, as `Account` does
  in point 10. Whether Salesforce lets an update write on another record of its own object was not looked up.
- Not verified on an org: the test org handed both files of workflow rules of the project back changed, in a way
  the log of the run does not show ([research note](../research/phase-2/real-org.md), section 2), and the reader
  has not run on a file that Salesforce wrote, because run 23 was made before it was built. A run of "Live org"
  after the merge does that. A criterion with `valueField`, a flow action, the layout of `decomposeWorkflowBeta`
  and a template in `unfiled$public` were not seen in a file that Salesforce wrote: they follow the types of the
  library.
