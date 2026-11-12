/** The default driver: the SQLite binding that is built into Node.js. */
import { DatabaseSync } from 'node:sqlite';
import {
  normaliseRow,
  type SqlDatabase,
  type SqlDriver,
  type SqlOpenOptions,
  type SqlStatement,
  type SqlValue,
} from './driver.ts';

const SQLITE_BUSY = 5;
const SQLITE_NOTADB = 26;

// node:sqlite reports the SQLite result code as `errcode`. Its low byte is the primary code.
function primaryCode(error: unknown): number | undefined {
  const code: unknown = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' ? code & 0xff : undefined;
}

function open(path: string, options: SqlOpenOptions): SqlDatabase {
  const database = new DatabaseSync(path, { readOnly: options.readOnly, timeout: options.busyTimeoutMs });
  let closed = false;
  return {
    exec: (sql) => {
      database.exec(sql);
    },
    prepare: (sql): SqlStatement => {
      const statement = database.prepare(sql);
      return {
        run: (...parameters: SqlValue[]) => {
          const { changes, lastInsertRowid } = statement.run(...parameters);
          return { changes: Number(changes), lastInsertRowid: Number(lastInsertRowid) };
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
}

export const nodeSqliteDriver: SqlDriver = {
  name: 'node:sqlite',
  open,
  isBusy: (error) => primaryCode(error) === SQLITE_BUSY,
  isNotADatabase: (error) => primaryCode(error) === SQLITE_NOTADB,
};
