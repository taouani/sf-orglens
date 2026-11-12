# 0013. Impact is reachability first, then change-aware rules

- Status: Accepted
- Date: 2026-11-11
- Decisions: D3

## Context

"What breaks if I change this?" has two readings. The simple one is everything that can reach the component through
references. The precise one depends on the change: deleting a field breaks every reader, renaming a picklist value
breaks only comparisons against it.

## Decision

The impact engine first answers by reachability: every component that depends on the target, with the path of
references that explains each one.

Change-aware rules are added on top, one change type at a time, starting with delete and data-type change.

## Consequences

- Reachability is useful from the first slice and is easy to verify against an answer key.
- Change-aware rules are where the tool becomes more than a where-used list, and each rule can be proven on its
  own.
- Until a change type has a rule, the answer for it is the reachability answer, and the output says so.
