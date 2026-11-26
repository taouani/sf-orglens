# 0086. The descriptions of the objects of a snapshot are kept in two tables of the store

- Status: Accepted
- Date: 2026-11-26
- Decisions: none (the store migration that record 0080 asks for, with the choices the author made in it)

## Context

Record [0080](0080-an-org-describes-its-objects-to-a-snapshot.md) asks that the descriptions of the objects of an
org be kept with the snapshot, so that every analysis of the snapshot checks names against the org without the org,
and that the store migration that keeps them have a record of its own, since it changes the storage format. Record
[0085](0085-an-org-describes-its-objects-through-the-rest-api.md) says how they are read and what is kept of each.

The rows of the Dependency API are kept in the same way since record
[0045](0045-the-cross-check-of-a-snapshot.md): a row for how they were read, and the rows themselves beside the
snapshot, with no reference and no component made of them.

## Decision

The statements below are choices of the author of this record. The maintainer can strike any of them.

1. **Migration 12 adds two tables** (`store/migrations/0012-object-descriptions.ts`). `snapshot_description_reading`
   holds one row for a snapshot whose org was asked: the state of the reading, when it started and when it ended, the
   requests, the objects that were asked for, those the org does not know and those of which no description came, and
   the code of the first failure. `snapshot_object_description` holds one row for each object described: the name of the
   object as the org writes it, and the description as a JSON object. Two names that were asked for and that the org
   describes as one object, such as a name in other capitals, keep the first description, and both count as described.
2. **A description is one JSON object, read whole** (`store/descriptions.ts`). The resolver reads every description
   of a snapshot once, and no query of the store looks into one, so its fields and child relationships get no tables
   of their own. The table refuses a text that is not a JSON object.
3. **A reading replaces the one before it** for the same snapshot, inside the write of its caller, as the rows of
   the Dependency API do. A description belongs to its reading, and both go with their snapshot.
4. **A snapshot without a row was not described**: a snapshot of a repository, and one that a version before this
   record took. Nothing is filled in for an older snapshot. It is described when it is taken again.

## Consequences

- The workspace database moves to schema version 12. `orglens analyse` or `orglens snapshot` migrates a database of
  an older version, which `impact` refuses until then, as it does for every migration.
- A description of a large standard object holds hundreds of fields. What a snapshot of a large org adds to the size
  of the database was not measured.
- The schema of the store is held by its golden file (`test/golden/schema.sql`), and both drivers run the tests of
  the tables, of a reading that replaces another and of a snapshot that is removed.
