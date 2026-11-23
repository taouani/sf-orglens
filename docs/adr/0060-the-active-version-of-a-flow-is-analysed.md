# 0060. The active version of a flow is analysed, and a snapshot of an org asks for it by its number

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (an answer of the maintainer to the Phase 2 plan, changed after a measurement)
- Changed by: [0067](0067-a-row-from-a-flow-is-compared-by-its-version.md), in two points: the rows of the Dependency API from a flow are compared where they are from the version the snapshot holds, as the maintainer decided, and the engine reads a second object of the Tooling API, `FlowDefinition`, for the ids of the versions

## Context

An org keeps every version of a flow: at most one is active, and there can be a newer draft and older versions
beside it. A repository holds one file per flow. Phase 2 analyses flows, so it has to say which version of a flow
of an org an answer speaks of.

The maintainer answered Q3 of the [Phase 2 plan](../plans/phase-2.md) on 22 November 2026: the version the org
hands out for the flow is analysed. Record [0057](0057-the-version-of-a-flow-that-is-analysed.md) held that
answer, and its author expected the org to hand out the active version.

The test org showed otherwise ([note](../research/phase-2/real-org.md), run 21 of "Live org"): a flow with an
active version and a newer draft is handed out as the draft, which does not run. The question went back to the
maintainer, who chose on 23 November 2026 the option that read: "OrgLens fetches the active version by its number
and analyses it. A newer draft is reported as present and not analysed." The option named the way, by the number.
It did not say how OrgLens learns the number, or what it does when the way fails.

Whether Salesforce hands out a version that is asked for by its number was not known then. The reference of the
Metadata API says of the full name of a flow, as a tool read the page for the author on 23 November 2026: "To
deploy or retrieve a version, you can specify the version number. For example, `sampleFlow-3` specifies version 3
of the flow whose unique name is sampleFlow. If you don't specify a version number, the flow is the latest
version. In API version 43.0 and earlier, this field included the version number. In API version 44 and later,
this field no longer includes the version number." The author reads the last two sentences as being about the
name a flow comes back with, not about the name it can be asked for by. The page does not say so.

The probe step of the workflow "Live org" asked the test org (`packages/engine/test/live/flow-versions.ts`), in
run 22 of 23 November 2026, with API version 68.0. The flow `Invoice_Recalculate` had version 1, active, and
version 2, a draft that reads one field more. Each name was asked for in a retrieve of its own:

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

**The active version of a flow is the one that is analysed. A snapshot of an org fetches it by its number.** That
is the answer of the maintainer of 23 November 2026.

**A newer draft is reported as present and is not analysed.** An answer about the flow does not hold what the
draft would change.

**A flow without an active version is analysed as the org hands it out, and its references say that the flow is
not active**, as a reference from a validation rule that is not active does. That is what record 0057 said, and
the second answer of the maintainer does not touch it: such a flow has no active version to ask for.

This record supersedes record 0057. What falls is its rule for a flow that has an active version: the version the
org hands out for the name is no longer the one that is analysed. What it says of a flow without an active
version stands, and is carried over here.

## What goes further than the answer of the maintainer

What follows is the design of the author of this record, from what run 22 showed. The maintainer can strike any
of it.

- **A flow is one component, whatever the number of its versions.** This is carried over from record 0057, where
  it is a conclusion of the author too.
- **The number comes from the file of the `FlowDefinition`.** A snapshot reads flows by their names, as it does
  today. Where the file of a flow says that it is not active and the file of its `FlowDefinition`, which the org
  hands out with the other types, names an active version, the snapshot asks once more, for the name of the flow
  with that number. The engine reads one object of the Tooling API, the one of the dependencies (record
  [0045](0045-the-cross-check-of-a-snapshot.md)), and this leaves it at one.
- **The rule goes by "not active", not by "draft".** The latest version of a flow can also be obsolete or an
  invalid draft while an older version is active, for example after an older version was activated again. The
  snapshot treats every such flow in the same way, and reports that the flow has a newer version that is not
  analysed. The maintainer spoke of a newer draft. The other states were not put to the maintainer.
- **The file that comes back is taken only if it says that it is active.** It is taken under either name: run 22
  showed a file name with the number for a version that is not the latest, and one without for the latest. It is
  stored under the path of the flow, without the number, so that the key is the one a repository gives.
- **A definition that names the number 0, or no number, names no active version.** That is how the probe reads
  it. No file of the test org was seen that says so: the one definition that run 22 printed names version 1. The
  reference of the Metadata API says of the number only that it is "the version number of the active flow".
- **If the second retrieve gives no file that says it is active, the flow counts as listed and not handed out.**
  That is an error of a type of the logic tier, which makes the snapshot `partial` (record
  [0046](0046-complete-over-the-logic-tier.md)). The draft is not put in its
  place and is not analysed. An answer then says that it may miss something, which is true.
- **If the snapshot holds no definition for a flow whose file is not active, it cannot know whether another
  version runs.** That happens when `exclude_types` names `FlowDefinition`, which is outside the logic tier, or
  when the org does not hand the definition out. The flow is kept and analysed as the org handed it out, marked
  as not active, and a warning for that flow says that its active version is not known and why.
- **The snapshot keeps which flows have a newer version that is not analysed.** An analysis works from the files
  of a snapshot, without the org (record [0043](0043-a-snapshot-is-analysed-from-its-files.md)), so the
  fact has to be stored with the snapshot. Where it is kept, and whether the file of the newer version is kept
  at all beside the flow, is designed when it is built.
- **A snapshot of a repository analyses the file the repository holds**, whatever its state. A repository in
  the format of today has one file per flow and no other version to ask for.
- **The rows of the Dependency API from a flow are left out of the cross-check from the moment flows are
  analysed.** They are counted and not compared, until the maintainer has decided how they are compared (see the
  consequences). Work package 3 of the plan builds that with the analyser of flows.

It is built in work package 3 of the plan. Record [0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md)
holds how, with the choices its author made in building it.

## Consequences

- The key of a flow and of its elements holds no version (record [0010](0010-data-model-and-identity.md)). A
  snapshot of an org and one of a repository give the same keys for the same flow.
- A snapshot of an org and a repository can differ for a flow because the org runs one version and the
  repository holds a newer one. That is a difference a comparison of snapshots shows, in Phase 4.
- A snapshot of an org with a flow whose latest version is not active costs at least one more retrieve, and one
  for each such flow if several cannot be asked for together, which is not measured: the probe asked for one
  name per retrieve. Its five retrieves took 22 requests to the Metadata API and about eleven seconds. An org
  without such a flow costs nothing more.
- The file of the active version comes back under a name with the number, `Invoice_Recalculate-1.flow`. The
  snapshot has to take it as the file of `Invoice_Recalculate`. What the Salesforce library makes of such a file
  name was not looked at when this record was written. Record
  [0062](0062-the-active-version-of-a-flow-is-fetched-by-its-number.md) says what it does.
- How an answer shows that a flow has a newer version that is not analysed is designed with the answers, in
  work package 6 of the plan.
- The rows of the Dependency API from a flow carry the id of a version, and the org lists a flow with the id of
  its latest version (the note, runs 20 and 21). For a flow with a newer draft, the rows of the active version
  therefore carry an id the org did not list, and the rows of the draft carry the one it listed. With this
  record the snapshot analyses the active version, so a comparison by the listed id would hold the analysis
  against the rows of the draft, and would report a reference of the draft as one the analysis missed. Record
  0045 allows a name only where there is no id. How the cross-check treats flows is put to the maintainer with
  its design, in work package 6. Until then the rows of flows are not compared.
- A process of the Process Builder is a flow to the Metadata API, and falls under the same rules.

What was not measured, and what this record therefore does not know:

- Any org but the one test org, a Developer Edition org, and any API version but 68.0.
- A flow with more than two versions, a flow whose active version is the latest of several, which needs no
  second retrieve, and a flow that has an active version, a newer draft and versions that are obsolete.
- A flow whose latest version is obsolete or an invalid draft while an older version is active.
- A process of the Process Builder asked for by a number.
- A flow of a managed package.
- A repository in the format of API version 43 or older, where by the reference of the Metadata API the name of
  a flow held the version number. Such a repository may hold several files per flow. What a snapshot of a Git
  source does with them was not looked at.
- Whether the reading of the reference above is right. It says that a version can be retrieved by its number,
  and the test org did hand out version 1 for the name with `-1`. It also recommends, on the page of
  `FlowDefinition`, to stop using that type to activate a flow from API version 44 on. It does not say that the
  type goes away, and the test org handed out the definition with version 68.0.
