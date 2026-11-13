# The Apex trial: two parsers, one resolver

Written on 12 November 2026 and revised on 13 November 2026 after the review of its pull request. This is the
report of work package 9 of the [Phase 0 plan](../../plans/phase-0.md). The code is in
[`trial/apex`](../../../trial/apex/README.md). The decision is record
[0018](../../adr/0018-apex-analysis-foundation.md).

Every number below was measured with the code in this repository, on one Linux machine with 4 cores and 16 GB of
memory, with Node.js 24.22.3. Memory is given in MiB (1,024 × 1,024 bytes). Claims are marked where they rest on
a reading and not on a measurement. The scripts and the sample behind the checks by hand are in the folder
[`apex-trial`](apex-trial/).

## Outcome in short

- Both parsers, `@apexdevtools/apex-parser` 5.3.0 (A) and `web-tree-sitter-sfapex` 3.0.2 (B), reach every pass
  mark on the fixture project with the same resolver: 181 of 181 references, none extra, none on a negative case.
- On three public codebases with about 394,000 lines of Apex, the resolver reports exactly the same 59,845
  references, the same unknown places and the same calls with either parser.
- So the choice does not rest on correctness. **It does not rest on a gate of the plan either.** B reads NPSP in
  3.6 to 4.1 seconds with a peak of 430 to 436 MiB. A needs 19 to 22 seconds. Its peak depends on how much heap
  Node.js is allowed: 1,490 to 1,546 MiB with the default, 1,047 to 1,108 MiB with a heap of 1,024 MiB, with
  the same output. The mark of the plan was 60 seconds and 1.5 GB. A meets it with a setting.
- The tie-break of the plan has four criteria in a fixed order. The first three do not separate the parsers by a
  measurement: on 1,781 damaged files each parser keeps more than the other for some kinds of damage. The fourth,
  speed, names B.
- **The choice is the maintainer's.** Record 0018 stays `Proposed`. The section "The rule of the plan, applied"
  sets out what speaks for each parser.
- The score on the fixture flatters the resolver. A check on NPSP found four kinds of code the resolver did not
  understand, and the review found more: references to things that do not exist, reported as `confirmed`. They
  are listed under "What the resolver does not do".

An earlier version of this report said that A misses the memory mark and that the rule of the plan therefore
selects B. The review of the pull request showed that this rested on one heap setting. The section "What the
review changed" lists every correction.

## What was built

One model of the syntax of Apex (`syntax.ts`, 225 lines): declarations, statements, expressions, queries, each
name with its line and column. One adapter per parser lowers the tree of the parser into this model. The resolver
(`resolver.ts`, about 1,600 lines) is written once against the model and knows nothing of a parser. It keeps
scopes and the declared types of variables, follows fields and relationships of records, reads SOQL and SOSL,
follows the text of a query that Apex builds at run time, and records which method calls which.

| | A: apex-parser | B: tree-sitter |
| --- | --- | --- |
| Lines of the adapter, without blank lines and comments | 695, of which 144 are the list of imports | 584, of which 23 are imports |
| What the adapter works with | One class per rule of the grammar | One kind of node, with a type name and named fields |
| Loading | Synchronous | One `await` at the start: the grammar is WebAssembly |
| Memory of a tree | Garbage collected | Freed by hand as soon as the tree is lowered |

Hours of work are not given. An AI assistant wrote both adapters in one session, the second with the first in
view, so the time says nothing a person could plan with. What can be compared is the list of things that needed a
second look, under "Surprises of each parser".

**Are the two adapters the same to the resolver?** The same references are a weak proof: the resolver does not
use everything the model holds. A test therefore compares the lowered models themselves, name by name and place
by place, for every file of the fixture project and for each of the 48 pieces of recent syntax. Over the public
codebases the comparison was run by hand: the models are equal for 142 of 142 files of apex-recipes, 245 of 245
of Nebula Logger and 1,069 of 1,070 of NPSP. The one file that differs is a script of anonymous Apex that B makes
a class of and A does not. Before the review the models differed in three ways that no reference showed: A
dropped the type of a collection that is created with empty braces, A counted a column in characters where B
counts UTF-16 units, so that a column behind an emoji differed, and A reported a syntax error for a file that
starts with a byte order mark. The adapter for A is corrected, and a test holds each of the three.

## The fixture project

`node trial/apex/src/run-fixture.ts <parser>` against `fixtures/expected/answer-key.v0.yaml`:

| Measure | Pass mark | A | B |
| --- | --- | --- | --- |
| Recall: entries of the key in Apex that are not stretch | 95% | 181 of 181 | 181 of 181 |
| Precision: reported references that the key has | 98% | 181 of 181 | 181 of 181 |
| Kind (reads, writes, references, extends, triggers-on) right among the matches | 99% | 181 of 181 | 181 of 181 |
| References on a negative case in Apex | 0 | 0 of 16 | 0 of 16 |
| Unknown places of the key that are reported | | 5 of 5, none more | 5 of 5, none more |
| Source member, the way the target is named, tier and DML operation wrong | | 0 | 0 |
| Stretch entries in Apex that are found | | 3 of 3 | 3 of 3 |

The key has 21 negative cases. 16 are in Apex. The other five are in formulas and rules, which the trial does not
read. A test pins every number of this table, so a change of the resolver that moves one of them fails.

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
`node trial/apex/src/run-corpus.ts <parser> .corpora/<name>`. Each run is a process of its own that loads one
parser only. Each was done three times, one process at a time. Time is the range of the three runs and includes
loading the parser. Memory is the largest resident set of the process, with the default heap of Node.js.

| | apex-recipes | Nebula Logger | NPSP |
| --- | --- | --- | --- |
| Files, lines | 142, 17,748 | 245, 56,608 | 1,070, 319,835 |
| References found, with A and with B | 1,026 | 13,331 | 45,488 |
| Unknown places, with A and with B | 23 | 111 | 1,293 |
| Calls between methods of the codebase, with A and with B | 890 | 9,360 | 30,037 |
| A: parsing | 1.28 to 1.52 s | 4.12 to 4.27 s | 18.4 to 20.7 s |
| B: parsing | 0.22 to 0.23 s | 0.93 to 1.01 s | 2.82 to 3.31 s |
| A: everything | 1.39 to 1.65 s | 4.54 to 4.64 s | 19.4 to 21.8 s |
| B: everything | 0.30 to 0.32 s | 1.27 to 1.38 s | 3.58 to 4.07 s |
| A: peak memory | 326 to 335 MiB | 648 to 660 MiB | 1,495 to 1,533 MiB |
| B: peak memory | 312 to 314 MiB | 325 to 330 MiB | 430 to 436 MiB |

The times moved by up to a third between the first measurement and this one, on the same machine. The first
version of this report had 16.1 to 17.3 seconds for A on NPSP and 3.04 to 3.13 seconds for B. The ratio between
the two stayed near five.

**The same output.** For each codebase the two result files were compared entry by entry: file, line, column,
word, source member, target, kind, the way the target is named, tier and operation. They are equal, in the same
order, for the references, the unknown places and the calls. Before they were equal, one difference showed: A
reads a variable that is declared in the body of a trigger as a field of the trigger. The adapter for A now
lowers it as a local variable, which is what it is.

**Files without a tree.** In apex-recipes and Nebula Logger every file gives a tree without a problem, with both
parsers. In NPSP four files give a problem with both. All four are scripts of anonymous Apex under `scripts/` and
`datasets/`, three of them with placeholders such as `%%%NAMESPACE%%%`. They are not classes. A gives no tree for
any of the four. B gives a class for one of them, which is the file whose models differ above. No class and no
trigger of the three codebases fails to parse.

**Memory of A, and the mark of the plan.** The mark for NPSP was under 60 seconds and under 1.5 GB. Both parsers
are far under 60 seconds. For memory the answer depends on a setting, because the garbage collector of Node.js
lets the heap grow as far as it is allowed before it works hard. The ranges are over every run of the author
and of the review:

| NPSP with A | Peak memory | Time for everything | Output |
| --- | --- | --- | --- |
| Default heap of Node.js on this machine (a limit of 2,240 MiB) | 1,490 to 1,546 MiB | 15 to 22 s | the 45,488 references |
| `--max-old-space-size=1024` | 1,047 to 1,108 MiB | 17 to 23 s | the same |
| `--max-old-space-size=768` | 921 to 943 MiB | 21 to 26 s | the same |
| `--max-old-space-size=512` | out of memory | | |
| `--max-old-space-size=512`, and the cache of the parser emptied after every 50 files | 578 to 602 MiB | 41 to 42 s | the same |

1.5 GB is 1,431 MiB when a GB is 1,000 MB and 1,536 MiB when it is 1,024. With the default heap A lies above the
first reading in every run and around the second. With a heap of 1,024 MiB it is under both, by 320 MiB and more,
at about the same time. So A passes the mark, with a setting that OrgLens would have to make when it starts. B
runs NPSP in 430 to 436 MiB, and completes with a heap of 256 MiB at 446 MiB. With a heap of 128 MiB it runs out
of memory too.

What A needs the memory for: after NPSP is parsed and nothing of it is kept, 372 MiB of heap stay in use with A,
against 29 MiB with B. It is the cache the ANTLR run time builds as it reads. The cache is held in the static
fields `DecisionsToDFA` of the parser class and of the lexer class, which are public. A program can replace them
and so give the memory back, at the price of time, because the cache is what makes the parser fast. With the
cache emptied after every 50 files (`ORGLENS_TRIAL_EMPTY_CACHE=50`) and a heap of 512 MiB, A reads NPSP in 578 to
602 MiB and 41 to 42 seconds, with the same output. That is the smallest A was made to run in: a third more
memory than B, at ten times its time.

**Texts of queries.** In NPSP the resolver finds 405 queries that are built as text. For 105 of them the text
with its unknown parts is not a query either parser can read, mostly because a whole clause comes from a
variable. For those only the object after `FROM` is looked for, and 96 of the 105 have no `FROM` in the part that
is known, so nothing is reported for them. The number is the same for A and B.

## A check by hand of 100 references

`sample.ts` drew 100 of the 1,016 references of apex-recipes with the seed 2026. For each one the line of source
was read, and where the line does not decide it, the declaration of the variable or the `FROM` of the query. The
check was done by the AI assistant that wrote the resolver, not by a second person. The sample with its lines of
source is [`apex-trial/sample-apex-recipes.txt`](apex-trial/sample-apex-recipes.txt), so that a second person
can repeat the check.

All 100 name the right target with the right kind at the right place: 43 fields of a record in an expression, 36
fields and objects of a static query, 15 DML statements, 2 names in the text of a query, 2 object tokens, 1 name
of a search and 1 trigger. 58 are reads, 39 writes, 2 references and 1 the object of a trigger. With no error in
100, the share of wrong references in apex-recipes is below about 3%, with the usual 95% confidence. The source
member of each reference was compared by its name, not derived again.

What the sample does not carry:

- It is drawn evenly from all references, so it follows their mix. Two of the 100 are names in a text and two
  are tokens. For those kinds, which are the hard ones, two right answers bound nothing.
- apex-recipes is teaching code with standard objects and few packages. The wrong references that the review
  found in NPSP (under "What the resolver does not do") are of kinds that apex-recipes hardly holds.
- The sample cannot be drawn again from a run of today. It was drawn before the four additions described below,
  which added 10 references in apex-recipes and removed none, so the same seed now picks other entries of a
  list of 1,026. All 10 added references are of one form, a field read on the result of a query,
  `[SELECT Name FROM Account ...].Name`, and were read as well: all 10 are right.

## A check for references that are missed

A sample of what was found says nothing about what was missed. For that, every word in the Apex of NPSP that ends
like a custom name (`__c`, `__r`, `__e`, `__mdt`) and stands outside a comment was listed by a script
([`apex-trial/uncovered-names.py`](apex-trial/uncovered-names.py)), 39,790 places, and compared with the places
of the references and unknown places.

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

This check looks only at words with a custom ending. A standard field or a standard object that the resolver
misses is not found by it.

## Calls, compared with apex-ls on Java

`apex-ls` 6.4.0 was run on Java 21 as an outside check, as the plan allows. For each method it lists the methods
it depends on. Those were compared with the calls the resolver records, by class, method, target class, target
method and number of arguments ([`apex-trial/apex-ls-edges.py`](apex-trial/apex-ls-edges.py)).

| | Fixture project | apex-recipes |
| --- | --- | --- |
| Edges of apex-ls to a method of the codebase | 8 | 766 |
| Of them, recorded by the trial | 8 | 751 (98.0%) |
| The others | none | 15, all `name()` on an enum of the codebase, a method Salesforce provides |
| Edges only the trial records | 1 | 108: 104 calls of a constructor and 4 calls from the body of a trigger or an initialiser, which the summaries of apex-ls do not list as method edges |

The measure is the second row: 751 of the 766 edges of apex-ls are found. An edge is compared as a whole, so
there is no such thing as an edge that both tools record and disagree on. The trial records 890 calls in
apex-recipes. Compared as edges they are 859, because a constructor, an initialiser and the body of a trigger are
compared as one member without a name, so two constructors of a class that call the same method fall on one edge.
Of the 859, apex-ls has 751 and has not 108. The target of the earlier research was 90%. apex-ls reports 19
problems on apex-recipes that are not problems, so it is a check and not a judge. It was not run on NPSP for this
report.

## Code that does not compile

### The five files of `fixtures/parser-negative`

Neither parser throws on any of them.

| File | A | B |
| --- | --- | --- |
| A query without fields, a statement without an end | 3 problems. The class and both methods are there. | 2 problems. The class and both methods are there. |
| An empty file | 1 problem. | No tree and no error node. The adapter adds the problem. |
| A method whose brace never closes | 3 problems. The class and 2 of 3 methods are there. | 1 problem. The whole file is one error node, so the adapter gives no class. The methods stand inside the error node. |
| Text that is not Apex | 9 problems, no class. | 12 problems, no class. |
| A text literal that never closes, then a comment that never closes | 2 problems. The class and 1 of 2 methods are there. | 4 problems. The class and both methods are there. |

### Damage to real files

Five files written for the purpose decide nothing. "Recovery on broken code" is the first tie-break of the plan,
so it was measured after the review (`node trial/apex/src/run-recovery.ts <folder> 200 1`).

A file takes part when both parsers read it without a problem, when the resolver finds the same references in it
with either parser, and when it has at least five of them: 52 files of apex-recipes, 108 of Nebula Logger and 561
of NPSP, of which 200 were drawn. Each file is damaged in five ways, one at a time: one character is deleted at a
place a seeded generator chooses, a closing brace, an opening brace, a closing parenthesis, a semicolon or a
quote of a text. That gives 1,781 damaged files with 138,480 references in their whole form. Each damaged file is
parsed and resolved alone. "Kept" is a reference of the whole file that is found again with the same member,
kind, target, tier, line and word. "Kept, member aside" leaves the member out of the comparison: the reference is
found at its place with its target, and may be counted to another method.

| What is deleted | Cases | A: kept | A: kept, member aside | B: kept | B: kept, member aside | Cases in which A keeps more, B keeps more |
| --- | --- | --- | --- | --- | --- | --- |
| A closing brace | 360 | 66.4% | 99.7% | 62.7% | 63.0% | 42, 10 |
| An opening brace | 360 | 68.0% | 71.4% | 54.9% | 58.7% | 95, 19 |
| A closing parenthesis | 360 | 99.2% | 99.6% | 98.8% | 99.0% | 32, 29 |
| A semicolon | 360 | 99.9% | 99.9% | 99.5% | 99.6% | 18, 5 |
| A quote of a text | 341 | 55.5% | 67.7% | 94.7% | 95.7% | 13, 230 |
| All | 1,781 | 77.9% | 87.7% | 82.1% | 83.2% | 200, 293 |

What the table says:

- **A missing brace: A.** After a missing closing brace A reads on to the end of the file and finds nearly every
  reference at its place, but it counts a third of them to another member than the one they stand in. B gives up
  the rest of the class. After a missing opening brace both lose a lot, B more.
- **A missing quote: B, by far.** A loses almost half of the file, B a twentieth.
- **A missing parenthesis or semicolon:** both recover nearly everything.
- **Over all cases** B keeps more references with the right member (82.1% against 77.9%), and A keeps more when
  the member does not matter (87.7% against 83.2%). Which of the two counts depends on the use. For "what refers
  to this field" the member matters less. For "what does this method touch" a reference at the wrong method is a
  wrong answer.
- References that the whole file does not have at all are rare with both: 95 with A and 26 with B.
- Both parsers report a problem in every one of the 1,781 cases, so the engine always knows that a file is
  damaged. Neither hangs: the slowest case took under a second with either.

The experiment found a defect that no test had shown. For a damaged file an adapter can give a method without a
name or a parameter without a type, and the resolver stopped with an error: in 15 cases with A and in 46 with B.
The resolver now skips such a member. In three cases it still stops, one with A and two with B, because a
parser makes a name out of several lines of damaged code. Those three count as "nothing kept" above. The
production resolver must not stop on anything a parser delivers.

Limits of the experiment: one deleted character is one kind of damage. Code that is half written, or syntax the
grammar does not know yet, was not tried. The measure goes through the resolver of the trial, and the damaged
file is resolved alone, without the other classes of its codebase.

For OrgLens the case is rare: what an org holds has compiled. A branch of a repository can hold a file that does
not, and for such a file the engine has to say that it was not analysed completely, whichever parser reads it.

## Syntax of recent years

`syntax-probes.ts` holds 48 pieces of Apex: safe navigation, the `??` operator, `switch`, DML and queries in user
mode, `WITH SECURITY_ENFORCED`, `FIELDS()`, `TYPEOF`, date functions, five-step relationships, nested
sub-queries, semi-joins, bound expressions, `FOR UPDATE`, `USING SCOPE`, `DISTANCE`, data categories, SOSL with a
bound term, nested generic types, bit operators, `System.runAs`, properties, annotations with values, inner
types, initialisers, sharing modes, a trigger, a test class. Both parsers read all 48 without a problem, and the
two adapters lower each of them to the same model. The pieces are valid by the documentation of Salesforce
`[docs]`. They were not compiled in an org.

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
- The cache of the parser grows with what it has read. It is given back only when the program replaces it.
- A column is counted in characters, not in UTF-16 units, and a byte order mark at the start of a file is a
  syntax error. The adapter corrects both.
- Installed size 18 MB, with the ANTLR run time as a dependency.

B, tree-sitter:

- The grammar for SOQL alone does not read a bind variable. The adapter reads the text of a dynamic query through
  the Apex grammar, wrapped in a class, which reads it.
- A tree must be deleted by hand. Without it the memory of the WebAssembly module grew to 207 MiB on NPSP.
- Comments are nodes of the tree and must be skipped everywhere.
- Node types and field names are strings. A misspelt name finds nothing, and the compiler does not notice.
- It accepts a number such as `1.5e3`, which Apex does not have `[docs]`, and it gives no error for an empty
  file.
- It makes a class of a script of anonymous Apex that starts like one.
- Installed size 6.5 MB.

## Installing

Neither package has an install script and neither compiles anything. The tests of the trial run in the CI of this
repository on Linux, macOS and Windows with Node.js 24 and 26, with both parsers. That run is green for the pull
request of the trial, on all eleven jobs. Nothing of the trial was run by hand on macOS or Windows.

## The rule of the plan, applied

The plan says: a candidate must first pass install, robustness and performance. Among those it must meet the
pass marks. If both do, the tie-break is, in this order: recovery on broken code, how current the grammar is, the
quality of the TypeScript API, then speed.

1. **Gates.** Install: both, on three systems. Robustness: both read every class and trigger of the three
   codebases and never throw. Performance on NPSP, under 60 seconds and under 1.5 GB: B passes with room. A
   passes the time, and passes the memory mark with a heap setting. **Both pass.**
2. **Pass marks on the fixture.** Both, with the same numbers.
3. **Tie-break 1, recovery on broken code.** Measured above. A is better after a missing brace, B after a
   missing quote, and over all cases the answer turns with what is counted. **No clear lead.**
4. **Tie-break 2, how current the grammar is.** Both read all 48 pieces of recent syntax. Both had a release in
   the last month. A has the larger group behind it, B one maintainer and a gap of 14 months in its history.
   **Equal on what was measured.** Who maintains a package is a risk, not a state of the grammar.
5. **Tie-break 3, quality of the TypeScript API.** A has a class per rule of the grammar, with types. After a
   syntax error its typed accessors cannot be trusted, so the adapter does not use them. B has no types for node
   names at all. The two adapters came out at 695 and 584 lines. **A on paper, no lead in the adapter.** This is
   a judgment, not a measurement.
6. **Tie-break 4, speed.** B is about five times as fast on NPSP and three and a half times on Nebula Logger,
   and on NPSP it needs 30 to 40 percent of the memory. **B.**

Read strictly, the first criterion that separates the parsers by a measurement is the last one, and it names B.
A reader who gives A the third criterion for having types arrives at A before speed is looked at. The rule
does not decide this without a judgment, so the trial does not select a parser. It puts the choice to the
maintainer with this summary:

| | For `web-tree-sitter-sfapex` (B) | For `@apexdevtools/apex-parser` (A) |
| --- | --- | --- |
| Speed and memory | About five times as fast on NPSP. 430 MiB on NPSP against 1,050 to 1,550, or against 600 at ten times the time. Matters for an org of 10,000 components. | Within the mark of the plan with a heap setting. |
| Broken code | Keeps far more after a missing quote. Counts fewer references to the wrong member. | Keeps far more after a missing brace. |
| Who stands behind it | One maintainer. | The group whose parser `apex-ls` and the experimental language server of Salesforce build on. |
| The API | Untyped node names. 584 lines of adapter. | Typed, but not to be trusted after an error. 695 lines of adapter. |
| If the choice turns out wrong | The adapter for A exists and gives the same output on 394,000 lines. | The adapter for B exists and gives the same output. |

The recommendation of the author of the trial is B, for speed and memory, and because the weaknesses of B (one
maintainer, untyped names) are covered by the second adapter and by the test that holds the two against each
other, while the weakness of A (time and memory) is covered by nothing. It is a recommendation and not the
result of the rule.

Whichever is chosen, the other adapter stays in the repository. The models of the two are compared by a test, so
the engine can move from one parser to the other by changing which adapter it loads, at the price in time and
memory measured above.

## What the resolver does not do

This list is for the phase that builds the production resolver. The trial resolver is a spike and is not moved
into the engine as it is. The first group are **wrong references, reported at the tier `confirmed`**. The review
of the pull request found them. The counts are from NPSP
([`apex-trial/unchecked-names.py`](apex-trial/unchecked-names.py)).

- **No field name is checked against the fields of the object.** A name that stands where a field stands is
  reported as that field, whether a file defines it or not. Of the 23,703 references of NPSP to a custom field of
  an object that has field files in the repository, 7,347 name a field that no file defines, 7,249 of them at the
  tier `confirmed`. 7,334 of the 7,347 carry the prefix of another package (`npe01__`, `npo02__` and others).
  NPSP builds on those packages and the repository does not hold them, so the fields may well exist. Nothing in
  the repository confirms them, and `confirmed` is the wrong tier for a name that was not checked. The other 13
  have no prefix: fields that a test names and no file defines.
- **A child relationship of a standard object is taken for a field.** `acc.Contacts` is reported as a read of a
  field `Account.Contacts`. 49 references of NPSP, all `confirmed`. The script looks for a list of common
  relationship names that is not complete, so 49 is a lower bound.
- **A `__r` name it cannot find is taken for a lookup.** `record.Lines__r`, where no lookup of the project
  defines the relationship, is reported as a read of a field `Lines__c` of the object of the record. When it is a
  child relationship of a package, that field does not exist. 370 references of NPSP rest on a `__r` name whose
  lookup field no file defines. Where the name is a lookup of another package the guess is right. Where it is a
  child relationship it is wrong. The review identified at least 86 of the second kind.
- **Smaller ones**, each seen in NPSP by the review and not counted: an inner enum that a class inherits and that
  is named like a standard object is taken for the object; a cast inside a conditional expression gives the wrong
  type; an alias of an aggregate in a query can be reported as a field.

The production resolver needs the description of the objects, from the org or from a bundled list for the
standard ones, and must lower the tier of every name it cannot check. With an org as the source the description
is there. With a repository alone it is not, and the resolver has to say "unknown" often: 1,293 places in NPSP
already.

The second group are **things that are dropped, without a reference and without an unknown place**:

- **A text that is put together in steps.** A query that grows by `+=`, by a list of clauses that is joined, or
  that takes a value joined into its text, is read as far as the constant parts go. The names in the other
  parts are lost without a word. So is a text of a query that has no `FROM` in its known part: 96 of the 105
  texts of NPSP that no parser can read.
- **The other arguments of `Database.query` and its relatives**, such as a map of bind values.
- **DML on a list of `SObject`.** The object is not known, and no unknown place is reported.
- **A class that is declared in the body of a trigger.**
- **Methods are found by name and number of arguments.** Overloads with the same number of arguments are not told
  apart, so the type a call returns is sometimes not known.
- **Text is followed inside one method and through constants.** A name that reaches a query through a parameter
  or a return value gives a reference to the object with the tier `possible`, or an unknown place, or nothing,
  as the cases above show.
- **The object in front of a method of a custom setting or of a describe call is not a reference.** The key of
  the fixture does not ask for it. Whether impact analysis wants it is a question for the plan of that phase.
- **Interfaces a class implements, and the values of a `switch`, are not in the model.**
- **A member without a name, from a damaged file, is skipped.** The file is reported as a file with a problem.

## What the review changed

The pull request of the trial was reviewed by a separate agent, which measured again and read the code. What it
changed in this report:

- **The memory mark.** The first version said that A misses it in each of three runs, by 1 to 32 MB, and that
  the gate therefore selects B. The numbers were MiB, the mark was not said to be either unit, and the peak
  depends on the heap setting. A passes with `--max-old-space-size=1024`. The conclusion was withdrawn.
- **The tie-break.** It was "for the record" and rested on five files. It is now measured on 1,781 cases.
- **The adapters** differed in three ways that no reference showed. They are corrected and tested.
- **Wrong references at the tier `confirmed`** and **things dropped without a word** were not in the list of
  what the resolver does not do.
- **Numbers.** 48 pieces of syntax, not 47. 16 negative cases in Apex, not 21. The lines of each codebase were
  one too many per file: 17,748, 56,608 and 319,835, not 17,890, 56,853 and 320,093. The run of a codebase loaded
  both parsers and started its clock after loading. It now loads one and starts before.
- **The cache of A** can be emptied through a public field. The first version said that no public call does it.
  Emptying it was then measured.
- **The evidence** for the checks by hand was not in the repository. It is now, in `apex-trial/`.

## Not done, not verified

- The check by hand and the classification of the uncovered names were done by the author of the resolver.
- Precision was sampled on apex-recipes only. On NPSP and Nebula Logger no reference was checked by hand, and the
  counts of wrong references above are lower bounds from patterns, not from reading every reference.
- The comparison with apex-ls covers the fixture project and apex-recipes.
- Nothing of the trial was run by hand on macOS or Windows. CI is the evidence there, and CI measures no time and
  no memory.
- Memory was measured as the peak of one process that keeps the lowered model of every file. A design that
  parses in several processes, or drops the model of a file once it is resolved, was not tried.
- Emptying the cache of A was tried with one interval, a fixed number of files. A cache with a bound, or
  emptying by the size of the heap, was not tried.
- The prediction mode of ANTLR that tries the fast strategy first and falls back (two-stage parsing) was not
  tried for A. It could make A faster.
- Time and memory were measured on one Linux machine. The times moved by up to a third between two sessions of
  measuring.
