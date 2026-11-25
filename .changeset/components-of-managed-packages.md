---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org now knows which of its components are of a managed package installed in the org: those the
org lists with the prefix of a package and a state of an installed one. `impact` leaves them out of what refers to
a component, counts them in a line of the text and in `packagesLeftOut`, and walks on through them, so that a
component of the org that refers to the component through one of a package stays in the answer. `--packages`
keeps them, with a column `PACKAGE`. Every result and the component that was asked about say their package in
`package`. An answer about what a component refers to leaves nothing out. `coverage`, `snapshot` and `analyse`
count per type how many listed components are of a package (`packaged`), with a column `OF PACKAGES` where there
is one. A component of a package that the org lists and Salesforce does not hand out is now a warning
`NOT_RETRIEVED` with `details.ofPackages`, which does not make the snapshot partial. The snapshot keeps the name a
component came back with, so that the cross-check matches the rows of the Dependency API about it; a snapshot that
is already there has no such name until it is taken again. The database moves to schema version 10. Decision
record 0076. Not verified on an org: the test org has no package.
