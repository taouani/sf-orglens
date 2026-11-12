/**
 * `doctor`: what OrgLens finds on this machine and in this workspace.
 *
 * It only reads. It never creates a workspace, migrates a database or
 * connects to an org. Every check is reported, also the ones that pass, so
 * that the report can be pasted into an issue as it is. For that reason it
 * names no login and no user: it says how many logins there are, and by
 * which route each org source would be logged in.
 */
import {
  diagnosticsJson,
  formatDiagnostic,
  LOCAL_CONFIG_FILE,
  SHARED_CONFIG_FILE,
  type WorkspaceConfig,
} from '../core/config/config.ts';
import { isEngineError, type JsonValue } from '../core/errors.ts';
import { redactText } from '../core/redact.ts';
import { engineVersion } from '../core/version.ts';
import { gitProgram } from '../sources/git.ts';
import { jwtVariables } from '../sources/jwt.ts';
import { listCliLogins } from '../sources/logins.ts';
import { planLogin } from '../sources/org.ts';
import { loadBetterSqlite3Driver } from '../store/better-sqlite3.ts';
import type { SqlDriver } from '../store/driver.ts';
import { nodeSqliteDriver } from '../store/node-sqlite.ts';
import { probeSqlite, type SqliteCapabilities } from '../store/probe.ts';
import { boundary } from './boundary.ts';
import { inspectConfig, inspectStore, locateWorkspace, type WorkspaceLocator } from './workspace.ts';

/** The oldest Node.js release OrgLens runs on. */
const MINIMUM_NODE = [24, 15] as const;

export interface DoctorCheck {
  /** A stable name: `node`, `sqlite`, `sqlite-fallback`, `git`, `workspace`, `config`, `store`, `logins`. */
  readonly id: string;
  /**
   * - `ok`: nothing to do.
   * - `warning`: OrgLens works, and something deserves a look.
   * - `failed`: OrgLens cannot work until this is fixed.
   * - `skipped`: the check does not apply here.
   */
  readonly status: 'ok' | 'warning' | 'failed' | 'skipped';
  /** One sentence for a person. */
  readonly summary: string;
  /** The facts behind the summary. */
  readonly details: Readonly<Record<string, JsonValue>>;
}

export interface DoctorReport {
  /** False if a check failed. */
  readonly ok: boolean;
  readonly engineVersion: string;
  readonly checks: readonly DoctorCheck[];
}

function checkNode(): DoctorCheck {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const supported = major > MINIMUM_NODE[0] || (major === MINIMUM_NODE[0] && minor >= MINIMUM_NODE[1]);
  const required = MINIMUM_NODE.join('.');
  return {
    id: 'node',
    status: supported ? 'ok' : 'failed',
    summary: supported
      ? `Node.js ${process.versions.node} on ${process.platform} ${process.arch}.`
      : `Node.js ${process.versions.node} is too old. OrgLens needs ${required} or newer.`,
    details: { version: process.versions.node, required, platform: process.platform, arch: process.arch },
  };
}

const CAPABILITIES: readonly (readonly [keyof SqliteCapabilities, string])[] = [
  ['strictTables', 'STRICT tables'],
  ['fts5Trigram', 'full-text search with the trigram tokenizer'],
  ['json', 'JSON functions'],
  ['recursiveQueries', 'recursive queries'],
];

function checkSqlite(id: string, driver: SqlDriver, hint: string): DoctorCheck {
  try {
    const capabilities = probeSqlite(driver);
    const missing = CAPABILITIES.filter(([key]) => capabilities[key] !== true).map(([, label]) => label);
    return {
      id,
      status: capabilities.ok ? 'ok' : 'failed',
      summary: capabilities.ok
        ? `SQLite ${capabilities.sqliteVersion} through ${capabilities.driver} has everything OrgLens needs.`
        : `SQLite ${capabilities.sqliteVersion} through ${capabilities.driver} lacks: ${missing.join(', ')}. ${hint}`,
      details: { ...capabilities },
    };
  } catch (error) {
    return {
      id,
      status: 'failed',
      summary: `SQLite could not be used through ${driver.name}. ${hint}`,
      details: { driver: driver.name, problem: error instanceof Error ? error.message : String(error) },
    };
  }
}

async function checkFallback(): Promise<DoctorCheck> {
  let driver: SqlDriver;
  try {
    driver = await loadBetterSqlite3Driver();
  } catch {
    return {
      id: 'sqlite-fallback',
      status: 'skipped',
      summary: 'The optional package better-sqlite3 is not installed. It is only needed if the built-in SQLite fails.',
      details: { driver: 'better-sqlite3', installed: false },
    };
  }
  const check = checkSqlite('sqlite-fallback', driver, 'The built-in SQLite is used unless you select this one.');
  // The fallback is optional, so a fallback that does not work is no reason for OrgLens to stop.
  return check.status === 'failed' ? { ...check, status: 'warning' } : check;
}

/** Git is needed to read a branch, a tag or a commit. Folders on disk are read without it. */
function checkGit(dir: string): DoctorCheck {
  const git = gitProgram(dir);
  const details = { installed: git.installed, version: git.version, required: git.required };
  if (!git.installed) {
    return {
      id: 'git',
      status: 'warning',
      summary:
        'No "git" program was found. Folders are read without it. A source that names a branch, a tag or a commit needs it.',
      details,
    };
  }
  if (!git.supported) {
    return {
      id: 'git',
      status: 'warning',
      summary: `Git ${git.version ?? ''} is too old to read a commit. OrgLens needs Git ${git.required} or newer for a source that names a branch, a tag or a commit.`,
      details,
    };
  }
  return {
    id: 'git',
    status: git.version === null ? 'warning' : 'ok',
    summary: git.version === null ? 'Git is installed and does not say its version.' : `Git ${git.version}.`,
    details,
  };
}

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The logins: how many the Salesforce CLI has on this machine, and by which
 * route each org and sandbox of the workspace would be logged in. Nothing
 * connects, so a login that is found here can still have expired.
 */
function checkLogins(config: WorkspaceConfig | undefined, env: Environment): DoctorCheck {
  const logins = listCliLogins();
  const count = `${String(logins.length)} Salesforce CLI ${logins.length === 1 ? 'login' : 'logins'} on this machine.`;
  const orgs = (config?.sources ?? []).filter((source) => source.kind !== 'git');

  // Two mistakes that would otherwise go unnoticed, because what is not read is not an error: a variable for a
  // login with a key that no source reads, such as a misspelled one, and a login in the personal file for a
  // source that is no longer declared. Only names are shown, never what a variable holds.
  // On Windows the name of a variable is found whatever its case.
  const asRead = (name: string): string => (process.platform === 'win32' ? name.toUpperCase() : name);
  const read = new Set(orgs.flatMap((source) => Object.values(jwtVariables(source.name))));
  const unreadVariables =
    config === undefined
      ? []
      : Object.keys(env)
          .filter((name) => /^ORGLENS_JWT_/i.test(name) && (env[name] ?? '') !== '' && !read.has(asRead(name)))
          .sort();
  const unusedLogins = [...(config?.unusedLogins ?? [])].sort();
  const notes = [
    ...(unreadVariables.length === 0
      ? []
      : [
          `No source reads ${unreadVariables.length === 1 ? 'the variable' : 'the variables'} ${unreadVariables.join(', ')}.`,
        ]),
    ...(unusedLogins.length === 0
      ? []
      : [
          `${LOCAL_CONFIG_FILE} names a login for ${unusedLogins.map((name) => `"${name}"`).join(', ')}, which ${SHARED_CONFIG_FILE} does not declare. It is not used.`,
        ]),
  ];
  const extra = { unreadVariables, unusedLogins };

  if (config === undefined || orgs.length === 0) {
    return {
      id: 'logins',
      status: notes.length === 0 ? 'ok' : 'warning',
      summary: [
        count,
        config === undefined
          ? 'No workspace configuration says which are needed.'
          : 'The workspace declares no org or sandbox.',
        ...notes,
      ].join(' '),
      details: { cliLogins: logins.length, sources: [], ...extra },
    };
  }
  const plans = orgs.map((source) => planLogin(source, config.logins[source.name], logins, env));
  const without = plans.filter((plan) => plan.problem !== null);
  const first = without[0];
  return {
    id: 'logins',
    status: first === undefined && notes.length === 0 ? 'ok' : 'warning',
    summary: [
      count,
      first === undefined
        ? 'Every org and sandbox of the workspace has a login. Whether it still works shows: orglens source check <name>'
        : `${String(without.length)} of ${String(plans.length)} org and sandbox sources cannot be logged in. "${first.source}": ${first.problem ?? ''}`,
      ...notes,
    ].join(' '),
    details: { cliLogins: logins.length, sources: plans.map((plan) => ({ ...plan })), ...extra },
  };
}

/** Runs every check. The workspace checks are skipped where there is no workspace. */
export function doctor(locator: WorkspaceLocator = {}): Promise<DoctorReport> {
  return boundary(() => examine(locator));
}

async function examine(locator: WorkspaceLocator): Promise<DoctorReport> {
  const env = locator.env ?? process.env;
  const checks: DoctorCheck[] = [
    checkNode(),
    checkSqlite(
      'sqlite',
      nodeSqliteDriver,
      'Install the optional package better-sqlite3 and select it in .orglens/local.toml.',
    ),
    await checkFallback(),
    checkGit(locator.cwd ?? process.cwd()),
  ];
  const skipped = (id: string, summary: string): DoctorCheck => ({ id, status: 'skipped', summary, details: {} });

  let paths: ReturnType<typeof locateWorkspace> = null;
  let validConfig: WorkspaceConfig | undefined;
  try {
    paths = locateWorkspace(locator);
    checks.push(
      paths === null
        ? skipped(
            'workspace',
            `No ${SHARED_CONFIG_FILE} in this folder or above it. Create a workspace with: orglens init`,
          )
        : { id: 'workspace', status: 'ok', summary: `Workspace at ${paths.root}.`, details: { root: paths.root } },
    );
  } catch (error) {
    if (!isEngineError(error)) throw error;
    checks.push({ id: 'workspace', status: 'failed', summary: error.message, details: error.details ?? {} });
  }

  if (paths === null) {
    checks.push(skipped('config', 'There is no workspace.'), skipped('store', 'There is no workspace.'));
  } else {
    let config: ReturnType<typeof inspectConfig> | undefined;
    let unreadable = '';
    try {
      config = inspectConfig(paths, env);
    } catch (error) {
      // A file that cannot be read is a finding of this report, not a reason to give none.
      unreadable = redactText(error instanceof Error ? error.message : String(error));
    }
    if (config === undefined) {
      checks.push(
        {
          id: 'config',
          status: 'failed',
          summary: `The configuration could not be read. ${unreadable}`,
          details: {},
        },
        skipped('store', 'The configuration has to be valid first.'),
      );
    } else if (config.ok) {
      validConfig = config.config;
      const count = config.config.sources.length;
      checks.push({
        id: 'config',
        status: 'ok',
        summary: `The configuration is valid and declares ${String(count)} ${count === 1 ? 'source' : 'sources'}.`,
        details: { sources: config.config.sources.map((source) => source.name), driver: config.config.store.driver },
      });
      const { store } = await inspectStore(paths, config.config);
      const status =
        store.state === 'ready' ? 'ok' : ['missing', 'outdated', 'busy'].includes(store.state) ? 'warning' : 'failed';
      const summaries: Readonly<Record<string, string>> = {
        ready: `The database is at schema version ${String(store.schemaVersion)}.`,
        missing: 'The database does not exist yet. Create it with: orglens init',
        outdated: 'The database was written by an older version of OrgLens. The next command that writes migrates it.',
      };
      checks.push({
        id: 'store',
        status,
        summary: summaries[store.state] ?? store.problem ?? 'The database cannot be used.',
        details: { ...store },
      });
    } else {
      const first = config.diagnostics[0];
      const count = config.diagnostics.length;
      checks.push(
        {
          id: 'config',
          status: 'failed',
          summary: `${String(count)} ${count === 1 ? 'problem' : 'problems'} in the configuration. First: ${first === undefined ? '' : formatDiagnostic(first)}`,
          details: { diagnostics: diagnosticsJson(config.diagnostics) },
        },
        skipped('store', 'The configuration has to be valid first.'),
      );
    }
  }

  checks.push(checkLogins(validConfig, env));

  return { ok: checks.every((check) => check.status !== 'failed'), engineVersion: engineVersion(), checks };
}
