# 0008. Own static analysis is primary, Salesforce data is a cross-check

- Status: Accepted
- Date: 2026-11-11
- Decisions: A4
- Supersedes: Legacy record 0005 (compiler symbol table as the primary Apex source). See [legacy.md](legacy.md).

## Context

There are two ways to learn what depends on what: ask Salesforce (the Dependency API and compiler symbol data), or parse
the metadata and code. Asking Salesforce works only for live orgs, the Dependency API is in Beta and returns at most
2,000 rows per query with no paging, and whether it reports references from Apex to fields at all has not yet been
measured. Parsing works for orgs and repositories alike but can be wrong.

## Decision

OrgLens's own static analysis is the primary source of references, for orgs and for repositories. For live orgs the
Salesforce Dependency API and compiler symbol data are ingested as a second source.

Every reference records its origin. Where the two sources agree, confidence rises. Where they disagree, the
difference is reported in the coverage output. References that cannot be resolved statically are handled by
[0012](0012-dynamic-references-and-confidence.md).

## Consequences

- Repositories and orgs give comparable results, because both go through the same analysis.
- The cross-check is a correctness oracle no earlier build had. How strong it is in practice is measured on a real org
  in Phase 0, and the result may limit it to component-level checks or show that it is not usable as a cross-check.
- OrgLens must own parsers for formulas, validation rules, flows and Apex. That is most of the engineering work.
