---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Add snapshots of repository folders. `orglens snapshot <source>` reads a source of the kind `git`, from disk or
from a commit, and stores its metadata files in the workspace database. `orglens coverage <source>` shows what a
snapshot holds per metadata type and what was left out or went wrong. A snapshot that is missing something is
stored as partial, and `snapshot` then ends with the exit code `5`. Reading a commit needs Git 2.30 or newer.
Reading folders from disk needs no Git. Snapshots of orgs and sandboxes are not available yet.
