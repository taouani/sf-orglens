# 0024. Component key grammar: escaping, sub-component kinds and collisions

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)
- Changed by: [0034](0034-dependency-api-is-the-cross-check.md), which takes compiler symbol data out: there is no compiler data to match against

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
  spells types (an upper-case ASCII letter followed by ASCII letters and digits) and is kept exactly as given, so a new
  Salesforce metadata type gets a key without a change to the engine. The list of types is therefore open, which
  departs from the closed list of the research note: for a type the engine does not know, the producer is responsible
  for the one spelling. All objects are `CustomObject` and all fields are `CustomField`, standard ones included.
- **Name.** The Metadata API full name, for orgs and repositories alike, never a name column from a query. It is
  normalised to Unicode NFC and lower-cased without regard to the locale. This is lower-casing, not full Unicode case
  folding, with one addition: both forms of the Greek small sigma are written `σ`, because that is the one letter
  whose lower case depends on its neighbours. The name already contains the parent object (`account.industry`) and
  any namespace prefix. Only `#` is escaped, as `%23`. The percent-encoding Salesforce itself applies to a full name
  is kept as delivered and never decoded. The name is otherwise taken as delivered: spaces, also at either end, and
  invisible characters are part of it.
- **Sub-components.** The kinds are a closed list: `method`, `ctor`, `prop`, `var`, `inner`, `init`, `element`, `file`
  and `value`. In the name of a sub-component `%`, `#` and `/` are percent-encoded.
- **Apex overloads.** The name of a method ends with its signature: the parameter types, folded, without whitespace,
  with every `T[]` written as `list<t>`. Example: `#method:run(account,list<string>)`. A constructor is the signature
  alone: `#ctor:(id)`. A method or constructor in any other spelling, or without a signature, is rejected by the
  builder and by the parser. A parameter type is taken as the declaration spells it, so `Schema.Account` and
  `Account` give different keys. Which spelling the Apex resolver hands in, and how that is matched against compiler
  data, is decided with the Apex analysis.
- **Characters.** An empty name, control characters, the Unicode line and paragraph separators, and text that is not
  well-formed Unicode (a lone surrogate, which has no UTF-8 form) are rejected. Nothing else is.
- **One spelling.** A key is split at the first `:` and then at the first `#`. Only the canonical form is a key: the
  parser rejects a string that the builder would not have written.
- **Parent.** The parent of a sub-component is the key without its last step. A field, validation rule, record type,
  field set or list view belongs to its object, and a custom metadata record belongs to its type
  (`CustomObject:<type>__mdt`). The parent name ends at the first dot. Containment is derived from the key and is
  never stored as a reference.
- **Collisions.** If two components of one snapshot fold to the same key, the first is kept and the second is
  reported as an issue of severity error, with the code `KEY_COLLISION` and the files of both. They are never merged.
  This is an issue of a snapshot, stored with it, and not one of the error codes of the engine API.

## Consequences

- A key is readable and can be typed by hand. On a command line, the key of a method or of a name with spaces needs
  quoting, because of `(`, `<`, `>` and the space.
- Folding uses the Unicode tables of the Node.js release that runs it. Node.js 24 and 26 fold every code point the
  same way. A later release that changes a mapping would change keys of names in that script, which a migration
  would have to handle. Names of objects, fields and classes are ASCII and are not affected.
- A rename that only changes case is not a delete plus an add, and Apex text in any spelling resolves to the same key.
- Changing the escaping, the folding or the list of kinds changes stored keys. That needs a new record and a migration
  of existing workspaces.
- Known limit: a name that contains the literal text `%23` and a name with `#` in the same place get the same key.
  Salesforce encodes `%` in the names it delivers, so this is not expected. If it happens, it is reported as a
  collision.
- The return type is not part of a method key. Apex cannot overload on it.
- The module is pinned by the key examples of the plan in a golden file and by property tests: every key that is
  built parses back to the same key, and different sub-component paths never share a key.
