# Changesets

This folder holds the release notes that have not been published yet. The project uses
[changesets](https://github.com/changesets/changesets) to version the two packages together.

A pull request that changes what users see adds one file here with `pnpm changeset`. Pull requests that only
touch documentation, tests or tooling do not need one.

No version of OrgLens is published to npm during the pre-release phases. The workflow "Release (dry run)" only
rehearses such a release. Whether the project holds its names on npm with empty packages is not decided
([decision record 0052](../docs/adr/0052-the-project-holds-its-names-on-npm.md)). No workflow would publish them.

## Pre-releases

A pre-release is a release on GitHub with the two packed packages attached
([decision record 0050](../docs/adr/0050-the-pre-release-on-github.md)). The folder is in the pre-release mode of
changesets (`pre.json`), so versions have the form `0.1.0-next.0`, and the changesets that were already used
are kept in `pre/` until the first release that is not a pre-release.

To make one, in a pull request:

1. Run `pnpm changeset version`. It sets the next version in both packages and adds a section to both change
   logs.
2. Put the new section of each change log in the order in which the pull requests were merged.
3. Write `docs/releases/v<version>.md`: what the version does, what it does not do, what is not verified, and
   the line that installs it. `node scripts/pre-release.mjs check <version> false -` says what is missing.

After the merge, the workflow "Pre-release" is started on `main` with that version. With "publish" off it
checks, packs and tries the install line on Linux, Windows and macOS, and publishes nothing. A run with
"publish" on is started only after the maintainer has said so for that version.

A pull request that adds a changeset after the version was set needs the three steps again before the next
pre-release: the workflow refuses to release while a changeset waits here.
