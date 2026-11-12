# OrgLens

OrgLens tells you what a change to a Salesforce org will affect before you make it. It reads a live org, a sandbox
or a Git repository, builds a dependency graph on your own machine, and answers impact questions from that graph.

> **Pre-release.** The project is being built in the open and is not usable yet. There is no published package and
> no analysis command. Follow the [roadmap](docs/plans/re-architecture-plan.md#roadmap) to see what comes when.

## What it will do

- **Impact analysis first.** What references this field, class or flow? What breaks if it is changed or deleted?
  What does this pull request affect? Who gains or loses access?
- **Deterministic answers.** Every result comes from the graph, with the path that explains it and a confidence
  tier. A language model is optional and only explains results.
- **Local-first.** Metadata and code stay on your machine. There is no server. OrgLens keeps no
  credentials of its own: it uses the Salesforce CLI login you already have.
- **Orgs and repositories alike.** A live org, a sandbox and a repository branch are read by the same parsers, so
  any two of them can be compared.
- **Honest about gaps.** Every snapshot reports what was covered and what was not.

## Status

| Phase                | Delivers                                                                                                                                | State       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 0 Foundations        | Repository, CI, decision records, workspace and configuration, first retrieve from a real org, Apex parser trial, first fixture project | In progress |
| 1 First slice        | Objects, fields, formulas and validation rules through every layer                                                                      | Not started |
| 2 Flows and config   | Flows, workflow rules, record types, custom metadata                                                                                    | Not started |
| 3 Apex               | Classes and triggers at method level, dynamic references                                                                                | Not started |
| 4 Compare and access | Snapshot comparison, change-set impact, permissions                                                                                     | Not started |
| Correctness gate     | Proof on public codebases and a real 10,000+ component org                                                                              | Not started |

The full plan, with the reasons behind each decision, is in [`docs/plans/`](docs/plans/).

## Repository layout

```
packages/engine   The engine library. Layers: core, sources, extraction, store, engines, api.
packages/cli      The `orglens` command line. Uses only the public API of the engine.
docs/plans        The re-architecture plan and one plan per phase.
docs/research     Research notes behind the plans.
docs/adr          Decision records.
scripts           Repository checks used by CI.
tools             The ESLint rule that enforces the layer rules.
```

## Developing

You need Node.js 24.15 or newer and [pnpm](https://pnpm.io) 12.

```sh
pnpm install
pnpm run build
pnpm run check   # build, lint, format, layer rules, unused code, boundary probes, tests with coverage
node packages/cli/dist/bin.js --version
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a change.

## Licence

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

OrgLens is an independent open-source project. It is not affiliated with, sponsored by or endorsed by Salesforce, Inc.
