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

## What the trial reported

The trial ran on 12 November 2026. The full report is
[docs/research/phase-0/apex-trial.md](../research/phase-0/apex-trial.md), the code is in `trial/apex`.

| Measure                                                       | `@apexdevtools/apex-parser` 5.3.0 | `web-tree-sitter-sfapex` 3.0.2 |
| ------------------------------------------------------------- | --------------------------------- | ------------------------------ |
| Fixture: recall, precision, kind right                        | 181 of 181 each                   | 181 of 181 each                |
| Fixture: references on a negative case                        | 0 of 21                           | 0 of 21                        |
| apex-recipes, Nebula Logger, NPSP: references found           | 59,845                            | the same 59,845                |
| Classes and triggers of the three codebases that do not parse | none                              | none                           |
| NPSP, 320,093 lines: time for everything                      | 16.1 to 17.3 s                    | 3.04 to 3.13 s                 |
| NPSP: peak memory of the process                              | 1,501 to 1,532 MB                 | 437 to 442 MB                  |
| NPSP with the heap limited to 512 MB                          | out of memory                     | completes, also with 256 MB    |
| 47 pieces of recent syntax                                    | all read                          | all read                       |
| Lines of the adapter                                          | 669                               | 584                            |

Of 100 references sampled from apex-recipes and checked by hand, all 100 are right. Where `apex-ls` on Java and
the trial both record a call between two methods, they agree: 751 of the 766 edges of `apex-ls` on apex-recipes
are found, and the other 15 are calls of a method Salesforce provides.

By the rule of the plan a candidate must first pass the gates of install, robustness and performance. The mark
for NPSP was under 60 seconds and under 1.5 GB. `apex-parser` misses the memory mark in each of three runs.
`web-tree-sitter-sfapex` passes every gate and every pass mark.

**The parser the trial selects is `web-tree-sitter-sfapex`.** The maintainer confirms the choice. Until then this
record stays `Proposed`.

The adapter for `apex-parser` is kept. A test holds the output of the two parsers against each other on the
fixture project, so a change of the grammar of either one shows at once, and the engine can change parser by
changing one import.

## Consequences

- The choice rests on measurements on real code, not on reading documentation.
- The cross-check for Apex is the Dependency API alone. The first runs against a real org showed that the symbol
  table the org keeps for a saved class holds declarations and no reference
  ([real-org.md](../research/phase-0/real-org.md)), and the maintainer decided on 12 November 2026 not to compile
  in the org to get more. An earlier version of this record said that compiler symbol data stays as a cross-check.
- The resolver of the trial is a spike. The phase that builds Apex analysis writes the production resolver, and
  starts from the list "What the resolver does not do" in the report.
- `web-tree-sitter-sfapex` has one maintainer, and the names of its nodes are text that the compiler does not
  check. The second adapter and the test that compares the two are the answer to both.
- The grammar is WebAssembly. Loading it is the one step that is not synchronous, and a tree must be freed by hand.
- `apex-ls` on Java may be used during development as an outside check of call-graph results. It is never
  shipped and never required of users.
- If neither candidate reaches the pass marks, the trial reports the gap and the maintainer decides how to
  proceed.
