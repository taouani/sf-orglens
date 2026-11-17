---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

On Windows, a command that changes a configuration file no longer fails with `WORKSPACE_IO` and `EPERM` when it
tries to take the lock at the moment another command gives its own back. It tries again for up to a third of a
second, as it already does when it reads the lock or removes it. One run of the tests on Windows had failed in
`orglens source add` for that reason: of eight commands that ran at the same moment, one ended that way.
