/**
 * `doctor`: what OrgLens finds on this machine and in this workspace.
 *
 * It only reads. It never creates a workspace, migrates a database or
 * connects to an org. Every check is reported, also the ones that pass, so
 * that the report can be pasted into an issue as it is.
 */
import { diagnosticsJson, formatDiagnostic, SHARED_CONFIG_FILE } from '../core/config/config.ts';
import { isEngineError, type JsonValue } from '../core/errors.ts';
import { redactText } from '../core/redact.ts';
import { engineVersion } from '../core/version.ts';
import { loadBetterSqlite3Driver } from '../store/better-sqlite3.ts';
import type { SqlDriver } from '../store/driver.ts';
import { nodeSqliteDriver } from '../store/node-sqlite.ts';
import { probeSqlite, type SqliteCapabilities } from '../store/probe.ts';
import { boundary } from './boundary.ts';
import { inspectConfig, inspectStore, locateWorkspace, type WorkspaceLocator } from './workspace.ts';

/** The oldest Node.js release OrgLens runs on. */
const MINIMUM_NODE = [24, 15] as const;

export interface DoctorCheck {
  /** A stable name: `node`, `sqlite`, `sqlite-fallback`, `workspace`, `config`, `store`. */
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
  ];
  const skipped = (id: string, summary: string): DoctorCheck => ({ id, status: 'skipped', summary, details: {} });

  let paths: ReturnType<typeof locateWorkspace> = null;
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

  return { ok: checks.every((check) => check.status !== 'failed'), engineVersion: engineVersion(), checks };
}
