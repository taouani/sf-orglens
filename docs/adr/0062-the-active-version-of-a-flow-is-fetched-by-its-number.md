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
   A definition that names a number Salesforce would not write, such as `01` or `1.5`, is not read as one: the
   flow gets the warning of point 5 with the reason `definition-unreadable`.
2. **The versions are asked for with the care a chunk gets.** The versions of several flows are asked for in one
   retrieve, at most 100 in one. A start the org refuses is asked for again after a pause, and a job that gives
   no result, because Salesforce no longer knows it or cannot say how far it is, is started again, each up to
   three times as for a chunk. A retrieve that fails is tried in two halves, down to the one flow, and the note
   `CHUNK_SPLIT` says so. After 20 retrieves in a row that gave nothing, the snapshot stops, as it does for
   chunks, and a snapshot that is continued asks for the flows it had not done. One thing differs: the job of a
   chunk is kept with the snapshot, so that a continued snapshot waits for it, and the job of a version is not,
   because no table and no column is added. A job of a version that does not end in 30 minutes is therefore
   started again at once, and after three starts its flows are taken out as in point 5. Without that, a job
   that never ends would stop the snapshot at every continuation. The review of the pull request of this record
   found that its first version had none of this care.
3. **The Salesforce library takes the file `Invoice_Recalculate-1.flow` for a flow named `Invoice_Recalculate-1`.**
   That was tried with the library of the engine on a zip file written for the purpose. The step reads both
   names in what comes back, and takes a file only if it names the state `Active`. It is stored under the path of
   the flow, without the number, in the place of the file of the newer version. A file that comes back under the
   name without the number is the latest version (run 22 of "Live org"): the flow was made active between the
   chunk of its file and the step, and has no newer version, so no note says that it has one.
4. **That a flow has a newer version is kept as a note of the reading**, `FLOW_NEWER_VERSION`, with the key of
   the flow as its component and the number of the active version and the state of the newer one in its details.
   A snapshot keeps its issues, so an analysis that runs later without the org finds it there, and an answer of
   work package 6 can find it by the key. No table and no column is added. The file of the newer version is not
   kept in the snapshot: a file under `flows/` is a flow to the analysis. Its content stays in the store of
   contents, but nothing of the snapshot points at it any more, so it cannot be found from the snapshot. The
   three codes of this record are the first issues of the reading that name a component: `docs/cli.md` and the
   JSON Schema say so, and the text of a command shows one line for each code, with the number of flows.
5. **A flow whose active version does not come back is taken out of the snapshot**, with the file of its newer
   version, and the org's listing of it counts as not handed out. The error `NOT_RETRIEVED` of the logic tier
   says so and makes the snapshot partial, as record 0060 asks. The note `ACTIVE_FLOW_NOT_RETRIEVED` beside it
   says why: what Salesforce said, its remark about the name with the number, the files it handed out that
   could not be read as metadata, or the states of the files that came back.
6. **A flow of which it is not known which version is active is kept as it came, with the warning
   `FLOW_VERSION_UNKNOWN`.** The snapshot holds no definition of it (`no-definition`, or `excluded` where the
   source leaves `FlowDefinition` out), or its definition cannot be read (`definition-unreadable`). An impact
   answer that covers flows counts the warning with the warnings of the analysis: the answer is not complete,
   and `mayMiss` stays as it is, because the flow was read and only its version is in doubt. The warning names
   the type `Flow` in its details for that count.
7. **A flow the org lists under another name than that of its file is not asked for by a number,** and is kept
   as it came with the same warning, with the reason `not-listed` and the number of the active version. That is
   a flow of a package that comes back without the prefix of its package (record
   [0047](0047-what-the-org-says-where-the-library-falls-short.md)). Asking for such a flow by a number was not
   seen to work on any org. Here the definition names an active version, so the file is known not to be the one
   that runs, and record 0060 takes such a flow out of the snapshot. **A choice of the author, for the maintainer
   to strike:** the flow is kept with the warning. Taking it out means marking the listed name, with its prefix,
   as not handed out. The snapshot does not keep which listed name a file came back for, so it could take the
   file out and leave the listing as it was: the snapshot would then be complete while it lacks a flow. The
   message of the warning says that the file is not the active version. No such flow was seen on an org.
8. **What the step does is written with the file it is about**, in one transaction for each retrieve. A snapshot
   that stops in the middle of the step, and is continued, does it again only for the flows it had not done: a
   flow that was done holds an active file, or no file. The step tells the command how many flows it asks for,
   and the command prints a line.
9. **The mock org of the tests keeps a definition of every flow**, as the test org did (run 19 of "Live org":
   seven flows, seven definitions), and answers for a name with a number as run 22 showed, for a flow a test
   gives versions to. What a definition says for a flow without an active version was not seen: the mock org
   names no number then. A file the mock org hands out beside the files of the project, such as a definition or
   an older version, counts against the number of files a test lets one retrieve hold, so that a test can make
   the retrieve of a version fail.

## Consequences

- A snapshot of an org where the latest version of a flow is not active holds its active version. The analysis
  of that snapshot gives the same components and references as one of an org without the newer version: a test
  says so for the fixture project with the draft of `Invoice_Recalculate`.
- A snapshot of a real org held the definitions of its flows before this record: run 19 counted seven. The mock
  org of the tests did not, and does now, so the read tool of "Live org" counts six more components and files on
  the mock org. A definition is a component of a type that is not analysed.
- The notes `FLOW_NEWER_VERSION` and `ACTIVE_FLOW_NOT_RETRIEVED` and the warning `FLOW_VERSION_UNKNOWN` are new
  codes of the JSON contract (`docs/cli.md`). The shape of an issue does not change, but an issue of the reading
  can now name a component.
- An answer does not say yet that a flow has a newer version. That is work package 6.
- Not verified on an org: the step itself, several flows asked for by their numbers in one retrieve, a flow whose
  latest version is obsolete, a flow of a package, and what a definition says for a flow without an active
  version. The run of "Live org" that the plan asks for, with the draft of `Invoice_Recalculate` in the test org,
  is the first check against Salesforce, after this record is merged.
