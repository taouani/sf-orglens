# `api` layer

The public API of the engine. `src/index.ts` re-exports this layer and nothing else.

May import from: every other layer.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones. The rule is enforced by ESLint and dependency-cruiser, and
`pnpm run check:boundaries` proves that the enforcement works. See `CLAUDE.md` at the repository root.
