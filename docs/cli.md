# The command line

This page describes the commands of `orglens` that exist today, what they write, and the exit code they end with.
The `--json` output and the exit codes are a contract: scripts, CI jobs and later the local web UI rely on them.
The decision behind the contract is [record 0027](adr/0027-json-envelope-and-exit-codes.md).

OrgLens is in pre-release. The commands below manage a workspace and its configuration, check the login for an
org, and take snapshots of orgs, sandboxes and repository folders. No command analyses anything yet. Reading an
org has been tested against a mock org only, not yet against Salesforce itself.

## Commands

| Command                              | What it does                                                                                | Changes                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------ |
| `orglens init [folder]`              | Makes a folder a workspace: writes `orglens.toml` and creates the data folder `.orglens`.   | The folder               |
| `orglens source add <name>`          | Declares an org, a sandbox or a set of repository folders in `orglens.toml`.                | `orglens.toml`           |
| `orglens source list`                | Lists the declared sources.                                                                 | Nothing                  |
| `orglens source remove <name>`       | Removes the declaration of a source. Snapshots already taken stay in the database.          | Both configuration files |
| `orglens source link <name> <login>` | Chooses the Salesforce CLI login you use for an org or a sandbox.                           | `.orglens/local.toml`    |
| `orglens source check <name>`        | Checks that a source can be read: logs in to an org, or reads the folders of a repository.  | No data                  |
| `orglens status`                     | Shows the workspace, the state of its database and the latest snapshot of every source.     | No data                  |
| `orglens snapshot <source>`          | Reads a source now and stores its metadata files as a new snapshot.                         | The database             |
| `orglens coverage <source>`          | Shows what a snapshot holds per metadata type, and what was left out or went wrong.         | No data                  |
| `orglens doctor`                     | Checks Node.js, SQLite, Git, the workspace, its configuration, its database and the logins. | No data                  |

`status`, `coverage` and `doctor` change neither the configuration nor the content of the database. They open the
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
- Only `init` and `snapshot` create the database. `status`, `coverage` and the `source` commands never create or
  migrate it. `status`
  reports a database that is missing, outdated, newer, foreign or busy as the `state` of the store, and still exits
  with `0`: the command did what it was asked to do. `doctor` is the command that turns a problem into an exit
  code.
- `source add`, `source remove` and `source link` take a lock while they change a configuration file, so two of
  them at the same moment do not lose each other's change. A command that cannot get the lock within two seconds
  ends with `WORKSPACE_IO`.
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
  make a snapshot partial.

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
  not be opened. `details.reason` says which it was.

#### A source of the kind `org` or `sandbox`

The org is read through the Metadata API, with the login described [below](#logins), in three steps:

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

- The snapshot is partial for: a type whose components the org refused to list (`LISTING_FAILED`), a retrieve
  that failed for a single component, or a chunk whose retrieve was started three times and gave no result
  (`RETRIEVE_FAILED`), a component the org listed that did not come back (`NOT_RETRIEVED`), a file that came back
  and cannot be read as metadata (`RESOLVE_FAILED`). The other types and components are in the snapshot.
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
- Only metadata is read. OrgLens makes no request for a record. One thing is not in its hands: when the session
  of a Salesforce CLI login expires while a snapshot is taken, the Salesforce library renews it and asks the org
  about the org itself (decision record 0031 names the requests).
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
```

The files of an org are always in the standard form of a Salesforce project, whatever `sfdx-project.json` of the
folder the command runs in says about the form of labels or permission sets.

Not verified against a real org yet: which types real orgs refuse to list, how Salesforce words the failure of a
retrieve that is too large, folders inside folders, and whether the names in a retrieve always equal the names
the org listed. The mock org the tests use is built from the fixture project, and was also built once from each
of three public codebases.

`orglens coverage <source>` shows the latest snapshot of a source, or the one given with `--snapshot <number>`.
It ends with `0` also when that snapshot is partial: showing the report is what it was asked to do. The column
`ANALYSED` is `0` for every type until the analysers arrive.

The table of `coverage` has one line per metadata type that has components. For an org, the column `LISTED` says
`not listed` for a type Salesforce never lists, and adds `(listing failed)` to the number of a type the org
refused to list in whole or in part.

The issue codes of today:

| Severity  | A source of the kind `git`                                                                                          | An org or a sandbox                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `error`   | `FOLDER_MISSING`, `FOLDER_UNREADABLE`, `FILE_UNREADABLE`, `NAME_NOT_UTF8`, `RESOLVE_FAILED`, `APEX_FILE_UNRESOLVED` | `LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED`, `RESOLVE_FAILED`                                  |
| `warning` | `LINK_SKIPPED`, `FILES_NOT_METADATA`, `COMPONENT_DEFINED_TWICE`                                                     | `TYPE_NOT_READ`, `ACCESS_INCOMPLETE`, `RETRIEVE_MESSAGES`, `FILES_NOT_METADATA`, `FILE_RETRIEVED_TWICE` |
| `info`    | `FILES_IGNORED`, `COMMIT_UNKNOWN`, `WORKING_TREE_MODIFIED`, `CHANGED_WHILE_READ`                                    | `CHUNK_SPLIT`, `UNLISTED_COMPONENTS`, `SNAPSHOT_RESUMED`, `SNAPSHOT_GIVEN_UP`                           |

An issue about several components of an org carries their number in `details.count` and at most the first 50
names in `details.components`. `LISTING_FAILED`, `TYPE_NOT_READ`, `NOT_RETRIEVED` and `UNLISTED_COMPONENTS` name
the type in `details.type`. `RETRIEVE_FAILED` and `CHUNK_SPLIT` carry what Salesforce said in `details.said`, and
`RETRIEVE_MESSAGES` its remarks in `details.messages`. `LISTING_FAILED`, `RETRIEVE_FAILED` and `CHUNK_SPLIT` carry
the code Salesforce gave for its refusal in `details.code`, or `null` if it gave none. A program reads the code
there and not out of the text.

An issue about several files carries their number in `details.count` and at most the first 50 paths in
`details.paths`. `COMPONENT_DEFINED_TWICE` carries at most the first 50 components in `details.components`, each
with its `type`, its `fullName` and the `paths` of its definitions. Only components without parts are looked at:
a class or a field in two package directories is reported, an object whose file is in two of them is not.

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

| Command         | `data`                                                                                                                                                                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`          | `root` (absolute path), `created` (the files this run created, relative to the workspace), `existing` (true if `orglens.toml` was already there).                                                                                                                                                                 |
| `source add`    | `source`: the declaration as it was written.                                                                                                                                                                                                                                                                      |
| `source list`   | `sources`: the declarations, in the order of the file.                                                                                                                                                                                                                                                            |
| `source remove` | `removed`: the name of the source.                                                                                                                                                                                                                                                                                |
| `source link`   | `source`, `login` (as it was given), `username`, `orgId` (of the login, as the Salesforce CLI knows it, or `null`), `declaredOrgId` (of the source, or `null`).                                                                                                                                                   |
| `source check`  | For an org or a sandbox: `source`, `kind`, `login` (`via`, `alias`, `username`), `org` (`id`, `instanceUrl`, `apiVersion`), `declaredOrgId`. For a source of the kind `git`: `source`, `kind`, `complete`, `commit`, `dirs`, `components`, `files`, `bytes`, `issues`.                                            |
| `status`        | `root`, `name`, `configFiles`, `store` (file, driver, `state`, schema version, size, problem), `sources` (declaration, `snapshots`: the number of snapshots that ended as complete or partial, `latestSnapshot`: the latest of them, `unfinishedSnapshot`: `id`, `startedAt`, `chunksDone`, `chunks`, or `null`). |
| `snapshot`      | `snapshot` (`id`, `source`, `kind`, `status`, `startedAt`, `finishedAt`, `engineVersion`, `apiVersion`, `commit`, `files`, `bytes`), `types` (per metadata type: `listed`, `retrieved`, `analysed`, `listing`, `note`), `issues` (`severity`, `code`, `message`, `details`).                                      |
| `coverage`      | The same as `snapshot`, for a snapshot that was taken before.                                                                                                                                                                                                                                                     |
| `doctor`        | `ok`, `engineVersion`, `checks`: one object per check with `id`, `status` (`ok`, `warning`, `failed`, `skipped`), `summary` and `details`.                                                                                                                                                                        |

A source is written with all keys of its kind, and `null` for what is not set. Keys are in camel case (`orgId`,
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

`snapshot` ends with `5` when the snapshot it stored is partial, and `source check` when a snapshot of the folders
would be. `source check`, `source link` and `snapshot` of an org end with `4` for a problem with a login. No command ends with `3` yet.
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
| `SNAPSHOT_NOT_FOUND`     | 2    | The source has no snapshot yet, or none with the given number.                                                     |
| `KEY_INVALID`            | 2    | A component key does not follow the key grammar.                                                                   |
| `LOGIN_FAILED`           | 4    | No login for the org of a source was found, the login did not work, or the org is silent.                          |
| `ORG_MISMATCH`           | 4    | The login belongs to another org than the one the source declares.                                                 |
| `WORKSPACE_IO`           | 1    | A file or folder of the workspace could not be read or written.                                                    |
| `SOURCE_READ_FAILED`     | 1    | A source could not be read: its repository, its folders, its commit, or an org that stopped answering as expected. |
| `SNAPSHOT_RUNNING`       | 1    | Another process is taking a snapshot of this source.                                                               |
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
`PROJECT_FILE_INVALID`, `FILE_UNREADABLE`, `FOLDERS_MISSING`, `REF_NOT_FOUND`, `OBJECT_MISSING`,
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
