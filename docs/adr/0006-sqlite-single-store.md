# 0006. One embedded SQLite database, no graph database

- Status: Accepted
- Date: 2026-11-11
- Decisions: A2, S2
- Supersedes: Legacy records 0001 (three embedded stores), 0002 (Kuzu) and 0006 (DuckDB and Kuzu split). See [legacy.md](legacy.md).

## Context

The prototypes used up to three embedded stores at once: a relational store for rows, a graph database for traversal and
a vector store for search. Three stores had to be kept consistent, and the graph database chosen (Kuzu) has since been
archived by its sponsor. The target scale is orgs of 10,000 or more metadata components, which is 150,000 or so rows
once fields, methods and flow elements are counted. That is small for a relational database.

## Decision

- **A2.** Components and references live in one embedded relational database. Traversal is done with recursive
  queries or with an adjacency list loaded into memory for the session. There is no graph database.
- **S2.** The database is SQLite: one file in `.orglens/`, with its built-in full-text index for keyword search.

## Consequences

- One file, one transaction model, one thing to back up or delete.
- Research on a synthetic org (Linux only) loaded 147,000 components and 587,000 references in 6 to 7 seconds. A
  five-level traversal from a hub field took 500 to 820 ms in SQL, or about 3 ms from an in-memory adjacency list that
  costs 150 to 440 ms to load once per process. Which of the two a command uses is decided with the impact engine.
- Graph query languages are not available. Every traversal is written and tested by the project.
- The choice of SQLite driver for Node is an implementation decision recorded with the store work.
