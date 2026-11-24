---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

The report of a snapshot is shorter in one place and clearer in another. Files that cannot be read as metadata
for the same reason, and are counted with the same types, share one line, with their number and the first of
them: an org can hand out hundreds of files of a type the Salesforce library does not know, and each had a line
of its own. And the line of the type `CustomLabels` says that it is the file of the labels, beside the line of
`CustomLabel`, which counts them: the two read like one type that is listed twice. The table of types of an
`impact` answer names the file the same way. The JSON output is unchanged: it has every issue, and the type is
`CustomLabels`.
