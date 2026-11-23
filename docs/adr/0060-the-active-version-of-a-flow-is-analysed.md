# 0060. The active version of a flow is analysed, and a snapshot of an org asks for it by its number

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (an answer of the maintainer to the Phase 2 plan, changed after a measurement)

## Context

An org keeps every version of a flow: at most one is active, and there can be a newer draft and older versions
beside it. A repository holds one file per flow. Phase 2 analyses flows, so it has to say which version of a flow
of an org an answer speaks of.

The maintainer answered Q3 of the [Phase 2 plan](../plans/phase-2.md) on 22 November 2026: the version the org
hands out for the flow is analysed. Record [0057](0057-the-version-of-a-flow-that-is-analysed.md) held that
answer, and its author expected the org to hand out the active version.

The test org showed otherwise ([note](../research/phase-2/real-org.md), run 21 of "Live org"): a flow with an
active version and a newer draft is handed out as the draft, which does not run. The question went back to the
maintainer, who chose on 23 November 2026 that the active version is fetched by its number and analysed, and that
a newer draft is reported as present and is not analysed.

Whether Salesforce hands out a version that is asked for by its number was not known then. The reference of the
Metadata API says that a version of a flow can be retrieved by a name with its number, and says in the same
paragraph that the name holds no version number from API version 44 on. The probe step of the workflow "Live
org" asked the test org (`packages/engine/test/live/flow-versions.ts`), in run 22 of 23 November 2026, with API
version 68.0. The flow `Invoice_Recalculate` had version 1, active, and version 2, a draft that reads one field
more. Each name was asked for in a retrieve of its own:

| Asked for                                   | What came back                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| `Flow`, `Invoice_Recalculate`               | `flows/Invoice_Recalculate.flow`, 11,408 bytes, state `Draft`: the draft       |
| `FlowDefinition`, `Invoice_Recalculate`     | A file of 171 bytes that names version 1 as the active one                     |
| `Flow`, `Invoice_Recalculate-1`             | `flows/Invoice_Recalculate-1.flow`, 11,361 bytes, state `Active`: version 1    |
| `Flow`, `Invoice_Recalculate-2`             | `flows/Invoice_Recalculate.flow`, 11,408 bytes, state `Draft`: the draft       |
| `Flow`, `Invoice_Recalculate-3` (a control) | No file. The retrieve succeeded, with the remark that the name cannot be found |

So the test org hands out the active version when it is asked for by the name of the flow with the number of
that version. The file of the active version has the number in its name. The file of the latest version has
not, also when it is asked for by its number. The number the `FlowDefinition` names is the one the Tooling API
gives for the active version.

## Decision

**The active version of a flow is the one that is analysed.** That is the answer of the maintainer of
23 November 2026.

**A newer draft is reported as present and is not analysed.** An answer about the flow does not hold what the
draft would change.

**A flow without an active version is analysed as the org hands it out, and its references say that the flow is
not active**, as a reference from a validation rule that is not active does. That is what record 0057 said, and
the second answer of the maintainer does not touch it: such a flow has no active version to ask for.

**A flow is one component, whatever the number of its versions.** This too is carried over from record 0057,
where it is a conclusion of the author that the maintainer can strike.

## What goes further than the answer of the maintainer

How a snapshot gets the active version is the design of the author of this record, from what run 22 showed. The
maintainer can strike it.

- **A snapshot of an org asks for the active version by its number.** It reads flows by their names, as it does
  today. Where the file of a flow says that it is not active and the file of its `FlowDefinition`, which the org
  hands out with the other types, names an active version, the snapshot asks once more, for the name of the flow
  with that number. The file that comes back is the flow of the snapshot. The file of the draft is not kept as
  the flow.
- **The number comes from the file of the `FlowDefinition`, not from the Tooling API.** The engine reads one
  object of the Tooling API, the one of the dependencies (record
  [0045](0045-the-cross-check-of-a-snapshot.md)), and this leaves it at one.
- **A definition that names the number 0, or no number, names no active version.** That is how the probe reads
  it. No file of the test org was seen that says so: the one definition that run 22 printed names version 1.
- **If the second retrieve gives no file for a flow, the snapshot says so** with an issue for that flow, and
  holds the draft, marked as not active. It does not guess.
- **A snapshot of a repository analyses the file the repository holds**, whatever its state. A repository has
  one file per flow and no other version to ask for.

None of this is built yet. Until it is, a snapshot of an org holds the draft of a flow that has a newer draft.
It is built in work package 3 of the plan, with the analyser of flows.

## Consequences

- The key of a flow and of its elements holds no version (record [0010](0010-data-model-and-identity.md)). A
  snapshot of an org and one of a repository give the same keys for the same flow.
- A snapshot of an org and a repository can differ for a flow because the org runs one version and the
  repository holds a newer one. That is a difference a comparison of snapshots shows, in Phase 4.
- A snapshot of an org with a flow that has a newer draft costs one more retrieve. An org without such a flow
  costs none. Whether several flows can be asked for by their numbers in one retrieve is not measured: the probe
  asked for one name per retrieve.
- The file of the active version comes back under a name with the number, `Invoice_Recalculate-1.flow`. The
  snapshot has to take it as the file of `Invoice_Recalculate`. What the Salesforce library makes of such a file
  name is not looked at yet.
- How an answer shows that a flow has a newer draft is designed with the answers, in work package 6 of the plan.
- The rows of the Dependency API from a flow carry the id of a version, and the org lists a flow with the id of
  its latest version (the note, runs 20 and 21). For a flow with a newer draft, the rows of the active version
  therefore carry an id the org did not list, and the rows of the draft carry the one it listed. With this
  record the snapshot analyses the active version, so a comparison by the listed id would hold the analysis
  against the rows of the draft. Record 0045 allows a name only where there is no id. How the cross-check treats
  flows is put to the maintainer with its design, in work package 6. Until then the rows of flows are not
  compared.
- A process of the Process Builder is a flow to the Metadata API, and falls under the same rules.

What was not measured, and what this record therefore does not know:

- Any org but the one test org, a Developer Edition org, and any API version but 68.0.
- A flow with more than two versions, a flow whose active version is the latest of several, which needs no
  second retrieve, and a flow that has an active version, a newer draft and versions that are obsolete.
- A flow of a managed package.
- Why the reference of the Metadata API says that the name holds no version number from API version 44 on. The
  author did not read that paragraph in full. The test org handed out version 1 for the name with `-1` all the
  same.
