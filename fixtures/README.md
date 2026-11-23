# Fixtures

Test data that is shared by the whole repository. Everything here was written for OrgLens. Nothing comes from a real
org, and nothing is copied from another project.

| Path                          | What it is                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `billing-sfdx/`               | A small Salesforce project in source format: invoices, their lines, and Apex.       |
| `expected/answer-key.v2.yaml` | The answer key: every reference an analyser must find in the project.               |
| `expected/answer-key.v1.yaml` | The key of Phase 1, kept so that the check can say what version 2 changed.          |
| `expected/answer-key.v0.yaml` | The key of Phase 0, kept as the key the Apex trial was scored with.                 |
| `formula-probes.yaml`         | One small formula for every operator, literal and function, to test a parser with.  |
| `merge-field-probes.yaml`     | Small texts and formulas of a flow with merge fields, to test their reader with.    |
| `formula-negative/`           | Fields and a rule whose formulas cannot be deployed, and what is expected of them.  |
| `flow-negative/`              | Three flows that cannot be deployed, and what is expected of them.                  |
| `parser-negative/`            | Apex files that do not compile, for tests of error recovery. Not part of a project. |
| `corpora.toml`                | Public codebases, pinned by commit, that are downloaded on demand.                  |

The decision behind the format is [record 0029](../docs/adr/0029-fixture-and-answer-key.md).

## The project

`billing-sfdx` has 118 components: 5 custom objects, 57 custom fields on them, on `Account` and on `User`, 11
validation rules, 13 Apex classes and 1 trigger, 6 flows, the workflow rules of two objects (2 files with 4 rules
and the 6 actions they start), 2 record types, a field set, an email template with its folder, 4 records of a
custom metadata type, and four components that are only there to be referred to: the file of custom labels with
one label, a custom permission and a global value set. Three of the objects are targets too: a custom setting, a
custom metadata type and `Tax_Code__c`. It is small on purpose. Each file is there for a case that an analyser can
get wrong:

- formulas on formulas, across a lookup, through the owner, with a comment and with a field name inside text;
- two roll-up summaries and a lookup filter;
- an inactive validation rule, and a rule that names a field only in its message;
- a field `Status__c` on `Invoice__c` and another of the same name on `Invoice_Line__c`, and a lookup field
  `Invoice__c` that is named like the object;
- queries with fields in `SELECT`, `WHERE`, `ORDER BY`, `GROUP BY` and `HAVING`, a sub-query, an aggregate with
  aliases, `TYPEOF`, a search, and queries built as text from literals, from constants of another class and from
  parameters;
- `get` and `put` by name, each with a literal, a constant, a field token and a variable;
- a trigger with a handler class, an inner class, a property with a body, `switch on` a record, and a local
  variable that is named like an object;
- `Unused_Field__c`, which nothing refers to. Its name stands in comments and in text only.

Phase 1 added 35 components, and changed no file that was there. The new fields and rules are these cases:

- a formula across three relationships, the last of them the owner of an account (`Account_Owner_Email__c`), the
  parent of an account, and a hierarchy field of the user;
- the global variables: `$Setup` with a custom setting, `$Label`, `$Permission`, `$CustomMetadata` with a record,
  `$User` with a standard and a custom field, `$Profile`, `$UserRole`, `$Organization`, and
  `$ObjectType` inside `VLOOKUP`;
- `CASE`, `INCLUDES` and `TEXT` on picklists, `ISCHANGED` and `PRIORVALUE` on a picklist in a rule
  (`Paid_Cannot_Be_Reopened`), a dependent picklist with its controlling field, and two picklists
  that take their values from a global value set;
- a name in a comment, in text with double quotes, in text with single quotes, and after a quote that a backslash
  keeps inside the text (`Status_Notice__c`);
- a field `Value__c` beside the function `VALUE`, and `ACCOUNT__R` written in capitals;
- `Owner:User` and `Owner:Queue`, a default value that is a formula, a lookup filter that names `$User` and a
  field of the record that holds the lookup, and a roll-up summary with two filter lines.

The project is valid as far as the Salesforce source library can tell: the check resolves every file to a component.
The live-org workflow deployed the 52 components of Phase 0 to a Developer Edition org on 12 November 2026.
Salesforce accepted them on the first try, so the Apex compiles. **The Apex test was not run**, so nothing proves
that it passes. What the runs showed is in [`real-org.md`](../docs/research/phase-0/real-org.md).

**The 35 components of Phase 1 are in the test org since 15 November 2026.** Salesforce accepted all 87
components on the second try. The Apex test was not run then either. The first try was refused for two of the 87
components, and Salesforce changed nothing in the org:

- the rule `Void_Needs_Admin`, which compared `$RecordType.Name`. `Invoice__c` had no record type then. The line
  is removed. A probe still has it, and so does a rule that Phase 2 added with the record types of the object.
- the field `Region__c`, whose default value was `TEXT($User.Billing_Region__c)`. Salesforce reported no problem
  for the formula field `Is_My_Region__c`, which holds the same call. The default value is now `$User.Department`.

The log of the refused run did not show what Salesforce said about the two, because its messages had no form the
step knew. **Why each was refused is therefore my reading, and not verified.** That Salesforce accepts the
corrected files shows that they are valid, and not that the reading is right. The step now shows the everyday
words of such a message.

What the runs showed, and which pairs of the key the Dependency API reports (129 of 189), is in
[`real-org.md` of Phase 1](../docs/research/phase-1/real-org.md).

Phase 2 added 31 components, and changed no file that was there. Two fields that nothing referred to are referred
to now. The new files are these cases:

- a flow that runs before an invoice is saved (`Invoice_Before_Save`): an entry condition that is a formula, a
  decision on `$Record`, a path through two relationships, a global variable in a condition and one in a formula,
  assignments to fields of `$Record`, and a custom error whose message holds a merge field and, beside it, the
  name of a field as plain text;
- a flow that runs after the save and three days after a date field (`Invoice_After_Save`): a scheduled path, a
  condition on `$Record__Prior`, a query for lines with filters, a sort field and a list of queried fields, a
  loop, an update of a collection, an update of the record behind a relationship, an email alert, and a subflow
  whose output a later condition reads. Which object that output is of stands in the other flow, so the place is
  an unknown;
- the subflow (`Invoice_Recalculate`): a record variable, formulas over it and over a loop variable, an assignment
  that adds to a field, and a condition logic that is written out;
- a screen flow (`Invoice_Review_Screen`): a field of a record on a screen, a display text with merge fields
  (`Owner:User` among them), a validation of an input, a choice set that is filled from records, a text template,
  an Apex action, and an element each that creates, updates by filter and deletes records;
- a flow that runs on a schedule and was never activated (`Invoice_Purge_Void`), and a process of the Process
  Builder (`Invoice_Sent_Process`), which Salesforce stores as a flow of its own shape;
- workflow rules with criteria lines and with a formula, an inactive rule, a time trigger from a date field, a
  field update with a literal and one with a formula, a field update on the parent of the record, an email alert
  with a user field, a contact field and the owner as recipients, an outbound message and a task;
- a record type that turns picklist values off, and whose name a validation rule and a flow compare
  `RecordType.DeveloperName` with, and a second one that allows every value and that nothing names;
- a field set with a field across a relationship;
- records of a custom metadata type that name a field and an object in five ways: through a field of the kind
  that points at a field definition, whose value is the name of the field alone, through one that points at an
  object definition, as text that is exactly `Object.Field`, as text that is exactly the name of a field of the
  object the record names, and inside a sentence;
- an email template with merge fields of the record, of the recipient, of the user and of the organisation, and
  with the name of a field as plain text.

**The 31 components went to Salesforce for the first time on 23 November 2026**, with the rest of the project in
one deploy. Salesforce counted all 118 components, found no error in 116 and refused two flows, so nothing was
deployed. Whether it names every error of a deploy in one go, I do not know. Of the two messages only the everyday
words came out (`docs/live-org-setup.md` says why).

- `Invoice_Review_Screen`: the field of a record on its screen was bound to `Amount__c`, a currency field, and had
  a name of its own. The words that came out: "field … unknown (A … field of type … reference the field … because
  its … type … supported on this object. … or … the …". The field is now bound to `Tax_Code_Name__c`, a text
  field, and has no name. That is the shape of the one public example I found, in Nebula Logger. It binds two
  fields of the user, a text field and one that is a long text as far as I know, and it takes them from the record
  an element that gets records stores by itself, not from a record variable, as here. That the type was the reason
  is my reading of "its … type … supported". The words "on this object" may mean that the object counts as well.
  Two things were changed at once, the type and the name. The second deploy found no error in the flow, and does
  not say which of the two it was.
- `Invoice_Before_Save`: the words that came out: "field … unknown (When the … field is set to … the … field …
  supported.)". The flow was not changed on a guess. The tool that deploys got a form for such a message, written
  from those words, and the second deploy, on the same day, printed it:
  `field integrity exception: unknown (When the TriggerType field is set to "RecordBeforeSave", the $Record.Account__r.Is_Key_Account__c field isn't supported.)`
  That path stood in the formula `Default_Tax_Rate` and nowhere else in the flow. The message says that this one
  path is not supported in a flow that runs before the save, and not why. Three readings fit it: a formula of
  such a flow may not cross a relationship from `$Record`, or the path may not end at a formula field, which
  `Is_Key_Account__c` is, or no path across a relationship is supported and Salesforce names one problem of a flow
  at a time. The formula now reads `Tax_Code_Name__c`, a text field of the invoice itself, which the first two
  readings allow, and the flow no longer refers to `Account.Is_Key_Account__c`. A formula of a flow that crosses a
  relationship is left in the process only (`Invoice_Sent_Process`). Three other paths across a relationship stand
  in the flow, in two assignments and in a decision, none of them to a formula field. The third deploy accepted
  them, with the custom error and the formula the flow starts by, so the third reading is ruled out.

The second deploy counted 118 components, found no error in 117 and refused that one flow. **The third deploy, on
the same day, took all 118, and the project is in the test org.** What Salesforce accepted with it, as far as one
org says anything: the process of the Process Builder and the workflow rules, which the setup pages no longer
create, the time trigger of a workflow rule and the scheduled path of a flow, and the outbound message with the
user of the login in the place of the made-up user name (`integration.user@billing-fixture.invalid`).
`docs/research/phase-2/real-org.md` has the runs and what the org says about the project.

Three things are not as a person would build them, and Salesforce accepted them. `Get_Invoice` of the
screen flow stores five fields of the invoice, and later elements read four others of the same record. The flow
would show nothing for them when it runs. The screen has a field of the record and a choice for the same thing,
the tax code, of which the update takes the choice. And `Save_Invoice` writes `Amount__c` back as `Get_Invoice`
read it, since no field of the screen changes it any more. For an analysis that reads the file none of them makes
a difference.

The tool that deploys can also send `Invoice_Recalculate` once more, in a step of its own, as a draft that reads
`Paid_Date__c` where the file here reads `Due_Date__c`, so that the test org holds an active version of a flow and
a newer draft (`docs/live-org-setup.md`). The key is about the file here, which the project sends as the active
version. Asked for the flow by its name, the org hands out the draft after that step, so the key does not
describe that flow as the test org hands it out for its name since 23 November 2026: it lacks the reference to
`Paid_Date__c`. Asked for the name with the number of the active version, the org hands out the version the key
is about (`docs/research/phase-2/real-org.md`).

## The answer key

The key was written by hand, by reading the files, before any analyser existed. It is the measure analysers are
scored with, so it must not be produced by one. Change it by hand, in the same pull request as the file it
describes, and never to make an analyser pass.

It has six parts:

- `components`: what the project contains, by type and full name.
- `standard`: targets that Salesforce provides, such as `Account` or the `Name` of an invoice. They have no file here.
- `unreferenced`: the fields of the project that nothing refers to.
- `references`: the expected references, grouped by file and by the member they start from.
- `negatives`: places where a reference to a named target must never be reported.
- `unknowns`: places where the target cannot be known from the source, and an analyser has to say so. There is one
  entry for each name whose target is not known.

One reference looks like this:

```yaml
- file: force-app/main/default/classes/InvoiceService.cls
  phase: 3
  members:
    - from: ApexClass:invoiceservice#method:markpaid(id)
      refs:
        - { line: 21, match: Invoice__c, nth: 2, kind: reads, to: CustomObject:invoice__c, via: soql }
        - { line: 25, match: Status__c, kind: writes, to: CustomField:invoice__c.status__c, via: field }
        - { line: 27, match: update, kind: writes, to: CustomObject:invoice__c, via: dml, op: update }
```

| Field              | Meaning                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`             | The component key of the member the reference starts from: a method, a property, a field, a rule.                                                         |
| `line`, `match`    | Where it stands: the whole word `match` on that line. The column is worked out from the file.                                                             |
| `nth`              | Which occurrence of the word on the line, when there are several. Default `1`.                                                                            |
| `kind`             | `reads`, `writes`, `references`, `extends`, `triggers-on` or `calls`.                                                                                     |
| `to`               | The component key of the target.                                                                                                                          |
| `via`              | How the source names the target, see below.                                                                                                               |
| `tier`             | `confirmed` (default), `probable` or `possible`.                                                                                                          |
| `op`               | For a DML statement: `insert`, `update`, `upsert`, `delete`, `undelete`, `merge`. For a record element of a flow: `lookup`, `create`, `update`, `delete`. |
| `stretch`          | `true` for a reference that is hard to find. Missing it costs no recall, finding it costs no precision.                                                   |
| `note`             | Why the entry is there, for the reader.                                                                                                                   |
| `phase` (per file) | The roadmap phase whose analyser must find it: `1` for fields and rules, `2` for flows, workflow rules and the other metadata of Phase 2, `3` for Apex.   |

Values of `via`: `formula`, `filter`, `summary`, `lookup`, `display-field`, `controlling-field` and `value-set` in
the files of fields and rules; `field` (plain field access), `soql`, `sosl`, `dml`, `token` (a field or object token,
or a describe call), `text` (a name that stands in text: a query built as a string, or `get` and `put` by name) and
`declaration` in Apex. The files of Phase 2 have these more:

| `via`          | Where the name stands                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `object`       | The object of a record element, of a start block or of a choice set.                                                                                                                                 |
| `record`       | The resource a record element writes or deletes (`inputReference`): the reference is to its object.                                                                                                  |
| `path`         | A reference of a flow that is no merge field: `$Record.Account__r.Tier__c` in a condition, or the field an assignment element writes. Also the relationship a field update on a parent goes through. |
| `merge-field`  | `{!...}` in a text: a message, a display text, a text template, the body of an email template.                                                                                                       |
| `assignment`   | The field a record element of a flow sets by its name (`inputAssignments`), and the field a field update writes.                                                                                     |
| `output`       | A field a query of a flow asks for or stores.                                                                                                                                                        |
| `sort`         | The field a query or a choice set is sorted by.                                                                                                                                                      |
| `time`         | The date field a scheduled path, a time trigger or the due date of a task counts from.                                                                                                               |
| `action`       | What a flow or a workflow rule starts: an Apex class, a subflow, an alert, a field update, an outbound message, a task.                                                                              |
| `template`     | The email template of an alert.                                                                                                                                                                      |
| `listed-field` | A field in a list: of a field set, of an outbound message, of the recipients of an alert, of the picklists of a record type, of the values of a record of a custom metadata type.                    |
| `value`        | A value of such a record in a field that is a relationship to the definition of a field or of an object.                                                                                             |
| `record-of`    | The type a record of a custom metadata type is of.                                                                                                                                                   |

`formula` is also the formula of a flow and of a workflow rule, `filter` also a line of a filter of a flow and a
criteria line of a workflow rule, and `display-field` also the field a custom error of a flow is shown at. `text`
is also a value of a record of a custom metadata type that is exactly the name of a field, and a value that a
condition of a flow compares with the name of a record type.

### What is keyed

Within these rules the key is complete: an analyser that reports a reference of these kinds that the key does not
have is wrong.

- Every use of a field in a formula, a filter, a roll-up, a query, a search or Apex code, as `reads` or `writes`.
  `a.X__c += 1` is one of each.
- A step through a relationship is a read of the lookup field: `Account__r.Tier__c` reads `Invoice__c.Account__c` and
  `Account.Tier__c`. A child relationship (`Lines__r`) is a `references` to the lookup field that defines it.
- The object after `FROM`, in a sub-query, in `RETURNING` and after `WHEN` in a `TYPEOF` is a `reads` of the object.
- A DML statement is a `writes` of the object, located at its keyword. `Database.upsert(...)` and the other methods
  of `Database` that write records count as DML statements, located at the name of the method.
- Field and object tokens, describe calls, the external id of an `upsert`, the target of a lookup, the field a
  validation rule shows its message at, and the key of a roll-up are `references`.
- `get` and `put` with a field token are a read and a write of the field, `via: token` and `confirmed`: the compiler
  has checked the token.
- `extends` to a class of the project, and the object of a trigger.
- A field behind a global variable of a formula is a `reads` of that field: `$Setup.Billing_Settings__c.Grace_Days__c`
  reads the field of the custom setting, `$User.Department` the field of the user, `$Profile.Name` the name of the
  profile. The same holds for `$UserRole` and `$Organization`, and for a field that `VLOOKUP` names
  with `$ObjectType.Tax_Code__c.Fields.Rate__c`.
- `$CustomMetadata.Billing_Rule__mdt.Default.Max_Amount__c` is a `reads` of the field of the type and a `references`
  to the record `Default`. `$Label` and `$Permission` are a `references` to the label and to the permission.
- The default value of a field is a formula, `via: formula`. The controlling field of a dependent picklist and the
  global value set of a picklist are `references`, `via: controlling-field` and `via: value-set`.
- A name that stands in text is `probable` when the object is known. When the object is known and the field comes
  from a variable, the reference goes to the object and is `possible`. When the object is not known, the place is an
  unknown, also if the name of the field is a literal: `record.get('Risk_Score__c')` on a record of unknown type
  names no target, even while only one object has a field of that name.
- The place of a name in text is the word in the expression that builds the text: the name inside the literal, or
  the name of the constant or variable that is joined in. It is not the place where a constant is declared, and not
  the call that runs the query.

Two references are different references when they stand at different places. The place, with its column, is part of
what a reference is: `'... FROM Invoice__c ORDER BY ' + fieldName` holds a `probable` read of the object at
`Invoice__c` and a `possible` one at `fieldName`.

### What is not keyed

- The field `Id`. It cannot be changed or deleted.
- The use of an object as a type: declarations, casts, `new`, `instanceof`, and `when` in a `switch`.
- An object that only qualifies a field (`Invoice__c.Amount__c` is a reference to the field).
- In Apex, every reference to an Apex class or to a member of one, except `extends`: calls between methods, the
  use of a constant of another class, `new` of a class. System classes and interfaces. A flow that calls a class
  is keyed.
- Picklist values and named credentials.
- The object behind a global variable or in `$ObjectType`, and the custom metadata type in `$CustomMetadata`: the
  reference goes to the field, as it does for `Invoice__c.Amount__c` in Apex.
- The hierarchy field of the user names no object in its file, so it has no entry of its own. A formula that goes
  through it reads it.
- The global variables that name nothing that can change: `$Api`, `$System`, `$Flow`.
- In a flow: the object a variable is declared with, the name of an action beside the name that is keyed, and
  the object in the name of an alert (`Invoice__c.Invoice_Overdue_Alert` is a reference to the alert).
- In a file of workflow rules: a recipient or an assignee that is the owner of the record, which names no field
  in its file. In the name of an email template, the folder (`Billing/Invoice_Overdue` is a reference to the
  template).
- The name of a record type in the text of a formula of a field or of a rule
  (`$RecordType.DeveloperName = 'Credit_Note'`). No phase reads a text of such a formula for a name yet. The
  place has no negative either, so a report of it is counted neither for nor against an analyser. Whether it
  should be keyed is a question for the maintainer.

Version 0 of the key did not key global variables. Version 1 does, also in the rule of Phase 0 that names
`$Profile.Name`. Version 2 adds what Phase 2 reads. Everything of an older version is in the next one unchanged,
and the Apex part is the same entry for entry in all three: the check compares the files.

Later versions of the fixture add components and permissions with the phases that read them, and references
between Apex classes with the Apex phase.

### What is keyed in the files of Phase 2

- A reference of a flow starts from the element or the resource it stands in: `Flow:invoice_before_save#element:
check_amount`. The start block with its scheduled paths is `#element:flow-start`. What stands outside every
  element starts from the flow. A reference of a file of workflow rules starts from the rule or the action it
  stands in, each of which is a component of its own.
- The object of a record-triggered flow or of a process is `triggers-on`. The object of an element that reads,
  creates, updates or deletes records is `references` with the `op` of the element. So is the object of a flow
  that runs on a schedule, with `op: lookup`: it reads the records it runs for.
- A subflow and an Apex action are `calls`, from the element to the flow or to the class. An email alert a flow
  sends is a `references` to the alert. The actions of a workflow rule and of its time triggers are `references`
  from the rule: to a field update, an alert, an outbound message and a task.
- A field a flow or a field update sets is `writes`. A field an assignment adds to or subtracts from is one of
  each, and so is a field of a record that a screen shows for input.
- A step through a relationship is a read of the lookup field, as in a formula. `$Record.Account__r` as the record
  an element updates is a read of the lookup field and a `references` to the object behind it.
- The field of a field set, of a recipient of an alert and of an outbound message is `reads`. The picklist of a
  record type and the field a record of a custom metadata type gives a value for are `references`.
- A record of a custom metadata type is a `references` to its type. No element of its file names the type, so
  the place is the root element of the file.
- A value of such a record in a field that is a relationship to a definition is `confirmed`, `via: value`. For an
  object the value is its name. For a field it is the name of the field alone, as Salesforce stores it: the
  object is the value the record gives the controlling field of the relationship, which the file of the field
  names. A value in a text field is `probable`, `via: text`, when it is exactly `Object.Field`, or exactly the
  name of a field of an object the same record names. A name inside a sentence is not keyed, and has a negative.
- A value that a condition compares with `RecordType.DeveloperName` is a `probable` reference to the record type
  of that name.

### What is marked as stretch

An entry is `stretch` when finding it needs one of three things, and for no other reason:

- following a value through a local variable or a collection: a list of names joined into a query, an object that
  reaches a describe call through two variables;
- knowing where a relationship that Salesforce provides points, which no file of the project says: that the
  manager of a user is a user, the owner of an account a user, the parent of an account an account, and the
  record type of an invoice a record type;
- knowing a name that only the formula language has for a standard field: `Owner:Queue.QueueName` is the name of
  a group.

Where a file of the project or the formula itself says where a relationship points, the entry is not stretch: a
hierarchy field points at a user, and `Owner:User` takes the owner as a user.

Fewer than 3 in 100 entries may be stretch. The check counts them.

A name held in a constant of another class is not stretch: following a constant is a requirement. Nine of the 181
Apex entries that are not stretch need it. That is just under 5 percent, so an analyser that cannot follow a constant
is at the edge of the pass mark for recall on this count alone. How the entries are weighed is fixed with the
scoring harness of the Apex trial.

## The check

`packages/engine/test/fixture-key.test.ts` runs with the other tests on all three operating systems. It needs no
analyser. It checks that:

- the components the key lists are exactly the ones the Salesforce source library finds in the folder, and no file
  of the project is left without a component;
- every place exists: the line has the word, as a whole word, as often as `nth` says;
- every reference and every unknown starts from the member its line belongs to. The members are read from the
  declarations of the file, with their signatures;
- every reference points at a component of the project or at a listed standard target;
- no place is in a comment, and each place is in the kind of text its entry says: in a query, in a literal, in code;
- every place of a field or a rule stands directly in the element its entry says (a formula, a line of a filter, a
  roll-up, the target of a lookup), not just somewhere inside it, and a place in a formula stands in no comment and
  in no text of it;
- the kind of such an entry follows from its place: `reads` for a field in a formula, in a line of a filter and as
  the field a roll-up sums, `references` for everything else;
- the word of an entry stands for its target: it is its name, a DML keyword, a child relationship of the project, or
  a constant of the project whose value holds the name. Only a name that comes from a variable is `possible`;
- the kind fits: a plain field access is a write exactly when an assignment follows it, `extends` points at a class,
  and the name of an object in front of a variable is not taken for a reference;
- the list of unreferenced fields is the list of fields no entry points at;
- no reference contradicts a negative or an unknown, a negative names a known object and the word on its line, and
  the tiers and operations follow the rules above;
- every reference of a flow or of a file of workflow rules starts from the element, the rule or the action its line
  stands in, and stands in an element of the kind its `via` says. A merge field stands between `{!` and `}`;
- the operation of an entry for a record element is the one of the element, and `calls` and `triggers-on` point at
  what they can point at;
- a value of a record of a custom metadata type is `value` in a field that is a relationship and `text` in every
  other field, the object of a process is the value at the top of its file, and a text that names a record type
  is compared with `RecordType.DeveloperName`;
- the numbers this page quotes are the numbers of the key: 491 references (112 in fields and rules, 195 in the
  files of Phase 2, 184 in Apex), 9 of them stretch, 63 negatives and 6 unknowns;
- versions 0 and 1 of the key still name places that exist, have nothing that version 2 has not, and have the same
  Apex part. Version 2 says nothing else about a file of fields or rules than version 1 does;
- the three flows of `flow-negative/` are what their `expected.yaml` says, as far as text can tell: the places
  exist, the XML reader of the engine reads two of them and refuses the third, every reference starts from the
  element its line stands in and follows the rules above for its element, its kind and its operation, and the
  element of an unknown kind is one no flow of the project has.

When a line of the project moves, the check fails and names the entry. The files of the project are stored with LF
line endings on every system and are not formatted by Prettier, because the key records their lines.

The check reads the files only as text. It cannot tell which of two objects a field of the same name belongs to,
which object a DML statement writes, whether an entry deserves its stretch mark, or whether an entry is missing.
That is what the second reading of the key and the code review are for. Of 20 defects planted in version 0 of the
key one at a time, the check found 17. The three it let pass are of these kinds. No defect was planted in the
entries that version 1 added.

For version 2 the code review planted twelve defects, one at a time, in the entries of Phase 2 and in
`flow-negative/`, and the check let seven of them pass. Its rules were made stricter for those seven. I then
planted thirteen, the seven among them: a wrong operation on three kinds of record element, a text keyed as a
value and a value as a text, a filter field keyed as a field a query stores, the object of a process keyed in a
formula, the file that must not be read made into XML, and five in `expected.yaml` of `flow-negative/`. The check
refuses each of the thirteen. What it still cannot tell for these files:

- which object a field of the same name belongs to, and whether an entry is missing;
- whether a field in a filter, in an output assignment or in a path is of the object the key says. It checks the
  word and the element, not the record the element is about;
- for `via: record`, it takes a relationship `X__r` to lead to the object `X`, which holds for the one relationship
  the key has such an entry for, to a standard object, and for no custom one.

The code review read every entry of Phase 2 against its file and found none wrong and none missing. Besides that
reading, nobody but me has read them.

### What the project does not cover

- A value of a record of a custom metadata type that is the bare name of a field, in a record that names no
  object. By the plan it is no reference. No record has such a value, so nothing here forbids an analyser to guess
  from the name alone. The tests of that analyser have to hold the case.
- A workflow rule whose name has spaces, and one with a filter logic. Both are common in real orgs.
- The unknown in `Invoice_After_Save`, at the output of the subflow, can be known from the other flow. It is an
  unknown because no phase follows a subflow yet. The entry changes when one does.

## Formula probes

`formula-probes.yaml` holds 178 small formulas: one for every operator, every kind of literal, every kind of name
and every function. A parser of formulas must read each without a problem. Each probe lists by hand the names its
formula holds, and `packages/engine/test/formula-fixtures.test.ts` compares that list with what a simple scan of
the text finds. `extraction-formula.test.ts` reads each probe with the reader of the engine.

- The operators, the literals and the characters of a name are taken from the grammar of the open-source formula
  engine of Salesforce (`github.com/salesforce/formula-engine`, commit `118bbca8`).
- The 104 functions are the ones the help page "Formula Operators and Functions by Context" lists. The page was
  fetched on 15 November 2026, and the fetch gave only its first two thirds as written. Of the 104 names, 85 were
  read as written. 17 stand only in a summary of the rest of the page and also in the formula engine. Two,
  `PICKLISTCOUNT` and `TRUNC`, stand only in that summary. Each probe says where its name was seen.
- The probes are not deployed, so Salesforce has not checked them. The kinds of their arguments are plausible and
  not verified. Nine functions are marked as not usable in a field or a rule, from the same summary.
- One thing has no probe: a text that runs over two lines. The grammar of the engine refuses it and the formula
  editor of Salesforce may accept it. Which holds is not verified, so no file here takes a side.

## Merge-field probes

`merge-field-probes.yaml` holds 41 small texts and 33 small formulas as a flow writes them, with merge fields:
`{!varInvoice.Name}`. Each text lists by hand what stands in each of its merge fields, how many are not closed,
and which are not read as a name. Each formula lists its names, and which of them stand outside braces.
`packages/engine/test/extraction-merge-fields.test.ts` reads each probe with the readers of the engine, and holds
the list of each text against what a regular expression finds.

- The probes cover what the plan of Phase 2 asks for: a merge field at the start and at the end of a text, two in
  a row, one that is not closed, and a brace that is no merge field.
- The file says what the first name of a merge field is in the probes, as a flow knows it of its resources: a
  record of `Invoice__c` or of `Invoice_Line__c`, or a value that is no record.
- The probes are not deployed, so Salesforce has not checked them. Three things in them are not verified, and
  each probe of them says so in a note: white space in the braces, a name outside braces in a formula of a flow,
  and a merge field in a text of such a formula.
- A merge field of an email template or of a page may hold a whole formula. One probe shows that it is found
  and not read. Nothing else of that kind is probed.

## Formulas that cannot be deployed

`formula-negative/` holds nine fields and one rule of `Invoice__c` in the layout of the project, and
`expected.yaml`, which says of each whether its formula parses and what is expected of the names in it. Five
formulas do not parse. Five name something that is not there: a field, a relationship, a field of the parent, a
label, and two fields of a package. No file has the name of a file of the project, so a test lays the folder over a
copy of the project (`extraction-analyse-formula.test.ts`). They are written so that Salesforce refuses them, which
is not verified: none was sent to Salesforce.

## Flows that cannot be deployed

`flow-negative/` holds three flows in the layout of the project, and `expected.yaml`, which says what is expected
of each. One names fields, a relationship, an object and a resource that do not exist, beside names that do. One
holds an element of a kind that no flow has, with merge fields in it. One ends in the middle of an element. No file
has the name of a file of the project, so a test lays the folder over a copy of the project. They are written so
that Salesforce refuses them, which is not verified: none was sent to Salesforce. The test of the analyser of
flows (`packages/engine/test/extraction-flows.test.ts`) reads them, and holds what it finds against
`expected.yaml`. It finds one unresolved name more than that file lists: the field that an element sets on the
object that does not exist.

## Public codebases

`corpora.toml` lists four public codebases with their repository, licence and a full commit id. `pnpm run
corpora:fetch` downloads each at that commit into `.corpora`, which Git ignores. No file of them is stored in this
repository. No test needs them. They are for measurements: robustness, speed and memory of the parsers, and samples
that are checked by hand. `pnpm run corpora:listing` prints what such a check reads: every formula field, default
value, validation rule, lookup filter and roll-up summary with the references OrgLens reports for it. `pnpm run
bench:corpora` times the commands on them ([`bench/README.md`](../bench/README.md)).
