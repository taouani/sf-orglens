---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads the calls of an Apex class or trigger. A call of a method of the project refers to the method that
the number and the types of its arguments choose, with the `via` `call`, and is `probable` to each method that a class
the value can be of runs in its place, and wherever the types do not tell the methods apart. A `new` of a class calls
the constructor its arguments choose, or the class where it declares none, with the `via` `new`; an exception has the
constructors of Salesforce too. `this(...)` and `super(...)` call a constructor as well, with the `via` `call`. A call
into a class whose code is hidden refers to the class, and the analysis keeps the name of the method. A value of an
enum that the code names, also after `when` in a `switch`, reads the enum. So
`orglens impact` of a field or an object now holds what calls the members that read or write it. Names in texts, such
as a query in a string, are not read yet, so `ApexClass` and `ApexTrigger` stay among the types that are not
analysed. A snapshot analysed by an older version shows none of this until it is analysed again (`orglens analyse`).
Decision record 0089 has the details.
