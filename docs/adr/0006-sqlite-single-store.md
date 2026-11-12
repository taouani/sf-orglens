# 0006. One embedded SQLite database, no graph database

- Status: Accepted
- Date: 2026-11-11
- Decisions: A2, S2
- Supersedes: Legacy records 0001 (three embedded stores), 0002 (Kuzu) and 0006 (DuckDB and Kuzu split). See [legacy.md](legacy.md).

## Context

The prototypes used up to three embedded stores at once: a relational store for rows, a graph database for traversal
and a vector store for search. Keeping them consistent was a constant source of defects, and the graph database
chosen (Kuzu) was archived by its sponsor in 2026. The target scale is an org of 10,000 to a few hundred thousand
components, which is small for a relational database.

## Decision

- **A2.** Components and references live in one embedded relational database. Traversal is done with recursive
  queries or with an adjacency list loaded into memory for the session. There is no graph database.
- **S2.** The database is SQLite: one file in `.orglens/`, with its built-in full-text index for keyword search.

## Consequences

- One file, one transaction model, one thing to back up or delete.
- Research measured 147,000 components and 587,000 references loading in seconds, and a hub traversal taking
  about 3 ms in memory against 500 to 820 ms in SQL. So wide traversals use the in-memory adjacency list.
- Graph query languages are not available. Every traversal is written and tested by the project.
- The choice of SQLite driver for Node is an implementation decision recorded with the store work.
