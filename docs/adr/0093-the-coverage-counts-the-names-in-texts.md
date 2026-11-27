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
   - `metadata` where its characters are held by metadata: a field of a record of a custom metadata type, at the place
     where the code reads the field, also in a query and in a text that a call hands a method, and the fields a field
     set shows, whether a text or a token names the field set (record 0092).
   - `built` in every other case: a text the code joins of more than one part, also of literals, a constant, a text that
     a method gives back, a text a call hands a method (record 0091), and a text of metadata that a method gives back,
     which stands where the code uses it.

   The reference to a record of custom metadata and to a field set that a text names is `written` or `built` by its own
   text. A reference that is made twice at one place keeps the step of the one that is kept, which is the first unless
   the second has a higher tier, as record 0090 keeps the higher tier.

2. **The warning of a text.** A warning `PATH_NOT_FOLLOWED` that a name in a text leads to has `details.via` `text`: a
   field of which nothing says the object, the name of a field, an object, a class, a field set, the object of a query
   or the text of a query or a search that is not known, a text that could not be read as a query or a search, a field
   set of which nothing says the object, and a relationship, a child relationship, a subquery and `FIELDS()` in the text
   of a query. A relationship of the code, a query in brackets and DML on records of no known object give the warning
   without it. Where a warning of a text and one of the code meet at one place, as a relationship the code reaches a
   record through and reads a field of by `get`, the one warning has `details.via` `text`.
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
   - The step comes from the place of a name. A text of metadata that a method gives back, or that a constant holds,
     stands where the code uses it, and is `built` there: the place no longer says that metadata held it.
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
  counts. The store tests write and read the counts with both drivers, refuse a set of fewer than five and a count below
  0, and read a database of schema version 12. A test of the command line holds the line and the JSON. Of 53 faults
  planted in the code of this part, one at a time, the first run let 11 pass. Each fault takes a condition out, turns it
  round, makes it always true or always false, or leaves a step out: in the step of a name and where it is set for each
  kind of text, in the places metadata holds, in the warning and where two warnings meet, in the counts, the store, the
  report, the command line and the check of the migration. Three changed nothing the analysis gives, and their code was
  taken out: the field set could not be read while a method is worked out, so its mark needs no saving there, and the
  step needs no restoring after what a method does with a text is read again at a call, since the next text sets it. One
  is a check that stays: only the warnings of the reader of Apex are counted, and no other reader gives a warning with
  `details.via` today. Seven showed gaps in the tests: a step on a reference of another way, four kinds of text whose
  step was not set again and that the tests read only after a text of the same step, another warning in a text, and two
  warnings that meet where the text adds no name. Each has a case now. Of the 50 faults that are left, 49 are caught,
  and the check that stays passes. The faults were chosen by hand, so a fault of another kind can still pass.
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

- The analysis takes about as long as before. On the machine of the build, which was busy and slower than for record
  0092, NPSP took between 9.1 and 10.1 seconds on the main branch and between 9.7 and 10.3 with this part, four runs
  each way, and EDA between 3.1 and 3.7 seconds on the main branch and between 3.0 and 3.7 with this part. The memory
  the process held after the analysis of NPSP was between 617 and 635 MiB on the main branch and between 618 and 642
  with this part.
