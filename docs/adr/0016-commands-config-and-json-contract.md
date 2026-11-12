# 0016. A fixed command set, a stable JSON contract, and a committable configuration file

- Status: Accepted
- Date: 2026-11-11
- Decisions: D6

## Context

The CLI is the first client, and the web UI, CI pipelines and the later agent will all drive the same engine. In the
prototypes, command names and output shapes changed freely, and configuration mixed shared settings with personal
ones and with secrets.

## Decision

- **Commands.** `source add|list|remove`, `snapshot`, `impact` (for a component, and for a change set with
  `--diff base..head`), `compare`, `access`, `coverage`, `status`, `doctor`, `explain`, and later `ask`.
- **Output.** Every command has a documented, stable `--json` output and documented exit codes for CI.
- **Configuration.** `orglens.toml` is committable: it declares sources and how repository folders map to orgs.
  Data lives in a local `.orglens/` folder that is never committed. Neither holds secrets.

## Consequences

- The JSON output is the contract for the web UI, CI and the agent, so it changes only with a version bump.
- A colleague can clone a repository containing `orglens.toml` and rerun the same analysis against their own
  login.
- The JSON envelope and the exit-code table are recorded in a separate decision when the CLI shell is built.
