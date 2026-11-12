import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countParameters, normaliseRow, type SqlOpenOptions } from '../src/store/driver.ts';
import { probeSqlite } from '../src/store/probe.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const options = { readOnly: false, busyTimeoutMs: 50 };

// One suite for both drivers: the store may only rely on what passes here for each of them.
describe.each(DRIVERS)('driver contract: $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);

  it('binds every kind of value and returns it in the promised shape', () => {
    const db = driver.open(':memory:', options);
    const row = db
      .prepare('SELECT ? AS a_null, ? AS a_whole, ? AS a_real, ? AS a_big, ? AS a_text, ? AS a_bytes')
      .get(null, 42, 1.5, 9007199254740991n, 'héllo', new Uint8Array([0, 1, 255]));
    expect(row).toEqual({
      a_null: null,
      a_whole: 42,
      a_real: 1.5,
      a_big: 9007199254740991,
      a_text: 'héllo',
      a_bytes: new Uint8Array([0, 1, 255]),
    });
    // Blobs are plain byte arrays with either driver, never a Buffer.
    expect(Object.getPrototypeOf(row?.['a_bytes'])).toBe(Uint8Array.prototype);
    db.close();
  });

  it('runs statements and reports what changed', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT; CREATE INDEX t_name ON t (name);');
    const insert = db.prepare('INSERT INTO t (name) VALUES (?)');
    expect(insert.run('a')).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(insert.run('b')).toEqual({ changes: 1, lastInsertRowid: 2 });
    expect(db.prepare('UPDATE t SET name = name || ?').run('!').changes).toBe(2);
    expect(db.prepare('SELECT id, name FROM t ORDER BY id').all()).toEqual([
      { id: 1, name: 'a!' },
      { id: 2, name: 'b!' },
    ]);
    expect(db.prepare('SELECT id FROM t WHERE name = ?').get('missing')).toBeUndefined();
    expect(db.prepare('SELECT id FROM t WHERE name = ?').all('missing')).toEqual([]);
    db.close();
  });

  it('refuses run on a statement that returns rows, and get or all on one that does not', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT) STRICT');
    expect(() => db.prepare('PRAGMA user_version').run()).toThrow(TypeError);
    expect(() => db.prepare('SELECT 1').run()).toThrow(/returns rows/);
    expect(() => db.prepare('INSERT INTO t (name) VALUES (?) RETURNING id').run('a')).toThrow(TypeError);
    expect(() => db.prepare('INSERT INTO t (name) VALUES (?)').get('a')).toThrow(/returns no rows/);
    expect(() => db.prepare('DELETE FROM t').all()).toThrow(TypeError);
    // None of the refused calls ran.
    expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
    expect(db.prepare('INSERT INTO t (name) VALUES (?) RETURNING id, name').get('b')).toEqual({ id: 1, name: 'b' });
    db.close();
  });

  it('refuses a wrong number of values', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (a INTEGER, b TEXT) STRICT');
    const insert = db.prepare('INSERT INTO t (a, b) VALUES (?, ?)');
    expect(() => insert.run(1)).toThrow(RangeError);
    expect(() => insert.run(1, 'x', 'y')).toThrow(/2 parameters and was given 3 values/);
    expect(() => db.prepare('SELECT a FROM t WHERE a = ?').all()).toThrow(RangeError);
    expect(db.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
    // A question mark inside text is not a parameter.
    expect(db.prepare("SELECT '?' AS mark, ? AS value").get(1)).toEqual({ mark: '?', value: 1 });
    db.close();
  });

  it('prepares one statement at a time, with plain parameters only', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (n INTEGER) STRICT');
    expect(() => db.prepare('INSERT INTO t VALUES (1); INSERT INTO t VALUES (2)')).toThrow(/one statement/);
    expect(() => db.prepare('SELECT ?1')).toThrow(/numbered/);
    expect(() => db.prepare('SELECT :name')).toThrow(/named/);
    expect(db.prepare('SELECT count(*) AS n FROM t; -- done').get()).toEqual({ n: 0 });
    db.close();
  });

  it('refuses an integer that does not fit a number instead of rounding it', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (n INTEGER) STRICT');
    db.prepare('INSERT INTO t VALUES (?)').run(9007199254740993n);
    expect(() => db.prepare('SELECT n FROM t').get()).toThrow(RangeError);
    expect(() => db.prepare('SELECT n FROM t').all()).toThrow(/does not fit/);
    expect(db.prepare('SELECT CAST(n AS TEXT) AS n FROM t').get()).toEqual({ n: '9007199254740993' });
    expect(db.prepare('SELECT -9007199254740991 AS low, 1.5 AS real').get()).toEqual({
      low: -9007199254740991,
      real: 1.5,
    });
    db.close();
  });

  it('binds a number as a floating-point value, which a STRICT integer column stores as an integer', () => {
    const db = driver.open(':memory:', options);
    expect(db.prepare('SELECT typeof(?) AS number, typeof(?) AS big, ? / 2 AS half').get(5, 5n, 5)).toEqual({
      number: 'real',
      big: 'integer',
      half: 2.5,
    });
    db.exec('CREATE TABLE t (n INTEGER) STRICT');
    db.prepare('INSERT INTO t VALUES (?)').run(5);
    expect(db.prepare('SELECT typeof(n) AS type, n / 2 AS half FROM t').get()).toEqual({ type: 'integer', half: 2 });
    db.close();
  });

  it('enforces STRICT tables', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (n INTEGER) STRICT');
    expect(() => db.prepare('INSERT INTO t (n) VALUES (?)').run('not a number')).toThrow();
    db.close();
  });

  it('throws on invalid SQL, and that is not a busy error', () => {
    const db = driver.open(':memory:', options);
    let thrown: unknown;
    try {
      db.exec('SELECT * FROM nowhere');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const classifiers = [
      (error: unknown) => driver.isBusy(error),
      (error: unknown) => driver.isNotADatabase(error),
      (error: unknown) => driver.isReadOnly(error),
    ];
    for (const classify of classifiers) {
      expect(classify(thrown)).toBe(false);
      expect(classify(undefined)).toBe(false);
      expect(classify(new Error('busy, not a database'))).toBe(false);
    }
    db.close();
  });

  it('keeps a transaction or rolls it back as a whole', () => {
    const db = driver.open(':memory:', options);
    db.exec('CREATE TABLE t (n INTEGER) STRICT');
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO t VALUES (?)').run(1);
    db.exec('ROLLBACK');
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO t VALUES (?)').run(2);
    db.exec('COMMIT');
    expect(db.prepare('SELECT n FROM t').all()).toEqual([{ n: 2 }]);
    db.close();
  });

  it('reports a lock held by another connection as busy', () => {
    const file = join(temp.next(), 'busy.sqlite');
    const first = driver.open(file, options);
    first.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER) STRICT;');
    const second = driver.open(file, options);
    first.exec('BEGIN IMMEDIATE');
    let thrown: unknown;
    try {
      second.exec('BEGIN IMMEDIATE');
    } catch (error) {
      thrown = error;
    }
    expect(driver.isBusy(thrown)).toBe(true);
    expect(driver.isNotADatabase(thrown)).toBe(false);
    expect(driver.isReadOnly(thrown)).toBe(false);
    // A reader is not blocked by the writer.
    expect(second.prepare('SELECT count(*) AS n FROM t').get()).toEqual({ n: 0 });
    first.exec('COMMIT');
    expect(() => {
      second.exec('BEGIN IMMEDIATE; COMMIT;');
    }).not.toThrow();
    first.close();
    second.close();
  });

  it('opens read-only without the ability to write, and only an existing file', () => {
    const dir = temp.next();
    const file = join(dir, 'ro.sqlite');
    const writer = driver.open(file, options);
    writer.exec('CREATE TABLE t (n INTEGER) STRICT; INSERT INTO t VALUES (7);');
    writer.close();

    const reader = driver.open(file, { readOnly: true, busyTimeoutMs: 50 });
    expect(reader.prepare('SELECT n FROM t').get()).toEqual({ n: 7 });
    let thrown: unknown;
    try {
      reader.exec('INSERT INTO t VALUES (8)');
    } catch (error) {
      thrown = error;
    }
    expect(driver.isReadOnly(thrown)).toBe(true);
    expect(driver.isBusy(thrown)).toBe(false);
    reader.close();

    expect(() => driver.open(join(dir, 'missing.sqlite'), { readOnly: true, busyTimeoutMs: 50 })).toThrow();
  });

  it('says so when a file is not a database, at the first read', () => {
    const file = join(temp.next(), 'notes.sqlite');
    writeFileSync(file, 'This is a text file, not a database. '.repeat(40));
    const db = driver.open(file, options);
    let thrown: unknown;
    try {
      db.prepare('SELECT count(*) FROM sqlite_schema').get();
    } catch (error) {
      thrown = error;
    } finally {
      db.close();
    }
    expect(driver.isNotADatabase(thrown)).toBe(true);
    expect(driver.isBusy(thrown)).toBe(false);
  });

  it('waits for the busy timeout before it gives up', () => {
    const file = join(temp.next(), 'wait.sqlite');
    const holder = driver.open(file, options);
    holder.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER) STRICT; BEGIN IMMEDIATE;');
    const waited = (busyTimeoutMs: number): number => {
      const other = driver.open(file, { readOnly: false, busyTimeoutMs });
      const start = performance.now();
      expect(() => {
        other.exec('BEGIN IMMEDIATE');
      }).toThrow();
      other.close();
      return performance.now() - start;
    };
    const patient = waited(300);
    expect(patient).toBeGreaterThanOrEqual(250);
    expect(waited(0)).toBeLessThan(patient);
    holder.exec('ROLLBACK');
    holder.close();
  });

  it('can be closed twice', () => {
    const db = driver.open(':memory:', options);
    db.close();
    expect(() => {
      db.close();
    }).not.toThrow();
  });

  it('has every SQLite feature OrgLens needs', () => {
    const capabilities = probeSqlite(driver);
    expect(capabilities).toMatchObject({
      driver: driver.name,
      strictTables: true,
      fts5Trigram: true,
      json: true,
      recursiveQueries: true,
      ok: true,
    });
    expect(capabilities.sqliteVersion).toMatch(/^3\.\d+\.\d+/);
  });
});

describe('normaliseRow', () => {
  it('refuses a value the port does not know', () => {
    expect(() => normaliseRow({ flag: true })).toThrow(TypeError);
  });

  it('turns a bigint into a number when that is exact, and refuses it otherwise', () => {
    expect(normaliseRow({ n: 9007199254740991n, m: -5n })).toEqual({ n: 9007199254740991, m: -5 });
    expect(() => normaliseRow({ n: 9007199254740992n })).toThrow(RangeError);
    expect(() => normaliseRow({ n: -9007199254740992n })).toThrow(RangeError);
  });

  it('hands a plain byte array on as it is, and copies a Buffer into one', () => {
    const plain = new Uint8Array([1, 2]);
    expect(normaliseRow({ b: plain })['b']).toBe(plain);
    const fromBuffer = normaliseRow({ b: Buffer.from([1, 2]) })['b'];
    expect(fromBuffer).toEqual(plain);
    expect(Object.getPrototypeOf(fromBuffer)).toBe(Uint8Array.prototype);
  });
});

describe('countParameters', () => {
  it('counts question marks outside text, names and comments', () => {
    expect(countParameters('SELECT 1')).toBe(0);
    expect(countParameters('SELECT ?, ? FROM t WHERE a = ?')).toBe(3);
    expect(countParameters(`SELECT '?', 'it''s ?', "a?b", [c?d], \`e?\` -- ? here\n, ? /* ? and ; */`)).toBe(1);
    expect(countParameters('SELECT ? ;  \n -- the end')).toBe(1);
    expect(countParameters("SELECT 'never closed ?")).toBe(0);
  });

  it('refuses a second statement and parameters that are not plain', () => {
    expect(() => countParameters('SELECT 1; SELECT 2')).toThrow(TypeError);
    expect(() => countParameters('SELECT ?2')).toThrow(TypeError);
    for (const named of ['SELECT :a', 'SELECT @a', 'SELECT $a'])
      expect(() => countParameters(named)).toThrow(TypeError);
    // A JSON path in text is not a named parameter.
    expect(countParameters(`SELECT json_extract(?, '$.a')`)).toBe(1);
  });
});

describe('probeSqlite', () => {
  it('reports a missing feature instead of throwing', () => {
    const real = DRIVERS[0];
    if (!real) throw new Error('no driver');
    const withoutFullText = {
      ...real,
      open: (path: string, openOptions: SqlOpenOptions) => {
        const db = real.open(path, openOptions);
        return {
          ...db,
          exec: (sql: string) => {
            if (sql.includes('fts5')) throw new Error('no such module: fts5');
            db.exec(sql);
          },
        };
      },
    };
    expect(probeSqlite(withoutFullText)).toMatchObject({ fts5Trigram: false, strictTables: true, ok: false });
  });

  it('reports a binding that cannot open a database as a store error', () => {
    const real = DRIVERS[0];
    if (!real) throw new Error('no driver');
    const broken = {
      ...real,
      open: () => {
        throw new Error('the native module is missing');
      },
    };
    let thrown: unknown;
    try {
      probeSqlite(broken);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'STORE_FAILED', message: `SQLite cannot be used through ${real.name}.` });
  });
});
