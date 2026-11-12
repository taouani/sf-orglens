/**
 * The driver port: the small part of a SQLite binding the store uses.
 *
 * Two bindings implement it, `node:sqlite` (the default) and
 * `better-sqlite3` (the fallback). Both pass one shared test suite, so that
 * switching is a change of adapter and nothing else. Where the bindings
 * behave differently on their own, `adaptStatement` makes them the same:
 *
 * - `prepare` takes one statement with positional `?` parameters, never
 *   numbered or named ones, and exactly as many values as it has parameters;
 * - values are null, a number, a bigint, a string or bytes. No booleans and
 *   no `undefined`. A JavaScript number is bound as a floating-point value by
 *   both bindings: a STRICT integer column stores it as an integer, but in
 *   an expression `? / 2` divides as a fraction;
 * - an integer comes back as a number, and one that does not fit a number
 *   exactly is refused, not rounded;
 * - `run` is for a statement that returns no rows, `get` and `all` are for
 *   one that does. The wrong one is refused.
 *
 * The two bindings must not open the same file in one process. Nothing here
 * can check that: the engine loads one driver for a workspace.
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
  /** Runs a statement that returns no rows. */
  run(...parameters: SqlValue[]): RunResult;
  /** The first row of a statement that returns rows, or `undefined` if there is none. */
  get(...parameters: SqlValue[]): SqlRow | undefined;
  all(...parameters: SqlValue[]): SqlRow[];
}

export interface SqlDatabase {
  /** Runs one or more statements that take no parameters and return nothing. */
  exec(sql: string): void;
  /** Prepares one statement. */
  prepare(sql: string): SqlStatement;
  /** Closes the connection. Closing twice is not an error. */
  close(): void;
}

export interface SqlOpenOptions {
  /** Open without the ability to write. The file must exist. */
  readonly readOnly: boolean;
  /** How long a statement waits for a lock held by another connection before it fails as busy. A whole number, 0 or more. */
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
  /** True if the error says that the file, or the folder it is in, cannot be written. */
  isReadOnly(error: unknown): boolean;
}

/**
 * Counts the `?` parameters of one statement, and refuses what the port does
 * not allow: a second statement, and numbered or named parameters. Text in
 * quotes and comments is skipped.
 */
export function countParameters(sql: string): number {
  let count = 0;
  let ended = false;
  let at = 0;
  while (at < sql.length) {
    const char = sql.charAt(at);
    const next = sql.charAt(at + 1);
    if (char === '-' && next === '-') {
      const end = sql.indexOf('\n', at);
      at = end === -1 ? sql.length : end + 1;
    } else if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', at + 2);
      at = end === -1 ? sql.length : end + 2;
    } else if (char === "'" || char === '"' || char === '`' || char === '[') {
      // A doubled quote inside the text starts the next quoted run, which this loop skips the same way.
      const end = sql.indexOf(char === '[' ? ']' : char, at + 1);
      at = end === -1 ? sql.length : end + 1;
    } else if (/\s/.test(char)) {
      at += 1;
    } else {
      if (ended) throw new TypeError('The store prepares one statement at a time. This text holds more than one.');
      if (char === ';') {
        ended = true;
      } else if (char === '?') {
        if (/[0-9]/.test(next)) throw new TypeError('The store uses plain "?" parameters, not numbered ones.');
        count += 1;
      } else if ((char === ':' || char === '@' || char === '$') && /[A-Za-z_]/.test(next)) {
        throw new TypeError('The store uses plain "?" parameters, not named ones.');
      }
      at += 1;
    }
  }
  return count;
}

/** Gives a row the shape the port promises, whatever the binding returned. */
export function normaliseRow(row: Record<string, unknown>): SqlRow {
  const result: Record<string, SqlResult> = {};
  for (const [column, value] of Object.entries(row)) {
    if (value === null || typeof value === 'number' || typeof value === 'string') {
      result[column] = value;
    } else if (typeof value === 'bigint') {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) {
        throw new RangeError(`Column "${column}" holds an integer that does not fit a JavaScript number.`);
      }
      result[column] = number;
    } else if (value instanceof Uint8Array) {
      // A Buffer is turned into a plain byte array. A plain one is passed on without a copy.
      result[column] = value.constructor === Uint8Array ? value : new Uint8Array(value);
    } else {
      throw new TypeError(`Column "${column}" holds a value the store cannot read.`);
    }
  }
  return result;
}

/** What an adapter hands to `adaptStatement`: the statement of the binding, reading integers as bigint. */
export interface RawStatement {
  /** True if the statement returns rows. */
  readonly returnsRows: boolean;
  run(parameters: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(parameters: SqlValue[]): Record<string, unknown> | undefined;
  all(parameters: SqlValue[]): Record<string, unknown>[];
}

/** Builds the statement of the port from the statement of a binding. `sql` has passed `countParameters`. */
export function adaptStatement(expected: number, raw: RawStatement): SqlStatement {
  const check = (parameters: SqlValue[], wantsRows: boolean): void => {
    if (parameters.length !== expected) {
      throw new RangeError(
        `The statement has ${String(expected)} parameters and was given ${String(parameters.length)} values.`,
      );
    }
    if (wantsRows !== raw.returnsRows) {
      throw new TypeError(
        raw.returnsRows
          ? 'The statement returns rows. Use get or all, not run.'
          : 'The statement returns no rows. Use run, not get or all.',
      );
    }
  };
  return {
    run: (...parameters) => {
      check(parameters, false);
      const { changes, lastInsertRowid } = raw.run(parameters);
      return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
    },
    get: (...parameters) => {
      check(parameters, true);
      const row = raw.get(parameters);
      return row === undefined ? undefined : normaliseRow(row);
    },
    all: (...parameters) => {
      check(parameters, true);
      return raw.all(parameters).map(normaliseRow);
    },
  };
}
