# `store` layer

The SQLite workspace database: driver, migrations, snapshots, components and references.

May import from: `core`, `sources`, `extraction`.

| File                       | What it holds                                                                  |
| -------------------------- | ------------------------------------------------------------------------------ |
| `driver.ts`                | The driver port: the small part of a SQLite binding the store uses             |
| `node-sqlite.ts`           | The default driver, on the SQLite built into Node.js                           |
| `better-sqlite3.ts`        | The fallback driver, loaded only when asked for                                |
| `open.ts`                  | `openStore`: the open sequence, write transactions, the "another writer" error |
| `migrate.ts`, `migrations` | The migration runner and the numbered migrations                               |
| `blobs.ts`                 | File contents, stored once per distinct content                                |
| `probe.ts`                 | What the SQLite build at hand can do                                           |

Decision records: [0025](../../../../docs/adr/0025-sqlite-driver.md) for the drivers and
[0026](../../../../docs/adr/0026-workspace-database.md) for the database.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
