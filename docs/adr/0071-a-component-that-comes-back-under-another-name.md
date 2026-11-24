# 0071. A document and what belongs to person accounts come back under another name than the org lists

- Status: Accepted
- Date: 2026-11-24
- Decisions: none (a correction made after a snapshot of a large org, with the choices the author made in it)
- Changed by: [0072](0072-a-folder-in-a-folder-comes-back-under-its-whole-path.md), which adds a fourth way, for a report, a dashboard and their folders in a folder inside a folder, and one condition: no other component that came back in the same retrieve stands for the same listed name. It puts the names of the note of this record in the order of the listed names

## Context

A snapshot of an org counts what came back against what the org listed. Record
[0047](0047-what-the-org-says-where-the-library-falls-short.md) found one kind of component that the org lists
under one name and that comes back under another: a component of a package, which comes back without the prefix
of the package. It takes what came back for the listed component under conditions that leave no other reading.

On 2026-11-23 the maintainer took a snapshot of a large org. It showed two more kinds. Each such component was
counted twice: as a component the org listed that did not come back, and as a component that came back although
the org had not listed it. One of them was a record type, which is of the logic tier, so the snapshot was partial
for a component whose file it held. The names in this record are made up.

- **A document.** The org lists a document with the ending of its file, as `Assets/Logo.png`, and a retrieve asks
  for it by that name. The Salesforce library names the component `Assets/Logo`: it takes the name of the file up
  to its first dot. That Salesforce names a document with the ending is known to the library: where Salesforce
  names a document in the messages of a deploy, the library takes the ending off (`client/deployMessages.js` of
  version 13.13.0). It does nothing of the kind for what an org lists.
- **What belongs to person accounts.** The org lists a record type of person accounts under the object `Account`,
  as `Account.Client`, and hands it out in the file of the object `PersonAccount`, where the library names it
  `PersonAccount.Client`. A public report shows that listing for record types
  ([mdapi-issues/listmetadata-recordtype-personaccount](https://github.com/mdapi-issues/listmetadata-recordtype-personaccount),
  read on 2026-11-24). The large org showed the same for a matching rule and for a duplicate rule: listed under
  `Account`, and back under `PersonAccount`. The documentation of Salesforce says that the matching rules of
  person accounts are in the file `PersonAccount.matchingRule`
  ([MatchingRule](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_matchingrule.htm),
  read on 2026-11-24). It does not say how they are listed.

A record type and a matching rule are parts: they come with their parent, the object or the file of rules, and a
retrieve does not name them. A duplicate rule is retrieved by its own name, and so is a document.

## Decision

A component that comes back in a retrieve under a name the org did not list counts as a component the org listed,
and that one as retrieved, when exactly one listed name can stand for it by one of three rules, and the conditions
below hold.

**The rules.** The type is the same in each.

- **The prefix of a package**, as in record 0047: the retrieve asked for a name that is the name that came back
  behind a prefix and two underscores, and the org states that prefix as the package of the listed component.
- **The ending of the file of a document.** The type is `Document`. The retrieve asked for a name that is the name
  that came back with an ending behind it. The ending starts at the first dot of the name of the file, which is
  what follows the last slash, as the library cuts it: `Assets/Terms.v2.txt` comes back as `Assets/Terms`.
- **Person accounts.** The name that came back starts with `PersonAccount.`, and the org lists the same name with
  `Account.` in that place. The retrieve asked for that listed name, or it asked for no component of the type at
  all. The second is the case of a part, which comes with its parent.

**The conditions**, for all three:

- The org lists nothing under the name that came back, and the retrieve did not ask for it. A name the org lists
  is that component, whatever else could be meant.
- The listed name did not come back itself in the same retrieve. Then what came back under the other name is a
  component of its own. This condition is new for the prefix as well, and is the one change to record 0047.
- Salesforce did not remark about the retrieve that it cannot find the listed name.
- No second listed name can stand for the name that came back in the same retrieve, by any of the rules. A name
  that can stand for it is one the retrieve asked for, or the listed name under `Account`. Two documents whose
  names differ in the ending only, asked for in one retrieve: nothing says which one came back, so neither counts.

Otherwise the component that came back is one the org had not listed, as before. Where a rule holds, the row of
the listed name is marked, and no row is made for the name that came back.

**The note.** `RETRIEVED_UNDER_ANOTHER_NAME` says how many components of a type came back that way in one
retrieve, names the first ones as the org lists them, and says why in `details.reason`: `file-ending` or
`person-account`. A component of a package keeps the note of record 0047, `RETRIEVED_WITHOUT_PREFIX`.

**The names of the snapshot.** The files and the keys of the components keep the name that came back:
`Document:Assets/Logo` and `RecordType:PersonAccount.Client`. That is the name a repository has for them, and the
name an impact question is asked with. Nothing in the database ties it to the listed name beyond the count.

## What goes further than the snapshot showed

These are choices of the author of this record. The maintainer can strike any of them.

1. **The rule for person accounts holds for every type**, although it was seen for three. A type whose components
   the org lists under `PersonAccount` never meets it.
2. **The rule for the ending holds for a document only.** It is the one type that is known to be listed with the
   ending of its file. A test holds that a component of another type is not taken this way.
3. **A part is taken without a word about its parent.** For a part, the rule asks only that the retrieve named no
   component of the type. It does not ask that the retrieve named the object `PersonAccount`: the store does not
   know which type is a part of which, and a part cannot come back without the file of its parent. For the same
   reason the branch holds for a type that is retrieved by its own name, such as a duplicate rule, in a retrieve
   that asked for no component of that type. Salesforce is not known to hand out a component that no retrieve
   asked for. If it did, the component would be taken for the listed one, and a later retrieve that asks for the
   listed name and gets the remark that it cannot be found would not undo that.
4. **The rules err to the side of "missing"**, as in record 0047. Each condition can leave a component as not
   retrieved that did come back. None can call a component retrieved because another one came back, as far as its
   author can see, with the cases below: two components whose names differ in `Account.` and `PersonAccount.`
   or in the ending of a document, and that come back in two retrieves, and the case of choice 3 for a type that
   is retrieved by its own name.
5. **One note with a reason**, and not a code for each rule. A third rule of this kind, which the same snapshot
   asks for, then adds a reason and no code.
6. **No column for the name a component came back with**, as in record 0047. It would need a migration.
7. **The mock org of the tests lists what the large org showed**: a document with the ending of its file, and a
   record type, a matching rule and a duplicate rule of person accounts under the object `Account`. It is asked
   for them by the listed name and hands out the files under the other one. It also lists the object
   `PersonAccount` and the file of matching rules `PersonAccount`, which is why the snapshot asks for them. That an
   org lists these two is an assumption of the author, and a test holds what happens where the object is not
   listed.

## Not done

- **Not verified on an org.** The test org has no person accounts and no document. The next snapshot of the large
  org shows whether its documents, its record type and its rules count as retrieved.
- **An org that lists nothing under the object `PersonAccount`.** A part is asked for through its parent, and the
  parent of a part the org lists as `Account.Client` is the object `Account`. The object `PersonAccount` is asked
  for only when the org lists it, or lists a part under its name. Whether an org with person accounts can list
  neither is not known. Its record types of person accounts would then not come back, and stay missing, and the
  snapshot would be partial: a test holds that. The same is so for the file of matching rules `PersonAccount`.
- **Two components of one type named `Account.Client` and `PersonAccount.Client`, of which the org lists the
  first name only.** This holds for every type, such as a field `Account.Hobby__pc` that an org lists and a field
  `PersonAccount.Hobby__pc` in the file of the object `PersonAccount`, which the Salesforce library reads as a
  component of its own. If both come back in one retrieve, the second is a component the org had not listed, as it
  should be. If they come back in two retrieves, in either order, the second is taken for the first and counted
  nowhere. Where the one under `PersonAccount` comes first, the listed one counts as retrieved, also if no later
  retrieve hands it out. Which retrieve a component comes in depends on where the snapshot cuts its chunks, so the
  number of components the org had not listed depends on it too. The files are in the snapshot all the same. As
  far as the author knows, a record type cannot be in this case: a record type of person accounts is a record type
  of the object `Account`, and a name is used once in an object. That is not verified, and whether a field, a
  matching rule or a duplicate rule can be in this case is not known.
- **Two documents whose names differ in the ending only, asked for in two retrieves.** Each retrieve has one name
  that can stand for the document that comes back, so each takes it, with a note. Whether an org can hold two such
  documents in one folder is not known.
- **A document whose file has no ending** needs no rule for its name. The library does not read such a file at
  all: it says that the file belongs to no type it knows. The file is the issue `RESOLVE_FAILED`, and the document
  stays missing. Both are warnings: a document is outside the logic tier. How an org lists such a document was
  not seen.
- **A document of a package.** Whether the org lists it with a prefix, and where, was not seen. A name with a
  prefix and an ending fits neither rule, and stays missing.
- **The cross-check.** It finds the component of a row by the id the org listed, under the listed name. A record
  type of person accounts is listed as `Account.Client`, and the analysis knows it as
  `RecordType:PersonAccount.Client`. A row of the Dependency API about such a record type would be held against a
  name the analysis does not have. The test org reported no row from a record type (record
  [0065](0065-record-types-field-sets-and-records-of-custom-metadata.md)). Whether an org reports a row from or
  to a record type of person accounts is not known. This is as it was before this record.
- **Reports and dashboards in a folder inside a folder.** The same snapshot showed them listed under the name of
  the inner folder and back under the whole path. That is a rule of its own with a pull request of its own.

## Consequences

- A snapshot of an org with person accounts can be complete where it was partial, and `snapshot` then ends with
  `0` where it ended with `5`.
- The counts of a type can change: the listed components count as retrieved, and the same number is no longer
  "not listed".
- The JSON output changes in one place: the issue code `RETRIEVED_UNDER_ANOTHER_NAME` is new. The JSON Schema
  does not describe the fields of `details` or list the codes, so only `docs/cli.md` changes.
- `markRetrieved` of the store returns each listed name with the rule that found it.
