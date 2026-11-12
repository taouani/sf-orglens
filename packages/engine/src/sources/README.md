# `sources` layer

Reading a live org, a sandbox or a Git repository: login, inventory, retrieve, reading files. The only layer allowed to import the Salesforce libraries.

May import from: `core`.

| File             | What it holds                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `tree.ts`        | `SourceTree`: the one shape every source is read into, and the issues of a reading       |
| `folder.ts`      | Folders of the disk as a tree. Symbolic links are not followed                           |
| `git.ts`         | A commit as a tree, read from the object database by the `git` program, and what differs |
| `project.ts`     | The package directories of `sfdx-project.json`                                           |
| `forceignore.ts` | The rules of `.forceignore`, evaluated on a tree                                         |
| `resolve.ts`     | Files to metadata components, with the Salesforce source library                         |
| `local.ts`       | `readLocalSource`: all of the above for a source of the kind `git`                       |

Reading an org is not built yet. Decision record:
[0030](../../../../docs/adr/0030-reading-a-git-source.md) for how a Git source is read.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
