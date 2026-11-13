---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

On Windows, `orglens source add`, `source remove` and `source link` no longer fail with `WORKSPACE_IO` when another
program has the configuration file open at the moment it is replaced. The replacement is tried again for about
half a second.
