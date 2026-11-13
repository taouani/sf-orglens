# Phase 1 plan: First slice

Status: **draft, not approved**. Nothing in this plan is built before the maintainer approves it.
Date: 2026-11-13
Parent document: [OrgLens re-architecture plan](re-architecture-plan.md)
Before it: [Phase 0 plan](phase-0.md), [Phase 0 report](../reports/phase-0.md)

This plan is written by the AI assistant that builds the project, addressed to the maintainer. "I" is the
assistant and "you" is the maintainer.

## 1. Outcome

At the end of Phase 1, OrgLens answers its first impact question on a real org:

1. `orglens snapshot` analyses what it stores. Objects, fields and validation rules become components. Formulas,
   lookups, roll-up summaries, lookup filters, default values and field dependencies become references, each with
   its kind, its confidence and the line it stands on.
2. `orglens impact <component>` says what refers to a field or an object, directly and through other fields and
   rules, with the path that explains each result. It has a `--json` output that is a contract.
3. Every answer says what it does not cover. In this phase that is a lot: Apex, flows and everything else that
   is not an object, a field or a validation rule. An answer never reads as "nothing else refers to this".
4. `orglens coverage` shows per metadata type how many components were analysed, and how many names could not be
   resolved.
5. The results are proven in the ways section 6 describes: the answer key of the fixture project, every formula
   and rule of the public codebases, the Dependency API on the test org, and a run of your own on an org you
   know.

Phase 1 does **not** read flows, Apex, permissions or any other type, does not compare snapshots, and does not
judge what a specific change breaks. It answers by reachability only (decision record 0013).

## 2. What Phase 0 and the preparation of this plan found

I looked at the code and at six public codebases before writing this. Five findings shape the plan.

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Consequence                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Public codebases hold few formulas and almost no validation rules.** I counted on 12 November 2026. NPSP: 13 formula fields and 3 rules in 765 fields. Nebula Logger, in the folder the manifest pins: 61 and 4. PMM: 15 and 13. EDA: 10 and 2. Outbound Funds: 1 and none. apex-recipes: none. Packages avoid them. Real orgs are where formulas and rules are, in hundreds. The counts of NPSP and Nebula Logger can be repeated on the pinned codebases. Those of PMM, EDA and Outbound Funds came from a script that is not in the repository, on clones that are not pinned, and cannot be repeated from it. | The public codebases cannot carry the proof for this phase the way they did for Apex. The 89 formulas and 20 rules of the three richest can be checked one by one, which I will do, but that is a small sample. The Dependency API on a real org becomes the main outside check. Question Q1. |
| 2   | **The Dependency API reports references from formulas to custom fields completely, as far as it was measured**: 24 of 24 on the test org, for formula fields and active validation rules. It reports nothing for standard fields, lookups, roll-up summaries and inactive rules ([real-org.md](../research/phase-0/real-org.md)).                                                                                                                                                                                                                                                                                   | For custom fields, Salesforce can say whether OrgLens missed a reference in a formula. For the rest, the answer key is the measure.                                                                                                                                                           |
| 3   | **An org rewrites the files of a project.** It adds elements with default values to almost every object and field, and writes a quote as `&apos;` where the repository has `'`. Lines and columns of the same formula differ between an org and a repository.                                                                                                                                                                                                                                                                                                                                                       | A reference is located in the file of its snapshot, not in "the" file. The reader of XML has to map a place in a decoded formula back to the place in the file.                                                                                                                               |
| 4   | **A repository holds a standard object only as far as it was customised.** No file of the fixture project says that the manager of a user is a user, so `Owner.Manager.Email` in a formula cannot be followed from the files alone, and the answer key marks that entry as "stretch". Whether the files an org hands out for standard fields say where a lookup points is not verified: no file of the test org was kept.                                                                                                                                                                                           | OrgLens needs a small table of the relationships every org has (`Owner`, `CreatedBy`, `RecordType` and so on) and a rule for the rest. What it cannot follow is recorded as not followed, never dropped.                                                                                      |
| 5   | **Both snapshots of the test org are "partial"**, and a snapshot reads every type the org lists, reports included. A snapshot is partial when a listed component did not come back, when the listing of a type failed, or when a file that came back cannot be read as metadata. The test org has all three. The overall plan says that reports are opt-in and that the logic tier comes first (decision F3). Nothing in the code does that yet.                                                                                                                                                                    | An impact answer inherits the state of its snapshot. Before impact is usable on a real org, "what is read" and "what is complete" need a rule. Question Q2.                                                                                                                                   |

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
| WP8 Cross-check (if Q1 is yes) | The Dependency API read by the engine and compared with its own references                            |
| WP9 What a snapshot reads (Q2) | The types that are read, what "complete" means, and the open points of Phase 0 in those types         |
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
- Layouts, list views, reports and the rest of the presentation tier.
- Asking an org to describe its objects through another API. Section 5, WP4, says what is done instead.
- The language model, the web UI, and any rider.

## 4. Decisions needed from you

Eight questions. Q1 and Q2 change what is built. The others can be answered with one word each.

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

Accepted when:

- Salesforce accepts the deploy, which shows that every formula of the fixture is valid.
- `fixture-key.test.ts` passes with the new key.
- The pull request with the fixture and the key is merged before the pull request of WP5 is opened.
- The run of the probe is recorded: which of the new pairs the Dependency API reports.
- You have read at least ten entries of the new key against their files (section 9).

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
- The benchmark of Phase 0, which used tables of its own, run again through the real store.

Accepted when:

- Every store test passes with both SQLite drivers, on the three systems.
- A second snapshot of an unchanged source adds membership rows and no version.
- A database of schema version 2 is migrated, and its snapshots are still there and count as not analysed.
- The benchmark is recorded: for the synthetic org of 147,000 components, the size after one and after ten
  snapshots and the time to write one, next to the numbers of Phase 0 (106 MB, 159 MB, 4 seconds). If the real
  store is more than twice as large or as slow, I report it before going on.

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

### WP6 Analysis in the snapshot, and coverage

Build:

- `orglens snapshot` analyses after the files are stored, also for a snapshot of an org that was continued. A
  failure of the analysis of one file costs that file and is an issue. It never loses the snapshot.
- `orglens analyse <source>` analyses a stored snapshot again, or what Q7 decides in its place.
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
- On the synthetic org of 147,000 components in the real store: the time of an impact query from an ordinary
  field and from a hub field, cold and warm, against the target of Q4.
- `orglens impact` on a snapshot that was never analysed ends with an error that says how to analyse it.

### WP8 Cross-check with the Dependency API (if Q1 is yes)

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

### WP9 What a snapshot reads, and when it is complete (follows Q2)

Build, for option (a):

- The list of logic-tier types of record 0004 as the default of a snapshot of an org, and keys in `orglens.toml`
  to add or remove types. Documented in `docs/configuration.md`.
- A snapshot is complete when every listed component of the types it reads came back. A type that was left out
  is named in `coverage` as not read.
- The open points of Phase 0 that are in logic-tier types, looked at on the test org through the workflow:
  - seven bundles of an installed package that are listed with the prefix of the package. Five were handed out
    without it, and for two no such twin was found,
  - two fields and two record types whose parent the org does not list as an object,
  - two objects that Salesforce says it cannot find,
  - custom labels, listed and not handed out, if they are added to the list (Q2),
  - three files that came back and could not be read as metadata. In which types they are is not known.
- A decision record for what is read and what "complete" means.

With option (b), the first point is dropped and the second changes. With option (c), this work package is only
the open points.

Accepted when:

- A snapshot of the test org is complete for the types it reads. If it is not, that is a mark missed: the phase
  report gives the count of what keeps it partial, per type and with the reason, and we decide together. It gives
  no name of a component of the org, which the rule of the public log forbids (record 0033).
- A snapshot of a Git source is not changed by any of this.

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
- The release of Q6.

## 6. How the results are proven

No single one of these is enough. Each covers a weakness of the others.

| Proof                                          | What it shows                                                                           | Its weakness                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The answer key of the fixture, v1              | Every hard case I could think of is handled, and no negative case is hit                | I wrote the fixture, the key and the analyser                                         |
| The deploy of the fixture to the test org      | Every formula of the fixture is valid Salesforce                                        | Says nothing about what OrgLens finds                                                 |
| The Dependency API on the test org             | For custom fields, whether Salesforce agrees pair by pair with the key and with OrgLens | Blind to standard fields, lookups, summaries and inactive rules. The fixture is small |
| Every formula and rule of the public codebases | Code I did not write, checked one by one                                                | About 110 items. Checked by me                                                        |
| The Dependency API on an org of yours (Q1)     | Scale: hundreds of formulas and rules that neither of us wrote                          | Only you see the result. I get the numbers you choose to tell me                      |
| Ten entries of the key read by you             | A second person                                                                         | Ten entries                                                                           |

## 7. Pull requests and review

About twelve pull requests, each from its own branch, each with a code review by a separate agent, merged when CI
is green on the three systems and every finding is resolved.

| PR  | Content                                                              | Work package |
| --- | -------------------------------------------------------------------- | ------------ |
| 1   | This plan as approved, with your answers                             |              |
| 2   | Fixture v1, its key, the probes, the deploy and the run of the probe | WP1          |
| 3   | The XML reader                                                       | WP2          |
| 4   | Migration 0003, the tables, the benchmark through the store          | WP3          |
| 5   | Components, attributes and the references written in XML             | WP4          |
| 6   | The formula parser and resolver, scored against the key              | WP5          |
| 7   | Analysis in `snapshot`, `analyse`, `coverage`                        | WP6          |
| 8   | The impact engine and `orglens impact`                               | WP7          |
| 9   | The Dependency API in the engine and the comparison                  | WP8          |
| 10  | What a snapshot reads, and "complete"                                | WP9          |
| 11  | The proof on public codebases and the note with the numbers          | WP10         |
| 12  | Phase close                                                          | WP11         |

PRs 3, 4 and 2 do not depend on each other. PR 5 needs 2, 3 and 4. PR 6 needs 5. PR 9 and PR 10 need 7.

## 8. Risks in this phase

| Risk                                                                                                                           | Handling                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The formula language has no published grammar, and has corners I do not know.                                                  | The probes of WP1 cover every documented function. The deploy to the test org rejects what is not valid. A formula that does not parse is reported and its names are still found, as `probable`. |
| The proof rests on one author (risk 12 of the overall plan).                                                                   | Section 6. The key is merged before the analyser is written. Q1.                                                                                                                                 |
| Standard relationships cannot be followed without a description of the standard objects.                                       | A table and a rule, with every path that is not followed counted. The count on the public codebases and on your org decides whether more is needed, and that would be a question to you.         |
| The real store is slower or larger than the benchmark tables of Phase 0.                                                       | Measured in WP3, before anything is built on it.                                                                                                                                                 |
| An answer of `impact` is read as complete when most of the org is not analysed yet.                                            | The answer says what it does not cover in its first lines, and `complete` is `false`. I would rather have a colleague annoyed by the warning than misled by its absence.                         |
| The Dependency API is in Beta and may change or be slow on a large org.                                                        | The stage is optional and has a time limit. What it did not cover is in `coverage`. Above 2,000 rows it was never run against Salesforce: your org in the test plan may be the first.            |
| Phase 1 grows. Flows and record types are close, and a real org will show ten things worth fixing.                             | The "not in Phase 1" list is the boundary. What a real org shows goes to the Phase 2 plan unless it breaks an outcome of this one.                                                               |
| `orglens snapshot` with a Salesforce CLI login never ran against Salesforce, nor did a login kept in the keychain of a system. | Part G of the Phase 0 test plan is that run. I ask you to do it before WP6 is built. A defect it shows is corrected first, in a pull request of its own.                                         |

## 9. Effort

The roadmap estimated Phase 1 at 4 to 6 weeks. This plan is 6 to 7. Two things account for the difference: the
cross-check of WP8, which the roadmap has in Phase 3, and WP9, which Phase 0 left open. Without both it is
about 5. If you approve the plan as it is, the total to the gate in the overall plan moves from 26 to 37 weeks
to 28 to 38, less what Phase 3 saves because the Dependency API is then already read. I have not estimated that
saving.

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

1. Answer Q1 to Q8, and approve this plan or send it back.
2. Run part G of the Phase 0 test plan, if you have not yet, before WP6 is built.
3. Read ten entries of the new answer key against their files, when the pull request of WP1 is up, before the
   analyser is written. About 20 minutes.
4. Review the pull requests you want to look at. Merging is done by the assistant under the rule of Phase 0.
5. At the end, run the Phase 1 test plan. Its main step is `orglens snapshot` and `orglens impact` on an org you
   know, for fields whose uses you know, and with Q1 the comparison with what Salesforce reports. If that org is
   a client's, the client's permission comes first, and nothing of it goes into an issue or a chat.
6. For Q6 (b) only: an npm account and a token.
