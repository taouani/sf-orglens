# Configuration

A workspace is a folder with a file named `orglens.toml` in it. This page describes that file, the personal file
next to it, the environment variables, and the folder `.orglens` where OrgLens keeps its data.

The reasons for this design are in decision records [0016](adr/0016-commands-config-and-json-contract.md) and
[0028](adr/0028-configuration-files.md).

## The files of a workspace

```
orglens.toml             shared configuration. Commit it.
.orglens/.gitignore      contains "*", so Git ignores the whole folder
.orglens/local.toml      personal settings. Optional, never committed. Written by hand or by "source link".
.orglens/orglens.db      the workspace database (plus the -wal and -shm files SQLite creates beside it)
.orglens/config.lock     exists only while a command changes a configuration file
.orglens/snapshot-<source>.lock   exists only while a snapshot of an org or a sandbox is taken
.orglens/tmp/            files of a retrieve on their way into the database. Emptied when a snapshot starts and ends.
.orglens/logs/           log files
```

`orglens init` creates `orglens.toml`, `.orglens/.gitignore`, the database and the log folder. It does not create
`.orglens/local.toml` and it does not change a `.gitignore` in the workspace folder: the folder `.orglens` ignores
itself.

Deleting the folder `.orglens` loses two things that cannot be read again from the sources: the snapshots, which
record an org at a past moment, and `local.toml` with your personal settings.

Neither file ever holds a password, a token or a key. OrgLens refuses a file in which a value looks like one,
whatever key it stands under.

## Which workspace a command uses

A command looks for the workspace in this order and uses the first it finds:

1. the folder given with `--workspace <folder>`,
2. the folder named by the environment variable `ORGLENS_WORKSPACE`, if it is set and not empty,
3. the current folder, then each folder above it, until one holds `orglens.toml`.

With `--workspace` or `ORGLENS_WORKSPACE` the named folder itself must hold `orglens.toml`. Folders above it are
not searched.

`orglens init` creates the workspace in the folder given as its argument, or with `--workspace`, or by
`ORGLENS_WORKSPACE`, or else in the current folder.

## `orglens.toml`

```toml
schema_version = 1

[workspace]
name = "acme-salesforce"

[sources.prod]
kind = "org"
description = "EMEA production"
org_id = "00D000000000001EAA"

[sources.uat]
kind = "sandbox"
org_id = "00D000000000002EAA"
sandbox_of = "prod"
sandbox_name = "uat"

[sources.emea-repo]
kind = "git"
ref = "main"
paths = ["orgs/emea/main", "orgs/emea/shared", "orgs/common"]
tracks = "prod"
```

The org ids above are made up.

### Top level

| Key              | Required | Value                                                                               |
| ---------------- | -------- | ----------------------------------------------------------------------------------- |
| `schema_version` | yes      | `1`. The version of the format of this file. Any other value is refused.            |
| `[workspace]`    | no       | A table with the key `name`.                                                        |
| `workspace.name` | no       | A label of 1 to 64 characters, shown in output. It has no function.                 |
| `[sources.NAME]` | no       | One table per source. `NAME` is the name used on the command line and in snapshots. |

A source name starts with a lower-case letter and has up to 32 lower-case letters, digits and hyphens.

### Every source

| Key           | Required | Value                                      |
| ------------- | -------- | ------------------------------------------ |
| `kind`        | yes      | `"org"`, `"sandbox"` or `"git"`.           |
| `description` | no       | A note for people, at most 200 characters. |

### A source of kind `org` or `sandbox`

| Key            | Kinds        | Value                                                                                                                                           |
| -------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_id`       | org, sandbox | The org id: `00D` followed by 12 or 15 letters and digits. It identifies the org and is not a credential. Two sources cannot name the same org. |
| `login_url`    | org, sandbox | The address of the login page, if it is not the default. It starts with `https://` and has no user name, no query and no fragment.              |
| `sandbox_of`   | sandbox      | The name of the source of kind `org` that this is a sandbox of.                                                                                 |
| `sandbox_name` | sandbox      | The name of the sandbox: 1 to 10 letters and digits.                                                                                            |

All four are optional.

- `org_id` is what keeps a login from pointing at the wrong org. With it, OrgLens finds the Salesforce CLI login
  of that org by itself, and refuses a login of another org (`ORG_MISMATCH`). Without it, a login has to be
  linked with `orglens source link`, and any org is accepted. `orglens source check` prints the id to add.
- `login_url` is read for a login with a key from the environment, when the variable for the login URL is not set
  (see [Environment variables](#environment-variables)). A Salesforce CLI login carries its own address.
- `sandbox_of` and `sandbox_name` are checked and not used by a command yet.

### A source of kind `git`

A git source is a set of folders in a repository that together hold the metadata of one org. A repository that
holds several orgs in sub-folders is declared as several git sources.

| Key      | Value                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `repo`   | The repository, as a path relative to the workspace. Default `"."`, the repository the workspace is in. A repository next to the workspace is written as `"../other-repo"`.                                                                                                                                                    |
| `ref`    | A branch, a tag or a commit. Without it, the working tree is read as it is on disk.                                                                                                                                                                                                                                            |
| `paths`  | A list of folders of the repository that belong to this source. Without it, the package directories of `sfdx-project.json` are used. No two folders of the list may be the same or lie in one another. Folders are compared without regard to upper and lower case, because on Windows and macOS two spellings are one folder. |
| `tracks` | The name of the org or sandbox source that this repository describes.                                                                                                                                                                                                                                                          |

Paths are written with forward slashes on every system. They are relative, and they contain no `..`, no `.` segment
and no `~`. In `repo` only, `..` may lead the path, also on its own: `repo = ".."` is the folder above the
workspace. A slash at the end of a folder is ignored.

### How a git source is read

`orglens snapshot` reads a git source as follows. The reasons are in
[record 0030](adr/0030-reading-a-git-source.md).

- **Without `ref`** the folders are read from disk as they are, changes that are not committed included. Git is
  not needed for it: on a machine without Git the snapshot is taken and names no commit. **With `ref`** the commit
  is read from the repository, whatever is checked out. This needs the `git` program, version 2.30 or newer. The
  repository is never changed and nothing is fetched: a branch of a remote is named with the remote, as in
  `origin/main`, and has to be fetched before. A partial clone that lacks files of the commit cannot be read.
- **Git reads the repository of `repo`, whatever the environment says.** Variables such as `GIT_DIR`, which point
  Git at another repository and which Git sets for the hooks it runs, are not handed on to it.
- **The folders** are those of `paths`. Without `paths`, they are the package directories of the
  `sfdx-project.json` at the top of `repo`, which is read from disk or from the commit like everything else. A
  package directory inside another one is read with that one. A project whose package directory is the folder of
  the project file itself (`"path": "."`) needs `paths`.
- **`.forceignore` is honoured.** Each folder follows the nearest `.forceignore`: its own, or the one of the
  nearest folder above it, up to the top of `repo`. A `.forceignore` above `repo` is not read. The rules are those
  of the Salesforce CLI, including the ones it always adds, such as leaving out files whose name starts with a
  dot. Without a `.forceignore`, no file is left out.
- **Symbolic links are not followed**, and submodules and other Git repositories inside a folder are not read.
  Each is reported. A folder of the source that is itself a link, a submodule or a file counts as missing. A
  `.forceignore` that is a link is not applied, and a `sfdx-project.json` that is a link is not read. One case is
  not covered: Git for Windows can be set to check a link out as a small text file, and from disk that file is
  read as the file it is.
- **Names are UTF-8.** A file or folder whose name is not UTF-8, which only Linux allows, is not read and is
  reported as an error.
- **Only metadata is stored.** A file that belongs to no metadata component is not part of the snapshot. It is
  counted in an issue.
- **One file that cannot be placed costs one file.** The Salesforce library stops at a `-meta.xml` file without
  its content, such as the file of a class that was deleted. OrgLens reports that file and reads everything
  beside it.
- **A component in two places is reported.** If two package directories of one source define a class or a field
  of the same name, the files of both are stored and a warning names them. OrgLens does not decide which one
  counts.
- **Paths in a snapshot** are relative to `repo`, with forward slashes.

The source that is read can be a plain folder that is in no repository. Its snapshots then name no commit.

## `.orglens/local.toml`

This file holds what differs from one machine or one person to the next. It is optional.

```toml
[store]
driver = "better-sqlite3"

[sources.prod]
login = "acme-prod"
```

| Key                    | Value                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.driver`         | The SQLite binding: `"node:sqlite"` (default, built into Node.js) or `"better-sqlite3"` (an optional package that has to be installed). See [record 0025](adr/0025-sqlite-driver.md).                                                             |
| `sources.<name>.login` | The Salesforce CLI login you use for the org or sandbox `<name>`: its alias or its user name, as `sf org list` shows it. `orglens source link <name> <login>` writes it. It is a name, not a credential: the login stays with the Salesforce CLI. |

`login` is accepted only for an org or a sandbox. `orglens source remove` removes the table together with the
source. A table for a name that `orglens.toml` does not declare is not an error: the shared file is changed by
others, and a source that a colleague removed or renamed must not stop every command of yours. Its login is not
used, and `orglens doctor` names it until you remove the table. See [the logins](cli.md#logins) for the order in
which a login is found.

## Environment variables

| Variable                | Meaning                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `ORGLENS_WORKSPACE`     | The workspace folder. `--workspace` wins over it. An empty value counts as not set.                    |
| `ORGLENS_SQLITE_DRIVER` | The SQLite binding, with the same two values as `store.driver`. It wins over the file. Empty: not set. |

### A login with a key, for a job without a person

A build server has no Salesforce CLI login. It logs in with a private key whose certificate is uploaded to an app
in the org (the OAuth JWT bearer flow). OrgLens reads the login from variables that carry the name of the source:
in upper case, with `_` for `-`. For a source `prod` the prefix is `ORGLENS_JWT_PROD_`, for `uat-eu` it is
`ORGLENS_JWT_UAT_EU_`.

| Variable                         | Meaning                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORGLENS_JWT_<SOURCE>_USERNAME`  | The user to log in as. Required.                                                                                                                                                  |
| `ORGLENS_JWT_<SOURCE>_CLIENT_ID` | The consumer key of the app in the org. Required.                                                                                                                                 |
| `ORGLENS_JWT_<SOURCE>_KEY`       | The private key in PEM form, without a passphrase. A value in one line may carry its line ends as `\n`. Blanks and line ends around the value are ignored.                        |
| `ORGLENS_JWT_<SOURCE>_KEY_FILE`  | The path of a file that holds the key. Exactly one of the two key variables is set. A relative path starts at the folder the command runs in, not at the workspace.               |
| `ORGLENS_JWT_<SOURCE>_LOGIN_URL` | Where to log in. Optional. Without it: the `login_url` of the source, and without that `https://login.salesforce.com` for an org and `https://test.salesforce.com` for a sandbox. |

- As soon as one of the five is set, the source is logged in with the key, and no Salesforce CLI login is
  considered for it. If a required one is missing, the command ends with `LOGIN_FAILED`.
- An empty value counts as not set.
- Only these five names are read. A variable with another name, such as `ORGLENS_JWT_PROD_CLIENTID` or
  `ORGLENS_JWT_UAT-EU_USERNAME`, is not an error for the commands, and a source for which none of the five is set
  uses a Salesforce CLI login. `orglens doctor` warns about every variable that starts with `ORGLENS_JWT_` and is
  read by no source.
- The user of the key must not also have a Salesforce CLI login on the machine. The Salesforce library would
  take over the stored login of that user, and a login with a key would no longer be only that. The command ends
  with `LOGIN_FAILED` (`JWT_USER_HAS_LOGIN`) before anything is sent. A build server has no such login.
- The login URL starts with `https://`. Only for an address of this machine itself (`localhost`, `127.0.0.1`),
  `http://` is accepted, which is what tests use.
- The key is an RSA key. OrgLens signs the request with it, sends the request to Salesforce, and keeps the session
  it gets in memory. Neither the key nor the session is written to a file or a log. The key never belongs in
  `orglens.toml` or `local.toml`, and both files refuse it.
- A session that was opened with a key is not renewed. If it expires while a snapshot is taken, the command ends
  with `LOGIN_FAILED` (`SESSION_EXPIRED`), and the next run logs in again and continues the snapshot.
- The app in the org needs the OAuth scope `api`, and the user has to be allowed to use it. To take a snapshot,
  the user also needs a permission for the Metadata API. Salesforce documents two that give it: "Modify Metadata
  Through Metadata API Functions" and "Modify All Data". Salesforce has no permission that only reads metadata.
  OrgLens itself sends no request that changes an org. Which permission is enough was not verified against an org.
  [live-org-setup.md](live-org-setup.md) walks through the set-up of such an app for the test org of this project.
- On a Linux machine without a desktop, set `SF_USE_GENERIC_UNIX_KEYCHAIN=true` for the job. The Salesforce library
  that OrgLens connects with creates an encryption key of its own on first use, and with this setting it keeps
  that key in a file in the home folder and does not look for a keychain of the system. The workflow of this
  project sets it. What happens without it on a machine that has the keychain program but no session for it was
  not tested.

## How the files are checked

- **Unknown keys are errors.** A typing mistake in a key is reported, never read as "use the default". The message
  lists the keys that are known in that place.
- **Every problem has a place.** A message names the file, the line, the column and the key, for example
  `orglens.toml:14:1: sources.uat.sandbox_of: "prd" is not the name of a source of kind "org" in this file.`
- **All problems are reported together**, not only the first. A file that is not valid TOML is the exception: the
  parser stops at the first place it cannot read.
- **Text values contain no control characters and no line breaks.**
- **A value that looks like a credential is refused**: a key or certificate block, a Salesforce access token or
  refresh token, a Salesforce CLI auth URL, a JSON Web Token, a bearer or basic credential, and a URL with a user
  name in it.
- **A key exists only once a feature reads it.** Keys for later features (which metadata to retrieve, how long to
  keep snapshots, limits) are added with those features. Until then they are unknown keys.

With `--json`, the problems are in `error.details.diagnostics` of the output, one object per problem with `file`,
`line`, `column`, `path`, `message` and `text` (the line a person would read). See [cli.md](cli.md).

## How the `source` commands change the files

`source add` and `source remove` edit `orglens.toml` as text, and `source link` and `source remove` edit
`.orglens/local.toml` the same way. They do not rewrite a file from parsed values, so comments, the order of keys
and the layout of every other line stay exactly as they were.

- `source add` appends a new table `[sources.NAME]` at the end of the file. A value that is the default, such as
  `repo = "."`, is not written.
- `source remove` deletes the lines of the table `[sources.NAME]`, from its header to the end of its last value.
  Comments above the header and comments after the last value are kept, because nothing tells whom they belong
  to. Where a blank line stood before the table and another after it, one of the two is removed with it. A source
  that another source refers to with `sandbox_of` or `tracks` is not removed.
- `source link` changes the value of `login` in the table `[sources.NAME]` of `local.toml` and keeps a comment
  after it. Where the table has no `login`, a line is added below its header. Where there is no such table, one is
  appended, and where there is no file, it is created with a two-line comment at its top. `source remove` deletes
  the source from `orglens.toml` first and the table from `local.toml` second. If the second step fails, a login
  is left for a source that is no longer declared, which is a valid configuration and which `doctor` names.
- After the change and before the file is written, the new text is read and checked like any configuration, and it
  must show exactly the intended difference. If it does not, nothing is written.
- The new file is written next to the old one and then moved over it, so a crash never leaves half a file. It
  keeps the permissions of the old one. If `orglens.toml` is a link, the file it points at is replaced and the link
  stays.
- While one command changes a file, a second one waits for it, for up to two seconds.
- The file has to be UTF-8. A file in another encoding is refused, not converted.
- Some ways of writing TOML cannot be changed safely as text: sources written as inline tables or with dotted keys
  such as `sources.prod.kind = "org"`, for example. That holds for both files. The commands then stop with the error
  `CONFIG_NOT_EDITABLE` and change nothing. The file can still be edited by hand, and every other command reads it.
