# 0025. SQLite through a driver port: `node:sqlite` by default, `better-sqlite3` as the tested fallback

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0006](0006-sqlite-single-store.md) chose SQLite. Node.js offers two ways to use it. `node:sqlite` is built into
Node.js: nothing to install, but it is a release candidate and not yet stable, and the SQLite library it uses is
whatever the user's Node.js carries. `better-sqlite3` is a mature package with its own SQLite, but it is a native
module of about 27 MB, and its version 13 is a recent rewrite.

Research ([sqlite-store.md](../research/phase-0/sqlite-store.md), Linux only) ran both on the same workload: the
database files were the same size and the speed was within about 10 percent. So the choice is not about performance.
It is about what happens if either one breaks.

## Decision

- The store reaches SQLite only through a small driver port (`packages/engine/src/store/driver.ts`): open, run
  statements, prepare a statement and run it or read its rows, close, and tell whether an error means "busy",
  "not a database" or "cannot be written".
- The default driver is `node:sqlite`. The engine therefore has no runtime dependency for storage.
- `better-sqlite3` is the fallback. It is an optional peer dependency of the engine, it is never installed by
  default, and it is loaded only when it is asked for.
- Both drivers pass one shared contract test suite, and every store test runs against both, on all three operating
  systems in CI.
- The store uses only what both drivers do the same way: positional `?` parameters; values that are null, numbers,
  bigints, strings or bytes. Blobs come back as plain byte arrays.
- Where the two bindings differ on their own, the port makes them the same, and the contract suite holds each
  case. A prepared statement is one statement. It takes exactly as many values as it has parameters: on its own,
  `node:sqlite` binds NULL for a missing value. `run` is refused on a statement that returns rows, and `get` and
  `all` on one that does not. An integer is read exactly, and one that does not fit a JavaScript number is refused:
  on its own, `better-sqlite3` rounds it.
- Both bindings bind a JavaScript number as a floating-point value. A STRICT integer column stores it as an
  integer, but an expression such as `? / 2` divides as a fraction. SQL that needs integer arithmetic on a
  parameter casts it.
- The two drivers must not open the same file in one process. Nothing enforces that: the engine loads one driver
  for a workspace.
- What the SQLite library at hand can do (STRICT tables, full-text search with the trigram tokenizer, JSON
  functions, recursive queries) is probed and never assumed. `doctor` will report it.

The fallback becomes the default if `node:sqlite` breaks before it is declared stable, if a desktop shell chosen
later lacks it, or if Node.js builds that link a system SQLite cause defects that cannot be worked around.

## Consequences

- Switching driver is a change of adapter. Nothing above the port knows which one is in use.
- The port is deliberately small. A feature only one driver has, such as user-defined functions, is not available to
  the store.
- `better-sqlite3` is pinned to an exact version for the tests, and the optional peer dependency of the engine
  names the same patch line (`~13.0.3`), because no other version is tested. A version published the day before
  was not taken: the release-age guard of the toolchain applies
  ([0023](0023-toolchain-and-layer-enforcement.md)).
- A user cannot select the fallback from the command line yet. That setting comes with the configuration file.
- With the default driver, behaviour can differ between Node.js builds. The probe catches a missing feature, not a
  subtle difference.
