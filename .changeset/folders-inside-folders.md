---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org no longer counts a report, a dashboard or a folder of either as missing when it lies in a
folder inside a folder and came back. An org lists such a folder by its own name, as `Quarterly`, and a report in
it as `Quarterly/Revenue`, and hands both out under the whole path, as `Finance/Quarterly` and
`Finance/Quarterly/Revenue`. Each such component was counted twice: as one the org listed that did not come back,
and as one that came back although the org had not listed it. These were warnings: the four types are outside the
logic tier.

What comes back under the whole path now counts as the listed component, under the conditions that hold for a
document and for what belongs to person accounts. One condition is new: where two components that came back in
one retrieve stand for one listed name, such as two folders of one name in two folders, neither counts as it. The
files and the keys of the snapshot keep the whole path. The
note `RETRIEVED_UNDER_ANOTHER_NAME` has the new reason `folder-path` in `details.reason`. The names of that note
and of `RETRIEVED_WITHOUT_PREFIX` are now in the order of the listed names.

Not verified on an org: the test org has no folder in a folder.
