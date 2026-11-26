---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads the queries and searches of an Apex class or trigger: the object after `FROM` and every field a
query names in any clause, also through relationships, in a subquery through a child relationship, which refers to the
lookup field behind it, in a subquery of the filter and after `WHEN` of a `TYPEOF`, what a query binds, and the objects
and fields of a search. Their references have the `via` `soql` or `sosl`. So `orglens impact` of a field or an object now
holds the members that query it. The warning `PATH_NOT_FOLLOWED` now also says where a subquery goes through a child
relationship that nothing defines, where the fields after `ELSE` of a `TYPEOF` are of objects that nothing says, and
where `FIELDS(ALL)`, `FIELDS(CUSTOM)` or `FIELDS(STANDARD)` reads fields that the query does not name. Calls and names
in texts, such as a query in a string, are not read yet, so `ApexClass` and `ApexTrigger` stay among the types that are
not analysed. A snapshot analysed by an older version shows none of this until it is analysed again (`orglens analyse`).
Decision record 0088 has the details.
