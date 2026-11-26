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
- No credentials anywhere: not in code, tests, fixtures, logs, workflow files or pull request text. Credentials for the
  test org exist only as GitHub Actions secrets and are used only by the live-org workflow, which a maintainer starts
  and which logs in once a week by itself. Its log is public: a step of it prints sentences of its own. They hold
  numbers, codes, names of metadata types and of their elements, and names of the fixture project, among them the
  standard fields and objects the mock org of the tests writes into its descriptions of the objects of the project. They
  hold no name of another component of the org, only how such a name is built. They hold no message that OrgLens, a
  Salesforce library or Salesforce wrote, unless its whole text has a form the step lists. Of a message in another form,
  only the words of a short list of everyday words are shown (`packages/engine/test/live/public-log.ts` has the rule,
  decision record 0033 the reasons). No file of the org is kept or uploaded.
- The assistant publishes nothing to npm and moves no tag there. It has no account on npm and never holds a
  token for it. The packages are published by the workflow "Pre-release", started by hand on `main`, in the
  environment `npm-next` of GitHub, which waits for the maintainer's approval (decision record 0053). A run with
  "publish" on cannot be undone and is started only after the maintainer has said so for that version. The
  assistant never approves a job in that environment, never reviews a deployment that waits there and never
  changes the environment, also where the access it works with would let it.
- The fixture project is the only thing that is ever deployed to an org, and only to the test org, by a tool of
  the tests (`packages/engine/test/live/deploy-fixture.ts`). The tool changes one thing on the way: the made-up
  user of the outbound message becomes the user it logs in as. In a step of its own it sends one more thing, and
  nothing else: one flow of the project as a draft, so that the org holds an active version of it and a newer
  one.
- OrgLens reads metadata only. Nothing here may query record data. One thing is outside the code of OrgLens: when the
  Salesforce library renews an expired login, it asks the org about the org itself. Decision record 0031 names those
  requests, and a test pins them. Through the Tooling API the engine queries three objects:
  `MetadataComponentDependency`, which says which component refers to which, `FlowDefinition`, which names the active
  and the latest version of each flow, and `Flow`, which names every version of a flow (`sources/dependency-api.ts`,
  decision records 0067 and 0078). A test holds every query against them. Through the REST API the engine asks for the
  description of each object a snapshot holds a file of (`sources/describe.ts`, decision record 0085), which says what
  the object holds and no value of a record. A test holds every address the engine asks for. A tool of the tests asks
  the test org for more of the same kind (`packages/engine/test/live/probe-org.ts`). The objects it reads describe
  metadata. The same tool asks the Metadata API for one flow of the fixture project by the numbers of its versions,
  and keeps no file.

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
  `web-tree-sitter-sfapex` on 13 November 2026. The engine took both adapters from it (decision record 0083), and
  the trial stays as it was scored.
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
- Apex is read with the reader of the engine, `extraction/apex-reader.ts`, built on `web-tree-sitter-sfapex`
  (decision record 0083). It lowers the tree of the parser into the model of `extraction/apex-syntax.ts`, which
  knows nothing of a parser, and frees the tree. Its grammar is loaded once in a process, by the analysis of a
  snapshot that holds a class or a trigger, and by nothing else. A class or a trigger that does not parse, or whose
  file holds more than the one it declares, is the error `APEX_MALFORMED` of its component, at the first place the
  parser cannot read. A fault of the reader is `ANALYSIS_FAILED`. The tests hold the reader against a second parser,
  `@apexdevtools/apex-parser`, ported to the same model (`test/helpers/apex-parser-adapter.ts`). No code of the
  engine imports it, and the tools of the layer rules refuse it there.
- A class or a trigger is a component, and each of its members is a component below it: a method, a constructor, a
  property, a member variable, the static and the instance initialisers, and an inner class with its own members
  (`extraction/apex.ts`, decision record 0084). The key of a method holds its signature, with each type as written,
  folded, without `System.` and an inner type of the class after the name of the class. A class extends and
  implements a class of the snapshot, a trigger is `triggers-on` its object with its events, and a member uses as a
  type a class of the snapshot or an object. A name of Salesforce that is no object gives nothing, and a `new` of a
  class is a call, which is not read yet. A test class, its members and a test method carry `test` in their
  attributes. A class whose code is `(hidden)`, or that has no file of code, is not analysed, with the warning
  `APEX_NO_CODE`. What the code reads, writes and calls is not read yet: the analysis does not list `ApexClass` and
  `ApexTrigger` among the types it read, so an answer names them as not analysed, and their rows of the Dependency
  API are not compared.
- A formula is read with the reader of the engine, `extraction/formula.ts` (decision record 0042): the formula
  of a field, its default value and the condition of a validation rule. It knows no function, so a call is any
  name before a bracket. A formula it cannot read as a whole is kept: a warning says where it stopped, and the
  names among its tokens are `probable`. `fixtures/formula-probes.yaml` must be read without a problem.
- A name in a text is read by shared code (decision record 0059). A reader hands its names over as they are
  written, each with its place (`extraction/raw-references.ts`), and `resolveReferences` resolves them when
  every file was read. `extraction/names-in-text.ts` reads the three ways a name stands in a text: the formula
  of a field or a rule, the formula of a flow, which has a merge field `{!Resource.Path}` where the other has a
  name, and a text with merge fields, where only what stands in the braces is read. The caller says what the
  first name of a merge field is. `fixtures/merge-field-probes.yaml` must be read as each probe says.
- A flow is read by `extraction/flows.ts`, from its file alone (decision record 0061). The flow is a component, and each
  of its elements and resources is a component below it (`Flow:<flow>#element:<name>`), which a reference starts at.
  `resourcesOf` says what each resource holds: a record of an object, something that holds no record, or something of
  which that is not known, and then a path from it is not followed and a warning says so, unless only `Id` stands after
  it, which gives no reference anyway (decision record 0082). An element of a kind the reader does not know is kept,
  with a warning and its names as `probable`. The analysis has a row of its own for flows (`parser:flow`). A row of the
  Dependency API from a flow is compared where it is from the version the snapshot holds, and counted otherwise
  (decision records 0067 and 0078).
- A file of workflow rules is read by `extraction/workflows.ts` (decision record 0063). The file is a component
  with the name of its object, and so is each rule, field update, email alert, outbound message and task in it,
  under the name Salesforce gives it (`WorkflowRule:Invoice__c.Mark_Overdue`). The file contains them, as an object
  contains its fields (`parentKey`). What they name is of the object the file is named after, also the formula of
  a field update that writes on the parent. A rule says whether it is active. An action of a type the reader does
  not know, or of none, is not read, and a warning says so. A test holds the types of action and the groups of the
  file against the Salesforce library. Of these files the Dependency API reports only the fields the formula of a
  field update reads: any other pair of them that no row reports is counted with a reason, and not listed.
- An object refers to the Lightning page, Visualforce page, s-control or Lightning component that overrides one of
  its actions (`extraction/objects.ts`, decision record 0070). The page or component is a target by its name and is
  not read. A Lightning component is an Aura component, or a Lightning web component where the snapshot defines only
  that. The Dependency API of a large org reported the Lightning page. Whether it reports the others was not
  measured, so a pair to one of them without a row is counted with a reason, and not listed. An impact answer
  follows the reference as any other: an answer about such a page holds the object and, behind it, what refers to
  the object.
- A record type and a field set are read by `extraction/objects.ts`, and a record of a custom metadata type by
  `extraction/custom-metadata.ts` (decision record 0065). A record refers to its type, to each field it gives a
  value, and to what the value of a relationship names: an object, a field, whose object is the value of the field
  that controls the relationship, or a record of another type. A text is a field only where it is exactly
  `Object.Field`, or the name of a field of an object the same record names in a relationship, and a file defines
  that field: then it is `probable`. A field without a value gives nothing, though Salesforce writes one for every
  field a record leaves out. Of these, the Dependency API reports the type of a record and the custom fields of a
  field set.
- An email template, a report type and a quick action are read by `extraction/email-templates.ts`,
  `extraction/report-types.ts` and `extraction/quick-actions.ts` (decision record 0077). The body of a template is
  a file of its own and no XML, and is read as text (`readText`). Its merge fields are written in the form of its
  kind, classic `{!Object.Field}`, Lightning `{{{Name.Field}}}` (and `{!Name.Field}`) or Visualforce
  `{!relatedTo.Field}`, and the kind says what their first name is. A merge field `{!...}` that holds more than a
  name is read as a formula. A report type refers to its object, to the lookup field behind each child relationship
  it joins (`childRelationship` of the model) and to each field it lists. A quick action refers to the object and
  the record type it creates records of, writes the fields it sets and those its layout lets the user type in,
  reads the names in the formula of a value, which start with the object the action runs on, and the fields its
  layout shows, and names the template it starts with and what it opens. The Dependency API of the test org reports
  the custom fields of a template and the object they are of, of a quick action the object it creates records of
  and the field `targetParentField`, and of a report type nothing: a pair of a report type or a quick action that no
  row reports is counted with a reason, and not listed. `EmailFolder` is outside the logic tier.
- A name alone that fits an object and more, such as `Invoice__c`, which the file of its workflow rules has too,
  means the object in an impact question, and the answer names the others (`sameName`, decision record 0064). A
  name that fits a flow and the definition an org lists under its name, and nothing else, means the flow (decision
  record 0082). Any other name that fits several components and no object is the error `COMPONENT_AMBIGUOUS`.
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
  what it does not cover (`notCovered`). For what refers to a component, a type that is not analysed is left out
  of it where its components can name no type of the answer, as the table of `engines/can-name.ts` says (decision
  record 0073). Each line of the table is held against the types of the Metadata API that `@jsforce/jsforce-node`
  declares, and a type without a line stays. `complete` is false while anything is known that the answer could
  miss: a type that is not analysed, a warning of the analysis that can bear on it, and for `--outgoing` a
  component the snapshot does not hold. A warning bears where the walk went from its component for `--outgoing`,
  and for what refers to a component where its component is not of the start and, for a path that was not
  followed, where its names can be in the answer (`engines/warnings.ts`, decision record 0074). `mayMiss`, which
  the exit code `5` follows, is true only when something of an analysed type was not read or its analysis had an
  error. Which types an analysis read is kept with the analysis (`snapshot_analysis.types`), not derived from the
  version that answers. A statement of the graph that takes many ids starts from that list and walks no table: a
  test reads every query plan.
- A flow runs its elements, so an impact answer takes the two together (decision record 0066). An element that is
  found brings its flow, a result of the same depth with the reference of that element, unless the flow was found
  nearer, and the walk goes on from the flow. An element that is asked about brings its flow into the start of what
  refers to it. For `--outgoing`, a flow that is found is walked from its elements, which are no results. A name
  such as `Invoice_After_Save.Update_Account` finds an element. An answer names the flows in it whose active
  version has a newer one beside it (`newerVersions`), and that is no gap.
- A component of a snapshot of an org is of a managed package where the org lists it with the prefix of the
  package and a state of an installed one, under the listed name or the name it came back with
  (`store/packages.ts`, decision record 0076). A part the analysis makes of it, such as an element of a flow, is of
  its package. The prefix in a name plays no part, and nothing of a snapshot of a repository is of a package. An
  answer about what refers to a component leaves a component of a package out, counts it (`packagesLeftOut`) and
  walks on through it. `--packages` keeps it. An answer about what a component refers to leaves nothing out. A
  component of a package that the org listed and that is not in the snapshot makes its type partial for an answer
  only where a reference of the snapshot names it (a chain can go through it), or for what refers to a component
  with `--packages`.
- A snapshot of an org is cross-checked (decision records 0034 and 0045). `snapshot` asks the Dependency API of
  Salesforce after the last chunk and stores its rows beside the snapshot, as Salesforce wrote them
  (`store/dependencies.ts`). They are no references: the graph never reads them, and `impact` never shows one. Every
  analysis holds them against what it found (`engines/cross-check.ts`) and keeps the comparison
  (`snapshot_analysis.cross_check`), so `analyse` compares again without the org. An end of a row is matched by the id
  the org listed the component with. A row from a flow carries the id of a version of it, and the org lists a flow with
  the id of its latest version: so the snapshot asks the org for the ids of the active and the latest version of each
  flow, and of every other version, and keeps them with the rows (decision records 0067 and 0078). A name is taken only
  where there is no id: for a standard object, and for a component the org listed without one. A pair Salesforce reports
  and the analysis lacks is the error `REFERENCE_MISSED` of the analysis. A pair only the analysis has is no error. An
  answer that Salesforce cut off can hold fewer rows than the limit, so the query for every row never stands for the
  org: the rows are always asked for per type, then whatever is of another type, and each type that shows there by name.
  An answer that holds half the limit or more is asked for in parts. An answer of fewer rows, of which every page came,
  is held against every row the reading holds in the end: a row of its query that another query gave and it lacks shows
  that it was cut off (decision record 0069). The reading is `whole` only where no answer shows that a row is missing.
  It never fails a snapshot and never makes it partial: an org that does not answer leaves a warning.
- A snapshot of an org asks the org to describe each object it holds a file of, after the cross-check and also without
  it (decision records 0080, 0085 and 0086). The objects are the components of the type `CustomObject` that came back,
  by the name the org listed them with, or the one they came back with where the org did not list them. A refusal that
  holds for every request, such as a used-up limit of requests, stops the reading. Of each description only the fields,
  their types, the objects a lookup points at and the child relationships are kept, as one JSON object beside the
  snapshot (`store/descriptions.ts`), so that an analysis can check a name against the org without the org. An object
  the org does not know, or does not describe, leaves the warning `DESCRIPTIONS_PARTIAL`, and never fails the snapshot
  or makes it partial. Nothing of the analysis reads the descriptions yet.
- A snapshot of an org reads every type and is judged over the logic tier (decision records 0038, 0046 and 0068).
  The tier is a list of names of the Metadata API in `core/tiers.ts`, and a type is of it by its own name. Every
  type an analyser reads is on it: a type joins in the pull request that analyses it, and a test fails until it
  does. What the org listed and did not hand out, a listing it refused, a retrieve that failed and a file that
  cannot be read as metadata are an `error` in the tier, which makes the snapshot `partial`, and a `warning`
  outside it, which does not. Each such issue says which in `details.tier`. What nothing tells the type of counts
  against the tier. A component of a managed package that the org lists and does not hand out is a warning in any
  tier (`details.ofPackages`, decision record 0076).
  Where the Salesforce library falls short, the word of the org is taken (decision record 0047): a file in a
  folder the library knows no type for is counted by the type the org describes with that folder, and a
  component of a package that comes back without the prefix of the package is the one the org listed, when the
  retrieve asked for the listed name and not for the short one. The same is done for a document, which the org
  lists with the ending of its file and the library names without it, and for what belongs to person accounts,
  which the org lists under the object `Account` and hands out under `PersonAccount` (decision record 0071), and
  for a report, a dashboard and their folders in a folder that lies in a folder, which the org lists without the
  outer folders and hands out under the whole path (decision record 0072). The keys and the files keep the name
  that came back, and the row of the listed name keeps it too (`inventory_item.came_back_as`, decision record
  0076), so that the cross-check matches a row by the id the org listed to the component the snapshot holds. A
  part comes with its parent and is not named in a retrieve, with one exception (decision record 0049): when
  Salesforce cannot find a parent the org does not list, its listed parts are asked for by their own names in one
  more retrieve. That is done only for a parent the Salesforce library keeps with a file
  for every part, such as an object.
  The file of custom labels is not missing when the org lists no label. Where the org hands out a version of a flow
  that is not active, the snapshot asks for the active version by the number its definition names, and keeps it
  under the path of the flow, with the note `FLOW_NEWER_VERSION` (`api/flow-versions.ts`, decision records 0060 and
  0062). A snapshot of a Git source is not judged by tier. An impact answer counts such a warning when it can be
  about a type it covers (decision record 0046), which no snapshot is known to hold, since every analysed type is
  of the tier. `exclude_types` of an org source in `orglens.toml` leaves types outside the tier out of its
  snapshots (decision record 0048): the org is not asked for them, and the coverage keeps each with the listing
  `excluded`, so that a report and an answer can say that it was not read.
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
pnpm run bench:corpora      # the time of the built commands on the public codebases, needs a build and the codebases
pnpm run corpora:fetch      # downloads the public test codebases of fixtures/corpora.toml into .corpora
pnpm run corpora:listing    # their formulas, rules, flows and configuration, with what the analysis reports
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
- `fixtures/billing-sfdx` and its answer key `fixtures/expected/answer-key.v3.yaml` belong together
  (`fixtures/README.md`). The key is written by hand and is never changed to make an analyser pass. Change a fixture
  file and its entries in the key in the same pull request. `fixture-key.test.ts` says which entries moved.
  `answer-key.v0.yaml` is the key of Phase 0, which the Apex trial is scored with, `answer-key.v1.yaml` the key of
  Phase 1 and `answer-key.v2.yaml` the key of Phase 2. Every entry of an older version is in the newer ones as it is
  there: the Apex part of versions 0 to 2 is the same, every later version says about a file of fields or rules what
  version 1 says, and version 3 says about the files of Phase 2 what version 2 says. The test fails when they differ:
  change such an entry in every file that has it.
- A test of how a retrieve is split, repeated or continued uses the part of the project that `org-snapshot.test.ts`
  names, so that its numbers do not move when the project grows. A new file in a folder of that part is added to
  the list of what is left out of it.
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
