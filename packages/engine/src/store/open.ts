/**
 * Opening the workspace database.
 *
 * The order of the steps matters:
 *
 * 1. Look at a file that exists through a connection that cannot write, and
 *    refuse a file that is not an OrgLens database or was written by a newer
 *    version. A connection that can write completes what a crashed program
 *    left behind, and that would change a file before it is identified.
 * 2. Open the connection the store works with, and check again: the file
 *    can have changed in between.
 * 3. Only then switch to write-ahead logging and run the migrations.
 *
 * Opening a database that is already current changes nothing in it. A
 * read-only open never changes the database, and refuses one that still
 * needs a migration. SQLite itself may create the `-wal` and `-shm` files
 * next to a database, also for a connection that only reads.
 *
 * Whatever a connection throws leaves the store as an `EngineError` with a
 * `STORE_` code.
 */
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { EngineError } from '../core/errors.ts';
import type { SqlDatabase, SqlDriver, SqlRow, SqlStatement, SqlValue } from './driver.ts';
import {
  busy,
  checkSchemaState,
  migrate,
  MIGRATIONS,
  readSchemaState,
  type Migration,
  type SchemaState,
} from './migrate.ts';
import { nodeSqliteDriver } from './node-sqlite.ts';

const DEFAULT_BUSY_TIMEOUT_MS = 5000;
/** The smallest SQLite database: one page of the smallest page size. */
const SMALLEST_DATABASE_BYTES = 512;
/** How many prepared statements a store keeps. The statements of a bulk write are few and run very often. */
const STATEMENT_CACHE_SIZE = 64;

export interface OpenStoreOptions {
  /** The database file. It is created if it does not exist, unless `readOnly` is set. */
  readonly path: string;
  /** Default: the SQLite binding built into Node.js. */
  readonly driver?: SqlDriver;
  readonly readOnly?: boolean;
  /** How long to wait for a lock held by another process, in milliseconds. Default 5 seconds. */
  readonly busyTimeoutMs?: number;
  /** For tests. Default: the migrations of this build. */
  readonly migrations?: readonly Migration[];
}

export interface Store {
  readonly path: string;
  readonly driverName: string;
  readonly readOnly: boolean;
  readonly schemaVersion: number;
  /** The schema versions before and after the migrations this open applied. They are equal if it applied none. */
  readonly migrated: { readonly from: number; readonly to: number };
  /** Runs a statement that returns no rows. */
  run(sql: string, ...parameters: SqlValue[]): { changes: number; lastInsertRowid: number };
  /** The first row of a statement that returns rows. */
  get(sql: string, ...parameters: SqlValue[]): SqlRow | undefined;
  all(sql: string, ...parameters: SqlValue[]): SqlRow[];
  /**
   * Runs `work` in one write transaction. It takes the write lock at the
   * start, so two writers never interleave: the second one waits for the
   * busy timeout and then fails with `STORE_BUSY`. If `work` throws, nothing
   * it wrote is kept. `work` must not be asynchronous.
   */
  write<T>(work: () => T): T;
  /**
   * Moves the write-ahead log into the database file. Call it after a large
   * write has been committed. Returns false if a reader in another process
   * kept a part of the log in use, or if the store is read-only.
   */
  checkpoint(): boolean;
  close(): void;
}

function foreign(path: string, cause?: unknown): EngineError {
  return new EngineError('STORE_FOREIGN', 'This file is not an OrgLens workspace database.', {
    hint: 'Point OrgLens at a workspace folder of its own. It never changes a database it did not create.',
    details: { path },
    cause,
  });
}

const CANNOT_WRITE = 'The workspace database, or the folder it is in, cannot be written.';
const WRITE_HINT =
  'Check that you may write to the folder of the database and to the files in it. SQLite creates files next to the database, also when it only reads.';

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Turns what a connection threw into the error the store reports. */
function storeError(driver: SqlDriver, path: string, message: string, cause: unknown): EngineError {
  if (cause instanceof EngineError) return cause;
  if (driver.isBusy(cause)) return busy(path, cause);
  if (driver.isNotADatabase(cause)) return foreign(path, cause);
  if (driver.isReadOnly(cause)) {
    return new EngineError('STORE_FAILED', CANNOT_WRITE, {
      hint: WRITE_HINT,
      details: { path, reason: reasonOf(cause) },
      cause,
    });
  }
  return new EngineError('STORE_FAILED', `${message} SQLite says: ${reasonOf(cause)}`, {
    details: { path, reason: reasonOf(cause) },
    cause,
  });
}

function timeoutOf(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new EngineError('INTERNAL', `A busy timeout of ${String(value)} milliseconds was asked for.`);
  }
  return Math.trunc(value);
}

/** How long an open that was told "busy" at once waits before it tries again. */
const RETRY_PAUSE_MS = 15;

function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** Opens the workspace database, and creates or migrates it unless `readOnly` is set. Every failure is an `EngineError`. */
export function openStore(options: OpenStoreOptions): Store {
  const busyTimeoutMs = timeoutOf(options.busyTimeoutMs);
  const deadline = Date.now() + busyTimeoutMs;
  for (;;) {
    try {
      return openOnce(options, busyTimeoutMs);
    } catch (error) {
      // SQLite waits for most locks, but in a few moments it says "busy" at once, for example while the last
      // other connection closes and tidies up. Opening is safe to repeat, so "busy" is reported only once the
      // timeout has really passed.
      if (!(error instanceof EngineError) || error.code !== 'STORE_BUSY' || Date.now() >= deadline) throw error;
      pause(RETRY_PAUSE_MS);
    }
  }
}

function openOnce(options: OpenStoreOptions, busyTimeoutMs: number): Store {
  const { path } = options;
  const driver = options.driver ?? nodeSqliteDriver;
  const readOnly = options.readOnly ?? false;
  const migrations = options.migrations ?? MIGRATIONS;
  const cannotOpen = 'The workspace database cannot be opened.';

  const connect = (withoutWriting: boolean): SqlDatabase => {
    try {
      return driver.open(path, { readOnly: withoutWriting, busyTimeoutMs });
    } catch (cause) {
      throw storeError(driver, path, cannotOpen, cause);
    }
  };
  /** Reads and checks the state of the file, and closes the connection if the file is refused. */
  const identify = (connection: SqlDatabase): SchemaState => {
    try {
      const state = readSchemaState(connection);
      checkSchemaState(state, migrations.length, path);
      return state;
    } catch (cause) {
      connection.close();
      throw storeError(driver, path, cannotOpen, cause);
    }
  };

  const exists = existsSync(path);
  if (readOnly && !exists) {
    throw new EngineError('STORE_NOT_FOUND', 'There is no workspace database here yet.', {
      hint: 'Take a snapshot first.',
      details: { path },
    });
  }
  if (exists) {
    const size = statSync(path).size;
    // SQLite takes a file shorter than a database page for an empty database, and would overwrite it.
    if (size > 0 && size < SMALLEST_DATABASE_BYTES) throw foreign(path);
    if (!readOnly) {
      try {
        accessSync(path, constants.W_OK);
      } catch (cause) {
        // SQLite would open such a file without the ability to write, and say so only at the first write.
        throw new EngineError('STORE_FAILED', CANNOT_WRITE, {
          hint: WRITE_HINT,
          details: { path, reason: reasonOf(cause) },
          cause,
        });
      }
      if (size > 0) {
        const look = connect(true);
        identify(look);
        look.close();
      }
    }
  }

  const database = connect(readOnly);
  let migrated: { from: number; to: number };
  const state = identify(database);
  try {
    if (readOnly) {
      if (state.empty && state.version === 0) {
        throw new EngineError('STORE_NOT_FOUND', 'There is no workspace database here yet.', {
          hint: 'Take a snapshot first.',
          details: { path },
        });
      }
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
        throw new EngineError('STORE_FAILED', 'SQLite cannot use write-ahead logging for this database.', {
          hint: 'Keep the workspace in a folder on a local disk.',
          details: { path, journalMode: typeof mode === 'string' ? mode : null },
        });
      }
      database.exec('PRAGMA synchronous = NORMAL');
      migrated = migrate(database, driver, path, migrations);
    }
    database.exec('PRAGMA foreign_keys = ON');
  } catch (cause) {
    database.close();
    throw storeError(driver, path, cannotOpen, cause);
  }

  const statements = new Map<string, SqlStatement>();
  const prepared = (sql: string): SqlStatement => {
    let statement = statements.get(sql);
    if (statement === undefined) {
      statement = database.prepare(sql);
      const oldest = statements.keys().next();
      if (statements.size >= STATEMENT_CACHE_SIZE && oldest.done !== true) statements.delete(oldest.value);
      statements.set(sql, statement);
    }
    return statement;
  };
  const guarded = <T>(action: () => T): T => {
    try {
      return action();
    } catch (cause) {
      throw storeError(driver, path, 'A statement on the workspace database failed.', cause);
    }
  };

  let writing = false;
  return {
    path,
    driverName: driver.name,
    readOnly,
    schemaVersion: migrated.to,
    migrated,
    run: (sql, ...parameters) => guarded(() => prepared(sql).run(...parameters)),
    get: (sql, ...parameters) => guarded(() => prepared(sql).get(...parameters)),
    all: (sql, ...parameters) => guarded(() => prepared(sql).all(...parameters)),
    write: (work) => {
      if (readOnly) throw new EngineError('INTERNAL', 'A write was attempted on a read-only workspace database.');
      if (writing) throw new EngineError('INTERNAL', 'A write transaction was started inside another one.');
      guarded(() => {
        database.exec('BEGIN IMMEDIATE');
      });
      writing = true;
      try {
        const result = work();
        if (typeof (result as { then?: unknown } | null)?.then === 'function') {
          throw new EngineError(
            'INTERNAL',
            'A write transaction was given an asynchronous function. It would end before the work does.',
          );
        }
        guarded(() => {
          database.exec('COMMIT');
        });
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
      if (readOnly) return false;
      if (writing) throw new EngineError('INTERNAL', 'A checkpoint was asked for inside a write transaction.');
      return guarded(() => prepared('PRAGMA wal_checkpoint(TRUNCATE)').get())?.['busy'] === 0;
    },
    close: () => {
      statements.clear();
      database.close();
    },
  };
}
