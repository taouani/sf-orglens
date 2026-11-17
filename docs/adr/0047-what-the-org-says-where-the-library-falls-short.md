# 0047. Where the Salesforce library falls short, a snapshot of an org takes the word of the org

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (work package 9 of the Phase 1 plan. It holds two corrections made after the first run of the
  test org with the judgement of record 0046, and the choices their author made)

## Context

Record [0046](0046-complete-over-the-logic-tier.md) judges a snapshot of an org over the logic tier. Run 13 of
the workflow "Live org" was the first with that judgement
([real-org.md](../research/phase-1/real-org.md#8-the-snapshot-judged-over-the-logic-tier)). The snapshot of the
test org stayed partial, as expected, for two kinds of things:

- **Three files that could not be read as metadata.** Each lies one level deep in a folder that the registry of
  the Salesforce library knows no type for, so nothing told their type, and they counted against the tier. The
  run names 81 types of which the org lists a component or refuses the listing. The library, version 13.12.0,
  knows 79 of them. The two it does not know are `ContentWorkspace`, whose listing the org refuses, and
  `ContentWorkspacePermission`, of which the org lists three components and none came back. That the three files are those three components is a reading of the counts:
  the log shows no name of a folder that is not of the source format.
- **Thirteen components of types of the tier that did not come back.** Seven are bundles of an installed
  package (`LightningComponentBundle`). The org lists them with the prefix of the package, and seven bundles
  came back that the org had not listed. For five, the tool of the run found the bundle that came back under
  the name without the prefix. Its rule could not see the other two: it takes a short name after a prefix for
  the ending of a custom object.

The org describes its types with the folder a retrieve puts their files in (`directoryName` of
`describeMetadata`). The org says of every component it lists which package it is of (`namespacePrefix`). The
engine used neither.

## Decision

### A file in a folder the library does not know is counted by the type the org describes with that folder

When a file of a retrieve cannot be read as metadata and the library knows no type for its top folder, the
engine asks the org to describe its types and takes the types that keep their files in a folder of that name,
with the types of their parts. `RESOLVE_FAILED` then carries them in `details.types`, says
`details.describedByOrg`, and is an error or a warning by the tier of those types, as for any other file.

- The file is still not in the snapshot. The library cannot read a type it does not know, and the engine does
  not read metadata without it. The component the file is of stays `NOT_RETRIEVED`, judged by its own type.
- The org is asked once per run, and only when such a file came back. A snapshot that reads no such file makes
  no request more than before.
- If the org refuses to describe its types at that moment, the file has no type and counts against the tier, as
  before.
- A file in a folder that neither the library nor the org knows a type for counts against the tier, as before.

### A component of a package that comes back without the prefix is the one the org listed

When a component comes back under a name the org did not list, and the org lists exactly one component of the
same type that is of a package and whose name is that name behind the prefix of the package and two
underscores, the listed component counts as retrieved. No row is made for the short name. The note
`RETRIEVED_WITHOUT_PREFIX` says how many components of a type came back that way and names the first ones as
the org lists them.

- A name the org lists itself is that component, whatever else could be meant.
- The prefix is the one the org states for the listed component, not what the name looks like.
- Two packages with a component of the same short name: nothing says which one came back, so neither counts,
  and the component that came back is one the org had not listed, as before.
- The files of the snapshot keep the name they came with, without the prefix. Nothing in the database ties that
  name to the listed one beyond the count.

## What goes further than the plan

These are choices of the author of this record. The maintainer can strike any of them.

1. **The word of the org decides the tier of a file.** The other way leaves every file of a type the library
   does not know as an error, and every org with such a type partial until the library catches up.
2. **Parts of the described type are counted with it**, as record 0046 does for the types the library knows.
3. **The rule for the prefix holds for every type**, although it was seen for one. A type whose components come
   back with the prefix never meets it.
4. **A note of its own, `RETRIEVED_WITHOUT_PREFIX`**, so that the change of name is not silent.
5. **No column for the name a component came back with.** It would need a migration, and no analyser reads a
   bundle yet.

## Not done

- A file of a type the library does not know is not read and not stored.
- The two fields and two record types whose object the org does not list, and the two objects that did not come
  back, are not explained by this record. The tool of the run now says more about them without a name: how the
  name of an object ends, how many objects they are, and of which of them Salesforce remarked that it cannot
  find them. What the next run says is recorded with it.
- When bundles are analysed, the analyser has to know that a bundle of a package is listed with a prefix and
  lies in a folder without it. The cross-check matches a row by the id the org listed a component with, and
  finds no component under the listed name. No bundle is analysed today, so no row is compared that way.
- No test makes the org refuse to describe its types in the middle of a snapshot.

## Consequences

- A snapshot of an org with a type the library does not know can be complete where it was partial, and
  `snapshot` then ends with `0` where it ended with `5`. The warning names the file and the type.
- A snapshot of an org with bundles of a package can be complete where it was partial. The counts of the type
  change: the listed components count as retrieved, and the same number is no longer "not listed".
- Not verified on a real org when this was written. The next run of the test org shows whether the three files
  and the seven bundles are what this record takes them for.
- The JSON output changes in two places: `RESOLVE_FAILED` can carry `details.describedByOrg`, and the issue code
  `RETRIEVED_WITHOUT_PREFIX` is new. The JSON Schema does not describe the fields of `details` or list the codes,
  so only `docs/cli.md` changes.
- "Complete" still says less than the word, as record 0046 says. A type the library does not know is in the
  snapshot with a count and without a file.
