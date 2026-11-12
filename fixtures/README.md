# Fixtures

Test data that is shared by the whole repository. Everything here was written for OrgLens. Nothing comes from a real
org, and nothing is copied from another project.

| Path                          | What it is                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `billing-sfdx/`               | A small Salesforce project in source format: invoices, their lines, and Apex.       |
| `expected/answer-key.v0.yaml` | The answer key: every reference an analyser must find in the project.               |
| `parser-negative/`            | Apex files that do not compile, for tests of error recovery. Not part of a project. |
| `corpora.toml`                | Public codebases, pinned by commit, that are downloaded on demand.                  |

The decision behind the format is [record 0029](../docs/adr/0029-fixture-and-answer-key.md).

## The project

`billing-sfdx` has 52 components: 2 custom objects (`Invoice__c`, `Invoice_Line__c`), 31 custom fields on them and on
`Account`, 6 validation rules, 12 Apex classes and 1 trigger. It is small on purpose. Each file is there for a case
that an analyser can get wrong:

- formulas on formulas, across a lookup, through the owner, with a comment and with a field name inside text;
- two roll-up summaries and a lookup filter;
- an inactive validation rule, and a rule that names a field only in its message;
- a field `Status__c` on both objects, and a lookup field `Invoice__c` that is named like the object;
- queries with fields in `SELECT`, `WHERE`, `ORDER BY`, `GROUP BY` and `HAVING`, a sub-query, an aggregate with
  aliases, `TYPEOF`, a search, and queries built as text from literals, from constants of another class and from
  parameters;
- `get` and `put` by name, each with a literal, a constant, a field token and a variable;
- a trigger with a handler class, an inner class, a property with a body, `switch on` a record, and a local
  variable that is named like an object;
- `Unused_Field__c`, which nothing refers to. Its name stands in comments and in text only.

The project is valid as far as the Salesforce source library can tell: the check resolves every file to a component.
**It has not been deployed to an org yet**, so nothing proves that the Apex compiles or that its test passes. The
live-org workflow, which is built later in Phase 0, will deploy it. What that finds is fixed here.

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

Values of `via`: `formula`, `filter`, `summary`, `lookup` and `display-field` in metadata files; `field` (plain field
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
- Global variables in formulas (`$User`, `$Profile`), picklist values and named credentials.

Later versions of the fixture add flows, custom metadata, components and permissions with the phases that read them,
and references between Apex classes with the Apex phase.

### What is marked as stretch

An entry is `stretch` when finding it needs one of two things, and for no other reason:

- following a value through a local variable or a collection: a list of names joined into a query, an object that
  reaches a describe call through two variables;
- knowing where a relationship of a standard object points, which no file of the project says: that the manager of
  a user is a user.

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
- the word of an entry stands for its target: it is its name, a DML keyword, a child relationship of the project, or
  a constant of the project whose value holds the name. Only a name that comes from a variable is `possible`;
- the kind fits: a plain field access is a write exactly when an assignment follows it, `extends` points at a class,
  and the name of an object in front of a variable is not taken for a reference;
- the list of unreferenced fields is the list of fields no entry points at;
- no reference contradicts a negative or an unknown, a negative names a known object and the word on its line, and
  the tiers and operations follow the rules above;
- the numbers this page quotes are the numbers of the key: 228 references (44 in fields and rules, 184 in Apex), 4
  of them stretch, 21 negatives and 5 unknowns.

When a line of the project moves, the check fails and names the entry. The files of the project are stored with LF
line endings on every system and are not formatted by Prettier, because the key records their lines.

The check reads the files only as text. It cannot tell which of two objects a field of the same name belongs to,
which object a DML statement writes, whether an entry deserves its stretch mark, or whether an entry is missing.
That is what the second reading of the key and the code review are for. Of 20 defects planted in the key one at a
time, the check found 17. The three it let pass are of these kinds.

## Public codebases

`corpora.toml` lists three public codebases with their repository, licence and a full commit id. `pnpm run
corpora:fetch` downloads each at that commit into `.corpora`, which Git ignores. No file of them is stored in this
repository. No test needs them. They are for measurements: robustness, speed and memory of the parsers, and samples
that are checked by hand.
