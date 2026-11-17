---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org asks for a part by its own name when Salesforce cannot find what the part belongs to. The
org can list a field or a record type of an object that it does not list and that Salesforce cannot find in a
retrieve. Such parts were never asked for and counted as missing. Now they are asked for by their own names in
one more retrieve, and the note `PARTS_ASKED_BY_NAME` says so. On the one real org this was run against,
Salesforce could not find the parts by their own names either, and they stayed missing. A real org that hands
such a part out was not seen.
