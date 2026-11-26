# 0004. Logic tier of metadata first, with measured coverage

- Status: Accepted
- Date: 2026-11-11
- Decisions: F3
- Changed by: [0036](0036-what-a-snapshot-of-an-org-reads.md), which makes the logic tier the default of a snapshot of an org and, as a reading of its author, adds custom labels, custom permissions and global value sets to that default. It also holds the note of the maintainer on the goal
- Changed by: [0038](0038-a-snapshot-reads-every-type.md), which supersedes 0036: a snapshot of an org reads every type from Phase 1 on, reports included, and the logic tier is the measure of a complete snapshot
- Changed by: [0055](0055-email-templates-report-types-and-quick-actions-in-phase-2.md), in one point: email templates, which this record has in the presentation tier and after the correctness gate, are analysed in Phase 2, with report types and quick actions
- Changed by: [0079](0079-lightning-components-and-visualforce-pages-in-phase-3.md), in one point: Visualforce pages (`ApexPage`), which this record names in neither tier, join the logic tier with their analyser in Phase 3

## Context

A Salesforce org has hundreds of metadata types. Supporting all of them before proving any is how the earlier builds
lost depth. Some types, reports above all, can number in the tens of thousands and would dominate retrieval time.

## Decision

The first release covers the logic tier: objects, fields including formulas, validation rules, Apex classes and
triggers, flows, workflow rules, record types, custom metadata types and their records, field sets, profiles, permission
sets and permission set groups, Lightning web components and Aura components, and named credentials.

The presentation tier is the next coverage milestone, built after the correctness gate (phase 6 of the roadmap):
layouts, Lightning pages, list views, reports, email templates and sharing rules. Reports are opt-in.

Every snapshot records, per metadata type, what was listed, what was retrieved and what was analysed. Results are
shown together with that coverage.

## Consequences

- The logic tier holds everything that can break at run time, so impact answers are meaningful early.
- A user can always see which types an answer does not cover. A type that is not covered is reported as not
  covered, never as having no dependencies.
- Layout and page references to a field are missing until the presentation tier is built, and the coverage
  output says so.
