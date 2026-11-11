# `core` layer

Component keys, the reference vocabulary, typed errors, logging and other building blocks.

May import from: nothing else in the engine.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones. The rule is enforced by ESLint and dependency-cruiser, and
`pnpm run check:boundaries` proves that the enforcement works. See `CLAUDE.md` at the repository root.
