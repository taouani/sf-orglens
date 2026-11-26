---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads the declarations of every Apex class and trigger. Each method, constructor, property, member
variable, initialiser and inner class is a component below its class, and a class declared in a trigger is below the
trigger. A class refers to the class it extends and the interfaces it implements, a trigger to its object with its
events, and a member to the classes and objects it uses as a type, also through `new` of an object and, as
`probable`, through `Type.forName('Name')`. A test class, its members and a test method are marked as tests in their
attributes. A class whose code is `(hidden)`, or that has no file of code, is not analysed, with the new warning
`APEX_NO_CODE`. What the code of a class reads, writes and calls is not read yet: `orglens impact` still names
`ApexClass` and `ApexTrigger` among the types that are not analysed, now "or only in part", and their rows of the
Dependency API are not compared. The reports of `snapshot`, `analyse` and `coverage` have a line for `parser:apex`.
A snapshot analysed by an older version shows none of this until it is analysed again (`orglens analyse`). Decision
record 0084 has the details.
