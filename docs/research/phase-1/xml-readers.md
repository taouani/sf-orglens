# xml-readers: is there a library that gives the place of every character?

Written on 15 November 2026, on the first day of work package 2 of Phase 1. Question Q8 of the
[Phase 1 plan](../../plans/phase-1.md) promised this search: "I know no library that gives the place of each
decoded character. I have not searched for one beyond the ones the Salesforce libraries bring, and will on the
first day of WP2. If one exists and is maintained, I take it and tell you."

Claims are marked `[package]` when they were read in the files of the package as npm hands it out, `[run]` when
something was run, and `[unverified]`.

In short: none of the seven libraries gives the place of each decoded character of a text. The reader of
decision record [0039](../../adr/0039-a-reader-of-our-own-for-xml.md) was written.

## What is needed

An analyser gives every reference a line and a column. For a reference in a formula, that is the place of a name
inside the text of an element such as `<formula>`. A file from a repository has `'Late'` there and the file an
org hands out has `&apos;Late&apos;`. So three things are needed:

1. the place of every element and attribute: line, column and place in the bytes,
2. the decoded text of an element, with references replaced and CDATA taken as it stands,
3. for each character of that decoded text, where it stands in the file.

## The libraries

Found with two web searches and from what the Salesforce libraries bring. Versions and dates are those of the
npm registry on 15 November 2026.

| Library | Version, licence | Last change on npm | What it gives for places | The place of each decoded character |
| --- | --- | --- | --- | --- |
| `fast-xml-parser` | 5.12.1, MIT (5.12.0 is in the tree) | November 2026 | With `captureMetaData`, the index where a tag starts. No line, no end, nothing for text. `[package]` | No |
| `@xmldom/xmldom` | 0.9.12, MIT | August 2026 | A line and a column for each node. `[package]` | No |
| `saxes` | 6.0.0, ISC | May 2022 | The line and column of the parser when an event is given. `[package]` | No |
| `sax` | 1.6.1, BlueOak-1.0.0 (in the tree) | July 2026 | As `saxes`. `[unverified]`: taken from its kind, its files were not read for this. | No |
| `sax-wasm` | 3.3.0, MIT | October 2026 | Line, character and a range of bytes for every tag, attribute and text. It is a WebAssembly file of 56 KB. `[package]` | Not as far as its documentation says. Whether a text with a reference comes in parts with a place each was not tried. `[unverified]` |
| `@rgrove/parse-xml` | 5.2.0, ISC, no dependency | November 2026 | With `includeOffsets`, the place in the bytes where each node starts and ends. No line. `[package]` | No. Text, references and what follows are joined into one text node with one start and one end. `[package]` |
| `@xml-tools/parser` | 1.0.12, Apache-2.0, needs `chevrotain` 7.1.1 | October 2026 | A syntax tree in which every token has a place, a reference among them. `[package]` | It can be worked out from the tokens. The parser repairs a file that is not well-formed and gives a partial tree. `[package]` |

## What follows

- **No library does the third thing.** With `@rgrove/parse-xml` the raw text of a node can be cut out of the
  file by its start and end, and decoded a second time by code of our own that notes the places. That code is the
  part of a reader that knows references, line ends and CDATA. With `@xml-tools/parser` the same is done from
  tokens.
- **Both would be a runtime dependency of the engine**, and `@xml-tools/parser` pins a version of `chevrotain`
  that is six major versions behind the current one, 13.2.0. `[package]`
- **`@xml-tools/parser` is made for editors.** It goes on after an error and gives what it could read. OrgLens
  must refuse such a file and say so.
- The search was two queries and the files of seven packages. A library that neither query found may exist.
  `[unverified]`

## What the reader of our own does on the public codebases

Measured on 15 November 2026 with the reader of this work package, on the three codebases of
`fixtures/corpora.toml` at their pinned commits. `[run]`

| Measurement | Value |
| --- | --- |
| `-meta.xml` files | 11,338, together 10.5 MB. 10,799 of them are in the package folders the manifest names |
| Refused | 0 |
| Files whose names and values differ from what `fast-xml-parser` gives | 0 |
| Elements | 176,828 |
| Texts | 128,949, of them 2,200 that do not stand in the file as they are |
| Files with one of the five entities | 408 |
| Files with a character reference | 1 |
| Files with a comment | 4 |
| Files with a CDATA section, with a byte order mark, with CRLF, without a declaration | 0 each |
| Files with a character of more than one byte | 3,929 |
| Attributes | 13,929: `xmlns` 11,275, `xsi:type` 1,583, `xmlns:xsi` 317, `xmlns:xsd` 303, `xsi:nil` 289, others 162 |
| The largest file | 777 KB |
| Time to read all of them, without reading them from disk | 0.35 seconds |

So the public codebases exercise entities, attributes and characters of more than one byte, and nothing else of
what the reader knows. CDATA, CRLF, a byte order mark and the refusals are covered by the unit tests and by the
random documents only. A real org writes entities where a repository has quotes (Phase 0 note
[real-org.md](../phase-0/real-org.md)). What else an org writes was not looked at, because no file of the test
org is kept.

A synthetic profile, made for this measurement and not kept: 25,000 field permissions in 4.5 MB were read in 0.11
to 0.19 seconds, and 120,000 in 21.8 MB in 0.50 to 0.60 seconds, five runs each. `fast-xml-parser` took 0.37 and
1.13 seconds for the same two texts, one run each. The first place asked for in the larger file took 0.1 seconds
more, which is when the table of lines is made. Memory was not measured. `[run]`
