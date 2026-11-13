---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

On Windows, a command that reads or changes a configuration file tries again for up to a third of a second when
another program has the file open at that moment, before it fails with `WORKSPACE_IO`. One run of the tests on
Windows had failed in `orglens source add` for that reason.
