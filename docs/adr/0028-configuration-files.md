# 0028. Configuration: two TOML files, strict reading, and edits that keep the file as written

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0016](0016-commands-config-and-json-contract.md) decided that `orglens.toml` is committable, declares the sources,
and holds no secrets. Building it raised questions that record does not answer: what is shared and what is
personal, how strictly the file is read, how a command may change a file that a team wrote by hand, and which
library reads TOML.

The file is the first thing a new user edits, and a wrong value shows up late: a source that points at the wrong
folder gives a snapshot that looks fine and answers that are wrong.

## Decision

**Two files.** `orglens.toml` is shared and committed: the workspace name and the sources. `.orglens/local.toml`
is personal and never committed: what differs from machine to machine, today only the SQLite binding. Two
environment variables override them, `ORGLENS_WORKSPACE` and `ORGLENS_SQLITE_DRIVER`. Where two places set the same
thing, the command line wins over the environment, and the environment over a file.

**Sources.** A source has a name and a kind: `org`, `sandbox` or `git`. An org is identified by its org id, which
is not a credential. A git source is a repository, an optional ref, and the set of folders that together make up
one org, so a repository that holds several orgs is declared as several sources. A git source can name the org it
describes (`tracks`), and a sandbox the org it belongs to (`sandbox_of`). The login a person uses for an org is
personal and is not in the shared file. How it is found is decided with Salesforce connectivity.

**Strict reading.** An unknown key is an error. Every problem is reported with file, line, column and key, and
all problems of a file are reported together. Text values with control characters are refused. Any value that has
the shape of a credential is refused, under whatever key it stands. The file has a `schema_version`, and a version
this OrgLens does not know is refused.

**A key exists only once a feature reads it.** There are no keys for features that are not built. With strict
reading, a key that does nothing would be a promise the tool does not keep.

**Validation is hand-written.** The rules are a few hundred lines in `core/config/`. A schema library was not
added: the messages have to name line and column and say what to write instead, the rules across sources (a
sandbox of an org that exists, one declaration per org, folders that do not overlap) are code in any case, and the
engine keeps its runtime dependencies few.

**TOML is read with `smol-toml`.** It is small, has no dependencies, follows TOML 1.1 and reports the position of
a syntax error. It gives values without positions, so a small reader of layout (`core/config/layout.ts`) finds the
line and column of each key in text the parser has already accepted.

**Commands edit the file as text.** `source add` appends a table, `source remove` deletes the lines of one table,
and with it at most one of the blank lines around it. Every other line stays byte for byte as it was: comments,
order and layout belong to the authors. A file that is not UTF-8 is refused, because reading it loosely and
writing it back would change bytes nobody asked to change. After the change, the new text is read again, and it
must declare exactly the old sources plus or minus the one asked for. Otherwise nothing is written and the command
fails with `CONFIG_NOT_EDITABLE`. The new file is written beside the old one, flushed, and moved over it, with the
permissions of the old one and through a link if the file is one. A lock file in `.orglens` keeps two commands
from changing the file at the same moment.

**Messages never repeat a credential.** A message about a wrong value quotes the value. Every message of the
configuration passes through the same masking as the log, so a token pasted under the wrong key does not travel
from the file into a terminal or the output of a CI job.

**`.orglens` ignores itself.** The folder holds a `.gitignore` with `*`. `init` does not touch a `.gitignore` of
the repository.

The files are documented for users in [configuration.md](../configuration.md).

## Consequences

- A typing mistake in a key is found at once, with its place. The price: a file written for a newer OrgLens is
  refused by an older one as soon as it uses a new key. Colleagues who share a file need versions that know the
  same keys.
- Comments survive `source add` and `source remove`. The price: a file that declares sources as inline tables or
  with dotted keys cannot be changed by the commands, only by hand. It is still read.
- `smol-toml` is a runtime dependency of the engine. Replacing it later touches one file, because nothing else
  imports it.
- The check for credential shapes can refuse a harmless value that looks like a token, for example a description
  that quotes one. There is no switch to turn the check off. The value has to be reworded.
- The lock holds off other OrgLens commands, not an editor. A hand-made change that is saved in the instant between
  the read and the write of a command is lost. A lock that a crashed command left behind is taken over after 30
  seconds.
- Settings that will be needed later (which metadata to retrieve, retention of snapshots, limits) have no place in
  the file yet. Each arrives with its feature, and with a decision if it changes this contract.
- The layout reader is a second, smaller reading of TOML. It is only used on text the parser accepted, and for
  positions and line ranges only. If it is wrong, a message points at the wrong line, or an edit is refused by the
  check that follows it. It cannot make a wrong value be accepted.
