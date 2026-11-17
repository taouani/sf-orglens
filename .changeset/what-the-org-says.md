---
'@sf-orglens/engine': minor
'sf-orglens': minor
---

A snapshot of an org takes the word of the org in two places where the Salesforce library falls short. A file
that comes back in a folder the library knows no type for is counted by the type the org describes with that
folder, so a type the library does not know yet no longer makes every snapshot `partial`. A component of a package
that comes back under its name without the prefix of the package counts as the component the org listed, and the
note `RETRIEVED_WITHOUT_PREFIX` says so. Not verified on a real org.
