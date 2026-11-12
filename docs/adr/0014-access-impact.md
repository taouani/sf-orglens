# 0014. Access impact from metadata by default, user assignments opt-in

- Status: Accepted
- Date: 2026-11-11
- Decisions: D4

## Context

The fourth impact question is who gains or loses access. Answering it fully needs to know which users hold which
profile or permission set, and that is personal data held in records, not metadata.

## Decision

By default, access impact is computed from metadata only: which profiles, permission sets and permission set groups
grant access to a component, and how those grants differ between two snapshots.

Reading user assignments is an explicit opt-in. When enabled it returns counts only, unless names are requested
explicitly.

## Consequences

- No personal data is read unless the user asks for it.
- The default answer is "which permission containers", not "which people". That is enough for most change
  reviews.
- The opt-in path needs its own data-handling rules when it is built.
