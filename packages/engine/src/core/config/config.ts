/**
 * The configuration of a workspace.
 *
 * Two files are read. `orglens.toml` is shared and committed: it declares
 * the sources. `.orglens/local.toml` is personal and never committed: it
 * holds what differs from one machine to the next. Neither holds a
 * credential, and a value that looks like one is refused.
 *
 * Reading is strict. An unknown key is an error, so a typing mistake is
 * never read as "use the default". Every problem is reported with its file,
 * line and column, and all problems of a file are reported together.
 *
 * A key exists here only once a feature reads it. Keys for later features
 * (metadata scope, retention, retrieve limits) are added with those features.
 *
 * The variables of the environment that carry a login for a job without a
 * person (`ORGLENS_JWT_...`) are not read here. They hold a key, and only
 * the code that logs in looks at them.
 */
import { parse, TomlError } from 'smol-toml';
import type { JsonValue } from '../errors.ts';
import { hasSecretShape, redactText } from '../redact.ts';
import { readLayout, type TomlLayout } from './layout.ts';

export const SHARED_CONFIG_FILE = 'orglens.toml';
export const LOCAL_CONFIG_FILE = '.orglens/local.toml';
const CONFIG_SCHEMA_VERSION = 1;

/** The SQLite bindings the store can use, by the name of their driver. */
const STORE_DRIVERS = ['node:sqlite', 'better-sqlite3'] as const;
export type StoreDriverName = (typeof STORE_DRIVERS)[number];

/** The environment variable that selects the SQLite binding. It wins over the local file. */
const DRIVER_VARIABLE = 'ORGLENS_SQLITE_DRIVER';

const SOURCE_KINDS = ['org', 'sandbox', 'git'] as const;

interface SourceBase {
  /** The name used on the command line and in the database. */
  readonly name: string;
  readonly description: string | null;
}

/** A production or developer org. */
export interface OrgSource extends SourceBase {
  readonly kind: 'org';
  /** The Salesforce org id. It identifies the org and is not a credential. */
  readonly orgId: string | null;
  readonly loginUrl: string | null;
}

/** A sandbox. */
export interface SandboxSource extends SourceBase {
  readonly kind: 'sandbox';
  readonly orgId: string | null;
  readonly loginUrl: string | null;
  /** The name of the org source this is a sandbox of. */
  readonly sandboxOf: string | null;
  readonly sandboxName: string | null;
}

/** A set of folders in a Git repository that together hold the metadata of one org. */
export interface GitSource extends SourceBase {
  readonly kind: 'git';
  /** The repository, relative to the workspace root. `.` is the repository the workspace is in. */
  readonly repo: string;
  /** A branch, tag or commit. `null` reads the working tree as it is on disk. */
  readonly ref: string | null;
  /** The folders, relative to the repository. `null` uses the package directories of `sfdx-project.json`. */
  readonly paths: readonly string[] | null;
  /** The name of the org or sandbox source this repository is the source of truth for. */
  readonly tracks: string | null;
}

export type SourceDeclaration = OrgSource | SandboxSource | GitSource;

export interface WorkspaceConfig {
  /** A label for output. It has no function. */
  readonly name: string | null;
  /** The declared sources, in the order of the file. */
  readonly sources: readonly SourceDeclaration[];
  readonly store: {
    readonly driver: StoreDriverName;
    /** Where the choice of driver comes from. */
    readonly driverSetBy: 'default' | 'local' | 'environment';
  };
  /**
   * The Salesforce CLI login this person uses for a source, by the name of
   * the source: an alias or a user name. From the personal file. A source
   * without an entry is matched to a login by its org id.
   */
  readonly logins: Readonly<Record<string, string>>;
  /**
   * The names in the personal file that carry a login and are no source of
   * the shared file. They are not an error: the shared file is changed by
   * others. `doctor` names them.
   */
  readonly unusedLogins: readonly string[];
}

/** One problem in a configuration file. */
export interface ConfigDiagnostic {
  /** The file, relative to the workspace root, or `environment` for an environment variable. */
  readonly file: string;
  /** Starts at 1. `null` when the problem has no place in a file. */
  readonly line: number | null;
  readonly column: number | null;
  /** The key, such as `sources.prod.org_id`, or the name of the environment variable. Empty for the file itself. */
  readonly path: string;
  readonly message: string;
}

export interface ConfigInput {
  /** The text of `orglens.toml`. */
  readonly shared: string;
  /** The text of `.orglens/local.toml`, or `undefined` if there is none. */
  readonly local?: string | undefined;
  /** The environment. Only the variables named in this module are read. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: WorkspaceConfig }
  | { readonly ok: false; readonly diagnostics: readonly ConfigDiagnostic[] };

type Table = Record<string, unknown>;
type Path = readonly (string | number)[];

export const SOURCE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const ORG_ID = /^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;
const SANDBOX_NAME = /^[A-Za-z0-9]{1,10}$/;
const GIT_REF = /^[^\s~^:?*[\\\p{Cc}]+$/u;
const CONTROL = /\p{Cc}/u;

const isTable = (value: unknown): value is Table =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

const formatPath = (path: Path): string =>
  path.reduce<string>(
    (text, part) => (typeof part === 'number' ? `${text}[${String(part)}]` : text === '' ? part : `${text}.${part}`),
    '',
  );

const quoteList = (values: readonly string[]): string => values.map((value) => `"${value}"`).join(', ');

/** Collects the problems of one file. */
class FileReport {
  readonly diagnostics: ConfigDiagnostic[] = [];
  readonly #file: string;
  readonly #layout: TomlLayout;

  constructor(file: string, layout: TomlLayout) {
    this.#file = file;
    this.#layout = layout;
  }

  add(path: Path, message: string): void {
    const { line, column } = this.#layout.positionOf(path);
    // A message quotes the value it is about, and a key can be anything. Neither may carry a credential out of
    // the file and into a terminal, a log or the output of a CI job.
    this.diagnostics.push({
      file: this.#file,
      line,
      column,
      path: redactText(formatPath(path)),
      message: redactText(message),
    });
  }
}

/** Reads the keys of one table, and reports the keys nothing asked for. */
class TableReader {
  readonly path: Path;
  readonly #table: Table;
  readonly #report: FileReport;
  readonly #known: string[] = [];

  constructor(table: Table, path: Path, report: FileReport) {
    this.#table = table;
    this.path = path;
    this.#report = report;
  }

  /** Reports a problem with a key of this table, or with one item of a list under that key. */
  fail(key: string, message: string, index?: number): undefined {
    this.#report.add(index === undefined ? [...this.path, key] : [...this.path, key, index], message);
    return undefined;
  }

  #take(key: string): unknown {
    this.#known.push(key);
    return this.#table[key];
  }

  has(key: string): boolean {
    return this.#table[key] !== undefined;
  }

  string(key: string): string | undefined {
    const value = this.#take(key);
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
      this.fail(key, 'This must be text in quotes.');
      return;
    }
    if (CONTROL.test(value)) {
      this.fail(key, 'This must not contain control characters or line breaks.');
      return;
    }
    return value;
  }

  oneOf<T extends string>(key: string, allowed: readonly T[]): T | undefined {
    const value = this.string(key);
    if (value === undefined) return undefined;
    if (!(allowed as readonly string[]).includes(value)) {
      this.fail(key, `"${value}" is not allowed here. Use one of ${quoteList(allowed)}.`);
      return;
    }
    return value as T;
  }

  table(key: string): TableReader | undefined {
    const value = this.#take(key);
    if (value === undefined) return undefined;
    if (!isTable(value)) {
      this.fail(key, 'This must be a table.');
      return;
    }
    return new TableReader(value, [...this.path, key], this.#report);
  }

  value(key: string): unknown {
    return this.#take(key);
  }

  /** Reports every key of the table that no call has asked for. Call it last. */
  finish(): void {
    for (const key of Object.keys(this.#table)) {
      if (this.#known.includes(key)) continue;
      const known = this.#known.length === 0 ? 'No key is known here.' : `Known keys: ${this.#known.join(', ')}.`;
      this.#report.add([...this.path, key], `Unknown key "${key}". ${known}`);
    }
  }
}

function parseToml(file: string, text: string): { table: Table; report: FileReport } | ConfigDiagnostic {
  try {
    return { table: parse(text), report: new FileReport(file, readLayout(text)) };
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    // The first line of the message is the reason. The rest is a drawing of the place.
    const reason = error.message.split('\n')[0] ?? 'The file is not valid TOML.';
    return {
      file,
      line: error.line,
      column: error.column,
      path: '',
      message: redactText(`This is not valid TOML: ${reason}`),
    };
  }
}

/** No value of a configuration file may be a credential, whatever key it stands under. */
function scanForSecrets(value: unknown, path: Path, report: FileReport): void {
  if (typeof value === 'string') {
    if (hasSecretShape(value)) {
      report.add(path, 'This value looks like a credential. A configuration file must never hold one.');
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanForSecrets(item, [...path, index], report);
    });
  } else if (isTable(value)) {
    for (const [key, item] of Object.entries(value)) scanForSecrets(item, [...path, key], report);
  }
}

function readDescription(reader: TableReader): string | null {
  const description = reader.string('description');
  if (description !== undefined && description.length > 200) {
    reader.fail('description', 'A description has at most 200 characters.');
  }
  return description ?? null;
}

function readOrgId(reader: TableReader): string | null {
  const orgId = reader.string('org_id');
  if (orgId === undefined) return null;
  if (!ORG_ID.test(orgId)) {
    reader.fail(
      'org_id',
      `"${orgId}" is not an org id. An org id starts with 00D and has 15 or 18 letters and digits.`,
    );
    return null;
  }
  return orgId;
}

function readLoginUrl(reader: TableReader): string | null {
  const loginUrl = reader.string('login_url');
  if (loginUrl === undefined) return null;
  // The text is checked as written. A URL parser would forgive spaces, a missing "//" and an empty query.
  if (!loginUrl.startsWith('https://') || /\s/.test(loginUrl) || !URL.canParse(loginUrl)) {
    reader.fail('login_url', 'A login URL starts with https:// and contains no spaces.');
    return null;
  }
  if (/[?#@]/.test(loginUrl)) {
    reader.fail(
      'login_url',
      'A login URL is the address of the login page only: no user name, no query and no fragment.',
    );
    return null;
  }
  return loginUrl;
}

/** A path inside a repository: relative, forward slashes, no way out of the repository. */
function pathProblem(path: string): string | undefined {
  if (path === '') return 'A path must not be empty.';
  if (CONTROL.test(path)) return 'A path must not contain control characters or line breaks.';
  if (path.includes('\\')) return 'Write paths with forward slashes.';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'A path here is relative, not absolute.';
  if (path.startsWith('~')) return 'A path here is relative. "~" is not expanded.';
  const segments = path.replace(/\/+$/, '').split('/');
  if (segments.includes('..')) return 'A path must not contain "..".';
  if (segments.some((segment) => segment === '' || segment === '.')) {
    return 'A path must not contain empty or "." segments.';
  }
  return undefined;
}

function readRepo(reader: TableReader): string {
  const repo = reader.string('repo');
  if (repo === undefined || repo === '.') return '.';
  // The repository can be a folder above the workspace or next to it, so ".." may lead the path. Nothing else
  // differs from a folder path.
  const below = repo.replace(/^(?:\.\.(?:\/+|$))+/, '');
  const problem = below === '' && repo !== '' ? undefined : pathProblem(below);
  if (problem !== undefined) {
    reader.fail('repo', `${problem} The repository is "." or a path relative to the workspace.`);
    return '.';
  }
  return repo.replace(/\/+$/, '');
}

function readPaths(reader: TableReader): readonly string[] | null {
  const value = reader.value('paths');
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length === 0) {
    reader.fail('paths', 'This must be a list with at least one folder. Leave the key out to use sfdx-project.json.');
    return null;
  }
  const paths: string[] = [];
  const found = { problems: 0 };
  value.forEach((item: unknown, index) => {
    const problem = typeof item === 'string' ? pathProblem(item) : 'A path is text in quotes.';
    if (problem !== undefined || typeof item !== 'string') {
      reader.fail('paths', problem ?? 'A path is text in quotes.', index);
      found.problems += 1;
      return;
    }
    const path = item.replace(/\/+$/, '');
    // Folders are compared without case: on Windows and macOS two spellings are one folder.
    const folded = path.toLowerCase();
    const clash = paths.find((other) => {
      const otherFolded = other.toLowerCase();
      return folded === otherFolded || folded.startsWith(`${otherFolded}/`) || otherFolded.startsWith(`${folded}/`);
    });
    if (clash !== undefined) {
      reader.fail('paths', `"${item}" is the same folder as "${clash}", or one lies inside the other.`, index);
      found.problems += 1;
      return;
    }
    paths.push(path);
  });
  return found.problems === 0 ? paths : null;
}

function readSource(name: string, reader: TableReader): SourceDeclaration | undefined {
  if (!reader.has('kind')) {
    reader.fail('kind', `A source needs a kind. Use one of ${quoteList(SOURCE_KINDS)}.`);
    return undefined;
  }
  const kind = reader.oneOf('kind', SOURCE_KINDS);
  if (kind === undefined) return undefined;
  const description = readDescription(reader);

  if (kind === 'git') {
    const repo = readRepo(reader);
    const ref = reader.string('ref');
    if (ref !== undefined && (!GIT_REF.test(ref) || ref.startsWith('-'))) {
      reader.fail('ref', `"${ref}" is not a branch, tag or commit.`);
    }
    const source: GitSource = {
      name,
      kind,
      description,
      repo,
      ref: ref ?? null,
      paths: readPaths(reader),
      tracks: reader.string('tracks') ?? null,
    };
    reader.finish();
    return source;
  }

  const orgId = readOrgId(reader);
  const loginUrl = readLoginUrl(reader);
  if (kind === 'org') {
    reader.finish();
    return { name, kind, description, orgId, loginUrl };
  }
  const sandboxName = reader.string('sandbox_name');
  if (sandboxName !== undefined && !SANDBOX_NAME.test(sandboxName)) {
    reader.fail('sandbox_name', 'A sandbox name has 1 to 10 letters and digits.');
  }
  const source: SandboxSource = {
    name,
    kind,
    description,
    orgId,
    loginUrl,
    sandboxOf: reader.string('sandbox_of') ?? null,
    sandboxName: sandboxName ?? null,
  };
  reader.finish();
  return source;
}

/** The rules that involve more than one source. */
function checkAcrossSources(sources: readonly SourceDeclaration[], report: FileReport): void {
  const byName = new Map(sources.map((source) => [source.name, source]));
  const byOrg = new Map<string, string>();
  for (const source of sources) {
    const at = ['sources', source.name];
    if (source.kind === 'git') {
      const tracked = source.tracks === null ? undefined : byName.get(source.tracks);
      if (source.tracks !== null && (tracked === undefined || tracked.kind === 'git')) {
        report.add([...at, 'tracks'], `"${source.tracks}" is not the name of an org or sandbox source in this file.`);
      }
      continue;
    }
    if (source.kind === 'sandbox' && source.sandboxOf !== null && byName.get(source.sandboxOf)?.kind !== 'org') {
      report.add(
        [...at, 'sandbox_of'],
        `"${source.sandboxOf}" is not the name of a source of kind "org" in this file.`,
      );
    }
    if (source.orgId !== null) {
      // The first 15 characters are the id. The last three of the long form only repeat its capitalisation.
      const id = source.orgId.slice(0, 15);
      const other = byOrg.get(id);
      if (other !== undefined)
        report.add([...at, 'org_id'], `This is the org of the source "${other}". An org is declared once.`);
      else byOrg.set(id, source.name);
    }
  }
}

function readShared(table: Table, report: FileReport): { name: string | null; sources: SourceDeclaration[] } {
  const root = new TableReader(table, [], report);

  const version = root.value('schema_version');
  if (version === undefined) {
    root.fail(
      'schema_version',
      `The file needs the line schema_version = ${String(CONFIG_SCHEMA_VERSION)} before its first table.`,
    );
  } else if (version !== CONFIG_SCHEMA_VERSION) {
    root.fail(
      'schema_version',
      `This version of OrgLens reads schema_version ${String(CONFIG_SCHEMA_VERSION)} only. The file says ${JSON.stringify(version)}.`,
    );
  }

  const workspace = root.table('workspace');
  const name = workspace?.string('name');
  if (name !== undefined && (name.trim() === '' || name.length > 64)) {
    workspace?.fail('name', 'A workspace name has 1 to 64 characters.');
  }
  workspace?.finish();

  const sources: SourceDeclaration[] = [];
  const sourceTables = root.table('sources');
  if (sourceTables !== undefined) {
    for (const sourceName of Object.keys(table['sources'] as Table)) {
      if (!SOURCE_NAME.test(sourceName)) {
        sourceTables.fail(
          sourceName,
          `"${sourceName}" is not a source name. A source name starts with a lower-case letter and has up to 32 lower-case letters, digits and hyphens.`,
        );
        // Marked as read, so that it is not reported a second time as unknown.
        sourceTables.value(sourceName);
        continue;
      }
      const reader = sourceTables.table(sourceName);
      const source = reader === undefined ? undefined : readSource(sourceName, reader);
      if (source !== undefined) sources.push(source);
    }
    sourceTables.finish();
  }
  root.finish();
  checkAcrossSources(sources, report);
  return { name: name ?? null, sources };
}

interface LocalSettings {
  readonly driver: StoreDriverName | undefined;
  readonly logins: Readonly<Record<string, string>>;
  readonly unusedLogins: readonly string[];
}

/**
 * Reads the personal file. `declared` are the sources of the shared file,
 * or `undefined` if that file has problems of its own: a table for a source
 * is then not held against a list that is incomplete.
 */
function readLocal(
  table: Table,
  report: FileReport,
  declared: readonly SourceDeclaration[] | undefined,
): LocalSettings {
  const root = new TableReader(table, [], report);
  const store = root.table('store');
  const driver = store?.oneOf('driver', STORE_DRIVERS);
  store?.finish();

  const logins = new Map<string, string>();
  const unusedLogins: string[] = [];
  const sourceTables = root.table('sources');
  if (sourceTables !== undefined) {
    for (const sourceName of Object.keys(table['sources'] as Table)) {
      const reader = sourceTables.table(sourceName);
      if (reader === undefined) continue;
      if (!SOURCE_NAME.test(sourceName)) {
        report.add(
          reader.path,
          `"${sourceName}" cannot be the name of a source. Remove this table, or correct the name.`,
        );
        continue;
      }
      const source = declared?.find((one) => one.name === sourceName);
      const login = reader.string('login');
      if (login !== undefined) {
        if (source?.kind === 'git') {
          reader.fail('login', 'A source of kind "git" has no login. Remove this key.');
        } else if (login === '' || login !== login.trim() || login.length > 255) {
          reader.fail('login', 'A login is the alias or the user name of a Salesforce CLI login.');
        } else if (declared !== undefined && source === undefined) {
          // The shared file is changed by others: a colleague removes or renames a source, or a branch without
          // it is checked out. That must not make the personal file invalid. The login is kept and not used.
          unusedLogins.push(sourceName);
        } else {
          logins.set(sourceName, login);
        }
      }
      reader.finish();
    }
    sourceTables.finish();
  }
  root.finish();
  return { driver, logins: Object.fromEntries(logins), unusedLogins };
}

/**
 * Reads and checks the configuration. It reads no file itself: the caller
 * hands in the texts, so the same function serves the workspace, the editor
 * of the file and the tests.
 */
export function readConfig(input: ConfigInput): ConfigResult {
  const diagnostics: ConfigDiagnostic[] = [];

  const shared = parseToml(SHARED_CONFIG_FILE, input.shared);
  let name: string | null = null;
  let sources: SourceDeclaration[] = [];
  if ('table' in shared) {
    scanForSecrets(shared.table, [], shared.report);
    ({ name, sources } = readShared(shared.table, shared.report));
    diagnostics.push(...shared.report.diagnostics);
  } else {
    diagnostics.push(shared);
  }
  const sharedIsSound = diagnostics.length === 0;

  let driver: StoreDriverName = 'node:sqlite';
  let driverSetBy: WorkspaceConfig['store']['driverSetBy'] = 'default';
  let logins: Readonly<Record<string, string>> = {};
  let unusedLogins: readonly string[] = [];
  if (input.local !== undefined) {
    const local = parseToml(LOCAL_CONFIG_FILE, input.local);
    if ('table' in local) {
      scanForSecrets(local.table, [], local.report);
      const settings = readLocal(local.table, local.report, sharedIsSound ? sources : undefined);
      ({ logins, unusedLogins } = settings);
      if (settings.driver !== undefined) {
        driver = settings.driver;
        driverSetBy = 'local';
      }
      diagnostics.push(...local.report.diagnostics);
    } else {
      diagnostics.push(local);
    }
  }

  const fromEnvironment = input.env?.[DRIVER_VARIABLE];
  if (fromEnvironment !== undefined && fromEnvironment !== '') {
    if ((STORE_DRIVERS as readonly string[]).includes(fromEnvironment)) {
      driver = fromEnvironment as StoreDriverName;
      driverSetBy = 'environment';
    } else {
      diagnostics.push({
        file: 'environment',
        line: null,
        column: null,
        path: DRIVER_VARIABLE,
        message: redactText(`"${fromEnvironment}" is not allowed here. Use one of ${quoteList(STORE_DRIVERS)}.`),
      });
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, config: { name, sources, store: { driver, driverSetBy }, logins, unusedLogins } };
}

/** The problems as they appear in the details of an error and in a report: each with the line a person reads. */
export const diagnosticsJson = (diagnostics: readonly ConfigDiagnostic[]): JsonValue =>
  diagnostics.map((one) => ({
    file: one.file,
    line: one.line,
    column: one.column,
    path: one.path,
    message: one.message,
    text: formatDiagnostic(one),
  }));

/** One line for a person: `orglens.toml:12:3: sources.prod.org_id: ...`. */
export function formatDiagnostic(diagnostic: ConfigDiagnostic): string {
  const place =
    diagnostic.line === null
      ? diagnostic.file
      : `${diagnostic.file}:${String(diagnostic.line)}:${String(diagnostic.column)}`;
  return diagnostic.path === ''
    ? `${place}: ${diagnostic.message}`
    : `${place}: ${diagnostic.path}: ${diagnostic.message}`;
}
