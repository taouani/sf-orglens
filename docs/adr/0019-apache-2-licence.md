# 0019. Apache License 2.0

- Status: Accepted
- Date: 2026-11-11
- Decisions: S6

## Context

OrgLens is an open-source tool meant to be used by consultancies on client work and to accept outside contributions.
The licence has to be acceptable to corporate users and clear about patents and contributions.

## Decision

OrgLens is licensed under the Apache License, Version 2.0. The copyright holder named in `NOTICE` is "The OrgLens
Authors", meaning the contributors recorded in the git history.

Contributions are accepted under the same licence with a Developer Certificate of Origin sign-off on each commit.
There is no contributor licence agreement.

## Consequences

- An explicit patent grant and well-understood terms for corporate users.
- Dependencies must have licences compatible with Apache 2.0. The public test codebases are fetched on demand
  and never copied into the repository, partly for this reason.
- Without a contributor licence agreement the project cannot relicense without the agreement of its
  contributors. That is accepted.

## Notes

The copyright holder and the sign-off rule were set by the answers to questions Q6 and Q7 of the [Phase 0
plan](../plans/phase-0.md).
