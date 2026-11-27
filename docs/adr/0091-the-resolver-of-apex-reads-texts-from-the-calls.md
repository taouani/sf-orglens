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
   A name in which a parameter stands beside a part that the method does not know itself, as in
   `inv.get(field + inv.Status__c)`, is not known whatever a call gives: the method reports it, once, as a `possible`
   reference or a warning, and the call does not.
4. **When a method says nothing of a parameter.** A method that is reported says nothing of a part of a text that is a
   parameter of the type `String`, no `possible` reference and no warning, where every call of it reads that text
   again. It still says what it does not know itself at the same place: where a variable holds the parameter on one
   way and a text that is not known on another, as after `if (field == null) field = inv.Status__c;`, the method
   reports the use, and each call adds what it gives. Every call reads the text again where:
   - no code outside the snapshot can call the method. Such code can call a method that is `global` or `webservice`,
     a method with an annotation that offers it to Lightning, a flow, Visualforce remoting, REST or another namespace
     (`@AuraEnabled`, `@InvocableMethod`, `@RemoteAction`, `@HttpGet`, `@HttpPost`, `@HttpPut`, `@HttpPatch`,
     `@HttpDelete`, `@NamespaceAccessible`), and a public method of a class that is `global` or stands within one. It
     cannot call a method that is private, also one without a modifier of access, or protected, nor a public static
     method or a constructor of a class that is not `global`. Of the other public methods of an object, it can call
     one whose class extends or implements a type that the snapshot does not hold, such as `Schedulable` or
     `Database.Batchable`, also through a class that its class extends; one that a class offers in that way which
     extends its class and does not declare the method again, as a class that extends it and implements `Callable`;
     one that a `global` class or interface that its class extends or implements declares; and one of a single
     parameter whose name begins with `set`, which a page of Visualforce calls to set a property;
   - code of the snapshot other than the method itself calls it, also a constructor through `new`, `this(...)` or
     `super(...)`, and a call in a bind of a query;
   - no code of the snapshot calls a method of its name and number of arguments on a value whose class is not known
     there, such as an `Object` or a type of Salesforce, which could be a call of it;
   - and the method does not call itself, also through other methods (rule 5).

   Otherwise the method keeps its `possible` references and warnings, and each call adds what it gives. A test method
   is called by no code of the snapshot and keeps them.

5. **Not followed.** A call from outside the snapshot is not known, and nor is one through a value of no known class:
   the method keeps its warnings. Methods that call each other, and a method that calls itself, are worked out as a
   group: each of them without what the others of the group do with a text, and the result does not depend on the
   order in which the members are read. Each keeps its warnings, as rule 4 says. A call from outside the group reads
   again what the method does itself, not what it hands on within the group; a call within the group reads again
   what the method it calls does itself, where it is read, and says there what is not known. A list, a set, a map or
   a token handed as an argument is not followed, nor a text handed to a parameter of another type than `String`, as
   `Object`. A record a method reads is of the object the method declares: a parameter of the type `SObject` stays a
   record of no known object, also where every call hands it a record of a known one, so a field it names at a call
   is a warning there. A field of the map of fields of a describe that a call names is a reference to the field at
   the call, but what the method does with the token it gets, as `rec.get(token)`, is not read again: where the name
   is in the method, the method reads the field there. A call that gives `null` gives no text, as record 0090 reads
   `null`. The name of an object that the code takes from its token, as `String.valueOf(Invoice__c.SObjectType)` or
   `Invoice__c.SObjectType.getDescribe().getName()`, is what a method of Salesforce gives, which record 0090 does not
   read: a text that is not known.
6. **Each use once.** A method keeps each use of a text once, with what it names and the parts of it that the calls
   give: where it hands the same text on to the same use in two calls, its own calls read it once. So the work grows
   with the number of methods and calls, not with the number of the ways through them.

## Consequences

- The fixture project gives the same 511 references of classes and triggers as before, and the answer key is
  unchanged. Its methods that are handed a text, which the key calls unknown, are called by no code of the project:
  they keep their 8 warnings, as the key says. Ten tests of `extraction-apex-resolver.test.ts` hold the rules: a
  field, a relationship, a token, an object, a class with and without a namespace, a query and a search that a call
  names, a constructor, also through `this(...)`, an override, a call in a bind, a use that goes up through two
  methods, who reports a name, a part the method does not know beside a parameter or on another way, also handed on
  by a method that says nothing, a method that calls itself, two that call each other and three in a ring, read in
  both orders, each way of rule 4 in which code outside the snapshot can call a method, and those in which it cannot:
  a private method, a public static one of a class that Salesforce runs, and one that the class which offers it
  declares again. They also hold calls on a value of no known class with the same and another number of arguments,
  two uses that are one at the call, and a chain of 24 methods of which each calls the next twice. Of 59 faults
  planted in the code of this part, one at a time, the tests catch 55. Each fault takes a condition out, turns it
  round, or makes it always true or always false: in who reports a name, in when a method says nothing, in each way
  of rule 4, in the calls that are counted, in each kind of use that is read again, in the moving of a relationship,
  in the parameters bound to what the calls give, in the search for groups and their second working out, and in the
  keeping of each use once. The four that pass change nothing the analysis gives: a check that a method calls
  itself, which its group already holds; the reading of a use once at a call, where a reference is kept once anyway;
  a guard on a part beside a parameter, whose place is marked already where it enters; and the caller a call is put
  down to while a group is worked out again, which a right search for groups never needs. The faults were chosen by
  hand, one or more for each condition of the code of this part, so a fault of another kind can still pass. The 50
  faults of record 0090 were planted again: 49 are caught, and the one that passes is the same as before, in code
  that cannot be reached.
- An answer about a field now holds the method that hands its name to a helper, at the call. A warning of a helper
  that only the snapshot calls moves to the calls that hand it a text that is not known, where the impact answer
  weighs it as any other (record 0074): it bears on fewer answers where it now names a field, and on as many where
  nothing is known at the call either.
- Rule 4 takes a public method that no way of it offers to code outside the snapshot to be called only by the
  snapshot. That holds for a snapshot of an org, which holds all its code, except where anonymous Apex, which an org
  does not keep, calls the method. A repository can hold part of the code of an org only: a method that code outside
  the repository calls with a text says nothing of the text there, where a warning would be right.
- On the eight public codebases, the texts from the calls give 297 references more: Apex Recipes 11, Nebula Logger 4,
  NPSP 225, PMM 16 and EDA 41 (`extraction-corpora.test.ts`). Where a call names the field, the `possible` reference
  to the object that the method gave went (Apex Recipes 1, Nebula Logger 1, NPSP 94, EDA 6); some came at calls that
  hand over a text known only in part (Nebula Logger 2, NPSP 46, EDA 21). Of the warnings, 203 went and 277 came:
  Apex Recipes 12 went and 11 came, Nebula Logger 2 and 11, NPSP 102 and 107, PMM 6 and 44, V4S 21 and 25, and EDA 60
  and 79. Many of those that came are at a call that hands over the name of a field with a record of which nothing
  says the object (Apex Recipes 3, NPSP 45, PMM 6, V4S 24, EDA 61): the helper declares the record as an `SObject`.
  24 of PMM are at a name of an object that the code takes from its token or its describe, which rule 5 leaves
  unknown. Reading those names would turn more than half of the new warnings of PMM into references: a later part can
  do it. The other references are as before: a script compared them one by one in every codebase. The new ones of
  NPSP were read by hand at the five places of two classes where most of them stand, and were right. The fixes of the
  review of this record changed NPSP only, by 42 references and warnings, and each of them was read by hand.
- The analysis of NPSP takes about 8.1 seconds on the machine of the build instead of 6.8, and its peak of memory is
  about 635 MiB instead of 600, measured twice each way. EDA takes 2.8 seconds instead of 2.6. Most of the added time
  is spent working out the callers of a method, to know whether every call of it is known: that is a second reading
  of the code that calls a method with a parameter of the type `String`, which is kept for the whole analysis.
