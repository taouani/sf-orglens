# `sources` layer

Reading a live org, a sandbox or a Git repository: login, inventory, retrieve, reading files. The only layer allowed to import the Salesforce libraries.

May import from: `core`.

| File              | What it holds                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `tree.ts`         | `SourceTree`: the one shape every source is read into, and the issues of a reading       |
| `folder.ts`       | Folders of the disk as a tree. Links and repositories inside are not followed            |
| `git.ts`          | A commit as a tree, read from the object database by the `git` program, and what differs |
| `project.ts`      | The package directories of `sfdx-project.json`                                           |
| `forceignore.ts`  | The rules of `.forceignore`, evaluated on a tree                                         |
| `resolve.ts`      | Files to metadata components, with the Salesforce source library                         |
| `local.ts`        | `readLocalSource`: all of the above for a source of the kind `git`                       |
| `library.ts`      | Loads the Salesforce libraries on first use, with their log file switched off            |
| `logins.ts`       | The logins of the Salesforce CLI, listed by reading files, and which one a source uses   |
| `jwt.ts`          | A login with a key from the environment: the variables, the assertion, the exchange      |
| `org.ts`          | `connectToOrg`: login, newest API version, and the check that the org is the one meant   |
| `org-errors.ts`   | What a failed login is reported as, and how a failed connection is told from a refusal   |
| `metadata-api.ts` | The four requests to the Metadata API, each with a time limit and without redirects      |
| `inventory.ts`    | What an org holds: every type it describes and every component it lists                  |
| `chunks.ts`       | Which components are asked for by name, and in which chunks                              |
| `retrieved.ts`    | The zip file of a retrieve, converted to the form a repository holds                     |

Reading an org has been tested against a mock org only. Decision records:
[0030](../../../../docs/adr/0030-reading-a-git-source.md) for how a Git source is read,
[0031](../../../../docs/adr/0031-logins-and-the-home-folder.md) for logins and the files they touch in the home
folder, [0032](../../../../docs/adr/0032-reading-an-org.md) for how an org is read.

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
