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
- The database grows with every snapshot. Sharing content keeps that modest (research: ten snapshots of a large
  org cost about 159 MB against 1,103 MB as full copies), and a retention policy is needed.
- Incremental refresh has to produce a new snapshot that shares content with the previous one, not update in
  place.
