# Security policy

## Supported versions

OrgLens is in pre-release. Three pre-releases were published: versions `0.1.0-next.0` and `0.1.0-next.1` on 17 November
2026, and `0.1.0-next.2` on 26 November 2026. No version without a pre-release part exists. Security fixes go to the
`main` branch. This section will list supported versions once the first release exists.

Pre-releases are published on npm as `sf-orglens` and `@sf-orglens/engine`, only by the workflow "Pre-release"
of this repository, each with a provenance attestation that names the run that built it. A version under one of
the two names without one is not from this project. There is one such version, `0.0.0-stage`, of each package:
npm made it by itself when the first pre-release was published, and it is not a version of OrgLens. The name
`orglens` is the name of the command and is not a package of this project.

## Reporting a vulnerability

Please report security problems privately through GitHub:
[Report a vulnerability](https://github.com/taouani/sf-orglens/security/advisories/new).

Do not open a public issue, and do not include real org data, host names, access tokens or other credentials in a
report. A description, the affected version or commit, and the steps to reproduce are enough.

You can expect a first answer within seven days. If the report is confirmed, the fix and the advisory are prepared
privately and published together, and you are credited unless you prefer otherwise.

## What counts as a security problem

OrgLens reads Salesforce metadata and source code and keeps the result on the user's machine. These are treated as
security problems:

- OrgLens writes a credential, an access token or a session id to its own files or logs, or sends one anywhere
  other than to Salesforce.
- OrgLens sends metadata, source code or results anywhere without the user asking for it.
- OrgLens reads record data from an org. It is designed to read metadata only.
- Crafted metadata or a crafted repository makes OrgLens execute code, write outside its workspace folder, or read
  files it was not pointed at.
- A dependency with a known vulnerability that can be reached through OrgLens.

## Design commitments

- OrgLens keeps no credential store of its own. Login is delegated to the Salesforce CLI login on the machine, or
  to environment variables in CI. The Salesforce library that OrgLens uses may refresh an expired token in the
  Salesforce CLI's own login files, exactly as the Salesforce CLI does. OrgLens writes no other credential file.
- No telemetry.
- The optional language-model features are off by default and say what they send before they send it.
