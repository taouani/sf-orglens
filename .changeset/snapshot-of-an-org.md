---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Add snapshots of orgs and sandboxes. `orglens snapshot <source>` now reads a source of the kind `org` or
`sandbox`: it asks the org which metadata it holds, retrieves every component by name in chunks, and stores the
files in the form a repository holds them. Progress goes to the standard error stream. A snapshot that is
interrupted is continued by the next run, and `--restart` takes a new one. What the org listed and did not hand
out, and every type it refused to list, makes the snapshot partial and is named in `coverage`. `status` shows a
snapshot that has not ended. Profiles and permission sets are read incompletely, and a warning says so. Only
metadata is read, never records. This has been tested against a mock org, not yet against Salesforce itself. The
workspace database moves to schema version 2.
