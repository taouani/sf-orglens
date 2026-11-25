---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

The cross-check of a snapshot of an org compares the rows of the Dependency API from flows. A row from a flow
carries the id of a version of the flow, and the org lists a flow with the id of its latest version only. So a
snapshot of an org that lists a flow asks the org once more, through the Tooling API, for the ids of the active
and of the latest version of each flow (`FlowDefinition`), and keeps them with the rows. Its requests count with
those of the rows. A row is compared where it is from the version the snapshot holds: the active one where a newer
version is noted, and else the latest. A row from another version, such as a draft, is counted in the new field
`rowsOtherVersion` of the comparison and not compared, and the text of `snapshot`, `coverage` and `analyse` says
how many there are. Where the org does not name the versions, the snapshot has the new warning
`FLOW_VERSIONS_NOT_READ`, and a row from a flow is matched by the id the org listed the flow with.

So a pair that Salesforce reports from a flow and the analysis lacks is now the error `REFERENCE_MISSED`, which
makes the analysis incomplete, and an impact answer from that snapshot ends with the exit code `5`. A reference of
a flow that Salesforce does not report is counted with one of three new reasons: `subflow`, `name-in-text` and
`global-variable`. On a real org a flow can name what the analysis of flows does not read yet, such as a component
of a screen. If Salesforce reports such a pair, the analysis is incomplete.

A comparison that an earlier version stored has no `rowsOtherVersion`, and is shown as one this version cannot
read, with the command that compares again: `orglens analyse`. A snapshot that an earlier version took holds no
ids of versions: its rows from flows are matched by the ids the org listed.
