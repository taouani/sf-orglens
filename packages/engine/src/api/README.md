# `api` layer

The public API of the engine. `src/index.ts` re-exports this layer and nothing else.

May import from: every other layer.

| File              | What it holds                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `index.ts`        | The list of what is public. `test/golden/api-surface.json` pins the names it exports.                |
| `workspace.ts`    | `initWorkspace` and `openWorkspace`: the workspace, its status and the sources it declares           |
| `doctor.ts`       | `doctor`: the checks of the environment, the workspace, the configuration, the database and logins   |
| `snapshot.ts`     | Taking a snapshot of a Git source, and the report of a snapshot                                      |
| `org-snapshot.ts` | Taking a snapshot of an org or a sandbox: inventory, retrieve in chunks, resume                      |
| `check.ts`        | Checking a source: can it be logged in to, or read, as things are now?                               |
| `layout.ts`       | Where a workspace keeps its files, and how the workspace of a folder is found                        |
| `atomic-write.ts` | Replacing a configuration file in one step, and further tries where Windows says that a file is busy |
| `boundary.ts`     | Turns everything that is thrown inside the engine into an `EngineError` before it reaches a client   |

Every function of the API returns a promise and data that survives `JSON.stringify`. It fails only with an
`EngineError`, whose `code` is one of the stable error codes.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
