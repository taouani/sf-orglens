# 0039. The engine reads XML with a reader of its own

- Status: Accepted
- Date: 2026-11-15
- Decisions: none (the answer of the maintainer to the eighth question of the Phase 1 plan)

## Context

A reference has a place: a file, a line and a column. For a reference inside a formula that is the place of a
name inside the text of an element, and an org writes a quote in that text as `&apos;` where a repository has
`'`. So the place of the twentieth character of a formula is not the place of the element plus twenty.

The Phase 0 plan named `fast-xml-parser` behind a wrapper of our own, and no XML was read in Phase 0.
`fast-xml-parser` gives values without places. Question Q8 of the [Phase 1 plan](../plans/phase-1.md) put two ways
to the maintainer: a reader of our own, or `fast-xml-parser` with a second search of the text for the places. The
maintainer chose the reader of our own on 15 November 2026. The plan promised a search for a maintained library
that gives the place of every decoded character before the reader was written, and to take it if one exists.

The search was made on the same day. Seven libraries were looked at, in the versions npm had that day. None gives
the place of each decoded character. Two give enough to work it out (`@rgrove/parse-xml`, `@xml-tools/parser`),
and the working out is the part of a reader that decodes references. One of the two repairs a file that is not
well-formed, which OrgLens must not do. [xml-readers.md](../research/phase-1/xml-readers.md) has the list and
what each gives.

## Decision

The engine reads the XML of metadata files with `packages/engine/src/extraction/xml.ts`. It has no dependency.

- **What it gives.** A tree of elements with their attributes, and for an element without child elements its
  text. Every element, attribute and text says where it stands in the file, and a text says it for each of its
  characters. A place is a line, a column and a place in the bytes. Lines and columns start at 1. A column
  counts UTF-16 code units, as a string of JavaScript does.
- **What it reads.** Elements, attributes, text, the five entities of XML, character references, CDATA
  sections, comments and the declaration, in UTF-8, with or without a byte order mark, with LF, CRLF or CR.
  Names are resolved against the namespaces the file declares, so `xsi:nil` is known by its namespace and not by
  its prefix.
- **What it refuses.** A file that is not well-formed, and a file that breaks a rule of Namespaces in XML, such
  as a prefix it does not declare. It gives one issue then, with a code, a sentence and the place where it
  stopped, and no tree. It never repairs and never gives half a file.
- **Six things that well-formed XML can hold are refused as well**: a document type declaration, a processing
  instruction, an encoding other than UTF-8, a version other than 1.0, an element that holds both text and
  elements, and elements nested more than 256 deep. No metadata file of the fixture project or of the public
  codebases holds one. The deepest file of the public codebases is 8 deep.
- **The sentence of an issue** holds names and no other text of the file: the name of an element, an attribute,
  a prefix or an entity, cut after 60 characters. In a file that is not well-formed, a name is what stands where
  a name is expected, which can be a word of a formula after a `<` or an `&`.
- **Two things are not kept**: comments, and the white space between the child elements of an element.
- **`fast-xml-parser` is the second opinion in the tests** and nothing else. It is a development dependency of
  the engine, pinned to the version the Salesforce library brings. The code of the engine does not import it.
- The reader is not part of the public API of the engine.

Five of these are choices of the author and not of the maintainer, who chose that there is a reader of our own:
which six things are refused, the limit of 256, that a comment may hold two hyphens (XML forbids it, and people
write it), that names are resolved against namespaces, and that a column counts code units.

The limit on nesting is there for what comes after the reader. Code that walks a tree by calling itself fails at
a depth of some thousands, and a file of 35 KB can be that deep. With the limit, an analyser may walk a tree in
the simple way. The version is refused because XML 1.1 has other rules for line ends and for characters, and
reading such a file by the rules of 1.0 would be a guess.

## Consequences

- A reference in a formula can carry the place of its name in the file, in a file from a repository and in the
  file an org hands out for the same component.
- A file that is refused gives no component and no reference. From work package 4 on it is an issue of the
  snapshot, which says so. If real orgs hold files with one of the six things, the reader is widened to read
  them. It is never made to guess.
- OrgLens maintains a reader for XML: about 840 lines, of them about 620 of code and types. Question Q8 said
  "about 300 lines", which was too low. A fault in it is a wrong place or a
  wrong value in every analyser that follows. Three kinds of test stand against that: random documents, written
  in many ways, whose values and places the reader must give back; the same documents and every metadata file of
  the public codebases compared with `fast-xml-parser`; and a list of files it must refuse.
- The comparison with `fast-xml-parser` covers values, not places. For places the reader is checked against the
  writer of the random documents, which the author of the reader wrote as well.
- The review of the pull request compared the reader once with a third parser, expat, on about 500,000
  generated documents, of which both read about 150,000. It reported the same names, namespaces, values and
  places of tags for all of them, and four kinds of file that the reader read and expat refused. Those are
  refused now. One of them was a fault that gave a wrong value: an entity named like a built-in property of an
  object of JavaScript, such as `&constructor;`. This comparison is not a test of the repository, because it
  needs Python.
- The time to read a file grows with its length. A test holds that for a file with thousands of prefixes, which
  took minutes before the review.
- `fast-xml-parser` is kept out of the code of the engine by the two tools of the layer rules, and
  `pnpm run check:boundaries` has probes for it.
- A file in another encoding than UTF-8 is not read. Salesforce writes UTF-8.
- Whether a file of a real org is ever refused is not known. The test org's files were not kept, and
  `orglens snapshot` does not read XML yet.
