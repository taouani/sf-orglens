# 0011. Apex references at method-to-field level, with read or write

- Status: Accepted
- Date: 2026-11-11
- Decisions: D2

## Context

Apex is where most hidden dependencies live. A reference at class level ("this class uses that object") produces
impact lists too long to act on. Users trust a result when they can see the line it comes from.

## Decision

Apex references are recorded from the method (or constructor, property or initialiser) to the field, method or type
it uses. A field reference states whether it is a read or a write. Every reference carries the file and the exact
position in the source.

## Consequences

- Impact chains are tight: changing a field lists the methods that touch it and whether they read or write it.
- Showing the source line makes each result checkable in seconds.
- This needs type resolution, not just parsing. Research showed that no available library provides it, so
  OrgLens owns the resolver. It is the largest and least certain piece of work in the plan.
- If a reference can only be resolved to the class, it is stored at that level with a lower confidence tier
  instead of being dropped.
