/**
 * The fallback driver: `better-sqlite3`, an optional dependency.
 *
 * It is loaded only when asked for, so that an installation without it
 * works, and so that the two bindings never meet by accident.
 */
import { EngineError } from '../core/errors.ts';
import {
  normaliseRow,
  type SqlDatabase,
  type SqlDriver,
  type SqlOpenOptions,
  type SqlStatement,
  type SqlValue,
} from './driver.ts';

function codeName(error: unknown): string {
  const code: unknown = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

async function loadPackage() {
  try {
    return (await import('better-sqlite3')).default;
  } catch (cause) {
    throw new EngineError(
      'STORE_FAILED',
      'The better-sqlite3 driver was asked for, but the package cannot be loaded.',
      {
        hint: 'Install better-sqlite3 next to OrgLens, or use the default driver.',
        cause,
      },
    );
  }
}

/** Loads `better-sqlite3` and returns the driver built on it. */
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
      prepare: (sql): SqlStatement => {
        const statement = database.prepare(sql);
        return {
          run: (...parameters: SqlValue[]) => {
            // better-sqlite3 refuses `run` on a statement that returns rows. The port allows it.
            if (statement.reader) {
              statement.all(...parameters);
              return { changes: 0, lastInsertRowid: 0 };
            }
            const { changes, lastInsertRowid } = statement.run(...parameters);
            return { changes, lastInsertRowid: Number(lastInsertRowid) };
          },
          get: (...parameters: SqlValue[]) => {
            const row = statement.get(...parameters);
            return row === undefined ? undefined : normaliseRow(row);
          },
          all: (...parameters: SqlValue[]) => statement.all(...parameters).map(normaliseRow),
        };
      },
      close: () => {
        if (closed) return;
        closed = true;
        database.close();
      },
    };
  };

  return {
    name: 'better-sqlite3',
    open,
    // better-sqlite3 reports the SQLite result code by name, for example `SQLITE_BUSY` or `SQLITE_BUSY_SNAPSHOT`.
    isBusy: (error) => codeName(error).startsWith('SQLITE_BUSY'),
    isNotADatabase: (error) => codeName(error) === 'SQLITE_NOTADB',
  };
}
