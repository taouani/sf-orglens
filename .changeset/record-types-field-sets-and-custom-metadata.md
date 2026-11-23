---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

Record types, field sets and records of custom metadata types are analysed. A record type refers to each picklist
field whose values it limits, and keeps the values it allows on that reference, and to its business process. It
says whether it is active. A field set reads each field it lists, available or shown, also across relationships. A
record of a custom metadata type refers to its type, to each field it gives a value, and to what the value of a
relationship names: an object, a field, whose object is the value of the field that controls the relationship, or a
record of another type. A value of a text field that is exactly `Object.Field`, or exactly the name of a field of
an object the same record names in a relationship, is a reference to that field at the tier `probable`, where a
file of the snapshot defines the field. A text with other words, a standard field and an object named in a text
give nothing. A field a record gives no value, as Salesforce writes one for each field a record leaves out, gives
nothing.

What these files do not say is reported and not guessed. A picklist of a record type, a field of a field set or a
field of a record that is not built like a name is the warning `NAME_NOT_READ`. A field set that lists a field
across a relationship that leads nowhere known, and the value of a relationship to a field whose object the record
does not give, are the warning `PATH_NOT_FOLLOWED`. A value of a record that is not one name gives nothing and no
warning: Salesforce writes one name as the value of a relationship, and a text can hold anything.

Of these files, the Dependency API reports the type of a record and the custom fields of a field set. The
cross-check now compares those rows, and the row from a record to its type is no longer counted as not compared.
It counts the other references of records with the new reason `custom-metadata`, and those of record types with
the new reason `record-type`.

A snapshot that was taken before has to be analysed again with `orglens analyse` for these types to be read.

Not read: what a record type names besides its picklists and its business process, the values of a record in
fields that are neither a relationship nor a text, and a text that names a field of an object that only another
record names.
