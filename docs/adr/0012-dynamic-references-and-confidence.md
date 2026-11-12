# 0012. Resolve dynamic references in a fixed sequence, with three confidence tiers

- Status: Accepted
- Date: 2026-11-11
- Decisions: D7

## Context

Apex can name fields and objects in strings: dynamic SOQL, `sobject.get('Field__c')`, field names held in custom
metadata records or field sets. Static analysis cannot follow these directly. The first design stored them as
"unknown", which leaves exactly the blind spots that make an impact tool untrustworthy. The maintainer proposed
resolving them instead.

## Decision

Dynamic references go through a fixed resolution sequence:

1. Read the text inside query strings and other string literals and match it against the inventory of objects
   and fields.
2. Read custom metadata records and field sets that hold field names.
3. Trace how strings are built in the Apex code: constants, concatenation, values passed between methods.

Every reference, static or dynamic, carries one of three confidence tiers:

- **confirmed**: resolved statically or fully.
- **probable**: resolved from text or metadata with the object identified.
- **possible**: the object is known and the field is decided at run time.

What remains unresolved is stored as an object-level `possible` dependency, never dropped. Reading custom settings
records is opt-in. Suggestions from a language model are allowed but labelled, and never counted as facts.

## Consequences

- Nothing is silently missed. The cost is extra `possible` entries, which is the right side to err on for this
  tool.
- Results are shown by tier, confirmed first, so a long `possible` list does not hide the certain results.
- The false-positive rate of text matching has to be measured on public codebases and tuned.
- Reading custom metadata records is the one place OrgLens reads records. They are configuration, not business
  data, and they are part of the metadata retrieve.
