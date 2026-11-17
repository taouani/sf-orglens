# 0051. The first release is the first one on npm: a pre-release on GitHub fixes nothing

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (an answer of the maintainer of 2026-11-17 to a question the Phase 1 plan left open)
- Changed by: [0053](0053-a-pre-release-is-published-on-npm.md), with which pre-releases are published on npm. Whether such a pre-release is "the first release on npm" of this record was put to the maintainer again on 2026-11-17 and is not answered. Record 0052, which this record names, was never accepted and is superseded

## Context

Two records let something change "until the first release". Record [0022](0022-public-pre-release.md) says that
the names of the packages can still change before it. Record [0027](0027-json-envelope-and-exit-codes.md) says
that until it the JSON contract can change in a pull request that says so, and that from it on a breaking
change needs a new `schemaVersion`. Neither says what the first release is.

The maintainer chose a pre-release on GitHub for the end of Phase 1
([Phase 1 plan](../plans/phase-1.md#4-the-eight-questions-and-your-answers), question Q6, built by record
[0050](0050-the-pre-release-on-github.md)). The plan said that this leaves open whether that pre-release is the
first release, and that the question is put to the maintainer before it is published. It was put on 2026-11-17
with three answers: the names and the JSON output are fixed with the first release on npm, the JSON output
alone is fixed now, or both are fixed now.

Phase 1 analyses objects, fields and validation rules. Every later phase adds types, kinds of reference and
commands, and each can show that a shape of the output was chosen too early. The first pre-release goes to a few
colleagues of the maintainer, who are told what it is.

## Decision

The maintainer chose the first answer.

**"The first release" of records 0022 and 0027 is the first release of OrgLens on npm.** A pre-release on GitHub
is not it, whatever its version.

Until that release:

- The names of the two packages and of the binary can still change.
- The JSON output and the exit codes can change from one pre-release to the next, in a pull request that says
  so, as record 0027 reads. `schemaVersion` stays `1`.
- A pre-release that changes a name, a shape of the JSON output or an exit code says so in its release notes.

Record [0052](0052-the-project-holds-its-names-on-npm.md), which is not accepted, is about empty packages with
which the project would hold its names on npm. Such a package would be no release of OrgLens and would fix
nothing.

## Consequences

- A script written against the JSON output of a pre-release can break with the next one. The release notes of
  every pre-release say that, under "What may still change".
- Nothing new is checked by a tool. That a change of the output is named in the release notes is for the review
  of the pull request that sets the version.
- `docs/cli.md` and the schema describe the output of the version they are in, as before. A client that
  validates output uses the schema of the version it runs.
- What makes the first release on npm is not decided here: when it happens, under which names, and whether a
  version with a pre-release part counts. The roadmap announces nothing before the correctness gate (record
  [0021](0021-correctness-proof.md)), and the question comes back to the maintainer before a package of OrgLens
  goes to npm.
