# 0053. A pre-release is published on npm under the tag next, by a workflow the maintainer approves

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (two answers of the maintainer of 2026-11-17. The first changes the answer to the sixth question
  of the Phase 1 plan and takes the place of record 0052. The second says what record 0051 means now)

## Context

A pre-release was on GitHub only, installed from two addresses into the global folder of npm
([0050](0050-the-pre-release-on-github.md)). The review of that record found the hole of such an install: a
global install keeps no address, so `npm update --global` asks the public registry for `sf-orglens` and
`@sf-orglens/engine` and installs whatever it finds there in the place of OrgLens. The project held neither
name.

The maintainer first chose to hold the names with empty packages
([0052](0052-the-project-holds-its-names-on-npm.md)). The review of that record found that the
[policy of npm on names](https://docs.npmjs.com/policies/disputes) forbids a package that only reserves a name,
so the record was never accepted and the choice went back to the maintainer, with four ways.

The maintainer answered with the workflow of another project of the maintainer's, which publishes its
pre-releases on npm: started by hand on `main`, in an environment of GitHub that waits for an approval, with
the trusted publishing of npm, under the tag `next`, and with the tag `latest` following `next` until a release
that is no pre-release. On 2026-11-17 the maintainer chose that way for OrgLens: **the pre-release itself is
published on npm.** The names are then in use, which is what the policy asks of a name.

What the pages of npm say, read on 2026-11-17
([trusted publishers](https://docs.npmjs.com/trusted-publishers)):

- With trusted publishing, npm takes a publish from one workflow file of one repository, optionally in one
  environment, on the word of the OIDC token GitHub gives a run. No token of npm is stored anywhere. It needs
  npm 11.5.1 and a machine that GitHub hosts.
- It is set up in the settings of a package. The page names no way to set it up for a package that does not
  exist yet.
- A new configuration always allows `npm stage publish`. Whether it also allows `npm publish` and `npm dist-tag`
  is ticked per configuration, and `npm dist-tag` is off unless ticked. Moving a tag this way needs npm 11.21.0.
- A new configuration "must complete its first successful publish within 2 days", or it expires.
- The repository that the `package.json` names must match the repository of the workflow.
- A public package published this way from a public repository gets a provenance attestation: a signed
  statement of which run of which workflow built it.

## Decision

**Where.** Every pre-release is published on npm: `@sf-orglens/engine` and `sf-orglens`, with the same version,
under the tag `next`. The pre-release on GitHub of record 0050 stays, with the same two files, their checksums
and the release notes. This changes the answer to the sixth question of the
[Phase 1 plan](../plans/phase-1.md#4-the-eight-questions-and-your-answers), which was that nothing goes to npm.

**How it is installed.** `npm install --global sf-orglens@<version>`. The command line names the engine by the
same exact version, so the one name is enough. `sf-orglens@next` is the newest pre-release.

**The tag `latest` follows `next` while it is a pre-release.** npm gives the version under `latest` to an
install without a tag, and `npm update --global` moves a global install to it. Left where the first publish put
it, `latest` would give the first pre-release for ever, and `npm update --global` would put it back in the place
of a newer one. Once a version without a pre-release part is under `latest`, the workflow leaves it alone.

**Who publishes.** Only the workflow `.github/workflows/pre-release.yml`, started by hand on `main` with
"publish" on. Its job "Publish on npm" runs in the environment `npm-next` of GitHub. The maintainer gives that
environment required reviewers and lets only `main` use it, so every publish waits for an approval there. The
first job of the workflow reads the environment and stops a run with "publish" on when it asks for no reviewer.
npm trusts the job through trusted publishing. The first publish cannot: the two packages do not exist, so they
have no settings. For that one run the maintainer puts a token of npm into the environment as the secret
`NPM_TOKEN`, and deletes the secret and the token afterwards. The assistant has no account on npm, never holds
a token and publishes nothing by itself. It starts a run with "publish" on only after the maintainer has said
so for that version, as before. It never approves a job in the environment and never changes the environment.

**What the job does.**

- It runs no code of the repository or of its dependencies. It takes the two files the first job packed, holds
  them against their checksums, and installs nothing but npm itself.
- It publishes the engine first, then the command line, each with `--tag next`, `--access public` and
  `--provenance`.
- A package that npm already shows under the version with the very bytes of the run is left as it is. So when
  one of the two went through and the other did not, the failed jobs of the run are run again. A version that
  npm shows with other bytes stops the job: npm never takes a version twice.
- An error that can pass (the transparency log of Sigstore, a 5xx answer of npm, the network) is tried again,
  three attempts in all. Any other error stops at once, with a sentence that says what to look at.
- Then it moves `latest` as said above. When the tag cannot be moved, the job fails and the jobs after it do
  not run. The publish is not undone by that. The summary of the job gives the command to run by hand, and the
  failed jobs are run again once the tag can be moved or was moved.

**The order of a run with "publish" on:** check and pack, try the install on three systems, publish on npm,
install from npm on the three systems, each with the npm that Node.js brings and with the newest one, and last
create the pre-release on GitHub. The page of a release is what tells people that there is one, so it comes
after an install from npm has worked.

**The rehearsal.** With "publish" off the run checks, packs and tries the install line, and publishes nothing.
The line is tried against a registry on the runner that holds the two packed files and sends every other
question on to the registry of npm. So the line is the one of the release notes, and the engine is found by its
name, as it will be after the publish.

**What the maintainer sets up** is in [`docs/releases/publishing.md`](../releases/publishing.md): the
organization `sf-orglens` on npm, the environment `npm-next`, the token for the first publish, and a trusted
publisher for each of the two packages.

**Removed with this record.** The step `names` of `scripts/pre-release.mjs` with its tests and its golden file,
and `docs/releases/npm-names.md`: nothing empty is published. The workflow "Release (dry run)": it never ran,
it rehearsed a publish to npm by another way than the one that now exists, and a run of "Pre-release" with
"publish" off is the rehearsal. A workflow for a release without a pre-release part is written when one is
planned. The workflow "Pre-release" refuses such a version.

**Choices of the author, which the maintainer can strike:**

- The name `npm-next` of the environment and that `latest` follows `next`, both taken from the workflow the
  maintainer showed.
- That the packages are published directly with `npm publish`, as in that workflow, and not staged
  (see "Staged publishing was not taken" below).
- That the job fails when `latest` cannot be moved. The workflow the maintainer showed goes on with a warning.
- That the pre-release on GitHub waits for the installs from npm.
- That the first job stops a publishing run when the environment asks for no reviewer.
- That provenance is always on, and that the files stay attached to the pre-release on GitHub.
- That the install line names the exact version and not `@next`.
- The removal of the workflow "Release (dry run)".
- The rule in [`CLAUDE.md`](../../CLAUDE.md) about what the assistant never does on npm and in the environment.
  The maintainer said that the workflow publishes with an approval. The words of the rule are the author's.

**A pre-release on npm fixes nothing.** Record [0051](0051-the-first-release-is-the-first-on-npm.md) fixes the
names, the JSON output and the exit codes with "the first release on npm", and was written when no pre-release
went there. It says that the question comes back to the maintainer before a package of OrgLens goes to npm. It
was put to the maintainer on 2026-11-17 with three answers: nothing is fixed before the first version without a
pre-release part, the names are fixed now, or everything is fixed now. The maintainer chose the first. So "the
first release" of records 0022, 0027 and 0051 is the first version of OrgLens on npm that has no pre-release
part. Until then the names of the two packages and of the command, the JSON output and the exit codes can
change from one pre-release to the next, as record 0051 says, and a pre-release that changes one of them says
so in its release notes.

## Consequences

- **The hole of record 0050 is closed for a pre-release made this way.** What `npm update --global` finds under
  the two names is what this project published, and it moves an install to the newest pre-release.
- **The names are in public use from the first pre-release, and can still change.** A later change of a name
  leaves the old packages on npm, under the account of the maintainer. Whoever installed under the old name
  gets no newer version unless the old package says where the new one is, which `npm deprecate` can do.
- **A published version stays.** npm never takes the same version twice, and by its
  [policy on unpublishing](https://docs.npmjs.com/policies/unpublish) a version can be taken back only under
  conditions. A pre-release with a defect is corrected by the next version, as record 0050 says. `npm deprecate`
  can put a warning on a version.
- **The scope `@sf-orglens` needs an organization of that name on npm**, which only the maintainer can create.
  None had the name on 2026-11-17. Whether a user account has it, the registry does not say. If the name cannot
  be had, the scope of the engine has to be chosen again before anything is published.
- **The name `orglens` is not a package of this project.** It is the name of the command. `npx orglens` on a
  machine without OrgLens fetches the package of that name from whoever has it, and the policy of npm forbids
  holding it empty. The release notes say so. Nobody had the name on 2026-11-17.
- **What the project now trusts:** the npm account of the maintainer and the organization, with their two-factor
  sign-in, and the settings of the repository on GitHub. Whoever can change the workflow on `main` and approve
  in the environment can publish. After trusted publishing works, the page of npm recommends to forbid tokens
  for the packages.
- **The environment is the only thing that holds a branch back.** A trusted publisher on npm names a
  repository, a workflow file and an environment, and no branch. The condition of the job on `main` is in the
  workflow file, and a copy of the file on another branch can leave it out. Such a copy is stopped by the
  environment alone: by its rule that only `main` may use it, and by its reviewer.
- **The approval does not tell the assistant from the maintainer.** The assistant works on GitHub through the
  account of the maintainer. A run it starts is a run of that account, and the reviewer of the environment is
  the same account, which is why "Prevent self-review" stays unticked there. Whether the access the assistant
  was given would let it approve a waiting job or change an environment was not tried, and is not to be tried.
  That it never does either is a rule of conduct, written into `CLAUDE.md`, and no barrier of GitHub. A barrier
  needs an account of its own for the assistant, which is the maintainer's to set up.
- **The token of the first publish** is a credential in a secret of an environment of GitHub, as the logins of
  the test org are. It is never in the repository, in a log or in a message. It cannot be limited to the two
  packages, which do not exist yet, and a workflow cannot type a second factor. So it is a token that can
  publish a new version of every package of the maintainer's account without a second factor, also those of
  other projects. While it exists, a run that is approved in the environment can use it. The maintainer creates
  it just before the run, with a life of one day, and deletes the secret and the token after the first publish.
- **Publishing with a token has an end.** The page of npm on access tokens says: "The ability to publish new
  package versions directly with a granular access token will be removed in January 2027." A first publish after
  that needs another way, and the one in sight is the staged publish below.
- **A trusted publisher cannot be set up long before it is used.** By the page of npm it expires when it has
  not published within two days. So the maintainer sets the two publishers up shortly before the second
  pre-release. Until then nothing can be published without a new token.
- **Provenance is public.** A package records the repository, the workflow and the run that built it, and the
  transparency log of Sigstore keeps that. `npm audit signatures` checks it. The checksums of record 0050 still
  only show a download that went wrong.
- **npm can hold a version that GitHub does not show.** The job on GitHub runs last. When a job between the
  publish and it fails, or the tag `latest` cannot be moved, the two packages are on npm and no page on GitHub
  says so. The failed jobs of the run are run again. The same holds for one package of two. The packed files of
  a run are kept for seven days. After that all jobs are run again, which packs again. The reviewer of this
  record packed twice from one commit, with a full build between, and got the same bytes both times, on one
  machine. With the same bytes a package on npm is left as it is, and with other bytes the job stops.
- **An environment that does not exist is made by GitHub without reviewers** the first time a job names it.
  Such a job does not wait. The steps say to create the environment first, and the first job of the workflow
  stops a publishing run when the environment asks for no reviewer. Whether the token of a run may read the
  environments is seen in the first rehearsal with that step.
- **Staged publishing was not taken.** `npm stage publish` puts a version in front of a maintainer, who approves
  it on npm with a second factor. Here the approval is the one of the environment on GitHub, as in the workflow
  the maintainer showed. A trusted publisher made today allows only `npm stage publish` unless `npm publish` is
  ticked, which the steps say. The pages of npm recommend the staged way for automation. It would also serve
  the first publish: by the documentation that comes with npm 12.2, `npm stage publish` creates a package that
  does not exist, with a token of any kind, so a token that can only stage would do, and no token that passes
  the second factor would be needed. That way is not built and was not tried. It is named in the steps of the
  maintainer as the other way.
- **Tried, on the machine of the author.** The install line against the stand-in registry, with npm 11.19 and
  12.2 on Linux. The publish step and the tag step of the workflow, without `--provenance`, against a registry
  on that machine that keeps what it is sent: a first publish, the same run again, a second version, `latest`
  moved, a missing `latest` set, a release under `latest` left alone, other bytes under a version refused, and
  a move of the tag refused, which fails the job. That try found one defect: npm read `release/<file>` as the
  short name of a repository on GitHub, so the step names the files with `./` in front. The second version was
  the first with another version number.
- **Tried by the reviewer,** the same way, with the npm that the job installs: every publish answered with an
  error of the server, a publish that was stored and answered with an error, the engine published and the
  command line refused and then the run again, and the answers 401, 404 and 422. Each ended as this record
  says.
- **What `latest` does was tried the same way,** with npm 11.19 and 12.2. While `latest` stays on the first
  pre-release and `next` is on the second, `npm update --global` leaves an installed first pre-release where it
  is, and the reviewer saw it put the first back in the place of an installed second. That is why the job fails
  when the tag cannot be moved. Once `latest` is moved, `npm outdated --global` names the second and
  `npm update --global` installs it.
  An install without a tag gives the version under `latest`. `npx sf-orglens@next` runs the command.
- **Not tried, and it cannot be before the first publish:** anything against the registry of npm. That is the
  OIDC token and trusted publishing, provenance, whether npm takes the repository address in the form the
  packages have it, the token, the organization, whether the registry puts `latest` on a first version that is
  published with `--tag next`, moving a tag with trusted publishing, and how long npm takes to show a new
  version, for which the install job waits and tries again. The job on npm and the jobs after it have never
  run.
- Added after the first publish, on 2026-11-17:
  [run 5 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44164088211) published version
  `0.1.0-next.0` of both packages with the token, after the maintainer approved its job. npm took the scope, the token,
  the provenance and the repository address in the form the packages have it. Asked right after the publish, npm named
  `0.0.0-stage` as the version under `latest` of both packages. The job took that for a pre-release and moved the tag to
  `0.1.0-next.0`, with the token. `0.0.0-stage` is a placeholder version npm made by itself when it received the first
  publish, which the page of npm on staged publishing names for a staged package: the maintainer read its time on npm,
  which is the time the package was created. The installs from npm found the version after about five minutes. Still not
  tried: the OIDC token and trusted publishing, and moving a tag with it.
  [`docs/releases/publishing.md`](../releases/publishing.md) has the whole of it.
- Added after the second publish, on 2026-11-17: the OIDC token, trusted publishing and moving a tag with it are tried.
  [Run 7 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44194660408) published version
  `0.1.0-next.1` of both packages without a token and moved the tag `latest` of both the same way (record
  [0054](0054-a-pre-release-without-a-change-is-published.md)). A publish that npm refuses is still not seen.
- **Read by the reviewer, and so no longer open:** a package of npm's own that is published with trusted
  publishing names its repository in the form `git+https://github.com/<owner>/<name>.git`, which is the form of
  the two packages here. The documentation of `npm trust` that comes with npm 12.2 says of a trusted publisher:
  "Package must exist".
- **Not confirmed from any page:** that npm answers "OIDC permission denied" when a publisher does not allow
  `npm publish`, and that it refuses a repository that does not match with the code E422. Two sentences of the
  job rest on them. The reviewer found the first neither on the page nor in the code of npm. Whether a job that
  is skipped makes its environment, the pages of GitHub do not say.
- The first pre-release was to go to a few colleagues by a link. On npm anybody can find and install it. The
  release notes already say what it is.
