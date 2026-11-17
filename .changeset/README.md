# Changesets

This folder holds the release notes that have not been published yet. The project uses
[changesets](https://github.com/changesets/changesets) to version the two packages together.

A pull request that changes what users see adds one file here with `pnpm changeset`. Pull requests that only
touch documentation, tests or tooling do not need one.

Nothing is published to npm during the pre-release phases. The workflow "Release (dry run)" only rehearses such
a release.

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

After the merge, the workflow "Pre-release" is started on `main` with that version. With "publish" off it only
checks and packs.
