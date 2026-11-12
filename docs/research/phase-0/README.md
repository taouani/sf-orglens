# Phase 0 research notes

Six notes written on 11 November 2026, before the [Phase 0 plan](../../plans/phase-0.md). Each one comes from
installing and running the libraries in question, not from reading about them. Claims are marked `[hands-on]`,
`[docs]` or `[unverified]`, with the evidence underneath.

| Note | Question it answers |
| --- | --- |
| [toolchain.md](toolchain.md) | Which TypeScript, test, lint and packaging tools work together today, and how the layer rules are enforced. |
| [salesforce-libs.md](salesforce-libs.md) | What `@salesforce/core` and `@salesforce/source-deploy-retrieve` do and do not do for login, inventory and retrieve. |
| [apex-analysis.md](apex-analysis.md) | What the Apex parser candidates provide, and what OrgLens has to build itself. |
| [sqlite-store.md](sqlite-store.md) | Which SQLite driver to use, how snapshots are laid out, and how the store performs at 10,000+ components. |
| [corpora-and-proof.md](corpora-and-proof.md) | Which public codebases and which free orgs can be used to prove correctness. |
| [harvest-and-config.md](harvest-and-config.md) | What is reused from the three earlier prototypes, and the design of the configuration file, the engine API and the JSON output. |

Two notes were added while Phase 0 was built:

| Note | What it holds |
| --- | --- |
| [store-benchmark.md](store-benchmark.md) | The numbers of the storage benchmark in `bench/`, measured again with the code in the repository. |
| [real-org.md](real-org.md) | What the first runs against a real org showed: the deploy of the fixture project, the first snapshot, what Salesforce rewrites, what an org lists and does not hand out, and what the Dependency API and the symbol tables of the compiler can be used for. |

## How to read them

- The notes are kept as written. They are working papers, not polished documents, and they are not updated when
  later work supersedes them. The phase plan and the decision records are the current truth.
- Paths such as `/home/user/...` and `/tmp/...` refer to the machine the research ran on. The earlier prototypes
  (`orgLens`, `salesforce-orglens`, `orglens-claude`, called A, B and C in the plans) are private repositories.
- Version numbers were correct on the day of the research.
- A few passages about data found in one of the private prototypes were removed from these public copies. Each
  removal is marked in the text.
- The throwaway code written during the research is not in the repository.
