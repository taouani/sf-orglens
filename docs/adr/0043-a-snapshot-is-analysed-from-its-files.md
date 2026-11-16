# 0043. A snapshot is analysed from the files it holds, and `orglens analyse` does it again

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (work package 6 of the Phase 1 plan. The command `analyse` extends record 0016, and the layout
  a snapshot keeps closes the open point of record 0032 about the project a Git source is read with)

## Context

Records [0041](0041-components-and-names-written-in-xml.md) and [0042](0042-the-names-in-a-formula.md) describe
an analysis of objects, fields, validation rules and their formulas. Record
[0040](0040-components-and-references-in-the-database.md) holds the tables for what it finds. No command ran it.

Work package 6 of the [Phase 1 plan](../plans/phase-1.md) asks for four things: `orglens snapshot` analyses what
it stored, `orglens analyse <source>` analyses a stored snapshot again, `coverage` shows per type and per origin
what was analysed, and `status` says whether the latest snapshot of a source is analysed. The maintainer chose
the command `analyse` with the answer to question Q7 of that plan. Record
[0016](0016-commands-config-and-json-contract.md) fixes the set of commands and does not hold it, so this record
adds it.

Records 0041 and 0042 left three questions to this work package: which issue of the analysis makes something
incomplete, how coverage counts the parts that the analysis finds inside files, and whether the place of a part
is counted from the start of the part.

Record [0032](0032-reading-an-org.md) left a fourth open: a project file can change which files make up which
component (`sourceBehaviorOptions`, `registryPresets`, `registryCustomizations`), and a Git source was read with
the project file of the folder the command runs in. A snapshot analysed later, from another folder, could then
be placed in another way than it was read, without a word: in the review of this work, a custom label was lost
and the analysis was called complete.

The plan fixes the outline, and the maintainer approved it. The points below are choices of the author, and the
maintainer's to strike.

## Decision

`orglens analyse <source> [--snapshot <number>]` joins the commands of record 0016. `api/analysis.ts` analyses a
stored snapshot: it reads the files of the snapshot from the database into a `SourceTree`, finds their
components with the Salesforce library, with the layout the snapshot keeps, runs `analyseSource` and writes the
result with `writeAnalysis`. Schema version 4 adds the column `snapshot.layout` for that layout.

These are choices of the author, fourteen in number.

1. **A snapshot is always analysed from the files it holds, never from the source.** `snapshot` stores first
   and analyses what it stored, so a snapshot that was just taken and one that was taken long ago go the same
   way, and `analyse` gives for a snapshot what `snapshot` gave.
2. **The analysis is written after the snapshot, in a transaction of its own.** If it fails as a whole, the
   snapshot stays, without an analysis or with the one it had. The command fails with the code of the failure.
   Its message says that the snapshot is stored, its hint names `orglens analyse` with the number of the
   snapshot, and `details.snapshot` holds that number. A snapshot of a Git source was one transaction before,
   and is two now.
3. **A snapshot keeps the layout its files were read with, and is always analysed with it.** A Git source is
   read with the settings of its own project file: the one at the top of `repo` on disk, or the one of the
   commit for a source with `ref`. That holds for a source with `paths` as well. The settings are stored with
   the snapshot as JSON, and the Salesforce library is handed them, never a folder, so the folder the command
   runs in plays no part in reading or in analysing. An org snapshot is stored in the standard layout (record
   [0032](0032-reading-an-org.md)) and keeps none. A setting the library does not know stops the reading with
   `SOURCE_READ_FAILED` (`LAYOUT_UNKNOWN`), because the files would be placed wrongly. A project file that is
   not JSON stops it as before, unless the source has `paths`: then a warning says so and the standard layout
   is used. A snapshot from a database of schema version 3 or older keeps no layout and is analysed in the
   standard one, which is what it was read with unless the project of the folder the command ran in said
   otherwise.
4. **`complete` and `partial` of a snapshot say what was read, and the analysis has a word of its own.** Only
   an issue of the stage `read` with the severity `error` makes a snapshot partial. The status of a snapshot is
   never changed by an analysis: a snapshot does not change once it is stored (record
   [0007](0007-immutable-snapshots.md)). The report of a snapshot has `analysis.complete`, which is false when
   an issue of the stage `analysis` has the severity `error`.
5. **Which issues of the analysis are errors.** Those of choice 19 of record 0041: `FILE_UNREADABLE`,
   `XML_NOT_UTF8`, `XML_MALFORMED`, `XML_UNSUPPORTED`, `METADATA_UNEXPECTED`, `KEY_INVALID`, `KEY_COLLISION`
   and `ANALYSIS_FAILED`. And two that are new with this record, both about files of the snapshot that the
   Salesforce library does not place: `RESOLVE_FAILED`, the code the reading has for the same thing, and
   `FILES_NOT_PLACED` for files that belong to no component. Every file of a snapshot was stored as a file of a
   component. One that belongs to none now lost another file of its component while the source was read, such
   as a class whose `-meta.xml` file went away between the listing and the storing, or is placed differently by
   another version of the library.
6. **A warning does not make an analysis incomplete.** `NAME_NOT_READ`, `PATH_NOT_FOLLOWED`,
   `ELEMENT_NOT_FOUND` and `FORMULA_NOT_READ` say that a reference may be missing or is only `probable`. They
   are counted and shown. A real org has such names in ordinary metadata, and an analysis that is incomplete
   for every org would say nothing.
7. **`snapshot` and `analyse` end with the exit code `5` when the snapshot is partial or its analysis is
   incomplete.** `coverage` ends with `0`, as before. `ok` is `true` in all three.
8. **`ANALYSED` counts, per type, the components the analysis read something of.** A component of a type that
   is not analysed, one whose file could not be read, and an object that is only named are not counted. The
   number can be larger than `RETRIEVED`: the fields and rules inside the file of an object are counted, and
   so is a component that came back although the org had not listed it. A type of which the source lists
   nothing and the analysis finds something gets a line of its own, with a note that says why.
9. **`analyse` refuses a snapshot of an org that has not ended or was given up**, with `SNAPSHOT_NOT_FOUND`
   and the state in `details.status`. No error code is added. A partial snapshot is analysed.
10. **The place of a part stays its place in the file.** It is not counted from the start of the part. In the
    file of an object in the format of the Metadata API, as a repository in that format holds it, a line added
    near the top therefore gives every field and rule below it that has a reference a new version. An org
    snapshot is stored in source format, with a file for each field, and is not affected. The comparison of two snapshots must not take "another
    version" for "changed", as record 0040 says.
11. **What the JSON output gets.** The report of a snapshot gets `analysis`, which is `null` for a snapshot
    without one. Every issue gets `stage` and `component`, the issues of the reading stand first, and `status`
    gets `latestSnapshot.analysis`. The layout of a snapshot is not shown. Fields are added and none is removed, so the version of the envelope stays
    at `1`, though a pre-release makes no promise yet (record [0027](0027-json-envelope-and-exit-codes.md)).
12. **The text output shows the issues of the analysis per code**, with their number and the first of them.
    An org can have hundreds. `--json` has every issue.
13. **`analyse` is a command that writes.** It migrates a database that an older version wrote. A command
    that only reads still refuses such a database, and its hint now names `analyse`.
14. **Analysing again replaces the analysis and nothing else.** The row of the analysis, the coverage per
    origin, the issues of the stage `analysis`, the numbers of `ANALYSED` and the lines of choice 8 are written
    anew. A version of a component that did not change is not stored twice (record 0040).

## Consequences

- A snapshot of the fixture folder and one of the mock org built from it give the same 89 keys and the same 106
  references, compared by the component they start from, their kind, their target, the name as written, their
  origin, confidence and attributes. The resolution is not compared: the org hands out a file for `Account`
  and `User`, which the folder does not hold, so a lookup to one of them is `resolved` in the snapshot of the
  org and `external` in that of the folder. Lines are compared within each snapshot only.
- A snapshot that the engine of Phase 0 stored is analysed by `analyse` to what a new snapshot gives. A test
  does this with a database of schema version 2 into which the snapshot is written with the statements of
  Phase 0. Once, by hand, the last
  commit of Phase 0 took a snapshot of the fixture project and of one public codebase, and `analyse` of this
  work package gave the same rows as a new snapshot for both.
- On one Linux machine, in a process that has loaded its libraries, over five runs: a snapshot of the fixture
  project with its analysis takes 46 to 68 ms, of which the analysis is 20 to 29 ms. For the three public
  codebases the analysis takes 51 to 74 ms (506 files), 174 to 196 ms (1,579 files) and 1.4 to 1.5 seconds
  (12,056 files), and the snapshot with it 0.15 to 0.19, 0.47 to 0.59 and 3.4 to 3.9 seconds. Analysing again
  takes about as long as the first time. Not measured: an org of the size of the performance targets.
- A snapshot of an org that an older version took can be analysed without a login and without reading the org
  again. This is what makes an update of OrgLens cheap for a large org.
- Nothing analyses a snapshot by itself after an update. `status` says by which version the latest snapshot of
  a source was analysed, and does not say that this version would find more.
- `snapshot` can now end with an error although the snapshot is stored. A script that reads only the exit code
  takes that for "no snapshot". The message, the hint and `details.snapshot` say otherwise.
- The first line of the text output says "is complete" for a snapshot whose analysis is incomplete, because
  the line is about what was read. The line about the analysis says that it is incomplete, and the exit code
  is `5`.
- An issue about a file that cannot be read as XML names the file and no component (`component: null`), as
  record 0041 made it: the file is reported once, however many components stand in it.
- The layout is what the project file said when the snapshot was taken. A project file changed later, or a
  newer library that reads the same settings in another way, is not noticed. A setting that a newer library
  stops knowing makes the analysis of such a snapshot fail as a whole, with `LAYOUT_UNKNOWN`.
- An error that makes the analysis fail as a whole is redacted and coded as the API does it for every other
  error: a failure of the file system is `WORKSPACE_IO`, a fault of the engine `INTERNAL`. The log of the
  workspace says `snapshot.not_analysed` for it, with the code and the number of the snapshot.
- Not built: an option that analyses every snapshot of a source or of the workspace, a rule that judges
  completeness over the types of the logic tier, which is work package 9, and any use of the analysis. The
  command that answers an impact question is work package 7.
- Not verified: the command was not run against a real org, and no snapshot of a real org was analysed.
  Part G of the Phase 0 test plan, in which the maintainer runs `orglens snapshot` against an org, had not been
  run when this was built.
