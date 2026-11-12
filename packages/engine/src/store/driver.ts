/**
 * The driver port: the small part of a SQLite binding the store uses.
 *
 * Two bindings implement it, `node:sqlite` (the default) and
 * `better-sqlite3` (the fallback). Both pass one shared test suite, so that
 * switching is a change of adapter and nothing else. To keep that true the
 * store uses only the SQL both understand the same way:
 *
 * - positional `?` parameters, never numbered or named ones;
 * - values that are null, a number, a bigint, a string or bytes. No
 *   booleans and no `undefined`;
 * - integers that fit a JavaScript number.
 *
 * The two bindings must never open the same file in one process.
 */

/** A value that can be bound to a parameter. */
export type SqlValue = null | number | bigint | string | Uint8Array;

/** A value as it comes back in a row. Integers come back as numbers, blobs as plain `Uint8Array`. */
type SqlResult = null | number | string | Uint8Array;

export type SqlRow = Readonly<Record<string, SqlResult>>;

interface RunResult {
  /** Rows inserted, updated or deleted by the statement. */
  readonly changes: number;
  readonly lastInsertRowid: number;
}

export interface SqlStatement {
  /** Runs the statement and discards any rows. */
  run(...parameters: SqlValue[]): RunResult;
  /** The first row, or `undefined` if there is none. */
  get(...parameters: SqlValue[]): SqlRow | undefined;
  all(...parameters: SqlValue[]): SqlRow[];
}

export interface SqlDatabase {
  /** Runs one or more statements that take no parameters and return nothing. */
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** Closes the connection. Closing twice is not an error. */
  close(): void;
}

export interface SqlOpenOptions {
  /** Open without the ability to write. The file must exist. */
  readonly readOnly: boolean;
  /** How long a statement waits for a lock held by another connection before it fails as busy. */
  readonly busyTimeoutMs: number;
}

type SqlDriverName = 'node:sqlite' | 'better-sqlite3';

export interface SqlDriver {
  readonly name: SqlDriverName;
  open(path: string, options: SqlOpenOptions): SqlDatabase;
  /** True if the error says that another connection holds the lock that was needed. */
  isBusy(error: unknown): boolean;
  /** True if the error says that the file is not a SQLite database. */
  isNotADatabase(error: unknown): boolean;
}

/** Gives a row the shape the port promises, whatever the binding returned. */
export function normaliseRow(row: Record<string, unknown>): SqlRow {
  const result: Record<string, SqlResult> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null || typeof value === 'number' || typeof value === 'string') result[column] = value;
    else if (typeof value === 'bigint') result[column] = Number(value);
    else if (value instanceof Uint8Array) result[column] = new Uint8Array(value);
    else throw new TypeError(`Column "${column}" holds a value the store cannot read.`);
  }
  return result;
}
