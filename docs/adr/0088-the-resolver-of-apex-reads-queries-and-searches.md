# 0088. The resolver of Apex reads the objects and fields of queries and searches

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (builds part C of work package 4 of the Phase 3 plan, with the choices the author made in it, which
  the maintainer can strike)

## Context

Work package 4 of the [Phase 3 plan](../plans/phase-3.md) builds the resolver of Apex in parts. Part B (record
[0087](0087-the-resolver-of-apex-and-the-tier-of-a-name-nothing-checks.md)) reads the fields of records, the members of
classes, the tokens and DML, and gives the records of a query the type of its object, and nothing more. Part C reads
queries and searches: "the object, every field of the select list, the filter, the order and the groups, also in a
subquery through a child relationship, and a bind variable. The alias of an aggregate is no field." The answer key
of version 3 holds 104 entries of `soql` and `sosl`. The reader of the engine (record
[0083](0083-the-engine-parses-apex-with-tree-sitter.md)) already lowers a query in brackets and a search into the model
of `apex-syntax.ts`, with its object, its fields of every clause, its subqueries, its `TYPEOF` and its binds.

## Decision

1. **What a query names.** A query in brackets `reads` the object after `FROM`, at the name of the object, also an
   object nothing knows of, which is `probable`, since what stands there is always an object. It `reads` each field it
   names, in any clause and also inside a function (`SUM(Amount__c)`, `toLabel(Status__c)`), as a field of a record of
   that object: a path through a relationship reads the lookup field behind it and goes on, a `__r` name nothing
   defines is guessed, and a relationship of no known end leaves `PATH_NOT_FOLLOWED`, all as record 0087 says of code.
   The alias of the object and the name of the object in front of a field are no relationship (`a.Name` of
   `FROM Account a`, `Account.Industry` of `FROM Account`). The alias of a field is no field. `Id` gives nothing. Each
   name is checked against the files and the descriptions, and keeps its tier or is `probable`, as record 0087 says.
2. **Subqueries.** A subquery of the select list goes through a child relationship of the object of the query. Where
   a file, a description or the short lists of the model define it, it `references` the lookup field behind it and
   `reads` the object of that field, both at the name of the relationship, and its fields are read from a record of
   that object, also in a subquery of its own. Where nothing defines it, the lookup field can have any name and the
   object can be any object: the warning `PATH_NOT_FOLLOWED` (`details.relationship`, the names of the subquery in
   `notFollowed`, without `Id`, and no `endsAt`) says that the subquery was not followed, and bears on every answer,
   as the warning of record 0087 about a child relationship used as a list. A subquery of the filter (`WHERE Id IN
(SELECT AccountId FROM Contact)`) is a query of its own object.
3. **`TYPEOF`.** The relationship is read as a path from the object of the query. Each object after `WHEN` is read,
   at its name, with its fields. The fields after `ELSE` are of the other objects the relationship leads to. Where it
   leads to one object, they are read as its fields. Otherwise nothing says which objects they are of, and the
   warning `PATH_NOT_FOLLOWED` at the relationship keeps them in `notFollowed`, with `endsAt: 'field'`, as for a path
   of record 0087. An `ELSE` of `Id` alone gives no warning. The objects a description lists for a polymorphic lookup
   are not taken away from those after `WHEN`: that is not built.
4. **Binds.** What a query or a search binds after a colon is read as code, in the scope of the member, so
   `:inv.Status__c` reads the field and `:ids` the variable of the class. Names read there are named as the query
   names them (`via` `soql`), since the query is what uses them. A token in a bind keeps the `via` `token`, as
   record 0087 says.
5. **What a query gives.** Records of its object, which record 0087 already said. Where its select list has an
   aggregate function (`AVG`, `COUNT`, `COUNT_DISTINCT`, `MAX`, `MIN`, `SUM`) or it has `GROUP BY`, it gives rows of
   `AggregateResult`, which hold no record of the object, so DML on them is DML on records of no known object. `COUNT()`
   gives a number. Both readers of the tests say which (`Query.gives`), and the test of the readers holds them against
   each other.
6. **Searches.** A search `reads` each object of its `RETURNING` and the fields named there, the name of the object
   in front of a field dropped. It gives lists of lists of records of no known object, as `List<List<SObject>>`.
7. **`via`.** The references of a query have the `via` `soql`, those of a search `sosl`, as the answer key says. The
   object, the fields, the lookup field behind a child relationship and the members a bind reads are named so.
8. **Not built here.** A query in a text, `Database.query` with a string and the names of `get` and `put` with a text
   are names in texts, work package 5. Calls, `new` of a class, overrides, interfaces and the values of a `switch` are
   part D. The count of the names nothing checks in the coverage comes with the coverage of Apex. `ApexClass` and
   `ApexTrigger` stay off the list of analysed types (record [0084](0084-the-members-of-a-class-are-components.md)).
   The old syntax `FROM Contact c, c.Account a` is not read: both readers keep only the first object and its alias,
   so `a.Name` is taken for a relationship `a` of the contact, at `probable`, and its warning `PATH_NOT_FOLLOWED`
   says that `Name` was not followed. None of the eight public codebases writes a query so.

## Consequences

- The fixture project gives every entry of the answer key of `soql` and `sosl`, 104, at its line and column with its
  kind and tier, and no other reference of them, gives no new warning and hits no negative of the key
  (`extraction-apex-resolver.test.ts`). Its classes and triggers give 426 references. The snapshot of the mock org,
  whose descriptions now define one more field that a query names, gives the same references with the tiers the
  descriptions check (`org-snapshot.test.ts`).
- An answer about a field or an object now holds the members that query it. On the fixture, what refers to
  `Invoice__c.Amount__c` holds 57 components, 8 more than before: members that query the field or a formula field
  that names it.
- On the eight public codebases, NPSP has 10,188 references by `soql` and 2 by `sosl`, and the other references of
  NPSP are those of part B with one more: a token in a bind. No reference of Apex at `confirmed` names a field that no
  file defines, or a name nothing knows (`extraction-corpora.test.ts`). The counts were not checked by hand beyond 30
  references of NPSP drawn at random and the subqueries of NPSP and EDA.
- Queries name many relationships of standard objects that the model does not know, such as `ApexClass` of a job,
  `CronJobDetail`, `UserLicense` and `PermissionSet`, and NPSP queries many relationships of the packages it builds
  on, which are guessed: their warnings go from 104 to 286 on NPSP, and `RELATIONSHIP_GUESSED` from 133 to 282. In a
  snapshot of an org a description says where most of them lead. 17 subqueries of the public codebases go through a
  child relationship nothing defines (NPSP 13, Outbound Funds 3, Apex Recipes 1). An answer of NPSP about what refers
  to a component is not complete more often than before.
