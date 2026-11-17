---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

The cross-check of an org with more than 2,000 rows no longer asks Salesforce for the rows to standard objects by
their type, which Salesforce refuses. A cross-check that was read that way was `partial` and lacked those rows.
They are now left to the query for every type that is not asked for by name, and the reader checks that they come
with it. Read that way afterwards, with every answer cut off at 30 rows, the test org of the project gave every
row. An org with more than 2,000 rows was not read.
