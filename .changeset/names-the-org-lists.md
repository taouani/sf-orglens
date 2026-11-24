---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

A snapshot of an org no longer counts a document, or a record type, a matching rule or a duplicate rule of person
accounts, as missing when it came back. An org lists a document with the ending of its file, as `Assets/Logo.png`,
and the snapshot names it `Assets/Logo`. An org lists what belongs to person accounts under the object `Account`,
as `Account.Client`, and hands it out under the object `PersonAccount`. Each such component was counted twice: as
one the org listed that did not come back, and as one that came back although the org had not listed it. A record
type is of the logic tier, so the snapshot was partial for a record type whose file it held, and `orglens snapshot`
ended with `5`.

What comes back under the other name now counts as the listed component, under the conditions that already hold
for a component of a package that comes back without its prefix: the org lists nothing under the name that came
back, the retrieve did not ask for that name, Salesforce did not remark that it cannot find the listed name, and
no second listed name can stand for what came back. One condition is new, also for a component of a package: the
listed name did not come back itself in the same retrieve. The files and the keys of the snapshot keep the name
that came back. The new note `RETRIEVED_UNDER_ANOTHER_NAME` says how many components of a type came back that
way, and why in `details.reason`: `file-ending` or `person-account`.

Not verified on an org: the test org has no person accounts and no document. Not done: reports and dashboards in
a folder inside a folder, which an org lists under the name of the inner folder and hands out under the whole
path, and an org that lists nothing under the object `PersonAccount`, which is then not asked for it.
