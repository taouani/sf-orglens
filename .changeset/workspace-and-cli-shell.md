---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Add the workspace and the first commands. `orglens init` creates a workspace, `orglens source add|list|remove`
declare orgs, sandboxes and repository folders in `orglens.toml`, `orglens status` shows the workspace and its
database, and `orglens doctor` checks that OrgLens can run. Every command takes `--json` and writes one envelope,
described by a JSON Schema that ships with the package, and ends with one of six documented exit codes.
