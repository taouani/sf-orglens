# Configuration

A workspace is a folder with a file named `orglens.toml` in it. This page describes that file, the personal file
next to it, the environment variables, and the folder `.orglens` where OrgLens keeps its data.

The reasons for this design are in decision records [0016](adr/0016-commands-config-and-json-contract.md) and
[0028](adr/0028-configuration-files.md).

## The files of a workspace

```
orglens.toml             shared configuration. Commit it.
.orglens/.gitignore      contains "*", so Git ignores the whole folder
.orglens/local.toml      personal settings. Optional, written by hand, never committed.
.orglens/orglens.db      the workspace database (plus the -wal and -shm files SQLite creates beside it)
.orglens/config.lock     exists only while a command changes orglens.toml
.orglens/logs/           log files
```

`orglens init` creates `orglens.toml`, `.orglens/.gitignore`, the database and the log folder. It does not create
`.orglens/local.toml` and it does not change a `.gitignore` in the workspace folder: the folder `.orglens` ignores
itself.

Deleting the folder `.orglens` loses two things that cannot be read again from the sources: the snapshots, which
record an org at a past moment, and `local.toml`, which was written by hand.

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

All four are optional. No command connects to an org yet, so nothing reads `login_url` today beyond checking it.
The commands that connect arrive with the second part of Salesforce connectivity, later in Phase 0.

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

This file holds what differs from one machine to the next. It is optional.

```toml
[store]
driver = "better-sqlite3"
```

| Key            | Value                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store.driver` | The SQLite binding: `"node:sqlite"` (default, built into Node.js) or `"better-sqlite3"` (an optional package that has to be installed). See [record 0025](adr/0025-sqlite-driver.md). |

## Environment variables

| Variable                | Meaning                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `ORGLENS_WORKSPACE`     | The workspace folder. `--workspace` wins over it. An empty value counts as not set.                    |
| `ORGLENS_SQLITE_DRIVER` | The SQLite binding, with the same two values as `store.driver`. It wins over the file. Empty: not set. |

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

## How `source add` and `source remove` change the file

The two commands edit `orglens.toml` as text. They do not rewrite the file from parsed values, so comments, the
order of keys and the layout of every other line stay exactly as they were.

- `source add` appends a new table `[sources.NAME]` at the end of the file. A value that is the default, such as
  `repo = "."`, is not written.
- `source remove` deletes the lines of the table `[sources.NAME]`, from its header to the end of its last value.
  Comments above the header and comments after the last value are kept, because nothing tells whom they belong
  to. Where a blank line stood before the table and another after it, one of the two is removed with it. A source
  that another source refers to with `sandbox_of` or `tracks` is not removed.
- After the change and before the file is written, the new text is read and checked like any configuration, and it
  must show exactly the intended difference. If it does not, nothing is written.
- The new file is written next to the old one and then moved over it, so a crash never leaves half a file. It
  keeps the permissions of the old one. If `orglens.toml` is a link, the file it points at is replaced and the link
  stays.
- While one command changes the file, a second one waits for it, for up to two seconds.
- The file has to be UTF-8. A file in another encoding is refused, not converted.
- Some ways of writing TOML cannot be changed safely as text: sources written as inline tables or with dotted keys
  such as `sources.prod.kind = "org"`, for example. The commands then stop with the error `CONFIG_NOT_EDITABLE` and
  change nothing. The file can still be edited by hand, and every other command reads it.
