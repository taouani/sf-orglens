# `sources` layer

Reading a live org, a sandbox or a Git repository: login, inventory, retrieve, reading files. The only layer allowed to import the Salesforce libraries.

May import from: `core`.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
