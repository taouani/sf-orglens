# 0078. A snapshot of an org asks for the ids of every version of a flow

- Status: Accepted
- Date: 2026-11-25
- Decisions: none (an answer of the maintainer to a question that run 29 of "Live org" raised, with the choices the
  author made in building it)

## Context

A row of the Dependency API from a flow carries the id of a version of the flow. Since record
[0067](0067-a-row-from-a-flow-is-compared-by-its-version.md) a snapshot asks the object `FlowDefinition` for the ids
of the active and of the latest version of each flow. It knew no other version. That record left one point not
measured: whether the API gives a row from a version that is neither active nor the latest.

Run 29 of "Live org" showed that it does (section 5 of the
[research note of Phase 2](../research/phase-2/real-org.md)). The deploy of that run sent every flow of the fixture
project again, and the org kept the versions it replaced, with their rows. The API gave 116 rows from flows. The engine
matched 62 of them to a flow, and 54 to nothing the org listed, so it counted them in `rowsNotMatched`. The reading in
parts, with every answer cut off at 30 rows, was no longer whole: 58 rows short. The reader asks a part that is near
the limit again per group of components only where every row of its cut-off answer is from a component whose id it
knows (`askPerComponent` in `sources/dependency-api.ts`). A row of an old version is from no such component, so the
part was taken as cut off. The rows that went missing were not only those of the old versions: by the count of the
note, 17 rows of the versions the snapshot holds were lost too. Salesforce keeps the old versions of a flow until they
are deleted, by its documentation `[unverified]`. So any org whose flows give 1,000 rows or more to one type of target
can lose rows in the same way.

The Tooling API holds every version of a flow as a row of the object `Flow`, with the id of the definition of its
flow. The probe of the test org queried that object on 23 November 2026, and the org answered
([live-org-setup.md](../live-org-setup.md)). The question went to the maintainer with two answers: ask the org for
the ids of every version, or leave the reader as it is and keep the warning.

## Decision

**A snapshot of an org that lists a flow asks the org for the ids of every version of each flow. A row from a
version that is neither active nor the latest counts as a row of another version.** The maintainer chose this on 25
November 2026.

The statements below are choices of the author of this record. The maintainer can strike any of them.

1. **One query more, after the one of `FlowDefinition`**: `SELECT Id, DefinitionId FROM Flow`, through the Tooling
   API, followed over its pages (`readFlowVersions` in `sources/dependency-api.ts`). A row of `Flow` names the
   definition of its flow by the id of the row of `FlowDefinition`, so the query is asked only where `FlowDefinition`
   named a flow. Its requests count with the others: in `requests`, and against the one limit of 2,000 requests.
   `Flow` describes metadata, a version of a flow, as the two other objects do. Only the two ids are asked for, not
   the definition of the version. A test holds the query. This changes point 1 of record 0067 and the rule of
   `CLAUDE.md` that the engine queries two objects of the Tooling API: it queries three.
2. **A version is another version where its id is neither the active nor the latest one of its flow.** Ids are
   compared by their first 15 characters. A version of a definition that `FlowDefinition` did not name is left out.
   The id the org listed a flow with is that of its latest version when it was listed. Where the org names that id
   only as another version, because `FlowDefinition` gave no latest version or because a version was made after
   the listing, it counts as the latest version all the same, as it did before this record.
3. **The ids are kept with the reading of the rows**, in the new table `snapshot_flow_other_version` (migration 11).
   Each row belongs to a flow of `snapshot_flow_version`, and goes when that row goes. `analyse` compares again from
   what the snapshot holds, without the org, as record 0045 asks.
4. **A row from another version is counted in `rowsOtherVersion` and not compared**, whichever version the snapshot
   holds, as a draft is in record 0067. Where a row names the flow as what it refers to, the other version stands for
   the flow too. No new count is added.
5. **The ids of the other versions are among the ids a query names when the rows are asked for per component**, as
   those of the active and the latest version are (point 6 of record 0067). A part near the limit whose rows come
   from an old version is then asked for per group of components, and the reading can be whole. Where a type has
   more ids than one query names (200), the query for every other component stays out, and the reading counts that
   in `queriesNotProven`, as before: the rows of the versions it knows come all the same, and the reading is not
   whole. Old versions add ids of flows, so an org with many flows reaches that number sooner.
6. **Where the org refuses the query of `Flow`, or its answer breaks off, the snapshot has the warning
   `FLOW_VERSIONS_NOT_READ`** with a sentence of its own: a row from another version then names a component the org
   did not list, and a part that is near the limit and holds such rows can be taken as cut off. The ids that came
   before stay, and so do the active and the latest versions. The warning gets two details, `versionsState` (`whole`,
   `partial` or `none`) and `versionsCode`. Where `FlowDefinition` named no flow, `Flow` is not asked: `versionsState`
   is `none` and `versionsCode` is `null`, and the warning says only what it said before. As in record 0067, the warning
   makes neither the snapshot nor the analysis incomplete.

## Consequences

- On the test org after run 29, the 54 rows are to count in `rowsOtherVersion` and not in `rowsNotMatched`. The
  reading in parts is to be whole again. Neither is measured until the next run of "Live org" ("read" is enough).
- The mock org of the tests names every version of its flows. A test gives a flow an old version with its rows and
  finds the rows counted as of another version, also when they are asked for in parts with the answers cut off. With
  the query refused, it finds them not matched and the reading in parts partial, as in run 29.
- An org with a flow costs one request more, or one per page of the answer. Where the rows of flows are asked for per
  component, each group of 200 ids is one query, so an org with many old versions costs more queries there.
- The workspace database moves to schema version 11 (point 3). `orglens analyse` or `orglens snapshot` migrates a
  database of an older version, which `impact` refuses until then, as it does for every migration. A snapshot taken
  before this record holds no ids of other versions: its rows from them stay counted in `rowsNotMatched` until the
  snapshot is taken again.
- The JSON output does not change its shape. `FLOW_VERSIONS_NOT_READ` has two more details. `docs/cli.md`, the
  description of `rowsOtherVersion` in the schema of the output and a changeset say so.

What was not measured, and what this record therefore does not know:

- Whether the test org answers the query as it is written here. The probe asked the same object for two more fields,
  `VersionNumber` and `Status`, and the org answered.
- Whether `Flow` names the versions of a flow of a managed package. The test org holds components of a package with a
  namespace, and its public log does not say whether a flow is among them.
- An answer of more than one page. It is written as the Tooling API documents it, and tested on the mock org only.
- An org that changes a flow while it is read. A version made between the two queries is named by `Flow` and is
  among the other versions, also where it is the new latest one. A version made after the query of `Flow` is not,
  and its rows count as not matched.
- How many versions a real org keeps, and so how many queries the reading per component costs on a large org.
