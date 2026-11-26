# real-org, with the fixture project of Phase 3

What the run against the test org showed after the fixture project grew from 120 to 148 components with the Apex,
the Lightning components, the pages and the named credential of Phase 3, recorded on 26 November 2026. The run is
run 31 of the workflow "Live org" (`.github/workflows/live-org.yml`), with the steps "deploy and read", on `main` at
the commit of pull request 106. Its log is public. Every number of the org here is taken from that log, and the
numbers of the project from its files. Nothing was read from the org in another way, and no file of the org was
kept.

The notes of the earlier phases, [of Phase 0](../phase-0/real-org.md), [of Phase 1](../phase-1/real-org.md) and
[of Phase 2](../phase-2/real-org.md), describe the org, the steps and the earlier runs. This note says what is new.
Claims are marked `[run 31]` with the run they come from, `[my reading]` where they rest on my reading of the code
or the files, or `[unverified]`.

In short:

- **Salesforce accepted the deploy of all 148 components at the first attempt**, with no error. The 15 new classes
  and the new trigger compile, and the named credential, the external credential, the two pages, the Aura
  component, the two Lightning web components and the number field `Account.Invoices__c`, which has the name of a
  child relationship, are taken as they are. Nothing had to be corrected.
- The org lists and hands out all 148. The cross-check of the engine compared 139 rows, and the analysis missed
  none.
- The Dependency API reports 185 of the 244 pairs of the answer key for the entries of Phase 3, and 109 of the 147
  of them that key v2 does not hold.
- **From Apex to a field it reports every pair where the code names a custom field (91 of 91), none where only a
  text names the field (0 of 21), and no standard field (0 of 24).** Nothing that Apex names only in a text is
  reported: 0 of 25 pairs, among them the record of a custom metadata type and the field set.
- **In the one case of each that the fixture has, it reports a call to the class the code names, and not to the
  class that defines an inherited method or that overrides a virtual one.** It reports 14 of the 15 pairs of calls
  from a class, the 2 of `implements`, both of `extends` and 50 of the 51 of uses as a type.
- **Of a Lightning web component it reports every import and the tag of another component, and of an Aura
  component its controller, a label, the object of an attribute and a tag. It reports no field that an attribute
  names**: neither the `field-name` of `lightning-output-field` (0 of 2) nor the `fields` of `force:recordData`
  (0 of 3). Of a page it reports the controller, the extensions and the standard controller (4 of 4).
- **It reports nothing of the callout and of the named credential**: neither the class that calls
  `callout:Billing_Gateway` to the named credential, nor the named credential to its external credential.
- **It reports what a merge field of a page and the path of an attribute in an expression of an Aura component
  name**, which Phase 3 does not read (record
  [0079](../../adr/0079-lightning-components-and-visualforce-pages-in-phase-3.md)). The key has a negative with
  `until: 3` at both places. Pass mark 3 of the plan asks that no pair the API reports from a page or a component
  be missing, for the kinds this run shows that it reports. As the plan stands, that mark cannot be met for these
  pairs. It is a question for the maintainer before work package 7 (section 7).
- **The rows from Apex, the components and the pages have to stay out of the comparison until work package 7
  builds their cross-check.** Once a type is analysed its rows are compared, and the readers of work packages 3
  and 6 alone find too little of what the API reports (section 7).
- **A snapshot holds no child relationship of a standard lookup.** It holds 31 standard fields each of `Account`
  and `Contact`, and 3,472 files of standard fields of all objects, and not one of them names a relationship. The
  name `Contacts` stands in one file of metadata of the org, as the text of a `field` and of a `label` element. The
  files alone do not give these names. By the answer of the maintainer to Q2 of the plan, a snapshot is to ask the
  org to describe every object (work package 4). That a description names the child relationships of the object is
  not verified: no tool asks for one yet.

## Conditions

- The same org as before: one Developer Edition org, API version 68.0. No other edition, no sandbox, no org with
  person accounts and no org with a namespace of its own was measured.
- The run deployed the fixture project of key v3 and then read the org once. The steps "draft" and "probe" were not
  run, so the symbol tables were not asked for. After the deploy no flow of the org has an active version that is
  not its latest `[run 31]`.
- The numbers of pairs are of the answer key `fixtures/expected/answer-key.v3.yaml`. An end of a row is matched to a
  component by the id the org listed it with, as in the notes of Phase 2. The cross-check of the engine matches a
  row from a flow by its version instead.

## 1. The deploy

The deploy ended as `Succeeded` after 51 seconds. Salesforce counted 148 components, deployed 148 and found errors
in 0. Of them it called 28 new in the org, 22 changed and 98 as they were `[run 31]`. The log does not say which 22
changed. No Apex test was run.

Salesforce saves no Apex that does not compile, so the 16 new files of Apex compile, and so do the 14 that were
there `[my reading]`. The pull request of the fixture said that whether Salesforce accepts a number field named
`Invoices__c` beside the child relationship `Invoices__r` was not tried: it does.

The deploys of Phases 1 and 2 needed corrections before Salesforce took them. This one needed none.

## 2. What the org hands out

The org lists the 148 components of the project, and the snapshot holds all of them and all of their 177 files
`[run 31]`. Of the files, 55 come back the same byte for byte and 122 differ. The log shows 80 of the 122:

- The 28 classes, 6 files of the Lightning web components, 3 files of the Aura component and the body of the email
  template come back with one byte less: only white space at the end of a line or of the file differs. Lines and
  columns do not change by this. The files of the triggers and the pages are among the 42 that the log does not
  show.
- The files of objects, fields, flows and records of custom metadata that it shows come back with elements the org
  adds, as in Phase 2, except three: two fields of `Billing_Rule__mdt` come back without `externalId`, and
  `Account.Is_Key_Account__c` with the same elements in another order or with other values. The new platform event
  field `Invoice_Paid__e.Invoice_Id__c` comes back with `isFilteringDisabled`, `isNameField` and
  `isSortingDisabled`.

The types of the new components are listed and handed out: `ApexPage` 2, `AuraDefinitionBundle` 1,
`LightningComponentBundle` 9 (7 of them of a package, which come back without its prefix), `NamedCredential` 1 and
`ExternalCredential` 1 `[run 31]`. The snapshot is partial, as in run 30, for the same 6 components outside the
project (the errors `NOT_RETRIEVED`). The warnings `NOT_RETRIEVED`, for components outside the logic tier, cover
about 216 components against 215 in run 30: the org lists 8 components of `WorkflowFlowAutomation` and hands out
none, against 7 in run 30, one for each flow `[my reading]`. The fixture project is whole in the snapshot.

## 3. The pairs of the entries of Phase 3

The key holds 244 pairs of a component and a component it refers to for the entries of Phase 3. Of them, 147 are
not in key v2: the others are the pairs of the Apex that was there before Phase 3, which versions 0 to 2 of the key
already had, and the pair of the flow of Phase 2 and its invocable action. Two pairs have entries of Phase 2 as
well, the pairs of a flow and a class, and are counted in both phases.

| From | Pairs | Reported | Not in key v2 | Of them reported |
| --- | --- | --- | --- | --- |
| Apex class | 213 | 161 | 118 | 87 |
| Apex trigger (two) | 7 | 6 | 6 | 5 |
| Visualforce page | 4 | 4 | 4 | 4 |
| Aura component | 7 | 4 | 7 | 4 |
| Lightning web component | 10 | 8 | 10 | 8 |
| Flow | 2 | 2 | 1 | 1 |
| Named credential | 1 | 0 | 1 | 0 |
| **All** | **244** | **185** | **147** | **109** |

These are my sums of the table of the log by the type that refers and the type referred to. By kind, as the log
gives them `[run 31]`, where a pair is counted under every kind the key has for it:

| From | Kind | Pairs | Reported | Not in key v2 | Of them reported |
| --- | --- | --- | --- | --- | --- |
| Apex class | `calls` | 15 | 14 | 15 | 14 |
| Apex class | `extends` | 2 | 2 | 1 | 1 |
| Apex class | `implements` | 2 | 2 | 2 | 2 |
| Apex class | `reads` | 141 | 100 | 65 | 43 |
| Apex class | `references` | 22 | 16 | 13 | 9 |
| Apex class | `uses-type` | 51 | 50 | 39 | 38 |
| Apex class | `writes` | 51 | 42 | 17 | 13 |
| Apex trigger | `calls` | 2 | 1 | 2 | 1 |
| Apex trigger | `reads` | 3 | 3 | 3 | 3 |
| Apex trigger | `triggers-on` | 2 | 2 | 1 | 1 |
| Apex trigger | `uses-type` | 1 | 1 | 1 | 1 |
| Apex trigger | `writes` | 1 | 1 | 1 | 1 |
| Visualforce page | `references` | 4 | 4 | 4 | 4 |
| Aura component | `calls` | 1 | 1 | 1 | 1 |
| Aura component | `references` | 7 | 4 | 7 | 4 |
| Lightning web component | `calls` | 1 | 1 | 1 | 1 |
| Lightning web component | `references` | 9 | 7 | 9 | 7 |
| Flow | `calls` | 2 | 2 | 1 | 1 |
| Flow | `writes` | 1 | 1 | 1 | 1 |
| Named credential | `references` | 1 | 0 | 1 | 0 |

### Apex

From Apex to a field, by how the code names the field, by my count of the pair lines of the log:

| How the field is named | Pairs | Reported |
| --- | --- | --- |
| A custom field in the code: a field of a record, a query, DML, an assignment | 91 | 91 |
| A custom field by a token of the class itself (`InvoiceConstants`) | 2 | 2 |
| A custom field by a token of another class and a describe call (`DynamicAccess`) | 1 | 0 |
| A custom field only in a text: a query built at run time, a name in a string | 21 | 0 |
| A standard field, in any way | 24 | 0 |

Phase 1 saw the same on the Apex of that time: none of the 9 pairs to a standard field, and of 12 pairs to custom
fields it lacked, 11 named in a text and 1 through the token of another class (finding 5 of the plan). The fixture
of Phase 3 makes the texts many more: the query built with `+=`, from joined clauses, from a parameter, from another
method, from a record of custom metadata and from a field set, and the texts given to `Database.countQueryWithBinds`
and `Search.query`. The Dependency API reports none of them, nor the record of the custom metadata type, the field
set and the object `Tax_Code__c`, which those texts name. `Tax_Code__c` stands only in the text of the search.

The pairs it does not report beyond these:

- `TriggerHandler` to `InvoiceTriggerHandler`: the base class calls its virtual methods, and the key has each
  override as a `probable` call. The API reports no pair from this class to the one that extends it.
- The trigger `InvoiceTrigger` to `TriggerHandler`: the trigger calls `run()`, which `InvoiceTriggerHandler`
  inherits. The API reports the trigger to `InvoiceTriggerHandler`, which the trigger creates, and not to the class
  that defines the method. The other calls of an inherited method in the fixture (`StandardPricing`,
  `InvoicePricingTest`) are pairs the API reports anyway, through `extends` or a use as a type.
- `ParserTorture` to `Invoice_Line__c`: the object stands only as the type of a `when` in a `switch` on a type.
- `InvoiceCalloutService` to the named credential `Billing_Gateway`, which the class names in the text
  `callout:Billing_Gateway/invoices`.

### Lightning web component, Aura component and pages

| Component | Reported | Not reported |
| --- | --- | --- |
| `invoiceSummary` (Lightning web component) | the Apex method it imports, the 3 fields, the label and the custom permission it imports, the object, the component of its tag | `Due_Date__c` and `Status__c`, named in `field-name` of `lightning-output-field` |
| `invoicePanel` (Aura component) | the controller, the label of `{!$Label.c.Overdue_Notice}`, the object of an attribute of type `Invoice__c`, the component of its tag | `Name`, `Amount__c` and `Account__c` of `force:recordData` |
| `InvoiceDetail`, `InvoiceList` (pages) | the controller, the extension of each, and the standard controller `Invoice__c` | nothing |

The Dependency API reports the Apex method of an import as a pair to its class. The call `component.get('c.pay')`
in the JavaScript of the Aura component is a pair to the same class as its controller, so the two are one pair.

### What it reports and the key does not hold

The Dependency API reports 8 pairs from the types of Phase 3 that the key does not hold `[run 31]`. Six are named:

- `InvoiceBatch` to `Account` and to `Contact`, and `InvoiceLineService` to `Account`: the objects that a path
  across relationships reaches, `Account__r.Primary_Contact__r.Email` and `Invoice__r.Account__r.Tier__c`. The key
  holds the lookups and the field at the end of each path, and not the objects they pass. Phase 1 saw such pairs
  too (finding 5 of the plan). The cross-check meets a row to an object by a reference from the same component to
  a field of that object (`engines/cross-check.ts`), and the key holds a field of each: `Account.Primary_Contact__c`,
  `Contact.Email` and `Account.Tier__c` `[my reading]`.
- The page `InvoiceList` to `Invoice__c.Amount__c` and to `Invoice__c`: the merge field `{!invoice.Amount__c}` of a
  column, and the object of the records of the table. The log gives no place: that the pair to the object comes from
  the merge fields is my reading. The merge field `{!invoice.Name}` beside it, a standard field, is not reported.
- The Aura component `invoicePanel` to `Invoice__c.Status__c`: the expression `{!v.invoice.Status__c}` that it hands
  to the badge. The expression `{row.Status__c}` of the Lightning web component is not reported.

The key has a negative with `until: 3` at each of these places of the page and the component: they hold for the
analysers up to Phase 3, and a later version of the key may hold the references (record 0079). The run shows that
Salesforce counts them as references.

The other 2 pairs have a component that is not of the fixture project, and the log does not name them. The log
counts 166 rows from classes and 7 from pages. The pairs named above account for 164 and 6 of them. The others are
the 2 pairs that are not named, or rows with an end the tool matches to nothing it can name `[my reading]`.

## 4. The pairs of the entries of Phase 2

The 164 pairs of run 30 have the same state as in that run: 78 reported `[run 31]`, by my comparison of the pair
lines of the two logs. The 7 new pairs of Phase 2, of the record `Billing_Rule.Invoice_Late_Fee` and of the flow
`Invoice_Object_Name`, add 3 reported: the record to its type, the flow to its object, and the flow to the class of
its generic action. The record to the two fields of its type it gives values to, to the object and to the field
its values name is not reported, as for the other records in Phase 2. So there are 81 of 171.

## 5. The cross-check

- 545 rows, read with 26 requests, and no answer shows that a row is missing. Read once more with every answer cut
  off at 30 rows, the reading is whole and gives the same rows `[run 31]`.
- The org named the versions of 8 flows. Versions that are neither active nor the latest: 8, of the same 4 flows as
  in run 30 (`Invoice_After_Save`, `Invoice_Before_Save`, `Invoice_Recalculate`, `Invoice_Review_Screen`), which had
  4. Each of them has one more, though its file has not changed since 23 November 2026. The other flows have none.
  Rows from these versions, which are not compared: 108, against 54 in run 30 `[run 31]`.
- Rows not compared, from a type that is not analysed: 298, of them 166 from Apex classes, 6 from the two triggers,
  7 from pages, 5 from the Aura component and 8 from Lightning web components.
- Rows compared: 139 pairs (run 30: 136). The analysis has 136, has 3 through a field of the object Salesforce
  names, and missed 0 `[run 31]`. The 3 more pairs are the 3 new pairs of Phase 2 that the API reports
  `[my reading]`.

## 6. What a snapshot holds of Account and Contact

| Object | File of the object | Standard fields | Custom fields | Fields that name a relationship | Other files |
| --- | --- | --- | --- | --- | --- |
| `Account` | yes | 31 | 14 | 1 | 7 |
| `Contact` | yes | 31 | 2 | 0 | 6 |
| `PersonAccount` | no | 0 | 0 | 0 | 0 |

`[run 31]`. Seven of the custom fields of `Account` are of the fixture project. The one field that names a
relationship is the custom lookup `Primary_Contact__c` of the project: it is the only field of `Account` in the
project with a `relationshipName`, and no standard field has one `[my reading]`.

- The snapshot holds 3,472 files of standard fields of all objects. The org lists 84 fields and hands out 3,472
  that it did not list, as many as there are files of standard fields `[run 31]`. None of them names a relationship
  (`relationshipName`).
- The child relationship `Contacts` of the standard field `Contact.AccountId`, as the whole text of an element of a
  file of metadata, stands in 1 file, which is not of the fixture project, as a `field` and a `label` element. It
  stands in no `relationshipName` and in no `relationship` of a report type.
- As a word in another file it stands in 1 file of the fixture project, in the folder `classes`. That is the class
  `AccountInvoices`, the only file of the project that holds it `[my reading]`.

So the files of a snapshot give the standard fields of `Account` and `Contact`, but not that `Contacts` is the child
relationship of `Contact.AccountId`. The plan asked for this count because the resolver must tell `acc.Contacts`
from a field (finding 2). By the answer of the maintainer to Q2, a snapshot is to ask the org to describe every
object it holds a file of (work package 4). This run shows that the files alone would not give the names. Which
names a description gives was not measured: no tool asks for a description yet.

## 7. What follows for the work packages

- **Work package 1.** The note meets the four conditions of the plan once it is merged: Salesforce accepted the
  deploy and the Apex compiles, with nothing to correct; `fixture-key.test.ts` passes with key v3 and the older keys
  (the checks of pull request 105, not this run); this note records the run, with the pairs by kind and by the type
  that refers; and the pull request of the fixture and the key is merged, while work package 3 has not started.
  The maintainer accepts the work package.
- **Rows stay out of the comparison until work package 7.** The rows from a type are compared as soon as an
  analyser reads the type (`snapshot_analysis.types`). Work package 3 makes classes and triggers analysed with their
  declarations, `extends`, `implements`, `uses-type` and `triggers-on` only. Of the 167 pairs from Apex of the
  project that the API reports, 111 have none of those kinds (93 to fields, 15 calls of a class and 3 to an object a
  path passes), by my count of the pair lines. Compared from work package 3 on, each would be `REFERENCE_MISSED`
  and the read step would fail, until work package 4 finds them. The pages and the components of work package 6
  are in the same place until the cross-check of work package 7. Phase 2 did the same for flows: their rows were
  counted and not compared from the work package that analysed them until their cross-check was built (record
  [0060](../../adr/0060-the-active-version-of-a-flow-is-analysed.md)). Work package 3 does this for Apex, and work
  package 6 for the components and the pages.
- **Work package 7 and pass mark 3.** Work package 7 compares the rows from classes, triggers, components and
  pages. Pass mark 3 asks that no pair the API reports from them be missing, for the kinds work package 1 shows that
  it reports. This run shows that the API reports the merge field of a column of a page and the path of an
  attribute in an expression of an Aura component, which answer (a) of Q1 does not read: here the page to a field
  and to its object, and the Aura component to a field. A row to an object is met by a field of the object, and the
  analysis of the page has none. So each of the three would be `REFERENCE_MISSED`, and the mark cannot be met as the
  plan stands. Reading those names is option (c) of Q1, which the maintainer did not choose. Whether to read them,
  to count such rows apart with a reason, or to report the mark as missed is for the maintainer to decide before
  work package 7.
- **Apex in work packages 4 and 7.** Of the named pairs from Apex that the Dependency API reports, the key holds
  all but the 3 to objects that a path passes, which a field of the object meets. An analysis that finds the
  entries of the key would then miss none of the named rows from the Apex of the project `[unverified]`. What the
  2 pairs the log does not name are, and what the analysis finds in the 4 classes of the org outside the project, is
  not known.
- **Callouts.** The Dependency API reports neither the class to the named credential nor the named credential to
  its external credential. Neither pair can be held against Salesforce on the test org.
- **Q2.** The description of the objects asked of the org is needed for the child relationships of standard
  lookups. Nothing else in a snapshot names them.

## 8. What was not measured

- One org of one edition. No org with person accounts, so the row of `PersonAccount` is empty.
- What an org hands out of the Apex of a managed package (the second half of finding 11). The plan says that the
  test org has no package, and so do record 0076, a comment of `engines/cross-check.ts` and the report of Phase 2.
  The org lists one installed package and 77 components with the prefix of a package, 7 of them Lightning web
  components, as in run 30 `[run 31]`. The note of Phase 1 already saw seven bundles of a package. Whether any of
  the 4 classes outside the project is of it, the log does not say.
- The symbol tables of the new classes: the step "probe" was not run.
- The rows from the 4 classes of the org outside the project, and the two pairs of the Phase 3 types that the log
  does not name.
