# 0077. Email templates, report types and quick actions are read, and the folders of email templates stay outside the logic tier

- Status: Accepted
- Date: 2026-11-25
- Decisions: none (it builds the answer of record 0055 in work package 8 of the Phase 2 plan, with what the
  maintainer answered on 2026-11-25 and the choices of the author, which the maintainer can strike)

## Context

The maintainer chose with question Q1 of the [Phase 2 plan](../plans/phase-2.md) that email templates, report types
and quick actions are analysed in Phase 2, as work package 8, and that reports stay in Phase 6 (record
[0055](0055-email-templates-report-types-and-quick-actions-in-phase-2.md)). The plan says what is read: the merge
fields of the subject and the body of a template, in the forms of the classic and the Lightning templates, the
objects a report type joins and the fields it lists, and the field a predefined value of a quick action sets with
the names in its formula. Record 0055 adds, as a conclusion of its author, that the three types join the logic tier
with their analysers (record [0058](0058-a-type-counts-for-complete-once-it-is-analysed.md)), and leaves one choice
to the maintainer: whether the folder of an email template counts.

The maintainer was asked on 2026-11-25 whether a folder of email templates that the org lists and does not hand
out should make a snapshot partial, and answered on the same day: no, folders stay a warning.

An email template is two files. The file of its metadata, `Name.email-meta.xml`, is XML and holds the subject, the
type of the template and, for some, a text version of the body. The body is a file of its own, `Name.email`, which
is no XML: text for a template of the type `text`, HTML for `html` and `custom`, and the markup of a Visualforce
page for `visualforce`. A Lightning template has the `uiType` `SFX` and writes its merge fields as
`{{{Recipient.FirstName}}}`. A report type names its object, the child relationships it joins one inside the other,
and the fields it lists by a table, such as `Invoice__c.Lines__r`, and a field, such as `Account__c.Tier__c`. A quick
action is named after the object whose records it runs on, `Invoice__c.New_Line`, or is global, and names the object
of the records it creates, the values it sets, the fields of its form and the flow, component or page it opens.

## Decision

1. **The body of an email template is read as text in UTF-8**, as the reader of XML reads a file (`readText` in
   `extraction/xml.ts`): a byte order mark of UTF-8 is no part of the text, and one of UTF-16 or UTF-32 is refused.
   `encodingKey` says how Salesforce encodes the email it sends, and not always the file: V4S writes `ISO-8859-1`
   there, and its files are UTF-8, with French in them. So UTF-8 is tried first. Where the bytes are no UTF-8 and
   `encodingKey` is `ISO-8859-1`, the body is read in that encoding, one character to a byte, and no issue is
   raised: the names of merge fields are ASCII. Bytes that are no UTF-8 under any other encoding are the error
   `XML_NOT_UTF8` of that file, and the rest of the template is read all the same. Nothing is read of the body
   where the file of the metadata cannot be read or is not that of an email template (`METADATA_UNEXPECTED`).
2. **A merge field of an email template is `reads`, `via: merge-field`, from the template**, in the subject, in the
   text version and in the body, each with its place in its own file. A merge field of the body stands in no
   element, and an issue about it has no `details.element`. The kind of the template says how merge fields are
   written and what their first name is (`extraction/email-templates.ts`):
   - A classic template (`text`, `html`, `custom`) writes `{!Object.Field}`. The first name is an object. `User` and
     `Sending_User` are the user who sends the email, `Receiving_User` the user who gets it, and `Organization` the
     org. `ApprovalRequest` is the request of an approval, which is no record, and gives no reference.
     `{!Object.Link}` is the link to the record and no field. A lookup field of Salesforce is named by its
     relationship, as in a report type: `{!Case.CreatedBy}` reads `CreatedById`. A field of the owner is written as
     a field of the record, `{!Case.OwnerEmail}`, and reads `OwnerId`: `Owner` and `FullName`, `FirstName`,
     `LastName`, `Email`, `Phone`, `Title` or `Alias`. Only these, as a contract has a field
     `OwnerExpirationNotice` of its own.
   - A Lightning template (`uiType` `SFX`, or `SFX_Sample` for a sample of Salesforce) writes `{{{Name.Field}}}`, and
     one made before Winter '19 `{!Name.Field}`: both forms are read. `Sender` is a user and `Organization` the org.
     The related record is of the object `relatedEntityType` names, and is written with that name. That object is
     a `references`, `via: object`. `Recipient` is a contact, a lead or a user, and nothing says which: its fields
     are not followed, with the warning `PATH_NOT_FOLLOWED`. `Link` is no field here either.
   - A Visualforce template writes `{!relatedTo.Field}` and `{!recipient.Field}`. The objects are the attributes
     `relatedToType` and `recipientType` of `<messaging:emailTemplate>` in its markup, and each is a `references`,
     `via: object`, at its place in the body. Where one is missing, the fields of that record are not followed.
     A first name after the record that ends in `__r` is a relationship of a custom object, and only the model of
     all objects says of which kind. A child relationship, `{!relatedTo.Lines__r}` or `{!relatedTo.Lines__r.size}`,
     is a `references` to the lookup field behind it, as a join of a report type is, and what follows it is no
     field. A relationship to a parent that the snapshot holds, or knows to be outside it, is a path as in a
     formula, and alone, `{!relatedTo.Account__r}`, its lookup field. Any other is not followed, with a warning
     that has no `details.endsAt`, as a child relationship of a report type that is not known.
   - A merge field of the form `{!...}` that holds more than a name, such as `{!IF(ISBLANK(Case.Reason), "", ...)}`
     or `{!TEXT(relatedTo.Amount__c)}`, is read as a formula with plain names whose first names are those of the
     kind (`readMergeFields` with `formula`). One that cannot be read as a formula is not read, with the warning
     `NAME_NOT_READ`.
   - A first name that starts with `$` and that the kind does not know is a global variable, as in a flow:
     `{!$Setup.Settings__c.Limit__c}`. Any other first name is not read, with the warning `NAME_NOT_READ`.
   - The letterhead of a template is a `references` to the `Letterhead`, `via: template`, and each document it
     attaches (`attachedDocuments`, `Folder/Name.pdf`) a `references` to the `Document`, `via: attachment`, by
     its name up to the first dot of the name of its file, as the Salesforce library keys a document (record
     [0071](0071-a-component-that-comes-back-under-another-name.md)).
3. **A report type is a `references` to its object, `via: object`, to the lookup field behind each child
   relationship it joins, `via: join`, and to each field it lists, `via: listed-field`.** A child relationship is
   the one a lookup or master-detail field of the snapshot names (`relationshipName` with `__r`, and the prefix of
   the field where it has one), of the object the field points at, or of its own object for a hierarchy field. Where
   no file names it, 15 that every org has are known (`Contacts` of an account, for one, is `Contact.AccountId`). A
   relationship that two fields name, or that is not known, is not followed. Its warning `PATH_NOT_FOLLOWED` has
   `details.relationship` and no `details.endsAt`: the lookup field behind it can have any name, so the warning
   bears on every answer about what refers to a component (record
   [0074](0074-a-warning-counts-where-it-can-bear-on-the-answer.md)). The table of a column says the object of its
   field: the object of the report type, and the child relationships after it. A column that names a field through
   lookup fields is a `reads` of each lookup field, which a report type names by the field where a formula names the
   relationship, and a `references` to the field at its end. `Owner` is the field `OwnerId`, and a column `Id` gives
   no reference. A table that does not start at the object of the report type is not read (`NAME_NOT_READ`), and
   neither are the columns of a table whose relationship was not followed.
4. **A quick action is a `references` to the object of the records it creates, `via: object`, and to their record type
   (`targetRecordType`, `Opportunity.Donation`), `via: assignment`.** Each field it sets with a predefined value, and
   the lookup field of the new record that it sets to the record it runs on (`targetParentField`), is `writes`,
   `via: assignment`. `What` and `Who` of a task are `WhatId` and `WhoId`. A field its layout shows is `reads`,
   `via: listed-field`, as a field of a field set is, and one the user types in (`uiBehavior` `Edit` or `Required`) is
   `writes` too, as a field of a screen of a flow is. The fields are of the object of the records it creates, or of its
   own object, the part of its name before the dot, where it names none. The formula of a predefined value names a field
   of the record the action runs on by its object, `Invoice__c.Amount__c`. It is read by the reader of formulas
   (`readFormulaOfStarts`), and the names are `reads`, `via: formula`. A name that starts with another name is not read
   (`NAME_NOT_READ`), and a global variable is read as in a formula of a field. A global action runs on no record: a
   name in its formula is not read, and a field it sets or shows without an object is not followed
   (`PATH_NOT_FOLLOWED`). The flow an action starts is `calls`, and the Aura component, Lightning web component,
   Visualforce page and canvas app (`ConnectedApp`) it opens are `references`, `via: action`, by their names. The email
   template an action that sends email starts with (`defaultEmailTemplateName`, `Folder/Name`) is a `references`,
   `via: template`. Reading the layout, the record type and what an action opens goes further than the plan.
5. **The three types join the logic tier**, with the version that analyses them. The list of `core/tiers.ts` has 28
   names. An org that lists an email template, a report type or a quick action and does not hand it out has a
   partial snapshot.
6. **`EmailFolder` stays outside the logic tier**, the maintainer's answer of 2026-11-25. A folder of email
   templates that the org lists and does not hand out is a warning and does not make a snapshot partial. A template
   in it that the org lists and does not hand out is an error, as any template.
7. **A row of the Dependency API from an email template is compared.** The test org reports the custom fields of
   the merge fields of a template, and the object they are of ([real-org.md of
   Phase 2](../research/phase-2/real-org.md)). A pair of the analysis from a template without a row is listed, but
   for a standard field or object. What the API reports of a report type and of a quick action was not measured
   when this was decided: a row from one of them is compared, and a pair the analysis has without a row is counted
   with the reasons `report-type` and `quick-action`, and not listed. Run 29 of that note measured it after the
   merge: of a report type the API reports nothing, and of a quick action the object it creates records of and the
   field `targetParentField`, not a field a predefined value writes, a name of its formula or a field of its layout.
   The two reasons stay as they are: a field `targetParentField` names and one a predefined value writes are both
   `assignment`.

## Consequences

- The fixture project has a report type and a quick action more, 120 components. The answer key has their 19 entries, 9
  of the report type and 10 of the quick action, and 510 references in all, with a negative more. The test org gets the
  two files when a run of the workflow "Live org" on `main` deploys the project again, which a maintainer starts with
  the step `deploy`. A run that only reads the org before that says that the org does not list them.
- An answer about a field that a template, a report type or a quick action names holds them now. `EmailTemplate` is
  no longer among the types an answer about the fixture project does not cover, and its golden files changed with
  it. An answer about what refers to `Invoice__c.Amount__c` holds the email alert of the template and the flow
  that sends the alert, which the answer did not reach before.
- A snapshot analysed by an earlier version has no references of the three types. `orglens analyse <source>`
  analyses it again.
- The JSON of the cross-check has two more values of `reason`, `report-type` and `quick-action`. The schema and
  `docs/cli.md` say so.
- V4S and Outbound Funds are pinned by commit in `fixtures/corpora.toml`, both under BSD-3-Clause, as their
  repositories state. At the pinned commits, the package folders of the six public codebases hold 31 email
  templates, 8 report types and 54 quick actions. The plan counted 31, 4 and 51 before they were pinned. All are
  read without an error. One formula of a quick action of PMM holds `%%%NAMESPACED_ORG%%%`, a token that the build
  tool of that project replaces before it deploys: the formula is not read (`FORMULA_NOT_READ`), four names are not
  read (`NAME_NOT_READ`), and the reader of formulas counts the file as one it failed on. The formula fields, rules,
  filters and roll-ups of the two codebases were read by hand against what the analysis reports, as those of the
  other four were in Phase 1: 76 references, none wrong
  ([note of Phase 1](../research/phase-1/public-codebases.md)).
- V4S is in the metadata format, where a file such as `objects/Contact.object` holds every field of its object. The
  test that takes a snapshot of each public codebase through a mock org skips such a codebase: the mock org that the
  Salesforce library builds gives no parts of such a file.
- Not done: a quick action is not tied to its own object by a reference. The action `Invoice__c.New_Line` runs on
  an invoice, and nothing of its file names the object but its name. An answer about the object holds the action
  only where the action names a field of the object, as this one does in its formula.
- Not done: of a Visualforce template only the merge fields of its markup are read. The controller, the components
  and the variables its markup declares, such as the `var` of `apex:repeat`, are not: a merge field that starts with
  such a variable is not read and says so. Reports are not analysed: they stay in Phase 6.
- Not done: the icon of a quick action (`icon`) is not read, as nothing says of what type its name is. An answer
  about the static resource or the document behind an icon does not hold the action. No action of the public
  codebases names one.
- Not verified on an org: the forms of the Lightning and the Visualforce templates are taken from the documentation
  of Salesforce and from the files of the public codebases, which hold no Lightning template. So are `Link`,
  `Sending_User`, `Receiving_User`, `ApprovalRequest`, the fields of the owner as a classic template writes them,
  the names of the 15 child relationships every org has, and how a report type writes a column through a lookup
  field of Salesforce. So are the form of `defaultEmailTemplateName` and of `canvas` of a quick action, and whether
  an org hands out the body of a template in ISO-8859-1. What the Dependency API reports of a report type and of a
  quick action was measured on the test org only, with one of each (decision 7).
