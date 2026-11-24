# 0069. An answer of the Dependency API below the limit can be cut off, so the rows are always asked for per type

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (a correction made after a snapshot of a large org, with the choices the author made in it)

## Context

Record [0045](0045-the-cross-check-of-a-snapshot.md) reads the rows of `MetadataComponentDependency` with one
query without a filter first. One query gives at most 2,000 rows and cannot be continued, so where that query gave
fewer, the reader took it as every row of the org and asked nothing else. The documentation of Salesforce gives the
limit of 2,000 rows. It does not say that an answer can hold fewer rows than that and still leave rows out, and it
says nothing about what `totalSize` counts. It also says that a query of this object through the Tooling API gives
no row of a report, and names the Bulk API 2.0 for those
([research note](../research/phase-0/salesforce-libs.md)).

On 23 November 2026 the maintainer took a snapshot of a large org with the pre-release 0.1.0-next.1. The query
without a filter gave fewer rows than the limit, the reader took them as every row, and the snapshot said that
no query left a row out. The rows were all of a few types that refer, and none was from a field, while the
analysis of the same snapshot found many references of kinds the Dependency API reports. So the answer was cut
off below the limit. Why is not known. One explanation fits what was seen: Salesforce cuts the answer at 2,000
rows and then leaves some of them out, for example rows the user may not see, or the rows of reports. That is a
guess, and nothing in the answer showed it. The test org holds too few rows to show it.

## Decision

- **The query for every row never stands for the org.** It is still asked first, and its rows are kept. After
  it, the rows are always asked for per type of the component that refers, as record 0045 did for a first answer
  at the limit: the 17 types known to refer and the types the rows show, then whatever is of another type, the
  rest. The types the rest shows are asked for by name in the next round, also where the rest held few rows, and
  the rest is asked for again after them, until it shows no type or was asked for six times. The types the sixth
  rest shows are asked for by name as well, and no rest is asked for after them. A reading of an org that has the
  API asks at least 19 queries where it asked one: the first, 17 and the rest. Each other type the rows show costs
  one more, and each round after the first one more for the rest. An org that does not have the API is asked
  three times, as before.
- **An answer is near the limit when it holds half as many rows as one answer can, or more, or says that it has
  as many (`totalSize`).** An answer near the limit is asked for in the parts of the next level, as an answer at
  the limit was, and a part that is still near the limit with no smaller part to ask for is counted as cut off.
  So is a rest near the limit that no rest follows: one that shows no type to ask for by name, and the sixth.
  Half is a choice of the author. The answer of the large org held more rows than half the limit, and how far
  below the limit an answer can be cut off is not known: half leaves a margin, at the cost of more queries
  where a type has between 1,000 and 2,000 rows. Whether `totalSize` counts the rows Salesforce leaves out is not
  known either. Where it does, it shows an answer that was cut off further below the limit.
- **Every answer that is taken as whole is held against the reading.** An answer that is not near the limit, and
  of which every page came, is taken as whole: as every row the org has for its query. When the reading has ended,
  each such answer is held against every row the reading holds, whichever query gave that row. A row that its
  query asked for and that it lacks shows that it was cut off all the same, or that the org does not read a
  condition the way it is meant here. The query is counted as cut off, once, so the reading is `partial`. That
  holds for each kind of query the reader asks: the first one, which asks for every row, the query of a type, of
  a pair of types and of a group of components, and a rest, which asks for every row of a type that its list does
  not leave out. So a rest is counted where the query of a type it showed gives a row of that type that it lacks,
  and also where a later rest shows a type that it did not leave out and did not show. An answer near the limit
  is held against nothing: it is expected to lack rows, and its parts are asked for. Nor is an answer that
  failed: its query is counted as failed, or its rows are asked for in another way.
- **One case is counted where it happens.** The rows a part gave before it was asked for per component have to
  come again with the groups of components. Where one does not, though no group left rows out itself, the org
  does not read the condition on the id the way it is meant here: the queries for the groups are counted as one
  query that was cut off, no group is taken as whole, and the query for the components that are not in the list
  is not asked. Where a group left rows out itself, as one component alone near the limit or as a query that
  failed, that is counted, and the answers of the other groups are taken as whole like any other answer. So are
  the answers of the groups that came before a reading stopped among them.
- **No new number in what a snapshot keeps or prints, and no new column.** Such a query is counted among those
  cut off (`cutOff` of the reading, `queriesCutOff` in `--json` and `cut_off` in the store). The reading itself
  says how many of them another answer showed to be (`disagreed`). A snapshot does not keep that number: the tool
  of the live-org workflow reads it from the readings it makes itself. The texts say "Rows are missing, or may
  be" where they said that rows are missing, "near the limit" where they said "at the limit", and a reading that
  is whole says that no answer shows that a row is missing, where it said that no query left a row out.

## Consequences

- An answer below half the limit that was cut off, and whose rows no other query gives, still goes unseen: the
  check only finds a row that one query gives and another lacks. The query of one type is such an answer where the
  first answer was near the limit and did not give the row. So is a rest that the org cut off with nothing but
  rows it leaves out: it shows no type, the rounds end, and a type behind it stays unseen. The same holds after
  the sixth rest, whose types are asked for by name and which no rest follows. On the large org, whether the
  reading per type is whole is not verified. It shows when the maintainer takes a snapshot of it with a version
  that holds this record.
- A type that only a rest shows, and that the org refuses to be asked for by name, leaves the reading `partial`
  with one query that failed, though the rest gave rows of it: nothing asks for them a second time. No org is
  known to refuse a type by name.
- An org that is changed while it is read can make two answers disagree: a row that is made or removed between two
  queries is given by one and not by the other. The reading is then `partial` though nothing was cut off. It does
  not ask again to tell the two apart: a second snapshot does.
- Every reading of an org that has the API costs at least 19 requests to the Tooling API, and a type with 1,000
  rows or more is asked for in parts, where a type with 2,000 was before. A snapshot of the fixture project asks 21
  queries for the rows, since its rows show two more types, and one for the versions of its flows. Requests count
  against the daily limit of the org. The limit of 2,000 requests of a reading stays.
- The tool of the live-org workflow reads the test org again as the snapshot does it, also where the reading of
  the snapshot is not whole, and then with every answer cut off at 30 rows. Both readings are given the ids the
  snapshot asked with. For the second, the tool tells the engine twice that number as the limit, so that the
  engine asks in parts where an answer holds 30 rows: where the tool cut it off, where it held exactly 30, and
  where the org says that it holds 30 or more (`totalSize`). The tool counts the answers that say that they hold
  more rows than they gave, whatever the number.
- The step fails where one of its two readings counts a query because another query gave a row that its answer
  lacks (`disagreed`). A query that the reading in parts counts for another reason does not fail it: one component
  alone can hold 30 rows, and a part cannot be asked for per component where one of its rows comes from a
  component the org did not list, such as a version of a flow that is neither the active nor the latest one. A
  snapshot does not keep how many queries another answer showed to be cut off. So for the snapshot, and for the
  reading as the snapshot does it, the step also fails where a query is counted as cut off though no query failed
  and the reading holds fewer rows than half the limit: only an answer that lacks a row another query gave, or
  one that says that it holds more rows than it gave, is known to cause that. Where a query of the snapshot
  failed as well, what the snapshot keeps does not tell, and the reading after it does. Before the rows were
  always asked for per type, the step saw answers that disagree when it read the rows again in parts.
- The reader and the step of the live-org workflow were built against mock orgs. Neither was run against the
  test org before this record was merged: the workflow gives the login only to a run from `main`. The first run
  on `main` after the merge shows how the test org answers.
- What `totalSize` says of an answer that Salesforce cut off is still not known. A snapshot does not show what
  its answers said of themselves, nor how many of the queries it counts another answer showed to be cut off.
- The cross-check of a snapshot that an earlier version took keeps the state its reading had. A snapshot of an org
  whose first answer was cut off below the limit says `whole` and lacks rows. Only a new snapshot reads the org
  again.
- The comments on the columns `state`, `cut_off` and `unproven` in migration 0006 still say that no query left a
  row out, and speak of the limit. A released migration is never edited (`store/migrate.ts`).
- The Bulk API 2.0, which the documentation names for up to 100,000 rows a query and for the rows of reports, is
  not used. It would be a new way of asking the org, with a record of its own.
- Record 0045 is changed in its point on how the rows are asked for and in its point on how far the reading came.
