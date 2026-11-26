# Phase 3 plan: Apex

Status: **approved** on 26 November 2026. You took the recommended answer to each of the six questions of section 4
and approved the plan. The answers are written in below section 4, and four of them have decision records (0079 to
0082). The plan was written for the recommended answers, so its work packages stand as they were drafted. Nothing of
it is built yet.
Date: 2026-11-25, with the answers and the approval written in on 2026-11-26
Parent document: [OrgLens re-architecture plan](re-architecture-plan.md)
Before it: [Phase 2 plan](phase-2.md), [Phase 2 report](../reports/phase-2.md), and the Apex trial of Phase 0
([report](../research/phase-0/apex-trial.md), record [0018](../adr/0018-apex-analysis-foundation.md))

This plan is written by the AI assistant that builds the project, addressed to the maintainer. "I" is the
assistant and "you" is the maintainer.

## 1. Outcome

At the end of Phase 3, an impact answer holds the Apex of an org, method by method:

1. `orglens snapshot` analyses Apex classes and triggers. Every method, constructor, property, member variable,
   initialiser and inner class is a component of its own, below its class, with a key such as
   `ApexClass:invoiceservice#method:markpaid(id)`. A method that reads or writes a field gets a reference of
   the kind `reads` or `writes`, with the line and column it stands on. A method that calls another gets `calls`,
   and a class that extends, implements or uses another as a type gets `extends`, `implements` or `uses-type`.
2. A name that Apex holds in a text, in a dynamic query, in `get` and `put` of a record, in a describe call, goes
   through the sequence of record [0012](../adr/0012-dynamic-references-and-confidence.md) and gets one of the
   three tiers. What cannot be resolved is kept as a `possible` reference to the object, or as an unknown place,
   and never dropped without a word.
3. `orglens impact Invoice__c.Amount__c` then names the methods that read or write the field, and the triggers,
   methods and flows that call them, beside the formulas, rules and flows of Phases 1 and 2. An answer about a
   method, such as `orglens impact InvoiceService.markPaid`, names what calls it, and `--outgoing` what it
   reads, writes and calls.
4. Lightning web components and Aura components refer to the Apex methods they call and to the fields they
   import. A Visualforce page refers to its controller, its extensions and its standard controller (Q1). Apex
   refers to the named credential of a callout.
5. The cross-check covers Apex. The rows of the Dependency API from an Apex class or trigger, which a snapshot
   stores since Phase 1 and does not compare, are compared, and a pair the analysis lacks is the error
   `REFERENCE_MISSED`.
6. Every answer still says what it does not cover. After this phase that is permissions, the presentation tier,
   the types no phase analyses, the names of the Apex that stay `possible` or unknown, and what this phase does
   not read of the types it analyses: the merge fields of a Visualforce page, the expressions in the markup of an
   Aura component, and the names of fields in the JavaScript and the markup of a Lightning web component outside
   its imports and the attributes of section 5. Where these can name what an answer is about, their types stay on
   its list of what it does not cover, with that reason (record 0004).
7. The results are proven in the ways of section 6.

## 2. What Phases 0 to 2 and the preparation of this plan found

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Consequence                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The resolver of the trial is a spike.** About 1,600 lines over a model of the syntax of 225 lines, with an adapter for each parser. It finds 181 of the 181 entries of the key in Apex that are not stretch and hits none of the 16 negative cases, and it gives the same 59,845 references on apex-recipes, Nebula Logger and NPSP with either parser. It was written with the fixture and its key in view, by their author, so the score says that the design can express the key, not how it does on code it has not seen.                                                                                                                                                                                                                                                                | The production resolver is written anew in the engine, from the design of the trial and from its list "What the resolver does not do". The trial stays where it is, for the test that compares the two parsers (record 0018).                                                                  |
| 2   | **The trial reports wrong references at the tier `confirmed`.** It checks no name against the description of the objects. In NPSP, 7,249 references at `confirmed` name a field that no file of the repository defines, nearly all with the prefix of another package that the repository does not hold. 49 take a child relationship of a standard object for a field (`acc.Contacts`), a lower bound, and of 370 that guess a lookup behind a `__r` name, at least 86 are child relationships.                                                                                                                                                                                                                                                                                               | The resolver needs to know the standard objects, their fields and their relationships. Where it learns them is question Q2.                                                                                                                                                                    |
| 3   | **The trial drops some names without a word**: a text of a query that grows in steps, the other arguments of `Database.query`, DML on a list of `SObject`, a class declared in a trigger, overloads with the same number of arguments, a value that reaches a query through a parameter or a return value, interfaces and the values of a `switch`.                                                                                                                                                                                                                                                                                                                                                                                                                                            | Each is a case of the new fixture (work package 1) and is built in work package 4 or 5, or is an unknown place that the coverage counts.                                                                                                                                                       |
| 4   | **The Apex part of the key holds no call, no interface and no use as a type.** It is the same in versions 0, 1 and 2: 184 references (129 `reads`, 41 `writes`, 12 `references`, 1 `extends`, 1 `triggers-on`), 3 of them stretch, 16 negative cases and 5 unknown places. The trial compared its calls with `apex-ls` on Java instead, and found 751 of the 766 edges of `apex-ls` in apex-recipes.                                                                                                                                                                                                                                                                                                                                                                                           | An impact answer about a method needs its callers, and one about a class what uses it. The key of this phase holds `calls`, `implements` and `uses-type` (work package 1).                                                                                                                     |
| 5   | **The Dependency API reports Apex at the level of the class.** On the test org in Phase 1 it reported 58 of the 70 pairs of the key from a class to a custom field, 11 of 11 to a custom object, 4 of 4 to a standard object, the one `extends`, the trigger to its object, and none of the 9 to a standard field. Of the 12 pairs to custom fields that it lacks, 11 name the field in a text and 1 through a token of another class and a describe call. It also reports 17 pairs from Apex that the key does not hold, all relations that exist: 9 from a class or the trigger to another class, and 8 from a class to an object it uses as a type or reaches through a relationship. In Phase 1, 94 of its 257 rows on the test org were from Apex. Rows from Apex are not compared today. | The cross-check of Apex compares at the level of the class: a row from a class is met by a reference of any member of it. Calls and uses as a type are needed for the rows from one class to another.                                                                                          |
| 6   | **The symbol tables of the org hold no reference.** Phases 0, 1 and 2 asked for them, and every table held 0 places of use. You decided on 12 November 2026 that the Dependency API alone is the cross-check for Apex and that nothing is compiled in the test org.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Nothing of this phase reads symbol tables.                                                                                                                                                                                                                                                     |
| 7   | **The public codebases hold much Apex and few of the other types of this phase.** In the package folders that a snapshot reads, the eight codebases hold at the pinned commits 2,074 classes and 81 triggers, about 575,000 lines, 239 Lightning web components, 106 Aura bundles (77 of them components), 103 Visualforce pages and 2 named credentials. These are my counts of files and folders by name on 25 November 2026. The trial read three of the codebases.                                                                                                                                                                                                                                                                                                                         | The public codebases can carry the proof of Apex in breadth, by a sample checked by hand. The fixture and the test org carry the hard cases and the Lightning components.                                                                                                                      |
| 8   | **The fixture holds no Lightning component, no Visualforce page and no named credential.** It has 13 classes and a trigger. One class makes a callout to `callout:Billing_Gateway`, which the project does not define.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Work package 1 adds them.                                                                                                                                                                                                                                                                      |
| 9   | **The parser is WebAssembly and the analysis is synchronous.** `web-tree-sitter-sfapex` loads its grammar with one `await`, and a tree must be freed by hand. `analyseSource` is synchronous. The engine has no runtime dependency on a parser yet: by record 0018 it gets one in this phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The parser is loaded once before an analysis, and only when the snapshot holds Apex, so that `impact` and `--version` do not start slower. A record for the new runtime dependency. The smoke test of the package shows that the grammar loads from an installed package on the three systems. |
| 10  | **Memory was measured only by the trial of Phase 0.** It measured a peak of 430 to 436 MiB on NPSP, 319,835 lines, keeping the model of every file. An org can hold several times that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The resolver reads the declarations of every class first and then resolves one file at a time, dropping its tree. Work package 9 measures time and memory on a made-up source of about 1.5 million lines.                                                                                      |
| 11  | **What an org hands out of a standard object was not counted.** A real org handed out standard fields with its standard objects in Phase 0 ([real-org.md](../research/phase-0/real-org.md)), and the documentation says that a retrieve of a standard object brings its custom fields and the standard fields that can be customised, without system fields ([salesforce-libs.md](../research/phase-0/salesforce-libs.md)). Whether a child relationship appears anywhere in a snapshot was not looked at. What an org hands out of the Apex of a managed package is not known either: the test org has no package, and as far as I know the body of such a class is hidden.                                                                                                                   | Work package 1 counts the first on the test org. For the second, a class without a body is a component that is not analysed and says so. Your org shows it, in the test plan.                                                                                                                  |
| 12  | **Phase 2 left five things open** that touch this phase. Its report asks you about three: the flow a flow overrides (`overriddenFlow`), the object a flow hands to a generic Apex action (`dataTypeMappings`), and the warning for `Id` at the end of a path. Its list of what is not done names two more: the token of the build tool of PMM, before which no name is read, and the name alone of a flow in a snapshot of an org, which fits the flow and its definition.                                                                                                                                                                                                                                                                                                                     | Question Q6.                                                                                                                                                                                                                                                                                   |

## 3. Scope

### In scope

| Work package                                    | Summary                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP1 Fixture v3 and its key                      | Apex cases the trial did not see, calls and uses as a type, Lightning components, a Visualforce page and a named credential, keyed before any analyser and deployed to the test org |
| WP2 The parser in the engine                    | `web-tree-sitter-sfapex` as a dependency of the engine, the model of the syntax, the loading of the grammar, the package                                                            |
| WP3 Classes, triggers and their members         | The components and their keys, declarations, `extends`, `implements`, `uses-type`, `triggers-on`, test classes                                                                      |
| WP4 The resolver                                | The descriptions of objects (Q2), types, scopes, fields and relationships checked against them, queries, DML, calls with overloads, interfaces and inherited members                |
| WP5 Names in texts                              | The sequence of record 0012: texts of queries and of `get` and `put`, describe calls, texts built in steps and passed between methods, custom metadata and field sets               |
| WP6 Lightning components, Visualforce, callouts | What a component, an Aura component and a Visualforce page refer to, and the named credential of a callout                                                                          |
| WP7 The answers                                 | `impact` and `coverage` with members of classes, the cross-check of Apex, and what an answer does not cover                                                                         |
| WP8 Flows and Apex, and what Phase 2 left (Q6)  | A flow calls the invocable method, its parameters are the variables of the class, and the open things of Phase 2                                                                    |
| WP9 Proof on public codebases, and measurements | A sample of references checked by hand, a search for missed names, calls held against `apex-ls`, time and memory                                                                    |
| WP10 Phase close                                | Updated overall plan, test plan, phase report, the next pre-release, draft of the Phase 4 plan                                                                                      |

### Deliberately not in Phase 3

- Permissions: which profile or permission set may run a class or see a field, `with sharing`, and the checks of
  access in the code. Phase 4.
- Comparison of snapshots, change sets and incremental refresh. Phase 4.
- Running Apex or its tests, code coverage, and the order in which triggers and flows of an object run. The order
  is the first rider, after the gate.
- The data flow inside the JavaScript of a Lightning component beyond its imports and the Apex it calls by name,
  and anything of the markup of a component beyond the components it holds and the fields it names in its
  attributes.
- The merge fields of a Visualforce page, by your answer to Q1. Visualforce components, s-controls, static
  resources, Lightning pages and the rest of the presentation tier stay in Phase 6.
- Reading the records of custom settings, deferred by record 0012.
- The body of the Apex of a managed package, which as far as I know Salesforce hides (finding 11). A call into a
  class of a package is a reference to that class and method by name. What its hidden code refers to is not known,
  and an answer that reaches such a class says so. This is how the plan answers, for Apex, the open question of the
  overall plan on references into the hidden code of a package, and the record of work package 4 says it.
- Security findings in Apex, such as a query built from input. That is the security rider, after the gate.
- The language model, the web UI, and any rider.

## 4. Questions for you

Six questions. Each has my recommendation. The plan below is written for the recommended answers, and says where
another answer changes it. Your answers get decision records, as those of the Phase 2 plan did.

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                                                                | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Recommendation                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1  | **How much of the components around Apex is analysed?** The roadmap names the links of Lightning web components and Aura components to Apex. Both types are in the logic tier since Phase 1. A Visualforce page is not, and the roadmap does not name it, but its controller is Apex: a controller cannot be changed without looking at its pages. The package folders of the public codebases hold 103 pages.                          | (a) A Lightning web component and an Aura component refer to the Apex they call, the fields and objects they import or name in an attribute, the labels, and the components they hold. A Visualforce page refers to its controller, its extensions and its standard controller, and joins the logic tier. A page is then found by an answer about its controller and not by one about a method of it: the methods it calls, as in `action="{!init}"`, are merge expressions, which only (c) reads. `ApexPage` joining the tier changes the list of record 0004, as record 0055 did for email templates, and the roadmap row of Phase 3, in the pull request that records the answer. About 4 days. (b) As (a), without Visualforce: a page stays a type that is not analysed. About 3 days. (c) As (a), and the merge fields of a page and of the markup of an Aura component are read as the merge fields of an email template are. About 2 days more.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | (a). A page is how much older code calls Apex. Its merge fields can wait for the presentation tier.                                                                                                                      |
| Q2  | **Where does the resolver learn the standard objects, their fields and their relationships?** The trial knows them by rule and checks no name (finding 2). The formulas of Phase 1 take a name of a standard field as written, as `external`, and that stays right for a formula, which Salesforce checks when it saves it. In Apex a name can also be a child relationship, and the type of an expression depends on what the name is. | (a) After the last chunk and before the analysis, `snapshot` asks the org to describe every object of which the snapshot holds a file, as it asks the Dependency API, and keeps the descriptions with the snapshot, so that `analyse` needs no org. It is a request about metadata that the engine does not make today: a decision record, a test that holds it, a line in the data rules, the mock org, a store migration with a record of its own, since it changes the storage format, and a run of "Live org". A description follows the permissions of the user who logs in, so a field that user cannot see is left out of it: the files come first and the description adds to them. How far that matters on a real org is not verified. A repository has no description: there a name is checked against the files, and a name of Salesforce or of a package that no file defines is `external` at `probable` (work package 4). About 4 days. (b) A description of the standard objects ships with OrgLens, written by the project from the documentation of Salesforce, for both kinds of source. It has to follow every release of Salesforce. About 6 days for the first, and a day or so at each release. (c) No description: names are taken as written, as in the trial, and the two kinds that are known to go wrong, a child relationship taken for a field and a `__r` name guessed as a lookup, are `probable` with a warning. About 1 day. The engine already holds a short list by hand, 24 relationships and 15 child relationships of standard objects (`extraction/model.ts`), which formulas and flows use. Under (a) the descriptions take its place for a snapshot of an org and it stays for a repository, under (b) it grows into the shipped description, and under (c) it stays as it is. | (a), and for a repository the two kinds of (c) are `probable` with a warning. An org knows its own objects, those of its packages included. I would not keep a list of Salesforce by hand beyond the short one there is. |
| Q3  | **Are test classes in an answer?** A test that names a field is a real dependency: Salesforce does not let a field be deleted while Apex names it outside a text, tests included. Tests also make an answer long: 396 of the 1,035 class files of the package folder of NPSP hold `@isTest`, by my count.                                                                                                                               | (a) A test class is kept in an answer and marked as a test, and the summary counts them. (b) A test class is left out of an answer about what refers to a component, counted, and an option of `impact` keeps it, as for the components of a package. (c) Kept and not marked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | (a). Before a change you want to know which tests to touch, and the mark lets you read past them.                                                                                                                        |
| Q4  | **Pass marks for this phase.**                                                                                                                                                                                                                                                                                                                                                                                                          | Proposed: (1) every entry of the new key that is not stretch is found at its line and column, nothing is reported that the key does not hold, no negative case is hit, and the marks of Phases 1 and 2 still hold. (2) Every class and trigger of the eight public codebases is read without an error of the analysis. A file that does not parse misses the mark, and the note names it with its cause. (3) On the test org, no pair that the Dependency API reports from an Apex class, a trigger, a Lightning component or a page is missing, for the kinds work package 1 shows that it reports. (4) A sample of 400 references of the public codebases, drawn with a fixed seed, with at least 25 of every kind and at least 25 of every tier, and the whole of a kind or a tier that has fewer, is checked by hand: no reference at the tier `confirmed` is wrong, and the share of wrong ones at the other tiers is reported. A search for missed names over two codebases explains every place it finds. (5) At least 98 percent of the edges of `apex-ls` to a method of apex-recipes are calls of the analysis, the share of the trial (751 of 766): the resolver of the engine does no worse. (6) A snapshot of the package folder of NPSP takes less than 60 seconds and 1.5 GB of memory with the default heap of Node.js, the mark of the trial of Phase 0.                                                                                                                                                                                                                                                                                                                                                                                                                                               | Accept as proposed. If a mark is missed, the phase reports the gap and we decide together, as in Phases 1 and 2.                                                                                                         |
| Q5  | **Who is the second reader?** Your reading for Phase 2, ten entries of the key and five flows, is in its test plan and not done yet. For Apex the agent that reviews a pull request is again a reader of the same kind as the author.                                                                                                                                                                                                   | (a) You read ten entries of the new key and 20 references of the sample of work package 9, in the test plan. About 45 minutes. (b) A colleague of yours does, with Apex in their daily work. (c) Nobody until the gate: the review agent stays the second reader, and the reports say so.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | (b) if you have someone, else (a). Apex is where an architect who did not write the code sees most.                                                                                                                      |
| Q6  | **The five things Phase 2 left open** (finding 12: items 3 and 4 of "Open with you" of its report, and two things its list of what is not done names).                                                                                                                                                                                                                                                                                  | (a) As the report recommends, in the first pull request of the phase: the reader of flows reads `overriddenFlow` and `dataTypeMappings`, the warning for `Id` at the end of a path goes, and a name alone that fits a flow and its definition means the flow, with the definition named beside it (`sameName`), as for an object since record 0064. The token of PMM (`%%%NAMESPACE%%%`) stays unread, with its warnings: it stands only in the source of PMM before its build, and no org holds it. About 1 day. (b) Only the two missed names. (c) None of them in this phase.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | (a). Each is small, and `dataTypeMappings` belongs with the Apex actions of flows.                                                                                                                                       |

### Your answers, 26 November 2026

You chose one option on a card, which took the recommended answer to each question: "Q1 a, Q2 a (plus c for a repo),
Q3 a, Q4 as proposed, Q5 b or else a, Q6 a". The recommendations are those of the last column of the table above.

| #   | Your answer                                    | What it means                                                                                                                                                                                                                                                                                                 | Where it is recorded                                                                |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Q1  | (a)                                            | Lightning web components and Aura components refer to the Apex they call, the fields and objects they import or name in an attribute, the labels, and the components they hold. A Visualforce page refers to its controller, its extensions and its standard controller, and `ApexPage` joins the logic tier. | Record [0079](../adr/0079-lightning-components-and-visualforce-pages-in-phase-3.md) |
| Q2  | (a), and the two kinds of (c) for a repository | A snapshot of an org asks the org to describe every object of which it holds a file, and keeps the descriptions with it. In a repository a name is checked against the files, and a child relationship taken for a field and a `__r` name guessed as a lookup are `probable` with a warning.                  | Record [0080](../adr/0080-an-org-describes-its-objects-to-a-snapshot.md)            |
| Q3  | (a)                                            | A test class is kept in an answer, marked as a test, and the summary counts the tests.                                                                                                                                                                                                                        | Record [0081](../adr/0081-a-test-class-stays-in-an-answer-and-is-marked.md)         |
| Q4  | As proposed                                    | The six pass marks as proposed. If one is missed, the phase reports the gap and we decide together.                                                                                                                                                                                                           | Here                                                                                |
| Q5  | (b), or else (a)                               | A colleague of yours with Apex in their daily work reads ten entries of the new key and 20 references of the sample of work package 9. If you have nobody, you read them, in the test plan.                                                                                                                   | Here                                                                                |
| Q6  | (a)                                            | In the first pull request of the phase, the reader of flows reads `overriddenFlow` and `dataTypeMappings`, the warning for `Id` at the end of a path goes, and a name alone that fits a flow and its definition means the flow. The token of PMM stays unread.                                                | Record [0082](../adr/0082-what-phase-2-left-open-about-flows-comes-first.md)        |

Three things I read into the answers, for you to strike:

- **Q5: who reads.** I do not know whether you have a colleague who can read the Apex. I ask you once, when the test
  plan of the phase is written, and write the reading so that either of you can follow it. Until a person has read
  the entries, the reports say that none has.
- **Q6 comes before the key of work package 1.** The first pull request reads two more names in flows before the key
  of this phase exists. The two kinds are proven on the public codebases, where the seven missed names stand, and
  the key gets entries for them in work package 1 where the test org can hold them. Record 0082 says why that is a
  departure from writing the key first, and why I take it for two small additions to a reader that has its key.
- **Phase 2 is not accepted yet.** Its test plan is not run as far as I know. Work packages 1 to 3 do not rest on it.
  The first pull request changes the reader of flows of Phase 2. A defect that its test plan shows is corrected
  before the next package that builds on the reader, as the last risk of section 8 says.

## 5. Work packages

Each package lists what is built and how it is accepted. "CI" means the checks run on Linux, macOS and Windows.
What I say here about Apex, Lightning components and Visualforce is from the documentation of Salesforce, from the
trial and from the files of the public codebases. Where the test org can confirm it, work package 1 asks.

### WP1 Fixture v3 and its key

The key is written before the analysers it scores, and is reviewed before they exist (records 0021 and 0029).

Build:

- New Apex in `fixtures/billing-sfdx` for the cases of findings 2 to 4 that the fixture does not have yet:
  - overloads with the same number of arguments and different types, a call whose overload is decided by the type
    of its argument, and a call to a method of a superclass and through an interface,
  - an interface with two implementations and a call through it, and an abstract class,
  - a child relationship of a standard object and of a custom object, in a loop and in a subquery, beside a lookup
    of the same name,
  - a query built in steps with `+=` and with a list of clauses that is joined, a query whose fields come from a
    parameter, a query whose text comes back from another method, `Database.query` with a map of bind values, and a
    search,
  - DML on a list of `SObject`, `Database.insert` with options, and `EventBus.publish` of a platform event, with
    the platform event object it publishes,
  - the custom setting `Billing_Settings__c`, which only formulas read today, read with `getInstance` and
    `getOrgDefaults`, a describe call by name, `Type.forName`, and a `switch` on a value,
  - a class that a trigger declares, a queueable and a schedulable class,
  - a field name that stands in a text of a custom metadata record and is used in a query, and a field set whose
    fields a method reads by its name.
- The fixture already has `Database.queryWithBinds` (`InvoiceSelector`), `upsert` by an external id field, an
  inner interface and a `switch` on a type (`ParserTorture`), a describe by token and `Schema.getGlobalDescribe`
  (`DynamicAccess`), virtual methods and their overrides (`TriggerHandler`, `InvoiceTriggerHandler`), a test class
  (`InvoiceServiceTest`) and a batch (`InvoiceBatch`). Their classes get the entries of the kinds the key does not
  hold yet: `calls`, `implements` and `uses-type`.
- A Lightning web component that imports an Apex method, fields and an object (`@salesforce/apex`,
  `@salesforce/schema`), a label and a custom permission, and holds another component of the project.
- An Aura component with an Apex controller, a call of a method of that controller from its JavaScript, an
  attribute of an object type and a `force:recordData` with fields.
- Two Visualforce pages (Q1), since Salesforce refuses a page with both a controller and a standard controller: one
  with a controller and an extension, one with a standard controller and an extension.
- The named credential `Billing_Gateway`, with a made-up endpoint on the reserved domain `example.com`, and the
  external credential it uses where the deploy needs one, so that the callout of the fixture names something the
  project defines.
- The test of the trial reads every Apex file of the fixture, expects 14 and holds that it finds nothing key v0
  lacks. New Apex would break it, so it reads the 14 files of key v0 by name. That is the only change to the trial.
- The entries of all of these in `fixtures/expected/answer-key.v3.yaml`: `reads`, `writes`, `calls`, `extends`,
  `implements`, `uses-type` and `references`, with the tier each must have, and negatives: a name in a comment, in
  a text that is no query and no argument of `get` or `put`, in the message of an assertion, a variable named like
  an object, a method of another class with the same name. The Apex entries of versions 0 to 2 stay as they are.
  Where the new key says more about the same place, for example the method behind a call of a flow where version 2
  names the class, the difference is listed in the header of the key.
- A deploy of the new fixture to the test org, and one run of the workflow "Live org" that reads it and asks the
  Dependency API. The run counts what the snapshot holds of the standard objects (finding 11). It prints counts
  only: its log is public and may name no component outside the fixture project (record 0033).

Accepted when:

- Salesforce accepts the deploy, and the Apex compiles. What it refuses is corrected by reading, as in Phases 1
  and 2, and the report says which and why.
- `fixture-key.test.ts` passes with the new key, and still with the old ones.
- The run is recorded in a note: which of the new pairs the Dependency API reports, by kind, from Apex, from a
  Lightning component, from an Aura component and from a page. What a snapshot holds of `Account` and `Contact`:
  how many standard fields have a file, and whether a child relationship appears anywhere in it.
- The pull request with the fixture and the key is merged before the one of work package 3 is opened.

### WP2 The parser in the engine

Build:

- `web-tree-sitter-sfapex` and `web-tree-sitter` as runtime dependencies of the engine, pinned, with a decision
  record (record 0018 says they join in this phase).
- The model of the syntax and the adapter in `extraction/`, starting from those of the trial and corrected where
  its list says. The trial stays as it is, but for its test (work package 1). The adapter of
  `@apexdevtools/apex-parser` is ported to the model of the engine as code of the tests of the engine, and
  `@apexdevtools/apex-parser` becomes a development dependency of the engine. A test holds the two adapters
  against each other on the fixture and on the 48 pieces of recent syntax, so that the second parser stays a way
  out by one import (risk 7 of the overall plan).
- The grammar is loaded once, before an analysis, and only when the snapshot holds a class or a trigger. Every tree
  is freed when its file is read. A file that does not parse is an error of the analysis for that class, with the
  place of the first error, and costs one component.

Accepted when:

- The smoke test of the package parses a class from the installed package on Linux, macOS and Windows.
- A test shows that a command that analyses nothing does not load the grammar, and `pnpm run check:startup` holds
  its budget.
- Every class and trigger of the eight public codebases parses, or is named with its cause.

### WP3 Classes, triggers and their members

Build:

- A class is a component, and each of its methods, constructors, properties, member variables, initialisers and inner
  classes is a component below it. The key of a method holds its signature in the canonical form of `core/keys.ts`,
  which leaves the spelling of a type to this phase: I propose the type as it is written, folded, with the namespace
  `System` dropped and the name of an inner class with its outer class. A record says which.
- A trigger is a component with its object and its events: `triggers-on` to the object, with the events as an
  attribute. A class declared in a trigger is a component below it.
- `extends`, `implements` and `uses-type` from the member where they stand: the type of a variable, a parameter, a
  return value, a cast and an `instanceof`. A `new` is a call of a constructor (work package 4). A type of Salesforce,
  such as `Account` or `Database.SaveResult`, is a target only where it is an object.
- A test class and a test method carry that they are tests (Q3, record 0081), and the store keeps it.
- A class without a body, as a class of a managed package can come back, is a component that is not analysed, with
  a warning.

Accepted when:

- Every entry of the key for declarations, `extends`, `implements`, `uses-type` and `triggers-on` is found, at its
  line and column, and no other.
- A snapshot of the fixture folder and one of the mock org give the same components for Apex.

### WP4 The resolver

Build:

- **The descriptions of objects, for answer (a) of Q2, which you gave (record 0080).** The request in `sources/`, after
  the last chunk of a snapshot of an org and before its analysis, for every object of which the snapshot holds a file,
  with a test that holds every request. The descriptions are stored with the snapshot (a store migration and a record),
  the mock org answers them, the data rules of `CLAUDE.md` get a line, and a run of "Live org" shows them on the test
  org, also whether they hold every field of the fixture. `analyse` reads them from the store.
- Scopes and the declared types of variables, fields and properties, with inheritance: a member of a superclass, of
  an outer class, and a static member of another class.
- Fields of a record, also through relationships, checked against the model of objects and, with an org, against
  the descriptions of Q2. A name that is a child relationship gives the object of its records, not a field.
- The tier of a name the resolver cannot check is lowered, as record 0018 asks. In a snapshot of an org, a name
  that a file or a description defines keeps the tier of its syntax, and a name that neither defines is
  `unresolved`, with a warning. In a repository, a name that a file of the snapshot defines keeps the tier of its
  syntax, and a name of Salesforce or of a package that no file defines is `external` at `probable`. The coverage
  counts both.
- SOQL and SOSL: the object, every field of the select list, the filter, the order and the groups, also in a
  subquery through a child relationship, and a bind variable. The alias of an aggregate is no field.
- DML with what it does (`op`): `insert`, `update`, `upsert` with its external id field, `delete`, `undelete`,
  `merge`, the methods of `Database` and `EventBus.publish`. The fields a statement writes are the fields the
  method sets on the record before it, as in the trial. DML on a list of `SObject` whose object is not known is an
  unknown place.
- Calls: to a method of the snapshot, chosen by name and by the types of the arguments where the number does not decide.
  A `new` calls the constructor its arguments choose, or the class where it declares none. A call that can reach several
  methods, through an interface or a virtual method, is `confirmed` to the method it names and `probable` to each
  override the snapshot holds. A call of a method of Salesforce is no reference, except the methods that name an object
  or a field (WP5).
- The object in front of a method of a custom setting, of a describe call or of a field token is a reference to
  the object. The trial did not make one, and left it to this plan: a class that reads a custom setting breaks when
  the setting goes.
- The values of a `switch`, interfaces and the other gaps of finding 3 that are syntax.
- A call into a class of a managed package whose body is hidden refers to that class and method by name. An
  answer that reaches such a class says that what it refers to is not known (section 3).

Accepted when:

- With answer (a) of Q2, a snapshot of the mock org holds the descriptions, and `analyse` without an org gives the
  same references from them.
- Every entry of the key for Apex that is not stretch and is no name in a text is found, at its line and column,
  with its kind, tier and `op`, and no other. No negative case is hit. The 184 entries of versions 0 to 2 are among
  them.
- On NPSP, no reference at `confirmed` names a field that no file defines, and no child relationship is taken for
  a field. The wrong references of finding 2 are counted again, and each kind that is left is named with its tier.

### WP5 Names in texts

The sequence of record 0012, step by step.

Build:

- **Step 1, the text itself.** The text of a query in `Database.query`, `Database.queryWithBinds`,
  `Database.countQuery`, `Database.getQueryLocator`, `Search.query` and their relatives, a field name in `get` and
  `put`, a relationship name in `getSObject`, `getSObjects` and `putSObject`, an object name in
  `Schema.getGlobalDescribe().get(...)` and `Schema.describeSObjects`, a field name in the map of fields of a
  describe, and a class name in `Type.forName`, which uses the class as a type. A text that is whole and read is
  `probable`. A name in a text that is no query and no argument of such a method gives nothing, as the key says.
- **Step 2, metadata that holds names.** A text read from a field of a custom metadata record, or the fields of a
  field set read by its name, give the names the records and the field set hold, at `probable`, with the place of
  the read in the code: the names are read from metadata, and the object is known (record 0012).
- **Step 3, how a text is built.** Constants, `+` and `+=`, `String.join` of a list of texts, `String.format`, and
  a text passed as an argument or given back by a method of the snapshot, followed through calls as far as the
  analysis of the whole snapshot reaches, without a loop. What is left unknown of a query whose object is known is
  a `possible` reference to the object. What is left unknown otherwise, also a class name in `Type.forName` that is
  not whole, is an unknown place.
- The coverage counts the names of each step, and the unknown places.

Accepted when:

- Every entry of the key for names in texts that is not stretch is found, at its tier, and the unknown places of
  the key are reported, and no other.

### WP6 Lightning components, Visualforce and callouts

Build, for answer (a) of Q1, which you gave (record 0079):

- A Lightning web component: `import ... from '@salesforce/apex/Class.method'` calls the method,
  `@salesforce/schema/Object.Field` refers to the field with the kind `references`, since an import serves to read
  and to write and the JavaScript is not followed, a path across a relationship such as
  `@salesforce/schema/Contact.Account.Name` refers to the lookup and to the field at its end,
  `@salesforce/schema/Object` refers to the object, `@salesforce/label/c.Name` and
  `@salesforce/customPermission/Name` refer to the label and the permission, an import from `c/name` and a tag
  `<c-name>` in its markup refer to that component. Imports of `@salesforce/resourceUrl`,
  `@salesforce/messageChannel`, `@salesforce/user`, `@salesforce/i18n`, `@salesforce/client` and `lightning/*`
  name no component of the logic tier and give nothing, without a warning. The JavaScript is read for its imports
  and for nothing else, with the reader of the engine for the forms of an import that the public codebases show.
  Fields named in an attribute of a base component, such as `lightning-record-form`, are `probable`.
- An Aura component: `controller` refers to the class, `component.get('c.method')` in its JavaScript, the
  controller or the helper, calls that method at `probable`, an attribute of an object type refers to the object,
  `force:recordData` refers to the fields it names (`references`, as an import), and a tag of another component of
  the project refers to it.
- A Visualforce page: `controller`, `extensions` and `standardController` refer to the classes and the object, and
  `ApexPage` joins the logic tier with its analyser (record 0058).
- A callout: a text that begins with `callout:` in a method that makes a request refers to the named credential at
  `probable`. A named credential refers to the external credential it uses.
- Two new origins of references, `parser:javascript` and `parser:markup`, for the JavaScript of a component and for
  the markup of a component or a page. The list of origins is closed (`core/references.ts`) and the store keeps it
  as a table (migration 0003), so they come with a record and a store migration.

Accepted when:

- Every entry of the key for these types is found, and no other.
- Every Lightning component, Aura component and page of the public codebases is read without an error, with the
  counts per codebase.

### WP7 The answers

Build:

- **Members and their class.** A member that is found brings its class, a result of the same depth with the
  reference of that member, unless the class was found nearer. The walk goes on from the member only: a method runs
  alone, unlike the elements of a flow (record 0066). The initialisers of a class are walked from its
  constructors, and a constructor from what calls it (`new`). For `--outgoing`, a class that is found is walked
  from all its members. A trigger is walked from its body.
- **Names.** `InvoiceService.recalculate` finds the method, and the answer starts from all its overloads.
  `InvoiceService` finds the class. A name with a signature finds one overload. A name that fits a method and a
  field is the error `COMPONENT_AMBIGUOUS`, with a hint. So is a name that fits a class and a Lightning web
  component, such as `InvoiceList` and `invoiceList`: the hint names both with their types (`ApexClass:InvoiceList`),
  as record 0064 has it for a name that fits several components and no object.
- **Tests.** An answer marks the results that are tests and counts them (Q3).
- **The cross-check of Apex.** The rows from an Apex class or a trigger, and from a Lightning component, an Aura
  component and a page, are compared at the level of the class or the component: a row is met by a reference from the
  component or any member of it to the target or any member of it. A pair the analysis lacks is `REFERENCE_MISSED`. A
  pair of a kind the API does not report, as work package 1 shows, is counted with a reason and not listed.
- **What an answer does not cover.** Apex leaves the list. Lightning web components, Aura components and pages
  stay on it where what this phase does not read of them can name what the answer is about, with that reason
  (outcome 6): for a field or an object, and for a page also a method. The table of `engines/can-name.ts` stays as
  it is, since it holds only types that no analyser reads: its lines that name a class, such as a suite of tests,
  now keep their type on the list of an answer about a class. A class without a body and a file that does not
  parse make an answer that can be about them not complete.
- The JSON output, `docs/cli.md` and `packages/cli/schemas/output.schema.json` change together, with a changeset.

Accepted when:

- Golden files for eight new questions: a field a method writes, a field read only in a dynamic query, a method
  with callers through an interface, a method with overloads, a class, a trigger, an Apex method a component calls,
  and `--outgoing` from a method.
- The test that works out the answer of every component from the key alone passes with the new key.
- Against the mock org, a pair taken out of a class on purpose is the error `REFERENCE_MISSED`.
- The impact times of the synthetic org are measured again, with Apex in it.

### WP8 Flows and Apex, and what Phase 2 left (Q6)

Build:

- An action of a flow calls the invocable method of its class, and its parameters are the invocable variables of
  the class of the request: a flow that sets a parameter writes that variable, and one that reads an output reads
  it. A flow then gives the Apex behind it to an answer, and an answer about the Apex names the flows.
- The output of an Apex action has a known object where the invocable variable has one. The path from it is
  followed, which Phase 2 could not.
- For answer (a) of Q6, which you gave (record 0082): `overriddenFlow` and `dataTypeMappings` are read, the warning for
  `Id` at the end of a path goes, and a name alone that fits a flow and its definition means the flow. This comes first,
  in the first pull request of the phase, and records 0061 and 0064 are completed.

Accepted when:

- Every entry of the key for flows and Apex is found, and no other.
- The seven names missed in Phase 2 are found in the public codebases, and the listing of Phase 2 changes only
  there.

### WP9 Proof on public codebases, and measurements

Build:

- **A sample checked by hand.** 400 references of the eight codebases, drawn with a fixed seed as Q4 says, each read
  with its line of source and the declaration it rests on. I check every one. The sample is kept in the repository as
  paths, places and the commit of each codebase, without the lines of source, which a script prints from the pinned
  codebases: a second person can repeat the check, and no code of the codebases is copied, so their licences ask nothing
  of the repository. The listing of the codebases itself is not kept, as in Phase 2.
- **A search for missed names.** As in the trial: every word that ends like a custom name and stands outside a
  comment in the Apex of NPSP and of EDA, compared with the places of the references and unknown places. Every
  place that is not covered is sorted into a reason. A sample of each reason is read.
- **Calls against `apex-ls`.** On apex-recipes, as in the trial, run during development and never shipped
  (record 0018).
- **Time and memory.** Of `snapshot` and `impact` on NPSP and EDA, and on a made-up source of about 1.5 million
  lines of Apex, made by copying codebases under other names as in Phase 2. Peak memory of the engine is measured for
  the first time, with the default heap of Node.js.
- A note in `docs/research/phase-3/` with the counts, every wrong reference and every missed one named with its
  cause and what was done.

Accepted when:

- Pass marks 2, 4, 5 and 6 of Q4 hold, or the note says which does not, and why.

### WP10 Phase close

- The overall plan updated, `docs/test-plans/phase-3.md`, a phase report, and the draft of the Phase 4 plan for
  your approval.
- The next pre-release, made by the workflow of records 0050 and 0053, under the next number that is free then.

Accepted when:

- The four documents are merged, and the report says for every acceptance criterion of this plan whether it is
  met.
- The pre-release is published on your word, or the report says what it waits for.

## 6. How the results are proven

| Proof                                            | What it shows                                                                          | Its weakness                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The answer key of the fixture, v3                | Every hard case I could think of is handled, and no negative case is hit               | I wrote the fixture, the key and the analyser                                                |
| The deploy of the fixture to the test org        | Every class compiles, and every component and page is valid Salesforce                 | Says nothing about what OrgLens finds. The Apex is compiled and never run                    |
| The Dependency API on the test org               | For what it reports of Apex and of the components around it, whether Salesforce agrees | It reports at the level of the class, and nothing to a standard field or of a name in a text |
| A sample of the public codebases checked by hand | Code I did not write, in breadth                                                       | 400 references, where three codebases alone gave about 60,000 in the trial. Checked by me    |
| The search for missed names                      | What the sample cannot: names the analysis did not report                              | Only words with a custom ending. A standard field that is missed is not found by it          |
| Calls against `apex-ls`                          | A second analyser of Apex agrees on the calls                                          | One codebase, and `apex-ls` itself reports problems that are none                            |
| The Dependency API on an org of yours            | Scale, and Apex that neither of us wrote                                               | Only you see the result                                                                      |
| The reading of a person (Q5)                     | A second person                                                                        | Ten entries and 20 references                                                                |

## 7. Pull requests and review

About fifteen pull requests, each from its own branch, each with a code review by a separate agent, merged when CI
is green on the three systems and every finding is resolved. Phase 2 planned about ten and needed 34, with the
corrections of your run. I expect more than fifteen.

Besides the records of your answers (0079 to 0082), the phase writes records for: the parser as a runtime dependency
(work package 2), the keys of members, the spelling of types and the mark of a test in the store (work package 3),
the descriptions of objects of Q2, the tiers of names that cannot be checked and the calls into packages
(work package 4), the new origins (work package 6), and the walk over members and their class, as record 0066 for
flows, and the cross-check at the level of the class, as record 0067 (work package 7).

## 8. Risks in this phase

| Risk                                                                                                      | Handling                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The resolver is the largest and least certain piece of the plan (risk 1 of the overall plan).             | The trial shows the design. If a part of work package 4 does not reach its mark in its time, its references are kept at the level of the class as `probable`, as risk 1 allows, the coverage counts them, and I come back to you before going on. |
| The grammar of `web-tree-sitter-sfapex` lags a release of Salesforce, and it is kept by one person.       | A file that does not parse costs one class and is named. The 48 pieces of recent syntax are a test. The second adapter of the trial stays as a way out.                                                                                           |
| Calls make answers long: in a framework of triggers almost everything calls almost everything.            | An answer keeps its depth and its limit, and says which results come only through calls. Work package 9 measures the length of answers on NPSP and EDA, and I come back to you if they are too long to read.                                      |
| Q2 (a) adds a request to the org, and its time on a large org is not known.                               | The snapshot asks only for the objects of which it holds a file, and the time is counted in the summary of a snapshot. Your org shows it.                                                                                                         |
| A description follows the permissions of the user who logs in, and can lack fields the org has.           | The files come first and the description adds to them. A name that neither holds is `unresolved` with a warning. The test org shows whether the fields of the fixture are in it.                                                                  |
| The resolver checks names against descriptions only with an org. A repository keeps more names unchecked. | The coverage counts them per snapshot. An answer from a repository says that names of Salesforce were not checked.                                                                                                                                |
| Memory on a large org.                                                                                    | Declarations first, then one file at a time (finding 10), measured in work package 9.                                                                                                                                                             |
| A Lightning component is JavaScript, and its imports can take forms the reader does not know.             | The forms of the public codebases are tests. An import the reader does not understand is a warning, never a guess.                                                                                                                                |
| Phase 3 grows: Apex touches everything, and an org of yours will show ten things.                         | The list "not in Phase 3" is the boundary. What an org shows goes to the Phase 4 plan unless it breaks an outcome of this one.                                                                                                                    |
| The test plan of Phase 2 is not run yet.                                                                  | Work packages 1 to 3 do not rest on it. A defect it shows is corrected before the next package that builds on it.                                                                                                                                 |

## 9. Effort

The roadmap estimated Phase 3 at 8 to 12 weeks. This plan is about 10, for the answers you gave: 50.5 days,
of which 4 are for answer (a) of Q2 (1 for (c), about 6 for (b)) and 4 for answer (a) of Q1.

| Work package                                    | Rough effort      |
| ----------------------------------------------- | ----------------- |
| WP1 Fixture v3 and its key                      | 5 days            |
| WP2 The parser in the engine                    | 3 days            |
| WP3 Classes, triggers and their members         | 4 days            |
| WP4 The resolver, with the descriptions of Q2   | 16 days           |
| WP5 Names in texts                              | 7 days            |
| WP6 Lightning components, Visualforce, callouts | 4 days            |
| WP7 The answers                                 | 4 days            |
| WP8 Flows and Apex, and what Phase 2 left       | 2 days            |
| WP9 Proof and measurements                      | 4 days            |
| WP10 Phase close                                | 1.5 days          |
| **Total**                                       | **about 50 days** |

These are developer-days as the overall plan counts them. Phase 2 was estimated at about 27 and was built in three
calendar days. Elapsed time depends on how fast you can answer, review the key and run the test plans.

## 10. What you will be asked to do

1. Answer Q1 to Q6 and approve this plan. Done on 26 November 2026.
2. Run the test plan of Phase 2, which holds your reading of ten entries of its key and five flows. This phase does
   not wait for it.
3. Read ten entries of the new key and 20 references of the sample, in the test plan of this phase (Q5).
4. Start "Live org" once the fixture of work package 1 is merged, again for the descriptions of Q2 (work package
   4), and for the cross-check of work package 7.
5. Review the pull requests you want to look at. Merging is done by the assistant under the rule of Phase 0.
6. At the end, run the Phase 3 test plan. Its main step is `orglens impact` on an org you know, for fields and
   classes whose Apex you know. If that org is a client's, the client's permission comes first, and nothing of it
   goes into an issue or a chat.
