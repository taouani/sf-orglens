# harvest-and-config

## Summary
The three old repos give Phase 0 six reusable designs and a long list of mistakes to avoid; nothing in them can be copied as code. C's coverage manifest is the right idea but is a hand-written, static list of free-text "areas" stored as one JSON blob; the new tool should measure coverage per snapshot and per metadata type, with separate retrieve and parse statuses and a second table per reference origin. C's single facade (OrgLensSession) is worth keeping as a pattern, with two fixes: plain JSON in and out, and no client reaching past it. For config, a committed orglens.toml can name a live org by its org id, and each colleague's alias is resolved locally; I verified hands-on that @salesforce/core lists local logins with org id and aliases without any network call. Git sources work as "repo + ref + set of sub-folders": @salesforce/source-deploy-retrieve (SDR) resolved arbitrary sub-folders with no sfdx-project.json and read a git ref through `git archive` without a checkout. The org-free key `Type:fullname[#sub]` round-trips for all 16 requested examples in a prototype, using SDR's own fullName so org and repo agree. The old edge types (23 Kuzu tables and 44 enum values in B, 12 in A, 9 in C) map onto 10 reference kinds plus attributes; a handful do not fit and several were mislabelled. The most serious retrieval lesson is that A and B retrieved by wildcard only, and Salesforce documents that a CustomObject wildcard does not return standard objects or their custom fields. A's Dependency API paging also relied on queryMore, which the docs say is unsupported, so it was capped at 2,000 rows. All six of B's ADRs are reversed in their specifics by the 27 recorded decisions; I propose 22 starting ADRs covering them.

## Recommendation
R1. COVERAGE (replaces C's manifest; measured, per snapshot, per metadata type)
Three tables, written by the snapshot pipeline inside the snapshot's transaction, never from a static list:
- snapshot_type_coverage(snapshot_id, metadata_type, scope, retrieve_status, parse_status, listed_count, retrieved_count, parsed_count, failed_count, parser_id, parser_version, detail). PK (snapshot_id, metadata_type). metadata_type is the exact registry name, child types included (CustomField, ValidationRule).
  - scope: requested | excluded_by_config | unsupported_by_tool | not_in_source.
  - retrieve_status: retrieved | partial | failed | not_retrieved | read (git sources).
  - parse_status: parsed | partial | not_parsed (no parser yet) | failed | n/a.
- snapshot_origin_coverage(snapshot_id, origin, metadata_type, status, components_total, components_analysed, references_emitted, unresolved_count, detail). origin is one of parser:xml, parser:formula, parser:flow, parser:apex, symboltable, dependency-api. status: complete | partial | failed | not_run | not_applicable. Examples: symboltable is not_applicable for git sources and partial when N classes return null; dependency-api is partial when a query hits the 2,000-row cap.
- snapshot_issue(snapshot_id, seq, stage, severity, metadata_type, component_key, file_path, code, message). stage: plan | list | retrieve | read | parse | resolve | crosscheck. This replaces free-text error lists (B's run.errors, C's unpersisted meta.errors).
Derived display status per type (one enum, computed in a view): complete, partial, retrieved_not_parsed, retrieve_failed, not_retrieved, excluded, unsupported, empty. "empty" (looked, found none) must stay distinct from "not_retrieved" (did not look); that distinction is the whole point.
Where each value is set: plan stage writes scope and listed_count (from listMetadata or the file walk); retrieve stage writes retrieve_status and retrieved_count from SDR fileProperties and messages; parse stage writes parse_status and counts; resolve and cross-check stages write origin rows. A static capability registry (type -> parser id, version, depth notes) supplies unsupported and retrieved_not_parsed.
Use: every impact answer carries blindSpots (types that could reference the target and are not complete) and complete: boolean. `coverage` and `status` read the same rows.

R2. ENGINE API (TypeScript; the only import surface for CLI, later web server, desktop and LLM layer)
Rules: every input and output is plain JSON-serialisable data (ISO strings, no classes or Buffers); failures throw EngineError {code, message, hint?, details?}; long operations take {signal?: AbortSignal, onProgress?: (e: ProgressEvent) => void}; clients never import store, config or connector modules; error classes and doctor facts are exported from the facade (fixes C's leaks).
  type SourceName = string; type SnapshotId = string; type ComponentKey = string;
  type SnapshotRef = SnapshotId | `${SourceName}@latest` | `${SourceName}@${string}`;
  type ErrorCode = 'WORKSPACE_NOT_FOUND'|'WORKSPACE_EXISTS'|'CONFIG_INVALID'|'SOURCE_NOT_FOUND'|'SOURCE_EXISTS'|'ORG_NOT_AUTHENTICATED'|'ORG_MISMATCH'|'GIT_ERROR'|'RETRIEVE_FAILED'|'SNAPSHOT_NOT_FOUND'|'SNAPSHOT_INCOMPLETE'|'COMPONENT_NOT_FOUND'|'COMPONENT_AMBIGUOUS'|'STORE_NEWER_SCHEMA'|'STORE_LOCKED'|'CANCELLED'|'INTERNAL';
  function findWorkspaceRoot(startDir?: string): Promise<string | null>;   // walks up to orglens.toml
  function initWorkspace(o: {dir: string; name?: string; force?: boolean}): Promise<{root: string; created: string[]}>;
  function openWorkspace(o?: {dir?: string; readOnly?: boolean; env?: Record<string, string | undefined>}): Promise<Workspace>;
  interface Workspace {
    readonly root: string;
    status(): Promise<WorkspaceStatus>;          // config summary, sources, latest snapshot per source, store facts
    doctor(): Promise<DoctorReport>;             // node, sqlite, git, sf logins, store schema; read-only
    validateConfig(): Promise<ConfigDiagnostic[]>;
    readonly sources: {
      list(): Promise<SourceInfo[]>;
      get(name: SourceName): Promise<SourceInfo>;
      add(decl: SourceDeclaration, o?: {link?: string; verify?: boolean}): Promise<SourceInfo>;
      remove(name: SourceName, o?: {deleteSnapshots?: boolean}): Promise<{removed: SourceName; snapshotsDeleted: number}>;
      link(name: SourceName, aliasOrUsername: string): Promise<SourceInfo>;   // writes .orglens/local.toml only
      check(name: SourceName): Promise<SourceCheck>;                           // resolves login or repo; no retrieve
    };
    readonly snapshots: {
      create(source: SourceName, o?: {resume?: boolean; types?: string[]; label?: string; signal?: AbortSignal; onProgress?: (e: ProgressEvent) => void}): Promise<SnapshotInfo>;
      list(f?: {source?: SourceName; state?: SnapshotState; limit?: number}): Promise<SnapshotInfo[]>;
      get(ref: SnapshotRef): Promise<SnapshotInfo>;
      pin(ref: SnapshotRef, label: string | null): Promise<SnapshotInfo>;
      delete(ref: SnapshotRef): Promise<void>;
      prune(o?: {dryRun?: boolean}): Promise<{deleted: SnapshotId[]; kept: number}>;
    };
    coverage(q?: {snapshot?: SnapshotRef; types?: string[]; gapsOnly?: boolean}): Promise<CoverageReport>;
    impact(q: {component: ComponentKey | string; snapshot?: SnapshotRef; depth?: number; kinds?: ReferenceKind[]; minConfidence?: Confidence}): Promise<ImpactResult>;   // Phase 1
    close(): Promise<void>;
  }
  type SourceDeclaration = {name: SourceName; kind: 'org'|'sandbox'; orgId?: string; loginUrl?: string; sandboxOf?: SourceName; sandboxName?: string; description?: string} | {name: SourceName; kind: 'git'; repo: string; ref?: string; paths?: string[]; tracks?: SourceName; description?: string};
  type SourceInfo = SourceDeclaration & {resolution: {status: 'linked'|'auto'|'unresolved'; via?: 'flag'|'env'|'local'|'org-id-match'|'jwt-env'; username?: string}; latestSnapshot?: SnapshotId};
  type SnapshotState = 'running'|'complete'|'partial'|'failed'|'abandoned';
  type SnapshotInfo = {id: SnapshotId; source: SourceName; kind: 'org'|'sandbox'|'git'; state: SnapshotState; label?: string; startedAt: string; finishedAt?: string; origin: {orgId?: string; instanceUrl?: string; apiVersion?: string; commit?: string; ref?: string; dirty?: boolean; paths?: string[]}; counts: {files: number; components: number; references: number}; coverage: {complete: number; partial: number; gaps: number}; toolVersion: string};
  type ProgressEvent = {stage: 'plan'|'list'|'retrieve'|'read'|'parse'|'resolve'|'crosscheck'|'store'; message: string; done?: number; total?: number; metadataType?: string};
  type Confidence = 'confirmed'|'probable'|'possible';
  type ImpactResult = {root: ComponentSummary; snapshot: SnapshotId; items: {component: ComponentSummary; depth: number; path: ReferenceEdge[]; confidence: Confidence}[]; blindSpots: TypeCoverage[]; complete: boolean; truncated: boolean};
Phase 0 implements init/open/status/doctor/validateConfig, sources.*, snapshots.create/list/get for the first retrieve, and coverage. impact is typed but its CLI command is not registered until Phase 1 (B shipped a silent exit-0 stub; do not repeat).

R3. CONFIG
Files: orglens.toml at the workspace root (committed); .orglens/local.toml (personal). Precedence, highest first: CLI flag, enumerated environment variables, local.toml, orglens.toml, built-in defaults. No generic env overlay and no user-level file in Phase 0. The workspace root is found by walking up from cwd to orglens.toml; --workspace and ORGLENS_WORKSPACE override.
Complete example (validated hands-on) is at /tmp/claude-0/phase0-research/harvest-config/cfg/orglens.toml with its override at /tmp/claude-0/phase0-research/harvest-config/cfg/.orglens/local.toml; the schema prototype is /tmp/claude-0/phase0-research/harvest-config/config.mjs. Content:
  schema_version = 1
  [workspace]  name = "acme-salesforce"; default_source = "prod"; api_version = "auto"
  [sources.prod]  kind = "org"; description = "EMEA production"; org_id = "00D000000000001EAA"; login_url = "https://login.salesforce.com"
  [sources.uat]  kind = "sandbox"; org_id = "00D000000000002EAA"; sandbox_of = "prod"; sandbox_name = "uat"
  [sources.emea-repo]  kind = "git"; repo = "."; ref = "main"; paths = ["orgs/emea/main", "orgs/emea/shared", "orgs/common"]; tracks = "prod"
  [sources.apac-repo]  kind = "git"; repo = "."; paths = ["orgs/apac/core", "orgs/apac/extra"]; metadata = { exclude = ["Profile"] }
  [metadata]  preset = "logic"; include = ["CustomLabels", "GlobalValueSet"]; exclude = []; managed_packages = "references"; namespaces = []
  [snapshots]  keep_last = 10; keep_days = 90; keep_pinned = true; auto_prune = true
  [retrieve]  cache_keep = 1; poll_timeout_minutes = 60; max_parallel_jobs = 3
  [data_policy.org]  user_assignments = "off"; custom_settings = false
  [data_policy.llm]  mode = "disabled"; redact_secrets = true; never_send_types = ["NamedCredential", "ConnectedApp", "ExternalCredential"]; allowed_providers = []
local.toml allows only: sources.<name>.org (alias or username), sources.<name>.repo and .ref for git sources, data_policy.* (stricter only), retrieve.max_parallel_jobs, retrieve.poll_timeout_minutes, workspace.default_source.
How a shared file refers to an org: by the logical source name plus org_id. Connection resolution order: (1) --target-org flag; (2) env ORGLENS_ORG_<SOURCE> (source name upper-cased, hyphens to underscores); (3) local.toml sources.<name>.org; (4) automatic match of org_id against local Salesforce CLI logins (AuthInfo.listAllAuthorizations, compare the first 15 characters); (5) JWT from env for CI: ORGLENS_JWT_USERNAME_<SOURCE>, ORGLENS_JWT_CLIENT_ID_<SOURCE>, ORGLENS_JWT_KEY_FILE_<SOURCE>; (6) fail with the exact `sf org login` and `source link` commands to run. After connecting, the org's id must equal org_id or the command stops with ORG_MISMATCH. If org_id is absent, `source add` writes it from the first successful connection. A sandbox refresh changes the org id: `source relink` updates it, and each snapshot stores the org id it was taken from.
Validation rules:
1. Strict tables: any unknown key is an error naming the file and key. schema_version must equal 1.
2. TOML syntax errors are fatal and reported as file:line:column. A missing local.toml is fine; a malformed one is fatal.
3. Source names match ^[a-z][a-z0-9-]{0,31}$ and are unique.
4. org_id matches ^00D[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$; no two sources share the same first 15 characters.
5. login_url is https only. sandbox_of names a source of kind "org". tracks names an org or sandbox source.
6. git: repo is "." or a relative path in the shared file (absolute only in local.toml); it must resolve to a git work tree. paths entries are relative POSIX paths with no "..", no backslash, no drive letter, no "~"; no duplicates and none nested in another (compared case-insensitively). If paths is omitted, sfdx-project.json packageDirectories at the repo root are used, and their absence is an error. ref must resolve to a commit at snapshot time; an absent ref means the working tree, and the snapshot records commit plus a dirty flag.
7. metadata include and exclude entries must be exact registry type names (correct case); a type cannot be in both lists; a per-source metadata table can only add to exclude or include, not change the preset. An unknown type is an error, never a silent skip and never a fallback to "all types" (B did both).
8. api_version is "auto" or a string like "62.0"; a TOML number is rejected.
9. snapshots.keep_last 1..1000, keep_days 0..3650. A snapshot is pruned only if it is beyond keep_last, older than keep_days and not pinned; the newest complete snapshot of each source is never pruned.
10. No secrets: strict keys already forbid api_key and similar; in addition every string value is scanned for private-key headers, Salesforce session-token shape (00D...!...), sfdx auth URLs (force://) and common API-key prefixes, and a hit is fatal. No key-name heuristics.
11. data_policy: local.toml may only tighten (llm.mode order disabled < structure < metadata; user_assignments order off < counts < names; custom_settings may only be set to false locally). llm.mode other than disabled requires at least one allowed_providers entry. LLM API keys come from the environment or OS keychain only, never from either file.
12. Every key has a reader and a test; a key with no reader fails a unit test that walks the schema.
Editing: `source add` appends a [sources.<name>] block as text and re-validates; `source remove` deletes the block by line range or asks the user to edit by hand. Never round-trip the file through a TOML serialiser.
.orglens/ layout:
  .orglens/.gitignore            contains "*" (written by init; the folder ignores itself)
  .orglens/local.toml            personal overrides
  .orglens/orglens.db            the single SQLite file (plus -wal and -shm while open); file bodies stored content-addressed inside it
  .orglens/cache/retrieve/<source>/<plan-hash>/plan.json        chunk list: id, types or members, job id, state, attempts, file count
  .orglens/cache/retrieve/<source>/<plan-hash>/chunks/<id>/     source-format files written by SDR; <id>.done marker when complete
  .orglens/logs/orglens-YYYY-MM-DD.log                          JSON lines, secrets masked, 14 days kept
  .orglens/tmp/                  scratch, safe to delete
.gitignore: `init` adds ".orglens/" to the root .gitignore when the workspace is inside a git repo (belt and braces with the inner file). The tool's own repository ignores: node_modules/, dist/, coverage/, *.tsbuildinfo, .orglens/, *.log, .env, .env.*, *.key, *.pem, *.p12, .sf/, .sfdx/, and any recorded HTTP fixtures not yet scrubbed.

R4. IDENTITY
Grammar:  key = Type ":" name [ "#" sub { "/" sub } ] ;  sub = kind ":" subname.
- Type: the Metadata API type name in registry case (ApexClass, CustomField). Closed vocabulary; input is accepted in any case and canonicalised. All sObjects use CustomObject and all fields use CustomField, standard ones included.
- name: the Metadata API fullName exactly as SDR reports it, then case-folded with String.prototype.toLowerCase after NFC normalisation. It already contains the parent object ("account.region__c") and the namespace prefix ("ns__score__c"). The original spelling is kept in a separate display_name column.
- sub kinds: method, ctor, prop, var, inner, init, element, file, value. Apex signatures are the parameter types, lower-cased, whitespace removed, T[] rewritten to list<t>, generics kept verbatim.
- The key never contains org, source, snapshot, Salesforce record id, flow version or file path; those are columns. parent_key is derivable by dropping the last sub or, for child types, from the name.
Examples (all generated by the prototype):
  custom object                CustomObject:invoice__c
  standard field               CustomField:account.industry
  custom field, managed ns     CustomField:account.ns__score__c   (on a managed object: CustomField:ns__invoice__c.ns__amount__c)
  Apex class                   ApexClass:accountservice           (managed: ApexClass:ns__billingservice)
  Apex method, overloads       ApexClass:accountservice#method:run(account)  and  ...#method:run(account,boolean)
  constructor / property       ApexClass:accountservice#ctor:(id)   /   ApexClass:accountservice#prop:isactive
  inner class and its method   ApexClass:accountservice#inner:helper   /   ApexClass:accountservice#inner:helper/method:apply()
  trigger                      ApexTrigger:accounttrigger
  flow / flow element          Flow:my_flow   /   Flow:my_flow#element:decision_1
  validation rule              ValidationRule:account.region_required
  record type                  RecordType:account.partner
  custom metadata type         CustomObject:settings__mdt     its record: CustomMetadata:settings.default
  permission set / profile     PermissionSet:sales_ops   /   Profile:admin   /   Profile:custom%3a marketing profile
  LWC bundle                   LightningComponentBundle:mycmp   (file: ...#file:mycmp.js)
  named credential             NamedCredential:erp
Case: keys are folded so that Apex text like ACCOUNT.region__C resolves and a case-only rename is not a delete plus add. If two components in one snapshot fold to the same key, record a snapshot_issue with severity error and keep the first; never merge silently.
Escaping: parsing splits on the first ":" and then the first "#". In name, only "#" is escaped (as %23); Salesforce's own percent-encoding in fullName is kept as delivered. In subname, "%", "#" and "/" are percent-encoded. Tabs and newlines are rejected. No other character restrictions (B's narrow regex rejected real profile names).
Stability across org and repo: the name always comes from the Metadata API fullName through SDR for both source kinds, never from Tooling or SOQL Name columns (C's Profile.Name mismatch). Standard objects present only as a folder of children get a stub CustomObject component flagged stub=true. Tooling record ids are stored per snapshot in an attribute for joining Dependency API and SymbolTable rows.
"Possible" dependencies from D7 target the object key (CustomObject:account) with attrs {scope: "any-field"} and confidence "possible"; no wildcard keys.

R5. REFERENCE VOCABULARY (10 kinds, fixed)
contains, reads, writes, calls, extends, implements, uses-type, triggers-on, grants, references.
Columns on every reference: snapshot_id, from_key, to_key (null if unresolved), to_type, to_name_raw, kind, origin (parser:xml | parser:formula | parser:flow | parser:apex | symboltable | dependency-api), confidence (confirmed | probable | possible), resolution (resolved | unresolved | external | dynamic), file_path, line, column, attrs JSON. Containment is stored as parent_key on the component and exposed as the virtual kind "contains"; it is not a row in the reference table.
Mapping, B's 23 tables:
  INGESTED, DEFINED_IN -> not references; snapshot_id and file_path columns.
  HAS_FIELD, HAS_RECORD_TYPE -> contains.
  USES_TYPE -> uses-type.
  INVOKES(method_count) -> calls {via: method-call}; now method to method, the count becomes an aggregate.
  CALLS_OUT_TO(endpoint) -> references {role: callout, endpoint}.
  REFERENCES_REMOTE_SITE(url) -> references {role: callout, url}, confidence probable (host match).
  GRANTS_OBJECT_PERM -> grants {access: [read, create, edit, delete, viewAll, modifyAll]}; GRANTS_FIELD_PERM -> grants {access: [read, edit]}; GRANTS_APEX_CLASS -> grants {access: [execute]}.
  FLOW_INVOKES_APEX -> calls {via: invocable-action}; FLOW_INVOKES_SUBFLOW -> calls {via: subflow}.
  FLOW_TRIGGERED_BY -> triggers-on {timing, recordTriggerType} for the start object only; other mentioned objects become reads or writes.
  FLOW_CREATES / FLOW_UPDATES / FLOW_DELETES -> writes {op: create | update | delete} on the object, from the flow element.
  FLOW_READS_FIELD -> reads {via: record-lookup}; FLOW_WRITES_FIELD -> writes {op, via: input-assignment}.
  FIRES_ON -> triggers-on {events}. WR_APPLIES_TO -> triggers-on {phase: workflow}. VR_APPLIES_TO -> triggers-on {phase: validation} plus containment. WR_USES_FIELD -> reads {via: criteria}.
B enum-only names: CALLS, METHOD_CALLS -> calls; CONTAINS_METHOD, FLOW_CONTAINS -> contains; EXTENDS -> extends; IMPLEMENTS -> implements; QUERIES_OBJECT -> reads {via: soql-from}; MAKES_DML -> writes {op}; PUBLISHES -> writes {op: publish}; SUBSCRIBES -> triggers-on {via: platform-event}; VR_USES_FIELD -> reads {via: formula}; PS_GRANTS_* -> grants; PSG_INCLUDES -> references {role: includes}.
A's 12: CONTAINS -> contains; TRIGGERS_ON(trigger_events) -> triggers-on {events}; INVOKES(invoke_type) -> calls {via}; CALLS(method_name, line) -> calls with line; IMPLEMENTS -> implements; GRANTS(access_type, permission) -> grants {access}; DEPENDS_ON from the field parser -> references {role: lookup | master-detail}; BELONGS_TO -> not a reference (source column).
C's 9: FIELD_OF -> contains; DEFINED_ON -> contains (plus triggers-on for rules); TRIGGERS_ON, TRIGGERED_BY -> triggers-on; LOOKUP_TO -> references {role: lookup | master-detail}; QUERIES -> reads; MODIFIES -> writes; REFERENCES_FIELD -> reads {via}; REFERENCES -> calls (invocable action, subflow, LWC Apex import, Aura controller), uses-type (Apex identifier, confidence probable) or grants (permission set to object).
Do not fit, or need a decision:
  FLOW_NEXT (B) and NEXT (A): control flow inside one flow, not a dependency. Keep as element attributes if diagrams need it.
  OWNED_BY, FLAGS, COMMIT_MODIFIES (B), COMMITTED_IN, MODIFIED_IN (A): people, findings and git history. Separate tables in later phases.
  DEPENDS_ON from the Dependency API (A): untyped. Store as references {role: dependency-api}, origin dependency-api, used only for cross-checking.
  USES_FIELD (A, B enum), FIELD_REFERENCES (B enum), REFERENCES_FIELD (C): do not say read or write; old data cannot be mapped mechanically, new parsers must decide.
  INVOKES (B): class-level only; no old expected outputs exist at method level.

R6. RETRIEVAL LESSONS (each becomes a requirement for the Phase 0 retrieve task)
1. Never rely on wildcards. Build the member list from listMetadata (SDR ComponentSet.fromConnection) and add standard objects explicitly; record listed_count per type.
2. Plan the retrieve as chunks (per type, split large types), each well under 10,000 files and 39 MB zipped; one failed chunk must not lose the others. B used one job for everything; A used one job per type and isolated failures.
3. Persist chunk state (job id, status) so `snapshot --resume` re-attaches to a running job (SDR accepts an existing id) and skips finished chunks. On a poll error, resume the same job; do not start a new one (A did).
4. Write retrieved files to disk through SDR; do not hold the zip in memory several times (B's 15 MB base64 node broke the XML parser).
5. Poll with backoff and a configurable cap (B: 5 s to 30 s, 30 minutes); default 60 minutes here.
6. Let @salesforce/core refresh sessions; add one test that a mid-retrieve expiry recovers (A needed two fix commits).
7. Use the Metadata API fullName for identity; names are permissive (spaces, parentheses, percent-encoding).
8. Inventory comes from retrieved files, not from Tooling queries. ApexTrigger has no SymbolTable; a null SymbolTable on a class is coverage data, not an error; managed classes have none.
9. Dependency API: at most 2,000 rows per query and no queryMore. Partition by type filters or use Bulk API 2.0; record truncation in snapshot_origin_coverage. Cross-check only.
10. Store writes: one transaction per stage, prepared statements, batched inserts. Size for permission grants first (hundreds of profiles and permission sets times thousands of fields; 150,000+ rows on a 12,000-component org).
11. Snapshots are insert-only, so no upserts (B's upsert caused foreign-key failures).
12. Optional stages (cross-checks) never fail the snapshot; their status goes to coverage.
13. Per-file parse failures never abort; each is a snapshot_issue row.
14. Retrieve in source format so org and repo share one layout (B needed a two-layout path classifier).
15. Cache is keyed by source and plan hash, used for resume, and deleted by retention (B's per-run zips were never reused or removed).
16. Record API calls used per snapshot and check remaining daily calls before starting (B parsed Sforce-Limit-Info).
17. Guard any self-managed unzip against path traversal (B's zip-slip check), including git-archive zips if they are ever extracted.
18. No command or config key ships without behaviour behind it.

R7. DECISION RECORDS
B's ADRs: 0001 embedded storage: principle valid (embedded, one folder, single writer), three-store specifics reversed by A2/S2. 0002 Kuzu over Neo4j: reversed (A2, no graph database). 0003 LiteLLM: reversed by F2 and S5; the "switch provider by config" principle survives. 0004 URN: reversed on its main point by D1 (org in the id); deterministic keys, verbatim type names and centralised parsing with property tests survive. 0005 SymbolTable first: reversed by A4 (own static analysis primary, compiler data as cross-check). 0006 DuckDB/Kuzu split: reversed (A2).
Starting ADRs for the new repo (22, covering all 27 decisions; format: context, decision, consequences, decision ids, supersedes):
0001 Record architecture decisions (process and template)
0002 Scope and release order: impact core first, riders gated, thin slice first (F1, F4, M3)
0003 LLM is optional and a client of the deterministic engines; no RAG or vectors; small provider interface (F2, S5)
0004 Metadata coverage tiers: logic tier first; measured coverage reported with every answer (F3)
0005 One engine library in five layers; clients are thin (A1)
0006 One embedded relational store, SQLite; no graph database (A2, S2); supersedes legacy 0001, 0002, 0006
0007 Immutable snapshots per source; comparison is a diff of two snapshots (A3)
0008 Reference sources: own static analysis primary; Dependency API and compiler SymbolTable as cross-checks; origin on every reference (A4); supersedes legacy 0005
0009 One ingestion path: orgs retrieved in source format, same parsers as Git, through @salesforce/core and SDR (A5, S4)
0010 Data model and identity: Component and Reference, org-free key grammar, ten reference kinds (D1); supersedes legacy 0004
0011 Apex reference granularity: method to field, read or write, with source location (D2)
0012 Dynamic reference resolution and three confidence tiers (D7)
0013 Impact semantics: reachability first, change-aware rules added one change type at a time (D3)
0014 Access impact from metadata by default; user assignments opt-in (D4)
0015 Authentication: reuse Salesforce CLI logins, JWT through environment variables for CI, store no credentials (D5)
0016 Command surface, JSON output contract, orglens.toml and .orglens/ (D6)
0017 Language and runtime: TypeScript on Node, floor Node 22 (S1)
0018 Apex analysis foundation chosen by trial (S3); status Proposed until the trial reports, then filled with results
0019 Licence: Apache-2.0 (S6)
0020 Rewrite and harvest in a new repository; old repos archived later with the owner's go-ahead (M1, M2); supersedes legacy 0003 by reference
0021 Correctness proof: fixture project, public codebases, private large-org gate (M4)
0022 Public pre-release from the first commit, no announcement before the gate (M5)
Add docs/adr/legacy.md with the disposition table above.

R8. GIT DIFF TO PR COMMENT (A, for later phases)
Flow: diff two refs -> map changed paths to components -> for each, walk inbound dependencies to a depth limit -> render a table or JSON -> write Markdown with a hidden marker -> CI posts it and exits 2 above a threshold. Keep: the three-step shape, the marker, the JSON output, the exit-code gate. Change: take a snapshot of each ref through the git source (archive of the ref), diff by key and content hash, compute impact for deleted and changed components on the base snapshot, update one sticky comment found by the marker, make the threshold configurable, and fail loudly on git errors.

## Plan tasks
- Write docs/adr/0001-0022 from the R7 list plus docs/adr/legacy.md with the disposition of B's six ADRs; ADR 0018 stays 'Proposed' until the Apex trial reports.
- Implement the component key module (build, parse, parent, Apex signature normalisation) from R4 with unit and property tests covering the 31 prototype cases in /tmp/claude-0/phase0-research/harvest-config/keys.mjs; include a collision check.
- Define the reference vocabulary as a TypeScript union with the common columns and per-kind attrs from R5; add docs/reference-kinds.md holding the old-edge mapping table.
- Implement config: smol-toml parse, strict zod schema, cross-field rules 1-12 from R3, value-pattern secret scan, local.toml merge with tighten-only policy, enumerated env overrides; port the 22 negative cases from config.mjs as tests, plus a test that every schema key has a reader.
- Implement workspace discovery and init: walk up to orglens.toml; create .orglens/ with the self-ignoring .gitignore, local.toml stub, cache/, logs/, tmp/; append '.orglens/' to the root .gitignore when inside a git repo.
- Implement source add/list/remove/link/check: text-append edits to orglens.toml, org resolution order from R3 (flag, env, local.toml, org-id match via AuthInfo.listAllAuthorizations, JWT env), ORG_MISMATCH check, org_id filled on first connection.
- Implement the git source reader: resolve ref to a commit, read via git archive + ZipTreeContainer for a ref or the file system for the working tree, across the declared set of paths; record commit, dirty flag and paths on the snapshot; create stub CustomObject components for object folders without an object-meta.xml.
- Create the SQLite schema v1 for source, snapshot, snapshot_type_coverage, snapshot_origin_coverage and snapshot_issue (R1), with schema_version, refuse-newer check and WAL.
- Implement the first org retrieve as a chunked plan: list members per type (standard objects named explicitly), retrieve in source format through SDR, persist plan.json with job ids, support --resume, write coverage rows from fileProperties and messages.
- On the real org, verify and record: listMetadata output for CustomObject (are standard objects listed), fullName encoding for a profile and a layout with special characters, case-collision behaviour, retrieve chunk sizes and timings, and API calls consumed.
- Implement the engine facade (R2) for Phase 0 scope with JSON-only types and EngineError codes; add a lint rule or dependency check that the CLI package imports only the facade.
- Implement CLI commands init, source add|list|remove|link, snapshot, coverage, status, doctor, each with --json; do not register impact until Phase 1.
- Run all tests with HOME pointed at a temp folder so @salesforce/core never reads or writes the developer's real Salesforce CLI state.
- Write the repo .gitignore from R3 and a secret-scan CI step for committed fixtures.
- Add to the fixture project v0 the cases found here: multi-org sub-folders in one repo, a standard object with only child files, a managed-namespace field, a custom metadata type with a record, overloaded Apex methods and an inner class, and a profile and a layout with special characters in their names.

## Risks
- Case-folded keys assume Salesforce developer names are unique case-insensitively for every type; this is unverified. Mitigation: collision check that records an error issue instead of merging.
- The exact set of characters Salesforce percent-encodes in fullName, and whether org listMetadata and retrieved file names always agree, is unverified; a mismatch would give one component two keys across org and repo.
- Apex method keys use the declared spelling of parameter types. Changing String to System.String shows up as a removed and an added method, and matching against compiler SymbolTable spellings needs a tolerant comparison. If apex-ls wins the trial, resolved types could replace this, which would change keys.
- org_id in a committed file is not a credential but some organisations treat it as internal information; it is optional in the schema, at the cost of automatic login matching.
- A sandbox refresh changes the org id; without the relink step users will hit ORG_MISMATCH with no obvious cause.
- Reading a ref through git archive loads the selected folders as one zip in memory; very large monorepo slices may need a streamed or extracted fallback. .forceignore handling inside a zip tree was not tested.
- Permission grant rows dominate volume (150,000+ on a 12,000-component org in B, more with full field-level security); with immutable snapshots this multiplies per snapshot unless unchanged content is shared between snapshots.
- @salesforce/core writes a log file and a key file under the user's home as a side effect of read-only calls; tests and CI must isolate HOME, and Windows keychain behaviour was not tested here.
- Both Salesforce libraries require Node 22 or later and are CommonJS; the toolchain choice (ESM or CJS output, bundling) must account for that.
- The Dependency API is Beta, capped at 2,000 rows per query and excludes reports; it can only ever be a partial cross-check, and the M4 gate wording ('no confirmed dependency reported by Salesforce is missing') depends on it.
- retrieve.max_parallel_jobs = 3 is a guess; Salesforce's limit on concurrent retrieves was not checked.
- Ten reference kinds may prove too few once presentation-tier metadata (layouts, reports) arrives; the 'references' kind with a role attribute is the pressure valve and could become a dumping ground.

## Open questions
- Should the personal override live at .orglens/local.toml (self-ignoring, recommended) or as orglens.local.toml next to the shared file (more visible, but needs a root .gitignore entry)?
- Is it acceptable to commit org ids in orglens.toml, or should the shared file carry only source names and leave all org identification to each person's local file?
- Should 'sandbox' be its own source kind as designed here, or an attribute of kind 'org'? And how should scratch orgs be declared, if at all?
- Should a git source be allowed to point at a remote URL (the tool clones it), or only at a local path, as assumed for Phase 0?
- Should the default metadata preset be 'logic' (decision F3) with presentation types opt-in through 'logic+presentation', and who maintains the type list for each preset?
- Retention defaults: keep the last 10 snapshots per source and anything younger than 90 days. Are these the right numbers for the owner's orgs and disk?
- Should the local override be allowed to loosen the data policy for a solo user, or is tighten-only correct as designed?
- ADR granularity: 22 records as listed, or one record per decision group (5)?
- Standard objects and fields share the types CustomObject and CustomField in keys, following the Metadata API. Is that acceptable, or does the owner prefer tool-neutral type names such as Object and Field?
- Could not be verified here and needs the real org: listMetadata behaviour for standard objects, fullName encoding of special characters, SymbolTable parameter-type spelling, and concurrent retrieve limits.

## Findings
- [hands-on] C's coverage manifest is a dict of source name to a list of {area, status, detail}, with three statuses: ingested, partial, not_ingested.
  EVIDENCE: coverage.py defines INGESTED/PARTIAL/NOT_INGESTED, entry(area,status,detail), gaps(coverage) and summarize_for_prompt(coverage). Source names are 'repo:<abs path>' and 'org:<alias or default>'.
- [hands-on] C's coverage is declared statically by hand, not measured. Only one status is ever changed at run time.
  EVIDENCE: Each connector holds a module-level _COVERAGE list (12 entries in sfdx_repo.py, 13 in salesforce_org.py) copied into model.meta['coverage'][source_name] on every fetch(). The only dynamic change is _downgrade_coverage(model, 'validation rules', detail) when per-rule formula fetches fail. An area stays 'ingested' even if zero files were read. Areas are free-text labels ('objects & fields'), not metadata type names, so they cannot be joined to a query.
- [hands-on] C stores coverage as one JSON string in a key/value meta table and surfaces it in status, ingest output, the REPL, the agent prompt and a get_coverage tool. Parse errors are not persisted.
  EVIDENCE: db.py write_model writes meta keys sources, ingested_at, ingest_id, component_count, reference_count, counts_by_type, coverage, model_hash; meta['errors'] is returned in IngestResult only. session.py status() reads meta 'coverage'. cli/app.py prints a 'Coverage gaps' table via cov.gaps(); agent/harness.py injects summarize_for_prompt. The store is a full rewrite per ingest (DELETE FROM components/refs), so there is one manifest, not one per snapshot.
- [hands-on] C's facade surface is OrgLensSession: open, status, ingest, ingest_repo, ingest_org, graph, load_suppressions, audit, build_agent, ask, ask_detailed, diagram; returning SessionStatus, IngestResult, AskResult dataclasses.
  EVIDENCE: session.py 321 lines. Test seams are constructor/method injection (org_client, provider, progress callback taking a string). The facade opens and closes the store per call and caches model+graph in memory keyed by a per-write ingest_id.
- [hands-on] C's CLI is thin but leaks past the facade in places.
  EVIDENCE: cli/app.py imports SalesforceAuthError, LLMConfigError, StoreVersionError and the coverage module from deep engine modules; the doctor command reads session.config directly and calls inspect_db and fts5_available from core.store.db. Commands: default (REPL), repl, version, status, ingest, doctor, audit, ask, diagram.
- [hands-on] In all three old repos the config lives inside the ignored .orglens/ folder, so it cannot be shared, and none can declare more than one source.
  EVIDENCE: A: config_path = cwd/.orglens/config.toml, single [git] repo_path + sfdx_path='force-app/main/default'. B: project_config_path = <cwd>/.orglens/config.toml plus a user-level file and ORGLENS_<SECTION>__<KEY> env overlay. C: ~/.orglens/config.toml then <project>/.orglens/config.toml then env; one default_org_alias. A and C resolve the workspace from cwd only (no upward search).
- [hands-on] B's config has keys that nothing reads, and three sources of truth for the API version.
  EVIDENCE: grep finds no reader outside config/schema.py for ingestion.include_managed_packages, ingestion.parallelism, ingestion.mode, salesforce.http_timeout_seconds, salesforce.max_retries, ingestion.api_version, salesforce.api_version. defaults.toml says api_version '62.0' twice, while cli/commands/sync.py defaults --api-version to '60.0' and orchestrator.py, package_xml.py and client.py each hard-code 60.0. Commit bb2e27c shows metadata_types.enabled was also ignored until then.
- [hands-on] C silently treats a malformed config file as no config; B's env overlay needed a reserved-variable workaround and guesses types from strings.
  EVIDENCE: C _load_toml catches TOMLDecodeError and returns {} (also listed as a gap in its own PRODUCTION_READINESS_PLAN.md section 2.4). B loader.py has _RESERVED_ENV_VARS because ORGLENS_WORKSPACE_DIR would be read as a config key, and _coerce_env_value turns any comma-containing string into a list.
- [hands-on] C's data policy has three modes: full, metadata-only, no-code-bodies; default is the most permissive (full).
  EVIDENCE: DataPolicy StrEnum with allows_records and allows_bodies; default DataPolicy.FULL; parsed where used so a typo raises a clear error.
- [hands-on] @salesforce/core can map an org id to a local login and its aliases offline, so a shared file can identify an org without naming anyone's alias.
  EVIDENCE: With HOME pointed at a temp folder holding one fake auth file and alias.json, AuthInfo.listAllAuthorizations(a => a.orgId === '00D000000000001EAA') returned {orgId, username:'dev1@example.com', aliases:['my-uat','uat2'], isSandbox:true, instanceUrl}. StateAggregator.aliases.resolveUsername('my-uat') returned the username. No network call was made. Side effects seen: it created ~/.sfdx/key.json and ~/.sf/sf-<date>.log.
- [hands-on] @salesforce/core 9.4.6 and @salesforce/source-deploy-retrieve 13.12.0 both require Node >= 22 and are Apache-2.0, CommonJS.
  EVIDENCE: package.json engines {node: '>=22.0.0'}, license Apache-2.0, no 'type: module'. Installed in 4 s; node_modules 80 MB with smol-toml and zod. Local Node is v22.23.4.
- [hands-on] SDR resolves a set of arbitrary sub-folders with no sfdx-project.json, which is what a 'repo + set of sub-folders' source needs.
  EVIDENCE: On a fixture repo with orgs/emea/... and orgs/apac/{core,extra} and no sfdx-project.json, new MetadataResolver().getComponentsFromPath('orgs/emea') returned 17 components and ComponentSet.fromSource({fsPaths:[core, extra]}) returned both classes.
- [hands-on] A git ref can be read without touching the working tree: `git archive --format=zip <ref> <paths...>` fed to SDR's ZipTreeContainer.
  EVIDENCE: ZipTreeContainer.create(zipBuffer) + new MetadataResolver(new RegistryAccess(), tree) resolved ApexClass ApacCore and AccountService from the archive and tree.readFile returned the class body. `git archive` with a path missing at that ref fails with 'pathspec did not match any files'. `git rev-parse --verify main^{commit}` gives the commit to record.
- [hands-on] SDR's fullName is already the fully qualified name needed for the key, including the parent object and the namespace prefix.
  EVIDENCE: Resolved names: CustomField 'Account.Region__c', 'Account.ns__Score__c', 'Invoice__c.Amount__c'; ValidationRule 'Account.Region_Required'; RecordType 'Account.Partner'; CustomMetadata 'Settings.Default' (type is CustomObject 'Settings__mdt'); LightningComponentBundle 'myCmp'; NamedCredential 'ERP'; Profile 'Custom%3A Marketing Profile'; Layout 'Account-Account %28Marketing%29 Layout' (percent-encoding kept as in the file name).
- [hands-on] A standard object folder with no .object-meta.xml yields its children but no CustomObject component, so the parent must be created as a stub.
  EVIDENCE: objects/Account/ held only fields, a validation rule and a record type. The resolver returned those four children with parent CustomObject:Account, but no top-level CustomObject 'Account'. Invoice__c, which has an object-meta.xml, was returned as a CustomObject.
- [hands-on] The proposed key grammar builds, parses and round-trips for every requested example, is case-insensitive, and distinguishes overloads.
  EVIDENCE: keys.mjs produced 31 distinct keys (max length 72), e.g. CustomField:account.region__c, ApexClass:accountservice#method:run(account,boolean), ApexClass:accountservice#inner:helper/method:apply(), Flow:my_flow#element:decision_1, CustomMetadata:settings.default, Profile:custom%3a marketing profile. Checks printed: round-trip all true; ACCOUNT.region__C equals Account.Region__c; String[] equals List<String>.
- [hands-on] B's URN embeds the org and has lossy sub-ids; its name validation had to be loosened after a real org broke it.
  EVIDENCE: ids.py: urn:orglens:<org_id>:<Type>:<api_name>[#sub:<sub_id>], org_id is the Salesforce id or git:<sha256 of origin>, so the same class in an org and a repo gets two URNs. apex/extractor.py builds method sub-ids as method:<name>:<types> after replacing every character outside [A-Za-z0-9_.-] with '_', so Map<String,Integer> becomes Map_String__Integer_. Commit da3dc29 changed _API_NAME_PATTERN from [A-Za-z0-9_.-]+ to [^:#\r\n]+ because profile names contain spaces and parentheses.
- [hands-on] A's key includes org, a separate namespace segment and a version; C's key is lower_snake type plus case-preserved name with exact-match lookup.
  EVIDENCE: A: f'{org_id}:{type}:{namespace or ""}:{name}:{version or 0}'. C: component_id = f'{ctype.value}:{name}', e.g. 'object:Account', 'field:Account.Industry'; components held in a dict keyed by that string. C's org connector notes profiles are named by Profile.Name, which differs from the repo file name, so a combined ingest can list one profile twice.
- [hands-on] B's graph schema has 23 relationship tables (2 provenance, 21 component-to-component); its EdgeType enum lists 44 names, about half never implemented.
  EVIDENCE: grep -c 'CREATE REL TABLE' schema.py = 23. Enum-only names with no table: CALLS, METHOD_CALLS, CONTAINS_METHOD, EXTENDS, IMPLEMENTS, USES_FIELD, QUERIES_OBJECT, MAKES_DML, PUBLISHES, SUBSCRIBES, FLOW_CONTAINS, FLOW_NEXT, VR_USES_FIELD, FIELD_REFERENCES, PS_GRANTS_*, PSG_INCLUDES, OWNED_BY, COMMIT_MODIFIES, FLAGS.
- [hands-on] B's FLOW_TRIGGERED_BY edge is mislabelled: it is written for every object a flow mentions, not only the object that starts it.
  EVIDENCE: flow_builder.py loops over payload['referenced_objects'] and calls writer.link_flow_triggered_by for each. The schema comment itself says 'the flow's start (or any element) acts on'.
- [hands-on] B's Apex call edge is class-to-class with a method count; neither A, B nor C separates field reads from writes in Apex.
  EVIDENCE: B INVOKES(FROM Component TO Component, method_count INT64) between classes; USES_TYPE for type references. A has one USES_FIELD(context) table and an untyped DEPENDS_ON(source, confidence, context). C has REFERENCES_FIELD plus QUERIES/MODIFIES at object level, with attributes {'via': ..., 'heuristic': True} on regex-derived edges.
- [docs] A and B retrieve by wildcard only and never list members, so by Salesforce's documented rules they did not retrieve standard objects or custom fields on standard objects.
  EVIDENCE: B orchestrator builds one build_wildcard_package(all types) per sync; chunk_members and MAX_RETRIEVE_COMPONENTS are defined but never called; there is no listMetadata call in B's src. A retrieves each type with members ['*']. Salesforce docs: 'using the wildcard with the CustomObject type name will not retrieve standard objects. To retrieve a standard object, you must explicitly name the object in package.xml' and 'if you want to retrieve custom fields defined on standard objects, you must name the object and field.' The effect on the old tools is inferred from code plus docs, not observed on an org.
- [docs] Metadata API limits per retrieve: 10,000 files, 39 MB zip, 600 MB unzipped.
  EVIDENCE: Docs: 'You can deploy or retrieve up to 10,000 files at once.' 'The maximum size of the deployed or retrieved .zip file is 39 MB.' 'If the files are uncompressed in an unzipped folder, the size limit is 600 MB.' B's single all-types retrieve returned about 15 MB of base64 on a roughly 12,000-component org (commit 82cb950), so one job is close to these limits at the target scale.
- [docs] The Dependency API returns at most 2,000 rows per Tooling query and does not support queryMore, ORDER BY, OFFSET or count(); it is still Beta. A's use of it was therefore silently capped.
  EVIDENCE: Docs: 'No more than 2000 records in a single query' (Tooling), 100,000 via Bulk API 2.0; unsupported: ORDER BY, count(), queryMore(), OFFSET, filters on the two Name fields, LIKE on the type fields; 'for evaluation purposes only'. A's DEPENDENCY_SOQL ends in LIMIT 2000 and fetch_all_paginated follows nextRecordsUrl.
- [hands-on] ApexTrigger has no SymbolTable column in the Tooling API; a null SymbolTable on a class means it could not be compiled. Both A and B hit this as a bug.
  EVIDENCE: B commit da3dc29: 'ApexTrigger has no such column (querying it returns a 400)'; it also stopped counting triggers from the Tooling query and counts retrieved .trigger files instead. A commit 468999d removed SymbolTable from APEX_TRIGGER_SOQL. B queries WHERE NamespacePrefix = null, so managed classes are skipped.
- [hands-on] Per-row commits made B's graph build run for hours on a roughly 12,000-component org; permission grants were the volume driver.
  EVIDENCE: Commit 6877c4e: 'hundreds of Profiles/PermissionSets x thousands of fields = ~150k+ edges', one auto-committed statement per edge; fixed by one transaction plus batched inserts, permission phase 'from hours to ~83s'. Commit eb8115c: per-URN deletes created about 57k version files; batching took full sync from about 46 min to about 14 min.
- [hands-on] B's 'resumable' ingest never existed; the retrieve zip is cached per run and never reused or cleaned.
  EVIDENCE: Commit a59ea9f: `orglens ingest` 'was a silent exit-0 stub'; CLAUDE.md now says standalone ingest is 'planned, not yet implemented'. extractor.py writes cache/metadata/<run_id>.zip and raw/metadata/<run_id>/ on every run with no deletion code.
- [hands-on] A retries a failed poll by starting a whole new retrieve job; B polls with backoff and fetches the zip only once the job is done.
  EVIDENCE: A retrieve_and_unpack wraps retrieve + poll + unpack in one _retry_with_backoff (3 attempts, 2 s base). B RetrieveClient.poll: 5 s start, x1.5 up to 30 s, 30 minute cap, include_zip=false until done. A also needed auto session refresh on INVALID_SESSION_ID (commit 016af4b) and session reuse (376b970).
- [docs] SDR's retrieve can attach to an existing job id and reports per-file problems, which supports resumable retrieves and measured coverage.
  EVIDENCE: Type definitions: MetadataTransferOptions {usernameOrConnection, components?, apiVersion?, id?}; RetrieveOptions {output, merge?, format?, unzip?, zipFileName?, ...}; retrieve result has fileProperties and messages: RetrieveMessage {fileName, problem}. ComponentSet.fromConnection accepts {metadataTypes, componentFilter}. Read from the .d.ts files only; not run against an org.
- [hands-on] The SDR registry knows 542 types and 36 child types and can validate type names in config.
  EVIDENCE: Object.keys(registry.types).length = 542. getTypeByName is case-insensitive ('apexclass' returns ApexClass) and resolves child types (ValidationRule, CustomLabel). All 20 of B's types exist. CustomObject children: BusinessProcess, CompactLayout, CustomField, FieldSet, Index, ListView, RecordType, SharingReason, ValidationRule, WebLink.
- [hands-on] The example orglens.toml and local override parse and validate, and 21 of 22 invalid variants are rejected with a located message.
  EVIDENCE: config.mjs (smol-toml 1.9.1 + zod 4.6.7, strict objects) accepted the example and rejected: unknown key, wrong-case type, absolute or '..' path, overlapping paths, absolute repo in the shared file, sandbox_of pointing at a git source, duplicate org_id, unknown default_source, numeric api_version, an [llm] api_key table, a token-shaped value, LLM enabled with no approved provider, TOML syntax error (line:column), schema_version 2, and five local-override violations. The one accepted variant, 'CustomLabel', is a real child type, so acceptance is correct.
- [hands-on] A secret check based on key names misfires; strict unknown-key rejection plus a value-pattern scan is enough.
  EVIDENCE: A first version flagged the tool's own key data_policy.redact_secrets as a secret and failed every case. After removing the key-name rule, '[llm] api_key' is still rejected as an unrecognised key and a token-shaped string is rejected by the value scan.
- [hands-on] Rewriting orglens.toml through a TOML library loses comments; appending a block as text does not.
  EVIDENCE: smol-toml parse+stringify: 42 comments to 0. @decimalturn/toml-patch 3.3.2: add-only kept 42, a scalar edit kept 42 but changed 6 lines, add plus delete of a table rewrote all [sources.*] as inline tables and kept 29. Appending '[sources.dev]' text at end of file kept 42 and parsed to five sources.
- [hands-on] A .gitignore containing '*' inside .orglens/ makes the folder ignore itself, with no entry needed in the user's root .gitignore.
  EVIDENCE: In the fixture repo, after creating .orglens/{.gitignore,orglens.db,local.toml,cache/a.zip} and orglens.toml, `git status --porcelain --untracked-files=all` listed only orglens.toml; git check-ignore attributed all three probed files to .orglens/.gitignore:2.
- [hands-on] A's Git-diff-to-PR-comment flow works at file level against the head graph and has defects worth not repeating.
  EVIDENCE: connectors/git/diff.py diffs two commits and maps paths to (type, full_name, change); a bare `except Exception: pass` turns any git error into 'no changes'; renames are not handled. preview/impact.py tries full_name, then short name, then the metadata type name as the lookup key. cli/ci.py exits 2 when any score >= 10 (hard-coded). scripts/ci_preview.sh always posts a new comment with `gh pr comment ... || true`; the '<!-- orglens-impact-preview -->' marker is written but never used to update a previous comment.
- [hands-on] B's six ADRs have drifted from its code.
  EVIDENCE: ADR-0005 places the Node bridge at src/orglens/apex/node_bridge/ (actual: apex-bridge/ and apex/bridge.py). ADR-0003 cites embeddings/client.py (actual: embeddings/{base,factory,litellm_provider,...}.py). ADR-0004 promises rename reconciliation through Dependency API history, which was never built.
- [docs] The 27 recorded decisions are F1-F4, A1-A5, D1-D7, S1-S6, M1-M5; D7 replaces the 'Unknown' marker with three confidence tiers (confirmed, probable, possible) and object-level 'possible' dependencies.
  EVIDENCE: Read from this project thread's history (messages between 20:43 and 21:49 UTC on 2026-11-11), including the owner's choices 'F1 B, F3 A', 'A2 A, A3 A, A4 C', 'D2 C, D3 C, D4 C, D5 C', 'S1 B, S3 D, S6 B', 'M2 A, M3 A, M5 C'.
- [unverified] Whether Salesforce developer names are unique case-insensitively for every metadata type, and exactly which characters the Metadata API percent-encodes in fullName, was not verified.
  EVIDENCE: From memory only. SDR kept '%3A' and '%28' as found in file names; nothing was checked against a live org's listMetadata output.
- [unverified] How the Tooling SymbolTable spells parameter types (for matching method keys to compiler data) was not verified.
  EVIDENCE: B's model reads parameters[].type as a string and sanitises it; no real SymbolTable payload was available in this session.
