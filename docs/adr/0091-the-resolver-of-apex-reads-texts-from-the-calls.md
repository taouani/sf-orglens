# 0091. The resolver of Apex reads a text that a method is handed at each call of it

- Status: Accepted
- Date: 2026-11-27
- Decisions: none (builds part B of work package 5 of the Phase 3 plan, with the choices the author made in it, which
  the maintainer can strike)

## Context

Step 3 of work package 5 of the [Phase 3 plan](../plans/phase-3.md) follows how a text is built: "Constants, `+` and
`+=`, `String.join` of a list of texts, `String.format`, and a text passed as an argument or given back by a method of
the snapshot, followed through calls as far as the analysis of the whole snapshot reaches, without a loop."
Record [0090](0090-the-resolver-of-apex-reads-names-in-texts.md) built the first part of the work package: the texts a
member builds itself, its constants and the texts that methods of the snapshot give back. In it, a parameter is a part
of a text that is not known (its rule 7), so a method that hands a parameter to `get`, to `Database.query` or to
`Type.forName` gives a `possible` reference or a warning, and its callers, which know the text, give nothing. On the
eight public codebases a script counted many such methods: helpers that read a field of a record by a name, that
build a query of an object their caller names, or that describe an object by its name.

This part follows a text from the calls. The third part reads the names that records of custom metadata and field sets
hold, and the counts of the coverage.

## Decision

1. **What a method does with a text it is handed.** A method of the snapshot is worked out once, without reporting
   anything, as record 0090 works out the texts a method gives back: each parameter is a part of a text that the calls
   give. Where the method hands a text that holds a parameter to one of the methods of rule 1 of record 0090, it keeps
   what it does with it: a field of a record that it reads or writes, a relationship of a record, a field of the map of
   fields of a describe, an object of `Schema.getGlobalDescribe()` or `Schema.describeSObjects`, a class of
   `Type.forName`, also with a namespace, or the text of a query or a search. The record, and the object of a map of
   fields, are as the method has them. Where the method hands such a parameter on to another method of the snapshot,
   which keeps a use of it, the use is the method's too, with what the method gives in place of the parameter: a use
   goes up through the calls as far as the snapshot reaches.
2. **Read again at each call.** At a call of a method of the snapshot, each use of each method the call can run
   (record [0089](0089-the-resolver-of-apex-reads-calls.md)) is read again, with the text of each argument that the
   call gives a parameter of the type `String`. The characters of the method stand at the call, as in a text that a
   method gives back, so a name stands where its first character stands: in the code of the caller, or at the name of
   the method in the call. What the text names is reported by the caller, with the `via` `text` and the tiers of
   record 0090: a field of a record of a known object, `probable`, a field whose name is known in part, `possible` to
   the object, and a warning where what is not known enters, as rule 6 of record 0090 says. A query is read again
   without its binds, which are code of the method and are read there. The relationship a record was reached through
   stands at the call.
3. **Who reports a name.** A name that holds no character of the caller, and a warning at a place of the method, are
   the method's: the method reports them where it is read, and the call does not repeat them. A name that holds a
   character the caller gives is the caller's. What a query or a search reads of an object the caller names is the
   caller's, also the fields the method writes into the query, which the method could not report without the object.
4. **When a method says nothing of a parameter.** A method that is reported says nothing of a part of a text that is a
   parameter of the type `String`, no `possible` reference and no warning, where every call of it reads that text
   again. That holds where:
   - no code outside the snapshot can call it: it is not `global` or `webservice`, it has no annotation that offers
     it to Lightning, a flow, Visualforce remoting, REST or another namespace (`@AuraEnabled`, `@InvocableMethod`,
     `@RemoteAction`, `@HttpGet`, `@HttpPost`, `@HttpPut`, `@HttpPatch`, `@HttpDelete`, `@NamespaceAccessible`), no
     class around it is `global`, and, for a method of an object, no class it belongs to or that its class extends
     extends or implements a type that the snapshot does not hold, such as `Schedulable` or `Database.Batchable`,
     through which Salesforce or other code can call it;
   - code of the snapshot other than the method itself calls it, also a constructor through `new`, `this(...)` or
     `super(...)`, and a call in a bind of a query;
   - and no code of the snapshot calls a method of its name and number of arguments on a value whose class is not
     known there, such as an `Object` or a type of Salesforce, which could be a call of it.

   Otherwise the method keeps its `possible` references and warnings, and each call adds what it gives. A test method
   is called by no code of the snapshot and keeps them.

5. **Not followed.** A call from outside the snapshot is not known, and nor is one through a value of no known class:
   the method keeps its warnings. A method that calls itself, also through other methods, is not worked out while it is
   worked out: the inner call reads nothing again, and the method keeps its warnings. A list, a set, a map or a token
   handed as an argument is not followed, nor a text handed to a parameter of another type than `String`, as `Object`.
   A record a method reads is of the object the method declares: a parameter of the type `SObject` stays a record of
   no known object, also where every call hands it a record of a known one, so a field it names at a call is a warning
   there. A call that gives `null` gives no text, as record 0090 reads `null`. The name of an object that the code takes
   from its token, as `String.valueOf(Invoice__c.SObjectType)` or `Invoice__c.SObjectType.getDescribe().getName()`, is
   what a method of Salesforce gives, which record 0090 does not read: a text that is not known.

## Consequences

- The fixture project gives the same 511 references of classes and triggers as before, and the answer key is
  unchanged. Its methods that are handed a text, which the key calls unknown, are called by no code of the project:
  they keep their 8 warnings, as the key says. Five tests of `extraction-apex-resolver.test.ts` hold the rules: a
  field, a relationship, a token, an object, a class, a query and a search that a call names, a constructor, an
  override, a method that calls itself, a use that goes up through two methods, the methods code outside the snapshot
  can call, a call on a value of no known class, and who reports a name. Of 35 faults planted in the code of this part,
  one at a time, the tests catch every one.
- An answer about a field now holds the method that hands its name to a helper, at the call. A warning of a helper
  that only the snapshot calls moves to the calls that hand it a text that is not known, where the impact answer
  weighs it as any other (record 0074): it bears on fewer answers where it now names a field, and on as many where
  nothing is known at the call either.
- On the eight public codebases, the texts from the calls give 316 references more: Apex Recipes 11, Nebula Logger 4,
  NPSP 244, PMM 16 and EDA 41 (`extraction-corpora.test.ts`). Some stand where a `possible` reference to an object
  stood before (Apex Recipes 1, Nebula Logger 1, NPSP 79, EDA 6). Of the warnings, 190 went and 277 came: Apex Recipes
  12 went and 11 came, Nebula Logger 2 and 11, NPSP 89 and 107, PMM 6 and 44, V4S 21 and 25, and EDA 60 and 79. Many
  of those that came are at a call that hands over the name of a field with a record of which nothing says the object
  (Apex Recipes 3, NPSP 45, PMM 6, V4S 24, EDA 61): the helper declares the record as an `SObject`. 24 of PMM are at a
  name of an object that the code takes from its token or its describe, which rule 5 leaves unknown. Reading those
  names would turn more than half of the new warnings of PMM into references: a later part can do it. The other
  references are as before: a script compared them one by one in every codebase. The new ones of NPSP were read by
  hand at the five places of two classes where most of them stand, and were right.
- The analysis of NPSP takes about 8.1 seconds on the machine of the build instead of 6.9, and its peak of memory is
  626 MiB instead of 608, measured twice each way. EDA takes 2.9 seconds instead of 2.7. Most of the added time is
  spent working out the callers of a method, to know whether every call of it is known: that is a second reading of
  the code that calls a method with a parameter of the type `String`, which is kept for the whole analysis.
