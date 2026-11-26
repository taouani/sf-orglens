# 0085. A snapshot of an org asks the REST API for the description of each object it holds a file of

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (builds record 0080 in work package 4 of the Phase 3 plan, with the choices the author made in it)

## Context

Record [0080](0080-an-org-describes-its-objects-to-a-snapshot.md) holds the answer of the maintainer to Q2 of the
[Phase 3 plan](../plans/phase-3.md): a snapshot of an org asks the org to describe every object of which it holds a
file, after the last chunk and before the analysis, and keeps the descriptions, so that `analyse` needs no org. It
left to work package 4 which API serves the request and which parts of a description are kept, and asked for a
record that names every request, as records [0067](0067-a-row-from-a-flow-is-compared-by-its-version.md) and
[0078](0078-the-ids-of-every-version-of-a-flow-are-read.md) do for the queries of the Tooling API. The storage of
the descriptions has a record of its own, [0086](0086-the-descriptions-of-objects-in-the-store.md).

An org lists its standard objects among the components of the type `CustomObject`, beside its custom objects, and
hands out a file of each: the test org listed 398 of them in Phase 1, nearly all of them standard objects (section 5
of the [research note of Phase 1](../research/phase-1/real-org.md)). So a snapshot of a real org holds a file of
every object a user can add a field to.

## Decision

The statements below are choices of the author of this record. The maintainer can strike any of them.

1. **One request of the REST API for each object**: `GET /services/data/v<version>/sobjects/<object>/describe`, with
   the version of the API the snapshot reads the Metadata API with (`describeObjects` in `sources/describe.ts`). It
   is the call Salesforce documents for the description of one object, and its answer holds in one place every part
   the resolver reads. A test holds every address the engine asks for (`org-descriptions.test.ts`): the Metadata API,
   the one address of the Tooling API, and the description of each object the snapshot holds a file of, and nothing
   else besides the check of the login of record [0031](0031-logins-and-the-home-folder.md). Two ways that ask for
   several objects at once were not tried: the call `describeSObjects` of the SOAP API, which takes up to 100 objects
   `[unverified]`, and the objects `EntityDefinition` and `FieldDefinition` of the Tooling API.
2. **The objects are those of which the snapshot holds a file**: every component of the type `CustomObject` of its
   inventory that came back, by the name the org listed it with, sorted, and one that came back although the org did
   not list it by the name it came back with. An object of a package that came back without its prefix is asked for
   with it, as the org knows it (record
   [0076](0076-a-component-is-of-a-package-where-the-org-lists-it-as-one.md)). An object that Apex names and of which
   the snapshot holds no file, such as `Organization` or `RecordType`, is not asked for, as record 0080 says. A name
   that cannot be one of an object (letters, digits and underscores, starting with a letter) is not sent.
3. **Four requests are under way at once**, each with 60 seconds to answer, and a request that got no answer is sent
   twice more, after one and after two seconds, as the requests of the Metadata API are (`DescribeLimits`). Its
   requests are not counted against the limit of 2,000 of the Dependency API.
4. **Of an answer only what the resolver reads is kept**: the name of the object; of each field its name, its type in
   the REST API (`reference`, `string`, `picklist` and so on), the objects a lookup points at, sorted, and the name of
   its relationship; of each child relationship with a name, its name, the object of its records and the lookup field
   that points back. The fields are sorted by name and the child relationships by theirs. A child relationship without
   a name cannot be written in Apex and is dropped. Labels, help texts, the values of picklists and everything else of
   the answer are dropped where it is read. An answer that is no description, such as a field without a name, or that
   describes an object of another name than the one asked for, in other than its capitals, is a failure of its object
   (`NOT_A_DESCRIPTION`).
5. **A failure of the org never fails the snapshot.** An object the org answers with `NOT_FOUND` is one it does not
   know. A request it refuses for another reason, or an answer that is no description, is a failure of that object,
   and the next object is asked for. A request that got no answer after the repetitions, a session the org does not
   accept, and a refusal for a reason that holds for the whole org, the same as for the Metadata API (such as
   `REQUEST_LIMIT_EXCEEDED` or `REDIRECT`, `isAboutTheOrg` in `sources/metadata-api.ts`), would hold for every request:
   no further request is made, not even the repetition of a request that was under way, and every object that is left
   counts as failed. A fault of this machine or of the code is thrown, as for the Metadata API.
6. **The reading is `whole`, `partial` or `none`**, as that of the Dependency API: every object described, some, or none
   of those asked for. Where it is not whole, the snapshot has the warning `DESCRIPTIONS_PARTIAL` of the reading, which
   says how many objects the org does not know and how many it gave no description of, with the code of the first
   failure, and names the first 50 of each in its details. It makes the snapshot neither partial nor its analysis
   incomplete. What an analysis does with a name that a missing description would have checked is for the resolver of
   work package 4.
7. **The org is asked after the cross-check and before the snapshot ends**, always: `--no-cross-check` leaves the
   Dependency API out, and not the descriptions. A snapshot that is interrupted before it ends asks again when it is
   continued, and the new reading replaces the one it held, with its warning. The progress has a step of its own,
   `describing`, told once before the first request and after every object. `orglens snapshot` says on the standard
   error stream how many objects it asks for, and then at most once in five seconds how many are done.
8. **The report of a snapshot says how the objects were described** (`descriptions` of the JSON output of `snapshot`
   and `coverage`, and a line of text after the cross-check). It says when the first request was sent and when the
   reading ended, and the line says how long it took, as record 0080 asks of the summary of a snapshot. It is `null`
   for a snapshot of a repository and for one that an earlier version took.

This changes record [0009](0009-one-ingestion-path.md) in the point record 0080 names, and the data rules of
`CLAUDE.md`, which name every request the engine makes to an org: the engine asks the REST API of the org for the
description of each object the snapshot holds a file of. A description says what an object holds and no value of a
record.

## Consequences

- A snapshot of an org costs one request for each object it holds a file of. The test org lists about 400 objects. A
  large org lists more: how many, and how long they take with four at once, was not measured. Each request counts
  against the requests a day the org allows, as every request of the API does.
- The mock org of the tests describes the objects of the fixture project from their files, with the fields Salesforce
  gives every object of a kind and a short list of standard fields of `Account` and `User`, written for the purpose
  (`test/helpers/mock-descriptions.ts`). The step of "Live org" that reads the test org holds the descriptions of the
  test org against it: whether every field of the fixture project is in them, and where a type, the object of a
  lookup, the name of a relationship or a child relationship differs. A name only the org has is counted and not
  printed.
- The JSON output gains `descriptions`. `docs/cli.md`, the schema of the output and a changeset say so.

What was not measured, and what this record therefore does not know:

- Whether the test org answers the request as it is written here, and whether its descriptions hold every field of
  the fixture project. A run of "Live org" with this version shows it.
- How far the permissions of the user who logs in leave fields out of a description on a real org (record 0080).
- Whether a standard object that an org lists and does not describe exists. The reading counts it as one the org does
  not know.
- Whether the org describes an object of a managed package by the name with the prefix, as the mock org does.
