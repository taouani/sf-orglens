---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads what the code of an Apex class or trigger reads and writes: the fields of records, also through
relationships and child relationships, the variables and properties of classes, of a class they extend and of a class
around them, the tokens of objects and fields with `get` and `put`, the object in front of a token, a describe and a
method of a custom setting or a custom metadata type, and the objects that DML writes, with what it does (`op`) and the
field an `upsert` tells records apart by. So `orglens impact` of a field now holds the members of classes and triggers
that read or write it, and of an object those that write its records. Each name is checked against the files of the
snapshot and, in a snapshot of an org, against the descriptions of its objects: a name that neither defines, and an
object that not every org has, is `probable`, also a standard field such as `Contact.AccountId`, and a use of such an
object as a type, which was `confirmed`. A field that an object the org described lacks is `unresolved`, with the new
warning `FIELD_NOT_DESCRIBED`. A `__r` name that nothing defines is taken for its lookup field, with the new warning
`RELATIONSHIP_GUESSED`, unless the code uses it as a list. The warning `PATH_NOT_FOLLOWED` now also says where a
relationship of Apex leads to no known object, where a child relationship nothing defines is not followed, and where
DML writes records of no known object (`details.op`). Queries, calls and names in texts are not read yet, so `ApexClass`
and `ApexTrigger` stay among the types that are not analysed. A snapshot analysed by an older version shows none of this
until it is analysed again (`orglens analyse`). Decision record 0087 has the details.
