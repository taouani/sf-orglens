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
  the rest is asked for again after them, until it shows no type or the rounds end. A reading asks at least 19
  queries where it asked one: the first, 17 and the rest. Each other type the rows show costs one more, and each
  round after the first one more for the rest. An org that does not have the API is asked three times, as before.
- **An answer is near the limit when it holds half as many rows as one answer can, or more, or says that it has
  as many (`totalSize`).** An answer near the limit is asked for in the parts of the next level, as an answer at
  the limit was, and a part that is still near the limit with no smaller part to ask for is counted as cut off.
  Half is a choice of the author. The answer of the large org held more rows than half the limit, and how far
  below the limit an answer can be cut off is not known: half leaves a margin, at the cost of more queries
  where a type has between 1,000 and 2,000 rows. Whether `totalSize` counts the rows Salesforce leaves out is not
  known either. Where it does, it shows an answer that was cut off further below the limit.
- **The answers are held against each other.** An answer that showed types, and the queries that ask for those
  types by name, have to give the same rows of them. That holds for the first answer and the queries of every
  type, for a rest and the queries of the types that only it showed, and within a type that is asked for per type
  of target, for the rest of the types of target and the queries of the types it showed. Two things count such an
  answer as cut off, once, so the reading is `partial`:
  - It gave a row that the queries of the type of that row did not give again. One of them left it out without
    showing it, or the org does not read a condition the way it is meant here. This is checked per type, and only
    for a type whose queries counted nothing as missing themselves: where one of them was cut off, failed or not
    proven, that query is counted, and the row can be among its rows.
  - It lacks a row that those queries give, though it was not near the limit. Then it was cut off all the same.
    So can be any answer below the limit on that org, also one the reading took as whole.
- **No new number and no new column.** Such a query is counted among those cut off (`cutOff` of the reading,
  `queriesCutOff` in `--json` and `cut_off` in the store). The texts say "Rows are missing, or may be" where they
  said that rows are missing, "near the limit" where they said "at the limit", and a reading that is whole says
  that no answer shows that a row is missing, where it said that no query left a row out.

## Consequences

- An answer below half the limit that was cut off, and whose rows no other query gives, still goes unseen: the
  checks only find a row that one query gives and another lacks. The query of one type is such an answer where the
  first answer was near the limit and did not give the row. On the large org, whether the reading per type is
  whole is not verified. It shows when the maintainer takes a snapshot of it with a version that holds this
  record.
- An org that is changed while it is read can make two answers disagree: a row that is made or removed between two
  queries is given by one and not by the other. The reading is then `partial` though nothing was cut off. It does
  not ask again to tell the two apart: a second snapshot does.
- Every reading of an org that has the API costs at least 19 requests to the Tooling API, and a type with 1,000
  rows or more is asked for in parts, where a type with 2,000 was before. A snapshot of the fixture project asks 21
  queries for the rows, since its rows show two more types, and one for the versions of its flows. Requests count
  against the daily limit of the org. The limit of 2,000 requests of a reading stays.
- The tool of the live-org workflow reads the test org again as the snapshot does it, and then with every answer
  cut off at 30 rows. It tells the engine twice that number as the limit, so that the engine asks in parts where
  an answer was cut off. The engine also does where an answer holds exactly 30 rows, and where the org says that
  an answer holds more rows than it gave: the tool counts the answers that say so. The step fails where the
  snapshot counts a query as cut off though no query failed: the test org holds too few rows for an answer near
  the limit, so its answers do not agree then. Before, the step saw that when it read the rows again in parts. It
  fails in the same way for the two readings after the snapshot, where nothing explains a query they count.
- What `totalSize` says of an answer that Salesforce cut off is still not known. A snapshot does not show what
  its answers said of themselves.
- The cross-check of a snapshot that an earlier version took keeps the state its reading had. A snapshot of an org
  whose first answer was cut off below the limit says `whole` and lacks rows. Only a new snapshot reads the org
  again.
- The comments on the columns `state`, `cut_off` and `unproven` in migration 0006 still say that no query left a
  row out, and speak of the limit. A released migration is never edited (`store/migrate.ts`).
- The Bulk API 2.0, which the documentation names for up to 100,000 rows a query and for the rows of reports, is
  not used. It would be a new way of asking the org, with a record of its own.
- Record 0045 is changed in its point on how the rows are asked for and in its point on how far the reading came.
