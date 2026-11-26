# 0074. A warning of the analysis counts for an impact answer only where it can bear on it

- Status: Accepted
- Date: 2026-11-25
- Decisions: none (it builds what record 0061 leaves to work package 6 of the Phase 2 plan, as a choice of the
  author, which the maintainer can strike)
- Changed by: [0082](0082-what-phase-2-left-open-about-flows-comes-first.md), in one point, built in the first pull request of Phase 3: a path of which only the field `Id` is not followed has no warning, so point 3 holds for every other path

## Context

Record [0044](0044-an-impact-answer.md) says that every impact answer names what it does not cover, and among it
how many warnings the analysis had (`notCovered.analysisWarnings`). A warning makes `complete` false and leaves
`mayMiss` as it is. The count was that of the whole snapshot, "since a name that was not read can be a reference
to any component", and record 0044 expects that `complete` will seldom be true for a real project.

Record [0061](0061-the-elements-of-a-flow.md) found the first warning of the fixture project: a path of a flow
behind what an Apex action gives back, which the answer key calls unknown. It made every impact answer about the
project one that is not complete, also an answer about what a field refers to, which the warning cannot touch.
Record 0061 leaves the narrowing to work package 6 of the [Phase 2 plan](../plans/phase-2.md), and the plan does
not say how.

The analysis has seven warnings (`docs/cli.md`): `NAME_NOT_READ`, `RESOURCE_NOT_FOUND`, `PATH_NOT_FOLLOWED`,
`ELEMENT_NOT_FOUND`, `FORMULA_NOT_READ`, `FLOW_ELEMENT_UNKNOWN` and `MERGE_FIELD_NOT_CLOSED`. Each is about a
component: the one whose names were not all turned into references, or that was not found in its file. One that is
about a file as a whole has no component. A reference that is missing for such a warning starts at its component,
and of most warnings nothing says where it would end. A `PATH_NOT_FOLLOWED` says more: it keeps the names that
were not followed, at most twenty of them (`details.notFollowed`). They are fields, or relationships that are
fields, of an object nothing says. Behind what an action or a subflow of a flow gives back, the first name is the
name of a value it gives, such as `invoice` in the fixture project. Where the path is the record that an element of
a flow writes or deletes as a whole, it ends at the object of its last relationship. The fields the element sets
are walked behind that record, and a walk that stopped within the record had no warning of its own: only the
record had one, which names none of the fields (`silent` in `extraction/raw-references.ts`). The review of the
pull request of this record found that. A flow that compares `RecordType.DeveloperName` of a record with a text
refers to the record type of that name, and makes no reference where the path to the record is not followed
(`extraction/flows.ts`).

## Decision

1. **For what a component refers to, a warning counts where its component is one the walk went from**: the
   component, what it contains, a result, or an element of a flow it found, which the walk goes on from (record
   [0066](0066-an-answer-takes-a-flow-with-its-elements.md)). A reference that is missing from any other component
   is not one of the answer. A result at the depth that was asked for is not walked from, and its warning counts
   all the same: it is a component of the answer.
2. **For what refers to a component, a warning of the start does not count**: of the component, of what it
   contains, or of the flow of an element that is asked about. A reference from the start never refers to it, and
   leads at most back into the start.
3. **A path that was not followed has a warning, wherever it stopped, and the warning says what the path ends
   at** (`details.endsAt`): `object` for the record that an element of a flow writes or deletes as a whole, and
   `field` for any other path. A field that an element sets behind such a record has a warning of its own, with
   the names after the stop, as a path that stops anywhere else has. Where the walk stops at the last name of the
   record, the warning says that "its field" was not followed, since the element names it apart. An analysis made before this record kept no
   warning for such a field, and its warnings say nothing of the end.
4. **For what refers to a component, a `PATH_NOT_FOLLOWED` counts only where its names can be in the answer**:
   the answer holds a field whose name one of the names can be, a record type where one of the names is
   `RecordType`, or an object where the path ends at one. The names are compared with the name of the field alone,
   since the object is what is not known, as the model resolves a name (`fieldsANameCanBe` in
   `extraction/raw-references.ts`): `Invoice__r` is the field `Invoice__c`, `Account` is `AccountId`,
   `Level__pr` and `Level__pc` are `Level__c` of a contact, a part of a geolocation field is the field, and
   `QueueName` after `Owner:Queue` is `Name`. A test holds the function against the model, for every pair of a
   name and an object of its table that has a key. A warning that kept twenty names, which may be fewer than the
   path has, one whose names cannot be read, and one that says nothing of its end count as before. A warning on a
   result counts by the same rule: where its names cannot be in the answer, the reference it misses does not lead
   to a component of the answer.
5. **Every other warning of the analysis counts for what refers to a component**, wherever it is, but on the
   start: nothing says what it misses. A warning about no component counts in both directions.
6. **`analysisWarnings` counts the warnings that bear on the answer directly**: a reference one of them misses
   could bring a component into the answer, or lead from one in it. A warning whose names fit only a component
   that another missing reference would bring is not counted. `complete` is right all the same, since the first of
   such references has a warning that counts.
7. **The warnings of the reading are not narrowed.** A flow analysed as a version that may not be the one that
   runs (`FLOW_VERSION_UNKNOWN`, record [0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md))
   counts as before, where the answer covers flows. `countIssues` counts it as `readWarnings`, and
   `readAnalysisWarnings` reads the warnings of the analysis for each answer.
8. **The text of an answer says what is counted**: "1 warning of the analysis bears on the answer", where it said
   "the analysis had 1 warning", and "the analysis had 1 error, and 1 of its warnings bears on the answer", where
   it said "the analysis had 1 error and 1 warning". The text of a complete answer about what refers to a component says what it now
   means: "every type that can refer to it was analysed, and the analysis had no error and no warning that bears
   on it". The old sentence, "every type of the snapshot was analysed, without an error or a warning", said more
   than record [0073](0073-an-answer-leaves-out-a-type-that-can-name-nothing-of-it.md) and this record leave
   true.

This changes one point of record 0044, which counted the warnings of the whole snapshot for every answer, and one
of record 0061: a field that an element of a flow sets behind a record whose path is not followed has a warning.

## Consequences

- A flow whose element sets fields behind a record of no known object has a warning more for each field.
  `pathsNotFollowed` of the analysis report counts them. The tests pin the warnings of the fixture project and of
  the public codebases, and none of their counts moves.
- A snapshot analysed before this record is not narrowed for `PATH_NOT_FOLLOWED`, since a field of an element may
  have no warning there. `orglens analyse <source>` analyses it again.
- On the fixture project, the one warning, whose names are `invoice` and `Amount__c`, counts for two of the
  twelve golden answers of the engine: what refers to `Invoice__c.Amount__c`, and what refers to the object
  `Invoice__c`. The other ten no longer count it, and neither do the six golden answers of the command line that
  had it. What `Invoice__c.Total__c` refers to is complete. What the flow `Invoice_After_Save` and its element
  `Check_Result` refer to counts it, and what refers to the element does not. Tests hold each.
- An answer about what refers to a component is still not complete in the fixture project while Apex is not
  analysed. An answer with `--outgoing` is complete wherever the walk meets no warning, which is the point.
- Nothing changes in the database, in the shape of the JSON of an answer, in `mayMiss` or in the exit code. An
  issue `PATH_NOT_FOLLOWED` has one key more, `details.endsAt`. Fewer answers count a warning, and more are
  complete.
- Every answer reads the warnings of the analysis of its snapshot, one statement by the id of the snapshot. On
  this machine, with a table made for it and an answer of 60,000 results, in four runs each: 100 warnings take
  under 1 ms to read and 27 to 48 ms to choose from for what refers to a component, most of it to gather the
  names of the fields of the answer, 10,000 take 23 to 49 and 32 to 63 ms, and 100,000 take 256 to 342 and 107 to
  129 ms. For `--outgoing` the choice takes 8 to 25 ms. The script is not in the repository. The benchmark of the
  synthetic org writes no issue, so its times do not change.
- The names are compared without the object, so a field of that name on any object makes the warning count, and
  every object in an answer makes every `PATH_NOT_FOLLOWED` of a record count. Each errs on the side of counting.
- A name the model resolves in a way the function does not know would make a warning drop out of an answer it
  bears on. The test holds the function against the model as it is, and a change to the model that the function
  does not follow fails it only for the names of its table. A second test writes 19 ways a name walks a
  relationship and analyses each twice, once where the relationship leads nowhere that is known and once where it
  leads to an object: every reference that only the second has must be one that a warning of the first bears on
  (`extraction-not-followed.test.ts`). The ways are a path in a formula, a validation rule, the filter of a lookup,
  a path, a merge field and a formula of a flow, an assignment that adds, the record an element updates or deletes
  behind one or two relationships with the field or path it sets, the record of a variable and of what a flow
  looks up, a record type behind the record or the prior record and behind two relationships, a field update on
  the parent, and a field a record of custom metadata names. What an action or a subflow gives back cannot be
  varied that way, and a way a reader adds later is not in it.
- Two ways the analysis drops a name without a warning are older than this record, and are not fixed here
  (issue #86): a record type a flow compares with behind a part such as `What:Account`, and a value of a record of
  custom metadata whose field has no file in the snapshot. With no warning, nothing is narrowed, and an answer that
  misses such a reference can call itself complete, as before.
- The other six codes are not narrowed for what refers to a component: of them, nothing says what is missed.
- Not measured: how many answers about a real org or about the public codebases this makes complete.
