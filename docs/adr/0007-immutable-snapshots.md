# 0007. Immutable snapshots of every source

- Status: Accepted
- Date: 2026-11-11
- Decisions: A3

## Context

Users need three comparisons: org against repository branch, org against sandbox, and sandbox against repository
branch. A consultancy also works with several orgs, and one repository can hold several orgs in sub-folders. The
prototypes kept one mutable copy per org, so comparison and history were bolted on.

## Decision

A source is a live org, a sandbox, or a Git repository at a branch or commit with a declared set of folders. Each
ingest of a source produces an immutable snapshot in the one workspace database. Content that did not change is
stored once and shared between snapshots.

Impact analysis runs on one snapshot. A comparison is a diff of any two snapshots, whatever their sources.

## Consequences

- All three comparisons are the same operation, and history comes free.
- Results are reproducible: a snapshot never changes after it is written.
- The database grows with every snapshot. Sharing content keeps that modest, and a retention policy is needed. Research
  on a synthetic org of about 10,000 top-level components (Linux only): the component and reference rows of ten
  snapshots took about 159 MB with shared versions against 1,103 MB as full copies. With file bodies the estimate is
  about 0.2 GB against about 2.65 GB.
- Incremental refresh has to produce a new snapshot that shares content with the previous one, not update in
  place.
