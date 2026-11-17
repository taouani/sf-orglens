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
  the test org exist only as GitHub Actions secrets and are used only by the live-org workflow, which a maintainer
  starts and which logs in once a week by itself. Its log is public: a step of it prints sentences of its own.
  They hold numbers, codes, names of metadata types and of their elements, and names of the fixture project. They
  hold no name of another component of the org, only how such a name is built. They hold no message that OrgLens,
  a Salesforce library or Salesforce wrote, unless its whole text has a form the step lists. Of a message in
  another form, only the words of a short list of everyday words are shown
  (`packages/engine/test/live/public-log.ts` has the rule, decision record 0033 the reasons). No file of the org
  is kept or uploaded.
- The fixture project is the only thing that is ever deployed to an org, and only to the test org, by a tool of
  the tests (`packages/engine/test/live/deploy-fixture.ts`).
- OrgLens reads metadata only. Nothing here may query record data. One thing is outside the code of OrgLens: when
  the Salesforce library renews an expired login, it asks the org about the org itself. Decision record 0031
  names those requests, and a test pins them. Through the Tooling API the engine queries one object,
  `MetadataComponentDependency`, which says which component refers to which (`sources/dependency-api.ts`), and a
  test holds every query against it. A tool of the tests asks the test org for more of the same kind
  (`packages/engine/test/live/probe-org.ts`). The objects it reads describe metadata.

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
- `trial/apex` is the Apex trial of Phase 0 (decision record 0018): two parser adapters under one resolver. It is
  not part of the engine and is not shipped. Its tests run with the others. The maintainer chose
  `web-tree-sitter-sfapex` on 13 November 2026. The other adapter stays for the test that compares the two.
- `packages/engine/src/index.ts` re-exports `api/` and nothing else. Clients never reach into the engine.
- Only `sources/` may import `@salesforce/*` and `@jsforce/*`. This is about the code of the engine. A test may
  import them.
- The rules are enforced twice: by the ESLint rule `orglens/layers` (`tools/eslint-plugin-orglens.js`, which
  resolves every static import, `import()`, type import and `require`) and by dependency-cruiser. The boundary
  between a client and the engine is guarded a third time by the `exports` map of the engine package.
- `pnpm run check:boundaries` writes probe files that break the rules, plus control probes with allowed imports,
  and checks each tool's verdict. It fails when a rule has no probe. When a rule is added or changed, add a probe.
- `packages/engine/src` contains only the six layer folders and `index.ts`.
- Every source is read into a `SourceTree` (`sources/tree.ts`): sorted paths with forward slashes, and a function
  that returns the bytes of one. Nothing after `sources/` asks where a file came from. Reading a source never
  changes it.
- XML is read with the reader of the engine, `extraction/xml.ts` (decision record 0039). It gives the place of
  every element and of every character of a text, and refuses a file it does not know with an issue. No code
  of the engine imports `fast-xml-parser`: it is the second opinion in the tests of the reader, and the tools of
  the layer rules refuse it elsewhere.
- An analysis is `analyseSource` (`extraction/analyse.ts`): from a `SourceTree` and the list of its components to
  a component for each, with references and issues. An analyser reads names with their places first and resolves
  them against the model of objects (`extraction/model.ts`) afterwards. A component it is handed is never dropped
  without an issue, a failure costs one component, and a name it does not find is `unresolved` or `external`,
  never guessed. Decision record 0041 has the rules and lists what is not read yet.
- A formula is read with the reader of the engine, `extraction/formula.ts` (decision record 0042): the formula
  of a field, its default value and the condition of a validation rule. It knows no function, so a call is any
  name before a bracket. A formula it cannot read as a whole is kept: a warning says where it stopped, and the
  names among its tokens are `probable`. `fixtures/formula-probes.yaml` must be read without a problem.
- A snapshot is analysed from the files it holds (`api/analysis.ts`, decision record 0043): `snapshot` stores
  first and analyses what it stored, and `analyse` does the same for a snapshot that is already there. Whether
  a snapshot is `complete` or `partial` says what was read. Whether its analysis is complete is said by the
  analysis: an issue of the stage `analysis` with the severity `error` makes it incomplete, a warning does not.
  A Git source is read, and its snapshot analysed, with the layout of files its own project file asks for, which
  the snapshot keeps. The project of the folder a command runs in plays no part.
  An analysis that fails as a whole never loses the snapshot.
- An impact question is answered by `engines/impact.ts` through the interface `SnapshotGraph` of the store
  (`api/impact.ts`, decision record 0044). The walk goes level by level, with one question to the store per
  level. A component is found once, on a shortest chain, and holds the one reference it is found by. Which chain
  is kept depends on confidence, keys and places only, never on a number of the database. Every answer says
  what it does not cover (`notCovered`). `complete` is false while anything is known that the answer could
  miss: a type that is not analysed, a warning of the analysis, and for `--outgoing` a component the snapshot
  does not hold. `mayMiss`, which the exit code `5` follows, is true only when something of an analysed type
  was not read or its analysis had an error. Which types an analysis read is kept with the analysis
  (`snapshot_analysis.types`), not derived from the version that answers. A statement of the graph that takes
  many ids starts from that list and walks no table: a test reads every query plan.
- A snapshot of an org is cross-checked (decision records 0034 and 0045). `snapshot` asks the Dependency API of
  Salesforce after the last chunk and stores its rows beside the snapshot, as Salesforce wrote them
  (`store/dependencies.ts`). They are no references: the graph never reads them, and `impact` never shows one.
  Every analysis holds them against what it found (`engines/cross-check.ts`) and keeps the comparison
  (`snapshot_analysis.cross_check`), so `analyse` compares again without the org. An end of a row is matched by
  the id the org listed the component with. A name is taken only where there is no id: for a standard object,
  and for a component the org listed without one. A pair Salesforce reports and the analysis lacks is the error
  `REFERENCE_MISSED` of the analysis. A pair only the analysis has is no error. The reading is `whole` only
  where no query could have left a row out. It never fails a snapshot and never makes it partial: an org that
  does not answer leaves a warning.
- A snapshot of an org reads every type and is judged over the logic tier (decision records 0038 and 0046). The
  tier is a list of names of the Metadata API in `core/tiers.ts`, and a type is of it by its own name. What the
  org listed and did not hand out, a listing it refused, a retrieve that failed and a file that cannot be read
  as metadata are an `error` in the tier, which makes the snapshot `partial`, and a `warning` outside it, which
  does not. Each such issue says which in `details.tier`. What nothing tells the type of counts against the tier.
  The file of custom labels is not missing when the org lists no label. A snapshot of a Git source is not judged
  by tier. An impact answer counts such a warning when it can be about a type it covers, which no warning is
  while every analysed type is of the tier. `exclude_types` of an org source in `orglens.toml` leaves types
  outside the tier out of its snapshots (decision record 0047): the org is not asked for them, and the coverage
  keeps each with the listing `excluded`, so that a report and an answer can say that it was not read.
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
pnpm run bench:store        # the same org written and read through the store of the engine, not part of check
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
- `fixtures/billing-sfdx` and its answer key `fixtures/expected/answer-key.v1.yaml` belong together
  (`fixtures/README.md`). The key is written by hand and is never changed to make an analyser pass. Change a fixture
  file and its entries in the key in the same pull request. `fixture-key.test.ts` says which entries moved.
  `answer-key.v0.yaml` is the key of Phase 0, which the Apex trial is scored with. Its Apex part and that of
  version 1 are the same, and the test fails when they differ: change an Apex entry in both files.
- A test of how a retrieve is split, repeated or continued uses the part of the project that `org-snapshot.test.ts`
  names, so that its numbers do not move when the project gets a new type.
- Tests need no network and no org. A test that needs a Git repository makes one with the Git helper of its
  package (`packages/engine/test/helpers/git-repo.ts`, `packages/cli/test/helpers/git.ts`). The helpers start Git
  without the `GIT_` variables and the Git settings of the machine, so that a test run from a hook cannot write
  into the repository of the developer. `git` is the only program a test starts besides Node.js.
- Every test process runs with an empty home folder of its own and without the Salesforce and proxy variables of
  the machine (`tools/vitest-setup.js`). A test that needs an org starts a mock on this machine
  (`test/helpers/mock-org.ts`) and writes the logins it needs with `test/helpers/cli-logins.ts`. A test that
  starts a second process while a mock runs in the first must not block: use `spawn`, not `spawnSync`.
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
