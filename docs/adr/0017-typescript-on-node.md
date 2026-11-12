# 0017. TypeScript on Node.js, minimum Node 24.15

- Status: Accepted
- Date: 2026-11-11
- Decisions: S1

## Context

All three prototypes were written in Python, which was not a requirement. Salesforce's own libraries for login,
retrieval and source format are JavaScript packages, and so are the Apex parsers. A Python engine would need a
bridge to Node for the hardest part of the work. The web UI will be written in a JavaScript language in any case.

## Decision

The engine, the CLI, the local web server and the UI are written in TypeScript and run on Node.js. Packages are
distributed through npm. A Salesforce CLI plugin is a possible later addition.

The minimum supported Node.js version is 24.15, the first release in which the built-in SQLite module works without
a warning. CI runs on Node 24 and 26 on Linux, macOS and Windows, and on exactly 24.15.0 on Linux.

## Consequences

- One language from parser to UI, and direct use of Salesforce's libraries.
- No native build step is required to install, as long as the built-in SQLite module is used.
- Node 22 users must upgrade. Node 22 leaves maintenance in April 2027.
- The minimum rises over time. Raising it is a change users notice and needs a changeset.

## Notes

The minimum version was set by the answer to question Q2 of the [Phase 0 plan](../plans/phase-0.md).
