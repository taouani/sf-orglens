# Contributing to OrgLens

Thank you for your interest. OrgLens is in a pre-release build phase with a fixed plan, so the most useful
contributions right now are bug reports, test cases and comments on the [plans](docs/plans/). Please open an issue
before starting on a larger change, so that it does not collide with work already planned.

## Ground rules

1. **Scope follows the plan.** The roadmap in [`docs/plans/re-architecture-plan.md`](docs/plans/re-architecture-plan.md)
   decides what is built and in which order. Features outside the current phase are recorded, not built.
2. **No customer data, ever.** Do not add metadata, recorded API responses, org identifiers, host names or user
   names taken from a real org. Test data is written for the purpose or comes from public repositories with a
   compatible licence, pinned by commit.
3. **No credentials.** OrgLens stores no credentials, and none may appear in code, tests, fixtures, logs or issues.
4. **Results must be explainable.** Every reference the engine reports carries where it came from and how certain
   it is. A change that produces results without provenance will not be merged.

## Setting up

You need Node.js 24.15 or newer and pnpm 12. The exact pnpm version is pinned in `package.json`.

```sh
pnpm install
pnpm run build
pnpm run check
```

`pnpm run check` runs everything CI runs except the package smoke test:

| Script                                       | What it checks                                                       |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm run build`                             | TypeScript compiles with the strict settings in `tsconfig.base.json` |
| `pnpm run typecheck:tests`                   | The test files type-check against the source                         |
| `pnpm run lint`                              | ESLint with type-aware rules and the import restrictions             |
| `pnpm run format`                            | Prettier formatting (`pnpm run format:write` fixes it)               |
| `pnpm run depcruise`                         | Layer rules and circular imports                                     |
| `pnpm run knip`                              | Unused files, exports and dependencies                               |
| `pnpm run check:boundaries`                  | Breaks each layer rule on purpose and checks that the tools catch it |
| `pnpm run coverage`                          | Tests with coverage thresholds                                       |
| `pnpm run publint` and `pnpm run smoke:pack` | The packages install and run outside the workspace                   |

## Architecture rules

The engine has six layers in a fixed order: `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer
may import from earlier layers only. Clients such as the CLI use only the public entry point of the engine
package. Only the `sources` layer may import the Salesforce libraries. These rules are defined once in
`layers.cjs` and enforced by the package `exports` map, ESLint and dependency-cruiser.

A decision that changes the architecture, the data model, the storage format or a public contract needs a decision
record in [`docs/adr/`](docs/adr/).

## Tests

- Every change comes with tests. Expected outputs that are larger than a few lines live in golden files under
  `test/golden/` and are compared byte for byte.
- All text files use LF line endings on every platform (see `.gitattributes`), because fixtures record line and
  column positions.
- Tests never need network access or a Salesforce org. Checks against a live org run in a separate, manually
  started workflow.

## Commits and pull requests

- Keep pull requests small and focused on one thing.
- Fill in the pull request template. Every pull request is reviewed before it is merged, and CI must be green on
  Linux, macOS and Windows.
- Changes that users will notice need a changeset: run `pnpm changeset`.

### Sign your work (DCO)

OrgLens uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a contributor
licence agreement. By adding a `Signed-off-by` line to a commit you state that you wrote the change or otherwise
have the right to submit it under the Apache License 2.0.

```sh
git commit -s -m "Describe the change"
```

This adds a line such as `Signed-off-by: Your Name <you@example.com>` to the commit message. The name and
address must be yours.

## Reporting security problems

Please do not open a public issue for a security problem. See [SECURITY.md](SECURITY.md).

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
