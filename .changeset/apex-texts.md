---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads the names that the code of an Apex class or trigger holds in texts: the text of a query or a search
that `Database` or `Search` runs, the field that `get` and `put` of a record name, the relationship of `getSObject`, the
field of the map of fields of a describe, the object of `Schema.getGlobalDescribe()` and `Schema.describeSObjects`, and
the class of `Type.forName`. It follows how a member builds such a text, with `+`, `+=`, branches and loops, the
constants it uses, `String.join`, `String.format` and the other methods of `String` that keep names, and the texts that
methods of the project give back. Each name stands where its characters stand in the code, with the `via` `text`, and is
`probable` at most. A part of a text that is not known is a `possible` reference to its object, or the warning
`PATH_NOT_FOLLOWED`, which says what is not known. So `orglens impact` of a field or an object now holds what names it
in a text, and an answer can say that warnings of Apex bear on it. `ApexClass` and `ApexTrigger` stay among the types
that are not analysed until the answers take Apex in. A snapshot analysed by an older version shows none of this until
it is analysed again (`orglens analyse`). Decision record 0090 has the details.
