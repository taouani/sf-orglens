---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A source of the kind `org` or `sandbox` can leave metadata types out of its snapshots with the new key
`exclude_types` in `orglens.toml`, for an org with very many components of a type nobody asks about, such as
reports. The org is not asked for such a type, and nothing of it is read. The report of the snapshot shows the type
as `left out`, and an impact answer names it among the types it does not cover. A type of the logic tier cannot be
left out. The workspace database moves to schema version 7, and `orglens snapshot` or `orglens analyse` migrates an
earlier one. Not verified on a real org.
