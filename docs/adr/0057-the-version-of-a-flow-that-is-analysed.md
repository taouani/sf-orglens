# 0057. The version of a flow that the org hands out is the one analysed

- Status: Accepted
- Date: 2026-11-22
- Decisions: none (an answer of the maintainer to the Phase 2 plan)

## Context

An org keeps every version of a flow: at most one is active, and there can be a newer draft and older versions
beside it. A repository holds one file per flow. Phase 2 analyses flows, so it has to say which version of a flow
of an org an answer speaks of.

The question was put to the maintainer as Q3 of the [Phase 2 plan](../plans/phase-2.md), with two options: (a) the
version the org hands out for the flow, (b) every version, read through the Tooling API, with more requests and
several components for one flow. The maintainer chose (a) on 22 November 2026.

## Decision

**The version of a flow that the org hands out in a retrieve is the one that is analysed.**

**A reference from a flow that is not active says so**, as a reference from a validation rule that is not active
does.

That is all the maintainer decided.

## What goes further than the answer of the maintainer

Three statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **A flow is one component, whatever the number of its versions.** The option the maintainer did not choose had
  several components for one flow. The author reads the answer as one.
- **Which version an org hands out is not verified.** The author expects the active version, and the latest one
  when none is active, and did not see it on an org. Work package 1 of the plan measures it on the test org, with a
  flow that has an active version and a newer draft and with a flow that is not active. If the org hands out
  something else, the author comes back to the maintainer before the analyser of flows is built, as the plan
  says.
- **The other versions are not read.** A draft that is newer than the active version is not in a snapshot, so an
  answer does not hold what the draft would change.

## Consequences

- The key of a flow and of its elements holds no version (record [0010](0010-data-model-and-identity.md)). A
  snapshot of an org and one of a repository give the same keys for the same flow.
- A snapshot of an org and a repository can differ for a flow because the org hands out the active version and the
  repository holds a newer one. That is a difference a comparison of snapshots shows, in Phase 4.
- The rows of the Dependency API for a flow may carry the id of a version, which the org does not list. Work
  package 1 measures that too. If so, the rows of flows cannot be compared by id, and record
  [0045](0045-the-cross-check-of-a-snapshot.md) allows a name only where there is no id. That choice is then put
  to the maintainer.
- A process of the Process Builder is a flow to the Metadata API, and falls under the same rule.
