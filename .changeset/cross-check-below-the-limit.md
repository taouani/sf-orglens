---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

The cross-check of a snapshot of an org no longer takes the query for every row of the Dependency API as whole
where it gives fewer than 2,000 rows: on a large org that query gave a little less, and no row from a field.
After it, the rows are always asked for per type of the component that refers, an answer of 1,000 rows or more is
asked for in parts, and the first answer is held against the others. A reading of a small org asks 19 queries
where it asked one. Where the answers do not agree, the reading is `partial` and the first query counts in
`queriesCutOff`. The texts say "Rows are missing, or may be" and "near the limit", and a reading that is whole
says "No answer shows that a row is missing." where it said "No query left a row out.". A snapshot that an earlier
version took keeps its reading.
