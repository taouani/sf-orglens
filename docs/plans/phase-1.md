# Phase 1 plan: First slice

Status: **approved with one change** on 15 November 2026. The maintainer answered the eight questions of
section 4, chose "Approve with changes", named the change in a list of what should be covered, and chose of two
readings: a snapshot reads every type (record [0038](../adr/0038-a-snapshot-reads-every-type.md)). The change is
written in below. The approval was given before the change was written. The author told the maintainer that it
takes the plan as approved with this change, and the maintainer has not read the changed text. One thing is
open and does not hold up the start: how the components of the performance targets are counted (record
[0037](../adr/0037-performance-targets.md)).
Date: 2026-11-13, with the answers and the approval written in on 2026-11-15
Parent document: [OrgLens re-architecture plan](re-architecture-plan.md)
Before it: [Phase 0 plan](phase-0.md), [Phase 0 report](../reports/phase-0.md)

This plan is written by the AI assistant that builds the project, addressed to the maintainer. "I" is the
assistant and "you" is the maintainer.

## 1. Outcome

At the end of Phase 1, OrgLens answers its first impact question on a real org:

1. `orglens snapshot` analyses what it stores. Every component it read gets a row with its type and name.
   Objects, fields and validation rules are analysed: formulas, lookups, roll-up summaries, lookup filters,
   default values and field dependencies become references, each with its kind, its confidence and the line it
   stands on.
2. `orglens impact <component>` says what refers to a field or an object, directly and through other fields and
   rules, with the path that explains each result. It has a `--json` output that is a contract.
3. Every answer says what it does not cover. In this phase that is a lot: Apex, flows and everything else that
   is not an object, a field or a validation rule. An answer never reads as "nothing else refers to this".
4. `orglens coverage` shows per metadata type how many components were analysed, and how many names could not be
   resolved.
5. The results are proven in the ways section 6 describes: the answer key of the fixture project, every formula
   and rule of the public codebases, the Dependency API on the test org, and a run of your own on an org you
   know.

Phase 1 does **not** analyse flows, Apex, permissions or any other type. A snapshot reads and stores them (record
0038), and an answer names them as not analysed. Phase 1 does not compare snapshots and does not judge what a
specific change breaks. It answers by reachability only (decision record 0013).

## 2. What Phase 0 and the preparation of this plan found

I looked at the code and at six public codebases before writing this. Five findings shape the plan.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Consequence                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Public codebases hold few formulas and almost no validation rules.** I counted on 12 November 2026. NPSP: 13 formula fields and 3 rules in 765 fields. Nebula Logger, in the folder the manifest pins: 61 and 4. PMM: 15 and 13. EDA: 10 and 2. Outbound Funds: 1 and none. apex-recipes: none. Packages avoid them. Real orgs are where formulas and rules are, in hundreds. The counts of NPSP and Nebula Logger can be repeated on the pinned codebases. Those of PMM, EDA and Outbound Funds came from a script that is not in the repository, on clones that are not pinned, and cannot be repeated from it. | The public codebases cannot carry the proof for this phase the way they did for Apex. The 89 formulas and 20 rules of the three richest can be checked one by one, which I will do, but that is a small sample. The Dependency API on a real org becomes the main outside check. Question Q1. |
| 2   | **The Dependency API reports references from formulas to custom fields completely, as far as it was measured**: 24 of 24 on the test org, for formula fields and active validation rules. It reports nothing for standard fields, lookups, roll-up summaries and inactive rules ([real-org.md](../research/phase-0/real-org.md)).                                                                                                                                                                                                                                                                                   | For custom fields, Salesforce can say whether OrgLens missed a reference in a formula. For the rest, the answer key is the measure.                                                                                                                                                           |
| 3   | **An org rewrites the files of a project.** It adds elements with default values to almost every object and field, and writes a quote as `&apos;` where the repository has `'`. Lines and columns of the same formula differ between an org and a repository.                                                                                                                                                                                                                                                                                                                                                       | A reference is located in the file of its snapshot, not in "the" file. The reader of XML has to map a place in a decoded formula back to the place in the file.                                                                                                                               |
| 4   | **A repository holds a standard object only as far as it was customised.** No file of the fixture project says that the manager of a user is a user, so `Owner.Manager.Email` in a formula cannot be followed from the files alone, and the answer key marks that entry as "stretch". Whether the files an org hands out for standard fields say where a lookup points is not verified: no file of the test org was kept.                                                                                                                                                                                           | OrgLens needs a small table of the relationships every org has (`Owner`, `CreatedBy`, `RecordType` and so on) and a rule for the rest. What it cannot follow is recorded as not followed, never dropped.                                                                                      |
| 5   | **Both snapshots of the test org are "partial"**, and a snapshot reads every type the org lists, reports included. A snapshot is partial when a listed component did not come back, when the listing of a type failed, or when a file that came back cannot be read as metadata. The test org has all three. When this was written the overall plan said that reports are opt-in and that the logic tier comes first (decision F3), and nothing in the code did that. Since record 0038 reports are read by default.                                                                                                | An impact answer inherits the state of its snapshot. Before impact is usable on a real org, "what is read" and "what is complete" need a rule. Question Q2.                                                                                                                                   |

Two smaller ones:

- The engine has no reader for XML yet. The Salesforce library reads XML without positions, and the answer key
  asks for the line of every reference.
- The reference vocabulary still names `symboltable` as an origin. Since record 0034 nothing can have it. It is
  removed in this phase, in the pull request of WP3. The list of origins is part of the public API of the engine.
- `orglens snapshot` with a login of the Salesforce CLI has not run against Salesforce yet. It is part G of the
  Phase 0 test plan, and it is yours to run. Everything in this phase that reads an org stands on it.

## 3. Scope

### In scope

| Work package                   | Summary                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| WP1 Fixture v1 and its key     | Hard cases for formulas, written and keyed before any analyser, and deployed to the test org          |
| WP2 XML with positions         | A reader for metadata files that knows the line and column of every value                             |
| WP3 Components and references  | The tables for them, with versions shared between snapshots, and the benchmark through the real store |
| WP4 Objects, fields and rules  | Components, their attributes, and the references that are written in XML                              |
| WP5 Formulas                   | A parser for the formula language and a resolver for the names in it                                  |
| WP6 Analysis in the snapshot   | `snapshot` analyses, `coverage` reports it, an older snapshot can be analysed again                   |
| WP7 Impact                     | The engine and the command `orglens impact`, with its JSON contract                                   |
| WP8 Cross-check                | The Dependency API read by the engine and compared with its own references                            |
| WP9 What a snapshot reads (Q2) | The types that are read, what "complete" means, and the open points of Phase 0 in the logic tier      |
| WP10 Proof                     | Every formula and rule of the public codebases checked, and the measurements                          |
| WP11 Phase close               | Updated overall plan, test plan, phase report, draft of the Phase 2 plan                              |

### Deliberately not in Phase 1

- Flows, workflow rules, record types, custom metadata records and field sets. They are Phase 2. A formula that
  names a custom label or a custom metadata record gets a reference to it, and the target is a component that is
  named and not analysed.
- Apex (Phase 3), and with it everything of the Apex trial. `trial/apex` stays as it is.
- Comparison of snapshots, change sets, permissions and incremental refresh (Phase 4).
- Rules about a specific change, such as "deleting this field breaks that formula, changing its length does
  not". Phase 1 answers by reachability, and the output says so.
- The analysis of layouts, list views, reports, email templates and the rest of the presentation tier, and of
  report types. A snapshot reads them (record 0038), and an answer names them as not analysed.
- Asking an org to describe its objects through another API. Section 5, WP4, says what is done instead.
- The language model, the web UI, and any rider.

## 4. The eight questions and your answers

You answered all eight on 15 November 2026. With your approval on the same day you changed what follows from
Q2. The first table holds each answer and what follows from it. The second table holds the questions as they
were asked, unchanged.

| #   | Your answer                                                                                                                                                                          | What follows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | (a). The engine reads the Dependency API in this phase.                                                                                                                              | WP8 is built. In the overall plan this moves from Phase 3 to Phase 1, for the types this phase analyses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Q2  | (a), with a note: "the goal is all metadata except those coming from managed packages".                                                                                              | **Changed with your approval.** You wrote: "metadata to index/retrieve should cover almost everything in the org: Custom objects/fields, flows and their elements, Apex classes and their methods, email templates, report types, reports, permission sets, permissin set groups, ...." Of the two readings I put to you, you chose: a snapshot reads every type from Phase 1 on, complete is judged over the logic tier, and references are found phase by phase. Record [0038](../adr/0038-a-snapshot-reads-every-type.md) holds it and supersedes record [0036](../adr/0036-what-a-snapshot-of-an-org-reads.md). WP9 is built for it. Readings of mine in that record, which you can strike: custom labels, custom permissions and global value sets belong to the logic tier. What is missing outside the logic tier is a warning. A snapshot still reads the components of a package, and how packages are left out is put to you when Phase 2 is planned, because your own formulas and code refer to fields and classes of packages. |
| Q3  | (a).                                                                                                                                                                                 | Record [0035](../adr/0035-gate-where-salesforce-confirms-nothing.md) adds the second half to the gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Q4  | Your own numbers, for an org of 100,000 components: first snapshot under 60 minutes, impact query under 5 seconds, comparison under 10 seconds, incremental refresh under 5 minutes. | Record [0037](../adr/0037-performance-targets.md). **How you count a component is open**, and I asked you on the same day. The question counted top-level components only, and by that count your target is ten times the synthetic org of Phase 0. Counted as the org lists them, fields included, it is twice that org. Until you answer, this plan works with the second count, as a reading of mine. Two more readings of mine are in the record: the org of the gate stays at 10,000 or more, and the 5 seconds hold for the worst impact query that is measured. This phase measures the impact query at the target size, through the real store (WP3 and WP7). Nothing that was measured supports 60 minutes for a first snapshot, by either count, and this phase does not change that (section 8).                                                                                                                                                                                                                                 |
| Q5  | As proposed.                                                                                                                                                                         | The four pass marks stand. If one is missed, the phase reports the gap and we decide together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Q6  | (a).                                                                                                                                                                                 | WP11 ends with a pre-release on GitHub that has the packed command line attached. Nothing goes to npm.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Q7  | (a).                                                                                                                                                                                 | WP6 builds `orglens analyse <source>`. The record that extends 0016 is written in the pull request of WP6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q8  | (a).                                                                                                                                                                                 | WP2 builds a reader of our own. I still search for a library on the first day of WP2, and take it and tell you if one exists and is maintained. The record is written in the pull request of WP2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

One thing your answer to Q6 leaves open, which I put to you before the release of WP11: records 0022 and 0027
say that the package names and the JSON contract can still change "until the first release". Whether this
pre-release is that release is not decided.

The questions as they were asked on 13 November 2026:

| #   | Question                                                                                                                                                                                                                                                                                                                                                                                 | Options                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **Is the Dependency API read by the engine in this phase?** The roadmap has it in Phase 3, with Apex. Finding 1 says that without it, this phase is proven on a fixture I wrote and on about 110 public formulas and rules.                                                                                                                                                              | (a) Yes, in Phase 1, for the types this phase analyses. `coverage` then says for a real org how many pairs Salesforce reports, how many OrgLens found, and names every pair OrgLens missed. About one week more. (b) No, in Phase 3 as planned. WP8 is dropped. The test tool of Phase 0 then does the comparison on the test org, for the fixture project only: WP1 extends it to the new fixture, and the third pass mark of Q5 is measured with it. Outcome 5 loses its last part: a run on an org of yours has no check from Salesforce. | (a). It is the only check at scale that I did not write, and it lets you verify OrgLens on a client org without anything leaving your machine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Q2  | **What does a snapshot of an org read, and when is it complete?** Today it reads every type the org lists, and it is partial when anything that was listed did not come back. On the test org that was so both times.                                                                                                                                                                    | (a) The logic tier by default, as decision F3 says. Other types are read when `orglens.toml` asks for them. A snapshot is complete when every listed component of the types it reads came back and could be read. (b) Everything, as today, and completeness is judged over the logic tier only. What is missing elsewhere is a warning. (c) As today. Every snapshot of the test org stays partial until each cause is understood.                                                                                                          | (a). It follows a decision you already made, it should make the first snapshot of a large org shorter, which is not measured, and "partial" gets its meaning back. One consequence needs your yes: the list of logic-tier types in record 0004 does not name custom labels, custom permissions and global value sets, which a formula can refer to and which WP1 and WP5 use as targets. With (a) I add the three to the default list, in a new record that extends 0004. With (a) or (b), 13 components of the test org in logic-tier types still need an explanation, and the custom labels with them. They are in WP9. |
| Q3  | **What does the correctness gate ask for where Salesforce confirms nothing?** The gate says: no dependency that Salesforce confirms is missing. For standard fields, names in text, lookups and roll-up summaries, Salesforce confirms nothing.                                                                                                                                          | (a) Add a second half to the gate: for those kinds, every entry of the answer key is found, and a random sample from public codebases is checked by hand with no wrong reference and a published list of what was missed. The size of the sample is set in the phase that runs the gate. (b) Decide when Phase 3 is planned, when the largest of those kinds, names in text in Apex, is built.                                                                                                                                               | (a). The wording costs nothing now and tells every phase what it is working towards.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Q4  | **Performance targets.** Open since the overall plan. Proposed for an org of 10,000 components: first snapshot under 30 minutes, impact query under 2 seconds, comparison under 10 seconds, incremental refresh under 5 minutes. Phase 1 builds the impact query.                                                                                                                        | Confirm, or give other numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Confirm. Phase 1 then measures the impact query against 2 seconds, on a synthetic org through the real store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Q5  | **Pass marks for this phase.**                                                                                                                                                                                                                                                                                                                                                           | Proposed: (1) every entry of the answer key for fields and rules that is not marked as stretch is found, nothing is reported that the key does not hold, no negative case is hit. (2) Every formula of the public codebases is read without a problem. (3) On the test org, no pair that the Dependency API reports for a formula field or a validation rule is missing. (4) In the check by hand of WP10, no reference at the tier `confirmed` is wrong, and every reference that was missed is corrected or named with its cause.          | Accept as proposed. If a mark is missed, the phase reports the gap and we decide together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Q6  | **How do colleagues get it at the end of the phase?** The roadmap says that colleagues use OrgLens from Phase 1. Nothing is published.                                                                                                                                                                                                                                                   | (a) A pre-release on GitHub with the packed command line attached, installed with one `npm install` line. No npm account is needed. (b) A pre-release on npm under the tag `next`. You create the npm account and a token, and someone has to check that the name is free, which I have not done because it sends the name to an outside service. (c) Nothing yet. Colleagues build from the repository.                                                                                                                                     | (a) for this phase. The step to npm can follow when the name is checked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q7  | **A new command, `orglens analyse <source>`?** Analysis is part of `snapshot`. A snapshot that an older OrgLens took has to be analysed again without reading the source, because the files of a snapshot never change and its analysis belongs to the engine version that made it. Record 0016, which you agreed as decision D6, fixes the set of commands, and `analyse` is not in it. | (a) A new command `orglens analyse <source>`, with a record that extends 0016. (b) No new command: a flag of `snapshot`. Flags are outside record 0016. A `snapshot` that reads no source is an odd thing to explain. (c) Neither: `impact` and `coverage` analyse a snapshot by themselves when its analysis is missing or old. Nothing to learn, and a command that only reads would then write.                                                                                                                                           | (a). It says what it does. It is your decision because it changes the command set you agreed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Q8  | **Our own reader for XML?** The Phase 0 plan named `fast-xml-parser` behind a wrapper of our own, and you approved that plan. No XML is read yet. The answer key asks for the line of every reference, and for a formula for the place of every name inside the text. `fast-xml-parser` gives values without places.                                                                     | (a) A reader of our own, about 300 lines, for the XML that metadata files hold. `fast-xml-parser`, which the Salesforce library already brings, is the second opinion in the tests. This reverses the choice of Phase 0. (b) `fast-xml-parser` as approved, and the places found by a second search of the text. That search has to undo entities such as `&apos;` itself, which is most of what a reader does.                                                                                                                              | (a). I know no library that gives the place of each decoded character. I have not searched for one beyond the ones the Salesforce libraries bring, and will on the first day of WP2. If one exists and is maintained, I take it and tell you.                                                                                                                                                                                                                                                                                                                                                                             |

Not a question any more: you chose `web-tree-sitter-sfapex` as the Apex parser on 13 November 2026 (record 0018).
Phase 1 does not depend on it.

Smaller choices I will make unless you object:

- **`orglens impact` takes a key or a name.** `orglens impact Account.Industry` and
  `orglens impact CustomField:account.industry` are the same. A name that fits several components ends with an
  error that lists them.
- **`orglens impact --outgoing`** lists what a component itself refers to. A person needs it to check a result by
  hand.
- **Our own parser for formulas.** The language is small and has no published grammar. I have not tried the
  existing open-source parsers. I will on the first day of WP5, and take one if it gives positions, keeps
  comments and strings apart from names, and does not fail on a function it does not know.
- **Standard objects from a table and a rule, not from the org.** WP4 says how. If the measurements show that this
  misses too much, I bring you the option of asking the org to describe its objects, which is one more API.

## 5. Work packages

Each package lists what is built and how it is accepted. "CI" means the checks run on Linux, macOS and Windows.

### WP1 Fixture v1 and its key

The key is written before the analyser it scores, and it is reviewed before the analyser exists (records 0021 and
0029).

Build:

- New fields and rules in `fixtures/billing-sfdx`, each for one hard case:
  - a formula across three relationships, one of them a relationship of a standard object,
  - `$Setup` with a field of a custom setting, `$Label`, `$Permission`, `$User`, `$Profile`, `$Organization`,
    `$RecordType`, `$ObjectType` with `VLOOKUP`, and `$CustomMetadata`,
  - `ISPICKVAL`, `ISCHANGED`, `PRIORVALUE`, `INCLUDES`, `CASE` and `TEXT` on a picklist,
  - a name of a field inside a comment, and inside a text literal with both kinds of quotes,
  - a field named like a function, and a name written in another case than it is declared,
  - `Owner:User` and `Owner:Queue`, a self-relationship (`Parent`), a hierarchy field,
  - a default value that is a formula, a dependent picklist with its controlling field, a global value set,
  - a lookup filter that names `$User` and a field of the source, and a roll-up summary with two filter lines.
- A custom setting with two fields, a custom label, a custom permission and a custom metadata type with one
  record, as targets.
- The entries of all of these in `fixtures/expected/answer-key.v1.yaml`, with negatives for every name that
  stands in a comment or in text. `answer-key.v0.yaml` stays as the key the Apex trial was scored with.
- A folder beside the project for what cannot be deployed: formulas that do not parse, a formula that names a
  field that does not exist, a field of a namespace that is not there.
- A list of formula probes, as the Apex trial has for syntax: one small formula for every function Salesforce
  documents, every operator and every kind of literal. Expected: each is read without a problem.
- A deploy of the new fixture to the test org, and a run of the probe of Phase 0.

Status on 15 November 2026, with the pull request that holds the fixture and the key. Built: the 35 new
components, `answer-key.v1.yaml` with 106 references in fields and rules (62 more than version 0), the probes
(178 formulas) and the folder `fixtures/formula-negative` (10 files), each with a check.

The first deploy, on the same day, was refused for two of the 87 components, and Salesforce changed nothing in
the test org: the rule that held `$RecordType.Name` and the field with the default value
`TEXT($User.Billing_Region__c)`. The log names the two components and not the reason. Both were corrected by
reading, and Salesforce accepted the second deploy: 87 of 87 components. Why the two were refused is still my
reading.

The probe ran after it. The Dependency API reports 129 of the 189 pairs of the key, and 29 of the 52 that are new.
No row between two components of the fixture is wrong. Of the 52 pairs from a formula to something custom, which
are not the same 52, it reports 51, and the one is in the inactive rule. It reports nothing for a global value set and for a controlling
field, which is new, and nothing for standard fields, lookups, roll-up summaries and lookup filters, as before.
The tool that asks had to be corrected first: it gave the custom metadata type a name with the ending `__c`.
[real-org.md](../research/phase-1/real-org.md) has the numbers and what is not verified.

Open: your reading of ten entries.

Five things differ from the list above:

- The fixture has no `$RecordType`. Salesforce refused the rule that had it. That the variable is the reason,
  because `Invoice__c` has no record type, is my reading. A probe has it, the key does not. To key it, the project
  would need a record type, which is one more metadata type in the fixture. That is not done.
- The fixture also has `$UserRole`, and the folder of what cannot be deployed also has a relationship and a
  label that do not exist.
- The list of functions for the probes is the one of the help page of Salesforce, and the fetch of that page gave
  only two thirds of it as written. [fixtures/README.md](../../fixtures/README.md#formula-probes) says which
  names were read how.
- The probes are not deployed. "Every function Salesforce documents" is therefore a list of calls a parser must
  read, not a list of formulas Salesforce accepts.
- The tests of how a retrieve is split, repeated and continued now run against a fixed part of the project, so
  that their numbers do not move each time the project gets a type. One test takes a snapshot of a mock org with
  the whole project, with every new type in it.

One case that the list does not name is lost as well: a custom field in a default value. Salesforce refused the
field that had one. The fixture still has a default value that is a formula, as the list asks, and the one
default value that names a field now names a standard field of the user.

Accepted when:

- Salesforce accepts the deploy, which shows that every formula of the fixture is valid. Met on 15 November
  2026, on the second try.
- `fixture-key.test.ts` passes with the new key. Met.
- The pull request with the fixture and the key is merged before the pull request of WP5 is opened. Met.
- The run of the probe is recorded: which of the new pairs the Dependency API reports. Met:
  [real-org.md](../research/phase-1/real-org.md) lists the 23 it does not report, and the other 29 are reported.
- You have read at least ten entries of the new key against their files (section 9). Open.

### WP2 XML with positions

Build, in `extraction`:

- A reader for the XML of metadata files: elements, text, the five entities and character references, CDATA,
  comments, the declaration. It gives a tree in which every element and every text has its line, its column and
  its place in the bytes of the file. For a text it also gives the place of each decoded character, so that the
  twentieth character of a formula can be found in the file even when a quote before it is written as `&apos;`.
- It reads what Salesforce writes and what people write: LF and CRLF, a byte order mark, attributes on the root,
  `xsi:nil`. It refuses what it does not know with an issue for that file, and never guesses.

Accepted when:

- Unit and property tests pass, among them: for a random document, every value the reader gives equals the value
  `fast-xml-parser` gives, and every place it gives holds that text in the file.
- Every `-meta.xml` file of the public codebases is read without a problem. That is more than 11,000 files.
- A file that is not well-formed gives an issue and no exception.

Status on 15 November 2026, with the pull request that holds the reader. Built: `extraction/xml.ts`, its tests,
and decision record [0039](../adr/0039-a-reader-of-our-own-for-xml.md).

- **The search I promised in Q8 found no library to take.** Seven were looked at. None gives the place of each
  decoded character. [xml-readers.md](../research/phase-1/xml-readers.md) has the list.
- **All three points above are met.** The reader gives back the names, the values and the places of 1,500 random
  documents, and the values `fast-xml-parser` gives for them. It reads the 11,338 `-meta.xml` files of the three
  public codebases without a problem, to the values `fast-xml-parser` gives, in a third of a second. 95 kinds of
  file that it must refuse give an issue each, and so does every start of a file that is cut off, and random
  bytes.
- **The review of the pull request found one fault against the third point, and it is corrected.** An entity
  named like a built-in property of an object of JavaScript, such as `&constructor;`, was read as a text. The
  review also found that a file with thousands of namespace prefixes took minutes, or all the memory. It takes
  the time of its length now. The record has what the review compared the reader with.
- CI does not download the public codebases. The test over them ran on my machine and is skipped in CI.

Six things differ from what Q8 and the list above say, or are choices of mine that you can strike:

- The reader is about 840 lines, of them about 620 of code and types. Q8 said "about 300 lines".
- It refuses six things that well-formed XML can hold: a document type declaration, a processing instruction,
  an encoding other than UTF-8, a version other than 1.0, an element with both text and elements, and elements
  nested more than 256 deep. No file of the fixture project or of the public codebases holds one, and the
  deepest of them is 8 deep. Whether a file of a real org does is not known.
- The sentence of an issue names what stands where a name is expected, cut after 60 characters. In a file that
  is not well-formed that can be a word of a formula. WP4 decides where such a sentence is shown.
- It does not keep comments, nor the white space between child elements.
- It resolves names against the namespaces a file declares, and refuses a prefix that is not declared.
- A column counts UTF-16 code units. A character outside the basic plane, such as an emoji, counts as two.

Five things the review noted for WP4, which builds on the reader:

- 131 of the 11,338 files have a root element outside the namespace of the Metadata API: 68 use that of the
  Tooling API, and 63 translations of objects declare none. So an analyser finds an element by its name without
  the namespace, and does not ask for the namespace on the root.
- An element with nothing in it has the empty text, however it is written. A value that is empty and a group
  without members look the same.
- The text of an element is not trimmed.
- `core/references.ts` does not say which unit a column has. WP4 says it there, before a second parser gives
  columns.
- The markup of Aura and Visualforce is not XML that this reader reads: it uses prefixes it does not declare and
  the entities of HTML. That is right for `-meta.xml` files and a limit for later phases.

### WP3 Components and references in the store

Build:

- Migration 0003, following the layout the research measured
  ([sqlite-store.md](../research/phase-0/sqlite-store.md)): one table of identities with the key as text, and
  integer ids everywhere else. A version of a component holds its attributes and its references, and is shared by
  every snapshot in which the component is the same. A snapshot is a list of versions. A reference goes from a
  version to an identity, with kind, origin, confidence, resolution, line and column.
- A version is the same only if the file is the same **and** the references found in it are the same. A formula
  can stay as it is while the lookup it goes through now points elsewhere.
- A target does not have to be a component of the snapshot. `CustomField:account.name` is a target in a
  repository that holds no file for it.
- Coverage per origin (`parser:xml`, `parser:formula`): components looked at, references found, names not
  resolved, files that failed.
- Writing in one transaction with batches. Reading through one interface, so that the impact engine does not know
  whether it walks SQL or an index in memory.
- A decision record for the tables.
- The benchmark of Phase 0, which used tables of its own, run again through the real store. The generator of
  the benchmark gets a factor for the size, and the benchmark runs at two sizes: the synthetic org of Phase 0,
  which has 147,000 rows, and the size of your targets. With components counted as an org lists them, that is
  twice the org of Phase 0. If you count top-level components only, it is ten times, and it costs one more run
  with another factor (record 0037).

Accepted when:

- Every store test passes with both SQLite drivers, on the three systems.
- A second snapshot of an unchanged source adds membership rows and no version.
- A database of schema version 2 is migrated, and its snapshots are still there and count as not analysed.
- The benchmark is recorded: for the synthetic org of 147,000 rows, the size after one and after ten
  snapshots and the time to write one, next to the numbers of Phase 0 (106 MB, 159 MB, 4 seconds). If the real
  store is more than twice as large or as slow, I report it before going on. The same three numbers are recorded
  for the org of twice the size. Phase 0 has no numbers to hold them against.

Status on 16 November 2026, with the pull request that holds the tables. Built: migration 3,
`store/analysis.ts` (`writeAnalysis`), `store/graph.ts` (`SnapshotGraph`, `sqlGraph`), their tests, the benchmark
`bench/store.mjs` and decision record [0040](../adr/0040-components-and-references-in-the-database.md).

- **The first three points above are met.** The tests run with both drivers on the three systems of CI. A
  second snapshot of an unchanged source adds a list and no version, also when the references and the keys of
  the attributes come in another order. A database of schema version 2 is migrated, its snapshots are there and
  none counts as analysed.
- **The benchmark**, through the real store, on one Linux machine, with ten snapshots of one source
  ([store-benchmark.md](../research/phase-1/store-benchmark.md)):

  | Measurement                    | Phase 0, own tables                | Real store   | Real store, twice the size |
  | ------------------------------ | ---------------------------------- | ------------ | -------------------------- |
  | Size after the first snapshot  | 106 MB                             | 94 MB        | 190 MB                     |
  | Size after ten snapshots       | 159 MB                             | 146 MB       | 293 MB                     |
  | Time to write the first        | 4.0 s recorded, 3.5 to 3.6 s today | 7.0 to 8.0 s | 15.4 s                     |
  | Time to write a later snapshot | 0.37 s                             | 3.1 s        | 6.6 s                      |

- **The first write takes about twice as long as in Phase 0, which is the limit this plan set, so I report it.**
  By the runs of the same day it is 1.9 to 2.3 times, and 1.8 times the recorded 4 seconds. The two times do
  not hold the same work: the store checks every key and takes a digest of every version, and the benchmark of
  Phase 0 wrote an index for names. I made it faster where I could (a larger page cache, about 15 percent) and
  found nothing more that the measurements support. Against your target of 60 minutes for a first snapshot,
  7 seconds are little. I go on with WP4 unless you want this looked at first.
- **The size is about the same as in Phase 0, not smaller in a way that counts.** Of the 12 MB the store saves,
  9 MB are the index for names that the tables of Phase 0 held and the store does not have yet.
- **The later snapshots cannot be compared.** The benchmark of Phase 0 knew which components had changed. The
  store is handed all of them and finds out by itself.
- **An org and a repository of one project will share few versions.** A version is the same only if the
  content and the place of every reference are the same, as this plan asked, and an org rewrites almost every
  file (finding 3). So the sharing that the numbers above show holds between snapshots of one source. A second
  source costs about as much as a first snapshot (an estimate of 70 MB at the size of Phase 0, not measured),
  and the comparison of an org with a repository has to compare what the versions hold. Record 0040 says how
  the comparison engine can get a digest of its own later. This was found by the review of the pull request.
- **The benchmark found a fault that no test had found, and it is corrected.** SQLite answered "which references
  point at this component" by walking the whole list of the snapshot, and the first run did not end. The
  statements now fix the order of their tables, and a test reads their query plans.
- **The review of the pull request found no fault in the code and four larger points**, all taken up: the point
  about the two sources above; nine shapes of a reference that the vocabulary forbids and the tables accepted, of which the tables now refuse four, one can no longer make a second version, and the record names the other four; 21 planted faults that the tests did not
  catch, for which 20 tests were added; and claims about the benchmark that one run each did not carry, which
  are now stated with the runs behind them.
- **Thirteen choices in the tables are mine**, and record 0040 lists them for you to strike. The ones with the
  most weight: a component whose references move by a line gets a new version, the kind and the three other
  fixed values of a reference are stored as numbers with a table that explains them, and an analysis of a
  snapshot is replaced as a whole when it is written again.
- **For WP4.** `validateReference` accepts two things the store cannot hold as they are: a line larger than
  SQLite can store, which the table refuses, and a name with half of a surrogate pair, which is stored as
  another character than it was. WP4 changes `core/references.ts` for the unit of a column and takes these two
  with it.
- **For WP6.** `readIssues` gives the issues of the reading and of the analysis together, and the code that
  decides whether a snapshot is complete counts every error among them. When WP6 writes the first analysis into
  a snapshot, that count has to look at the stage. WP6 also keeps the column `analysed` of the coverage per
  type in step with the analysis: `writeAnalysis` does not touch it. The time WP6 adds to a snapshot is that
  of the analysers plus 7 to 8 seconds for the store at the size of Phase 0.
- **For WP7.** Walking five steps from the most used field one question at a time takes 3.5 to 4.2 seconds at
  the size of Phase 0 and 8 to 10 seconds at twice that size, which is above your target of 5 seconds. From an
  ordinary field it takes less than a millisecond. WP7 needs a faster way for the worst field, an index in
  memory or one recursive statement, and measures it. Phase 0 measured 3 milliseconds and 0.8 seconds for the
  two. A snapshot knows the parent of every component it knows, so the walk can go up from a field to its
  object also where the source holds no file for the object.
- **Not done.** The size of ten times the org of Phase 0 was not run. It is the size of your targets if you
  count top-level components only, which is still open with you. No command deletes a snapshot yet, and the one
  that will has to remove the versions it leaves. Nothing was measured on Windows or macOS, with a cold file
  cache, or with two sources in one database.

### WP4 Objects, fields and validation rules

Build, in `extraction`:

- **Components.** Every metadata component of a snapshot gets a row with its type and name, whatever its type, so
  that a reference can point at it and an answer can name what was not analysed. Analysed in this phase:
  `CustomObject`, `CustomField`, `ValidationRule`. A standard object that a repository holds only as a folder of
  fields gets a component that is marked as not defined in the source.
- **Attributes** that later phases and the formula resolver need: the type of a field, where a lookup points, the
  name of its relationship, whether a field is a formula, whether a rule is active, whether an object is a custom
  setting.
- **References written in XML**, with the line of the element:
  - a lookup or master-detail field to its object (`references`),
  - a lookup filter to the fields it compares (`reads`), also behind `$Source` and `$User`,
  - a roll-up summary to the field it sums, to the field that ties the child to the parent, and to the fields of
    its filter,
  - a dependent picklist to its controlling field, a picklist to its global value set,
  - a validation rule to the field its message is shown at.
- **The model of objects** that formulas are resolved against: for each object its fields, and for each
  relationship name the field behind it and the object it leads to.
  - A custom relationship is read from the lookup field: `Account__r` is the field `Account__c`.
  - A standard relationship follows the rule that `Xyz` is the field `XyzId`. Where it leads is known when a file
    says so, when the name is an object, or when it is one of a short table of relationships that every org has
    (`Owner`, `CreatedBy`, `LastModifiedBy`, `RecordType`, `Parent`, `Manager`, `ReportsTo` and a few more).
  - Where it leads is otherwise not known. The reference to the relationship field is recorded, the rest of the
    path is recorded as not followed, and coverage counts it.
- **What becomes of a name that is not found**: a custom name is `unresolved`, which is a finding. A name with
  the prefix of a package that is not in the snapshot is `external`. A standard field that no file defines is
  `external` and keeps its key, so that "what refers to `Account.Name`" has an answer.
- Two names that fold to one key are reported and not merged.

Accepted when:

- Every reference of the key that is written in XML is found (lookups, filters, summaries, display fields), and
  nothing else of those kinds.
- The components of the fixture project are the 52 of the key plus the new ones, on a snapshot of the folder and
  on a snapshot of the mock org built from it, with the same keys in both.
- The public codebases are analysed without an exception. For each, the plan of WP10 gets the count of
  relationship paths that could not be followed.

Status on 16 November 2026, with the pull request that holds the analysis. Built: `extraction/analyse.ts`
(`analyseSource`), `extraction/objects.ts`, `extraction/model.ts`, `extraction/names.ts`,
`extraction/analysed.ts`, their tests and decision record
[0041](../adr/0041-components-and-names-written-in-xml.md). No command runs the analysis yet: WP6 writes it into a
snapshot.

- **The three points above are met.**
  - The analysis finds the 26 references of the key that are written in XML, each at the line and the column
    the key says, and no other: 5 through lookups, 8 through filters, 5 through summaries, 5 through display
    fields, 2 through global value sets and 1 through a controlling field.
  - The key lists 87 components today, not 52. The analysis gives those and two more: the standard objects
    `Account` and `User`, of which the project holds fields and no file, as components that are not defined. A
    snapshot of the mock org built from the project gives the same 89 keys and the same 26 references. One
    thing differs and should: the org hands out the file of `Account`, so the lookup to it is `resolved` there
    and `external` in the folder.
  - The three public codebases are analysed without an exception and without an issue. A test pins the numbers
    and is skipped where the codebases are not downloaded, which CI does not do.

    | Codebase      | Components | Objects, fields and rules read | References written in XML | Paths not followed |
    | ------------- | ---------- | ------------------------------ | ------------------------- | ------------------ |
    | apex-recipes  | 255        | 44                             | 9                         | 0                  |
    | nebula-logger | 894        | 622                            | 49                        | 0                  |
    | npsp          | 11,722     | 819                            | 97                        | 0                  |

    A search of the files for the elements that are read gives the same counts of references. The largest
    takes 0.3 to 0.9 seconds on one Linux machine.

- **The count for WP10 is 0, 0 and 0, and it says little.** No file of the three writes a path through a
  standard relationship in XML. The table of relationships and the rule for names were exercised by tests
  only. Formulas use such paths far more, so the count that matters comes with WP5.
- **The review of the pull request found one fault that would have cost an org its components, and it is
  corrected.** An org hands out an object as one file. The first version made components of the fields and the
  rules in it and of nothing else, so record types, list views, field sets, compact layouts, web links,
  business processes, sharing reasons and indexes had no row in a snapshot of an org and one in a snapshot of
  the repository. The fixture project has none of these, so the test on the mock org did not show it. All ten
  kinds are components now, and a test compares one object in both forms. The fixture project was not given a
  record type or a list view: that changes the answer key and what is deployed to the test org, and belongs to
  a pull request of its own if you want it.
- **The review found eleven more points, all taken up.** A value that ends with a dot made the analysis of its
  field fail, and inside the file of an object it took the parts after it along. A file name with a backslash
  made the whole analysis fail. Custom fields of an activity were called unresolved when a task or an event
  named them. The count of files that failed left out files that could not be opened. An object in two package
  folders was read from one. The record and `CLAUDE.md` said things the code did not do. Eleven planted faults were not
  caught by a test, for which tests were added. One guard still has no test, and the record says which.
- **Twenty-one choices are mine**, and record 0041 lists them for you to strike. The ones with the most weight:
  - A custom name that is not found has no key. The reference keeps the name as written and, for a field, the
    object it was looked for on. "What refers to a field that does not exist" cannot be asked by key.
  - A standard field without a file is always `external`. A typing error in such a name is not found.
  - `Owner` is taken as a user and `Parent` as the object itself, which is wrong for the few objects where the
    owner can be a queue or the parent is of another kind.
  - The parts inside the file of an object become components, and an object of which the source holds only
    parts gets a component that is not defined. The source library lists neither, so the analysis counts more
    components than the list: 15 more in NPSP, all of them objects of which it holds parts and no file.
  - A custom field named on a task or an event is looked for at `Activity`, and a name that ends in `__pc` on
    an account at the contact.
  - A reference says in an attribute `via` how the source names its target.
- **One thing differs from this plan.** It says that coverage counts the paths that were not followed. Each one
  is an issue `PATH_NOT_FOLLOWED`, and the count is the number of those issues. The coverage table of WP3 has
  no column for it.
- **One thing was added to this plan.** The field of a custom metadata type that points at a field of an object
  names the field that says which object (`metadataRelationshipControllingField`). It is read as a reference:
  the public codebases write it 9 times.
- **`core/keys.ts` changed.** It knew five kinds of parts whose parent is an object. It knows the ten now, so a
  compact layout or a web link has its object as its parent.
- **The two points WP3 left for this package are done.** `core/references.ts` says which unit a column has, and
  refuses a line the database cannot hold and a name with half of a surrogate pair.
- **The sentence of the reader about a malformed file**, which WP2 left to this package, is part of the issue in
  the workspace database. That database is on the machine of the user and holds the file itself. The public
  log of the live-org workflow keeps its own rule.
- **For WP5.** The resolver of formulas uses `walkPath`, the model and `GLOBAL_OBJECTS` as they are, and the
  same two steps: read the names with their places, resolve them when every file was read. `walkPath` says for
  each name which object it was looked for on, so an unresolved field at the end of a path can say where it
  was expected. `readField` already marks a field that has a formula. Still missing in the model: the
  namespace of a package project, a way for `Owner:User` to say which object a relationship leads to, and the
  relationship of a person-account field (`__pr`).
- **For WP6.** The components come from `resolveComponents` on the stored files of a snapshot, then
  `analyseSource`, then `writeAnalysis`. The coverage per type has to count the parts and the objects the
  analysis adds to the list. The eleven issue codes of record 0041 go into `docs/cli.md` with the command that
  shows them, and WP6 decides which of them make a snapshot incomplete. The analysis catches its own faults
  component by component, and WP6 should still not assume that it cannot throw. In the file of an object as an
  org hands it out, a line added near the top gives every field and rule below it with a reference a new
  version, because places are part of a version. WP6 decides whether the places of a part are counted from the
  start of the part.
- **Not done or not verified.** Formulas. What a record type, a list view, a field set, a compact layout, a web
  link, an index and an action override name. The name field and the search layouts of an object. The field an
  indirect lookup matches on. Whether a standard field named on a custom object exists. Whether the files an
  org hands out for standard fields name the object a lookup points at: if not, a standard relationship of an
  org snapshot is resolved by its name and the table, as in a repository. Nothing was run against a real org,
  and memory on a large org was not measured. The reference vocabulary still names the origin `symboltable`,
  which this plan wanted removed with WP3 (record 0040 notes it).

### WP5 Formulas

Build, in `extraction`:

- A tokenizer and a parser for the formula language: names with dots, `$` names, numbers, text in single and
  double quotes, comments, the operators, calls. A call is any name before a bracket, so a function that
  Salesforce adds next year does not break it. The tree keeps the place of every name.
- A resolver that walks a path of names from the object of the formula through the model of WP4, one reference
  per step: `Account__r.Owner.Email` reads the lookup field, the owner field and the email field.
- The `$` names: `$Setup`, `$Label`, `$Permission`, `$CustomMetadata`, `$ObjectType`, `$User`, `$Profile`,
  `$UserRole`, `$Organization`, `$RecordType`, `$Source`, `$Api` and `$System`. Each gives a reference to what it
  names, or none where it names nothing that can change.
- `Owner:User.Email` and its kind, and `VLOOKUP`, whose arguments name fields of another object.
- The value a picklist is compared with (`ISPICKVAL(Status__c, "Paid")`) is kept on the reference. Nothing uses
  it in this phase. A later rule about renaming a picklist value needs it, and it costs one attribute now.
- Where formulas are read from in this phase: the formula of a field, the default value of a field, the
  condition of a validation rule.
- **A formula that does not parse is not dropped.** It gives an issue, and the names in it are found by their
  tokens and recorded as `probable`.
- The score against the answer key, with the harness of the trial as the model.

Accepted when:

- The pass marks of Q5 on the key.
- Every probe of WP1 is read without a problem.
- Every formula of the public codebases is read without a problem, or the report says which and why.
- The tests of the parser run on the three systems.

Status on 16 November 2026, with the pull request that holds the reader of formulas. Built:
`extraction/formula.ts` (`parseFormula`, `namesOfTree`, `namesOfTokens`), `extraction/formula-names.ts`
(`usesOfName`), the formulas in `extraction/objects.ts` and `extraction/analyse.ts`, hints for `walkPath` in
`extraction/model.ts`, their tests and decision record [0042](../adr/0042-the-names-in-a-formula.md). No command
runs the analysis yet: WP6 writes it into a snapshot.

- **Pass mark 1 of Q5 is met.** The analysis finds the 106 references that the key holds for fields and
  validation rules: the 26 written in XML and 80 in formulas, each at the line and the column the key says,
  and no other. The four that the key marks as a stretch are found too. None of the places where the key
  forbids a reference is hit, and no issue is raised.
- **Pass mark 2 is met.** Every formula of the three public codebases is read as a whole. A simple scan that is
  no parser finds the same names in each formula. A test pins the numbers and is skipped where the codebases
  are not downloaded, which CI does not do.

  | Codebase      | Formulas and default values | Of them formulas of fields and conditions | References from formulas | Paths not followed |
  | ------------- | --------------------------- | ----------------------------------------- | ------------------------ | ------------------ |
  | apex-recipes  | 1                           | 0                                         | 0                        | 0                  |
  | nebula-logger | 142                         | 65                                        | 387                      | 0                  |
  | npsp          | 168                         | 16                                        | 58                       | 4                  |

  Of the references, 372 and 38 are `resolved` and 15 and 20 `external`. None is `unresolved`. The largest
  codebase is analysed in 0.3 to 0.9 seconds on one Linux machine, as before.

- **Pass mark 3 is not measured yet.** That no pair of the Dependency API is missing on the test org is
  measured in WP8. What can be said now is read from the record of the run of 15 November 2026
  ([real-org.md](../research/phase-1/real-org.md)), not measured again: the rows of the API from a field or a
  rule of the fixture are pairs of the key, which the analysis finds, and two rows from a validation rule to
  an object, which it does not. Those two are the question this plan keeps for WP8.
- **The 178 probes are read without a problem**, each with the names it lists. Five names are not read as a
  name, all in probes for functions of buttons, pages and reports. The ten formulas that cannot be deployed
  give what their file of expectations says: five warnings, `probable` references, and names that are
  `unresolved` or `external`.
- **The tests of the reader need no file of the machine**, so they run on the three systems with the others.
  This is confirmed by CI on the pull request, not before.
- **The count for WP10 is 0, 0 and 4.** The four are one formula of NPSP, on the opportunity. It goes four times
  through a lookup of another package (`npe03__Recurring_Donation__r`), and no file of the codebase says where
  that lookup leads. The four fields behind it have no reference. An org snapshot would hold the file of that
  lookup and follow it.
- **The public formulas say little about the harder parts.** None has a comment or an `Owner:User`, and seven
  names stand behind a global variable (`$User` once, `$Setup` twice, `$Label` four times). Comments, the
  colon and the other variables are covered by the fixture project, which Salesforce accepted in WP1, by the
  probes, which it never saw, and by tests.
- **Sixteen choices are mine**, and record 0042 lists them for you to strike. The ones with the most weight:
  - A formula that is not read as a whole gives a warning, not an error, and its names are `probable`. In such
    a formula the name of a function that stands without its bracket is taken for a field.
  - The field `Id` at the end of a path gives no reference, as the key rules say. This now holds for a path in
    XML too, which changes one point of record 0041: `$User.Id` in a lookup filter gave a reference and gives
    none now.
  - A default value is a formula, as this plan says. So the count of components with a formula includes every
    checkbox with the default `false`.
  - The value a picklist is compared with is kept for `ISPICKVAL` and `INCLUDES`, also through `PRIORVALUE`.
    The values of a `CASE` and of `TEXT(Status__c) = "Paid"` are not kept.
  - `$ObjectType.Tax_Code__c` without a field is a reference to the object. `$RecordType` is taken as the
    object `RecordType`. A variable the reader does not know gives a warning and no reference.
  - The order of the operators is mine and is not verified. No reference depends on it.
  - A text may run over lines and a no-break space is white space, which is wider than the grammar of the
    formula engine.
- **Two points WP4 left for this package are done, one is not.** `Owner:User` says where a relationship leads,
  and `Level__pr` on an account is followed to the contact. The namespace of a package project is still not
  known to the analysis.
- **The check of my work.** 58 faults were planted in the new code, one at a time. The tests noticed 56 at
  once and the other two after two expectations were added. A 59th showed a line that did nothing, which was
  removed.
- **The review of the pull request found no wrong reference and twelve points, all taken up or answered.** Two
  cost a component its analysis and are corrected: a name `constructor` behind `Owner:Queue`, and a formula
  with more than about 125,000 names. Neither can come from an org. The problem that an issue tells is now the
  one that stands first in the text. `$User.UITheme` and `$User.UIThemeDisplayed`, which validation rules use,
  gave a reference to a field the user does not have and give none now. A custom metadata type written
  without `__mdt` was guessed at and is not read now. An issue about a path has a bounded length. The comment
  on the count of files that failed says what it means for formulas.
- **For WP8.** Whether the formula language has more names of its own for a queue than `QueueName` is not
  verified. `Owner:Queue.Email` is taken as the field `Email` of `Group`. The test org can say.
- **For Phase 2.** The loop that turns the names of a formula into references with places is inside
  `extraction/objects.ts`. The formulas of flows and workflow rules need it, so it moves out then.
- **For WP6.** One more issue code, `FORMULA_NOT_READ`, goes into `docs/cli.md` with the eleven of record 0041,
  and WP6 decides whether it makes a snapshot incomplete. The work of the origin `parser:formula` says how
  many components hold a formula and how many files hold one that was not read as a whole. "Names not
  resolved" and "paths not followed" have no column: they are the references with the resolution `unresolved`
  and the issues `PATH_NOT_FOLLOWED`.
- **Not done or not verified.** Named arguments in square brackets. Formulas outside fields and validation
  rules. The order of the operators, a text over lines, and whether Salesforce accepts each probe. Nothing was
  deployed in this package, and nothing was run against a real org.

### WP6 Analysis in the snapshot, and coverage

Build:

- `orglens snapshot` analyses after the files are stored, also for a snapshot of an org that was continued. A
  failure of the analysis of one file costs that file and is an issue. It never loses the snapshot.
- `orglens analyse <source>` analyses a stored snapshot again (your answer to Q7), with the decision record that
  extends 0016.
- `coverage`: the column `ANALYSED` gets its numbers. Below the table, per origin: references found, names not
  resolved, paths not followed, formulas that did not parse.
- `status` says for each source whether its latest snapshot is analysed, and by which version.
- The public API of the engine for all of it, the JSON Schema, `docs/cli.md`.
- New issue codes, each with a test.

Accepted when:

- A snapshot of the fixture folder and one of the mock org give the same components and the same references,
  compared by key, kind and target. Lines are compared within each snapshot only (finding 3).
- A snapshot taken by the Phase 0 engine is analysed by `analyse` and then equals a new one.
- Analysis of the fixture adds no more than a second to `snapshot`.

Status on 16 November 2026, with the pull request that analyses a snapshot. Built: `api/analysis.ts`
(`analyseStored`, `analysisReport`), the analysis in `api/snapshot.ts` and `api/org-snapshot.ts`,
`Workspace.analyse`, `snapshotTree` in `store/snapshots.ts`, the number of analysed components per type in
`store/analysis.ts`, the command `orglens analyse`, the new parts of `coverage` and `status`, the JSON Schema,
`docs/cli.md`, their tests and decision record [0043](../adr/0043-a-snapshot-is-analysed-from-its-files.md).

- **The three pass marks are met.**
  - A snapshot of the fixture folder and one of the mock org give the same 89 keys and the same 106
    references, compared by the component they start from, kind, target, the name as written, origin,
    confidence and attributes. Lines are compared within each snapshot. The resolution is not compared, and
    differs in one place: the org hands out a file for `Account` and `User`, so a lookup to one of them is
    `resolved` there and `external` in the folder.
  - A snapshot in a database of schema version 2 is analysed by `analyse` to what a new snapshot gives. The
    test writes the snapshot into that database with the statements of Phase 0. Once, by
    hand, the last commit of Phase 0 took a snapshot of the fixture project and of nebula-logger, and `analyse`
    gave the same rows as a new snapshot for both. That run is not a test.
  - The analysis of the fixture takes 20 to 29 ms on one Linux machine, over five runs, in a process that has
    loaded its libraries. A snapshot of the fixture with its analysis takes 46 to 68 ms.
- **The times on the three public codebases**, the same way: the analysis takes 51 to 74 ms for apex-recipes
  (506 files), 174 to 196 ms for nebula-logger (1,579 files) and 1.4 to 1.5 seconds for NPSP (12,056 files).
  The snapshot with it takes 0.15 to 0.19, 0.47 to 0.59 and 3.4 to 3.9 seconds. No issue of the analysis is
  an error in any of them. An org of the size of your targets was not measured: that is WP10.
- **What "incomplete" means is a choice of mine**, and record 0043 lists it with thirteen others for you to
  strike. The ones with the most weight:
  - `complete` and `partial` of a snapshot say what was read. The analysis has `complete` of its own, which is
    false when a file of the snapshot could not be read as XML, a component could not be analysed, or a file
    belongs to no component. `snapshot` and `analyse` end with `5` for either.
  - A warning does not make an analysis incomplete: a name that was not read, a path that was not followed,
    a formula that was not read as a whole. They are counted and shown.
  - If the analysis fails as a whole, the snapshot stays and the command fails with an error that says so and
    names `orglens analyse`. So `snapshot` can end with an error although a snapshot is stored.
  - `ANALYSED` counts the components the analysis read something of. It can be larger than `RETRIEVED`,
    because the fields and rules inside the file of an object are counted.
  - The place of a part stays its place in the file, which answers the question WP4 left.
  - A snapshot of a Git source keeps the layout of files that its own project file asks for, and is analysed
    with it from whatever folder. This closes the open point of Phase 0 about the project a Git source is read
    with. The code review found why it matters: `analyse` run from a folder whose project laid out custom labels
    otherwise lost a label and called the analysis complete. The database is at schema version 4 for it.
- **Part G of the Phase 0 test plan had not been run when this was built.** This plan asks for it before WP6.
  The maintainer was told on 16 November 2026 that WP6 starts without it, and that a defect it shows is
  corrected in a pull request of its own. `orglens snapshot` has still not run against Salesforce.
- **For WP7.** `analysisReport` and `CoverageReport.analysis` say whether a snapshot is analysed, by which
  version, and whether the analysis is complete. `impact` on a snapshot with `analysis: null` is to end with an
  error that names `orglens analyse`. The exit code `5` of `impact` for "a file of an analysed type could not
  be read" is `analysis.complete === false`.
- **For WP8.** `analyse` reads no source, so the rows of the Dependency API cannot come from it. They belong to
  `snapshot`, or to a step of their own.
- **For WP9.** The coverage per type has `analysed`, and a type that only the analysis found has a line with
  a note. The rule that judges completeness over the logic tier has what it needs there.
- **Not done or not verified.** No option analyses every snapshot at once. Nothing says that a snapshot was
  analysed by an older version than the one that runs: `status` names the version, and the user compares.
  No snapshot of a real org was analysed.

### WP7 Impact

Build:

- The engine, in `engines`: from a component, walk the references that point at it, then those that point at
  what was found, to a depth that can be set. Each result carries the shortest path that explains it, and the
  weakest confidence on that path.
- For an object, the walk starts from the object and everything it contains.
- **What the answer does not cover**: the types of the snapshot that are not analysed and can refer to the
  target, with their counts, and whether the snapshot is partial for an analysed type. `complete` is `true` only
  when both lists are empty. In this phase it is `false` for every org that has Apex or flows, and the text
  output says so in its first lines, not its last.
- The command `orglens impact <component> [--source <name>] [--snapshot <n>] [--depth <n>] [--min-confidence <tier>] [--outgoing]`.
  Text output grouped by depth, with file and line. JSON output with its schema.
- Exit codes: `0` when the answer is there. `5` when the snapshot is partial for an analysed type or a file of an
  analysed type could not be read, because the answer may then miss something it claims to cover. A type that is
  not analysed yet is named in the answer and does not change the exit code. `2` for a component that is not
  found or a name that fits several.
- A decision record for the shape of the answer and these rules.

Accepted when:

- Golden files for the fixture: `Invoice__c.Amount__c`, `Account.Tier__c`, a standard field, an object, a field
  that nothing refers to, a field that is reached only through another formula.
- The answer for every field of the fixture equals what the answer key implies, computed by a test from the key
  alone.
- On the two synthetic orgs of WP3 in the real store: the time of an impact query from an ordinary field and
  from a hub field, cold and warm, to a depth of five levels and without a limit. The target is 5 seconds at the
  size of your targets (record 0037). I hold the four cases at that size against it, which is a reading of mine:
  you named no case. A case that misses it is a mark missed, and the phase reports it.
- `orglens impact` on a snapshot that was never analysed ends with an error that says how to analyse it.

Status on 16 November 2026, with the pull request that holds the impact engine. Built: `engines/impact.ts`
(`walkImpact`, `findComponent`, `impactGaps`), `api/impact.ts` (`impactOf`), `Workspace.impact`, five members of
`SnapshotGraph` for a walk, `countIssues` in `store/snapshots.ts`, the fifth migration of the database (the
types an analysis reads), the command `orglens impact`, the JSON Schema, `docs/cli.md`, the impact questions in
`bench/store.mjs`, their tests and decision record [0044](../adr/0044-an-impact-answer.md).

- **The four pass marks.**
  - The six golden files are there, for `Invoice__c.Amount__c`, `Account.Tier__c`, `User.Department`,
    `Invoice__c`, `Invoice__c.Unused_Field__c` and `Invoice_Line__c.Quantity__c`, as JSON from the engine and
    as text from the command.
  - A test works out from the answer key alone what refers to each of 96 components of the fixture, at which
    depth and with which confidence, and the answers are equal: 141 results. Every reference of every chain
    is one the key holds, at the place the key gives it. The 96 are the fields, objects and rules the key
    names. Not compared: which of two equally good chains is shown, which the key does not say.
  - The times are below. The target of 5 seconds is met in the cases that were measured, at the size the plan
    reads as that of your targets.
  - A snapshot without an analysis ends with `SNAPSHOT_NOT_ANALYSED` and the hint `orglens analyse`. That is
    tested through the engine and not through the command line, because `snapshot` always analyses.
- **The times**, on one Linux machine, with the file in the cache of the system, in a database that was just
  opened, three runs with the default driver. They hold the walk and the making of the answer. Starting
  Node.js, loading the engine and printing are not in them.

  | Question                         | Results                                             | Size of Phase 0, first call | Twice that size, first call |
  | -------------------------------- | --------------------------------------------------- | --------------------------- | --------------------------- |
  | An ordinary field, five levels   | 57 and 76                                           | 8 to 12 ms                  | 8 to 9 ms                   |
  | An ordinary field, no limit      | 52,340 and 104,760, up to 19 and 21 references away | 0.91 to 1.10 s              | 2.16 to 2.34 s              |
  | The most used field, five levels | 57,951 and 115,708                                  | 1.00 to 1.08 s              | 2.37 to 2.54 s              |
  | The most used field, no limit    | 58,189 and 116,100                                  | 1.01 to 1.06 s              | 2.29 to 2.76 s              |

  A second call in the same process takes about as long for the large answers, and 2 to 3 milliseconds for
  the small one: the time goes into reading and building the answer, not into opening the database. The one
  question at a time of WP3 took 4.0 to 4.2 and 7.6 to 10.3 seconds in the same runs.

  With `better-sqlite3`, one run each: 0.9 to 1.0 seconds and 2.2 to 2.7 seconds for the large answers. Nothing was
  measured with a cold file cache, on Windows or macOS, or on a real org. The answers from the synthetic orgs are far
  larger than a person reads: the generator ties the org together, and a third of all components is reached from
  an ordinary field.

- **One departure from this plan**, for you to strike: a result holds the one reference it is found by, and not its
  whole path. The other end of that reference is a result of the depth before, which holds the next one, so the whole
  chain can be followed. With every path written out, the answer from an ordinary field of the larger org was 443 MB
  of JSON (104,760 results, 1,361,153 references on their paths), which took 1.9 seconds to turn into text and is
  close to the longest text Node.js can hold. With one reference per result it is 56 MB, and the answer with its JSON
  text takes 2.5 to 2.7 seconds. If you want the paths written out, I change it back, and the answer then needs a
  limit.
- **Other choices of mine**, which record 0044 lists for you to strike. The ones with the most weight:
  - A shorter chain wins over a more certain one. `--min-confidence` finds the other.
  - A component that is found is followed from itself only, not from what it contains or what contains it.
  - Without `--depth` the answer goes as far as references lead.
  - Every type that is not analysed makes an answer not complete, whatever the component is. The plan says
    "the types that can refer to the target", and nothing says yet which type can refer to which.
  - `complete` and the exit code are two things. `complete` is false for what refers to a component in every
    real project in this phase, and the exit code stays `0`, as this plan says. The exit code `5` follows
    `mayMiss`: an analysed type is partial, a file or folder was not read, or the analysis had an error.
  - A warning of the analysis anywhere in the snapshot makes an answer not complete, and leaves the exit code
    as it is. So does, for `--outgoing`, a component of the answer that the snapshot does not hold. This plan
    names neither. Real projects have warnings, so `complete` will seldom be true for them.
  - The types an analysis reads are stored with it, and the database moves to schema version 5. Without that
    list, an analysed type of which the snapshot holds nothing looked like a type that is not analysed yet.
  - The text output is one table sorted by depth, with the depth in the first column. This plan says "grouped
    by depth". It has no heading per depth.
  - `--source` can be left out when the workspace declares exactly one source.
  - A name alone that fits components of several types is an error that lists them.
- **For WP8.** An answer shows the origin of every reference in `reference.origin`, and the walk follows every
  origin alike. When the rows of the Dependency API are stored with the origin `dependency-api`, `impact`
  will follow them like its own unless the walk is told not to: WP8 has to decide that, with this plan's
  sentence that they are "never mixed into the answer as if OrgLens had found them". Such a row has no place,
  and the walk and the text output already handle a reference without one. Between two references of the same
  two components the walk shows the more certain one, and of two equally certain ones the one with a place, so
  a row of the Dependency API does not hide the place OrgLens found.
- **For WP9.** `impactGaps` reads the counts per type and treats every type alike. The rule that judges
  completeness over the logic tier can narrow `notAnalysed` there. An error of the reading other than
  `NOT_RETRIEVED` and `LISTING_FAILED` with a type (`RETRIEVE_FAILED`, `RESOLVE_FAILED`, a folder that is
  missing) makes `mayMiss` true whatever it was about. The warnings count for the whole snapshot: WP9 can
  narrow them to what an answer rests on.
- **The code review** found no wrong answer in the walk, which it also compared with a second walk of its own
  on 150 random graphs with both drivers. It found three places where an answer said more than was known: an
  analysed type that the snapshot does not hold at all was listed as "not analysed yet" and left the exit code
  at `0`, an answer with `--outgoing` could call itself complete for a component the snapshot does not hold or
  an object with parts of a type that is not analysed, and an answer could call itself complete while the
  analysis had warnings. All three are changed, with the choices listed above.
- **For WP10.** The times above are from synthetic orgs. WP10 measures on the public codebases and reports
  the time of the whole command, with the start of Node.js and the printing.
- **Not done or not verified.** No option limits the number of results. An answer shows one reference per
  result, and the other places where the same component names the same target are not listed. Nothing says
  what breaks, only what refers. The command was not run on a snapshot of a real org. The size of ten times
  the org of Phase 0 was not run. A component the snapshot does not hold, of a type that is neither in the
  snapshot nor known to OrgLens by name, is found only when it is named with its type. A key of a part of a
  component, written with `#`, is found only in its exact spelling: no such component exists yet. The
  times above were measured before the changes of the code review, which change no statement of the walk. The
  series was not run again. One run at twice the size after the changes, and one of the code before them in
  the same hour, gave 2.8 to 2.9 and 2.3 to 3.1 seconds for the first call of the large answers: no difference
  that one run each can show, and both slower than the series, on a machine that was busier.

### WP8 Cross-check with the Dependency API

Build:

- In `sources`: the reading of `MetadataComponentDependency` through the Tooling API, per type and per pair of
  types where a query reaches 2,000 rows, with the names behind the ids. The test tool of Phase 0 does this
  today. It moves into the engine, and the test tool uses the engine.
- The rows are stored with the snapshot, with the origin `dependency-api`. They are never mixed into the answer
  of `impact` as if OrgLens had found them: an answer shows the origin of every reference.
- The comparison, for the types this phase analyses. A pair that Salesforce has and OrgLens has not is a missed
  reference and an issue of the severity `error`. A pair that OrgLens has and Salesforce has not is counted only
  where Salesforce could have seen it (record 0034).
- `coverage` shows the comparison in numbers and lists the missed pairs.
- The stage is optional and never fails a snapshot. A source of the kind `git` has none.
- The step of the live-org workflow that compares on the test org, with the rule for the public log unchanged.

Accepted when:

- Against the mock org: the comparison finds a pair that is taken out of OrgLens's result on purpose.
- On the test org: no pair of the fixture is missed for a formula field or a validation rule, and the report
  says how many pairs Salesforce reports that this phase cannot have yet, which are those of Apex.
- Only metadata is read. A test pins the objects that are queried.

Three things the probe of 15 November 2026 showed are for this work package
([real-org.md](../research/phase-1/real-org.md), sections 4 and 6):

- **A question for you, before I build it.** The Dependency API reports two pairs from a validation rule to an
  object that the key leaves out on purpose: the object in `$ObjectType` inside `VLOOKUP`, and the custom
  metadata type behind `$CustomMetadata`. The key has the reference to the field or the record. As the second
  point above is written, OrgLens would miss these two. Either OrgLens records a reference to the object there
  as well, or the comparison counts a row to an object as covered when OrgLens has a reference from the same
  component to a field or a record of that object. I will put both to you with what each costs when this work
  package starts.
- A third row goes from the record `Billing_Rule.Default` to its custom metadata type. It is not from a formula,
  so the second point above does not cover it, and the key has no entry from a record. Whether OrgLens records
  it is a separate question, which I will put to you with the first.
- "Where Salesforce could have seen it" follows the list of record 0034: standard fields, names in text,
  lookups, roll-up summaries and inactive rules. The probe adds lookup filters, the value set and the controlling
  field of a picklist. Built from the shorter list, the comparison would count five pairs of the fixture
  against OrgLens that Salesforce never reports. The comparison is built on the longer list, and a record that
  follows 0034 says so.
- The row of a custom object in the Tooling API holds its name without the ending, and the type of a row about
  a record of a custom metadata type is the name of that type. The test tool got both wrong at first. The
  engine has to name a custom object from a source that has the ending.

Status on 16 November 2026, with the pull request that holds the cross-check. Built: `sources/dependency-api.ts`
(`readDependencies`) and `sources/org-http.ts`, the sixth migration of the database (the rows of a snapshot and
the comparison of an analysis), `store/dependencies.ts`, `engines/cross-check.ts`, the comparison in
`api/analysis.ts`, the step of `api/org-snapshot.ts` that asks the API, `CoverageReport.crossCheck`, the option
`--no-cross-check` of `orglens snapshot`, the cross-check in the text of `coverage`, the JSON Schema,
`docs/cli.md`, the two tools of the live-org workflow, their tests and decision record
[0045](../adr/0045-the-cross-check-of-a-snapshot.md).

- **The three pass marks.**
  - Against the mock org, the comparison finds a pair that is taken out on purpose. A test changes the rule
    `Tax_Rate_Matches_Code` of the fixture project so that its formula no longer names `Tax_Code_Name__c`. The
    snapshot then has the error `REFERENCE_MISSED` with both keys, its analysis is incomplete, and an impact
    answer for the field says that it may miss something. Without the change, the mock org reports 141 rows.
    84 are from Apex and from the record of the custom metadata type and are not compared. The other 57 are
    57 pairs: the analysis has 55, has 2 as a reference to a part of the object, and missed none. The mock org
    answers from the answer key. It is not Salesforce.
  - **On the test org: met**, by the run of 17 November 2026 after the merge
    ([real-org.md](../research/phase-1/real-org.md), section 7). Salesforce reports 257 rows. 201 are from
    types this phase does not analyse, 94 of them from Apex. The other 56 are 56 pairs from a custom field or
    a validation rule: the analysis has 54, has 2 as a reference to a part of the object, and missed none.
    Every end of those rows was matched to a component the org listed, and no pair the analysis has is
    without a row where the API reports the kind.
  - Only metadata is read. The engine queries one object, `MetadataComponentDependency`. A test of the reader
    and a test of the snapshot hold every query the mock org received against it.
- **Three departures from this plan**, for you to strike. Record 0045 has the reasons.
  - The rows are not stored "with the origin `dependency-api`". They are stored beside the snapshot, as
    Salesforce wrote them, and are no references. `impact` cannot show one, because the graph does not read
    them. As references they would have changed the digest of a component whose files did not change, or been
    shared with a snapshot of a repository.
  - The engine does not read "the names behind the ids". It finds the component of a row by the id the org
    listed it with, which the snapshot already holds. So one object is queried, and not the four more that
    the test tool reads for the names. The test tool still reads them, and the two ways can be held against
    each other on the test org.
  - A query at the limit is asked again on a third level, per group of components that refer, with the ids of
    the listing. This plan names two levels.
- **The two questions of this work package** were put to you on 16 November 2026, and you answered both on
  the same day with the first answer, which is what was built. A row from a rule to an object counts as
  covered when the analysis has a reference from the same rule to a field or a record of that object
  (`coveredByPart`). A record of a custom metadata type refers to its type from the phase that analyses
  records: until then its row is counted with the rows of types this phase does not analyse. Record 0045 holds
  both as your decisions.
- **The review of the pull request** found no fault of the highest weight, four of middle weight and nine
  small ones. All four of middle weight are corrected.
  - The reading could call itself whole where it was not. After a query at the limit was asked again per
    component, a row of a component the org did not list was left out without a trace. Now the rows the query
    gave before have to come again, one more query asks for the rows of every other component where it can
    name all ids, and where it cannot the reading is `partial` and says that rows may be missing
    (`queriesNotProven`).
  - A name could match a row to the wrong component. Now a name is taken only where there is no id: for a
    standard object, and for a component the org listed without one. A custom object is never taken by name.
  - One query that ran out of time ended the reading, and a type whose query was refused was not asked for in
    parts. Now such a type is asked for in parts, and the reading stops only after three in a row.
  - Nothing bounded the requests, and nothing was said while they ran. Now the reading stops after 2,000
    requests, and `snapshot` writes a line about the rows so far at most every five seconds. The number 2,000
    is mine and rests on no measurement.
  - Of the small ones: the sentence about a pair only OrgLens has now says that its row can be among the
    missing ones, a snapshot that is continued replaces the warning of its earlier reading, the next page of
    an answer is followed only to the same query, a comparison stored by another version is shown only with
    the fields this version knows, and the step on the test org reads one query again just before the parts,
    so that a change of the org between two readings is less likely to fail it.
  - Not taken up: a run of the command line against the mock org that ends with `REFERENCE_MISSED` and the
    exit code `5`. The mock org of the command line tests holds two classes and nothing that is compared. The
    engine test shows that the error makes the analysis incomplete, and the tests of the command line show
    that an incomplete analysis ends with `5`.
- **Other choices of mine**, which record 0045 lists for you to strike. The ones with the most weight:
  - The API is asked by default, and `--no-cross-check` leaves it unasked. This plan says "optional".
  - The comparison is kept with the analysis, and `orglens analyse` compares again from the stored rows,
    without the org.
  - A missed pair makes the analysis incomplete like every error of it: exit code `5`, and `mayMiss` for every
    impact answer from that snapshot, not only for the two components.
  - A pair that only OrgLens has is listed and is no issue.
  - With rows missing, the comparison is still made, and the report says that rows are missing.
  - The list of what the API does not report is longer than that of record 0034, as this plan says. Three
    entries of it rest on no measurement: a standard object as the target of anything but a lookup, the
    display field of a lookup, and a custom name in a default value.
  - The text of `coverage` lists the first 20 missed pairs, and `--json` all of them.
- **Not done, against record 0034.** A row for a pair OrgLens found raises no confidence: nothing of a
  reference is changed by a row. The output does not say for each reference whether the API reports its kind:
  it counts pairs per reason.
- **For WP9.** The cross-check adds two warnings of the reading, `CROSS_CHECK_NOT_READ` and
  `CROSS_CHECK_PARTIAL`. Neither makes a snapshot partial, and the rule for "complete" has to leave it so. A
  row that names a component the org did not list is not compared: a type that is read without being listed
  has no ids.
- **For WP10.** How many requests the cross-check of a large org needs, and how long they take, was not
  measured. The public codebases have no org, so WP10 cannot measure it either. It needs an org of yours.
- **For Phase 2.** With every type that is analysed, its rows move from "not compared" to "compared" without a
  change to the comparison: the analysis says which types it read.
- **The reading in parts, after the three runs of 17 November 2026.** Read with every answer cut off at 30 rows, as an
  org above 2,000 rows has to be read, 6 queries failed on the test org and 9 of the 257 rows were lacking. Run 11
  showed which: the queries that name `StandardEntity`, the type of a standard object, as the type of the target, by
  name or in the list of the rest. Salesforce documents that it does not answer the first. The 9 rows are from an
  Apex class to a standard object. Every other query was answered, the ones with `IN` and `NOT IN` on the id of a
  component among them. The reader no longer names `StandardEntity`: the rows to standard objects are left to the
  rest, and a rest at the limit is asked for per group of components. Runs 10 and 11 did not show that the org
  answers a rest whose list does not hold `StandardEntity`, or that such a rest holds the rows to standard objects:
  no such query was asked. So the reader holds the rest against the rows it already has, and asks for the whole type
  per group of components where the org refuses the list. Run 12, from the commit with the corrected reader, gave 60
  requests, none failed, the same 257 rows as the one query, and a reading the engine calls whole. So the test org
  answers such a rest. That the rows to standard objects came with it is most likely and not shown: the step does
  not print which query gave a row. The two ways for an org that does not answer so were not needed there, and only
  tests cover them. The documentation also lists `IN` and `NOT IN` as not supported. The test org answered `NOT IN`
  on the two types, and both on the id of a component. The reader keeps them, which is a choice of the author
  (decision record 0045), and a query that an org refuses makes the reading `partial`. The record of the runs is
  section 7 of `docs/research/phase-1/real-org.md`.
- **Not done or not verified.** Verified on the test org on 17 November 2026: the ids of the listing are the ids of
  the rows for fields, rules and custom objects, and what the comparison shows. Verified there too: that the org
  accepts the conditions `IN` and `NOT IN` on `MetadataComponentId`, and that the corrected reader of the point
  above reads the org whole in parts. Not verified: an org above 2,000 rows, where the parts are asked for in
  earnest. An org with more than 200 components of a type of which a part is at the limit, a pair of types or the
  rest, gets a reading that is `partial`, and how often that is so was not measured. Which permission the user needs
  for the query was not looked up. The command `orglens snapshot` itself was not run against a real org, as before.
  The mock org reports the formula of a rule that is not active and of a default value, which Salesforce does not or
  may not.

### WP9 What a snapshot reads, and when it is complete (follows Q2)

Build, as record [0038](../adr/0038-a-snapshot-reads-every-type.md) says, which replaces record
[0036](../adr/0036-what-a-snapshot-of-an-org-reads.md).

What you decided with your approval:

- A snapshot of an org reads every type the org lists, reports included, as it does since Phase 0. No default
  list of types is built.
- A snapshot is complete when every listed component of the logic tier came back and could be read.

Readings of mine in record 0038, which you can strike:

- The logic tier is the list of record 0004 with custom labels, custom permissions and global value sets.
- What is missing in another type is a warning: it is named in the output and does not make the snapshot
  partial. This changes the output of `snapshot` and of `coverage`: the JSON Schema and `docs/cli.md` change with
  it.
- A file whose type cannot be told counts against the logic tier until it is explained.

The rest of the work package:

- A proposal of mine, which you can strike: a key in `orglens.toml` to leave out types that are not of the logic
  tier, because a large org can hold tens of thousands of reports. A type that was left out is named in
  `coverage` as not read. Documented in `docs/configuration.md`.
- The open points of Phase 0 that are in logic-tier types, looked at on the test org through the workflow:
  - seven bundles of an installed package that are listed with the prefix of the package. Five were handed out
    without it, and for two no such twin was found,
  - two fields and two record types whose parent the org does not list as an object,
  - two objects that Salesforce says it cannot find,
  - custom labels, listed and not handed out,
  - three files that came back and could not be read as metadata. In which types they are is not known, so
    they are looked at here.

Not built here: leaving out the components of managed packages. Your note to Q2 names that as the goal. How it
is done is put to you when Phase 2 is planned. Not built here either: an analyser for any type beyond objects,
fields and validation rules. The types of your list get theirs in the phases of the roadmap, and where email
templates, report types and reports go is put to you when Phase 2 is planned.

Accepted when:

- A snapshot of the test org is complete, judged over the logic tier. If it is not, that is a mark missed: the
  phase report gives the count of what keeps it partial, per type and with the reason, and we decide together.
  It gives no name of a component of the org, which the rule of the public log forbids (record 0033).
- What is missing outside the logic tier is in the output of `snapshot` and of `coverage` as a warning, per type
  and with a count, and the exit code stays that of a complete snapshot.
- If you keep the key: a type it leaves out is not retrieved and is named in `coverage` as not read. A type of
  the logic tier in the key is an error.
- A snapshot of a Git source is not changed by any of this.

Status on 17 November 2026, with the first pull request of the work package. It holds the judgement over the
logic tier. The key in `orglens.toml` and the look at the test org follow, each in a pull request of its own.

- **Built:** `core/tiers.ts` with the 21 names of the logic tier, the severity of the four issues that say
  something is missing (`LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED`, `RESOLVE_FAILED`) by the tier they
  count against, `details.tier` and `details.types` on them, the first line of the report of `snapshot`,
  `analyse` and `coverage`, the count of `readErrors` in an impact answer, `docs/cli.md`, the descriptions of
  the JSON Schema, and record [0046](../adr/0046-complete-over-the-logic-tier.md). No migration was needed.
- **Against the acceptance criteria:**
  - A snapshot of the test org is complete over the logic tier: **not shown yet.** Nothing of this pull request
    was run against a real org. Thirteen components of types of the tier and three files that cannot be read
    are expected to keep it partial until they are looked at. In Phase 0 the count was fourteen: the file of
    custom labels was the fourteenth, and it comes back since the fixture project gave the org a label.
  - What is missing outside the tier is a warning in `snapshot` and `coverage`, per type and with a count, and
    the exit code stays `0`: met against the mock org. The tests of the command line show the exit code and the
    lines of `snapshot`, `analyse` and `coverage` for a file that cannot be read. The tests of the engine show
    the status `complete` for a component that does not come back, a listing that is refused and a retrieve
    that fails. No test of the command line runs those three.
  - The key: not built in this pull request. You were asked on 17 November 2026 whether to keep it. The second
    status below has it.
  - A snapshot of a Git source is not changed: its code was not touched, and its tests pass as they were.
- **Choices of mine, for you to strike.** Record 0046 has the reasons.
  - The 21 names. Records 0004 and 0038 hold words, and `Workflow` and `CustomLabels` are in the list because
    the org lists the file and its parts as types of their own.
  - A type counts by its own name. A list view, a web link, a compact layout and the other parts of an object
    that the list does not name are outside the tier although the object is in it. The same holds for the
    actions in the file of workflow rules.
  - A retrieve that fails counts against the tier if one of its components is of the tier.
  - A file that cannot be read counts by the types that keep their files in its top folder, and against the
    tier where no type is known.
  - The warnings keep their codes, and say the tier in `details.tier`.
  - A complete snapshot that lacks something outside the tier says so in its first line: it "is complete for
    the logic tier", and after the numbers of the line: "Something of other types is missing, and the warnings
    below say what."
  - The file of custom labels is not missing when the org lists no label. The test org listed the file and
    handed out nothing until it had a label, so an org without a label would be partial for good. The rule
    rests on that one org in two states.
  - An impact answer counts a warning outside the tier in `readErrors` when it can be about a type the answer
    covers. **The rule has no effect today**: every analysed type is of the tier, so no warning the engine
    writes is counted, and only tests with rows written by hand show it. What does change today: `impact` ends
    with `0` where it ended with `5` for a snapshot in which a file or a retrieve outside the tier failed. The
    answer names the type in `notCovered.notAnalysed`.
- **Not done:** `notCovered.notAnalysed` of an impact answer is not narrowed, which record 0044 named as
  something this work package could do. The tier does not say which type can refer to which. The analysis is
  not judged by tier, and `FILES_NOT_METADATA` stays a warning in every tier. Record 0046 lists both, and three
  places of the code that no test reaches.

Status on 17 November 2026, with the pull request that looks at the test org. The key in `orglens.toml` is built
in a pull request of its own, whose status follows this one.

- **Run 13 of the test org**, the first with the judgement over the logic tier
  ([real-org.md](../research/phase-1/real-org.md#8-the-snapshot-judged-over-the-logic-tier)): **the snapshot is
  partial, so the first acceptance criterion is not met yet.** What keeps it partial, per type:
  - 7 of 7 `LightningComponentBundle`. They are bundles of an installed package, listed with its prefix. Seven
    bundles came back that the org had not listed.
  - 2 of 398 `CustomObject`. Not explained.
  - 2 of 79 `CustomField` and 2 of 2 `RecordType`. The object before the dot is not among the objects the org
    lists. Not explained further.
  - 3 files that cannot be read as metadata, in a folder the Salesforce library knows no type for. Most likely
    they are the three `ContentWorkspacePermission` the org lists, a type this version of the library does not
    know. That is a reading of the counts.
  - Custom labels, the fifth open point of Phase 0, come back since the org has a label.
- **What no longer makes it partial:** 209 components of 10 types outside the tier, and one listing the org
  refuses. They are warnings, per type and with a count, as the second acceptance criterion asks.
- **Built for it**, with record [0047](../adr/0047-what-the-org-says-where-the-library-falls-short.md):
  - A file in a folder the library knows no type for is counted by the type the org describes with that folder.
    If the reading above holds, the three files become warnings.
  - A component of a package that comes back under its name without the prefix of the package counts as the
    one the org listed, when the retrieve asked for the listed name and not for the short one, and Salesforce
    did not remark that it cannot find it. If the seven bundles are what they look like, they count as
    retrieved.
  - The step that reads the test org says more about the objects, fields and record types, without a name.
- **Choices of mine, for you to strike.** Record 0047 has the reasons: that the word of the org decides the tier
  of a file the library cannot place, that the rule for the prefix holds for every type that is retrieved by
  its own name although it was seen for one, that the rule leaves a component missing rather than count one for
  another, and that the name a component came back with is not kept in the database.
- **Not done, and not verified:** neither correction was run against the org when this was written. The two
  objects, two fields and two record types are not explained, so the snapshot of the test org is expected to
  stay partial for six components after the next run. That run is recorded here when it is made.

Status on 17 November 2026, after run 14 of the test org, with a fourth pull request of the work package.

- **Run 14**, the first with the two corrections of record 0047
  ([real-org.md](../research/phase-1/real-org.md#run-14-the-two-corrections-on-the-org)): **both hold on the
  org, and the snapshot is still partial, so the first acceptance criterion is not met.**
  - The seven bundles count as retrieved, and the three files are warnings.
  - Six components of the tier keep the snapshot partial, as expected: 2 of 79 `CustomField`, 2 of 2
    `RecordType` and 2 of 398 `CustomObject`.
  - The fields and record types belong to objects the org does not list. Salesforce remarked of these objects
    that it cannot find them. So the fields and record types were never asked for: the engine asks for the
    object they belong to.
  - The two objects are listed and do not come back. Salesforce does not remark that it cannot find them. They
    are not explained.
- **Built for it**, with record [0049](../adr/0049-a-part-by-its-own-name.md): when Salesforce remarks that it
  cannot find a component the org does not list, the parts of it that the org lists are asked for by their own
  names in one more retrieve. The step that reads the test org says how many missing components a remark of
  another form names.
- **Choices of mine, for you to strike.** Record 0049 has the reasons: that parts are asked for a second time
  at all, that this is not done for a parent the org lists, that it is done only for a parent with a file for
  every part, such as an object, and that the Salesforce library says which types are parts.
- **Not done, and not verified:** whether Salesforce hands out a part by its own name when it cannot find the
  parent is not known. The next run shows it and is recorded here. The two objects stay missing whatever that
  run says, so the snapshot of the test org is expected to stay partial for two components at least, and the
  first acceptance criterion to stay missed. The phase report gives the counts.

Status on 17 November 2026, with the pull request that holds the key. It was the second to be opened and the
last of the three to be merged.

- **What it rests on.** You were asked on 17 November 2026 whether to keep the key, with my recommendation to
  keep it, and chose "Keep the key" on the same day. I had built it as proposed while the question was open, and
  merged the pull request after your answer. Record [0048](../adr/0048-types-a-snapshot-leaves-out.md) is
  `Accepted`.
- **Built:** the key `exclude_types` of a source of the kind `org` or `sandbox` in `orglens.toml`, the listing
  `excluded` in the coverage of a snapshot with migration 7 of the database, the note `TYPES_EXCLUDED` and the
  warning `TYPE_NOT_EXCLUDED`, `left out` in the text of `coverage`, `excludeTypes` in the JSON output of
  `status` and the `source` commands, `docs/configuration.md`, `docs/cli.md`, the JSON Schema and record 0048.
- **Against the acceptance criterion** "a type it leaves out is not retrieved and is named in `coverage` as not
  read. A type of the logic tier in the key is an error": met against the mock org, which is asked neither for
  the components of such a type nor for its folders, and whose snapshot and `coverage` name the type as left
  out. A test against a stand-in for the Metadata API counts the requests. The file is refused for a type of
  the tier before anything is read. Not run against a real org, and how much time the key saves on an org with
  many reports is not measured. No test runs `impact` of the command line on such a snapshot, and no snapshot
  of a source of the kind `sandbox` is taken with the key.
- **Choices of mine, for you to strike.** Record 0048 has the reasons.
  - The name `exclude_types`, and that it is a key of the source and not of the workspace.
  - A type that is left out is not listed at all, so `coverage` shows no count for it.
  - The parts and the folders of a type go with it, and a part or a folder type cannot be named alone.
  - A name the org does not know, or one that cannot be left out, is a warning and the type is read. It is not
    an error of the file, because only the org says which types it has.
  - A value of its own for the listing, with a migration, so that an impact answer can name the type.
  - No option of the command line for the key. It is written by hand.
- **Not done:** leaving out the components of managed packages, single components, folders or name patterns. The
  cross-check with the Dependency API is not narrowed by the key, and can come out `partial` for a type that was
  left out and has more rows than one answer holds. Record 0048 says how.

### WP10 Proof on public codebases, and measurements

Build:

- PMM, the Program Management Module of Salesforce.org, is added to `fixtures/corpora.toml`, pinned by commit, for
  its 13 validation rules and its lookup filters. Its licence is BSD-3-Clause, as that of NPSP.
- **Every** formula field, default value formula, validation rule, lookup filter and roll-up summary of NPSP,
  Nebula Logger and PMM is checked by hand against what OrgLens reports: 89 formula fields and 20 rules, and the
  default values, filters and summaries beside them. I do that check, and the report says so.
- A note in `docs/research/phase-1/` with the numbers: references per kind, names not resolved, paths not
  followed, by codebase, and the time of analysis.

Accepted when:

- The note states the count of wrong and of missed references, with each one named, and what was done about it.
- The fourth pass mark of Q5 holds after the corrections: no wrong reference at the tier `confirmed`, and every
  missed one corrected or named with its cause.

### WP11 Phase close

- The overall plan updated, `docs/test-plans/phase-1.md`, a phase report, and the draft of the Phase 2 plan for
  your approval.
- The release of Q6: a pre-release on GitHub with the packed command line attached, installed with one
  `npm install` line. Nothing goes to npm.

## 6. How the results are proven

No single one of these is enough. Each covers a weakness of the others.

| Proof                                          | What it shows                                                                           | Its weakness                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The answer key of the fixture, v1              | Every hard case I could think of is handled, and no negative case is hit                | I wrote the fixture, the key and the analyser                                                                                         |
| The deploy of the fixture to the test org      | Every formula of the fixture is valid Salesforce                                        | Says nothing about what OrgLens finds                                                                                                 |
| The Dependency API on the test org             | For custom fields, whether Salesforce agrees pair by pair with the key and with OrgLens | Blind to standard fields, lookups, summaries, lookup filters, value sets, controlling fields and inactive rules. The fixture is small |
| Every formula and rule of the public codebases | Code I did not write, checked one by one                                                | About 110 items. Checked by me                                                                                                        |
| The Dependency API on an org of yours (Q1)     | Scale: hundreds of formulas and rules that neither of us wrote                          | Only you see the result. I get the numbers you choose to tell me                                                                      |
| Ten entries of the key read by you             | A second person                                                                         | Ten entries                                                                                                                           |

## 7. Pull requests and review

About twelve pull requests, each from its own branch, each with a code review by a separate agent, merged when CI
is green on the three systems and every finding is resolved.

| PR  | Content                                                                                                                                       | Work package |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1   | This plan with your answers, and records 0035 to 0037. A second pull request holds your approval, the change you made with it and record 0038 |              |
| 2   | Fixture v1, its key, the probes, the deploy and the run of the probe                                                                          | WP1          |
| 3   | The XML reader                                                                                                                                | WP2          |
| 4   | Migration 0003, the tables, the benchmark through the store                                                                                   | WP3          |
| 5   | Components, attributes and the references written in XML                                                                                      | WP4          |
| 6   | The formula parser and resolver, scored against the key                                                                                       | WP5          |
| 7   | Analysis in `snapshot`, `analyse`, `coverage`                                                                                                 | WP6          |
| 8   | The impact engine and `orglens impact`                                                                                                        | WP7          |
| 9   | The Dependency API in the engine and the comparison                                                                                           | WP8          |
| 10  | What a snapshot reads, and "complete"                                                                                                         | WP9          |
| 11  | The proof on public codebases and the note with the numbers                                                                                   | WP10         |
| 12  | Phase close                                                                                                                                   | WP11         |

PRs 3, 4 and 2 do not depend on each other. PR 5 needs 2, 3 and 4. PR 6 needs 5. PR 9 and PR 10 need 7.

## 8. Risks in this phase

| Risk                                                                                                                                                      | Handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The formula language has no published grammar, and has corners I do not know.                                                                             | The probes of WP1 cover every documented function. The deploy to the test org rejects what is not valid. A formula that does not parse is reported and its names are still found, as `probable`.                                                                                                                                                                                                                                                                                                                                   |
| The proof rests on one author (risk 12 of the overall plan).                                                                                              | Section 6. The key is merged before the analyser is written. Q1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Standard relationships cannot be followed without a description of the standard objects.                                                                  | A table and a rule, with every path that is not followed counted. The count on the public codebases and on your org decides whether more is needed, and that would be a question to you.                                                                                                                                                                                                                                                                                                                                           |
| The real store is slower or larger than the benchmark tables of Phase 0.                                                                                  | Measured in WP3, before anything is built on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| An answer of `impact` is read as complete when most of the org is not analysed yet.                                                                       | The answer says what it does not cover in its first lines, and `complete` is `false`. I would rather have a colleague annoyed by the warning than misled by its absence.                                                                                                                                                                                                                                                                                                                                                           |
| The Dependency API is in Beta and may change or be slow on a large org.                                                                                   | The stage is optional and has a time limit. What it did not cover is in `coverage`. Above 2,000 rows it was never run against Salesforce: your org in the test plan may be the first.                                                                                                                                                                                                                                                                                                                                              |
| Phase 1 grows. Flows and record types are close, and a real org will show ten things worth fixing.                                                        | The "not in Phase 1" list is the boundary. What a real org shows goes to the Phase 2 plan unless it breaks an outcome of this one.                                                                                                                                                                                                                                                                                                                                                                                                 |
| The target of 60 minutes for a first snapshot of an org of 100,000 components has no measurement behind it, however a component is counted (record 0037). | A snapshot reads every type, reports included (record 0038), so nothing shortens it. The one thing this phase builds that can is the key of WP9 that leaves types out, if you keep it. The test plan of this phase asks you for the time of the first snapshot of your org and the count `coverage` lists, if you are free to tell them. That would be the first real number. It is not written into the repository. If it is far off, retrieving chunks side by side is the next thing to look at, and that is a question to you. |
| `orglens snapshot` with a Salesforce CLI login never ran against Salesforce, nor did a login kept in the keychain of a system.                            | Part G of the Phase 0 test plan is that run. I ask you to do it before WP6 is built. A defect it shows is corrected first, in a pull request of its own.                                                                                                                                                                                                                                                                                                                                                                           |

## 9. Effort

The roadmap estimated Phase 1 at 4 to 6 weeks. This plan is 6 to 7. Two things account for the difference: the
cross-check of WP8, which the roadmap has in Phase 3, and WP9, which Phase 0 left open. Without both it is
about 5. With your answers to Q1 and Q2 both are in, and the total to the gate in the overall plan moves from 26
to 37 weeks to 28 to 38, less what Phase 3 saves because the Dependency API is then already read. I have not
estimated that saving. The second size of the benchmark is inside the days of WP3. The change of record 0038 was
not estimated again: WP9 stays at 3 days, as a guess.

| Work package                  | Rough effort      |
| ----------------------------- | ----------------- |
| WP1 Fixture v1 and its key    | 3 days            |
| WP2 XML with positions        | 2 days            |
| WP3 Components and references | 4 days            |
| WP4 Objects, fields and rules | 3 days            |
| WP5 Formulas                  | 5 days            |
| WP6 Analysis in the snapshot  | 2 days            |
| WP7 Impact                    | 4 days            |
| WP8 Cross-check               | 4 days            |
| WP9 What a snapshot reads     | 3 days            |
| WP10 Proof                    | 2 days            |
| WP11 Phase close              | 1.5 days          |
| **Total**                     | **about 33 days** |

These are developer-days as the overall plan counts them. Phase 0 was estimated at 23 to 25 and was built in two
calendar days. Elapsed time depends on how fast you can answer, review the key and run the test plan.

## 10. What you will be asked to do

1. Done: you answered Q1 to Q8 and approved this plan with one change on 15 November 2026. Still open: how the
   components of your performance targets are counted (record 0037). It is best answered before WP3. Without it
   WP3 measures at the second count, and the other count costs one more run.
2. Run part G of the Phase 0 test plan, if you have not yet, before WP6 is built.
3. Read ten entries of the new answer key against their files, when the pull request of WP1 is up, before the
   analyser is written. About 20 minutes.
4. Review the pull requests you want to look at. Merging is done by the assistant under the rule of Phase 0.
5. At the end, run the Phase 1 test plan. Its main step is `orglens snapshot` and `orglens impact` on an org you
   know, for fields whose uses you know, and with Q1 the comparison with what Salesforce reports. If that org is
   a client's, the client's permission comes first, and nothing of it goes into an issue or a chat. If you are
   free to tell them, I ask for two numbers of that run: how long the first snapshot took and how many
   components `coverage` lists. If the org is a client's, they stay with you unless the client agrees, and they
   are not written into the repository.
