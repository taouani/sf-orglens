# 0087. The resolver of Apex reads fields, members, tokens and DML, and a name nothing checks is probable

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (builds part B of work package 4 of the Phase 3 plan and record 0080, with the choices the author
  made in it, which the maintainer can strike)
- Changed by: [0088](0088-the-resolver-of-apex-reads-queries-and-searches.md), in one point: queries and searches, with their binds, are read

## Context

Work package 4 of the [Phase 3 plan](../plans/phase-3.md) builds the resolver of Apex: what the code of a member
reads, writes and calls. It is built in parts. Part A gave a snapshot of an org the descriptions of its objects
(records [0085](0085-an-org-describes-its-objects-through-the-rest-api.md) and
[0086](0086-the-descriptions-of-objects-in-the-store.md)), and nothing read them. This part reads the fields of
records, also through relationships, the variables and properties of classes, the tokens of objects and fields, and
DML, and checks each name against the files and the descriptions. Queries and searches (part C), calls (part D) and
names in texts (work package 5) come later.

Record [0080](0080-an-org-describes-its-objects-to-a-snapshot.md) holds the answer of the maintainer to Q2 of the
plan: in a repository a name is checked against the files, a name of Salesforce or of a package that no file defines
is `external` at `probable`, and a child relationship taken for a field and a `__r` name guessed as a lookup are
`probable` with a warning. The plan adds that in a snapshot of an org a name that neither a file nor a description
defines is `unresolved`, with a warning, and that the coverage counts both. Finding 2 of the plan is the trial's
1,597 references at `confirmed` on NPSP to fields no file defines.

## Decision

1. **Where it runs.** The resolver (`extraction/apex-resolver.ts`) runs once every class and trigger was read, on the
   syntax that `readApexUnit` keeps, and gives each member the references and the warnings of its code. Its index
   holds every class of the snapshot with the declared types of its variables, properties and methods, the class it
   extends and the class around it.
2. **Scopes and types.** A name is a local variable or a parameter, then a variable or a property of its class, of a
   class it extends or of a class around it, then a class, then an object, then one of the namespaces `Schema`,
   `Trigger`, `Database` and `EventBus`. A local variable of a block hides the variable of a class. The type of an
   expression is worked out as far as the declarations say: a record of an object, a list or a map, a value of a
   class of the snapshot, a token and a describe, and nothing is guessed beyond them. A local variable that is never
   assigned again keeps the type of the value it starts with, so `SObject r = new Invoice__c()` is an invoice. A
   type of Salesforce that is no class of the snapshot, no object the analysis knows and no primitive type such as
   `Id` or `String`, such as `PermissionSet`, is kept by its name: DML on it and `new PermissionSet(Name = 'x')` take
   it as an object, since only an object can be written or made with the values of its fields. Anything else of it
   gives nothing. What stands after `FROM` in a query is always an object. `Database.delete` and `Database.undelete`
   also take a list of `Id`, whose records are of an object nothing says.
3. **References.** Each starts at the member, has the origin `parser:apex` and keeps `via`, as the answer key says:
   - `field`: a read and a write of a field of a record (`inv.Amount__c = 1` writes, `+=` reads and writes), of the
     lookup field behind a relationship (`inv.Account__r.Name` reads `Account__c` and the name of the account), of a
     variable or a property of a class (to its member component), and `references` to the lookup field behind a
     child relationship. The field `Id` gives nothing.
   - `token`: `references` to an object and a field named by a token (`Invoice__c.Amount__c`,
     `Schema.SObjectType.Invoice__c.fields.Amount__c`, `Lead.fields.Company`), to the object in front of a token, a
     describe and a method of a custom setting or a custom metadata type, and a read or a write of a field by `get`
     and `put` with a token, also one a variable or a constant holds, at the place of the argument.
   - `dml`: a write of the object of the records, at the keyword or the name of the method, with `op`: `insert`,
     `update`, `upsert`, `delete`, `undelete`, `merge` (also `Database.*`, `*Immediate`, `*Async`) and `publish` of
     `EventBus`, and `references` to the field an `upsert` tells records apart by: the name after the records, or a
     variable or a constant that holds its token, which refers as an argument of `Database.upsert` does (`token`).
     The field `Id` gives nothing there either. The name of the target of a write by DML is the name of the object,
     which the code does not write at the place of the keyword.
     A reference is kept once for its kind, its target and its place. One whose target has no key keeps the object of
     its field or of its DML in `attrs.object`.
4. **The tier of a name.** A name keeps the tier of its syntax where something checks it: a file of the snapshot
   defines it, a description of the org defines it, or it is an object that every org has, which the snapshot has a
   component for, a file names as an object, or the short lists of `extraction/model.ts` name. The description of an
   object also checks the lookup field behind each of its child relationships, of an object the org did not describe
   too. Every other name is `probable`: a field of Salesforce or of a package that no file defines, also one the short
   lists name, such as `Contact.AccountId`, a custom name no file defines, and an object nothing knows. This holds for
   the types that members use as well: record 0084 gave such a use the tier of its syntax, and it is `probable` now.
   The short lists say only that a name is a field and not a child relationship, which no warning needs to say. An
   object that a file names, as the target of a lookup, and that the snapshot holds no file of, is checked: its
   reference keeps the tier of its syntax, and is `unresolved`, since it has no key.
5. **A snapshot of an org.** A name that an object the org described lacks, and that no file defines, is `unresolved`,
   with the warning `FIELD_NOT_DESCRIBED` (`details.object`, `details.name`, the field it lacks, which is the lookup
   field behind a relationship): the org does not know it, or the user who took the snapshot cannot see it. A name
   of an object the org did not describe, which is any object the snapshot holds no file of, such as `RecordType`
   and `Profile`, and any object the org did not know, is checked as in a repository. That departs from a sentence
   of the plan and of record 0080, which would make it `unresolved` too: every field of `RecordType` that Apex names
   would be. `DESCRIPTIONS_PARTIAL` stays a warning of the reading. The test org did not know 47 of the 397 objects
   it was asked to describe (run 32 of "Live org", note [real-org](../research/phase-3/real-org.md), section 9), so
   most snapshots of an org will have it. It names no type, so it bears on no impact answer.
6. **Relationships that nothing defines.** A `__r` name that no file and no description defines is taken for the
   lookup the rule names (`Partner__r` is `Partner__c`), at `probable`, with the warning `RELATIONSHIP_GUESSED`
   (`details.relationship`, `details.object`, `details.field`). Where the code then uses it as a list, it is a child
   relationship: the guessed read and the warning are taken back, and the warning `PATH_NOT_FOLLOWED` says that the
   relationship was not followed (`details.relationship`, an empty `notFollowed` and no `endsAt`, so that it bears on
   every answer). A name of Salesforce without `__` that nothing checks is read as a field and taken back the same
   way. A use as a list is a loop over it, an index, a method of a list (`size`, `isEmpty`, `add` and the others),
   the argument of a method of a list that takes a list (`addAll`, `containsAll`, `putAll`, `removeAll`,
   `retainAll`), of the constructor of a list, a set or a map, a value given to a list or a map (a variable, an
   assignment, a return value, the items of a list of lists and the values of a map of lists, also in braces), and
   an argument that every method of the snapshot of that name and number of arguments takes as a list. A record has
   `get` and `clear` too: `get` with a text or a token, and `clear`, say nothing.
7. **Paths that are not followed.** A relationship whose object is not known, one that can lead to several objects
   (`What`, `Who`, and `Owner` where a description says that the owner can be a group) or one that nothing defines,
   leaves `PATH_NOT_FOLLOWED` where a name stands after it, with the names after it in `notFollowed` (at most 20, as
   for a flow: a warning with 20 bears on every answer) and `endsAt: 'field'`, as for a flow (record
   [0074](0074-a-warning-counts-where-it-can-bear-on-the-answer.md)). DML on records of which nothing says the
   object, such as a list of `SObject` or of `Id`, leaves `PATH_NOT_FOLLOWED` with `details.op`, an empty
   `notFollowed` and `endsAt: 'object'`: it bears only on an answer that holds an object, as the write of a record by
   a flow does. The answer key calls the one place of the fixture an unknown place. Each warning is given once for
   its place.
8. **The key test reads the tiers as a repository gives them.** The answer key holds the fields of Salesforce that
   Apex names at `confirmed`, since an org checks them. The test of the fixture, which reads a repository, lowers
   each entry in a class or a trigger whose target the key lists as standard to `probable`
   (`tierInRepository` of `test/helpers/answer-key.ts`). The key is not changed. The snapshot of the mock org, whose
   descriptions define three of those fields, keeps them `confirmed` (`org-snapshot.test.ts`).
9. **Not built here.** The count of the names nothing checks in the coverage, which the plan asks for, comes with the
   coverage of Apex. Queries and searches, with their binds, are part C (record
   [0088](0088-the-resolver-of-apex-reads-queries-and-searches.md)): here a query gives its records the type of its
   object, and nothing more. Calls, `new` of a class, overrides, interfaces and the values of a `switch` are part D.
   Names in texts, also `get('Name')` and `put('Name', v)` with a text, are work package 5. The readers of formulas,
   flows and the other metadata do not read the descriptions, and their answers do not move. `ApexClass` and
   `ApexTrigger` stay off the list of analysed types (record [0084](0084-the-members-of-a-class-are-components.md)).

## Consequences

- The fixture project gives every entry of the answer key of `field`, `token` and `dml`, 185, at its line and column
  with its kind, tier and `op`, and no other reference of them, and hits no negative of the key
  (`extraction-apex-resolver.test.ts`). Its one warning is the unknown place of the key. Its classes and triggers give
  322 references with those of record 0084. The snapshot of the mock org gives the same references with the
  descriptions, but for the tier of 11 that the descriptions check.
- On the eight public codebases no reference of Apex at `confirmed` names a field that no file defines, or a name
  nothing knows (`extraction-corpora.test.ts`). NPSP has 57,367 references by `field`, 3,810 by `token` and 3,356 by
  `dml`. The counts were not checked by hand.
- Finding 2 of the plan, counted again on NPSP. The trial had 7,249 references at `confirmed` to fields no file
  defines. Now there are none: of the 28,907 references of Apex to fields, 13,569 are `confirmed` and found, and
  15,338 are `probable` and `external`, 5,954 of them to fields with the prefix of a package and 9,384 to standard
  fields. The trial took at least 49 child relationships of standard objects for fields. Now a child relationship of
  the short lists refers to the lookup field behind it, `probable` (48), and one of the files does so at `confirmed`
  (53). Two names of Salesforce without `__` that the code uses as lists are child relationships that are not
  followed. How many others are read as fields cannot be told without a description: each such read is `probable`.
  Of the trial's 370 lookups guessed behind a `__r` name, of which at least 86 were child relationships, 81 are now
  child relationships that are not followed, since the code uses them as lists, and 133 are guessed, `probable` and
  `external`, with `RELATIONSHIP_GUESSED`, 104 of them with names after them that are not followed. At least four of
  the 133 are child relationships whose use there the resolver does not read as a list (below).
- An answer about a field now holds the members that read or write it, and an answer about an object those that
  write its records. An answer of NPSP about what refers to a component is often not complete: a warning about a child
  relationship that is not followed bears on every such answer.
- A guessed relationship can be a child relationship whose code does not show it, as in `acc.Things__r != null`: the
  reference is `probable` and the warning says that it can be one. On NPSP four such names are used as lists in other
  places: three stand in comparisons with `null` and one is an argument of a constructor (calls are part D).
- A field of Salesforce that nothing checks and that the code uses as a list, as `size()` of the Blob field
  `ContentVersion.VersionData` in a repository, is taken for a child relationship: its read is taken back, and the
  warning bears on every answer. A description of the object tells it.
- The resolver holds the syntax of every class and trigger of a snapshot at once, since a member reads the
  declarations of other classes. On NPSP the syntax takes about 125 MB of the heap. The whole analysis of NPSP takes
  about 5.5 seconds, and the heap is about 250 MB larger at its end, with what it found.
- The parser does not read a statement that starts with `Trigger.`, such as `Trigger.new[0].addError('x');`: the
  file is `APEX_MALFORMED`, and nothing of it is analysed. This is older than the resolver, and none of the eight
  codebases has such a statement (issue #112).
- An analysis of a snapshot that an older version took, which holds no descriptions, checks names as for a repository,
  and nothing in the analysis says so. The warning `DESCRIPTIONS_PARTIAL` of a snapshot names the objects the org did
  not describe.
- A description follows the permissions of the user who takes the snapshot. On the test org that user sees 8 of the
  59 custom fields of the fixture project (run 32). A field that a file defines is found from its file, so that
  changes nothing here. Not verified on a real org: how many names `FIELD_NOT_DESCRIBED` gives, and which objects an
  org does not know and whether Apex names them.
