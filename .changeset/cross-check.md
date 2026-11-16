---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org is now cross-checked. `orglens snapshot` of an org or a sandbox asks the Dependency API of
Salesforce which component refers to which, keeps the rows with the snapshot, and holds them against what the
analysis found. `coverage` shows the result: how many rows Salesforce reports, how many are from a type this
version does not analyse and are not compared, how many pairs of components the analysis has as well, and
every pair it missed. A reference that Salesforce reports and the analysis did not find is the new issue
`REFERENCE_MISSED` of the analysis, with the severity `error`: the analysis is incomplete, `snapshot` and
`analyse` end with the exit code 5, and an impact answer from that snapshot says that it may miss something. A
reference that only the analysis has is no error. It is listed where the API is known to report that kind, and
counted by its reason where it is not, such as a standard field or a lookup. The rows are a second opinion and
never part of an answer: `impact` shows no row of Salesforce. `orglens analyse` compares again from the rows a
snapshot holds, without asking the org. The reading never fails a snapshot: an org that does not answer leaves
the warning `CROSS_CHECK_NOT_READ`, and rows that are missing because a query was cut off or failed leave
`CROSS_CHECK_PARTIAL`. `--no-cross-check` leaves the API unasked. The engine gets `CoverageReport.crossCheck`
and the option `crossCheck` of `Workspace.snapshot`, and the JSON output of `snapshot`, `analyse` and `coverage`
gets the field `crossCheck`. The workspace database moves to schema version 6: `orglens analyse` or
`orglens snapshot` migrates a database of an earlier version, and `coverage` and `impact` end with `STORE_OUTDATED`
until then. Only metadata is read: one object of the Tooling API is queried, `MetadataComponentDependency`. The
cross-check was not run against a real org when this was written.
