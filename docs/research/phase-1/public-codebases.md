# public-codebases

What the analysis of Phase 1 reports for the public codebases of `fixtures/corpora.toml`, held entry by entry
against their files, and how long the commands take on them. Recorded on 17 November 2026 (work package 10 of the
[Phase 1 plan](../../plans/phase-1.md)), with the code of the pull request that holds this note and the codebases
at the commits the manifest pins.

## In short

- **368 entries were held against what OrgLens reports**: every formula field (89), validation rule (20),
  default value (240), lookup filter (4) and roll-up summary (15) of PMM, NPSP, Nebula Logger and Apex Recipes.
  The 133 that can hold a name were read one by one with their references. The 235 default values that are a
  literal were read as a list of values. `[read]`
- OrgLens reports 616 references for them. **None is wrong.** All 616 are at the tier `confirmed`. `[read]`
- **Four references are missed.** They stand in one formula of NPSP, behind a lookup of another package, and
  the analysis names each of them with a warning. Nothing was corrected, and the cause is below. `[read]`
- Some names give no reference on purpose, by rules of decision records
  [0041](../../adr/0041-components-and-names-written-in-xml.md) and
  [0042](../../adr/0042-the-names-in-a-formula.md). They are listed below, so that the maintainer can strike
  the rules.
- The fourth pass mark of the phase holds: no wrong reference at the tier `confirmed`, and every missed one is
  named with its cause.
- **The check was made by the author of the analyser**, which is the assistant that builds OrgLens with the
  maintainer. The sub-agent that reviewed the pull request read the 133 entries again and held every reference
  against the files with scripts of its own. It found the same four and nothing else. It is a second reader of
  the same kind as the first, and no person read an entry. The plan names that weakness.
- A first snapshot of the largest codebase, NPSP with 11,722 components, takes 3.5 to 3.9 seconds as a command,
  and an impact question 0.1 to 0.2 seconds. On a made-up source of 100,216 components the snapshot takes 18.4
  to 19.7 seconds and an impact question 0.1 to 0.2 seconds. `[run]` These are repositories on a disk. **No
  org was measured**, and the time of a snapshot of an org is the time Salesforce takes to hand out the files.

## Conditions

- The four codebases of `fixtures/corpora.toml`, each at its pinned commit, in the package folders the manifest
  names. PMM, the Program Management Module of Salesforce.org, was added with this work package for its
  validation rules and lookup filters. Its licence is BSD-3-Clause, as its repository states it.
- Nothing of the codebases is in this repository. The names of their fields in this note are names, not content.
- The analysis of Phase 1 reads objects, fields and validation rules. Apex, flows, layouts and the other types
  have a row each and no reference yet, so nothing here says anything about them.
- One machine for the times: Linux x64, a 4-core virtual machine, warm file cache, Node.js v24.22.3. Windows and
  macOS were not measured.

## The entries

An entry is one text that can hold a name: a `<formula>`, an `<errorConditionFormula>`, a `<defaultValue>`, a
`<lookupFilter>`, or the elements of a roll-up summary. `pnpm run corpora:listing` cuts them out of the files as
text, without the reader of the engine, and prints each with the references and the issues the analysis reports
for its component.

| Entries | PMM | NPSP | Nebula Logger | Apex Recipes | All |
| --- | --- | --- | --- | --- | --- |
| Formula fields | 15 | 13 | 61 | 0 | 89 |
| Validation rules | 13 | 3 | 4 | 0 | 20 |
| Default values | 10 | 152 | 77 | 1 | 240 |
| Lookup filters | 2 | 2 | 0 | 0 | 4 |
| Roll-up summaries | 0 | 3 | 12 | 0 | 15 |
| All | 40 | 173 | 154 | 1 | 368 |
| References of the entries | 137 | 69 | 410 | 0 | 616 |

- The plan named 89 formula fields and 20 rules in PMM, NPSP and Nebula Logger. The counts are the same.
- **235 of the 240 default values are a literal**: `false` (147), `true` (30), a number (45) or a text in
  quotes (13). A literal holds no name that the formula language reads, and none has a reference.
- **Two of the texts hold names of fields, as text**: the default values of
  `Data_Import_Settings__c.Donation_Matching_Rule__c` and `DataImportBatch__c.Donation_Matching_Rule__c` of
  NPSP are a list of field names in quotes. Code may read such a text when it runs. It is no reference, and an
  impact answer does not see it.
- The five that are not a literal are calls without a name: `NOW()`, `TODAY()` and a sum with `NOW()` in PMM,
  `now()` and `Today()` in NPSP. None has a reference, which is right.
- Apex Recipes was not in the plan. Its one entry, a default value `true`, was read with the others.

## What the analysis reports

For the whole of each codebase, not only for the entries. `[run]` `pnpm run corpora:listing` prints these numbers
to the error output, and `extraction-corpora.test.ts` holds the components and the references by `via`. One
number differs, the components of PMM, and a point below says why.

| | PMM | NPSP | Nebula Logger | Apex Recipes |
| --- | --- | --- | --- | --- |
| Components | 1,666 | 11,722 | 894 | 255 |
| Analysed: objects, fields and rules | 129 | 819 | 622 | 44 |
| Of them with a formula, a default value or a condition | 38 | 168 | 142 | 1 |
| **References** | **164** | **155** | **436** | **9** |
| via `formula` | 133 | 58 | 387 | 0 |
| via `lookup` | 26 | 77 | 17 | 8 |
| via `filter` | 4 | 7 | 7 | 0 |
| via `summary` | 0 | 4 | 16 | 0 |
| via `controlling-field` | 1 | 5 | 3 | 1 |
| via `display-field` | 0 | 2 | 4 | 0 |
| via `value-set` | 0 | 2 | 2 | 0 |
| Kind `reads` | 137 | 62 | 398 | 0 |
| Kind `references` | 27 | 93 | 38 | 9 |
| To a field | 138 | 72 | 417 | 1 |
| To an object | 26 | 77 | 17 | 8 |
| To a custom label | 0 | 4 | 0 | 0 |
| To a global value set | 0 | 2 | 2 | 0 |
| Resolution `resolved` | 148 | 83 | 410 | 6 |
| Resolution `external` | 16 | 72 | 26 | 3 |
| **Names not resolved** (`unresolved`) | **0** | **0** | **0** | **0** |
| **Paths not followed** (`PATH_NOT_FOLLOWED`) | **0** | **4** | **0** | **0** |
| Tier `confirmed` | 164 | 155 | 436 | 9 |
| Tier `probable` or `possible` | 0 | 0 | 0 | 0 |
| Files the reader refused, formulas not read as a whole | 0 | 0 | 0 | 0 |

- `external` is a target that no file of the codebase defines: a standard field such as `Contact.FirstName`, or
  a field or an object of a package the codebase builds on. NPSP builds on other packages, which is why nearly
  half of its references are external.
- The conditions of a roll-up summary are reported with `via` `filter`, as those of a lookup filter. Nebula
  Logger has no lookup filter: its seven are conditions of summaries.
- The 148 references that are not of an entry are lookups (128), controlling fields (10), display fields (6)
  and value sets (4). Each is one name in an element of its own. They were not read one by one, and the plan
  did not ask for it.
- PMM has 1,666 components in a snapshot. `extraction-corpora.test.ts` and the listing count 1,667, because
  they read the folders without `.forceignore`: the folder `lwc/__tests__` holds data of tests, the file leaves
  it out, and the source library takes it for a component when it is there.
- Seven metadata files of PMM have CRLF line ends: five validation rules and two formula fields. Two of the
  rules have them on every line, the other five files on the lines of the formula only. They are the first of
  the public codebases that have ([xml-readers.md](xml-readers.md) counted none in the other three), and the
  reader of the engine and `fast-xml-parser` read each to the same content.

## The check

**How.** The listing of each codebase was printed and read from the first entry to the last. For every entry
the text was read, and the names in it were held against the lines of references below it: is every name
there, does every line name the right target, is the kind right, is the place the place of the name. Four
references carry the value a picklist is compared with, and each is the value of the text. For a name behind
a relationship (`Program__r.Name`), the lookup field was opened in PMM and in NPSP to see where it leads. The
listings are not kept, because they hold the text of the codebases.

**What the listing can hide.** It shows a reference under an entry of its file when the `via` of the reference
fits the kind of the entry. A reference with another `via` would not be shown, and a file with two entries
would show its references under both. Neither happens in these codebases: every file has one entry, and the
616 references are all references of the whole analysis with the `via` `formula`, `filter` or `summary`. The
test that holds the check asserts both.

**Two more checks, by scripts.** Neither script is in the repository, so neither can be repeated from it.
`[run]`

- For each of the 616 references, the first looked for the file of the target in the codebase, without the
  engine: a field file, or the entry of a label in the file of labels. Every `resolved` target has one, and no
  `external` target has one.
- For each relationship name in a formula, the second read `<referenceTo>` in the file of the lookup and
  held it against the object of the name that follows in the listing. There are 25 such lookups in the three
  codebases, counted by the field that holds them. 22 have a file, and the analysis went where the file says.
  The other three are the standard relationship `Account` of a contact, `Owner` with `Id` behind it, and the
  lookup of the missed references below.

**Wrong references: 0.** No reference names a target the text does not name, none has the wrong kind, and none
stands at a place where the name is not written.

**Missed references: 4.** All four are in the formula of `Opportunity.Recurring_Donation_Installment_Name__c`
of NPSP:

| # | Line | Written | What is missed |
| --- | --- | --- | --- |
| 1 | 10 | `npe03__Recurring_Donation__r.npe03__Open_Ended_Status__c` | the field `npe03__Open_Ended_Status__c` of the object behind the lookup |
| 2 | 10 | the same, a second time | the same field |
| 3 | 10 | `npe03__Recurring_Donation__r.npe03__Installments__c` | the field `npe03__Installments__c` of that object |
| 4 | 12 | the same | the same field |

- **Cause.** The lookup `Opportunity.npe03__Recurring_Donation__c` is a field of another package, and NPSP holds
  no file of it. So no file of the codebase says which object it leads to, and a field cannot be given a key
  without its object.
- **What OrgLens does.** It reports the lookup field itself, as `external`, at each of the four places of the
  relationship name, and once more where the formula names the field. For each of the four names behind it, it
  writes the warning `PATH_NOT_FOLLOWED` with the line and the name. `coverage` counts them, and an impact
  answer on this snapshot is not `complete`.
- **What was done about it: nothing, on purpose.** A person can guess from the name that the lookup leads to
  `npe03__Recurring_Donation__c`. The analysis does not guess (decision record
  [0041](../../adr/0041-components-and-names-written-in-xml.md)). A snapshot of an org with that package
  holds the file of the lookup, and the path is followed there. That is not verified: no such org was read.

**Names that give no reference, on purpose.** The text holds them and the analysis reports nothing for them,
by a rule. They are no misses by the rules as they stand. They are listed because a rule of the author is the
maintainer's to strike.

| Codebase | Where | Name | Rule |
| --- | --- | --- | --- |
| PMM | `ProgramEngagement__c.CurrentUserOwner__c` | `$User.Id` | `Id` at the end of a path gives no reference (record 0042, point 8) |
| PMM | the same | `Id` in `Owner:User.Id` | the same. The relationship `Owner` is reported, as the field `OwnerId` |
| PMM | the same | `User` in `Owner:User` | the object after the colon says where the relationship leads and is no reference (record 0042, point 10) |
| Nebula Logger | `Log__c.WasLoggedByCurrentUser__c` | `$User.Id` | `Id` at the end of a path |
| NPSP | `Contact.Primary_Contact__c` | `Id` | the same |
| NPSP | `Account.Membership_Status__c` | `npo02__Households_Settings__c` in `$Setup`, twice | the field behind `$Setup` is reported, twice, and the custom setting is not (record 0042, point 12) |
| PMM, NPSP, Nebula Logger | lookup filters and roll-up summaries | the object at the start of a path, such as `Program__c` in `Program__c.Status__c`: 2, 8 and 23 times | the first name of a path in XML is no reference, and the field after it is (record 0041, point 9) |
| PMM, NPSP | lookup filters | `$Source`, 2 and 3 times | the same |

**What the check does not show.**

- It was made by the author of the analyser, by reading, once. A name the reader overlooked in a text is
  overlooked in the analysis as easily: the same head wrote both. The listing guards against one kind of
  that, because it cuts the texts out of the files without the reader of the engine.
- The public formulas are easy. Thirteen names stand behind a `$`: `$Label` four times, `$Setup` twice,
  `$User.Id` twice, and `$Source` five times in lookup filters. One formula has `Owner:User`.
  None has a comment or a `VLOOKUP`. The fixture project covers what is not here, and Salesforce accepted it.
- Whether Salesforce agrees was not asked: the codebases are in no org. The Dependency API on the test org is
  the proof for that, for the fixture project only.
- The 235 literal default values were read as a list of values, not file by file.
- The package folders hold 19 formulas that are no entry: 11 in quick actions of PMM, 5 in quick actions of
  NPSP and 3 in a workflow of NPSP. Phase 1 does not analyse those types, so nothing was reported for them
  and nothing was checked.

## How the check is held

`extraction-corpora-checked.test.ts` holds, for each codebase, the count of entries by kind, of literals, of
references and of paths not followed, and the SHA-256 of the whole listing as it was read. When the analysis
reports another reference, another place, another tier or another issue for an entry, the digest moves and the
test fails. The test then asks for a new check by hand of what moved: the listing is printed at the commit
that recorded the digest and at the new one, and the two are compared. The listing does not print the origin
of a reference, so the digest does not hold it. Like the other tests on the public codebases it is skipped
where the codebases are not downloaded, so CI does not run it.

| Codebase | SHA-256 of the listing that was read |
| --- | --- |
| apex-recipes | `763dead7e0066c9d934944ead168752206d7225da9e75e4e33bee68be1c5566f` |
| nebula-logger | `4365fb5061f0f6582ec6e162a0d4d76f2c45d4475b61463289e645f4439ee373` |
| npsp | `2112d75d80f796b71722c9a82555c7b2b7a95521915eafe6a8c5c917607bc6a2` |
| pmm | `ac9d3f04b93df69ca952ef7b86799722d704482e809a9286a7e99ebf8d42eadc` |

## The times

`pnpm run bench:corpora npsp nebula-logger pmm apex-recipes --runs 5 --copies 98`
([`bench/corpora.mjs`](../../../bench/README.md)). Each time is that of a whole command of the built command
line: a new process, with the start of Node.js, the opening of the database and the printing. Every run has a
new workspace, so every snapshot is a first snapshot. The table gives the least and the most of five runs, in
seconds. It is of the run made after the review of the pull request, when the made-up source had become a
repository. The run before it gave the same counts for the four codebases and times within 0.4 seconds of
these. `[run]`

| | Apex Recipes | Nebula Logger | PMM | NPSP | Made-up source |
| --- | --- | --- | --- | --- | --- |
| Files in the snapshot | 506 | 1,021 | 1,719 | 12,056 | 99,080 |
| Size of the files | 1.5 MB | 3.5 MB | 2.3 MB | 31.3 MB | 104.4 MB |
| Components | 255 | 894 | 1,666 | 11,722 | 100,216 |
| Analysed components | 44 | 622 | 129 | 819 | 81,081 |
| References | 9 | 436 | 164 | 155 | 15,345 |
| Database after the snapshot | 0.9 MB | 1.7 MB | 2.1 MB | 19.6 MB | 84.3 MB |
| `snapshot`, with its analysis | 0.63 to 0.72 | 0.81 to 0.99 | 0.94 to 1.18 | 3.51 to 3.87 | 18.42 to 19.69 |
| `analyse`, the analysis again | 0.51 to 0.63 | 0.63 to 0.79 | 0.70 to 0.79 | 1.72 to 1.85 | 10.34 to 10.92 |
| `coverage` | 0.09 to 0.14 | 0.09 to 0.11 | 0.09 to 0.13 | 0.10 to 0.12 | 0.11 to 0.17 |
| `impact`, the field most refer to | 0.09 to 0.13 | 0.09 to 0.11 | 0.10 to 0.13 | 0.09 to 0.14 | 0.12 to 0.15 |
| the same with `--json` | 0.09 to 0.14 | 0.09 to 0.16 | 0.09 to 0.15 | 0.10 to 0.14 | 0.12 to 0.17 |
| `impact`, a field one component refers to | 0.09 to 0.14 | 0.09 to 0.12 | 0.09 to 0.13 | 0.10 to 0.15 | 0.13 to 0.13 |
| Results of the first impact question | 1 | 25 | 5 | 3 | 297 |

**The time of the analysis alone** (`analyseSource`, as `pnpm run corpora:listing` prints it, each codebase in
a process of its own, five runs): 24 to 32 ms for Apex Recipes, 69 to 94 ms for Nebula Logger, 51 to 58 ms for
PMM and 238 to 367 ms for NPSP. `[run]` The process, the listing of the folders and the database are not in
it. The reading of the contents of the files is, because a tree reads a file when it is asked for it. A good
part of the smaller times is code that runs for the first time: when the four are analysed one after the
other in one process, PMM takes 27 to 43 ms and Nebula Logger 54 to 62.

- **A command that reads no file takes a tenth of a second or a little more, at every size.** Most of that is
  the start of the process: the start-up check of the repository measures it apart.
- **The first snapshot of NPSP takes 3.5 to 3.9 seconds.** `analyse` takes half of that, for the same
  analysis: it reads the files of the snapshot out of the database and writes the components again.
- **The field most components refer to** was found by asking `impact` for every field of the codebase, up to
  1,000 of them. In Apex Recipes no field has more than one result, so both questions are the same one.
- The status of work package 6 gave 1,579 files for Nebula Logger. A snapshot of the folder the manifest names
  holds 1,021, and 52 more are left out by `.forceignore`. Where 1,579 came from was not found.

**The made-up source.** It is NPSP with every one of its 66 object folders copied 98 times under another name,
in a package folder of its own. It is a Git repository with one commit, with the project file and the
`.forceignore` of NPSP, so that it is read the way NPSP is. A copy keeps its files as they are, so a lookup of
a copy leads to the object it led to before, and a formula of a copy names the fields of the copy. It stands
for a repository with very many objects and fields. **Nothing of it is real, and it is unlike an org in five
ways**:

- 81 percent of its components are objects, fields and rules, which are the types Phase 1 analyses. In NPSP
  itself they are 7 percent. So the analysis of Phase 1 has more to do here than on a real source of this
  size. The Apex, the flows and the other types, which later phases analyse, are in it once, as in NPSP.
- It has 15,345 references. The synthetic org of the storage benchmark has 1.2 million at about three times
  the components ([store-benchmark.md](store-benchmark.md)), and an impact question from its hub field has
  more than 100,000 results where this one has 297. That note has the times for such a question: 2.2 to 2.8
  seconds, without the start of the process and the printing.
- Its files are small: 104 MB for 100,216 components, where NPSP has 31 MB for 11,722. A real source of this
  size has more Apex, flows and layouts, and those files are larger. By how much was not measured.
- Every reference of NPSP starts in a file of an object folder, so every copy has all 155 of them, and the
  source has 99 times the references of NPSP. Some cannot exist in an org: the copy of a standard object, such
  as `Contact_1__c`, keeps formulas that name standard fields the copy cannot have, and the analysis reports
  those as `external`.
- It is a repository on a disk. A snapshot of an org spends its time waiting for Salesforce.

**Against the targets** (decision record [0037](../../adr/0037-performance-targets.md): for an org of 100,000
components, a first snapshot under 60 minutes and an impact query under 5 seconds). 100,216 components is that
size when a component is counted as a snapshot counts it, with fields. How the maintainer counts is still open.
An impact question takes under 0.2 seconds here, with the limits just named. The 18 to 20 seconds of the
snapshot say this much: reading and storing 100,000 small files and analysing them as Phase 1 does is far
from 60 minutes. They say nothing about the analysis of Apex and flows, which is not built, nor about the
time Salesforce takes. They do not show that 60 minutes can be met: that needs an org.

## Not measured, and not verified

- **Memory.** No run recorded it. One look at the process list during the snapshot of the made-up source showed
  about 700 MB resident, which is a look and not a measurement.
- **An org.** Neither the time of a snapshot of a large org nor the requests of its cross-check: the public
  codebases are in no org. Both need an org of the maintainer.
- **Windows and macOS.** All times are from one Linux machine.
- **A later snapshot.** Every snapshot here is the first of its workspace.
- **The references that are not of an entry** (lookups, controlling fields, display fields, value sets) were
  not read one by one.
- **A person as reader.** The author of the analyser and the sub-agent of the review read the entries. No
  person did.
