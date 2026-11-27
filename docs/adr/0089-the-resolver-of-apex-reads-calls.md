# 0089. The resolver of Apex reads calls, constructors, overrides and the values of enums

- Status: Accepted
- Date: 2026-11-27
- Decisions: none (builds part D of work package 4 of the Phase 3 plan, with the choices the author made in it, which
  the maintainer can strike)

## Context

Work package 4 of the [Phase 3 plan](../plans/phase-3.md) builds the resolver of Apex in parts. Parts B and C
(records [0087](0087-the-resolver-of-apex-and-the-tier-of-a-name-nothing-checks.md) and
[0088](0088-the-resolver-of-apex-reads-queries-and-searches.md)) read what the code of a member reads and writes. Part
D reads what it calls. The plan says: "Calls: to a method of the snapshot, chosen by name and by the types of the
arguments where the number does not decide. A `new` calls the constructor its arguments choose, or the class where it
declares none. A call that can reach several methods, through an interface or a virtual method, is `confirmed` to the
method it names and `probable` to each override the snapshot holds. A call of a method of Salesforce is no reference,
except the methods that name an object or a field (WP5)." It also asks for the values of a `switch` and for "a call
into a class of a managed package whose body is hidden", which "refers to that class and method by name". The answer
key of version 3 holds 30 entries of `calls` by `call` and 9 by `new`, 8 of them `probable`. Record
[0084](0084-the-members-of-a-class-are-components.md) made each method and constructor a component, with its
signature in its key.

## Decision

1. **A call.** A call of a method of the snapshot `calls` the method, at the name of the method, with the `via`
   `call`. A call with something in front is a call of a method of what the resolver takes the thing in front to be:
   a value of a class or an interface of the snapshot, or the class itself for a static method. A call with nothing
   in front is of a method of the class, or of a class or interface it extends or implements, or else of the closest
   class around it that has a method of that name and number of parameters. `this(...)` calls a constructor of the
   class and `super(...)` one of the class it extends, or that class where it declares none, both with the `via`
   `call`. A method of a value of no known class, a method of Salesforce, and a method that calls itself give no
   reference. A call in what a query binds keeps the `via` `call`.
2. **`new`.** A `new` of a class of the snapshot calls the constructor its arguments choose, or the class where it
   declares none, at the name of the class after `new`, with the `via` `new`. An exception that declares a
   constructor has the four that every exception has as well, without arguments, with a message, with a cause and
   with both: a `new` that they choose calls the class, `super(...)` the class it extends, and `this(...)` gives no
   reference, as a constructor of Salesforce. A `new` of an object stays what record 0084 says: the member uses the
   object as a type.
3. **Overloads.** The methods a call can reach are those of the name that the class has, with those of the classes
   and interfaces it extends or implements that it does not override, and the number of arguments chooses among
   them. Where several are left, the types of the arguments choose, as Apex does:
   - Each argument fits a parameter exactly, as a wider type, not at all, or in a way that is not known here. A
     number fits a wider number (`Integer` a `Long`, a `Double` and a `Decimal`, and a `Double` and a `Decimal` each
     other), an `Id` a text, a `Date` a `Datetime`, a record its object and `SObject`, and a value of a class the
     classes and interfaces it extends or implements. `null` fits anything, and anything fits `Object`. A text can
     be turned into an `Id` at run time, so whether it fits one is not known. A type of Salesforce that is no class
     of the snapshot, such as `Exception` or
     `Database.SaveResult`, fits itself, and whether it fits another type of Salesforce is not known, since they extend
     one another, as exceptions do. A record, a list and a map fit no such type.
   - A parameter of the same type in every method that is left does not tell them apart and is not looked at.
   - The method that the arguments fit is chosen, also of one that each argument fits exactly where it is not known
     whether others take them. Otherwise, where it is not known for one, each method they may fit is `probable`.
     Otherwise the most specific is chosen: the one whose parameters each fit the parameters of the others, where
     `null` makes no parameter more specific. Where none is, or none fits, each is `probable`.
   - The type of an argument is the type the code declares, of the variable or of a cast, also where the resolver
     keeps a more exact type of a variable given a value once, as Apex chooses a method by what it declares. So is
     an item of such a list and a value of such a map: an item of `List<SObject> recs = [SELECT Id FROM Account]` is
     an `SObject`. A conditional or `??` is of the closest type both its values are of. The resolver knows the types
     of literals, of operations on primitive types, of the variables, properties, parameters and methods of the
     snapshot, of the tokens of objects and fields, of a class literal (`Type`), of a custom label (a text), of `get`
     of a record (`Object`), of `getSObjectType()` of a record, of `name()`, `ordinal()`, `values()` and `valueOf()`
     of an enum, of `valueOf` of a primitive type and of `String.format`, `join` and `escapeSingleQuotes`. A value of
     a method of Salesforce, and a field of a record, are of a type not known here. A field of a describe reached by
     `fields` (`Schema.SObjectType.Invoice__c.fields.Amount__c`) is a token or its describe, as the code takes it.
   - What a method gives back is the type of the call where every method chosen gives back the same type, and an
     argument is taken as a list where every method chosen takes it as a list or a map, as record 0087 does with a
     child relationship.
4. **Overrides.** A method that can be overridden is a method of an interface, or one that is virtual, abstract or
   an override, and not static. A call of one on a value is `confirmed` to the method chosen, and `probable` to each
   method that a class of the snapshot that extends or implements the class of the value, at any depth, runs for
   it: the method of the same signature that the class declares, or that it has from a class it extends, as a
   class that implements an interface through a method of its superclass. Where the code gave a variable declared
   as one class an object of a class that extends it, once, the value is of that class:
   `Shape s = new Square(); s.area(x)` is `probable` to the method of `Square` and to the methods that override it,
   and to none of another class that implements `Shape`. The variable of a loop that the loop assigns is of the type
   it declares, and a conditional of objects of two classes is of the closest class or interface both are of.
   `super.m()` calls the method of the class it extends, and no override. A call with nothing in front is a call on
   the value the method runs on.
5. **Classes whose code is not read.** A class whose code is `(hidden)`, has no file of code (record 0084), or
   cannot be parsed (`APEX_MALFORMED`) is called by name: a call of one of its methods, or a `new` of it, refers to
   the class at `confirmed`, and names the method in `attrs.method`. So do `super(...)` and `super.m()` in a class
   that extends it. Nothing is known of its methods, so what such a call gives back is not known. A class written
   `ns.Name` is the class `ns__Name` of the snapshot where it holds one, which is how the org lists a class of a
   managed package, also one whose code is read.
6. **Enums and `switch`.** A value of an enum of the snapshot that the code names (`Color.RED`) `reads` the enum,
   with the `via` `field`, as the constant of a class does. So does a bare name after `when` in a `switch` on a value
   of the enum. A bare name after `when` that is no value of that enum is not read, since Apex takes only literals
   and values of an enum there. Any other value after `when` is read as code.
7. **What the resolver reads in passing.** The variable of a `catch` has the type of the exception it names, so a
   property of an exception of the snapshot is read. `System.Database`, `System.EventBus` and `System.Label` are read
   as `Database`, `EventBus` and `Label`, so DML through `System.Database` is read as record 0087 says.
8. **Not built here.** The types of fields that the files and the descriptions give are not used to choose a method,
   nor the types that the methods of Salesforce give back: such a call is `probable` to each method it may reach. A
   call into a class that the snapshot does not hold gives nothing. The call of the constructor of the superclass that
   Apex adds to a constructor that calls none is not read. A method that a class has from a class whose code is not
   read is not found. `Type.forName(...).newInstance()` and a class name in a text are names in texts, work package 5.
   A method that overrides another and spells a type of its signature otherwise, such as `Schema.SObjectField` for
   `SObjectField`, is not taken for an override. That an org lists a class of a package as `ns__Name` was not checked
   on an org. Where a variable is given a value of a more exact type than it declares, the resolver keeps both, and
   for the class of the value only an object of a class of the snapshot counts. `Trigger.new` is a list of records
   of the object of the trigger, not the `List<SObject>` Apex declares, also where it chooses between two methods
   that take one or the other. Whether an exception of the snapshot fits a parameter of a type of Salesforce, such
   as `Exception`, is not known, so such a call is `probable` to each method it may reach. That an exception keeps
   the constructors of Salesforce beside those it declares is read from how Apex is used, and was not checked on an
   org. The count of the names nothing checks in the coverage comes with the coverage of Apex. `ApexClass` and
   `ApexTrigger` stay off the list of analysed types (record 0084) until the names in texts are read.

## Consequences

- The fixture project gives every entry of the answer key of `calls` by `call` and `new`, 39, at its line and column
  with its kind and tier, and no other reference, gives no new warning and hits no negative of the key
  (`extraction-apex-resolver.test.ts`). Its classes and triggers give 465 references. 29 defects planted in the
  resolver, each a rule of this record turned off, were each caught by its tests. The review of the pull request
  found five rules wrong (the method a class has from the class it extends, a conditional, an item of a list or a
  map, a loop that assigns its variable, and the constructors of exceptions) and turned off 26 other rules one at a
  time, of which 16 no test caught. With 16 more for the rules the fixes added, 41 of those 42 are caught now. The
  one left changes nothing for code that Apex accepts: an exception that declares no constructor is called as a
  class that declares none, and the constructors of Salesforce it would have call the class too.
- An answer about a field or an object now holds what calls the members that read or write it. On the fixture, what
  refers to `Invoice__c.Amount__c` holds 63 components, 6 more than before: five methods and a trigger that call one
  of them. Where a call is `probable`, so is the chain through it.
- On the eight public codebases, NPSP has 35,618 references by `call` and 5,613 calls by `new`. A call is `probable`
  where it reaches an override, 2,010 times in NPSP, and where the types of its arguments do not tell the methods
  apart, at 55 places of NPSP, 58 of Nebula Logger and 7 of PMM, most of them where an argument is the value of a
  method of Salesforce or a field (`extraction-corpora.test.ts`). The values of enums give 2,562 more references by
  `field` in NPSP. The other references are as before, but for one child relationship of NPSP that a constructor hands
  to another with `this(...)`, which is now a list, and the DML through `System.Database` and `System.EventBus` of
  Nebula Logger, which is now read, with 19 more warnings of records of no known object. 30 calls of NPSP drawn at
  random and 10 of its `probable` calls were read by hand, and were right. The fixes of the review changed 4
  references of NPSP, and none of the other codebases. They are 4 more: 3 `new` of an exception with a message alone,
  where it declares a constructor of two parameters, which call the class, and a method of `fflib_SObjects` that a
  domain runs through the interface it implements, which is `probable`. Each was read by hand.
- The analysis of NPSP takes about as long as before, about 6 seconds on the machine of the build.
