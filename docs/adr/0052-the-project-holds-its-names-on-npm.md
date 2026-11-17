# 0052. The project holds its names on npm with empty packages, before the first pre-release

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (an answer of the maintainer of 2026-11-17 to a finding of the review of record 0050, and the
  choices the author made in building it)

## Context

A pre-release is installed from two addresses on GitHub into the global folder of npm
([0050](0050-the-pre-release-on-github.md)). The review of that record found what follows from it, and the
author repeated it: a global install keeps no address, so `npm update --global` asks the public registry for
`sf-orglens` and `@sf-orglens/engine` and installs whatever it finds there in the place of OrgLens. Whoever
holds the names on npm can put code on the machine of a colleague who installed exactly as told, next to the
logins of the Salesforce CLI. The names are public in this repository, and the project held neither.

The maintainer had chosen with question Q6 of the
[Phase 1 plan](../plans/phase-1.md#4-the-eight-questions-and-your-answers) that nothing goes to npm. The finding
was put to the maintainer on 2026-11-17 with three ways: the project holds both names on npm, the release notes
only warn, or the install goes into a folder of its own that `npm update --global` does not touch.

With the maintainer's answer the author looked the names up on the registry, on 2026-11-17:

- No package has the name `sf-orglens`, `@sf-orglens/engine` or `orglens`, and none the near spellings
  `sforglens` and `sf_orglens`.
- No organization of npm has the name `sf-orglens`. A package with the scope `@sf-orglens` can only be published
  by the user or the organization of that name.
- Whether a user account has the name `sf-orglens` is not known: the registry answers that question to nobody
  who is not signed in. If one has, the organization cannot be created, and the scope of the engine has to be
  chosen again.

## Decision

The maintainer chose the first way.

**The project holds its names on npm before the first pre-release is published.** The maintainer creates the
organization `sf-orglens` on npm and publishes an empty package at version `0.0.0` under each name from the
maintainer's own account. This is the one thing that goes to npm before the first release there, and it changes
the answer to Q6 in that one point. It is not a release of OrgLens
([0051](0051-the-first-release-is-the-first-on-npm.md)).

**Three names**, not two: `sf-orglens`, `@sf-orglens/engine`, and `orglens`. The third is the name of the
binary. A person who types `npx orglens` on a machine without OrgLens gets the package of that name from the
registry, from whoever holds it. The maintainer was told and can leave it out.

**What an empty package holds.** A `package.json` with the name, the version `0.0.0`, the licence and the
address of the repository, and a `README.md` that says that the name is held and where the pre-releases are.
No dependency, no script, no code of OrgLens. `sf-orglens` and `orglens` also install a command `orglens` that
prints that it is not OrgLens and how to install a pre-release again, and ends with the exit code 1.

**How they are made.** `node scripts/pre-release.mjs names <folder>` writes the three packages, so that what is
published is what was reviewed. A test holds what it writes. The maintainer publishes them by hand:
[`docs/releases/npm-names.md`](../releases/npm-names.md) has the steps. No workflow of this repository
publishes to npm, and no token for npm is stored in it.

**The first pre-release waits for it.** Its release notes hold the mark `[open]` at this point until the three
names answer on the registry with the maintainer as their owner, and the workflow publishes no notes with the
mark (record 0050).

## Consequences

- **The hole is closed, and a nuisance is left.** With the names held, `npm update --global` still replaces an
  installed pre-release, now with the empty package of the project. This was tried with npm 11.19 and 12.2
  against a stand-in registry that held the empty packages: both name `0.0.0` as the wanted version and install
  it, and `orglens` then prints that it is not OrgLens. Nobody else's code runs. The release notes keep the
  warning and say how to install again.
- With the address of the command line alone, npm asks the registry for `@sf-orglens/engine` in the version of
  the pre-release, finds only `0.0.0` and fails. That was not tried.
- The names are held by one npm account. Who else can publish under them, and two-factor sign-in for it, are
  settings of that account and of the organization, outside this repository.
- An empty package cannot be taken back cleanly: npm lets a version be removed for 72 hours, and a removed
  version number can never be used again. `0.0.0` is used up either way, which costs nothing: the packages of
  the repository are past it.
- A name near these, such as `org-lens`, is not held. npm refuses some near spellings by itself and not others.
- The workflow "Release (dry run)" asks the registry for the two names in its last step. Once the project holds
  them, that says nothing to anybody. It has still never run.
- When OrgLens is released on npm, the real packages are published over the empty ones, as a higher version
  under the same names, by the same account or by a workflow that is written then.
