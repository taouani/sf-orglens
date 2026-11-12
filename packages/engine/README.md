# @sf-orglens/engine

The engine of [OrgLens](https://github.com/taouani/sf-orglens), a local-first impact analysis tool for Salesforce.
It reads a live org, a sandbox or a Git repository, builds a dependency graph in a local SQLite file, and answers
impact questions from that graph.

> **Pre-release.** The engine has no analysis features yet and its API will change. See the
> [roadmap](https://github.com/taouani/sf-orglens/blob/main/docs/plans/re-architecture-plan.md#roadmap).

Most people want the command line, [`sf-orglens`](https://github.com/taouani/sf-orglens/tree/main/packages/cli).
This package is for programs that drive the engine themselves. Everything it offers is exported from the package
entry point. Nothing below it is part of the API.

```js
import { engineVersion } from '@sf-orglens/engine';

console.log(engineVersion());
```

Requires Node.js 24.15 or newer. Licensed under the Apache License 2.0.
