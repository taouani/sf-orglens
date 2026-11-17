# The command line

This page describes the commands of `orglens` that exist today, what they write, and the exit code they end with.
The `--json` output and the exit codes are a contract: scripts, CI jobs and later the local web UI rely on them.
The decision behind the contract is [record 0027](adr/0027-json-envelope-and-exit-codes.md).

OrgLens is in pre-release. The commands below manage a workspace and its configuration, check the login for an
org, take snapshots of orgs, sandboxes and repository folders, and analyse them: a snapshot is analysed for its
objects, fields and validation rules, with the formulas in them. `orglens impact` answers what refers to a
component from those types alone. Nothing else of a snapshot is analysed yet, and an answer names the types it
does not cover. Reading an org is tested against a mock org. The code that reads an org was also run against one real Developer Edition
org, by a tool of the tests ([`real-org.md`](research/phase-0/real-org.md)). The command `orglens snapshot`
itself has not been run against Salesforce.

## Commands

| Command                              | What it does                                                                                 | Changes                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------ |
| `orglens init [folder]`              | Makes a folder a workspace: writes `orglens.toml` and creates the data folder `.orglens`.    | The folder               |
| `orglens source add <name>`          | Declares an org, a sandbox or a set of repository folders in `orglens.toml`.                 | `orglens.toml`           |
| `orglens source list`                | Lists the declared sources.                                                                  | Nothing                  |
| `orglens source remove <name>`       | Removes the declaration of a source. Snapshots already taken stay in the database.           | Both configuration files |
| `orglens source link <name> <login>` | Chooses the Salesforce CLI login you use for an org or a sandbox.                            | `.orglens/local.toml`    |
| `orglens source check <name>`        | Checks that a source can be read: logs in to an org, or reads the folders of a repository.   | No data                  |
| `orglens status`                     | Shows the workspace, the state of its database and the latest snapshot of every source.      | No data                  |
| `orglens snapshot <source>`          | Reads a source now, stores its metadata files as a new snapshot, and analyses them.          | The database             |
| `orglens analyse <source>`           | Analyses a stored snapshot again, from the files it holds. The source is not read.           | The database             |
| `orglens coverage <source>`          | Shows what a snapshot holds per metadata type, what its analysis found, and what went wrong. | No data                  |
| `orglens impact <component>`         | Shows what refers to a component in a snapshot, directly or through other components.        | No data                  |
| `orglens doctor`                     | Checks Node.js, SQLite, Git, the workspace, its configuration, its database and the logins.  | No data                  |

`status`, `coverage`, `impact` and `doctor` change neither the configuration nor the content of the database. They
open the
database to read it, and SQLite can then create its two helper files beside it (`orglens.db-wal` and
`orglens.db-shm`) and leave them there. Both are in the ignored folder `.orglens`.

`orglens <command> --help` shows the arguments and options of a command. [configuration.md](configuration.md)
describes the file the `source` commands edit and how a command finds its workspace.

What the help texts do not say:

- `init` in a folder that already has an `orglens.toml` never changes that file. It creates what is missing in
  `.orglens` and says so. With `--name` it is refused there, because the name is set in the file. `init` in a folder
  below an existing workspace is refused too. Both end with `WORKSPACE_EXISTS`.
- `snapshot` of an org or a sandbox takes minutes and says on the standard error stream how far it is. With
  `--json` it says nothing there.
- Only `init` and `snapshot` create the database. `status`, `coverage`, `impact` and the `source` commands never
  create or migrate it. `status`
  reports a database that is missing, outdated, newer, foreign or busy as the `state` of the store, and still exits
  with `0`: the command did what it was asked to do. `doctor` is the command that turns a problem into an exit
  code.
- `source add`, `source remove` and `source link` take a lock while they change a configuration file, so two of them
  at the same moment do not lose each other's change. A command that finds the lock taken waits for it, and prints
  nothing while it waits. It ends with `WORKSPACE_IO` when the command in front has held the lock for ten seconds,
  or when it has waited thirty seconds in all while several commands took their turn. `details.reason` is then
  `LOCKED`, `details.waitedMs` says how long the command waited, and `details.heldMs` how long the lock it saw last
  had been held, both in milliseconds.
- `source remove` also removes the login that `source link` set for the source from `.orglens/local.toml`.
- `doctor` connects to nothing. Its check `logins` says how many logins the Salesforce CLI has on this machine and
  by which route each org and sandbox of the workspace would be logged in. It names no login and no user, so the
  report can be pasted into an issue. Whether a login still works shows `source check`. The check is a warning
  when a source cannot be logged in, and for two things that are easy to miss because what is not read is not an
  error: a variable that starts with `ORGLENS_JWT_` and is read by no source, such as a misspelled one
  (`details.unreadVariables`, names only), and a login in `.orglens/local.toml` for a source that `orglens.toml`
  no longer declares (`details.unusedLogins`).
- The check `git` of `doctor` is a warning, not a failure, when Git is missing or older than 2.30: folders on disk
  are read without Git.
- A reader that closes the pipe early, as in `orglens status | head -1`, ends the command quietly with the exit
  code `1`.

### Snapshots

`orglens snapshot <source>` reads a source now and stores its metadata files. What holds for every kind of source:

- A snapshot never changes the source. A repository is only read: no checkout, no fetch, no file is written into
  it. From an org only metadata is read, never a record.
- Every snapshot gets a number that is never used again. Earlier snapshots stay as they are. A file that did not
  change between two snapshots is stored once.
- A snapshot is `complete` or `partial`. It is partial when something the source should hold could not be read.
  Each such thing is an issue of the severity `error`, and it costs the snapshot that one file, folder, component
  or type and nothing beside it. The snapshot is stored either way, `ok` is `true`, and the exit code is `5`, so
  that a script does not take an incomplete picture for a complete one.
- Issues of the severity `warning` and `info` say what was left out on purpose or is worth knowing. They do not
  make a snapshot partial. A snapshot of an org is judged over the logic tier: what is missing of a type outside
  it is such a warning ([below](#a-source-of-the-kind-org-or-sandbox)).
- A snapshot is analysed as soon as it is stored. `complete` and `partial` say what was read, whatever the
  analysis found. [The analysis of a snapshot](#the-analysis-of-a-snapshot) has its own word for that.

#### A source of the kind `git`

The folders of a repository are read as they are on disk, or from a commit when the source has a `ref`.
[configuration.md](configuration.md#how-a-git-source-is-read) says which folders and files are read. The snapshot
is stored in one step: it is there with all its files, or not at all.

- The snapshot is partial for: a folder that is declared and does not exist or is not a folder, a folder that
  cannot be listed, a file that cannot be opened, a file or folder with a name that is not UTF-8, a `-meta.xml`
  file the Salesforce library cannot place, an Apex file that belongs to no component.
- Warnings and notes: symbolic links that were not followed, files that `.forceignore` excludes, files that
  belong to no metadata component, a component that is defined in two places, a working tree that differs from
  its commit.
- `snapshot.commit` is the full id of the commit the snapshot was read from, or `null`.
  - For a source with a `ref` it is the commit that name stood for when the snapshot was taken. Everything in the
    snapshot comes from that commit. If the snapshot is partial, it does not hold all of it.
  - For folders read from disk it is the commit that is checked out, and it is given only if the folders hold
    exactly that commit. Compared byte for byte are: every file below the folders that `.forceignore` does not
    exclude, whether it ends up in the snapshot or not, the project file, and every place a `.forceignore` can be
    at. The files are compared a second time when they are stored.
  - Otherwise `commit` is `null`, and an issue of the severity `info` says why. `WORKING_TREE_MODIFIED` lists the
    files that differ. On a machine where Git converts line endings on checkout, that is every text file, and
    the issue says so (`details.onlyLineEndings`). `CHANGED_WHILE_READ` lists files that changed while the
    snapshot was taken. `COMMIT_UNKNOWN` means Git gave no commit, and `details.reason` says why:
    `NOT_A_REPOSITORY`, `NO_COMMIT`, `NOT_TRUSTED` (Git refuses a repository of another user),
    `GIT_NOT_INSTALLED` or `GIT_FAILED`.
- A source that cannot be read at all ends with `SOURCE_READ_FAILED` and stores nothing: no repository, no
  `sfdx-project.json`, an unknown branch, no folder that can be read, a project file or a `.forceignore` that may
  not be opened, a project file that asks for a layout of files this version does not know (`LAYOUT_UNKNOWN`) or
  describes types the Salesforce library refuses (`LAYOUT_INVALID`). `details.reason` says which it was.
- The project file is read for a source with `paths` as well, because it says how the files are laid out. If it
  is not JSON, or its settings for the layout are not built as the library expects, the warning
  `PROJECT_FILE_INVALID` says so and the files are read as Salesforce lays them out.

#### A source of the kind `org` or `sandbox`

The org is read through the Metadata API, with the login described [below](#logins), in three steps. A fourth
asks the Dependency API, and is described [further down](#the-cross-check-of-a-snapshot-of-an-org).

1. **The inventory.** The org is asked which metadata types it has, and for every type which components. Types
   whose components lie in folders, such as reports, are asked folder by folder. The inventory is what the
   snapshot is measured against.
2. **The retrieve.** Every component is asked for by its name, never by a wildcard, because a wildcard leaves out
   standard objects and components of installed packages without a word. The components are retrieved in chunks
   of about 3,000 files, one chunk after the other. The files of a chunk are stored as soon as they arrive. A
   chunk that Salesforce fails, which is how it says that a chunk is too large, is tried again in two halves, down
   to the one component that cannot be handed out. The same is done when Salesforce refuses three times to start
   the retrieve of a chunk, or hands out something that is not a zip file.
3. **The count.** What came back is counted against the inventory, type by type.

The files are stored in the form a repository holds them in (an object with one file per field), under the paths
they have below a package directory, such as `classes/Foo.cls`.

- Four things can be missing: a type whose components the org refused to list (`LISTING_FAILED`), a retrieve
  that failed for a single component, or a chunk whose retrieve was started three times and gave no result
  (`RETRIEVE_FAILED`), a component the org listed that did not come back (`NOT_RETRIEVED`), a file that came back
  and cannot be read as metadata (`RESOLVE_FAILED`). The other types and components are in the snapshot.
- **A snapshot of an org is judged over the logic tier.** Every type the org lists is read. The snapshot is
  partial when one of the four things is missing of a type of the logic tier: the issue is an `error`. Of any
  other type the same issue is a `warning`. Its message ends with a sentence that says it is outside the logic
  tier and does not make the snapshot partial, the snapshot is `complete`, and the exit code is `0`. The first
  line of the report then says "is complete for the logic tier", and after the numbers: "Something of other
  types is missing, and the warnings below say what." A script that needs every type reads the issues: each of
  the four carries `details.tier`, which is `logic` or `other`.

  The types of the logic tier are:

  `ApexClass`, `ApexTrigger`, `AuraDefinitionBundle`, `CustomField`, `CustomLabel`, `CustomLabels`,
  `CustomMetadata`, `CustomObject`, `CustomPermission`, `FieldSet`, `Flow`, `GlobalValueSet`,
  `LightningComponentBundle`, `NamedCredential`, `PermissionSet`, `PermissionSetGroup`, `Profile`, `RecordType`,
  `ValidationRule`, `Workflow`, `WorkflowRule`.

  A type is of the tier by its own name. A part of an object that is not in the list, such as a list view, is
  outside it although the object is in it. Four cases need a rule. A retrieve that fails counts against the
  tier if one of its components is of the tier. A file that cannot be read as metadata counts by the types that
  keep their files in its top folder: a file under `reports` is outside the tier, one under `classes` or
  `objects` is in it. Where the Salesforce library knows no type for the folder, the types the org itself
  describes with that folder decide. A file in a folder of no known type, or outside the package that was asked
  for, counts against the tier, because nothing says what it is. And the file of custom labels, `CustomLabels`, is not
  missing when the org lists no custom label: an org without a label lists the file and hands out nothing. The
  issue `NOT_RETRIEVED` is then a warning with `details.holdsNothing` set to `true`, and the first line of the
  report stays that of a complete snapshot.

  A snapshot that an earlier version took keeps the status that version gave it. A snapshot of a repository is
  not judged by tier: whatever its folders hold and cannot be read makes it partial.

- **Types can be left out.** `exclude_types` of the source in `orglens.toml` names metadata types that a snapshot
  does not read ([configuration.md](configuration.md#a-source-of-kind-org-or-sandbox)). The org is not asked for
  the components of such a type, nor for those of its parts and its folders, and none is retrieved. The report
  has a line for each with `left out` in the column `LISTED`, and the note `TYPES_EXCLUDED` names them. In JSON
  such a type has the `listing` `excluded`. A type of the logic tier cannot be left out: the file is refused. A
  name that cannot be left out for another reason is read, and the warning `TYPE_NOT_EXCLUDED` says why: the org
  describes no such type, the type is a part of another, or it holds the folders of another. A part or a folder
  type that is named beside its owner goes with the owner, without a warning. Leaving a type out does not make a
  snapshot partial. A reference to a component of such a type keeps its name and is not resolved, as for any
  component the snapshot does not hold.

  The cross-check with the Dependency API is not narrowed by the key: Salesforce is asked for the rows of every
  type. One thing can change. Where a type has more rows than one answer holds, the rows are asked for per
  component, with the ids the org listed. A type that was left out has none, so its rows stay cut off and the
  reading is `partial` (`CROSS_CHECK_PARTIAL`) where it could have been `whole`. The rows that are missing then
  are from a type that is not compared.

- Warnings: a type Salesforce describes and never lists, which today is `StandardValueSet` (`TYPE_NOT_READ`), what
  Salesforce remarked about a retrieve (`RETRIEVE_MESSAGES`), files of a retrieve that belong to no component
  (`FILES_NOT_METADATA`), and a file that came back in two retrieves (`FILE_RETRIEVED_TWICE`).
- **Profiles and permission sets are incomplete.** Salesforce hands out a profile or a permission set with the
  access to the components of the same retrieve only. Because the org is retrieved in chunks, such a file holds a
  part of the access settings. The snapshot says so with the warning `ACCESS_INCOMPLETE` and a note on both
  types. Reading access completely is not built yet.
- Notes: a chunk that was split (`CHUNK_SPLIT`), components that came back although the org had not listed them,
  such as an object that came for the sake of its fields (`UNLISTED_COMPONENTS`), a snapshot that was continued
  (`SNAPSHOT_RESUMED`) or given up (`SNAPSHOT_GIVEN_UP`).
- **A component of a package can come back without the prefix of the package.** An org lists a Lightning web
  component of a package as `pkg__thing` and hands out the folder `thing`. What comes back under the short name
  counts as the listed component when the retrieve asked for the listed name and not for the short one, the org
  states the prefix as the package of the listed component, the org lists nothing under the short name,
  Salesforce did not remark that it cannot find the listed name, and no second component of the retrieve has
  the same short name. Otherwise the listed component stays missing. Only a prefix at the very start of a name
  is seen, so a part of a component and a component in a folder are never taken this way. The files of the
  snapshot keep the short name. The note `RETRIEVED_WITHOUT_PREFIX` says how many components of a type came
  back that way in one retrieve, so a snapshot of many retrieves can hold several for a type.
- **A part is asked for by its own name when Salesforce cannot find its parent.** A field comes with its object,
  so a retrieve names the object, also when the org lists the field and not the object. When Salesforce remarks
  that it cannot find such an object, the fields, record types and other parts of it that the org lists are
  asked for by their own names in one more retrieve. The note `PARTS_ASKED_BY_NAME` says so. The file that
  comes back is the file of the object, so the object counts among the components that came back although the
  org had not listed them. It is expected to hold those parts and nothing else of the object. A part that
  Salesforce cannot find by its own name either stays missing. Nothing of this is done for an object the org
  lists: then the object is what is missing. Nor is it done for a parent whose parts stay in its one file, such
  as the rules of a workflow. On the one real org this was run against, Salesforce could not find the parts by
  their own names either, and they stayed missing. A real org that hands such a part out was not seen.
- **A snapshot that is interrupted is continued.** The database says at every moment how far a snapshot is. When
  the command is stopped, the network goes away, the login expires or Salesforce stops answering, the snapshot
  stays in the database as unfinished: `status` shows it, and `coverage` and "the latest snapshot" do not count it.
  The next `orglens snapshot <source>` picks it up where it stopped. It asks Salesforce for the retrieve that was
  running, and does not ask again what the org holds. A snapshot that was continued was read from the org at more
  than one time, and an issue says so.
- `--restart` gives the unfinished snapshot up and takes a new one. The snapshot that was given up keeps its
  number and gets the status `failed`. An unfinished snapshot that another version of OrgLens began is given up in
  the same way, without the option.
- One snapshot of a source is taken at a time. A second command for the same source ends with `SNAPSHOT_RUNNING`
  and changes nothing. The lock is the file `.orglens/snapshot-<source>.lock`, which holds the id of the process.
  A lock whose process no longer exists is taken over.
- The name of a source stands for one org. The first snapshot ties the name to the org that answered, also when
  the source declares no `org_id`. A later login that reaches another org is refused with `ORG_MISMATCH`.
- A snapshot is read with one API version from start to end: the newest the org offers when the snapshot is
  begun. `snapshot.apiVersion` says which.
- Every request to the Metadata API gives up when its answer is not complete within 60 seconds, or 10 minutes for
  the request that fetches the files of a chunk. A request that got no answer, or whose answer broke off, is made
  again twice. No request to the Metadata API follows a redirect. A retrieve that Salesforce does not end within
  30 minutes stops the command, and the next run asks for the same retrieve again. If it does not end then
  either, it is started anew. A chunk is started three times in all before it is given up.
- Only metadata is read. OrgLens makes no request for a record. Through the Tooling API it queries one object,
  `MetadataComponentDependency`, which says which component refers to which. One thing is not in its hands:
  when the session of a Salesforce CLI login expires while a snapshot is taken, the Salesforce library renews it
  and asks the org about the org itself (decision record 0031 names the requests).
- What stops the command, with the snapshot left to be continued: `LOGIN_FAILED` with the reason
  `SESSION_EXPIRED` or `ORG_UNREACHABLE`, `WORKSPACE_IO` when the work folder cannot be written, and
  `SOURCE_READ_FAILED` with the reason `REQUEST_REFUSED` (the org said no for a reason that holds whatever is
  asked for, such as a used-up limit of requests, and `details.code` is its code), `RETRIEVE_TOO_SLOW`, or
  `RETRIEVES_FAILING` (20 retrieves in a row failed, and `details.code` is the code of the last one, or `null`).
  `details.snapshot` is the number of the unfinished snapshot.
- While the org is asked what it holds, the same refusal ends the command before a snapshot is stored. So does an
  org that refuses more than half of its listings.
- A login that fails before anything was read ends with `LOGIN_FAILED` or `ORG_MISMATCH` and stores nothing.
- The user of the login needs a permission for the Metadata API. Without it the org refuses the first request,
  and the command ends with `SOURCE_READ_FAILED` (`REQUEST_REFUSED`).
  [configuration.md](configuration.md#a-login-with-a-key-for-a-job-without-a-person) names the permissions.

While an org is read, lines like these go to the standard error stream:

```
Logged in to the org of "prod". It is read with API version 66.0.
Asking the org what it holds: 240 of 312 requests answered.
Snapshot #4: the org lists 11,862 components. They are retrieved in 9 chunks.
Snapshot #4: 1 of 9 chunks is stored.
Snapshot #4: every chunk is done. Asking the Dependency API of Salesforce which references it knows.
Snapshot #4: the Dependency API gave 5,412 rows so far, in 38 requests.
Snapshot #4: its files are stored. Analysing them.
```

A line about the rows so far comes at most every five seconds, so an org that is done with one request has
none. With `--no-cross-check` the lines about the Dependency API are not there.

The files of an org are always in the standard form of a Salesforce project, whatever `sfdx-project.json` of the
folder the command runs in says about the form of labels or permission sets.

Not verified against a real org yet: which types real orgs refuse to list, how Salesforce words the failure of a
retrieve that is too large, folders inside folders, and whether the names in a retrieve always equal the names
the org listed. The mock org the tests use is built from the fixture project, and was also built once from each
of three public codebases.

#### The analysis of a snapshot

The analysis finds the components that the files of a snapshot make up, and which component refers to which.
Today it reads objects, fields and validation rules: the names written in their XML, and the formula of a field,
its default value and the condition of a rule. Every other type is stored and not analysed yet. Decision record
[0043](adr/0043-a-snapshot-is-analysed-from-its-files.md) has the rules, records
[0041](adr/0041-components-and-names-written-in-xml.md) and [0042](adr/0042-the-names-in-a-formula.md) say what
is read and what is not.

- A snapshot is analysed from the files it holds, not from the source. `orglens snapshot` does it after the
  snapshot is stored, also for a snapshot of an org that was interrupted and continued.
- `orglens analyse <source>` analyses the latest snapshot of a source again, or the one given with
  `--snapshot <number>`. The source is not read, and no login is needed. The analysis the snapshot had is
  replaced, and nothing else of the snapshot changes. Use it after an update of OrgLens that analyses more, and
  for a snapshot that an older version took and did not analyse. It migrates a database that an older version
  wrote.
- An analysis is complete or incomplete. It is incomplete when an issue of the analysis has the severity
  `error`: a file of the snapshot could not be read as XML or does not hold what its name says, a component
  could not be analysed, or a file of the snapshot belongs to no component as this version reads it. Each such
  issue costs the analysis that one file or component. For a snapshot of an org there is one more: a reference
  that Salesforce reports and the analysis did not find
  ([the cross-check](#the-cross-check-of-a-snapshot-of-an-org)). `snapshot` and `analyse` then end with the exit
  code `5`, with `ok: true`.
- A warning of the analysis says that a name was not read, a path of names was not followed to its end, or a
  formula was not read as a whole. The analysis is complete all the same: what it did not find is counted and
  shown, and an answer that rests on it has to say so.
- If the analysis fails as a whole, which a full disk or a fault of OrgLens can cause, the snapshot stays as it
  was stored, without an analysis, or with the one it had. The command ends with the error of the failure. Its
  message says that the snapshot is stored, its hint how to analyse it, and `details.snapshot` its number.
- `analyse` refuses a snapshot of an org that has not ended or was given up, with `SNAPSHOT_NOT_FOUND` and the
  state of the snapshot in `details.status`.
- A project file can change which files make up which component, with `sourceBehaviorOptions` (or the older
  `registryPresets`) and `registryCustomizations`. A snapshot of a repository keeps what its own project file
  said when it was read: the one on disk, or the one of the commit for a source with `ref`. Its files are
  analysed with that, whenever and from whatever folder `analyse` runs. A later change of the project file is
  not applied to a snapshot that is stored. The files of an org are read as Salesforce lays them out.
- A snapshot in a database of schema version 3 or older keeps nothing of the kind, and its files are analysed
  as Salesforce lays them out. For a repository whose project changes the layout, take a new snapshot.

Not verified: no snapshot of a real org was analysed by the command. The test org is read by a tool of the
tests.

#### The cross-check of a snapshot of an org

Salesforce keeps a list of which component refers to which, the Dependency API. OrgLens does not answer from
it: it reads less than OrgLens does, and says of no reference where it is. It is a second opinion. Where
Salesforce reports a reference and the analysis has none, the analysis is wrong, and OrgLens says so. Decision
records [0034](adr/0034-dependency-api-is-the-cross-check.md) and
[0045](adr/0045-the-cross-check-of-a-snapshot.md) have the rules.

- `orglens snapshot` of an org or a sandbox asks the API after the last chunk is stored, and keeps its rows with
  the snapshot. `--no-cross-check` leaves it unasked. A source of the kind `git` has no cross-check.
- A snapshot that was interrupted and is continued asks again, and the new reading takes the place of an
  earlier one and of its warning. Continued with `--no-cross-check`, it keeps a reading it already has.
- One query gives at most 2,000 rows and cannot be continued. Where a query reaches that number, the rows are
  asked for in parts: per type of the component that refers, per pair of types, and per group of components.
  A part that is still at the limit, or a query that fails, leaves rows out. The snapshot then has the warning
  `CROSS_CHECK_PARTIAL`, and the report says that rows are missing.
- The groups of components are the components the org listed. Where a type has more of them than one query
  can name, which is 200, nothing shows whether a component the org did not list has a row as well. The
  reading is then `partial` too, and the warning and the report say that rows may be missing.
- The reading stops with what it has after 2,000 requests, which count against the daily limit of the org,
  after three queries in a row that got no answer in 180 seconds, and when the login or the network goes
  away. The report then gives the code of the first failure, such as `REQUESTS_USED_UP` or `TIMEOUT`.
- An org that answers no query, because it does not have the API or not for this user, leaves the warning
  `CROSS_CHECK_NOT_READ`. Neither warning makes a snapshot partial, and nothing about the API stops a snapshot.
- The rows are compared with every analysis of the snapshot. `orglens analyse` compares again from the rows the
  snapshot holds, without asking the org: an update of OrgLens that analyses more is measured against the same
  rows.
- Only rows from a component of a type that is analysed are compared. A row from a class or a flow is counted
  and not compared in this version.
- A component of a row is found by the id the org listed it with. A name is taken only where there is no id:
  for a standard object, which Salesforce names in the place of an id, and for a component the org listed
  without one. A row that names a component the org did not list is counted and not compared.
- **A pair that Salesforce reports and the analysis lacks** is the issue `REFERENCE_MISSED` of the analysis, with
  the severity `error`. It makes the analysis incomplete: `snapshot` and `analyse` end with the exit code `5`,
  and an impact answer from the snapshot says that it may miss something.
- A pair to an object counts as found when the analysis has a reference from the same component to a field or
  another part of that object.
- **A pair that only the analysis has** is no error. It is listed where the API is known to report that kind of
  reference: either the analysis found a reference that is none, or the API left one out, or its row is among
  those that are missing or were not compared, which the report then says. It is only counted
  where the API reports nothing of the kind: a standard field or object, a lookup, the filter of a lookup, a
  roll-up summary apart from its filter, the value set and the controlling field of a picklist, a rule that is
  not active.
- The rows are never part of an answer. `impact` shows the references OrgLens found, and no row of Salesforce.

Not verified: the command was not run against a real org. The test org is read by a tool of the tests, which
compares in the same way. How many requests a large org needs was not measured, and the limit of 2,000 is a
choice without a measurement.

#### The report of a snapshot

`orglens coverage <source>` shows the latest snapshot of a source, or the one given with `--snapshot <number>`.
It ends with `0` also when that snapshot is partial or its analysis is incomplete: showing the report is what it
was asked to do. `snapshot` and `analyse` print the same report.

The first table has one line per metadata type that has components. For an org, the column `LISTED` says
`not listed` for a type Salesforce never lists and `left out` for a type that `exclude_types` of the source
leaves out, and adds `(listing failed)` to the number of a type the org refused to list in whole or in part. The
column `ANALYSED` says of how many components of the type the analysis read something. It is `0` for a type that
is not analysed yet. It can be larger than `RETRIEVED`: the analysis also counts the fields and rules it finds
inside the file of an object, and a type of which the source lists nothing can have a line for that reason.

Below it stand the issues of the reading, then the analysis, and for a snapshot of an org the cross-check:

```
Analysed by engine 0.1.0: 89 components, 106 references.

ORIGIN          COMPONENTS  REFERENCES  NOT RESOLVED  PATHS NOT FOLLOWED  FILES NOT READ
parser:xml      69          26          0             0                   0
parser:formula  34          80          0             0                   0
```

There is one line for each origin of references that this version analyses. `COMPONENTS` are the components
the analyser looked at: for `parser:formula`, those with a formula or a default value. `NOT RESOLVED` are the
references that are `unresolved`: a custom name that no file of the snapshot defines and that is not of a
package. A standard name, such as a field of `Account`, and a name of a package are `external` and not counted. `PATHS NOT FOLLOWED` are the paths of names
that could not be walked to their end. `FILES NOT READ` are the files the analyser tried to read and could not:
for `parser:formula`, the files with a formula that was not read as a whole, whose names are recorded as
`probable`. The number of components includes the parts found inside files, and the objects that are only
named.

The issues of the analysis follow, one line per code with their number and the first of them: an org can have
hundreds. `--json` has every issue. A snapshot without an analysis says so, and names the command that analyses
it. `orglens status` says in the column `ANALYSED` whether the latest snapshot of a source is analysed, and by
which version of the engine.

The cross-check of a snapshot of an org comes last:

```
Cross-check: the Dependency API of Salesforce reports 120 rows. No query left a row out.
61 rows are from a component of a type this version does not analyse, and are not compared: ApexClass 60, CustomMetadata 1.
1 row names a component the org did not list, and is not compared.
2 rows are from a component the snapshot does not hold or that was not analysed, and are not compared.
56 rows were compared. They are 50 pairs of components: the analysis has 46 of them, has 2 as a reference to a part of the object Salesforce names, and missed 2.

Salesforce reports these references, and the analysis has none. Each is an error of the analysis:
FROM                                       TO
CustomField:invoice__c.total__c            CustomField:invoice__c.status__c
ValidationRule:invoice__c.amount_positive  CustomField:invoice__c.amount__c

The analysis has 38 more references of kinds the API does not report: lookup 7, standard-field 31.
```

Several rows can name the same two components, so there are fewer pairs than rows. A list of pairs shows the
first 20, and `--json` has all of them. A snapshot of an org that was taken with `--no-cross-check`, or before
this version, says that the API was not asked. A snapshot of a repository says nothing.

Where the reading is not whole, the first line says why in the place of "No query left a row out.":

```
Cross-check: the Dependency API of Salesforce reports 9,214 rows. Rows are missing: 2 queries were cut off at the limit of the API or failed (TIMEOUT). Rows of a component the org did not list may be missing: 1 query at the limit of the API was asked again component by component.
```

The list of the references that only the analysis has then says that their rows can be among those that are
missing or not compared.

In `--json`, `crossCheck` is `null` when the API was not asked. Otherwise it holds:

| Field                            | Meaning                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state`                          | `whole`: no query left a row out. `partial`: rows are missing, or may be. `none`: the org answered no query, and nothing was compared.                       |
| `readAt`, `requests`, `rows`     | When the API was read, with how many requests, and how many different rows the snapshot holds.                                                               |
| `queriesCutOff`, `queriesFailed` | Queries that reached the limit with no smaller part to ask for, and queries that failed and whose rows no other query gave.                                  |
| `queriesNotProven`               | Queries at the limit that were asked again per component, for more components than one query names. Rows of a component the org did not list may be missing. |
| `code`                           | The code of the first failure, such as `INVALID_TYPE`, `TIMEOUT` or `REQUESTS_USED_UP`, or `null`. The last is a code of OrgLens.                            |
| `comparison`                     | What the comparison found, or `null` if nothing was compared: the API gave nothing, or the snapshot has no analysis with a comparison.                       |

`comparison` holds:

| Field                            | Meaning                                                                                                                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rows`                           | The rows that were looked at.                                                                                                                                                                                                                       |
| `rowsNotAnalysed`, `notAnalysed` | Rows from a component of a type the analysis does not read, in all and per `type`, with `rows`. The type is the metadata type where the row was matched, `CustomMetadata` for a record of a custom metadata type, and else the type the API writes. |
| `rowsNotMatched`                 | Rows with an end that is no component the org listed.                                                                                                                                                                                               |
| `rowsNotHeld`                    | Rows from a component of an analysed type that the snapshot does not hold or whose analysis failed.                                                                                                                                                 |
| `rowsCompared`, `pairs`          | The rows that were compared, and the different pairs of components they are.                                                                                                                                                                        |
| `agreed`                         | Pairs the analysis has as well.                                                                                                                                                                                                                     |
| `coveredByPart`                  | Pairs to an object for which the analysis has a reference from the same component to a part of the object, and none to the object.                                                                                                                  |
| `missed`                         | Pairs Salesforce reports and the analysis lacks, each with the keys `from` and `to`. Each is also an issue `REFERENCE_MISSED`.                                                                                                                      |
| `onlyOrgLens`                    | Pairs the analysis has, of a kind the API reports, without a row that was compared.                                                                                                                                                                 |
| `notReported`                    | Pairs the analysis has without a row, of a kind the API does not report: per `reason`, with `pairs`.                                                                                                                                                |

The values of `reason` are `standard-field`, `standard-object`, `inactive-rule`, `lookup`, `lookup-filter`,
`roll-up-summary`, `controlling-field`, `value-set`, `display-field`, `default-value` and `other`. A later
version can add one.

The issue codes of the reading (`stage` is `read`):

| Severity  | A source of the kind `git`                                                                                          | An org or a sandbox                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`   | `FOLDER_MISSING`, `FOLDER_UNREADABLE`, `FILE_UNREADABLE`, `NAME_NOT_UTF8`, `RESOLVE_FAILED`, `APEX_FILE_UNRESOLVED` | In the logic tier: `LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED`, `RESOLVE_FAILED`                                                                                                                                                                                                |
| `warning` | `LINK_SKIPPED`, `FILES_NOT_METADATA`, `COMPONENT_DEFINED_TWICE`, `PROJECT_FILE_INVALID`                             | Outside the logic tier: `LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED`, `RESOLVE_FAILED`. In any tier: `TYPE_NOT_READ`, `TYPE_NOT_EXCLUDED`, `ACCESS_INCOMPLETE`, `RETRIEVE_MESSAGES`, `FILES_NOT_METADATA`, `FILE_RETRIEVED_TWICE`, `CROSS_CHECK_NOT_READ`, `CROSS_CHECK_PARTIAL` |
| `info`    | `FILES_IGNORED`, `COMMIT_UNKNOWN`, `WORKING_TREE_MODIFIED`, `CHANGED_WHILE_READ`                                    | `CHUNK_SPLIT`, `UNLISTED_COMPONENTS`, `RETRIEVED_WITHOUT_PREFIX`, `PARTS_ASKED_BY_NAME`, `SNAPSHOT_RESUMED`, `SNAPSHOT_GIVEN_UP`, `TYPES_EXCLUDED`                                                                                                                                       |

An issue about several components of an org carries their number in `details.count` and at most the first 50
names in `details.components`. `LISTING_FAILED`, `TYPE_NOT_READ`, `NOT_RETRIEVED`, `UNLISTED_COMPONENTS` and
`RETRIEVED_WITHOUT_PREFIX` name the type in `details.type`. The names of `RETRIEVED_WITHOUT_PREFIX` are the ones
the org lists, with the prefix. `PARTS_ASKED_BY_NAME` counts and names the components Salesforce cannot find, each
as type and name, and carries the number of parts that are asked for in `details.parts`. `RETRIEVE_FAILED` and
`CHUNK_SPLIT` carry what Salesforce said in `details.said`, and
`RETRIEVE_MESSAGES` its remarks in `details.messages`. `LISTING_FAILED`, `RETRIEVE_FAILED` and `CHUNK_SPLIT` carry
the code Salesforce gave for its refusal in `details.code`, or `null` if it gave none. A program reads the code
there and not out of the text. `CROSS_CHECK_NOT_READ` carries the code of the first failure in `details.code` and
the number of requests in `details.requests`. `CROSS_CHECK_PARTIAL` carries `details.cutOff`, `details.failed`,
`details.unproven`, `details.code` and `details.rows`.

`LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED` and `RESOLVE_FAILED` of an org carry `details.tier`: `logic`
for an error, `other` for a warning. `RETRIEVE_FAILED` carries the types of its components in `details.types`,
sorted. Those are the types that are retrieved by name: a field that fails with its object is not named.
`RESOLVE_FAILED` carries in `details.types` the types the file or component can be of: the type of the
component, or the types that keep their files in the top folder of the file with the types of their parts. The
types are those the Salesforce library knows for the folder. Where it knows none, they are the types the org
describes with that folder, and `details.describedByOrg` is `true`. The list is empty when nothing tells the
type. When the org was asked for its types and refused, the message says so and what the org answered. A
snapshot taken before these fields existed has issues without them.

`TYPES_EXCLUDED` carries the types a snapshot left out in `details.types`, sorted, and their number in
`details.count`: the types `exclude_types` names, with their parts and their folders. `TYPE_NOT_EXCLUDED` carries
the name in `details.type` and why it was not left out in `details.reason`: `unknown` (the org describes no such
type), `part` or `folder` (its components are parts or folders of the type in `details.of`), or `logic-part` (the
type in `details.of`, a part of it, is of the logic tier). No type of Salesforce is known that gives
`logic-part`. A fifth value, `logic`, says that the type is of the logic tier itself. The file is refused for
such a name, so no snapshot of this pre-release has it.

An issue about several files carries their number in `details.count` and at most the first 50 paths in
`details.paths`. `COMPONENT_DEFINED_TWICE` carries at most the first 50 components in `details.components`, each
with its `type`, its `fullName` and the `paths` of its definitions. Only components without parts are looked at:
a class or a field in two package directories is reported, an object whose file is in two of them is not.

The issue codes of the analysis (`stage` is `analysis`), for every kind of source:

| Severity  | Code                                               | Situation                                                                                                                                                                                                                                               |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`   | `FILE_UNREADABLE`                                  | A file of the snapshot could not be read from the database.                                                                                                                                                                                             |
| `error`   | `XML_NOT_UTF8`, `XML_MALFORMED`, `XML_UNSUPPORTED` | A file is not text in UTF-8, is not well-formed XML, or holds something the reader of OrgLens does not read.                                                                                                                                            |
| `error`   | `METADATA_UNEXPECTED`                              | A file holds another type than its name says, or a part inside it has no name.                                                                                                                                                                          |
| `error`   | `KEY_INVALID`, `KEY_COLLISION`                     | The name of a component gives no key, or two components give the same key.                                                                                                                                                                              |
| `error`   | `ANALYSIS_FAILED`                                  | The analysis of one component failed. The component is kept, without attributes and references. This points at a bug.                                                                                                                                   |
| `error`   | `RESOLVE_FAILED`                                   | A file of the snapshot could not be read as metadata by the Salesforce library.                                                                                                                                                                         |
| `error`   | `REFERENCE_MISSED`                                 | Salesforce reports that a component refers to another, and the analysis found no such reference (`details.from`, `details.to`, and `details.origin`, which is `dependency-api`). Only a snapshot of an org that was cross-checked can have it.          |
| `error`   | `FILES_NOT_PLACED`                                 | Files of the snapshot belong to no component (`details.count`, `details.paths`): another file of their component is missing, such as the `-meta.xml` file of a class that went away while the source was read, or this version places them differently. |
| `warning` | `NAME_NOT_READ`                                    | A value that should be a name is not built like one. No reference is made for it.                                                                                                                                                                       |
| `warning` | `PATH_NOT_FOLLOWED`                                | It is not known where a relationship leads, so the names after it have no reference (`details.origin` says whose).                                                                                                                                      |
| `warning` | `ELEMENT_NOT_FOUND`                                | A component that the Salesforce library finds inside a file, such as one custom label, is not found there by its name.                                                                                                                                  |
| `warning` | `FORMULA_NOT_READ`                                 | A formula was not read as a whole. The names among its tokens are recorded as `probable`.                                                                                                                                                               |

An issue of the analysis names the component it is about in `component`, by its key, when it is about one
component. An issue about a file as a whole, such as one of the three codes of the reader, names the file in
`details.path` and has `component: null`. Every issue of the reading has `component: null`.

### Impact

`orglens impact <component>` answers the question the tool is for: if this component changes or goes away, what
is affected? It shows every component of a snapshot that refers to the component, directly or through other
components.

```
$ orglens impact Invoice__c.Amount__c
What refers to CustomField:invoice__c.amount__c (Invoice__c.Amount__c), in snapshot #1 of "repo".
The answer is not complete: 7 types are not analysed yet. The details are below the answer.

7 components refer to it, 6 of them directly.

DEPTH  COMPONENT                              CONFIDENCE  KIND   REFERS TO                         WHERE
1      CustomField:invoice__c.late_fee__c     confirmed   reads  CustomField:invoice__c.amount__c  force-app/…/Late_Fee__c.field-meta.xml:6
1      CustomField:invoice__c.total__c        confirmed   reads  CustomField:invoice__c.amount__c  force-app/…/Total__c.field-meta.xml:4
2      CustomField:invoice__c.grand_total__c  confirmed   reads  CustomField:invoice__c.total__c   force-app/…/Grand_Total__c.field-meta.xml:4
…

Not analysed yet. A component of these types may refer to it, and is not in the answer:
TYPE         LISTED  RETRIEVED
ApexClass    12      12
ApexTrigger  1       1
…
```

The example is shortened: the command prints every line and every path in full.

| Option                    | Meaning                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `--source <name>`         | The source to ask. It can be left out in a workspace that declares exactly one source.             |
| `--snapshot <number>`     | The snapshot to ask. Default: the latest snapshot of the source that ended as complete or partial. |
| `--depth <number>`        | How many references away from the component the answer goes at most. Default: no limit.            |
| `--min-confidence <tier>` | Follows only references that are at least this certain: `confirmed`, `probable` or `possible`.     |
| `--outgoing`              | Shows what the component refers to, in place of what refers to it.                                 |

**How the component is named.** By its name (`Account.Industry`), by its type and name
(`CustomField:Account.Industry`) or by its key (`CustomField:account.industry`). Upper and lower case do not
matter. A name alone is looked up among the types the snapshot holds and the types OrgLens knows by name. If it
fits components of several types, the command ends with `COMPONENT_AMBIGUOUS` and lists their keys. The snapshot
also knows a component that it does not hold and that something in it refers to, such as a standard field:
`orglens impact Account.Name` works in a repository that has no file for that field. A component of that kind
whose type is neither in the snapshot nor known to OrgLens by name is not found by its name alone: name it with
its type.

**What the answer holds.**

- One line per component that refers to the component, at any distance. `DEPTH` is the number of references
  between the two, on the shortest chain. A component is in the answer once, however many chains lead to it.
- `REFERS TO` and `WHERE` are the reference the component is found by: what the component of the line itself
  refers to, and the file and line where it does. For a depth of 2 and more, `REFERS TO` is another line of the
  answer, one reference nearer, and that line shows the next reference of the chain.
- `CONFIDENCE` is the weakest confidence on the chain. Among several chains of the same length, the answer shows
  the one whose weakest reference is the most certain.
- One line shows one reference. If a component refers to the same target at several places, the answer shows
  one of them: the one that makes the chain most certain, and among those the first in the file. The other
  places are not listed.
- For a component that contains others, such as an object with its fields and validation rules, the answer is
  about everything it contains too: what refers to any of them is in the answer. The second line says how many
  components that are. What the component contains is never a line of the answer itself.
- A component that is found is followed from itself only. If a field refers to the component, the answer goes
  on with what refers to that field, not with what refers to its object or to the other fields of its object.
- With `--depth`, the answer says whether references lead further than it goes.
- With `--outgoing`, the same is shown in the other direction: what the component refers to, and what those
  refer to. A name that has no key, so that no component stands for it, is listed in a table of its own.

**What the answer does not cover.** An answer can only hold what was read and analysed. Before the first result,
the answer says whether it is complete, and if not, why. Below the results it names what it does not cover:

- the types of the snapshot that no analyser has read yet, with the number of components the source has of each.
  A component of such a type can refer to the component and is not in the answer. In this pre-release, that is
  every type except objects, fields and validation rules. A type that `exclude_types` leaves out of a snapshot
  of an org is among them, with `left out` for its number;
- the analysed types of which the snapshot holds less than the source has, also when it holds nothing of them;
- how many files or folders could not be read, and how many errors the analysis had, with the command that shows
  them. A warning of an org snapshot about something outside the logic tier is counted with them when it can be
  about a type the answer covers: a type the analysis read, or one of which it analysed a component. No type
  outside the tier is analysed in this pre-release, so no such warning is counted yet;
- how many warnings the analysis had. A warning says that a name was not read, a path of names was not followed
  to its end, or a part of a file was not found. A reference may be missing for each;
- for `--outgoing`, how many components of the answer the snapshot does not hold, such as a standard field or a
  component of a package. What such a component refers to is not known.

An answer is complete only if none of these applies. The warnings are those of the whole snapshot, not only
those of the components in the answer.

For `--outgoing`, a type that is not analysed counts only if the component, something it contains or a result
is of it: what a component refers to is known once the component itself is analysed.

Whether a type is analysed is read from the snapshot, not from the version of OrgLens that answers: an analysis
records the types it read. A snapshot that an older version analysed covers what that version read.
`orglens analyse <source>` analyses it again. An analysis from before the database kept that list (schema
version 4 or older) has none, and a type then counts as analysed if the snapshot holds an analysed component of
it. An analysed type of which such a snapshot holds nothing is listed as not analysed there, not as partial.

`impact` only reads, so it does not migrate a database that an older version of OrgLens wrote. It ends with
`STORE_OUTDATED`. `orglens analyse <source>` or `orglens snapshot <source>` migrates the database.

**Exit codes.** `0` for an answer that misses nothing of a type it covers. Types that are not analysed yet do
not change that: the answer names them, and a script would otherwise fail on every run. Warnings of the analysis
and components the snapshot does not hold do not change it either. `5` if the answer may miss something of a type
it covers: an analysed type is partial in the snapshot, a file or a folder could not be read, or the analysis
had an error. `2` if no component has the name or several have, and for a workspace with several sources when
`--source` is missing. A snapshot that was never analysed ends with `SNAPSHOT_NOT_ANALYSED` and the exit code
`1`, and the hint names the command that analyses it. A script that needs a complete answer reads
`data.complete`: the exit code `0` does not say it.

**The data of `--json`:**

| Field           | Meaning                                                                                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `snapshot`      | `id`, `source`, `kind`, `status` (`complete` or `partial`), `finishedAt`, and `analysedBy`: the version of the engine that analysed it.                                                                                                         |
| `component`     | The component that was asked about: `key`, `type`, `name` and `file`. `name` and `file` are `null` for a component the snapshot does not hold.                                                                                                  |
| `parts`         | How many components of the snapshot it contains.                                                                                                                                                                                                |
| `direction`     | `incoming` or `outgoing`.                                                                                                                                                                                                                       |
| `depth`         | The depth that was asked for, or `null` for no limit.                                                                                                                                                                                           |
| `beyondDepth`   | `true` if the answer stops at `depth` and references lead further.                                                                                                                                                                              |
| `minConfidence` | The least confidence that was asked for.                                                                                                                                                                                                        |
| `results`       | Sorted by `depth`, then by `key`. Each has `key`, `type`, `name`, `file`, `depth`, `confidence` (the weakest on its chain) and `reference`.                                                                                                     |
| `reference`     | The reference a result is found by, with `from`, `to`, `kind`, `origin`, `confidence`, `resolution`, `file`, `line`, `column`. For `incoming`, `from` is the result and `to` is one reference nearer. For `outgoing` it is the other way round. |
| `unresolved`    | For `outgoing`: the references to a name without a key. Each has `from`, the `type` and `name` of the target as they were written, `kind`, `origin`, `confidence`, `resolution`, `file`, `line`, `column` and `depth`. Empty for `incoming`.    |
| `complete`      | `true` if nothing is known to be missing from the answer: both lists of `notCovered` are empty and its four numbers are `0`.                                                                                                                    |
| `notCovered`    | `notAnalysed` and `partial`: lists of types with `type`, `listed`, `retrieved` and `listing`. `readErrors`, `analysisErrors`, `analysisWarnings` and `notHeld`: numbers. `notHeld` is `0` for `incoming`.                                       |
| `mayMiss`       | `true` if `partial` is not empty, or `readErrors` or `analysisErrors` is not `0`. This is what the exit code `5` says. `analysisWarnings` and `notHeld` make `complete` false and leave `mayMiss` as it is.                                     |

**The chain behind a result.** A result holds one reference and not its whole chain. The nearer end of that
reference is the key of another result, of the depth before, which holds the next reference. At depth 1 the
nearer end is the component that was asked about, or something it contains, and the chain ends there. A program
follows the chain by looking up that key among the results. An answer with every chain written out grows with
the number of results times their depth: the largest answer that was measured had 104,760 results up to 21
references away, and was 443 MB of JSON that way.

What is not done, and what a user should know:

- The answer holds references, not consequences. It does not say what breaks when a field is deleted or its type
  changes. That is a later phase.
- Only objects, fields and validation rules are analysed. Apex, flows, layouts, permissions and the other types
  follow in later phases. Until then an answer about what refers to a component of a real project says that it
  is not complete. An answer with `--outgoing` can be complete, because it needs only the component and its
  results to be analysed.
- The text output is one table, sorted by depth and then by key. It is not grouped by type or by depth.
- An answer can be large: a field that much of an org rests on can have tens of thousands of results.
  `--depth` and `--min-confidence` make it smaller. There is no option yet that limits the number of results.
- A snapshot of an org that is still running or was given up cannot be asked. The command ends with
  `SNAPSHOT_NOT_FOUND` and the state of the snapshot in `details.status`.
- Not verified: no snapshot of a real org was asked by the command. The answers are checked against the answer
  key of the fixture project, and the time is measured on synthetic orgs
  ([store-benchmark.md](research/phase-1/store-benchmark.md)).

### Logins

OrgLens never asks for a password and stores no credential. For an org or a sandbox it uses a login that exists
already, found in this order:

1. **A private key in the environment**, for a job that runs without a person. The variables carry the name of
   the source in upper case, with `_` for `-`. For a source `prod`: `ORGLENS_JWT_PROD_USERNAME`,
   `ORGLENS_JWT_PROD_CLIENT_ID`, and the key in `ORGLENS_JWT_PROD_KEY` or the path of its file in
   `ORGLENS_JWT_PROD_KEY_FILE`. [configuration.md](configuration.md#environment-variables) describes them. As soon
   as one of them is set, the source is logged in with the key. Half a set is an error and never a reason to use
   the login of whoever runs the job. Neither is a key whose user also has a Salesforce CLI login on the machine:
   that is refused (`JWT_USER_HAS_LOGIN`), because the Salesforce library would mix the two.
2. **The Salesforce CLI login that is linked to the source**: `orglens source link prod my-alias`. The login is
   named by its alias or its user name, as `sf org list` shows it. The choice is personal and goes into
   `.orglens/local.toml`. The login itself stays with the Salesforce CLI.
3. **The one Salesforce CLI login of the declared org**: a source that declares its `org_id` needs no link when
   exactly one login on this machine belongs to that org.

The Salesforce CLI does not have to be installed for a login with a key. For the other two, a person has logged in
with it before (`sf org login web`). OrgLens does not start the `sf` program.

`orglens source link <name> <login>` checks that the login exists and that it belongs to the org the source
declares, and connects to nothing. `orglens source check <name>` logs in, asks the org which org it is, and
reports the route (`login.via`: `jwt-env`, `linked` or `org-id`), the id of the org and the API version OrgLens
uses, which is the newest the org offers. For a login with a key, the user name and the address of the org are
`null` in the output and absent from the text: they come from secrets, and the output of a job is read by others.

- A login that belongs to another org than the `org_id` of the source is refused with `ORG_MISMATCH`, by `link`
  from what the Salesforce CLI knows and by `check` from what the org itself says. A source without `org_id`
  accepts any login, and both commands say which `org_id` to add.
- `source check` ends with the exit code `4` when no login is found, the login no longer works, or the org does
  not answer (`LOGIN_FAILED`, with the cause in `details.reason`), and for `ORG_MISMATCH`.
- The requests OrgLens makes itself give up when no answer starts within 30 seconds: the login with a key, the
  list of API versions, and the question who is logged in. The requests the Salesforce library makes while it
  renews a session have the library's own limit, which is far longer. They go to the address that has just
  answered the list of versions.
- A Salesforce CLI login whose session has expired is renewed by the Salesforce library, which writes the new
  session into the login file of the Salesforce CLI, as the CLI itself does. While it does, the library asks the
  org three things of its own: whether it is a Dev Hub, which API versions it has, and its name and kind.
  [Record 0031](adr/0031-logins-and-the-home-folder.md) lists every file that is read or written.
- For a source of the kind `git`, `source check` reads everything a snapshot would read and stores nothing. It
  reports the commit, the number of components and files, and the issues, and ends with `5` if a snapshot taken
  now would be partial.

### Global options

| Option                 | Meaning                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `--json`               | Write the result as one line of JSON. Allowed anywhere on the command line before `--`.   |
| `--workspace <folder>` | The workspace folder. Without it, the workspace is found from the current folder upwards. |
| `-h`, `--help`         | Show help and exit with `0`. Help is always text, also with `--json`.                     |
| `-V`, `--version`      | Print the version line and exit with `0`. Always text.                                    |

`orglens` without any argument shows the help and exits with `0`.

## Text output

Without `--json`, the result of a command goes to the standard output and is written for people. Its wording and
layout are **not** a contract and change without notice. Do not parse it: use `--json`.

A failure goes to the standard error stream:

```
error: No source named "nope" is declared.
hint: Declared sources: prod, repo.
```

A configuration with several problems prints the first after `error:` and the others below it, one per line.

Names and messages can come from files. Before a line is printed, every control character other than the tab,
line feeds included, and
every character that reorders text, is replaced by `�` (U+FFFD), so that the content of a file cannot hide or
rewrite the lines around it.

## JSON output

With `--json`, a command writes exactly one line to the standard output and nothing to the standard error stream.
The line is one JSON object, the envelope, followed by a line feed. This holds for a success, for a failure and
for a command line that cannot be understood.

One thing OrgLens does not control: Node.js prints the warnings of a library to the standard error stream. The
Salesforce libraries warn about a variable they no longer like, such as `SFDX_USE_GENERIC_UNIX_KEYCHAIN`, and
about an address that starts with `http://`. Read the result from the standard output only.

```json
{
  "schemaVersion": 1,
  "command": "source remove",
  "ok": false,
  "data": null,
  "warnings": [],
  "error": {
    "code": "SOURCE_NOT_FOUND",
    "message": "No source named \"nope\" is declared.",
    "hint": "Declared sources: prod, repo.",
    "details": {}
  }
}
```

| Field           | Type           | Meaning                                                                                                                     |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | number         | The version of the envelope. `1` today.                                                                                     |
| `command`       | string or null | The command that ran, such as `"status"` or `"source add"`. `null` when the command line was rejected before a command ran. |
| `ok`            | boolean        | `true` if the command ran and has a result. `false` if it failed.                                                           |
| `data`          | object or null | The result of the command. `null` exactly when `ok` is `false`.                                                             |
| `warnings`      | array          | Things the user should know that did not stop the command: objects with `code` and `message`. No command produces one yet.  |
| `error`         | object or null | The failure. `null` exactly when `ok` is `true`.                                                                            |

The error object:

| Field     | Type           | Meaning                                                                                         |
| --------- | -------------- | ----------------------------------------------------------------------------------------------- |
| `code`    | string         | A stable code from the table below. Branch on this, never on the message.                       |
| `message` | string         | What went wrong, for a person. The wording can change.                                          |
| `hint`    | string or null | What the user can do about it.                                                                  |
| `details` | object         | Facts about the failure for a program. Empty if there are none. It never contains a credential. |

**`ok` and the exit code are two things.** `ok` says whether the command produced its result. The exit code says
how the run ended for a script. `orglens doctor --json` with a failed check has `ok: true`, because the report is
there, `data.ok: false`, and the exit code `1`.

The output is one line of printable text: line breaks and control characters inside text are escaped by JSON
itself, and the characters U+007F to U+009F, U+2028 and U+2029 are written as `\u` escapes too. Other characters,
including non-Latin letters, are written as they are, in UTF-8.

### The schema

The exact shape of the envelope and of `data` for every command is a JSON Schema (draft 2020-12):
[`packages/cli/schemas/output.schema.json`](../packages/cli/schemas/output.schema.json). It is shipped in the
package and can be loaded as `sf-orglens/schemas/output.schema.json`. The tests validate every output they produce
against it, so the schema and the commands cannot drift apart unnoticed.

The schema is written by hand, not generated from the types. It describes the output of the release it ships
with exactly and allows no other fields.

`data` in short:

| Command         | `data`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`          | `root` (absolute path), `created` (the files this run created, relative to the workspace), `existing` (true if `orglens.toml` was already there).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `source add`    | `source`: the declaration as it was written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `source list`   | `sources`: the declarations, in the order of the file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `source remove` | `removed`: the name of the source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `source link`   | `source`, `login` (as it was given), `username`, `orgId` (of the login, as the Salesforce CLI knows it, or `null`), `declaredOrgId` (of the source, or `null`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `source check`  | For an org or a sandbox: `source`, `kind`, `login` (`via`, `alias`, `username`), `org` (`id`, `instanceUrl`, `apiVersion`), `declaredOrgId`. For a source of the kind `git`: `source`, `kind`, `complete`, `commit`, `dirs`, `components`, `files`, `bytes`, `issues`.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `status`        | `root`, `name`, `configFiles`, `store` (file, driver, `state`, schema version, size, problem), `sources` (declaration, `snapshots`: the number of snapshots that ended as complete or partial, `latestSnapshot`: the latest of them, with `analysis`: `engineVersion` and `analysedAt`, or `null` if it is not analysed, `unfinishedSnapshot`: `id`, `startedAt`, `chunksDone`, `chunks`, or `null`).                                                                                                                                                                                                                                                                                                                            |
| `snapshot`      | `snapshot` (`id`, `source`, `kind`, `status`, `startedAt`, `finishedAt`, `engineVersion`, `apiVersion`, `commit`, `files`, `bytes`), `types` (per metadata type: `listed`, `retrieved`, `analysed`, `listing`, `note`), `analysis` (`engineVersion`, `analysedAt`, `components`, `references`, `complete`, `origins`: per origin `origin`, `components`, `failedFiles`, `references`, `unresolved`, `pathsNotFollowed`), or `null` for a snapshot that is not analysed, `crossCheck` (how the Dependency API was read, and `comparison`), or `null` for a snapshot the API was not asked for, `issues` (`stage`, `severity`, `code`, `message`, `component`, `details`): those of the reading first, then those of the analysis. |
| `analyse`       | The same as `snapshot`, for the snapshot that was analysed again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `impact`        | `snapshot`, `component`, `parts`, `direction`, `depth`, `beyondDepth`, `minConfidence`, `results`, `unresolved`, `complete`, `notCovered`, `mayMiss`. The section [Impact](#impact) describes them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `coverage`      | The same as `snapshot`, for a snapshot that was taken before.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `doctor`        | `ok`, `engineVersion`, `checks`: one object per check with `id`, `status` (`ok`, `warning`, `failed`, `skipped`), `summary` and `details`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

A source is written with all keys of its kind, and `null` for what is not set. `excludeTypes` of a source of the
kind `org` or `sandbox` is the list of `exclude_types`, sorted, and an empty list when the key is not set. Only
the JSON output shows it: the text of `status` and of `source list` does not. Keys are in camel case (`orgId`,
`sandboxOf`), whereas the configuration file uses snake case (`org_id`, `sandbox_of`). Paths inside the workspace
use forward slashes on every system. `root` is an absolute path in the form of the system.

### What may change, and what may not

Within one `schemaVersion`:

- A field is never removed and never changes its type or meaning.
- An error code is never renamed and never reused for another meaning. An exit code never changes its meaning.
- Fields, commands, error codes, issue codes, checks of `doctor` and values of a `state` or `status` field **can
  be added**.
  A program that reads the output ignores fields it does not know and handles values it does not know.

A change that breaks the first two rules raises `schemaVersion` and is announced in the changelog. Until the first
release, the contract can still change with a pull request that says so.

## Exit codes

| Code | Name       | Meaning                                                                       |
| ---- | ---------- | ----------------------------------------------------------------------------- |
| `0`  | ok         | The command did what it was asked to do. Help and version end with `0` too.   |
| `1`  | failure    | The command failed, or `doctor` found a check that failed.                    |
| `2`  | usage      | The command line or the configuration is wrong. Nothing was changed.          |
| `3`  | gate       | A threshold was crossed, for example an impact above the limit a CI job sets. |
| `4`  | connection | A login is missing or has expired, or the org cannot be reached.              |
| `5`  | partial    | The result is there and it is incomplete.                                     |

`snapshot` ends with `5` when the snapshot it stored is partial or its analysis is incomplete, `analyse` when the
snapshot it analysed is partial or its analysis is incomplete, and `source check` when a snapshot of the folders
would be partial. A snapshot of an org that lacks something of a type outside the logic tier is complete, and
does not end a command with `5`. `impact` ends with `5` when its answer may miss something of a type it covers
(`data.mayMiss`). `source check`, `source link` and `snapshot` of an org end with `4` for a problem with a login.
No command ends with `3` yet.
The code is fixed now, so that scripts written today keep their meaning when the commands that use it arrive.

## Error codes

| Code                     | Exit | Situation                                                                                                          |
| ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------ |
| `USAGE`                  | 2    | The command line cannot be understood: an unknown command or option, a missing argument.                           |
| `CONFIG_INVALID`         | 2    | A configuration file, or an environment variable that overrides it, has a problem.                                 |
| `CONFIG_NOT_EDITABLE`    | 2    | `orglens.toml` is written in a way OrgLens cannot change safely. Edit it by hand.                                  |
| `WORKSPACE_NOT_FOUND`    | 2    | No workspace: no `orglens.toml` in this folder or in a folder above it.                                            |
| `WORKSPACE_EXISTS`       | 2    | A workspace cannot be created here, because the folder already belongs to one.                                     |
| `SOURCE_NOT_FOUND`       | 2    | No source with this name is declared.                                                                              |
| `SOURCE_EXISTS`          | 2    | A source with this name is already declared.                                                                       |
| `SOURCE_INVALID`         | 2    | The declaration of a source breaks a rule of the configuration.                                                    |
| `SOURCE_IN_USE`          | 2    | The source cannot be removed, because another source refers to it.                                                 |
| `SNAPSHOT_NOT_FOUND`     | 2    | The source has no snapshot yet, or none with the given number, or none that can be analysed or asked.              |
| `COMPONENT_NOT_FOUND`    | 2    | The snapshot knows no component with the name that was given to `impact`.                                          |
| `COMPONENT_AMBIGUOUS`    | 2    | The name fits components of several types. `details.candidates` lists their keys.                                  |
| `KEY_INVALID`            | 2    | A component key does not follow the key grammar.                                                                   |
| `LOGIN_FAILED`           | 4    | No login for the org of a source was found, the login did not work, or the org is silent.                          |
| `ORG_MISMATCH`           | 4    | The login belongs to another org than the one the source declares.                                                 |
| `WORKSPACE_IO`           | 1    | A file or folder of the workspace could not be read or written.                                                    |
| `SOURCE_READ_FAILED`     | 1    | A source could not be read: its repository, its folders, its commit, or an org that stopped answering as expected. |
| `SNAPSHOT_RUNNING`       | 1    | Another process is taking a snapshot of this source.                                                               |
| `SNAPSHOT_NOT_ANALYSED`  | 1    | The snapshot has no analysis, so nothing is known about its references. The hint names the command.                |
| `STORE_NOT_FOUND`        | 1    | The workspace has no database yet, and the command only reads.                                                     |
| `STORE_FOREIGN`          | 1    | The file at the place of the workspace database was not created by OrgLens.                                        |
| `STORE_NEWER`            | 1    | The database was written by a newer version of OrgLens.                                                            |
| `STORE_OUTDATED`         | 1    | The database needs a migration, and the command only reads.                                                        |
| `STORE_BUSY`             | 1    | Another process holds the write lock of the database.                                                              |
| `STORE_MIGRATION_FAILED` | 1    | A migration of the database failed and was rolled back.                                                            |
| `STORE_FAILED`           | 1    | The database could not be opened, read or written.                                                                 |
| `REFERENCE_INVALID`      | 1    | A reference record breaks a rule of the reference vocabulary. This points at a bug.                                |
| `INTERNAL`               | 1    | An unexpected failure. This is a bug in OrgLens.                                                                   |

`USAGE` is raised by the command line itself. All other codes come from the engine, so the local web UI and other
clients of the engine see the same codes.

For `CONFIG_INVALID`, `details.diagnostics` lists every problem: objects with `file`, `line`, `column`, `path`,
`message` and `text`.

For `SOURCE_READ_FAILED`, `details.reason` is one of `REPO_NOT_FOUND`, `PROJECT_FILE_MISSING`,
`PROJECT_FILE_INVALID`, `LAYOUT_UNKNOWN`, `LAYOUT_INVALID`, `FILE_UNREADABLE`, `FOLDERS_MISSING`, `REF_NOT_FOUND`, `OBJECT_MISSING`,
`GIT_NOT_INSTALLED`, `GIT_TOO_OLD` and `GIT_FAILED` for a source of the kind `git`, and `REQUEST_REFUSED`,
`RETRIEVE_TOO_SLOW` and `RETRIEVES_FAILING` for an org or a sandbox. With `GIT_FAILED`, the message carries what
Git said, which can include paths of this machine. With `REQUEST_REFUSED` and `RETRIEVES_FAILING`, it carries what
Salesforce said, filtered as described below.

For `LOGIN_FAILED`, `details.reason` is one of:

| Reason               | Situation                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `NO_LOGIN`           | Nothing says which login the source uses, or no Salesforce CLI login belongs to its org.                        |
| `LOGIN_AMBIGUOUS`    | Several Salesforce CLI logins belong to the org of the source. Choose one with `source link`.                   |
| `LOGIN_UNKNOWN`      | The login that is linked, or that was given to `source link`, is not on this machine.                           |
| `JWT_INCOMPLETE`     | Some of the variables for a login with a key are set and others are missing (`details.missing`).                |
| `JWT_INVALID`        | A variable holds something that cannot be used (`details.variable`): no key, no login URL.                      |
| `JWT_REJECTED`       | Salesforce refused the login with the key. `details.error` is its error code, the message its text.             |
| `JWT_USER_HAS_LOGIN` | The user of the key also has a Salesforce CLI login on this machine. Unset the variables, or log that user out. |
| `SESSION_EXPIRED`    | The login is no longer valid and could not be renewed. Log in again with the Salesforce CLI.                    |
| `ORG_UNREACHABLE`    | No answer came from the org. `details.network` is the code of the failure, or `TIMEOUT`.                        |
| `REQUEST_FAILED`     | The org, or what answers at its address, answered with something else than expected.                            |

`details.source` is the name of the source. For `ORG_MISMATCH`, `details.declared` and `details.found` are the two
org ids. No message and no detail holds a token or a key. What OrgLens itself says about a login with a key names
no user and no address. Where a message passes on what Salesforce or a Salesforce library said, tokens are
removed, everything that has the form of an address or of a user name is replaced by `[address]` or `[user]`, a
page is not passed on, and the text is cut after 300 characters. That is a filter by form, not a promise about
every text Salesforce can send.

## Start-up time

A command that needs no org has a budget of 150 ms on CI Linux, measured as the median of repeated runs of
`orglens status` in a new process. `pnpm run check:startup` measures it on the built binary, and CI runs it on
every pull request. The budget is enforced on Linux and only reported on Windows and macOS.
