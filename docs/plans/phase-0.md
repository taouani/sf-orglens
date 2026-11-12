# Phase 0 plan: Foundations

Status: **approved by the maintainer on 2026-11-11**. The answers to the questions in section 4 are recorded there.
Date: 2026-11-11
Parent document: [OrgLens re-architecture plan](re-architecture-plan.md) (27 decisions, roadmap phases 0 to 6)

This plan is written by the AI assistant that builds the project, addressed to the maintainer. "I" is the
assistant and "you" is the maintainer.

## 1. Outcome

At the end of Phase 0 there is a new public repository in which:

1. `orglens init`, `source add|list|remove`, `status`, `doctor`, `snapshot` and `coverage` work on Linux, macOS and Windows.
2. `orglens snapshot` retrieves a real Salesforce org in source format, in chunks, can resume after an interruption, and stores the result as an immutable snapshot in one SQLite file. No parsing yet.
3. A fixture Salesforce project with a hand-written answer key exists and is checked by CI.
4. The Apex analysis foundation has been chosen by a measured trial and recorded.
5. We know, from measurements on a real org, what Salesforce's Dependency API and compiler symbol data can and cannot be used for.
6. Every decision so far is written down as a decision record, and the plans live in git.

Phase 0 does **not** parse metadata, build references or answer impact questions. That starts in Phase 1.

## 2. What the research changed

Before writing this plan I had six research agents install and exercise the libraries. Raw notes are in [`docs/research/phase-0/`](../research/phase-0/). Six findings change earlier assumptions. All were verified hands-on unless marked.

| #   | Finding                                                                                                                                                                                                                                                                                                                                           | Consequence                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The npm package `@apexdevtools/apex-ls` is not the semantic analyser. It exposes one lookup function. The real analyser runs only on Java.                                                                                                                                                                                                        | It is dropped as a runtime candidate (decision S3). It can still serve as an optional development-time checker.                                                                                                                         |
| 2   | None of the candidates produces method-to-field read/write references. `apex-parser` and `tree-sitter-sfapex` are syntax parsers only.                                                                                                                                                                                                            | OrgLens must own the type resolver whichever parser wins. The trial now chooses the parser underneath, and proves the resolver is feasible. A 79-line spike scored 41 of 43 on a small self-written test, which shows feasibility only. |
| 3   | The Dependency API is still Beta, returns at most 2,000 rows per query with no paging, and a real recorded response contained zero Apex rows. `ApexClass.SymbolTable` is documented as containing no references. Not yet measured on a live org.                                                                                                  | The cross-check from decision A4 may be weaker than planned. Phase 0 measures it on a real org. The fixture answer key becomes the primary proof of correctness.                                                                        |
| 4   | `@salesforce/core` 9.4.6 and `@salesforce/source-deploy-retrieve` 13.12.0 work from a plain Node program with no Salesforce CLI installed. Three traps: the built-in JWT login writes a credential file to the home directory, the retrieve helper silently skips Apex files without a `-meta.xml`, and wildcard retrieves omit standard objects. | OrgLens does its own JWT exchange, builds its own inventory with explicit member names, and adds a completeness test. This is more work than "first retrieve" suggested.                                                                |
| 5   | Node 26 is Active LTS, Node 24 is LTS, Node 22 ends in April 2027. The built-in `node:sqlite` is warning-free only from Node 24.15.                                                                                                                                                                                                               | Decision needed on the minimum Node version (section 4).                                                                                                                                                                                |
| 6   | The old repositories contain test inputs but no expected outputs. Expected values exist only inside Python test assertions, and the 72 fixture files are small.                                                                                                                                                                                   | Decision M1 assumed they could be reused as ready test data. Inputs are re-homed into the new fixture where useful, and all expected answers are written fresh.                                                                         |

One further finding concerns the earlier private prototypes and not this repository. It was reported to the
maintainer directly and is not repeated here. Its consequence for this repository is a rule: no recorded API
responses and no fixtures are copied from the prototypes.

## 3. Scope

### In scope

| Work package                | Summary                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| WP1 Repository and CI       | Scaffold, licence, contribution files, CI on three operating systems     |
| WP2 Project documents       | Plans, decision records, research notes in git                           |
| WP3 Engine core             | Component keys, reference vocabulary, errors, logging                    |
| WP4 Store                   | SQLite driver layer, migrations, minimal schema                          |
| WP5 Workspace, config, CLI  | `orglens.toml`, `.orglens/`, command shell, JSON output contract         |
| WP6 Fixture and answer key  | Fixture project v0, answer key, checks, public test codebases            |
| WP7 Salesforce connectivity | Login, inventory, chunked resumable retrieve, snapshot storage, coverage |
| WP8 Real-org run and probes | First real retrieve, measurements of the Salesforce cross-checks         |
| WP9 Apex trial              | Two parsers, one shared resolver, scored against the answer key          |
| WP10 Phase close            | Updated overall plan, test plan for you, phase report                    |

### Deliberately not in Phase 0

- All parsing of objects, fields, formulas, validation rules (Phase 1).
- The component and reference tables beyond what the snapshot of retrieved files needs (Phase 1).
- `impact`, `compare`, `access` commands. They are not registered in the CLI until they do something.
- Incremental refresh. Phase 0 only stores what a later incremental design needs (ids and last-modified dates).
- Publishing to npm. Phase 0 rehearses the release with a dry run only.
- The LLM layer, web UI, and anything from roadmap phases 5 and 6.

## 4. Decisions and actions needed from you

These blocked the start. All seven were answered on 2026-11-11. The answers are in the table after this one.

| #   | Question                                                                                                                                                         | Options                                                                                                                                                                                                                                                                                                                                                                       | Recommendation                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **Repository.** I cannot create GitHub repositories from this workspace. Please create an empty public repository and add it to this project. What is it called? | GitHub names ignore case, so `orglens` collides with your existing `orgLens`. Either rename the old one first (for example to `orglens-python-v1`), or pick a different name.                                                                                                                                                                                                 | Rename the old one, create `orglens`. I have **not** checked npm or GitHub for name availability, because that sends the project name to outside services. Tell me if you want me to check. |
| Q2  | **Minimum Node version.**                                                                                                                                        | (a) Node 24: built-in SQLite, no native dependency. (b) Node 22: needs the `better-sqlite3` native module, one more CI column, ends April 2027.                                                                                                                                                                                                                               | (a) Node 24, tested on 24 and 26.                                                                                                                                                           |
| Q3  | **Org for the first real retrieve, and how it is reached.** This workspace has no Salesforce access.                                                             | (a) You sign up a free Developer Edition org, I give you the exact steps to create the login key, you store it as GitHub Actions secrets, and a manually triggered workflow runs the retrieve. I never hold the credentials. (b) You run the commands on your machine from a written checklist and send me the output. (c) You add the credentials to this cloud environment. | (a). It also gives the project a permanent test org for later phases.                                                                                                                       |
| Q4  | **Apex trial pass marks** on the labelled fixture.                                                                                                               | Proposed: recall at least 95%, precision at least 98%, read/write correct for at least 99% of matches, no false hits on the negative cases.                                                                                                                                                                                                                                   | Accept as proposed. If neither parser reaches them in 5 working days, the trial reports the gap and we decide together.                                                                     |
| Q5  | **Java as a development-only checker** (`apex-ls` on the JVM) during the trial. Never shipped, never required by users.                                          | (a) Yes, half a day. (b) No, keep the project Node-only even in development.                                                                                                                                                                                                                                                                                                  | (a). It is the only independent check of call-graph results available.                                                                                                                      |
| Q6  | **Legal names.** Who is the copyright holder in `LICENSE` and `NOTICE`, and which contact address goes in `SECURITY.md`?                                         |                                                                                                                                                                                                                                                                                                                                                                               | Your name or a project name such as "The OrgLens Authors".                                                                                                                                  |
| Q7  | **Outside contributions.**                                                                                                                                       | (a) Sign-off line on commits (DCO), no paperwork. (b) Contributor licence agreement, needed only if you may relicense later.                                                                                                                                                                                                                                                  | (a).                                                                                                                                                                                        |

Smaller choices I will make unless you object: pnpm workspace with two packages (`engine`, `cli`); TypeScript 6 (TypeScript 7 is out but the lint tools do not support it yet); vitest; ESLint with Prettier; commander for the CLI; `smol-toml` with `zod` for configuration; `fast-xml-parser` behind our own wrapper; changesets for versioning.

### Answers (2026-11-11)

| #   | Answer                                                                                                                                                                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | The repository is `sf-orglens`, created by the maintainer. The old repositories are not renamed and are not touched. The packages are named `@sf-orglens/engine` and `sf-orglens`, and the command is `orglens`. The package names can still change before the first release, because nothing is published in Phase 0. |
| Q2  | Node 24 is the minimum (24.15, the first release where the built-in SQLite module is free of warnings). CI runs on Node 24 and 26.                                                                                                                                                                                     |
| Q3  | Option (a): a Developer Edition org, credentials stored only as GitHub Actions secrets, and a manually started workflow.                                                                                                                                                                                               |
| Q4  | Pass marks accepted as proposed: recall at least 95%, precision at least 98%, read or write correct for at least 99% of matches, no hits on the negative cases. Time box of 4 working days with a hard stop at 5.                                                                                                      |
| Q5  | Yes. Java is allowed as a development-only checker and is never shipped or required.                                                                                                                                                                                                                                   |
| Q6  | The copyright holder is a project name, "The OrgLens Authors". Security reports go through GitHub private vulnerability reporting.                                                                                                                                                                                     |
| Q7  | DCO sign-off. No contributor licence agreement.                                                                                                                                                                                                                                                                        |

Two process rules were set with the approval and replace what section 6 says about merging:

- The old repositories are not to be touched in any way.
- The assistant may merge a pull request once CI is green and every review comment is resolved.

## 5. Work packages

Each package lists what is built and how it is accepted. "CI" means the checks run on Linux, macOS and Windows.

### WP1 Repository and CI

Build:

- Root files: `package.json`, `pnpm-workspace.yaml`, `.node-version`, `.gitignore`, `.gitattributes` (LF line endings, required so fixture line numbers hold on Windows), `.editorconfig`, `LICENSE` (Apache 2.0), `NOTICE`, `README`, `CONTRIBUTING`, `SECURITY.md`, `CODE_OF_CONDUCT`, issue forms, pull-request template with a "sub-agent review done" checkbox, `CODEOWNERS`, Dependabot config.
- Two packages: `packages/engine` with layer folders `core, sources, extraction, store, engines, api`, and `packages/cli`.
- Layer enforcement by three independent mechanisms: the package `exports` map, an ESLint import rule, and dependency-cruiser rules. Salesforce libraries may be imported only under `sources/`.
- `ci.yml`: build, lint, format check, layer check, unused-code check, tests with coverage, then pack the packages, install them into an empty folder and run the binary.
- `release.yml` as a dry run only.

Accepted when:

- CI is green on Linux, macOS and Windows for the supported Node versions.
- A test that injects a forbidden import fails in all three mechanisms.
- The packed CLI installs and prints its version in a clean folder.

### WP2 Project documents

Build:

- `docs/plans/re-architecture-plan.md` (exported from the plan document), `docs/plans/phase-0.md` (this file), `docs/research/phase-0/` (the six research notes, checked for client data first).
- `docs/adr/`: a template, an index, 22 short decision records covering all 27 decisions, and `legacy.md` stating which of the old repository's six records are reversed.
- Further records for choices made in Phase 0: Node baseline, SQLite driver, snapshot storage layout, toolchain, exit codes and JSON envelope, Salesforce connectivity and the files it touches in the home directory, fixture and answer-key format, correctness gate definition.

Accepted when: every decision id (F1 to M5) appears in exactly one record, and the Apex record is marked "Proposed" until WP9 fills it.

### WP3 Engine core

Build:

- **Component key module.** Grammar `Type:name[#kind:sub[/kind:sub]]`, with no org, source or snapshot in the key. Examples: `CustomField:account.industry`, `ApexClass:accountservice#method:run(account,boolean)`, `Flow:my_flow#element:decision_1`. Names come from the Metadata API full name, case-folded, with the original spelling kept separately for display.
- **Reference vocabulary** as types: `contains, reads, writes, calls, extends, implements, uses-type, triggers-on, grants, references`, with origin, confidence tier (`confirmed, probable, possible`), resolution and location.
- Typed engine errors with stable codes. A small JSON-lines logger that masks tokens and keeps recent log files in the workspace.

Accepted when: unit and property tests cover the 16 key examples from the plan plus escaping, overloads, inner classes, namespaces and case-only differences; two components folding to one key raise a recorded issue instead of merging.

### WP4 Store

Build:

- A thin driver interface with a `node:sqlite` adapter (default) and a `better-sqlite3` adapter (fallback), both passing one shared test suite.
- Open sequence that refuses a database written by a newer version before making any change, then enables write-ahead logging.
- Numbered SQL migrations using the database's version field, each in one transaction.
- Migration 0001: `source`, `snapshot`, content-addressed compressed `blob`, `snapshot_file` (retrieved file listing), `inventory_item` (what the org listed, with id and last-modified date), `retrieve_chunk` (resume journal), `snapshot_type_coverage`, `snapshot_issue`.
- `bench/`: the synthetic-org generator and benchmark from the research, runnable with one command.

Accepted when:

- Migration tests pass for fresh, already current, failed-and-rolled-back, and newer-file-refused cases.
- A two-process test passes on all three operating systems: one writes, one reads, a second writer gets a clear "another snapshot is running" error.
- The benchmark runs and its numbers are recorded in `docs/research/`.

Research numbers this design rests on (Linux only): 147,000 components and 587,000 references load in seconds; ten snapshots cost about 159 MB with shared versions against 1,103 MB as full copies; a five-level impact query takes under 0.1 ms from an ordinary field and 500 to 820 ms from a hub field in SQL, or about 3 ms from an in-memory index.

### WP5 Workspace, configuration and CLI shell

Build:

- `orglens.toml` (committed, no secrets) and `.orglens/local.toml` (personal). Strict validation: unknown keys are errors, errors show file, line and column, and string values are scanned for token and private-key shapes.
- **Sources.** `kind = "org" | "sandbox" | "git"`. An org is identified by its org id, which is not a credential. Each colleague's own Salesforce CLI alias is matched automatically by org id, or set in `local.toml`. A git source is `repo + ref + paths`, where `paths` is the set of sub-folders that make up one org. This covers your multi-org repository layout.
- `.orglens/` layout: the SQLite file, the retrieve cache, logs, and a `.gitignore` that ignores the whole folder.
- Commands: `init`, `source add|list|remove|link|check`, `status`, `doctor`, `snapshot`, `coverage`.
- One JSON envelope for `--json`: `{ schemaVersion, command, ok, data, warnings, error }`. Generated JSON Schemas committed under `schemas/`, with a test that fails when output and schema disagree.
- Exit codes: 0 success, 1 internal error, 2 usage or configuration error, 3 gate breached, 4 login or connection failure, 5 partial result.
- Salesforce libraries are loaded only by commands that need an org, because importing them costs about half a second.

Accepted when:

- 20 or more invalid-config cases each produce a precise error.
- `source add` and `source remove` keep comments in the file intact.
- A startup-time test holds a budget for a command that needs no org (target under 150 ms on CI Linux).
- `doctor` reports Node version, SQLite capabilities, workspace state and available Salesforce logins, in text and JSON.

Status after pull request 5 (2026-11-12). Built: both configuration files with strict reading, the `.orglens` layout,
`init`, `source add|list|remove`, `status`, `doctor`, the JSON envelope, the exit codes and the start-up check. The
decisions made on the way are in records [0027](../adr/0027-json-envelope-and-exit-codes.md) and
[0028](../adr/0028-configuration-files.md). What differs from the list above:

- `source link`, `source check`, `snapshot` and `coverage` are not built. Each of them needs an org or a retrieve, so
  they arrive with WP7. The rule "no stubs" forbids adding them earlier. The same holds for the retrieve cache in
  `.orglens`, for the Salesforce logins in `doctor`, and for matching a source to a Salesforce CLI login.
- The JSON Schema is written by hand, not generated. A test validates the real output of every command against it.
- Exit code `1` stands for every failure that is not a usage error, including a failed check of `doctor`, not only
  for an internal error.
- `init` does not change a `.gitignore` of the repository. `.orglens` holds its own.

### WP6 Fixture project, answer key, test codebases

Build:

- `fixtures/billing-sfdx/`: a valid, deployable Salesforce project. Version 0 contains what Phase 1 and the Apex trial need:
  - Three objects (`Account` additions, `Invoice__c`, `Invoice_Line__c`) with about 25 fields, including formulas, a formula on a formula, cross-object formulas, roll-up summaries, a lookup filter, and one field referenced by nothing.
  - Six validation rules, including one inactive rule and one that mentions a field only in its error text.
  - About 12 Apex classes and one trigger covering: static field reads and writes, SOQL in every clause, dynamic SOQL by concatenation, field names held in constants in another class, `sobj.get` and `sobj.put` with literals, constants and variables, a trigger with a handler, inner classes, and a deliberately awkward syntax file.
  - A separate folder of files that do not compile, for error-recovery tests.
- `fixtures/expected/answer-key.v0.yaml`: every expected reference with source member, file, line, matched text, target, kind, read or write, confidence tier and the phase that must find it, plus a list of **negatives** that must never be reported. At least 150 Apex references.
- A key check in CI: ids unique, each file exists, the text at each line contains the matched text, and the component list equals what the Salesforce library resolves from the folder.
- `corpora.toml`: three public codebases pinned by commit and fetched on demand, never copied into the repository. `apex-recipes` (139 classes, deployable), `Nebula Logger` (236 classes, 10 flows, used from Phase 2), `NPSP` (11,715 components, 319,000 lines of Apex, parse-only scale test).

Accepted when: the key check passes on all three operating systems, and a second review pass of the key has been done before any analyser is run against it.

Later fixture versions add flows, custom metadata mappings, field sets, components, permissions and named credentials in the phases that need them.

Status after pull request 6 of this plan (2026-11-12, number 7 on GitHub). Built: the project (52 components: 2
objects, 31 fields, 6 validation rules, 12 classes, 1 trigger), the folder of files that do not compile, the answer
key (228 references, 184 of them in Apex, 21 negatives, 5 unknowns), the check as a test on all three systems,
`corpora.toml` with a fetch script, and record [0029](../adr/0029-fixture-and-answer-key.md). What differs from the
list above, or is not done:

- The project has 31 fields, not about 25.
- The key names a place by line and word. The column is worked out by the check, not written by hand.
- The second pass over the key was done twice: by reading it against a list of every custom name in the project that
  no entry covers, and by the code review of the pull request, which read every entry against the files. The review
  found no wrong and no missing entry. It found rules that could be read in two ways, which are now written down in
  `fixtures/README.md`, and a check that let most planted defects pass, which now finds 17 of 20.
- The Apex has not been compiled by Salesforce. WP8 will deploy the project.

### WP7 Salesforce connectivity, retrieve and snapshot

Build:

- **Login, two modes.** `cli-login` (default): resolve a source to an existing Salesforce CLI login without calling the `sf` program. `jwt-env` (CI): OrgLens performs the key exchange itself from environment variables and writes no credential file.
- **Inventory.** List every metadata type and member with bounded parallelism, including folders, child types and standard objects by explicit name. Store id, last-modified date and namespace. A type that fails to list is recorded as failed, never as empty.
- **Chunk planner.** Explicit members only, about 3,000 files per chunk, well under Salesforce's limits of 10,000 files and 39 MB. A chunk that hits a limit is split and retried.
- **Retrieve.** Through the Salesforce library in source format. Each chunk's job id and state are journalled in SQLite, so an interrupted `snapshot` resumes instead of restarting.
- **Snapshot.** Retrieved files stored as compressed, content-addressed blobs. Coverage rows per metadata type: listed, retrieved, failed.
- **Local source reading.** A git or folder source is read through the same library into the same shape. Parsing is Phase 1.
- A completeness test: any Apex file on disk that is missing from the resolved component set fails the build.

Accepted when:

- Tests against a local mock Salesforce server pass on all three operating systems, with the home directory redirected: login by alias, retrieve, kill and resume, chunk split on a simulated limit.
- A test proves `jwt-env` leaves no credential file and works twice in a row.
- A fixture-folder snapshot and an org snapshot of the same content produce the same file list.

Status after the third of three pull requests for this work package (2026-11-12). The work package is built in
three parts, because each is useful and reviewable on its own: what needs no org, the logins, and reading an org.
The scope of the work package is unchanged. Three pull requests where the table below had one is a change to the
plan the maintainer approved, and each split is named as such in the pull request that makes it:

- **Part one, built: the snapshot of a Git source.** Reading folders from disk and a commit from the repository
  into one shape, `sfdx-project.json` and `.forceignore`, component resolution through the Salesforce library,
  storage as content-addressed blobs in one transaction, coverage per metadata type, issues, and the commands
  `snapshot` and `coverage`. The decisions are in record [0030](../adr/0030-reading-a-git-source.md).
- **Part two, built: the logins.** Both login modes, `source link` and `source check`, the checks `git` and
  `logins` in `doctor`, and tests against a mock org with the home folder redirected. The decisions, and every
  file that is read or written in the home folder, are in record
  [0031](../adr/0031-logins-and-the-home-folder.md).
- **Part three, built: reading an org.** The inventory, the chunk planner, the journalled retrieve, the org
  snapshot, and the tests for kill and resume and for a chunk that is split. The decisions are in record
  [0032](../adr/0032-reading-an-org.md).

What differs from the list above in part three, or is not done:

- **Nothing of part three has met Salesforce.** Every test runs against a mock org that answers the Metadata API
  from the fixture project. Record 0032 lists what that leaves open: the names in a retrieve against the names
  the org lists, which types real orgs refuse to list, the wording of a retrieve that is too large, folders in
  folders, speed and limits on a large org. WP8 is where these are measured.
- A mock org that holds each of the three public codebases was read as well (506, 1,021 and 12,056 files). Every
  component came back. That check found two defects the fixture project could not show, both fixed: custom labels
  could not be stored, and reports in folders were never asked for. It runs where the codebases are downloaded,
  not in CI.
- Found on the way, not changed: how a Git source is resolved follows settings in the `sfdx-project.json` of the
  folder the command runs in (`sourceBehaviorOptions`). Record 0032 describes it. It has to be decided with the
  comparison of an org and a repository.
- **Profiles and permission sets are read incompletely.** Salesforce hands them out with the access to the
  components of the same retrieve only. The snapshot says so with a warning. How they are read completely has to
  be decided before access impact is built.
- The retrieve does not go through the Salesforce library. OrgLens makes the four requests of the Metadata API
  itself, because the retrieve of the library keeps the state of a job in memory only, waits up to 30 minutes for
  a request and follows redirects. The library converts the files that come back. The requests are sent with the
  HTTP client of the library (`undici`, now a direct dependency of the engine), with one time limit for the whole
  answer: the code review showed that the SOAP client limits only the time until an answer starts and ends the
  process when a connection breaks in the middle of one.
- The code review of part three found one blocker (a second command that was refused the lock deleted the work
  folder of the snapshot that ran) and four ways a snapshot could hang, loop or end wrongly. All are fixed, each
  with a test that fails without its fix. Record 0032 lists what stays open, with two questions for the
  maintainer: a sandbox that is refreshed gets a new org id, and folders inside folders may need a query that the
  data rule forbids.
- A type that fails to list is recorded as failed and makes the snapshot partial. Standard value sets, which
  Salesforce never lists, are not read and a warning says so.
- Coverage has the columns listed, retrieved and analysed, and says per type how the listing went. What failed
  is in the issues, not in a column.
- The acceptance criterion "a fixture-folder snapshot and an org snapshot of the same content produce the same
  file list" is met against the mock with one difference: the mock org also hands out the standard object
  `Account`, because it holds custom fields.
- Kill and resume is tested with a second process that is killed while a retrieve runs. The login by alias, the
  split on a limit and the test that a login with a key leaves no credential file run in CI on all three systems.
- The storage schema has version 2 (migration 2).
- Of the notes the reviews of parts one and two left, record 0032 decides each. Three stay as they are: the files
  of a component are not stored, `coverage` refuses a source that is no longer declared, and a Git LFS pointer is
  stored as the file.

What differs from the list above in part two, or is not done:

- Of the acceptance criteria, part two meets two halves: login by alias against the mock, and the test that a
  login with a key leaves no credential file and works twice in a row, in one process and in two. Strictly, that
  login leaves two files without secrets, which the Salesforce library creates. Record 0031 says what they hold.
- A login with a key is found by variables that carry the name of the source (`ORGLENS_JWT_<SOURCE>_…`), so that
  one job can read several orgs.
- `source check` also works for a source of the kind `git`: it reads everything a snapshot would read and stores
  nothing.
- When the session of a Salesforce CLI login has expired, the Salesforce library renews it and then makes three
  requests of its own about the org. Record 0031 names them and why they are accepted.
- A login with a key is refused for a user who also has a Salesforce CLI login on the machine. The code review
  showed that the library otherwise takes over the stored login of that user.
- A login in the personal file for a source that is no longer declared is not an error. `doctor` names it, and
  every variable `ORGLENS_JWT_…` that no source reads.
- Not verified: the keychains of macOS, Linux and Windows (the tests use the file-based one on all three), a
  login written by the real Salesforce CLI, and a real org. The live-org workflow is the first check against
  Salesforce itself.

The code review of part two left these for part three. Record 0032 says how each was decided:

- A guard that the library never stores a session of a login with a key. Nothing does so today. Paths of the
  library that part three may use, such as looking up the newest API version, save the login they work with.
- Time limits for the requests the library makes itself. Only the three requests OrgLens makes have its limit of
  30 seconds. A renewal, and later a retrieve, run with the limit of the library, which is 30 minutes.
- The HTTP client of the library follows a redirect and sends the session along. The address it starts from is
  the one that issued the session, so this was accepted for a login. A retrieve should decide it again.

The code review of part one left these for part three. Record 0032 says how each was decided, and the latest
snapshot is now the latest that ended:

- A snapshot does not record what was read: not `repo`, the name of the `ref`, the folders, nor which file belongs
  to which component. Only the counts per type survive. Phase 1 needs the components.
- A source is known to the database by its name and kind only. A name that is removed and declared again for
  another repository continues the old row.
- `coverage` refuses a source that is no longer declared, although its snapshots are kept.
- The latest snapshot is the one with the highest number. With org snapshots that can be one that is still
  running or that failed.
- `doctor` does not check that Git is there and new enough. Done in part two.
- Taking a snapshot blocks the process from start to end. That is fine for the CLI and not for a local web UI.
- A Git LFS pointer file is stored as the content of the file when a commit is read.
- A package directory inside another one is read with the outer one, and its own `.forceignore` is not consulted.
- A component that is defined in two places is one component with the files of both. How it is analysed is a
  question for Phase 1.

What differs from the list above in part one, or is not done:

- The completeness test for Apex files exists twice. As planned, a test fails the build when an Apex file of the
  fixture project is missing from the snapshot. Beyond the plan, the same check is part of every snapshot: an
  Apex file that belongs to no component is an issue of the severity `error` and makes the snapshot partial.
- Coverage has the columns listed, retrieved and analysed. For a Git source, listed is what the resolver found and
  retrieved is what could be stored. A failed type cannot occur before the inventory of an org exists.
- A snapshot of the folders names its commit only if every file that was read is the same as in the commit, byte
  for byte. On a machine where Git converts line endings on checkout it therefore names none.
- Components and their files are compared with the Salesforce library's own reading by a test on the fixture
  project, which runs in CI. The same test on the three public codebases is skipped where they are not
  downloaded, which includes CI. By hand, 20 public codebases were compared once.
- Not run: Windows and macOS beyond what CI runs, and any Git older than 2.43.
- The acceptance criterion "a fixture-folder snapshot and an org snapshot produce the same file list" is met
  against the mock org in part three, and waits for the test org.
- Measured once by hand, not held by CI: NPSP (11,707 components in 12,056 files) is read and stored in about 3
  seconds, from disk and from a commit.

### WP8 Real-org run and cross-check probes

Depends on Q3. Build `live-org.yml`, a workflow that runs only on manual trigger or schedule, never on pull requests from forks, and skips cleanly when secrets are absent.

Status on 2026-11-12. The workflow exists with its first step, ahead of the rest of this work package, so that the
setup of the test org is checked as early as possible: it logs in with the key from the secrets and says whether
that worked. Everything else in the list below is not built.

- The maintainer decided on 2026-11-12 that the workflow also runs once a week by itself, and that this run only
  logs in.
- In a copy of the repository the job is skipped. In the repository itself, missing secrets are a failure and not
  a clean skip: there they mean that the setup is broken, and a green run would hide that.
- The step prints no text that OrgLens, a Salesforce library or Salesforce wrote: only sentences of its own with
  codes, and an answer of Salesforce if it is one of a list of known texts. The code review asked for this in
  place of a filter that masks what looks like an address or a user name. It is tested against a mock org and
  against a stand-in for `orglens` that answers with secrets in every field. The list of known texts is written
  from the documentation of Salesforce and from memory. The step has not run against Salesforce before the
  maintainer starts it for the first time.

Status after the second pull request of this work package (2026-11-12). The workflow can now do the first three
items of the list below: a run that is started by hand can deploy the fixture project and read the org.

- The two steps are tools of the tests of the engine (`packages/engine/test/live`), written in TypeScript and run
  from source by Node.js. They call the engine in the process of the step, so "the first real `orglens snapshot`"
  is a snapshot taken through the API of the engine, which is what the command does, and not a run of the binary.
- The rule for the public log was widened and is written down in decision record 0033, `public-log.ts`,
  `docs/live-org-setup.md` and `CLAUDE.md`: a step may print names of metadata types, of elements and of the
  fixture project. Without them a real run could say nothing about types and files. It still prints no name of
  another component and no message of Salesforce outside a list of known forms.
- The code review found that the first version could print the name of a folder of the org where a code was
  expected. Three things changed for it. The engine keeps the code of a refusal of Salesforce in a field of its
  own (`details.code` of an issue), and the step reads only that. A tool does its work in a second process
  without output, which can only send lines of its log to the step. And the tests read a mock org that holds
  components beside the fixture project.
- The deploy does not go through the request code of the engine (record 0032) but through the Salesforce
  library, which has no time limit for a whole answer. The step has a time limit in the workflow.
- The maintainer decided on 2026-11-12 that the automated author of this project starts the runs itself. The
  secrets stay in GitHub.
- Not built yet: the two probes (items 4 and 5) and the report. Item 6 is for the maintainer to choose.
- Nothing of this has met Salesforce when the pull request is merged. The runs follow it, because the secrets
  are handed only to a run from `main`.

Status after the first real runs and the third pull request of this work package (2026-11-12).

- Items 1 to 3 have run against Salesforce. The deploy was accepted on the first try: all 52 components of the
  fixture project, in 16 seconds. The first real snapshot took 197 seconds, used 387 requests to the Metadata
  API and 402 MB of memory, and read 1,668 listed components into 5,010 files. All 52 components of the fixture
  project came back, in 65 files, of which 17 are the same byte for byte as in the repository.
- The snapshot was "partial": the org did not hand out 223 of the components it listed, in 15 types, and the
  listing of one type failed. None of them is of the fixture project. A Developer Edition org that holds
  "nothing but the fixture project" holds 1,600 components of its own. The first version of the step could not
  say why they are missing, because it prints no name of the org. The step now describes them without a name,
  and shows a message of an unknown form in everyday words (record 0033).
- The step that reads the org no longer fails for a partial snapshot. It fails when the snapshot does not end or
  when the fixture project is not whole in it.
- The two probes are built as one tool, `packages/engine/test/live/probe-org.ts`, and a choice of the workflow.
  It reads the Dependency API per type of component and per pair of types where a query is at the limit of
  2,000 rows, and compares the rows with the 137 pairs of the answer key. It reads `ApexClass.SymbolTable` as
  the org holds it. The variant that compiles a class in the org to get references is not built: it writes to
  the org.
- Not done yet: the runs of the probe, and the report `docs/research/phase-0/real-org.md`, which follows them.

Run and record in `docs/research/phase-0/real-org.md`:

1. Deploy fixture v0 to the Developer Edition org with a script kept in the repository.
2. First real `orglens snapshot`: components and files per type, number of chunks, duration, peak memory, API calls used, any type that failed or came back empty.
3. Compare the retrieved source with the fixture folder to learn what Salesforce rewrites.
4. **Dependency API probe.** Query per type pair, detect the 2,000-row cut-off, and record exactly which fixture references it reports: Apex to field, formula to field, validation rule to field, dynamic ones.
5. **Compiler symbol probe.** Record what `SymbolTable` returns for the fixture classes and whether field references appear at all.
6. Check a login written by the real Salesforce CLI, if you choose to run that one step locally.

Accepted when: the report states, with evidence, whether each Salesforce cross-check is usable for field-level verification, usable at component level only, or not usable. Any of the three answers is a valid Phase 0 result. A negative answer changes how the correctness gate is defined and I will bring that to you as a decision.

### WP9 Apex trial

Time box: 4 working days, hard stop at 5.

Method:

1. Define a thin syntax-adapter interface.
2. Write the resolver once on top of it: symbols and scopes, declared-type resolution against the fixture's objects and fields, read or write classification, SOQL field extraction, constant folding for dynamic names.
3. Implement two adapters: `@apexdevtools/apex-parser` 5.3.0 and `web-tree-sitter-sfapex` 3.0.2 (WebAssembly, so no native build on any system).
4. Score both with one harness against the answer key.
5. Run both over `apex-recipes` and `NPSP` for robustness, speed and memory. Hand-check 100 sampled references from `apex-recipes`.
6. If Q5 is yes, run `apex-ls` on Java as an outside check of call-graph edges.

Measures: recall, precision and read/write accuracy on the fixture; false hits on negatives; share of files yielding a usable tree; behaviour on broken files; time and peak memory on NPSP (target under 60 seconds and 1.5 GB); clean install on all three operating systems with no compiler; hours and lines of adapter code per candidate.

Decision rule: a candidate must first pass install, robustness and performance. Among those, it must meet the pass marks in Q4. If both pass, which is likely since the resolver is shared, the tie-break order is: recovery on broken code, how current the grammar is, quality of the TypeScript API, then speed.

If neither passes in the time box: the trial reports the measured gap by category, and I bring you options (extend the time box, accept a lower bar with a "name-match" confidence tier, or change approach).

Deliverables: the trial code under `trial/apex/` (not shipped), the results table, and decision record 0018 filled in with the numbers. The resolver written here is a spike. Phase 3 builds the production version, informed by it.

Research measurements so far: on NPSP, `apex-parser` parsed 1,070 files in 18.5 s and `tree-sitter-sfapex` in 2.3 s. `apex-parser` kept more structure on badly broken code. Preliminary ranking puts `apex-parser` slightly ahead, and the trial is allowed to reverse that.

### WP10 Phase close

- Update the overall plan: roadmap estimates, risks and open questions, in light of WP8 and WP9.
- Write `docs/test-plans/phase-0.md`: step-by-step checks you can run yourself, with expected output for each.
- Write a short phase report: what was built, what was measured, what changed.
- Draft the Phase 1 plan for your approval. Nothing in Phase 1 starts before that.

## 6. Pull requests and review

About ten pull requests, in this order. Each is small enough to review in one sitting.

| PR  | Content                                                                | Work package |
| --- | ---------------------------------------------------------------------- | ------------ |
| 1   | Scaffold, CI, licence and contribution files, plans and research notes | WP1, WP2     |
| 2   | Decision records                                                       | WP2          |
| 3   | Engine core: keys, reference vocabulary, errors, logger                | WP3          |
| 4   | Store: drivers, migrations, schema 0001, benchmark                     | WP4          |
| 5   | Config, workspace, CLI shell, JSON contract, `doctor`                  | WP5          |
| 6   | Fixture v0, answer key, key check, test codebase manifest              | WP6          |
| 7a  | Snapshot of a Git source, `snapshot` and `coverage`                    | WP7          |
| 7b  | Logins: `source link`, `source check`, logins in `doctor`              | WP7          |
| 7c  | Reading an org: inventory, chunk planner, retrieve, org snapshot       | WP7          |
| 8a  | Live-org workflow with its login step, ahead of 7c                     | WP8          |
| 8b  | Live-org workflow: deploy of the fixture project, first real snapshot  | WP8          |
| 8c  | Cross-check probes, what the read step says about missing components   | WP8          |
| 8d  | Real-org report, fixes from the real runs                              | WP8          |
| 9   | Apex trial code, results, decision record 0018                         | WP9          |
| 10  | Phase close: updated plan, test plan, phase report                     | WP10         |

PRs 3, 4 and 6 do not depend on each other. PR 9 needs PR 6. PR 8 needs PR 7 and your org setup.

For every pull request, as you asked:

- I start a separate review agent that sees the diff and the relevant decision records, not my reasoning. Its findings are fixed or answered in the pull request before I ask you to look.
- CI must be green on all three operating systems.
- I request your review and assign you. Under the rule set at approval (section 4), I merge once CI is green and every review comment is resolved.

## 7. Risks in this phase

| Risk                                                                                                                                              | Handling                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows and macOS were not tested in the research. Paths, line endings, file locking and the macOS keychain may fail on first CI run.             | CI on three systems is in PR 1, before any feature. Time is budgeted for the first cross-platform failures.                                                                         |
| The Salesforce libraries write to `~/.sfdx` and `~/.sf` when connecting, and a mistake in login handling could damage a real CLI login.           | Never use the library's own JWT path. All tests redirect the home directory. A decision record lists every file touched. `doctor` shows what will be used before anything connects. |
| The cross-checks turn out weak (finding 3).                                                                                                       | Measured in WP8 and reported plainly. The answer key is designed to stand on its own.                                                                                               |
| The Apex resolver does not reach the pass marks in five days.                                                                                     | Hard stop and a decision brought to you, not a silent extension.                                                                                                                    |
| A fresh install of the Salesforce libraries shows 5 high-severity audit warnings from one indirect dependency (an FTP parser in a proxy library). | Recorded in a decision record with an assessment of whether OrgLens can reach that code. Reported to you before PR 7 merges.                                                        |
| The free Developer Edition org can expire when unused.                                                                                            | The fixture redeploys from one script. A scheduled keep-alive job logs in weekly.                                                                                                   |
| Phase 0 grows.                                                                                                                                    | The "not in Phase 0" list in section 3 is the boundary. Anything new goes to the Phase 1 plan.                                                                                      |

## 8. Effort

The roadmap estimated Phase 0 at 2 to 3 focused weeks. **This plan is 4 to 5.** Two things account for the difference:

- A correct retrieve needs its own inventory, explicit members, chunking and a resume journal (finding 4). That is WP7, about one week.
- The trial has to build a working resolver, because no library provides one (finding 2). That is WP9, one week.

| Work package                  | Rough effort      |
| ----------------------------- | ----------------- |
| WP1 Repository and CI         | 2 days            |
| WP2 Project documents         | 1.5 days          |
| WP3 Engine core               | 1.5 days          |
| WP4 Store                     | 2 days            |
| WP5 Workspace, config, CLI    | 3 days            |
| WP6 Fixture and answer key    | 2.5 days          |
| WP7 Connectivity and retrieve | 4 to 5 days       |
| WP8 Real-org run and probes   | 1.5 days          |
| WP9 Apex trial                | 4 to 5 days       |
| WP10 Phase close              | 1 day             |
| **Total**                     | **23 to 25 days** |

With this change the roadmap total to the correctness gate moves from 24 to 35 weeks to roughly 26 to 37.

These are developer-days of work. Since I do the building, elapsed time will depend mostly on your review turnaround and on the org setup in Q3.

A leaner variant exists: move WP8 and the resume journal to the start of Phase 1, which brings Phase 0 back to about 3 weeks. I advise against it. WP8 answers the question the whole correctness strategy depends on, and it is cheaper to learn the answer before Phase 1 is designed.

## 9. What you will be asked to do

1. Answer Q1 to Q7.
2. Create the repository and add it to the project.
3. For Q3 option (a): sign up a Developer Edition org, follow a written checklist to create the login key (about 20 minutes), and add four secrets to the repository.
4. Review the pull requests you want to look at. Merging is done by the assistant under the rule in section 4.
5. At the end, run the Phase 0 test plan and approve or reject the phase.
