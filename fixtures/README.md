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
- queries in every clause, a sub-query, an aggregate with aliases, `TYPEOF`, a search, and queries built as text
  from literals, from constants of another class and from parameters;
- `get` and `put` by name with a literal, a constant, a field token and a variable;
- a trigger with a handler class, an inner class, a property with a body, `switch on` a record, and a local
  variable that is named like an object;
- `Unused_Field__c`, which nothing refers to. Its name stands in comments and in text only.

The project is valid as far as the Salesforce source library can tell: the check resolves every file to a component.
**It has not been deployed to an org yet**, so nothing proves that the Apex compiles. The live-org workflow of Phase 0
deploys it, and what it finds is fixed here.

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
- `unknowns`: places where the target cannot be known from the source, and an analyser has to say so.

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
| `op`               | For a DML statement: `insert`, `update`, `upsert`, `delete`.                                            |
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
- The object after `FROM`, in a sub-query, in `RETURNING` and after `WHEN` is a `reads` of the object.
- A DML statement is a `writes` of the object, located at its keyword.
- Field and object tokens, describe calls, the external id of an `upsert`, the target of a lookup, the field a
  validation rule shows its message at, and the key of a roll-up are `references`.
- `extends` to a class of the project, and the object of a trigger.
- A name that stands in text is `probable` when the object is known, and is keyed where the text is used, not where
  a constant is declared. When the object is known and the field comes from a variable, the reference goes to the
  object and is `possible`.

### What is not keyed

- The field `Id`. It cannot be changed or deleted.
- The use of an object as a type: declarations, casts, `new`, `instanceof`, `when`.
- An object that only qualifies a field (`Invoice__c.Amount__c` is a reference to the field).
- Calls between methods, and system classes and interfaces.
- Global variables in formulas (`$User`, `$Profile`), picklist values and named credentials.

Later versions of the fixture add flows, custom metadata, components and permissions with the phases that read them,
and calls with the Apex phase.

## The check

`packages/engine/test/fixture-key.test.ts` runs with the other tests on all three operating systems. It needs no
analyser. It checks that:

- the components the key lists are exactly the ones the Salesforce source library finds in the folder;
- every place exists: the line has the word, as a whole word, as often as `nth` says;
- every reference starts from a member of the component that owns the file, and points at a component of the
  project or at a listed standard target;
- the list of unreferenced fields is exactly right;
- no reference contradicts a negative or an unknown, and the tiers and operations follow the rules above;
- the numbers this page quotes are the numbers of the key: 226 references (44 in fields and rules, 182 in Apex, 5 of
  them stretch), 15 negatives and 3 unknowns.

When a line of the project moves, the check fails and names the entry. The files of the project are stored with LF
line endings on every system and are not formatted by Prettier, because the key records their lines.

The check cannot tell whether the key is _right_: that an entry is a read and not a write, or that nothing is
missing. That is what the second reading of the key and the code review are for.

## Public codebases

`corpora.toml` lists three public codebases with their repository, licence and a full commit id. `pnpm run
corpora:fetch` downloads each at that commit into `.corpora`, which Git ignores. No file of them is stored in this
repository. No test needs them. They are for measurements: robustness, speed and memory of the parsers, and samples
that are checked by hand.
