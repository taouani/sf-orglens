# 0080. A snapshot of an org holds the descriptions of its objects, and a repository checks names against its files

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (an answer of the maintainer to the Phase 3 plan)

## Context

The Apex trial of Phase 0 (record [0018](0018-apex-analysis-foundation.md)) knows the standard objects, their fields
and their relationships by rule, and checks no name against them. On NPSP it reports 7,249 references at
`confirmed` to fields that no file of the repository defines, nearly all with the prefix of a package the repository
does not hold. It takes at least 49 child relationships of a standard object for a field (`acc.Contacts`), and of
370 references that rest on a name it guesses as a lookup (`__r`), at least 86 rest on a child relationship. Record
0018 asks that the tier of a name the resolver cannot check be lowered.

The formulas of Phase 1 take the name of a standard field as written, as `external`. That stays right for a
formula, which Salesforce checks when it saves it. In Apex a name can also be a child relationship, and the type of
an expression depends on what the name is. The engine holds a short list by hand of what every org has, 24
relationships and 15 child relationships of standard objects (`extraction/model.ts`), which formulas and flows use.

An org knows its own objects, with those of its packages, and can describe each: its fields, their types, the
objects a lookup points at and the child relationships. The engine asks an org today for its metadata through the
Metadata API, and through the Tooling API for the rows of the Dependency API and the versions of its flows (records
[0009](0009-one-ingestion-path.md), [0067](0067-a-row-from-a-flow-is-compared-by-its-version.md) and
[0078](0078-the-ids-of-every-version-of-a-flow-are-read.md)). It does not ask for the description of an object.

The question was put to the maintainer as Q2 of the [Phase 3 plan](../plans/phase-3.md), with three options: (a)
`snapshot` asks the org to describe every object of which the snapshot holds a file and keeps the descriptions with
the snapshot, (b) a description of the standard objects ships with OrgLens, written by the project from the
documentation of Salesforce, (c) no description, and the two kinds of names known to go wrong are `probable` with a
warning. The plan recommended (a), and for a repository the two kinds of (c). The maintainer chose that on 26
November 2026, with the recommended answers to the other five questions of the plan.

## Decision

1. **A snapshot of an org asks the org to describe every object of which it holds a file**, after the last chunk
   and before the analysis, as it asks the Dependency API.
2. **The descriptions are kept with the snapshot**, so that `analyse` needs no org.
3. **The files come first, and a description adds to them.** A description follows the permissions of the user who
   logs in, and a field that user cannot see is left out of it.
4. **A repository has no description.** There a name is checked against the files. A name of Salesforce or of a
   package that no file defines is `external` at `probable`. A child relationship taken for a field and a `__r`
   name guessed as a lookup are `probable`, with a warning.
5. **No description of Salesforce is written by hand** beyond the short list there is. For a snapshot of an org the
   descriptions take its place. For a repository it stays.
6. **The request comes with what every new request about metadata comes with**: this record, a test that holds it,
   a line in the data rules, an answer of the mock org, a run of "Live org", and a store migration with a record of
   its own, since it changes the storage format.

That is all the maintainer decided. Point 1 changes record 0009 in one point: the engine asks an org for one more
kind of metadata, the description of an object, which it does not ask for today. Which API serves it is chosen in
work package 4.

## What goes further than the answer of the maintainer

Seven statements below are conclusions of the author of this record. The maintainer can strike any of them.

- **A description is metadata and no record.** It says what an object holds, and no value of a record. The data
  rule that OrgLens reads metadata only stands, and its line in `CLAUDE.md` that names the requests to an org gets
  this one in the pull request that builds it.
- **Which calls of the API of Salesforce are used is a choice of work package 4.** The record written with it names
  every request, as for the queries of the Tooling API. The run of "Live org", which the maintainer starts, shows
  whether the descriptions of the test org hold every field of the fixture.
- **Only what the resolver reads is kept** of a description: the names of the fields and their types, the objects a
  lookup points at, the names of relationships, and the child relationships with their objects and fields. Labels,
  help texts and the values of picklists are not kept. Work package 4 lists the parts.
- **An object that Apex names and of which the snapshot holds no file is not described.** A name that neither a
  file nor a description defines is `unresolved` in a snapshot of an org, with a warning, as the plan says.
- **An org that does not answer leaves a warning and never fails a snapshot**, as for the Dependency API (record
  [0045](0045-the-cross-check-of-a-snapshot.md)). The analysis of such a snapshot, and of a snapshot that an older
  version took, checks names as for a repository, and says so.
- **The readers of Phases 1 and 2 keep their answers.** Where they use the short list for a snapshot of an org, the
  descriptions take its place. Their entries in the key must not move. Where one would, the record of work package
  4 says which and why.
- **The time of the requests is counted in the summary of a snapshot.** On a large org it is not known. The snapshot
  asks only for the objects of which it holds a file.

## Consequences

- In a snapshot of an org, a name of a field is checked against the org, those of its packages included, and a
  child relationship is told from a field. The wrong references of the trial at `confirmed` should not come back
  there.
- In a repository more names stay unchecked. The coverage counts them per snapshot, and an answer from a repository
  says that names of Salesforce were not checked.
- A snapshot of an org takes longer by the time of the descriptions. Whether that matters for the target of 60
  minutes for a first snapshot (record [0037](0037-performance-targets.md)) is not measured.
- How far the permissions of the user who logs in make a description lack fields on a real org is not verified.
  The test org shows it for the fixture only.
- About 4 days of work package 4. Option (b) would have cost about 6 days and a day or so at each release of
  Salesforce.
