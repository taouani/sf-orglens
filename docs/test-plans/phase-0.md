# Test plan for Phase 0

This is the list of checks the maintainer can run by hand to verify what Phase 0 built. It follows the six
outcomes of the [Phase 0 plan](../plans/phase-0.md#1-outcome). The [phase report](../reports/phase-0.md) says what
was built and measured.

The plan is written by the AI assistant that built the phase, addressed to the maintainer. "I" is the assistant
and "you" is the maintainer.

- Parts A to E need no org and no network after the install. They take about 30 minutes.
- Part F starts the workflow against the test org. It takes about 10 minutes, most of it waiting.
- Part G is the one check that only you can do: `orglens snapshot` against an org with a Salesforce CLI login of
  your own. That command has never been run against Salesforce. It takes 5 to 15 minutes.
- Part H repeats the measurements of the Apex trial. It downloads three public codebases, about 250 MB.

Every expected output below was produced on Linux x64 with Node.js 24.22.3 on 12 November 2026, from the commit
that closes the phase. Times and sizes on your machine will differ. Numbers of components, files and references
must not.

At the end there is a list of what this plan cannot show, and what I ask you to decide.

## Before you start

You need Git, Node.js 24.15 or newer and pnpm 12.

```sh
git clone https://github.com/taouani/sf-orglens.git
cd sf-orglens
pnpm install
pnpm run build
```

Expected: `pnpm install` ends without an error and runs no install script of a dependency. `pnpm run build` prints
`$ tsc -b` and nothing else.

The command line is not published, so it is started from the build. The steps below write `orglens` for it. Make
that work in your shell, with the path of your clone:

```sh
# bash, zsh, Git Bash
alias orglens='node /path/to/sf-orglens/packages/cli/dist/bin.js'
```

```powershell
# PowerShell
function orglens { node C:\path\to\sf-orglens\packages\cli\dist\bin.js @args }
```

```sh
orglens --version
```

Expected: one line of the form `sf-orglens/0.0.0 engine/0.0.0 node-v24.22.3 linux-x64`, with your Node.js version
and your system.

## A. The repository and its checks

Outcome 6, and the base of all others.

| #   | Do                                                         | Expect                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `pnpm run check`                                           | It ends with a table of coverage, the lines `Statements`, `Branches`, `Functions`, `Lines`, and the exit code `0`. About 1,170 tests pass and 16 are skipped. On my machine it takes about five minutes.               |
| A2  | `pnpm run check:adr`                                       | `34 decision records checked: 27 plan decisions covered once each.`                                                                                                                                                    |
| A3  | `pnpm run check:startup`                                   | Three lines with medians, then `ok: "orglens status" is within the budget of 150 ms.` The budget is enforced on Linux and only reported on Windows and macOS.                                                          |
| A4  | Open the page **Actions** of the repository, workflow `CI` | The latest run on `main` is green, with jobs for Linux, macOS and Windows on Node.js 24 and 26.                                                                                                                        |
| A5  | Open `docs/adr/README.md`                                  | Every record is `Accepted`, except those the table marks as superseded. Record 0018 names the parser you confirmed. If you have not confirmed it yet, 0018 is `Proposed`, and that is the one open point of the phase. |

The skipped tests are those of the three public codebases. They run when the codebases are there (part H).

## B. A workspace, and a snapshot of a repository folder

Outcomes 1 and 2, for a source of the kind `git`. Work on a copy of the fixture project, outside the clone, so
that nothing is written into the repository.

```sh
cp -r /path/to/sf-orglens/fixtures/billing-sfdx ~/orglens-demo
cd ~/orglens-demo
```

In PowerShell: `Copy-Item -Recurse C:\path\to\sf-orglens\fixtures\billing-sfdx $HOME\orglens-demo`.

| #   | Do                                   | Expect                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `orglens init`                       | `Created a workspace in` and your folder, then three lines: `created orglens.toml`, `created .orglens/.gitignore`, `created .orglens/orglens.db`.                                                                                                                            |
| B2  | `orglens init` a second time         | `The workspace in` your folder `is complete. Nothing was changed.`                                                                                                                                                                                                           |
| B3  | `orglens source add repo --kind git` | `Added the source "repo" (git) to orglens.toml.` Open `orglens.toml`: the comments at the top are still there, and a table `[sources.repo]` was added.                                                                                                                       |
| B4  | `orglens source list`                | One line for `repo`, of the kind `git`, that points at `repo .`.                                                                                                                                                                                                             |
| B5  | `orglens source check repo`          | `The source "repo" can be read: 52 components in 65 files (36 KiB). Nothing was stored.` and one line `info COMMIT_UNKNOWN`, because the folder is not in a Git repository.                                                                                                  |
| B6  | `orglens snapshot repo`              | `Snapshot #1 of "repo" is complete: 52 components in 65 files (36 KiB).` and the table below.                                                                                                                                                                                |
| B7  | `orglens coverage repo`              | The same table, with the time the snapshot was taken.                                                                                                                                                                                                                        |
| B8  | `orglens status`                     | The workspace, `orglens.toml`, the database with `schema version 2`, and the line `repo  git  1  #1 complete, finished` with a time.                                                                                                                                         |
| B9  | `orglens doctor`                     | Eight checks, all `ok`: `node`, `sqlite`, `sqlite-fallback`, `git`, `workspace`, `config`, `store`, `logins`. The last line is `OrgLens can run here.` The check `git` is a warning, not a failure, on a machine without Git. The check `logins` names no login and no user. |

The table of B6:

```
TYPE            LISTED  RETRIEVED  ANALYSED
ApexClass       12      12         0
ApexTrigger     1       1          0
CustomField     31      31         0
CustomObject    2       2          0
ValidationRule  6       6          0
```

`ANALYSED` is `0` everywhere. Phase 0 stores files and analyses nothing.

## C. Snapshots are immutable, and an incomplete one says so

Outcome 2. Continue in the same folder.

| #   | Do                                                                                                                       | Expect                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Add a line `// a change` at the end of `force-app/main/default/classes/InvoiceService.cls`, then `orglens snapshot repo` | `Snapshot #2 of "repo" is complete: 52 components in 65 files (36 KiB).`                                                                                                                                                    |
| C2  | `orglens coverage repo --snapshot 1`                                                                                     | Snapshot #1 as it was, with its own time. The second snapshot did not change the first.                                                                                                                                     |
| C3  | Look at the size of `.orglens/orglens.db` before and after C1                                                            | It grew by 12 KiB on my machine, a third of the 36 KiB of the project: the 64 files that did not change are stored once. SQLite grows a file in pages of 4 KiB, so your number can differ a little.                         |
| C4  | Delete `force-app/main/default/classes/InvoiceService.cls-meta.xml`, then `orglens snapshot repo`                        | `Snapshot #3 of "repo" is partial, something is missing: 51 components in 63 files (34 KiB).` `ApexClass` shows 11. One line `error APEX_FILE_UNRESOLVED`. The exit code is `5` (`echo $?`, in PowerShell `$LASTEXITCODE`). |
| C5  | `orglens snapshot repo --json`                                                                                           | Exactly one line of JSON. It starts with `{"schemaVersion":1,"command":"snapshot","ok":true,` and holds `"status":"partial"` and the path of the class under `"paths"`. The exit code is `5` again.                         |
| C6  | `orglens snapshot nope`                                                                                                  | On the error stream: `error: No source "nope" is declared in orglens.toml.` and a hint. The exit code is `2`.                                                                                                               |
| C7  | `orglens snapshot nope --json`                                                                                           | One line of JSON with `"ok":false`, `"data":null` and `"code":"SOURCE_NOT_FOUND"`. Nothing on the error stream. The exit code is `2`.                                                                                       |
| C8  | `orglens status`                                                                                                         | `repo  git  4  #4 partial`. Four snapshots, and none was overwritten.                                                                                                                                                       |

[docs/cli.md](../cli.md) holds the contract these outputs follow: the envelope, the exit codes and the error
codes.

## D. A snapshot knows its commit

Outcome 2, for a folder that is in a Git repository. Use a second copy.

```sh
cp -r /path/to/sf-orglens/fixtures/billing-sfdx ~/orglens-demo-git
cd ~/orglens-demo-git
orglens init
orglens source add repo --kind git
git init
git add -A
git commit -m "first"
```

| #   | Do                                                                          | Expect                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `orglens snapshot repo`                                                     | `Snapshot #1 of "repo" is complete: 52 components in 65 files (36 KiB), commit` and the first ten characters of the id that `git rev-parse HEAD` prints.                                                                    |
| D2  | Add a line to a class without a commit, then `orglens snapshot repo`        | The snapshot is complete and names no commit. One line `info WORKING_TREE_MODIFIED` says that 1 file differs from the commit.                                                                                               |
| D3  | `git status` and `git log`                                                  | OrgLens changed nothing in the repository: no new commit, no file but yours modified. `.orglens` ignores itself.                                                                                                            |
| D4  | On Windows with the Git setting `core.autocrlf=true`: D1 can name no commit | Git then checks text files out with other line ends than the commit has. The snapshot names no commit and says in `WORKING_TREE_MODIFIED` that only the line ends differ. That is by design. I did not try this on Windows. |

## E. The fixture project and its answer key

Outcome 3.

| #   | Do                                                                                                                            | Expect                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | `pnpm exec vitest run packages/engine/test/fixture-key.test.ts`                                                               | All tests pass. They check that the key and the project list the same components, that every place the key names exists and holds the word the entry names, and that the key follows its own rules.                     |
| E2  | Read `fixtures/README.md` and a class of your choice next to its entries in `fixtures/expected/answer-key.v0.yaml`            | Each reference you find in the class is in the key, with the right line, word and kind (`reads`, `writes`), or the README says why it is left out. This is the check no tool can do: the key is written by hand, by me. |
| E3  | In one entry of the key, change the word after `match:` to a word that is not on that line, run E1 again, and undo the change | The run fails with `The answer key has 1 problem(s):` and names the file, the component and the line.                                                                                                                   |

## F. The test org

Outcomes 2 and 5. The workflow logs in with the secrets you stored. Its log is public.

| #   | Do                                                                                                                                  | Expect                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Actions**, workflow **Live org**, **Run workflow** on `main` with the choice `read and probe`                                     | The run is green after three to five minutes. The step that reads the org ends with a warning for a partial snapshot, which is expected for this org.                                                                                           |
| F2  | Read the log of the step that reads the org                                                                                         | The org lists 1,668 components or a number near it, of which about 1,445 are retrieved. All 52 components of the fixture project are listed and came back, in 65 files. The numbers of the org itself can move when Salesforce changes the org. |
| F3  | Read the log of the step that asks Salesforce about references                                                                      | The Dependency API reports 100 of the 137 pairs of the answer key, and no row between two components of the fixture project is wrong. No symbol table holds a reference.                                                                        |
| F4  | Search the whole log for the address of the org, its id, the user name and a name of a component that is not of the fixture project | None is there. You are the only one who knows the first three, so only you can do this check.                                                                                                                                                   |
| F5  | Look at the list of runs of the workflow                                                                                            | From the first Monday after the workflow was merged there is a run every week that logs in and does nothing else.                                                                                                                               |

[real-org.md](../research/phase-0/real-org.md) holds the numbers of the first runs, section by section.

## G. `orglens snapshot` against an org, with your own login

Outcome 2. **This is the check that has not been done.** The code that reads an org ran against the test org in
part F, started by a tool of the tests. The command `orglens snapshot`, with a login of the Salesforce CLI, ran
against a mock org only. I have no org and no login.

Use an org you are free to read: a Developer Edition org or a sandbox of your own. The snapshot stores the
metadata files of that org in `.orglens/orglens.db` on your machine and nowhere else. OrgLens reads metadata only
and writes nothing to the org. Do this in a new folder outside any repository, and delete the folder afterwards if
the org is not yours to keep a copy of.

You need a login of the Salesforce CLI for the org (`sf org login web --alias my-org`).

```sh
mkdir ~/orglens-org-test
cd ~/orglens-org-test
orglens init
orglens source add dev --kind org
orglens source link dev my-org
```

| #   | Do                                                                                                                                   | Expect                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G0  | Before the line `orglens source link`: `orglens source check dev`                                                                    | `error: Nothing says which login the source "dev" uses.` and a hint. The exit code is `4`. This step needs no org.                                                                                                                                                                                                               |
| G1  | `orglens doctor`                                                                                                                     | The check `logins` is `ok`. It says how many logins the Salesforce CLI has on the machine and by which route `dev` would be logged in. It names no login and no user.                                                                                                                                                            |
| G2  | `orglens source check dev`                                                                                                           | It logs in and prints the id of the org and the API version. It says which `org_id` to add to `orglens.toml`.                                                                                                                                                                                                                    |
| G3  | `orglens snapshot dev`                                                                                                               | Lines of progress on the error stream: the login, the requests that ask the org what it holds, the number of components and chunks, each chunk as it is stored. Then the table per metadata type and the issues. A Developer Edition org took two to three minutes in part F. Expect `partial` and the exit code `5`: see below. |
| G4  | `orglens coverage dev`                                                                                                               | The same table. For each type, `LISTED` is what the org said it has and `RETRIEVED` what came back.                                                                                                                                                                                                                              |
| G5  | Stop a second `orglens snapshot dev` with Ctrl+C while a chunk is retrieved, run `orglens status`, then `orglens snapshot dev` again | `status` shows an unfinished snapshot with the chunks that are done. The next run continues it and does not ask again what the org holds. The finished snapshot has a note `SNAPSHOT_RESUMED`. This only shows on an org with more than one chunk, which is about 3,000 files.                                                   |
| G6  | Compare the table with what you know of the org                                                                                      | The counts of classes, triggers, custom objects and flows are the ones you expect. If a type you know is missing from the table, that is a finding.                                                                                                                                                                              |

What I expect and cannot promise: the snapshot will most likely be `partial`. The test org lists 223 components
that Salesforce does not hand out, most of them list views. What "complete" should mean is one of the questions
at the end of this plan. Anything else that looks wrong here is worth an issue, because this is the first run of
its kind: an error code, a type that is refused, a retrieve that fails.

Please do not paste the output of G2 into a public issue: it holds the id of the org. `orglens doctor` is safe to
paste.

## H. The Apex trial

Outcome 4. The trial is in `trial/apex` and is not part of OrgLens.

```sh
cd /path/to/sf-orglens
node trial/apex/src/run-fixture.ts tree-sitter
node trial/apex/src/run-fixture.ts apex-parser
```

| #   | Do                                                                                                                                                                                                                               | Expect                                                                                                                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | The two commands above                                                                                                                                                                                                           | For each parser: `recall 181 of 181`, `precision 181 of 181`, `kind 181 of 181`, `stretch 3 found`, `negatives 0 hit of 21`, `unknowns 5 of 5, 0 more`, and no line that names a difference.                        |
| H2  | `pnpm run corpora:fetch`                                                                                                                                                                                                         | Three public codebases are downloaded into `.corpora`, each at the commit `fixtures/corpora.toml` pins. This needs the network.                                                                                     |
| H3  | `node trial/apex/src/run-corpus.ts tree-sitter .corpora/npsp`                                                                                                                                                                    | A JSON summary with `"files": 1070`, `"lines": 320093`, `"references": 45488`, `"unknowns": 1293`, `"calls": 30037`. `totalMs` was 3,040 to 4,240 and `peakMemoryMb` 437 to 444 on my machine.                      |
| H4  | `node trial/apex/src/run-corpus.ts apex-parser .corpora/npsp`                                                                                                                                                                    | The same five numbers. `totalMs` was 16,100 to 17,300 and `peakMemoryMb` 1,501 to 1,532 on my machine. The plan's mark is 60 seconds and 1,500 MB.                                                                  |
| H5  | `pnpm run test` with the codebases in place                                                                                                                                                                                      | The tests that were skipped in A1 now run and pass.                                                                                                                                                                 |
| H6  | Read ten entries of the sample in [apex-trial.md](../research/phase-0/apex-trial.md) against the source in `.corpora/apex-recipes`, or draw your own with `node trial/apex/src/sample.ts` (the README of `trial/apex` shows how) | Each reference is in the source at the line it names, and reads or writes the field it names. I checked 100 and found all right. No second person has checked them, so ten of yours are worth more than my hundred. |

## What this plan cannot show

- **Windows and macOS by hand.** CI runs every test on both, on every pull request. I ran nothing by hand on
  either. If you are on one of them, parts A to D are that check.
- **`orglens snapshot` against a real org.** Part G is the first time. An org with a namespace, a sandbox, an org
  of 10,000 components or more, and a login with a key from your own machine were never tried.
- **That the answer key is right.** I wrote the fixture project, the key and the resolver of the trial. The
  Dependency API contradicts no entry of the key, for the 100 pairs it can see. Step E2 is the only check by
  another person.
- **Anything about impact.** Phase 0 parses nothing. No command answers a question about an org yet.
- **A release.** Nothing is published to npm. CI packs the packages and installs them from the files, on three
  systems.

## What I ask you to decide

1. **Approve or reject Phase 0.** If a step above fails, tell me its number and what you saw.
2. **The parser.** The trial selects `web-tree-sitter-sfapex`. Record 0018 becomes `Accepted` when you confirm.
3. **The questions of the [Phase 1 plan](../plans/phase-1.md), section 4.** Nothing of Phase 1 is built before you
   approve that plan.
