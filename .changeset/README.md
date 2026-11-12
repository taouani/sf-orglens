# Changesets

This folder holds the release notes that have not been published yet. The project uses
[changesets](https://github.com/changesets/changesets) to version the two packages together.

A pull request that changes what users see adds one file here with `pnpm changeset`. Pull requests that only
touch documentation, tests or tooling do not need one.

Nothing is published during the pre-release phases. The release workflow only rehearses a release as a dry run.
