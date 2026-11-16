# Fixtures

Test data that is shared by the whole repository. Everything here was written for OrgLens. Nothing comes from a real
org, and nothing is copied from another project.

| Path                          | What it is                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `billing-sfdx/`               | A small Salesforce project in source format: invoices, their lines, and Apex.       |
| `expected/answer-key.v1.yaml` | The answer key: every reference an analyser must find in the project.               |
| `expected/answer-key.v0.yaml` | The key of Phase 0, kept as the key the Apex trial was scored with.                 |
| `formula-probes.yaml`         | One small formula for every operator, literal and function, to test a parser with.  |
| `formula-negative/`           | Fields and a rule whose formulas cannot be deployed, and what is expected of them.  |
| `parser-negative/`            | Apex files that do not compile, for tests of error recovery. Not part of a project. |
| `corpora.toml`                | Public codebases, pinned by commit, that are downloaded on demand.                  |

The decision behind the format is [record 0029](../docs/adr/0029-fixture-and-answer-key.md).

## The project

`billing-sfdx` has 87 components: 5 custom objects, 54 custom fields on them, on `Account` and on `User`, 10
validation rules, 12 Apex classes and 1 trigger, and five components that are only there to be referred to: the
file of custom labels with one label, a record of a custom metadata type, a custom permission and a global value
set. Three of the objects are targets too: a custom setting, a custom metadata type and `Tax_Code__c`. It is small
on purpose. Each file is there for a case that an analyser can get wrong:

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

- the rule `Void_Needs_Admin`, which compared `$RecordType.Name`. `Invoice__c` has no record type. The line is
  removed, so the project has no `$RecordType` any more. A probe still has it.
- the field `Region__c`, whose default value was `TEXT($User.Billing_Region__c)`. Salesforce reported no problem
  for the formula field `Is_My_Region__c`, which holds the same call. The default value is now `$User.Department`.

The log of the refused run did not show what Salesforce said about the two, because its messages had no form the
step knew. **Why each was refused is therefore my reading, and not verified.** That Salesforce accepts the
corrected files shows that they are valid, and not that the reading is right. The step now shows the everyday
words of such a message.

What the runs showed, and which pairs of the key the Dependency API reports (129 of 189), is in
[`real-org.md` of Phase 1](../docs/research/phase-1/real-org.md).

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

| Field              | Meaning                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `from`             | The component key of the member the reference starts from: a method, a property, a field, a rule.       |
| `line`, `match`    | Where it stands: the whole word `match` on that line. The column is worked out from the file.           |
| `nth`              | Which occurrence of the word on the line, when there are several. Default `1`.                          |
| `kind`             | `reads`, `writes`, `references`, `extends` or `triggers-on`.                                            |
| `to`               | The component key of the target.                                                                        |
| `via`              | How the source names the target, see below.                                                             |
| `tier`             | `confirmed` (default), `probable` or `possible`.                                                        |
| `op`               | For a DML statement: `insert`, `update`, `upsert`, `delete`, `undelete`, `merge`.                       |
| `stretch`          | `true` for a reference that is hard to find. Missing it costs no recall, finding it costs no precision. |
| `note`             | Why the entry is there, for the reader.                                                                 |
| `phase` (per file) | The roadmap phase whose analyser must find it: `1` for fields and rules, `3` for Apex.                  |

Values of `via`: `formula`, `filter`, `summary`, `lookup`, `display-field`, `controlling-field` and `value-set` in
metadata files; `field` (plain field
access), `soql`, `sosl`, `dml`, `token` (a field or object token, or a describe call), `text` (a name that stands in
text: a query built as a string, or `get` and `put` by name) and `declaration` in Apex.

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
- Every reference to an Apex class or to a member of one, except `extends`: calls between methods, the use of a
  constant of another class, `new` of a class. System classes and interfaces.
- Picklist values and named credentials.
- The object behind a global variable or in `$ObjectType`, and the custom metadata type of a record: the reference
  goes to the field, as it does for `Invoice__c.Amount__c` in Apex.
- The hierarchy field of the user names no object in its file, so it has no entry of its own. A formula that goes
  through it reads it.
- The values a record of a custom metadata type holds. They are read with flows, in Phase 2.
- The global variables that name nothing that can change: `$Api`, `$System`.

Version 0 of the key did not key global variables. Version 1 does, also in the rule of Phase 0 that names
`$Profile.Name`. Everything else of version 0 is in version 1 unchanged, and the Apex part is the same entry for
entry: the check compares the two files.

Later versions of the fixture add flows, components and permissions with the phases that read them, and references
between Apex classes with the Apex phase.

### What is marked as stretch

An entry is `stretch` when finding it needs one of three things, and for no other reason:

- following a value through a local variable or a collection: a list of names joined into a query, an object that
  reaches a describe call through two variables;
- knowing where a relationship of a standard object points, which no file of the project says: that the manager of
  a user is a user, the owner of an account a user, and the parent of an account an account;
- knowing a name that only the formula language has for a standard field: `Owner:Queue.QueueName` is the name of
  a group.

Where a file of the project or the formula itself says where a relationship points, the entry is not stretch: a
hierarchy field points at a user, and `Owner:User` takes the owner as a user.

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
- the numbers this page quotes are the numbers of the key: 290 references (106 in fields and rules, 184 in Apex), 7
  of them stretch, 31 negatives and 5 unknowns;
- version 0 of the key still names places that exist, has nothing that version 1 has not, and has the same Apex
  part.

When a line of the project moves, the check fails and names the entry. The files of the project are stored with LF
line endings on every system and are not formatted by Prettier, because the key records their lines.

The check reads the files only as text. It cannot tell which of two objects a field of the same name belongs to,
which object a DML statement writes, whether an entry deserves its stretch mark, or whether an entry is missing.
That is what the second reading of the key and the code review are for. Of 20 defects planted in version 0 of the
key one at a time, the check found 17. The three it let pass are of these kinds. No defect was planted in the
entries that version 1 added.

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

## Formulas that cannot be deployed

`formula-negative/` holds nine fields and one rule of `Invoice__c` in the layout of the project, and
`expected.yaml`, which says of each whether its formula parses and what is expected of the names in it. Five
formulas do not parse. Five name something that is not there: a field, a relationship, a field of the parent, a
label, and two fields of a package. No file has the name of a file of the project, so a test lays the folder over a
copy of the project (`extraction-analyse-formula.test.ts`). They are written so that Salesforce refuses them, which
is not verified: none was sent to Salesforce.

## Public codebases

`corpora.toml` lists three public codebases with their repository, licence and a full commit id. `pnpm run
corpora:fetch` downloads each at that commit into `.corpora`, which Git ignores. No file of them is stored in this
repository. No test needs them. They are for measurements: robustness, speed and memory of the parsers, and samples
that are checked by hand.
