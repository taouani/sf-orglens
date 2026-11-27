---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The coverage counts the names in the texts of Apex by the step that found them: written as one literal, held by
metadata, or in a text the code builds, and apart from them the `possible` references and the paths not followed where
a part of a text is not known. `orglens snapshot`, `analyse` and `coverage` show them in a line under the table of
origins, and `--json` holds them in `texts` of the origin `parser:apex`, which is `null` for the other origins. Each
reference of the `via` `text` says its step in `attrs.step`, and a warning `PATH_NOT_FOLLOWED` that a text leads to has
`details.via` `text`. The workspace database moves to schema version 13, and an analysis written by an older version
counts no names in texts until the snapshot is analysed again (`orglens analyse`). Decision record 0093 has the details.
