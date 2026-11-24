---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

The cross-check of a snapshot of an org no longer takes the query for every row of the Dependency API as whole
where it gives fewer than 2,000 rows: on a large org that query gave fewer, and no row from a field. After it,
the rows are always asked for per type of the component that refers, then whatever is of another type, and each
type that shows is asked for by name. An answer of 1,000 rows or more is asked for in parts. Any other answer is
held against every row the reading holds in the end: where another query gave a row that it was asked for as well
and lacks, the reading is `partial` and the query counts in `queriesCutOff`. A reading of an org that has the
Dependency API asks at least 19 queries where it asked one: one more for each other type its rows show, and one
more each time the rows of another type are asked for again after such a type. An org without the API is asked
three times, as before. The texts say "Rows are missing, or may be" and "near the limit". A reading that is whole
says "No answer shows that a row is missing", where it said "No query left a row out". A snapshot that an earlier
version took keeps its reading.
