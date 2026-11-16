# 0041. Components, the model of objects, and the names written in XML

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (the analysis of work package 4 of the Phase 1 plan)

## Context

The workspace database can hold components and references since record
[0040](0040-components-and-references-in-the-database.md), and nothing produced them. Work package 4 of the
[Phase 1 plan](../plans/phase-1.md) asks for the first analysis: a component for everything a source holds, the
attributes and the references of objects, fields and validation rules that are written in XML, and a model of
objects that the formulas of work package 5 are resolved against.

The plan fixes the outline, and the maintainer approved it: which types are analysed, which references are read,
that a custom name that is not found is `unresolved`, that the name of a package that is not in the snapshot is
`external`, that a standard field without a file is `external` and keeps its key, and that two names that fold to
one key are reported and not merged. It leaves open how each of these is decided in a given case. What follows
under "Decision" fills that in, and the points marked as choices of the author are the maintainer's to strike.

## Decision

`analyseSource` in `extraction/analyse.ts` takes the files of a source and the list of components that
`sources/resolve.ts` makes of them. It gives the components sorted by key, the work of the origin `parser:xml`,
and the issues. It does not know whether the files come from an org or from a repository.

It works in two passes. The first reads every file once and keeps the names with their places, and nothing else
of the file. The second builds the model of objects from what all files said and resolves the names against it.
A lookup can therefore name an object whose file comes later in the list, and the result does not depend on the
order of the list.

- **Components.** Every listed component gets a row, whatever its type. Only a `CustomObject`, a `CustomField`
  and a `ValidationRule` are read. A component of another type has no attributes and no references, which the
  database shows as not analysed.
- **The model** (`extraction/model.ts`) answers four questions: what an object name stands for, what a field
  name of an object stands for, what the name of a component without a parent stands for, and which field is
  behind a relationship and where it leads. `walkPath` walks a path of names with it, one target per name.
- **Names in XML** (`extraction/objects.ts`): the target of a lookup, the fields of a lookup filter, the three
  fields of a roll-up summary and those of its filter, the controlling field and the global value set of a
  picklist, and the field a validation rule shows its message at. Each reference has the line and the column of
  the name itself, the origin `parser:xml` and the tier `confirmed`.

These are choices of the author, eighteen in number.

What a component is:

1. **The file a component is defined in is its `-meta.xml` file**, or its first file if it has none. The hash of
   its content is that of the one file. For a component of several files it is taken over a line per file, the
   hash of the file and its path.
2. **A component that is an element of a larger file is defined by the text of that element.** A custom label is
   one, and so is a workflow rule. `sources/resolve.ts` now says for such a component which file, which element
   and which element holds the name. If the element is not found, the component is defined by the whole file,
   and a warning says so.
3. **The fields and the validation rules inside the file of an object become components.** An org hands out an
   object that way, and so does a repository in the metadata format. The source library does not list them, so
   the analysis counts more components than the list it was given. A part without a name is an error.
4. **An object of which the source holds only parts gets a row that is not defined**, standard or custom. The
   plan asks for this for standard objects. A project that adds fields to the object of a package is the other
   case.
5. **Two components with one key: the first is kept, the second gets no row**, and an error names both.

What is kept of a component:

6. **The attributes are few**: of a field its type, the objects it points at, the name of its relationship and
   whether it has a formula. Of a rule whether it is active. Of an object its kind of custom setting. Nothing
   else of a file is kept, and a later analyser that needs more adds it.
7. **A reference says how the source names its target**, in its attribute `via`: `lookup`, `filter`, `summary`,
   `controlling-field`, `value-set` or `display-field`. An answer can then say why one component refers to
   another without reading the file again.
8. **In a path, every relationship is a read of the field behind it.** `Account__r.Owner.Email` in a filter
   reads the lookup field, the owner field of the account and the email field of the user. The first name of a
   path in XML, an object or `$Source` or `$User`, is no reference. The field that ties the child of a roll-up
   summary to its parent is a `references`, the others are `reads`.

What becomes of a name:

9. **An object is `resolved` when a file of the snapshot defines it.** It is `external`, with its key, when the
   snapshot holds only parts of it, when its name is a standard one, or when its name has the prefix of a
   package. Otherwise it is `unresolved`.
10. **A field is `resolved` when a file defines it**, and a part of a geolocation field resolves to that field.
    On a custom object that the snapshot does not know, it is `external` if the object has the prefix of a
    package and `unresolved` if not. A custom field name without a prefix that no file defines is `unresolved`.
    Everything else is `external` with its key: a standard field, and the field of a package.
11. **An unresolved name has no key.** The reference keeps the type and the name as written. So "what refers to
    a field that does not exist" cannot be asked by key. A name that cannot be a key at all, such as one with a
    control character, is unresolved too.
12. **A prefix is read from the form of the name**: three parts for the name of an object or a field, two for a
    name without a suffix. The namespace of the project itself is not known to the analysis. In a package
    project, a name with the project's own prefix that no file defines is called `external`, where `unresolved`
    would be right.
13. **Where a relationship leads is taken from the file of its field first**: the one object the field points
    at, or the object itself for a hierarchy field. A custom relationship whose field has no file leads nowhere.
    A standard relationship without a file leads to the object of its name if the snapshot has one or a lookup
    names one, and otherwise to what a table of 24 relationships says. A field that points at several objects
    leads nowhere, unless its relationship is a standard one of that table.
14. **The table takes `Owner` as a user and `Parent` as the object itself.** The owner of a record of some
    objects can be a queue. The parent of an attachment, a note or a share is of another kind. Both are wrong
    for those objects, and the reference then names a field of the wrong object as `external`.

What is reported:

15. **A value that is no name is not guessed at.** A warning `NAME_NOT_READ` gives its place and its first 60
    characters, and no reference is made.
16. **A path that cannot be walked to its end keeps what it reached.** A warning `PATH_NOT_FOLLOWED` names the
    relationship and what stands after it. The plan says that coverage counts these. The count is the number of
    issues with that code: the coverage table of record 0040 has no column for it.
17. **The codes and their severities.** Errors: `FILE_UNREADABLE`, the three codes of the reader
    (`XML_NOT_UTF8`, `XML_MALFORMED`, `XML_UNSUPPORTED`), `METADATA_UNEXPECTED` for a file whose root element is
    of another type and for a part without a name, `KEY_INVALID`, `KEY_COLLISION`, and `ANALYSIS_FAILED` for a
    fault of the analyser itself, which costs one component its analysis and leaves it its row. Warnings:
    `NAME_NOT_READ`, `PATH_NOT_FOLLOWED`, `ELEMENT_NOT_FOUND`. A file is reported once, however many components
    stand in it.
18. **The sentence of the reader about a malformed file is part of the issue.** Record
    [0039](0039-a-reader-of-our-own-for-xml.md) left open where it is shown, because it can hold up to 60
    characters of the file. It is stored in the workspace database, which is on the machine of the user and
    holds the file itself. The public log of the live-org workflow applies its own rule to every message
    (record [0033](0033-the-test-org.md)).

Two changes outside the layer come with this:

- `core/references.ts` says what a place is: a line ends with LF, CRLF or a lone CR, and a column counts UTF-16
  code units, with a byte order mark counting as none. `validateReference` now refuses a line or a column that
  is no safe integer, and a file path or a name as written that is not well-formed Unicode. The database could
  hold neither as it was given.
- The types of what an analysis hands on (`AnalysedComponent`, `OriginWork`) moved from the store to
  `extraction/analysed.ts`, because the layer that produces them comes before the store. The store exports them
  as before.

## Consequences

- On the fixture project the analysis gives the 87 components of the answer key and two more, the standard
  objects `Account` and `User`, of which the project holds fields. It finds the 26 references of the key that
  are written in XML, each at the line and column the key says, and no other. A snapshot of the mock org built
  from the project gives the same 89 keys and the same 26 references. One thing differs and should: the org
  hands out the file of `Account`, so the lookup to it is `resolved` there and `external` in the folder.
- The three public codebases are analysed without an exception and without an issue: 255, 894 and 11,722
  components, of which 44, 622 and 819 were read, with 8, 46 and 92 references. No path in them could not be
  followed. A text search for the same elements gives the same counts. The largest takes 0.3 to 0.9 seconds on
  one Linux machine.
- None of them writes a path that goes through a standard relationship in XML, so the table of choice 13 and
  the name rule were exercised by tests only. Formulas, which use such paths far more, come with work package
  5 and will show how often a path stops.
- "What refers to `Account.Name`" has an answer in a repository without a file for the object: the field is
  `external` and has its key.
- A typing error in the name of a standard field is not found: `Account.Nmae` is `external` like any standard
  field without a file. Only an org snapshot, which holds the file of the object, could tell, and the analysis
  does not use that yet.
- A component that is a part of a file gets a new version only when its own part changes, not when another
  label of the same file does.
- The analysis counts more components than the source library lists, by the parts of choice 3 and the objects of
  choice 4. The coverage per type of work package 6 has to count them.
- Not read: formulas, which are work package 5. The name field of an object, its compact layouts, search
  layouts and record types. The field an indirect lookup matches on (`referenceTargetField`). Fields of person
  accounts: `Level__pc` of the account is the field `Level__c` of the contact, and the analysis calls such a
  name `unresolved`.
- Not verified: whether the files an org hands out for standard fields name the object a lookup points at. If
  they do not, a standard relationship of an org snapshot is resolved by its name and the table, as in a
  repository. Nothing was run against a real org.
- No command runs the analysis yet. Work package 6 writes it into a snapshot, adds the codes of choice 17 to
  `docs/cli.md`, and decides which of them make a snapshot incomplete.
