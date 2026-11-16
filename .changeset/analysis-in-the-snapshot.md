---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot is now analysed. `orglens snapshot` analyses the files it stored: the objects, fields and validation
rules, with the names written in their XML and in their formulas. The new command `orglens analyse <source>`
analyses a stored snapshot again from the files it holds, without reading the source, and migrates a database
that an older version wrote. `coverage` shows per metadata type how many components were analysed, and per
origin how many references were found, how many are not resolved, and how many paths were not followed.
`status` says whether the latest snapshot of a source is analysed. `snapshot` and `analyse` end with the exit
code 5 when the snapshot is partial or its analysis is incomplete. In the JSON output, the report of a snapshot
gets `analysis`, every issue gets `stage` and `component`, and `status` gets `latestSnapshot.analysis`. No
command answers an impact question yet, and no snapshot of a real org was analysed.
