# 0034. Own static analysis is primary, and the Dependency API alone is the cross-check

- Status: Accepted
- Date: 2026-11-12
- Decisions: A4
- Supersedes: [0008](0008-reference-sources-and-provenance.md)

## Context

[0008](0008-reference-sources-and-provenance.md) named two sources from Salesforce as a cross-check for the
references OrgLens finds itself: the Dependency API and the symbol data of the Apex compiler. How strong either
is was not known then. Phase 0 measured both on a real org with the fixture project in it
([real-org.md](../research/phase-0/real-org.md)).

- **The Dependency API** reports 100 of the 137 pairs of the answer key, and none of its 117 rows between two
  components of the fixture project is wrong. Its other 107 rows were counted and not checked. It knows custom
  fields, custom objects and standard objects as targets, and classes, triggers, formula fields and active
  validation rules as sources. It has no row for a standard field, for a name in text, for a field named only in
  a describe call or through a token kept in another class, for the target of a lookup, or for a rule that is not
  active. Of a roll-up summary it reports the field in its filter and nothing else. A row names two components.
  It does not say which method refers, where, how often, or whether a field is read or written.
- **The symbol table** that an org keeps for a saved class holds what the class declares and no reference at
  all. A symbol table with references can only be had by compiling a copy of the class in the org, which writes
  to the org and needs the permission to author Apex.

The maintainer decided on 12 November 2026 that the Dependency API alone is the cross-check for Apex, and that
nothing is compiled in the test org to learn what such a symbol table holds. That is all the maintainer decided.
This record writes it down and draws two conclusions from it, which the section "What goes further than the
decision of the maintainer" names.

## Decision

OrgLens's own static analysis is the primary source of references, for orgs and for repositories. This part of
0008 is unchanged.

**For a live org, the Dependency API is the one second source from Salesforce.** Compiler symbol data is not
read, and OrgLens compiles nothing in an org: not in the test org of the project, and not in the org of a user,
which the goal of the project already rules out ("read-only against every org").

- Every reference records its origin. Where the Dependency API has a row for a pair that OrgLens found, confidence
  rises. Where it has a row and OrgLens has no reference, the difference is reported in the coverage output.
- A pair that OrgLens found and the Dependency API does not have is a difference only where the API could have
  seen it. The coverage output says for each reference whether it is of a kind the API reports, by the list
  above. A reference to a standard field or from a name in text is never counted against OrgLens for want of a
  row.
- Four other records name compiler data and are read without it from now on. Each stays in force for everything
  else, and each has a note that points here: the sentence of [0009](0009-one-ingestion-path.md) that the Tooling
  API supplies "the Dependency API and compiler symbol data", level 2 of [0021](0021-correctness-proof.md), the
  sentence of [0010](0010-data-model-and-identity.md) that a reference can be reported by "the SymbolTable or the
  Dependency API", and the sentence of [0024](0024-component-key-grammar.md) about matching a key against
  compiler data.

## What goes further than the decision of the maintainer

Two sentences of the decision above are conclusions of the author of this record. They are in force with the
record, and the maintainer can strike either.

- **"Not in the org of a user."** The maintainer decided for the test org. That OrgLens compiles nothing in the
  org of a user follows from the goal statement, "read-only against every org", which the maintainer confirmed
  on 11 November 2026.
- **How a missing row is counted.** That a pair without a row is a difference "only where the API could have
  seen it" is a rule of the author. Without it, every reference to a standard field would count as a
  disagreement with Salesforce. What the correctness gate asks for in the kinds the API does not see is put to
  the maintainer as question Q3 of the [Phase 1 plan](../plans/phase-1.md), and the answer may change this
  rule.

## Consequences

- OrgLens stays read-only against every org, with no exception for analysis.
- For custom fields and custom objects, the Dependency API can show a reference that OrgLens missed. That is the
  half of the correctness gate that Salesforce can still carry.
- For standard fields, names in text, lookups, roll-up summaries and inactive rules nothing from Salesforce
  confirms or contradicts OrgLens. Recall there is measured against the answer key and against public codebases
  only. What the gate of 0021 asks for in these kinds is a question for the maintainer, and its answer is a new
  record.
- Read against write, the method and the place of a reference are checked by nothing from Salesforce. The answer
  key and a check by hand of a sample are the only measure.
- The limits above were measured on one small Developer Edition org. Flows, layouts and every type the fixture
  project does not hold yet were not measured, and neither was an org above the limit of 2,000 rows per query.
  Each is measured in the phase that builds the type, and at the gate.
- The Dependency API is still in Beta. If Salesforce removes or changes it, the cross-check goes with it and the
  answer key stands alone.
- A later decision can add a compile in an org as an option the user chooses. It would be a new record, and it
  would change the rule that OrgLens writes nothing.
