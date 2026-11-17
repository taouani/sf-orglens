# How a pre-release gets to npm

A pre-release of OrgLens is published by the workflow "Pre-release": the two packages on npm under the tag
`next`, and a pre-release on GitHub with the same files (decision records
[0050](../adr/0050-the-pre-release-on-github.md) and [0053](../adr/0053-a-pre-release-is-published-on-npm.md)).
This page has what only the maintainer can do: what is set up once, and what happens at each pre-release. "You"
is the maintainer, and "I" the AI assistant that wrote the page.

I have no account on npm and never hold a token. **Do not send me a token, a code or a password, and do not put
one into the repository, a pull request or an issue.**

**The first pre-release, `0.1.0-next.0`, was published this way on 17 November 2026,** with a token
([run 5 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44164088211)).
[What the first publish showed](#what-the-first-publish-showed) is at the end of this page. The steps before the second
pre-release, with trusted publishing, have been tried by nobody. They follow the pages of npm as I read them on 17
November 2026 and the workflow of your other project. Where a page of npm or GitHub reads differently today, the page is
right.

## Once, before the first pre-release

Both steps are done. They stay here for what the environment must keep.

1. **The organization on npm.** Sign in on npmjs.com and create the organization `sf-orglens`, with the free
   plan for public packages. The engine is published as `@sf-orglens/engine`, and npm takes a package with that
   scope only from the user or the organization of that name. No organization had the name before you made it.
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

These steps were done once, for `0.1.0-next.0`, all eleven: you said on 17 November 2026 that the token and
the secret are deleted, you looked at the two packages, and step 11 is the pull request that added this
sentence. They are needed again only for a package that is not on npm yet, and npm takes this way away in
January 2027.

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
   publishes nothing. npm shows a new version to a read only minutes after its publish. When npm says that a
   version exists which it does not show yet, the job looks once a minute, ten times, before it gives up.
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
prefer this one. It leaves the same placeholder version `0.0.0-stage` that the first publish left, by the
[page of npm on staged publishing](https://docs.npmjs.com/staged-publishing/).

## Before the second pre-release

By the page of npm, a new trusted publisher that has not published within two days expires. So set the two up
shortly before the second pre-release, not after the first.

You set the two up on 17 November 2026, half an hour after the first publish. The page of each package shows
the publisher with the permissions `npm publish`, `npm stage publish` and `npm dist-tag`, and the status
"Pending validation": npm asks for a publish through it before 19 November 2026, about 21:00 UTC. You chose on
the same day to publish a second pre-release, `0.1.0-next.1`, within that time, to try the way without a
token. Steps 1 to 3 below are done.

1. On npmjs.com, in the settings of `sf-orglens`, under "Trusted publishing", add a publisher for GitHub
   Actions: the owner and the name of this repository, the workflow file `pre-release.yml` (the file name
   alone), and the environment `npm-next`. The page compares the names letter by letter, upper and lower case
   included.
2. Under "Allowed actions" tick `npm publish` and `npm dist-tag`. A new publisher allows only
   `npm stage publish` unless they are ticked.
3. Do the same in the settings of `@sf-orglens/engine`.
4. The secret `NPM_TOKEN` must be gone. npm tries trusted publishing first and falls back to a token, so a run
   that works while the secret exists proves nothing.
5. The publish then goes as steps 5 to 8 above, without a token. The job then also moves the tag `latest`
   through the trusted publisher, which the first publish did with the token. When it has worked, the page of
   npm recommends to require the second factor and to forbid tokens in the settings of each package.

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

## What the first publish showed

[Run 5 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44164088211) published `0.1.0-next.0` on 17
November 2026, from `main`, after you approved its job. I read its log. I did not look at npm: what is said here of the
pages of npm and of the times npm gives is what you saw and sent me on the same day.

- **npm took both packages with the token,** `@sf-orglens/engine` first and `sf-orglens` after it, each with
  its provenance, which was signed and written to the public log of Sigstore. npm took the scope, the name
  `sf-orglens` and the address of the repository as the packages name it,
  `git+https://github.com/taouani/sf-orglens.git`.
- **npm warned about the token** at every use of it: "npm tokens that bypass 2FA are being restricted for
  account changes and direct publishing." That is the end this page names above.
- **npm made a version `0.0.0-stage` of each package, by itself.** The page of each package lists two versions,
  `0.0.0-stage` and `0.1.0-next.0`, both with the status "Published", and only `0.1.0-next.0` has the mark of a
  provenance. `npm view sf-orglens time` gives 20:22:42.327 UTC for `0.0.0-stage`, which is to the millisecond the time
  the package was created and the second in which `npm publish` of the workflow came back, and 20:24:50.715 UTC for
  `0.1.0-next.0`. The workflow sent one publish per package, and no other run of the repository had the token. So npm
  creates a new package with that version when it receives the first publish, and has the real version ready two minutes
  later. `0.0.0-stage` is not a version of OrgLens. The
  [page of npm on staged publishing](https://docs.npmjs.com/staged-publishing/), last edited on 10 November 2026, names
  it: "When you stage a package that does not yet exist, npm publishes a placeholder version of the package with the
  version `0.0.0-stage`", and "This placeholder version is publicly available". The page speaks of `npm stage publish`.
  The workflow used `npm publish`, and no page I read says that a direct first publish gets the placeholder too. What it
  holds, whether npm still needs it and whether it can be removed, the page does not say. I recommended to leave it
  alone.
- **The tag `latest` was on `0.0.0-stage`, not on the new version.** Asked right after the publish, npm named
  `0.0.0-stage` as the version under `latest` of both packages. The job took that for a pre-release and moved
  `latest` to `0.1.0-next.0`, with the token. Without that step an install without a tag would have got the
  placeholder. You read the tags on the pages half an hour later: `next` and `latest` are on `0.1.0-next.0` for
  both packages. The installs of the run name the version, so they did not show it. The run now reads the tags
  once more before it creates the pre-release on GitHub, and fails when one is not on the version.
- **An install found the version between four and five and a half minutes after the publish,** two to three
  minutes after npm had it ready. The install jobs on Linux and Windows passed with their fifth try, which was
  their last. They now try eight times and wait eleven minutes in all.
- **One install job on macOS waited fifteen minutes for a machine of GitHub and was cancelled,** so the job
  that creates the pre-release on GitHub did not run. Fifteen minutes was also the limit of that job, and I do
  not know whether the limit ended it or GitHub did. The limit is twenty minutes now. "Re-run failed jobs" ran
  the install, which passed, and the pre-release on GitHub was created eighteen minutes after the two packages
  were on npm. The job on npm did not run a second time.
- **A read does not see a new version for minutes, which the publish step did not expect.** It asks npm for
  the version before it publishes and after an error. Had a publish gone through and been answered with an
  error, or had the failed jobs been run again within those minutes, the step would have tried to publish
  again, npm would have refused, and the step would have named the wrong cause. The step now waits when npm
  says that the version exists: I tried it against a registry on my machine that hides a new version for a
  while. It rests on the words "cannot publish over" in the answer of npm, which I know from npm and did not
  see in this run.

## Not known

- Anything of trusted publishing: whether npm accepts the identity of the workflow, whether the address of the
  repository passes there too, and whether the job can move a tag that way. The page says that the repository
  "must exactly match" and gives no example. The reviewer found a package of npm's own that is published with
  trusted publishing and names its repository in the same form, so I expect it to pass. On moving a tag two
  pages of npm disagree: the page on trusted publishers has the allowed action `npm dist-tag`, and the page of
  the command `npm stage` says that such a token "can only be used with `npm stage publish` and `npm publish`".
  The workflow follows the first, and the steps by hand are above.
- What the version `0.0.0-stage` holds, whether npm makes one for every new package or only for one that is
  published with such a token, and whether it can be removed. The job moves `latest` whether a first version
  has it or not.
- How long npm takes to show a new version to an install on another day, and whether a second version of a
  package that exists takes as long as the first. It was seen once.
- Staged publishing, the other way for a first publish. Nobody tried it.
