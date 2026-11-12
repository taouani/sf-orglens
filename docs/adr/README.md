# Decision records

A decision record is one short file that states a decision, why it was made, and what it rules out. A change to
the architecture, the data model, the storage format, a public contract or the scope of a release needs one.
[0001](0001-record-decisions.md) describes the practice.

Records 0002 to 0022 write out the 27 decisions the project started from. Those decisions were agreed on
2026-11-11 and are summarised in the decision log of the
[re-architecture plan](../plans/re-architecture-plan.md#decision-log). The "Decisions" column gives the plan ids
each record covers. Records from 0023 on are decisions made during the build.

| Record                                            | Title                                                                             | Status   | Decisions  |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | -------- | ---------- |
| [0001](0001-record-decisions.md)                  | Record decisions as short files in git                                            | Accepted |            |
| [0002](0002-scope-and-release-order.md)           | Impact analysis first, riders after the correctness gate                          | Accepted | F1, F4, M3 |
| [0003](0003-llm-optional.md)                      | The language model is optional and is a client of the engines                     | Accepted | F2, S5     |
| [0004](0004-metadata-coverage-tiers.md)           | Logic tier of metadata first, with measured coverage                              | Accepted | F3         |
| [0005](0005-one-engine-five-layers.md)            | One engine library in layers, with thin clients                                   | Accepted | A1         |
| [0006](0006-sqlite-single-store.md)               | One embedded SQLite database, no graph database                                   | Accepted | A2, S2     |
| [0007](0007-immutable-snapshots.md)               | Immutable snapshots of every source                                               | Accepted | A3         |
| [0008](0008-reference-sources-and-provenance.md)  | Own static analysis is primary, Salesforce data is a cross-check                  | Accepted | A4         |
| [0009](0009-one-ingestion-path.md)                | One ingestion path for orgs and repositories                                      | Accepted | A5, S4     |
| [0010](0010-data-model-and-identity.md)           | Components and references, with keys that do not contain the org                  | Accepted | D1         |
| [0011](0011-apex-reference-granularity.md)        | Apex references at method-to-field level, with read or write                      | Accepted | D2         |
| [0012](0012-dynamic-references-and-confidence.md) | Resolve dynamic references in a fixed sequence, with three confidence tiers       | Accepted | D7         |
| [0013](0013-impact-semantics.md)                  | Impact is reachability first, then change-aware rules                             | Accepted | D3         |
| [0014](0014-access-impact.md)                     | Access impact from metadata by default, user assignments opt-in                   | Accepted | D4         |
| [0015](0015-authentication.md)                    | Reuse Salesforce CLI logins, store no credentials                                 | Accepted | D5         |
| [0016](0016-commands-config-and-json-contract.md) | A fixed command set, a stable JSON contract, and a committable configuration file | Accepted | D6         |
| [0017](0017-typescript-on-node.md)                | TypeScript on Node.js, minimum Node 24.15                                         | Accepted | S1         |
| [0018](0018-apex-analysis-foundation.md)          | Apex analysis foundation chosen by a measured trial                               | Proposed | S3         |
| [0019](0019-apache-2-licence.md)                  | Apache License 2.0                                                                | Accepted | S6         |
| [0020](0020-rewrite-in-new-repository.md)         | A rewrite in a new repository, harvesting ideas from the prototypes               | Accepted | M1, M2     |
| [0021](0021-correctness-proof.md)                 | A three-level proof of correctness and a gate before anything else                | Accepted | M4         |
| [0022](0022-public-pre-release.md)                | Public from the first commit, announced after the gate                            | Accepted | M5         |
| [0023](0023-toolchain-and-layer-enforcement.md)   | Toolchain, and layer rules enforced by independent mechanisms                     | Accepted |            |

## Writing a record

1. Copy [0000-template.md](0000-template.md) to the next free number.
2. Keep it short. Link to the plan or research note that holds the detail.
3. Add a row to the table above.
4. Run `pnpm run check:adr`. It checks the format, the links, this index, and that every decision id of the plan
   is covered by exactly one record.

An accepted record is not rewritten when the decision changes. Write a new record, and set the old one to
`Superseded by NNNN` with a link.

## Earlier prototypes

[legacy.md](legacy.md) states what became of the six decision records kept by one of the earlier prototypes.
