---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org is now judged over the logic tier: 21 metadata types, listed in `docs/cli.md`. What the org
listed and did not hand out, a listing it refused, a retrieve that failed and a file that cannot be read as
metadata make the snapshot `partial` only for a type of that tier. For any other type the same issue is a
warning, the snapshot is `complete`, and `snapshot` ends with `0` where it ended with `5`. The first line of the
report then says "is complete for the logic tier" and that something of other types is missing, and each of the
four issues carries `details.tier`. The file of custom labels is not missing when the org lists no label.
`impact` ends with `0` where it ended with `5` for a snapshot in which a file or a retrieve outside the tier
failed: the answer does not cover that type and names it in `notCovered.notAnalysed`. A snapshot of a repository
is not changed. Not verified on a real org.
