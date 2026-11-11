# Security policy

## Supported versions

OrgLens is in pre-release and no version has been published. Security fixes go to the `main` branch. This section
will list supported versions once the first release exists.

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

- OrgLens stores, logs or transmits a credential, an access token or a session id.
- OrgLens sends metadata, source code or results anywhere without the user asking for it.
- OrgLens reads record data from an org. It is designed to read metadata only.
- Crafted metadata or a crafted repository makes OrgLens execute code, write outside its workspace folder, or read
  files it was not pointed at.
- A dependency with a known vulnerability that can be reached through OrgLens.

## Design commitments

- No credentials are stored by OrgLens. Login is delegated to the Salesforce CLI login on the machine, or to
  environment variables in CI.
- No telemetry.
- The optional language-model features are off by default and say what they send before they send it.
