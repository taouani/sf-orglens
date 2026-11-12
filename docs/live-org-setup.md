# Setting up the test org

OrgLens is tested against one real Salesforce org: a free Developer Edition org that holds nothing but the fixture
project. This page is the checklist for the maintainer who owns that org. It takes about 20 minutes and is done once.

At the end, four secrets exist in a protected environment of the GitHub repository. Only the workflow `live-org.yml`
reads them: when a maintainer starts it by hand, and once a week by itself, to log in and do nothing else. Nobody
else, and no tool, ever holds the key.

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
the same workflow, once that part of it is built.

## If the key may have leaked

1. In the org, open the external client app and upload a new certificate, or delete the app. No new login is
   possible with the old key from then on.
2. End the sessions that exist already. A token that was issued before stays valid until its session ends. In
   Setup, open **Session Management**, select the sessions of the user and click **Remove**. In the external
   client app, under the OAuth usage of the app, revoke its tokens for the user.
3. Replace the secret `ORGLENS_TEST_ORG_JWT_KEY`.

Changing the password of the user does not help: a login with a key does not use the password.
