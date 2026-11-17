---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org asks for a part by its own name when Salesforce cannot find what the part belongs to. The
org can list a field or a record type of an object that it does not list and that Salesforce cannot find in a
retrieve. Such parts were never asked for and counted as missing. Now they are asked for by their own names in
one more retrieve, and the note `PARTS_ASKED_BY_NAME` says so. Not verified on a real org.
