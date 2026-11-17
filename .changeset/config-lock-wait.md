---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

A command that changes a configuration file while another one does waits longer for it. It gave up after two
seconds in all. Now it gives up when the command in front has held the lock for ten seconds, or after thirty
seconds in all while several commands take their turn. The error says how long the command waited
(`details.waitedMs`) and how long the lock had been held (`details.heldMs`), and a command that waited or held
the lock for a second or longer writes that to the log of the workspace. One run of the tests on Windows had
failed: of eight commands, one got the lock and seven gave up after their two seconds.

Two commands that found a lock that was left behind at the same moment could both take it over, and one of
their changes could be lost. Now only one of them removes the old lock. A command also no longer removes a lock
that is not its own when it ends.
