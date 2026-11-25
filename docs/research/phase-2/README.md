# Phase 2 research notes

Notes written while Phase 2 is built. Claims are marked with the run or the check they come from, or
`[unverified]`. The notes of Phase 1 are in [`../phase-1/`](../phase-1/README.md).

| Note | What it holds |
| --- | --- |
| [real-org.md](real-org.md) | What the runs against the test org showed with the larger fixture project of Phase 2: two deploys that Salesforce refused and one it accepted, what it rewrites in a flow, which of the new pairs of the answer key the Dependency API reports, that a row from a flow carries the id of a version, that the org hands out the draft of a flow that has an active version and a newer draft, and that it hands out the active version when it is asked for by the name of the flow with the number of that version. |
| [public-codebases.md](public-codebases.md) | Every flow, file of workflow rules and record type of the eight public codebases read by hand with what OrgLens reports for it, and the field sets and the records of custom metadata types held against their files: no wrong reference, seven missed names with their cause, the names that give no reference by a rule, and the times of the commands on the codebases and on two made-up sources of about 100,000 components. |
| [impact-times.md](impact-times.md) | The impact times of the synthetic org, measured again on 25 November 2026 with the engine after pull request 83 and with the engine of the close of Phase 1, on the same machine: they have not changed beyond the spread of the runs, and an answer from the hub field holds the flows its elements bring. |

The notes are kept as written and are not updated when later work supersedes them. The phase plan and the decision
records are the current truth.
