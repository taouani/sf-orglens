---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org holds the active version of a flow. An org hands out the newest version of a flow, which can
be a draft while an older version runs. Where the file of a flow says that it is not active and its definition
names an active version, the snapshot asks for that version by its number and keeps it under the path of the
flow. The new note `FLOW_NEWER_VERSION` says that the flow has a newer version that is not analysed. If the
active version does not come back, the flow is not in the snapshot, the snapshot is partial (`NOT_RETRIEVED`),
and the new note `ACTIVE_FLOW_NOT_RETRIEVED` says why. A flow that is not active and has no definition, or that
the org lists under another name than that of its file, is kept as it came, with the new warning
`FLOW_VERSION_UNKNOWN`, which an impact answer that covers flows counts: such an answer is not complete. The
three are the first issues of the reading that name a component, the flow. The text of `snapshot` and `coverage`
shows one line for each of them, with the number of flows.

On the test org, a snapshot of a flow with an active version and a newer draft holds the active version, with
the note.
