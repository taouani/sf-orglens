# 0022. Public from the first commit, announced after the gate

- Status: Accepted
- Date: 2026-11-11
- Decisions: M5

## Context

The maintainer and colleagues want to use the tool on real work as soon as the first slice exists. A private
repository makes that awkward, and a public launch before the results are proven would spend the project's one first
impression on unverified claims.

## Decision

The repository is public from the first commit and marked pre-release. Nothing is announced until the correctness
gate ([0021](0021-correctness-proof.md)) has passed. No package is published during Phase 0; the release workflow
only rehearses a release as a dry run.

## Consequences

- Everything committed is public immediately. Plans, research notes and decision records are written with that
  in mind: no personal names, no client names, no data from a real org.
- Colleagues can install from the repository and report problems through normal issues.
- Package names can still change before the first release.
