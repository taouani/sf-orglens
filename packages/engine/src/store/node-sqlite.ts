/** The default driver: the SQLite binding that is built into Node.js. */
import { DatabaseSync } from 'node:sqlite';
import { adaptStatement, countParameters, type SqlDatabase, type SqlDriver, type SqlOpenOptions } from './driver.ts';

const SQLITE_BUSY = 5;
const SQLITE_READONLY = 8;
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
    prepare: (sql) => {
      const expected = countParameters(sql);
      const statement = database.prepare(sql);
      statement.setReadBigInts(true);
      return adaptStatement(expected, {
        returnsRows: statement.columns().length > 0,
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
}

export const nodeSqliteDriver: SqlDriver = {
  name: 'node:sqlite',
  open,
  isBusy: (error) => primaryCode(error) === SQLITE_BUSY,
  isNotADatabase: (error) => primaryCode(error) === SQLITE_NOTADB,
  isReadOnly: (error) => primaryCode(error) === SQLITE_READONLY,
};
