/**
 * The workspace: the one object a client works with.
 *
 * Everything that goes in and comes out is plain data that survives
 * `JSON.stringify`, and every failure is an `EngineError`. A client never
 * opens the database or reads the configuration files itself.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  diagnosticsJson,
  formatDiagnostic,
  LOCAL_CONFIG_FILE,
  readConfig,
  SHARED_CONFIG_FILE,
  type ConfigDiagnostic,
  type SourceDeclaration,
  type StoreDriverName,
  type WorkspaceConfig,
} from '../core/config/config.ts';
import { addSourceText, linkLoginText, removeSourceText, unlinkLoginText } from '../core/config/edit.ts';
import { EngineError, isEngineError } from '../core/errors.ts';
import { createFileSink, createLogger, type Logger } from '../core/logger.ts';
import { chooseCliLogin, listCliLogins, sameOrg } from '../sources/logins.ts';
import { orgMismatch } from '../sources/org.ts';
import { loadBetterSqlite3Driver } from '../store/better-sqlite3.ts';
import type { SqlDriver } from '../store/driver.ts';
import { nodeSqliteDriver } from '../store/node-sqlite.ts';
import { openStore } from '../store/open.ts';
import { pause, writeFileAtomically } from './atomic-write.ts';
import { boundary } from './boundary.ts';
import { checkSource, type SourceCheck } from './check.ts';
import { takeOrgSnapshot, type SnapshotProgress } from './org-snapshot.ts';
import { coverageOf, noSnapshot, takeSnapshot, type CoverageReport } from './snapshot.ts';
import {
  DATABASE_FILE,
  IGNORE_FILE,
  isFile,
  searchWorkspaceRoot,
  WORKSPACE_VARIABLE,
  workspacePaths,
  type WorkspacePaths,
} from './layout.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/** How a workspace is located. With nothing set, it is searched from the current folder upwards. */
export interface WorkspaceLocator {
  /** The workspace folder itself. It wins over everything else. */
  readonly root?: string | undefined;
  /** Where the search starts. Default: the current folder of the process. */
  readonly cwd?: string | undefined;
  /** The environment. Default: the environment of the process. */
  readonly env?: Environment | undefined;
}

/** A source to declare. What is left out is not written to the file. */
export type SourceInput =
  | {
      readonly name: string;
      readonly kind: 'org';
      readonly description?: string | undefined;
      readonly orgId?: string | undefined;
      readonly loginUrl?: string | undefined;
    }
  | {
      readonly name: string;
      readonly kind: 'sandbox';
      readonly description?: string | undefined;
      readonly orgId?: string | undefined;
      readonly loginUrl?: string | undefined;
      readonly sandboxOf?: string | undefined;
      readonly sandboxName?: string | undefined;
    }
  | {
      readonly name: string;
      readonly kind: 'git';
      readonly description?: string | undefined;
      readonly repo?: string | undefined;
      readonly ref?: string | undefined;
      readonly paths?: readonly string[] | undefined;
      readonly tracks?: string | undefined;
    };

/** What is known about the workspace database without changing it. */
export interface StoreStatus {
  /** The database file, relative to the workspace. */
  readonly file: string;
  /**
   * - `ready`: the database can be used as it is.
   * - `missing`: it does not exist yet. `orglens init` or the first snapshot creates it.
   * - `outdated`: an older version of OrgLens wrote it. The next command that writes migrates it.
   * - `newer`: a newer version of OrgLens wrote it. This version must not touch it.
   * - `foreign`: the file is not an OrgLens database.
   * - `busy`: another process holds it and it could not be read in time.
   * - `unusable`: it could not be opened for another reason, which `problem` states.
   */
  readonly state: 'ready' | 'missing' | 'outdated' | 'newer' | 'foreign' | 'busy' | 'unusable';
  /** The SQLite binding in use. */
  readonly driver: StoreDriverName;
  readonly schemaVersion: number | null;
  readonly sizeBytes: number | null;
  /** What is wrong, in one sentence, when the state is not `ready`. */
  readonly problem: string | null;
}

export interface SnapshotSummary {
  readonly id: number;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

/** A snapshot of an org that was begun and has not ended. */
export interface UnfinishedSnapshot {
  readonly id: number;
  readonly startedAt: string;
  /** How many chunks of the retrieve are stored or were given up, and how many there are. */
  readonly chunksDone: number;
  readonly chunks: number;
}

export type SourceStatus = SourceDeclaration & {
  /** How many finished snapshots of this source the database holds: complete ones and partial ones. */
  readonly snapshots: number;
  /** The latest finished snapshot. This is the one `coverage` shows. */
  readonly latestSnapshot: SnapshotSummary | null;
  /**
   * The snapshot of an org that is being taken, or that was interrupted. The next `snapshot` of the source
   * continues it.
   */
  readonly unfinishedSnapshot: UnfinishedSnapshot | null;
};

export interface WorkspaceStatus {
  readonly root: string;
  readonly name: string | null;
  /** The configuration files that were read, relative to the workspace. */
  readonly configFiles: readonly string[];
  readonly store: StoreStatus;
  readonly sources: readonly SourceStatus[];
}

/** The Salesforce CLI login that was set for a source. */
export interface SourceLink {
  readonly source: string;
  /** What was written to the personal file: the alias or the user name that was given. */
  readonly login: string;
  readonly username: string;
  /** The id of the org the login belongs to, if the Salesforce CLI knows it. */
  readonly orgId: string | null;
  /** The org id the source declares. With `null`, nothing says which org is meant. */
  readonly declaredOrgId: string | null;
}

export interface Workspace {
  readonly root: string;
  readonly name: string | null;
  /** The configuration, the database and the sources with their latest snapshot. Reads only. */
  status(): Promise<WorkspaceStatus>;
  readonly sources: {
    list(): Promise<SourceDeclaration[]>;
    /** Declares a source in `orglens.toml`. Nothing is connected or read yet. */
    add(source: SourceInput): Promise<SourceDeclaration>;
    /**
     * Removes the declaration of a source from `orglens.toml`, and the login that was set for it from
     * `.orglens/local.toml`. Snapshots already taken stay in the database.
     */
    remove(name: string): Promise<{ readonly removed: string }>;
    /**
     * Sets the Salesforce CLI login this person uses for an org or a sandbox: an alias or a user name. It is
     * written to `.orglens/local.toml`. The login has to exist, and it has to belong to the org the source
     * declares. Nothing is connected.
     */
    link(name: string, login: string): Promise<SourceLink>;
    /**
     * Checks that a source can be read as things are: logs in to an org and asks it who is logged in, or reads
     * the folders of a repository. Nothing is stored.
     */
    check(name: string): Promise<SourceCheck>;
  };
  /**
   * Reads a source now and stores what it holds as a new snapshot. Earlier snapshots stay as they are. The source
   * itself is never changed.
   *
   * A snapshot of an org or a sandbox takes minutes. If one was interrupted, this call continues it and takes no
   * new one.
   */
  snapshot(source: string, options?: SnapshotOptions): Promise<CoverageReport>;
  /** What the latest snapshot of a source holds, or the snapshot with the given id. Reads only. */
  coverage(source: string, options?: { readonly snapshot?: number | undefined }): Promise<CoverageReport>;
}

export interface SnapshotOptions {
  /**
   * True to give up a snapshot of an org that was interrupted, and to take a new one. A snapshot of a Git source
   * is never interrupted, so this changes nothing for one.
   */
  readonly restart?: boolean | undefined;
  /** Called while an org is read. It is not called for a Git source. */
  readonly onProgress?: ((event: SnapshotProgress) => void) | undefined;
}

export interface InitOptions {
  /** The folder that becomes the workspace. It is created if it does not exist. */
  readonly dir: string;
  /** The label of the workspace. Default: the name of the folder. */
  readonly name?: string | undefined;
  readonly env?: Environment | undefined;
}

export interface InitResult {
  readonly root: string;
  /** The files this call created, relative to the workspace, with forward slashes. */
  readonly created: readonly string[];
  /** True if `orglens.toml` was already there. It is never overwritten. */
  readonly existing: boolean;
}

function invalidConfig(diagnostics: readonly ConfigDiagnostic[]): EngineError {
  const first = diagnostics[0];
  const more = diagnostics.length > 1 ? ` (and ${String(diagnostics.length - 1)} more)` : '';
  return new EngineError(
    'CONFIG_INVALID',
    first === undefined ? 'The configuration has a problem.' : `${formatDiagnostic(first)}${more}`,
    {
      details: { diagnostics: diagnosticsJson(diagnostics) },
    },
  );
}

// The byte order mark stays part of the text, so that a file that starts with one is written back with it.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Reads a configuration file as text. A file that is not UTF-8 is a problem of the configuration: decoding it
 * loosely would replace the bytes that are wrong, and the next edit would write the replacements back.
 */
function readText(file: string, label: string): string | ConfigDiagnostic {
  try {
    return UTF8.decode(readFileSync(file));
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return {
      file: label,
      line: null,
      column: null,
      path: '',
      message: 'The file is not UTF-8 text. Save it as UTF-8.',
    };
  }
}

/** Reads both configuration files of a workspace. */
function loadConfig(paths: WorkspacePaths, env: Environment): WorkspaceConfig {
  const result = inspectConfig(paths, env);
  if (!result.ok) throw invalidConfig(result.diagnostics);
  return result.config;
}

/** Like `loadConfig`, with the problems returned and not thrown. */
export function inspectConfig(paths: WorkspacePaths, env: Environment): ReturnType<typeof readConfig> {
  const shared = readText(paths.configFile, SHARED_CONFIG_FILE);
  const local = isFile(paths.localConfigFile) ? readText(paths.localConfigFile, LOCAL_CONFIG_FILE) : undefined;
  const unreadable = [shared, local].filter((one) => typeof one === 'object');
  if (typeof shared !== 'string' || typeof local === 'object') return { ok: false, diagnostics: unreadable };
  return readConfig({ shared, local, env });
}

/** Resolves the workspace folder, or returns `null` if there is none. A folder that was named must be one. */
export function locateWorkspace(locator: WorkspaceLocator = {}): WorkspacePaths | null {
  const env = locator.env ?? process.env;
  const named = locator.root ?? (env[WORKSPACE_VARIABLE] === '' ? undefined : env[WORKSPACE_VARIABLE]);
  if (named !== undefined) {
    const paths = workspacePaths(resolve(locator.cwd ?? process.cwd(), named));
    if (!isFile(paths.configFile)) {
      throw new EngineError('WORKSPACE_NOT_FOUND', `There is no ${SHARED_CONFIG_FILE} in ${paths.root}.`, {
        hint: 'Create a workspace there with: orglens init',
        details: { root: paths.root },
      });
    }
    return paths;
  }
  const root = searchWorkspaceRoot(locator.cwd ?? process.cwd());
  return root === null ? null : workspacePaths(root);
}

/** Returns the driver the configuration asks for. The fallback is loaded only here. */
async function resolveDriver(name: StoreDriverName): Promise<SqlDriver> {
  return name === 'better-sqlite3' ? loadBetterSqlite3Driver() : nodeSqliteDriver;
}

/** A logger that writes to the workspace, or to nowhere if the log file cannot be set up. */
function workspaceLogger(paths: WorkspacePaths): Logger {
  try {
    return createLogger({ sink: createFileSink({ dir: paths.logsDir }).sink }).child({ pid: process.pid });
  } catch {
    return createLogger({ sink: () => undefined });
  }
}

/** Creates the data folder if it is missing, and first of all the file that keeps it out of Git. */
function ensureDataDir(paths: WorkspacePaths): boolean {
  mkdirSync(paths.dataDir, { recursive: true });
  if (existsSync(paths.ignoreFile)) return false;
  writeFileSync(paths.ignoreFile, '*\n');
  return true;
}

const LOCK_WAIT_MS = 2000;
const LOCK_PAUSE_MS = 20;
/** A lock this old was left behind by a command that did not end properly. An edit takes milliseconds. */
const LOCK_STALE_MS = 30_000;

/**
 * Runs one change of the configuration files while no other command changes them.
 *
 * A change reads a file, edits the text and writes it back. Two commands doing that at the same moment would
 * each write their own result, and one of the two changes would be lost without a word. The lock is a file that
 * only one process can create. A hand-made edit in an editor is not held off by it.
 */
function withConfigLock<T>(paths: WorkspacePaths, work: () => T): T {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeFileSync(paths.configLockFile, `${String(process.pid)}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
      const held = statSync(paths.configLockFile, { throwIfNoEntry: false });
      if (held !== undefined && Date.now() - held.mtimeMs > LOCK_STALE_MS) {
        rmSync(paths.configLockFile, { force: true });
      } else if (Date.now() >= deadline) {
        throw new EngineError('WORKSPACE_IO', 'Another OrgLens command is changing the configuration.', {
          hint: `Try again. If no other command is running, delete ${paths.configLockFile}.`,
          details: { reason: 'LOCKED', operation: 'lock' },
        });
      } else {
        pause(LOCK_PAUSE_MS);
      }
    }
  }
  try {
    return work();
  } finally {
    rmSync(paths.configLockFile, { force: true });
  }
}

const STORE_STATES: Readonly<Record<string, StoreStatus['state']>> = {
  STORE_NOT_FOUND: 'missing',
  STORE_OUTDATED: 'outdated',
  STORE_NEWER: 'newer',
  STORE_FOREIGN: 'foreign',
  STORE_BUSY: 'busy',
};

/** What `status` shows of the snapshots of one source. */
interface SourceSnapshots {
  readonly count: number;
  readonly latest: SnapshotSummary | null;
  readonly unfinished: UnfinishedSnapshot | null;
}

/** Looks at the database without changing it, and reads what `status` shows from it. */
export async function inspectStore(
  paths: WorkspacePaths,
  config: WorkspaceConfig,
): Promise<{ store: StoreStatus; snapshots: ReadonlyMap<string, SourceSnapshots> }> {
  const base = { file: DATABASE_FILE, driver: config.store.driver };
  const snapshots = new Map<string, SourceSnapshots>();
  const sizeBytes = existsSync(paths.databaseFile) ? statSync(paths.databaseFile).size : null;
  try {
    const store = openStore({
      path: paths.databaseFile,
      driver: await resolveDriver(config.store.driver),
      readOnly: true,
    });
    try {
      // A snapshot that has not ended, or that was given up, is not the latest one: it holds a part at most.
      const rows = store.all(
        `SELECT s.name AS name, n.id AS id, n.status AS status, n.started_at AS started_at, n.finished_at AS finished_at,
                (SELECT COUNT(*) FROM snapshot c WHERE c.source_id = s.id AND c.status IN ('complete', 'partial')) AS count,
                r.id AS running, r.started_at AS running_since,
                (SELECT COUNT(*) FROM retrieve_chunk k WHERE k.snapshot_id = r.id) AS chunks,
                (SELECT COUNT(*) FROM retrieve_chunk k WHERE k.snapshot_id = r.id AND k.status IN ('done', 'failed')) AS chunks_done
           FROM source s
           LEFT JOIN snapshot n ON n.id = (SELECT MAX(m.id) FROM snapshot m
                                            WHERE m.source_id = s.id AND m.status IN ('complete', 'partial'))
           LEFT JOIN snapshot r ON r.source_id = s.id AND r.status = 'running'`,
      );
      for (const row of rows) {
        snapshots.set(String(row['name']), {
          count: Number(row['count']),
          latest:
            row['id'] === null
              ? null
              : {
                  id: Number(row['id']),
                  status: String(row['status']),
                  startedAt: String(row['started_at']),
                  finishedAt: row['finished_at'] === null ? null : String(row['finished_at']),
                },
          unfinished:
            row['running'] === null
              ? null
              : {
                  id: Number(row['running']),
                  startedAt: String(row['running_since']),
                  chunksDone: Number(row['chunks_done']),
                  chunks: Number(row['chunks']),
                },
        });
      }
      return {
        store: { ...base, state: 'ready', schemaVersion: store.schemaVersion, sizeBytes, problem: null },
        snapshots,
      };
    } finally {
      store.close();
    }
  } catch (error) {
    if (!isEngineError(error)) throw error;
    const state = STORE_STATES[error.code] ?? 'unusable';
    return { store: { ...base, state, schemaVersion: null, sizeBytes, problem: error.message }, snapshots };
  }
}

const orNull = <T>(value: T | undefined): T | null => value ?? null;

/** A folder as the configuration returns it: without the slashes at its end. */
const withoutTrailingSlash = (path: string): string => path.replace(/\/+$/, '') || path;

function declaration(input: SourceInput): SourceDeclaration {
  const common = { name: input.name, description: orNull(input.description) };
  if (input.kind === 'git') {
    return {
      ...common,
      kind: 'git',
      repo: input.repo === undefined ? '.' : withoutTrailingSlash(input.repo),
      ref: orNull(input.ref),
      paths: input.paths === undefined ? null : input.paths.map(withoutTrailingSlash),
      tracks: orNull(input.tracks),
    };
  }
  const org = { ...common, orgId: orNull(input.orgId), loginUrl: orNull(input.loginUrl) };
  if (input.kind === 'org') return { ...org, kind: 'org' };
  return { ...org, kind: 'sandbox', sandboxOf: orNull(input.sandboxOf), sandboxName: orNull(input.sandboxName) };
}

/**
 * Opens the workspace a folder belongs to. The configuration is read and
 * checked. The database is not opened until something needs it.
 */
export function openWorkspace(locator: WorkspaceLocator = {}): Promise<Workspace> {
  return boundary(() => {
    const env = locator.env ?? process.env;
    const paths = locateWorkspace(locator);
    if (paths === null) {
      throw new EngineError('WORKSPACE_NOT_FOUND', `No ${SHARED_CONFIG_FILE} in this folder or in a folder above it.`, {
        hint: 'Create a workspace with: orglens init',
      });
    }
    let config = loadConfig(paths, env);

    /**
     * Changes the configuration files. `change` gets the text of the shared file and of the personal file, which
     * may not exist, and returns the new text of each file it changes.
     */
    const edit = (
      change: (shared: string, local: string | undefined) => { shared?: string; local?: string | undefined },
    ): void => {
      // The folder may be a fresh clone that has the configuration and nothing else. The file that keeps the data
      // folder out of Git comes first, before the lock, the log and the personal file are written into it.
      ensureDataDir(paths);
      withConfigLock(paths, () => {
        const shared = readText(paths.configFile, SHARED_CONFIG_FILE);
        if (typeof shared !== 'string') throw invalidConfig([shared]);
        const local = isFile(paths.localConfigFile) ? readText(paths.localConfigFile, LOCAL_CONFIG_FILE) : undefined;
        if (typeof local === 'object') throw invalidConfig([local]);
        const changed = change(shared, local);
        // The shared file first. If the second write fails, a login is left for a source that is no longer
        // declared. That is a valid configuration, and `doctor` names it. The other order would remove the login
        // of a source that is still there.
        if (changed.shared !== undefined && changed.shared !== shared) {
          writeFileAtomically(paths.configFile, changed.shared);
        }
        if (changed.local !== undefined && changed.local !== local) {
          writeFileAtomically(paths.localConfigFile, changed.local);
        }
      });
      config = loadConfig(paths, env);
    };

    const declared = (name: string): SourceDeclaration => {
      const source = config.sources.find((one) => one.name === name);
      if (source !== undefined) return source;
      throw new EngineError('SOURCE_NOT_FOUND', `No source "${name}" is declared in ${SHARED_CONFIG_FILE}.`, {
        hint: 'See the sources with: orglens source list',
        details: { source: name },
      });
    };

    return {
      root: paths.root,
      name: config.name,
      snapshot: (name, options = {}) =>
        boundary(async () => {
          const source = declared(name);
          const driver = await resolveDriver(config.store.driver);
          const open = (): ReturnType<typeof openStore> => {
            ensureDataDir(paths);
            return openStore({ path: paths.databaseFile, driver });
          };
          try {
            const taken =
              source.kind === 'git'
                ? await takeSnapshot(paths.root, source, open)
                : await takeOrgSnapshot({
                    paths,
                    source,
                    linked: config.logins[name],
                    env,
                    openStore: open,
                    restart: options.restart,
                    onProgress: options.onProgress,
                  });
            const { id, status, files, commit } = taken.snapshot;
            workspaceLogger(paths).info('snapshot.taken', { source: name, snapshot: id, status, files, commit });
            return taken;
          } catch (error) {
            // Only what OrgLens itself says about the failure goes into the log: its code and its reason. A run
            // that stopped before it created the data folder, for want of a login, does not create it for the log.
            if (source.kind !== 'git' && isEngineError(error) && existsSync(paths.dataDir)) {
              const { reason, snapshot } = error.details ?? {};
              workspaceLogger(paths).warn('snapshot.stopped', {
                source: name,
                code: error.code,
                reason: typeof reason === 'string' ? reason : null,
                snapshot: typeof snapshot === 'number' ? snapshot : null,
              });
            }
            throw error;
          }
        }),
      coverage: (name, options = {}) =>
        boundary(async () => {
          declared(name);
          const driver = await resolveDriver(config.store.driver);
          // A workspace without a database has no snapshot. That is said in the same words as for an empty one.
          if (!existsSync(paths.databaseFile)) throw noSnapshot(name, options.snapshot);
          const store = openStore({ path: paths.databaseFile, driver, readOnly: true });
          try {
            return coverageOf(store, name, options.snapshot);
          } finally {
            store.close();
          }
        }),
      status: () =>
        boundary(async () => {
          const { store, snapshots } = await inspectStore(paths, config);
          return {
            root: paths.root,
            name: config.name,
            configFiles: existsSync(paths.localConfigFile)
              ? [SHARED_CONFIG_FILE, LOCAL_CONFIG_FILE]
              : [SHARED_CONFIG_FILE],
            store,
            sources: config.sources.map((source) => ({
              ...source,
              snapshots: snapshots.get(source.name)?.count ?? 0,
              latestSnapshot: snapshots.get(source.name)?.latest ?? null,
              unfinishedSnapshot: snapshots.get(source.name)?.unfinished ?? null,
            })),
          };
        }),
      sources: {
        list: () => Promise.resolve([...config.sources]),
        add: (input) =>
          boundary(() => {
            let added: SourceDeclaration | undefined;
            edit((text) => {
              const result = addSourceText(text, declaration(input));
              added = result.source;
              return { shared: result.text };
            });
            if (added === undefined) throw new EngineError('INTERNAL', 'The source was not added.');
            workspaceLogger(paths).info('source.add', { source: added.name, kind: added.kind });
            return added;
          }),
        remove: (name) =>
          boundary(() => {
            edit((shared, local) => ({
              shared: removeSourceText(shared, name),
              // The login of a source that is no longer declared would make the personal file invalid.
              local: local === undefined ? undefined : unlinkLoginText(shared, local, name),
            }));
            workspaceLogger(paths).info('source.remove', { source: name });
            return { removed: name };
          }),
        link: (name, login) =>
          boundary(() => {
            const source = declared(name);
            if (source.kind === 'git') {
              throw new EngineError('SOURCE_INVALID', `The source "${name}" is of the kind "git" and has no login.`, {
                details: { source: name, problems: [] },
              });
            }
            const choice = chooseCliLogin(source, login, listCliLogins());
            if (choice.via === 'none') {
              throw new EngineError(
                'LOGIN_FAILED',
                `"${login}" is not a login of the Salesforce CLI on this machine.`,
                {
                  hint: 'The Salesforce CLI lists its logins with: sf org list. It adds one with: sf org login web --alias <alias>',
                  details: { reason: 'LOGIN_UNKNOWN', source: name },
                },
              );
            }
            const { orgId, username } = choice.login;
            if (source.orgId !== null && orgId !== null && !sameOrg(source.orgId, orgId)) {
              throw orgMismatch(source, orgId, `login "${login}"`);
            }
            edit((shared, local) => ({ local: linkLoginText(shared, local, name, login) }));
            workspaceLogger(paths).info('source.link', { source: name });
            return { source: name, login, username, orgId, declaredOrgId: source.orgId };
          }),
        check: (name) =>
          boundary(async () => {
            const source = declared(name);
            const checked = await checkSource(paths.root, source, config.logins[name], env);
            // A job in a fresh clone is the main user of this command. The log must not be the first file of a
            // data folder that Git does not ignore yet.
            ensureDataDir(paths);
            workspaceLogger(paths).info('source.check', {
              source: name,
              kind: checked.kind,
              ...(checked.kind === 'git' ? { complete: checked.complete } : { via: checked.login.via }),
            });
            return checked;
          }),
      },
    };
  });
}

const TEMPLATE = (
  name: string,
): string => `# orglens.toml: the shared configuration of this OrgLens workspace. Commit this file.
# It never holds a password, a token or a key. Personal settings go in ${LOCAL_CONFIG_FILE}.

schema_version = 1

[workspace]
name = ${JSON.stringify(name)}

# Sources are the orgs, sandboxes and repository folders that OrgLens reads.
# Add one with "orglens source add", or write it here:
#
# [sources.prod]
# kind = "org"
# org_id = "00D000000000000AAA"
`;

/**
 * Makes a folder a workspace, or completes one.
 *
 * In a folder without `orglens.toml` it writes that file and the data
 * folder. In a folder that has one (a fresh clone of a repository that
 * carries it) it only creates what is missing in the data folder, and never
 * touches the configuration.
 */
export function initWorkspace(options: InitOptions): Promise<InitResult> {
  return boundary(() => createWorkspace(options));
}

/** The path with its links resolved, as far as it exists. */
function realPath(path: string): string {
  const rest: string[] = [];
  let existing = resolve(path);
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) return resolve(path);
    rest.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...rest);
}

async function createWorkspace(options: InitOptions): Promise<InitResult> {
  const env = options.env ?? process.env;
  const paths = workspacePaths(options.dir);
  const created: string[] = [];
  const existing = isFile(paths.configFile);

  if (existing && options.name !== undefined) {
    throw new EngineError(
      'WORKSPACE_EXISTS',
      `This folder is already a workspace. Its name is set in ${SHARED_CONFIG_FILE}.`,
      {
        hint: 'Leave out the name to complete the workspace, or change the name in the file.',
        details: { root: paths.root },
      },
    );
  }

  if (!existing) {
    // The folder is looked at where it really is. Reached through a link, it can lie inside a workspace.
    const outer = searchWorkspaceRoot(dirname(realPath(paths.root)));
    if (outer !== null) {
      throw new EngineError('WORKSPACE_EXISTS', `This folder is inside the workspace at ${outer}.`, {
        hint: 'One workspace covers all folders below it. Declare the sources there.',
        details: { root: outer },
      });
    }
    // Control characters cannot be part of a name, and a name has at most 64 characters.
    const fallback = basename(paths.root)
      .replace(/\p{Cc}/gu, '')
      .slice(0, 64);
    const name = options.name ?? (fallback.trim() === '' ? 'workspace' : fallback);
    const text = TEMPLATE(name);
    // Everything that can be wrong is found before the first file is written: the name, a personal file that is
    // already there, and the environment.
    const local = isFile(paths.localConfigFile) ? readText(paths.localConfigFile, LOCAL_CONFIG_FILE) : undefined;
    if (typeof local === 'object') throw invalidConfig([local]);
    const check = readConfig({ shared: text, local, env });
    if (!check.ok) {
      const ofName = check.diagnostics.find((one) => one.file === SHARED_CONFIG_FILE);
      if (ofName === undefined) throw invalidConfig(check.diagnostics);
      // The file does not exist yet, so its line numbers would mean nothing to the reader.
      throw new EngineError('CONFIG_INVALID', `The name cannot be used. ${ofName.message}`, {
        details: { name, diagnostics: diagnosticsJson(check.diagnostics) },
      });
    }
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.configFile, text, { flag: 'wx' });
    created.push(SHARED_CONFIG_FILE);
  }

  const config = loadConfig(paths, env);
  if (ensureDataDir(paths)) created.push(IGNORE_FILE);
  const hadDatabase = existsSync(paths.databaseFile);
  openStore({ path: paths.databaseFile, driver: await resolveDriver(config.store.driver) }).close();
  if (!hadDatabase) created.push(DATABASE_FILE);

  workspaceLogger(paths).info('workspace.init', { created, existing });
  return { root: paths.root, created, existing };
}
