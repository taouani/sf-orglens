---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis follows a text that an Apex method is handed as a `String` from each call of the method: what the method
does with the text, as a field of a record that `get` or `put` names, the object of a query it builds or a class of
`Type.forName`, is read again at the call with the text the call gives, and the call refers to what the text names.
So `orglens impact` of a field now holds the code that hands its name to a helper. A method that only calls of the
project reach says nothing of such a parameter, and a warning `PATH_NOT_FOLLOWED` stands at the call that hands it a
text that is not known. A method that code outside the project can call, such as one that is `global` or
`@AuraEnabled`, keeps its warnings. A snapshot analysed by an older version shows none of this until it is analysed
again (`orglens analyse`). Decision record 0091 has the details.
