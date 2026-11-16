---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

The workspace database gets tables for components and references, and is now at schema version 3. A command
that writes to the workspace updates an older database when it opens it, and an older version of OrgLens then
refuses that database. No command fills the new tables yet: a snapshot is still read and not analysed.
