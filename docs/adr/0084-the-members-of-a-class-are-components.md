# 0084. The members of a class and of a trigger are components, and refer to the types they use

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (it builds work package 3 of the Phase 3 plan, with the choices of the author, which the maintainer
  can strike)

## Context

Work package 3 of the [Phase 3 plan](../plans/phase-3.md) makes a class and a trigger components with their members,
and reads their declarations and the types their members use: `extends`, `implements`, `uses-type` and
`triggers-on`. Record [0083](0083-the-engine-parses-apex-with-tree-sitter.md) gave the engine a reader of Apex and
left three things to this work package: the warning for a class whose code Salesforce hides (its point 6), the row of
the origin `parser:apex` and the types `ApexClass` and `ApexTrigger` as analysed (its point 7).

`core/keys.ts` has the canonical form of the signature of a method, and leaves the spelling of a type in it to the
analysis of Apex. Record [0081](0081-a-test-class-stays-in-an-answer-and-is-marked.md) decided that a test class and
a test method are marked, and left how the store keeps the mark to this work package.

What the code of a member reads, writes and calls comes with work packages 4 and 5. Until then the analysis reads a
part of every class.

## Decision

1. **Components.** A class, interface or enum in a file of its own (`ApexClass`) and a trigger (`ApexTrigger`) are
   components, as before. Each of their members is a component below them, of the same type: a method
   (`#method:<name><signature>`), a constructor (`#ctor:<signature>`), a property (`#prop:<name>`), a member variable
   (`#var:<name>`, one for each variable of a declaration such as `Integer a, b;`), the static and the instance
   initialisers (`#init:static`, `#init:instance`) and an inner class, interface or enum (`#inner:<name>`), whose
   members are below it in the same way (`#inner:result/method:add(invoice__c)`). A class that a trigger declares is
   below the trigger. The values of an enum are not components. A member that has the key of another one, which only
   code that does not compile can give, is the error `KEY_COLLISION`, and is left out with what is below it.
2. **The spelling of a type in a signature.** A type is taken as written, folded and without white space, as
   `apexSignature` does, with two changes: the namespace `System` is dropped (`System.Type` is `type`), and an inner
   type of the class, written by its name alone, gets the name of the class in front of it (`Result` in the class
   `InvoiceBatch` is `invoicebatch.result`, as another class writes it). The inner types of a trigger are written as
   they are: Apex has no name of a trigger to write in front of them. Nothing else is resolved: `Schema.Account` and
   `Account` are two spellings and give two keys.
3. **Names and definitions.** A member is named as Apex writes it, with the types of its parameters as written:
   `InvoiceBatch.Result.add(Invoice__c)`, `InvoiceNotifications.InvoiceNotifications(List<InvoiceNotifier>)` for a
   constructor, `Parts.static {}` and `Parts.{}` for the initialisers. A member is defined by the file of its class,
   with the SHA-256 of the text it spans, from its first annotation or modifier to its last character. A change to one
   method changes the definition of that method and of its class, and of no other member. The initialisers of one
   kind are one component, since Apex runs them one after the other: its text is the text of each of them, joined by
   a line break.
4. **References.** Each starts at the member where it stands, has the origin `parser:apex` and keeps how the file
   names its target as `via`:
   - `extends` and `implements`, `via: declaration`, from a class or an interface to a class or an interface of the
     snapshot. A type of Salesforce, such as `Database.Batchable`, is no target, but its type arguments are used as
     types.
   - `triggers-on`, `via: declaration`, from a trigger to its object, with the events in `attrs.events`.
   - `uses-type`, `via: type`, from a member to a class of the snapshot or an object that it names as a type: of a
     variable, a parameter, a return value, a property, a cast, an `instanceof`, a `catch`, a `for` over a list, the
     binding of a `when`, and every type argument. `new X[3]` uses `X` as a type.
   - `uses-type`, `via: new`, for a `new` of an object: it makes a record. A `new` of a class is a call of its
     constructor, which work package 4 reads, and gives nothing here.
   - `uses-type`, `via: text`, `probable`, for `Type.forName('Name')` and `Type.forName('', 'Name')` or with `null`,
     where the text is the name of a class of the snapshot, at the place of the first character of the name.

   A name is a type of the snapshot first: an inner type of the class or trigger it stands in, then a class, then
   `Class.Inner`. Then it is an object: a custom one by its suffix, one the snapshot has a component for or a file
   names as an object, or a standard object on the short lists of `extraction/model.ts`, which record
   [0080](0080-an-org-describes-its-objects-to-a-snapshot.md) keeps until an org describes its objects
   (`ObjectModel.isObject`). `Schema.X` is the object `X`. Any other name gives no reference: a name of Salesforce,
   such as `Database.SaveResult`, `String` or `Map`, is no component. A member that names its own type has no
   reference to itself. A reference is kept once for its kind, its target and its place.

5. **Attributes and the mark of a test.** A class, interface or enum has `kind`, a trigger `object` and `events`, as
   lower-case words with one space (`before insert`). A class with the annotation `@isTest`, every member of it and
   inner class in it, and a method with `@isTest` or the keyword `testMethod`, has `test: true` (record 0081). Any
   other component has no `test`. The store keeps the attributes of a component as it keeps those of any other, in
   `component_version.attrs`, so the mark needs no migration, and `analyse` and `impact` read it without parsing
   again. The JSON output of the mark comes with work package 7.
6. **Code that is not there.** A class or a trigger whose file holds only `(hidden)`, as an org is said to hand out a
   class of a managed package, or that has no file of code beside its file `-meta.xml`, keeps its row, is not
   analysed, and has the warning `APEX_NO_CODE` with the file in `details.path`. It changes point 6 of record 0083. A
   warning makes no analysis incomplete. It bears on every answer about what refers to a component, as any warning
   about a component that is not of the start (record [0074](0074-a-warning-counts-where-it-can-bear-on-the-answer.md)).
7. **Read in part.** The analysis has the row `parser:apex`: the classes and triggers and their members it read, and
   the files of them that do not parse or could not be read. It does not list `ApexClass` and `ApexTrigger` among the
   types it read (`snapshot_analysis.types`), since what their code refers to is not read yet. So an impact answer
   names them among the types that are not analysed, also where it holds components of them, and the rows of the
   Dependency API from a class or a trigger are counted and not compared. It changes point 7 of record 0083. Work
   package 7, which builds the answers and the cross-check of Apex, lists them.
8. **Only the list says what is read.** Whether a type is analysed, for `notCovered.notAnalysed` and for the warnings
   of a reading that an answer counts, is read from that list alone where the analysis kept one. A type of which the
   analysis has analysed components and that it does not list no longer counts as read. This changes one point of
   record [0046](0046-complete-over-the-logic-tier.md), which counted such a type as covered, and makes the code do
   what record [0044](0044-an-impact-answer.md) says: that the list decides. An analysis without the list, of schema
   version 4 or older, is judged by its analysed components as before. An earlier version gave attributes only to
   components of the types on its list, so its analyses are judged as before.
9. **The text of the command line** says that a type is not analysed "or only in part", and that what a component of
   it refers to "may be missing", where it said that a component of it is not in the answer, or that what it refers to
   is not known. A row of the Dependency API that is not compared is from "a type whose rows this version does not
   compare". The JSON output keeps its shape.

## Consequences

- The fixture project gives 168 components for its 30 files of Apex, and every entry of the answer key for
  declarations and types, 137, at its line and column, and no other reference (`extraction-apex.test.ts`). A snapshot
  of the mock org gives the same components, attributes and references as the folder (`org-snapshot.test.ts`).
- The eight public codebases give about 30,500 more components: every class and trigger of their package folders is
  read, and no two components have one key. NPSP has 19,100 components of Apex. The counts of their references were
  not checked by hand.
- An answer about an object now holds the members that use it as a type, and an answer about a class the classes
  that extend it or use it as a type. It is not complete while `ApexClass` is not analysed, and says so. An answer
  about a field holds nothing of Apex yet.
- A share object such as `Log__Share`, which Salesforce makes for a custom object and no file defines, is
  `unresolved`, as any custom name that no file defines. A standard object that no file of a repository names and that
  is not on the short lists, such as `Order`, gives no reference. A snapshot of an org has a component for each object
  the org lists, so there it is known.
- An overload is told apart by the spelling of its types. A class that changes `Account` to `Schema.Account` in a
  parameter gets a method with a new key, and the old one goes away.
- Not verified: that an org hands out the code of a class of a managed package as `(hidden)` and in no other form.
  A run of "Live org" on an org with a managed package can show it. The test org holds none.
