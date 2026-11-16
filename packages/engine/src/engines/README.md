# `engines` layer

The deterministic engines: impact, comparison, access and coverage.

`impact.ts` is the first of them (decision record 0044). It walks the references of one snapshot from a
component, level by level, through the interface `SnapshotGraph` of the store, and says what an answer does not
cover. It knows nothing of SQL, of sources or of the command line. The other three do not exist yet.

May import from: `core`, `sources`, `extraction`, `store`.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
