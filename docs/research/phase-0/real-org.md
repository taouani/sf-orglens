# real-org

What the first runs against a real Salesforce org showed, recorded on 12 November 2026. The runs are the ones of
the workflow "Live org" (`.github/workflows/live-org.yml`), whose log is public. Every number here is taken from
such a log. Nothing was read from the org in another way, and no file of the org was kept.

Claims are marked `[run N]` with the run they come from, or `[unverified]`.

In short:

- The deploy and the snapshot work against a real org. The fixture project went in on the first try and came
  back whole.
- This org gives a "partial" snapshot on every read: it lists components it does not hand out. 179 of the 223
  are parts of a component, such as list views, which the engine does not ask for by name. For 12 more the run
  gives a remark or a reason. What "complete" should mean for a snapshot is an open question for the maintainer.
- The Dependency API reports 100 of the 137 pairs of the answer key. Of the 117 rows it has between two
  components of the fixture project, none is wrong. It knows custom fields and custom objects, at the level of
  the component. It is blind to standard fields, to names in text, to a field named in a describe call or
  through a token kept in another class, to lookups, to roll-up summaries and to inactive rules. It is usable as
  a cross-check within those limits.
- The symbol tables that the org keeps for saved classes hold no reference at all. They cannot serve as a
  cross-check for references. The way to symbol tables with references writes to the org.
- The maintainer decided on 12 November 2026 that the Dependency API alone is the cross-check for Apex. Nothing
  is compiled in the test org.

## Conditions

- One org: a Developer Edition org that was new when the fixture project was deployed to it. API version 68.0.
  No other edition, no sandbox, and no org with a namespace was measured.
- One runner per run: `ubuntu-latest` of GitHub Actions, Node.js from `.node-version`.
- The deploy and the probe were run once, the read step twice. The times are indications, not statistics.
- The steps print no name of a component that is not of the fixture project (decision record 0033). What is said
  here about the other components of the org is said in counts, types and forms of names.

| Run | Steps | Commit | Result |
| --- | --- | --- | --- |
| [2](https://github.com/taouani/sf-orglens/actions/runs/43281408869) | deploy | `88cedd4` | green |
| [3](https://github.com/taouani/sf-orglens/actions/runs/43281590603) | read | `88cedd4` | red: the step still failed for a partial snapshot |
| [4](https://github.com/taouani/sf-orglens/actions/runs/43298352099) | read and probe | `d022241` | green, with a warning for the partial snapshot |

Run 1 was the first login of the workflow and read nothing.

## 1. The deploy of the fixture project

- Salesforce accepted the fixture project on the first try: 52 components counted, 52 deployed, 0 errors, all 52
  new in the org. The deploy took 16 seconds, the step 17. `[run 2]`
- No Apex test was run. The twelve classes and the trigger compiled, which is the first time the Apex of the
  fixture project met a compiler. `[run 2]`
- Nothing in `fixtures/billing-sfdx` had to be changed for it.

## 2. The first real snapshot

| Measurement | Run 3 | Run 4 |
| --- | --- | --- |
| Time in all | 197.0 s | 120.0 s |
| Login | 0.4 s | 0.4 s |
| Asking what the org holds, 339 requests | 6.9 s | 8.0 s |
| Retrieving it, 2 chunks | 189.7 s | 111.6 s |
| The first chunk, 896 components of 55 types | 175.2 s | 95.3 s |
| The second chunk, 472 components of 7 types | 14.1 s | 15.6 s |
| Requests to the Metadata API in all | 387 | 371 |
| Largest memory of the process | 402 MB | 408 MB |

What the org holds was the same in both runs:

| Measurement | Value |
| --- | --- |
| Metadata types the org describes | 334, of which 77 hold a component or have a listing that is not ok |
| Components the org listed | 1,668 |
| Of them retrieved | 1,445 |
| Retrieved without being listed | 3,506 |
| Components of a package with a namespace | 77 |
| Files | 5,010, together 14.6 MB |

`[run 3]` `[run 4]`

- **The time of a retrieve is the time Salesforce takes to build the zip file.** The same chunk took 175 seconds
  in one run and 95 in the next, an hour and a half later. The requests in between are polls. The engine has no
  influence on it, and one measurement says little.

- **A Developer Edition org that "holds nothing but the fixture project" holds about 1,600 components of its
  own.** The fixture project is 52 of the 1,668. The largest types are `CustomObject` (394 listed, the standard
  objects among them), `ListView` (224), `SharingRules` (208), `Settings` (197), `Layout` (166), `CustomField`
  (56), `Profile` (44).
- **The two chunks were very unequal.** The first held 896 components of 55 types and took between 95 and 175
  seconds. The second held 472 components of 7 types and took about 15 seconds. Neither had to be started again
  or split.
- **Most of what came back was never listed.** 3,506 components came back that no listing had named, in four
  types: `CustomField`, `CustomFieldTranslation`, `LightningComponentBundle` and `RecordType`. 3,983 of the 5,010
  files are under `objects`. A retrieve of a standard object hands out its standard fields, which no listing of
  `CustomField` names.
- **The snapshot was "partial".** The org did not hand out 223 of the components it listed, in 15 types. The
  listing of one type, `ContentWorkspace`, failed with `INVALID_FIELD`. `StandardValueSet` cannot be listed at
  all. None of this touches the fixture project.

| Type | Listed | Retrieved |
| --- | --- | --- |
| ListView | 224 | 53 |
| Report | 30 | 6 |
| StandardValueSetTranslation | 34 | 32 |
| LightningComponentBundle | 7 | 0 |
| ContentWorkspacePermission | 3 | 0 |
| MatchingRule | 3 | 0 |
| CustomObject | 394 | 392 |
| CustomField | 56 | 54 |
| Dashboard | 2 | 0 |
| RecordType | 2 | 0 |
| ReportFolder | 8 | 7 |
| CustomLabels | 1 | 0 |
| EmailFolder | 1 | 0 |
| InstalledPackage | 1 | 0 |
| WorkflowFlowAutomation | 1 | 0 |

- Salesforce made 9 remarks about the retrieves, for 223 components it did not hand out. For most of them it
  says nothing. `[run 3]` `[run 4]`
- Three files of what the org handed out could not be read as metadata (`RESOLVE_FAILED`). They lie one level
  deep in a folder that is not a folder of the source format as the Salesforce library knows it. The library
  says that the file belongs to no metadata type that is known. `[run 4]`

## 3. What Salesforce rewrites in the fixture project

All 52 components of the fixture project were listed and came back, in 65 files. 17 files are the same byte for
byte as in the repository. 48 differ. `[run 3]`

| Files | How the file from the org differs |
| --- | --- |
| The 12 classes and the trigger | One byte less: the line end at the end of the file is gone. |
| The two custom objects | The org adds about 4,800 bytes of elements to each: `actionOverrides` with `actionName`, `type` and `formFactor` (30 overrides), `enableActivities` and `enableSearch` (one of the two objects), `enableBulkApi`, `enableFeeds`, `enableHistory`, `enableLicensing`, `enableReports`, `enableSharing`, `enableStreamingApi`, `externalSharingModel`, `compactLayoutAssignment`, `allowInChatterGroups`, `searchLayouts`, `visibility`. |
| Every field of a custom object | The org adds `trackTrending`. |
| Formula fields of a custom object | The org also adds `required` to 8 of the 9, and to 5 of them `externalId` and `unique`. The ninth, a formula that gives a checkbox, gets `trackTrending` only. |
| Number and text fields of a custom object | The org also adds `externalId` and `unique`. |
| Fields on `Account` | The org adds `trackFeedHistory`, and for the number field `externalId` and `unique`. |
| One formula field on `Account` | The same elements, in another order or with other values. The file from the org is 10 bytes longer, which fits its two quotes written as `&apos;`, so the elements most likely stand in another order. `[unverified]` |
| Two of the six validation rules | Only how characters such as quotes are written differs (`'` and `&apos;`). |
| The other four validation rules and 13 more files | The same byte for byte. |

What follows for the engine:

- **A comparison of an org with a repository cannot compare bytes, and cannot compare elements one by one
  either.** The org adds elements with default values to almost every object and field. A comparison has to
  know which elements are defaults, or compare what the elements mean. This is work for the comparison engine of
  a later phase, and the fixture project now gives it a real case.
- **A reference extracted from a file of the org and from the file of the repository must be the same.** The
  differences above are in white space, in added defaults, in the order of elements and in how a character is
  written. None of them changes a formula or a line of Apex, so the pairs of the answer key should hold for
  both. This is not tested: the engine has no parsers yet. `[unverified]`
- **Line and column positions in Apex are the same** in both, because only the end of the file differs.
- **Line positions in the files of fields and rules are not known to be the same, and most likely are not.**
  The key records a line for these files too. The org adds elements to 30 of them and changes the order in at
  least one. Where an element is added above a formula, the line of the formula moves. The run compares bytes
  and elements, not lines. `[unverified]`

## 4. The components the org lists and does not hand out

Run 4 describes them without a name: how many, of which package state, how their names are built, and whether
the object or the folder they belong to came back. `[run 4]`

| Type | Missing | What the run says | Reason |
| --- | --- | --- | --- |
| ListView | 171 of 224 | Unmanaged. Every name is `object.view`, and every one of the objects came back. | A part: the engine asks for the object, not for the view. Why 53 come back and 171 do not is not known. |
| Report | 24 of 30 | Unmanaged. Every name is `folder/report`, and every one of the folders came back. | Not known. |
| LightningComponentBundle | 7 of 7 | All of an installed package. 7 bundles came back that were not listed, 5 of them under the same name without the prefix of the package. | The listing names a bundle of a package with its prefix, the retrieve hands it out without. For 2 of the 7 no such twin was found. |
| ContentWorkspacePermission | 3 of 3 | No package state. | Not known. |
| MatchingRule | 3 of 3 | Unmanaged. Every name is `object.rule`, and the objects came back. All 7 `MatchingRules` came back. | A part, as the list views. |
| CustomField | 2 of 56 | Unmanaged. What stands before the dot is not in the list of objects. | A part. The fields belong to something the org does not list as an object, and the engine asks for that parent as a `CustomObject`. Which it is, is not known. |
| RecordType | 2 of 2 | Unmanaged. What stands before the dot is not in the list of objects. One record type came back that was not listed, of an object that came back. | As for the fields. |
| CustomObject | 2 of 394 | Two remarks: an entity of the type `CustomObject` "cannot be found". | Two objects are listed and cannot be retrieved, if the two remarks are about them. They may also be about the parents the engine asked for because of the fields and the record types above. The counts match, no name ties them. `[unverified]` |
| Dashboard | 2 of 2 | Unmanaged. Name `folder/dashboard`, the folders came back. | Not known. |
| StandardValueSetTranslation | 2 of 34 | Two remarks: unable to retrieve the file, with the words "the language" and "supported". | Most likely a language the org lists and does not support for this type. The word between the two is not shown, so "not supported" is a reading. `[unverified]` |
| EmailFolder, ReportFolder | 1 each | The name is `unfiled$public`. | The folder of unfiled items is listed and is not a folder that can be retrieved. |
| InstalledPackage | 1 of 1 | One remark: "cannot be found". | The org lists a package it cannot retrieve. Why, the remark does not say. |
| CustomLabels | 1 of 1 | No package state. | Not known. An org without a custom label may list the type and hand out nothing. `[unverified]` |
| WorkflowFlowAutomation | 1 of 1 | Unmanaged. | Not known. Most likely a part of `Workflow`, as the list views are of an object. `[unverified]` |

- **179 of the 223 are parts that the engine never names in a retrieve**: 171 list views, 3 matching rules, 2
  fields, 2 record types and, most likely, the 1 workflow automation. The engine asks for a part through its
  parent (`packages/engine/src/sources/chunks.ts`): it named 1,368 of the 1,668 listed components, 896 in the
  first chunk and 472 in the second. Fields and validation rules come back with their object. Most list views
  do not. **The hypothesis** `[unverified]`: Salesforce hands out some kinds of part only when the part is
  named. It can be tested by naming the list views of one object in a retrieve.
- **For 12 more the run gives a reason or a remark**: 5 bundles and 2 folders with a reason, 2 objects, 2
  translations and 1 package with a remark of Salesforce that says little.
- **32 are not explained**: 24 reports, 2 dashboards, 3 `ContentWorkspacePermission`, 2 bundles and the custom
  labels. Reports and dashboards are not parts. The engine asks for them by name, in their folder, and the
  folders came back.
- **Four remarks, of two forms, could not be tied to a component**: "You do not have the proper permissions to
  access" (twice) and "Not a ... type" (twice). The words in between are not shown, by the rule of the public
  log. They may belong to components of the lines above.
- **The other way round, 3,506 components came back that were not listed.** 3,472 are fields of the form
  `object.field` whose object came back. That these are the standard fields, which no listing names, is a
  reading of the count: the run does not say it. 26 are translations of fields, 7 are the bundles above, 1 is a
  record type.

What follows:

- **A snapshot of this org is "partial" on every run today.** One Developer Edition org was read twice, so
  this is not shown for every org. The word was meant for a retrieve that failed.
  Here it also covers components that Salesforce lists and never hands out, and that will not change with a
  second try. What "complete" should mean is a decision for the maintainer. It is not made here.
- **A listed component and a retrieved component are matched by type and full name.** For a bundle of a package
  that is not enough. The inventory row of the listing holds the prefix, so the two can be joined. This is not
  changed in Phase 0: the rule for it belongs to the decision above.
- **The step that reads the org cannot be red for a partial snapshot.** It was, on its first run. It now fails
  when the snapshot does not end or when the fixture project is not whole in it.

## 5. The Dependency API

One query without a filter gave 224 rows, which is under the limit of 2,000 rows of one query. The queries per
type gave the same rows. No query failed, also not the one with `NOT IN`. 29 requests in 7 seconds, with the
symbol tables. `[run 4]`

| Type that refers | Rows |
| --- | --- |
| Layout | 93 |
| ApexClass | 92 |
| CustomField | 15 |
| ValidationRule | 10 |
| CustomApplication | 9 |
| ApexTrigger | 2 |
| LookupFilter | 1 |
| PromptVersion | 1 |
| WebLink | 1 |

117 rows are between two components of the fixture project. The other 107 have at least one end that is not a
component of the answer key: 82 from a layout to a custom field, 11 from a layout to a button or link, 9 from an
application to a page, 2 from a class to a standard entity, 1 each from a lookup filter to a custom field, from
a button or link to a custom field and from a prompt to a quick action. **These 107 were counted and not
checked.** Some of them start or end at the fixture project: a layout of the org can show a field of it, and the
2 rows from a class may start at classes of it. The run names neither end of such a row.

**Against the answer key.** The key holds 137 pairs of a component and a component it refers to. A pair is
"reported" when the API has a row from the one to the other. The API reports 100 of them. `[run 4]`

| From | To | In the key | Reported |
| --- | --- | --- | --- |
| ApexClass | CustomField | 70 | 58 |
| ApexClass | CustomObject | 11 | 11 |
| ApexClass | ApexClass (`extends`) | 1 | 1 |
| ApexClass | a standard object | 4 | 4 |
| ApexClass | a standard field | 9 | 0 |
| ApexTrigger | CustomObject | 1 | 1 |
| CustomField | CustomField | 19 | 15 |
| CustomField | CustomObject | 1 | 0 |
| CustomField | a standard object | 3 | 0 |
| CustomField | a standard field | 7 | 0 |
| ValidationRule | CustomField | 11 | 10 |

The 37 pairs that are missing have six causes, and no pair is missing without one:

| Cause | Pairs | What the API does |
| --- | --- | --- |
| The target is a standard field, for example `Name`, `CreatedDate`, `OwnerId`, `Contact.Email` | 16 | It has no row to a standard field, from Apex, from a formula or from a lookup filter. A standard object is reported, as `StandardEntity`. |
| The name of the field stands in text: a query built as a string, `get` and `put` by name | 11 | It does not read text. |
| A field that a class names only through a token kept in a constant of another class, and in a describe call (`Schema.SObjectType.Invoice__c.fields.Amount__c`) | 1 | It reports the token for the class that holds the constant, not for the class that uses it. It has no row for the describe call either, which stands in the class itself. |
| The target of a lookup field, and the key and the summarised field of a roll-up summary | 7 | It has no row for what a lookup points to, and none for a roll-up except for the field in its filter. |
| A lookup filter | 1 | It has no row from the field with the filter to the field the filter names. One row from a `LookupFilter` to a custom field is among the 107: most likely the API reports the filter as a component of its own. The run names neither end. `[unverified]` |
| A validation rule that is not active | 1 | It has no row for it. The 10 pairs of the 5 active rules are all reported. |

- **Static references from Apex to a custom field are reported with one exception**: 58 of the 59 pairs that
  the key has in a query, a search, a field access, a DML statement or a token. The exception is the pair of the
  table above: `DynamicAccess` names `Invoice__c.Amount__c` twice through a token of another class and once in a
  describe call, and the API has no row for it. Of the custom objects, 10 of the 10 that a class names outside
  text are reported, and the object of the trigger. The formulas of fields and of active rules that name custom
  fields are all reported: 24 of 24.
- **Of the 117 rows between two components of the fixture project, none is wrong.** 17 pairs are reported that
  the key does not hold. 9 are references from a class or the trigger to another class, which the key leaves
  out by its own rules (`fixtures/README.md`). 8 are from a class to an object that the class uses as a type,
  or that a relationship in a query or in a field access leads to. Each was read against the code of the
  fixture project, and each is a true dependency. The API does not report every use as a type: one class names
  an object only after `when` in a `switch`, and has no row to it.
- **Between two components of the fixture project, the four fields the key calls unreferenced have no row.**
  Whether a layout of the org shows one of them was not looked at.
- **What a row is.** A row names two components. It does not say which method refers, where in the file, how
  often, or whether the field is read or written. A field comes without its object: the id of the row has to be
  looked up in `CustomField`. With that the org gave a name for 310 of the 448 ends of the rows, and no pair had
  to be matched by the name of a field alone.
- **A pair can be reported for another reason than the one the key has.** The key has `InvoiceSelector` name
  `Invoice__c` in text only. The pair counts as reported, most likely because the class also uses the object as
  a type. Of the 12 pairs whose best tier is "probable", this is the 1 that is reported.

**Verdict: usable for field-level verification of custom fields, within known limits.** The plan asked for one
of three answers: usable for field-level verification, usable at component level only, or not usable. The target
of a row is a field, so the first answer holds for the target. The source of a row is a component: a class, not
a method.

- Usable for: custom fields and custom objects as targets; Apex classes, triggers, formula fields and active
  validation rules as sources. For a custom field, a pair the API has and OrgLens does not is a reference
  OrgLens missed. For a custom object it can also be a use as a type, which OrgLens does not count as a
  reference today.
- Not usable for: standard fields, names in text, a field named only in a describe call or through a token of
  another class, lookups and roll-up summaries, inactive rules, the method and the place of a reference, read
  against write. For these the answer key and the public codebases are the only measure.
- Not measured: flows, layouts, pages, components and every other type the fixture project does not hold yet.
  An org above the limit of 2,000 rows. The tool asks per type and per pair of types there, which the mock org
  tests and this org did not need.

## 6. The symbol tables of the compiler

`ApexClass.SymbolTable` was asked for the twelve classes of the fixture project, by name, in one query that took
1.4 seconds. `[run 4]`

- **Every class has a symbol table**, less than two hours after the deploy and without a compile started by the
  tool.
- **No symbol table holds a reference.** The arrays `references` are empty everywhere (0 entries in 12 tables),
  and `externalReferences` is empty for every class, also for the classes that call another class of the
  project.
- **No name of a custom field of the fixture project stands anywhere in a symbol table.** The tool looks for
  those names. It leaves out `Invoice__c`, the field that is named like the object, and it does not look for
  standard fields. A name of a custom object stands in 47 places, all of them the type of a variable, of a
  parameter or of a return value.
- **What it holds are declarations**: 58 methods with their parameters, 12 properties, 105 variables, 4 inner
  classes, the parent class. The fields of a table are `constructors`, `externalReferences`, `id`,
  `innerClasses`, `interfaces`, `key`, `methods`, `name`, `namespace`, `parentClass`, `properties`,
  `tableDeclaration` and `variables`.
- **The compiler drops the arguments of a generic type.** A method that returns `List<Invoice__c>` is written
  with the return type `List`, a parameter `Map<Id, SObject>` as `Map`. An inner type loses its outer name:
  `Database.BatchableContext` is written `BatchableContext`, while `Database.QueryLocator` and
  `Schema.SObjectField` keep theirs.
- **A trigger has no symbol table to ask for**: the query fails with `INVALID_FIELD`.

**Verdict: not usable.** Of the three answers the plan asked for, this is the third. The symbol table of a saved
class says what the class declares, not what it uses. It could check the declarations an Apex parser finds:
the methods of a class and their parameters, with the limits above.

A symbol table with references can be had by compiling a copy of a class in the org (`ApexClassMember` in a
`MetadataContainer`). That writes to the org and needs the permission to author Apex. Decision record 0033 and
the data rules allow no write but the deploy of the fixture project, so it was not tried. Whether such a table
names fields is not known. `[unverified]`

## 7. What this changes

- **Decision A4 of the plan** names two cross-checks from Salesforce for Apex: the Dependency API and the
  compiler symbol data. The first holds, within the limits of section 5. The second does not, as the org stores
  it. **The maintainer decided on 12 November 2026: the Dependency API alone is the cross-check for Apex.** The
  compile in the org is not tried. The decision is written into the overall plan and into the records that
  name the symbol data when Phase 0 is closed: [0008](../../adr/0008-reference-sources-and-provenance.md),
  [0009](../../adr/0009-one-ingestion-path.md) and [0021](../../adr/0021-correctness-proof.md), each by a new
  record where the record says so. [0018](../../adr/0018-apex-analysis-foundation.md) is completed with the Apex
  trial.
- **Risk 6 of the plan** (the Dependency API is incomplete or limited on large orgs) is real for the first half
  and now has a list. The coverage a snapshot reports has to say for each reference whether Salesforce could
  have confirmed it. The second half was not measured: this org is small.
- **The correctness gate** cannot lean on Salesforce for standard fields and for names in text. Recall there is
  measured against the answer key and against public codebases only.
- **The fixture project needs no change.** It deployed as written, and the Dependency API contradicts no entry
  of the answer key.
- **Open, for the phase that builds the reading of an org in full**: whether a part such as a list view has to
  be named in a retrieve; why reports and dashboards do not come back; the bundle of a package that is listed
  with a prefix and handed out without; the three files the engine could not read as metadata; what "complete"
  means for a snapshot.
- **Open, for a later phase**: how the Dependency API behaves above 2,000 rows on a real org. The tool asks per
  type there. This org never came near the limit, so that path ran against the mock org only.
- **The logs of the runs are kept by GitHub for a limited time.** The numbers here were read from them on the
  day of the runs. The list of the 137 pairs is not copied here. It can be made again by a run of the step
  `probe`.
