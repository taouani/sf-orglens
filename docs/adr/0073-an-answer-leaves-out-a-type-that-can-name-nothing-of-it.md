# 0073. An answer about what refers to a component leaves out a type whose components can name nothing of it

- Status: Accepted
- Date: 2026-11-24
- Decisions: none (it builds a choice of the author of the Phase 2 plan, in work package 6, which the maintainer
  can strike, and corrects a gap that the review of a pull request found)

## Context

Record [0044](0044-an-impact-answer.md) says that every impact answer names what it does not cover. Among it are
the types of the snapshot that no analyser read (`notCovered.notAnalysed`): a component of such a type may refer to
the component that was asked about, and is not in the answer. For `--outgoing`, only the types of the component, of
what it contains and of the results count, because what a component refers to is known once it is analysed. For
the question of what refers to a component, every type that is not analysed counted, whatever the component was.

The [Phase 2 plan](../plans/phase-2.md) says in its row 8 that on a snapshot of PMM that was 35 types, also for a
field nothing refers to, and that nothing said yet which type can refer to which. In work package 6 it holds a
choice of its author, which the maintainer can strike: the list is narrowed for a question where the files of a
type cannot name the component asked about, as a custom label cannot name a field. The table that says so is in
one file, with the source of each line, and a type that is not in the table stays on the list.

The review of pull request 77 found a second point, which became issue 78. A type counted as not analysed only
where the source listed components of it, the snapshot held some of them or its listing was not `ok`. The
components that came back without having been listed are counted apart, so a type of which the source listed
nothing and the snapshot held only such components counted nowhere. On the mock org of the tests of the command
line, which hands out a file of custom labels that it does not list, `orglens impact CustomLabels:CustomLabels
--outgoing` said that the answer was complete, and the type was not analysed. Whether a real org hands out a
component of a type it lists none of is not known.

The Metadata API describes each type in its WSDL. `@jsforce/jsforce-node`, which the engine has as a dependency in
version 3.13.1, holds a file made from it, `lib/api/metadata/schema.d.ts`, with a type of TypeScript for each type
of metadata and each type its fields have. The documentation of Salesforce says the same of each type in prose,
which a test cannot read.

## Decision

1. **A table says, for 21 types that no analyser reads, which types of component their components can name**
   (`engines/can-name.ts`). Each line is read from the type of the schema of `@jsforce/jsforce-node` 3.13.1 and
   holds every field of the type as a path, with the fields of the types it is built on and of the types of its
   fields. A test holds the paths against the file, so a version of the library that changes one of these types
   fails it. Another test holds that every type of the table, and every type it names, is a type the Salesforce
   library knows, and that no type of the table is analysed. Each line says in a sentence why its fields name what
   they name. Where a field can name something that is no component, such as a user, the sentence says so. Where
   it was not plain whether a field names a component, its type is among those it names: a type too many keeps a
   type on the list, and a type too few would drop it.
2. **The types are those that are common and whose fields are few enough to read by hand:** `ApexTestSuite`,
   `ContentAsset`, `CspTrustedSite`, `CustomLabel`, `CustomLabels`, `CustomNotificationType`, `CustomPermission`,
   `DashboardFolder`, `Document`, `DocumentFolder`, `EmailFolder`, `GlobalValueSet`, `GlobalValueSetTranslation`,
   `Group`, `Letterhead`, `PermissionSetGroup`, `PlatformCachePartition`, `RemoteSiteSetting`, `ReportFolder`,
   `SharingReason` and `StaticResource`. Nine of them name nothing: a label, a document or a static resource is a
   text or a file and words about it, a global value set holds its own values, and the others are a name, an
   address or sizes. A type the schema of the library does not have, such as a parameter of a feature or a
   resource of DataWeave, cannot be in the table, because the test has nothing to hold it against.
3. **An answer about what refers to a component leaves out a type of `notAnalysed` whose line names no type of
   the answer.** The types of the answer are those of the component, of what it contains and of the results, and
   every type that stays on the list. The last holds for a chain through components that are not analysed: a test
   suite names a class, and a class is not analysed and may refer to a field, so for an answer about a field the
   class stays, and the suite with it. A folder names the groups it is shared with, and a group names nothing, so
   for a snapshot that holds both, an answer about a field names neither. A type whose line names its own type,
   such as a custom permission that needs another one, stays only where its type is of the answer. A type that has
   no line stays for every question.
4. **An answer with `--outgoing` is not changed.** It names only the types of the component, of what it contains
   and of the results already, and the table does not say what a component of a type that is not analysed refers
   to beyond its type.
5. **A type of which the snapshot holds components that the source did not list counts as any other** (issue 78):
   it is among the types that are not analysed, also where the source listed none of it. Its two numbers are then
   `0`, because they count what the source listed. The answer does not say how many came back without being
   listed: `orglens coverage` says it, and the JSON of an answer has no field for it.

## Consequences

- On the fixture project, five types leave the list of an answer about a field: a custom label, the file of the
  labels, a custom permission, a folder of email templates and a global value set. Three stay, Apex classes,
  triggers and email templates, so `complete` stays false. An answer about the label keeps the file of the labels,
  and an answer about the custom permission keeps the custom permissions. Tests hold the three.
- On the public codebases of `fixtures/corpora.toml`, at the commits that file pins, the built command was asked
  by hand on 2026-11-24 about every field of a sample of 30 to 39 fields in each. Every answer about a field
  listed 29 types where it would have listed 33 in PMM, 25 where 37 in NPSP, 23 where 32 in Nebula Logger and 13
  where 18 in Apex Recipes, whether it had results or not. Most of what stays is
  of a type that names fields, such as a layout, a list view, a permission set or a page, or is code, which a
  later phase reads.
- `complete` is true for an answer about what refers to a component only once every type that stays is analysed.
  No snapshot of the tests reaches that while Apex is not analysed.
- Nothing changes in the database or in the shape of the JSON. Fewer types are in `notAnalysed`, and an answer is
  complete in more cases. `mayMiss` and the exit code do not depend on that list.
- The table is read from the schema of the library and not tried on an org. The schema does not say which
  version of the Metadata API it was made from. It lacks types that the public codebases hold, such as the
  parameters of a feature, so it is older than they are, and a field that Salesforce added to a type since is not
  in it. Where such a field names a component, the table says too little of its type, and the type is left out of
  an answer it can be in. The test fails only when the library changes, and each line is then read by hand
  again.
- A text such as the value of a label, a description or the content of a file is no name that Salesforce
  resolves, and the table does not count it. A static resource can hold code that names a field, which is then not
  read as a reference, as before.
- A type leaves the table when it is analysed: the test fails until its line is taken out.
- On the mock org, an answer with `--outgoing` about the file of labels that came back without being listed is
  not complete, and names the type with `0` and `0`. A test holds it.
