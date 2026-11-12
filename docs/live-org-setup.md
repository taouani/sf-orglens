# Setting up the test org

OrgLens is tested against one real Salesforce org: a free Developer Edition org that holds nothing but the fixture
project. This page is the checklist for the maintainer who owns that org. It takes about 20 minutes and is done once.

At the end, four secrets exist in a protected environment of the GitHub repository. Only the workflow `live-org.yml`
reads them, and only when a maintainer starts it by hand. Nobody else, and no tool, ever holds the key.

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
    with.
13. Click **Save**.
14. Open the **Settings** tab, then **OAuth Settings**, and click **Consumer Key and Secret**. Salesforce sends a
    verification code by email. Enter it, click **Verify**, and copy the **Consumer Key**. The consumer secret is not
    needed.

A new app can take up to ten minutes before Salesforce accepts logins with it.

## 4. Store the four secrets in GitHub

The secrets live in an environment, not in the repository as a whole, so that only one workflow can read them.

1. In the repository on GitHub, open **Settings**, then **Environments**, and click **New environment**. Name it
   `live-org`.
2. Under **Deployment branches and tags**, choose **Selected branches and tags** and add the branch `main`. A
   workflow that runs from any other branch then cannot read the secrets.
3. Optional, and recommended: tick **Required reviewers** and add yourself. Every run of the workflow then waits for
   your approval.
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

Nothing can be checked before the workflow exists. Once `live-org.yml` is merged: open **Actions**, choose **Live
org**, click **Run workflow**, and approve the run if you made yourself a required reviewer. Its first step logs in
and prints only whether the login worked. It never prints the address of the org, the user name or a token.

If you have the Salesforce CLI, you can check the login on your own machine before you delete the key:

```sh
sf org login jwt --client-id <consumer key> --jwt-key-file orglens-ci.key --username <user name> --instance-url <login URL>
```

## Keeping the org alive

Salesforce may deactivate a Developer Edition org that nobody logs in to for a long time. The workflow has a weekly
run that logs in and does nothing else. If the org is lost anyway, sign up for a new one, repeat this page, and run
the workflow: it deploys the fixture again.

## If the key may have leaked

1. In the org, open the external client app and upload a new certificate, or delete the app. The old key stops
   working at once.
2. Replace the secret `ORGLENS_TEST_ORG_JWT_KEY`.
3. Change the password of the user.
