---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

On Windows, a command that changes a configuration file tries again for up to a third of a second when Windows
refuses to create the lock file with `EPERM` or `EBUSY`, as it already does when it reads the lock or removes
it. The same holds for the second file that guards the removal of a lock that was left behind. Before, the
command ended with that error. One run of the tests on Windows had failed that way: of eight processes that
added a source at the same moment, one ended with `EPERM`. Why Windows refused is not known, and the refusal
could not be made to happen again, so it is not verified that the new tries are enough. A command that was
refused and tried again writes that to the log of the workspace (`config.lock.refused`).
