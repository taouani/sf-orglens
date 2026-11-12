# The command line

This page describes the commands of `orglens` that exist today, what they write, and the exit code they end with.
The `--json` output and the exit codes are a contract: scripts, CI jobs and later the local web UI rely on them.
The decision behind the contract is [record 0027](adr/0027-json-envelope-and-exit-codes.md).

OrgLens is in pre-release. The commands below manage a workspace and its configuration, take snapshots of
repository folders, and check the login for an org. No command reads the metadata of an org or analyses anything
yet.

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
- Only `init` and `snapshot` create the database. `status`, `coverage` and the `source` commands never create or
  migrate it. `status`
  reports a database that is missing, outdated, newer, foreign or busy as the `state` of the store, and still exits
  with `0`: the command did what it was asked to do. `doctor` is the command that turns a problem into an exit
  code.
- `source add`, `source remove` and `source link` take a lock while they change a configuration file, so two of
  them at the same moment do not lose each other's change. A command that cannot get the lock within two seconds
  ends with `WORKSPACE_IO`.
- `source remove` also removes the login that `source link` set for the source from `.orglens/local.toml`. A
  login for a source that is not declared would make that file invalid.
- `doctor` connects to nothing. Its check `logins` says how many logins the Salesforce CLI has on this machine and
  by which route each org and sandbox of the workspace would be logged in. It names no login and no user, so the
  report can be pasted into an issue. Whether a login still works shows `source check`. Its check `git` is a
  warning, not a failure, when Git is missing or older than 2.30: folders on disk are read without Git.
- A reader that closes the pipe early, as in `orglens status | head -1`, ends the command quietly with the exit
  code `1`.

### Snapshots

`orglens snapshot <source>` reads a source of the kind `git`: the folders of a repository as they are on disk, or
a commit when the source has a `ref`. [configuration.md](configuration.md#how-a-git-source-is-read) says which
folders and files are read. A source of the kind `org` or `sandbox` cannot be read yet and ends with
`SOURCE_READ_FAILED`.

- A snapshot never changes the source. A repository is only read: no checkout, no fetch, no file is written into
  it.
- Every snapshot gets a number that is never used again. Earlier snapshots stay as they are. A file that did not
  change between two snapshots is stored once.
- A snapshot is `complete` or `partial`. It is partial when something the source should hold could not be read: a
  folder that is declared and does not exist or is not a folder, a folder that cannot be listed, a file that
  cannot be opened, a file or folder with a name that is not UTF-8, a `-meta.xml` file the Salesforce library
  cannot place, an Apex file that belongs to no component. Each of these is an issue of the severity `error`,
  and it costs the snapshot that one file or folder and nothing beside it. The snapshot is stored either way,
  `ok` is `true`, and the exit code is `5`, so that a script does not take an incomplete picture for a complete
  one.
- Issues of the severity `warning` and `info` say what was left out on purpose or is worth knowing: symbolic links
  that were not followed, files that `.forceignore` excludes, files that belong to no metadata component, a
  component that is defined in two places, a working tree that differs from its commit. They do not make a
  snapshot partial.
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

`orglens coverage <source>` shows the latest snapshot of a source, or the one given with `--snapshot <number>`.
It ends with `0` also when that snapshot is partial: showing the report is what it was asked to do. The column
`ANALYSED` is `0` for every type until the analysers arrive.

The issue codes of today:

| Severity  | Codes                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------- |
| `error`   | `FOLDER_MISSING`, `FOLDER_UNREADABLE`, `FILE_UNREADABLE`, `NAME_NOT_UTF8`, `RESOLVE_FAILED`, `APEX_FILE_UNRESOLVED` |
| `warning` | `LINK_SKIPPED`, `FILES_NOT_METADATA`, `COMPONENT_DEFINED_TWICE`                                                     |
| `info`    | `FILES_IGNORED`, `COMMIT_UNKNOWN`, `WORKING_TREE_MODIFIED`, `CHANGED_WHILE_READ`                                    |

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
   the login of whoever runs the job.
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
  not answer within 30 seconds (`LOGIN_FAILED`, with the cause in `details.reason`), and for `ORG_MISMATCH`.
- A Salesforce CLI login whose session has expired is renewed by the Salesforce library, which writes the new
  session into the login file of the Salesforce CLI, as the CLI itself does. Nothing else is written outside the
  workspace. [Record 0031](adr/0031-logins-and-the-home-folder.md) lists every file that is touched.
- For a source of the kind `git`, `source check` reads everything a snapshot would read and stores nothing. It
  reports the commit, the number of components and files, and the issues, and ends with `5` if a snapshot taken
  now would be partial.

### Not available yet

The plan of Phase 0 lists snapshots of orgs and sandboxes. They arrive with the third part of Salesforce
connectivity, later in Phase 0. Until then `orglens snapshot` ends with `SOURCE_READ_FAILED` for an org or a
sandbox, also when `source check` succeeds for it.

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

| Command         | `data`                                                                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`          | `root` (absolute path), `created` (the files this run created, relative to the workspace), `existing` (true if `orglens.toml` was already there).                                                                                                   |
| `source add`    | `source`: the declaration as it was written.                                                                                                                                                                                                        |
| `source list`   | `sources`: the declarations, in the order of the file.                                                                                                                                                                                              |
| `source remove` | `removed`: the name of the source.                                                                                                                                                                                                                  |
| `status`        | `root`, `name`, `configFiles`, `store` (file, driver, `state`, schema version, size, problem), `sources` (declaration, snapshot count, latest snapshot).                                                                                            |
| `snapshot`      | `snapshot` (`id`, `source`, `kind`, `status`, `startedAt`, `finishedAt`, `engineVersion`, `commit`, `files`, `bytes`), `types` (per metadata type: `listed`, `retrieved`, `analysed`, `note`), `issues` (`severity`, `code`, `message`, `details`). |
| `coverage`      | The same as `snapshot`, for a snapshot that was taken before.                                                                                                                                                                                       |
| `doctor`        | `ok`, `engineVersion`, `checks`: one object per check with `id`, `status` (`ok`, `warning`, `failed`, `skipped`), `summary` and `details`.                                                                                                          |

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
would be. `source check` and `source link` end with `4` for a problem with a login. No command ends with `3` yet.
The code is fixed now, so that scripts written today keep their meaning when the commands that use it arrive.

## Error codes

| Code                     | Exit | Situation                                                                                 |
| ------------------------ | ---- | ----------------------------------------------------------------------------------------- |
| `USAGE`                  | 2    | The command line cannot be understood: an unknown command or option, a missing argument.  |
| `CONFIG_INVALID`         | 2    | A configuration file, or an environment variable that overrides it, has a problem.        |
| `CONFIG_NOT_EDITABLE`    | 2    | `orglens.toml` is written in a way OrgLens cannot change safely. Edit it by hand.         |
| `WORKSPACE_NOT_FOUND`    | 2    | No workspace: no `orglens.toml` in this folder or in a folder above it.                   |
| `WORKSPACE_EXISTS`       | 2    | A workspace cannot be created here, because the folder already belongs to one.            |
| `SOURCE_NOT_FOUND`       | 2    | No source with this name is declared.                                                     |
| `SOURCE_EXISTS`          | 2    | A source with this name is already declared.                                              |
| `SOURCE_INVALID`         | 2    | The declaration of a source breaks a rule of the configuration.                           |
| `SOURCE_IN_USE`          | 2    | The source cannot be removed, because another source refers to it.                        |
| `SNAPSHOT_NOT_FOUND`     | 2    | The source has no snapshot yet, or none with the given number.                            |
| `KEY_INVALID`            | 2    | A component key does not follow the key grammar.                                          |
| `LOGIN_FAILED`           | 4    | No login for the org of a source was found, the login did not work, or the org is silent. |
| `ORG_MISMATCH`           | 4    | The login belongs to another org than the one the source declares.                        |
| `WORKSPACE_IO`           | 1    | A file or folder of the workspace could not be read or written.                           |
| `SOURCE_READ_FAILED`     | 1    | A source could not be read: its repository, its folders or the commit it names.           |
| `STORE_NOT_FOUND`        | 1    | The workspace has no database yet, and the command only reads.                            |
| `STORE_FOREIGN`          | 1    | The file at the place of the workspace database was not created by OrgLens.               |
| `STORE_NEWER`            | 1    | The database was written by a newer version of OrgLens.                                   |
| `STORE_OUTDATED`         | 1    | The database needs a migration, and the command only reads.                               |
| `STORE_BUSY`             | 1    | Another process holds the write lock of the database.                                     |
| `STORE_MIGRATION_FAILED` | 1    | A migration of the database failed and was rolled back.                                   |
| `STORE_FAILED`           | 1    | The database could not be opened, read or written.                                        |
| `REFERENCE_INVALID`      | 1    | A reference record breaks a rule of the reference vocabulary. This points at a bug.       |
| `INTERNAL`               | 1    | An unexpected failure. This is a bug in OrgLens.                                          |

`USAGE` is raised by the command line itself. All other codes come from the engine, so the local web UI and other
clients of the engine see the same codes.

For `CONFIG_INVALID`, `details.diagnostics` lists every problem: objects with `file`, `line`, `column`, `path`,
`message` and `text`.

For `SOURCE_READ_FAILED`, `details.reason` is one of `REPO_NOT_FOUND`, `PROJECT_FILE_MISSING`,
`PROJECT_FILE_INVALID`, `FILE_UNREADABLE`, `FOLDERS_MISSING`, `REF_NOT_FOUND`, `OBJECT_MISSING`,
`GIT_NOT_INSTALLED`, `GIT_TOO_OLD`, `GIT_FAILED` and `KIND_NOT_READABLE`. With `GIT_FAILED`, the message carries
what Git said, which can include paths of this machine.

For `LOGIN_FAILED`, `details.reason` is one of:

| Reason            | Situation                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `NO_LOGIN`        | Nothing says which login the source uses, or no Salesforce CLI login belongs to its org.            |
| `LOGIN_AMBIGUOUS` | Several Salesforce CLI logins belong to the org of the source. Choose one with `source link`.       |
| `LOGIN_UNKNOWN`   | The login that is linked, or that was given to `source link`, is not on this machine.               |
| `JWT_INCOMPLETE`  | Some of the variables for a login with a key are set and others are missing (`details.missing`).    |
| `JWT_INVALID`     | A variable holds something that cannot be used (`details.variable`): no key, no login URL.          |
| `JWT_REJECTED`    | Salesforce refused the login with the key. `details.error` is its error code, the message its text. |
| `SESSION_EXPIRED` | The login is no longer valid and could not be renewed. Log in again with the Salesforce CLI.        |
| `ORG_UNREACHABLE` | No answer came from the org. `details.network` is the code of the failure, or `TIMEOUT`.            |
| `REQUEST_FAILED`  | The org, or what answers at its address, answered with something else than expected.                |

`details.source` is the name of the source. For `ORG_MISMATCH`, `details.declared` and `details.found` are the two
org ids. No message and no detail holds a token or a key. A message about a login with a key holds no user name
and no address either.

## Start-up time

A command that needs no org has a budget of 150 ms on CI Linux, measured as the median of repeated runs of
`orglens status` in a new process. `pnpm run check:startup` measures it on the built binary, and CI runs it on
every pull request. The budget is enforced on Linux and only reported on Windows and macOS.
