# 0002. Impact analysis first, riders after the correctness gate

- Status: Accepted
- Date: 2026-11-11
- Decisions: F1, F4, M3

## Context

The earlier prototypes went broad before deep: question answering, documentation, audits and impact analysis were
all started and none was proven correct on a real org. The capability users asked for first is impact analysis
before a change.

## Decision

- **F1.** The first release is the impact core: org and repository ingest, a field-level dependency graph, the
  four impact questions, comparison, and coverage reporting. Automation order, integration map and a basic
  security audit follow as riders over the same graph. No rider starts until impact analysis has passed the
  correctness gate ([0021](0021-correctness-proof.md)).
- **F4.** Retrieval-augmented question answering, vector search, the standalone binary build and unused dependencies are
  not carried over. By default OrgLens queries no record data from an org. The one exception is an explicit opt-in,
  recorded in [0014](0014-access-impact.md). Documentation and diagram generation, dead-code detection and security
  posture audit are deferred.
- **M3.** Build order is a thin slice through every layer first (objects, fields, formulas, validation rules), then
  widening by metadata family (flows and configuration, Apex, permissions), then comparison and access. The Apex trial
  ([0018](0018-apex-analysis-foundation.md)) runs alongside.

## Consequences

- Each phase ends with something usable and checkable. Design mistakes surface while they are cheap.
- Requests for riders and for language-model features are recorded and wait. This is the main guard against
  scope creep by a solo developer.
- A command is added to the CLI only when it does something. There are no stubs.
- Not reading record data keeps the local-first promise simple: by default OrgLens reads metadata and code, nothing
  else.
