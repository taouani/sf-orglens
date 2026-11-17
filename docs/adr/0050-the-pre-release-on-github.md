# 0050. A pre-release is on GitHub only: two packed packages, and a version that says what it is

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (work package 11 of the Phase 1 plan. It builds the pre-release the maintainer chose on
  2026-11-15 with the sixth question of that plan, and holds the choices its author made while building it)
- Changed by: [0051](0051-the-first-release-is-the-first-on-npm.md), in the first point this record leaves undecided: "the first release" is the first one on npm, and a pre-release on GitHub is not it. The second point, the names on npm, is the subject of [0052](0052-the-project-holds-its-names-on-npm.md), which is not accepted

## Context

The roadmap says that colleagues of the maintainer use OrgLens from Phase 1 on. Until now nobody could without
building the repository: no package is published ([0022](0022-public-pre-release.md)), and the workflow
"Release (dry run)" only rehearses a release to npm.

Question Q6 of the [Phase 1 plan](../plans/phase-1.md#4-the-eight-questions-and-your-answers) put three ways to
the maintainer, who chose the first: a pre-release on GitHub with the packed command line attached, installed
with one `npm install` line, and nothing on npm. A pre-release on npm needs an account and a check that the
names of the packages are free. That check was not made, because it sends the names to an outside service.

Three things had to be settled to build it.

- **The command line is two packages.** `sf-orglens` needs `@sf-orglens/engine` by its name
  ([0005](0005-one-engine-five-layers.md)). npm finds a package by its name in a registry, and the engine is in
  none.
- **Both packages were at version 0.0.0**, with fifteen changesets waiting. A version is printed by `--version`
  and written into every snapshot and every analysis, so two builds with one version cannot be told apart.
- **Nothing the assistant has can create a release.** A workflow can, with the token GitHub gives a run.

## Decision

**Where.** A pre-release is a release on GitHub that is marked as a pre-release, with the tag `v<version>`. It
has three files attached: the two packages as `pnpm pack` writes them, and `SHA256SUMS`. Nothing is sent to a
registry.

**How it is installed.** With one line that gives npm the addresses of both files:
`npm install --global --allow-remote=root <address of the engine> <address of the command line>`. npm then has
the engine in hand when the command line asks for it, and this install asks no registry about either name.
npm 12 refuses an address on the command line unless `--allow-remote` allows it. By the documentation of npm,
`root` allows the addresses the line itself names and none that a dependency names. That a dependency is
refused was not tried. npm 11 installs with the option as well. The line was tried with the two files served
from an address on the machine of the build, with npm 11.0, 11.19 and 12.2 on Linux. The workflow tries it the
same way on Linux, Windows and macOS before it publishes, and from GitHub after.

**The version.** The packages are versioned in the pre-release mode of changesets, with the tag `next`: the
first pre-release is `0.1.0-next.0`, the next `0.1.0-next.1`. A version without such a part is kept for the first
release that is not a pre-release. The workflow refuses a version without one.

**The workflow** `.github/workflows/pre-release.yml` is started by hand with the version typed in.

- It stops when the version is not the one of both packages, when a change log has no section for it, when a
  changeset is waiting, or when the release notes are missing, do not hold the line that installs this version,
  or are written in a form of Markdown that the page of a release would show differently. With "publish" on it
  also stops on any branch but `main`, when the tag of the version exists, and when the release notes still hold
  the mark `[open]`, which says that something in them waits for an answer.
- Its first job has no right to write. It runs the full check, the lint of the packages and the smoke test of
  the packed packages, and then packs. It does not use the cache of earlier runs.
- Its second job tries the install line before anything is public, on the three systems, each with the npm that
  Node.js brings and with the newest npm. The packed files are served from an address on the runner that stands
  in for GitHub. The line is built by the function that `check` holds the release notes against. The job then
  runs `orglens --version`, `init` and `doctor`.
- Its third job is the only one that may write to the repository. It checks nothing out and runs no code of the
  repository or of its dependencies: it holds the files against their checksums and attaches what the first job
  packed. It runs only when publishing was asked for on `main`, after the first two jobs, and it looks once
  more whether the tag exists.
- Its fourth job repeats the second with the addresses of the release on GitHub.
- With "publish" off, the run checks, packs and tries the install line, and stops. That is the rehearsal.

**The release notes** of a version are a file of the repository, `docs/releases/v<version>.md`, so they are
reviewed like any change. They say what the version does, what it does not do and what is not verified. The
workflow shows them on the page of the release and adds the checksums.

**The change log.** Each package has a `CHANGELOG.md` that changesets writes. The section of the first
pre-release holds the fifteen entries of two phases. It was put in the order in which the pull requests were
merged, by hand, with a sentence that says so: an entry says what was true when it was merged.

**A published pre-release is not changed.** Its files and its tag stay as they are. A defect is corrected by the
next version. Nothing but this rule holds that today: the setting of GitHub that makes releases immutable is off
in this repository, and only the maintainer can turn it on.

**When.** A pre-release is made at the close of a phase, and otherwise when the maintainer asks for one. The
assistant starts the rehearsal. A run with "publish" on cannot be undone, so the assistant starts it only after
the maintainer has said so for that version.

**Not decided here:** whether a pre-release is "the first release" of records [0022](0022-public-pre-release.md)
and [0027](0027-json-envelope-and-exit-codes.md), from which the names of the packages and the JSON contract are
fixed. That is a question to the maintainer, and the index lists it among the planned records. Also not
decided: whether the project holds the two names on npm before the first pre-release is published, which the
second consequence below is about. Both were put to the maintainer on 2026-11-17, and no pre-release is
published before both are answered: the release notes of the first one hold the mark `[open]` at each of the
two, and the workflow does not publish notes with the mark.

## Consequences

- A colleague installs OrgLens with one line and Node.js, without an account anywhere. The line is long, and it
  names the version twice per file. GitHub adds two archives of the source to the three files of a release.
- **After the install, `npm update --global` replaces OrgLens with whatever the public registry holds under the
  two names.** A global install keeps no address: npm treats both packages as any version of their name from the
  registry. `npm outdated --global` asks the registry for both names. `npm update --global` does the same and
  installs what it finds. The review of this change showed it with npm 11.19 and 12.2 and a stand-in registry
  on its own machine, and the author repeated it with npm 11.19: a made-up package under each name took the
  place of OrgLens, with no warning, and `orglens` then ran the made-up one. This project has published nothing
  under the names and has not looked whether they are taken, and the names are public in this repository.
  Whoever holds them on npm can therefore put code on the machine of a colleague who installed exactly as told
  and later updates the global packages, next to the logins of the Salesforce CLI. The release notes say not to
  run the two commands. That is a warning, not a protection. The risk ends when the project holds both names on
  npm, which is the step Q6 left for later, or with an install that does not go into the global folder of npm.
- **With the address of the command line alone, npm asks the public registry for `@sf-orglens/engine`**, with
  the same result. The release notes say to give both addresses.
- An install of the two files that is not global, into a folder with a `package.json`, sends both names to the
  registry with the audit request of npm, unless `--no-audit` is given.
- The packages hold no lock file. The versions of the libraries the engine names are fixed. The versions of what
  those libraries need are chosen by npm at the moment of the install, and can be newer than the ones the tests
  ran with. The smoke test of CI has the same weakness, by design: it installs as a user would.
- The checksums show a download that went wrong. They do not show a release that was changed: whoever can write
  to the repository can replace a file and the checksums with it. Nothing is signed, and no attestation of the
  build is made.
- The install from GitHub itself is tried only after the release is public. Before that, the same line is tried
  on the three systems with the files served from the runner. What that cannot show is whatever differs between
  the stand-in and GitHub, such as the redirect of a download. If the install fails there, a pre-release that
  cannot be installed is public until the next version.
- An impact answer names the version that analysed its snapshot. The golden files of the engine no longer hold
  that version, or every release would change them: the test puts a fixed word in its place, and a test of its
  own holds the version against the engine.
- When the pre-release mode is left, changesets writes the section of `0.1.0` from the same fifteen files, in
  the order of their names. It has to be put in order again.
- The workflow "Release (dry run)" stays as the rehearsal of a release to npm. It has never run. Its last step
  asks the public registry for both names, as the review showed with a stand-in registry, so a run of it makes
  the check of the names that was not made here. It is not started before the maintainer has decided about the
  names.
