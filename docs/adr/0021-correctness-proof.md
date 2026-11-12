# 0021. A three-level proof of correctness and a gate before anything else

- Status: Accepted
- Date: 2026-11-11
- Decisions: M4

## Context

For an impact tool, a missed dependency in front of a client destroys trust, and a wrong result is worse than no
result. None of the prototypes could show that its results were correct. Research also found that Salesforce's own
dependency data is weaker than assumed, so it cannot be the only yardstick.

## Decision

Correctness is proven at three levels.

1. **A fixture project built for the purpose**, with a hand-written answer key listing every expected reference
   and a list of negatives that must never be reported. It runs in CI on every change.
2. **Large public Salesforce codebases**, pinned by commit, cross-checked against the Dependency API and
   compiler data where an org is available.
3. **One real org of 10,000 or more components**, run privately with the owner's permission. Nothing from it
   enters the repository, the benchmarks or the issue tracker.

The gate: no dependency that Salesforce confirms is missing from OrgLens, and every difference between the two is
explained. Riders, language-model features and any announcement wait for the gate
([0002](0002-scope-and-release-order.md)).

## Consequences

- The answer key is the primary proof and must stand on its own. It is reviewed before any analyser is run
  against it, so that it is not shaped by what the analyser happens to find.
- Level 3 depends on access to a suitable org. Finding it early also allows large-org testing before the gate.
- The gate costs two to three weeks in the plan, and it is the point at which claims about the tool become
  backed by evidence.
