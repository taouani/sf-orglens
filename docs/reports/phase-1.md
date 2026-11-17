# Phase 1 report: First slice

Written on 17 November 2026 by the AI assistant that built the phase, for the maintainer. The plan of the phase
is [`docs/plans/phase-1.md`](../plans/phase-1.md), which holds a status for every work package. The checks you
can run yourself are in the [test plan](../test-plans/phase-1.md).

## In short

- All eleven work packages are built. Four of the five outcomes of the plan are reached. The fifth is reached
  as far as I can reach it: the proof that is yours, a run on an org you know, is the test plan.
- OrgLens answers its first impact question. `orglens snapshot` reads a source and analyses its objects, fields
  and validation rules. `orglens impact` says what refers to a field or an object, with the reference each
  result is found by, and names what the answer does not cover. `orglens coverage` shows what was analysed and
  what went wrong. A snapshot of an org is held against the Dependency API of Salesforce.
- The four pass marks you accepted with Q5 are met. No reference that was checked is wrong. Four are missed,
  in one formula of one public codebase, and a warning names each.
- **One acceptance criterion is missed.** A snapshot of the test org is not complete over the logic tier: the
  org lists six components that Salesforce does not hand out, in any way the engine can ask. You decided on
  17 November 2026 that such a component stays an error, so a snapshot of the test org stays partial.
- **Nothing was run on an org of the size of your targets, and `orglens snapshot` as a command still never ran
  against Salesforce.** The engine behind it read the test org eight times in this phase. The test plan asks
  you for both.
- Two pre-releases were published on npm and on GitHub on 17 November 2026: version `0.1.0-next.0` with a token, and
  version `0.1.0-next.1`, which changes nothing in what OrgLens does, without one, through the trusted publishing of
  npm. **The review of the first found a security hole in its first way of installing,** from two addresses on GitHub:
  after the install, `npm update --global` replaces OrgLens with whatever the public registry holds under the two
  package names, and nobody held them for this project. You first decided to hold the names on npm with empty packages,
  on my recommendation. The review of that decision found that the policy of npm forbids it. I had not read the policy.
  You then chose, on 17 November 2026, to publish the pre-release itself on npm, by a workflow that waits for your
  approval, as your other project does. That is built (record 0053). You set up what only you can, gave your word for
  the version and approved the job, and
  [run 5 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44164088211) published it.

## The outcomes of the plan

| #   | Outcome of the plan                                                                                                 | State                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `snapshot` analyses what it stores: a row per component, and references of objects, fields and validation rules     | Built. Formulas, lookups, roll-up summaries, lookup filters, default values, display fields, value sets and field dependencies become references with kind, confidence and place. Shown on the fixture project, on a mock org, on four public codebases, and through the engine on the test org. |
| 2   | `impact` says what refers to a field or an object, with the path that explains each result, and has a JSON contract | Built, with one departure: a result holds the one reference it is found by, not its whole path. The chain can be followed from result to result. Never run on a snapshot of a real org.                                                                                                          |
| 3   | Every answer says what it does not cover                                                                            | Built. An answer says in its first lines that it is not complete and how many types are not analysed, and lists them below its results. `complete` is false for every real project in this phase.                                                                                                |
| 4   | `coverage` shows per type how many components were analysed, and how many names could not be resolved               | Built. It also shows the cross-check, and what a snapshot of an org left out.                                                                                                                                                                                                                    |
| 5   | The results are proven in the ways of section 6 of the plan                                                         | Five of the six proofs are made. The answer key, the deploy, the Dependency API on the test org and the public codebases are done by me. Your reading of ten entries of the key and your run on an org you know are open.                                                                        |

## The pass marks of Q5

| #   | Pass mark                                                                                                          | Result                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Every entry of the answer key for fields and rules is found, nothing else is reported, no negative case is hit     | Met. The 106 references of the key are found, each at its line and column, and no other. The four entries the key marks as a stretch are found too.                                                                                              |
| 2   | Every formula of the public codebases is read without a problem                                                    | Met, on four codebases. PMM was added in work package 10.                                                                                                                                                                                        |
| 3   | On the test org, no pair that the Dependency API reports for a formula field or a validation rule is missing       | Met. Of 56 such pairs the analysis has 54, has 2 as a reference to a part of the object, which you chose to count as covered, and missed none.                                                                                                   |
| 4   | In the check by hand, no `confirmed` reference is wrong, and every missed one is corrected or named with its cause | Met. 368 entries, 616 references, none wrong. Four missed, in one formula of NPSP, behind a lookup of another package that no file of the codebase describes. Nothing was corrected: the analysis does not guess, and names each with a warning. |

The weakness of mark 4 is the one the plan named. I wrote the analyser and I made the check. The agent that
reviewed the pull request read the 133 entries that can hold a name again and found the same result. It is a
reader of the same kind as I am. No person read an entry.

## What was built

| Work package                         | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Fixture v1 and its key             | The fixture project grew from 52 to 87 components. Its key holds 106 references of fields and rules, 62 more than before. 178 formula probes, and ten formulas that cannot be deployed with what the analysis must say of each. Salesforce accepted the project on the second deploy.                                                                                                                                                                                                                                                                                                    |
| 2 XML with positions                 | A reader of our own for metadata files that gives the line and column of every value (record 0039). No library does. It refuses six things well-formed XML can hold, none of which a file of the fixture or the public codebases holds.                                                                                                                                                                                                                                                                                                                                                  |
| 3 Components and references in store | Tables for components, their versions and references, shared between the snapshots of a source (record 0040). A benchmark through the real store.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4 Objects, fields, validation rules  | Every file of a snapshot becomes a component. Objects, fields and rules are read, and the ten kinds of parts an org keeps inside the file of an object are components too. A model of the objects resolves names, with a table of standard relationships (record 0041).                                                                                                                                                                                                                                                                                                                  |
| 5 Formulas                           | A parser of the formula language and the rules that turn its names into references: paths through relationships, global variables, `Owner:User`, picklist values (record 0042). A formula that is not read as a whole still gives its names, as `probable`.                                                                                                                                                                                                                                                                                                                              |
| 6 Analysis in the snapshot           | `snapshot` analyses what it stored. The new command `orglens analyse` analyses a stored snapshot again without reading the source. `coverage` and `status` show the analysis (record 0043).                                                                                                                                                                                                                                                                                                                                                                                              |
| 7 Impact                             | The walk over references, and the command `orglens impact` with `--depth`, `--min-confidence`, `--outgoing` and `--snapshot`. Six golden answers, and a test that works out the answer for 96 components from the key alone (record 0044).                                                                                                                                                                                                                                                                                                                                               |
| 8 Cross-check                        | A snapshot of an org asks the Dependency API, keeps the rows beside the snapshot and compares them with the analysis. A pair Salesforce reports and the analysis lacks is the error `REFERENCE_MISSED` (record 0045). An org too large for one query is read in parts.                                                                                                                                                                                                                                                                                                                   |
| 9 What a snapshot reads              | A snapshot reads every type (record 0038) and is judged complete over the 21 types of the logic tier (0046). Two corrections where the Salesforce library falls short (0047). The key `exclude_types` in `orglens.toml` (0048). Parts asked for by their own names (0049).                                                                                                                                                                                                                                                                                                               |
| 10 Proof on public codebases         | PMM as the fourth codebase. A listing for a check by hand, a test that holds what was checked by its digest, a timing of the built commands, and the note with the numbers.                                                                                                                                                                                                                                                                                                                                                                                                              |
| 11 Phase close                       | The workflow that makes a pre-release on GitHub and tries its install line on three systems before it publishes, version `0.1.0-next.0` with its release notes (record 0050). Record 0051. The job that publishes a pre-release on npm, in an environment that waits for your approval, and what you set up for it (record 0053, which takes the place of record 0052). Version `0.1.0-next.1`, which changes nothing and was published without a token to try trusted publishing (record 0054). This report, the test plan, the updated overall plan and the draft of the Phase 2 plan. |

In numbers: about 18,400 lines of TypeScript in the engine and the command line, and about 35,700 lines of
tests. 2,106 tests are defined. On my machine, with the four public codebases downloaded, 2,095 pass and 11 are
skipped. Without them, 35 are skipped there, where the tests run as the root user. CI does not download the
codebases and skips the tests on them, and how many it skips differs by system.
Statement coverage of the two packages is 97.5 percent. The database is at schema version 7, from version 2 at
the end of Phase 0, and every earlier version is migrated. 20 decision records are new, 0035 to 0054, of which
0036 is superseded by 0038 and 0052 by 0053. 30 pull requests, 20 to 48 and the one that brought this sentence,
each with a code review by a separate agent, which comes before the merge. The workflow "Live org" ran ten
times against the test org.

## What was measured

Each number has its conditions in the note or the status it comes from. All are a handful of runs on one Linux
machine or on one org.

| Question                                            | Answer                                                                                                                                                                                                                                                                                           | Where                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| What does the Dependency API report of the new key? | 129 of its 189 pairs, and no row between two components of the fixture is wrong. Of the 52 pairs from a formula to something custom it reports 51. It reports nothing for standard fields, lookups, roll-up summaries, lookup filters, global value sets, controlling fields and inactive rules. | [real-org.md](../research/phase-1/real-org.md)                 |
| Does the analysis miss what Salesforce reports?     | No, on the test org. 257 rows, 201 of them from types this phase does not analyse. The other 56 are 56 pairs: 54 found, 2 found as a reference to a part of the object, none missed.                                                                                                             | [real-org.md](../research/phase-1/real-org.md), section 7      |
| Can a large org be read in parts?                   | On the test org, with every answer cut off at 30 rows: 60 requests, none failed, and the same 257 rows as the one query. Six queries had failed before a correction: Salesforce refuses a query that names a standard object as the type of the target. An org above 2,000 rows was not read.    | [real-org.md](../research/phase-1/real-org.md), section 7      |
| Is a snapshot of the test org complete?             | No. Of 222 components that do not come back, 209 of 10 types are outside the logic tier and are warnings. Seven bundles and three files were explained and corrected. Six components of the tier stay missing, see the next section.                                                             | [real-org.md](../research/phase-1/real-org.md), section 8      |
| Is a checked reference wrong?                       | No. Four public codebases, 368 entries, 616 references: none wrong, four missed.                                                                                                                                                                                                                 | [public-codebases.md](../research/phase-1/public-codebases.md) |
| How large and how fast is the real store?           | At the size of the benchmark of Phase 0: 94 MB after the first snapshot and 146 MB after ten. The first write takes 7.0 to 8.0 seconds, about twice the time of the tables of Phase 0, and a later one 3.1 seconds. At twice the size: 190 MB, 293 MB, 15.4 and 6.6 seconds.                     | [store-benchmark.md](../research/phase-1/store-benchmark.md)   |
| How long does an impact question take?              | On the synthetic org at twice the size of Phase 0: 8 to 9 ms from an ordinary field over five levels, and 2.3 to 2.8 seconds from the most used field, with 116,100 results. Your target is 5 seconds. The times hold the walk and the making of the answer, not the start of Node.js.           | Status of work package 7 in the plan                           |
| How long do the commands take on real repositories? | As whole commands: a first snapshot with its analysis takes 0.6 to 0.7 seconds for Apex Recipes, 0.8 to 1.0 for Nebula Logger, 0.9 to 1.2 for PMM and 3.5 to 3.9 for NPSP with its 11,722 components. `coverage` and `impact` take 0.1 to 0.2 seconds on each.                                   | [public-codebases.md](../research/phase-1/public-codebases.md) |
| And at the size of your targets?                    | A made-up source of 100,216 components, NPSP with every object copied 98 times, is read, stored and analysed in 18.4 to 19.7 seconds. Its database has 84.3 MB. It is a repository on a disk and not an org, its files are small, and it has few references.                                     | [public-codebases.md](../research/phase-1/public-codebases.md) |

Against your four targets for an org of 100,000 components (record 0037):

| Target                              | State                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First snapshot under 60 minutes     | **No measurement.** What OrgLens does with the files takes seconds. The time Salesforce takes to hand them out is not known for an org of that size, and Apex and flows are not analysed yet.       |
| Impact query under 5 seconds        | Met in every case that was measured, at twice the size of the synthetic org of Phase 0. That size is my reading of how you count a component, which is still open. Ten times that size was not run. |
| Comparison under 10 seconds         | Not built. Phase 4.                                                                                                                                                                                 |
| Incremental refresh under 5 minutes | Not built. A later snapshot of an unchanged source is written in 3.1 seconds at the size of Phase 0, but it reads the whole source again.                                                           |

## The six components that keep the test org partial

The plan of work package 9 asks for this count in the phase report. It is the state after run 15, the last of
the phase.

| Type           | Missing  | Reason                                                                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CustomField`  | 2 of 79  | The org lists the field and not its object. Salesforce cannot find the object, and cannot find the field by its own name. |
| `RecordType`   | 2 of 2   | The same: Salesforce cannot find the object, and cannot find the record type by its own name.                             |
| `CustomObject` | 2 of 398 | The org lists the object. Salesforce hands nothing out, and a remark that says "Not a … type" holds its name.             |

The names of the objects have no ending of a custom object. The two fields belong to two objects, and the two
record types to one of these. Why the org lists what Salesforce does not hand out is not known. None of the
six is of the fixture project, so the public log names none of them.

What follows today: `snapshot` of that org ends with the exit code `5` every time, and by the rules of record
0044 so does every `impact` answer from it, because fields and objects are analysed types and something of
them was not read. Only one org was read, so how common this is in other orgs is not known.

## What changed against the plans

- **A snapshot reads every type.** With your approval of the plan you changed what follows from Q2: an org is
  read whole from this phase on, "complete" is judged over the logic tier, and references are found phase by
  phase. Record 0038 replaces 0036.
- **The Dependency API is read by the engine in this phase**, not in Phase 3 (Q1). Its rows are kept beside
  the snapshot and are no references, which departs from the wording of the plan: as references they would
  change the digest of a component whose files did not change. `impact` never shows one.
- **An impact result holds one reference, not its whole path.** With every path written out, one answer from
  the synthetic org was 443 MB of JSON. With one reference per result the chain can still be followed.
- **Work package 9 took five pull requests, not one,** and missed its first acceptance criterion. Each run of
  the test org showed something the one before could not: components of a package listed with a prefix and
  handed out without it, files of a type the Salesforce library does not know, and parts of objects the org
  does not list. Three were corrected. The fourth is the six components above.
- **The reader for XML is our own (Q8), and it is about 840 lines.** The question said about 300.
- **The first write of the real store takes about twice as long as the tables of Phase 0,** which is the limit
  the plan set for reporting it. At the size of Phase 0 that is 7 to 8 seconds.
- **The fixture project has no `$RecordType`.** Salesforce refused the rule that had it. To key it, the project
  needs a record type, which also the review of work package 4 asked for. Work package 1 of the Phase 2 plan
  adds one.
- **A fourth public codebase, PMM,** was added for its validation rules and lookup filters. NPSP has few.
- **Two defects that tests of the phase brought out in code of Phase 0** were corrected in pull requests of
  their own: a command that waited two seconds for the lock of the configuration and gave up while others
  took their turn, and two commands that could both take over a lock that was left behind.
- **Effort.** The plan estimated about 33 developer-days in about twelve pull requests. The phase was built in
  three calendar days, in 30 pull requests. As in Phase 0, the estimate measured the size of the work and
  not the time it took.
- **The pre-release has a version with a pre-release part,** `0.1.0-next.0`, and is made by a workflow. The
  plan named neither. Record 0050 holds both.
- **The pre-release goes to npm.** Your answer to Q6 was that nothing does. Your first answer of 17 November
  2026 was that the project holds three names on npm with empty packages. The review found that the policy of
  npm forbids that, and the record of that answer was never accepted (record 0052). Your second answer of that
  day was to publish the pre-release itself on npm (record 0053). The install line of the first pre-release was
  `npm install --global sf-orglens@0.1.0-next.0`, and the README now has `npm install --global sf-orglens@next`.
- **What "the first release" is, is decided:** the first version on npm without a pre-release part. You decided
  that it is the first one on npm (record 0051), when no pre-release went there, and when asked again that a
  pre-release on npm is not it (record 0053). Until then the names, the JSON output and the exit codes can
  change from one pre-release to the next.

## What is not done, and what is not verified

- `orglens snapshot`, `coverage` and `impact` as commands against Salesforce. The workflow "Live org" calls
  the engine, not the commands. Part G of the Phase 0 test plan and the test plan of this phase are those runs.
- An org with thousands of components, a sandbox, an org with a namespace, another edition than Developer
  Edition. One org was read.
- The Dependency API above 2,000 rows, where an org is read in parts in earnest, and how many requests and how
  much time that takes.
- Memory, in every measurement of this phase. Windows and macOS, in every measurement: CI runs the tests there,
  and nothing was timed.
- The key `exclude_types` against a real org, and how much time it saves on an org with many reports.
- The check of the public codebases by a person. The 148 references there that are not of a formula, a rule, a
  filter or a summary were not read one by one.
- Formulas outside fields and validation rules: quick actions, workflow rules, flows. The public codebases
  hold 19 of them. Named arguments in square brackets. The order of the operators of the formula language is
  mine and is not verified. No reference depends on it.
- A standard field without a file is always `external`, so a typing error in such a name is not found. `Owner`
  is taken as a user and `Parent` as the object itself, which is wrong for the few objects where it is not so.
  Whether the formula language has more names for a queue than `QueueName` is not verified.
- `notCovered.notAnalysed` of an impact answer is not narrowed to the types that can refer to the component:
  nothing says yet which type can refer to which. No option limits the number of results.
- No command deletes a snapshot. No option analyses every snapshot at once. Nothing says that a snapshot was
  analysed by an older version than the one that runs: `status` names the version.
- The namespace of a package project is not known to the analysis.
- Profiles and permission sets are still read incompletely, as in Phase 0.
- A row of the Dependency API for a pair OrgLens found raises no confidence, which record 0034 foresaw.
- **Two pre-releases were published, and that is all that was tried against npm.**
  [Run 5 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44164088211) published both packages with a
  token on 17 November 2026, with their provenance, moved the tag `latest`, installed from npm on Linux, Windows and
  macOS, each with the npm that Node.js brings and with the newest one, and created the
  [pre-release on GitHub](https://github.com/taouani/sf-orglens/releases/tag/v0.1.0-next.0). I read the log of the run.
  I have no account on npm and did not look there. Before that run, the script of the job had only run against a
  registry on one machine that keeps what it is sent, on mine and on the reviewer's.
  [`docs/releases/publishing.md`](../releases/publishing.md#what-the-first-publish-showed) has what the run showed.
  Three things of it:
  - npm made a version `0.0.0-stage` of each package by itself when it received the first publish, and put
    `latest` on it. The job moved the tag to `0.1.0-next.0`. You looked at npm on the same day: both versions
    are listed, and the time of `0.0.0-stage` is the time the package was created. It is not a version of
    OrgLens. The page of npm on staged publishing names it as a placeholder for a staged package. What it holds
    and whether it can be removed, I do not know. You also read the tags: `next` and `latest` are on
    `0.1.0-next.0` for both packages.
  - An install found the version only four to five and a half minutes after the publish. The install jobs on
    Linux and Windows passed with the last of their five tries. They now try eight times.
  - One install job on macOS got no machine from GitHub and was cancelled. "Re-run failed jobs" ran it, and the
    pre-release on GitHub came eighteen minutes after the packages were on npm.
- **Trusted publishing was tried once, and it worked.**
  [Run 7 of the workflow](https://github.com/taouani/sf-orglens/actions/runs/44194660408) published `0.1.0-next.1` on
  17 November 2026 without a token, with the provenance of both packages, moved the tag `latest` the same way,
  installed from npm on the three systems and created the
  [pre-release on GitHub](https://github.com/taouani/sf-orglens/releases/tag/v0.1.0-next.1), all on its first attempt.
  An install found the version after three and a half to five and a half minutes: its fourth try failed and its
  fifth passed, as at the first publish.
  [`docs/releases/publishing.md`](../releases/publishing.md#what-the-second-publish-showed) has what the run showed.
  Not seen: a publish that npm refuses, and what the job says then. Not seen by me: the pages of npm, so whether
  the two trusted publishers still show "Pending validation" is yours to look at. Staged publishing, the other
  way for a first publish, is not tried. An install by a person and `npm update --global` against npm are not
  done: both are in part I of the test plan.
- **One test failed once on Windows, in a pull request that changed no code:** of eight processes that added a
  source at the same moment, one could not create the lock of the configuration (`EPERM`). The creation is
  tried again since pull request 48, as the read and the removal of the lock already were. Why Windows refused
  is not known, and the refusal cannot be forced on the machines of CI, so it is not shown that the tries are
  enough. A command that was refused writes it to the log of the workspace. The correction is on `main` and in
  no published version. Three older holes in the lock files that its review found are in
  [issue 49](https://github.com/taouani/sf-orglens/issues/49).
- You said on 17 November 2026 that the token of the first publish and the secret that held it are deleted. I
  did not check it, and I did not try to read the list of secrets of the environment.
- **The name `orglens` is free on npm, and stays so.** It is the name of the command, not of a package.
  `npx orglens` on a machine without OrgLens fetches whatever package has that name. The policy of npm does not
  let the project hold it empty. The release notes say not to run it.
- Three things I could not trace: why two objects of the test org are listed and not handed out, why Salesforce
  refused two files of the first deploy of the fixture, and where the count of 1,579 files for Nebula Logger in
  the status of work package 6 came from. A snapshot holds 1,021.

## Open with you

1. **Run the test plan**, and approve or reject the phase. Its main part needs an org you know.
2. **After the first publish.** Nothing is open: you deleted the token and the secret.
3. **After the second publish.** You set up a trusted publisher for each of the two packages on 17 November
   2026, chose to publish `0.1.0-next.1` through them before they expired (record 0054), gave your word for the
   version and approved the job. Three things are left, all yours, two on npmjs.com and one on GitHub:
   - Look that the trusted publisher of each package no longer shows "Pending validation".
   - A setting on npmjs.com, not a question: npm recommends, once trusted publishing works, to require the
     second factor and to forbid tokens in the settings of each package. The workflow needs no token any more.
   - A setting on GitHub, not a question: GitHub can make releases immutable. It is off in this repository, and
     only you can turn it on. Record 0050 says that a published pre-release is not changed. The setting would
     hold that.
4. **How you count the 100,000 components of your targets** (record 0037). This phase worked with the count as
   an org lists them, fields included. Asked on 15 November 2026.
5. **The draft of the [Phase 2 plan](../plans/phase-2.md)** and its questions. Nothing of Phase 2 is built
   before you approve it.
6. **From Phase 0, still open:** part G of its test plan, your reading of ten entries of the answer key, and
   whether private vulnerability reporting is switched on in the settings of the repository.
7. **Choices of mine that are yours to strike.** Records 0039 to 0050 and records 0053 and 0054 each list the
   choices their author made.
   The ones with the most weight are named in the status of each work package in the plan.
