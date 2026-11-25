# 0074. A warning of the analysis counts for an impact answer only where it can bear on it

- Status: Accepted
- Date: 2026-11-25
- Decisions: none (it builds what record 0061 leaves to work package 6 of the Phase 2 plan, as a choice of the
  author, which the maintainer can strike)

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
fields, of an object nothing says. Where the path is the record of an element of a flow, it ends at the object of
its last relationship, and with no name left the warning is about that object alone. A flow that compares
`RecordType.DeveloperName` of a record with a text refers to the record type of that name, and makes no reference
where the path to the record is not followed (`extraction/flows.ts`).

## Decision

1. **For what a component refers to, a warning counts where its component is one the walk went from**: the
   component, what it contains, a result, or an element of a flow it found, which the walk goes on from (record
   [0066](0066-an-answer-takes-a-flow-with-its-elements.md)). A reference that is missing from any other component
   is not one of the answer. A result at the depth that was asked for is not walked from, and its warning counts
   all the same: it is a component of the answer.
2. **For what refers to a component, a warning of the start does not count**: of the component, of what it
   contains, or of the flow of an element that is asked about. A reference from the start never refers to it, and
   leads at most back into the start.
3. **For what refers to a component, a `PATH_NOT_FOLLOWED` counts only where its names can be in the answer**:
   the answer holds an object, at which the path can end, or a field whose name one of the names can be, or a
   record type where one of the names is `RecordType`. The names are compared with the name of the field alone,
   since the object is what is not known, as the model resolves a name (`fieldsANameCanBe` in
   `extraction/raw-references.ts`): `Invoice__r` is the field `Invoice__c`, `Account` is `AccountId`,
   `Level__pr` and `Level__pc` are `Level__c` of a contact, a part of a geolocation field is the field, and
   `QueueName` after `Owner:Queue` is `Name`. A test holds the function against the model, for every pair of a
   name and an object of its table that has a key. A warning that kept twenty names, which may be fewer than the
   path has, and one whose names cannot be read, count as before. A warning on a result counts by the same rule:
   where its names cannot be in the answer, the reference it misses leads out of the answer and changes nothing in
   it.
4. **Every other warning of the analysis counts for what refers to a component**, wherever it is, but on the
   start: nothing says what it misses. A warning about no component counts in both directions.
5. **The warnings of the reading are not narrowed.** A flow analysed as a version that may not be the one that
   runs (`FLOW_VERSION_UNKNOWN`, record [0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md))
   counts as before, where the answer covers flows. `countIssues` counts it as `readWarnings`, and
   `readAnalysisWarnings` reads the warnings of the analysis for each answer.
6. **The text of a complete answer about what refers to a component says what it now means**: "every type that can
   refer to it was analysed, and the analysis had no error and no warning that bears on it". The old sentence,
   "every type of the snapshot was analysed, without an error or a warning", said more than record
   [0073](0073-an-answer-leaves-out-a-type-that-can-name-nothing-of-it.md) and this record leave true.

This changes one point of record 0044, which counted the warnings of the whole snapshot for every answer.

## Consequences

- On the fixture project, the one warning, whose names are `invoice` and `Amount__c`, counts for two of the
  twelve golden answers of the engine: what refers to `Invoice__c.Amount__c`, and what refers to the object
  `Invoice__c`. The other ten no longer count it, and neither do the six golden answers of the command line that
  had it. What `Invoice__c.Total__c` refers to is complete. What the flow `Invoice_After_Save` and its element
  `Check_Result` refer to counts it, and what refers to the element does not. Tests hold each.
- An answer about what refers to a component is still not complete in the fixture project while Apex is not
  analysed. An answer with `--outgoing` is complete wherever the walk meets no warning, which is the point.
- Nothing changes in the database or in the shape of the JSON, in `mayMiss` or in the exit code. Fewer answers
  count a warning, and more are complete.
- Every answer reads the warnings of the analysis of its snapshot, one statement by the id of the snapshot. On
  this machine, with a table made for it and an answer of 60,000 results: 100 warnings take 0.5 ms to read and 20
  ms to choose from for what refers to a component, 10,000 take 20 and 30 ms, and 100,000 take 150 to 260 and 90
  ms. For `--outgoing` the choice takes 7 to 21 ms. The script is not in the repository. The benchmark of the
  synthetic org writes no issue, so its times do not change.
- The names are compared without the object, so a field of that name on any object makes the warning count, and
  every object in an answer makes every `PATH_NOT_FOLLOWED` count. The issue does not say whether its path is the
  record of an element, so the object counts for every such warning. Each errs on the side of counting.
- A name the model resolves in a way the function does not know would make a warning drop out of an answer it
  bears on. The test holds the function against the model as it is, and a change to the model that the function
  does not follow fails it only for the names of its table.
- The other six codes are not narrowed for what refers to a component: of them, nothing says what is missed.
- Not measured: how many answers about a real org or about the public codebases this makes complete.
