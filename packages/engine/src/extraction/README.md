# `extraction` layer

Turning retrieved metadata into components and references: parsers for objects, fields, formulas, validation rules, Flows and Apex.

May import from: `core`, `sources`.

| File     | What it holds                                                                                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xml.ts` | The reader for the XML of metadata files. It gives a tree in which every element, attribute and text says where it stands in the file, and a text says it for each of its characters. It refuses what it does not know with an issue and never repairs a file. Decision record 0039 has what it reads and what it refuses. |

The order of the layers is `core`, `sources`, `extraction`, `store`, `engines`, `api`. A layer may import from
layers earlier in that list and never from later ones, nor from the engine entry point `src/index.ts`. The rule is
enforced by an ESLint rule and by dependency-cruiser, and `pnpm run check:boundaries` proves that both work. See
`CLAUDE.md` at the repository root.
