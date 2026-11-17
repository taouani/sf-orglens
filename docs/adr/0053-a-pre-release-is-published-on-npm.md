# 0053. A pre-release is published on npm under the tag next, by a workflow the maintainer approves

- Status: Accepted
- Date: 2026-11-17
- Decisions: none (an answer of the maintainer of 2026-11-17, which changes the answer to the sixth question of the
  Phase 1 plan and takes the place of record 0052)

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
environment required reviewers, so every publish waits for an approval there. npm trusts the job through
trusted publishing. The first publish cannot: the two packages do not exist, so they have no settings. For that
one run the maintainer puts a token of npm into the environment as the secret `NPM_TOKEN`, and deletes the
secret and the token afterwards. The assistant has no account on npm, never holds a token and publishes nothing
by itself. It starts a run with "publish" on only after the maintainer has said so for that version, as before.

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
- Then it moves `latest` as said above. When the tag cannot be moved, the job stays green and its summary gives
  the command to run by hand.

**The order of a run with "publish" on:** check and pack, try the install on three systems, publish on npm,
create the pre-release on GitHub, and install from npm on the three systems, each with the npm that Node.js
brings and with the newest one.

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

**Choices of the author, which the maintainer can strike:** the name `npm-next` of the environment and that
`latest` follows `next`, both taken from the workflow the maintainer showed; that provenance is always on; that
the files stay attached to the pre-release on GitHub; that the install line names the exact version and not
`@next`; and the removal of the workflow "Release (dry run)".

**Not decided here: what a pre-release on npm fixes.** Record
[0051](0051-the-first-release-is-the-first-on-npm.md) fixes the names, the JSON output and the exit codes with
"the first release on npm", and was written when no pre-release went there. It says that the question comes
back to the maintainer before a package of OrgLens goes to npm. It was put to the maintainer on 2026-11-17 with
three answers: nothing is fixed before the first version without a pre-release part, which the author
recommends, the names are fixed now, or everything is fixed now. The release notes of the first pre-release
hold the mark `[open]` at that point, and the workflow publishes no notes with the mark.

## Consequences

- **The hole of record 0050 is closed for a pre-release made this way.** What `npm update --global` finds under
  the two names is what this project published, and it moves an install to the newest pre-release.
- **The names are in public use from the first pre-release.** A later change of a name leaves the old packages
  on npm. That is what the open question above is about.
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
- **The token of the first publish** is a credential in a secret of an environment of GitHub, as the logins of
  the test org are. It is never in the repository, in a log or in a message. While it exists, a run that is
  approved in the environment can use it. The maintainer deletes the secret and the token after the first
  publish.
- **A trusted publisher cannot be set up long before it is used.** By the page of npm it expires when it has
  not published within two days. So the maintainer sets the two publishers up shortly before the second
  pre-release. Until then nothing can be published without a new token.
- **Provenance is public.** A package records the repository, the workflow and the run that built it, and the
  transparency log of Sigstore keeps that. `npm audit signatures` checks it. The checksums of record 0050 still
  only show a download that went wrong.
- **npm can hold a version that GitHub does not show.** The job on GitHub runs after the one on npm. When it
  fails, the failed jobs of the run are run again. The same holds for one package of two. A new run packs
  again, and whether its files have the same bytes was not tried: run the failed jobs again, not a new run.
- **An environment that does not exist is made by GitHub without reviewers** the first time a job names it.
  Such a job does not wait. The steps say to create the environment first.
- **Staged publishing was not taken.** `npm stage publish` puts a version in front of a maintainer, who approves
  it on npm with a second factor. Here the approval is the one of the environment on GitHub, as in the workflow
  the maintainer showed. A trusted publisher made today allows only `npm stage publish` unless `npm publish` is
  ticked, which the steps say.
- **Tried, on the machine of the author.** The install line against the stand-in registry, with npm 11.19 and
  12.2 on Linux. The publish step and the tag step of the workflow, without `--provenance`, against a registry
  on that machine that keeps what it is sent: a first publish, the same run again, a second version, `latest`
  moved, a missing `latest` set, a release under `latest` left alone, other bytes under a version refused. That
  try found one defect: npm read `release/<file>` as the short name of a repository on GitHub, so the step
  names the files with `./` in front. The second version was the first with another version number.
- **What `latest` does was tried the same way,** with npm 11.19 and 12.2. While `latest` stays on the first
  pre-release and `next` is on the second, `npm update --global` leaves an installed first pre-release where it
  is. Once `latest` is moved, `npm outdated --global` names the second and `npm update --global` installs it.
  An install without a tag gives the version under `latest`. `npx sf-orglens@next` runs the command.
- **Not tried, and it cannot be before the first publish:** anything against the registry of npm. That is the
  OIDC token and trusted publishing, provenance, whether npm takes the repository address in the form the
  packages have it, the token, the organization, whether the registry puts `latest` on a first version that is
  published with `--tag next`, moving a tag with trusted publishing, and how long npm takes to show a new
  version, for which the install job waits and tries again. The job on npm and the jobs after it have never
  run.
- The first pre-release was to go to a few colleagues by a link. On npm anybody can find and install it. The
  release notes already say what it is.
