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
   names at the place of the name in the code. A name is one where the whole text is one name: of any other text, as
   `get('Account.Name')`, which Salesforce refuses, or an empty text, the field is not known, which gives the
   `possible` reference of rule 5. A token that a text names stays a name in a text where `get`, `put` or
   `Database.upsert` takes it: the field is read or written where the text stands, when the code hands the token
   over right where it gets it, and where the code uses the token otherwise.

2. **What a text is.** A text is a list of pieces: characters that the code writes, each with its place in the code,
   and parts that are not known, each with the place where it enters the text and, where the code says it, whether
   it is a number, a Boolean, a date or a date and time. The characters of a literal are those Apex reads, with its
   escapes, each at its own column. A value can be one of several texts, at most 16: of a value that can be more, the
   first 15 are followed, and a part that is not known stands for the others where the code uses the value.
3. **How a text is built.** The resolver follows the texts of the local variables of a member in the order of its
   statements: `=`, `+` and `+=`, a branch of an `if`, of a conditional or of a `switch`, after which a variable is any
   text it is after one of them, a loop, which is followed as if it ran its body once or not at all, `do`, which runs
   its body once at least and is followed as if it ran it once, and a `try`, whose `catch` starts from the texts before
   the block or after any statement of it that does not end it. A way that returns or throws does not go on after its
   statement. A variable that one way does not know is not known after that way only: it is a part that is not known
   where the code uses the variable, beside the texts of the other ways. `null` is no text: a variable that is `null`,
   also one of a primitive type that is declared without a value, names nothing, adds nothing to a text with `+`, and a
   method that gives back `null` on a way gives its other texts. A number that the code works out, with `++`, `--`, `-`
   or `+=`, is not known, and `+` before a text changes nothing. Each accessor of a property is read on its own. A
   constant (`static final`) is the text of its value, whose characters all stand where the member uses it. A method of
   the snapshot that gives back a text is worked out once, with a part for each parameter, and a call of it is that
   text, its characters at the call and each parameter the text of its argument. Of the methods of `String`, `join` of a
   list the code writes out, `format`, `escapeSingleQuotes`, `valueOf`, `trim`, `removeStart`, `removeEnd`,
   `toLowerCase` and `toUpperCase` are followed. Anything else is a part that is not known, where it enters the text: a
   parameter, a field of a record, a variable of a class that is no constant, what a method of Salesforce gives, a list
   the code fills in, and a method that calls itself on the way.
4. **Reading the text of a query or a search.** Each text a value can be is put together, with each part that is not
   known filled with what can stand there: a name where a name stands, also within a name (`ns + '__Field__c'`), a
   value after an operator, a list after `IN`, a number after `LIMIT`, a condition after `WHERE`, a direction after
   an order, also after the last of several fields, `SELECT` with a field and an object where the text starts with no
   query, more of the select list after a whole name in it, nothing after a whole name or value at the end of the
   text, a scope after `USING SCOPE`, a number after `LAST_N_DAYS:` and its relatives, a bind of Apex after any other
   colon, which names nothing of the query, and a word of the search after `FIND`. The braces of a search after
   `FIND` become quotes, since the reader of the engine knows a search in brackets in that form, and what stands in
   them is a word. The reader of the engine parses it as it parses a query in brackets, and the resolver reads it as
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
   - the object of a query: the names the query holds, its fields, the child relationship of each subquery and what
     the subquery names, and what a `TYPEOF` names, ending at `object`;
   - a field and its object, both not known, a class, and a query or a search of which nothing is known: no name and
     no end, so the warning bears on every answer (record 0074);
   - an object a search returns, and the child relationship of a subquery, that are not known: as record 0088 does,
     and a part that is not known in such a subquery is a field of its object, which that warning stands for.

   Two warnings at one place, as the parts of a text that a method gives back, which all stand at the call, are one,
   which keeps the names of both and an end only where both have it.

   A text that can be put together in several ways is read in each. One that is no query, such as a `WHERE` that a
   loop that never runs leaves without a condition, or a subquery that the code puts into a query elsewhere, gives a
   `possible` reference to the object after the `FROM` outside brackets where that is known, and otherwise a warning
   only where its parts that are not known are not those of a text that was read. The warning says that the text
   could not be read as a query or a search, or, where parts of it are not known, that it could not be read as far
   as it is known.

7. **Not built here.** A text that a member is handed as a parameter is not known in it: the second part of the work
   package follows it from the calls. A text read from a record of custom metadata or from a field set is not known
   either: the third part reads what they hold, and the counts of the coverage. A list constant is not followed into its
   items, nor a list or a map that the code fills in with `add` or `put`, as the key says of the list constant of
   `InvoiceSelector`, nor a list that a local variable holds, also one the code writes out: `String.join` and
   `Schema.describeSObjects` read the items of a list only where the code writes it out at the call. `break` and
   `continue` are not followed: the statements after them are read as if they ran. A custom label is a text that is not
   known. Where a loop builds a text, the text it builds after two runs is not one of the texts followed, and so a query
   that a loop builds can be read as one that no run of the code makes, which can give a reference or a warning that the
   code does not need. `ApexClass` and `ApexTrigger` stay off the list of analysed types (record 0084) until work
   package 7, in which the answers take Apex in.

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
- On the eight public codebases, the names in texts give 2,179 references more: Apex Recipes 36, Nebula Logger 52,
  NPSP 1,444, V4S 141, Outbound Funds 2, Coral Cloud 8 and EDA 496. PMM gives none: the object of every query it builds
  is a text that is not known within the method. A token of a field that the map of fields of an object gives by a
  known name is a name in a text where `get` or `put` takes it, which gives 5 of those of NPSP. The new warnings are
  1,248, of which NPSP has 947 (`extraction-corpora.test.ts`). 611 of those of NPSP stand, as a script counted them, at
  `get`, `put`, `getSObject`, `getSObjects` or `putSObject` of a record of no known object, most often an `SObject`.
  The other references are as before: a script compared them one by one in every codebase. 30 references of NPSP and
  20 of EDA drawn at random were read by hand before the review, and were right. What the fixes of the review changed
  was compared one by one with the references before them.
- The analysis of NPSP takes about 6.8 seconds on the machine of the build, 15 to 20 per cent more than before, measured
  three times each way.
- The review of the pull request found that a search in braces was never read, that a token a text names came out
  `confirmed`, that a way that does not know a text lost the texts of the other ways, that a number kept an old text and
  made up a name, that some parts that are not known were filled so that the reader refused a query that can be read,
  that the warning of a query of an object that is not known left out its subqueries, that a getter that ends ended the
  setter too, and that `do` and a `catch` lost or made up names. Each is fixed, with a test. Measured on the codebases
  again, three fixes showed side effects, fixed too: a value of more than 16 texts became one that is not known, `+`
  before a text lost the text, and of two warnings at one place only the first was kept. Of 50 faults planted in the
  code of this part, one at a time, the tests catch 49. The one they miss lets a `catch` start after a statement of its
  block that follows a `return` or a `throw`, which Apex refuses as a statement that cannot be reached.
