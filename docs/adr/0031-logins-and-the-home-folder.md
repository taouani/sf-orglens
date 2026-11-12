# 0031. How a source is logged in, and what that touches in the home folder

- Status: Accepted
- Date: 2026-11-12
- Decisions: none (made during the build)

## Context

[0015](0015-authentication.md) says that OrgLens uses a login of the Salesforce CLI by default, logs in with a key
from environment variables in a job without a person, and stores no credentials. It left three things to the work
that builds the logins: which login belongs to which source, how the exchange with a key is made, and which files
in the home folder of the user are read or written. That record promised a list of every file touched. This is
it.

The Salesforce library (`@salesforce/core`) keeps the logins of the Salesforce CLI in the folder `.sfdx` of the
home folder, one file per user, with the tokens encrypted by a key that lives in the keychain of the system or in
`.sfdx/key.json`. The library is the only code that should decrypt and renew those logins. It also does more than
OrgLens asks for, and what it does was measured before this was written, with version 9.4.6 on Linux, against a
mock org, with the home folder redirected.

## Decision

**Which login a source uses is decided in a fixed order, and a later step never covers for a failed earlier one.**

1. If any variable `ORGLENS_JWT_<SOURCE>_*` is set, the source is logged in with a key. An incomplete set is an
   error. It is not a reason to try a login of the Salesforce CLI, because a job that silently used another login
   would read as another user.
2. Otherwise, if the personal file `.orglens/local.toml` names a login for the source, that login is used, found
   by alias first and then by user name. If it is no longer on the machine, that is an error.
3. Otherwise, if exactly one login of the Salesforce CLI belongs to the org the source declares with `org_id`,
   that login is used. Several are an error that asks for `orglens source link`. A source without `org_id` and
   without a linked login cannot be logged in.

The link is personal and is never written to `orglens.toml`: an alias means something on one machine only.

**The org says who is logged in, before anything is read.** After connecting, OrgLens asks the org for the
identity of the session and compares the org id with the one the source declares. A difference is the error
`ORG_MISMATCH`. The org id in a login file is compared first, without a request, but it is not trusted. A source
without `org_id` accepts any org, and `source check` says so.

**The API version is the newest the org offers.** OrgLens asks the org for its versions, which needs no login, and
hands the answer to the library. The version set for the Salesforce CLI (`org-api-version`) is not applied, and
the library neither looks the version up nor stores it. Two people who read the same org use the same version.

**The logins are listed by reading files, without the library.** `doctor` and the choice of a login read the
names of the files in `.sfdx`, and from each login file the user name, the org id and the address of the org, and
the aliases from `.sfdx/alias.json`. No token is decrypted, nothing is written, and a file that cannot be read is
left out. A test compares the list with the one the library gives. The library is loaded only when a connection
is made.

**The exchange with a key is made by OrgLens.** The library's own login with a key writes a login file.
OrgLens signs the assertion with `node:crypto` (RS256, valid for three minutes), posts it to the token address, and
hands the session to the library in memory. The request has a time limit of 30 seconds and is not repeated.
Details:

- The key is given as text in `ORGLENS_JWT_<SOURCE>_KEY` or as a path in `ORGLENS_JWT_<SOURCE>_KEY_FILE`, never
  both. Only RSA keys are accepted. A message about a key names the variable and never what it holds.
- The login address is `ORGLENS_JWT_<SOURCE>_LOGIN_URL`, then `login_url` of the source, then the general address
  of Salesforce for the kind of the source. It must be `https`. `http` is accepted for this machine only, which is
  what the tests use.
- The audience of the assertion is one of the two general addresses of Salesforce or the login address. For a
  login address at Salesforce, they are tried in that order, and the next one only after Salesforce refuses the
  grant. For any other host, only the login address itself is used: an assertion that is signed for Salesforce is
  never sent to a host that is not Salesforce.
- For a login with a key, `source check` shows neither the user name nor the address of the org. Both come from
  secrets, and the output of a job is read by others.

**What is read and written in the home folder.** Measured on Linux with the file-based keychain. `<user>` stands
for a user name.

| What OrgLens does                            | Read                                                                               | Written                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `doctor`, `source link`, choosing a login    | names in `.sfdx`, `.sfdx/<user>.json`, `.sfdx/alias.json`                          | nothing, and no folder is created                                                    |
| Connecting with a Salesforce CLI login       | the above, and through the library the key of the keychain and `.sfdx/<user>.json` | nothing while the session is valid                                                   |
| The same, when the session has expired       | the same                                                                           | `.sfdx/<user>.json`, rewritten by the library with the new session and what it found |
| Connecting with a key from the environment   | `.sfdx/<user>.json` of the same user, if there is one                              | `.sfdx/alias.json` and `.sfdx/key.json`, if they are not there yet                   |
| Any use of the library                       |                                                                                    | no log file: `SF_DISABLE_LOG_FILE` is set before the library loads                   |
| OrgLens itself, in the workspace of the user | `.orglens/local.toml`                                                              | `.orglens/local.toml`, by `source link` and `source remove` only                     |

Three of these rows need words:

- **A login with a key leaves two files.** The library creates `.sfdx/alias.json` with an empty list of aliases
  and `.sfdx/key.json` with a new encryption key of its own, which protects nothing. Neither holds the session,
  the user name or the private key, and no login file is written. A test runs the login in two processes in a row
  and requires that the home folder holds exactly these two files afterwards. With the keychain of the system in
  use, the library would put that key there instead of in `key.json`.
- **A login with a key reads the login file of the same user.** If the user of the key also has a login of the
  Salesforce CLI on the machine, the library adds the fields of that file to its copy in memory. The session of
  the key is the one that is used, and the file is not changed. Both are tested.
- **Renewing an expired session is the library's work, and it asks the org more than OrgLens does.** When the
  session of a Salesforce CLI login has expired, the library renews it with the stored refresh token. It then
  makes two queries of its own before it stores the result: one finds out whether the org is a Dev Hub, the other
  reads the name, the instance, the kind, the namespace and the trial end date of the org. It writes those into
  the login file with the new session. The Salesforce CLI does the same whenever it renews a login. The code of
  OrgLens makes neither query. A test pins the requests, so that a new version of the library that asks for more
  fails it.

**Failures are sorted, and say what to do.** Every failed login is the error `LOGIN_FAILED` with a reason in its
details: no login, several logins, a linked login that is gone, variables that are incomplete or invalid, a
refused key, a session that cannot be renewed, an org that cannot be reached, or a request that failed. A message
never contains a token or a key. `docs/cli.md` lists the reasons.

## Consequences

- OrgLens stores no credential and creates no login. A person logs in and out with the Salesforce CLI, and a job
  holds its key in the secrets of its CI system.
- The rule "OrgLens reads metadata only" holds for the code of OrgLens. It does not fully hold for the process:
  on a renewal the library reads one row that describes the org itself, and looks for Dev Hub records. Avoiding
  that would mean renewing sessions without the library, which means handling refresh tokens in OrgLens. That
  was judged the worse choice.
- A job that logs in with a key leaves two small files without secrets in the home folder of the runner. They
  could be avoided only by not using the library for the connection.
- Reading the login files directly depends on their layout, which is the library's and not a public contract.
  The test that compares both lists fails when a new version of the library changes it.
- Two new direct dependencies of the engine, `@salesforce/core` and `@jsforce/jsforce-node`. Both were installed
  already, as dependencies of the Salesforce source library, and are now imported by `sources/` and pinned.
- The tests run with a home folder of their own (`tools/vitest-setup.js`), without the `SF_`, `SFDX_` and proxy
  variables of the machine, and with the file-based keychain. A test cannot see or change the logins of the
  person who runs it.

Not verified, and stated as such:

- The keychain of macOS, the system keychain of Linux and the storage on Windows. CI runs the tests on all three
  systems, but with the file-based keychain. On a machine that uses the keychain of the system, a login with a key
  would make the library store its encryption key there.
- A login written by the real Salesforce CLI. The login files of the tests are written by the same library the
  Salesforce CLI uses.
- A real org. Which audience Salesforce accepts for a login address of an org's own domain, and the wording of
  its refusals, are taken from its documentation and from the mock. The live-org workflow is the first check
  against Salesforce itself.
- The table above on any version of the library other than 9.4.6.
