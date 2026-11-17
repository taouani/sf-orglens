---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

The first impact answers. The new command `orglens impact <component>` shows what refers to a component in a
snapshot, directly or through other components: each result with its depth, the reference it is found by with
file and line, and the weakest confidence on its chain. For an object, the answer is about everything it
contains too. `--depth` limits how far the answer goes, `--min-confidence` leaves uncertain references out,
`--outgoing` shows what the component refers to, and `--snapshot` asks an older snapshot. A component is named
by its name, by its type and name, or by its key. Every answer says what it does not cover: the types of the
snapshot that are not analysed yet, the analysed types of which the snapshot holds less than the source has,
the errors of the reading and of the analysis, the warnings of the analysis, and for `--outgoing` the
components the snapshot does not hold. In this pre-release only objects, fields and validation rules are
analysed, so an answer about what refers to a component of a real project is not complete and says so in its
first lines. The exit code is 5 when the answer may miss something of a type it covers, and 2 for a name that
fits no component or several. The engine gets `Workspace.impact` and the error codes `SNAPSHOT_NOT_ANALYSED`,
`COMPONENT_NOT_FOUND` and `COMPONENT_AMBIGUOUS`. An analysis now records the types it read, and the workspace
database moves to schema version 5: `orglens analyse` or `orglens snapshot` migrates a database of an earlier
version, and `impact` ends with `STORE_OUTDATED` until then. No snapshot of a real org was asked.
