---
'@sf-orglens/engine': patch
---

The engine uses `@salesforce/core` 9.6.0, `@jsforce/jsforce-node` 3.13.3 and `undici` 8.13.1, where it used 9.5.0,
3.13.1 and 8.12.4. The new version of `@jsforce/jsforce-node` keeps the new refresh token when Salesforce hands one out
with a renewed login. The description of the Metadata API in it, which the table of what a type can name is held
against, is the same file as before.
