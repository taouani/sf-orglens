# 0076. A component is of a package where the org lists it as one, and an answer leaves it out as the thing that refers

- Status: Accepted
- Date: 2026-11-25
- Decisions: none (it builds the answer of record 0056 in work package 7 of the Phase 2 plan, with what the
  maintainer answered on 2026-11-25 and the choices of the author, which the maintainer can strike)

## Context

The maintainer chose with question Q2 of the [Phase 2 plan](../plans/phase-2.md) that a snapshot reads and keeps
the components of a managed package, that each is marked with its package, that an impact answer leaves them out
as the thing that refers and keeps them as targets, and that an option of `impact` shows them (record
[0056](0056-components-of-a-managed-package.md)). Record 0056 left five points to work package 7: how a component
is known to be of a package, that a repository of a package project is no package, the line and the field that say
how many results were left out, a chain through a component of a package, and a pair of the Dependency API from a
component of a package.

The org says of every component it lists the prefix of its namespace (`namespacePrefix`) and its state
(`manageableState`), and a snapshot of an org keeps both (`inventory_item`). A component of an installed managed
package is `installed` or `installedEditable`, or `deprecated` or `deprecatedEditable` where the package no longer
holds it. A component of the org's own namespace is `released` or `beta`, and one of no package `unmanaged`.

A component can come back under another name than the org lists it with (records
[0047](0047-what-the-org-says-where-the-library-falls-short.md),
[0071](0071-a-component-that-comes-back-under-another-name.md) and
[0072](0072-a-folder-in-a-folder-comes-back-under-its-whole-path.md)), among them a component of a package without
the prefix of its package. The snapshot marked the row of the listed name as retrieved and held the
component under the name that came back, and kept no tie between the two (record 0047, choice 6). So the package
of such a component was not known of the component the snapshot holds, and the cross-check could not match a row
of the Dependency API to it.

Record [0046](0046-complete-over-the-logic-tier.md) makes a component of the logic tier that the org lists and
Salesforce does not hand out an error, which makes the snapshot partial, and the maintainer confirmed that rule on
2026-11-17. Salesforce does not hand out a protected component of a package, such as a protected custom label, so
an org with one is never complete. The maintainer was asked on 2026-11-25 whether such a component of a package
should make a snapshot partial, and answered on the same day: no, it is a warning.

## Decision

1. **A component of a snapshot of an org is of a package where the org lists it with a prefix and one of the four
   states of an installed package**, under its listed name or under the name it came back with. Its package is
   that prefix. A part that the analysis makes of a component, such as an element of a flow, is of the package of
   the component. Nothing else is taken: not the prefix in a name, which a component can carry for another one it
   belongs to, as a tab carries the name of its object, and not a component the org does not list. This departs
   from a sentence of the plan, which names the prefix of the name as well: the org states the package of every
   component it lists, and a name can only mislead beside it.
2. **Nothing of a snapshot of a repository is of a package.** A repository has no listing. A repository of a
   package project, such as NPSP, holds its own components, also those whose names carry the prefix of another
   package: NPSP holds the tabs of three objects of other packages.
3. **The name a listed component came back with is kept with its row** (`inventory_item.came_back_as`, migration
   10), where it is another name, whichever rule took it for the listed one. The package of the component is read
   from the row, and the cross-check matches a row of the Dependency API by the id of the listed component to the
   component the snapshot holds. This replaces choice 6 of record 0047.
4. **An answer about what refers to a component leaves a result of a package out, counts it
   (`packagesLeftOut`), and says so in a line of its own.** `impact --packages` keeps it. Every result and the
   component that was asked about say which package they are of (`package`). The text shows a column `PACKAGE`
   where a result is of one, and a line where the component is.
5. **The walk goes on through a component of a package that it leaves out.** A component of the org that refers to
   it is a result, and its reference names the component of the package, which is then no result. The text says
   so in a line. What the answer does not cover is reckoned with every component the walk found, also one it left
   out: a warning of a component of a package counts where it bears on the answer.
6. **An answer about what a component refers to leaves nothing out.** A component of a package that a component
   of the org refers to is a target, and so is what that component refers to. `--packages` changes nothing there.
7. **A component of a package that the org lists and Salesforce does not hand out is a warning**, the maintainer's
   answer of 2026-11-25. The issue keeps the code `NOT_RETRIEVED`, with `details.ofPackages` set to `true` and the
   tier of its type, and does not make the snapshot partial. The components of the org's own that did not come
   back are an issue of their own, judged by the tier as before.
8. **Such a component makes no type partial in an answer that does not count it**: in an answer about what refers
   to a component, unless it keeps the components of packages, and in an answer about what a component refers to,
   where it is a target the snapshot does not hold and is counted as such (`notHeld`). With `--packages` the type
   is partial, and the answer may miss something.
9. **`coverage` counts per type how many of the components the org listed are of a package** (`packaged`), and
   the text shows a column `OF PACKAGES` where a type has one.
10. **A pair of the Dependency API from a component of a package is compared as any other.** A pair that the
    analysis lacks is the error `REFERENCE_MISSED`, also from a component of a package: the walk goes through such
    a component, so a reference it lacks can be one that an answer about the org misses.

## Consequences

- A snapshot taken before this record has no name a component came back with. Its components that came back
  under another name are of the org's own for an answer, and its rows of the Dependency API about them stay
  unmatched or not held, until the snapshot is taken again. Every other component of a package is known as such in
  every snapshot of an org since Phase 1, which kept the prefix and the state. A snapshot keeps the status it was
  given, also one that is partial only for components of packages.
- The rule of record 0047 errs to the side of "missing": it can leave a listed component of a package as not
  retrieved that did come back under its short name. That is now a warning and no longer makes the snapshot
  partial.
- An answer about a component of a snapshot of an org that has packages is shorter by what the packages refer to
  it with, and says how much. One about a component of a package keeps what of the org refers to it.
- The cross-check now matches a row about any component that came back under another name to the component the
  snapshot holds: a document, a part of a person account, a report or folder in a folder, and a component of a
  package. Such a row was counted as not held, or not compared. It is now compared, and where the analysis names
  that component by the name the org lists it with, the pair is `REFERENCE_MISSED`. That is a reference an answer
  about the component the snapshot holds misses.
- The JSON of `impact` has two fields more, `package` on the component and on each result and `packagesLeftOut`,
  and that of `coverage`, `snapshot` and `analyse` one more on each type, `packaged`. The text of `impact` has one
  line and one column more where a package is in the answer, and that of `coverage` one column more where the org
  lists a component of a package.
- The text of a snapshot of a repository and of an org without packages does not change.
- Not done: a reference that names a component of a package by the name the org lists it with, with the prefix,
  does not reach the component the snapshot holds under the name it came back with. Only bundles of Lightning web
  components were seen to come back without the prefix, and no analyser reads a bundle. The mock org of the tests
  hands out every component of a package without the prefix, and the references to it are written without it.
- Not verified on an org: the test org has no package. The mock org of the tests lists components of a package
  as an org does, with the prefix and the state `installed`. Whether an org with a namespace of its own lists its
  components with `released`, as the documentation of the Metadata API says, is not verified either.
