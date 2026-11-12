# 0024. Component key grammar: escaping, sub-component kinds and collisions

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0010](0010-data-model-and-identity.md) fixed the shape of a component key, `Type:name[#kind:sub[/kind:sub]]`, and
that names are case-folded. Writing the key module needed answers that record leaves open: which characters are
escaped, which kinds of sub-component exist, how Apex overloads are told apart, what the parent of a key is, and what
happens when two components fold to the same key.

Real names are wider than identifiers. Profile, layout and report names contain spaces and punctuation, and Salesforce
delivers some of them with its own percent-encoding. The research note
[harvest-and-config.md](../research/phase-0/harvest-and-config.md) holds the prototype this grammar was tried with.

## Decision

- **Type.** The Metadata API type name in registry spelling, for example `ApexClass`. A type the engine knows is
  accepted in any case and written in that spelling. A type it does not know is accepted only as the Metadata API
  spells types (an upper-case letter followed by letters and digits) and is kept as given, so a new Salesforce
  metadata type gets a key without a change to the engine. All objects are `CustomObject` and all fields are
  `CustomField`, standard ones included.
- **Name.** The Metadata API full name, for orgs and repositories alike, never a name column from a query. It is
  normalised to Unicode NFC and lower-cased without regard to the locale. It already contains the parent object
  (`account.industry`) and any namespace prefix. Only `#` is escaped, as `%23`. The percent-encoding Salesforce itself
  applies to a full name is kept as delivered and never decoded.
- **Sub-components.** The kinds are a closed list: `method`, `ctor`, `prop`, `var`, `inner`, `init`, `element`, `file`
  and `value`. In the name of a sub-component `%`, `#` and `/` are percent-encoded.
- **Apex overloads.** The name of a method or constructor ends with its signature: the parameter types, folded,
  without whitespace, with every `T[]` written as `list<t>`. Example: `#method:run(account,list<string>)`.
- **Characters.** Control characters and the Unicode line and paragraph separators are rejected. Nothing else is.
- **One spelling.** A key is split at the first `:` and then at the first `#`. Only the canonical form is a key: the
  parser rejects a string that the builder would not have written.
- **Parent.** The parent of a sub-component is the key without its last step. A field, validation rule, record type,
  field set or list view belongs to its object, and a custom metadata record belongs to its type
  (`CustomObject:<type>__mdt`). Containment is derived from the key and is never stored as a reference.
- **Collisions.** If two components of one snapshot fold to the same key, the first is kept and the second is
  reported as an issue of severity error. They are never merged.

## Consequences

- A key is readable and can be typed by hand on the command line.
- A rename that only changes case is not a delete plus an add, and Apex text in any spelling resolves to the same key.
- Changing the escaping, the folding or the list of kinds changes stored keys. That needs a new record and a migration
  of existing workspaces.
- Known limit: a name that contains the literal text `%23` and a name with `#` in the same place get the same key.
  Salesforce encodes `%` in the names it delivers, so this is not expected. If it happens, it is reported as a
  collision.
- The return type is not part of a method key. Apex cannot overload on it.
- The module is pinned by the key examples of the plan in a golden file and by property tests: every key that is
  built parses back to the same key, and different sub-component paths never share a key.
