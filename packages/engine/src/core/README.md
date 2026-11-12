# `core` layer

Component keys, the reference vocabulary, typed errors, logging and other building blocks.

May import from: nothing else in the engine.

| File            | What it holds                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `keys.ts`       | Component keys: the grammar, building, parsing, parent keys, Apex signatures, collision reports |
| `references.ts` | The reference vocabulary: kinds, origins, confidence tiers, resolutions, source locations       |
| `errors.ts`     | `EngineError` and the stable error codes                                                        |
| `redact.ts`     | Masking of credentials in anything that is logged                                               |
| `logger.ts`     | The JSON-lines logger and its file sink: one file per day, old days removed                     |
| `version.ts`    | The version of the engine package                                                               |
| `config/`       | The configuration: reading and checking the two TOML files, and the edits commands make to them |

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
