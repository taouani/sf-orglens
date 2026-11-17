# 0054. A second pre-release without a change is published, to try trusted publishing

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (an answer of the maintainer of 2026-11-17, after the first publish)

## Context

The first pre-release, `0.1.0-next.0`, was published on npm on 2026-11-17 with a token of the maintainer
([0053](0053-a-pre-release-is-published-on-npm.md)). Every pre-release after it is to be published without a
token, through the trusted publishing of npm. That record lists trusted publishing, and moving a tag with it, as
not tried. [`docs/releases/publishing.md`](../releases/publishing.md#not-known) names what is not known:
whether npm accepts the identity of the workflow, whether the address of the repository passes there too, and
whether the job can move a tag that way. On the last point two pages of npm disagree.

The draft of the [Phase 2 plan](../plans/phase-2.md) put the second pre-release at the close of that phase, and
record 0053 says that the maintainer sets up the two trusted publishers shortly before it, because npm lets a
new one expire when no version is published through it within two days.

The maintainer set the two up on the day of the first publish, half an hour after it. npm shows each as
"Pending validation" and asks for a publish through it before 2026-11-19, 20:56 UTC for `sf-orglens` and 21:00
UTC for `@sf-orglens/engine`. The maintainer said
on the same day that the token of the first publish and its secret are deleted. Phase 2 is not approved, and
nothing of it is built.

The author put the choice to the maintainer on 2026-11-17, with two ways: a version without a change is
published within the two days, or the publishers expire, the maintainer sets them up again before the
pre-release of Phase 2, and trusted publishing stays untried until then. The author recommended the first: a
fault that shows with a version that changes nothing costs less than one that shows at the close of a phase.

## Decision

**The maintainer chose the first way on 2026-11-17: version `0.1.0-next.1` is published within the two days,
and it changes nothing in what OrgLens does.**

- **What the version holds.** The code of both packages as in `0.1.0-next.0`. New are the version the packages
  name and a section in each change log. Its [release notes](../releases/v0.1.0-next.1.md) say in their first
  paragraph that nothing has changed and why the version exists.
- **How it is made.** As every pre-release (records [0050](0050-the-pre-release-on-github.md) and 0053): a
  changeset, the version set in a pull request, a run of the workflow "Pre-release" on `main` with "publish"
  off, and then a run with "publish" on, whose job waits for the maintainer's approval in the environment
  `npm-next`. The choice of this record is not the word for that run: the run that publishes is started only
  after the maintainer has said so for this version, as record 0053 says.
- **This record decides this one version.** It makes no rule for other pre-releases between two phases.

**Choices of the author, which the maintainer can strike:**

- That the version has no test plan and no report of its own, since it closes no phase. What its run shows of
  trusted publishing is written into [`docs/releases/publishing.md`](../releases/publishing.md), as after the
  first publish.
- That the job which publishes gives npm no token any more and does not read the secret of the first publish.
  npm tries trusted publishing first and falls back to a token, so a run with a token would say nothing about
  trusted publishing. Record 0053 has the token for the first publish only. A package that is not on npm yet
  cannot be published by the workflow as it is.
- That the version is a pre-release like every other, with release notes, a page on GitHub and the two files
  attached. The workflow knows no other kind, and was not changed for this version.
- That the tag `latest` moves to it, as for every pre-release. `npm update --global` then moves an install of
  `0.1.0-next.0` to a version that changes nothing.

## Consequences

- **When it works,** the way every later pre-release takes has run once, and the two publishers stay. The page
  of npm then recommends to require the second factor and to forbid tokens in the settings of each package,
  which is the maintainer's to set.
- **The pre-release at the close of Phase 2 takes the next number that is free then.** The draft of the Phase 2
  plan named `0.1.0-next.1` for it and is changed.
- **When npm refuses the publish of the engine,** nothing is on npm under the version. The job says what to
  look at, and shows what the log file of npm says about the identity of the workflow. The failed jobs of the
  run are run again once the cause is found, and the job waits for the maintainer's approval again. A cause in
  the workflow is corrected in a pull request, and the version can still be published by a later run, on the
  maintainer's word.
- **When npm takes the engine and refuses the command line,** the engine is on npm under the tag `next`, and
  the command line is not. Each package has a trusted publisher of its own, and the job publishes the engine
  first and stops at the first refusal. The tag `latest` is not touched then, and `sf-orglens@next` is still
  the first pre-release, which names its own engine. Once the cause is found, the failed jobs of the run are
  run again: the engine is left as it is and the command line is published, as record 0053 says for one
  package of two. The reviewer of this record saw both on a registry on the reviewer's machine.
- **When the publish goes through and the tag cannot be moved,** the two packages are on npm and the job fails,
  as record 0053 decided. The maintainer moves the tags by hand, and the failed jobs are run again.
  [`docs/releases/publishing.md`](../releases/publishing.md#what-the-workflow-does-with-the-tags) has the
  commands.
- **When the two days pass without a publish,** the publishers expire. By the page of npm an expired one "can
  no longer be used or edited": the maintainer deletes it and makes a new one before the next try. Whether the
  version is then still published, or waits for the close of Phase 2, is not decided here.
- **A version that changes nothing is public and stays.** Whoever updates gets the same OrgLens under a new
  number. One thing follows from the number alone: a snapshot of an org that was interrupted under
  `0.1.0-next.0` is not continued by `0.1.0-next.1`. It is given up, and a new one is begun. The release notes
  say both.
- **npm never takes a version twice.** A try that fails after npm took a package under the version with other
  bytes than a later run packs needs the next number.
- **The changeset of this version is the sixteenth that is kept** in `.changeset/pre`. When the pre-release
  mode is left, changesets writes all of them into the section of the first version without a pre-release part,
  this one among them.
- **Not tried before the run:** everything this version is published to try. A rehearsal with "publish" off
  asks npm for no identity and moves no tag. The steps of the workflow that were changed after the first
  publish have run only against a registry on the machine of the author and of the reviewers: the wait when npm
  says that a version exists, the step that reads the tags before the page on GitHub is created, and what the
  job shows when npm refuses an identity.
- Added after the publish, on 2026-11-17: **it worked.** The maintainer gave the word for the version and
  approved the job, and [run 7 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44194660408)
  published both packages without a token, each with its provenance, and moved the tag `latest` of both the
  same way, two hours after the publishers were made. The six installs from npm passed, and the pre-release on
  GitHub was created seven minutes after the packages were on npm. So npm accepts the identity of the workflow
  for a publish and for the move of a tag. No publish was refused, so what the job says and shows in that case
  has still run against a stand-in only. The author did not look at npm: whether the two publishers still show
  "Pending validation" is the maintainer's to look at.
  [`docs/releases/publishing.md`](../releases/publishing.md#what-the-second-publish-showed) has what the run
  showed.
