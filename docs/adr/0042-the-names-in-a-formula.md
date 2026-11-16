# 0042. A reader of our own for formulas, and what a name in a formula stands for

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (the formulas of work package 5 of the Phase 1 plan)

## Context

The analysis of record [0041](0041-components-and-names-written-in-xml.md) reads the names that are written in
XML. The formula of a field, its default value and the condition of a validation rule are text in another
language, and it read none of them. Work package 5 of the [Phase 1 plan](../plans/phase-1.md) asks for a
tokenizer and a parser of that language, a resolver that walks the names through the model of objects, the
global variables, the value a picklist is compared with, and for a formula that does not parse to be kept with
an issue and its names as `probable`.

Salesforce publishes no grammar of the language. Two things were at hand: the grammar of its open-source formula
engine, which `fixtures/formula-probes.yaml` names with its commit, and the help page that lists the functions.
Neither says what a formula field of an org accepts in every case, and nothing here was sent to Salesforce.

The plan fixes the outline, and the maintainer approved it. What follows under "Decision" fills it in, and the
points marked as choices of the author are the maintainer's to strike.

## Decision

`extraction/formula.ts` reads a formula into tokens and a tree, each with its place in the text.
`extraction/formula-names.ts` says what a name stands for as far as the name itself says it.
`extraction/objects.ts` gives every name its line and column in the file, and the names are resolved against
the model when every file was read, like the names written in XML. A reference of a formula has the origin
`parser:formula` and says `formula` in its attribute `via`.

These are choices of the author, sixteen in number.

How a formula is read:

1. **The tokens are those of the grammar of the engine**: names, numbers, texts, comments, operators, brackets
   and commas. A name starts with a letter or `$` and goes on with letters, digits, `_`, `$`, `:`, `.` and `#`.
   A text stands in double or single quotes, and a backslash keeps the character after it. A comment stands
   between `/*` and `*/`, and `\*/` does not end it. Two things are read more widely than the grammar says: a
   text may run over lines, and white space is everything Unicode calls white space, a no-break space among it.
   Nothing else can be meant by either, and a formula that Salesforce refuses is not in an org.
2. **A call is any name before a bracket.** The reader knows no function, no number of arguments and no kind of
   value, so a function that Salesforce adds does not break it. It knows three names, for choice 9.
3. **Operators bind in this order, the loosest first**: `||`, `&&`, the four signs of equality, the four of
   comparison, `+` `-` `&`, `*` `/`, `^`. Operators that bind alike are read from the left. The signs `-`, `+`
   and `!` before a value bind tightest, and so does `NOT` before a value without a bracket. The order is not
   verified against Salesforce, and no reference depends on it: only the names of a formula and the arguments
   of a call are taken from the tree.
4. **Brackets and calls may be nested 200 deep.** Deeper, the formula is not read as a whole. The deepest
   formula of the three public codebases is nested 6 deep.

A formula that is not read as a whole:

5. **It is kept, with a warning `FORMULA_NOT_READ`** that gives the first problem and its place in the file.
   The names among its tokens are recorded as `probable`: every name that no bracket follows and that is not
   `TRUE`, `FALSE`, `NULL` or `NOT`. A text or a comment that is not closed takes the rest of the formula with
   it. A character that is no part of a formula is left out, and the tokens after it are read. Without a tree
   the value of choice 9 is not known. In such a formula the name of a function that stands without its
   bracket is taken for a field.
6. **What the origin `parser:formula` counts.** Its components are those with at least one formula. A default
   value is a formula, so the `false` of a checkbox counts, and most components with a formula name nothing.
   Its files that failed are the files with a formula that was not read as a whole.

What a name stands for:

7. **A name without a variable is a path from the object of the formula.** Every relationship is a read of the
   field behind it, as in record 0041. Every reference of a formula is a `reads`, except those to a custom
   label, a custom permission, a record of a custom metadata type and an object, which are `references`.
8. **The field `Id` at the end of a path gives no reference.** It cannot be changed or deleted, and the answer
   key does not hold it. The relationships before it are read. This holds for a path written in XML too, which
   changes one point of record 0041: `$User.Id` in a lookup filter gave a reference to `User.Id`, and now gives
   none.
9. **The value a picklist is compared with is kept in the attribute `value`** of the reference to the field at
   the end of the path, for `ISPICKVAL` and `INCLUDES` with two arguments of which the second is a text, also
   when the first is `PRIORVALUE` of the field. The values of a `CASE` and of `TEXT(Status__c) = "Paid"` are
   not kept. Nothing uses the attribute in this phase.
10. **`Owner:User` is believed before the model.** The object after the colon is where the relationship leads.
    A queue is a group: `Owner:Queue.QueueName` reads `OwnerId` and the field `Name` of `Group`, and the
    reference keeps `QueueName` as the name that was written.
11. **`$User`, `$Profile`, `$UserRole` and `$Organization` are a path from that object. `$RecordType` is taken
    as a path from the object `RecordType`**, and `$Source` as one from the object of the formula, though only
    a lookup filter has that variable.
12. **`$Setup.Settings__c.Days__c` reads the field of the custom setting**, and
    `$ObjectType.Tax_Code__c.Fields.Rate__c` the field of the object, which is how `VLOOKUP` names its fields.
    The setting and the object are no reference of their own. `$ObjectType.Tax_Code__c` without a field is a
    `references` to the object: nothing else of the formula says that it depends on it.
13. **`$CustomMetadata.Rule__mdt.Standard.Limit__c` is a `references` to the record `Rule.Standard` and a read
    of the field of the type.** `$Label.X` and `$Permission.X` are a `references` to the label and to the
    permission. One that no file defines is `unresolved` without a key, or `external` when its name has the
    prefix of a package. A record of a type of a package that the project should hold and does not is called
    `external` by that rule, where `unresolved` would be right.
14. **`$Api` and `$System` give no reference and no issue.** They name nothing that can change.
15. **A name behind any other variable, or one that is not built like a name, is not read.** A warning
    `NAME_NOT_READ` gives its place and its first 60 characters, and the rest of the formula is read. `$Action`,
    `$SControl` and `$Resource` are of this kind: they belong to buttons and pages, whose formulas this phase
    does not read.
16. **`Level__pr` on an account is the relationship of the field `Level__pc`**, which is the field `Level__c`
    of the contact. Record 0041 left it out.

One change outside the two new files comes with this: `walkPath` in `extraction/model.ts` takes, for each name,
what the source says beyond the name: the object a relationship leads to, and the name a field has in metadata.

## Consequences

- On the fixture project the analysis finds the 106 references that the answer key holds for fields and
  validation rules: the 26 that are written in XML and 80 in formulas, each at the line and column the key
  says, and no other. The four that the key marks as a stretch are among them. No place where the key forbids
  a reference is hit, and no issue is raised. 34 components hold a formula or a default value.
- The 178 probes are read without a problem, each with the names it lists. Five names in them are not read as
  a name, all in probes for functions of buttons, pages and reports: `$SControl.Header_Snippet`,
  `$Action.Account.View` twice and `AMOUNT:SUM` twice.
- The ten formulas of `fixtures/formula-negative`, laid over the project, give what `expected.yaml` says: the
  five that do not parse give a warning and `probable` references, the names that nothing defines are
  `unresolved`, the names of a package `external`, and the name behind a relationship that does not exist is
  not followed.
- Every formula of the three public codebases is read as a whole: 1, 142 and 168 formulas and default values,
  of which 0, 65 and 16 are the formula of a field or the condition of a rule. A simple scan that is no parser
  finds the same names in each. They give 0, 387 and 58 references, of which 372 and 38 are `resolved` and 15
  and 20 `external`. None is `unresolved`, and no name is not read. One formula of NPSP goes four times
  through a lookup of another package, and no file says where that leads: four warnings `PATH_NOT_FOLLOWED`,
  and the four fields behind it have no reference. The analysis of the largest takes 0.3 to 0.9 seconds on one
  Linux machine, as before.
- The public formulas use little of the language: no comment, no `Owner:User`, and seven names behind a global
  variable in all (`$User` once, `$Setup` twice, `$Label` four times). What this record says about comments,
  about the colon and about the other variables rests on the fixture project, the probes and the tests, which
  the author wrote.
- "What refers to this field" now includes formula fields, default values and validation rules. A typing error
  in the name of a standard field is still not found, as record 0041 says: `Nmae` in a formula is `external`.
- A reference to a picklist field can say which value the formula compares it with. A rule about renaming a
  value can use it later, and has to know that it holds only what choice 9 lists.
- A name that is `unresolved` in a formula gives a reference without a key and no issue, like one written in
  XML. Work package 6 decides how coverage shows them.
- Not read: named arguments in square brackets, which old buttons use. The square bracket is no part of a
  formula for this reader, so such a formula gives a warning and `probable` names.
- Not read in this phase: every formula outside a field and a validation rule, such as those of flows,
  workflow rules, approval processes, buttons and reports.
- Not verified: the order of the operators, a text over lines, and whether Salesforce accepts each of the
  probes. The formulas of the fixture project are the exception: Salesforce accepted them when the project
  was deployed to the test org in work package 1. Nothing was deployed for this record, and nothing was run
  against a real org. The third pass mark of the plan, that no pair the Dependency API reports for a formula
  field or a rule is missing, is measured on the test org in work package 8. By the record of the run of work
  package 1, two rows of the API from a validation rule go to an object, which choice 12 and choice 13 do not
  make a reference of: the object in `$ObjectType` inside `VLOOKUP`, and the custom metadata type behind
  `$CustomMetadata`. The plan keeps that question for work package 8.
- Fifty-eight faults were planted in the code of this work package, one at a time. The tests noticed 56 at
  once and the other two after two expectations were added. A 59th showed a line that did nothing, which was
  removed.
- No command runs the analysis yet. Work package 6 adds `FORMULA_NOT_READ` to `docs/cli.md` with the codes of
  record 0041, and decides whether it makes a snapshot incomplete.
