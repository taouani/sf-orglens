# sf-orglens

The command line of [OrgLens](https://github.com/taouani/sf-orglens), a local-first impact analysis tool for
Salesforce. It tells you what a change to an org will affect before you make it, from a dependency graph built on
your own machine.

> **Pre-release.** The commands below manage a workspace and its configuration, take snapshots of repository
> folders and of orgs, and analyse the objects, fields, validation rules and formulas in them. `orglens impact`
> shows what refers to a component among those types. Apex, flows and the other types are not analysed yet, and
> an answer names the types it does not cover. See the
> [roadmap](https://github.com/taouani/sf-orglens/blob/main/docs/plans/re-architecture-plan.md#roadmap).

```sh
npm install --global sf-orglens@next
```

That installs the newest pre-release, and the engine with it. The package is `sf-orglens`, and the command is
`orglens`. **Do not run `npx orglens`:** the name `orglens` is not a package of this project, and npx fetches
whatever package has that name. To run OrgLens without installing it, use `npx sf-orglens@next`.

```sh
orglens init                              # make the current folder a workspace
orglens source add prod --kind org        # declare an org, a sandbox or repository folders
orglens source add repo --kind git --path force-app --tracks prod
orglens source list
orglens status                            # the workspace, its database and its sources
orglens snapshot repo                     # read the folders now and store their metadata files
orglens coverage repo                     # what the latest snapshot holds, what it is missing, what was analysed
orglens analyse repo                      # analyse the latest snapshot again, from the files it holds
orglens impact Account.Industry           # what refers to a component, directly or through other components
orglens doctor                            # check that OrgLens can run here
```

Every command takes `--json` and then writes one line of JSON in a fixed envelope, for a success and for a failure
alike. The JSON Schema of that output is shipped as `sf-orglens/schemas/output.schema.json`.

Exit codes: `0` success, `1` failure, `2` a wrong command line or configuration, `3` a gate was breached, `4` a
login or connection problem, `5` an incomplete result. `snapshot` and `analyse` end with `5` for a partial
snapshot or an incomplete analysis, and `impact` when its answer may miss something of a type it covers.
`snapshot` of an org and the commands that check a login end with `4` for
a problem with a login. No command ends with `3` yet.

The [command line reference](https://github.com/taouani/sf-orglens/blob/main/docs/cli.md) documents the output
contract, and the [configuration reference](https://github.com/taouani/sf-orglens/blob/main/docs/configuration.md)
documents `orglens.toml`.

Requires Node.js 24.15 or newer. Licensed under the Apache License 2.0. OrgLens is an independent open-source
project and is not affiliated with Salesforce, Inc.
