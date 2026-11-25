# 0075. The objects `PersonAccount` and `BusinessAccount` show the fields of a person account as the account does

- Status: Accepted
- Date: 2026-11-25
- Decisions: none (a correction made after the maintainer took a snapshot of a large org on 2026-11-23, with the
  choices of the author, which the maintainer can strike)

## Context

Record [0041](0041-components-and-names-written-in-xml.md) takes a name that ends in `__pc` on an account for the
custom field of the contact of a person account: `Level__pc` is `Contact.Level__c`. Record
[0042](0042-the-names-in-a-formula.md) takes `Level__pr` on an account for the relationship of that field. Both
hold for the object `Account` alone.

An org with person accounts hands out parts of the account under other objects. Record
[0071](0071-a-component-that-comes-back-under-another-name.md) names `PersonAccount`, under which an org hands out
a record type, a matching rule and a duplicate rule that it lists under `Account`. The snapshot of a large org held
fields under the object `BusinessAccount` as well, and their formulas walk relationships whose names end in
`__pr`. The analysis took each such name for a field of `BusinessAccount`, found none, did not know where it leads,
and gave a warning `PATH_NOT_FOLLOWED` for each. The maintainer said that the business account is a record type of
the account, and that `__pr` walks a lookup field of the contact of a person account. Neither the Salesforce
library nor the types of the Metadata API that `@jsforce/jsforce-node` declares name an object `BusinessAccount`.

## Decision

1. **A name that ends in `__pc` or `__pr` is read the same on the objects `Account`, `PersonAccount` and
   `BusinessAccount`**, in any case: `Level__pc` is `Contact.Level__c`, and `Level__pr` is the relationship of
   that field. The list holds these three names, since nothing else says which objects show the fields of a
   contact (`PERSON_ACCOUNT_OBJECTS` in `extraction/model.ts`).
2. **The field of the contact comes first. Where the snapshot defines no such field of the contact, and defines
   the field as the object shows it, the name is that field.** Record 0071 names that case: the Salesforce library
   would read a field such as `PersonAccount.Hobby__pc` in the file of the object `PersonAccount` as a component
   of its own. Whether an org hands one out is not known. Before this record a name on `PersonAccount` was such a
   field, and with the first point alone it would be lost where the snapshot holds no field of the contact. The
   same holds on `Account` and `BusinessAccount`, where a file defines the field there: before this record the
   name was not found on `Account`.
3. **Nothing else of `BusinessAccount` is taken for the account.** A custom field of another kind is its own, as
   before, and the key of a component keeps the name that came back, as record 0071 says. Whether an org hands out
   under `BusinessAccount` the same fields as under `Account`, or fields that it lists under `Account` only, is not
   known. The maintainer was asked.

## Consequences

- A formula of a field of `BusinessAccount` or `PersonAccount` that walks a `__pr` relationship is followed where
  the snapshot holds the lookup field of the contact, and a `__pc` name there is a field of the contact. An answer
  about that field of the contact holds what refers to it from those objects.
- Where the snapshot defines a field of the contact and the same field as an object shows it, such as
  `Contact.Level__c` and `PersonAccount.Level__pc`, a name `Level__pc` or `Level__pr` on that object is the field
  of the contact. Before this record it was the field as the object shows it, so an answer about
  `PersonAccount.Level__pc` held what names it there, and now does not. Nothing ties the two keys together, so no
  one question finds both.
- `fieldsANameCanBe` of record [0074](0074-a-warning-counts-where-it-can-bear-on-the-answer.md) needs no change,
  since it compares names without their object. The test that holds it against the model reads the two objects
  too.
- The fixture project and the public codebases hold no person account, so nothing of them moves.
- An analysis made before this record is not changed until `orglens analyse` analyses its snapshot again.
- Not verified on an org: the test org has no person accounts. The next snapshot of the large org, with a new
  pre-release, shows whether its warnings on `BusinessAccount` are gone.
- Not known: whether an org hands out parts of the account under yet another object. Its `__pc` names would stay
  unresolved and its `__pr` paths not followed, each with a warning, as before.
- Not changed, and older than this record: a formula field that the file of `PersonAccount` holds as `X__pc` is a
  formula of the contact, and its names are read on `PersonAccount`, as of any field of that object.
