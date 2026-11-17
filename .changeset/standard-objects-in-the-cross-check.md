---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

The cross-check of an org with more than 2,000 rows no longer asks Salesforce for the rows to standard objects by
their type, which Salesforce refuses. Such an org got a cross-check that was `partial` and lacked those rows.
They are now read with the rows of every type that is not asked for by name.
