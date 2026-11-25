# 0041. Components, the model of objects, and the names written in XML

- Status: Accepted
- Date: 2026-11-16
- Decisions: none (the analysis of work package 4 of the Phase 1 plan)
- Changed by: [0065](0065-record-types-field-sets-and-records-of-custom-metadata.md), in one point: of the ten kinds of parts of an object, record types and field sets are read as well
- Changed by: [0070](0070-an-object-refers-to-what-overrides-its-actions.md), in one point: an object refers to the page or component that each override of one of its actions names
- Changed by: [0075](0075-two-more-objects-show-the-fields-of-a-person-account.md), in one point: a name that ends in `__pc` is read the same on the objects `PersonAccount` and `BusinessAccount`, and where the snapshot defines no such field of the contact and defines the field as the object shows it, the name is that field

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

It works in two passes. The first puts the list into a fixed order, reads the files of objects, fields and
validation rules, and keeps of each the attributes and the names with their places. The second builds the model
of objects from what all files said and resolves the names against it. A lookup can therefore name an object
whose file comes later, and the same components give the same analysis however they are listed.

- **Components.** Every listed component gets a row, whatever its type. Only a `CustomObject`, a `CustomField`
  and a `ValidationRule` are read. A component of another type has no attributes and no references, which the
  database shows as not analysed.
- **The model** (`extraction/model.ts`) answers four questions: what an object name stands for, what a field
  name of an object stands for, what the name of a component without a parent stands for, and which field is
  behind a relationship and where it leads. `walkPath` walks a path of names with it, one target per name.
- **Names in XML** (`extraction/objects.ts`): the target of a lookup, the fields of a lookup filter, the three
  fields of a roll-up summary and those of its filter, the controlling field and the global value set of a
  picklist, the controlling field of a relationship to a field definition, and the field a validation rule
  shows its message at. Each reference has the line and the column of the name itself, the origin `parser:xml`
  and the tier `confirmed`.

These are choices of the author, twenty-one in number.

What a component is:

1. **The file a component is defined in is its first `-meta.xml` file**, or its first file if it has none. The
   hash of its content is that of the one file. For a component of several files it is taken over a line per
   file, the hash of the file and its path. A file that cannot be read stands in that line without a hash.
2. **A component that is an element of a larger file is defined by the text of that element.** A custom label is
   one, and so is a workflow rule. `sources/resolve.ts` now says for such a component which file, which element
   and which element holds the name. If the element is not found, the component is defined by the whole file,
   and a warning says so.
3. **The parts inside the file of an object become components**, of the ten kinds a project in the source
   format has a folder for: fields, validation rules, record types, list views, field sets, compact layouts,
   web links, business processes, sharing reasons and indexes. An org hands out an object as one file, and so
   does a repository in the metadata format, and the source library does not list what is in it. So the same
   object gives the same components in both forms, and the analysis counts more components than the list it
   was given. Of the ten kinds, only fields and rules are read. A part without a name is an error. A test holds
   the ten against the list of the Salesforce library.
4. **An object of which the source holds only parts gets a row that is not defined**, standard or custom. The
   plan asks for this for standard objects. A project that adds fields to the object of a package is the other
   case. `core/keys.ts` knew five kinds of parts whose parent is the object. It now knows the ten.
5. **Two components with one key: one is kept, the other gets no row**, and an error names both. The one kept
   is the first in the order of type, name and file, by code units, so it does not depend on the list.
6. **An object that lies in two package folders can have a file of its own in each. Both are read.** Its
   attributes are those of both, and where the two differ the first file says. Whether the two contradict each
   other is not reported.

What is kept of a component:

7. **The attributes are few**: of a field its type, the objects it points at, the name of its relationship and
   whether it has a formula. Of a rule whether it is active. Of an object its kind of custom setting. Nothing
   else of a file is kept, and a later analyser that needs more adds it.
8. **A reference says how the source names its target**, in its attribute `via`: `lookup`, `filter`, `summary`,
   `controlling-field`, `value-set` or `display-field`. An answer can then say why one component refers to
   another without reading the file again.
9. **In a path, every relationship is a read of the field behind it.** `Account__r.Owner.Email` in a filter
   reads the lookup field, the owner field of the account and the email field of the user. The first name of a
   path in XML, an object or `$Source` or `$User`, is no reference. The field that ties the child of a roll-up
   summary to its parent is a `references`, and so is a controlling field. The others are `reads`.

What becomes of a name:

10. **An object is `resolved` when a file of the snapshot defines it.** It is `external`, with its key, when the
    snapshot holds only parts of it, when its name is a standard one, or when its name has the prefix of a
    package. Otherwise it is `unresolved`.
11. **A field is `resolved` when a file defines it**, and a part of a geolocation field resolves to that field.
    On a custom object that the snapshot does not know, it is `external` if the object has the prefix of a
    package and `unresolved` if not. A custom field name without a prefix that no file defines is `unresolved`.
    Everything else is `external` with its key: a standard field, and the field of a package.
12. **Two objects show custom fields that belong to another, and the model looks there.** A custom field named
    on a task or an event is a field of `Activity`. A name that ends in `__pc` on an account is the custom field
    of the contact of a person account: `Level__pc` is `Contact.Level__c`. The reference keeps the name as
    written. The relationship of such a field, `Level__pr`, is not handled.
13. **An unresolved name has no key.** The reference keeps the type and the name as written, and for a field
    the object it was looked for on, in its attribute `object`. So "what refers to a field that does not exist"
    cannot be asked by key. A name that cannot be a key at all, such as one with a control character, is
    unresolved too.
14. **A prefix is read from the form of the name**: three parts for the name of an object or a field, two for a
    name without a suffix. The namespace of the project itself is not known to the analysis. In a package
    project, a name with the project's own prefix that no file defines is called `external`, where `unresolved`
    would be right.
15. **Where a relationship leads is taken from the file of its field first**: the one object the field points
    at, or the object itself for a hierarchy field. A custom relationship whose field says neither leads
    nowhere. A standard relationship whose field has no file, or names several objects or none, leads to the
    object of its name if the snapshot has one or a lookup names one, and otherwise to what a table of 24
    relationships says. If none of these knows it, it leads nowhere.
16. **The table takes `Owner` as a user and `Parent` as the object itself.** The owner of a record of some
    objects can be a queue. The parent of an attachment, a note or a share is of another kind. Both are wrong
    for those objects, and the reference then names a field of the wrong object as `external`.

What is reported:

17. **A value that is no name is not guessed at.** A warning `NAME_NOT_READ` gives its place and its first 60
    characters, and no reference is made. The rest of the component is read.
18. **A path that cannot be walked to its end keeps what it reached.** A warning `PATH_NOT_FOLLOWED` names the
    relationship and what stands after it. The plan says that coverage counts these. The count is the number of
    issues with that code: the coverage table of record 0040 has no column for it.
19. **The codes and their severities.** Errors: `FILE_UNREADABLE`, the three codes of the reader
    (`XML_NOT_UTF8`, `XML_MALFORMED`, `XML_UNSUPPORTED`), `METADATA_UNEXPECTED` for a file whose root element is
    of another type and for a part without a name, `KEY_INVALID`, `KEY_COLLISION`, and `ANALYSIS_FAILED`.
    Warnings: `NAME_NOT_READ`, `PATH_NOT_FOLLOWED`, `ELEMENT_NOT_FOUND`. A file is reported once, however many
    components stand in it. `ANALYSIS_FAILED` is a fault of the analyser itself, or a place that a reference
    cannot hold, such as a file whose name has a backslash. It costs one component its analysis. The component
    keeps its row and what defines it, and has no attributes and no references.
20. **The files that failed** are those the analysis tried to read and could not: files that could not be
    opened, and files the reader refused. A file of a type that is not analysed is among them if the analysis
    opened it, which it does for the hash of every file and for the parts of a file such as that of the labels.
    A malformed file of a flow is not among them, because nothing reads it yet.
21. **The sentence of the reader about a malformed file is part of the issue.** Record
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
  hands out the file of `Account`, so the lookup to it is `resolved` there and `external` in the folder. The
  fixture project has no record type, list view or other part of the kinds that are not read. That those give
  the same components in both forms is held by a test on a written object, not by the fixture.
- The three public codebases are analysed without an exception and without an issue: 255, 894 and 11,722
  components, of which 44, 622 and 819 were read, with 9, 49 and 97 references. No path in them could not be
  followed. A search of the files for the elements that are read gives the same counts. The largest takes 0.3
  to 0.9 seconds on one Linux machine.
- None of them writes a path that goes through a standard relationship in XML, so the table of choice 15 and
  the name rule were exercised by tests only. Formulas, which use such paths far more, come with work package
  5 and will show how often a path stops.
- "What refers to `Account.Name`" has an answer in a repository without a file for the object: the field is
  `external` and has its key.
- A typing error in the name of a standard field is not found: `Account.Nmae` is `external` like any standard
  field without a file. The same holds on a custom object that the snapshot defines: `$Source.Account.Name` on
  an invoice without such a relationship gives `Invoice__c.AccountId` and `Account.Name`, both `external` and
  `confirmed`. A custom object has a small known set of standard fields, and an org snapshot holds the file of
  a standard object. The analysis uses neither yet.
- The hash of a component that is a part of a file changes only when its own part changes. Its version in the
  database can change all the same: the place of a reference is part of a version (choice 3 of record 0040),
  and a line added above a part moves the places in it. In the file of an object as an org hands it out,
  every field and rule with a reference below an edit gets a new version. The comparison engine cannot take
  "another version" for "changed", as record 0040 says, and work package 6 decides whether the places of a
  part are counted from the start of the part.
- The analysis counts more components than the source library lists, by the parts of choice 3 and the objects of
  choice 4. The coverage per type of work package 6 has to count them.
- The documents of files that several components stand in are held until the analysis ends, and the file of the
  labels is read a second time for its hash as a whole. Memory on a large org was not measured.
- Names that are written in XML and not read: the name field of an object, its search layouts, and what a
  record type, a list view, a field set, a compact layout, a web link, an index and an action override name
  (fields, picklist values, pages, components). The field an indirect lookup matches on
  (`referenceTargetField`). Formulas are work package 5.
- Not verified: whether the files an org hands out for standard fields name the object a lookup points at. If
  they do not, a standard relationship of an org snapshot is resolved by its name and the table, as in a
  repository. Nothing was run against a real org.
- One guard has no test: if the analysis of a component fails after its row was made, no second row is made.
  No source reaches that place today.
- No command runs the analysis yet. Work package 6 writes it into a snapshot, adds the codes of choice 19 to
  `docs/cli.md`, and decides which of them make a snapshot incomplete.
