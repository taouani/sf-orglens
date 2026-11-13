# 0009. One ingestion path for orgs and repositories

- Status: Accepted
- Date: 2026-11-11
- Decisions: A5, S4
- Changed by: [0034](0034-dependency-api-is-the-cross-check.md), which takes compiler symbol data out: the Tooling API supplies the Dependency API only

## Context

Metadata can be read from an org in several shapes: Metadata API format, source format, or Tooling API rows. The
prototypes had separate code paths for orgs and repositories, which gave different results for the same component.

## Decision

- **A5.** A live org is retrieved through the Metadata API and converted to source format, the same format a Git
  repository holds. Both then go through the same parsers. The Tooling API supplies the Dependency API and compiler
  symbol data. Retrieves are chunked and resumable from the start.
- **S4.** Login, retrieval and reading of source-format folders use Salesforce's own open-source libraries,
  `@salesforce/core` and `@salesforce/source-deploy-retrieve`. Only the `sources` layer may import them.

## Consequences

- An org snapshot and a repository snapshot of the same content are directly comparable.
- The libraries are maintained by Salesforce and follow new metadata types.
- Research found traps that OrgLens must handle itself: the retrieve helper skips Apex files without a
  `-meta.xml`, wildcard retrieves omit standard objects, and listing errors are swallowed. OrgLens therefore
  builds its own inventory with explicit member names and tests completeness.
- The libraries are large (about 240 packages) and slow to import (about half a second), so they are loaded only
  by commands that need them.
