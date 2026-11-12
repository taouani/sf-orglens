/**
 * What the SQLite build at hand can do.
 *
 * With the default driver the SQLite library is whatever the user's Node.js
 * carries, so the features OrgLens needs are probed and not assumed. The
 * probe uses a database in memory and touches no file.
 */
import type { SqlDriver } from './driver.ts';

export interface SqliteCapabilities {
  readonly driver: string;
  /** The version of the SQLite library, for example `3.54.1`. */
  readonly sqliteVersion: string;
  /** STRICT tables, which every OrgLens table uses. */
  readonly strictTables: boolean;
  /** Full-text search with the trigram tokenizer, used for lookup by name. */
  readonly fts5Trigram: boolean;
  /** JSON functions, used by checks on JSON columns. */
  readonly json: boolean;
  /** Recursive queries, used to walk dependencies. */
  readonly recursiveQueries: boolean;
  /** True if nothing OrgLens needs is missing. */
  readonly ok: boolean;
}

export function probeSqlite(driver: SqlDriver): SqliteCapabilities {
  const database = driver.open(':memory:', { readOnly: false, busyTimeoutMs: 0 });
  const works = (check: () => boolean): boolean => {
    try {
      return check();
    } catch {
      return false;
    }
  };
  try {
    const version = database.prepare('SELECT sqlite_version() AS v').get()?.['v'];
    const strictTables = works(() => {
      database.exec('CREATE TABLE probe_strict (n INTEGER) STRICT');
      return true;
    });
    const fts5Trigram = works(() => {
      database.exec("CREATE VIRTUAL TABLE probe_fts USING fts5 (name, tokenize = 'trigram')");
      database.prepare('INSERT INTO probe_fts (name) VALUES (?)').run('accountservice');
      return database.prepare('SELECT count(*) AS n FROM probe_fts WHERE name MATCH ?').get('ntserv')?.['n'] === 1;
    });
    const json = works(
      () => database.prepare(`SELECT json_valid('[1]') AS v, json_extract('{"a":2}', '$.a') AS a`).get()?.['a'] === 2,
    );
    const recursiveQueries = works(() => {
      const sql =
        'WITH RECURSIVE c (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 5) SELECT sum(n) AS s FROM c';
      return database.prepare(sql).get()?.['s'] === 15;
    });
    return {
      driver: driver.name,
      sqliteVersion: typeof version === 'string' ? version : 'unknown',
      strictTables,
      fts5Trigram,
      json,
      recursiveQueries,
      ok: strictTables && fts5Trigram && json && recursiveQueries,
    };
  } finally {
    database.close();
  }
}
