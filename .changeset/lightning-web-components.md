---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads Lightning web components: what their JavaScript imports and what their templates hold. An import of
an Apex method calls it, an import of an object, a field, also across relationships, a label, a custom permission and
another component of the project refers to it, a tag `<c-name>` refers to the component, and the literal object and
fields that base components name in their attributes are `probable` references. They have two new origins,
`parser:javascript` and `parser:markup`, with a row each in the table of origins of `orglens snapshot`, `analyse` and
`coverage` and in `--json`, and a module or a tag of a form that is not known is the warning `NAME_NOT_READ`. A file
that a reader cannot read to its end is the new warning `FILE_NOT_READ`. Answers find these components by their
references, and still name `LightningComponentBundle` among the types they do not cover. The workspace database moves
to schema version 14, and an analysis written by an older version has no reference of a Lightning web component until
the snapshot is analysed again (`orglens analyse`). Decision record 0094 has the details.
