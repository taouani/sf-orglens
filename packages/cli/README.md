# sf-orglens

The command line of [OrgLens](https://github.com/taouani/sf-orglens), a local-first impact analysis tool for
Salesforce. It tells you what a change to an org will affect before you make it, from a dependency graph built on
your own machine.

> **Pre-release.** No analysis commands are available yet. See the
> [roadmap](https://github.com/taouani/sf-orglens/blob/main/docs/plans/re-architecture-plan.md#roadmap).

```sh
orglens --version
orglens --help
```

Exit codes: `0` success, `2` a command line that cannot be understood, `1` an internal error. The full table is
documented when the first commands arrive.

Requires Node.js 24.15 or newer. Licensed under the Apache License 2.0. OrgLens is an independent open-source
project and is not affiliated with Salesforce, Inc.
