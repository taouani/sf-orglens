# @sf-orglens/engine

## 0.1.0-next.2

The third pre-release, made at the close of Phase 2. What this version does as a whole, what it does not
do and what is not verified is in its
[release notes](https://github.com/taouani/sf-orglens/blob/main/docs/releases/v0.1.0-next.2.md).

The entries are in the order in which their pull requests were merged, under each heading, and each says what
was true on that day. Where one says that something is not done yet, or was not verified on an org, a later one
may say otherwise.

### Minor Changes

- c2419fd: Flows are analysed. A flow is a component, and each of its elements and resources is a component below it, with
  the key `Flow:<flow>#element:<name>`: a decision, an assignment, a lookup, a create, an update or a delete of
  records, a screen, a loop, an action, a subflow, a variable, a formula, a text template and the others. The start
  of a flow is the element `flow-start`. A process of the Process Builder is a flow.

  An element refers to the object it reads or writes records of, to the fields in its filters, assignments and
  conditions, to the fields in its formulas and merge fields, and to the Apex class, the flow or the email alert it
  starts. `orglens impact` shows the elements of flows that refer to a component, and `Flow` is no longer among the
  types an answer does not cover. The database keeps with a reference to an object from a record element what the
  element does to its records: `lookup`, `create`, `update`, `upsert` or `delete`. No output shows it yet.

  What a flow does not say is reported and not guessed. A path from a resource of which the object is not known,
  such as what an Apex action gives back, and a name of a field where no object is named, are the warning
  `PATH_NOT_FOLLOWED`. A resource the flow does not have is the new warning `RESOURCE_NOT_FOUND`, an element of a
  kind that is not known the new warning `FLOW_ELEMENT_UNKNOWN`, with the names in it read at the tier `probable`,
  and a merge field that is not closed the new warning `MERGE_FIELD_NOT_CLOSED`. The work of an analysis has a
  third row, `parser:flow`.

  A snapshot that was taken before has to be analysed again with `orglens analyse` for its flows to be read.

  Also changed: the line of an impact answer that gives its reasons says "the analysis had 1 error and 1 warning"
  where both are there. An alert that a flow names and the snapshot does not hold is reported as missing, and no
  longer as the alert of a package. The line of the cross-check about the rows that are not compared says "or from
  a flow" where one of them is from a flow.

  Not done: the rows of the Dependency API from flows are counted and not compared in the cross-check.

- 3732f2d: A snapshot of an org holds the active version of a flow. An org hands out the newest version of a flow, which can
  be a draft while an older version runs. Where the file of a flow says that it is not active and its definition
  names an active version, the snapshot asks for that version by its number and keeps it under the path of the
  flow. The new note `FLOW_NEWER_VERSION` says that the flow has a newer version that is not analysed. If the
  active version does not come back, the flow is not in the snapshot, the snapshot is partial (`NOT_RETRIEVED`),
  and the new note `ACTIVE_FLOW_NOT_RETRIEVED` says why. A flow that is not active and has no definition, or that
  the org lists under another name than that of its file, is kept as it came, with the new warning
  `FLOW_VERSION_UNKNOWN`, which an impact answer that covers flows counts: such an answer is not complete. The
  three are the first issues of the reading that name a component, the flow. The text of `snapshot` and `coverage`
  shows one line for each of them, with the number of flows.

  On the test org, a snapshot of a flow with an active version and a newer draft holds the active version, with
  the note.

- f5bb7fe: Workflow rules are analysed. A file of workflow rules is a component with the name of its object
  (`Workflow:Invoice__c`), and each rule, field update, email alert, outbound message and task in it is a component
  under the name Salesforce gives it (`WorkflowRule:Invoice__c.Remind_When_Sent`). The file contains them, so an
  impact answer about the file is about its rules and actions. A rule refers to the fields of its criteria and of its
  formula, to the actions it starts, at once and after a time, and to the date field a time trigger counts from. A
  field update writes its field, also on the parent of the record through a relationship field, and reads the fields
  of its formula. An email alert reads the fields that hold its recipients and refers to its email template. An
  outbound message reads the fields it sends, and a task the date field its due date counts from. A rule says whether
  it is active. A project laid out with the preset `decomposeWorkflowBeta` gives the same.

  `orglens impact` with a name alone that fits an object and other components, such as `Invoice__c`, which the file
  of its workflow rules has too, answers for the object and no longer ends with `COMPONENT_AMBIGUOUS`. The line below
  the first one names the others, and the new field `sameName` of the JSON lists their keys. A name that fits
  several components and no object is still that error.

  What a file of workflow rules does not say is reported and not guessed. An action of a type that is not known, or
  of none, and an email template named without its folder are the warning `NAME_NOT_READ`. A field update that
  writes on a parent through a relationship that leads nowhere known, or that would lead to the object of the record
  itself, such as `ParentId` of an email message, is the warning `PATH_NOT_FOLLOWED`.

  Of these files, the Dependency API reports only the custom fields the formula of a field update reads. The
  cross-check compares its rows as for every analysed type, and counts the other references of these files with the
  new reasons `workflow-rule`, `workflow-action` and `field-update`.

  The workspace database moves to schema version 8, which gives the rules and actions a snapshot already holds their
  file. A command that writes to the workspace, such as `orglens analyse` or `orglens snapshot`, migrates it. A
  snapshot that was taken before has to be analysed again with `orglens analyse` for its workflow rules to be read.

  Not read: a flow action, an action that publishes an article or that sends, and a recipient, an address or a user
  named by itself.

- 3864d3b: Record types, field sets and records of custom metadata types are analysed. A record type refers to each picklist
  field whose values it limits, and keeps the values it allows on that reference, and to its business process. It
  says whether it is active. A field set reads each field it lists, available or shown, also across relationships. A
  record of a custom metadata type refers to its type, to each field it gives a value, and to what the value of a
  relationship names: an object, a field, whose object is the value of the field that controls the relationship, or a
  record of another type. A value of a text field that is exactly `Object.Field`, or exactly the name of a field of
  an object the same record names in a relationship, is a reference to that field at the tier `probable`, where a
  file of the snapshot defines the field. A text with other words, a standard field and an object named in a text
  give nothing. A field a record gives no value, as Salesforce writes one for each field a record leaves out, gives
  nothing.

  What these files do not say is reported and not guessed. A picklist of a record type, a field of a field set or a
  field of a record that is not built like a name is the warning `NAME_NOT_READ`. A field set that lists a field
  across a relationship that leads nowhere known, and the value of a relationship to a field whose object the record
  does not give, are the warning `PATH_NOT_FOLLOWED`. A value of a record that is not one name gives nothing and no
  warning: Salesforce writes one name as the value of a relationship, and a text can hold anything.

  Of these files, the Dependency API reports the type of a record and the custom fields of a field set. The
  cross-check now compares those rows, and the row from a record to its type is no longer counted as not compared.
  It counts the other references of records with the new reason `custom-metadata`, and those of record types with
  the new reason `record-type`.

  A snapshot that was taken before has to be analysed again with `orglens analyse` for these types to be read.

  Not read: what a record type names besides its picklists and its business process, the values of a record in
  fields that are neither a relationship nor a text, and a text that names a field of an object that only another
  record names.

- 35471b0: `orglens impact` takes a flow with its elements, since the flow runs them. Where an answer finds an element of a
  flow, such as an assignment that writes the field that was asked about, it also holds the flow, at the same depth,
  with the reference of that element, and goes on with what refers to the flow, such as a flow that calls it as a
  subflow. The line of the flow shows the reference of that element, which has a line of its own after it, and a
  line of the text says so. In the JSON, `reference.from` of the flow names the element. An answer about an element
  holds what refers to its flow, and the new field `elementOf` of the JSON names the flow. With `--outgoing`, an
  answer goes on from a flow that it finds to what the elements of the flow refer to, and `REFERRED TO BY` can name
  such an element, which has no line of its own. So an answer can hold more results than before: on the fixture
  project, the answer about `Invoice__c.Amount__c` has 28 in place of 23.

  An element of a flow can be named by the name of its flow and its own, such as
  `Invoice_After_Save.Update_Account`, alone or after `Flow:`, in any case. A key is found in any case too. A name
  with one dot that found a field before can now also fit an element of a flow, such as `Account.Name` where a flow
  `Account` has an element `Name`. Where neither is an object, the command then ends with `COMPONENT_AMBIGUOUS` and
  the exit code `2`, and lists both keys. Named with its type, such as `CustomField:Account.Name`, the field is found
  as before.

  An answer names each flow in it whose active version has a newer one beside it, such as a draft, in a line below
  the results and in the new field `newerVersions` of the JSON. The answer is about the active version, which the
  snapshot holds and which is the one that runs. The newer version is not analysed, and naming it changes neither
  `complete` nor the exit code. Only a snapshot of an org knows of a newer version.

- 9e8e2d0: The cross-check of a snapshot of an org compares the rows of the Dependency API from flows. A row from a flow
  carries the id of a version of the flow, and the org lists a flow with the id of its latest version only. So a
  snapshot of an org that lists a flow asks the org once more, through the Tooling API, for the ids of the active
  and of the latest version of each flow (`FlowDefinition`), and keeps them with the rows. Its requests count with
  those of the rows. A row is compared where it is from the version the snapshot holds: the active one where a newer
  version is noted, and else the latest. A row from another version, such as a draft, is counted in the new field
  `rowsOtherVersion` of the comparison and not compared, and the text of `snapshot`, `coverage` and `analyse` says
  how many there are. Where the org does not name the versions, the snapshot has the new warning
  `FLOW_VERSIONS_NOT_READ`, and a row from a flow is matched by the id the org listed the flow with.

  So a pair that Salesforce reports from a flow and the analysis lacks is now the error `REFERENCE_MISSED`, which
  makes the analysis incomplete, and an impact answer from that snapshot ends with the exit code `5`. A reference of
  a flow that Salesforce does not report is counted with one of three new reasons: `subflow`, `name-in-text` and
  `global-variable`. On a real org a flow can name what the analysis of flows does not read yet, such as a component
  of a screen. If Salesforce reports such a pair, the analysis is incomplete.

  A comparison that an earlier version stored has no `rowsOtherVersion`, and is shown as one this version cannot
  read, with the command that compares again: `orglens analyse`. A snapshot that an earlier version took holds no
  ids of versions: its rows from flows are matched by the ids the org listed.

- ac9c6d8: The email alerts, field updates, outbound messages and tasks of a workflow rule, which the analysis reads, are of
  the logic tier now: every type an analyser reads is. A snapshot of an org that lists one of them and does not hand
  it out, or that refuses to list them, is `partial` where it was `complete`, and `orglens snapshot` ends with `5`
  where it ended with `0`. `exclude_types` in `orglens.toml` refuses the four names, as it refuses every type of the
  tier: a snapshot read them all the same before, with the warning `TYPE_NOT_EXCLUDED`. A snapshot that an earlier
  version took keeps the status it was given.
- 7ca24d5: The cross-check of a snapshot of an org no longer takes the query for every row of the Dependency API as whole
  where it gives fewer than 2,000 rows: on a large org that query gave fewer, and no row from a field. After it, the
  rows are always asked for per type of the component that refers, then whatever is of another type, and each type
  that shows is asked for by name. An answer of 1,000 rows or more is asked for in parts. An answer of fewer rows,
  of which every page came, is held against every row the reading holds in the end: where another query gave a row
  that it was asked for as well and lacks, the reading is `partial` and the query counts in `queriesCutOff`. A
  reading of an org that has the Dependency API asks at least 19 queries where it asked one: one more for each other
  type its rows show, and one more each time the rows of another type are asked for again after such a type. An org
  without the API is asked three times, as before. The texts say "Rows are missing, or may be" and "near the limit".
  A reading that is whole says "No answer shows that a row is missing", where it said "No query left a row out". A
  snapshot that an earlier version took keeps its reading.
- 71fba98: An object refers to the page or component that overrides one of its actions: a Lightning page, such as the record
  page of the object, a Visualforce page, an s-control or a Lightning component. The analysis reads the name of each,
  and not the page itself. Before, a snapshot of an org whose Dependency API reports the Lightning page of an object
  had the error `REFERENCE_MISSED` for each, and its analysis was not complete. A Lightning component is taken for an
  Aura component, or for a Lightning web component where the snapshot defines only that. An override of a type that
  is not known here, or without a type, is not read, with the warning `NAME_NOT_READ`. The cross-check has one more
  reason, `action-override`, for an override by a Visualforce page, a Lightning component or an s-control without a
  row: whether the API reports those was not measured. An impact answer follows the new reference as any other: an
  answer about such a page holds the object and, from a depth of 2, what refers to the object, and an answer with
  `--outgoing` that reaches an object with an override holds the page too, and says that the type of the page is not
  analysed.
- e8e0491: A snapshot of an org no longer counts a document, or what belongs to person accounts, as missing when it came
  back. That was seen for a record type, a matching rule and a duplicate rule, and the rule holds for every type. An org lists a document with the ending of its file, as `Assets/Logo.png`,
  and the snapshot names it `Assets/Logo`. An org lists what belongs to person accounts under the object `Account`,
  as `Account.Client`, and hands it out under the object `PersonAccount`. Each such component was counted twice: as
  one the org listed that did not come back, and as one that came back although the org had not listed it. A record
  type is of the logic tier, so the snapshot was partial for a record type whose file it held, and `orglens snapshot`
  ended with `5`.

  What comes back under the other name now counts as the listed component, under the conditions that already hold
  for a component of a package that comes back without its prefix: the org lists nothing under the name that came
  back, the retrieve did not ask for that name, Salesforce did not remark that it cannot find the listed name, and
  no second listed name can stand for what came back in the same retrieve. One condition is new, also for a component of a package: the
  listed name did not come back itself in the same retrieve. The files and the keys of the snapshot keep the name
  that came back. The new note `RETRIEVED_UNDER_ANOTHER_NAME` says how many components of a type came back that
  way, and why in `details.reason`: `file-ending` or `person-account`.

  Not verified on an org: the test org has no person accounts and no document. Not done: reports and dashboards in
  a folder inside a folder, which an org lists under the name of the inner folder and hands out under the whole
  path, and an org that lists nothing under the object `PersonAccount`, which is then not asked for it.

- b1f303e: A snapshot of an org no longer counts a report, a dashboard or a folder of either as missing when it lies in a
  folder inside a folder and came back. An org lists such a folder by its own name, as `Quarterly`, and a report in
  it as `Quarterly/Revenue`, and hands both out under the whole path, as `Finance/Quarterly` and
  `Finance/Quarterly/Revenue`. Each such component was counted twice: as one the org listed that did not come back,
  and as one that came back although the org had not listed it. These were warnings: the four types are outside the
  logic tier.

  What comes back under the whole path now counts as the listed component, under the conditions that hold for a
  document and for what belongs to person accounts. One condition is new: where two components that came back in
  one retrieve stand for one listed name, such as two folders of one name in two folders, neither counts as it. The
  files and the keys of the snapshot keep the whole path. The
  note `RETRIEVED_UNDER_ANOTHER_NAME` has the new reason `folder-path` in `details.reason`. The names of that note
  and of `RETRIEVED_WITHOUT_PREFIX` are now in the order of the listed names.

  Not verified on an org: the test org has no folder in a folder.

- 231fcc6: An answer of `orglens impact` about what refers to a component names fewer types that are not analysed: a type is
  left out where its components can name no type of the answer. A custom label or a static resource, for one, names
  nothing, and a folder names only the groups, roles, queues, territories and sites it is shared with, and folders of
  its own type. A table in the engine says this for 21 types, each read from the types of the Metadata API, and a type
  that is not in it stays for every question. Once a type stays, every analysed type counts as of the answer. On the fixture project, five of eight types leave the list of an answer about a field.
  An answer with `--outgoing` is not changed by it. A type of which the snapshot holds only components that the
  source did not list now counts among the types that are not analysed, with `0` for both numbers: before, an answer
  could call itself complete although such a type was not analysed.
- f130006: `orglens impact` counts a warning of the analysis only where it can bear on the answer, not every warning of the
  snapshot. For `--outgoing`, a warning counts where it is about the component, something it contains, a result or an
  element of a flow of the answer. For what refers to a component, a warning about the component itself, about
  something it contains, or about the flow of an element that is asked about does not count, and a path that was not
  followed counts only where the answer holds a record type, a field whose name the names of the path can be, or an
  object where the path ends at one: the record that an element of a flow writes or deletes. A field that such an
  element sets behind a record of no known object now has a warning of its own, and the warning `PATH_NOT_FOLLOWED`
  says what its path ends at (`details.endsAt`). A snapshot analysed by an earlier version counts every such warning
  as before, until `orglens analyse` analyses it again. So more answers are complete: on the fixture project, the one
  warning counts for the answers about `Invoice__c.Amount__c` and the object `Invoice__c`, and no longer for an answer
  about `Account.Tier__c`, nor for what `Invoice__c.Total__c` refers to. The field `notCovered.analysisWarnings` of
  the JSON keeps its shape and counts fewer warnings. `mayMiss` and the exit code do not change. The text says "1
  warning of the analysis bears on the answer" where it said "the analysis had 1 warning". The line of a complete
  answer about what refers to a component now reads "every type that can refer to it was analysed, and the analysis
  had no error and no warning that bears on it".
- 6cb41ac: A name that ends in `__pc` or `__pr` is now read on the objects `PersonAccount` and `BusinessAccount` as on
  `Account`: `Level__pc` is the field `Level__c` of the contact of a person account, and `Level__pr` is the
  relationship of that field. An org with person accounts hands out parts of the account under these objects, and
  the analysis did not know where such a relationship leads there, so it did not follow the path and left a warning
  `PATH_NOT_FOLLOWED`. Where the snapshot holds no such field of the contact and holds the field as the object
  shows it, such as `PersonAccount.Hobby__pc`, the name is that field. A snapshot that is already there is read this
  way once `orglens analyse` analyses it again. Not verified on an org: the test org has no person accounts.
- 1118534: A snapshot of an org now knows which of its components are of a managed package installed in the org: those the
  org lists with the prefix of a package and a state of an installed one. `impact` leaves them out of what refers to
  a component, counts them in a line of the text and in `packagesLeftOut`, and walks on through them, so that a
  component of the org that refers to the component through one of a package stays in the answer. `--packages`
  keeps them, with a column `PACKAGE`. Every result and the component that was asked about say their package in
  `package`. An answer about what a component refers to leaves nothing out. `coverage`, `snapshot` and `analyse`
  count per type how many listed components are of a package (`packaged`), with a column `OF PACKAGES` where there
  is one. A component of a package that the org lists and Salesforce does not hand out is now a warning
  `NOT_RETRIEVED` with `details.ofPackages`, which does not make the snapshot partial, and the first line of the
  report says so. It makes its type partial for an answer only where a reference of the snapshot names it, or for
  what refers to a component with `--packages`. The snapshot keeps the name a component came back with, so that the
  cross-check matches the rows of the Dependency API about it to the component the snapshot holds. That holds for
  every component that came back under another name, also in an org without packages: such a row was counted as
  not held and is now compared, and can be `REFERENCE_MISSED`. A snapshot that is already there has no such name
  until it is taken again. The database moves to schema version 10. Decision record 0076. Not verified on an org:
  the test org has no package.
- b2c8650: Email templates, report types and quick actions are analysed. An email template reads the fields of its merge
  fields, in its subject and in its body, which is read as text in UTF-8, or in ISO-8859-1 where its `encodingKey`
  says so and the bytes are no UTF-8: a classic template writes `{!Object.Field}`, a Lightning template
  `{{{Name.Field}}}` or `{!Name.Field}`, and a Visualforce template `{!relatedTo.Field}`, whose object its markup names.
  A merge field that holds a formula is read as one. A template also refers to the object it is written for, its
  letterhead and the documents it attaches. A report type refers to its object, to the lookup field behind each child
  relationship it joins, and to each field it lists. A quick action refers to the object and the record type of the
  records it creates, writes each field it sets, the lookup to the record it runs on and the fields its layout lets the
  user type in, reads the names in the formula of a value it sets and the fields its layout shows, and calls the flow
  or names the email template, component, page or canvas app it opens. A name that is not read, a child relationship
  that is not known and a field of a record of no known object are warnings, as elsewhere. The three types join the
  logic tier, so an org that lists one and does not hand it out has a partial snapshot. A folder of email templates
  (`EmailFolder`) stays outside it. The cross-check compares the rows from an email template, and counts a pair of a
  report type or a quick action without a row with the new reasons `report-type` and `quick-action`. An impact answer
  holds them as any other result, and no longer lists `EmailTemplate` among the types it does not cover. A snapshot
  that is already there is analysed again with `orglens analyse`. Decision record 0077. Not done: the icon of a quick
  action. Not verified on an org: the forms of the Lightning and the Visualforce templates, the fields of the owner as a
  classic template writes them, and what the Dependency API reports of report types and quick actions.
- fdbf02c: A snapshot of an org that lists a flow now asks the Tooling API for the ids of every version of each flow, through
  one more object, `Flow`, after `FlowDefinition`. Its requests count with those of the rows. The Dependency API keeps
  the rows of a version that is neither active nor the latest, such as one that a deploy left behind, and a row carries
  the id of its version. Such a row is now counted in `rowsOtherVersion` and not compared. Before, it was counted in
  `rowsNotMatched`. Its id is also among the ids the rows are asked for with when an answer is near the limit, so the
  reading of the rows of flows in parts no longer counts such a part as cut off, where the ids of flows fit in one
  query (200). Where they do not, the rows come all the same, and the part counts in `queriesNotProven` as before.

  Where the org refuses the query of `Flow`, or its answer breaks off, the warning `FLOW_VERSIONS_NOT_READ` says so in
  a sentence of its own, and has two more details: `versionsState` and `versionsCode`. The workspace database moves to
  schema version 11. A snapshot taken before keeps no ids of the other versions, so its rows from them stay counted as
  not matched until the snapshot is taken again. Decision record 0078. Not verified on an org yet.

### Patch Changes

- 704fc5a: On Windows, a command that changes a configuration file tries again for up to a third of a second when Windows
  refuses to create the lock file with `EPERM` or `EBUSY`, as it already does when it reads the lock or removes
  it. The same holds for the second file that guards the removal of a lock that was left behind. Before, the
  command ended with that error. One run of the tests on Windows had failed that way: of eight processes that
  added a source at the same moment, one ended with `EPERM`. Why Windows refused is not known, and the refusal
  could not be made to happen again, so it is not verified that the new tries are enough. A command that was
  refused and tried again writes that to the log of the workspace (`config.lock.refused`).
- 23b1c0c: The report of a snapshot is shorter in one place and clearer in two. Files of an org that cannot be read as
  metadata for the same reason, and are counted with the same types, share one line, with their number and the
  first of them: an org can hand out hundreds of files of a type the Salesforce library does not know, and each had
  a line of its own. Where nothing tells the type of such files, only those of one top folder share a line. A
  repository still has a line for each file. The warning `FLOW_VERSION_UNKNOWN`, which had one line for all flows,
  has one for each reason it gives. And the line of the type `CustomLabels` says that it holds the labels, beside the
  line of `CustomLabel`, which counts them: the two read like one type that is listed twice. The table of types of an
  `impact` answer names it the same way. The JSON output is unchanged: it has every issue, and the type is
  `CustomLabels`.

  A message about a file that the Salesforce library could not place, in a folder whose type the org describes or
  does not tell, ran two sentences together. They are two sentences now.

## 0.1.0-next.1

The second pre-release. It changes nothing in what OrgLens does. Why it exists is in its
[release notes](https://github.com/taouani/sf-orglens/blob/main/docs/releases/v0.1.0-next.1.md).

### Patch Changes

- No command, no output and no exit code has changed since `0.1.0-next.0`: the code of both packages is the same,
  and only the version they name is new. This version exists to publish once without a token. The first
  pre-release was published with a token of the maintainer, because a package has settings on npm only once it
  exists. Every version after it is published through a trusted publisher of npm, which takes a version only from
  the workflow "Pre-release" of this repository in its environment `npm-next`. That way had not been tried, and
  npm keeps a new trusted publisher only when a version is published through it within two days.

  One thing follows from the new version alone: a snapshot of an org that was interrupted under `0.1.0-next.0` is
  not continued by this version. It is given up, and `orglens snapshot` begins a new one.

## 0.1.0-next.0

The first pre-release, on npm under the tag `next` and on GitHub. What this version does as a whole, what it
does not do and what is not verified is in its
[release notes](https://github.com/taouani/sf-orglens/blob/main/docs/releases/v0.1.0-next.0.md).

The entries are in the order in which their pull requests were merged, under each heading, and each says what
was true on that day. Where one says that something is not available yet, or was not run against a real org, a
later one may say otherwise.

### Minor Changes

- 0b2c27d: Add the workspace and the first commands. `orglens init` creates a workspace, `orglens source add|list|remove`
  declare orgs, sandboxes and repository folders in `orglens.toml`, `orglens status` shows the workspace and its
  database, and `orglens doctor` checks that OrgLens can run. Every command takes `--json` and writes one envelope,
  described by a JSON Schema that ships with the package, and ends with one of six documented exit codes.
- 897aa4c: Add snapshots of repository folders. `orglens snapshot <source>` reads a source of the kind `git`, from disk or
  from a commit, and stores its metadata files in the workspace database. `orglens coverage <source>` shows what a
  snapshot holds per metadata type and what was left out or went wrong. A snapshot that is missing something is
  stored as partial, and `snapshot` then ends with the exit code `5`. Reading a commit needs Git 2.30 or newer.
  Reading folders from disk needs no Git. Snapshots of orgs and sandboxes are not available yet.
- 795f833: Add logins. A source of the kind `org` or `sandbox` is logged in with a login of the Salesforce CLI: the one that
  `orglens source link <name> <login>` sets in the personal file, or the one login that belongs to the org the
  source declares. A job without a person logs in with a key from the variables `ORGLENS_JWT_<SOURCE>_…`, and no
  login file is written. `orglens source check <name>` connects and says which org answered, by which login and with
  which API version, and for a source of the kind `git` it reads everything a snapshot would read. Both store
  nothing. A login that fails, or that belongs to another org than the declared one, ends with the exit code `4`.
  `doctor` now also checks Git and says how each org would be logged in. Snapshots of orgs and sandboxes are not
  available yet.
- e9a44e9: Add snapshots of orgs and sandboxes. `orglens snapshot <source>` now reads a source of the kind `org` or
  `sandbox`: it asks the org which metadata it holds, retrieves every component by name in chunks, and stores the
  files in the form a repository holds them. Progress goes to the standard error stream. A snapshot that is
  interrupted is continued by the next run, and `--restart` takes a new one. What the org listed and did not hand
  out, and every type it refused to list, makes the snapshot partial and is named in `coverage`. `status` shows a
  snapshot that has not ended. Profiles and permission sets are read incompletely, and a warning says so. An issue
  about a refusal of Salesforce carries its code in `details.code`. OrgLens reads only metadata and makes no request
  for a record. When the Salesforce library renews an expired session, it asks the org about the org itself, as
  before. This has been tested against a mock org, not yet against Salesforce itself. The workspace database moves
  to schema version 2.
- b1a459b: The workspace database gets tables for components and references, and is now at schema version 3. A command
  that writes to the workspace updates an older database when it opens it, and an older version of OrgLens then
  refuses that database. No command fills the new tables yet: a snapshot is still read and not analysed.
- 258f13b: A snapshot is now analysed. `orglens snapshot` analyses the files it stored: the objects, fields and validation
  rules, with the names written in their XML and in their formulas. The new command `orglens analyse <source>`
  analyses a stored snapshot again from the files it holds, without reading the source, and migrates a database
  that an older version wrote. `coverage` shows per metadata type how many components were analysed, and per
  origin how many references were found, how many are not resolved, and how many paths were not followed.
  `status` says whether the latest snapshot of a source is analysed. `snapshot` and `analyse` end with the exit
  code 5 when the snapshot is partial or its analysis is incomplete. In the JSON output, the report of a snapshot
  gets `analysis`, every issue gets `stage` and `component`, and `status` gets `latestSnapshot.analysis`. A Git
  source is now read with the layout of files that its own `sfdx-project.json` asks for, also with `paths` and
  from the commit of a `ref`, and no longer with the project of the folder the command runs in. The snapshot keeps
  that layout, in schema version 4 of the database, and is always analysed with it. No command answers an impact
  question yet, and no snapshot of a real org was analysed.
- 69c7957: The first impact answers. The new command `orglens impact <component>` shows what refers to a component in a
  snapshot, directly or through other components: each result with its depth, the reference it is found by with
  file and line, and the weakest confidence on its chain. For an object, the answer is about everything it
  contains too. `--depth` limits how far the answer goes, `--min-confidence` leaves uncertain references out,
  `--outgoing` shows what the component refers to, and `--snapshot` asks an older snapshot. A component is named
  by its name, by its type and name, or by its key. Every answer says what it does not cover: the types of the
  snapshot that are not analysed yet, the analysed types of which the snapshot holds less than the source has,
  the errors of the reading and of the analysis, the warnings of the analysis, and for `--outgoing` the
  components the snapshot does not hold. In this pre-release only objects, fields and validation rules are
  analysed, so an answer about what refers to a component of a real project is not complete and says so in its
  first lines. The exit code is 5 when the answer may miss something of a type it covers, and 2 for a name that
  fits no component or several. The engine gets `Workspace.impact` and the error codes `SNAPSHOT_NOT_ANALYSED`,
  `COMPONENT_NOT_FOUND` and `COMPONENT_AMBIGUOUS`. An analysis now records the types it read, and the workspace
  database moves to schema version 5: `orglens analyse` or `orglens snapshot` migrates a database of an earlier
  version, and `impact` ends with `STORE_OUTDATED` until then. No snapshot of a real org was asked.
- 9aadacb: A snapshot of an org is now cross-checked. `orglens snapshot` of an org or a sandbox asks the Dependency API of
  Salesforce which component refers to which, keeps the rows with the snapshot, and holds them against what the
  analysis found. `coverage` shows the result: how many rows Salesforce reports, how many are from a type this version
  does not analyse and are not compared, how many pairs of components the analysis has as well, and the pairs it
  missed: the first 20 in text, all of them with `--json`. A reference that Salesforce reports and the analysis did
  not find is the new issue `REFERENCE_MISSED` of the analysis, with the severity `error`: the analysis is incomplete,
  `snapshot` and `analyse` end with the exit code 5, and an impact answer from that snapshot says that it may miss
  something. A reference that only the analysis has is no error. It is listed where the API is known to report that
  kind, and counted by its reason where it is not, such as a standard field or a lookup. The rows are a second opinion
  and never part of an answer: `impact` shows no row of Salesforce. `orglens analyse` compares again from the rows a
  snapshot holds, without asking the org. The reading never fails a snapshot: an org that does not answer leaves the
  warning `CROSS_CHECK_NOT_READ`, and rows that are missing because a query was cut off or failed, or that may be
  missing because the org holds more components of a type than one query can name, leave `CROSS_CHECK_PARTIAL`. The
  reading stops after 2,000 requests. `--no-cross-check` leaves the API unasked. The engine gets
  `CoverageReport.crossCheck` and the option `crossCheck` of `Workspace.snapshot`, and the JSON output of `snapshot`,
  `analyse` and `coverage` gets the field `crossCheck`. The workspace database moves to schema version 6: `orglens
analyse` or `orglens snapshot` migrates a database of an earlier version, and `coverage` and `impact` end with
  `STORE_OUTDATED` until then. Only metadata is read: one object of the Tooling API is queried,
  `MetadataComponentDependency`. The cross-check was not run against a real org when this was written.
- 64714df: A snapshot of an org is now judged over the logic tier: 21 metadata types, listed in `docs/cli.md`. What the org
  listed and did not hand out, a listing it refused, a retrieve that failed and a file that cannot be read as
  metadata make the snapshot `partial` only for a type of that tier. For any other type the same issue is a
  warning, the snapshot is `complete`, and `snapshot` ends with `0` where it ended with `5`. The first line of the
  report then says "is complete for the logic tier" and that something of other types is missing, and each of the
  four issues carries `details.tier`. The file of custom labels is not missing when the org lists no label.
  `impact` ends with `0` where it ended with `5` for a snapshot in which a file or a retrieve outside the tier
  failed: the answer does not cover that type and names it in `notCovered.notAnalysed`. A snapshot of a repository
  is not changed. The judgement was seen on one real org, where 209 components of 10 types outside the tier are
  warnings. The commands were not run against a real org, so their lines and exit codes are shown by tests only.
- 801bf9c: A snapshot of an org takes the word of the org in two places where the Salesforce library falls short. A file
  that comes back in a folder the library knows no type for is counted by the type the org describes with that
  folder, so a type the library does not know yet no longer makes every snapshot `partial`. A component of a package
  that comes back under its name without the prefix of the package counts as the component the org listed, when the
  retrieve asked for the listed name and not for the short one and Salesforce did not remark that it cannot find
  it. The note `RETRIEVED_WITHOUT_PREFIX` says so. Both were seen on one real org: three files of a type the
  library does not know became warnings, and seven bundles of a package count as retrieved.
- bdbac40: A source of the kind `org` or `sandbox` can leave metadata types out of its snapshots with the new key
  `exclude_types` in `orglens.toml`, for an org with very many components of a type nobody asks about, such as
  reports. The org is not asked for such a type, and nothing of it is read. The report of the snapshot shows the type
  as `left out`, and an impact answer names it among the types it does not cover. A type of the logic tier cannot be
  left out. The workspace database moves to schema version 7, and `orglens snapshot` or `orglens analyse` migrates an
  earlier one. Not verified on a real org.
- 79cf9d0: A snapshot of an org asks for a part by its own name when Salesforce cannot find what the part belongs to. The
  org can list a field or a record type of an object that it does not list and that Salesforce cannot find in a
  retrieve. Such parts were never asked for and counted as missing. Now they are asked for by their own names in
  one more retrieve, and the note `PARTS_ASKED_BY_NAME` says so. On the one real org this was run against,
  Salesforce could not find the parts by their own names either, and they stayed missing. A real org that hands
  such a part out was not seen.

### Patch Changes

- 20c5f72: On Windows, a command that reads or changes a configuration file tries again for up to a third of a second when
  another program has the file open at that moment, before it fails with `WORKSPACE_IO`. One run of the tests on
  Windows had failed in `orglens source add` for that reason.
- 70daa9d: A command that changes a configuration file while another one does waits longer for it. It gave up after two
  seconds in all. Now it gives up when the command in front has held the lock for ten seconds, or after thirty
  seconds in all while several commands take their turn. The error says how long the command waited
  (`details.waitedMs`) and how long the lock had been held (`details.heldMs`), and a command that waited or held
  the lock for a second or longer writes that to the log of the workspace. One run of the tests on Windows had
  failed: of eight commands, one got the lock and seven gave up after their two seconds.

  Two commands that found a lock that was left behind at the same moment could both take it over, and one of
  their changes could be lost. Now only one of them removes the old lock. A command also no longer removes a lock
  that is not its own when it ends.

- 678f7df: The cross-check of an org with more than 2,000 rows no longer asks Salesforce for the rows to standard objects by
  their type, which Salesforce refuses. A cross-check that was read that way was `partial` and lacked those rows.
  They are now left to the query for every type that is not asked for by name, and the reader checks that they come
  with it. Read that way afterwards, with every answer cut off at 30 rows, the test org of the project gave every
  row. An org with more than 2,000 rows was not read.
