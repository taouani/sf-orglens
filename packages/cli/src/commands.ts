/**
 * The commands. Each one calls the engine and returns the data for `--json`
 * together with the lines for a person. None of them writes to the terminal
 * or knows about exit codes of failures: that is `output.ts`.
 */
import { resolve } from 'node:path';
import {
  doctor,
  initWorkspace,
  openWorkspace,
  type ConfidenceTier,
  type CoverageReport,
  type ImpactGaps,
  type ImpactReport,
  type SnapshotProgress,
  type SourceDeclaration,
  type SourceInput,
  type SourceStatus,
  type WorkspaceLocator,
} from '@sf-orglens/engine';
import { EXIT, table, UsageError, type Io, type Outcome } from './output.ts';

export interface Context {
  readonly io: Io;
  /** The value of `--workspace`. */
  readonly workspace: string | undefined;
  /** Says what a command that takes long is doing. */
  readonly progress: (line: string) => void;
}

const locator = (context: Context): WorkspaceLocator => ({
  root: context.workspace,
  cwd: context.io.cwd,
  env: context.io.env,
});

export async function init(
  context: Context,
  dir: string | undefined,
  options: { name?: string | undefined },
): Promise<Outcome> {
  if (dir !== undefined && context.workspace !== undefined) {
    throw new UsageError('The folder was given twice: as an argument and with --workspace. Give it once.');
  }
  const { cwd, env } = context.io;
  const variable = env['ORGLENS_WORKSPACE'] === '' ? undefined : env['ORGLENS_WORKSPACE'];
  const target = resolve(cwd, dir ?? context.workspace ?? variable ?? '.');
  const result = await initWorkspace({ dir: target, name: options.name, env });

  const created = result.created.map((file) => `  created ${file}`);
  if (!result.existing) {
    return {
      data: result,
      lines: [
        `Created a workspace in ${result.root}.`,
        ...created,
        'Next: declare an org, a sandbox or a repository folder with "orglens source add".',
      ],
    };
  }
  if (created.length === 0) {
    return { data: result, lines: [`The workspace in ${result.root} is complete. Nothing was changed.`] };
  }
  return {
    data: result,
    lines: [`Completed the workspace in ${result.root}. orglens.toml was not changed.`, ...created],
  };
}

/** The options of `source add`, as the argument parser delivers them. */
export interface SourceAddOptions {
  readonly kind: 'org' | 'sandbox' | 'git';
  readonly description?: string | undefined;
  readonly orgId?: string | undefined;
  readonly loginUrl?: string | undefined;
  readonly sandboxOf?: string | undefined;
  readonly sandboxName?: string | undefined;
  readonly repo?: string | undefined;
  readonly ref?: string | undefined;
  readonly path?: readonly string[] | undefined;
  readonly tracks?: string | undefined;
}

/** The options that belong to one kind of source only, with the kinds that take them. */
const OPTION_KINDS: readonly (readonly [keyof SourceAddOptions, string, readonly string[]])[] = [
  ['orgId', '--org-id', ['org', 'sandbox']],
  ['loginUrl', '--login-url', ['org', 'sandbox']],
  ['sandboxOf', '--sandbox-of', ['sandbox']],
  ['sandboxName', '--sandbox-name', ['sandbox']],
  ['repo', '--repo', ['git']],
  ['ref', '--ref', ['git']],
  ['path', '--path', ['git']],
  ['tracks', '--tracks', ['git']],
];

function sourceInput(name: string, options: SourceAddOptions): SourceInput {
  for (const [key, flag, kinds] of OPTION_KINDS) {
    if (options[key] !== undefined && !kinds.includes(options.kind)) {
      throw new UsageError(
        `${flag} does not apply to a source of kind "${options.kind}".`,
        `It applies to: ${kinds.map((kind) => `--kind ${kind}`).join(', ')}.`,
      );
    }
  }
  const { kind, description } = options;
  if (kind === 'git') {
    return {
      name,
      kind,
      description,
      repo: options.repo,
      ref: options.ref,
      paths: options.path,
      tracks: options.tracks,
    };
  }
  const org = { name, description, orgId: options.orgId, loginUrl: options.loginUrl };
  if (kind === 'org') return { ...org, kind };
  return { ...org, kind, sandboxOf: options.sandboxOf, sandboxName: options.sandboxName };
}

/** What a source points at, in a few words. */
function describeSource(source: SourceDeclaration): string {
  const parts: (string | null)[] =
    source.kind === 'git'
      ? [
          `repo ${source.repo}`,
          source.ref === null ? null : `ref ${source.ref}`,
          source.paths === null ? null : `paths ${source.paths.join(' ')}`,
          source.tracks === null ? null : `tracks ${source.tracks}`,
        ]
      : [
          source.kind === 'sandbox' && source.sandboxOf !== null ? `sandbox of ${source.sandboxOf}` : null,
          source.kind === 'sandbox' && source.sandboxName !== null ? `sandbox name ${source.sandboxName}` : null,
          source.orgId === null ? null : `org id ${source.orgId}`,
          source.loginUrl,
        ];
  return parts.filter((part) => part !== null).join(', ');
}

const NO_SOURCES = 'No sources are declared. Declare one with "orglens source add".';

export async function sourceAdd(context: Context, name: string, options: SourceAddOptions): Promise<Outcome> {
  const input = sourceInput(name, options);
  const workspace = await openWorkspace(locator(context));
  const source = await workspace.sources.add(input);
  return { data: { source }, lines: [`Added the source "${source.name}" (${source.kind}) to orglens.toml.`] };
}

export async function sourceList(context: Context): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const sources = await workspace.sources.list();
  return {
    data: { sources },
    lines:
      sources.length === 0
        ? [NO_SOURCES]
        : table(
            ['NAME', 'KIND', 'POINTS AT', 'DESCRIPTION'],
            sources.map((source) => [source.name, source.kind, describeSource(source), source.description ?? '']),
          ),
  };
}

export async function sourceRemove(context: Context, name: string): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const result = await workspace.sources.remove(name);
  return {
    data: result,
    lines: [`Removed the source "${result.removed}" from orglens.toml. Snapshots of it stay in the database.`],
  };
}

export async function sourceLink(context: Context, name: string, login: string): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const link = await workspace.sources.link(name, login);
  const lines = [`The source "${link.source}" now uses the Salesforce CLI login "${link.login}" on this machine.`];
  if (link.declaredOrgId === null && link.orgId !== null) {
    lines.push(
      `The source declares no org id, so OrgLens cannot tell when a login points at another org. Add org_id = "${link.orgId}" to the source in orglens.toml.`,
    );
  }
  lines.push(`Check the login with: orglens source check ${link.source}`);
  return { data: link, lines };
}

const LOGIN_VIA: Readonly<Record<'jwt-env' | 'linked' | 'org-id', string>> = {
  'jwt-env': 'a private key from the environment',
  linked: 'the Salesforce CLI login linked to the source',
  'org-id': 'the Salesforce CLI login of the declared org',
};

export async function sourceCheck(context: Context, name: string): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const check = await workspace.sources.check(name);
  if (check.kind === 'git') {
    const lines = [
      `The source "${check.source}" ${check.complete ? 'can be read:' : 'can be read in part, something is missing:'} ${count(check.components, 'component', 'components')} in ${count(check.files, 'file', 'files')} (${size(check.bytes)})${
        check.commit === null ? '' : `, commit ${shortCommit(check.commit)}`
      }. Nothing was stored.`,
    ];
    if (check.issues.length > 0) {
      lines.push(
        '',
        ...table(
          ['SEVERITY', 'CODE', 'WHAT'],
          check.issues.map((issue) => [issue.severity, issue.code, issue.message]),
        ),
      );
    }
    return { data: check, lines, exitCode: check.complete ? EXIT.ok : EXIT.partial };
  }
  const { login, org } = check;
  const who = [login.alias, login.username].filter((part) => part !== null).join(', ');
  const lines = [
    `The source "${check.source}" can be reached.`,
    ...table(
      ['Login', `${LOGIN_VIA[login.via]}${who === '' ? '' : ` (${who})`}`],
      [
        ['Org', org.instanceUrl === null ? org.id : `${org.id} at ${org.instanceUrl}`],
        ['API version', org.apiVersion],
      ],
    ),
  ];
  if (check.declaredOrgId === null) {
    lines.push(
      `The source declares no org id, so OrgLens cannot tell when a login points at another org. Add org_id = "${org.id}" to the source in orglens.toml.`,
    );
  }
  return { data: check, lines };
}

function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function latest(source: SourceStatus): string {
  const snapshot = source.latestSnapshot;
  if (snapshot === null) return 'none';
  return `#${String(snapshot.id)} ${snapshot.status}, ${snapshot.finishedAt === null ? `started ${snapshot.startedAt}` : `finished ${snapshot.finishedAt}`}`;
}

/** Whether the latest snapshot of a source is analysed, and by which version of the engine. */
function analysed(source: SourceStatus): string {
  const snapshot = source.latestSnapshot;
  if (snapshot === null) return '';
  return snapshot.analysis === null ? 'no' : `by engine ${snapshot.analysis.engineVersion}`;
}

/** The line about a latest snapshot that is not analysed. */
function notAnalysed(source: SourceStatus): string[] {
  const snapshot = source.latestSnapshot;
  if (snapshot?.analysis !== null) return [];
  return [
    `Snapshot #${String(snapshot.id)} of "${source.name}" is not analysed. "orglens analyse ${source.name}" analyses it.`,
  ];
}

/** The line about a snapshot of an org that has not ended. */
function unfinished(source: SourceStatus): string[] {
  const snapshot = source.unfinishedSnapshot;
  if (snapshot === null) return [];
  return [
    `Snapshot #${String(snapshot.id)} of "${source.name}" was begun ${snapshot.startedAt} and has not ended: ${String(snapshot.chunksDone)} of ${count(snapshot.chunks, 'chunk is', 'chunks are')} stored. "orglens snapshot ${source.name}" continues it.`,
  ];
}

export async function status(context: Context): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const report = await workspace.status();
  const { store } = report;
  const database =
    store.state === 'ready'
      ? `${store.file}, schema version ${String(store.schemaVersion)}, ${size(store.sizeBytes ?? 0)}, ${store.driver}`
      : `${store.file}: ${store.state}. ${store.problem ?? ''}`.trimEnd();
  return {
    data: report,
    lines: [
      ...table(
        ['Workspace', report.name === null ? report.root : `${report.name} (${report.root})`],
        [
          ['Config', report.configFiles.join(', ')],
          ['Database', database],
        ],
      ),
      '',
      ...(report.sources.length === 0
        ? [NO_SOURCES]
        : table(
            ['SOURCE', 'KIND', 'SNAPSHOTS', 'LATEST SNAPSHOT', 'ANALYSED'],
            report.sources.map((source) => [
              source.name,
              source.kind,
              String(source.snapshots),
              latest(source),
              analysed(source),
            ]),
          )),
      ...report.sources.flatMap(unfinished),
      ...report.sources.flatMap(notAnalysed),
    ],
  };
}

/** The first characters of a commit id, as Git shows it. */
const shortCommit = (commit: string): string => commit.slice(0, 10);

function count(number: number, one: string, many: string): string {
  return `${String(number)} ${number === 1 ? one : many}`;
}

/** At most this many characters of the first issue of a code are shown in the table of the analysis. */
const LONGEST_ISSUE_SHOWN = 200;

/**
 * The lines about the analysis of a snapshot: one sentence, what each origin of references found, and the
 * issues of the analysis. An org can have hundreds of names that are not read, so the issues are shown per
 * code, with their number and the first of them. `--json` has them all.
 */
function analysisLines(report: CoverageReport): string[] {
  const { snapshot, analysis } = report;
  if (analysis === null) {
    // Only a snapshot that has ended is analysed. `analyse` refuses the two others.
    const how =
      snapshot.status === 'running'
        ? `It has not ended. It is continued and then analysed by: orglens snapshot ${snapshot.source}`
        : snapshot.status === 'failed'
          ? 'It was given up, and a snapshot that was given up is never analysed.'
          : `Analyse it with: orglens analyse ${snapshot.source} --snapshot ${String(snapshot.id)}`;
    return ['', `The snapshot is not analysed. ${how}`];
  }
  const lines = [
    '',
    `Analysed by engine ${analysis.engineVersion}: ${count(analysis.components, 'component', 'components')}, ${count(analysis.references, 'reference', 'references')}.${
      analysis.complete ? '' : ' The analysis is incomplete: the errors below say what was not analysed.'
    }`,
  ];
  if (analysis.origins.length > 0) {
    lines.push(
      '',
      ...table(
        ['ORIGIN', 'COMPONENTS', 'REFERENCES', 'NOT RESOLVED', 'PATHS NOT FOLLOWED', 'FILES NOT READ'],
        analysis.origins.map((origin) => [
          origin.origin,
          String(origin.components),
          String(origin.references),
          String(origin.unresolved),
          String(origin.pathsNotFollowed),
          String(origin.failedFiles),
        ]),
      ),
    );
    if (analysis.origins.some((origin) => origin.origin === 'parser:formula' && origin.failedFiles > 0)) {
      lines.push('For parser:formula, FILES NOT READ counts the files with a formula that was not read as a whole.');
    }
  }
  const byCode = new Map<string, { severity: string; code: string; count: number; first: string }>();
  for (const issue of report.issues) {
    if (issue.stage !== 'analysis') continue;
    const id = `${issue.severity} ${issue.code}`;
    const seen = byCode.get(id);
    if (seen === undefined)
      byCode.set(id, { severity: issue.severity, code: issue.code, count: 1, first: issue.message });
    else seen.count += 1;
  }
  if (byCode.size > 0) {
    lines.push(
      '',
      ...table(
        ['SEVERITY', 'CODE', 'COUNT', 'THE FIRST'],
        [...byCode.values()].map((one) => [
          one.severity,
          one.code,
          String(one.count),
          one.first.length > LONGEST_ISSUE_SHOWN ? `${one.first.slice(0, LONGEST_ISSUE_SHOWN)}...` : one.first,
        ]),
      ),
    );
  }
  return lines;
}

/** The lines that describe a snapshot: one sentence, the types, the issues of the reading, and the analysis. */
function coverageLines(report: CoverageReport, headline: string): string[] {
  const { snapshot, types } = report;
  const issues = report.issues.filter((issue) => issue.stage === 'read');
  // What came back although the source had not listed it, per type. The snapshot holds it.
  const unlisted = new Map<string, number>();
  for (const issue of issues) {
    const { type, count: number } = issue.details;
    if (issue.code === 'UNLISTED_COMPONENTS' && typeof type === 'string' && typeof number === 'number') {
      unlisted.set(type, (unlisted.get(type) ?? 0) + number);
    }
  }
  // The components the snapshot holds, not the ones the source listed: of a partial snapshot these are fewer.
  const components = types.reduce((sum, type) => sum + type.retrieved + (unlisted.get(type.type) ?? 0), 0);
  const lines = [
    `${headline} ${count(components, 'component', 'components')} in ${count(snapshot.files, 'file', 'files')} (${size(snapshot.bytes)})${
      snapshot.commit === null ? '' : `, commit ${shortCommit(snapshot.commit)}`
    }.${lacksOtherTypes(report) ? ' Something of other types is missing, and the warnings below say what.' : ''}${
      lacksOfPackages(report)
        ? ' Components of managed packages installed in the org are missing, and the warnings below say which.'
        : ''
    }`,
  ];
  // An org describes hundreds of types and has components of a few of them. A type of which it listed none says
  // nothing in a table. A type it could not list always does, and so does one of which something came back.
  const shown = types.filter(
    (type) =>
      type.listed > 0 || type.retrieved > 0 || type.analysed > 0 || type.listing !== 'ok' || unlisted.has(type.type),
  );
  if (shown.length > 0) {
    // How many listed components are of a managed package, where any is (decision record 0076).
    const ofPackages = shown.some((type) => type.packaged > 0);
    lines.push(
      '',
      ...table(
        ['TYPE', 'LISTED', ...(ofPackages ? ['OF PACKAGES'] : []), 'RETRIEVED', 'ANALYSED'],
        shown.map((type) => {
          const more = unlisted.get(type.type);
          return [
            typeShown(type.type),
            LISTED[type.listing](type.listed),
            ...(ofPackages ? [String(type.packaged)] : []),
            `${String(type.retrieved)}${more === undefined ? '' : ` (and ${String(more)} not listed)`}`,
            String(type.analysed),
          ];
        }),
      ),
    );
  }
  if (shown.length < types.length) {
    lines.push('', `${count(types.length - shown.length, 'more type has', 'more types have')} no components.`);
  }
  if (issues.length > 0) lines.push('', ...table(['SEVERITY', 'CODE', 'WHAT'], readIssueRows(issues)));
  lines.push(...analysisLines(report), ...crossCheckLines(report));
  return lines;
}

/** Codes of the reading that come once for each flow they are about. An org can have hundreds of flows. */
const ONE_PER_FLOW: ReadonlySet<string> = new Set([
  'FLOW_NEWER_VERSION',
  'ACTIVE_FLOW_NOT_RETRIEVED',
  'FLOW_VERSION_UNKNOWN',
]);

type ReadIssue = CoverageReport['issues'][number];

/**
 * The row an issue of the reading shares with others, or undefined for an issue with a row of its own: what is
 * the same for all issues of the row, and what they are counted as.
 *
 * - A code that comes once for each flow has one row for each reason it gives (`details.reason`), and one row
 *   where it gives none: the reasons of `FLOW_VERSION_UNKNOWN` call for different things to do.
 * - `RESOLVE_FAILED` comes once for each file that cannot be read as metadata, and an org can hand out hundreds
 *   of files of a type the Salesforce library does not know. The issues that are counted with the same types and
 *   say the same of the place they name share a row. Where nothing tells the type, only the issues of one top
 *   folder do: nothing else says that the files are of one kind, and the row shows the place of the first only.
 *   A place is a file, a folder or a component, so the row counts issues. An issue that does not say which types
 *   it is counted with has a row of its own: one of a Git source, and one of a snapshot that was taken before
 *   issues said so.
 */
function sharedRow(issue: ReadIssue): { readonly id: string; readonly counted: string } | undefined {
  const { at, reason, types } = issue.details;
  if (ONE_PER_FLOW.has(issue.code)) {
    return { id: JSON.stringify([issue.severity, issue.code, reason ?? null]), counted: 'flows' };
  }
  if (issue.code !== 'RESOLVE_FAILED' || typeof at !== 'string' || !Array.isArray(types)) return undefined;
  if (!issue.message.startsWith(at)) return undefined;
  // The Salesforce library names the place once more in what it says. So the place is taken out wherever it
  // stands, and two messages that differ in nothing else say the same.
  const said = issue.message.split(at).join('');
  const slash = at.indexOf('/');
  const folder = types.length === 0 && slash > 0 ? at.slice(0, slash) : null;
  return { id: JSON.stringify([issue.severity, issue.code, types, folder, said]), counted: 'issues of this kind' };
}

/**
 * The issues of the reading as rows: one for each issue, and one for the issues that share a row, with their
 * number and the first of them. `--json` has every issue. It is exported for its tests.
 */
export function readIssueRows(issues: readonly ReadIssue[]): string[][] {
  const rows: string[][] = [];
  const shared = new Map<string, { row: string[]; count: number; first: string }>();
  for (const issue of issues) {
    const row = [issue.severity, issue.code, issue.message];
    const share = sharedRow(issue);
    const seen = share === undefined ? undefined : shared.get(share.id);
    if (share === undefined || seen === undefined) {
      if (share !== undefined) shared.set(share.id, { row, count: 1, first: issue.message });
      rows.push(row);
    } else {
      seen.count += 1;
      seen.row[2] = `${String(seen.count)} ${share.counted}. The first: ${seen.first}`;
    }
  }
  return rows;
}

/** At most this many pairs of a list of the cross-check are shown as text. `--json` has all of them. */
const MOST_PAIRS_SHOWN = 20;

/** A list of pairs of the cross-check as lines: a sentence, and a table of the first of them. */
function pairLines(pairs: readonly { readonly from: string; readonly to: string }[], sentence: string): string[] {
  if (pairs.length === 0) return [];
  const shown = pairs.slice(0, MOST_PAIRS_SHOWN);
  const lines = [
    '',
    sentence,
    ...table(
      ['FROM', 'TO'],
      shown.map(({ from, to }) => [from, to]),
    ),
  ];
  if (shown.length < pairs.length) {
    lines.push(`${count(pairs.length - shown.length, 'more pair', 'more pairs')}: --json has all of them.`);
  }
  return lines;
}

/** Numbers with what they count, such as `CustomField 4, Flow 2`. */
const tally = (parts: readonly (readonly [string, number])[]): string =>
  parts.map(([name, number]) => `${name} ${String(number)}`).join(', ');

/**
 * The lines about the cross-check of a snapshot of an org: how the Dependency API of Salesforce was read, and
 * what holding its rows against the analysis found. Nothing for a snapshot of a repository.
 */
function crossCheckLines(report: CoverageReport): string[] {
  const { snapshot, crossCheck } = report;
  if (crossCheck === null) {
    if (snapshot.kind === 'git' || snapshot.status === 'running' || snapshot.status === 'failed') return [];
    return ['', 'The Dependency API of Salesforce was not asked for this snapshot. Its analysis is not cross-checked.'];
  }
  if (crossCheck.state === 'none') {
    return [
      '',
      `Cross-check: the Dependency API of Salesforce gave no answer (${crossCheck.code ?? 'no code'}). Nothing was compared.`,
    ];
  }
  const left = crossCheck.queriesCutOff + crossCheck.queriesFailed;
  const lacks: string[] = [];
  if (left > 0) {
    lacks.push(
      `Rows are missing, or may be: ${count(left, 'query was', 'queries were')} cut off or failed${
        crossCheck.code === null ? '' : ` (${crossCheck.code})`
      }.`,
    );
  }
  if (crossCheck.queriesNotProven > 0) {
    lacks.push(
      `Rows of a component the org did not list may be missing: ${count(crossCheck.queriesNotProven, 'query', 'queries')} near the limit of the API ${crossCheck.queriesNotProven === 1 ? 'was' : 'were'} asked again component by component.`,
    );
  }
  const read = crossCheck.state === 'whole' ? 'No answer shows that a row is missing.' : lacks.join(' ');
  const lines = [
    '',
    `Cross-check: the Dependency API of Salesforce reports ${count(crossCheck.rows, 'row', 'rows')}. ${read}`,
  ];
  const { comparison } = crossCheck;
  if (comparison === null) {
    lines.push(
      report.analysis === null
        ? 'They were not compared: the snapshot is not analysed.'
        : `They were not compared by this version of OrgLens. Compare them with: orglens analyse ${snapshot.source} --snapshot ${String(snapshot.id)}`,
    );
    return lines;
  }
  if (comparison.rowsNotAnalysed > 0) {
    lines.push(
      `${count(comparison.rowsNotAnalysed, 'row is', 'rows are')} from a component of a type that is not analysed, and ${comparison.rowsNotAnalysed === 1 ? 'is' : 'are'} not compared: ${tally(comparison.notAnalysed.map(({ type, rows }) => [type, rows]))}.`,
    );
  }
  if (comparison.rowsNotMatched > 0) {
    lines.push(
      `${count(comparison.rowsNotMatched, 'row names', 'rows name')} a component the org did not list, and ${comparison.rowsNotMatched === 1 ? 'is' : 'are'} not compared.`,
    );
  }
  if (comparison.rowsNotHeld > 0) {
    lines.push(
      `${count(comparison.rowsNotHeld, 'row is', 'rows are')} from a component the snapshot does not hold or that was not analysed, and ${comparison.rowsNotHeld === 1 ? 'is' : 'are'} not compared.`,
    );
  }
  if (comparison.rowsOtherVersion > 0) {
    lines.push(
      `${count(comparison.rowsOtherVersion, 'row is', 'rows are')} from a version of a flow that the snapshot does not hold, such as a draft, and ${comparison.rowsOtherVersion === 1 ? 'is' : 'are'} not compared.`,
    );
  }
  const missed = comparison.missed.length;
  // A row that is missing, or that names a component the org did not list, can be the row of such a pair.
  const unseen = crossCheck.state !== 'whole' || comparison.rowsNotMatched > 0;
  const one = comparison.onlyOrgLens.length === 1;
  lines.push(
    comparison.rowsCompared === 0
      ? 'No row was compared.'
      : `${count(comparison.rowsCompared, 'row was', 'rows were')} compared. ${comparison.rowsCompared === 1 ? 'It is' : 'They are'} ${count(comparison.pairs, 'pair', 'pairs')} of components: the analysis has ${String(comparison.agreed)} of them, has ${String(comparison.coveredByPart)} as a reference to a part of the object Salesforce names, and missed ${String(missed)}.`,
  );
  lines.push(
    ...pairLines(
      comparison.missed,
      missed === 1
        ? 'Salesforce reports this reference, and the analysis has none. It is an error of the analysis:'
        : 'Salesforce reports these references, and the analysis has none. Each is an error of the analysis:',
    ),
    ...pairLines(
      comparison.onlyOrgLens,
      `The analysis has ${count(comparison.onlyOrgLens.length, 'reference', 'references')} of a kind Salesforce reports, without a row${unseen ? ' that was compared' : ''}. Either the analysis is wrong there, or the API left ${one ? 'it' : 'them'} out${unseen ? `, or ${one ? 'its row is' : 'their rows are'} among those that are missing or not compared` : ''}:`,
    ),
  );
  const notReported = comparison.notReported.reduce((sum, { pairs }) => sum + pairs, 0);
  if (notReported > 0) {
    lines.push(
      '',
      `The analysis has ${count(notReported, 'more reference', 'more references')} of kinds the API does not report: ${tally(comparison.notReported.map(({ reason, pairs }) => [reason, pairs]))}.`,
    );
  }
  return lines;
}

/** The exit code for a snapshot: `partial` if something was not read, or if something was not analysed. */
const exitOf = (report: CoverageReport): typeof EXIT.ok | typeof EXIT.partial =>
  report.snapshot.status === 'complete' && report.analysis?.complete !== false ? EXIT.ok : EXIT.partial;

/**
 * A type as a table names it. The component that holds the custom labels and a label are two types whose names
 * differ by a letter, and both have a line: the line of the one that holds them says what it is. A repository can
 * keep it in more files than one, so the words do not speak of a file.
 */
const typeShown = (type: string): string => (type === 'CustomLabels' ? 'CustomLabels (holds the labels)' : type);

/** How many components a source listed, with what is to be known about the number. */
const LISTED: Readonly<Record<CoverageReport['types'][number]['listing'], (listed: number) => string>> = {
  ok: (listed) => String(listed),
  failed: (listed) => `${String(listed)} (listing failed)`,
  unlistable: () => 'not listed',
  excluded: () => 'left out',
};

/**
 * At most one line about the listing in this many milliseconds, and one about the Dependency API. An org is
 * asked hundreds of times.
 */
const PROGRESS_LINE_EVERY_MS = 5_000;

/** Turns what the engine tells about a snapshot of an org into lines. */
function progressLines(source: string, write: (line: string) => void): (event: SnapshotProgress) => void {
  let listingSaid = 0;
  let crossCheckSaid = 0;
  return (event) => {
    if (event.step === 'connected') {
      write(`Logged in to the org of "${source}". It is read with API version ${event.apiVersion}.`);
    } else if (event.step === 'listing') {
      if (Date.now() - listingSaid < PROGRESS_LINE_EVERY_MS) return;
      listingSaid = Date.now();
      write(
        `Asking the org what it holds: ${String(event.done)} of ${count(event.total, 'request', 'requests')} answered.`,
      );
    } else if (event.step === 'planned') {
      write(
        `Snapshot #${String(event.snapshot)}: the org lists ${count(event.components, 'component', 'components')}. They are retrieved in ${count(event.chunks, 'chunk', 'chunks')}.`,
      );
    } else if (event.step === 'resumed') {
      write(
        `Snapshot #${String(event.snapshot)} was interrupted and is continued: ${String(event.done)} of ${count(event.chunks, 'chunk is', 'chunks are')} stored.`,
      );
    } else if (event.step === 'retrieved') {
      write(
        `Snapshot #${String(event.snapshot)}: ${String(event.done)} of ${count(event.chunks, 'chunk is', 'chunks are')} stored.`,
      );
    } else if (event.step === 'flow-versions') {
      write(
        `Snapshot #${String(event.snapshot)}: every chunk is stored. Asking for the active version of ${count(event.flows, 'flow', 'flows')} whose latest version is not active.`,
      );
    } else if (event.step === 'cross-checking') {
      if (event.requests === 0) {
        write(
          `Snapshot #${String(event.snapshot)}: every chunk is done. Asking the Dependency API of Salesforce which references it knows.`,
        );
        // A small org is done with one request. The first line about how far it is comes after a while.
        crossCheckSaid = Date.now();
      } else if (Date.now() - crossCheckSaid >= PROGRESS_LINE_EVERY_MS) {
        crossCheckSaid = Date.now();
        write(
          `Snapshot #${String(event.snapshot)}: the Dependency API gave ${count(event.rows, 'row', 'rows')} so far, in ${count(event.requests, 'request', 'requests')}.`,
        );
      }
    } else {
      write(`Snapshot #${String(event.snapshot)}: its files are stored. Analysing them.`);
    }
  };
}

const SNAPSHOT_VERDICT: Readonly<Record<CoverageReport['snapshot']['status'], string>> = {
  complete: 'is complete:',
  partial: 'is partial, something is missing:',
  running: 'has not ended:',
  failed: 'failed:',
};

/**
 * True for a snapshot of an org that is complete and lacks something of a type outside the logic tier, by which
 * it is not judged. The warnings of its reading say what.
 */
const lacksOtherTypes = (report: CoverageReport): boolean =>
  report.snapshot.status === 'complete' &&
  report.issues.some(
    (issue) => issue.stage === 'read' && issue.severity === 'warning' && issue.details['tier'] === 'other',
  );

/**
 * True for a snapshot of an org that lacks components of a managed package installed in it, which make no
 * snapshot partial (decision record 0076). The warnings of its reading say which.
 */
const lacksOfPackages = (report: CoverageReport): boolean =>
  report.issues.some(
    (issue) => issue.stage === 'read' && issue.code === 'NOT_RETRIEVED' && issue.details['ofPackages'] === true,
  );

/** What a snapshot is called. One that lacks something outside the logic tier is called complete for that tier. */
const verdictOf = (report: CoverageReport): string =>
  lacksOtherTypes(report) ? 'is complete for the logic tier:' : SNAPSHOT_VERDICT[report.snapshot.status];

export async function snapshot(
  context: Context,
  source: string,
  options: { restart?: boolean | undefined; crossCheck?: boolean | undefined } = {},
): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const report = await workspace.snapshot(source, {
    restart: options.restart,
    crossCheck: options.crossCheck,
    onProgress: progressLines(source, context.progress),
  });
  return {
    data: report,
    lines: coverageLines(report, `Snapshot #${String(report.snapshot.id)} of "${source}" ${verdictOf(report)}`),
    exitCode: exitOf(report),
  };
}

/** The value of `--snapshot`: the number of a snapshot. */
function snapshotNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]{0,14}$/.test(value)) {
    throw new UsageError(`--snapshot takes the number of a snapshot, and "${value}" is not one.`);
  }
  return Number(value);
}

export async function analyse(
  context: Context,
  source: string,
  options: { snapshot?: string | undefined },
): Promise<Outcome> {
  const id = snapshotNumber(options.snapshot);
  const workspace = await openWorkspace(locator(context));
  const report = await workspace.analyse(source, { snapshot: id });
  return {
    data: report,
    lines: coverageLines(
      report,
      `Snapshot #${String(report.snapshot.id)} of "${source}" was analysed from the files it holds. It ${verdictOf(report)}`,
    ),
    exitCode: exitOf(report),
  };
}

export async function coverage(
  context: Context,
  source: string,
  options: { snapshot?: string | undefined },
): Promise<Outcome> {
  const id = snapshotNumber(options.snapshot);
  const workspace = await openWorkspace(locator(context));
  const report = await workspace.coverage(source, { snapshot: id });
  const { finishedAt, startedAt } = report.snapshot;
  return {
    data: report,
    lines: coverageLines(
      report,
      `Snapshot #${String(report.snapshot.id)} of "${source}", ${finishedAt === null ? `started ${startedAt}` : `taken ${finishedAt}`}, ${verdictOf(report)}`,
    ),
  };
}

export async function doctorCommand(context: Context): Promise<Outcome> {
  const report = await doctor(locator(context));
  const failed = report.checks.filter((check) => check.status === 'failed').length;
  const warnings = report.checks.filter((check) => check.status === 'warning').length;
  const verdict =
    failed > 0
      ? `${String(failed)} ${failed === 1 ? 'check' : 'checks'} failed.`
      : warnings > 0
        ? `OrgLens can run here. ${String(warnings)} ${warnings === 1 ? 'check deserves' : 'checks deserve'} a look.`
        : 'OrgLens can run here.';
  return {
    data: report,
    lines: [
      `OrgLens engine ${report.engineVersion}`,
      '',
      ...table(
        ['STATUS', 'CHECK', 'FINDING'],
        report.checks.map((check) => [check.status, check.id, check.summary]),
      ),
      '',
      verdict,
    ],
    exitCode: report.ok ? EXIT.ok : EXIT.failure,
  };
}

/** The options of `impact`, as the argument parser delivers them. */
export interface ImpactCommandOptions {
  readonly source?: string | undefined;
  readonly snapshot?: string | undefined;
  readonly depth?: string | undefined;
  readonly minConfidence?: ConfidenceTier | undefined;
  readonly outgoing?: boolean | undefined;
  readonly packages?: boolean | undefined;
}

/** The value of `--depth`: how many references away the answer goes. */
function depthNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]{0,8}$/.test(value)) {
    throw new UsageError(`--depth takes a whole number from 1, and "${value}" is not one.`);
  }
  return Number(value);
}

/** The source a question is about: the one that was named, or the only one the workspace declares. */
function onlySource(named: string | undefined, declared: readonly SourceDeclaration[]): string {
  if (named !== undefined) return named;
  const [first, second] = declared;
  if (first === undefined) {
    throw new UsageError('The workspace declares no source.', 'Declare one with: orglens source add');
  }
  if (second !== undefined) {
    throw new UsageError(
      `The workspace declares ${String(declared.length)} sources. Say which one is meant with --source <name>.`,
      `The sources: ${declared.map((source) => source.name).join(', ')}`,
    );
  }
  return first.name;
}

/** Where a reference stands, as editors take it: the file and the line. */
const place = (step: { readonly file: string | null; readonly line: number | null }): string =>
  step.file === null ? 'no place' : `${step.file}${step.line === null ? '' : `:${String(step.line)}`}`;

/** The sentences that say why an answer is not complete, each without its full stop. */
function gapReasons(gaps: ImpactGaps): string[] {
  const reasons: string[] = [];
  if (gaps.notAnalysed.length > 0) {
    reasons.push(`${count(gaps.notAnalysed.length, 'type is', 'types are')} not analysed yet`);
  }
  if (gaps.partial.length > 0) {
    reasons.push(`the snapshot holds ${count(gaps.partial.length, 'analysed type', 'analysed types')} only in part`);
  }
  if (gaps.readErrors > 0) {
    reasons.push(
      `${count(gaps.readErrors, 'error of the reading names', 'errors of the reading name')} no type, so what is missing may be of an analysed type`,
    );
  }
  // The errors are those of the whole analysis, the warnings only those that bear on the answer (decision record
  // 0074).
  if (gaps.analysisErrors > 0) reasons.push(`the analysis had ${count(gaps.analysisErrors, 'error', 'errors')}`);
  if (gaps.analysisWarnings > 0) {
    const bear = gaps.analysisWarnings === 1 ? 'bears' : 'bear';
    reasons.push(
      gaps.analysisErrors > 0
        ? `${String(gaps.analysisWarnings)} of its warnings ${bear} on the answer`
        : `${count(gaps.analysisWarnings, 'warning', 'warnings')} of the analysis ${bear} on the answer`,
    );
  }
  if (gaps.notHeld > 0) {
    reasons.push(
      `the snapshot does not hold ${count(gaps.notHeld, 'component', 'components')} of the answer, so what ${gaps.notHeld === 1 ? 'it refers' : 'they refer'} to is not known`,
    );
  }
  return reasons;
}

function impactLines(report: ImpactReport): string[] {
  const { component, snapshot, results, notCovered } = report;
  const incoming = report.direction === 'incoming';
  const named = `${component.key}${component.name === null ? '' : ` (${component.name})`}`;
  const scope = [
    `in snapshot #${String(snapshot.id)} of "${snapshot.source}"`,
    report.depth === null ? null : `to a depth of ${String(report.depth)}`,
    report.minConfidence === 'possible' ? null : `over references that are at least ${report.minConfidence}`,
  ]
    .filter((part) => part !== null)
    .join(', ');
  const lines = [incoming ? `What refers to ${named}, ${scope}.` : `What ${named} refers to, ${scope}.`];
  if (component.package !== null) {
    lines.push(`It is of the managed package ${component.package}, which is installed in the org.`);
  }
  // A name alone that fits an object and more means the object, and one that fits a flow and its definition means
  // the flow (decision records 0064 and 0082). The others are named, so that none is missed.
  if (report.sameName.length > 0) {
    const about = component.key.startsWith('Flow:') ? 'the flow' : 'the object';
    lines.push(
      `The name also fits ${report.sameName.join(', ')}. The answer is about ${about}. To ask about ${report.sameName.length === 1 ? 'the other' : 'another'}, name it by its key.`,
    );
  }
  if (report.parts > 0) {
    lines.push(
      `It contains ${count(report.parts, 'component', 'components')} of the snapshot. The answer is about ${report.parts === 1 ? 'it' : 'them'} too.`,
    );
  }
  // A flow runs its elements: what calls the flow runs the element.
  if (incoming && report.elementOf !== null) {
    lines.push(`It is an element of ${report.elementOf}. What refers to the flow refers to it too.`);
  }

  // What the answer does not cover comes before the answer: a short list must not be read as a complete one.
  const reasons = gapReasons(notCovered);
  if (reasons.length === 0) {
    lines.push(
      incoming
        ? 'The answer is complete: every type that can refer to it was analysed, and the analysis had no error and no warning that bears on it.'
        : 'The answer is complete: the snapshot holds every component in it, and each was analysed, without an error or a warning.',
    );
  } else {
    lines.push(`The answer is not complete: ${reasons.join(', and ')}. The details are below the answer.`);
  }
  if (!incoming && component.name === null) {
    lines.push('The snapshot does not hold the component itself: what it refers to is not known.');
  } else if (!incoming && notCovered.notAnalysed.some((gap) => gap.type === component.type)) {
    lines.push(`${component.type} is not analysed yet: what the component itself refers to is not known.`);
  }

  const direct = results.filter((result) => result.depth === 1).length;
  const leftOut = report.packagesLeftOut;
  lines.push('');
  if (results.length === 0) {
    lines.push(
      incoming
        ? leftOut > 0
          ? 'Nothing of the org itself that was analysed refers to it.'
          : 'Nothing that was analysed refers to it.'
        : 'It refers to no component, as far as it was analysed.',
    );
  } else if (incoming) {
    lines.push(
      `${count(results.length, 'component refers', 'components refer')} to it, ${direct === results.length ? (direct === 1 ? 'directly' : 'all of them directly') : `${String(direct)} of them directly`}.`,
    );
  } else {
    lines.push(
      `It refers to ${count(results.length, 'component', 'components')}, ${direct === results.length ? 'directly' : `to ${String(direct)} of them directly`}.`,
    );
  }
  // A component of a package is left out as the thing that refers, and never silently (decision record 0076).
  if (leftOut > 0) {
    lines.push(
      `${count(leftOut, 'component of a managed package refers', 'components of managed packages refer')} to it as well, and ${leftOut === 1 ? 'is' : 'are'} left out. --packages keeps ${leftOut === 1 ? 'it' : 'them'}.`,
    );
  }
  // A flow refers to what its elements refer to, and is found by the reference of one of them.
  if (incoming && results.some((result) => result.reference.from !== result.key)) {
    lines.push('A flow is listed with the reference of one of its elements, which is listed after it.');
  }
  // Beyond depth 1, the nearer end of a reference is a result, or an element of a flow that is one.
  const listed = new Set(results.map((result) => result.key));
  if (incoming && leftOut > 0 && results.some((result) => result.depth > 1 && !listed.has(result.reference.to))) {
    lines.push('REFERS TO can name a component of a managed package, which is left out.');
  }
  if (!incoming && results.some((result) => result.depth > 1 && !listed.has(result.reference.from))) {
    lines.push(
      'A flow refers to what its elements refer to: REFERRED TO BY can name an element of a listed flow, which is not listed itself.',
    );
  }
  if (results.length > 0) {
    // The package of a result is shown where one of them is of a package.
    const ofPackages = results.some((result) => result.package !== null);
    lines.push(
      '',
      ...table(
        [
          'DEPTH',
          'COMPONENT',
          ...(ofPackages ? ['PACKAGE'] : []),
          'CONFIDENCE',
          'KIND',
          incoming ? 'REFERS TO' : 'REFERRED TO BY',
          'WHERE',
        ],
        // The reference a result is found by: it stands in the result itself, or names it.
        results.map(({ depth, key, confidence, reference, package: of }) => [
          String(depth),
          key,
          ...(ofPackages ? [of ?? 'none'] : []),
          confidence,
          reference.kind,
          incoming ? reference.to : reference.from,
          place(reference),
        ]),
      ),
    );
  }
  if (report.beyondDepth) {
    lines.push(
      '',
      `The answer stops at depth ${String(report.depth)}, and references lead further. Ask again with a larger --depth, or without it.`,
    );
  }
  if (report.unresolved.length > 0) {
    lines.push(
      '',
      `${count(report.unresolved.length, 'reference names', 'references name')} something that has no component in the snapshot:`,
      ...table(
        ['DEPTH', 'FROM', 'KIND', 'TYPE', 'NAME', 'WHERE'],
        report.unresolved.map((one) => [String(one.depth), one.from, one.kind, one.type, one.name, place(one)]),
      ),
    );
  }

  for (const { flow, active, newer } of report.newerVersions) {
    lines.push(
      '',
      `${flow} has a version newer than its active version ${String(active)}, which is ${newer}. The answer is about the active version, and the newer one is not analysed.`,
    );
  }

  const gapTable = (gaps: ImpactReport['notCovered']['partial']): string[] =>
    table(
      ['TYPE', 'LISTED', 'RETRIEVED'],
      gaps.map((gap) => [typeShown(gap.type), LISTED[gap.listing](gap.listed), String(gap.retrieved)]),
    );
  const about = `orglens coverage ${snapshot.source} --snapshot ${String(snapshot.id)}`;
  if (notCovered.notAnalysed.length > 0) {
    lines.push(
      '',
      incoming
        ? 'Not analysed yet. A component of these types may refer to it, and is not in the answer:'
        : 'Not analysed yet. What the components of these types in the answer refer to is not known:',
      ...gapTable(notCovered.notAnalysed),
    );
  }
  if (notCovered.partial.length > 0) {
    lines.push(
      '',
      'Analysed, and the snapshot holds less than the source has. The answer may miss a component of these types:',
      ...gapTable(notCovered.partial),
    );
  }
  if (notCovered.readErrors > 0) {
    lines.push(
      '',
      `${count(notCovered.readErrors, 'error of the reading names', 'errors of the reading name')} no type: a file or a folder could not be read. See: ${about}`,
    );
  }
  if (notCovered.analysisErrors > 0) {
    lines.push(
      '',
      `The analysis had ${count(notCovered.analysisErrors, 'error', 'errors')}: something of an analysed type was not read. See: ${about}`,
    );
  }
  if (notCovered.analysisWarnings > 0) {
    lines.push(
      '',
      `${count(notCovered.analysisWarnings, 'warning', 'warnings')} of the analysis ${notCovered.analysisWarnings === 1 ? 'bears' : 'bear'} on the answer: a name was not read, a path was not followed, or a part of a file was not found. A reference may be missing for each. See: ${about}`,
    );
  }
  if (notCovered.notHeld > 0) {
    lines.push(
      '',
      `The snapshot does not hold ${count(notCovered.notHeld, 'component', 'components')} of the answer, such as a standard field or a component of a package. What ${notCovered.notHeld === 1 ? 'it refers' : 'they refer'} to is not known.`,
    );
  }
  return lines;
}

export async function impact(context: Context, component: string, options: ImpactCommandOptions): Promise<Outcome> {
  const snapshotId = snapshotNumber(options.snapshot);
  const depth = depthNumber(options.depth);
  const workspace = await openWorkspace(locator(context));
  const source = onlySource(options.source, await workspace.sources.list());
  const report = await workspace.impact(source, component, {
    snapshot: snapshotId,
    depth,
    minConfidence: options.minConfidence,
    outgoing: options.outgoing,
    packages: options.packages,
  });
  return {
    data: report,
    lines: impactLines(report),
    // The answer is there. It may miss something of a type it covers, which a script must be able to tell.
    exitCode: report.mayMiss ? EXIT.partial : EXIT.ok,
  };
}
