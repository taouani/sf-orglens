# 0003. The language model is optional and is a client of the engines

- Status: Accepted
- Date: 2026-11-11
- Decisions: F2, S5
- Supersedes: Legacy record 0003 (LiteLLM as the language-model abstraction). See [legacy.md](legacy.md).

## Context

Two prototypes put a language model and a vector index at the centre. Embeddings were the heaviest dependency,
needed network access or a large local model, and served a secondary feature. For structured metadata, an exact
graph query gives a better answer than similarity search, and it gives the same answer every time.

## Decision

- **F2.** Every result comes from the deterministic engines. A language model is optional. First it explains and
  summarises results; later an agent may call the engines as tools. There is no retrieval-augmented generation,
  no vector store and no embeddings. Lookup by name uses keyword search in the database.
- **S5.** Access to language models goes through one small internal interface with two adapters to start: the
  OpenAI-compatible protocol, which covers most hosted and local providers, and Anthropic. The client library is
  chosen when the layer is built.
- The language-model layer is a client of the engine API like the CLI. It never reads the store directly.

## Consequences

- OrgLens is fully usable with no model and no API key. Analysis of stored snapshots and of Git sources needs no
  network.
- Provider choice stays open, including local models.
- Free-form questions arrive late, after the correctness gate. The `ask` command is not part of the first
  release.
