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
  type CoverageReport,
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
            ['SOURCE', 'KIND', 'SNAPSHOTS', 'LATEST SNAPSHOT'],
            report.sources.map((source) => [source.name, source.kind, String(source.snapshots), latest(source)]),
          )),
    ],
  };
}

/** The first characters of a commit id, as Git shows it. */
const shortCommit = (commit: string): string => commit.slice(0, 10);

function count(number: number, one: string, many: string): string {
  return `${String(number)} ${number === 1 ? one : many}`;
}

/** The lines that describe a snapshot: one sentence, the types, and the issues. */
function coverageLines(report: CoverageReport, headline: string): string[] {
  const { snapshot, types, issues } = report;
  const components = types.reduce((sum, type) => sum + type.listed, 0);
  const lines = [
    `${headline} ${count(components, 'component', 'components')} in ${count(snapshot.files, 'file', 'files')} (${size(snapshot.bytes)})${
      snapshot.commit === null ? '' : `, commit ${shortCommit(snapshot.commit)}`
    }.`,
  ];
  if (types.length > 0) {
    lines.push(
      '',
      ...table(
        ['TYPE', 'LISTED', 'RETRIEVED', 'ANALYSED'],
        types.map((type) => [type.type, String(type.listed), String(type.retrieved), String(type.analysed)]),
      ),
    );
  }
  if (issues.length > 0) {
    lines.push(
      '',
      ...table(
        ['SEVERITY', 'CODE', 'WHAT'],
        issues.map((issue) => [issue.severity, issue.code, issue.message]),
      ),
    );
  }
  return lines;
}

const SNAPSHOT_VERDICT: Readonly<Record<CoverageReport['snapshot']['status'], string>> = {
  complete: 'is complete:',
  partial: 'is partial, something is missing:',
  running: 'has not ended:',
  failed: 'failed:',
};

export async function snapshot(context: Context, source: string): Promise<Outcome> {
  const workspace = await openWorkspace(locator(context));
  const report = await workspace.snapshot(source);
  const { id, status } = report.snapshot;
  return {
    data: report,
    lines: coverageLines(report, `Snapshot #${String(id)} of "${source}" ${SNAPSHOT_VERDICT[status]}`),
    exitCode: status === 'complete' ? EXIT.ok : EXIT.partial,
  };
}

export async function coverage(
  context: Context,
  source: string,
  options: { snapshot?: string | undefined },
): Promise<Outcome> {
  let id: number | undefined;
  if (options.snapshot !== undefined) {
    if (!/^[1-9][0-9]{0,14}$/.test(options.snapshot)) {
      throw new UsageError(`--snapshot takes the number of a snapshot, and "${options.snapshot}" is not one.`);
    }
    id = Number(options.snapshot);
  }
  const workspace = await openWorkspace(locator(context));
  const report = await workspace.coverage(source, { snapshot: id });
  const { status, finishedAt, startedAt } = report.snapshot;
  return {
    data: report,
    lines: coverageLines(
      report,
      `Snapshot #${String(report.snapshot.id)} of "${source}", ${finishedAt === null ? `started ${startedAt}` : `taken ${finishedAt}`}, ${SNAPSHOT_VERDICT[status]}`,
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
