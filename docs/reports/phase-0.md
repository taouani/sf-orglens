# Phase 0 report: Foundations

Written on 13 November 2026 by the AI assistant that built the phase, for the maintainer. The plan of the phase
is [`docs/plans/phase-0.md`](../plans/phase-0.md). The checks you can run yourself are in the
[test plan](../test-plans/phase-0.md).

## In short

- All ten work packages are built. The six outcomes of the plan are reached, with the limits named below.
- OrgLens can make a workspace, declare sources, log in to an org without holding a credential, and store an
  org or a repository folder as an immutable snapshot in one SQLite file. It analyses nothing yet.
- The two questions the phase was there to answer have answers:
  - **What Salesforce can confirm.** The Dependency API is usable as a cross-check for custom fields and custom
    objects, within known limits. The symbol tables of the compiler are not usable. You decided that the
    Dependency API alone is the cross-check (record [0034](../adr/0034-dependency-api-is-the-cross-check.md)).
  - **Which parser.** Both candidates give the same references with one resolver, and both pass every mark of
    the plan. `web-tree-sitter-sfapex` is about five times as fast on the largest codebase and needs 30 to 40
    percent of the memory. On damaged files neither is better throughout. The tie-break of the plan needs a
    judgment, so the trial does not select a parser. I recommend `web-tree-sitter-sfapex`, and you choose. Record
    [0018](../adr/0018-apex-analysis-foundation.md) is `Proposed` until then.
- One thing was never run: the command `orglens snapshot` against Salesforce with a login of the Salesforce CLI.
  The code behind it ran against the test org. Part G of the test plan is that run, and only you can do it.

## The outcomes of the plan

| #   | Outcome of the plan                                                                                                    | State                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `init`, `source add`, `list`, `remove`, `status`, `doctor`, `snapshot` and `coverage` work on Linux, macOS and Windows | Built, and `source link` and `source check` beside them. Tested by CI on the three systems, on Node.js 24 and 26. Run by hand on Linux only.                                                                                        |
| 2   | `snapshot` retrieves a real org in chunks, can resume, and stores an immutable snapshot                                | Built. The engine read the test org twice, in two chunks, into 5,010 files. Resuming and the splitting of a chunk ran against a mock org only: the test org never needed either. The command itself was not run against Salesforce. |
| 3   | A fixture project with a hand-written answer key, checked by CI                                                        | Built: 52 components, 184 references of Apex and 44 of formulas and rules, 21 negatives, 5 unknowns. Salesforce accepted the project on the first deploy, and the Dependency API contradicts no entry of the key.                   |
| 4   | The Apex analysis foundation is chosen by a measured trial and recorded                                                | The trial is done. It does not select a parser: both pass, and the tie-break needs a judgment. The record is `Proposed` until you choose.                                                                                           |
| 5   | We know from a real org what the Dependency API and compiler symbol data are good for                                  | Measured on one small Developer Edition org. Not measured: an org above 2,000 rows per query, flows, and every type the fixture project does not hold yet.                                                                          |
| 6   | Every decision is a decision record, and the plans are in git                                                          | 34 records. 0018 is `Proposed`, 0008 is superseded by 0034, the others are `Accepted`.                                                                                                                                              |

## What was built

| Work package              | What exists                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Repository and CI       | A pnpm workspace with two packages, Apache 2.0, contribution files, CI on three systems, a package smoke test, a release workflow as a dry run. The layer rules are enforced by an ESLint rule, by dependency-cruiser and by the `exports` map, and probe files prove that each of them fires.                              |
| 2 Project documents       | The overall plan, this phase's plan, nine research notes, 34 decision records and a script that checks them.                                                                                                                                                                                                                |
| 3 Engine core             | Component keys with their grammar, the reference vocabulary, typed errors with stable codes, a logger that masks tokens.                                                                                                                                                                                                    |
| 4 Store                   | SQLite through a driver port, with `node:sqlite` as the default and `better-sqlite3` as the tested fallback. Migrations, a schema for sources, snapshots, shared file contents, the inventory of an org and the journal of a retrieve. A benchmark on a synthetic org.                                                      |
| 5 Workspace, config, CLI  | `orglens.toml` and `.orglens/local.toml` with strict reading and edits that keep the file as written. One JSON envelope, six exit codes, a JSON Schema of every output. `doctor`.                                                                                                                                           |
| 6 Fixture and answer key  | `fixtures/billing-sfdx`, `fixtures/expected/answer-key.v0.yaml`, a test that holds the two together, and a manifest of three public codebases pinned by commit.                                                                                                                                                             |
| 7 Salesforce connectivity | Logins by three routes, none of which stores a credential. An inventory of the org with every component named, a retrieve in chunks that splits a chunk Salesforce refuses, a journal that lets an interrupted snapshot continue, the count of what came back against what was listed. Snapshots of a Git folder or commit. |
| 8 Real org                | A workflow that logs in to the test org every week, and on request deploys the fixture project, reads the org and asks Salesforce about references. Its log is public and built so that it cannot show a name of the org.                                                                                                   |
| 9 Apex trial              | `trial/apex`: one model of the syntax of Apex, two parser adapters, one resolver, a score against the answer key.                                                                                                                                                                                                           |
| 10 Phase close            | The updated overall plan, the test plan, this report, the draft of the Phase 1 plan.                                                                                                                                                                                                                                        |

In numbers: about 10,800 lines of TypeScript in the engine and the command line, about 19,600 lines of tests, and
about 4,000 lines in the trial. About 1,170 tests run on every pull request on three systems. Statement coverage of
the two packages is 96.7 percent. 14 pull requests before the one that closes the phase, each with a code review by a separate agent before it was
merged.

## What was measured

Each number has its conditions in the note it comes from. All of them are single measurements or a handful of
runs on one machine or one org.

| Question                                         | Answer                                                                                                                                                            | Note                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Does the storage layout hold at the target size? | A synthetic org of 147,000 components and 600,000 references: ten snapshots in 159 MB, an impact query over five levels in 3 ms from memory. Linux only.          | [store-benchmark.md](../research/phase-0/store-benchmark.md) |
| How fast does a command start?                   | `orglens status` in 72 ms at the median, against a budget of 150 ms.                                                                                              | `pnpm run check:startup`                                     |
| How long does a real org take to read?           | 120 and 197 seconds for a Developer Edition org of 1,668 listed components and 5,010 files, 408 MB of memory. Nearly all of it is Salesforce building a zip.      | [real-org.md](../research/phase-0/real-org.md)               |
| What does the Dependency API report?             | 100 of the 137 pairs of the answer key, none wrong. Nothing for standard fields, names in text, lookups, roll-up summaries and inactive rules.                    | [real-org.md](../research/phase-0/real-org.md)               |
| What do compiler symbol tables hold?             | Declarations, and no reference.                                                                                                                                   | [real-org.md](../research/phase-0/real-org.md)               |
| Can one resolver reach the pass marks?           | 181 of 181 on the fixture with either parser, and the same 59,845 references on three public codebases of 394,000 lines.                                          | [apex-trial.md](../research/phase-0/apex-trial.md)           |
| How do the parsers differ?                       | NPSP, 320,000 lines: about 4 seconds and 430 MiB with tree-sitter. About 20 seconds with apex-parser, and 1,050 to 1,550 MiB depending on the heap it is allowed. | [apex-trial.md](../research/phase-0/apex-trial.md)           |

## What changed against the plans

- **Decision A4.** The cross-check from Salesforce is the Dependency API alone. Compiler symbol data is out, and
  nothing is compiled in an org. Record 0034 replaces 0008.
- **The correctness gate** can lean on Salesforce for custom fields and custom objects only. For standard fields
  and for names in text, the answer key and the public codebases are the only measure. How the gate is worded
  for those is a question to you in the Phase 1 plan.
- **A snapshot of a real org is "partial" every time.** The test org lists 223 components that Salesforce does
  not hand out, 179 of them parts such as list views. The word was meant for a retrieve that failed. What
  "complete" should mean is a question to you in the Phase 1 plan.
- **Reading an org needed more than the plan said.** The retrieve of the Salesforce library is not used. OrgLens
  makes four requests of the Metadata API itself, so that it can set time limits, refuse redirects, keep the
  state of a retrieve in the database and never write into a project folder (record 0032).
- **The parser.** The research before the trial ranked `apex-parser` slightly ahead. The trial found the two
  equal in output and `web-tree-sitter-sfapex` far ahead in speed and memory. My first report of the trial said
  that `apex-parser` misses the memory mark of the plan. The code review of the pull request showed that this
  rested on one heap setting, and I withdrew it. I then measured recovery on 1,781 damaged files, which is mixed.
- **What the code review of the trial found in the resolver.** It reports references to things that do not
  exist at the tier `confirmed`, because it checks no field name against the description of the object, and it
  drops some names without a word. Both are counted in the report of the trial and are work for the Apex phase.
- **The Apex resolver is feasible, and it is not small.** The spike is about 1,600 lines and still lacks
  overloads by type, interfaces, and a complete description of standard objects. The estimate for the Apex phase
  stays at 8 to 12 weeks.
- **Effort.** The plan estimated 23 to 25 developer-days. The phase was built in two calendar days, because an AI
  assistant did the building and you answered within hours. The estimates in weeks of the overall plan are kept
  as a measure of the size of each phase. Phase 0 says that they are a poor forecast of elapsed time, which
  depends on your reviews and decisions and on access to orgs.
- **Work that was not in the plan:** the rule for what a public log may show (record 0033), the two logins of the
  Salesforce library that write into the home folder and how OrgLens avoids them (record 0031), and a third
  public codebase, Nebula Logger, in the trial.

## What is not done, and what is not verified

- `orglens snapshot` against Salesforce with a Salesforce CLI login. Part G of the test plan.
- A sandbox, an org with a namespace of its own, an org of 10,000 components. Only one small org was read.
- Resuming an interrupted snapshot and splitting a chunk, against Salesforce. Both are tested against a mock org.
- Profiles and permission sets are read incompletely: a retrieve in chunks hands out a profile with the access
  to the components of its chunk only. The snapshot says so. Reading access completely belongs to the phase that
  builds access impact.
- 32 of the 223 components that the test org does not hand out are not explained, 24 of them reports.
- The answer key and the 100 references of the hand check were written and checked by me, not by a second
  person.
- Nothing by hand on Windows or macOS. CI is the only evidence there.
- No release. Nothing is on npm, and the name of the package can still change.

## Open with you

1. Approve or reject the phase, after the test plan.
2. Choose the parser.
3. The questions in section 4 of the [Phase 1 plan](../plans/phase-1.md).
4. Two things in the settings of the repository that I cannot do: close pull request 2, which Dependabot opened, and confirm that private vulnerability reporting is switched on.
