# 0005. One engine library in layers, with thin clients

- Status: Accepted
- Date: 2026-11-11
- Decisions: A1

## Context

The product is planned as a CLI first, then a local web UI, then an optional language-model layer and possibly a
desktop app. In the prototypes, command code reached into storage and connectors directly, so each new front end
would have meant a rewrite.

## Decision

OrgLens has five architectural layers: sources, extraction, store, deterministic engines, and clients. The first four
form one engine library. Clients (the CLI now, a local HTTP server with a browser UI later, the optional language-model
layer) use only the public API of the engine.

In the repository the engine package has six folders in a fixed dependency order: `core`, `sources`, `extraction`,
`store`, `engines`, `api`. `core` holds shared building blocks, and `api` is the public surface. A folder may import
only from folders earlier in that list. The order is defined once, in `layers.cjs`.

How the rule is enforced is recorded in [0023](0023-toolchain-and-layer-enforcement.md).

## Consequences

- A new client is an addition, not a rewrite.
- The language-model layer cannot bypass the engines, because it has no other way to reach the data.
- Everything that crosses the engine API is plain serialisable data, so the same API can later be served over
  local HTTP unchanged.
- The cost is some indirection: a feature usually touches several layers.
