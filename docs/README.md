# Project documents

Everything that explains why OrgLens is built the way it is lives here, in git, next to the code.

| Folder                                   | Content                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`plans/`](plans/)                       | The [re-architecture plan](plans/re-architecture-plan.md) the project started from, and one plan per phase. A phase plan is approved by the maintainer before anything in the phase is built. |
| [`adr/`](adr/)                           | Decision records: one short file per decision, with its reason and what it rules out.                                                                                                         |
| [`research/`](research/)                 | Research notes behind the plans, kept as written.                                                                                                                                             |
| [`cli.md`](cli.md)                       | The command line: the commands, the `--json` output contract, the exit codes and the error codes.                                                                                             |
| [`configuration.md`](configuration.md)   | The files of a workspace: `orglens.toml`, `.orglens/local.toml`, the environment variables and how the files are checked.                                                                     |
| [`live-org-setup.md`](live-org-setup.md) | How the maintainer sets up the Salesforce org that the live-org workflow runs against, and the GitHub secrets it reads.                                                                       |
| [`test-plans/`](test-plans/)             | One test plan per phase: steps the maintainer can run by hand to verify what was built, with the output to expect.                                                                            |
| [`reports/`](reports/)                   | One report per phase: what was built, what was measured, what changed against the plan, and what is not done.                                                                                 |

## Phase plans

| Phase         | Plan                                 | State                                                                                                                                              |
| ------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Foundations | [plans/phase-0.md](plans/phase-0.md) | Approved on 2026-11-11. Built. [Test plan](test-plans/phase-0.md), [report](reports/phase-0.md). Closed when the maintainer has run the test plan. |
| 1 First slice | [plans/phase-1.md](plans/phase-1.md) | Draft. Not approved, nothing of it is built.                                                                                                       |
