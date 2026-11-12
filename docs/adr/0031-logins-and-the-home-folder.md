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

1. If one of the five variables for a login with a key is set for the source (`ORGLENS_JWT_<SOURCE>_USERNAME`,
   `_CLIENT_ID`, `_KEY`, `_KEY_FILE`, `_LOGIN_URL`), the source is logged in with a key. An incomplete set is an
   error. It is not a reason to try a login of the Salesforce CLI, because a job that silently used another login
   would read as another user. A variable with another name, such as a misspelled one, is not read and is no
   error. `doctor` warns about every variable that starts with `ORGLENS_JWT_` and that no source reads.
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
hands the answer to the library. The version set for the Salesforce CLI (`org-api-version`) is not applied. When
it connects, the library neither looks the version up nor stores it. Two people who read the same org use the
same version. A renewal is the exception to "nor stores it": see below.

**The logins are listed by reading files, without the library.** `doctor` and the choice of a login read the
names of the files in `.sfdx`, and from each login file the user name, the org id and the address of the org, and
the aliases from `.sfdx/alias.json`. No token is decrypted, nothing is written, and a file that cannot be read is
left out. A test compares the list with the one the library gives. The library is loaded only when a connection
is made.

**The exchange with a key is made by OrgLens.** The library's own login with a key writes a login file.
OrgLens signs the assertion with `node:crypto` (RS256, valid for three minutes), posts it to the token address, and
hands the session to the library in memory. The request has a time limit of 30 seconds and is not repeated.

**A login with a key is refused for a user who also has a login of the Salesforce CLI on the machine.** The
library reads the login file of the user of a session it is given and takes over what it finds. With a refresh
token from that file, it renews a session of the key that the org does not accept with the other login, writes
the login file, and the result still looks like a login with a key. The code review of this work showed exactly
that. OrgLens therefore looks for a login of the same user before it sends anything, and after the library has
built its login it asks the library whether that login is a session and nothing else. In both cases the command
ends with the reason `JWT_USER_HAS_LOGIN`. A build server has no login of the Salesforce CLI. A person who tries
the key of a job on a machine where that user is logged in has to log the user out or unset the variables.

Details of the login with a key:

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

**What is read and written.** Measured on Linux with the file-based keychain, by tracing the files the process
opens. `<user>` stands for a user name. All paths are in the home folder unless they say otherwise.

| What OrgLens does                          | Read                                                                                                                                                                                | Written                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `doctor`, `source link`, choosing a login  | names in `.sfdx`, `.sfdx/<user>.json`, `.sfdx/alias.json`                                                                                                                           | nothing, and no folder is created                                                                                              |
| Any connection, through the library        | `.sf/config.json`, `.sfdx/sfdx-config.json`, `.jsforce/config.json`, and `sfdx-project.json` in the current folder and every folder above it. A file that is missing is not created | no log file: `SF_DISABLE_LOG_FILE` is set before the library loads                                                             |
| Connecting with a Salesforce CLI login     | the above, the encryption key (keychain or `.sfdx/key.json`), `.sfdx/<user>.json`, `.sfdx/alias.json`                                                                               | nothing while the session is valid                                                                                             |
| The same, when the session has expired     | the same                                                                                                                                                                            | `.sfdx/<user>.json`, rewritten by the library, and for the time of the renewal a lock file beside it                           |
| Connecting with a key from the environment | the above, and it looks for `.sfdx/<user>.json` of the user of the key                                                                                                              | `.sfdx/alias.json` and `.sfdx/key.json`, if they are not there yet                                                             |
| OrgLens itself, in the workspace           | `orglens.toml`, `.orglens/local.toml`                                                                                                                                               | `.orglens/local.toml` by `source link` and `source remove`, and a line in `.orglens/logs/` by `source link` and `source check` |

Some of these rows need words:

- **The settings of the Salesforce CLI are read.** The library reads the configuration files of the Salesforce
  CLI and of its HTTP client, and looks for a Salesforce project around the current folder, as it does for every
  program that uses it. OrgLens passes the two settings it would otherwise take from there, the login and the API
  version, itself. What else those files can change in the library was not examined.
- **A login with a key leaves two files.** The library creates `.sfdx/alias.json` with an empty list of aliases
  and `.sfdx/key.json` with a new encryption key of its own, which protects nothing. Neither holds the session,
  the user name or the private key, and no login file is written. A test runs the login in two processes in a row
  and requires that the home folder holds exactly these two files afterwards. With the keychain of the system in
  use, the library would put that key there instead of in `key.json`.
- **Renewing an expired session is the library's work, and it asks the org more than OrgLens does.** When the
  session of a Salesforce CLI login has expired, the library renews it with the stored refresh token. Before it
  stores the result, it makes three requests of its own: a query that finds out whether the org is a Dev Hub, the
  list of API versions, and a query that reads the name, the instance, the kind, the namespace and the trial end
  date of the org. It writes all of that into the login file with the new session, the newest API version
  included. The Salesforce CLI does the same whenever it renews a login. The code of OrgLens makes none of these
  requests. A test pins the full list of requests, so that a new version of the library that asks for more
  fails it. These requests run with the time limit of the library, which is 30 minutes, not with the 30 seconds
  of the requests OrgLens makes. If the process is stopped during a renewal, the lock file can stay behind.
- **The workspace log.** `source check` writes one line to the log of the workspace: the name of the source, its
  kind and the route of the login. In a folder that holds the configuration and nothing else, as a fresh clone on
  a build server does, the file that keeps `.orglens` out of Git is written first.

**What Salesforce says is filtered before it is shown.** The words of OrgLens in a message name no token, no key,
no address and no user. Where a message passes on what Salesforce or the library said, tokens are removed,
everything that has the form of an address or of a user name is masked, a page is not passed on, and the text is
cut after 300 characters. Whether a session could not be renewed is decided from the start of the library's own
message, which is the only sign the library gives, and not from a word somewhere in the answer of an org.

**A redirect is followed.** The HTTP client of the library follows a redirect and sends the headers of the request
along, the session included. The signed assertion is not sent along: a redirected request loses its body. The
requests with a session start at the address that issued it. This was accepted for a login and is to be decided
again for a retrieve.

**Failures are sorted, and say what to do.** Every failed login is the error `LOGIN_FAILED` with a reason in its
details: no login, several logins, a linked login that is gone, variables that are incomplete or invalid, a
refused key, a key whose user also has a login of the Salesforce CLI, a session that cannot be renewed, an org
that cannot be reached, or a request that failed. `docs/cli.md` lists the reasons.

**The personal file may name a source that is gone.** `orglens.toml` is shared and `.orglens/local.toml` is not.
When a colleague removes or renames a source, the login that someone else linked to it stays in that person's
file. That is not an error, the login is not used, and `doctor` names it. `source remove` changes the shared file
first and the personal file second, so that a failure in between leaves this harmless state.

## Consequences

- OrgLens stores no credential and creates no login. A person logs in and out with the Salesforce CLI, and a job
  holds its key in the secrets of its CI system.
- The rule "OrgLens reads metadata only" holds for the code of OrgLens. It does not fully hold for the process:
  on a renewal the library reads one row that describes the org itself, and looks for Dev Hub records. Avoiding
  that would mean renewing sessions without the library, which means handling refresh tokens in OrgLens. That
  was judged the worse choice. `CLAUDE.md` states the exception next to the rule.
- A login with a key cannot be tried on a machine where the same user is logged in with the Salesforce CLI.
- Part three of this work has to make sure that the library never stores a session of a login with a key. Nothing
  does so today, but paths of the library that a retrieve may use save the login they work with.
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
