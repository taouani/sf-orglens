# real-org, with the fixture project of Phase 1

What the runs against the test org showed after the fixture project grew from 52 to 87 components, recorded on
15 November 2026. The runs are the ones of the workflow "Live org" (`.github/workflows/live-org.yml`), whose log is
public. Every number here is taken from such a log. Nothing was read from the org in another way, and no file of
the org was kept.

The note of Phase 0, [real-org.md](../phase-0/real-org.md), describes the org, the steps and the first runs. This
note says what is new and what moved. Claims are marked `[run N]` with the run they come from, or `[unverified]`.

In short:

- Salesforce refused the first deploy of the larger project for two of its 87 components, and accepted the second
  after two files were corrected by reading. Why the two were refused is not verified.
- The snapshot holds all 87 components, in 99 files. The four new metadata types came through without a change
  to the engine. The org still gives a "partial" snapshot, for 222 components of its own, as many as before in
  every type.
- The Dependency API reports 129 of the 189 pairs of the answer key, and no row between two components of the
  fixture project is wrong. Of the 52 pairs from a formula to something custom, it reports 51: custom fields,
  also of a custom setting, of the user and of a custom metadata type, a custom label, a custom permission and
  a record of a custom metadata type. The one it misses is in the rule that is not active.
- It is blind, as before, to standard fields, lookups, roll-up summaries, lookup filters, names in text and
  inactive rules. New on that list: global value sets and the controlling field of a picklist.
- The tool that asks the org named a custom metadata type wrongly, and counted two pairs as missing that
  Salesforce reports. The first probe gave 127. The engine will meet the same trap in work package 8.
- The symbol tables are as in Phase 0: no reference in any of them.
- Added on 17 November 2026, from run 10: the engine now reads the Dependency API itself and holds it against
  its analysis ([section 7](#7-the-cross-check-of-the-engine)). Of the 56 pairs Salesforce reports from a custom
  field or a validation rule, the analysis has 54, has 2 through a part of the object, and missed none. Every
  end of those rows was matched to a component the org listed. Read in parts, as a large org has to be read,
  6 queries failed and 9 of 257 rows were lacking.
- Added from run 11: the 6 queries are the ones that name a standard object as the type of the target, which
  Salesforce does not answer and says so in its documentation. The 9 rows are from an Apex class to a standard
  object. The reader no longer names that type in a condition. That is not run against the org yet.

## Conditions

- The same org as in Phase 0: one Developer Edition org, API version 68.0. No other edition, no sandbox and no
  org with a namespace was measured.
- One runner per run: `ubuntu-latest` of GitHub Actions, Node.js from `.node-version`.
- The deploy that Salesforce accepted and the read ran once. The probe ran twice, 37 minutes apart, before and
  after a correction of the tool. The times are indications, not statistics.
- The steps print no name of a component that is not of the fixture project (decision record 0033). What is said
  here about the other components of the org is said in counts, types and forms of names.

| Run | Steps | Commit | Result |
| --- | --- | --- | --- |
| [5](https://github.com/taouani/sf-orglens/actions/runs/43756201988) | deploy and read | `9283b8c` | red: Salesforce refused the deploy, and the org was not read |
| [6](https://github.com/taouani/sf-orglens/actions/runs/43759793416) | deploy and read | `74cadde` | green, with a warning for the partial snapshot |
| [7](https://github.com/taouani/sf-orglens/actions/runs/43760218782) | probe | `74cadde` | green |
| [8](https://github.com/taouani/sf-orglens/actions/runs/43763715996) | probe | `fdd34b6` | green |
| [10](https://github.com/taouani/sf-orglens/actions/runs/43996393289) | read and probe | `9aadacb` | green, with a warning for the partial snapshot and one for a query the org refused |
| [11](https://github.com/taouani/sf-orglens/actions/runs/44003600959) | read | `faae654` | green, with the same two warnings |

Runs 1 to 4 are those of Phase 0. Run 9 is the login the workflow makes once a week by itself. Runs 10 and 11
are of 17 November 2026, after work package 8 was merged, and section 7 is about them.

## 1. The deploy of the larger fixture project

- **The first deploy was refused.** Salesforce counted 87 components, found an error in 2 and none in the other
  85. Of the 85, 32 were new in the org, 6 were changed and 47 were as they are. `[run 5]`
- **Salesforce took everything back.** The log of run 5 has no sentence about it. The tool asks for it
  (`rollbackOnError`), and run 6 confirms it: the 32 and the 2 were new in the org again. `[run 6]`
- **53 of the 87 were in the org before, and 6 of them count as changed.** The 53 are the 52 of Phase 0 and,
  most likely, `CustomLabels`, which the org listed before the deploy. No file of the 52 changed in the
  repository. What makes Salesforce call 6 of them changed the run does not say, and it names none of them.
  `[unverified]`
- The two components were the rule `Invoice__c.Void_Needs_Admin` and the field `Invoice__c.Region__c`. The log
  names them and says of each problem only that it is "not of a known form": the step showed a message of
  Salesforce only when its whole text had a form the step knew. `[run 5]`
- **Why each was refused is a reading, and not verified.** `[unverified]`
  - The rule compared `$RecordType.Name`, and `Invoice__c` has no record type.
  - The field had the default value `TEXT($User.Billing_Region__c)`. Salesforce reported no problem for the
    formula field `Is_My_Region__c` of the same object, which holds the same call. So the call is valid in a
    formula field and was not accepted in a default value. Whether it is the custom field of the user, the
    picklist or something else that a default value does not take, the run does not say.
  - The page "Deployment Status" in the Setup of the test org shows the two messages. Only the maintainer can
    read it.
- Both files were corrected by reading: the line with `$RecordType.Name` was removed, and the default value
  became `$User.Department`. The step now shows the everyday words of a problem whose form it does not know.
- **The second deploy was accepted**: 87 counted, 87 deployed, 0 errors, after 41 seconds. 34 components were new
  in the org, 6 were changed and 47 were as they are. `[run 6]`
- **No Apex test was run**, as in Phase 0. That the test class passes is still not shown.
- What this proves: every formula of the 87 components is one Salesforce accepts. What it does not prove: that
  the two corrections were the smallest ones possible, and that Salesforce had checked the other 85 components
  to the end in the deploy it refused. The second deploy found nothing more.
- **The fixture project has no `$RecordType` and no default value that names a custom field any more.** It
  still has default values that are formulas: `TODAY() + 30`, and `$User.Department`, which names a standard
  field. A probe in `fixtures/formula-probes.yaml` still has `$RecordType`. The probes are not deployed.

## 2. The snapshot

One read, in run 6. The run of Phase 0 beside it is run 4.

| Measurement | Run 4, 12 November | Run 6, 15 November |
| --- | --- | --- |
| Time in all | 120.0 s | 207.6 s |
| Login | 0.4 s | 0.3 s |
| Asking what the org holds, 339 requests | 8.0 s | 5.8 s |
| Retrieving it, 2 chunks | 111.6 s | 201.5 s |
| The first chunk | 896 components of 55 types, 95.3 s | 883 components of 56 types, 191.8 s |
| The second chunk | 472 components of 7 types, 15.6 s | 499 components of 9 types, 9.0 s |
| Requests to the Metadata API in all | 371 | 389 |
| Largest memory of the process | 408 MB | 391 MB |
| Metadata types the org describes | 334 | 334 |
| Of them with a component or a listing that is not ok | 77 | 81 |
| Components the org listed | 1,668 | 1,710 |
| Of them retrieved | 1,445 | 1,488 |
| Retrieved without being listed | 3,506 | 3,526 |
| Components of a package with a namespace | 77 | 77 |
| Files | 5,010, together 14.6 MB | 5,072, together 14.8 MB |

`[run 4]` `[run 6]`

- **The org lists 42 components more, and the fixture project grew by 35.** 34 of the 35 are new in the listing.
  The 35th, `CustomLabels`, was listed before. The other 8 are not of the fixture project: 3
  `CustomObjectTranslation`, 2 `Layout`, 1 `CustomObject`, 1 `SharingRules` and 1 `TopicsForObjects`. That
  Salesforce made them for the new objects of the deploy is a reading of the counts: the run names none of
  them. `[unverified]`
- **The four new types came through the listing and the retrieve without a change to the engine**:
  `GlobalValueSet` (1 listed, 1 retrieved), `CustomMetadata` (1, 1), `CustomPermission` (1, 1) and `CustomLabel`
  (1, 1). In Phase 0 the org listed `CustomLabels` and handed out nothing, and the note guessed that an org
  without a label does that. With one label in the org, `CustomLabels` comes back (1, 1). `[run 6]`
- **222 components are listed and not handed out**, with the same count, the same state and the same form of
  name in each of the same 14 types as before without `CustomLabels`. That they are the same components is not
  shown, because the run prints no name. They are 171 list views, 24 reports, 7 bundles of a package, 3
  `ContentWorkspacePermission`, 3 matching rules, 2 fields, 2 objects, 2 dashboards, 2 record types, 2
  translations of standard value sets, 2 folders of unfiled items, which are of two types, 1 installed package
  and 1 `WorkflowFlowAutomation`. The nine remarks of Salesforce are the same in number and form. Nothing of the
  fixture project is among them. `[run 6]`
- **The time of the retrieve is still the time Salesforce takes.** The first chunk took 95 seconds on 12
  November and 192 seconds now, for 13 components fewer. Phase 0 measured 175 and 95 seconds for the same chunk
  on one day.
- **Fields that came back without being listed: 3,472**, the same number as before. The translations of fields
  among the unlisted went from 26 to 46. `[run 6]`

## 3. What Salesforce rewrites in the larger fixture project

All 87 components were listed and came back, in 99 files. 26 files are the same byte for byte as in the
repository. 73 differ. `[run 6]`

| Files | How the file from the org differs |
| --- | --- |
| The 12 classes and the trigger | One byte less: the line end at the end of the file is gone. As in Phase 0. |
| The three custom objects `Invoice__c`, `Invoice_Line__c`, `Tax_Code__c` | The org adds about 4,800 bytes of elements to each (4,719 to 4,816), the ones Phase 0 lists. |
| 45 fields of the custom objects and of the custom setting | The org adds `trackTrending`. To 12 formula fields that give a text or a number it also adds `externalId`, `required` and `unique`, to 4 formula fields `required` only, and to 6 text and number fields `externalId` and `unique`. 23 fields get `trackTrending` only. |
| 5 of the 6 fields on `Account` | The org adds `trackFeedHistory`, and for the number field `externalId` and `unique`. |
| One formula field on `Account` | The same elements, in another order or with other values. As in Phase 0. |
| The two fields on `User` | The org adds `trackFeedHistory` and `trackHistory`. To the hierarchy field `Backup_Approver__c` it also adds `restrictedAdminField`, **and it leaves out `required`**, which the file of the repository has. |
| 4 of the 10 validation rules | Only how characters such as quotes are written differs. |

The 26 files that are the same: the 13 files beside a class or the trigger, the other 6 validation rules, the
custom label, the custom permission, the global value set, the record of the custom metadata type, the object
file of the custom metadata type and its one field, and the object file of the custom setting.

What is new against Phase 0:

- **A field of a custom metadata type and the object file of a custom setting or of a custom metadata type come
  back as they were sent.** The org adds nothing to them. The two fields of the custom setting get
  `trackTrending` like every field of a custom object.
- **The org can leave an element out.** `required` of the hierarchy field on `User` did not come back. A
  comparison of an org with a repository has to take an element that one side does not have as "not said", and
  not as a difference, where the element has its default value. This is one more case for the comparison engine
  of a later phase.
- **Why the org leaves it out is not known.** The four fields of the type `Lookup` that have `required` in the
  repository kept it. So it may be a property of the type `Hierarchy`, or of the object `User`. One field cannot
  say which. `[unverified]`
- **A field on `User` gets `trackHistory`, a field on `Account` does not.** The elements the org adds depend on
  the object, and not only on the kind of field.
- Nothing here changes a formula. As in Phase 0, that a reference extracted from the file of the org is the
  same as one from the file of the repository is not tested, because the engine has no parser yet. The lines of
  a formula in a file of the org are not known to be the same. `[unverified]`

## 4. The Dependency API

One query without a filter gave 257 rows, in both runs. The queries per type gave the same rows, and none was cut
off or failed. Each run made 29 requests to the Tooling API, with the symbol tables. The step took 5 and 8
seconds. `[run 7]` `[run 8]`

| Type that refers | Rows on 12 November | Rows now |
| --- | --- | --- |
| Layout | 93 | 93 |
| ApexClass | 92 | 92 |
| CustomField | 15 | 35 |
| ValidationRule | 10 | 21 |
| CustomApplication | 9 | 9 |
| ApexTrigger | 2 | 2 |
| LookupFilter | 1 | 2 |
| PromptVersion | 1 | 1 |
| WebLink | 1 | 1 |
| A type whose name is not the name of a metadata type | 0 | 1 |
| All | 224 | 257 |

149 rows are between two components of the fixture project. The other 108 have the counts by type of the 107 of
Phase 0, and one more from a lookup filter to a custom field. As before, they were counted and not checked, and
the run names none of them. `[run 8]`

**Against the answer key.** The key holds 189 pairs of a component and a component it refers to. The API reports
129 of them. `[run 8]`

| From | To | In the key | Reported | On 12 November |
| --- | --- | --- | --- | --- |
| ApexClass | CustomField | 70 | 58 | 58 of 70 |
| ApexClass | CustomObject | 11 | 11 | 11 of 11 |
| ApexClass | ApexClass (`extends`) | 1 | 1 | 1 of 1 |
| ApexClass | a standard object | 4 | 4 | 4 of 4 |
| ApexClass | a standard field | 9 | 0 | 0 of 9 |
| ApexTrigger | CustomObject | 1 | 1 | 1 of 1 |
| CustomField | CustomField | 42 | 34 | 15 of 19 |
| CustomField | CustomObject | 1 | 0 | 0 of 1 |
| CustomField | a standard object | 4 | 0 | 0 of 3 |
| CustomField | a standard field | 17 | 0 | 0 of 7 |
| CustomField | CustomLabel | 1 | 1 | |
| CustomField | GlobalValueSet | 2 | 0 | |
| ValidationRule | CustomField | 18 | 17 | 10 of 11 |
| ValidationRule | a standard field | 6 | 0 | |
| ValidationRule | CustomMetadata | 1 | 1 | |
| ValidationRule | CustomPermission | 1 | 1 | |
| All | | 189 | 129 | 100 of 137 |

The Apex of the fixture project is the same as in Phase 0, and so are its numbers. The 52 pairs that are new are
all in fields and rules. The API reports 29 of them.

The 60 pairs that are missing have nine causes, and no pair is missing without one:

| Cause | Pairs | Of them new | What the API does |
| --- | --- | --- | --- |
| The target is a standard field | 32 | 16 | It has no row to a standard field. That holds for a field reached through a lookup (`Invoice__r.Account__r.Owner.Email`), through `Owner`, `Parent` and `Manager`, for a field of the user, the profile, the role and the organization behind a global variable (`$User.Department`, `$Profile.Name`, `$UserRole.Name`, `$Organization.Country`), for the `Name` of the object in `VLOOKUP`, and for a standard field in a lookup filter and in a default value. |
| The name of the field stands in text, in Apex | 11 | 0 | It does not read text. |
| A field named through a token of another class, and in a describe call | 1 | 0 | As in Phase 0. |
| The target of a lookup field | 5 | 1 | It has no row for what a lookup points to. |
| The key and the summarised field of a roll-up summary | 5 | 2 | It has no row for them. The fields in the filter of a roll-up are reported: 3 of 3. |
| A custom field in a lookup filter | 2 | 1 | It has no row from the field with the filter. Two rows go from a `LookupFilter` to a custom field, and the project has two filters that each name one custom field. Most likely the API reports a filter as a component of its own. The run names neither end, so the two rows fit two readings: the filter refers to the custom field it names, or to the field it belongs to. A filter that names two custom fields, or none, would tell them apart. The project has no such filter. `[unverified]` |
| The global value set of a picklist | 2 | 2 | It has no row from a field to its value set. |
| The controlling field of a picklist | 1 | 1 | It has no row from the dependent field to the field that controls it. |
| A validation rule that is not active | 1 | 0 | It has no row for it. All 17 pairs of the 9 active rules to a custom field are reported. |

What the new pairs show:

- **A formula of a field or of an active rule that names something custom is reported, in every way of naming
  the fixture project has.** The key has 73 pairs from a formula. 21 go to a standard field. Of the other 52, 51
  are reported, and the one that is not is in the inactive rule. These 52 are not the 52 new pairs above: the
  two sets only have the same size. Among the 51 are:
  - a field of a custom setting behind `$Setup`,
  - a custom label behind `$Label` and a custom permission behind `$Permission`,
  - the field and the record behind `$CustomMetadata`,
  - a custom field of the user behind `$User`, and one reached through a lookup to the user,
  - the custom field in `VLOOKUP`, named by `$ObjectType`,
  - picklist fields inside `CASE` and `INCLUDES`, which are new,
  - picklist fields inside `ISPICKVAL` and `TEXT`, and a field inside `ISCHANGED` and `PRIORVALUE`. Phase 0 had
    these four and they were reported then. Phase 1 uses them in more places.
- **For two things in a formula the API reports the object as well, and the key does not hold it.** The rule
  with `VLOOKUP` has a row to `Tax_Code__c`, the object behind `$ObjectType`. The rule with `$CustomMetadata` has
  a row to `Billing_Rule__mdt`. The key leaves these out by its own rule: the reference goes to the field or the
  record (`fixtures/README.md`, "What is not keyed"). Both rows are true.
- **A third row to an object is not from a formula.** It goes from the record `Billing_Rule.Default` to
  `Billing_Rule__mdt`: a record and its type. The key has no entry from a record, and no line of "What is not
  keyed" names this pair. The row is true.
- **Of the 149 rows between two components of the fixture project, none is wrong.** 129 are pairs of the key. Of
  the other 20, 17 are the ones of Phase 0, which were read against the code then: from a class or the trigger
  to another class, and from a class to an object it uses as a type. The Apex has not changed. 3 are the three
  rows to an object above.
- **The 15 fields the key calls unreferenced have no row** between two components of the fixture project.
  Whether a layout of the org shows one of them was not looked at.
- **What the run cannot say about a default value.** The one default value that names a field now names a
  standard field of the user, which the API never reports. Whether it reports a custom field in a default value
  is not shown. `[unverified]`
- **What the run cannot say about the field a rule shows its error on.** The five pairs the key has for it
  (`errorDisplayField`) are all reported, and in each the formula of the rule names the same field. A rule that
  shows its error on a field its formula does not name is not in the project. `[unverified]`
- **The two probes ran about 4 and about 41 minutes after the deploy and gave the same 257 rows.** That speaks
  for an index that is complete within minutes. A row that Salesforce adds hours later would not be seen here.
  `[unverified]`

**How the API writes a record of a custom metadata type.** The type of such a row is not `CustomMetadata`. It is
the name of the custom metadata type. No run prints the type. It is deduced from the code of the tool and two
lines of the logs. `[run 7]` `[run 8]`

- In run 8 the row matched the record `Billing_Rule.Default`. The tool has two paths that give that key: one for
  a type that ends in `__mdt`, and one for the type `CustomMetadata` with a name that holds a dot.
- The second path is excluded twice. In run 7 the tool printed the type as "a type that is not shown", which it
  does for a name that is not made of letters and digits alone, and `CustomMetadata` is made of letters. In run
  8 the row stands under "every other type", where a type of letters and digits never stands.
- Whether the name of the row is `Default` or `Billing_Rule.Default` the runs do not say: the tool accepts both.

**The fault of the tool, and what it means for the engine.** The first probe reported 127 pairs. It counted the
field `Billing_Rule__mdt.Max_Amount__c` and the record as missing, and four rows as "not of the fixture project"
that are of it. `[run 7]`

- The Dependency API gives an id and a name without the object. The tool reads the object behind an id from the
  Tooling API. The row of a custom object there holds the name without its ending (`Billing_Rule`), and the
  tool added `__c` to every one. The custom metadata type became `billing_rule__c`, which the key does not hold.
- The tool now asks a field and a rule for the name of their object (`EntityDefinition.QualifiedApiName`). The
  org accepted that in both queries, and all 5 custom objects of the org were named that way. The log does not
  say whether a name came from a field, from a rule or from both. `[run 8]`
- A custom object without a custom field and without a validation rule gets no name this way. The tool marks a
  pair that rests on a built name as a guess. This org has no such object.
- **Work package 8 reads the Dependency API in the engine and has to solve the same thing**: the ending of a
  custom object (`__c`, `__mdt`, and the endings of the kinds the fixture project does not hold), and the row of
  a record, whose type is the name of its custom metadata type.

**Verdict, as in Phase 0: usable for field-level verification of custom fields, within known limits.** The
limits are wider than Phase 0 knew by two entries, and the part it covers is wider as well.

- Usable for: custom fields, custom objects, custom labels, custom permissions and records of a custom metadata
  type as targets; Apex classes, triggers, formula fields and active validation rules as sources. For a label, a
  permission, a record and a custom field of the user behind `$User`, this rests on one pair each.
- Not usable for: standard fields, names in text, lookups, roll-up summaries, lookup filters, the value set and
  the controlling field of a picklist, inactive rules, the place of a reference, read against write.
- Not measured: a custom field in a default value, a rule that shows its error on a field its formula does not
  name, record types (`$RecordType`), flows, layouts and every type the fixture project does not hold. An org
  above the limit of 2,000 rows.

## 5. The symbol tables of the compiler

As in Phase 0, with the same numbers: 12 classes, each with a symbol table, 0 entries in `references`, 0 external
references, 58 methods, and a name of a custom object in 47 places, all of them a type. A trigger cannot be asked
for with a symbol table. `[run 7]` `[run 8]`

## 6. What this changes

- **Work package 1 of Phase 1 is accepted on its first point**: Salesforce accepts the deploy, so every formula
  of the fixture project is valid. The probes in `fixtures/formula-probes.yaml` are not deployed and not covered
  by this.
- **Finding 2 of the Phase 1 plan holds on a wider base.** It said that the API reports references from formulas
  to custom fields completely, as far as measured: 24 of 24 for formula fields and active validation rules. For
  everything custom a formula names it is now 51 of 51 for formula fields and active rules, and 51 of 52 with
  the inactive rule the finding names.
- **The third pass mark of the phase needs a reading before work package 8 is built.** It says that on the test
  org, no pair the API reports for a formula field or a validation rule is missing in what OrgLens finds. The
  API reports two pairs from a validation rule to an object that the key leaves out on purpose. Either OrgLens
  records a reference to the object there, or the comparison counts a row to an object as covered when OrgLens
  has a reference from the same component to a field or a record of that object. This is a question for the
  maintainer, with the plan of work package 8. It is not decided here.
- **The row from a record to its custom metadata type is a separate question.** It is not from a formula, so the
  pass mark does not cover it, and the second way above cannot cover it: OrgLens has no reference from a record.
- **The list of what Salesforce could have seen is longer in both directions.** Decision record 0034 counts a
  missing row as a difference only where the API could have seen the pair, and names standard fields, names in
  text, lookups, roll-up summaries and inactive rules. The list now also holds lookup filters, the value set and
  the controlling field of a picklist. Work package 8 has to build on the longer list, or it counts five pairs
  of the fixture project against OrgLens that Salesforce never reports.
- **The coverage a snapshot reports** can name Salesforce as a second witness for global variables that lead to
  something custom. For value sets, controlling fields, lookups, roll-up summaries, lookup filters and standard
  fields, the answer key and the public codebases stay the only measure.
- **The fixture project has no `$RecordType`, which the plan of work package 1 asked for.** To key it, the
  project needs a record type, which is one more metadata type. That is not done. The project still has a
  default value that is a formula, as the plan asked. That formula no longer names a custom field, so a custom
  field in a default value is not measured.
- **Open**: why the two components of the first deploy were refused; why the org leaves `required` out of the
  hierarchy field on `User`; the questions Phase 0 left open about the snapshot, none of which moved.
- **The logs of the runs are kept by GitHub for a limited time.** The numbers here were read from them on the
  day of the runs. The list of the 189 pairs is not copied here. It can be made again by a run of the step
  `probe`. The 23 new pairs that the API does not report are listed below, so that this part does not rest on
  a log.

## 7. The cross-check of the engine

Work package 8 moved the reading of the Dependency API into the engine (decision record
[0045](../../adr/0045-the-cross-check-of-a-snapshot.md)). Run 10 is its first run against a real org. The step
"read" takes a snapshot with the cross-check, as `orglens snapshot` does, and the step "probe" reads through the
same reader. The org and the fixture project in it are as on 15 November: nothing was deployed. `[run 10]`

**The reading.** One request gave 257 rows, and the engine calls the reading whole. It is the number of runs 7
and 8. The counts per type are those of section 4 as far as this log gives them: for the 201 rows that are not
compared by type, and for custom fields and validation rules by their sum.

**The comparison.**

| What                                                                           | Rows or pairs |
| ------------------------------------------------------------------------------ | ------------- |
| Rows of the API                                                                | 257           |
| Rows from a component of a type this phase does not analyse, not compared      | 201           |
| Rows with an end that is no component the org listed                           | 0             |
| Rows from a component the snapshot does not hold or that was not analysed      | 0             |
| Rows compared                                                                  | 56            |
| Pairs of components these are                                                  | 56            |
| Pairs the analysis has as well                                                 | 54            |
| Pairs to an object that the analysis has as a reference to a part of the object | 2             |
| Pairs the analysis missed                                                      | 0             |
| Pairs only the analysis has, of a kind the API reports                         | 0             |
| Pairs only the analysis has, of a kind the API does not report                 | 39            |

- The 201 rows that are not compared: Layout 93, ApexClass 92, CustomApplication 9, ApexTrigger 2, LookupFilter 2,
  the record of the custom metadata type 1, PromptVersion 1, WebLink 1.
- The 56 rows that are compared are the 35 from a custom field and the 21 from a validation rule of section 4.
- The 2 pairs through a part are the two from a rule to an object that section 6 names: the object in
  `$ObjectType` inside `VLOOKUP` and the custom metadata type behind `$CustomMetadata`. The maintainer decided on
  16 November 2026 that such a row counts as covered.
- The 39 pairs of kinds the API does not report, by reason: a standard field 23, a roll-up summary 5, a standard
  object 4, the filter of a lookup 2, a value set 2, a controlling field 1, a rule that is not active 1, a
  lookup 1. With the 54 they are 93, as many as the answer key holds from a custom field or a validation rule,
  and the counts by reason are those of section 4. The run does not hold the analysis against the key pair by
  pair: the tests do that for the files of the repository.
- Of the 54, 51 are from a formula and 3 from the filter of a roll-up summary, by the counts of section 4.

**What this verifies.**

- **The third pass mark of the phase is met on this org**: no pair the API reports for a formula field or a
  validation rule is missing in what the analysis found, and the report says how many rows it cannot compare
  yet, 94 of them from Apex.
- **The ends of the rows are found in the listing**, for the types that were compared. All 112 ends of the 56
  rows were matched to a component the org listed: custom fields and validation rules as sources, and custom
  fields, a custom label, a custom permission, a record of a custom metadata type and two custom objects as
  targets. A field, a rule and a custom object can only be matched by their id, so for them the ids of the
  listing are the ids of the rows. For the label, the permission and the record the log does not say whether
  the id matched or, for a component the org listed without an id, the type and the full name. No compared row
  of this org has a standard object as an end, so the match of a standard object by its name was not
  exercised.
- **Nothing the analysis found is contradicted.** No pair of a kind the API reports is without a row. So on
  this org the list of kinds the API does not report puts no pair on the wrong side. The three entries of that
  list that rest on no measurement stay unmeasured: the fixture project has no pair of those kinds.
- The mock org of the tests reports 57 rows for these types and the real org 56. The one more is the formula of
  the rule that is not active, which the mock org reports and Salesforce does not. The comparison counts that
  pair under "a rule that is not active", as it should.

**The reading in parts.** The org holds fewer rows than the 2,000 at which Salesforce cuts a query off. The step
therefore read the rows again with one query, and just after it through a session that cuts every answer off
at 30 rows, so that the engine asks per type, per pair of types and per component.

| What                                                                  | Number |
| --------------------------------------------------------------------- | ------ |
| Requests                                                              | 63     |
| Rows                                                                  | 248    |
| Queries still at the limit with no smaller part to ask for            | 0      |
| Queries that failed and whose rows no other query gave                | 6      |
| Queries asked again per component, for more components than one names | 0      |
| Rows of the one query that the parts lack                             | 9      |
| Rows the parts give that the one query does not have                  | 0      |

- The engine calls this reading `partial`, which is right: it lacks 9 rows and says that rows are missing. The
  step does not fail for a reading that says so. It ended with a warning.
- **6 queries failed, and their rows came from no other query. Which ones is not known.** The first failure of
  the reading had the code `INVALID_TYPE_FOR_OPERATION`. The log gives that one code and the number, not the
  code of each, and not the queries. The number is not the number of requests the org refused: a query that
  failed and whose rows other queries gave is not counted.
- So it is not shown whether the org accepts the conditions `IN` and `NOT IN` on `MetadataComponentId`, which
  the record of work package 8 lists as not verified. The numbers bound it for `IN`. The rows from a layout to
  a custom field are 82 or more by the probe of the same run, so that pair of types was at the limit of 30, and
  no query stayed cut off, so the engine asked for it per component. Had the org refused that way of asking,
  the pair would hold only what three answers of 30 rows gave, and most likely more than 9 rows would be
  lacking. So `IN` was probably answered there. `[unverified]`
- **This matters for every org above 2,000 rows.** If the queries are ones the engine always asks, such as a
  query for a type that this API does not take in a condition, the cross-check of a large org is always
  `partial`. That is `[unverified]`: it is a reading of the two numbers, not of the queries.
- The step now prints the condition of the query of every request that failed, with the names of the types and
  the number of ids in the place of the ids, and the rows the parts lack by the types of their two ends. The
  next run shows which queries they are, and the reader is corrected by what it shows.
- The one query and the 63 requests took about 9 seconds together.

**Run 11: which queries failed.** The step "read" was run again on 17 November 2026 from the commit that prints the
condition of every request that failed. The comparison and the reading in parts gave the numbers of run 10. `[run
11]`

| The condition of the query that failed, for each of the types ApexClass, CustomField and Layout | Code |
| --- | --- |
| `MetadataComponentType = <the type> AND RefMetadataComponentType = StandardEntity` | `INVALID_TYPE_FOR_OPERATION` |
| `MetadataComponentType = <the type> AND RefMetadataComponentType NOT IN (<the types asked for by name, StandardEntity among them>)` | `INVALID_TYPE_FOR_OPERATION` |

- Six requests failed, one for each of six queries, and no request was sent again. The three types are the ones with
  more than 30 rows, so they are the three that were asked for per type of the target.
- **Every query that failed names `StandardEntity` as a type of the target, and no query that names it was
  answered.** `StandardEntity` is what the API writes as the type of a standard object. The query for it by name
  failed, and so did the query for the rest, whose list of types to leave out holds it.
- **The 9 rows the parts lack are all from an Apex class to a standard object.** They are the rows
  that the query for an Apex class to `StandardEntity` would have given. The other five queries left no row out:
  custom fields and layouts have no row to a standard object in this org, and no row of a type that was not asked
  for by name.
- **Salesforce documents the first of the two.** The page of the object in the Tooling API guide lists, among the
  queries that are not supported, a filter by `RefMetadataComponentType = 'StandardEntity'`
  ([MetadataComponentDependency](https://developer.salesforce.com/docs/atlas.en-us.api_tooling.meta/api_tooling/tooling_api_objects_metadatacomponentdependency.htm),
  read on 17 November 2026). It does not name the code, and says nothing of a list that holds the type.
- **Every other request was answered**, 57 of 63. Among them are the conditions `IN` and `NOT IN` on
  `MetadataComponentId`: the rows from a layout to a custom field were at the limit, no query stayed cut off and
  none of them failed, so the engine asked for that pair per group of components and for every other component, and
  the org answered. That settles what the list above left `[unverified]`.
- **The same page says something the org does not do.** It lists a condition with an operator other than `=`, `!=`,
  `AND` and `OR` as not supported. The reader uses `IN` and `NOT IN`, on the two types and on the id of the
  component, and the test org answered every such query that does not name `StandardEntity`. Whether another org or
  another version of the API refuses them is `[unverified]`. A reading stays honest if one does: a query that is
  refused is counted, and the reading is `partial`. The same conditions can be written with `=`, `!=` and `OR`,
  which makes a query with 200 ids about twice as long. That is not done.
- **What this meant.** Every org above 2,000 rows that has a type at the limit and a row to a standard object got a
  reading that is `partial`, and lost the rows from that type to standard objects.

**What was changed after run 11.** The reader never puts `StandardEntity` into a condition (`sources/dependency-
api.ts`).

- The rows to standard objects come with the rest: the query for whatever is of no type that a query named.
  `StandardEntity` is never on that list.
- Where the rest is at the limit and no type is left to ask for by name, it is asked for per group of components, as
  a pair of types is. Before, such a rest was counted as cut off.
- A type of target whose query by name the org does not answer is treated the same way: it is not put on the list,
  so its rows come with the rest. It counts as failed only if the rest fails too.
- Both mock orgs of the tests refuse a condition that names `StandardEntity`, alone or in a list, with the code the
  test org gave.
- **Not verified:** the corrected reader against the test org. The workflow runs from `main` only, so the run is
  after the merge. In particular it is not shown that the org answers `RefMetadataComponentType NOT IN` with a list
  that does not hold `StandardEntity`: every such query of runs 10 and 11 held it.

**The step "probe"** reads through the reader of the engine now: 1 request, 257 rows. Its comparison with the
answer key gives the numbers of run 8: 129 of 189 pairs, the same tables by type, by way and by tier, and the
same 20 pairs the key does not hold. The symbol tables are as before.

**Not verified by this run.** The command `orglens snapshot` itself, which the step does not start: it calls
the engine as the command does. An org above 2,000 rows, where the parts are asked for in earnest. Another
edition, a sandbox, an org with a namespace. How many requests a large org needs.

## The 23 new pairs the Dependency API does not report

They are written as the step prints them: the keys of the answer key, in lower case. All names are of the
fixture project or of Salesforce. `[run 8]`

The target is a standard field (16):

- `CustomField:invoice__c.approver__c -> CustomField:user.department` (lookup filter)
- `CustomField:invoice__c.approver_backup_email__c -> CustomField:user.email`
- `CustomField:invoice__c.owner_label__c -> CustomField:group.name`
- `CustomField:invoice__c.owner_label__c -> CustomField:invoice__c.ownerid`
- `CustomField:invoice__c.owner_label__c -> CustomField:user.username`
- `CustomField:invoice__c.parent_account_name__c -> CustomField:account.name`
- `CustomField:invoice__c.parent_account_name__c -> CustomField:account.parentid`
- `CustomField:invoice__c.region__c -> CustomField:user.department` (default value)
- `CustomField:invoice_line__c.account_owner_email__c -> CustomField:account.ownerid`
- `CustomField:invoice_line__c.account_owner_email__c -> CustomField:user.email`
- `ValidationRule:invoice__c.locked_when_paid -> CustomField:profile.name`
- `ValidationRule:invoice__c.tax_rate_matches_code -> CustomField:tax_code__c.name`
- `ValidationRule:invoice__c.void_needs_admin -> CustomField:organization.country`
- `ValidationRule:invoice__c.void_needs_admin -> CustomField:profile.name`
- `ValidationRule:invoice__c.void_needs_admin -> CustomField:user.department`
- `ValidationRule:invoice__c.void_needs_admin -> CustomField:userrole.name`

The target of a lookup field (1):

- `CustomField:invoice__c.approver__c -> CustomObject:user`

The key and the summarised field of a roll-up summary (2):

- `CustomField:invoice__c.open_billable_total__c -> CustomField:invoice_line__c.invoice__c`
- `CustomField:invoice__c.open_billable_total__c -> CustomField:invoice_line__c.line_amount__c`

A custom field in a lookup filter (1):

- `CustomField:invoice__c.approver__c -> CustomField:invoice__c.status__c`

The global value set of a picklist (2):

- `CustomField:account.billing_region__c -> GlobalValueSet:billing_region`
- `CustomField:user.billing_region__c -> GlobalValueSet:billing_region`

The controlling field of a picklist (1):

- `CustomField:invoice__c.sub_status__c -> CustomField:invoice__c.status__c`

The other 29 new pairs are reported.
