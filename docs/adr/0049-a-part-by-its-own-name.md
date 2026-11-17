# 0049. A part is asked for by its own name when Salesforce cannot find its parent

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (work package 9 of the Phase 1 plan. It holds a correction made after the second run of the
  test org with the judgement of record 0046, and the choices its author made)

## Context

Run 14 of the workflow "Live org" was the first with the two corrections of record
[0047](0047-what-the-org-says-where-the-library-falls-short.md)
([real-org.md](../research/phase-1/real-org.md#8-the-snapshot-judged-over-the-logic-tier)). Both hold on the
test org: the seven bundles of a package count as retrieved, and the three files in a folder the library does
not know are warnings. The snapshot is still partial, for six components of the logic tier:

- **Two fields and two record types.** The two fields belong to two objects, and the two record types to one
  object. The org lists none of these objects. Their names have no ending of a custom object. Salesforce
  remarked of each of them that it cannot find it. It made two such remarks about an object in all, so the
  object of the record types is one of the two objects of the fields.
- **Two objects.** The org lists them and does not hand them out. Their names have no ending of a custom object.
  Salesforce did not remark that it cannot find them.

A part comes with its parent. So the engine does not name a part in a retrieve. It names the parent, also when
the org does not list the parent, which is the usual case for a field of a standard object. If Salesforce
cannot find that parent, the part was never asked for. The Metadata API takes the name of a part in a retrieve
too: `CustomField` and `RecordType` are types a retrieve can name.

## Decision

When Salesforce remarks about a retrieve that it cannot find a component the retrieve asked for, and the org
does not list that component, the parts of it that the org lists and that did not come back are asked for by
their own names, in one more retrieve.

- **Which components.** The remark has the form `Entity of type '…' named '…' cannot be found`. The component
  is of a type that has parts, as the Salesforce library describes the types. Its parts are the components of
  those types whose name is the name of the component, a dot and a name of their own.
- **Only for a parent the org does not list.** Such a parent was asked for only for the sake of its parts. A
  parent the org lists and Salesforce cannot find is what is missing, and its parts are not asked for alone:
  the file that comes back for a part is the file of the parent with that part in it, and it would count as the
  parent.
- **One more retrieve, at the end of the plan.** It is a chunk like any other: it is in the journal, so a
  snapshot that is interrupted before it continues with it. It is asked once. A part that Salesforce cannot
  find by its own name either stays `NOT_RETRIEVED`, and the remark about it is kept with the others.
- **The parts of one parent stay in one retrieve.** They come back in one file. In two retrieves the file would
  come back twice, each time with other parts, and the snapshot would hold what came last. So a retrieve of
  parts that fails is split between two parents and never inside one. If the parts of a single parent fail
  together, they stay missing and `RETRIEVE_FAILED` names them.
- **The note `PARTS_ASKED_BY_NAME`** says of how many components Salesforce said that it cannot find them, names
  the first, and says how many parts are asked for.
- **What comes back.** The file of the parent, with the parts that were asked for and nothing else. The parent
  then counts among the components that came back and that the org had not listed (`UNLISTED_COMPONENTS`), as
  an object does that comes back whole for the sake of its fields.
- A snapshot without such a remark makes no request more than before. Which types are parts is read from the
  library, not asked of the org.

## What goes further than the plan

These are choices of the author of this record. The maintainer can strike any of them.

1. **A second way to ask for a part.** The plan of the work package says that every component is named and
   that the snapshot is judged over the tier. It does not say what to do when the org lists a part and
   Salesforce cannot find what the part belongs to. The other way leaves such a part missing, and every org
   that has one partial.
2. **Not for a parent the org lists.** A snapshot must not call a component retrieved of which only a part came
   back.
3. **The library says which types are parts, not the org.** A part of a type the library does not know could
   not be read when it came back. And the org does not have to be asked once more, which it could refuse.
4. **A retrieve of the parts of one parent is not tried part by part when it fails.** That would need a way to
   put two files of one parent together, which the engine does not have.
5. **A note of its own**, so that a retrieve the plan did not hold is not silent.
6. **The step that reads the test org says how many of the missing components a remark of another form
   names**, and shows that remark in its everyday words. The two objects have no remark of the known form.

## Not done

- **Not verified on a real org.** Whether Salesforce hands out a part by its own name when it cannot find the
  parent is not known. The next run of the test org from `main` shows it for two fields and two record types.
  It is recorded in the research note and in the plan.
- The two objects that the org lists and does not hand out are not explained. This record does nothing for
  them. Of the nine remarks of run 14, two speak of permissions and two say "Not a … type". Whether they are
  about these objects is not known. The step that reads the test org now counts it.
- The remark is read in one form. A parent Salesforce does not hand out without that remark has its parts left
  missing, as before.
- A part whose name does not begin with the name of its parent and a dot is never asked for this way. A custom
  label is such a part, and its file is one the org lists.
- The file of a parent that came back for its parts is stored and analysed as the file of that parent. Nothing
  in the database says that it holds a part of the component only, beyond the note of the retrieve.
- The first retrieve of the parts is not held below a number of members. If Salesforce fails it, it is split
  between parents like any other retrieve of parts.
- Not tested: a retrieve of parts that Salesforce fails for a reason of its size, and a type other than
  `CustomObject` as the parent. The tests take an object with fields and a validation rule.

## Consequences

- A snapshot of an org that lists a field or a record type of an object Salesforce cannot find can be complete
  where it was partial, if Salesforce hands the part out by its name. If it does not, the snapshot stays
  partial, and the remarks of Salesforce say for each part that it cannot be found.
- Such a snapshot makes one retrieve more, and its count of chunks grows while it runs, as it does when a
  chunk is split.
- A retrieve that fails is no longer cut in the middle in every case: parts of one parent that it names stay
  together. The plan of the engine names a part only in a retrieve of parts, as long as the org and the library
  agree on which types are parts. Where the library calls a type a part that the org describes as a type of its
  own, the components of that type with the same name before a dot stay together too.
- The JSON output changes in one place: the issue code `PARTS_ASKED_BY_NAME` is new, with `details.count`,
  `details.components` and `details.parts`. The JSON Schema does not list the codes, so only `docs/cli.md`
  changes.
- No migration: the retrieve is a row of the table of chunks.
