# @sf-orglens/engine

The engine of [OrgLens](https://github.com/taouani/sf-orglens), a local-first impact analysis tool for Salesforce.
It reads a live org, a sandbox or a Git repository, builds a dependency graph in a local SQLite file, and answers
impact questions from that graph.

> **Pre-release.** The engine takes snapshots and analyses objects, fields, validation rules and formulas. It
> answers what refers to a component among those types, and names the types an answer does not cover. Its API
> will change. See the
> [roadmap](https://github.com/taouani/sf-orglens/blob/main/docs/plans/re-architecture-plan.md#roadmap).

Most people want the command line, [`sf-orglens`](https://github.com/taouani/sf-orglens/tree/main/packages/cli).
This package is for programs that drive the engine themselves. Everything it offers is exported from the package
entry point. Nothing below it is part of the API.

```js
import { openWorkspace } from '@sf-orglens/engine';

const workspace = await openWorkspace({ cwd: process.cwd() });
const status = await workspace.status();
console.log(status.sources.map((source) => source.name));

// What refers to a field in the latest snapshot of the source `repo`, and what the answer does not cover.
const answer = await workspace.impact('repo', 'Account.Industry');
console.log(
  answer.results.map((result) => result.key),
  answer.complete,
  answer.notCovered,
);
```

A function of the API fails only with an `EngineError`. Its `code` is one of the stable codes in `ERROR_CODES`.

Requires Node.js 24.15 or newer. Licensed under the Apache License 2.0.
