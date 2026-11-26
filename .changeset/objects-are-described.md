---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

`orglens snapshot` of an org or a sandbox asks the REST API of the org for the description of each object the snapshot
holds a file of, standard objects among them, after the cross-check and also with `--no-cross-check`: one request for
each object, `GET /services/data/v<version>/sobjects/<object>/describe`, four at once. Of each answer it keeps the
fields with their types, the objects a lookup points at, the names of the relationships and the child relationships, and
nothing else, so that a later analysis of Apex can check a name against the org without the org. Nothing reads them yet.
An object the org does not know or does not describe leaves the new warning `DESCRIPTIONS_PARTIAL`, which names them and
neither fails the snapshot nor makes it partial. A refusal that holds for every request, such as a used-up limit of
requests, stops the reading. The progress on the standard error stream says how many objects are asked for and how many
are done. The report of `snapshot`, `analyse` and `coverage` ends with a line about the descriptions and how long they
took, and its JSON output has the new field `descriptions`, `null` for a snapshot of a repository and for one an older
version took. The workspace database moves to schema version 12: `orglens snapshot` or `orglens analyse` migrates it. A
snapshot taken before is not described until a new one is taken. Decision records 0085 and 0086 have the details.
