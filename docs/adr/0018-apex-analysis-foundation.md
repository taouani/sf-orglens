# 0018. Apex analysis foundation chosen by a measured trial

- Status: Proposed
- Date: 2026-11-11
- Decisions: S3

## Context

Method-to-field references ([0011](0011-apex-reference-granularity.md)) need a parser for Apex and a type resolver
on top of it. The choice of parser determines months of work and cannot be settled from documentation.

Research in Phase 0 already changed the candidate list. The npm package `@apexdevtools/apex-ls` exposes only one
lookup function, and the real analyser runs only on Java, so it is dropped as a run-time candidate. The two
remaining candidates, `@apexdevtools/apex-parser` and `tree-sitter-sfapex`, are syntax parsers only. Whichever wins,
OrgLens owns the resolver.

## Decision

The parser is chosen by a trial in Phase 0 (work package WP9 of the [Phase 0 plan](../plans/phase-0.md)): one
resolver written once over a thin syntax interface, two parser adapters, scored against the hand-written answer key
of the fixture project and run over public codebases for robustness, speed and memory.

Pass marks on the fixture: recall at least 95%, precision at least 98%, read or write correct for at least 99% of
matches, and no hits on the negative cases. The time box is four working days with a hard stop at five.

**This record stays `Proposed` until the trial reports.** It is then completed with the measurements and the chosen
parser.

## Consequences

- The choice rests on measurements on real code, not on reading documentation.
- Compiler symbol data from the org stays as a cross-check whichever parser is chosen.
- `apex-ls` on Java may be used during development as an outside check of call-graph results. It is never
  shipped and never required of users.
- If neither candidate reaches the pass marks, the trial reports the gap and the maintainer decides how to
  proceed.
