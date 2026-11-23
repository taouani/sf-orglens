# 0067. A row of the Dependency API from a flow is compared where it is from the version the snapshot holds

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (an answer of the maintainer to a question of work package 6 of the Phase 2 plan, with the
  choices the author made in building it)

## Context

A row of the Dependency API from a flow carries the id of a version of the flow, and the org lists a flow with
the id of its latest version (record [0060](0060-the-active-version-of-a-flow-is-analysed.md)). A snapshot of an
org analyses the active version. Where the org hands out a newer one, the snapshot fetches the active version by
its number and keeps the note `FLOW_NEWER_VERSION` (record
[0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md)). Record
[0045](0045-the-cross-check-of-a-snapshot.md) matches an end of a row by the id the org listed. For a flow with a
newer version, that is the id of the newer version: the rows of the active version, which the snapshot holds,
would not be matched, and the rows of the newer one would be held against an analysis of another version. Record
0060 therefore left the rows of flows out of the cross-check until the maintainer had decided how they are
compared.

On the test org, with the draft of `Invoice_Recalculate` beside its active version, the Dependency API had 78 rows
from the flows of the fixture project (runs 21 and 26 of "Live org", `docs/research/phase-2/real-org.md`): 47 from
the five flows with one version, 15 with the id of version 1 of `Invoice_Recalculate`, which is active and which
the org does not list, and 16 with the id of version 2, the draft, which is the id the org lists.

The question was put to the maintainer with three answers: ask the org for the ids of the active versions, so that
62 of the 78 rows are compared; compare only the rows that carry the id the org listed, 47 of the 78, and no row of
`Invoice_Recalculate`; or leave the rows of flows not compared.

## Decision

**A snapshot of an org asks the org for the ids of the versions of its flows, and a row from a flow is compared
where it is from the version the snapshot holds.** The maintainer chose this on 23 November 2026, as recommended.

The statements below are choices of the author of this record. The maintainer can strike any of them.

1. **One query more, before the rows**:
   `SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM FlowDefinition`, through the
   Tooling API, followed over its pages (`readFlowVersions` in `sources/dependency-api.ts`). It is asked only where
   the snapshot lists a flow. `FlowDefinition` describes metadata, as `MetadataComponentDependency` does. Its
   requests count with those of the rows: in `requests`, and against the one limit of 2,000 requests, so that the
   rows are read with the requests that are left. A test holds the query. This changes the point of record 0045
   that `MetadataComponentDependency` is the one object that is queried, the sentence of record
   [0009](0009-one-ingestion-path.md), as record 0034 changed it, that the Tooling API supplies the Dependency API
   only, and the rule of `CLAUDE.md` that the engine queries one object of the Tooling API: it queries two.
2. **The ids are kept with the reading of the rows**, in the new table `snapshot_flow_version` (migration 9): for
   each flow, the id of its active version and of its latest one, either of them `null`. `analyse` compares again
   from what the snapshot holds, without the org, as record 0045 asks.
3. **The version the snapshot holds is the active one where the snapshot has the note `FLOW_NEWER_VERSION` for the
   flow, and else the latest.** That is the version whose file was analysed in every case of record 0062: a flow
   whose latest version is active; a flow whose active version was fetched by its number; a flow that came back
   under its name without a number, which is the latest version and has no note; a flow kept as it came with the
   warning `FLOW_VERSION_UNKNOWN`, which is the latest version as well; and a flow with no active version. A flow
   whose active version did not come back is not in the snapshot, and its rows count as from a component the
   snapshot does not hold.
4. **A row from a flow is matched by the ids the org named for the versions**, and else by the id it listed the
   flow with, as the id of the latest version. A row from the version the snapshot holds is compared. A row from
   another version, such as a draft, is counted in the new number `rowsOtherVersion` and not compared: it says
   nothing about the version that runs. An id that the org named for two flows is taken as the id of no version.
   Where a row names a flow as what it refers to, any version of it stands for the flow.
5. **Where the org does not name the versions, the snapshot has the warning `FLOW_VERSIONS_NOT_READ`**, with the
   code of the failure, whether the org named some versions or none, how many flows it named, and the requests.
   The rows are then matched as in point 4 with what there is. A row of the active version of a flow that has a
   newer one then names a component the org did not list, and is counted in `rowsNotMatched`, which the report
   shows as rows that may hide a missed reference. The warning is not written where the Dependency API gave no
   answer either: `CROSS_CHECK_NOT_READ` says more. It makes neither the snapshot nor the analysis incomplete, and
   no impact answer counts it.
6. **The ids of the versions are among the ids a query names when the rows are asked for per component** (record
   0045). The rows of the active version of a flow with a newer one are then asked for by their own id, and the
   reading can be `whole`. Without the ids, such rows came only from the query for the rest, and the reading was
   `partial` on the test org (`docs/research/phase-2/real-org.md`).
7. **Three kinds of references of a flow are counted as not reported**, from what the test org reports
   (runs 19 and 20, section 3 of `docs/research/phase-2/real-org.md`): `subflow`, a flow that the flow starts;
   `name-in-text`, a component that only a text names, such as a record type a condition compares a text with; and
   `global-variable`, a field of a custom setting or a custom permission that only formulas of the flow name,
   through `$Setup` and `$Permission`. Every other reference of a flow that has no row is listed in `onlyOrgLens`.

## Consequences

- The rows of flows are compared. A pair that Salesforce reports from a flow and the analysis lacks is the error
  `REFERENCE_MISSED`, as for any analysed type, and makes the analysis incomplete. The mock org of the tests has a
  draft of `Invoice_Recalculate` with the rows of both versions: the rows of the draft, also one to a field only
  the draft reads, are counted in `rowsOtherVersion`, and nothing is missed. A test takes a field out of the file of
  a flow and finds the pair as missed.
- On the test org, 62 of the 78 rows of flows should be compared and 16 counted as of another version. That is
  worked out from what runs 21 and 26 printed, and was not measured: the first run of "Live org" after the merge
  measures it.
- **On a real org, a flow can name what the reader of flows does not read**, such as a component of a screen or an
  action of a type other than Apex, a flow and an email alert. If the Dependency API reports such a pair, it is now
  `REFERENCE_MISSED`, and an impact answer from that snapshot says that it may miss something (exit code `5`).
  That is what the cross-check is for: an answer about that component would miss the flow. No real org but the
  test org was read, so how often it happens is not known.
- The JSON of `coverage`, `snapshot` and `analyse` has `rowsOtherVersion`, and the reasons `subflow`,
  `name-in-text` and `global-variable`. A comparison that an older version stored has no `rowsOtherVersion`, and is
  shown as one this version cannot read, with the command that compares again. The schema of the output,
  `docs/cli.md` and a changeset say so.
- A snapshot that an older version took has no ids of versions. Analysed again, its rows from flows are matched by
  the listed ids, as in point 5 without the warning.
- The workspace database moves to schema version 9 (point 2). `orglens analyse` or `orglens snapshot` migrates a
  database of an older version, which `impact` refuses until then, as it does for every migration.
- An org with a flow costs one request more, or one per page of the answer. An org without flows costs nothing more.

What was not measured, and what this record therefore does not know:

- Any org but the one test org, which has six flows and no package. The prefix of a package in `NamespacePrefix`,
  and an answer of more than one page, are written as the Tooling API documents them and tested on the mock org
  only.
- An org that changes a flow while it is read. The ids are asked for after the last chunk. A flow that is made
  active between the chunk of its file and the query has rows that are compared against another version, or
  matched to none. That was not seen.
- Whether the API gives a row from an older version that is neither active nor the latest. Such a row names an id
  the org named for no version, and counts in `rowsNotMatched`.
