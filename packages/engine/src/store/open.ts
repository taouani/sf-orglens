/**
 * Opening the workspace database.
 *
 * The order of the steps matters:
 *
 * 1. Set the busy timeout, so that every later step waits for a lock instead of failing at once.
 * 2. Read the schema version and the application id, and refuse a foreign or newer file. Nothing has been written.
 * 3. Only then switch to write-ahead logging and run the migrations.
 *
 * Opening a database that is already current writes nothing. A read-only
 * open never writes, and refuses a database that still needs a migration.
 */
import { existsSync } from 'node:fs';
import { EngineError } from '../core/errors.ts';
import type { SqlDatabase, SqlDriver, SqlRow, SqlValue } from './driver.ts';
import { busy, checkSchemaState, migrate, MIGRATIONS, readSchemaState, type Migration } from './migrate.ts';
import { nodeSqliteDriver } from './node-sqlite.ts';

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface OpenStoreOptions {
  /** The database file. It is created if it does not exist, unless `readOnly` is set. */
  readonly path: string;
  /** Default: the SQLite binding built into Node.js. */
  readonly driver?: SqlDriver;
  readonly readOnly?: boolean;
  /** How long to wait for a lock held by another process. Default 5 seconds. */
  readonly busyTimeoutMs?: number;
  /** For tests. Default: the migrations of this build. */
  readonly migrations?: readonly Migration[];
}

export interface Store {
  readonly path: string;
  readonly driverName: string;
  readonly readOnly: boolean;
  readonly schemaVersion: number;
  /** The schema versions before and after opening. They differ if this open migrated the database. */
  readonly migrated: { readonly from: number; readonly to: number };
  run(sql: string, ...parameters: SqlValue[]): { changes: number; lastInsertRowid: number };
  get(sql: string, ...parameters: SqlValue[]): SqlRow | undefined;
  all(sql: string, ...parameters: SqlValue[]): SqlRow[];
  /**
   * Runs `work` in one write transaction. It takes the write lock at the
   * start, so two writers never interleave: the second one waits for the
   * busy timeout and then fails with `STORE_BUSY`. If `work` throws, nothing
   * it wrote is kept.
   */
  write<T>(work: () => T): T;
  /** Moves the write-ahead log into the database file. Call it after a large write has been committed. */
  checkpoint(): void;
  close(): void;
}

function fail(message: string, path: string, cause: unknown): EngineError {
  return new EngineError('STORE_FAILED', message, { details: { path }, cause });
}

export function openStore(options: OpenStoreOptions): Store {
  const { path } = options;
  const driver = options.driver ?? nodeSqliteDriver;
  const readOnly = options.readOnly ?? false;
  const migrations = options.migrations ?? MIGRATIONS;

  if (readOnly && !existsSync(path)) {
    throw new EngineError('STORE_NOT_FOUND', 'There is no workspace database here yet.', {
      hint: 'Take a snapshot first.',
      details: { path },
    });
  }

  let database: SqlDatabase;
  try {
    database = driver.open(path, { readOnly, busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS });
  } catch (cause) {
    throw fail('The workspace database cannot be opened.', path, cause);
  }

  let migrated: { from: number; to: number };
  try {
    database.exec(`PRAGMA busy_timeout = ${String(Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS))}`);
    let state;
    try {
      state = readSchemaState(database);
    } catch (cause) {
      // A file that is not a SQLite database at all fails on the first read.
      if (driver.isNotADatabase(cause)) {
        throw new EngineError('STORE_FOREIGN', 'This file is not an OrgLens workspace database.', {
          hint: 'Point OrgLens at a workspace folder of its own. It never changes a database it did not create.',
          details: { path },
          cause,
        });
      }
      if (driver.isBusy(cause)) throw busy(path, cause);
      throw cause;
    }
    checkSchemaState(state, migrations.length, path);

    if (readOnly) {
      if (state.version < migrations.length) {
        throw new EngineError('STORE_OUTDATED', 'The workspace database was written by an older version of OrgLens.', {
          hint: 'Run a command that writes to the workspace, such as a snapshot, to update it.',
          details: { path, found: state.version, current: migrations.length },
        });
      }
      migrated = { from: state.version, to: state.version };
    } else {
      const mode = database.prepare('PRAGMA journal_mode = WAL').get()?.['journal_mode'];
      if (mode !== 'wal') {
        throw fail(
          'The workspace database cannot use write-ahead logging here. Keep the workspace on a local disk.',
          path,
          undefined,
        );
      }
      database.exec('PRAGMA synchronous = NORMAL');
      migrated = migrate(database, driver, path, migrations);
    }
    database.exec('PRAGMA foreign_keys = ON');
  } catch (cause) {
    database.close();
    if (cause instanceof EngineError) throw cause;
    throw fail('The workspace database cannot be opened.', path, cause);
  }

  let writing = false;
  const store: Store = {
    path,
    driverName: driver.name,
    readOnly,
    schemaVersion: migrated.to,
    migrated,
    run: (sql, ...parameters) => database.prepare(sql).run(...parameters),
    get: (sql, ...parameters) => database.prepare(sql).get(...parameters),
    all: (sql, ...parameters) => database.prepare(sql).all(...parameters),
    write: (work) => {
      if (readOnly) throw new EngineError('INTERNAL', 'A write was attempted on a read-only workspace database.');
      if (writing) throw new EngineError('INTERNAL', 'A write transaction was started inside another one.');
      try {
        database.exec('BEGIN IMMEDIATE');
      } catch (cause) {
        if (driver.isBusy(cause)) throw busy(path, cause);
        throw fail('The workspace database cannot be written.', path, cause);
      }
      writing = true;
      try {
        const result = work();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          database.exec('ROLLBACK');
        } catch {
          // The transaction is already gone. The original failure is the one to report.
        }
        throw error;
      } finally {
        writing = false;
      }
    },
    checkpoint: () => {
      if (!readOnly) database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    },
    close: () => {
      database.close();
    },
  };
  return store;
}
