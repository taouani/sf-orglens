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
2. **The environment on GitHub.** In the repository: Settings, Environments. If `npm-next` is in the list, open
   it. If not, choose "New environment" and give it the name `npm-next`. Then:
   - Tick "Required reviewers" and add yourself.
   - Leave "Prevent self-review" unticked. I work on GitHub through your account, so a run that I start is a
     run of your account, and with the box ticked nobody could approve it.
   - Under "Deployment branches and tags" choose "Selected branches and tags" and add `main`.

   Do this before the first run with "publish" on. GitHub makes an environment that a job names and that does
   not exist, without reviewers, and such a job does not wait for you. The first job of the workflow therefore
   reads the environment and stops a run with "publish" on when it asks for no reviewer.

That is all before the rehearsal. The token comes later, just before the run that publishes.

## What the approval is, and what it is not

The reviewer of the environment and its branch rule are what stands between this repository and npm. A trusted
publisher on npm names a repository, a workflow file and an environment, and no branch. So a changed copy of
the workflow on another branch is held back by the environment alone: it lets only `main` in, and it waits for
you.

Because I work through your account, GitHub cannot tell an approval of yours from one of mine. Whether the
access I was given would let me approve a waiting job or change an environment, I have not tried and will not
try. **I never approve a job in `npm-next`, never review a waiting deployment and never change that
environment.** That is a rule I keep ([`CLAUDE.md`](../../CLAUDE.md)), not a barrier of GitHub. If you want a
barrier, GitHub must know me by another account than yours, and that is yours to set up.

## The first pre-release

1. I start the workflow on `main` with "publish" off. It checks, packs and tries the install on three systems.
   Its first job also says what it found of the environment.
2. You say that the version is to be published. The release notes must hold no mark `[open]`: the workflow
   refuses to publish notes with one.
3. **You create the token, just before the run.** A package has settings on npm only once it exists, so trusted
   publishing cannot be set up for the first publish. On npmjs.com: Access Tokens, Generate New Token, a
   granular access token, with
   - the expiration set by hand to one day, the shortest the page takes,
   - under "Packages and scopes" the permission "Read and write (publish and stage)", for "All packages": the
     two packages do not exist yet, so they cannot be selected. The other permission, "Read and write (stage
     only)", cannot publish, and npm then answers `E_STAGE_REQUIRED`,
   - "Bypass two-factor authentication" ticked. It is unticked by default, and a workflow cannot type a second
     factor.

   **Know what this token is.** While it exists, whoever has it can publish a new version of every package of
   your account, also those of your other project, without a second factor. So it lives for one run only.

4. **The secret.** In the environment `npm-next`, add the secret `NPM_TOKEN` with the token as its value. A
   secret of an environment is given only to a job that runs in it, after your approval.
5. I start the workflow with "publish" on. **This cannot be undone:** npm never takes a version twice.
6. GitHub asks you to approve the job "Publish on npm". Approve it.
7. The job publishes `@sf-orglens/engine` and then `sf-orglens`, moves the tag `latest`, and its summary says
   what it did. The jobs after it install from npm on three systems, and the last one creates the pre-release
   on GitHub.
8. If a job fails, use "Re-run failed jobs" of the same run. A package that is on npm already is then left as
   it is. The packed files of a run are kept for seven days. After that only "Re-run all jobs" works, which
   packs again. Two packs of the same commit had the same bytes when the reviewer of this page tried it on one
   machine, and with the same bytes a package on npm is left as it is. With other bytes the job stops and
   publishes nothing.
9. **Delete the secret `NPM_TOKEN`** from the environment, and delete the token on npmjs.com.
10. Look at the two packages on npmjs.com: each shows version `0.1.0-next.0` under `next` and under `latest`.
11. I open a pull request that changes `README.md` and `SECURITY.md`, which say until then that no version is
    published.

**This way has an end.** The page of npm on access tokens says: "The ability to publish new package versions
directly with a granular access token will be removed in January 2027." A first publish after that needs
another way.

**The other way, which is not built.** By the documentation that comes with npm 12.2, `npm stage publish` can
create a package that does not exist, with a token of any kind. The token would then have the permission "Read
and write (stage only)" and no bypass of the second factor: what the workflow sends waits on npmjs.com until you
approve it there with your second factor. Such a token can publish nothing by itself. The workflow would have to
be changed for it, and neither the reviewer nor I tried it. I kept the way of your other project. Say so if you
prefer this one.

## Before the second pre-release

By the page of npm, a new trusted publisher that has not published within two days expires. So set the two up
shortly before the second pre-release, not after the first.

1. On npmjs.com, in the settings of `sf-orglens`, under "Trusted publishing", add a publisher for GitHub
   Actions: the owner and the name of this repository, the workflow file `pre-release.yml` (the file name
   alone), and the environment `npm-next`. The page compares the names letter by letter, upper and lower case
   included.
2. Under "Allowed actions" tick `npm publish` and `npm dist-tag`. A new publisher allows only
   `npm stage publish` unless they are ticked.
3. Do the same in the settings of `@sf-orglens/engine`.
4. The secret `NPM_TOKEN` must be gone. npm tries trusted publishing first and falls back to a token, so a run
   that works while the secret exists proves nothing.
5. The publish then goes as steps 5 to 8 above, without a token. When it has worked, the page of npm recommends
   to require the second factor and to forbid tokens in the settings of each package.

When a publish is refused, the job says in its own words what to look at: the allowed actions of the publisher,
its fields, or the token. Two of its sentences rest on texts I could not confirm. That npm answers "OIDC
permission denied" when `npm publish` is not ticked is from my reading of its page, and the reviewer found the
words neither on the page nor in the code of npm. That a repository that does not match is refused with the
code E422 is not on the page either. npm writes why it did not accept the identity of a workflow only at a
log level the job does not use, so the log may show no more than the code ENEEDAUTH.

## What the workflow does with the tags

Every pre-release is published under `next`. The job then moves `latest` to the new version, as long as the
version under `latest` is a pre-release or there is none: `npm install` and `npm update --global` without a tag
follow `latest`. A version without a pre-release part under `latest` is left alone.

When the tag cannot be moved, the two packages are published and the job fails. The jobs after it do not run,
so there is no pre-release on GitHub yet. That is on purpose: while `latest` stays on an older pre-release,
`npm update --global` puts the older one back in the place of the new one. The summary of the job says for
which package the tag is missing. Tick `npm dist-tag` in its trusted publisher, or move the tag by hand after
`npm login`:

```sh
npm dist-tag add sf-orglens@<version> latest
npm dist-tag add @sf-orglens/engine@<version> latest
```

Then use "Re-run failed jobs". The job leaves what is published as it is, finds the tag in place or moves it,
and the run goes on.

## Not known

- Whether npm takes the address of the repository of our packages, `git+https://github.com/taouani/sf-orglens.git`.
  The page says that it "must exactly match" the repository and gives no example. The reviewer found a package
  of npm's own that is published with trusted publishing and names its repository in the same form, so I expect
  it to pass. It is not tried with ours.
- Whether the registry puts `latest` on the first version of a package that is published with `--tag next`.
  The job handles both.
- Whether an account named `sf-orglens` exists on npm, which would keep the organization from being made.
- Whether npm refuses the name `sf-orglens` as too near to a name that exists. That would show only after the
  engine is public.
- Whether a job that is skipped makes its environment. The pages of GitHub do not say. A rehearsal skips the
  job, so look for `npm-next` in the list before you make it.
- How long npm takes to show a new version to an install. The install jobs try five times, with up to two
  minutes between two tries.
