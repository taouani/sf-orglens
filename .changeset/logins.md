---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Add logins. A source of the kind `org` or `sandbox` is logged in with a login of the Salesforce CLI: the one that
`orglens source link <name> <login>` sets in the personal file, or the one login that belongs to the org the
source declares. A job without a person logs in with a key from the variables `ORGLENS_JWT_<SOURCE>_…`, and no
login file is written. `orglens source check <name>` connects and says which org answered, by which login and with
which API version, and for a source of the kind `git` it reads everything a snapshot would read. Both store
nothing. A login that fails, or that belongs to another org than the declared one, ends with the exit code `4`.
`doctor` now also checks Git and says how each org would be logged in. Snapshots of orgs and sandboxes are not
available yet.
