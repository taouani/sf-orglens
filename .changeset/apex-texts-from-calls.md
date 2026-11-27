---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis follows a text that an Apex method is handed as a `String` from each call of the method: what the method
does with the text, as a field of a record that `get` or `put` names, the object of a query it builds or a class of
`Type.forName`, is read again at the call with the text the call gives, and the call refers to what the text names.
So `orglens impact` of a field now holds the code that hands its name to a helper. A method that only calls of the
project reach says nothing of such a parameter: a `possible` reference to the object, or a warning
`PATH_NOT_FOLLOWED` where the object is not known either, stands at the call that hands it a text that is not known.
A method still says what it does not know itself, and one that calls itself, also through other methods, keeps its
warnings. So does a method that code outside the project can call, such as one that is `global` or `@AuraEnabled`,
a public method of a class that implements an interface of Salesforce, or a setter that a Visualforce page calls. A
snapshot analysed by an older version shows none of this until it is analysed again (`orglens analyse`). Decision
record 0091 has the details.
