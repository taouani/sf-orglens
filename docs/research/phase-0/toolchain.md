# toolchain

## Summary
I built and ran a throwaway two-package workspace (engine library + thin CLI) on this Linux machine. It builds, lints, enforces layering, tests and runs on Node 22.23.4, 24.22.3 and 26.13.1; Windows and macOS were not testable here, so CI is the only verification for them. The registry has moved a long way: TypeScript 7.0.2 (native compiler, ships no JS API), vitest 5.1.0, eslint 10.14.0, zod 4.6.7, commander 15.1.0, pnpm 12.18.0, @salesforce/core 9.4.6 and source-deploy-retrieve (SDR) 13.12.0, both CommonJS and Node >=22. Node 26 is Active LTS, 24 is LTS, 22 is in maintenance. Recommended stack: pnpm workspace, ESM with module nodenext, `tsc -b` build, native Node type stripping for dev (no tsx), vitest, ESLint + typescript-eslint + Prettier, commander, smol-toml + zod, changesets, and npm trusted publishing. One trap: typescript-eslint 8.72.2 and dependency-cruiser 18.7.2 refuse TypeScript 7, so the TS 6 API package must be installed side by side; I verified that setup works. "Clients only use the engine API" is enforced by three independent mechanisms, each of which I saw fail a deliberate violation: the package `exports` map plus pnpm's strict node_modules (tsc TS2307), ESLint no-restricted-imports, and dependency-cruiser layer rules. Startup cost drives the design: commander hello is about 50 ms, oclif about 125-140 ms, and importing @salesforce/core adds about 400 ms (SDR about 500 ms), so the Salesforce SDK must be lazy-loaded per command. fast-xml-parser defaults silently corrupt Salesforce metadata, and SDR's shared parser caps entity expansions at 50,000; the same cap on a standalone parser throws, so the tool needs its own parser configuration. Not verified: GitHub Actions versions beyond README/docs, Windows/macOS behaviour, and the first-publish flow for npm trusted publishing. [A finding about data in one of the earlier private prototypes was removed from this public copy. Its consequence: no recorded API responses and no fixtures are copied from the prototypes.]

## Recommendation
Working reference scaffold: /tmp/claude-0/phase0-research/toolchain/scaffold (TS 6 only) and /tmp/claude-0/phase0-research/toolchain/scaffold-ts7 (TS 7 + TS 6 side by side). `<scope>` and `<cli>` below stand for the package names the owner still has to choose.

**1. Package manager and layout**
- Recommended: pnpm 12.18.0 workspace, pinned in `packageManager`, with two packages in Phase 0: `packages/engine` and `packages/cli`. Later clients (`server`, `web`, `llm`) become further packages that depend only on the engine.
- Runner-up: npm workspaces with the same layout. No extra tool, but hoisted node_modules would not block undeclared imports, so only lint and dependency-cruiser would guard the boundary.
- Not recommended: a single package. It loses the `exports`-map boundary.
- Inside the engine: `src/{core,sources,extraction,store,engines,api}`. `src/index.ts` re-exports `api/` only; package `exports` exposes only `.`.
- Enforcement, all in CI:
  - `tsc -b`: the exports map and pnpm strictness make deep or undeclared imports a TS2307 error.
  - ESLint `no-restricted-imports` on client packages: no `<engine>/*`, `@salesforce/*`, SQLite driver or XML parser.
  - dependency-cruiser: no circular imports, no forward imports between layers, clients reach the engine only via its entry, the engine never imports clients, `@salesforce/*` only under `sources/` (and `api/` wiring), plus a not-to-unresolvable rule.

**2. TypeScript, build, dev runtime**
- ESM everywhere (`"type": "module"`, module and moduleResolution `nodenext`). The CommonJS Salesforce packages import fine.
- Compiler, recommended: TS 7.0.2 as `@typescript/native` (provides `tsc`) plus `typescript` aliased to `@typescript/typescript6@6.0.2` for typescript-eslint and dependency-cruiser.
- Compiler, runner-up: plain `typescript@6.0.3` everywhere. Simpler; build takes 3.7 s instead of 0.3 s on the scaffold.
- Flags: use the scaffold's tsconfig.base.json as is. `erasableSyntaxOnly` means no enums, namespaces or parameter properties.
- Build, recommended: `tsc -b` with project references, with a clean step first.
- Build, runner-up: tsdown 0.23.7 to bundle the published CLI. It halves startup (109 ms to 53 ms) but is 0.x and would oblige shipping third-party notices. Record it as the lever if the startup budget fails.
- Dev runtime, recommended: native type stripping with a custom export condition (`node --conditions=<scope>/source packages/cli/src/bin.ts`). Runner-up: tsx 4.23.15 (not tested here).
- Node: `.node-version` 24 for dev and release; `engines.node` `^22.13.0 || >=24`. Raise the floor to 24 if the store uses node:sqlite.

**3. Tests**
- Recommended: vitest 5.1.0 + @vitest/coverage-v8 5.1.0. Runner-up: node:test.
- Golden files: plain JSON under `fixtures/expected/`, written with `toMatchFileSnapshot`. Use one canonical serializer (sorted keys, sets sorted, LF, trailing newline) and `.gitattributes` forcing LF.
- CI fails on a missing or changed golden (verified). Updates happen only through `vitest -u` in a reviewed PR.
- Start coverage thresholds modest and ratchet up; the old repo gated at 88%.
- Reuse from the Python repos:
  - Copy the input fixtures, sample_sfdx project and SymbolTable JSON after owner review.
  - Convert `golden_questions.json` grounding lists into deterministic expected sets for the fixture project.
  - [A finding about data in one of the earlier private prototypes was removed from this public copy. Its consequence: no recorded API responses and no fixtures are copied from the prototypes.]
  - Author expected outputs fresh; none exist to port.

**4. Lint, format, hygiene**
- Recommended: ESLint 10.14.0 + typescript-eslint 8.72.2 (`strictTypeChecked` + `stylisticTypeChecked`, `projectService`, `defineConfig` from `eslint/config`) + Prettier 3.10.0. Add knip 6.45.1 and publint 0.3.25 as CI checks.
- Runner-up: Biome 2.6.7 (very fast, but type-aware rules are still nursery).
- Hygiene: squash-merge PRs with Conventional-Commit-style titles; a changeset in every user-visible PR; a PR template with tests / changeset / ADR / docs / sub-agent-review checkboxes; branch protection requiring CI. No mandatory git hooks.

**5. CLI framework**
- Recommended: commander 15.1.0 (about 50 ms, one package, ESM, typed).
- Runner-up: oclif (@oclif/core 5.1.12, about 125-140 ms, 39 packages). Use it only if a Salesforce CLI plugin is wanted; that can later be a separate thin package over the engine API.
- Conventions:
  - Each command lives in its own module, loaded by dynamic import, so `@salesforce/*` loads only for commands that need an org.
  - stdout carries only the result; progress and logs go to stderr; no spinner when not a TTY, under `--json` or in CI.
  - `--json` prints one envelope: `{ schemaVersion, command, ok, data, warnings[], error{code,message,hint} }`.
  - Exit codes, to be fixed in an ADR: 0 ok; 1 internal error; 2 usage or config error (via commander `exitOverride`, since its default is 1); 3 gate breached; 4 auth or connection failure; 5 partial result.
  - A CI test asserts a startup budget for a no-org command.

**6. Config and schemas**
- Recommended: smol-toml 1.9.1 to parse and zod 4.6.7 to validate (`strictObject`, `discriminatedUnion` on `kind`, a `schema_version` field).
- Runner-up: valibot 1.5.0 + @valibot/to-json-schema (5 ms import versus 42 ms).
- Report TOML errors with line and column, and zod errors with the path.
- Edit the file for `source add|remove` with @decimalturn/toml-patch 3.3.2 so comments survive.
- Generate JSON Schemas with `z.toJSONSchema` (draft 2020-12) into a committed `schemas/` folder: one for the config, one per `--json` payload. A test fails if generated and committed schemas differ; another validates real CLI output with Ajv 8.20.0.

**7. XML**
- Recommended: fast-xml-parser 5.12.0 (already in the SDR tree) through one engine-owned wrapper:
  - `parseTagValue:false`, `parseAttributeValue:false`, `trimValues:false`, `ignoreAttributes:false`;
  - a per-metadata-type `isArray` path table;
  - an explicit, generous entity limit;
  - validation switched on;
  - `preserveOrder` only for types where sibling order matters.
- Do not use SDR's `parseXml` for content: its shared parser sets a 50,000 entity-expansion cap and has no array normalisation.
- Runner-up: saxes 6.0.0 streaming for the few multi-MB types, if measurement on the real org shows a need.

**8. CI**
- ci.yml: on push to main and pull_request; `permissions: contents: read`; `concurrency` cancel-in-progress; fail-fast false.
- Matrix: ubuntu-latest x Node 22, 24, 26; windows-latest x 22, 26; macos-latest x 24.
- Steps: checkout, pnpm/action-setup (version from `packageManager`), setup-node with `cache: pnpm`, `pnpm install --frozen-lockfile`, then build, lint, format check, dependency-cruiser, knip, test with coverage.
- One extra Linux job: pack, install the tarballs with npm into an empty directory, run the bin, run publint.
- Pin actions by commit SHA and enable Dependabot or Renovate for actions and npm.
- Carry over from the old repos: the affordable-matrix idea, separate named steps, a coverage gate, and build-then-publish with OIDC.
- Replace the nightly LLM eval with a `live-org.yml` (schedule + workflow_dispatch, protected environment, skips cleanly when secrets are absent, never on fork PRs) that runs the real-org retrieve smoke test.

**9. Release**
- Recommended: changesets 3.0.3 with engine and CLI in one `fixed` group; hand-written `.changeset/config.json` (init is interactive); pre mode with tag `alpha` giving 0.1.0-alpha.N.
- Runner-up: release-please 17.11.2 (needs Conventional Commits; not tested here).
- Publish from release.yml on Node 24 using trusted publishing (OIDC, `id-token: write`, a GitHub environment), with provenance, to a non-`latest` dist-tag.
- In Phase 0 only rehearse: `pnpm publish --dry-run` plus the pack-and-install smoke test. Actual publishing waits on the owner's name decision.

**10. Repository hygiene**
- Files: LICENSE (Apache-2.0 text), a short NOTICE copied into each published package (pnpm copies only LICENSE), `license` field in every package.json, README, CONTRIBUTING, SECURITY.md, CODE_OF_CONDUCT (Contributor Covenant), CHANGELOG via changesets, issue forms, PR template, CODEOWNERS, `.editorconfig`, `.gitattributes`.
- Headers: no per-file headers; the licence does not require them. Runner-up: one-line SPDX identifiers.
- Contributions: DCO sign-off, relying on Apache-2.0 section 5. Runner-up: a CLA, only if the owner wants future relicensing freedom.
- ADRs: `docs/adr/NNNN-kebab-title.md`, keeping the old format (Status, Date, Deciders; Context, Decision, Consequences, Alternatives considered) plus an "Evidence" section linking trial results; a `0000-template.md`; an index README.

**11. Logging and doctor**
- Logging:
  - No logging dependency: a small JSON-lines logger in the engine.
  - Every run writes a debug-level file under the workspace `logs/` folder, keeping the last 20.
  - `--verbose` mirrors debug output to stderr; `--quiet` silences progress.
  - Redact access tokens, Authorization headers and auth URLs before writing.
  - Document that @salesforce/core keeps its own log under `~/.sf`, controlled by SF_LOG_LEVEL and SF_DISABLE_LOG_FILE.
- `doctor` checks, each pass / warn / fail with a hint, also as `--json`, non-zero exit on any fail:
  - Node version against engines; OS and arch; tool version.
  - Workspace found and writable; config parses and validates.
  - SQLite opens, with its version, schema version and an integrity check.
  - `sf` CLI on PATH (optional); `~/.sf` readable.
  - Per org source: login present, token refresh works, API version, remaining API requests, Metadata / Tooling / Dependency API reachable.
  - Per repo source: path exists, `sfdx-project.json` valid, git available.
  - Environment: JWT env vars complete and key file readable; proxy and CA variables; Linux keychain availability; free disk space; Windows long-path support.

**Scaffold file tree for Phase 0**
```
.changeset/config.json
.dependency-cruiser.cjs
.editorconfig
.gitattributes
.gitignore
.github/CODEOWNERS
.github/ISSUE_TEMPLATE/{bug.yml,feature.yml,config.yml}
.github/PULL_REQUEST_TEMPLATE.md
.github/dependabot.yml
.github/workflows/{ci.yml,release.yml,live-org.yml}
.node-version
.prettierignore
.prettierrc.json
CHANGELOG.md  CODE_OF_CONDUCT.md  CONTRIBUTING.md  LICENSE  NOTICE  README.md  SECURITY.md
docs/adr/{README.md,0000-template.md,0001-...}
docs/plans/phase-0.md
docs/test-plans/phase-0.md
docs/research/            (trial results, benchmarks)
eslint.config.js
knip.json
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
tsconfig.base.json
tsconfig.json             (references only)
vitest.config.ts
schemas/                  (generated JSON Schemas, committed)
fixtures/sf-project/      (sfdx-project.json + force-app/...)
fixtures/expected/        (golden JSON, known answers)
packages/engine/package.json
packages/engine/tsconfig.json
packages/engine/src/index.ts
packages/engine/src/{core,sources,extraction,store,engines,api}/
packages/engine/test/tsconfig.json
packages/engine/test/**/*.test.ts
packages/cli/package.json
packages/cli/tsconfig.json
packages/cli/src/bin.ts
packages/cli/src/commands/
packages/cli/src/output/  (json envelope, progress, exit codes)
packages/cli/test/tsconfig.json
packages/cli/test/**/*.test.ts
scripts/                  (schema generation, smoke-pack)
```

**Versions installed and run together in the scaffold** (Node 22.23.4; tsc, ESLint, dependency-cruiser and vitest also on 24.22.3 and 26.13.1)
- Tooling: pnpm 12.18.0; typescript 6.0.3 or the pair @typescript/typescript6@6.0.2 (as `typescript`) + typescript@7.0.2 (as `@typescript/native`); @types/node 22.20.5; vitest 5.1.0; @vitest/coverage-v8 5.1.0; eslint 10.14.0; @eslint/js 10.0.1; typescript-eslint 8.72.2; prettier 3.10.0; dependency-cruiser 18.7.2; knip 6.45.1; publint 0.3.25; @changesets/cli 3.0.3; tsdown 0.23.7 (optional).
- Runtime: commander 15.1.0; zod 4.6.7; smol-toml 1.9.1; fast-xml-parser 5.12.0; @salesforce/core 9.4.6; @salesforce/source-deploy-retrieve 13.12.0.
- Verified only in separate scratch projects, not inside the workspace: ajv 8.20.0, @decimalturn/toml-patch 3.3.2, saxes 6.0.0, better-sqlite3 13.1.1.

## Plan tasks
- Get owner decisions that block the scaffold: package scope and CLI package name, copyright holder for LICENSE/NOTICE, minimum Node (22 or 24), DCO or CLA, and whether anything is published to npm in Phase 0.
- Create the repository with the root files: package.json (private, type module, packageManager pnpm@12.18.0, engines), pnpm-workspace.yaml, .node-version, .gitignore, .gitattributes (LF for all text, especially fixtures), .editorconfig, LICENSE, NOTICE, README.
- Write ADR 0000-template and the first toolchain ADRs under docs/adr/: package manager and layout; ESM and TypeScript setup (TS 7 with TS 6 alias); CLI framework; test and golden-file approach; config format and schema library; exit codes and --json envelope; release and versioning. Each cites the measurements from this research.
- Commit docs/plans/phase-0.md and docs/test-plans/phase-0.md so the plan and test plan live in git from the first PR.
- Add tsconfig.base.json, the root tsconfig.json with references, and the packages/engine and packages/cli skeletons with the layer folders, the exports map with the dev source condition, publishConfig.exports, and `files` negations for .tsbuildinfo.
- Add eslint.config.js (defineConfig, strictTypeChecked, projectService, no-restricted-imports for client packages), Prettier config, .dependency-cruiser.cjs with the layer rules and not-to-unresolvable, and knip.json.
- Add vitest.config.ts with the source condition, coverage thresholds, a per-package test/tsconfig.json, one real unit test per package, and one golden-file test writing to fixtures/expected/.
- Add a negative boundary test to CI: a script that injects a forbidden import into a temp copy and asserts that tsc, ESLint and dependency-cruiser each fail.
- Implement the CLI shell with commander: the command tree as stubs (source add|list|remove, snapshot, impact, compare, access, coverage, status, doctor), lazy per-command imports, the --json envelope, the exit-code mapping via exitOverride, stderr-only progress, and --verbose / --quiet.
- Implement workspace discovery and orglens.toml: the zod schema with schema_version and source declarations, smol-toml parsing with line/column errors, comment-preserving edits for source add|remove, and tests for bad files.
- Add scripts/generate-schemas and commit schemas/ for the config and the JSON envelope; add the drift test and an Ajv test validating real CLI output.
- Implement the JSON-lines file logger with redaction and log retention, and the first version of `doctor` with the checks that need no org.
- Implement the engine XML wrapper around fast-xml-parser with the safe options and the per-type array table; add tests for leading zeros, apiVersion, whitespace, single-versus-array, malformed input and a file with more than 50,000 entities.
- Add .github/workflows/ci.yml with the Linux/Windows/macOS matrix on Node 22/24/26, pnpm cache, all check steps, and the pack-install-run smoke job; get it green on all three operating systems before adding features.
- Add a CLI startup-budget test for a no-org command and record the baseline in docs/research/.
- Add changesets with a hand-written config (fixed group, pre mode alpha) and .github/workflows/release.yml as a dry run using OIDC permissions and a GitHub environment; do not publish until the owner decides.
- Add .github/workflows/live-org.yml (schedule and manual, protected environment, skip when secrets are absent) for the real-org retrieve smoke test using JWT env vars.
- Add CONTRIBUTING, SECURITY.md, CODE_OF_CONDUCT, issue forms, the PR template (including the sub-agent review checkbox), CODEOWNERS and dependabot.yml; turn on branch protection requiring CI.
- Seed fixtures/sf-project v0 from the reviewed old input fixtures and sample SFDX project, and write the first known-answer files in fixtures/expected/, using golden_questions.json grounding lists as a starting point.

## Risks
- Windows and macOS were not tested. Path separators, CRLF in golden files, bin shims, long metadata paths and SQLite file locking can only be confirmed by CI; budget time for the first cross-platform run to fail.
- Two TypeScript versions side by side means lint (TS 6 checker) and build (TS 7 checker) can disagree in rare cases, and TS 7.1 will bring a new API that changes this setup again. Fallback is a one-line switch to typescript@6.0.3.
- typescript-eslint and dependency-cruiser have no announced date for TS 7 support; the alias arrangement may last several releases.
- pnpm 12 edits pnpm-workspace.yaml by itself when a very new version is added (minimumReleaseAgeExclude), and adds about 1.2 s to every `pnpm run`. Reviewers will see unexpected diffs unless this is documented.
- Corepack is absent from Node 26, so contributor setup instructions differ by Node version; CI must install pnpm with the action.
- The Salesforce SDK tree is large (246 packages, 80 MB), currently carries 5 high-severity npm audit advisories through proxy-agent, and costs about 0.4-0.5 s to import. An eager import anywhere on a common path makes every command slow.
- fast-xml-parser defaults corrupt values silently. Any code path that parses XML outside the engine wrapper (including SDR's own parseXml) reintroduces the bug, and a 50,000-entity cap like SDR's throws on very large files.
- Parsing a 20 MB profile takes over a second and several hundred MB of memory with fast-xml-parser; at 10,000+ components, parallel parsing of many large files could exhaust memory.
- zod adds about 42 ms to every command that validates config. Together with other eager imports this can breach a startup budget; bundling or valibot are the fallbacks.
- The dev-only export condition must be stripped at publish (publishConfig.exports). If that is forgotten the published package points at source files that are not shipped.
- Stale files in dist and .tsbuildinfo were packed in the rehearsal. Without a clean build and `files` negations, releases can ship dead code.
- npm trusted publishing: the docs do not say whether a package must exist before a trusted publisher can be configured, and a new configuration expires if unused for 2 days. The first publish may need a manual step.
- [A finding about data in one of the earlier private prototypes was removed from this public copy. Its consequence: no recorded API responses and no fixtures are copied from the prototypes.]
- tsdown, citty and clipanion are pre-1.0 or release candidates; adopting any of them for a core role adds churn risk.
- Action versions were read from READMEs and one docs example only; exact tags and SHAs must be confirmed when the workflows are written.
- Node 22 is in maintenance and nears end of life (date unverified, about April 2027). Supporting it costs matrix time and blocks a warning-free node:sqlite.

## Open questions
- What are the npm scope and package names for the engine and the CLI, and the GitHub owner (personal account or organisation)? I did not check availability, as instructed.
- Should anything be published to npm during Phase 0, or only rehearsed with dry runs until the repo is announced?
- Who is the copyright holder named in LICENSE and NOTICE?
- DCO or CLA: does the owner want to keep the option of relicensing or dual licensing later? If yes, a CLA is needed from the first outside contribution.
- Minimum supported Node: keep 22 (Salesforce packages allow it) or start at 24? This depends on whether the store uses node:sqlite or better-sqlite3.
- Is a Salesforce CLI plugin a real goal? If yes, when: it decides whether an oclif package is added later or oclif is adopted now.
- Compiler setup: accept TS 7 with the TS 6 alias (faster, two versions) or stay on TS 6.0.3 alone until typescript-eslint supports TS 7?
- Exit-code table: the old tool used exit 2 for 'impact threshold breached', while this proposal uses 2 for usage errors and 3 for gates. Which convention should users' CI scripts rely on?
- Which secrets and which org will the live-org CI job use, and may a scheduled job touch that org nightly?
- May the old repos' input fixtures (MIT-licensed, owner's own work) be copied into the new Apache-2.0 repo, and who reviews them for org-specific data first?
- Contacts for SECURITY.md and the code of conduct: which address should be published?
- Does DCO sign-off apply to commits authored by the AI assistant, and under whose name are they signed?
- Initial coverage threshold and startup-time budget: what numbers should CI enforce from day one?
- Could not verify: exact latest release tags of the GitHub Actions (API access was blocked), release-please behaviour, tsx, lefthook and commitlint, and whether a first publish with a non-latest tag still sets `latest` on npm.

## Findings
- [hands-on] Node release lines on 2026-11-11: 26.x is LTS 'Lithium', 24.x is LTS 'Krypton', 22.x is LTS 'Jod'. This machine runs Node 22.23.4 with npm 10.9.9.
  EVIDENCE: nodejs.org/dist/index.json: v26.13.1 (2026-11-10, lts=Lithium, npm 11.20.0), v24.22.3 (lts=Krypton, npm 11.19.1), v22.23.5 (lts=Jod, npm 10.9.9). `node -v` gave v22.23.4. I downloaded the 24.22.3 and 26.13.1 binaries into /tmp/claude-0/phase0-research/toolchain/nodes and ran the scaffold on both.
- [hands-on] @salesforce/core 9.4.6 and @salesforce/source-deploy-retrieve 13.12.0 are CommonJS, Apache-2.0, require Node >=22, and import cleanly from ESM with named imports.
  EVIDENCE: Neither package.json has a `type` field; main is lib/index and lib/src/index.js; engines.node is >=22.0.0. An ESM script doing `import { AuthInfo, Org, Connection, SfProject } from '@salesforce/core'` and `import { ComponentSet, MetadataResolver, RegistryAccess } from '@salesforce/source-deploy-retrieve'` ran; RegistryAccess reported 542 metadata types. Installing both gives 246 packages and 80 MB of node_modules. `npm audit` reports 5 high advisories, all via SDR -> proxy-agent -> basic-ftp.
- [hands-on] Importing the Salesforce SDK is the dominant startup cost, so it must be lazy-loaded per command.
  EVIDENCE: Cold dynamic import, Node 22: @salesforce/core 366-463 ms; SDR (includes core) 505-516 ms. Scaffold `orgs` command, which lazily imports core: 594 ms median versus 109 ms for `hello`. Other imports: zod 42 ms, zod/mini 39 ms, valibot 5 ms, typebox 73 ms, fast-xml-parser 27 ms, smol-toml 7 ms, ajv 26 ms.
- [hands-on] TypeScript `latest` is 7.0.2 (native compiler). It ships no JS API, and typescript-eslint 8.72.2 and dependency-cruiser 18.7.2 do not work with it.
  EVIDENCE: `npm view typescript dist-tags`: latest 7.0.2 (published 2026-07-08), 6.0.3 (2026-04-16), beta 7.1.0-beta. The TS 7 `exports['.']` is ./lib/version.cjs. typescript-eslint peer range is `typescript >=4.8.4 <6.1.0` (canary too). With only TS 7 installed, ESLint aborts with 'typescript-eslint does not support TS 7.0' and dependency-cruiser prints 'Support for typescript@>=7 will follow when its API is published and stable'. `tsc -b` and vitest still work.
- [hands-on] The officially documented side-by-side setup works: `typescript` aliased to the TS 6 API package and `@typescript/native` aliased to TS 7.
  EVIDENCE: devDependencies `"typescript": "npm:@typescript/typescript6@6.0.2"` and `"@typescript/native": "npm:typescript@7.0.2"` give two bins: `tsc` (7.0.2) and `tsc6` (reports 6.0.3). `tsc -b` on the two-package scaffold takes 0.32 s with TS 7 versus 3.7 s with TS 6.0.3. ESLint type-checked rules, dependency-cruiser and vitest all pass. The TS 7 announcement describes these aliases, says 7.0 'does not ship with an API', and expects 7.1 to ship a new, different API.
- [hands-on] Native type stripping runs .ts directly, unflagged and without warnings, on Node 22.23.4, 24.22.3 and 26.13.1; enums fail (erasable syntax only).
  EVIDENCE: `node a.ts` with a relative `.ts` import printed the result on all three versions with no warning; a file with `enum` threw a SyntaxError on all three. Node docs: enabled by default from v22.18.0 / v23.6.0; marked stable in v24.12.0 / v25.2.0; still 'Stability 1.2 - Release candidate' in the v22 docs; `--experimental-transform-types` removed in v26.0.0. Node refuses to strip types under node_modules. The docs' recommended tsconfig is module nodenext, rewriteRelativeImportExtensions, erasableSyntaxOnly, verbatimModuleSyntax.
- [hands-on] A custom export condition lets the CLI and tests run across workspace packages from source with no build step and no tsx.
  EVIDENCE: Engine exports `{ '@scaffold/source': './src/index.ts', types: './dist/index.d.ts', default: './dist/index.js' }`. With dist deleted, `node --conditions=@scaffold/source packages/cli/src/bin.ts hello` works; without the condition it fails with ERR_MODULE_NOT_FOUND. Vitest picks it up via `resolve.conditions` and `ssr.resolve.conditions`; the test tsconfig via `customConditions`. `pnpm pack` applies `publishConfig.exports`, so the published package.json does not carry the dev condition.
- [hands-on] The scaffold tsconfig compiles under both TS 6.0.3 and TS 7.0.2.
  EVIDENCE: tsconfig.base.json: target/lib es2023, module and moduleResolution nodenext, types [node], strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride, noImplicitReturns, noFallthroughCasesInSwitch, noPropertyAccessFromIndexSignature, verbatimModuleSyntax, erasableSyntaxOnly, isolatedModules, rewriteRelativeImportExtensions, composite, declaration, declarationMap, sourceMap. Project references with `tsc -b` emit ESM with `.ts` imports rewritten to `.js`.
- [hands-on] pnpm 12.18.0 installs via corepack on Node 22 and its strict node_modules blocks undeclared imports in the CLI package.
  EVIDENCE: `corepack prepare pnpm@12.18.0` worked; cold install of 404 packages took 6.3 s. packages/cli/node_modules contains only @scaffold/engine and commander. A CLI file importing `@salesforce/core` or `@scaffold/engine/src/store/memory.ts` fails `tsc -b` with TS2307. I did not run the same test under npm workspaces.
- [hands-on] pnpm 12 has supply-chain behaviours the plan must account for.
  EVIDENCE: Adding very recently published versions (@salesforce/core@9.4.6, prettier@3.10.0, better-sqlite3@13.1.1) made pnpm write `minimumReleaseAgeExclude` entries into pnpm-workspace.yaml on its own. `pnpm run` first prints 'Verifying lockfile against supply-chain policies', about 1.2 s per invocation. better-sqlite3 13.1.1 installed and loaded with no build-approval step (2 packages, SQLite 3.54.1).
- [hands-on] Corepack is not bundled with Node 26, so CI and docs cannot rely on it to provide pnpm there.
  EVIDENCE: node-v26.13.1-linux-x64/bin contains node, npm and npx only; the 24.22.3 tarball also has corepack. The pnpm/action-setup README shows @v6 and reads the version from the `packageManager` field.
- [hands-on] Layering is mechanically enforceable; deliberate violations were caught by dependency-cruiser and ESLint.
  EVIDENCE: dependency-cruiser 18.7.2 with per-layer rules reported 'layer-sources-no-forward-imports: sources/bad.ts -> engines/impact.ts' and 'clients-use-engine-api-only: cli/src/commands/bad.ts -> engine/src/store/memory.ts'. ESLint no-restricted-imports flagged the deep engine imports and `@salesforce/core` in the CLI. Caveat: dependency-cruiser did not flag a deep import by package name that failed to resolve, so the config also needs a not-to-unresolvable rule; tsc catches that case.
- [hands-on] ESLint 10.14.0 + typescript-eslint 8.72.2 type-checked linting works with flat config and projectService, with two setup details.
  EVIDENCE: `tseslint.config()` is flagged as deprecated in favour of `defineConfig` from 'eslint/config'. Test files must belong to a tsconfig; a `test/tsconfig.json` per package fixed 'was not found by the project service'. A clean run takes about 3.9 s.
- [hands-on] Biome 2.6.7 is far faster than ESLint, but its type-aware floating-promise rule is still in the nursery group.
  EVIDENCE: `biome lint` checked 8 files in 7 ms and caught a floating promise, but `biome explain noFloatingPromises` shows category lint/nursery and the diagnostic says the rule 'is not yet stable'.
- [hands-on] vitest 5.1.0 works for unit tests, v8 coverage with thresholds, and language-neutral golden JSON files; under CI a missing golden fails instead of being written.
  EVIDENCE: 5 tests across 2 packages pass in about 0.45 s. `expect(json).toMatchFileSnapshot('fixtures/expected/account-fields.json')` writes plain JSON on the first local run. With CI=true and the file removed, the test fails with 'Snapshot ... mismatched' and no file is created. File snapshots are written after the test ends, so the same test cannot read the file back on the first run.
- [hands-on] node:test is a viable runner-up: it runs .ts tests, has file snapshots and has coverage.
  EVIDENCE: On Node 22.23.4 and 26.13.1, `node --test` ran a .ts test using `t.assert.fileSnapshot` with a JSON serializer (written with --test-update-snapshots), and `--experimental-test-coverage` printed a coverage table. The coverage flag is still named experimental.
- [hands-on] CLI hello-world startup: citty about 40 ms, commander about 50 ms, clipanion about 50 ms, oclif about 125-140 ms, against a bare Node baseline of about 30-34 ms.
  EVIDENCE: 40 timed spawns each after 5 warm-ups on a 4-vCPU Linux VM, Node 22.23.4, medians: baseline 30-34 ms; citty 0.2.2 39-45 ms; commander 15.1.0 48-54 ms; clipanion 4.0.0-rc.4 49 ms; @oclif/core 5.1.12 133-141 ms without a manifest and 124 ms with oclif.manifest.json. Node 26.13.1 gave the same picture (commander 49 ms, oclif 143 ms).
- [hands-on] oclif is much heavier than commander, and commander's default exit code for usage errors is 1.
  EVIDENCE: @oclif/core 5.1.12: 39 packages, 4.4 MB installed, CommonJS, Node >=22; the oclif dev CLI 6.0.15 adds 132 packages and 57 MB. commander 15.1.0: one package, 252 KB, ESM, Node >=22.12, bundled types. citty is 0.2.2 (pre-1.0) and clipanion's latest is a release candidate. commander exits 1 on an unknown command and on an unknown option. @salesforce/sf-plugins-core 13.0.9 depends on @oclif/core ^5 and @salesforce/core ^9.1.10.
- [hands-on] Eager imports roughly double CLI startup; bundling halves it; the Node compile cache gives about 15-20%.
  EVIDENCE: Scaffold `hello`, which eagerly imports the engine with zod, smol-toml and fast-xml-parser: 109 ms unbundled tsc output; 92 ms with `module.enableCompileCache()`; 53 ms as a single 458 KB tsdown 0.23.7 bundle with @salesforce/* external. Running from source with type stripping: 154 ms.
- [hands-on] smol-toml 1.9.1 + zod 4.6.7 covers config parsing, validation and JSON Schema generation; the generated schema compiles in Ajv strict mode.
  EVIDENCE: TomlError exposes line and column (a bad value reported line 2, col 5). `z.strictObject` and `z.discriminatedUnion` reject a misspelt key with path `sources[0]` via `z.prettifyError`. `z.toJSONSchema(schema, { target: 'draft-2020-12' })` emitted a schema with oneOf and additionalProperties:false; `.meta({ id })` produces $defs/$ref. Ajv 8.20.0 (Ajv2020, strict) compiled it, accepted the good document and rejected a bad one. zod 4.6.7 is already a dependency of @salesforce/core 9.4.6. @iarna/toml was last published in 2023; @ltd/j-toml is LGPL-3.0.
- [hands-on] `source add` and `source remove` cannot use a plain TOML stringify without destroying user comments; a comment-preserving patcher exists.
  EVIDENCE: `smol-toml` stringify of the parsed file drops every comment. `@decimalturn/toml-patch` 3.3.2 (MIT, published 2026-10-31) appended a new [[sources]] table while keeping both comments in the test file.
- [hands-on] fast-xml-parser 5.12.0 default options silently corrupt Salesforce metadata values.
  EVIDENCE: Defaults turned `<precision>018</precision>` into 18, `<apiVersion>65.0</apiVersion>` into 65, `<label>1e5</label>` into 100000, `<fullName>0012</fullName>` into 12 and `0x1F` into 31; trimmed formula whitespace; returned a single `<fields>` child as an object, not an array; and parsed the malformed `<a><b>1</a>` without error (XMLValidator does report it). With parseTagValue:false, parseAttributeValue:false, trimValues:false and an `isArray` callback keyed on the path, all values are preserved as strings and arrays are stable.
- [hands-on] Object-mode XML parsing loses the order of mixed sibling elements; preserveOrder keeps it at the cost of a different output shape.
  EVIDENCE: `<Flow><decisions/><assignments/><decisions/></Flow>` parses to `{decisions:[D1,D2], assignments:{...}}` in object mode; `preserveOrder:true` returns an ordered array of single-key nodes.
- [hands-on] SDR already ships fast-xml-parser 5.12.0, but its shared parser is configured with a 50,000 entity-expansion cap; that cap throws on a file with more entity references.
  EVIDENCE: SDR lib/src/utils/metadata.js exports a parser with ignoreAttributes:false, parseTagValue:false, parseAttributeValue:false, cdataPropName '__cdata', processEntities { maxTotalExpansions: 50_000 } and no isArray. A standalone parser with the same cap threw 'Entity expansion count limit exceeded: 50001 > 50000' on a document with 60,000 x 3 entity references; default options parsed it. I did not call SDR's own parseXml on such a file.
- [hands-on] XML parse cost on large profiles: fast-xml-parser takes about 0.2 s for 4.4 MB and 1.3 s for 20 MB; saxes is 5-6 times faster.
  EVIDENCE: Synthetic Profile, 4.4 MB with 25,000 fieldPermissions: fast-xml-parser object mode 224 ms, preserveOrder 189 ms, saxes 6.0.0 42 ms, sax 1.6.1 158 ms. 20 MB with 120,000 fieldPermissions: 1261 ms, 875 ms, 206 ms and 738 ms; process RSS reached 882 MB after all parsers had run on the 20 MB file.
- [hands-on] node:sqlite prints an ExperimentalWarning on Node 22 and none on Node 24 or 26. This bears on the minimum Node version if the store area picks it.
  EVIDENCE: `new DatabaseSync(':memory:')` on 22.23.4 printed 'ExperimentalWarning: SQLite is an experimental feature' (SQLite 3.53.4); on 24.22.3 and 26.13.1 there was no warning (SQLite 3.54.1).
- [hands-on] changesets 3.0.3 handles fixed-version workspace packages and pre-release mode, but `changeset init` is interactive and hangs without a terminal.
  EVIDENCE: `changeset init` waited on a Yes/No prompt until killed. With a hand-written .changeset/config.json (`fixed: [[engine, cli]]`, access public), `changeset pre enter alpha` then `changeset version` set both packages to 0.1.0-alpha.0 and wrote the changelogs.
- [hands-on] A packed release installs and runs cleanly, with three packaging pitfalls to guard against.
  EVIDENCE: `pnpm pack` rewrote `workspace:*` to `0.1.0-alpha.0`. Installing both tarballs with npm into an empty directory gave a working bin (`scaffold hello --json`, `scaffold orgs`). Pitfalls seen: dist/.tsbuildinfo and a stale compiled file from an earlier build were packed until `files` negations were added; the root LICENSE is copied into each package but NOTICE is not. publint 0.3.25 reported 'All good!' and `pnpm publish --dry-run --tag alpha` ran.
- [docs] npm trusted publishing needs npm >=11.5.1 and Node >=22.14, GitHub-hosted runners, and `id-token: write`; provenance is automatic for a public package from a public repo.
  EVIDENCE: The npm docs page states those versions, shows an example with actions/checkout@v6 and actions/setup-node@v6 on Node 24, lists the fields to configure (owner, repository, workflow filename, optional environment), requires package.json `repository.url` to match the repo exactly, recommends 'Require two-factor authentication and disallow tokens' afterwards, and says a new configuration must publish within 2 days or it expires. It does not say whether the package must already exist. Node 22 ships npm 10.9.9, so the release job must run on Node 24 or later.
- [docs] pnpm publish supports trusted publishing and attaches provenance by default for public packages from public repos.
  EVIDENCE: The pnpm publish page says that under trusted publishing pnpm attaches provenance by default, with `--no-provenance` to opt out, and documents `--tag`, `--no-git-checks` and `publishConfig`. It gives no minimum pnpm version for trusted publishing.
- [docs] Current GitHub Actions versions and runner labels.
  EVIDENCE: READMEs show actions/setup-node@v7 (`cache: pnpm` requires pnpm to be installed first; V7 removed the dummy NODE_AUTH_TOKEN fallback) and pnpm/action-setup@v6. The runner-images README maps ubuntu-latest to Ubuntu 24.04 x64, windows-latest to Windows Server 2025 x64, macos-latest to macOS 26 arm64. The `gh` API was blocked in this session, so I could not confirm exact release tags; actions/checkout@v6 comes only from the npm docs example.
- [hands-on] What the old workflows did that is worth carrying over.
  EVIDENCE: ci.yml: push to main plus pull_request, fail-fast false, full version matrix on Linux and one version each on macOS and Windows (with a comment explaining path handling and `sf` discovery), separate lint / format / types / test steps, coverage gate 88%. release.yml: triggered by `v*` tags, build job separate from publish job, artifact handed over, publish in a named environment with `id-token: write` (OIDC, no token secret), package check before publish. evals.yml: nightly cron plus workflow_dispatch, exits 0 with a message when the secret is absent, minimum-score gate. The other repo's workflow adds `paths:` filters and minimal `permissions`.
- [hands-on] The old ADR format is short Nygard-style, in docs/adr/NNNN-kebab-title.md.
  EVIDENCE: Six ADRs, each titled `# ADR-000N: <title>` with bullets Status / Date / Deciders and sections Context, Decision, Consequences (6 of 6) and Alternatives considered (2 of 6).
- [hands-on] The old repos contain no expected-output JSON to reuse; what is reusable is input fixtures, one SymbolTable JSON and golden_questions.json.
  EVIDENCE: [A finding about data in one of the earlier private prototypes was removed from this public copy. Its consequence: no recorded API responses and no fixtures are copied from the prototypes.]
- [hands-on] @salesforce/core writes its own rotating log file and honours its own environment variables; `AuthInfo.listAllAuthorizations()` works with no logins.
  EVIDENCE: lib/logger/logger.js writes `sf-<date>.log` under Global.SF_DIR unless SF_DISABLE_LOG_FILE=true, and reads SF_LOG_LEVEL and SF_LOG_ROTATION_PERIOD. envVars.js defines SF_USE_GENERIC_UNIX_KEYCHAIN, SF_ACCESS_TOKEN, SF_ORG_INSTANCE_URL, SF_ORG_API_VERSION and SF_AUDIENCE_URL. core depends on pino 9.14.0 while pino `latest` is 10.4.0. The scaffold `orgs` command returned [] on this machine. No `sf` binary is installed here.
- [docs] Apache-2.0 does not require per-file headers, and contributions are inbound under the same licence by default.
  EVIDENCE: Section 5: contributions submitted for inclusion 'shall be under the terms and conditions of this License' unless stated otherwise. Section 4(d) applies only if the Work includes a NOTICE file. The appendix says to 'attach the following boilerplate notice' as the way to apply the licence; the only per-file obligation in Section 4 is marking modified files.
- [hands-on] Every package in the runtime dependency tree and the recommended dev tools carries a permissive licence.
  EVIDENCE: Licence fields across the 246 installed packages of core + SDR: MIT 180, Apache-2.0 36, ISC 11, BSD-3-Clause 7, BSD-2-Clause 5, BlueOak-1.0.0 3, (MIT OR GPL-3.0-or-later) 2, (MIT AND Zlib) 1, 0BSD 1. commander MIT, zod MIT, fast-xml-parser MIT, smol-toml BSD-3-Clause, better-sqlite3 MIT, @apexdevtools/apex-parser and apex-ls BSD-3-Clause, tree-sitter-sfapex MIT.
- [hands-on] The toolchain works on Node 24.22.3 and 26.13.1 as well as 22.23.4; knip and publint also run.
  EVIDENCE: On both extra Node versions: `tsc -b` ok, ESLint ok, dependency-cruiser 'no dependency violations found', vitest 5/5 passing, built CLI and run-from-source CLI both printing output. knip 6.45.1 correctly flagged the unused SDR dependency and unused exports.
- [unverified] Node 22 reaches end of life around April 2027.
  EVIDENCE: From memory of the Node release schedule; I did not open the schedule page.
- [unverified] Windows and macOS behaviour of this toolchain (path separators, CRLF in golden files, npm bin shims, long paths, SQLite file locking).
  EVIDENCE: Not testable on this Linux machine. The first green CI run on all three operating systems is the verification.
