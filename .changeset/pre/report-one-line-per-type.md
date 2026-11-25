---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

The report of a snapshot is shorter in one place and clearer in two. Files of an org that cannot be read as
metadata for the same reason, and are counted with the same types, share one line, with their number and the
first of them: an org can hand out hundreds of files of a type the Salesforce library does not know, and each had
a line of its own. Where nothing tells the type of such files, only those of one top folder share a line. A
repository still has a line for each file. The warning `FLOW_VERSION_UNKNOWN`, which had one line for all flows,
has one for each reason it gives. And the line of the type `CustomLabels` says that it holds the labels, beside the
line of `CustomLabel`, which counts them: the two read like one type that is listed twice. The table of types of an
`impact` answer names it the same way. The JSON output is unchanged: it has every issue, and the type is
`CustomLabels`.

A message about a file that the Salesforce library could not place, in a folder whose type the org describes or
does not tell, ran two sentences together. They are two sentences now.
