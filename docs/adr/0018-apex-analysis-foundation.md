# 0018. Apex analysis is built on `web-tree-sitter-sfapex`, chosen after a measured trial

- Status: Accepted
- Date: 2026-11-13
- Decisions: S3

## Context

Method-to-field references ([0011](0011-apex-reference-granularity.md)) need a parser for Apex and a type resolver
on top of it. The choice of parser determines months of work and cannot be settled from documentation.

Research in Phase 0 already changed the candidate list. The npm package `@apexdevtools/apex-ls` exposes only one
lookup function, and the real analyser runs only on Java, so it is dropped as a run-time candidate. The two
remaining candidates, `@apexdevtools/apex-parser` and `tree-sitter-sfapex`, are syntax parsers only. Whichever wins,
OrgLens owns the resolver.

## Decision

Decision S3 was that the parser is chosen after a trial in Phase 0 (work package WP9 of the
[Phase 0 plan](../plans/phase-0.md)): one resolver written once over a thin syntax interface, two parser adapters,
scored against the hand-written answer key of the fixture project and run over public codebases for robustness,
speed and memory.

Pass marks on the fixture: recall at least 95%, precision at least 98%, read or write correct for at least 99% of
matches, and no hits on the negative cases. The time box is four working days with a hard stop at five.

Decision S3 was agreed on 11 November 2026. This record was written the day after as `Proposed`, to be completed
with the measurements and the chosen parser. The trial reported on 12 and 13 November. The maintainer chose on
13 November 2026.

**OrgLens builds its Apex analysis on `web-tree-sitter-sfapex`**, under a resolver of its own. The sections below
give the measurements, why the trial itself did not select a parser, the choice, and what this record says
beyond the choice.

## What the trial reported

The trial ran on 12 November 2026 and was measured again on 13 November 2026 after the review of its pull
request. The full report is [docs/research/phase-0/apex-trial.md](../research/phase-0/apex-trial.md), the code is
in `trial/apex`. Memory is in MiB.

| Measure                                                       | `@apexdevtools/apex-parser` 5.3.0 | `web-tree-sitter-sfapex` 3.0.2 |
| ------------------------------------------------------------- | --------------------------------- | ------------------------------ |
| Fixture: recall, precision, kind right                        | 181 of 181 each                   | 181 of 181 each                |
| Fixture: references on a negative case in Apex                | 0 of 16                           | 0 of 16                        |
| apex-recipes, Nebula Logger, NPSP: references found           | 59,845                            | the same 59,845                |
| Classes and triggers of the three codebases that do not parse | none                              | none                           |
| NPSP, 319,835 lines: time for everything                      | 19.4 to 21.8 s                    | 3.6 to 4.1 s                   |
| NPSP: peak memory with the default heap of Node.js            | 1,490 to 1,546 MiB                | 430 to 436 MiB                 |
| NPSP: peak memory with the heap limited to 1,024 MiB          | 1,047 to 1,108 MiB, the same time | not needed                     |
| NPSP: the smallest heap that was tried and works              | 768 MiB with its cache kept       | 256 MiB                        |
| 1,781 damaged files: references kept, with the right member   | 77.9%                             | 82.1%                          |
| 1,781 damaged files: references kept, whatever the member     | 87.7%                             | 83.2%                          |
| 48 pieces of recent syntax                                    | all read                          | all read                       |
| Lines of the adapter                                          | 695                               | 584                            |

Of 100 references sampled from apex-recipes and checked by hand, all 100 are right. The check was done by the AI
assistant that wrote the resolver, not by a second person, and the sample holds few references of the hard
kinds. Of the 766 calls between methods that `apex-ls` on Java finds in apex-recipes, the trial finds 751. The
other 15 are calls of a method Salesforce provides.

By the rule of the plan a candidate must first pass the gates of install, robustness and performance. The mark
for NPSP was under 60 seconds and under 1.5 GB. **Both candidates pass every gate and every pass mark.**
`apex-parser` passes the memory mark with a heap setting. An earlier version of this record said that it misses
the mark. That rested on the default heap of one machine, and the review of the pull request corrected it.

The tie-break of the plan is, in this order: recovery on broken code, how current the grammar is, the quality of
the TypeScript API, then speed.

1. Recovery on broken code: `apex-parser` keeps more after a missing brace, `web-tree-sitter-sfapex` after a
   missing quote. Over all cases the lead turns with what is counted. No clear lead.
2. How current the grammar is: equal on what was measured.
3. Quality of the TypeScript API: `apex-parser` has types that cannot be trusted after a syntax error,
   `web-tree-sitter-sfapex` has none. A judgment, not a measurement.
4. Speed: `web-tree-sitter-sfapex` is about five times as fast on NPSP, with 30 to 40 percent of the memory.

**The trial does not select a parser.** The first criterion that separates the two by a measurement is the last
one, and a reader can weigh the third the other way. The author of the trial recommended
`web-tree-sitter-sfapex` and put the choice to the maintainer.

## The choice

The maintainer chose `web-tree-sitter-sfapex` on 13 November 2026. A summary of the measurements above and the
recommendation were put to the maintainer with the question, beside the other parser and the option to decide
later. The choice is a judgment of the maintainer. The rule of the plan did not make it.

That is all the maintainer decided.

## What goes further than the choice of the maintainer

Two statements of this record are conclusions of its author. The maintainer can strike either one without
touching the choice.

- The adapter of `@apexdevtools/apex-parser`, which is not chosen, is kept in `trial/apex`. The question to the
  maintainer said that it stays as a fallback, and the maintainer was not asked to decide it. A test holds the
  lowered models of the two parsers against each other on the fixture project and on the 48 pieces of syntax, so
  a change of the grammar of either one shows at once. The engine is meant to be able to change parser by taking
  the other adapter. That is not shown: the engine has no Apex analysis yet, and it may not import `trial/apex`.
- `web-tree-sitter-sfapex` and `web-tree-sitter` become run-time dependencies of the engine in the phase that
  builds Apex analysis, not before. Until then they are dependencies of the trial only. This follows from the
  rule that no feature of a later phase is started early.

## Consequences

- The choice rests on measurements on real code, and where the measurements do not decide, on a judgment that
  is said to be one.
- The cross-check for Apex is the Dependency API alone. The first runs against a real org showed that the symbol
  table the org keeps for a saved class holds declarations and no reference
  ([real-org.md](../research/phase-0/real-org.md)), and the maintainer decided on 12 November 2026 not to compile
  in the org to get more. An earlier version of this record said that compiler symbol data stays as a cross-check.
- The resolver of the trial is a spike. The phase that builds Apex analysis writes the production resolver, and
  starts from the list "What the resolver does not do" in the report. That list holds references to things that
  do not exist, reported as `confirmed`: the production resolver must check every name against the description
  of the objects, and lower the tier of what it cannot check.
- `web-tree-sitter-sfapex` is maintained by one person, and the names of its nodes are text that the compiler
  does not check. The second adapter and the test that compares the two are the answer to both. The grammar is
  WebAssembly. Loading it is the one step that is not synchronous, and a tree must be freed by hand.
- Not taken: `apex-parser`. With it OrgLens would have had to set the size of the heap when it starts, or empty
  the cache of the parser between files, and reading the Apex of a large org would take about five times as
  long. It recovers more after a missing brace, and that advantage is given up.
- `apex-ls` on Java may be used during development as an outside check of call-graph results. It is never
  shipped and never required of users.
