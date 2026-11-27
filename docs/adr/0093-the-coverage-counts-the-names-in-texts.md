# 0093. The coverage counts the names in the texts of Apex by the step that found them

- Status: Accepted
- Date: 2026-11-27
- Decisions: none (builds the last line of work package 5 of the Phase 3 plan, with the choices the author made in it,
  which the maintainer can strike)

## Context

Work package 5 of the [Phase 3 plan](../plans/phase-3.md) reads the names in texts by the sequence of record
[0012](0012-dynamic-references-and-confidence.md): step 1 the text itself, step 2 metadata that holds names, step 3 how
a text is built. Records [0090](0090-the-resolver-of-apex-reads-names-in-texts.md),
[0091](0091-the-resolver-of-apex-reads-texts-from-the-calls.md) and
[0092](0092-the-resolver-of-apex-reads-names-held-by-metadata.md) built the three steps. The last line of the work
package is left: "The coverage counts the names of each step, and the unknown places."

Until now the coverage of an analysis had, per origin, the components the analyser looked at, the files it could not
read, the references it found, those that are not resolved and the paths not followed. A name in a text was a reference
of the `via` `text`, and nothing said which step found it. A part of a text that is not known was a `possible` reference
to its object or a warning `PATH_NOT_FOLLOWED`, and the warning did not say that a text led to it: the same code is
given where a relationship of the code leads to no known object and where DML writes records of no known object.

The fixture project gives 53 references of the `via` `text`. Of the 8 unknown places of its answer key, 7 are of texts,
and one is DML on a list of `SObject`.

## Decision

1. **The step of a name.** Each reference of Apex of the `via` `text` says in `attrs.step` which step found it:
   - `written` where its text is one literal of the member that is read, as the code writes it, each character at its
     own column: a literal that a query, `get` or another method of record 0090 is given, also through a local variable,
     and each way of a branch that is one literal. A class that `Type.forName` is given as a literal is `written` too.
   - `metadata` where metadata holds its characters: a field of a record of a custom metadata type, at the place where
     the code reads the field, also in a query, in a text that a call hands a method, and where the code uses a constant
     or a method that gives the text of the field back, and the fields a field set shows, whether a text or a token
     names the field set, and every field set of an object that `values()` gives (record 0092). The characters of the
     field carry the mark with them, so a name is `metadata` only where they hold all of it. A name of which they hold a
     part, as where the code joins the text of the field with a literal, is `built`.
   - `built` in every other case: a text the code joins of more than one part, also of literals, a constant, a text that
     a method gives back and a text a call hands a method (record 0091).

   The reference to a record of custom metadata and to a field set that a text names is `written` or `built` by its own
   text. What a query or a search binds is code in the middle of its text: the texts that code reads do not change the
   step of the names of the text after it. A reference that is made twice at one place keeps the step of the one that is
   kept, which is the first unless the second has a higher tier, as record 0090 keeps the higher tier.

2. **The warning of a text.** A warning `PATH_NOT_FOLLOWED` that a name in a text leads to has `details.via` `text`: a
   field of which nothing says the object, the name of a field, an object, a class, a field set, the object of a query
   or the text of a query or a search that is not known, a text that could not be read as a query or a search, a field
   set of which nothing says the object, a relationship, a child relationship, a subquery and `FIELDS()` in the text of
   a query, and a relationship that a text names, as `getSObject('What')`, with what the code reads after it. A
   relationship of the code, a query in brackets and DML on records of no known object give the warning without it.
   Where a warning of a text and one of the code meet at one place, as a relationship the code reaches a record through
   and reads a field of by `get`, the one warning has `details.via` `text`.
3. **The counts.** The work of the origin `parser:apex` holds `texts`: `written`, `metadata` and `built` count its
   references of the `via` `text` that are not `possible`, by their step, `possible` those that are, and
   `pathsNotFollowed` its warnings `PATH_NOT_FOLLOWED` with `details.via` `text`. A `possible` reference also has a
   step, that of the text it stands in, and is counted apart: it is the place where a part of the text is not known.
   The other origins have no such counts: the names in the texts of formulas, flows and templates are no step of
   record 0012. An analysis that finds a reference of Apex of the `via` `text` without a step fails as an internal
   error.
4. **Kept in the store.** Migration 13 adds five columns to `snapshot_origin_coverage`, `texts_written`,
   `texts_metadata`, `texts_built`, `texts_possible` and `texts_not_followed`. They are `NULL` for an origin without
   counts, and a check makes the five be written together and none below 0. The workspace database moves to schema
   version 13. An analysis that an older version wrote has no counts, and its report says `null`, until the snapshot is
   analysed again.
5. **Shown.** The report of an origin has `texts`, `null` where it has none, and the JSON output of `snapshot`,
   `analyse` and `coverage` holds it (`packages/cli/schemas/output.schema.json`). Their text output has a line under the
   table of origins for each origin of which a count is above 0, as for the fixture project:

   ```
   Names in texts of parser:apex: 15 written as one literal, 5 held by metadata, 26 in a text the code builds. Where a part of a text is not known: 7 possible references, 7 paths not followed.
   ```

6. **Not done.**
   - A name that two texts make at one place has one step, that of the reference that is kept.
   - The counts are of the whole analysis, not of a component, and an impact answer does not show the step of a
     reference. The counts are not split by what takes the text, a query, `get` or a describe.
   - The counts measure what was found, not what was missed: there is no number of the names that the code could name in
     texts, and a text that names nothing gives no count.

## Consequences

- The fixture project gives 15 names written as one literal, 5 held by metadata and 26 in texts the code builds, 7
  `possible` references and 7 paths not followed that a text leads to (`org-snapshot.test.ts`,
  `extraction-apex.test.ts`). The 5 held by metadata are the field `Late_Fee__c`, which a field of the record
  `Invoice_Late_Fee` names, and the 4 references to what the field set `Invoice_Summary` shows, `Name`, `Amount__c` and
  `Account__r.Tier__c` with the lookup behind it. The record and the field set themselves are `written`. The references
  and their tiers are as before, and the answer key is unchanged. Of its 8 unknown places, the 7 of texts have
  `details.via` `text`, and the DML on a list of `SObject` has not.
- A test of `extraction-apex-resolver.test.ts` holds each rule of the step and of the warning: a literal, a local, a
  join of literals, a constant, a text a method gives back, a text handed at a call, both ways of a branch, a field of a
  record of custom metadata, also in a query and handed at a call, a field set by a text and by a token, a text of
  metadata that a method gives back, a relationship, a field of a describe, an object of the org and a class named by a
  literal and by a join, each after a text of the other step, a `possible` reference, `Type.forName`, the warnings of
  texts, DML, a warning of a text and one of the code at one place, in either order and also where the text adds no
  name, another warning in a text, which has no `details.via`, a reference of another way, which has no step, and the
  counts. A second test holds what the review found (below): a query that binds a constant that reads metadata, a search
  that binds one, a query of a constant that names fields of custom metadata, a name of which metadata holds a part,
  either part first, a format of `String.format` that metadata holds, every field set of an object, a relationship that
  a text names, a method that another class works out first, and a reference made twice at one place, read first and
  handed first. The store tests write and read the counts with both drivers, refuse a set of fewer than five and a count
  below 0, and read a database of schema version 12. A test of the command line holds the line and the JSON. Of 53
  faults planted in the code of this part, one at a time, the first run let 11 pass. Each fault takes a condition out,
  turns it round, makes it always true or always false, or leaves a step out: in the step of a name and where it is set
  for each kind of text, in the places metadata holds, in the warning and where two warnings meet, in the counts, the
  store, the report, the command line and the check of the migration. Three changed nothing the analysis gives, and
  their code was taken out: no method is worked out while the fields a field set shows are given, so the mark of
  metadata needs no saving there, and the step needed no restoring after what a method does with a text is read again at
  a call, since the next text sets it (the review found where that is not so, below). One is a check that stays: only
  the warnings of the reader of Apex are counted, and no other reader gives a warning with `details.via` today. Seven
  showed gaps in the tests: a step on a reference of another way, four kinds of text whose step was not set again and
  that the tests read only after a text of the same step, another warning in a text, and two warnings that meet where
  the text adds no name. Each has a case now. Of the 50 faults that are left, 49 were caught, and the check that stays
  passed. After the fixes of the review the faults were planted again in the code as it is now, 61 faults, of which 21
  are new or written anew for the changed code. The first run let four pass. Two showed gaps in the second test: the
  mark of metadata on characters that the code cuts, as a format of `String.format`, and a search whose bind the test
  named as a parameter of the method by mistake, since Apex does not tell the case of a name. Each has a case now. Two
  are checks that stay: the count of the warnings of the reader of Apex only, as before, and the start of each component
  with no text read, which changes nothing on the fixture project or the eight codebases, and stays so that no component
  takes a step from the one read before it. Of the 59 others, all are caught. The faults were chosen by hand, so a fault
  of another kind can still pass.
- On the eight public codebases (`extraction-corpora.test.ts`):

  | Codebase       | Written | Metadata | Built | Possible | Paths not followed |
  | -------------- | ------: | -------: | ----: | -------: | -----------------: |
  | Apex Recipes   |      11 |        2 |    35 |        1 |                 32 |
  | Coral Cloud    |       0 |        0 |     8 |        0 |                  0 |
  | EDA            |     175 |        0 |   305 |       60 |                154 |
  | Nebula Logger  |      39 |       12 |    45 |       10 |                 59 |
  | NPSP           |     488 |       67 |   931 |      269 |                969 |
  | Outbound Funds |       0 |        0 |     0 |        2 |                  3 |
  | PMM            |       0 |       24 |    16 |        0 |                 71 |
  | V4S            |      11 |       37 |    85 |       45 |                 57 |

  Of the warnings `PATH_NOT_FOLLOWED` of Apex, 1,345 have `details.via` `text` and 602 have not: relationships of the
  code and of queries in brackets that lead to no known object, child relationships the code uses as a list, subqueries
  of queries in brackets, `FIELDS()` in queries in brackets and DML on records of no known object. A script grouped
  every warning by its message. These counts were not checked by hand beyond the grouping: the fixture project and its
  key hold each case. A script compared the references and the warnings of every codebase one by one against the main
  branch: only `attrs.step` and `details.via` differ.

- The review of the pull request found five faults, each fixed now, with a case in the second test. The places where the
  code reads a field of a record of custom metadata were kept for the whole analysis, whatever the code did with the
  field there: two fields that the query of a constant names gave `built` and `metadata`, and a method worked out first
  for a caller read before it gave `metadata` where it gives `written` alone. The characters of the field carry the mark
  now, and a name is `metadata` where they hold all of it. That also makes `metadata` the text of a field that a
  constant holds or a method gives back, which the first build of this part left `built` and named as not done. What a
  query or a search binds is read in the middle of its text, and a constant it binds, worked out at its first use, gave
  the step of its own text to the names after the bind: the step is kept around the binds now. A name joined of the
  characters of a field and a literal was `metadata` or `built` by which came first: it is `built` either way. The
  `possible` reference that `values()` of the field sets gives took the step of the text read before it, also in another
  component: it is `metadata` now, as for a field set. A path after a relationship that a text names, which the code
  then reads, had no `details.via`: it has now (rule 2). The review found the store, the migration, the report, the
  command line and the schema right, and the throw of an internal error where a reference of the `via` `text` has no
  step out of reach, so no test holds it. Measured on the codebases again, the fixes changed the step of two `possible`
  references of Nebula Logger, at `values()`, from `built` to `metadata`, and nothing else: the counts are as before.

- The analysis takes about as long as before. On the machine of the build, which was busy, NPSP took between 8.2 and 9.6
  seconds on the main branch and between 8.4 and 9.2 with this part and the fixes of the review, four runs each way, and
  EDA between 3.0 and 3.2 seconds on the main branch and between 2.7 and 3.5 with this part. The memory the process held
  after the analysis of NPSP was between 626 and 641 MiB on the main branch and between 624 and 636 with this part.
  Before the fixes, on a slower run of the same machine, NPSP took between 9.1 and 10.1 seconds on the main branch and
  between 9.7 and 10.3 with this part.
