# 0059. Merge fields are read by a reader of our own, and the formula of a flow by the reader of formulas

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (the names in text of work package 2 of the Phase 2 plan)

## Context

Phase 1 reads the names of a formula of a field and of a validation rule (record
[0042](0042-the-names-in-a-formula.md)). The code that gives each name its place in the file, and the code that
resolves the names against the model of objects, stood in the reader of objects, fields and rules, where no
other analyser could use it.

Phase 2 reads flows, workflow rules, email templates, field sets and records of custom metadata types. They
write names in two more ways. A text of a flow, of an email template or of an email alert holds merge fields:
`{!varInvoice.Name}`. A formula of a flow is the formula language with a merge field wherever the formula of a
field has a name: `ISBLANK({!$Record.Tax_Code_Name__c})`. Work package 2 of the
[Phase 2 plan](../plans/phase-2.md) asks for the shared code, a reader for merge fields, the formula language
as a flow writes it, and one function that walks a path from a known object. It asks that nothing changes for a
field or a rule.

Salesforce publishes no grammar of a merge field. What follows under "Decision" is read from the files of the
fixture project, which Salesforce accepted when they were deployed to the test org, and from the 13 flows of the
public codebases. The points marked as choices of the author are the maintainer's to strike.

## Decision

The code is in five files of `extraction/`:

- `values.ts`: the value of an element, and the place in the file of every part of it.
- `raw-references.ts`: a reference as a file writes it, and `resolveReferences`, which resolves its names
  against the model and walks a path with `walkPath`. Every reader hands its names over in this form.
- `names-in-text.ts`: the names of a formula, of a formula of a flow and of a text with merge fields, as such
  references.
- `merge-fields.ts`: where the merge fields of a text stand.
- `formula.ts` and `formula-names.ts`, which were there: the formula language, now also as a flow writes it,
  and what a name stands for, now also the name of a merge field.

`objects.ts` keeps the reading of the XML of an object, a field and a rule, and calls the shared code for a
formula. What it gives is what it gave: no test and no golden file of Phase 1 changed with this.

These are choices of the author, twelve in number.

Where a merge field stands:

1. **A merge field opens with `{!` and closes at the next `}`.** A `{` without a `!` after it opens nothing,
   and a `}` that closes nothing is a character like any other: `{0}`, a piece of JSON and a lone brace are
   left alone. White space around what stands between the braces is not part of it.
2. **A merge field is not closed when the text ends, or another `{` stands, before its `}`.** Nothing of it is
   read. The reader gives the place of its `{!`, and reads the merge fields after it.
3. **What stands between two merge fields is left alone.** A name of the project in the words of a text is no
   reference.

What stands in a merge field:

4. **In a text, a merge field holds one name.** Anything else in it, a call or an operator, is not read as a
   name, and the reader says so with its place and its first 60 characters. An email template or a page may
   write a formula in a merge field. Such a formula is not read in this phase.
5. **The first name of a merge field is something the text around it knows**, and the caller says what: a
   record of an object, so that the names after it are a path from that object, or something that holds no
   record and names nothing that can change, such as a number, a text or the time of the flow. For a flow that
   is a resource, for an email template the object it is written for.
6. **The caller is asked before anything else**, so that `$Record` of a flow is what the flow says. A first
   name the caller does not know is read as the global variable of a formula if it starts with `$`: `$User`,
   `$Setup`, `$Label`, `$Permission` and the others of record 0042, with what that record says of each. Any
   other first name is not read. `$Source` is not read in a merge field: no record holds a lookup there.
7. **A record that is named as a whole gives no reference**: `{!varInvoice}` names no field. Whether an element
   that uses the record refers to its object is for the analyser of that element.
8. **A reference of a merge field in a text says `merge-field` in its attribute `via`**, and one of a formula of
   a flow says `formula`, as the answer key does.

The formula of a flow:

9. **It is read by the reader of formulas, which takes `{!…}` for a name when it is asked to.** The token is
   the name, at the place of the name, and the braces are part of no token. Everything else of record 0042
   holds: a call is any name before a bracket, the order of the operators, the value a picklist is compared
   with, and a formula that is not read as a whole is kept with its names as `probable`.
10. **A merge field is a name whatever it holds.** It is never `TRUE`, `FALSE`, `NULL` or `NOT`, and never the
    name of a call: `{!varCount}(1)` is not read as a whole.
11. **A name outside braces is read as a token and gives no reference.** The reader says that it is not read,
    with its place. A flow has no such name as far as the author knows: the 7 formulas of the flows of the
    public codebases hold 73 names, all in braces. Whether Salesforce accepts one is not verified.
12. **A merge field that is not closed makes the formula one that is not read as a whole.** The problem is told
    at its `{!`. The name that follows is still taken as the name of a merge field, and is `probable` like the
    other names of the formula. A merge field in a text in quotes or in a comment is not read: a text is a
    text. Whether a flow fills a merge field in a text of a formula is not verified.

Without the request of choice 9 the reader of formulas is what it was: a brace is no part of a formula.

## Consequences

- No analyser uses the new readers yet. This record adds no reference to a snapshot: a flow, a workflow rule and
  an email template are still not analysed. Work packages 3 to 5 call the readers.
- The 74 probes of `fixtures/merge-field-probes.yaml`, 41 texts and 33 formulas, are read as each of them says.
  A regular expression that is no reader finds the same merge fields in every text.
- On the fixture project, a test says by hand what each first name of a merge field is, and reads every text of
  the six flows, every formula of the two files of workflow rules, and the subject and the body of the email
  template. The readers give the 50 references the answer key holds for a formula or a merge field of Phase 2,
  30 in the flows, 12 in the workflow rules and 8 in the email template, each at the line and column the key
  says, and no other. No place where the key forbids a reference is hit. Which element of a flow holds a
  formula is a list of three names in that test (`expression`, `formulaExpression`, `filterFormula`). The
  analyser of flows decides that for good.
- The digests of the four listings of the public codebases are the ones the test of Phase 1 holds. The 13 flows
  of those codebases hold 7 formulas, which are read as a whole, and 10 texts with one merge field each, all in
  the label of an interview. That is little: what this record says about merge fields rests on the fixture
  project and the probes, which the author wrote.
- Thirty-six faults were planted in the new and the moved code, one at a time. The tests noticed 35 at once and
  the other after one expectation was added. Writing them showed a special case that did nothing, which was
  removed.
- A path from a resource whose object is not known is not decided here. The plan says that it is not followed
  and counted like a path a formula could not follow. The analyser of flows builds that, with the model of
  resources.
- The flows that cannot be deployed (`fixtures/flow-negative`) ask for the merge fields of an element of an
  unknown kind as `probable`. The reader of a text has no way to say that yet. It gets one with the analyser
  that needs it.
- The reader gives the place of a merge field that is not closed and of one that is not read. The codes of the
  issues they become are named with the analyser that raises them, and documented in `docs/cli.md` then.
- Not verified: anything against Salesforce. Nothing was deployed for this record. Whether a flow accepts white
  space in the braces, a name outside braces, or a merge field in a text of a formula is not known. The reader
  takes the first, does not read the second and leaves the third alone.
