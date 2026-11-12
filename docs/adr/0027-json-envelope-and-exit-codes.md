# 0027. One JSON envelope for every command, and six exit codes

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0016](0016-commands-config-and-json-contract.md) decided that every command has a stable `--json` output and
documented exit codes, and left the shape to the moment the CLI shell is built. The readers of that output are
shell scripts, CI jobs, later the local web UI and the agent. They need three things: to tell a success from a
failure without parsing prose, to tell kinds of failure apart, and to keep working when OrgLens gains features.

The prototypes printed a different shape per command, wrote errors as text even when JSON was asked for, and used
the exit code `2` for both "the command line is wrong" and "the gate was breached".

## Decision

**One envelope.** With `--json`, every command writes exactly one line to the standard output, and nothing to the
standard error stream:

```
{ "schemaVersion": 1, "command": …, "ok": …, "data": …, "warnings": […], "error": … }
```

- `command` is the command that ran, such as `"source add"`. It is `null` when the command line was rejected
  before a command ran.
- `ok` is true when the command produced its result. Then `data` holds the result and `error` is `null`. When
  `ok` is false, `data` is `null` and `error` is `{ code, message, hint, details }`.
- `warnings` is a list of `{ code, message }`. It is part of the envelope from the start, so that adding the first
  warning is not a change of shape.
- The envelope is written for a failure and for a command line that cannot be understood too. A program that asked
  for JSON never has to parse text. Help and version are the exception: they are always text.

**Codes, not messages.** `error.code` is a stable code. The codes of the engine are defined once, in
`core/errors.ts`, and the CLI adds one of its own, `USAGE`. Messages and hints are for people and can be reworded.

**`ok` is not the exit code.** `ok` says whether there is a result. The exit code says how the run ended. `doctor`
with a failed check has a complete report (`ok: true`, `data.ok: false`) and ends with `1`. A later `impact --gate`
that breaches its threshold has a complete result and ends with `3`.

**Six exit codes.**

| Code | Meaning                                                          |
| ---- | ---------------------------------------------------------------- |
| 0    | The command did what it was asked to do.                         |
| 1    | The command failed, or `doctor` found a check that failed.       |
| 2    | The command line or the configuration is wrong. Nothing changed. |
| 3    | A gate was breached.                                             |
| 4    | A login is missing or has expired, or the org cannot be reached. |
| 5    | The result is there, and it is incomplete.                       |

Every error code maps to one exit code, in one table in the CLI (`EXIT_OF_ERROR`). The table is typed over all
error codes, so a new error code does not compile until it has an exit code.

**Compatibility.** Within one `schemaVersion`, no field is removed or changes its meaning, no error code is renamed
or reused, and no exit code changes its meaning. Fields, commands, error codes, checks and values of state fields
can be added. A reader ignores what it does not know. Anything else raises `schemaVersion`.

**A schema that is tested.** The envelope and the `data` of every command are described by a JSON Schema,
`packages/cli/schemas/output.schema.json`, shipped in the package. The tests validate every JSON output they
produce against it. The schema is written by hand: the types of the engine are the source of the data, the
schema is the published description, and the tests hold the two together.

**One answer to "was JSON asked for".** `--json` anywhere on the command line before `--` means JSON, and that one
answer holds for the whole run, whatever the argument parser makes of the rest of the line.

**Safe to print.** Text output replaces control characters, line feeds inside a line included, and the characters
that reorder text. JSON output
escapes the characters that `JSON.stringify` leaves raw and that break a line or a terminal (U+007F to U+009F,
U+2028, U+2029).

The contract is documented for users in [cli.md](../cli.md).

## Consequences

- A script needs one parser for every command, and `jq -e .ok` works everywhere.
- CI can tell "fix your command" (2) from "the tool or the database failed" (1), "the gate says no" (3), "log in
  again" (4) and "look at the gaps" (5). The codes 3, 4 and 5 are reserved now and first used by the commands that
  connect to an org and by the gates.
- The exit code `1` has two meanings, a failure and a failed check of `doctor`. A script that needs to tell them
  apart reads `ok`.
- The plan said the schemas would be generated. They are hand-written instead. Generating them from TypeScript
  types needs a build-time dependency and gives a schema that mirrors internal type names. The cost of the choice:
  a new field has to be added in two places, and the test fails until it is.
- The schema allows no unknown fields, so it describes exactly one release. A client that validates output against
  the schema must use the schema of the version it runs.
- Until the first release the contract can still change in a pull request that says so. From the first release
  on, a breaking change needs a new `schemaVersion`.
