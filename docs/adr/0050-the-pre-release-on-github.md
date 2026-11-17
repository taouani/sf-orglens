# 0050. A pre-release is on GitHub only: two packed packages, and a version that says what it is

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (work package 11 of the Phase 1 plan. It builds the pre-release the maintainer chose on
  2026-11-15 with the sixth question of that plan, and holds the choices its author made while building it)

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
`npm install --global <address of the engine> <address of the command line>`. npm then has the engine in hand
when the command line asks for it, and asks no registry about either name. This was tried with the two files
served from an address on the machine of the build. From GitHub it is tried by the workflow, on Linux, Windows
and macOS, after a release is published.

**The version.** The packages are versioned in the pre-release mode of changesets, with the tag `next`: the
first pre-release is `0.1.0-next.0`, the next `0.1.0-next.1`. A version without such a part is kept for the first
release that is not a pre-release. The workflow refuses a version without one.

**The workflow** `.github/workflows/pre-release.yml` is started by hand with the version typed in.

- It stops when the version is not the one of both packages, when a change log has no section for it, or when
  the release notes are missing or do not hold the line that installs this version.
- Its first job has no right to write. It runs the full check, the lint of the packages and the smoke test of
  the packed packages, and then packs.
- Its second job is the only one that may write to the repository. It checks nothing out and runs no code of the
  repository or of its dependencies: it attaches what the first job packed. It runs only when publishing was
  asked for, and the first job refuses that on any branch but `main`.
- Its third job installs from the release with the line of the release notes on the three systems, and runs
  `orglens --version`, `init` and `doctor`.
- With "publish" off, the run checks and packs and stops. That is the rehearsal.

**The release notes** of a version are a file of the repository, `docs/releases/v<version>.md`, so they are
reviewed like any change. They say what the version does, what it does not do and what is not verified. The
workflow shows them on the page of the release and adds the checksums.

**The change log.** Each package has a `CHANGELOG.md` that changesets writes. The section of the first
pre-release holds the fifteen entries of two phases. It was put in the order in which the pull requests were
merged, by hand, with a sentence that says so: an entry says what was true when it was merged.

**A published pre-release is not changed.** Its files and its tag stay as they are. A defect is corrected by the
next version.

**When.** A pre-release is made at the close of a phase, and otherwise when the maintainer asks for one. The
assistant starts the run.

**Not decided here:** whether a pre-release is "the first release" of records [0022](0022-public-pre-release.md)
and [0027](0027-json-envelope-and-exit-codes.md), from which the names of the packages and the JSON contract are
fixed. That is a question to the maintainer, and the index lists it among the planned records.

## Consequences

- A colleague installs OrgLens with one line and Node.js, without an account anywhere. The line is long, and it
  names the version twice per file.
- **With the address of the command line alone, npm asks the public registry for `@sf-orglens/engine`.** This
  project has published nothing there and has not looked whether the name is taken. What npm would find is not
  from this project. The release notes say to give both addresses. The risk ends when the packages are on npm
  under names the project holds, which is the step Q6 left for later.
- The packages hold no lock file. The versions of the libraries the engine names are fixed. The versions of what
  those libraries need are chosen by npm at the moment of the install, and can be newer than the ones the tests
  ran with. The smoke test of CI has the same weakness, by design: it installs as a user would.
- The checksums show a download that went wrong. They do not show a release that was changed: whoever can write
  to the repository can replace a file and the checksums with it. Nothing is signed, and no attestation of the
  build is made.
- The install from GitHub is tried only after the release is public. If it fails on a system, a pre-release that
  cannot be installed there is public until the next version. The smoke test of the packed packages runs on the
  three systems in CI before, which makes that unlikely and not impossible.
- An impact answer names the version that analysed its snapshot. The golden files of the engine no longer hold
  that version, or every release would change them: the test puts a fixed word in its place, and a test of its
  own holds the version against the engine.
- When the pre-release mode is left, changesets writes the section of `0.1.0` from the same fifteen files, in
  the order of their names. It has to be put in order again.
- The workflow "Release (dry run)" stays as the rehearsal of a release to npm.
