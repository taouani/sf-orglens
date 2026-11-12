# sf-orglens

The command line of [OrgLens](https://github.com/taouani/sf-orglens), a local-first impact analysis tool for
Salesforce. It tells you what a change to an org will affect before you make it, from a dependency graph built on
your own machine.

> **Pre-release.** The commands below manage a workspace and its configuration. No command connects to an org or
> analyses anything yet. See the
> [roadmap](https://github.com/taouani/sf-orglens/blob/main/docs/plans/re-architecture-plan.md#roadmap).

```sh
orglens init                              # make the current folder a workspace
orglens source add prod --kind org        # declare an org, a sandbox or repository folders
orglens source add repo --kind git --path force-app --tracks prod
orglens source list
orglens status                            # the workspace, its database and its sources
orglens doctor                            # check that OrgLens can run here
```

Every command takes `--json` and then writes one line of JSON in a fixed envelope, for a success and for a failure
alike. The JSON Schema of that output is shipped as `sf-orglens/schemas/output.schema.json`.

Exit codes: `0` success, `1` failure, `2` a wrong command line or configuration, `3` a gate was breached, `4` a
login or connection problem, `5` an incomplete result. The codes `3` to `5` are reserved and not used yet.

The [command line reference](https://github.com/taouani/sf-orglens/blob/main/docs/cli.md) documents the output
contract, and the [configuration reference](https://github.com/taouani/sf-orglens/blob/main/docs/configuration.md)
documents `orglens.toml`.

Requires Node.js 24.15 or newer. Licensed under the Apache License 2.0. OrgLens is an independent open-source
project and is not affiliated with Salesforce, Inc.
