# 0061. An element of a flow is a component, and a flow is read from its file alone

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (the analyser of flows of work package 3 of the Phase 2 plan)

## Context

Work package 3 of the [Phase 2 plan](../plans/phase-2.md) asks for flows: a component for the flow and for each
of its elements and resources, a model of what each resource holds, and the references a flow writes. The plan
names the kinds of reference. It does not say which element of the file holds what.

A flow writes a name in three ways. As the value of an element beside the object it is a field of:
`<field>Status__c</field>` beside `<object>Invoice__c</object>`. As the name of a resource of the flow with a
path of fields, in an element such as `elementReference`: `Get_Invoice.Account__r.Name`. And as a merge field in
a text or a formula: `{!$Record.Amount__c}`. Record [0059](0059-the-names-in-a-text-with-merge-fields.md) has
the reader of the third. The second and the third need to know what a resource holds.

Salesforce publishes the type of a flow in the reference of the Metadata API. The names of the elements were
not taken from that page. They are those of the types the Salesforce library holds for a flow, which end with
API version 48, those of the six flows of the fixture project, which the test org accepted, and for five names
the memory of the author. Choice 3 says which is which.

What follows under "Decision" are choices of the author. The maintainer can strike any of them.

## Decision

The reader is `extraction/flows.ts`. It reads one file and nothing else. `analyseSource` makes the components
and resolves the names against the model of objects when every file was read, as for a field or a rule (record
[0041](0041-components-and-names-written-in-xml.md)).

Components:

1. **A flow is a component, and each of its elements and resources is a component below it**, with the key
   `Flow:<flow>#element:<name>` and the attribute `kind`. The start of a flow is an element with the fixed name
   `flow-start`, which no element of a flow can have. A reference starts at the element that writes it, so an
   answer names the decision or the assignment and not only the flow.
2. **An outcome of a decision, an event of a wait, a field of a screen and a scheduled path are no
   components.** They are names of the flow. What they hold belongs to the element they stand in.
3. **The kind of an element is told by the name of the group of the file that holds it.** `actionCalls`,
   `apexPluginCalls`, `assignments`, `choices`, `constants`, `decisions`, `dynamicChoiceSets`, `formulas`,
   `loops`, `recordCreates`, `recordDeletes`, `recordLookups`, `recordUpdates`, `screens`, `stages`, `start`,
   `steps`, `subflows`, `textTemplates`, `variables` and `waits` are names of the types of the Salesforce
   library. `customErrors` is in the fixture project. `collectionProcessors`, `orchestratedStages`,
   `recordRollbacks` and `transforms` are written as the author knows them: no file here holds one.
   `processMetadataValues` and `customProperties` hold values of the builder and no element, and the second is
   from memory too.
4. **A group that is not in that list is an element of a kind that is not known.** It is a component with the
   kind `unknown` and the name of the group, and the warning `FLOW_ELEMENT_UNKNOWN` says so. The names of
   resources and the merge fields in it are read at the tier `probable`. A bare name of a field in it is not
   read: nothing says which element of an unknown kind holds one. Where such a group has no name, what is read
   of it belongs to the flow.
5. **An element of a known kind without a name is the error `METADATA_UNEXPECTED`**, and nothing of it is read.
   Two elements whose names differ only in capitals give one key: the first is kept, and the error
   `KEY_COLLISION` names both.
6. **A flow says whether it is active, and each of its elements says it too** (`active`), as a validation rule
   does. A reference carries that through the component it starts at. The flow also keeps its status, its
   process type and what triggers it.

What a resource holds:

7. **A record of a known object**: `$Record` and `$Record__Prior` of the object of the start, a record variable
   of the object it declares, a lookup of the object it reads, a loop of the list it goes over, and a step that
   filters or sorts a list of the list it is given. A list is followed through the resources that hand it on.
   Two loops that go over each other hold a record of no known object.
8. **Values under names of its own**: an action, an Apex plug-in, a subflow, a component of a screen, a variable
   of an Apex type and an element of an unknown kind. One name after such a resource is such a value and gives
   no reference. More names are a path from a record of which nothing says the object.
9. **No record**: everything else, such as a text variable, a constant, a formula, a decision, and `$Flow`.
   Names after it give no reference.
10. **A value that is not built like a name names no object.** A project that writes a token of its build tool
    where a name should stand, such as `%%%NAMESPACE%%%Thing__c`, gets a warning for that value, and a resource
    that would be of that object holds a record of no known object.

References:

11. **The object of a start is `triggers-on`** where a record sets the flow off. A start on a schedule reads the
    records of its object: `references` with `op: lookup`. A process of the Process Builder has no start and
    names its object in a value of the builder (`ObjectType`): the reference starts at the flow, and is
    `triggers-on` for the process type `Workflow` and `references` for any other.
12. **The object of a record element is `references`, with what the element does to its records** in `op`:
    `lookup`, `create`, `update` or `delete`. A set of choices that reads records is a lookup.
13. **A name of a field beside an object**: in a filter `reads`, in `inputAssignments` `writes`, and in
    `outputAssignments`, `queriedFields`, `displayField`, `valueField`, `sortField` and the `recordField` of a
    scheduled path `reads`. The `fieldSelection` of a custom error and the `picklistField` of a set of choices
    are `references`. The object of a picklist is named for its field only and gets no reference of its own.
    The fields of a step that sorts a list are fields of the records of that list.
14. **The record an element writes as a whole** (`inputReference` of a create, an update or a delete) is a
    reference to its object, with `via: record` and the `op`. A relationship on the way is a read of the field
    behind it, and the fields the element sets are fields of the object at the end.
15. **The name of a resource with a path** is `reads` in `elementReference`, `leftValueReference` and
    `collectionReference`, and `writes` in `assignToReference`, `outputReference`, `assignNextValueToReference`
    and `assignRecordIdToReference`. In an assignment the operator decides: `Assign` and `AssignCount` write,
    and any other operator reads the field and writes it. A field of a screen that is bound to a field of a
    record (`objectFieldReference`) reads it and writes it. The field `Id` at the end of a path gives no
    reference, as in a formula.
16. **Any other element whose name ends with `Reference` or `References`** is read as the name of a resource at
    the tier `probable`, also in an element of a known kind. Five names are left out, because they hold the name
    of an element and never a field: `targetReference`, `choiceReferences`, `defaultSelectedChoiceReference`,
    `fieldReference` and `startElementReference`.
17. **A formula stands in `expression`, `filterFormula`, `formulaExpression` or `formula`**, and is read by the
    reader of formulas. Its references have the origin `parser:formula`. A text with merge fields stands in
    `stringValue`, `fieldText`, `errorMessage`, `text`, `helpText`, `pausedText`, `choiceText`, `promptText` or
    `interviewLabel`. A merge field in any other element is read at the tier `probable`. A label, a description
    and a name are not read.
18. **What an element starts**: an action of the type `apex` and an Apex plug-in `calls` the class, an action of
    the type `flow` and a subflow `calls` the flow, and an action of the type `emailAlert` `references` the
    alert, at its name behind the object. An action of any other type gets no reference for what it starts.
19. **A text that a condition compares `RecordType.DeveloperName` of a record with** is a reference to the
    record type of that name, at the tier `probable`, only where the snapshot holds such a record type of the
    object of the record.

What is not known says so:

20. **A path from a resource of which the object is not known is not followed**: the warning
    `PATH_NOT_FOLLOWED`, with the resource in `details.resource`. The same code says that a name of a field
    stands where no object is named.
21. **A resource the flow does not have is the warning `RESOURCE_NOT_FOUND`**, and no reference: nothing says
    what the name would refer to. A field or an object that nothing defines is a reference without a target, as
    in Phase 1.
22. **A merge field that is not closed is the warning `MERGE_FIELD_NOT_CLOSED`**, and a value that is not built
    like a name the warning `NAME_NOT_READ`.
23. **The work of the reader has a row of its own** (`parser:flow`): the flows and their elements, and the files
    of flows that could not be read. The row is there also when the source holds no flow.
24. **The name of a part is judged by its own name.** An alert `Invoice__c.Overdue` that the snapshot does not
    hold is missing, and not the alert of a package: the two underscores of the object are no prefix. This
    corrects the model of objects, which took such a name for one of a package. No reader handed it the name of
    a part of an object before. The record of a custom metadata type is still of a package when its type is.

The rows of the Dependency API from flows are counted and not compared, as record
[0060](0060-the-active-version-of-a-flow-is-analysed.md) says.

## Consequences

- The fixture project has 6 flows with 55 elements. The analysis finds all 126 references the answer key holds
  for them, each from the element, at the line and column, with the way and the tier the key says, and no other.
  None of the 22 places where the key forbids a reference is hit. The one place the key marks as not known, a
  path behind what an Apex action gives back, is the one warning. The three flows of `fixtures/flow-negative`
  give what their `expected.yaml` says, and one unresolved name more: the field of an object that does not
  exist.
- A snapshot of the fixture folder and one of the mock org give the same components and references for flows.
- That one warning makes every impact answer about the fixture project one that is not complete, also an answer
  about what a field refers to, which the warning cannot touch. A warning counts for every answer of its
  snapshot (record [0044](0044-an-impact-answer.md)). Narrowing that is for work package 6.
- The 13 flows of the public codebases are read without an error. Ten of them stand outside the package folders
  of `fixtures/corpora.toml`, in recipes, tests and settings of a developer org, so a test reads those folders
  too. Apex Recipes: 1 flow, 3 elements, 1 reference. Nebula Logger: 10 flows, 42 elements, 32 references, no
  issue. PMM: 2 flows, 21 elements, no reference, and 102 warnings: both are processes that hold
  `%%%NAMESPACE%%%` before every name of the package, which choice 10 does not read. No element of the 13 is of
  a kind the reader does not know. Nothing of this was checked by hand against the files, except the one
  process of Nebula Logger. The check by hand of every flow is work package 9.
- A project that is built with such tokens gets nothing from its flows until OrgLens reads the token as an
  empty prefix. That is not built, and is not in the plan.
- Not read, and no reference: a quick action or another action that is no Apex class, no flow and no alert, the
  component of a screen (`extensionName`), the type of an Apex variable (`apexClass`), the object a variable
  declares (`objectType`), the object of a picklist, a bare name of a field in an element of an unknown kind,
  and what a subflow or an action gives back. A value of the builder (`processMetadataValues`) is not read
  beyond the object of a process.
- An element that names a variable of a text where a record should stand gets the warning `NAME_NOT_READ`, whose
  words say that the value is no name. It is one, of a resource that holds no record. The words are not
  corrected.
- The file a snapshot of an org holds for a flow with a newer draft is still the draft. Fetching the active
  version is the second part of the work package, in a pull request of its own.
- Not verified: anything against Salesforce beyond the deploy of the six flows of the fixture project in work
  package 1. The five names of elements from memory. Whether Salesforce reports through the Dependency API what
  the reader finds is not compared.
