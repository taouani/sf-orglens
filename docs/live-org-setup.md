# Setting up the test org

OrgLens is tested against one real Salesforce org: a free Developer Edition org that holds nothing but the fixture
project. This page is the checklist for the maintainer who owns that org. It takes about 20 minutes and is done once.

At the end, four secrets exist in a protected environment of the GitHub repository. Only the workflow `live-org.yml`
reads them: when a maintainer starts it by hand, and once a week by itself, to log in and do nothing else. Nobody
else, and no tool, ever holds the key. The section "What the workflow does in the org" says what a run that is
started by hand can do beyond logging in.

These steps follow the Salesforce documentation as of November 2026. They were written without access to an org, so
a label on the screen may differ. If one does, note it and correct this page.

## Before you start

- Use a **new** Developer Edition org, and use it for nothing else. The key you create gives full access to this
  org. An org with no real data makes that harmless.
- You need `openssl`. macOS and Linux have it. On Windows it comes with Git for Windows: use "Git Bash".
- Do not paste the key, the consumer key, the user name or the address of the org into an issue, a pull request, a
  chat or a file of the repository. They go into GitHub secrets and nowhere else.

## 1. Sign up for the org

1. Open <https://developer.salesforce.com/signup> and sign up. Use an email address you read, and choose a user name
   you do not use anywhere else, for example `orglens-ci@<something unique>.example`. A user name has the form of an
   email address and does not have to be a real one.
2. Follow the link in the email, set a password and log in.
3. In Setup, enter `My Domain` in the Quick Find box and open **My Domain**. Copy the value of **Current My Domain
   URL**, and put `https://` in front of it. It looks like `https://<name>-dev-ed.develop.my.salesforce.com`. This is
   the **login URL** for step 4.

## 2. Create the key and the certificate

In a terminal, in a new folder outside any Git repository:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out orglens-ci.key
openssl req -new -x509 -sha256 -days 730 -key orglens-ci.key -out orglens-ci.crt -subj "/CN=orglens-ci"
```

In Git Bash on Windows, write `-subj "//CN=orglens-ci"` with two slashes. With one, Git Bash takes the value for
a path and rewrites it, and `openssl` fails.

`orglens-ci.key` is the private key. It is the secret. `orglens-ci.crt` is the certificate. It is not secret, and it
is the file Salesforce gets. The certificate is valid for two years. After that, repeat steps 2 to 4 with a new pair.

## 3. Create the external client app in the org

1. In Setup, enter `App Manager` in the Quick Find box and open **App Manager**.
2. Click **New External Client App**.
3. Name it `OrgLens CI` and enter your email address as the contact.
4. Under **API (Enable OAuth Settings)**, click **Enable OAuth**.
5. In **Callback URL**, enter `http://localhost:1717/OauthRedirect`. The value is required and is never used.
6. In **OAuth Scopes**, select **Manage user data via APIs (api)** and **Perform requests at any time
   (refresh_token, offline_access)**.
7. In **Flow Enablement**, select **Enable JWT Bearer Flow**.
8. Click **Upload Files** and upload `orglens-ci.crt`.
9. Click **Create**.
10. Click **Edit**, then open the **Policies** tab and **OAuth Policies**.
11. In **Plugin Policies**, set **Permitted Users** to `Admin approved users are pre-authorized` and confirm with
    **OK**.
12. In **App Policies**, select the profile **System Administrator**. This is the profile of the user you signed up
    with. It lets every user with that profile log in through the app. In an org that has one user and is used for
    nothing else, that is the one user. The narrower way is to create a permission set, assign it to that user
    only, and select it here under **Select Permission Sets** instead of the profile.
13. Click **Save**.
14. Open the **Settings** tab, then **OAuth Settings**, and click **Consumer Key and Secret**. Salesforce sends a
    verification code by email. Enter it, click **Verify**, and copy the **Consumer Key**. The consumer secret is not
    needed.

A new app can take up to ten minutes before Salesforce accepts logins with it.

## 4. Store the four secrets in GitHub

The secrets live in an environment, not in the repository as a whole. An environment does not tie its secrets to
one workflow file: any workflow that runs from an allowed branch and names the environment gets them. What
protects them is the rule in step 2, which allows only `main`, together with the review every change to `main`
goes through, and your approval of each run if you choose step 3.

1. In the repository on GitHub, open **Settings**, then **Environments**, and click **New environment**. Name it
   `live-org`.
2. Under **Deployment branches and tags**, choose **Selected branches and tags** and add the branch `main`. A
   workflow that runs from any other branch, or from a pull request, then cannot read the secrets.
3. Optional, and recommended: tick **Required reviewers** and add yourself. Every run of the workflow then waits for
   your approval. A run on a schedule would wait for it too.
4. Under **Environment secrets**, add these four:

| Name                         | Value                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ORGLENS_TEST_ORG_LOGIN_URL` | The login URL from step 1, for example `https://<name>-dev-ed.develop.my.salesforce.com`                                 |
| `ORGLENS_TEST_ORG_USERNAME`  | The user name you signed up with                                                                                         |
| `ORGLENS_TEST_ORG_CLIENT_ID` | The consumer key from step 3                                                                                             |
| `ORGLENS_TEST_ORG_JWT_KEY`   | The whole content of `orglens-ci.key`, including the lines `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` |

5. Delete `orglens-ci.key` from your computer, or move it into a password manager. GitHub cannot show a secret
   again, and it does not need to: a lost key is replaced by repeating steps 2 to 4.

## 5. Check it

Open **Actions**, choose **Live org**, click **Run workflow** on the branch `main`, and approve the run if you made
yourself a required reviewer. The step **Log in** logs in to the org and says whether that worked, and prints the
API version of the org.

The log of the step can be read by everyone. The step therefore prints no text that Salesforce, a Salesforce
library or OrgLens wrote: not the address of the org, the id of the org, the user name, a token, or a message. It
prints sentences of its own with error codes, names of variables, and the answer of Salesforce to a refused login
if that answer is word for word one of a list of known texts in `scripts/live-org-login.mjs`. Anything else is
"not shown".

If the login fails, the step names codes. This is what they mean:

| What the step says                | What it means                                                                                                                                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| secrets are missing               | A secret is not set in the environment `live-org`, or has another name than in the table above.                                                                                                                                                                                                                              |
| `JWT_INVALID`                     | A secret holds something that cannot be used. The line "Variable" names it: the key is not the whole key file, or the login URL is not an `https` address.                                                                                                                                                                   |
| `JWT_REJECTED`                    | Salesforce refused the login. The line "Answer of Salesforce" gives its error code, and its description if it is a known one. Usual causes: a wrong consumer key or user name, the certificate is not the one of the key, the user is not allowed to use the app (step 3, 11 to 12), or the app is younger than ten minutes. |
| `ORG_UNREACHABLE`                 | No answer came. The line "Network" says how: `ENOTFOUND` means that the login URL names no host, so check the secret `ORGLENS_TEST_ORG_LOGIN_URL` against step 1. `TIMEOUT` or `ECONNRESET` can also be a failure of the network of the runner, so start the workflow again first.                                           |
| `REQUEST_FAILED`                  | Something answered, and not as Salesforce does. The login URL may lead to another site.                                                                                                                                                                                                                                      |
| `SESSION_EXPIRED`                 | Salesforce issued a session and does not accept it. The app needs the OAuth scope `api` (step 3).                                                                                                                                                                                                                            |
| "orglens init" failed, or similar | OrgLens itself failed before it tried to log in. That is a bug in OrgLens or in the workflow, not in the set-up.                                                                                                                                                                                                             |
| anything else                     | The line names an error code. `docs/cli.md` lists them.                                                                                                                                                                                                                                                                      |

A run that is started from another branch than `main` never reaches the step: GitHub refuses the job, because the
environment `live-org` only accepts `main`. That is the behaviour GitHub documents for an environment with a
branch rule. It was not tried here.

When the step shows too little to find the cause, the full message is seen by logging in on a machine of your own.
If you have the Salesforce CLI, you can check the login on your own machine before you delete the key:

```sh
sf org login jwt --client-id <consumer key> --jwt-key-file orglens-ci.key --username <user name> --instance-url <login URL>
```

## What the workflow does in the org

A run that is started by hand asks what it should do after the login (**Run workflow**, field "What the run does
after it has logged in"). The weekly run always logs in only.

| Choice                | What the run does                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| login only            | Logs in. This is the default.                                                                                                                                                                                                                                                                                                                                                                  |
| deploy                | Puts the fixture project `fixtures/billing-sfdx` into the org, as one deploy that is taken back as a whole if Salesforce does not accept a part of it. No Apex test is run.                                                                                                                                                                                                                    |
| read                  | Takes a snapshot of the org with the engine, as `orglens snapshot` does, and prints what it holds in numbers. The snapshot asks the Dependency API, and the step prints how its rows compare with the analysis, and which pairs of the answer key they report for the files no analyser reads yet. The snapshot is written to a temporary folder of the runner and deleted when the step ends. |
| deploy and read       | Both, in this order. The org is read only if the deploy succeeded.                                                                                                                                                                                                                                                                                                                             |
| probe                 | Asks the org what Salesforce itself knows about references: the rows of the Dependency API and the symbol tables of the Apex compiler. It prints how much of the answer key of the fixture project each of the two reports, and which versions of the flows of the project the org holds. Nothing is written to the org.                                                                       |
| read and probe        | Both, in this order. The org is asked about references only if the read step did not fail.                                                                                                                                                                                                                                                                                                     |
| draft                 | Sends one flow of the fixture project once more, as a draft that differs from the version the project holds. It is meant for an org that holds the project already. Nothing but the project and this draft is ever deployed.                                                                                                                                                                   |
| draft, read and probe | All three, in this order, each only if the one before it did not fail.                                                                                                                                                                                                                                                                                                                         |

The deploy is the one thing in this repository that changes an org. It is a tool of the tests
(`packages/engine/test/live/deploy-fixture.ts`), not a part of OrgLens: OrgLens itself only reads. The deploy adds
the components of `fixtures/billing-sfdx`: custom objects with their fields and validation rules, a custom setting,
a custom metadata type with four records, fields on the standard objects Account and User, a global value set, a
custom label, a custom permission, thirteen Apex classes and one trigger, and since Phase 2 six flows, the workflow
rules of two objects, two record types, a field set and an email template with its folder. It removes nothing. To
take the fixture project out of the org again, delete those components in Setup, or start over with a new org.

The tool sends two things that are not the files of the repository as they are:

- The outbound message of the project names the user Salesforce sends it as. The file holds a made-up user name,
  which no org has. The step "deploy" writes the user it logs in as in its place, in the copy it sends. That name
  is in no file of the repository and in no log. After the deploy it is in the outbound message of the test org,
  so a snapshot of the test org holds it, in the temporary folder of the read step, which is deleted.
- The step "draft" sends the flow `Invoice_Recalculate` once more, as a draft that reads another field
  (`Paid_Date__c` where the file reads `Due_Date__c`). After it the org holds an active version of the flow and
  a newer draft, which is what the read step and the probe then report on. It is a step of its own, so that
  the org can be read before it and after it, and so that no step waits for two deploys.

What the step "draft" did on the test org, on 23 November 2026 (`docs/research/phase-2/real-org.md` has the
runs):

- **The deploy of the draft added a version and left the active version active.** The flow has version 1, which
  is active, and version 2, which is a draft.
- **A read after the step "draft" holds the draft, and not the active version.** The reference of the Metadata
  API says of the name of the file of a flow: "If you don't specify a version number, the flow is the latest
  version." The plan of Phase 2 and decision record 0057 expected the active version. That went to the
  maintainer before the analyser of flows is built, as the plan says. Since that step the answer key, which is
  about the file of the repository, does not describe that flow as the test org hands it out: it is off by the
  reference to `Paid_Date__c`.

What follows is not verified:

- **No tool takes the draft out again.** A version of a flow is deleted by hand, in Setup under **Flows**. I
  expect that a run of "deploy" after it makes the version of the project the latest one again, as a new version
  or in the place of the draft, and did not see it.
- **A flow can have 50 versions.** Whether a run of "deploy" adds a version to each of the six flows when nothing
  in them changed is not verified. The probe prints the number of versions of each flow.

The probe reads through the Tooling API (`packages/engine/test/live/probe-org.ts`). The objects it asks for
describe metadata: `MetadataComponentDependency`, which it reads with the reader of the engine
(`packages/engine/src/sources/dependency-api.ts`), `ApexClass` with its symbol table, and `CustomObject`,
`CustomField`, `ValidationRule`, `ApexTrigger`, `FlowDefinition` and `Flow` for the names behind the ids. The last
two also say which versions of a flow the org holds and which one is active. The test org answered the queries
for them as they are written on 23 November 2026. A query an org refuses is said in the log, and the step goes
on. No record of the data of the org is read. The read step asks for `MetadataComponentDependency` only: the
engine finds the components of a row by the ids the org listed them with. A symbol table with references to other classes can only be had by compiling a copy
of a class in the org, which writes to the org, so the probe does not do that.

The row of a custom object holds its name without the ending, and a custom metadata type ends in `__mdt`, not in
`__c`. So a field and a rule are asked for with the name of their object (`EntityDefinition.QualifiedApiName`).
Where the org refuses that, the probe reads without it, names every custom object with `__c`, marks the pairs
that rest on such a name as "by name", and ends with a warning. The test org accepted that in both queries on 15
November 2026 and named all 5 of its custom objects. A row of the Dependency API about a record of a custom
metadata type has the name of that type as its type, as the two probes of that day showed together. Whether its name holds the type before a dot was not seen, so the probe reads
both. Of a type it does not show, its log says whether it ends in `__mdt`.

What the steps print follows the same rule as the login step, with a wider list of what a sentence may hold
(`packages/engine/test/live/public-log.ts`):

- numbers, and codes of OrgLens, of Salesforce and of the network,
- names of metadata types (`CustomField`), of the elements of a metadata file (`trackHistory`) and of the folders
  of the source format (`classes`). They are the vocabulary of the Metadata API and the same in every org.
- names and paths of the fixture project, which this repository holds anyway,
- a problem Salesforce reports for a component of the fixture project in a deploy, if the whole text has one of
  the forms listed in `deploy-fixture.ts` and every name in it is a word of the fixture project or of the
  platform. Anything else is "not shown", and is read on the page **Deployment Status** in the Setup of the org.
- of a problem of a deploy and of a remark of Salesforce about a retrieve in a form the step does not know, and of
  what a library says about a file it cannot read: the words of a short list of everyday words
  (`everydayWords` in `public-log.ts`). Every other word, every
  number, everything in quotes or brackets and every path of a file is left out. That says what kind of message
  it is. No word comes out that is not of the list. A name that stands in a message without quotes and holds
  words of the list can leave those words behind: "Error" of a layout that is called "Error Layout".
- of a file the engine could not read as metadata: its first folder and the ending of its name, if they are
  words of the source format (`reports`, `.report-meta.xml`), and how deep it lies. Of a component the engine
  could not read: its type and how its name is built.
- from a symbol table of a class of the fixture project: the names of its fields (`externalReferences`), and a
  method or a type if every word of it is a word of the fixture project or of Apex.
- about a component that is not of the fixture project: how its name is built, with `a` in the place of every run
  of letters, digits and underscores (`a.a`, `a/a`), and whether the object or the folder it belongs to came back.

A step never prints the name of a component that is not of the fixture project, a message of Salesforce or of a
library in another form, the address or the id of the org, or the user name. On top of the forms, a line that
holds a word of the settings of the login is replaced as a whole.

The work of a step is done in a second process that has no output of its own: its standard streams lead nowhere.
The only way out of it is a channel to the first process, and only the lines of the log of the tool are sent over
it (`packages/engine/test/live/own-output.ts`). So nothing a library writes or an error says can reach the log of
the run, whichever way it is written. What is left to trust is the log of the tool itself.

No file of the org is uploaded or kept. The temporary folder of a snapshot is removed when the step ends. If the
step is killed from outside, for example by its time limit, the folder goes with the machine of the run, which
GitHub throws away.

With "deploy and read", the org is not read if the deploy failed. Start a run with "read" for that.

The step "Read the org" fails when the snapshot does not end, or when a component or a file of the fixture project
is missing in it. A real org lists components that it does not hand out, so the snapshot of the test org is
"partial" for reasons that have nothing to do with the fixture project. The step says so in a warning and does not
fail for it.

The same step shows the cross-check of the snapshot (decision record
[0045](adr/0045-the-cross-check-of-a-snapshot.md)): how many rows the Dependency API gave, how many are from a
type that is not analysed yet, how many name a component the org did not list, and how many pairs of components
the analysis has, has through a part of an object, and missed. A pair is named only if both of its components are
of the fixture project. Of the others the step gives the number. The step fails when nothing was compared, and
when the analysis missed a pair that Salesforce reports.

The test org holds fewer rows than the 2,000 at which Salesforce cuts a query off, so the engine never has to ask
in parts there. The step therefore reads the rows twice more: with one query, and just after it through a session
that shortens every answer to 30 rows and calls it ended. Every request still goes to the org as it is. The engine
then asks per type, per pair of types and per group of components, and the step says whether the parts give the
same rows as the one query just before. It fails when the parts give a row that the one query did not give, and
when the engine calls the reading in parts whole and a row is lacking. The org can change between the two
readings, so a second run tells whether a failure is one of the engine. The step ends with a warning when the
org refuses one of those queries. Whenever a request of that reading failed, the step prints the condition of
its query, with the names of the metadata types and the number of ids in the place of the ids, and how many
queries and requests had that condition. Whenever the parts lack a row or give one too many, it counts those
rows by the types of their two ends. It does not try the parts when the one query did not give every row, or when
the org holds fewer than 30 rows, and says so.

The step "Ask Salesforce about references" fails when the org answers neither the Dependency API nor the query for
the symbol tables. One query of the Dependency API gives at most 2,000 rows, so the reader of the engine asks per
type and per pair of types. Where a query is still cut off or fails, rows are missing. The step then ends with a
warning, and the number of pairs it reports is a lower bound. A pair that only the name of a field or of a rule
gives, because the org did not say which object the id belongs to, is marked "by name" and not counted.

The steps were tested against a mock org only before their first run. What the first runs showed is in
[`docs/research/phase-0/real-org.md`](research/phase-0/real-org.md).

## Keeping the org alive

Salesforce may deactivate a Developer Edition org that nobody logs in to for a long time. The workflow therefore
also runs by itself every Monday. That run logs in and does nothing else, as the maintainer decided on
2026-11-12. It also shows within a week when the key or the app has stopped working.

What follows is how GitHub documents schedules, as far as this project knows it. None of it was verified.

- A failed run on a schedule is reported to one person: according to the documentation of GitHub, the user who
  last changed the schedule in the workflow file, or the user who switched the workflow on again after it was
  switched off. The workflow file of this project was committed by an automated author, so who that person is
  here is not known. The first weekly run shows it: the page of the run names who it runs as. Until then, look at
  the page of the workflow now and then.
- If you made yourself a required reviewer of the environment, the weekly run waits for your approval like every
  other run. A run that waits may hold up the next one, because the workflow runs one at a time.
- GitHub stops the schedule of a public repository that has had no activity for 60 days. The schedule is switched
  on again on the page of the workflow under **Actions**. From then on, the notices about failed runs go to
  whoever switched it on.
- Whether a login through the API counts for Salesforce as a login was not verified. Logging in to the org yourself
  every few months is the safe addition.
- The job is skipped in a repository of another name. If this repository is renamed or moved, the name in
  `live-org.yml` has to follow, or the weekly run shows as skipped and logs in to nothing.

If the org is lost anyway, sign up for a new one and repeat this page. The fixture project is deployed again by
the same workflow: start it with the choice "deploy".

## If the key may have leaked

1. In the org, open the external client app and upload a new certificate, or delete the app. No new login is
   possible with the old key from then on.
2. End the sessions that exist already. A token that was issued before stays valid until its session ends. In
   Setup, open **Session Management**, select the sessions of the user and click **Remove**. In the external
   client app, under the OAuth usage of the app, revoke its tokens for the user.
3. Replace the secret `ORGLENS_TEST_ORG_JWT_KEY`.

Changing the password of the user does not help: a login with a key does not use the password.
