---
'@sf-orglens/engine': patch
'sf-orglens': patch
---

No command, no output and no exit code has changed since `0.1.0-next.0`: the code of both packages is the same,
and only the version they name is new. This version exists to publish once without a token. The first
pre-release was published with a token of the maintainer, because a package has settings on npm only once it
exists. Every version after it is published through a trusted publisher of npm, which takes a version only from
the workflow "Pre-release" of this repository in its environment `npm-next`. That way had not been tried, and
npm keeps a new trusted publisher only when a version is published through it within two days.

One thing follows from the new version alone: a snapshot of an org that was interrupted under `0.1.0-next.0` is
not continued by this version. It is given up, and `orglens snapshot` begins a new one.
