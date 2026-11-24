# 0072. A report, a dashboard and their folders come back under the whole path of their folders

- Status: Accepted
- Date: 2026-11-24
- Decisions: none (a correction made after a snapshot of a large org, with the choices the author made in it)

## Context

Record [0071](0071-a-component-that-comes-back-under-another-name.md) takes a component that comes back under
another name than the org lists it with for the listed one, by three rules and under conditions that leave no other
reading. The snapshot of a large org that the maintainer took on 2026-11-23 showed a fourth kind, which that record
names as not done: what lies in a folder that lies in a folder. The names in this record are made up.

- **The org lists by the inner folder.** A folder of reports `Quarterly` that lies in the folder `Finance` is
  listed as `Quarterly`, and a report in it as `Quarterly/Revenue`. It was the same for dashboards and their
  folders.
- **A retrieve asks by those names.** A report is asked for as the org lists it. A folder is asked for under the
  type of what it holds (`sources/chunks.ts`): the folder `Quarterly` as the report `Quarterly`. So no retrieve
  ever names a component of the type `ReportFolder` or `DashboardFolder`.
- **The org hands out the whole path.** The files are `reports/Finance/Quarterly-meta.xml` and
  `reports/Finance/Quarterly/Revenue.report`, and the Salesforce library names the components
  `Finance/Quarterly` and `Finance/Quarterly/Revenue`.

Each such component was counted twice: as a component the org listed that did not come back, and as a component
that came back although the org had not listed it. All four types are outside the logic tier, so these were
warnings, and no snapshot was partial for them.

The documentation of Salesforce says that a folder in a folder is named in a manifest by its whole path with a
slash at the end, under the type of what it holds, and that a name with a slash in it and none at its end is read
as a report in a folder
([Folder](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_folder.htm) and
[Report](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_report.htm), read on
2026-11-24). Of a listing it says that the name of a report is the name of its folder and its own. It does not say
by which name an org lists a folder in a folder. The Salesforce library writes a manifest as the documentation
says, and reads the files as said above: both were tried with version 13.13.0.

## Decision

The rule of record 0071 gets a fourth way in which a listed name can stand for the name that came back. The type
is the same, as in the other three.

- **The path of the folders.** The type is `Report`, `Dashboard`, `ReportFolder` or `DashboardFolder`. The listed
  name is an end of the name that came back, which starts behind one of its slashes: `Quarterly/Revenue` for
  `Finance/Quarterly/Revenue`, and `Quarterly` for the folder `Finance/Quarterly`. The retrieve asked for that
  listed name, or it asked for no component of the type at all. The second is the case of a folder.

The conditions of record 0071 hold as they are: the org lists nothing under the name that came back, and the
retrieve did not ask for it. The listed name did not come back itself in the same retrieve. Salesforce did not
remark that it cannot find the listed name. No second listed name can stand for the name that came back, by any of
the rules. Where the rule holds, the row of the listed name is marked, and no row is made for the name that came
back.

**The note** is the one of record 0071, `RETRIEVED_UNDER_ANOTHER_NAME`, with `folder-path` in `details.reason`.

**The names of the snapshot.** The files and the keys of the components keep the whole path, as a repository has
it: `Report:Finance/Quarterly/Revenue`.

## What goes further than the snapshot showed

These are choices of the author of this record. The maintainer can strike any of them.

1. **Every end of the path can be the listed name**, and not only the one with the innermost folder. A report
   three folders deep is offered under each shorter path. Only a name the org lists is taken, so this adds
   nothing where the org lists as the large org did. How deep the folders of that org lie was not looked at.
2. **A folder is taken without a word about what the retrieve asked for.** For a folder, the rule asks only that
   the retrieve named no component of the type of the folder. It does not ask that the retrieve named the folder
   under the type of what it holds: the store does not know which type holds which, as it does not know which
   type is a part of which (record 0071, choice 3).
3. **Four types and no other.** They are the ones the snapshot showed. A test holds that an email template whose
   name ends as a listed one does is not taken this way.
4. **The names of a note are in the order of the listed names**, by code unit, for every reason and for the note
   `RETRIEVED_WITHOUT_PREFIX` as well. They were in the order of the names that came back, which is not always
   the same: the folders `Finance/Quarterly` and `Finance/Quarterly/Archive` come back in that order, and are
   listed as `Quarterly` and `Archive`. A note names the first fifty, and its message the first one.
5. **The mock org of the tests lists as the large org did**: a report, a dashboard and a folder of either without
   the folders around the innermost one. It is asked by those names and hands out the whole path.

## Not done

- **Not verified on an org.** The test org has no folder in a folder. The next snapshot of the large org shows
  whether its reports, dashboards and folders count as retrieved.
- **Two folders of one name in two folders.** The rule takes the name of a folder to be used once in an org. The
  documentation of Salesforce says of the name of a folder that it is unique in the org
  ([Folder](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_folder.htm),
  the object, read on 2026-11-24). That was not tried on an org. If an org can hold `Finance/Archive` and
  `Sales/Archive`, it lists the name `Archive` for both, and the row of that name stands for whichever comes
  back. The other one is then counted nowhere, whether it comes back in the same retrieve or in a later one. Its
  file is in the snapshot all the same. The same holds for two reports of one name in those two folders.
- **What did not come back under either name.** Some reports and dashboards the large org listed came back under
  no name. Why is not known, and this record changes nothing for them: they stay missing, with a warning.
- **The name of the file in a listing.** An org names a file for every component it lists. The snapshot does not
  read that name. Whether it holds the whole path of such a component was not seen. If it does, it says which
  listed name a component that came back belongs to, without a rule.
- **A folder of email templates in a folder**, and a report of a package in such a folder, were not seen. Neither
  is taken by this rule: the first for its type, the second where its listed name is not an end of the name that
  came back.
- **The cross-check** finds the component of a row by the id the org listed, under the listed name, as record
  0071 says. A report and a dashboard are not analysed, so a row from one is not compared. This is as it was
  before this record.

## Consequences

- The counts of the four types change: the listed components count as retrieved, and the same number is no
  longer "not listed". The warnings about them fall away. No snapshot changes between `complete` and `partial`.
- The JSON output changes in two places: `details.reason` of the note `RETRIEVED_UNDER_ANOTHER_NAME` has the new
  value `folder-path`, and the names in `details.components` of that note and of `RETRIEVED_WITHOUT_PREFIX` are
  in the order of the listed names. The JSON Schema does not describe the fields of `details`, so only
  `docs/cli.md` changes.
- `OtherNameRule` of the store has one more member.
