# 0023. Toolchain, and layer rules enforced by independent mechanisms

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0005](0005-one-engine-five-layers.md) only holds if the layer rules cannot be broken by accident. A rule that
exists only in a document erodes within weeks, most of all when much of the code is written by an AI assistant
across separate sessions. The toolchain also had to be chosen from versions that work together today: research found
that TypeScript 7 exists but the lint and dependency tools do not support it yet.

## Decision

**Toolchain.** A pnpm workspace with two packages (`@sf-orglens/engine`, `sf-orglens`). TypeScript 6 with strict
settings and erasable syntax only, compiled with `tsc -b`. ES modules. Tests run from source with vitest through a
custom export condition, so no build is needed to test. ESLint with type-aware rules, Prettier, knip for unused
code, publint and a pack-and-install smoke test for packaging, changesets for versioning. Dependencies are pinned to
exact versions, and a package version must have been public for a day before it can be installed.

**Layer rules** are defined once, in `layers.cjs`, and enforced by independent mechanisms:

1. An ESLint rule written for this repository (`tools/eslint-plugin-orglens.js`). It resolves every import to a
   path before judging it, and covers static imports, re-exports, `import()`, type imports and `require`.
2. dependency-cruiser, which checks the same rules on the resolved dependency graph and also forbids circular
   and unresolvable imports.
3. For the boundary between a client and the engine only: the `exports` map of the engine package, which exposes only
   the entry point and `package.json`. The compiler and Node.js both honour it.

The rules: a layer never imports from a later layer or from the engine entry point; `packages/engine/src` holds only the
layer folders and `index.ts`; the engine never imports a client; a client imports the engine only by its package name;
inside `packages/engine/src`, only the `sources` layer imports the Salesforce libraries; a client never imports the
database driver or the XML parser.

`scripts/check-boundaries.mjs` runs in CI. It writes probe files that break each rule, and control probes with
allowed imports, runs the tools, and fails unless every probe gets the expected verdict. A rule without a probe
fails the script, and the layer order is stated a second time there so that loosening `layers.cjs` alone is caught.

## Consequences

- A layer violation fails CI on every platform, and the enforcement itself is tested.
- When a layer rule is added or changed, a probe case is added with it.
- The toolchain is ordinary and replaceable. Moving to TypeScript 7 waits until the lint tools support it.
- A generic import-restriction rule was tried first and replaced: matching import text could be bypassed with
  `./../` and misfired on folder names. Owning a small rule costs about 150 lines that the probes keep honest.
- A layer violation inside the engine is caught by two mechanisms, not three. An `exports` map cannot see inside
  a package.

## Notes

Evidence and version numbers are in the research note [toolchain.md](../research/phase-0/toolchain.md). This record
departs from that note in two places: it stays on TypeScript 6 alone where the note recommended running TypeScript 7
beside it, and it uses its own lint rule where the note used a generic import restriction.
