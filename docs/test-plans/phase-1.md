# Test plan for Phase 1

This is the list of checks the maintainer can run by hand to verify what Phase 1 built. It follows the five
outcomes of the [Phase 1 plan](../plans/phase-1.md#1-outcome). The [phase report](../reports/phase-1.md) says
what was built and measured.

The plan is written by the AI assistant that built the phase, addressed to the maintainer. "I" is the assistant
and "you" is the maintainer.

- Parts A to D need no org and no network after the install. They take about 30 minutes.
- Part E is your reading of ten entries of the answer key, which the plan of the phase asks for. About 20
  minutes.
- Part F downloads four public codebases, about 160 MB on disk, and repeats the check and the timing of work
  package 10. It also asks you to read a few entries by hand, which no person has done yet.
- Part G reads the log of a run against the test org.
- **Part H is the main part, and only you can do it:** `orglens snapshot`, `coverage` and `impact` on an org
  you know. None of the three commands has ever run against Salesforce. It takes as long as the org takes to
  hand out its metadata: minutes for a small org, and I do not know how long for a large one.
- Part I installs the pre-release, once it is published. It is not published yet.

Every expected output of parts B to D was produced on Linux x64 with Node.js 24.22.3 on 17 November 2026, as
the root user, with the code of the engine and the command line of the commit named below. Times and sizes on
your machine will differ. Numbers of components, files and references must not.

At the end there is a list of what this plan cannot show, and what I ask you to decide.

## Before you start

You need Git, Node.js 24.15 or newer and pnpm 12.

```sh
git clone https://github.com/taouani/sf-orglens.git
cd sf-orglens
git checkout 71f070bbb4df28d34c1e7b482c436e4e5d20a00b
pnpm install
pnpm run build
```

Expected: `pnpm install` ends without an error and runs no install script of a dependency. `pnpm run build`
prints `$ tsc -b` and nothing else.

The third line takes the repository to the commit this plan was written against: the last one of Phase 1 that
changed the engine or the command line. What came after it are documents, three decision records from your
answers of 17 November 2026 (0051 to 0053), and the workflow and the script that make a pre-release. They are on
`main`. Git says that the clone is in "detached HEAD" state, which is
expected. In a clone you made earlier, run `git fetch origin` first.

The steps below write `orglens` for the command line of the build. Make that work with the two lines for your
shell, in the root of the clone:

In bash, zsh or Git Bash:

```sh
ORGLENS_REPO="$(pwd)"
orglens() { node "$ORGLENS_REPO/packages/cli/dist/bin.js" "$@"; }
```

In PowerShell:

```powershell
$orglensRepo = (Get-Location).ProviderPath
function orglens { node "$orglensRepo\packages\cli\dist\bin.js" @args }
```

The two lines hold for the terminal window they were run in. `orglens --version` prints
`sf-orglens/0.1.0-next.0 engine/0.1.0-next.0`, then your Node.js version and system.

I ran the lines for bash, in bash on Linux. I have no Windows machine, so the lines for PowerShell were not run
by me. The folder `orglens-phase1` in your home folder must not exist yet.

## A. The repository and its checks

| #   | Do                                                         | Expect                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `pnpm run check`                                           | It ends with a table of coverage and the exit code `0`. Of 2,099 tests, 2,064 pass and 35 are skipped where I ran it, as the root user, without the public codebases. With them (part F): 2,088 and 11. As another user or on another system the split differs. No test fails. About ten minutes. |
| A2  | `pnpm run check:adr`                                       | `50 decision records checked: 27 plan decisions covered once each.`                                                                                                                                                                                                                               |
| A3  | Open the page **Actions** of the repository, workflow `CI` | The latest run on `main` is green, with jobs for Linux, macOS and Windows on Node.js 24 and 26.                                                                                                                                                                                                   |
| A4  | Open `docs/adr/README.md`                                  | Records 0035 to 0050 are of this phase. 0036 is superseded by 0038. Records 0039 to 0050 each list choices of mine that are yours to strike. On `main` the file has three more, 0051 to 0053, from your answers of 17 November 2026. 0052 is superseded.                                          |

## B. A snapshot is analysed

Outcomes 1 and 4. Work on a copy of the fixture project, outside the clone.

In bash, zsh or Git Bash:

```sh
cp -r "$ORGLENS_REPO/fixtures/billing-sfdx" ~/orglens-phase1
cd ~/orglens-phase1
```

In PowerShell:

```powershell
Copy-Item -Recurse "$orglensRepo\fixtures\billing-sfdx" "$HOME\orglens-phase1"
cd "$HOME\orglens-phase1"
```

Then, in either shell:

```sh
orglens init
orglens source add repo --kind git
```

| #   | Do                      | Expect                                                                                                                                                                                                                        |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `orglens snapshot repo` | `Snapshot #1 of "repo" is complete: 87 components in 99 files (52 KiB).` and the output below.                                                                                                                                |
| B2  | `orglens coverage repo` | The same, with the time the snapshot was taken in the first line.                                                                                                                                                             |
| B3  | `orglens status`        | The database is at `schema version 7`. The line of `repo` ends with `by engine 0.1.0-next.0` in the column `ANALYSED`.                                                                                                        |
| B4  | `orglens analyse repo`  | `Snapshot #1 of "repo" was analysed from the files it holds. It is complete: 87 components in 99 files (52 KiB).` and the same tables. The source is not read: the command also works when the folder `force-app` is renamed. |

The output of B1, below its first line:

```
TYPE              LISTED  RETRIEVED  ANALYSED
ApexClass         12      12         0
ApexTrigger       1       1          0
CustomField       54      54         54
CustomLabel       1       1          0
CustomLabels      1       1          0
CustomMetadata    1       1          0
CustomObject      5       5          5
CustomPermission  1       1          0
GlobalValueSet    1       1          0
ValidationRule    10      10         10

SEVERITY  CODE            WHAT
info      COMMIT_UNKNOWN  The snapshot names no commit: the folder is not in a Git repository.

Analysed by engine 0.1.0-next.0: 89 components, 106 references.

ORIGIN          COMPONENTS  REFERENCES  NOT RESOLVED  PATHS NOT FOLLOWED  FILES NOT READ
parser:xml      69          26          0             0                   0
parser:formula  34          80          0             0                   0
```

`ANALYSED` is the number of components of a type the analysis read something of. It is `0` for every type but
objects, fields and validation rules: Phase 1 analyses nothing else. The analysis counts 89 components where
the snapshot lists 87, because it also knows the standard objects `Account` and `User`, of which the project
holds fields and no file. The 106 references are the 106 the answer key holds for fields and rules: 26 written
in XML and 80 in formulas.

## C. Impact answers

Outcomes 2 and 3. Continue in the same folder.

| #   | Do                                                                       | Expect                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `orglens impact Invoice__c.Amount__c`                                    | The output below: 7 components, 6 of them directly. The second line says that the answer is not complete, and the last table names the 7 types that are not analysed. The exit code is `0`.                                  |
| C2  | Open the file and the line of one result                                 | The line holds the name `Amount__c`, in a formula. For the result of depth 2, `Grand_Total__c`, the line holds `Total__c`, which is itself a result of depth 1: that is the chain.                                           |
| C3  | `orglens impact Invoice__c.Amount__c --depth 1`                          | The first line ends with `to a depth of 1.` and the answer has the 6 direct results.                                                                                                                                         |
| C4  | `orglens impact Invoice__c.Unused_Field__c`                              | `Nothing that was analysed refers to it.` and the same warning and table of types. It does not say that nothing refers to the field.                                                                                         |
| C5  | `orglens impact Invoice__c`                                              | `It contains 40 components of the snapshot. The answer is about them too.` Then the components that refer to the object or to something in it from outside.                                                                  |
| C6  | `orglens impact Invoice__c.Total__c --outgoing`                          | `What CustomField:invoice__c.total__c (Invoice__c.Total__c) refers to`: the two fields `Amount__c` and `Tax_Rate__c`. This answer says that it is complete: the snapshot holds every component in it, and each was analysed. |
| C7  | `orglens impact Invoice__c.Nope__c`                                      | On the error stream: `error: The snapshot knows no component "Invoice__c.Nope__c".` and a hint. The exit code is `2` (`echo $?`, in PowerShell `$LASTEXITCODE`).                                                             |
| C8  | `orglens impact Invoice__c.Amount__c --json`                             | Exactly one line of JSON. It starts with `{"schemaVersion":1,"command":"impact","ok":true,` and holds `"analysedBy":"0.1.0-next.0"` and `"complete":false`.                                                                  |
| C9  | Pick three fields of the fixture project you have read, and ask for each | What you expect from the files. `fixtures/expected/answer-key.v1.yaml` holds every reference, and a test works the answer for 96 components out from the key alone. This step is your own look at it.                        |

The output of C1:

```
What refers to CustomField:invoice__c.amount__c (Invoice__c.Amount__c), in snapshot #1 of "repo".
The answer is not complete: 7 types are not analysed yet. The details are below the answer.

7 components refer to it, 6 of them directly.

DEPTH  COMPONENT                                                CONFIDENCE  KIND   REFERS TO                         WHERE
1      CustomField:invoice__c.late_fee__c                       confirmed   reads  CustomField:invoice__c.amount__c  force-app/main/default/objects/Invoice__c/fields/Late_Fee__c.field-meta.xml:6
1      CustomField:invoice__c.summary__c                        confirmed   reads  CustomField:invoice__c.amount__c  force-app/main/default/objects/Invoice__c/fields/Summary__c.field-meta.xml:5
1      CustomField:invoice__c.total__c                          confirmed   reads  CustomField:invoice__c.amount__c  force-app/main/default/objects/Invoice__c/fields/Total__c.field-meta.xml:4
1      ValidationRule:invoice__c.amount_within_credit_limit     confirmed   reads  CustomField:invoice__c.amount__c  force-app/main/default/objects/Invoice__c/validationRules/Amount_Within_Credit_Limit.validationRule-meta.xml:5
1      ValidationRule:invoice__c.large_amount_needs_permission  confirmed   reads  CustomField:invoice__c.amount__c  force-app/main/default/objects/Invoice__c/validationRules/Large_Amount_Needs_Permission.validationRule-meta.xml:6
1      ValidationRule:invoice__c.locked_when_paid               confirmed   reads  CustomField:invoice__c.amount__c  force-app/main/default/objects/Invoice__c/validationRules/Locked_When_Paid.validationRule-meta.xml:7
2      CustomField:invoice__c.grand_total__c                    confirmed   reads  CustomField:invoice__c.total__c   force-app/main/default/objects/Invoice__c/fields/Grand_Total__c.field-meta.xml:4

Not analysed yet. A component of these types may refer to it, and is not in the answer:
TYPE              LISTED  RETRIEVED
ApexClass         12      12
ApexTrigger       1       1
CustomLabel       1       1
CustomLabels      1       1
CustomMetadata    1       1
CustomPermission  1       1
GlobalValueSet    1       1
```

The Apex classes of the fixture project do read `Amount__c`. This answer does not hold them, and says so.

## D. An answer follows the files

Outcomes 1 to 3. Each step changes one line of one file and takes a new snapshot. Continue in the same folder.
The file is `force-app/main/default/objects/Invoice__c/fields/Total__c.field-meta.xml`. Its fourth line is
`<formula>Amount__c * (1 + Tax_Rate__c)</formula>`.

| #   | Do                                                                                                                                              | Expect                                                                                                                                                                                                                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Change the formula to `Amount__c * (1 + Tax_Rate__c) + Paid_Date__c`, then `orglens snapshot repo` and `orglens impact Invoice__c.Paid_Date__c` | Snapshot #2 is complete. The answer has 3 components: `Total__c` at line 4 of its file and the rule `Paid_Requires_Paid_Date` at depth 1, and `Grand_Total__c` at depth 2, through `Total__c`. OrgLens does not check that a formula is valid: this one adds a date to a number, and Salesforce would refuse it.                    |
| D2  | `orglens impact Invoice__c.Paid_Date__c --snapshot 1`                                                                                           | The answer of the first snapshot: 1 component, the rule. A later snapshot did not change the earlier one.                                                                                                                                                                                                                           |
| D3  | Change the formula to `Amount__c * (1 + Tax_Rte__c)`, a name that does not exist, then `orglens snapshot repo`                                  | Snapshot #3 is complete. The line `parser:formula` shows `1` in the column `NOT RESOLVED`. `orglens impact Invoice__c.Tax_Rate__c` now has 1 component, the rule `Tax_Rate_Matches_Code`, and no longer `Total__c`.                                                                                                                 |
| D4  | Change the formula to `Amount__c * (1 + `, which is cut off, then `orglens snapshot repo`                                                       | Snapshot #4 is complete, with one line `warning FORMULA_NOT_READ` that names the file and line 4. `orglens impact Invoice__c.Amount__c` still has 7 components. `Total__c` is among them with the confidence `probable`, and the second line says that the analysis had 1 warning.                                                  |
| D5  | Change `</label>` in the fifth line to `</labe>`, then `orglens snapshot repo`                                                                  | Snapshot #5: `The analysis is incomplete: the errors below say what was not analysed.` and one line `error XML_MALFORMED` for the file. The exit code is `5`. `orglens impact Invoice__c.Amount__c` has 5 components, says that the analysis had 1 error, and ends with `5` too: the answer may miss something of a type it covers. |

The folder can be deleted after this part.

## E. The answer key, read by you

Outcome 5. The plan of the phase asks you to read at least ten entries of the new answer key against their
files. I wrote the fixture project, the key and the analyser, so a blind spot of mine is in all three. Your
reading is the one check of the key by a second person.

| #   | Do                                                                                                                                                                                  | Expect                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Read [fixtures/README.md](../../fixtures/README.md), the sections "What is keyed", "What is not keyed" and "What is marked as stretch"                                              | They say what an entry holds and which names give no reference by a rule.                                                                                                                                                                                                      |
| E2  | Pick ten fields or validation rules under `fixtures/billing-sfdx/force-app/main/default/objects`, of several kinds: a formula, a lookup, a roll-up summary, a lookup filter, a rule | For each, the entries of `fixtures/expected/answer-key.v1.yaml` under that component, below the line `references:`, hold every name you find in the file, with the right line, kind and target (`line`, `match`, `kind`, `to`). Nothing is in the key that is not in the file. |
| E3  | Read the entries of fields and rules that the key marks with `stretch: true`, and the ones below the line `negatives:`                                                              | You agree that each of the first is a reference, and that each of the second is none.                                                                                                                                                                                          |

A name you find and the key lacks, or a reference of the key you do not agree with, is a finding. The key is
not changed to make an analyser pass, so a finding changes the key first and the analyser after it.

## F. The public codebases

Outcome 5. Run this part in the root of the clone: `cd "$ORGLENS_REPO"` in bash, `cd $orglensRepo` in PowerShell.

| #   | Do                                                                                                          | Expect                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | `pnpm run corpora:fetch`                                                                                    | Four codebases are downloaded into `.corpora`, each at the commit `fixtures/corpora.toml` names: Apex Recipes, Nebula Logger, NPSP and PMM.                                                                                                                                                                                                            |
| F2  | `pnpm exec vitest run packages/engine/test/extraction-corpora-checked.test.ts`                              | All tests pass, and none is skipped. They hold the counts and the digest of what I checked by hand: when the analysis reports something else for an entry, a test fails.                                                                                                                                                                               |
| F3  | `pnpm run corpora:listing pmm > pmm-listing.txt`                                                            | On the error stream, a line `pmm: 40 entries` with a time and a digest. The file holds every formula field, default value, validation rule, lookup filter and roll-up summary of PMM as text, each with the references and the issues OrgLens reports for it. Delete the file afterwards: it holds text of PMM, which is not stored in the repository. |
| F4  | Read five entries of that file that hold a formula                                                          | Every name of a field or an object in the formula has a reference, with the right target, and no reference is there for a name that is not in the formula. The note names the rules by which a name gives no reference: `Id` at the end of a path, the custom setting in `$Setup`, `User` in `Owner:User`, and the first name of a path in a filter.   |
| F5  | `pnpm run corpora:listing npsp > npsp-listing.txt`, and find `Recurring_Donation_Installment_Name__c` in it | The one formula with missed references. It goes through `npe03__Recurring_Donation__r` four times, and the entry has four warnings `PATH_NOT_FOLLOWED` and no reference to the fields behind that lookup. Delete the file afterwards.                                                                                                                  |
| F6  | `pnpm run bench:corpora pmm --runs 3`                                                                       | A table of times for `snapshot`, `analyse`, `coverage` and `impact` on PMM. On my machine a snapshot took 0.9 to 1.2 seconds and an impact question 0.1 to 0.2. Your times are yours: I ask for no number here.                                                                                                                                        |

[public-codebases.md](../research/phase-1/public-codebases.md) has the numbers of the check and what it does
not show. F4 matters more than its five entries suggest: no person has read an entry yet.

## G. The test org

Outcome 5. The workflow "Live org" logs in to the test org with the secrets you stored. Its log is public. I
start its runs, as you decided. The last run of the phase is
[run 15](https://github.com/taouani/sf-orglens/actions/runs/44051349448), of 17 November 2026.

| #   | Do                                                                                                                                  | Expect                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Open the log of run 15, the step that reads the org                                                                                 | The org lists 1,710 components, of which 1,495 are retrieved, in 5,072 files. The fixture project is whole: 87 components in 99 files. The snapshot is partial, and the step ends with a warning for it. |
| G2  | In the same step, the lines about what is missing                                                                                   | `NOT_RETRIEVED` is an error for 2 of 79 `CustomField`, 2 of 2 `RecordType` and 2 of 398 `CustomObject`. For 209 components of 10 types outside the logic tier it is a warning.                           |
| G3  | In the same step, the lines about the cross-check                                                                                   | The Dependency API reports 257 rows. 56 pairs are compared, and none is missed. Read in parts, 60 requests give the same 257 rows.                                                                       |
| G4  | Search the whole log for the address of the org, its id, the user name and a name of a component that is not of the fixture project | None is there. You are the only one who knows the first three, so only you can do this check.                                                                                                            |

[real-org.md](../research/phase-1/real-org.md) holds the numbers of every run of the phase.

## H. An org you know

Outcome 5. **This is the check that has not been done.** The engine read the test org through a tool of the
tests. The commands `orglens snapshot`, `coverage` and `impact`, with a login of the Salesforce CLI, ran
against a mock org only. The test org is small and holds little besides the fixture project. An org you know
shows what neither can: whether the answers hold for fields whose uses you know, on formulas and rules that
neither of us wrote.

**If the org is a client's, the client's permission comes first.** The snapshot stores the metadata files of
the org in `.orglens/orglens.db` on your machine and nowhere else. OrgLens reads metadata only and writes
nothing to the org. It asks one object of the Tooling API, `MetadataComponentDependency`, for the cross-check.
Work in a new folder outside any repository, and delete the folder afterwards if the org is not yours to keep
a copy of.

If you have not run part G of the [Phase 0 test plan](phase-0.md#g-orglens-snapshot-against-an-org-with-your-own-login),
its steps G0 to G2 come first: they show that the login works. They are the first run with a login of the
Salesforce CLI and with the keychain of your system.

You need a login of the Salesforce CLI for the org (`sf org login web --alias my-org`). Then, in a new folder,
with the alias of your login in place of `my-org`:

```sh
orglens init
orglens source add prod --kind org
orglens source link prod my-org
orglens source check prod
```

| #   | Do                                                                                                                                                                       | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Note the time, then `orglens snapshot prod`                                                                                                                              | Lines of progress on the error stream, also for the rows of the Dependency API. Then the table per type, the issues, the analysis, and the cross-check. The first line says `is complete`, `is complete for the logic tier` or `is partial`. On the test org it is partial, for six components that Salesforce does not hand out.                                                                                                             |
| H2  | Read the issues of H1                                                                                                                                                    | An `error` is about a type of the logic tier, a `warning` about another type or about something that does not make the snapshot partial. For each `NOT_RETRIEVED` that is an error: is it a component you know, and can you see why Salesforce does not hand it out? That is what I could not find out on the test org.                                                                                                                       |
| H3  | `orglens coverage prod`, the lines of the cross-check at the end                                                                                                         | `Cross-check: the Dependency API of Salesforce reports N rows.` and whether a query left a row out. Then how many rows are not compared, by type, and the line that counts: `They are N pairs of components: the analysis has N of them, has N as a reference to a part of the object Salesforce names, and missed N.` **Missed must be 0.** A missed pair is listed with both components, and is an error of the analysis I have to correct. |
| H4  | Pick five fields whose uses you know, in formula fields, validation rules, roll-up summaries or lookup filters. For each: `orglens impact <Object.Field__c>`             | Every formula field and validation rule you know of is in the answer, at the line where the name stands. Nothing is in it that does not name the field. Uses in flows, Apex, layouts or reports are not in the answer, and its first lines say so.                                                                                                                                                                                            |
| H5  | Pick a field that a formula reaches through a relationship, such as `Account.Owner.Name` on a contact                                                                    | The field at the end of the path is found. In the table of `coverage`, the column `PATHS NOT FOLLOWED` counts the paths the analysis could not follow, and `NOT RESOLVED` the names it found nowhere. For a few of each, look at the formula: is the name one a person could resolve from the org?                                                                                                                                            |
| H6  | Only if the org has many reports or another type nobody asks about: add `exclude_types = ["Report"]` to the source in `orglens.toml`, then `orglens snapshot prod` again | The type is `left out` in the table and is not read. The key was never run against Salesforce. Whether the second snapshot is faster is a number I would like to know.                                                                                                                                                                                                                                                                        |
| H7  | Stop a third `orglens snapshot prod` with Ctrl+C while a chunk is retrieved, then run it again                                                                           | The next run continues the snapshot and does not ask again what the org holds. This is step G5 of the Phase 0 test plan, and only shows on an org with more than one chunk.                                                                                                                                                                                                                                                                   |

**Two numbers I ask for, if you are free to tell them:** how long the first snapshot took (H1), and how many
components the table of `coverage` lists in all. They would be the first real numbers behind your target of 60
minutes for an org of 100,000 components. If the org is a client's, they stay with you unless the client
agrees. They are not written into the repository either way.

**What these outputs hold, and where they must not go.** The outputs of H1 to H5 hold names of components of
the org. The repository is public and its data rules allow none of this in an issue, a pull request or a
commit. If the org is a client's, it does not belong in a chat either. To report a finding, give the number of
the step, the error or issue code, the metadata type, the kind of the reference (formula, lookup, summary,
filter) and the counts. For a missed or a wrong reference, the shape of the formula with the names replaced is
enough for me to build a case of it in the fixture project.

## I. The pre-release

The pre-release `0.1.0-next.0` is not published, and this part waits for it. It is published on npm and on
GitHub by the workflow "Pre-release" (records 0050 and 0053). Three things come first:

1. What only you can set up: the organization `sf-orglens` on npm, the environment `npm-next` on GitHub and the
   token for the first publish. [`docs/releases/publishing.md`](../releases/publishing.md) has the steps.
2. Your answer to what a pre-release on npm fixes, which the release notes wait for.
3. Your word for the run that publishes, and your approval of its job in the environment. The run cannot be
   undone.

| #   | Do                                                                                    | Expect                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Open the [releases](https://github.com/taouani/sf-orglens/releases) of the repository | One release, `OrgLens 0.1.0-next.0 (pre-release)`, marked as a pre-release, with three files: two `.tgz` and `SHA256SUMS`. GitHub adds two archives of the source.         |
| I2  | Open `https://www.npmjs.com/package/sf-orglens`                                       | Version `0.1.0-next.0`, under the tags `next` and `latest`, with a mark that it has provenance and a link to the run that built it. `@sf-orglens/engine` shows the same.   |
| I3  | In a terminal without the shell function of this plan, run the install line of I1     | The line is `npm install --global sf-orglens@0.1.0-next.0`. `orglens --version` prints `sf-orglens/0.1.0-next.0 engine/0.1.0-next.0`.                                      |
| I4  | `orglens doctor` in any folder that is no workspace                                   | The checks `node`, `sqlite` and `git` are `ok`. The check `workspace` is `skipped`: `No orglens.toml in this folder or above it.` The last line is `OrgLens can run here.` |
| I5  | `npm update --global`, then `orglens --version`                                       | The version is still `0.1.0-next.0`: it is the newest one under `latest`.                                                                                                  |
| I6  | `npm uninstall --global sf-orglens`                                                   | It is removed with the engine, and `orglens` is no longer found.                                                                                                           |

The run of the workflow that publishes also installs from npm on Linux, Windows and macOS. I3 is the first
install by a person. I2 is written from the pages of npm, and what the page of a package shows is npm's to
decide. I5 was tried against a registry on my machine, not against npm. I5 updates every global package of your
machine. Leave it out if you do not want that.

**Do not run `npx orglens`.** The name `orglens` is the command, not a package of this project, and npx fetches
whatever package has that name.

## What this plan cannot show

- That the answers are right on an org of thousands of components. Part H shows it for the fields you pick.
- That nothing is missed where Salesforce confirms nothing: standard fields, lookups, roll-up summaries, lookup
  filters and inactive rules. For those the answer key, the public codebases and your own knowledge of an org
  are the only measure.
- How long a first snapshot of an org of 100,000 components takes. Your numbers of part H are the first step.
- Anything about Apex, flows and every other type. They are stored and not analysed.
- A sandbox, an org with a namespace of its own, and an edition other than the ones you run it on.
- Memory. It was measured nowhere in this phase.
- Windows and macOS by hand. CI runs the tests there, and I ran nothing there myself.

## What I ask you to decide

1. Whether the phase is accepted, after this plan.
2. What a pre-release on npm fixes of the names and the JSON output (part I). Asked on 17 November 2026.
3. Your word for the run that publishes the pre-release, once you have set up what part I names.
4. How you count the 100,000 components of your performance targets (record 0037). Asked on 15 November 2026.
5. The questions of the [Phase 2 plan](../plans/phase-2.md), and its approval.

Two questions of the close you answered on 17 November 2026: a component the org lists and Salesforce does not
hand out stays an error of a snapshot, and the pre-release is not "the first release" of records 0022 and 0027
(record 0051).
