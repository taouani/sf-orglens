---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A name that ends in `__pc` or `__pr` is now read on the objects `PersonAccount` and `BusinessAccount` as on
`Account`: `Level__pc` is the field `Level__c` of the contact of a person account, and `Level__pr` is the
relationship of that field. An org with person accounts hands out parts of the account under these objects, and
the analysis did not know where such a relationship leads there, so it did not follow the path and left a warning
`PATH_NOT_FOLLOWED`. Where the snapshot holds no such field of the contact and holds the field as the object
shows it, such as `PersonAccount.Hobby__pc`, the name is that field. A snapshot that is already there is read this
way once `orglens analyse` analyses it again. Not verified on an org: the test org has no person accounts.
