# 0052. The project holds its names on npm with empty packages, before the first pre-release

- Status: Superseded by [0053](0053-a-pre-release-is-published-on-npm.md)
- Date: 2026-11-17
- Decisions: none (an answer of the maintainer of 2026-11-17 to a finding of the review of record 0050, put in question on the same day by the review of this record)

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
only warn, or the install goes into a folder of its own that `npm update --global` does not touch. The author
recommended the first.

With the maintainer's answer the author looked the names up on the registry, on 2026-11-17:

- No package has the name `sf-orglens`, `@sf-orglens/engine` or `orglens`, and none the near spellings
  `sforglens` and `sf_orglens`.
- No organization of npm has the name `sf-orglens`. A package with the scope `@sf-orglens` can only be published
  by the user or the organization of that name.
- Whether a user account has the name `sf-orglens` is not known: the registry answers that question to nobody
  who is not signed in. If one has, the organization cannot be created, and the scope of the engine has to be
  chosen again. If it is the account of the maintainer, the scope is the maintainer's already.

**What the review of this record found.** The policy of npm on names
([docs.npmjs.com/policies/disputes](https://docs.npmjs.com/policies/disputes), read on 2026-11-17) forbids what
this record decides. By that page it is against the terms of npm to publish a package, or to register a user
name or an organization name, only to reserve it for future use. A package name counts as squatted "if the
package has no genuine function", names are "intended for immediate and active use", and accounts that break
the rule "may be removed or renamed without notice". The page names no exception for a project that holds its
own names, and none for a package that guards an install. The author had recommended this way without having
read the policy, and the maintainer chose on that recommendation.

## Decision

The maintainer chose the first way on 2026-11-17. **It is not carried out, and this record is not accepted.**
With the finding above the choice went back to the maintainer on the same day, with four ways: the install goes
into a folder of its own, the pre-release itself is published on npm so that the names are in use, the names
are held as below against the policy, or the release notes only warn. The author recommends the first of these.
Nothing is published under the names before the maintainer has answered. What follows is the decision as it was
built, so that it can be carried out or struck as a whole.

**The project holds its names on npm before the first pre-release is published.** The maintainer creates the
organization `sf-orglens` on npm and publishes an empty package at version `0.0.0` under each name from the
maintainer's own account. This is the one thing that goes to npm before the first release there, and it changes
the answer to Q6 in that one point. It is not a release of OrgLens
([0051](0051-the-first-release-is-the-first-on-npm.md)).

**Three names**, not two: `sf-orglens`, `@sf-orglens/engine`, and `orglens`. The third is the name of the
binary. A person who types `npx orglens` on a machine without OrgLens gets the package of that name from the
registry, from whoever holds it. The maintainer was told and can leave it out.

**What an empty package holds.** A `package.json` with the name, the version `0.0.0`, the licence, the address
of the repository and the public registry as the place it is published to, and a `README.md` that says that the
name is held and where the pre-releases are. No dependency, no script, no code of OrgLens. `sf-orglens` and
`orglens` also install a command `orglens` that prints that it is not OrgLens and how to install a pre-release
again, and ends with the exit code 1.

**How they are made.** `node scripts/pre-release.mjs names <folder>` writes the three packages, so that what is
published is what was reviewed. A golden file holds the eight files it writes. The maintainer publishes them by
hand: `docs/releases/npm-names.md` had the steps, and was removed with record 0053, as the step was. No
workflow of this repository publishes to npm, and no token for npm is stored in it.

**The first pre-release waits.** Its release notes hold the mark `[open]` at this point, and the workflow
publishes no notes with the mark (record 0050). The mark goes with the answer of the maintainer. If the names
are held, it goes when the registry answers for the two package names, and for `orglens` if it is held, with
the checksum of the package the step wrote. The author does not look for the account that holds them: the name
of a user stays out of this repository.

## Consequences

- **It is against the written policy of npm**, as the context says. npm can remove the packages or rename the
  account without notice. If it removes them, the names are free again, the hole is open again, and nothing
  tells the project. How often npm acts on such a package is not known to the author. The account at risk is
  the maintainer's own.
- **With the names held, the hole is closed and a nuisance is left.** `npm update --global` still replaces an
  installed pre-release, now with the empty package of the project. This was tried with npm 11.19 and 12.2
  against a stand-in registry that held the empty packages: both name `0.0.0` as the wanted version and install
  it, and `orglens` then prints that it is not OrgLens. Nobody else's code runs. The release notes keep the
  warning and say how to install again.
- **The empty version is what the name gives by default, until a version without a pre-release part is
  published.** The review tried it on a stand-in registry with npm 11.19: a version such as `0.1.0-next.0` is
  refused without `--tag`, and published with `--tag next` it leaves the tag `latest` on `0.0.0`. So
  `npm install --global sf-orglens` and `npm update --global` keep giving the empty package, also after real
  pre-releases are on npm, unless `latest` is moved by hand.
- With the address of the command line alone, npm asks the registry for `@sf-orglens/engine` in the version of
  the pre-release, finds only `0.0.0` and fails. That was not tried.
- The names are held by one npm account. Who else can publish under them, and two-factor sign-in for it, are
  settings of that account and of the organization, outside this repository.
- **An empty package must not be taken back.** By the policy of npm on unpublishing, a version can be removed
  within 72 hours, and later as well while no package depends on it, it has fewer than 300 downloads a week and
  one owner, which these packages will meet. `0.0.0` is the only version, so removing it removes the package.
  That the name is then free for anyone is a reading of the author: the page does not say it. A removed version
  number can never be used again, which costs nothing here: the packages of the repository are past `0.0.0`.
- `npm deprecate` on the three versions would make npm print a warning at the moment it installs the empty
  package, and not only when `orglens` is run. It is not part of the steps. It is the maintainer's to add.
- A name near these, such as `org-lens`, is not held. npm refuses some near spellings by itself and not others,
  and can refuse `orglens` as too near to a name that exists. Only near spellings of `sf-orglens` were looked
  up.
- The workflow "Release (dry run)" asks the registry for the two names in its last step. Once the project holds
  them, that says nothing to anybody. It has still never run.
- When OrgLens is released on npm, the real packages are published over the empty ones, as a higher version
  under the same names, by the same account or by a workflow that is written then.
