# 0015. Reuse Salesforce CLI logins, store no credentials

- Status: Accepted
- Date: 2026-11-11
- Decisions: D5

## Context

One prototype stored tokens in the operating-system keyring and another read key files from a configuration folder.
Both make the tool a place where credentials live, which is a liability for an open-source tool run on consultants'
machines against client orgs.

## Decision

By default OrgLens uses a login that already exists in the Salesforce CLI on the machine. For CI it supports the JWT
bearer flow with the username, client id and key file location passed in environment variables.

OrgLens stores no credentials: not in `orglens.toml`, not in `.orglens/`, not in logs.

## Consequences

- Users log in the way they already do, and revoking access is done in one place.
- The configuration file can be committed and shared, because it identifies an org by its id, which is not a
  credential.
- Research found that the library's built-in JWT login writes a credential file to the home directory. OrgLens
  therefore performs the JWT exchange itself and keeps the token in memory only.
- There is no browser login inside OrgLens for now. Admins without the Salesforce CLI are served later.
