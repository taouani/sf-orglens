/**
 * The fallback driver: `better-sqlite3`, an optional dependency.
 *
 * It is loaded only when asked for, so that an installation without it
 * works, and so that the two bindings never meet by accident.
 */
import { EngineError } from '../core/errors.ts';
import { adaptStatement, countParameters, type SqlDatabase, type SqlDriver, type SqlOpenOptions } from './driver.ts';

function codeName(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

function unusable(message: string, cause: unknown): EngineError {
  return new EngineError('STORE_FAILED', message, {
    hint: 'Install better-sqlite3 next to OrgLens, or use the default driver.',
    cause,
  });
}

async function loadPackage() {
  try {
    return (await import('better-sqlite3')).default;
  } catch (cause) {
    throw unusable('The better-sqlite3 driver was asked for, but the package cannot be loaded.', cause);
  }
}

/**
 * Loads `better-sqlite3` and returns the driver built on it. The native part
 * of the package is loaded with the first connection, so one is opened in
 * memory here: a package that is installed and cannot run is reported now.
 */
export async function loadBetterSqlite3Driver(): Promise<SqlDriver> {
  const Database = await loadPackage();

  const open = (path: string, options: SqlOpenOptions): SqlDatabase => {
    const database = new Database(path, {
      readonly: options.readOnly,
      fileMustExist: options.readOnly,
      timeout: options.busyTimeoutMs,
    });
    let closed = false;
    return {
      exec: (sql) => {
        database.exec(sql);
      },
      prepare: (sql) => {
        const expected = countParameters(sql);
        const statement = database.prepare(sql);
        statement.safeIntegers(true);
        return adaptStatement(expected, {
          returnsRows: statement.reader,
          run: (parameters) => statement.run(...parameters),
          get: (parameters) => statement.get(...parameters),
          all: (parameters) => statement.all(...parameters),
        });
      },
      close: () => {
        if (closed) return;
        closed = true;
        database.close();
      },
    };
  };

  try {
    open(':memory:', { readOnly: false, busyTimeoutMs: 0 }).close();
  } catch (cause) {
    throw unusable('The better-sqlite3 package is installed, but its native part cannot be loaded.', cause);
  }

  return {
    name: 'better-sqlite3',
    open,
    // better-sqlite3 reports the SQLite result code by name, for example `SQLITE_BUSY` or `SQLITE_BUSY_SNAPSHOT`.
    isBusy: (error) => codeName(error).startsWith('SQLITE_BUSY'),
    isNotADatabase: (error) => codeName(error) === 'SQLITE_NOTADB',
    isReadOnly: (error) => codeName(error).startsWith('SQLITE_READONLY'),
  };
}
