# 0065. What a record type, a field set and a record of a custom metadata type refer to

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (the readers of work package 5 of the Phase 2 plan)

## Context

Work package 5 of the [Phase 2 plan](../plans/phase-2.md) asks for three types. A record type refers to the
picklist fields it names, with the values it allows, and to its business process. A field set reads each field it
lists, also through a relationship. A record of a custom metadata type refers to its type and to each field it
gives a value. A value in a field that is a relationship to the definition of an object or of a field is a
reference to that object or field, at the tier `confirmed`. A value in a text field that is exactly the name of a
field of an object the same record names, or exactly `Object.Field`, is a reference at the tier `probable`, the
second step of the sequence of decision D7. A text that only holds such a name among other words is no
reference. The plan does not say which element of a file holds what, how a value is known to be a name, nor what
becomes of a value that is neither.

Salesforce keeps a record type and a field set in a file of their own in the folder of their object, or in the
file of the object in the format of the Metadata API, and names them `<object>.<name>`. A record of a custom
metadata type is a file of its own, `customMetadata/Billing_Rule.Default.md-meta.xml`, named with its type
without the suffix `__mdt`. The file names its type nowhere else. Each value is an element `values` with the name
of a field and the value. What the value means depends on the field, which a file of the type defines: a field of
the type `MetadataRelationship` points at `EntityDefinition`, `FieldDefinition` or another custom metadata type,
and one that points at `FieldDefinition` names the field of the same type whose value says the object
(`metadataRelationshipControllingField`).

Work package 1 measured what the Dependency API of the test org reports
([research note](../research/phase-2/real-org.md), section 3). Of a record: the type it is a record of, and nothing
else. Of a field set: its four custom fields, also the one across a relationship, and not the standard one. Of a
record type: nothing. Record [0045](0045-the-cross-check-of-a-snapshot.md) holds the answer of the maintainer of
16 November 2026 that a record refers to its type from the phase that analyses records. The test org also wrote a
`values` element for every field a record leaves out, and the log of the run does not show what its `value` holds
(section 2 of the note). The public codebases hold such elements with a value that is nil (`xsi:nil="true"`).

What follows under "Decision" are choices of the author. The maintainer can strike any of them.

## Decision

The readers are `readRecordType` and `readFieldSet` in `extraction/objects.ts`, and `readRecord` in
`extraction/custom-metadata.ts`. Each reads one element of a file, with the reader of values of `objects.ts`.
`analyseSource` resolves the names against the model of objects when every file was read, as for a field, a
validation rule or a flow (record [0041](0041-components-and-names-written-in-xml.md)).

Components:

1. **Each record type, field set and record is a component**, under the type and the name Salesforce gives it:
   `RecordType:Invoice__c.Credit_Note`, `FieldSet:Invoice__c.Invoice_Summary`,
   `CustomMetadata:Billing_Rule.Default`. A record type and a field set are contained in their object, and a record
   in its type, as their keys said before (`core/keys.ts`). A record whose name starts with the type and its
   suffix, `Billing_Rule__mdt.Default`, is of the same type.
2. **A record type says whether it is active** (`active`), as a validation rule does.
3. **The work of the readers is counted in the row of the reader of XML** (`parser:xml`).

References of a record type:

4. **A record type `references` each picklist field whose values it limits** (`picklistValues`), with the way
   `listed-field`, and keeps the values it allows in the attribute `values` of the reference, as the file writes
   them: `Closed%2FWon` stays as it is. The field is of the object of the record type. A standard picklist such
   as `StageName` is `external`. A value that is not a name gives the warning `NAME_NOT_READ`.
5. **A record type `references` its business process**, with the way `business-process`, as the component
   `BusinessProcess:<object>.<name>`. The name of a business process can hold a space, so the whole value is the
   name, and no warning is given for one that is not built like a name. Business processes are not analysed:
   the reference is resolved where the snapshot holds the business process, and not resolved where it does not.

References of a field set:

6. **A field set `reads` each field it lists**, available (`availableFields`) or shown (`displayedFields`), with
   the way `listed-field`. A field across relationships, such as `Account__r.Tier__c`, is read as a path of a
   formula is: each relationship field on the way and the field at the end. A relationship that leads to no known
   object gives the warning `PATH_NOT_FOLLOWED`, and a value that is no path of names `NAME_NOT_READ`.

References of a record:

7. **A record `references` its type**, with the way `record-of`. The file does not name the type, so the
   reference stands at the name of the root element, `CustomMetadata`, after its prefix where it has one. The name
   the reference holds is the name of the type with its suffix, `Billing_Rule__mdt`, which the name of the file
   gives. The answer key places the reference at the same element and writes `CustomMetadata` there.
8. **A record `references` each field it gives a value**, with the way `listed-field`, as a field of its type. A
   field whose value is nil or empty gives nothing, not even a warning when its name is not built like one. The
   test org writes an element for each field a record leaves out, and the public codebases hold 275 such elements
   with a value that is nil. Were they read, a record would refer to fields it gives no value.
9. **The value of a relationship is a name, at the tier `confirmed`**, with the way `value`. A relationship is a
   field of the type `MetadataRelationship`, in any case of letters. Of a relationship to `EntityDefinition` it is
   the object. Of a relationship to `FieldDefinition` it is the field alone, and its object is the value the same
   record gives the field that the relationship names as controlling it. Where the record gives that field no
   value, or a value that is not one name, nothing says which object the field is of: the warning
   `PATH_NOT_FOLLOWED` says so, and the field is not guessed. Of a relationship to another custom metadata type it
   is a record of that type, named without its type. A record whose name holds the type with its suffix (point 1)
   is found under that name where the snapshot holds no record of the name without it. A value of a relationship
   that is not one name, such as `Invoice__c.Amount__c` for a field or a name with a space, gives nothing and no
   warning: Salesforce writes one name there.
10. **A value of a text field is a name only where it is exactly one, and only where a file of the snapshot defines
    that field**, at the tier `probable`, with the way `text`. A text field is of the type `Text`, `TextArea` or
    `LongTextArea`, in any case of letters. Two names joined by a dot are the object and the field. One name alone
    is a field of an object that the same record names in a relationship to `EntityDefinition`, of each such object
    where it names several. Words around a name, a global variable such as `$User.Email`, three names, a field that
    no file defines and a standard field are no reference, and give no warning, because a text can be anything. A
    standard field has no file, so for it nothing tells a name from a word: `Account.Anything` would be one. An
    object named in a text is not taken as the object of the record, because a public codebase has a text naming an
    object beside a text naming a field of another object (see the consequences). The values of fields of other
    types, such as a number, a checkbox or a picklist, are not read.
11. **The values of a record are collected before any is resolved**, so their order in the file does not matter.
    Where a file gives one field two values, which Salesforce does not write, each gives its references, and the
    first one is the value that says the object of a field.

The cross-check:

12. **The row of the Dependency API from a record to its type is compared**, as record 0045 says, **and so are
    the rows from a field set to its custom fields.** Every other pair of a record is counted, with the reason
    `custom-metadata`, and every pair of a record type with the reason `record-type`, among the pairs the API does
    not report. A pair to a standard field or a standard object has the reason it has from any component. The mock
    org of the tests reports what the test org reports.

## Consequences

- The fixture project has two record types, a field set and four records: 7 components. The analysis finds all
  28 references the answer key holds for them, each from the component the key says, at the line and column,
  with the way and the tier the key says, and no other. None of the 4 places where the key forbids a reference is
  hit, and the files give no issue.
- On the mock org of the tests, built from the fixture project, the 4 rows from a record to its type and the 4
  from the field set to its custom fields are compared and agreed. Until this record, the row of a record was
  counted as not compared.
- The six impact answers of the golden files of the engine and of the command line change. None of them names
  the three types among those that are not analysed. Four gain results, each checked against the key: the answer
  about `Invoice__c.Amount__c` gains the record whose relationship names it and the field set that lists it, the
  one about `Account.Tier__c` the field set, the one about the chain of formulas from `Invoice_Line__c.Quantity__c`
  the record whose text names it, at the tier `probable`, and the one about the object `Invoice__c` the record
  that names its field `Amount__c`.
- **The 335 records of the four public codebases are read without an error**, with the folders the test of the
  codebases names: 11 of Apex Recipes, 100 of Nebula Logger, of which 7 stand in two folders of its tests as the
  same file, 193 of NPSP and 31 of PMM. Every type, field and value of a relationship they name is found, except in
  the four records of PMM in the folder `unpackaged/config/cmdts`, outside its package: their type and their one
  field are named with tokens of the build tool of that project, `___NAMESPACE___` and `%%%NAMESPACE%%%`. The type
  is `external` and the field gives `NAME_NOT_READ`, as the tokens of the flows of PMM do. Nebula Logger has 136
  values that are nil and NPSP 139, which give nothing (point 8).
- **No value of a text field gives a reference at the tier `probable`** in any of the four. So there are none to
  read by hand. Instead, values of text fields that look like names were read by hand, three of each codebase where
  it has three, to see why none is taken. Apex Recipes: its two values that are one name are the names of Apex
  classes (`Metadata_Driven_Trigger.MDTAccountTriggerHandler`, `Class__c = MDTAccountTriggerHandler`), and the
  record names `Account` in its relationship to an object, which has no field of that name. Nebula Logger:
  `LoggerSObjectHandler.SomeExample` names an object in a text (`SObjectTypeOverride__c = Account`), not a field;
  `LoggerSObjectHandler.LogEntryHandler` names a class (`SObjectHandlerApexClass__c = LogEntryHandler`); and
  `LogRetentionRuleCondition.Sample_Rule_1_condition` holds the path `Log__r.TotalERRORLogEntries__c`, whose first
  name is a relationship and not an object: no record names the object the path starts at, the code of the plugin
  does. PMM: its six values that are one name are values of picklists, such as `BucketedValue.Active` and
  `BucketedValue.Enrolled` (`Value__c = Active`, `Enrolled`, values of `ProgramEngagement__c.Stage__c`) and
  `BucketedValue.ServiceSessionStatusPending` (`Pending`, of `ServiceSession__c.Status__c`). A record of these
  names the picklist only through two relationships: to its bucket, and from there to the record that names the
  field.
- NPSP holds the case the rule leaves out on purpose. Its 135 records of `Data_Import_Field_Mapping` name
  fields in texts as one name, with the prefix of the package (`Data_Import_Field_Mapping.Account_1_City`,
  `Source_Field_API_Name__c = npsp__Account1_City__c`), and name no object: the object stands in a text of
  another record, of `Data_Import_Object_Mapping`, which the first one names in a relationship. That record shows
  why an object in a text is not taken for the object of the other texts of the record:
  `Data_Import_Object_Mapping.GAU_Allocation_1` has `Object_API_Name__c = npsp__Allocation__c` beside
  `Imported_Record_Field_Name__c = npsp__GAU_Allocation_1_Imported__c`, a field of the object of the data to
  import and not of the allocation, and `Custom_Mapping_Logic_Class__c = npsp.BDI_CustObjMappingGAUAllocation`,
  two names that are a class with its namespace. Its 34 records of `GetStartedChecklistItem` have two names that
  are the name of a file, such as `Image__c = add_users.svg`. None of them is taken. Following a relationship to
  another record, taking a text there for an object, and reading a name with the prefix of the package that
  holds it are not built.
- The field sets of the four codebases, in the folders of their packages, are read without an issue: one of
  Nebula Logger, 18 of NPSP and 7 of PMM, with 6, 703 and 384 fields, of which 5, 139 and 230 are found and the
  rest are standard fields or fields of other packages, `external`. No codebase holds a record type, so no record
  type of them was read.
- The plan asks for the numbers and the values read by hand in a note. That is the note of work package 9, which
  checks the codebases and is not written yet. Until it is, they are here, and that note takes them over with the
  rest.
- Not read, and no reference: the label and the description of a record type, its compact layout, which value of
  a picklist is its default, whether a field of a field set is required, and the label and `protected` of a
  record. The values a record type allows are kept as written and not held against the values of the picklist.
- Not verified on an org: the readers have not run on files that Salesforce wrote. The test org writes a `values`
  element for every field a record leaves out, adds the values of one more picklist to each record type, and drops
  `externalId` from the relationship fields of the type (section 2 of the note). A run of "Live org" after the
  merge reads them. Nor has a real org shown what the Dependency API reports of a record type with more than the
  picklists of a custom object: a row from a record type to something the reader does not read, such as its compact
  layout, would be a pair the analysis lacks, the error `REFERENCE_MISSED`.
