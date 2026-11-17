# 0046. When a snapshot of an org is complete: the logic tier, type by type

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (work package 9 of the Phase 1 plan. It builds what record 0038 decided, and holds the choices
  its author made while building it)

## Context

Record [0038](0038-a-snapshot-reads-every-type.md) holds what the maintainer decided when approving the
[Phase 1 plan](../plans/phase-1.md): a snapshot of an org reads every type, and "complete is judged over the logic
tier". The record adds three readings of its author: the logic tier is the list of record
[0004](0004-metadata-coverage-tiers.md) with custom labels, custom permissions and global value sets, what is
missing outside the tier is a warning, and a file whose type cannot be told counts against the tier.

Until this record a snapshot of an org was partial for anything the org listed and did not hand out, whatever its
type (record [0032](0032-reading-an-org.md)). On the test org that is every snapshot: the org lists 223
components it does not hand out, 209 of them outside the logic tier.

Records 0004 and 0038 name the tier in words: "objects, fields including formulas, validation rules". The code
needs names of the Metadata API, and a rule for three things the words do not settle: a part of an object that
the list does not name, a retrieve that fails for components of several types, and a file that cannot be read,
which has no type by definition.

## Decision

### The list

The logic tier is a list of 21 names of the Metadata API, kept in one place, `core/tiers.ts`. A test pins the
list, checks every name against the registry of the Salesforce library, and holds the list in `docs/cli.md`
against it.

| The words of records 0004 and 0038                  | The names                                          |
| --------------------------------------------------- | -------------------------------------------------- |
| Objects                                             | `CustomObject`                                     |
| Fields including formulas                           | `CustomField`                                      |
| Validation rules                                    | `ValidationRule`                                   |
| Apex classes and triggers                           | `ApexClass`, `ApexTrigger`                         |
| Flows                                               | `Flow`                                             |
| Workflow rules                                      | `WorkflowRule`, and `Workflow`, the file of them   |
| Record types                                        | `RecordType`                                       |
| Custom metadata types and their records             | `CustomObject` for a type, `CustomMetadata`        |
| Field sets                                          | `FieldSet`                                         |
| Profiles, permission sets and permission set groups | `Profile`, `PermissionSet`, `PermissionSetGroup`   |
| Lightning web components and Aura components        | `LightningComponentBundle`, `AuraDefinitionBundle` |
| Named credentials                                   | `NamedCredential`                                  |
| Custom labels (0038)                                | `CustomLabels`, the file, and `CustomLabel`        |
| Custom permissions (0038)                           | `CustomPermission`                                 |
| Global value sets (0038)                            | `GlobalValueSet`                                   |

Every other type is `other`. That is not the presentation tier of record 0004: it is everything the list does not
name, the presentation tier included.

### A type counts by its own name

A type is of the tier if its name is in the list, and for no other reason. An object is of the tier, and so are
its fields, validation rules, record types and field sets, because the list names them. The other parts of an
object are outside it: list views, web links, compact layouts, business processes, sharing reasons and indexes.
The same holds for the file of workflow rules: the rules are of the tier, and the field updates, alerts, tasks
and outbound messages in the same file are not.

### What is missing is an error in the tier and a warning outside it

Four issues of the reading say that something is missing: `LISTING_FAILED`, `RETRIEVE_FAILED`, `NOT_RETRIEVED`
and `RESOLVE_FAILED`. Each has the severity `error` when it counts against the logic tier and `warning` when it
does not. Each carries which of the two in `details.tier`, as `logic` or `other`. The message of a warning ends
with a sentence that says it is outside the tier and does not make the snapshot partial.

- `LISTING_FAILED` and `NOT_RETRIEVED` are about one type, and count by that type.
- `RETRIEVE_FAILED` is about the components of one retrieve. It counts against the tier if one of them is of
  the tier. Their types are in `details.types`.
- `RESOLVE_FAILED` is about a component or a file. A component counts by its type. A file counts by the types
  that keep their files in its top folder, as the registry of the Salesforce library says: a file under
  `reports` can be a report or a report folder and is outside the tier, a file under `classes` counts against
  it. The types are in `details.types`.
- A file in a folder of no type the registry knows, a file beside the folders, and a file outside the package
  that was asked for have no type that can be told. `details.types` is empty, and they count against the tier.

The status of a snapshot is decided as before: it is `partial` if the reading left an issue of the severity
`error`. No status is added, and the database is not changed. A snapshot that an earlier version took keeps the
status that version gave it, and its issues carry no tier.

A snapshot of a Git source is not changed. Whatever its folders hold and cannot be read makes it partial.

### What the commands show

`snapshot`, `analyse` and `coverage` call a complete snapshot with such a warning "complete for the logic tier,
and something of other types is missing", in the first line of the report. The warnings are in the table of
issues below it, one per type for what did not come back, with the count. The exit code is that of a complete
snapshot.

### An impact answer still counts what it covers

`notCovered.readErrors` of an impact answer counted the errors of the reading (record
[0044](0044-an-impact-answer.md)). A `RESOLVE_FAILED` or `RETRIEVE_FAILED` outside the tier is no error any more.
It is counted all the same if one of its `details.types` is a type the answer covers: a type the analysis read,
or a type the analysis found a component of. So an answer says that it may miss something when a list view could
not be read, once list views are components, and says nothing of the kind for a report. `NOT_RETRIEVED` and
`LISTING_FAILED` need no such rule: the counts of the type tell them, in `notCovered.partial`, whatever their
severity.

## What goes further than records 0004 and 0038

These are choices of the author of this record. The maintainer can strike any of them.

1. **The 21 names.** Records 0004 and 0038 hold words. `Workflow` and `CustomLabels` are in the list because the
   org lists the file and its parts as types of their own. A custom metadata type is counted as a `CustomObject`.
2. **A part of an object that the list does not name is outside the tier.** The other reading takes every part
   of an object with the object. The test org lists 224 list views and hands out 53 (record 0038). With that
   reading a snapshot of it could never be complete, and record 0004 puts list views in the presentation tier.
3. **A retrieve that fails counts against the tier if one of its components is of the tier.** A failure is
   narrowed to one component wherever Salesforce allows it. A chunk that was started three times without a
   result is not narrowed, and can count against the tier for a cause that lies in a report.
4. **A file is placed by its top folder.** A file under `objects` counts against the tier, also when it lies in
   the folder of the list views of an object. No folder is shared by types of both tiers today. One that were
   would count against the tier.
5. **The warnings keep their codes.** The other way was a code of its own for what is missing outside the tier.
   One code with `details.tier` keeps a script that looks for `NOT_RETRIEVED` working.
6. **The words of the first line**, and that it is said in the first line at all.
7. **What an impact answer counts**, as the section above says.

## Not done

- The key in `orglens.toml` that leaves types out of a snapshot. Record 0038 leaves it undecided, the plan
  proposes it, and the maintainer was asked on 17 November 2026. It is built in a pull request of its own, or not
  at all.
- The open points of the test org in types of the logic tier (record 0038 lists them) were not looked at when
  this was written. They are the next step of the work package.
- Record 0044 says that this work package can narrow `notCovered.notAnalysed` to the types that can refer to
  the component. It is not narrowed. The tier does not say which type can refer to which: a report outside the
  tier can refer to a field.
- An error of the reading still counts in `readErrors` whatever its type, also for a class, which no analyser
  reads yet.

## Consequences

- A snapshot of an org that was `partial` only for types outside the tier is now `complete`, and `snapshot` ends
  with `0` where it ended with `5`. A script that needs every type reads the issues and their `details.tier`.
- Not verified on a real org when this was written. On the test org, thirteen components of types of the tier do
  not come back and three files cannot be read as metadata (record 0038), so its snapshot is expected to stay
  partial until those are explained. What the snapshot of the test org says is recorded with the run.
- Every snapshot of an org that lacks something outside the tier carries warnings, and a first line that says
  so. A user can learn to read past both (risk 13 of the [overall plan](../plans/re-architecture-plan.md)).
- "Complete" says less than the word. It does not say that every component of the org is in the snapshot. It
  says that nothing the org listed of the 21 types is missing. Profiles and permission sets are still read
  incompletely (`ACCESS_INCOMPLETE`), standard value sets are still not read (`TYPE_NOT_READ`), and what the org
  does not list is still not known to be missing.
- When a type outside the tier gets an analyser, whether it then counts for "complete" stays undecided, as
  record 0038 says. An impact answer counts it either way.
- The list is a part of the contract of the command line: it is written out in `docs/cli.md`, and a change to
  it changes what `complete` means.
- The issues of the four codes have new fields, `details.tier` and for two of them `details.types`. The JSON
  Schema does not describe the fields of `details`, so only its descriptions change.
