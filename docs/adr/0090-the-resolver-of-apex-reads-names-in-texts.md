# 0090. The resolver of Apex reads the names in the texts of a member

- Status: Accepted
- Date: 2026-11-27
- Decisions: none (builds part A of work package 5 of the Phase 3 plan, with the choices the author made in it, which
  the maintainer can strike)

## Context

Work package 5 of the [Phase 3 plan](../plans/phase-3.md) reads the names that the code of Apex holds in texts, in
the sequence of record [0012](0012-dynamic-references-and-confidence.md): the text itself (step 1), the metadata that
holds names (step 2), and how a text is built (step 3). The plan names the methods that take such a text: "The text
of a query in `Database.query`, `Database.queryWithBinds`, `Database.countQuery`, `Database.getQueryLocator`,
`Search.query` and their relatives, a field name in `get` and `put`, a relationship name in `getSObject`,
`getSObjects` and `putSObject`, an object name in `Schema.getGlobalDescribe().get(...)` and `Schema.describeSObjects`,
a field name in the map of fields of a describe, and a class name in `Type.forName`." For step 3 it names "Constants,
`+` and `+=`, `String.join` of a list of texts, `String.format`, and a text passed as an argument or given back by a
method of the snapshot". It is accepted when "every entry of the key for names in texts that is not stretch is found,
at its tier, and the unknown places of the key are reported, and no other." The answer key of version 3 holds 50 such
entries that are not stretch. Record [0088](0088-the-resolver-of-apex-reads-queries-and-searches.md) reads a query in
brackets, and record [0084](0084-the-members-of-a-class-are-components.md) a literal that `Type.forName` is given.

The work package is built in three parts. This part reads step 1, and step 3 within a member: the texts a member
builds itself, the constants it uses and the texts that methods of the snapshot give back. The second part follows a
text that a member hands to another as an argument, and the third reads step 2 and the counts of the coverage.

## Decision

1. **Where a text names something.** A text names what it holds where the code hands it to one of these:
   - a method of `Database` that runs a query, `query`, `countQuery`, `getQueryLocator`, `getCursor` and
     `getPaginationCursor` and their variants `...WithBinds`, and `Search.query` and `Search.find`: the text is read
     as a query or a search, with the `via` `text`;
   - `get` and `put` of a record: the field that is read or written;
   - `getSObject`, `getSObjects` and `putSObject` of a record: a relationship, or a child relationship, which is
     read as the code reads one after a dot (record 0087);
   - `get` of the map of fields of a describe (`Schema.SObjectType.Invoice__c.fields.getMap().get(name)`): the field,
     which the value is the token of, `references`;
   - `get` of `Schema.getGlobalDescribe()` and `Schema.describeSObjects`: the object, `references`, and the value is
     its token or its describe;
   - `Type.forName` with a text that is no literal, also with a namespace: the class, which the member uses as a type,
     as record 0084 reads a literal.

   A text anywhere else names nothing, as the key says. A record whose object is known reads or writes the field it
   names at the place of the name in the code. A name is one where the whole text is one name: `get('Account.Name')`
   names no field.

2. **What a text is.** A text is a list of pieces: characters that the code writes, each with its place in the code,
   and parts that are not known, each with the place where it enters the text and, where the code says it, whether
   it is a number, a Boolean, a date or a date and time. The characters of a literal are those Apex reads, with its
   escapes, each at its own column. A value can be one of several texts, at most 16: a value that can be more is not
   known as a whole.
3. **How a text is built.** The resolver follows the texts of the local variables of a member in the order of its
   statements: `=`, `+` and `+=`, a branch of an `if`, of a conditional or of a `switch`, after which a variable is
   any text it is after one of them, a loop, which is followed as if it ran its body once or not at all, and a `try`,
   whose `catch` starts from the texts before the block or after it. A way that returns or throws does not go on
   after its statement. A constant (`static final`) is the text of its value, whose characters all stand where the
   member uses it. A method of the snapshot that gives back a text is worked out once, with a part for each parameter,
   and a call of it is that text, its characters at the call and each parameter the text of its argument. Of the
   methods of `String`, `join` of a list the code writes out, `format`, `escapeSingleQuotes`, `valueOf`, `trim`,
   `removeStart`, `removeEnd`, `toLowerCase` and `toUpperCase` are followed. Anything else is a part that is not
   known, where it enters the text: a parameter, a field of a record, a variable of a class that is no constant, what
   a method of Salesforce gives, a list the code fills in, and a method that calls itself on the way.
4. **Reading the text of a query or a search.** Each text a value can be is put together, with each part that is not
   known filled with what can stand there: a name where a name stands, also within a name (`ns + '__Field__c'`), a
   value after an operator, a list after `IN`, a number after `LIMIT`, a condition after `WHERE`, a direction after
   an order, `SELECT` with a field and an object where the text starts with no query, and the braces of a search
   after `FIND`. The reader of the engine parses it as it parses a query in brackets, and the resolver reads it as
   record 0088 says, with the `via` `text`: each name stands where its first character stands in the code, and a name
   that a part that is not known stands in stands where that part enters the text. What a query binds is read as the
   code at the call reads it, except in a variant `...WithBinds`, which binds the keys of a map. A part that is not
   known and that no name of the text stands for can name a field of the object of the query.
5. **Tiers.** A name read from a text is `probable` at most (record 0012), also where a file defines it. Where a part
   of a name or of a query is not known and its object is, the reference is `possible`, to the object. An object
   that nothing defines gives none, since a name of it is not found. The same reference found twice, as from two
   texts a query can be, keeps the higher tier.
6. **What is not known.** Where nothing says what a text names, the resolver warns with `PATH_NOT_FOLLOWED` at the
   place where what is not known enters the text, and the warning says what that is:
   - a field whose name is known, of a record of no known object: the name, ending at `field`, or after the
     relationship the record was reached through, as record 0087 does;
   - an object that is not known: no name, ending at `object`;
   - the object of a query: the fields the query names, ending at `object`;
   - a field and its object, both not known, a class, and a query or a search of which nothing is known: no name and
     no end, so the warning bears on every answer (record 0074);
   - an object a search returns, and the child relationship of a subquery, that are not known: as record 0088 does.

   A text that can be put together in several ways is read in each. One that is no query, such as a `WHERE` that a
   loop that never runs leaves without a condition, or a subquery that the code puts into a query elsewhere, gives a
   `possible` reference to the object after `FROM` where that is known, and otherwise a warning only where its parts
   that are not known are not those of a text that was read.

7. **Not built here.** A text that a member is handed as a parameter is not known in it: the second part of the work
   package follows it from the calls. A text read from a record of custom metadata or from a field set is not known
   either: the third part reads what they hold, and the counts of the coverage. A list constant is not followed into
   its items, nor a list or a map that the code fills in with `add` or `put`, as the key says of the list constant of
   `InvoiceSelector`. `break` and `continue` are not followed: the statements after them are read as if they ran. A
   custom label is a text that is not known. Where a loop builds a text, the text it builds after two runs is not
   one of the texts followed, and so a query that a loop builds can be read as one that no run of the code makes,
   which can give a reference or a warning that the code does not need. `ApexClass` and `ApexTrigger` stay off the
   list of analysed types (record 0084) until work package 7, in which the answers take Apex in.

## Consequences

- The fixture project gives every entry of the key of a name in a text that is not stretch, 43, at its line and
  column with its kind and tier, but the 7 that records of custom metadata and field sets hold, which the third part
  reads (`extraction-apex-resolver.test.ts`). It also gives 3 entries that the key calls a stretch: the object of a
  query whose fields are a list, a list constant of another class and a list that the code fills in, and a field of
  the map of fields of an object that reaches the line through two variables. And one reference the key does not
  hold: the object of a query whose field is a text read from a record of custom metadata, which is `possible`. It
  warns at the 8 places of Apex that the key calls unknown, and at no other. Its classes and triggers give 511
  references, 46 more than before.
- An answer about a field or an object now holds what names it in a text. On the fixture, what refers to
  `Invoice__c.Amount__c` holds 67 components, 4 more than before. Four of the new warnings, of a field and a class
  that a caller names by a text, and of a field of a query whose object a caller names too, bear on every answer,
  until the second part follows the texts from their callers.
- On the eight public codebases, the names in texts give 2,134 references more: Apex Recipes 36, Nebula Logger 52,
  NPSP 1,420, V4S 117, Outbound Funds 2, Coral Cloud 8 and EDA 499. PMM gives none: the object of every query it
  builds is a text that is not known within the method. A field that the map of fields of an object gives by a known
  name is a token, which gives NPSP 5 more references by `token`. The new warnings are 1,217, of which NPSP has 926
  (`extraction-corpora.test.ts`). 393 of those of NPSP are a field that `get`, `put` or `getSObject` names on a record
  of no known object, most often an `SObject`. The other references are as before: a script compared them one by one
  in every codebase. 30 references of NPSP and 20 of EDA drawn at random were read by hand, and were right.
- The analysis of NPSP takes about 6 seconds on the machine of the build, 5 to 10 per cent more than before.
