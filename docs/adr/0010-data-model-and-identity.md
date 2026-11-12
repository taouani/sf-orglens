# 0010. Components and references, with keys that do not contain the org

- Status: Accepted
- Date: 2026-11-11
- Decisions: D1
- Supersedes: Legacy record 0004 (identifier containing the org id). See [legacy.md](legacy.md).

## Context

Comparison between an org, a sandbox and a repository needs the same component to have the same identity in all
three. One prototype put the org id inside every identifier, which made that impossible without rewriting ids.

## Decision

There are two core records.

- **Component.** Anything that can be referenced or changed, down to a field, an Apex method or a flow element. It has a
  type and a name.
- **Reference.** A directed link between two components with a kind from a fixed vocabulary (`contains`, `reads`,
  `writes`, `calls`, `extends`, `implements`, `uses-type`, `triggers-on`, `grants`, `references`), an origin, a
  confidence tier, a resolution and a source location (file, line and column).

A component key is the metadata type plus the fully qualified API name including namespace, with an optional path to
a sub-component: `Type:name[#kind:sub[/kind:sub]]`. Examples: `CustomField:account.industry`,
`ApexClass:accountservice#method:run(account,boolean)`, `Flow:my_flow#element:decision_1`. Names are case-folded in
the key and the original spelling is kept for display.

The key never contains the org, the source or the snapshot. The source and the snapshot are separate columns, and the
org is a property of the source.

## Consequences

- The same component in production, a sandbox and a repository has one key, so comparison is a join.
- The reference vocabulary is closed. A new kind is a decision, not a side effect of a new parser.
- Two components that fold to the same key (names differing only in case) must be detected and reported, not
  merged silently.
