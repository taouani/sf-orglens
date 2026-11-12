/**
 * Where a workspace keeps its files.
 *
 * A workspace is a folder with `orglens.toml` in it. Everything OrgLens
 * writes besides that file lives in `.orglens/`, which ignores itself in
 * Git. Deleting it loses the snapshots: a repository can be read again, the
 * state of an org at a past moment cannot.
 *
 *   orglens.toml             shared configuration, committed
 *   .orglens/.gitignore      contains "*": the folder ignores itself
 *   .orglens/local.toml      personal settings, optional, written by hand
 *   .orglens/orglens.db      the workspace database (plus -wal and -shm, which SQLite creates beside it)
 *   .orglens/config.lock     held while a command changes orglens.toml
 *   .orglens/logs/           one JSON-lines file per day
 *
 * The retrieve cache and the scratch folder are added with the feature
 * that writes to them.
 */
import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { LOCAL_CONFIG_FILE, SHARED_CONFIG_FILE } from '../core/config/config.ts';

const DATA_DIR = '.orglens';
export const DATABASE_FILE = '.orglens/orglens.db';
export const IGNORE_FILE = '.orglens/.gitignore';
const LOGS_DIR = '.orglens/logs';
const CONFIG_LOCK_FILE = '.orglens/config.lock';

/** The environment variable that names the workspace folder. It wins over the search from the current folder. */
export const WORKSPACE_VARIABLE = 'ORGLENS_WORKSPACE';

export interface WorkspacePaths {
  /** The absolute path of the workspace folder. */
  readonly root: string;
  readonly configFile: string;
  readonly localConfigFile: string;
  readonly dataDir: string;
  readonly databaseFile: string;
  readonly ignoreFile: string;
  readonly logsDir: string;
  readonly configLockFile: string;
}

export function workspacePaths(root: string): WorkspacePaths {
  const absolute = resolve(root);
  const at = (relative: string): string => join(absolute, ...relative.split('/'));
  return {
    root: absolute,
    configFile: at(SHARED_CONFIG_FILE),
    localConfigFile: at(LOCAL_CONFIG_FILE),
    dataDir: at(DATA_DIR),
    databaseFile: at(DATABASE_FILE),
    ignoreFile: at(IGNORE_FILE),
    logsDir: at(LOGS_DIR),
    configLockFile: at(CONFIG_LOCK_FILE),
  };
}

/** True if the path is a file. A folder of that name is not one. */
export const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

/** Walks up from a folder to the first one that holds a file named `orglens.toml`. */
export function searchWorkspaceRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (isFile(join(dir, SHARED_CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
