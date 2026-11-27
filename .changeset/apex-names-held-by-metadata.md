---
'sf-orglens': patch
'@sf-orglens/engine': patch
---

The analysis reads the names that records of custom metadata types and field sets hold, where Apex reads them. A field
of a record that holds a text, such as `Billing_Rule__mdt.getInstance('Invoice_Late_Fee').Field_Name__c`, gives the
values that the records of the project give it: of the records the code names with `getInstance` or `getAll().get`, and
of every record of the type where it names none. A name in such a value stands where the code reads the field, with the
`via` `text`, and is `probable` at most, and the code refers to each record it names. A field set that the code names,
as `Schema.SObjectType.Invoice__c.fieldSets.getMap().get('Invoice_Summary')` or by its token, is referred to where its
name stands, and the code reads there each field it shows, also through a relationship. A record or a field set that the
project does not hold, and a record the code makes, give a `possible` reference to the object that the name would be of,
or the warning `PATH_NOT_FOLLOWED` where that object is not known either. So `orglens impact` of a field now holds the
code that reads it through custom metadata or a field set. A snapshot analysed by an older version shows none of this
until it is analysed again (`orglens analyse`). Decision record 0092 has the details.
