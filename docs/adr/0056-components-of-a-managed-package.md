# 0056. Components of a managed package are kept and marked, and are left out of an answer as the thing that refers

- Status: Accepted
- Date: 2026-11-22
- Decisions: none (an answer of the maintainer to the Phase 2 plan)

## Context

The maintainer noted on 15 November 2026 that the goal is all metadata except what comes from managed packages,
and wrote with the approval of the Phase 1 plan that the metadata to read "should cover almost everything in the
org" (record [0038](0038-a-snapshot-reads-every-type.md)). The author of that record read "almost" as the packages
and left open how they are left out. The [overall plan](../plans/re-architecture-plan.md#open-questions) holds it as
the open question "Managed packages".

Today a snapshot reads the components of a package and analyses them like any other. The code of a package is
hidden. Its objects and fields are not, and the metadata of the org itself refers to them.

The question was put to the maintainer as Q2 of the [Phase 2 plan](../plans/phase-2.md), with three options: (a)
read and keep the components of a package, mark each with its package, and leave them out of an answer as the thing
that refers, (b) do not retrieve them at all, (c) leave it as it is until Phase 4. The maintainer chose (a) on 22
November 2026.

## Decision

1. **A snapshot reads and keeps the components of a managed package**, as before.
2. **Each such component is marked with its package.**
3. **An impact answer leaves them out as the thing that refers.** A flow of a package that reads a field is not a
   result of the question about that field.
4. **A component of a package stays a target.** The question "what of mine refers to this field of the package"
   keeps working.
5. **An option of `impact` shows them.**

That is all the maintainer decided.

## What goes further than the answer of the maintainer

Five statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **How a component is known to be of a package is a choice of the build**, in work package 7 of the plan: from the
  namespace the org lists it with, from the prefix of its name, and from the state the org lists it with
  (`manageableState`), which a snapshot keeps since Phase 1 and which tells an installed component from one of
  the org's own namespace. An org with a namespace of its own was not read yet, so this is not verified.
- **A repository of a package project is not a package.** The components of a repository such as NPSP are the
  repository's own, whatever prefix they will carry once installed. The plan says so in its acceptance criteria.
- **An answer says how many results it left out**, in a line of its own, so that leaving out is never silent. The
  name of the option, the line and the field of the JSON output are written with work package 7, in
  `docs/cli.md` and in the schema of the output.
- **A chain through a component of a package is settled with work package 7.** An answer is walked level by level,
  and a result holds the reference to a result of the level before (record
  [0044](0044-an-impact-answer.md)). If a formula field of a package reads the field asked about and a flow of
  the org reads that formula field, the answer of the maintainer does not say whether the flow is a result, and
  if it is, what its reference points at. The author expects that the flow stays a result and that the answer
  names the component of the package it was reached through. That is not decided.
- **Not retrieving the components of a package can still be decided later.** The maintainer chose (a) among three
  options and did not say that (b) stays open. The author reads it so, because (a) drops nothing and (b) is the
  one that could help with the target of 60 minutes for a first snapshot (record
  [0037](0037-performance-targets.md)). The plan says that it is decided with a number from an org of the
  maintainer.

## Consequences

- A snapshot is not smaller and not faster by this decision.
- The decision can be undone by an option, because nothing is dropped from the snapshot.
- The cross-check with the Dependency API keeps its rows as Salesforce wrote them (record
  [0045](0045-the-cross-check-of-a-snapshot.md)). Whether a pair that Salesforce reports from a component of a
  package counts as missed is not decided by this record. It is settled in work package 7, and until then such a
  pair is treated like any other.
- `coverage` shows per type how many components are of a package.
- Still open from the question of the overall plan: at what confidence a reference into hidden code of a package
  is shown. That belongs to Phase 3, where Apex is analysed.
