---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

A command that changes a configuration file while another one does waits longer for it. It gave up after two
seconds in all. Now it gives up when the command in front has held the lock for ten seconds, or after thirty
seconds in all while several commands take their turn. The error says how long the command waited
(`details.waitedMs`) and how long the lock had been held (`details.heldMs`). One run of the tests on Windows had
failed because one of eight commands held the lock for more than two seconds.
