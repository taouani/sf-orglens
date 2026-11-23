# 0062. A snapshot of an org fetches the active version of a flow by its number, and notes a newer version

- Status: Accepted
- Date: 2026-11-23
- Decisions: none (the second part of work package 3 of the Phase 2 plan)

## Context

Record [0060](0060-the-active-version-of-a-flow-is-analysed.md) holds the answer of the maintainer: the active
version of a flow is analysed, and a newer draft is reported as present and not analysed. Its section "What goes
further than the answer of the maintainer" holds the design of its author for the fetch, which the maintainer can
strike, and leaves two points to the build: where the snapshot keeps that a flow has a newer version, and what
the Salesforce library makes of a file named `Invoice_Recalculate-1.flow`.

This record holds how the fetch is built. What follows are choices of the author, beside the design of record
0060, and the maintainer can strike any of them.

## Decision

1. **The fetch is one step of a snapshot of an org, after the last chunk and before the cross-check.** It reads
   the files the snapshot holds: a file of a flow that names a state other than `Active`, and the file of its
   `FlowDefinition` (`flowDefinitions/<flow>.flowDefinition-meta.xml`), which the org lists and hands out with
   the other types. Where the definition names an active version, the flow is asked for as `<flow>-<number>`.
   The versions of several flows are asked for in one retrieve, at most 100 in one. A retrieve that Salesforce
   refuses or fails is tried in two halves, down to the one flow.
2. **The Salesforce library takes the file `Invoice_Recalculate-1.flow` for a flow named `Invoice_Recalculate-1`.**
   That was tried with the library of the engine on a zip file written for the purpose. The step reads both
   names in what comes back, and takes a file only if it names the state `Active`. It is stored under the path of
   the flow, without the number, in the place of the file of the newer version.
3. **That a flow has a newer version is kept as a note of the reading**, `FLOW_NEWER_VERSION`, with the key of
   the flow as its component and the number of the active version and the state of the newer one in its details.
   A snapshot keeps its issues, so an analysis that runs later without the org finds it there, and an answer of
   work package 6 can find it by the key. No table and no column is added. The file of the newer version is not
   kept in the snapshot: a file under `flows/` is a flow to the analysis. Its content stays in the store of
   contents, which keeps every content it was given.
4. **A flow whose active version does not come back is taken out of the snapshot**, with the file of its newer
   version, and the org's listing of it counts as not handed out. The error `NOT_RETRIEVED` of the logic tier
   says so and makes the snapshot partial, as record 0060 asks. The note `ACTIVE_FLOW_NOT_RETRIEVED` beside it
   says why: what Salesforce said, its remark about the name with the number, or the states of the files that
   came back.
5. **A flow the org lists under another name than that of its file is not asked for by a number.** That is a flow
   of a package that comes back without the prefix of its package (record
   [0047](0047-what-the-org-says-where-the-library-falls-short.md)). It is kept as it came, with the warning
   `FLOW_VERSION_UNKNOWN`, as a flow without a definition is. Asking for such a flow by a number was not seen to
   work on any org.
6. **What the step does is written with the file it is about**, in one transaction for each retrieve. A snapshot
   that stops in the middle of the step, and is continued, does it again only for the flows it had not done: a
   flow that was done holds an active file, or no file.
7. **The mock org of the tests keeps a definition of every flow**, as the test org did (run 19 of "Live org":
   seven flows, seven definitions), and answers for a name with a number as run 22 showed, for a flow a test
   gives versions to. What a definition says for a flow without an active version was not seen: the mock org
   names no number then.

## Consequences

- A snapshot of an org where the latest version of a flow is not active holds its active version. The analysis
  of that snapshot gives the same components and references as one of an org without the newer version: a test
  says so for the fixture project with the draft of `Invoice_Recalculate`.
- A snapshot of an org now holds a file for every definition of a flow. It is a component of a type that is not
  analysed. The read tool of "Live org" counts six more components and files on the mock org.
- The notes `FLOW_NEWER_VERSION` and `ACTIVE_FLOW_NOT_RETRIEVED` and the warning `FLOW_VERSION_UNKNOWN` are new
  codes of the JSON contract (`docs/cli.md`). The shape of an issue does not change.
- An answer does not say yet that a flow has a newer version. That is work package 6.
- Not verified on an org: the step itself, several flows asked for by their numbers in one retrieve, a flow whose
  latest version is obsolete, a flow of a package, and what a definition says for a flow without an active
  version. The run of "Live org" that the plan asks for, with the draft of `Invoice_Recalculate` in the test org,
  is the first check against Salesforce, after this record is merged.
