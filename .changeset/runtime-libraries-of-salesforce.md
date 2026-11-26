---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

The engine uses `@salesforce/core` 9.6.0, `@jsforce/jsforce-node` 3.13.4 and `undici` 8.13.1, where it used 9.5.0,
3.13.1 and 8.12.4. OrgLens is not known to behave differently with them. The one change of code in
`@jsforce/jsforce-node`, made in 3.13.3, is in a way of renewing a login that OrgLens does not use: `@salesforce/core`
renews a login with code of its own, which has not changed. The package of 3.13.4 holds the same files as that of
3.13.3, apart from the version number. The new `@salesforce/core` adds a message about creating scratch orgs, and the
new `undici` fixes how connections are reused and how a waiting request is stopped. The description of the Metadata
API in `@jsforce/jsforce-node`, which the table of what a type can name is held against, is the same file as before.
These versions were tested against the mock org of the tests, not against an org.
