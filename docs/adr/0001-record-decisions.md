# 0001. Record decisions as short files in git

- Status: Accepted
- Date: 2026-11-11
- Decisions: none (made during the build)

## Context

The three earlier prototypes of OrgLens took different architectural directions, and only one of them wrote its
reasons down. This project is built by one maintainer with AI assistance over many months, in separate working
sessions that do not share memory. A decision that is not written down is made again, differently.

## Decision

Every decision that changes the architecture, the data model, the storage format, a public contract or the scope of
a release is recorded as one Markdown file in `docs/adr/`, named `NNNN-short-title.md`.

- A record has a status (`Proposed`, `Accepted`, `Superseded`), a date, the ids of the plan decisions it covers,
  and three sections: context, decision, consequences.
- Records are short. The reasoning that led to a decision lives in the plans and research notes and is linked.
- An accepted record is not rewritten. A change of mind is a new record that supersedes the old one, and the old
  one is marked `Superseded` with a link.
- `docs/adr/README.md` is the index. `scripts/check-adr.mjs` runs in CI and checks the format, the index, and
  that every decision id of the re-architecture plan (F1 to M5) is covered by exactly one record.

## Consequences

- A new working session can read the index and know what is settled.
- Reopening a decision is visible: it needs a new file and a review.
- The cost is a few minutes per decision. Implementation choices that are easy to change do not need a record.
