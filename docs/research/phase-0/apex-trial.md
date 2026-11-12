# The Apex trial: two parsers, one resolver

Written on 12 November 2026. This is the report of work package 9 of the [Phase 0 plan](../../plans/phase-0.md).
The code is in [`trial/apex`](../../../trial/apex/README.md). The decision is record
[0018](../../adr/0018-apex-analysis-foundation.md).

Every number below was measured with the code in this repository, on one Linux machine with 4 cores and 16 GB of
memory, with Node.js 24.22.3. Claims are marked where they rest on a reading and not on a measurement.

## Outcome in short

- Both parsers, `@apexdevtools/apex-parser` 5.3.0 (A) and `web-tree-sitter-sfapex` 3.0.2 (B), reach every pass
  mark on the fixture project with the same resolver: 181 of 181 references, none extra, none on a negative case.
- On three public codebases with about 395,000 lines of Apex, the resolver reports exactly the same 59,845
  references, the same unknown places and the same calls with either parser.
- So the choice does not rest on correctness. It rests on the gates of the plan. B reads NPSP in 3 seconds with a
  peak of 440 MB. A needs 16 to 17 seconds and a peak of 1,501 to 1,532 MB, which is over the mark of 1.5 GB in
  each of three runs, and it runs out of memory when the heap is limited to 512 MB.
- By the rule of the plan the parser is B, tree-sitter. The adapter for A stays in the repository as a second
  reading of the same code, which a test compares with the first.
- The score on the fixture flatters the resolver. A check on NPSP found four kinds of code the resolver did not
  understand, and two kinds it cannot understand without a complete description of the objects. They are listed
  under "What the resolver does not do".

## What was built

One model of the syntax of Apex (`syntax.ts`, 225 lines): declarations, statements, expressions, queries, each
name with its line and column. One adapter per parser lowers the tree of the parser into this model. The resolver
(`resolver.ts`, about 1,500 lines) is written once against the model and knows nothing of a parser. It keeps
scopes and the declared types of variables, follows fields and relationships of records, reads SOQL and SOSL,
follows the text of a query that Apex builds at run time, and records which method calls which.

| | A: apex-parser | B: tree-sitter |
| --- | --- | --- |
| Lines of the adapter, without blank lines and comments | 669, of which 143 are the list of imports | 584, of which 23 are imports |
| What the adapter works with | One class per rule of the grammar | One kind of node, with a type name and named fields |
| Loading | Synchronous | One `await` at the start: the grammar is WebAssembly |
| Memory of a tree | Garbage collected | Freed by hand as soon as the tree is lowered |

Hours of work are not given. An AI assistant wrote both adapters in one session, the second with the first in
view, so the time says nothing a person could plan with. What can be compared is the list of things that needed a
second look, under "Surprises of each parser".

## The fixture project

`node trial/apex/src/run-fixture.ts <parser>` against `fixtures/expected/answer-key.v0.yaml`:

| Measure | Pass mark | A | B |
| --- | --- | --- | --- |
| Recall: entries of the key in Apex that are not stretch | 95% | 181 of 181 | 181 of 181 |
| Precision: reported references that the key has | 98% | 181 of 181 | 181 of 181 |
| Kind (reads, writes, references, extends, triggers-on) right among the matches | 99% | 181 of 181 | 181 of 181 |
| References on a negative case | 0 | 0 of 21 | 0 of 21 |
| Unknown places of the key that are reported | | 5 of 5, none more | 5 of 5, none more |
| Source member, the way the target is named, tier and DML operation wrong | | 0 | 0 |
| Stretch entries in Apex that are found | | 3 of 3 | 3 of 3 |

The first run of the resolver gave 178 of 181 and two extra references. One mistake caused all five: a parameter
of type `String` was taken for an empty text, so a field name that comes from the caller was read as the empty
name. After the fix the score was 181 of 181. The first run with B gave 176 of 181, because the adapter used the
grammar for SOQL alone, which does not read a bind variable. The key was not changed, and the resolver has no
case that names a class or a field of the fixture.

**What this score is worth.** The resolver was written by the author of the fixture and of its key, with both in
view. The score shows that the design can express everything the key asks for, and that both parsers give the
resolver what it needs for that. It does not show how the resolver does on code it has not seen.

## Three public codebases

The codebases of `fixtures/corpora.toml`, at the commits pinned there, read from the root of each repository:
`node trial/apex/src/run-corpus.ts <parser> .corpora/<name>`. Each run is a process of its own. Each was done
three times. Time is the range of the three runs. Memory is the peak of the resident memory of the process.

| | apex-recipes | Nebula Logger | NPSP |
| --- | --- | --- | --- |
| Files, lines | 142, 17,890 | 245, 56,853 | 1,070, 320,093 |
| References found, with A and with B | 1,026 | 13,331 | 45,488 |
| Unknown places, with A and with B | 23 | 111 | 1,293 |
| Calls between methods of the codebase, with A and with B | 890 | 9,360 | 30,037 |
| A: parsing | 1.25 to 1.27 s | 3.40 to 3.47 s | 15.3 to 16.4 s |
| B: parsing | 0.17 to 0.22 s | 0.76 to 0.77 s | 2.42 to 2.44 s |
| A: everything | 1.31 to 1.33 s | 3.67 to 3.70 s | 16.1 to 17.3 s |
| B: everything | 0.24 to 0.30 s | 1.01 to 1.03 s | 3.04 to 3.13 s |
| A: peak memory | 341 to 349 MB | 647 to 654 MB | 1,501 to 1,532 MB |
| B: peak memory | 325 to 327 MB | 331 to 342 MB | 437 to 442 MB |

**The same output.** For each codebase the two result files were compared entry by entry: file, line, column,
word, source member, target, kind, the way the target is named, tier and operation. They are equal, in the same
order, for the references, the unknown places and the calls. Before they were equal, one difference showed: A
reads a variable that is declared in the body of a trigger as a field of the trigger. The adapter for A now
lowers it as a local variable, which is what it is.

**Files without a tree.** In apex-recipes and Nebula Logger every file gives a tree without a problem, with both
parsers. In NPSP four files give a problem with both. All four are scripts of anonymous Apex under `scripts/` and
`datasets/`, three of them with placeholders such as `%%%NAMESPACE%%%`. They are not classes. No class and no
trigger of the three codebases fails to parse.

**Memory of A.** After NPSP is parsed and nothing of it is kept, 372 MB of heap stay in use with A, against 29 MB
with B. It is the cache the ANTLR run time builds as it reads, which belongs to the parser class and which no
public call empties. With `--max-old-space-size=512` the run with A ends with "heap out of memory". The run with
B completes with a heap of 256 MB. The target of the plan for NPSP was under 60 seconds and under 1.5 GB: A meets
the first and misses the second by 1 to 32 MB, B meets both with room.

**Texts of queries.** In NPSP the resolver finds 405 queries that are built as text. For 105 of them the text
with its unknown parts is not a query either parser can read, mostly because a whole clause comes from a
variable. For those only the object after `FROM` is looked for. The number is the same for A and B.

## A check by hand of 100 references

`sample.ts` drew 100 of the 1,016 references of apex-recipes with the seed 2026. For each one the line of source
was read, and where the line does not decide it, the declaration of the variable or the `FROM` of the query. The
check was done by the AI assistant that wrote the resolver, not by a second person.

All 100 name the right target with the right kind at the right place: 43 fields of a record in an expression, 36
fields and objects of a static query, 15 DML statements, 2 names in the text of a query, 2 object tokens, 1 name
of a search and 1 trigger. 58 are reads, 39 writes, 2 references and 1 the object of a trigger. With no error in
100, the share of wrong references in apex-recipes is below about 3%, with the usual 95% confidence. The source
member of each reference was compared by its name, not derived again.

The sample was drawn before the four additions described below. They added 10 references in apex-recipes and
removed none. All 10 are of one form, a field read on the result of a query, `[SELECT Name FROM Account ...].Name`,
and were read as well: all 10 are right.

## A check for references that are missed

A sample of what was found says nothing about what was missed. For that, every word in the Apex of NPSP that ends
like a custom name (`__c`, `__r`, `__e`, `__mdt`) and stands outside a comment was listed by a script, 39,790
places, and compared with the places of the references and unknown places.

| Where the word stands | Places |
| --- | --- |
| Covered by a reference or an unknown place | 25,822 |
| Not covered: a type in a declaration, a cast or a constructor. The key does not count these. | 9,799 |
| Not covered: inside a text that is no query and no argument of `get` or `put` | about 3,030 |
| Not covered: the object in front of a field token, a describe call or a method of a custom setting. The reference stands at the field. | about 870 |
| Not covered: in a script that does not parse | 129 |
| Not covered: something else | at most 140 |

The middle rows are sorted by patterns of text, so their counts are approximate. The last row is the one that
matters. A sample of it was read. Most of it is the word a second time on the same line inside a message of an
assertion. The rest is a field behind a child relationship of a package that the repository does not hold, such
as `opp.npe01__OppPayment__r[0].npe01__Paid__c`.

The first pass of this check, before the additions, had about 500 places in the last row and showed four things
the resolver did not understand. They were added, each in a few lines, without a change to an adapter:

1. `Invoice__c.SObjectType.fields.Amount__c`, a third way to write a field token.
2. A field on the result of a query: `[SELECT Name FROM Account LIMIT 1].Name`.
3. The methods of a custom setting: `Settings__c.getOrgDefaults().Limit__c`.
4. A field behind a lookup whose target the project does not describe was dropped without a word. It is now an
   unknown place. This raised the unknown places of NPSP from 974 to 1,293.

None of the four is in the fixture project, which is why the score of the fixture did not move.

## Calls, compared with apex-ls on Java

`apex-ls` 6.4.0 was run on Java 21 as an outside check, as the plan allows. For each method it lists the methods
it depends on. Those were compared with the calls the resolver records, by class, method, target class, target
method and number of arguments.

| | Fixture project | apex-recipes |
| --- | --- | --- |
| Edges of apex-ls to a method of the codebase | 8 | 766 |
| Of them, recorded by the trial | 8 | 751 (98.0%) |
| The others | none | 15, all `name()` on an enum of the codebase, a method Salesforce provides |
| Edges only the trial records | 1 | 108: 104 calls of a constructor and 4 calls from the body of a trigger or an initialiser, which the summaries of apex-ls do not list as method edges |

Where both tools record an edge they agree in every case. The target of the earlier research was 90%. apex-ls
reports 19 problems on apex-recipes that are not problems, so it is a check and not a judge. It was not run on
NPSP for this report.

## Files that do not compile

The five files of `fixtures/parser-negative`. Neither parser throws on any of them.

| File | A | B |
| --- | --- | --- |
| A query without fields, a statement without an end | 3 problems. The class and both methods are there. | 2 problems. The class and both methods are there. |
| An empty file | 1 problem. | No tree and no error node. The adapter adds the problem. |
| A method whose brace never closes | 3 problems. The class and 2 of 3 methods are there. | 1 problem. The whole file is one error node, so the adapter gives no class. The methods stand inside the error node. |
| Text that is not Apex | 9 problems, no class. | 12 problems, no class. |
| A text literal that never closes, then a comment that never closes | 2 problems. The class and 1 of 3 methods are there. | 4 problems. The class and all 3 methods are there. |

Neither is better throughout. A keeps the class when a brace is missing. B keeps more when a literal is not
closed. For OrgLens the case is rare: what an org holds has compiled. A branch of a repository can hold a file
that does not, and for such a file the engine has to say that it was not analysed, whichever parser reads it.

## Syntax of recent years

`syntax-probes.ts` holds 47 pieces of Apex: safe navigation, the `??` operator, `switch`, DML and queries in user
mode, `WITH SECURITY_ENFORCED`, `FIELDS()`, `TYPEOF`, date functions, five-step relationships, nested
sub-queries, semi-joins, bound expressions, `FOR UPDATE`, `USING SCOPE`, `DISTANCE`, data categories, SOSL with a
bound term, nested generic types, bit operators, `System.runAs`, properties, annotations with values, inner
types, initialisers, sharing modes, a trigger, a test class. Both parsers read all 47 without a problem. The
pieces are valid by the documentation of Salesforce `[docs]`. They were not compiled in an org.

Both packages were released within the last month: A on 16 October 2026, B on 8 November 2026. The history of B
has a gap of 14 months between two releases, and one maintainer. A is the parser that `apex-ls` and the
experimental language server of Salesforce build on. These facts are from the research note
[apex-analysis.md](apex-analysis.md).

## Surprises of each parser

A, apex-parser:

- After a syntax error a typed accessor of a context can return nothing where its type says it returns a node.
  The adapter therefore finds children by their class and never by accessor.
- The type declarations have no accessor for the constructor of a class, though the tree has the node.
- A variable in the body of a trigger is read as a field.
- `SELECT Id FROM Account WHERE` is accepted, with `WHERE` as an alias.
- The cache of the parser grows with what it has read and is never given back.
- Installed size 18 MB, with the ANTLR run time as a dependency.

B, tree-sitter:

- The grammar for SOQL alone does not read a bind variable. The adapter reads the text of a dynamic query through
  the Apex grammar, wrapped in a class, which reads it.
- A tree must be deleted by hand. Without it the memory of the WebAssembly module grew to 207 MB on NPSP.
- Comments are nodes of the tree and must be skipped everywhere.
- Node types and field names are strings. A misspelt name finds nothing, and the compiler does not notice.
- It accepts a number such as `1.5e3`, which Apex does not have `[docs]`, and it gives no error for an empty file.
- Installed size 6.5 MB.

## Installing

Neither package has an install script and neither compiles anything. The tests of the trial run in the CI of this
repository on Linux, macOS and Windows with Node.js 24 and 26, with both parsers, so a green run of CI is the
proof for the three systems. It is not claimed here before that run.

## The rule of the plan, applied

1. **Gates: install, robustness, performance.** Install: both, subject to CI. Robustness: both read every class
   and trigger of the three codebases and never throw. Performance on NPSP, under 60 seconds and under 1.5 GB: B
   passes, A misses the memory mark in all three runs.
2. **Pass marks on the fixture.** Both.
3. **Tie-break**, which the gate makes unnecessary, for the record: recovery on broken code is mixed; both
   grammars are current; the API of A is typed but cannot be trusted after an error, the API of B is untyped; B
   parses about six times as fast.

The result is B, `web-tree-sitter-sfapex`. Two things weigh against it and are answered by the design, not by
hope: it has one maintainer, and its node names are not checked by the compiler. The adapter is 584 lines behind
an interface of one file, the adapter for A exists and gives the same output on 395,000 lines, and a test holds
the two against each other. If B falls behind the language, the engine can move to A by changing one import, at
the price in time and memory measured above.

## What the resolver does not do

This list is for the phase that builds the production resolver. The trial resolver is a spike and is not moved
into the engine as it is.

- **It needs a complete description of the objects.** A child relationship of a standard object (`Contacts`), a
  lookup of a package the repository does not hold, and a standard field that does not exist cannot be judged
  from the files of a project. With an org as the source the description is there. With a repository alone it is
  not, and the resolver has to say "unknown" often: 1,293 places in NPSP.
- **A `__r` name it cannot find is taken for a lookup.** When it is a child relationship of a package, the
  resolver reports a read of a lookup field that does not exist. The check on NPSP showed the pattern. How often
  it happens was not counted.
- **Methods are found by name and number of arguments.** Overloads with the same number of arguments are not told
  apart, so the type a call returns is sometimes not known.
- **Text is followed inside one method and through constants.** A name that reaches a query through a parameter
  or a return value gives a reference to the object with the tier `possible`, or an unknown place.
- **The object in front of a method of a custom setting or of a describe call is not a reference.** The key of
  the fixture does not ask for it. Whether impact analysis wants it is a question for the plan of that phase.
- **Interfaces a class implements, and the values of a `switch`, are not in the model.**

## Not done, not verified

- The check by hand and the classification of the uncovered names were done by the author of the resolver.
- Precision was sampled on apex-recipes only. On NPSP and Nebula Logger no reference was checked by hand.
- The comparison with apex-ls covers the fixture project and apex-recipes.
- No file of the trial was run on macOS or Windows before the pull request.
- Memory was measured as the peak of one process that keeps the lowered model of every file. A design that
  parses in several processes, or drops the model of a file once it is resolved, was not tried.
