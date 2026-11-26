# Test plan for Phase 2

This is the list of checks the maintainer can run by hand to verify what Phase 2 built. It follows the six outcomes
of the [Phase 2 plan](../plans/phase-2.md#1-outcome). The [phase report](../reports/phase-2.md) says what was built
and measured.

The plan is written by the AI assistant that built the phase, addressed to the maintainer. "I" is the assistant and
"you" is the maintainer.

- Parts A to D need no org, and no network after the install but for step A3, which opens a page of GitHub. They
  take about 30 minutes.
- **Part E is your reading of ten entries of the answer key**, which you chose with Q6 of the plan. About 20
  minutes.
- Part F downloads eight public codebases, about 250 MB on disk, and repeats the check of work package 9. **Its step
  F4 is your reading of five flows**, the other half of Q6. About 20 minutes.
- Part G reads the log of a run against the test org.
- **Part H is the main part, and only you can do it:** `orglens snapshot`, `coverage` and `impact` on an org you
  know, with flows whose uses you know. No command of this version has run against an org. It also shows whether
  the corrections from your snapshot of a large org on 23 November 2026 hold there.
- Part I installs `0.1.0-next.2` from npm, where it is published since 26 November 2026.

Every expected output of parts B to D was produced on Linux x64 with Node.js 24.22.3 on 25 November 2026, as the root
user, with the code of the commit named below. Times and sizes on your machine will differ. Numbers of components,
files and references must not.

At the end there is a list of what this plan cannot show, and what I ask you to decide.

## Before you start

You need Git, Node.js 24.15 or newer and pnpm 12.

```sh
git clone https://github.com/taouani/sf-orglens.git
cd sf-orglens
git checkout 497531d
pnpm install
pnpm run build
```

Expected: `pnpm install` ends without an error and runs no install script of a dependency. `pnpm run build` prints
`$ tsc -b` and nothing else.

The third line takes the repository to the commit of the version `0.1.0-next.2`: the code of Phase 2 with the version
number of the pre-release. What came after it on `main` are documents and an update of two development tools. In a clone
you made earlier, run `git fetch origin` first. Git says that the clone is in "detached HEAD" state, which is expected.

The steps below write `orglens` for the command line of the build. Make that work with the two lines for your shell,
in the root of the clone:

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
`sf-orglens/0.1.0-next.2 engine/0.1.0-next.2`, then your Node.js version and system.

I ran the lines for bash, in bash on Linux. I have no Windows machine, so the lines for PowerShell were not run by
me. The folder `orglens-phase2` in your home folder must not exist yet.

## A. The repository and its checks

| #   | Do                                                         | Expect                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `pnpm run check`                                           | It ends with a table of coverage and the exit code `0`. Of 2,614 tests, 2,526 pass and 88 are skipped where I ran it, as the root user, without the public codebases. With them (part F): 2,594 and 20. As another user or on another system the split differs. No test fails. About ten minutes. |
| A2  | `pnpm run check:adr`                                       | `78 decision records checked: 27 plan decisions covered once each.`                                                                                                                                                                                                                               |
| A3  | Open the page **Actions** of the repository, workflow `CI` | The latest run on `main` is green, with jobs for Linux, macOS and Windows on Node.js 24 and 26.                                                                                                                                                                                                   |
| A4  | Open `docs/adr/README.md`                                  | Records 0055 to 0078 are of this phase. 0057 is superseded by 0060. Records 0059 and later each list the choices of their author that are yours to strike.                                                                                                                                        |

## B. A snapshot is analysed

Outcomes 1 and 2. Work on a copy of the fixture project, outside the clone.

In bash, zsh or Git Bash:

```sh
cp -r "$ORGLENS_REPO/fixtures/billing-sfdx" ~/orglens-phase2
cd ~/orglens-phase2
```

In PowerShell:

```powershell
Copy-Item -Recurse "$orglensRepo\fixtures\billing-sfdx" "$HOME\orglens-phase2"
cd "$HOME\orglens-phase2"
```

Then, in either shell:

```sh
orglens init
orglens source add repo --kind git
```

| #   | Do                      | Expect                                                                                                                                                                                                                           |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | `orglens snapshot repo` | `Snapshot #1 of "repo" is complete: 120 components in 124 files (116 KiB).` and the output below.                                                                                                                                |
| B2  | `orglens coverage repo` | The same, with the time the snapshot was taken in the first line.                                                                                                                                                                |
| B3  | `orglens status`        | The database is at `schema version 11`. The line of `repo` ends with `by engine 0.1.0-next.2` in the column `ANALYSED`.                                                                                                          |
| B4  | `orglens analyse repo`  | `Snapshot #1 of "repo" was analysed from the files it holds. It is complete: 120 components in 124 files (116 KiB).` and the same tables. The source is not read: the command also works when the folder `force-app` is renamed. |

The output of B1, below its first line:

```
TYPE                             LISTED  RETRIEVED  ANALYSED
ApexClass                        13      13         0
ApexTrigger                      1       1          0
CustomField                      57      57         57
CustomLabel                      1       1          0
CustomLabels (holds the labels)  1       1          0
CustomMetadata                   4       4          4
CustomObject                     5       5          5
CustomPermission                 1       1          0
EmailFolder                      1       1          0
EmailTemplate                    1       1          1
FieldSet                         1       1          1
Flow                             6       6          61
GlobalValueSet                   1       1          0
QuickAction                      1       1          1
RecordType                       2       2          2
ReportType                       1       1          1
ValidationRule                   11      11         11
Workflow                         2       2          2
WorkflowAlert                    1       1          1
WorkflowFieldUpdate              3       3          3
WorkflowOutboundMessage          1       1          1
WorkflowRule                     4       4          4
WorkflowTask                     1       1          1

SEVERITY  CODE            WHAT
info      COMMIT_UNKNOWN  The snapshot names no commit: the folder is not in a Git repository.

Analysed by engine 0.1.0-next.2: 177 components, 326 references.

ORIGIN          COMPONENTS  REFERENCES  NOT RESOLVED  PATHS NOT FOLLOWED  FILES NOT READ
parser:xml      95          105         0             0                   0
parser:formula  47          114         0             0                   0
parser:flow     61          107         0             1                   0

SEVERITY  CODE               COUNT  THE FIRST
warning   PATH_NOT_FOLLOWED  1      force-app/main/default/flows/Invoice_After_Save.flow-meta.xml, line 104: it is not known which object "Recalculate" holds, so "invoice.Amount__c" after it was not followed.
```

`ANALYSED` of `Flow` is 61 where 6 are listed: the 6 flows and their 55 elements and resources, each a component of its
own. The two files of workflow rules hold 10 rules and actions, which the snapshot lists as types of their own. Only
Apex, the label, the file of labels, the custom permission, the folder of templates and the global value set are not
analysed. The analysis counts 177 components where the snapshot lists 120: the 55 elements and resources of the flows,
and the standard objects `Account` and `User`, of which the project holds fields and no file. The 326 references are the
326 of the answer key that are not of Apex. The one warning is the entry of a flow under `unknowns` in the key: a field
of a record that a subflow gives back, whose object the flow does not say.

## C. Impact answers

Outcomes 3 and 5. Continue in the same folder. The command line has a golden file for four of these answers, C1, C5, C6
and C7, in `packages/cli/test/golden/` of the clone, which a test compares with what the command prints. Your output
must be that file, with the name of your source, `repo`, where the file has `fixture`: in quotes, and after
`orglens coverage`.

| #   | Do                                                                                             | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `orglens impact Invoice__c.Amount__c`                                                          | `impact-amount.txt`: 33 components, 29 of them directly. Besides formulas and rules: 4 flows and 12 of their elements, the field set, the record of the custom metadata type, the email template, the quick action, the report type, a workflow rule of each object, the outbound message, and at depth 2 the alert that sends the template. The second line says that 2 types are not analysed (Apex) and that 1 warning bears on the answer. The exit code is `0`. |
| C2  | Open the file and the line of two results of C1                                                | `Flow:invoice_recalculate#element:set_amount` at line 72 of `flows/Invoice_Recalculate.flow-meta.xml` writes the field: the line is `<assignToReference>invoice.Amount__c</assignToReference>`. `Flow:invoice_after_save#element:recalculate` at depth 2 calls that flow, at line 251 of `Invoice_After_Save.flow-meta.xml`: that is the chain. A flow is listed with the reference of one of its elements, and the element after it.                                |
| C3  | `orglens impact Invoice__c.Tax_Code_Name__c`                                                   | 9 components, 8 of them directly. Among them `WorkflowFieldUpdate:invoice_line__c.stamp_tax_code_of_invoice`, which `writes` the field of the parent invoice from the file of the workflow rules of the line, and at depth 2 the rule that starts it.                                                                                                                                                                                                                |
| C4  | `orglens impact RecordType:Invoice__c.Credit_Note`                                             | 2 components: the flow `Invoice_Review_Screen` and its decision `is_paid_now`, at line 54, at the confidence `probable`. The decision compares `RecordType.DeveloperName` with the text `Credit_Note`: a name in text, not a reference Salesforce checks.                                                                                                                                                                                                            |
| C5  | `orglens impact Invoice_Recalculate`                                                           | `impact-flow.txt`: `It contains 14 components of the snapshot. The answer is about them too.` Then 2 components: the flow `Invoice_After_Save` and its element `recalculate`, which calls it.                                                                                                                                                                                                                                                                        |
| C6  | `orglens impact Invoice_Recalculate.Set_Amount`                                                | `impact-element.txt`: `It is an element of Flow:invoice_recalculate. What refers to the flow refers to it too.` and the same 2 components. The name is the flow and the element with a dot. Case plays no part: `invoice_recalculate.set_amount` gives the same.                                                                                                                                                                                                     |
| C7  | `orglens impact Invoice__c`                                                                    | `impact-object.txt`: `The name also fits Workflow:invoice__c. The answer is about the object. To ask about the other, name it by its key.` Then `It contains 44 components of the snapshot.` and 54 components, 48 of them directly.                                                                                                                                                                                                                                 |
| C8  | `orglens impact Invoice_After_Save --outgoing`                                                 | `It refers to 37 components, to 15 of them directly.` The answer is not complete: the custom label and the custom permission in it are not analysed, 1 warning bears on it, and the snapshot does not hold 9 components of the answer, such as a standard field.                                                                                                                                                                                                     |
| C9  | `orglens impact Invoice_Nope.Set_Amount`                                                       | On the error stream: `error: The snapshot knows no component "Invoice_Nope.Set_Amount".` and a hint. The exit code is `2` (`echo $?`, in PowerShell `$LASTEXITCODE`).                                                                                                                                                                                                                                                                                                |
| C10 | `orglens impact Invoice__c --json`                                                             | Exactly one line of JSON. It starts with `{"schemaVersion":1,"command":"impact","ok":true,` and holds `"sameName":["Workflow:invoice__c"]`, `"analysedBy":"0.1.0-next.2"` and `"complete":false`. For `Invoice_Recalculate.Set_Amount --json` it holds `"elementOf":"Flow:invoice_recalculate"`.                                                                                                                                                                     |
| C11 | Pick three fields of the fixture project that a flow or a workflow rule uses, and ask for each | What you expect from the files. `fixtures/expected/answer-key.v2.yaml` holds every reference, and a test works out the answer for every component from the key alone. This step is your own look at it.                                                                                                                                                                                                                                                              |

In bash you can compare an answer with its golden file in one line, for example for C1:

```sh
diff <(orglens impact Invoice__c.Amount__c) <(sed -e 's/"fixture"/"repo"/' -e 's/coverage fixture/coverage repo/' "$ORGLENS_REPO/packages/cli/test/golden/impact-amount.txt") && echo same
```

The Apex classes of the fixture project do read `Amount__c`. No answer holds them, and every answer says so.

## D. An answer follows the files

Outcomes 1 and 3. Each step changes one or two lines of one flow and takes a new snapshot. Continue in the same
folder. The file is `force-app/main/default/flows/Invoice_Recalculate.flow-meta.xml`. Its line 72 is
`<assignToReference>invoice.Amount__c</assignToReference>`, in the assignment `Set_Amount`, and its line 81 is
`</assignments>`.

| #   | Do                                                                                                                                               | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Change `invoice.Amount__c` in line 72 to `invoice.Unused_Field__c`, then `orglens snapshot repo` and `orglens impact Invoice__c.Unused_Field__c` | Snapshot #2 is complete. The answer has 4 components, 2 of them directly: the flow `Invoice_Recalculate` and its element `set_amount`, which write the field at line 72, and at depth 2 the flow `Invoice_After_Save` and its element `recalculate`, which call the flow. `orglens impact Invoice__c.Amount__c` has 30 components, 27 of them directly, and `orglens impact Invoice__c.Amount__c --snapshot 1` still has 33.                                                                          |
| D2  | Change the same text to `invoce.Amount__c`, a resource the flow does not have, then `orglens snapshot repo`                                      | Snapshot #3 is complete, with 325 references and a second warning: `RESOURCE_NOT_FOUND ... line 72: the element "assignToReference" holds "invoce.Amount__c", and the flow has no resource "invoce". It is not read.` `orglens impact Invoice__c.Amount__c` has 30 components, and its second line says that 2 warnings of the analysis bear on the answer.                                                                                                                                           |
| D3  | Change it back to `invoice.Amount__c`, and change `</assignments>` in line 81 to `</assignment>`, then `orglens snapshot repo`                   | Snapshot #4: `The analysis is incomplete: the errors below say what was not analysed.` and one line `error XML_MALFORMED` for the file: `The end tag of "assignment" stands where "assignments" is open.` The analysis has 163 components and 298 references: the 14 parts of the flow are not analysed. The exit code is `5`. `orglens impact Invoice__c.Amount__c` has 30 components, says that the analysis had 1 error, and ends with `5` too: the answer may miss something of a type it covers. |

The folder can be deleted after this part.

## E. The answer key, read by you

Outcome 6, and the first half of your answer to Q6. I wrote the fixture project, the key and the analysers, so a
blind spot of mine is in all three. Your reading is the one check of the key by a second person. No person has read an
entry of it yet. Run this part in the root of the clone.

| #   | Do                                                                                                                                                                                         | Expect                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Read [fixtures/README.md](../../fixtures/README.md), the sections "The answer key", "What is not keyed", "What is keyed in the files of Phase 2" and "What is marked as stretch"           | They say what an entry holds, what each value of `via` means, and which names give no reference by a rule.                                                                                                                                                                                              |
| E2  | For each of the ten components in the table below, find the line `from: <key>` in `fixtures/expected/answer-key.v2.yaml`, and open its file                                                | The entries below that line hold every name of a field, an object, a flow, a class, a record type, a template or an action that you find in the part of the file the component is, with the right line, kind and target (`line`, `match`, `kind`, `to`). Nothing is in the key that is not in the file. |
| E3  | Read the two entries of flows that the key marks with `stretch: true`, the entry of a flow below the line `unknowns:`, and the entries of the files of Phase 2 below the line `negatives:` | You agree that each of the first is a reference, that the target of the second cannot be known from the file, and that each of the third is none.                                                                                                                                                       |

The ten components of E2, one of each kind, in the folder `fixtures/billing-sfdx/force-app/main/default`:

| #   | Key in the answer key                                           | File                                                     | What it has                                                                                                        |
| --- | --------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | `Flow:invoice_before_save#element:set_defaults`                 | `flows/Invoice_Before_Save.flow-meta.xml`                | Assignments to `$Record` before the save, paths across lookups                                                     |
| 2   | `Flow:invoice_after_save#element:flow-start`                    | `flows/Invoice_After_Save.flow-meta.xml`                 | The start: the object, a condition, a scheduled path on a date                                                     |
| 3   | `Flow:invoice_after_save#element:get_open_lines`                | `flows/Invoice_After_Save.flow-meta.xml`                 | A lookup of records, with a filter, the fields it reads, a sort                                                    |
| 4   | `Flow:invoice_review_screen#element:review`                     | `flows/Invoice_Review_Screen.flow-meta.xml`              | A screen: input fields bound to a record, display text with merge fields                                           |
| 5   | `Flow:invoice_recalculate#element:is_late`                      | `flows/Invoice_Recalculate.flow-meta.xml`                | A formula resource with global variables (`$Setup`, `$Permission`, `$Profile`, `$User`, `$Organization`, `$Label`) |
| 6   | `Flow:invoice_sent_process#element:myrule_1_a1`                 | `flows/Invoice_Sent_Process.flow-meta.xml`               | An action of a process of the Process Builder                                                                      |
| 7   | `WorkflowRule:invoice__c.remind_when_sent`                      | `workflows/Invoice__c.workflow-meta.xml`                 | A rule with criteria, actions and a time trigger                                                                   |
| 8   | `WorkflowFieldUpdate:invoice_line__c.stamp_tax_code_of_invoice` | `workflows/Invoice_Line__c.workflow-meta.xml`            | A field update that writes a field of the parent record                                                            |
| 9   | `CustomMetadata:billing_rule.invoice_amount`                    | `customMetadata/Billing_Rule.Invoice_Amount.md-meta.xml` | A record of a custom metadata type that names an object and a field in its values                                  |
| 10  | `QuickAction:invoice__c.new_line`                               | `quickActions/Invoice__c.New_Line.quickAction-meta.xml`  | A quick action: what it creates, sets and shows                                                                    |

Component 10 matters more than its place in the list suggests: its entries were written in the pull request of its
analyser, not before it, like those of the report type.

A name you find and the key lacks, or a reference of the key you do not agree with, is a finding. The key is not
changed to make an analyser pass, so a finding changes the key first and the analyser after it.

## F. The public codebases

Outcome 6. Run this part in the root of the clone: `cd "$ORGLENS_REPO"` in bash, `cd $orglensRepo` in PowerShell.

| #   | Do                                                                                                                                                                         | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | `pnpm run corpora:fetch`                                                                                                                                                   | Eight codebases are downloaded into `.corpora`, each at the commit `fixtures/corpora.toml` names: Apex Recipes, Nebula Logger, NPSP, PMM, Volunteers for Salesforce, Outbound Funds, Coral Cloud and EDA.                                                                                                                                                                                                                                                                            |
| F2  | `pnpm exec vitest run packages/engine/test/extraction-corpora-checked.test.ts`                                                                                             | 18 tests pass, and none is skipped. They hold the counts and the digest of what I checked by hand: when the analysis reports something else for an entry, a test fails.                                                                                                                                                                                                                                                                                                              |
| F3  | `pnpm run corpora:listing coral-cloud > coral-cloud.txt` and `pnpm run corpora:listing nebula-logger > nebula-logger.txt`                                                  | On the error stream, among the counts, a line `coral-cloud, flows and configuration: 95 entries` and one `nebula-logger, flows and configuration: 53 entries`, each with a time and a digest. Each file has, after the formulas of Phase 1, a part headed `flows and configuration`: every flow, then every element of it, each with its values, its references and its issues. Delete the files afterwards: they hold text of the codebases, which is not stored in the repository. |
| F4  | Read the five flows of the table below: open the file of the flow in `.corpora`, and find its entries in the listing by `## flow` and `## element` and the key of the flow | For every element, every name of a field, an object, a flow or a class in its values has a reference, with the right target and kind (`reads`, `writes`, `calls`, `references`, `triggers-on`), and no reference is there for a name that is not in the element. Two of the five have a name the analysis misses, named below.                                                                                                                                                       |
| F5  | `pnpm run bench:corpora coral-cloud --runs 3`                                                                                                                              | A table of times for `snapshot`, `analyse`, `coverage` and `impact` on Coral Cloud. Your times are yours: I ask for no number here.                                                                                                                                                                                                                                                                                                                                                  |

The five flows of F4. The paths are below `.corpora` in the clone.

| #   | Flow                                         | File                                                                                                                  | Kind                               | Elements |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| 1   | `Flow:create_booking`                        | `coral-cloud/cc-base-app/main/default/flows/Create_Booking.flow-meta.xml`                                             | Without a screen, called by others | 10       |
| 2   | `Flow:issue_resort_credit`                   | `coral-cloud/cc-base-app/main/default/flows/Issue_Resort_Credit.flow-meta.xml`                                        | Without a screen, called by others | 5        |
| 3   | `Flow:account_record_launched_flow_example`  | `nebula-logger/nebula-logger/recipes/flows/Account_Record_Launched_Flow_Example.flow-meta.xml`                        | Started after a record is saved    | 2        |
| 4   | `Flow:account_process_logger_example`        | `nebula-logger/nebula-logger/recipes/flows/Account_Process_Logger_Example.flow-meta.xml`                              | A process of the Process Builder   | 9        |
| 5   | `Flow:logentryhandler_screen_tests_for_flow` | `nebula-logger/nebula-logger/extra-tests/integration-tests/flows/LogEntryHandler_Screen_Tests_for_Flow.flow-meta.xml` | A screen flow                      | 5        |

Flows 3 and 5 each have an action that hands records to a generic Apex action and names their object in
`<dataTypeMappings>` (`Account` and `User`). The analysis gives no reference for that name and no warning: two of the
seven missed names of the [note](../research/phase-2/public-codebases.md). If you find another, it is a finding. The
note also names the rules by which a name gives no reference, such as the component of a screen and the object a
variable declares.

[public-codebases.md](../research/phase-2/public-codebases.md) has the numbers of the check and what it does not
show. F4 matters more than its five flows suggest: no person has read an entry yet. A flow is where I am most likely
to misread what Salesforce does, because I can deploy one and cannot run one.

## G. The test org

Outcome 6. The workflow "Live org" logs in to the test org with the secrets you stored. Its log is public. You start
its runs. The last run of the phase is [run 30](https://github.com/taouani/sf-orglens/actions/runs/45695912416), of 25
November 2026, which read the org after run 29 had deployed the project of 120 components.

| #   | Do                                                                                                                                  | Expect                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Open the log of run 30, the step that reads the org                                                                                 | The snapshot is partial, and the step ends with a warning for it: `NOT_RETRIEVED` is an error for 6 components of the org of the types `CustomField`, `CustomObject` and `RecordType`, the same six as in Phase 1. None is of the fixture project.        |
| G2  | In the same step, the lines about the cross-check                                                                                   | The Dependency API reports 391 rows. 136 are compared, as many pairs: the analysis has 133, has 3 through a part of the object, and missed none. 54 rows are of a version of a flow that the snapshot does not hold. No warning `FLOW_VERSIONS_NOT_READ`. |
| G3  | In the same step, the reading in parts                                                                                              | With every answer cut off at 30 rows, 84 requests give the same 391 rows, and the reading is whole.                                                                                                                                                       |
| G4  | Search the whole log for the address of the org, its id, the user name and a name of a component that is not of the fixture project | None is there. You are the only one who knows the first three, so only you can do this check.                                                                                                                                                             |

[real-org.md](../research/phase-2/real-org.md) holds the numbers of every run of the phase.

## H. An org you know

Outcome 6. **This is the check that has not been done.** The engine read the test org through a tool of the tests,
and the test org holds 7 flows, 6 of them of the fixture project. No impact question of this phase was asked about a
snapshot of an org. An org you know shows what neither can: whether the answers hold for fields whose uses in flows
you know, on flows that neither of us wrote, and whether the corrections from your snapshot of 23 November 2026
hold.

**If the org is a client's, the client's permission comes first.** The snapshot stores the metadata files of the org
in `.orglens/orglens.db` on your machine and nowhere else. OrgLens reads metadata only and writes nothing to the
org. For the cross-check it asks three objects of the Tooling API: `MetadataComponentDependency`, `FlowDefinition`,
which names the active and the latest version of each flow, and `Flow`, which names every version of a flow. Work in
a new folder outside any repository, and delete the folder afterwards if the org is not yours to keep a copy of.

Use the build of this plan, or the version you install in part I: both are the same code. A workspace that an earlier
version made is migrated by the first command that writes to it, and then an earlier version refuses it: start in a
new folder.

You need a login of the Salesforce CLI for the org (`sf org login web --alias my-org`). Then, in a new folder, with
the alias of your login in place of `my-org`:

```sh
orglens init
orglens source add prod --kind org
orglens source link prod my-org
orglens source check prod
```

| #   | Do                                                                                                                                             | Expect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | Note the time, then `orglens snapshot prod`                                                                                                    | Lines of progress on the error stream, for the retrieves and the rows of the Dependency API, and for the versions of the flows where a flow has a version newer than its active one. Then the table per type, with `Flow`, `Workflow` and its parts, `RecordType`, `FieldSet`, `CustomMetadata`, `EmailTemplate`, `ReportType` and `QuickAction` analysed, a column `OF PACKAGES` where the org has managed packages, the issues, the analysis and the cross-check.                                                                              |
| H2  | Read the issues of H1 against what your run of 23 November 2026 showed                                                                         | What should be gone: an error `NOT_RETRIEVED` for the record type of person accounts, for a component of a managed package that the org never hands out (now a warning with `ofPackages`), and a warning for each document and each report or dashboard in a folder inside a folder. One line for all the files of a type the Salesforce library cannot read, not one per file. For each `NOT_RETRIEVED` that is still an error: is it a component you know, and can you see why Salesforce does not hand it out?                                |
| H3  | `orglens coverage prod`, the lines of the cross-check at the end                                                                               | `Cross-check: the Dependency API of Salesforce reports N rows.` and whether an answer shows that a row is missing. Then how many rows are not compared, and why, also those of a version of a flow the snapshot does not hold, and the line that counts: `N rows were compared. They are N pairs of components: the analysis has N of them, has N as a reference to a part of the object Salesforce names, and missed N.` **Missed must be 0.** A missed pair is listed with both components, and is an error of the analysis I have to correct. |
| H4  | Pick five fields whose uses in flows and workflow rules you know. For each: `orglens impact <Object.Field__c>`                                 | Every flow, field update, workflow rule, field set, quick action and email template you know of that reads or writes the field is in the answer, each flow with the element that names it and the line of the file. Nothing is in it that does not name the field. Uses in Apex, layouts or reports are not in the answer, and its first lines say so.                                                                                                                                                                                           |
| H5  | Pick a flow you know. `orglens impact Flow:<Its_Name>`, then `orglens impact Flow:<Its_Name> --outgoing`                                       | The first answer names what calls the flow: other flows and their elements, and processes. The second names what its elements read, write and call. **Write `Flow:` before the name:** without it, the name fits the flow and its definition, which the org lists under the same name, and the command ends with `COMPONENT_AMBIGUOUS` and the exit code `2`. That is not corrected in this version.                                                                                                                                             |
| H6  | Pick an element of that flow: `orglens impact <Its_Name>.<Element_Name>`                                                                       | `It is an element of Flow:...` and what calls the flow, as in C6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| H7  | Only if the org has managed packages: ask for a field of yours that a flow of a package uses, then the same with `--packages`                  | The first answer says how many components of managed packages refer to it and are left out. With `--packages` they are in the answer. `orglens coverage prod` counts the components of packages per type.                                                                                                                                                                                                                                                                                                                                        |
| H8  | Only if a flow of the org has a draft newer than its active version: look for `FLOW_NEWER_VERSION` in H1, and ask about a field that flow uses | The note names the flow. The answer is about the active version, and names the flow below the results: `has a version newer than its active version`.                                                                                                                                                                                                                                                                                                                                                                                            |
| H9  | `orglens impact Account`, or another object with workflow rules                                                                                | A line `The name also fits ...` that names `Workflow:account`, maybe with other components of that name, such as rules of sharing or matching. The answer is about the object.                                                                                                                                                                                                                                                                                                                                                                   |

**Two numbers I ask for, if you are free to tell them:** how long the first snapshot took (H1), and how many requests
the cross-check sent, which `orglens coverage prod --json` holds in `crossCheck.requests`. The second is the number
[issue 79](https://github.com/taouani/sf-orglens/issues/79) waits for. If the org is a client's, they stay with you
unless the client agrees. They are not written into the repository either way.

**What these outputs hold, and where they must not go.** The outputs of H1 to H9 hold names of components of the org.
The repository is public and its data rules allow none of this in an issue, a pull request or a commit. If the org is
a client's, it does not belong in a chat either. To report a finding, give the number of the step, the error or issue
code, the metadata type, the kind of the element or of the reference, and the counts. For a missed or a wrong
reference, the shape of the element with the names replaced is enough for me to build a case of it in the fixture
project.

## I. The pre-release

Version `0.1.0-next.2` was published on 26 November 2026, on your word, by the workflow "Pre-release" and with your
approval of its job (records 0050 and 0053).

| #   | Do                                                                                                                                        | Expect                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Open the [releases](https://github.com/taouani/sf-orglens/releases) of the repository                                                     | `OrgLens 0.1.0-next.2 (pre-release)` above the two earlier ones, marked as a pre-release, with three files: two `.tgz` and `SHA256SUMS`.                                                                                                                   |
| I2  | In a terminal without the shell function of this plan, where `0.1.0-next.1` is installed: `npm update --global`, then `orglens --version` | `sf-orglens/0.1.0-next.2 engine/0.1.0-next.2`. Without an earlier install: `npm install --global sf-orglens@0.1.0-next.2`.                                                                                                                                 |
| I3  | `orglens doctor` in any folder that is no workspace                                                                                       | The checks `node`, `sqlite` and `git` are `ok`. The check `workspace` is `skipped`. The last line is `OrgLens can run here.`                                                                                                                               |
| I4  | `orglens --help`, then `orglens impact --help`                                                                                            | The commands of `docs/cli.md`, and for `impact` the option `--packages`. The note at the end of the help of this version names objects, fields, validation rules and flows only: the report lists that as not done, and the next version names every type. |

I2 updates every global package of your machine. To leave it out, use the install line of the release notes.
**Do not run `npx orglens`.** The name `orglens` is the command, not a package of this project, and npx fetches
whatever package has that name.

## What this plan cannot show

- That the answers are right on an org of thousands of components, with many flows. Part H shows it for the fields
  and flows you pick.
- That nothing is missed where Salesforce confirms nothing: standard fields, workflow rules, record types, report
  types, the values of records of custom metadata types, and names in text. For those the answer key, the public
  codebases and your own knowledge of an org are the only measure.
- How long a first snapshot of an org of 100,000 components takes, and whether flows make it longer.
- Anything about Apex, Lightning components, layouts, Lightning pages, reports and permissions. They are stored and
  not analysed.
- A sandbox, an org with a namespace of its own, and an edition other than the ones you run it on.
- Memory. It was measured nowhere in this phase.
- Windows and macOS by hand. CI runs the tests there, and I ran nothing there myself.

## What I ask you to decide

1. Whether the phase is accepted, after this plan.
2. Whether `0.1.0-next.2` is published. Done: you said so on 25 November 2026, and it is published.
3. Whether the reader of flows reads the two kinds of names it misses (`overriddenFlow` and `dataTypeMappings`), and
   whether the warning for `Id` at the end of a path goes. Done: you chose both with the Phase 3 plan on 26
   November 2026.
4. How you count the 100,000 components of your performance targets (record 0037). Asked on 15 November 2026.
5. The draft of the Phase 3 plan and its questions. Done: you approved it on 26 November 2026.
