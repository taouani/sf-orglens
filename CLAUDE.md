# OrgLens

OrgLens is an open-source, local-first impact analysis tool for Salesforce. It reads a live org, a sandbox or a Git
repository, builds a field-level dependency graph in a local SQLite file, and answers impact questions
deterministically. A language model is optional and only explains results.

This repository is a rewrite in TypeScript. The plan and the 27 decisions behind it are in
`docs/plans/re-architecture-plan.md`. Read the plan of the current phase in `docs/plans/` before changing anything.

## How work is done here

These rules come from the maintainer and apply to every phase.

1. **Plan first.** Before a phase is built, a detailed plan for it is written to `docs/plans/phase-N.md` and the
   maintainer approves it. Nothing in a phase is built before that approval.
2. **Every pull request gets a sub-agent code review.** Open the pull request, start a separate agent to review
   it, and resolve or answer every finding. Tick the box in the pull request template.
3. **Merging.** A pull request may be merged once CI is green on all platforms and every review comment is
   resolved.
4. **Phase close.** When a phase is built: update the overall plan, write a test plan the maintainer can follow by
   hand in `docs/test-plans/phase-N.md`, and write a short phase report.
5. **Everything is in git.** Plans, test plans, research notes and decision records live in `docs/`. A decision
   that changes the architecture, the data model, the storage format, a public contract or the scope of a release
   gets a record in `docs/adr/`.
6. **Scope follows the plan.** No feature from a later phase is started early. No rider (automation order,
   integration map, security audit) and no language-model feature starts before the correctness gate has passed.
   A command is added to the CLI only once it does something: no stubs.

## Data rules

- Never add data from a real org: no metadata, recorded API responses, org ids, host names or user names. Test
  data is written for the purpose, or fetched from public repositories pinned by commit.
- Never copy fixtures, recordings or code from the earlier private OrgLens prototypes into this repository.
- No credentials anywhere: not in code, tests, fixtures, logs, workflow files or pull request text. Credentials for
  the test org exist only as GitHub Actions secrets and are used only by the manually started live-org workflow.
- OrgLens reads metadata only. Nothing here may query record data.

## Architecture

One engine library, thin clients.

```
packages/engine/src
  core         keys, reference vocabulary, errors, logging     imports nothing else in the engine
  sources      org, sandbox and Git access                     may import core
  extraction   parsers that produce components and references  may import core, sources
  store        the SQLite workspace database                   may import core .. extraction
  engines      impact, comparison, access, coverage            may import core .. store
  api          the public API                                  may import everything
packages/cli   the `orglens` binary                            imports only `@sf-orglens/engine`
```

- A layer imports only from layers above it in this list. The list is defined once, in `layers.cjs`.
- `packages/engine/src/index.ts` re-exports `api/` and nothing else. Clients never reach into the engine.
- Only `sources/` may import `@salesforce/*`. This is about the code of the engine. A test may import it.
- The rules are enforced twice: by the ESLint rule `orglens/layers` (`tools/eslint-plugin-orglens.js`, which
  resolves every static import, `import()`, type import and `require`) and by dependency-cruiser. The boundary
  between a client and the engine is guarded a third time by the `exports` map of the engine package.
- `pnpm run check:boundaries` writes probe files that break the rules, plus control probes with allowed imports,
  and checks each tool's verdict. It fails when a rule has no probe. When a rule is added or changed, add a probe.
- `packages/engine/src` contains only the six layer folders and `index.ts`.
- Component keys never contain the org, the source or the snapshot.
- Every reference carries its origin, a confidence tier (`confirmed`, `probable`, `possible`) and a source location.

## Commands

Node.js 24.15 or newer and pnpm 12 are required.

```sh
pnpm install
pnpm run build              # tsc -b
pnpm run typecheck:tests    # tsc on the test projects
pnpm run check              # everything CI runs except the package smoke test and the start-up check
pnpm run test               # vitest, from source, no build needed
pnpm run lint
pnpm run format:write
pnpm run depcruise
pnpm run knip
pnpm run check:adr          # format and coverage of docs/adr
pnpm run check:boundaries   # needs a build first
pnpm run publint && pnpm run smoke:pack   # need a build first
pnpm run check:startup      # start-up time of the built binary, needs a build first, not part of check
pnpm run bench              # storage benchmark on a synthetic org, not part of check
pnpm run corpora:fetch      # downloads the public test codebases of fixtures/corpora.toml into .corpora
```

Run `pnpm run check` before every push.

## Conventions

- TypeScript with the strict settings in `tsconfig.base.json`. Only erasable syntax: no enums, no namespaces, no
  parameter properties. Relative imports use the `.ts` extension. Type-only imports use `import type`.
- ES modules only. Node.js built-ins are imported with the `node:` prefix.
- Tests live in `packages/*/test` and run from source through the `@sf-orglens/source` export condition.
- Expected outputs larger than a few lines are golden files in `test/golden/`, compared byte for byte with
  `toMatchFileSnapshot`. Review a changed golden file like code. Never regenerate one just to make a test pass.
- All text is LF on every platform. Fixtures record line and column positions.
- `fixtures/billing-sfdx` and its answer key `fixtures/expected/answer-key.v0.yaml` belong together
  (`fixtures/README.md`). The key is written by hand and is never changed to make an analyser pass. Change a fixture
  file and its entries in the key in the same pull request. `fixture-key.test.ts` says which entries moved.
- Tests need no network and no org.
- Every store test runs against both SQLite drivers (`test/helpers/store.ts`). The store uses only what the driver
  port in `store/driver.ts` offers.
- Dependencies are pinned to exact versions. A new runtime dependency needs a reason in the pull request, and a
  decision record if it is structural.
- Machine-readable output is a contract: `--json` shapes and exit codes are documented in `docs/cli.md` and change
  only with a version bump. A change to the output of a command changes `packages/cli/schemas/output.schema.json`
  and `docs/cli.md` in the same pull request. The configuration files are documented in `docs/configuration.md`.
- A command returns its data and its lines of text (`packages/cli/src/commands.ts`). Only `output.ts` writes to the
  terminal and knows exit codes. Every engine error code has a line in `EXIT_OF_ERROR`.
- A configuration key is added only with the feature that reads it. Unknown keys are errors.
- Writing style for documents and messages: plain, direct, full sentences. Say what is not done or not verified.
