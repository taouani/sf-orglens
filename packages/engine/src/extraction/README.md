# `extraction` layer

Turning retrieved metadata into components and references: parsers for objects, fields, formulas, validation rules, Flows and Apex.

May import from: `core`, `sources`.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
