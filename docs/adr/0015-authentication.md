# 0015. Reuse Salesforce CLI logins, store no credentials

- Status: Accepted
- Date: 2026-11-11
- Decisions: D5

## Context

A tool that stores tokens or key files becomes a place where credentials live. That is a liability for an open-source
tool run on consultants' machines against client orgs.

## Decision

By default OrgLens uses a login that already exists in the Salesforce CLI on the machine. For CI it supports the JWT
bearer flow with the username, client id and key file location passed in environment variables.

OrgLens itself stores no credentials: not in `orglens.toml`, not in `.orglens/`, not in logs.

## Consequences

- Users log in the way they already do, and revoking access is done in one place.
- The configuration file can be committed and shared, because it identifies an org by its id, which is not a
  credential.
- Research found that the library's built-in JWT login writes a credential file to the home directory. OrgLens
  therefore performs the JWT exchange itself and keeps the token in memory only.
- The Salesforce libraries update the Salesforce CLI's own state files in the home directory when they connect.
  Every file touched is listed in the decision record written with the connectivity work.
- There is no browser login inside OrgLens for now. Admins without the Salesforce CLI are served later.
