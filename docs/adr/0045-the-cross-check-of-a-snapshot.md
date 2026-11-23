# 0045. The cross-check of a snapshot: the rows of the Dependency API, held against its analysis

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (work package 8 of the Phase 1 plan. It builds the cross-check of record 0034 for the types
  this phase analyses, and follows the answer to question Q1 of that plan)
- Changed by: [0067](0067-a-row-from-a-flow-is-compared-by-its-version.md), in two points: `MetadataComponentDependency` is no longer the one object that is queried, since one query of `FlowDefinition` asks for the ids of the active and the latest version of each flow; and an end of a row from a flow is matched by those ids, and a row from a version the snapshot does not hold is counted and not compared; and [0069](0069-an-answer-below-the-limit-can-be-cut-off.md), in two points: the query without a filter no longer stands for the org where it gives fewer than 2,000 rows, since an answer can be cut off below the limit, so the rows are always asked for per type and an answer is asked for in parts from half the limit on; and the reading is `whole` only where the first answer and the later ones agree

## Context

Record [0034](0034-dependency-api-is-the-cross-check.md) makes the Dependency API of Salesforce the one second
source for a live org: where it has a row and OrgLens has no reference, the difference is reported, and a pair
that only OrgLens has is a difference only where the API could have seen it. The maintainer answered question
Q1 of the [Phase 1 plan](../plans/phase-1.md) on 15 November 2026: the engine reads the Dependency API in this
phase, for the types this phase analyses.

Work package 8 of that plan asks for the reading in `sources`, for the rows stored with the snapshot, for the
comparison, for `coverage` to show it, and for a step of the live-org workflow that compares on the test org.
It says that the stage is optional and never fails a snapshot, and that a pair Salesforce has and OrgLens has
not is an issue of the severity `error`.

Four things were known before the work began.

- One query of `MetadataComponentDependency` gives at most 2,000 rows and cannot be continued
  ([real-org.md](../research/phase-0/real-org.md) of Phase 0). The test tool of Phase 0 asked per type and per
  pair of types.
- A row names a field and a rule without their object, and a custom object without its ending. The type of a
  row about a record of a custom metadata type is the name of that type
  ([real-org.md](../research/phase-1/real-org.md) of Phase 1, sections 4 and 6).
- `analyse` reads no source (record [0043](0043-a-snapshot-is-analysed-from-its-files.md)), so the rows have to
  come with the snapshot.
- The walk of `impact` follows every origin alike (record [0044](0044-an-impact-answer.md)). References with the
  origin `dependency-api` in the tables of the graph would be followed like the ones OrgLens found.

Two questions of this work package were put to the maintainer, who answered both on 16 November 2026. The
section "Two questions the maintainer answered" has them. Everything else below is a choice of the author, and
the maintainer's to strike. Three of the choices depart from a sentence of the plan and are marked. The code
review of the pull request changed the reading and the matching in several points before the record was
merged. The text below is the state after it.

## Decision

### The reading

`sources/dependency-api.ts` reads the rows of `MetadataComponentDependency` through the Tooling API, with the
session of the snapshot and the API version the snapshot is read with.

- **It is the one object that is queried.** Every query is built from one constant, and a test holds every
  query the mock org receives against it. The object describes metadata. No record of the data of the org is
  read, and nothing is written.
- **A query at the limit is asked again in parts**, on three levels. First one query without a filter. If it
  gives fewer than 2,000 rows, it gave every row, and nothing else is asked. Otherwise the rows are asked for
  per type of the component that refers: a list of 17 types that are known to refer, the types the rows so far
  show, and then whatever is of another type, for at most six rounds. A type at the limit is asked for per
  type of the target in the same way. A pair of types at the limit is asked for per group of 200 components
  that refer, and a group at the limit in two halves, down to one component.
- **The third level is not in the plan**, which names the first two. It needs the ids of the components, and
  takes them from what the org listed for the snapshot. It is trusted only as far as it can be checked.
  - It is used only if every row the pair gave so far is from a component whose id is among them. Otherwise
    the pair counts as cut off: asking per id would leave rows out without a trace.
  - Every row the pair gave before it was cut off has to come again from the groups. Where one does not, the
    org does not read the condition on the id as it is meant here, and the pair counts as cut off.
  - The org may hold a component it did not list, or one that was made since. Where one query can name every
    id of the type, which is up to 200, one more query asks for the rows of every other component. Where it
    cannot, the pair is counted as not proven (`unproven`): every row of a component that was listed was read,
    and nothing shows whether another component has a row.
- **A standard object is never asked for by name.** Added on 17 November 2026, after the second run against the test
  org. The API writes `StandardEntity` as the type of a standard object. The documentation of Salesforce says that
  a filter `RefMetadataComponentType = 'StandardEntity'` is not supported, and the test org refused it. The org also
  refused every query for the rest of a type, whose list of types of the target to leave out held `StandardEntity`.
  That the list was refused for holding it is a reading of six queries, not something Salesforce says: when this
  was written, the org had never been asked with a list that does not hold it. So the rows to standard objects are
  left to the rest, the query for whatever is of no type that a query named, and `StandardEntity` is never on that
  list.
- **The rest is not trusted further than it can be checked.** When this was written, no run had shown that the org
  answers the rest of a type without `StandardEntity` on its list, or that the answer holds the rows to standard
  objects. Run 12 came after, and the consequences below say what it showed.
  - The rows the first query of the type gave before it was cut off show it: one that is of the rest and does not
    come with the rest counts as a query cut off, so the reading is `partial`.
  - An org that refuses the list of types of the rest gets the whole type asked for per group of components.
  - A rest that is at the limit with no type left to ask for by name, or after the last round, is asked for per
    group of components, as a pair of types is.
  - A type of target whose query by name the org refuses as it is written, with no row and not for the time it
    took, is treated like a standard object: it is not put on the list, and its rows are left to the rest. A query
    that broke off or took too long is not treated so. Its type is on the list, and the query counts as failed.
- **The conditions `IN` and `NOT IN` are kept**: `NOT IN` on the two types, `IN` and `NOT IN` on the id of the
  component. The documentation of the object lists every operator other than `=`, `!=`, `AND` and `OR` as not
  supported. The test org answered `NOT IN` on the type of the component that refers, and both on the id. `NOT IN`
  on the type of the target it was asked only with `StandardEntity` on the list when this was written. In run 12 it
  was asked with a list that does not hold it, and answered. An org that does not answer one of them gets a reading
  that is `partial` and says so, except where the point above has another way of asking. The same conditions can be
  written with `=`, `!=` and `OR`, which is not done. This is a choice of the author, made on what one org does.
- **The reading says how far it came.** It is `whole` only when no query left a row out and none could have.
  It is `partial` when a query was cut off at the limit with no smaller part to ask for, or failed, or was not
  proven: rows are missing, or may be. It is `none` when the org answered no query and gave no row. It carries
  the number of requests, of queries cut off, failed and not proven, and the code of the first failure.
- **A failure of the org never throws.** A query the org refuses costs the rows of that query. A type whose
  query was refused or got no answer is asked for in the parts of the next level: a part can be answered where
  the whole is not. A request gives up after 180 seconds. One that broke off without an answer is made again
  twice. One that ran out of time is not made again: it would take as long, and its parts may not.
- **The reading stops with what it has** after three refusals from the start with no answer, after three
  queries in a row that ran out of time, when the session or the network goes away, and after 2,000 requests.
  The last number is a choice without a measurement. Requests count against the daily limit of the org, and
  how many a large org needs is not known. A reading that stops is `partial`, or `none` without a row.
- **An answer is followed only to its own next page.** The address of the next page has to be the query of
  the Tooling API in the version that was asked. Any other address is not followed, and the query counts as
  one that failed.
- A type or an id is put into a query only if it is built like one. Nothing else of a row ever is.
- The reader tells its caller the requests and the rows so far after every query. `snapshot` hands that on,
  and the command line writes a line about it at most every five seconds.

The shared part of the two readers of an org, the Metadata API and this one, is `sources/org-http.ts`.

### The rows are kept beside the snapshot, as Salesforce wrote them

This departs from the plan, which says that the rows are stored "with the origin `dependency-api`".

The sixth migration of the database adds two tables. `snapshot_dependency_reading` has one row for a snapshot
the API was asked for: the state, the time, the numbers and the code. `snapshot_dependency` holds the rows: the
type, the id, the name and the namespace of both ends, as the API gave them. Both go with their snapshot.

- **They are no references.** No component, no version of a component and no row of `reference` is written for
  them. The graph of a snapshot does not read the two tables, so `impact` cannot show one, and the sentence of
  the plan that they are "never mixed into the answer as if OrgLens had found them" holds without a rule in the
  walk. The origin `dependency-api` stays in the vocabulary of references and is written nowhere in this phase.
- **Why not as references.** A version of a component is shared between snapshots and has a digest of its
  content (record [0040](0040-components-and-references-in-the-database.md)). What Salesforce says about a
  component is no part of its files: stored in the version, it would change the digest of a component whose
  files did not change, or be shared with a snapshot of a repository that Salesforce never saw. And a row is
  less than a reference: it has no place, no kind and no confidence.
- **Why as Salesforce wrote them.** Which component an end stands for is worked out by the comparison, and
  that can improve. An analysis by a later version reads the same rows again.

### The comparison

`engines/cross-check.ts` holds the rows against the references of one analysis. It reads no database and no
org.

- **An end is matched by the id the org listed the component with.** The plan says "with the names behind the
  ids", which the test tool reads from four objects of the Tooling API. The engine does not query them: the
  listing of the snapshot already holds the id of every component, and the one object stays the one object.
- **A name is taken only where there is no id.** A standard object has none: the API writes its name in the
  place of the id, so the name is what Salesforce identifies it by. A component the org listed without an id
  is found by its type and full name. A component that was listed with an id is found by that id or not at
  all, and a custom object is never taken by its name: the API names it without its ending, which can be the
  name of a standard object. Should the org list one id under two types, the type of the row decides.
- A row with an end that is matched to nothing is counted (`rowsNotMatched`) and not compared. If the ids of
  the listing were not the ids of the rows, this number would show it.
- **Only the types the analysis read are compared.** A row from a component of another type, such as a class,
  is counted per type (`notAnalysed`) and not compared. A row from a component of an analysed type that the
  snapshot does not hold, or whose analysis failed, is counted too (`rowsNotHeld`).
- **A pair is two whole components.** Several rows can be one pair. A reference from or to a part of a
  component counts for the component.
- **Agreed**: the analysis has a reference from the one to the other.
- **Covered by a part** (`coveredByPart`): Salesforce names an object, and the analysis has a reference from
  the same component to something the object contains, such as a field or a record, and none to the object.
  The maintainer decided this, as the first of the two questions below.
- **Missed**: every other pair Salesforce reports. Each is an issue of the analysis with the severity `error`
  and the code `REFERENCE_MISSED`, which names both keys in its details. It makes the analysis incomplete, as
  every error of the analysis does: `snapshot` and `analyse` end with the exit code `5`, and an impact answer
  from the snapshot has `mayMiss: true`.
- **Only OrgLens** (`onlyOrgLens`): a pair the analysis has, of a kind the API reports, without a row that was
  compared. It is listed and is no issue: either the analysis found a reference that is none, or the API left
  one out, and nothing here can tell which. Where rows are missing or were not matched, its row can be one of
  those, and the report says so.
- **Not reported** (`notReported`): a pair the analysis has, of a kind the API does not report, counted per
  reason. The reasons of record 0034 are a standard field, an inactive rule, a lookup and a roll-up summary.
  The probe of 15 November 2026 adds the filter of a lookup, the controlling field and the value set of a
  picklist. Three more are choices without a measurement: a standard object as the target of anything but a
  lookup, the display field of a lookup, and a custom name in a formula that is the default value of a field.
  A name in text has no reason of its own in this phase. Whatever else is no formula and no filter of a
  roll-up summary is `other`.

The comparison is made by `analyseSnapshot`, with every analysis, and kept with the analysis in the new column
`snapshot_analysis.cross_check` as a JSON object. `orglens analyse` therefore compares again, from the stored
rows and without the org. A comparison that a later version stored in a form this version does not know is
shown as "not compared by this version", and `analyse` makes it anew.

### When the API is asked, and what a failure costs

- `snapshot` of an org or a sandbox asks the API after the last chunk is stored and before the snapshot ends. A
  snapshot that is interrupted there is continued there, and asks again: the new reading takes the place of
  the earlier one, and of its warning. `--no-cross-check` leaves the API unasked. A snapshot that is continued
  with it keeps a reading it already has, with its warning. A source of the kind `git` has no cross-check.
- **The reading never fails a snapshot and never makes it partial.** An org that gives no answer leaves the
  warning `CROSS_CHECK_NOT_READ`, and rows that are missing or may be leave the warning `CROSS_CHECK_PARTIAL`,
  both issues of the reading. The plan says "optional and never fails a snapshot". That the API is asked by
  default is a choice.
- With missing rows the comparison is still made. A pair that is missed is still an error. What changes is what
  silence means: a reference the analysis missed can go unseen, and the report says that rows are missing, or
  that they may be.

### What the report shows

`CoverageReport.crossCheck` is `null` for a snapshot the API was not asked for. Otherwise it holds how the API
was read and, in `comparison`, the numbers and the three lists above, or `null` if nothing was compared. The
JSON output has every pair. The text output of `coverage`, `snapshot` and `analyse` says in one sentence each
what was read, what was not compared and why, and what was compared. It then lists the first 20 pairs that
were missed and the first 20 that only OrgLens has, and says how many more there are. The plan says that
`coverage` "lists the missed pairs", and an org can have more than a terminal shows.

### The tools of the live-org workflow

- The step "read" takes its snapshot with the cross-check and prints the comparison in numbers. A pair is named
  only if both of its components are of the fixture project. The step fails when nothing was compared or when
  a pair was missed.
- The test org holds far fewer than 2,000 rows, so the parts are never asked for there. The step therefore
  reads the rows again with one query, and then through a session that cuts every answer off at 30 rows, and
  holds the parts against the one query just before. It fails when the parts give a row the one query did not
  give, and when the engine calls the reading in parts whole and a row is lacking. The org can change between
  the two readings, and the line of the failure says that a second run tells. Where the one query is not
  whole, or the org holds fewer than 30 rows, the parts are not tried, and the step says so.
- The step "probe" reads the rows through the reader of the engine. It keeps its own queries for the names
  behind the ids and its comparison with the answer key, so the two tools find the components of a row in two
  ways.

## Two questions the maintainer answered

Both were put to the maintainer on 16 November 2026, with what each answer costs, and answered on the same day.
Both answers are the ones that were recommended, and the ones the build had followed.

- **A row from a rule to an object counts as covered.** Salesforce reports the object in `$ObjectType` inside
  `VLOOKUP` and the custom metadata type behind `$CustomMetadata`. The answer key has the reference to the
  field or the record, not to the object. OrgLens keeps only that reference. A row of Salesforce to the object
  counts as found when the analysis has a reference from the same component into the object: the pair is
  `coveredByPart` and no error. The other answer was to record the object as well, in the analysis and in the
  key.
- **A record of a custom metadata type refers to its type, from the phase that analyses records.** Records are
  not analysed in this phase, so the row is counted under `CustomMetadata` as not compared, like a row from a
  class. The phase that analyses records adds the reference. The other answers were to read records in this
  phase for this one reference, and to have no such reference at all.

## Not done, against record 0034 and the plan

- **Confidence does not rise.** Record 0034 says that a row for a pair OrgLens found raises confidence. Nothing
  is raised: the rows are kept apart from the references, and a reference is not changed by them.
- **Not per reference.** Record 0034 says that the coverage output says for each reference whether it is of a
  kind the API reports. The output counts pairs per reason and lists the pairs without a row. A single
  reference is not marked.
- The names behind the ids are not read by the engine, as said above.

## Consequences

- The workspace database moves to schema version 6. `orglens analyse` or `orglens snapshot` migrates a
  database of an earlier version. Its snapshots have no cross-check, and get none without a new snapshot.
- A snapshot of an org sends more requests than before: one where the org holds fewer than 2,000 rows, and many
  where it holds more. How many a large org needs, how long they take, and what they cost of the daily limit
  of API requests were not measured. Which permission the user of the login needs for the query was not
  looked up: an org that refuses leaves `CROSS_CHECK_NOT_READ`.
- Against the mock org, every pair of the fixture project that the answer key says Salesforce reports is found
  by the analysis, and a pair that is taken out on purpose is reported as missed. The mock org answers from
  the answer key. It is not Salesforce.
- Not verified on a real org when this was written: that the ids of the listing are the ids of the rows, that
  the org accepts the two conditions on `MetadataComponentId`, `IN` and `NOT IN`, and what the comparison shows
  for the fixture project. The read step of the live-org workflow shows all three: `rowsNotMatched`, the
  reading in parts, and the missed pairs. Its result is recorded with the run.
- The runs of 17 November 2026 showed all three on the test org (`docs/research/phase-1/real-org.md`, section 7),
  and that the org refuses a query that names a standard object as the type of the target. The reader was corrected
  for that. The corrected reader was not run against the org when this was written. So it was not shown whether the
  org answers the rest of a type whose list does not hold `StandardEntity`, and whether that answer holds the rows
  to standard objects.
- Added after run 12 of the same day, from the commit with the corrected reader. Read in parts, with every answer
  cut off at 30 rows, no request failed, the parts gave the same 257 rows as the one query, and the reading is
  `whole`. So the test org answers the rest of a type whose list does not hold `StandardEntity`. That the rows to
  standard objects came with that rest is most likely and not shown: the step does not print which query gave a row
  (`docs/research/phase-1/real-org.md`, section 7). The check of the rest and the whole type per group of components
  stay: one org says nothing about another, and only tests against the mock org cover them.
- An org with more than 200 components of a type of which a part is at the limit, a pair of types or the rest,
  never gets a reading that is `whole`: it is `partial`, with `unproven` above zero. That is the price of not
  claiming what cannot be shown. Whether a real org of that size comes out so, and how often, was not measured.
- The list of what the API does not report rests on one small Developer Edition org and, for three reasons, on
  nothing. A kind that is wrongly on the list hides nothing that Salesforce reports: a row is always compared.
  It only keeps a pair without a row out of the list `onlyOrgLens`. A kind that is wrongly missing puts pairs
  on that list that say nothing against the analysis.
- A component the org did not list has no id in the snapshot, and a row about it is not compared. That is so
  for a component of a type the org never lists and for one that only came back with another.
- The comparison is as good as the analysis is wide. In this phase a real org has most of its rows from
  classes, flows and layouts, which are counted and not compared.
