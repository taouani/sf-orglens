---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org that lists a flow now asks the Tooling API for the ids of every version of each flow, through
one more object, `Flow`, after `FlowDefinition`. Its requests count with those of the rows. The Dependency API keeps
the rows of a version that is neither active nor the latest, such as one that a deploy left behind, and a row carries
the id of its version. Such a row is now counted in `rowsOtherVersion` and not compared. Before, it was counted in
`rowsNotMatched`. Its id is also among the ids the rows are asked for with when an answer is near the limit, so the
reading of the rows of flows in parts no longer counts such a part as cut off, where the ids of flows fit in one
query (200). Where they do not, the rows come all the same, and the part counts in `queriesNotProven` as before.

Where the org refuses the query of `Flow`, or its answer breaks off, the warning `FLOW_VERSIONS_NOT_READ` says so in
a sentence of its own, and has two more details: `versionsState` and `versionsCode`. The workspace database moves to
schema version 11. A snapshot taken before keeps no ids of the other versions, so its rows from them stay counted as
not matched until the snapshot is taken again. Decision record 0078. Not verified on an org yet.
