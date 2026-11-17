# How a pre-release gets to npm

A pre-release of OrgLens is published by the workflow "Pre-release": the two packages on npm under the tag
`next`, and a pre-release on GitHub with the same files (decision records
[0050](../adr/0050-the-pre-release-on-github.md) and [0053](../adr/0053-a-pre-release-is-published-on-npm.md)).
This page has what only the maintainer can do: what is set up once, and what happens at each pre-release. "You"
is the maintainer, and "I" the AI assistant that wrote the page.

I have no account on npm and never hold a token. **Do not send me a token, a code or a password, and do not put
one into the repository, a pull request or an issue.**

**Nothing here was tried by me against npm or against the settings of GitHub.** The steps follow the pages of
npm as I read them on 17 November 2026 and the workflow of your other project. Where a page of npm or GitHub
reads differently today, the page is right.

## Once, before the first pre-release

1. **The organization on npm.** Sign in on npmjs.com and create the organization `sf-orglens`, with the free
   plan for public packages. The engine is published as `@sf-orglens/engine`, and npm takes a package with that
   scope only from the user or the organization of that name. No organization had the name on 17 November 2026.
   If npm refuses the name, stop and tell me: the scope of the engine has to be chosen again, which changes a
   package name.
2. **The environment on GitHub.** In the repository: Settings, Environments, New environment, with the name
   `npm-next`. Add yourself under "Required reviewers". Under "Deployment branches and tags" choose "Selected
   branches and tags" and add `main`. Create it before the first run: GitHub makes an environment that a job
   names and that does not exist, without reviewers, and such a job does not wait for you.
3. **A token for the first publish.** A package has settings on npm only once it exists, so trusted publishing
   cannot be set up for the first publish. On npmjs.com create a granular access token that can read and write
   packages, with the shortest life the page offers. The two packages do not exist yet, so the token cannot be
   limited to them. A workflow cannot type a second factor, so the token must be allowed to publish without one.
   This is the way your other project made its first publish.
4. **The secret.** In the environment `npm-next`, add the secret `NPM_TOKEN` with the token as its value. A
   secret of an environment is given only to a job that runs in it, after your approval.

## The first pre-release

1. I start the workflow on `main` with "publish" off. It checks, packs and tries the install on three systems.
2. You say that the version is to be published. I start the workflow with "publish" on. **This cannot be
   undone:** npm never takes a version twice.
3. GitHub asks you to approve the job "Publish on npm". Approve it.
4. The job publishes `@sf-orglens/engine` and then `sf-orglens`, and its summary says what it did. The jobs
   after it create the pre-release on GitHub and install from npm on three systems.
5. If a job fails, use "Re-run failed jobs" of the same run, not a new run. A package that is on npm already
   is then left as it is.
6. **Delete the secret `NPM_TOKEN`** from the environment, and delete the token on npmjs.com.
7. Look at the two packages on npmjs.com: each shows version `0.1.0-next.0` under `next` and under `latest`. If
   `latest` is missing, the summary of the job says so and gives the command.

## Before the second pre-release

By the page of npm, a new trusted publisher that has not published within two days expires. So set the two up
shortly before the second pre-release, not after the first.

1. On npmjs.com, in the settings of `sf-orglens`, under "Trusted publishing", add a publisher for GitHub
   Actions: the owner and the name of this repository, the workflow file `pre-release.yml` (the file name
   alone), and the environment `npm-next`.
2. Under "Allowed actions" tick `npm publish` and `npm dist-tag`. A new publisher allows only
   `npm stage publish` unless they are ticked.
3. Do the same in the settings of `@sf-orglens/engine`.
4. The secret `NPM_TOKEN` must be gone. npm tries trusted publishing first and falls back to a token, so a run
   that works while the secret exists proves nothing.
5. The publish then goes as steps 1 to 5 above. When it has worked, the page of npm recommends to require the
   second factor and to forbid tokens in the settings of each package.

If npm answers "OIDC permission denied", the publisher is known and `npm publish` is not ticked. If it answers
with the code E401, E403, E404 or ENEEDAUTH, a field of the publisher does not match, or the publisher expired.
The job says both in its own words.

## What the workflow does with the tags

Every pre-release is published under `next`. The job then moves `latest` to the new version, as long as the
version under `latest` is a pre-release or there is none: `npm install` and `npm update --global` without a tag
follow `latest`. A version without a pre-release part under `latest` is left alone. When the tag cannot be
moved, the job stays green, and its summary gives the command to run after `npm login`:

```sh
npm dist-tag add sf-orglens@<version> latest
npm dist-tag add @sf-orglens/engine@<version> latest
```

## Not known

- Whether npm takes the address of the repository in the form the packages name it,
  `git+https://github.com/taouani/sf-orglens.git`. The page says that it "must exactly match" the repository and
  gives no example. It is the form `npm pkg fix` writes. If npm refuses it, the publish fails with the code
  E422 before anything is public, and the address is changed in a pull request.
- Whether the registry puts `latest` on the first version of a package that is published with `--tag next`.
  The job handles both.
- Whether an account named `sf-orglens` exists on npm, which would keep the organization from being made.
- How long npm takes to show a new version to an install. The install jobs try five times, with up to two
  minutes between two tries.
