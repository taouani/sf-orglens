---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

The email alerts, field updates, outbound messages and tasks of a workflow rule, which the analysis reads, are of
the logic tier now: every type an analyser reads is. A snapshot of an org that lists one of them and does not hand
it out, or that refuses to list them, is `partial` where it was `complete`, and `orglens snapshot` ends with `5`
where it ended with `0`. An impact answer from such a snapshot said already that it may miss something, and does
not change. `exclude_types` in `orglens.toml` refuses the four names, as it refuses every type of the tier: a
snapshot read them all the same before, with the warning `TYPE_NOT_EXCLUDED`. A snapshot that an earlier version
took keeps the status it was given.
