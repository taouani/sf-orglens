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
**The second, `0.1.0-next.1`, was published on the same day without a token,** through the trusted publishing of npm
([run 7](https://github.com/taouani/sf-orglens/actions/runs/44194660408)). It changes nothing in what OrgLens does and
was the first try of trusted publishing (decision record
[0054](../adr/0054-a-pre-release-without-a-change-is-published.md)).
[What the first publish showed](#what-the-first-publish-showed) and
[what the second publish showed](#what-the-second-publish-showed) are at the end of this page. The steps follow the
pages of npm as I read them on 17 November 2026 and the workflow of your other project. Where a page of npm or GitHub
reads differently today, the page is right.

**For the next pre-release** nothing should have to be set up, as long as the two trusted publishers and the environment
stay as they are: I prepare the version in a pull request and rehearse it, you give your word for that version, I start
the run, and you approve its job "Publish on npm". Those are steps 1, 2 and 5 to 8 of
[the first pre-release](#the-first-pre-release) below. That nothing has to be set up rests on the page of npm, which
says that the first publish through a publisher validates it. Nobody has looked yet whether the two publishers left
"Pending validation".

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

These steps were done once, for `0.1.0-next.0`, all eleven: you said on 17 November 2026 that the token and the secret
are deleted, you looked at the two packages, and step 11 is the pull request that added this sentence. Steps 1, 2 and 5
to 8 are the steps of every pre-release, with the number of that version. Steps 3, 4 and 9 are about the token. They
would be needed again only for a package that is not on npm yet, and npm takes this way away in January 2027. The
workflow no longer reads the secret: since the first publish its job gives npm no token, so that a run cannot pass with
a token where trusted publishing was to be tried. For a new package the workflow would have to be changed back, or
changed for the other way below.

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

These steps are done, and the publish of step 5 went through on 17 November 2026. They stay here for a
publisher that has to be made anew, and for a package that is added later.

By the [page of npm](https://docs.npmjs.com/trusted-publishers), a new trusted publisher "must complete its
first successful publish within 2 days". After that "it expires and can no longer be used or edited", and the
page says to delete it and to create a new one. So a publisher is set up shortly before the publish that uses
it.

You set the two up on 17 November 2026, half an hour after the first publish. The page of each package showed
the publisher with the permissions `npm publish`, `npm stage publish` and `npm dist-tag`, and the status
"Pending validation". npm asked for a publish through it before 19 November 2026, 20:56 UTC for `sf-orglens`
and 21:00 UTC for `@sf-orglens/engine`. You chose on the same day to publish a second pre-release,
`0.1.0-next.1`, within that time, to try the way without a token (decision record
[0054](../adr/0054-a-pre-release-without-a-change-is-published.md)). It was published two hours after the
publishers were made.

1. On npmjs.com, in the settings of `sf-orglens`, under "Trusted publishing", add a publisher for GitHub
   Actions: the owner and the name of this repository, the workflow file `pre-release.yml` (the file name
   alone), and the environment `npm-next`. The page compares the names letter by letter, upper and lower case
   included.
2. Under "Allowed actions" tick `npm publish` and `npm dist-tag`. A new publisher allows only
   `npm stage publish` unless they are ticked.
3. Do the same in the settings of `@sf-orglens/engine`.
4. The secret `NPM_TOKEN` must be gone. By the page of npm, npm uses trusted publishing "before falling back
   to traditional tokens", so a run that works with a token proves nothing. The job no longer reads the secret
   and gives npm an empty token. A secret that is still there, or that is put back, is therefore not used.
5. The publish then goes as steps 5 to 8 above, without a token. The job then also moves the tag `latest`
   through the trusted publisher, which the first publish did with the token. When it has worked, the page of
   npm recommends to require the second factor and to forbid tokens in the settings of each package.

When a publish is refused, the job says in its own words what to look at: the allowed actions of the publisher
or its fields. No publish through a trusted publisher has been refused so far, so none of these sentences has
been seen in a run. Two of them rest on texts I could not confirm. That npm answers "OIDC permission
denied" when `npm publish` is not ticked is from my reading of its page, and the reviewer found the words
neither on the page nor in the code of npm. That a repository that does not match is refused with the code
E422 is not on the page either. npm writes why it did not accept the identity of a workflow only to its log
file, and its error may show no more than the code ENEEDAUTH. So the job shows the lines of that file that
speak of the identity, with anything in the form of a token taken out. A reviewer saw such a line on a
registry on the reviewer's machine: "Failed token exchange request with body message", followed by the words
of the registry.

Each package has a trusted publisher of its own, and the job publishes the engine first. When npm takes the
engine and refuses the command line, the engine is on npm under `next` and the command line is not. Nothing
is broken by that: `sf-orglens@next` is still the pre-release before, which names its own engine. Correct the
publisher of `sf-orglens` and use "Re-run failed jobs". The job asks for your approval again, leaves the
engine as it is and publishes the command line. A reviewer found that `npm publish --dry-run` asks npm for
the identity and sends no package, so a dry run of both files could stop the job before the engine is sent.
That is not built: it was seen on a stand-in only, and the state it would avoid is repaired by a re-run.

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

Before the pre-release on GitHub is created, the last job reads the tags of both packages once more. After
each move of a tag npm printed in the first publish: "This change is being processed and may take a few
minutes to take effect." So a read that is not right yet is repeated, five looks a minute apart. When the tags
are still not right, the job fails. Use "Re-run failed jobs" first, which looks again, and move a tag by hand
only when it is still wrong then.

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
  that creates the pre-release on GitHub did not run. Fifteen minutes was also the limit of that job, and I did
  not know whether the limit ended it or GitHub did. The limit is twenty minutes now. "Re-run failed jobs" ran
  the install, which passed, and the pre-release on GitHub was created eighteen minutes after the two packages
  were on npm. The job on npm did not run a second time.

  Fifty minutes later the same happened to the three macOS jobs of a run of the workflow "CI": each was
  cancelled fifteen minutes to the second after it was queued, without a machine, and two of them have a limit
  of twenty minutes. So the limit of a job did not end them, and the longer limit of the install jobs does not
  help against a wait for a machine. What helped both times is "Re-run failed jobs", after which the jobs got a
  machine within seconds to minutes. A publishing run can meet this at any macOS job. Before the publish it
  costs a re-run and time: in the run that published, the two macOS jobs that try the install line waited five
  and ten minutes for a machine. After the publish it leaves the packages on npm without a page on GitHub until
  the re-run. A run that publishes is therefore started with hours to spare before a limit of npm, not minutes.

- **A read does not see a new version for minutes, which the publish step did not expect.** It asks npm for
  the version before it publishes and after an error. Had a publish gone through and been answered with an
  error, or had the failed jobs been run again within those minutes, the step would have tried to publish
  again, npm would have refused, and the step would have named the wrong cause. The step now waits when npm
  says that the version exists: I tried it against a registry on my machine that hides a new version for a
  while. It rests on the words "cannot publish over" in the answer of npm, which I know from npm and did not
  see in this run.

## What the second publish showed

[Run 7 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44194660408) published `0.1.0-next.1` on 17
November 2026, from `main`, after you gave your word for the version and approved its job. It went through on its first
attempt, in seventeen minutes, of which five were the wait for your approval. I read its log. I did not look at npm. The
date and the times are in UTC.

- **npm took both packages without a token.** The log of the step that publishes and of the step that moves the tag
  shows the token of the job empty. npm took `@sf-orglens/engine` at 23:05:09 and `sf-orglens` at 23:05:18, each with
  its provenance, signed and written to the public log of Sigstore. So npm accepts the identity of this workflow in the
  environment `npm-next`, for a publisher that showed "Pending validation" two hours before, and the address of the
  repository as the packages name it passes there too.
- **The job moved the tag `latest` the same way,** for both packages, from `0.1.0-next.0` to `0.1.0-next.1`. Two pages
  of npm disagreed on this: the page on trusted publishers has the allowed action `npm dist-tag`, and the page of the
  command `npm stage` says that such a token "can only be used with `npm stage publish` and `npm publish`". The first is
  right: a workflow whose publisher allows `npm dist-tag` can move a tag without a token. With the bullet above, that
  answers the three things this page listed as not known before the run and that decision record 0054 names: whether npm
  accepts the identity of the workflow, whether the address of the repository passes, and whether the job can move a
  tag.
- **npm still printed its warning about tokens that bypass the second factor,** at each publish and at each
  move of a tag, although the job had no token. The warning says nothing about this job.
- **An install found the version between three and a half and five and a half minutes after the publish.** On Linux the
  fourth try failed 3 minutes and 20 seconds after the publish of the command line, and the fifth passed two minutes
  later. On Windows it was the fifth try as well. At the first publish the fourth try failed and the fifth passed too,
  with the same waits, so this second version of a package that exists took about as long as the first. The two tries
  are two minutes apart, and the runs cannot say more exactly than that. Five tries were all the jobs had at the first
  publish. They have eight now and used five.
- **The tags were right at the first look,** seven minutes after they were moved. The four further looks of
  that step have not run on GitHub.
- **Every job got a machine within seconds,** the macOS jobs too. The pre-release on GitHub was created seven
  minutes after the two packages were on npm.
- **Not seen in this run:** a publish that npm refuses, what the job then shows of the log file of npm, a tag
  that cannot be moved, and a version that npm says exists and does not show. Those parts of the workflow have
  run against stand-in registries only, on my machine and on the reviewers'.
- **Not seen by me:** the pages of npm. Whether the two publishers still show "Pending validation" is for you
  to look at. The page of npm recommends, once trusted publishing works, to require the second factor and to
  forbid tokens in the settings of each package ("Require two-factor authentication and disallow tokens").
  That is yours to set, and the workflow needs no token any more.

## Not known

- What npm answers when it refuses a workflow: which code and which words. The sentences of the job for that
  case rest on the pages of npm and on stand-in registries.
- What the version `0.0.0-stage` holds, whether npm makes one for every new package or only for one that is
  published with such a token, and whether it can be removed. The job moves `latest` whether a first version
  has it or not.
- How long npm takes to show a new version to an install on another day. It was seen twice, on one evening:
  both times the fourth try of an install failed, up to four minutes after the publish, and the fifth passed,
  five and a half minutes after it.
- Staged publishing, the other way for a first publish. Nobody tried it.
