import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineError } from '../src/core/errors.ts';
import type { SqlDatabase, SqlDriver } from '../src/store/driver.ts';
import { APPLICATION_ID, MIGRATIONS, type Migration } from '../src/store/migrate.ts';
import { openStore } from '../src/store/open.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const first: Migration = { version: 1, name: 'first', sql: 'CREATE TABLE a (n INTEGER) STRICT;' };
const second: Migration = {
  version: 2,
  name: 'second',
  sql: 'ALTER TABLE a ADD COLUMN t TEXT; CREATE TABLE b (n INTEGER) STRICT;',
};
// The first statement succeeds and the second fails, so a rollback has something to undo.
const broken: Migration = {
  version: 2,
  name: 'broken',
  sql: 'CREATE TABLE b (n INTEGER) STRICT; CREATE TABLE a (oops);',
};

// Rebuilds table "a" the only way SQLite can change a column: a new table, a copy, a drop and a rename.
const rebuild: Migration = {
  version: 2,
  name: 'rebuild',
  sql: `
CREATE TABLE a_new (id INTEGER PRIMARY KEY, label TEXT NOT NULL DEFAULT 'x') STRICT;
INSERT INTO a_new (id) SELECT id FROM a;
DROP TABLE a;
ALTER TABLE a_new RENAME TO a;`,
};
const parentAndChild: Migration = {
  version: 1,
  name: 'parent and child',
  sql: `
CREATE TABLE a (id INTEGER PRIMARY KEY) STRICT;
CREATE TABLE child (id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES a (id) ON DELETE CASCADE) STRICT;`,
};

/** A driver whose connections call `before` ahead of each `exec` and each `prepare`. */
function watching(driver: SqlDriver, before: (sql: string, database: SqlDatabase) => void): SqlDriver {
  return {
    ...driver,
    open: (file, options) => {
      const database = driver.open(file, options);
      return {
        ...database,
        exec: (sql) => {
          before(sql, database);
          database.exec(sql);
        },
        prepare: (sql) => {
          before(sql, database);
          return database.prepare(sql);
        },
      };
    },
  };
}

function thrownBy(run: () => unknown): EngineError {
  try {
    run();
  } catch (error) {
    if (error instanceof EngineError) return error;
    throw error;
  }
  throw new Error('did not throw');
}

/** True where the tests can take the right to write away from themselves. An administrator keeps it. */
const canLoseAccess = process.platform !== 'win32' && process.getuid?.() !== 0;

const fingerprint = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');
const tables = (store: { all: (sql: string) => readonly Record<string, unknown>[] }): unknown[] =>
  store.all("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").map((row) => row['name']);

describe.each(DRIVERS)('openStore with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const newFile = (): string => join(temp.next(), 'orglens.sqlite');

  it('creates a fresh database at the latest schema version, marked as an OrgLens workspace', () => {
    const path = newFile();
    const store = openStore({ path, driver });
    expect(store.migrated).toEqual({ from: 0, to: MIGRATIONS.length });
    expect(store.schemaVersion).toBe(MIGRATIONS.length);
    expect(store.driverName).toBe(driver.name);
    expect(store.get('PRAGMA user_version')).toEqual({ user_version: MIGRATIONS.length });
    expect(store.get('PRAGMA application_id')).toEqual({ application_id: APPLICATION_ID });
    expect(store.get('PRAGMA journal_mode')).toEqual({ journal_mode: 'wal' });
    expect(store.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(store.get('PRAGMA synchronous')).toEqual({ synchronous: 1 });
    store.close();
  });

  it('writes nothing when the database is already current', () => {
    const path = newFile();
    openStore({ path, driver }).close();
    const before = fingerprint(path);

    const store = openStore({ path, driver });
    expect(store.migrated).toEqual({ from: MIGRATIONS.length, to: MIGRATIONS.length });
    store.close();

    expect(fingerprint(path)).toBe(before);
    const wal = `${path}-wal`;
    expect(existsSync(wal) ? readFileSync(wal).byteLength : 0).toBe(0);
  });

  it('applies the migrations a database is missing, one version at a time', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first] }).close();
    const store = openStore({ path, driver, migrations: [first, second] });
    expect(store.migrated).toEqual({ from: 1, to: 2 });
    expect(tables(store)).toEqual(['a', 'b']);
    expect(store.get('PRAGMA user_version')).toEqual({ user_version: 2 });
    store.close();
  });

  it('rolls a failed migration back completely and says which one failed', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first] }).close();

    let thrown: unknown;
    try {
      openStore({ path, driver, migrations: [first, broken] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EngineError);
    expect((thrown as EngineError).code).toBe('STORE_MIGRATION_FAILED');
    expect((thrown as EngineError).message).toBe(
      'Migration 2 ("broken") of the workspace database failed and was rolled back. The database is at schema version 1.',
    );
    expect((thrown as EngineError).hint).toMatch(/^Nothing was lost\./);
    expect((thrown as EngineError).details).toEqual({ path, migration: 2, schemaVersion: 1 });

    const store = openStore({ path, driver, migrations: [first] });
    expect(tables(store)).toEqual(['a']);
    expect(store.get('PRAGMA user_version')).toEqual({ user_version: 1 });
    store.close();
  });

  it('does not repeat a migration that another process finished while this one waited for the lock', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first] }).close();
    let raced = false;
    const racing: SqlDriver = {
      ...driver,
      open: (file, options) => {
        const database = driver.open(file, options);
        return {
          ...database,
          exec: (sql) => {
            if (sql === 'BEGIN IMMEDIATE' && !raced) {
              raced = true;
              openStore({ path, driver, migrations: [first, second] }).close();
            }
            database.exec(sql);
          },
        };
      },
    };
    // Running "second" twice would fail, because its column would already exist.
    const store = openStore({ path, driver: racing, migrations: [first, second] });
    expect(raced).toBe(true);
    expect(store.schemaVersion).toBe(2);
    // This open applied nothing, and says so.
    expect(store.migrated).toEqual({ from: 2, to: 2 });
    expect(tables(store)).toEqual(['a', 'b']);
    store.close();
  });

  it('sees one consistent state when another process migrates a new database at the same moment', () => {
    const path = newFile();
    let tried = false;
    let other: unknown;
    // The other process gets its chance between two of the three values that describe the file.
    const racing = watching(driver, (sql) => {
      if (sql !== 'PRAGMA user_version' || tried) return;
      tried = true;
      try {
        openStore({ path, driver, busyTimeoutMs: 0 }).close();
      } catch (error) {
        other = error;
      }
    });
    const store = openStore({ path, driver: racing });
    expect(tried).toBe(true);
    expect(store.schemaVersion).toBe(MIGRATIONS.length);
    store.close();
    // The other one had to wait, and was told so. It did not get in between.
    expect((other as EngineError).code).toBe('STORE_BUSY');
  });

  it('refuses a database that another process brought to a newer version while this one waited for the lock', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first] }).close();
    let raced = false;
    const racing = watching(driver, (sql) => {
      if (sql !== 'BEGIN IMMEDIATE' || raced) return;
      raced = true;
      const other = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
      other.exec('PRAGMA user_version = 9');
      other.close();
    });
    const error = thrownBy(() => openStore({ path, driver: racing, migrations: [first, second] }));
    expect(error.code).toBe('STORE_NEWER');
    const check = driver.open(path, { readOnly: true, busyTimeoutMs: 50 });
    expect(check.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name = 'b'").get()).toEqual({ n: 0 });
    check.close();
  });

  it('commits the version together with the migration, never one without the other', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first] }).close();
    const failing = watching(driver, (sql) => {
      if (sql === 'PRAGMA user_version = 2') throw new Error('the power went out');
    });
    expect(thrownBy(() => openStore({ path, driver: failing, migrations: [first, second] })).code).toBe(
      'STORE_MIGRATION_FAILED',
    );
    const store = openStore({ path, driver, migrations: [first] });
    expect(tables(store)).toEqual(['a']);
    expect(store.get('PRAGMA user_version')).toEqual({ user_version: 1 });
    store.close();
  });

  it('says where the database stands when a later migration fails', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first] }).close();
    const third = { ...broken, version: 3 };
    const error = thrownBy(() => openStore({ path, driver, migrations: [first, second, third] }));
    expect(error.message).toContain('Migration 3 ("broken")');
    expect(error.message).toContain('The database is at schema version 2.');
    const store = openStore({ path, driver, migrations: [first, second] });
    expect(store.migrated).toEqual({ from: 2, to: 2 });
    store.close();
  });

  it('keeps the rows that refer to a table when a migration rebuilds that table', () => {
    const path = newFile();
    const before = openStore({ path, driver, migrations: [parentAndChild] });
    before.write(() => {
      before.run('INSERT INTO a (id) VALUES (1)');
      before.run('INSERT INTO child (a_id) VALUES (1)');
      before.run('INSERT INTO child (a_id) VALUES (1)');
    });
    before.close();

    const store = openStore({ path, driver, migrations: [parentAndChild, rebuild] });
    expect(store.migrated).toEqual({ from: 1, to: 2 });
    expect(store.get('SELECT count(*) AS n FROM child')).toEqual({ n: 2 });
    expect(store.get('SELECT label FROM a')).toEqual({ label: 'x' });
    // References are enforced again once the migrations are done.
    expect(store.get('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(thrownBy(() => store.run('INSERT INTO child (a_id) VALUES (99)')).code).toBe('STORE_FAILED');
    store.write(() => store.run('DELETE FROM a'));
    expect(store.get('SELECT count(*) AS n FROM child')).toEqual({ n: 0 });
    store.close();
  });

  it('rolls back a migration that leaves a row without the row it refers to', () => {
    const path = newFile();
    const before = openStore({ path, driver, migrations: [parentAndChild] });
    before.write(() => {
      before.run('INSERT INTO a (id) VALUES (1)');
      before.run('INSERT INTO child (a_id) VALUES (1)');
    });
    before.close();
    const orphaning: Migration = { version: 2, name: 'orphaning', sql: 'DELETE FROM a;' };
    const error = thrownBy(() => openStore({ path, driver, migrations: [parentAndChild, orphaning] }));
    expect(error.code).toBe('STORE_MIGRATION_FAILED');
    const store = openStore({ path, driver, migrations: [parentAndChild] });
    expect(store.get('SELECT count(*) AS n FROM a')).toEqual({ n: 1 });
    store.close();
  });

  it('reports a migration that cannot start because another process is writing', () => {
    const path = newFile();
    const holder = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
    holder.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;');
    expect(codeOf(() => openStore({ path, driver, busyTimeoutMs: 50 }))).toBe('STORE_BUSY');
    holder.exec('ROLLBACK');
    holder.close();
    openStore({ path, driver }).close();
  });

  it('tries again when SQLite says "busy" without waiting, until the timeout has passed', () => {
    const path = newFile();
    openStore({ path, driver }).close();
    const busyAtOnce = (): SqlDriver => {
      let failed = false;
      return watching(driver, (sql) => {
        if (sql !== 'BEGIN' || failed) return;
        failed = true;
        // What each binding reports while another connection tidies up as it closes.
        throw Object.assign(new Error('database is locked'), { errcode: 5, code: 'SQLITE_BUSY' });
      });
    };
    const store = openStore({ path, driver: busyAtOnce(), busyTimeoutMs: 1000 });
    expect(store.schemaVersion).toBe(MIGRATIONS.length);
    store.close();
    expect(codeOf(() => openStore({ path, driver: busyAtOnce(), busyTimeoutMs: 0 }))).toBe('STORE_BUSY');
  });

  it('reports a new database that another process is just creating as busy, not as broken', () => {
    const path = newFile();
    // The other process has not switched to write-ahead logging yet, so its lock also stops this open from doing so.
    const holder = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
    holder.exec('BEGIN IMMEDIATE; CREATE TABLE early (n INTEGER); ');
    const error = thrownBy(() => openStore({ path, driver, busyTimeoutMs: 50 }));
    expect(error.code).toBe('STORE_BUSY');
    expect(error.hint).toBe('Wait for it to finish, then try again.');
    holder.exec('ROLLBACK');
    holder.close();
    openStore({ path, driver }).close();
  });

  it('refuses a database written by a newer version, before changing anything', () => {
    const path = newFile();
    openStore({ path, driver, migrations: [first, second] }).close();
    const before = fingerprint(path);

    let thrown: unknown;
    try {
      openStore({ path, driver, migrations: [first] });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as EngineError).code).toBe('STORE_NEWER');
    expect((thrown as EngineError).details).toEqual({ path, found: 2, supported: 1 });
    expect(codeOf(() => openStore({ path, driver, migrations: [first], readOnly: true }))).toBe('STORE_NEWER');
    expect(fingerprint(path)).toBe(before);
  });

  /**
   * Leaves a database the way a program that was killed leaves it: with
   * changes that are only in the write-ahead log. Returns the copy.
   */
  function abandoned(prepare: (database: SqlDatabase) => void): string {
    const original = newFile();
    const database = driver.open(original, { readOnly: false, busyTimeoutMs: 50 });
    database.exec('PRAGMA journal_mode = WAL');
    prepare(database);
    const copy = newFile();
    copyFileSync(original, copy);
    copyFileSync(`${original}-wal`, `${copy}-wal`);
    database.close();
    expect(statSync(`${copy}-wal`).size).toBeGreaterThan(0);
    return copy;
  }

  it('does not change the file of a refused database, even when a program left it without closing it', () => {
    const foreignCopy = abandoned((database) => {
      database.exec('CREATE TABLE somebody_elses (n INTEGER); INSERT INTO somebody_elses VALUES (1);');
    });
    const newerCopy = abandoned((database) => {
      database.exec(`${first.sql} PRAGMA application_id = ${String(APPLICATION_ID)}; PRAGMA user_version = 99;`);
    });
    for (const [copy, code] of [
      [foreignCopy, 'STORE_FOREIGN'],
      [newerCopy, 'STORE_NEWER'],
    ] as const) {
      const before = fingerprint(copy);
      const log = fingerprint(`${copy}-wal`);
      expect(
        codeOf(() => openStore({ path: copy, driver, migrations: [first] })),
        code,
      ).toBe(code);
      expect(
        codeOf(() => openStore({ path: copy, driver, migrations: [first], readOnly: true })),
        code,
      ).toBe(code);
      // A connection that can write would have moved the log into the file when it closed.
      expect(fingerprint(copy), code).toBe(before);
      expect(fingerprint(`${copy}-wal`), code).toBe(log);
    }
  });

  it('refuses an empty database that carries the mark or the version of something else', () => {
    for (const pragma of ['application_id = 123', 'user_version = 5']) {
      const path = newFile();
      const other = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
      other.exec(`PRAGMA ${pragma}`);
      other.close();
      expect(
        codeOf(() => openStore({ path, driver })),
        pragma,
      ).toBe('STORE_FOREIGN');
    }
  });

  it('refuses a database that OrgLens did not create, before changing anything', () => {
    const path = newFile();
    const other = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
    other.exec('CREATE TABLE somebody_elses (n INTEGER); INSERT INTO somebody_elses VALUES (1);');
    other.close();
    const before = fingerprint(path);

    expect(codeOf(() => openStore({ path, driver }))).toBe('STORE_FOREIGN');
    expect(codeOf(() => openStore({ path, driver, readOnly: true }))).toBe('STORE_FOREIGN');
    expect(fingerprint(path)).toBe(before);
  });

  it('refuses a file that is not a database, and leaves it alone', () => {
    const path = newFile();
    const text = 'These are my notes, not a database. '.repeat(40);
    writeFileSync(path, text);
    expect(codeOf(() => openStore({ path, driver }))).toBe('STORE_FOREIGN');
    expect(readFileSync(path, 'utf8')).toBe(text);
  });

  it.each([1, 100, 511])('refuses a file of %i bytes, which SQLite would take for an empty database', (size) => {
    const path = newFile();
    const text = 'x'.repeat(size);
    writeFileSync(path, text);
    expect(codeOf(() => openStore({ path, driver }))).toBe('STORE_FOREIGN');
    expect(codeOf(() => openStore({ path, driver, readOnly: true }))).toBe('STORE_FOREIGN');
    expect(readFileSync(path, 'utf8')).toBe(text);
  });

  it('takes an empty file for a database that is yet to be created', () => {
    const path = newFile();
    writeFileSync(path, '');
    expect(codeOf(() => openStore({ path, driver, readOnly: true }))).toBe('STORE_NOT_FOUND');
    const store = openStore({ path, driver });
    expect(store.migrated).toEqual({ from: 0, to: MIGRATIONS.length });
    store.close();
  });

  it('refuses a place where write-ahead logging cannot be used', () => {
    const error = thrownBy(() => openStore({ path: ':memory:', driver }));
    expect(error.code).toBe('STORE_FAILED');
    expect(error.message).toBe('SQLite cannot use write-ahead logging for this database.');
    expect(error.details).toEqual({ path: ':memory:', journalMode: 'memory' });
  });

  it('accepts a busy timeout with a fraction, and refuses one that is no time span', () => {
    openStore({ path: newFile(), driver, busyTimeoutMs: 50.5 }).close();
    for (const wrong of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        codeOf(() => openStore({ path: newFile(), driver, busyTimeoutMs: wrong })),
        String(wrong),
      ).toBe('INTERNAL');
    }
  });

  it.skipIf(!canLoseAccess)('says so at once when the database file cannot be written', () => {
    const path = newFile();
    openStore({ path, driver }).close();
    chmodSync(path, 0o444);
    try {
      const error = thrownBy(() => openStore({ path, driver }));
      expect(error.code).toBe('STORE_FAILED');
      expect(error.message).toBe('The workspace database, or the folder it is in, cannot be written.');
      expect(error.hint).toMatch(/^Check that you may write/);
      // Reading needs no right to write to the file.
      openStore({ path, driver, readOnly: true }).close();
    } finally {
      chmodSync(path, 0o644);
    }
  });

  // Which error SQLite gives for such a folder was only looked at on Linux.
  it.skipIf(!canLoseAccess || process.platform !== 'linux')(
    'explains a folder it cannot write to, which SQLite needs even to read',
    () => {
      const path = newFile();
      openStore({ path, driver }).close();
      const folder = join(path, '..');
      chmodSync(folder, 0o555);
      try {
        const error = thrownBy(() => openStore({ path, driver, readOnly: true }));
        expect(error.code).toBe('STORE_FAILED');
        expect(error.hint).toMatch(/SQLite creates files next to the database, also when it only reads\.$/);
      } finally {
        chmodSync(folder, 0o755);
      }
    },
  );

  it('fails clearly when the file cannot be opened at all', () => {
    const path = join(temp.next(), 'no-such-folder', 'orglens.sqlite');
    expect(codeOf(() => openStore({ path, driver }))).toBe('STORE_FAILED');
  });

  describe('read-only', () => {
    it('reports a workspace that has no database yet, and creates nothing', () => {
      const path = newFile();
      expect(codeOf(() => openStore({ path, driver, readOnly: true }))).toBe('STORE_NOT_FOUND');
      expect(existsSync(path)).toBe(false);
    });

    it('refuses a database that still needs a migration, and does not migrate it', () => {
      const path = newFile();
      openStore({ path, driver, migrations: [first] }).close();
      const before = fingerprint(path);
      expect(codeOf(() => openStore({ path, driver, migrations: [first, second], readOnly: true }))).toBe(
        'STORE_OUTDATED',
      );
      expect(fingerprint(path)).toBe(before);
    });

    it('reads, and refuses to write', () => {
      const path = newFile();
      const writer = openStore({ path, driver });
      writer.write(() =>
        writer.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')"),
      );
      writer.close();

      const reader = openStore({ path, driver, readOnly: true });
      expect(reader.readOnly).toBe(true);
      expect(reader.all('SELECT name, kind FROM source')).toEqual([{ name: 'prod', kind: 'org' }]);
      expect(codeOf(() => reader.write(() => 1))).toBe('INTERNAL');
      const refused = thrownBy(() =>
        reader.run("INSERT INTO source (name, kind, created_at) VALUES ('x', 'org', '2026-01-01T00:00:00.000Z')"),
      );
      expect(refused.code).toBe('STORE_FAILED');
      expect(refused.hint).toMatch(/^Check that you may write/);
      expect(reader.checkpoint()).toBe(false);
      reader.close();
    });
  });

  describe('write', () => {
    it('keeps everything a transaction wrote, and returns its result', () => {
      const store = openStore({ path: newFile(), driver });
      const id = store.write(
        () =>
          store.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')")
            .lastInsertRowid,
      );
      expect(store.get('SELECT name FROM source WHERE id = ?', id)).toEqual({ name: 'prod' });
      store.close();
    });

    it('moves the write-ahead log into the database file on a checkpoint', () => {
      const path = newFile();
      const store = openStore({ path, driver });
      store.write(() =>
        store.run(`INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')`),
      );
      expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
      expect(store.checkpoint()).toBe(true);
      expect(statSync(`${path}-wal`).size).toBe(0);
      expect(codeOf(() => store.write(() => store.checkpoint()))).toBe('INTERNAL');
      store.close();
    });

    it('does not wait with a checkpoint for a connection that still reads the log', () => {
      const path = newFile();
      const store = openStore({ path, driver, busyTimeoutMs: 5000 });
      store.write(() =>
        store.run(`INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')`),
      );
      // Another connection in the middle of reading: it holds on to the log as it is now.
      const reader = driver.open(path, { readOnly: true, busyTimeoutMs: 0 });
      reader.exec('BEGIN');
      reader.prepare('SELECT COUNT(*) AS n FROM source').get();
      store.write(() =>
        store.run(`INSERT INTO source (name, kind, created_at) VALUES ('uat', 'org', '2026-01-01T00:00:00.000Z')`),
      );

      const started = Date.now();
      expect(store.checkpoint()).toBe(false);
      expect(Date.now() - started).toBeLessThan(2000);
      // The store waits for other connections as before: the timeout it was opened with is back.
      expect(store.get('PRAGMA busy_timeout')).toEqual({ timeout: 5000 });

      reader.exec('COMMIT');
      reader.close();
      expect(store.checkpoint()).toBe(true);
      expect(statSync(`${path}-wal`).size).toBe(0);
      store.close();
    });

    it('refuses an asynchronous function, and keeps nothing it wrote', () => {
      const store = openStore({ path: newFile(), driver });
      const error = thrownBy(() =>
        store.write(async () => {
          store.run(`INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')`);
          await Promise.resolve();
        }),
      );
      expect(error.code).toBe('INTERNAL');
      expect(error.message).toContain('asynchronous');
      expect(store.get('SELECT count(*) AS n FROM source')).toEqual({ n: 0 });
      expect(store.write(() => 3)).toBe(3);
      store.close();
    });

    it('reports a statement that waits for another writer as busy, and any other failure with what SQLite said', () => {
      const path = newFile();
      const store = openStore({ path, driver, busyTimeoutMs: 50 });
      const holder = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
      holder.exec('BEGIN IMMEDIATE');
      const insert = `INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')`;
      expect(thrownBy(() => store.run(insert)).code).toBe('STORE_BUSY');
      holder.exec('ROLLBACK');
      holder.close();

      store.run(insert);
      const duplicate = thrownBy(() => store.run(insert));
      expect(duplicate.code).toBe('STORE_FAILED');
      expect(duplicate.message).toBe(
        'A statement on the workspace database failed. SQLite says: UNIQUE constraint failed: source.name',
      );
      expect(duplicate.details).toEqual({ path, reason: 'UNIQUE constraint failed: source.name' });
      expect(thrownBy(() => store.get('SELECT * FROM nowhere')).code).toBe('STORE_FAILED');
      expect(thrownBy(() => store.all('SELECT ?')).code).toBe('STORE_FAILED');
      store.close();
    });

    it('prepares a statement once, and keeps only the most recent ones prepared', () => {
      const seen = new Map<string, number>();
      const counting = watching(driver, (sql) => seen.set(sql, (seen.get(sql) ?? 0) + 1));
      const store = openStore({ path: newFile(), driver: counting });
      const often = 'SELECT ? + 1 AS next';
      for (let n = 0; n < 500; n += 1) expect(store.get(often, n)).toEqual({ next: n + 1 });
      expect(seen.get(often)).toBe(1);
      // A statement that many others have pushed out is prepared again when it comes back.
      for (let n = 0; n < 100; n += 1) expect(store.get(`SELECT ${String(n)} + ? AS sum`, 1)).toEqual({ sum: n + 1 });
      expect(store.get(often, 1)).toEqual({ next: 2 });
      expect(seen.get(often)).toBe(2);
      expect(store.get('SELECT 99 + ? AS sum', 1)).toEqual({ sum: 100 });
      expect(seen.get('SELECT 99 + ? AS sum')).toBe(1);
      store.close();
    });

    it('keeps nothing when the work throws, and passes the error on', () => {
      const store = openStore({ path: newFile(), driver });
      const failure = new Error('stop');
      expect(() =>
        store.write(() => {
          store.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')");
          throw failure;
        }),
      ).toThrow(failure);
      expect(store.get('SELECT count(*) AS n FROM source')).toEqual({ n: 0 });
      // The store is usable again afterwards.
      expect(store.write(() => 5)).toBe(5);
      store.close();
    });

    it('refuses a transaction inside another one', () => {
      const store = openStore({ path: newFile(), driver });
      expect(codeOf(() => store.write(() => store.write(() => 1)))).toBe('INTERNAL');
      expect(store.write(() => 2)).toBe(2);
      store.close();
    });

    it('tells a second writer that another snapshot is running', () => {
      const path = newFile();
      const holder = driver.open(path, { readOnly: false, busyTimeoutMs: 50 });
      const store = openStore({ path, driver, busyTimeoutMs: 50 });
      holder.exec('BEGIN IMMEDIATE');
      let thrown: unknown;
      try {
        store.write(() => 1);
      } catch (error) {
        thrown = error;
      }
      expect((thrown as EngineError).code).toBe('STORE_BUSY');
      expect((thrown as EngineError).message).toBe('Another snapshot is running in this workspace.');
      holder.exec('COMMIT');
      expect(store.write(() => 1)).toBe(1);
      holder.close();
      store.close();
    });
  });

  it('rejects a list of migrations whose versions do not count up from 1', () => {
    const misnumbered = [first, { ...second, version: 3 }];
    expect(codeOf(() => openStore({ path: newFile(), driver, migrations: misnumbered }))).toBe('INTERNAL');
  });

  describe('the schema', () => {
    const source = "INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00.000Z')";
    const snapshot = (status: string): string =>
      `INSERT INTO snapshot (source_id, status, started_at, engine_version) VALUES (1, '${status}', '2026-01-01T00:00:00.000Z', '0.0.0')`;

    it('has exactly these tables and indexes, all of them STRICT', () => {
      const store = openStore({ path: newFile(), driver });
      expect(tables(store)).toEqual([
        'blob',
        'inventory_item',
        'retrieve_chunk',
        'snapshot',
        'snapshot_file',
        'snapshot_issue',
        'snapshot_type_coverage',
        'source',
        // Kept by SQLite for the tables whose ids are never used twice.
        'sqlite_sequence',
      ]);
      const indexes = store
        .all("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map((row) => row['name']);
      expect(indexes).toEqual([
        'snapshot_by_source',
        'snapshot_file_by_blob',
        'snapshot_issue_by_snapshot',
        'snapshot_one_running',
      ]);
      expect(
        store.all('SELECT name FROM pragma_table_list WHERE schema = ? AND type = ? AND strict = 0', 'main', 'table'),
      ).toEqual([{ name: 'sqlite_schema' }, { name: 'sqlite_sequence' }]);
      store.close();
    });

    // The schema as SQLite holds it, in a golden file. A released migration is never edited, so this file
    // changes only together with a new migration. A column that a migration adds stands on the line of the
    // column before it: that is how SQLite writes it down.
    it('is exactly the schema in the golden file', async () => {
      const store = openStore({ path: newFile(), driver });
      const schema = store
        .all("SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
        .map((row) => `${String(row['sql'])};\n`)
        .join('\n');
      store.close();
      await expect(schema).toMatchFileSnapshot('./golden/schema.sql');
    });

    it('brings a database of the first version to the second, with what it holds', () => {
      const path = newFile();
      const old = openStore({ path, driver, migrations: MIGRATIONS.slice(0, 1) });
      old.run(source);
      old.run(snapshot('complete'));
      old.run("INSERT INTO inventory_item (snapshot_id, type, full_name) VALUES (1, 'ApexClass', 'A')");
      old.run("INSERT INTO retrieve_chunk (snapshot_id, seq, status, members) VALUES (1, 0, 'done', '[]')");
      old.run(
        "INSERT INTO snapshot_type_coverage (snapshot_id, type, listed, retrieved) VALUES (1, 'ApexClass', 1, 1)",
      );
      old.close();

      const store = openStore({ path, driver });
      expect(store.migrated).toEqual({ from: 1, to: 2 });
      // What an older version stored reads as what it was: listed, not known to be retrieved, listing in order.
      expect(store.get('SELECT listed, retrieved FROM inventory_item')).toEqual({ listed: 1, retrieved: 0 });
      expect(store.get('SELECT job_id, status FROM retrieve_chunk')).toEqual({ job_id: null, status: 'done' });
      expect(store.get('SELECT listing, listed FROM snapshot_type_coverage')).toEqual({ listing: 'ok', listed: 1 });
      store.close();
    });

    it('allows one snapshot of a source to be under way, and no second one', () => {
      const store = openStore({ path: newFile(), driver });
      store.run(source);
      store.run(snapshot('running'));
      expect(codeOf(() => store.run(snapshot('running')))).toBe('STORE_FAILED');
      store.run(snapshot('complete'));
      store.run(snapshot('failed'));
      store.run("UPDATE snapshot SET status = 'partial' WHERE id = 1");
      store.run(snapshot('running'));
      store.close();
    });

    it('never uses the id of a source or a snapshot twice', () => {
      const store = openStore({ path: newFile(), driver });
      store.run(source);
      store.run(snapshot('complete'));
      expect(store.run(snapshot('complete')).lastInsertRowid).toBe(2);
      store.run('DELETE FROM snapshot WHERE id = 2');
      expect(store.run(snapshot('complete')).lastInsertRowid).toBe(3);
      store.run('DELETE FROM snapshot');
      store.run('DELETE FROM source');
      expect(store.run(source).lastInsertRowid).toBe(2);
      store.close();
    });

    it('accepts a time only in the one form that sorts as text', () => {
      const store = openStore({ path: newFile(), driver });
      const insert = 'INSERT INTO source (name, kind, created_at) VALUES (?, ?, ?)';
      store.run(insert, 'good', 'org', new Date(0).toISOString());
      for (const wrong of ['now', '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000+01:00', '']) {
        expect(
          codeOf(() => store.run(insert, 'bad', 'org', wrong)),
          wrong,
        ).toBe('STORE_FAILED');
      }
      store.run(source);
      const finished =
        'INSERT INTO snapshot (source_id, status, started_at, finished_at, engine_version) VALUES (2, ?, ?, ?, ?)';
      store.run(finished, 'complete', '2026-01-01T00:00:00.000Z', null, '0.0.0');
      store.run(finished, 'complete', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '0.0.0');
      expect(codeOf(() => store.run(finished, 'complete', '2026-01-01T00:00:00.000Z', 'later', '0.0.0'))).toBe(
        'STORE_FAILED',
      );
      expect(codeOf(() => store.run(finished, 'complete', 'earlier', null, '0.0.0'))).toBe('STORE_FAILED');
      store.close();
    });

    it('enforces references between tables and the allowed values', () => {
      const store = openStore({ path: newFile(), driver });
      // A snapshot needs its source.
      expect(() => store.run(snapshot('running'))).toThrow();
      store.run(source);
      store.run(snapshot('running'));
      expect(() => store.run(snapshot('finished'))).toThrow();
      expect(() =>
        store.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'git', '2026-01-01T00:00:00.000Z')"),
      ).toThrow();
      expect(() =>
        store.run(
          "INSERT INTO source (name, kind, created_at) VALUES ('other', 'database', '2026-01-01T00:00:00.000Z')",
        ),
      ).toThrow();
      expect(() =>
        store.run(
          "INSERT INTO retrieve_chunk (snapshot_id, seq, status, members) VALUES (1, 1, 'pending', 'not json')",
        ),
      ).toThrow();
      expect(() =>
        store.run(
          'INSERT INTO blob (sha256, encoding, raw_size, body) VALUES (?, 0, 1, ?)',
          new Uint8Array(4),
          new Uint8Array(1),
        ),
      ).toThrow();
      store.close();
    });

    it('refuses every value a column must not hold', () => {
      const store = openStore({ path: newFile(), driver });
      store.run(source);
      store.run(snapshot('complete'));
      const blob = 'INSERT INTO blob (sha256, encoding, raw_size, body) VALUES (?, ?, ?, ?)';
      const hash = (seed: number): Uint8Array => new Uint8Array(32).fill(seed);
      store.run(blob, hash(1), 0, 2, new Uint8Array(2));
      store.run(blob, hash(2), 1, 500, new Uint8Array(2));
      const chunk = 'INSERT INTO retrieve_chunk (snapshot_id, seq, status, members, attempts) VALUES (1, ?, ?, ?, ?)';
      store.run(chunk, 0, 'pending', '["ApexClass:A"]', 0);
      const coverage =
        'INSERT INTO snapshot_type_coverage (snapshot_id, type, listed, retrieved, analysed) VALUES (1, ?, ?, ?, ?)';
      store.run(coverage, 'ApexClass', 1, 1, 0);
      const issue = 'INSERT INTO snapshot_issue (snapshot_id, severity, code, message, details) VALUES (1, ?, ?, ?, ?)';
      store.run(issue, 'info', 'X', 'm', null);
      store.run(issue, 'error', 'X', 'm', '{"a":1}');
      store.run("INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (1, 'a.cls', 1)");
      store.run("INSERT INTO inventory_item (snapshot_id, type, full_name) VALUES (1, 'ApexClass', 'A')");

      const refused: readonly (readonly [string, () => unknown])[] = [
        ['a second blob with the same hash', () => store.run(blob, hash(1), 0, 2, new Uint8Array(2))],
        ['an unknown encoding', () => store.run(blob, hash(3), 2, 2, new Uint8Array(2))],
        ['a negative size', () => store.run(blob, hash(3), 1, -1, new Uint8Array(2))],
        ['a size that is not the size of an unpacked body', () => store.run(blob, hash(3), 0, 3, new Uint8Array(2))],
        [
          'a file without a blob',
          () => store.run("INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (1, 'b.cls', 99)"),
        ],
        [
          'a file without a path',
          () => store.run("INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (1, '', 1)"),
        ],
        [
          'the same file twice',
          () => store.run("INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (1, 'a.cls', 2)"),
        ],
        [
          'the same inventory item twice',
          () => store.run("INSERT INTO inventory_item (snapshot_id, type, full_name) VALUES (1, 'ApexClass', 'A')"),
        ],
        [
          'an inventory item without a name',
          () => store.run("INSERT INTO inventory_item (snapshot_id, type, full_name) VALUES (1, 'ApexClass', '')"),
        ],
        ['a chunk with an unknown status', () => store.run(chunk, 1, 'waiting', '[]', 0)],
        ['a chunk whose members are no array', () => store.run(chunk, 1, 'pending', '5', 0)],
        ['a chunk with a negative number', () => store.run(chunk, -1, 'pending', '[]', 0)],
        ['a chunk with negative attempts', () => store.run(chunk, 1, 'pending', '[]', -1)],
        ['a negative count', () => store.run(coverage, 'Flow', 0, -1, 0)],
        ['an unknown severity', () => store.run(issue, 'fatal', 'X', 'm', null)],
        ['details that are no JSON', () => store.run(issue, 'info', 'X', 'm', '{')],
        ['details that are no object', () => store.run(issue, 'info', 'X', 'm', '[1]')],
        [
          'a source without a name',
          () => store.run("INSERT INTO source (name, kind, created_at) VALUES ('', 'org', '2026-01-01T00:00:00.000Z')"),
        ],
      ];
      for (const [what, attempt] of refused) expect(codeOf(attempt), what).toBe('STORE_FAILED');
      store.close();
    });

    it('removes everything that belongs to a snapshot with the snapshot, and keeps shared content', () => {
      const store = openStore({ path: newFile(), driver });
      store.write(() => {
        store.run(source);
        store.run(snapshot('complete'));
        store.run(
          'INSERT INTO blob (sha256, encoding, raw_size, body) VALUES (?, 0, 1, ?)',
          new Uint8Array(32),
          new Uint8Array(1),
        );
        store.run("INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (1, 'classes/A.cls', 1)");
        store.run("INSERT INTO inventory_item (snapshot_id, type, full_name) VALUES (1, 'ApexClass', 'A')");
        store.run("INSERT INTO retrieve_chunk (snapshot_id, seq, status, members) VALUES (1, 1, 'done', '[]')");
        store.run("INSERT INTO snapshot_type_coverage (snapshot_id, type, listed) VALUES (1, 'ApexClass', 1)");
        store.run("INSERT INTO snapshot_issue (snapshot_id, severity, code, message) VALUES (1, 'warning', 'X', 'm')");
      });
      store.write(() => store.run('DELETE FROM snapshot WHERE id = 1'));
      for (const table of [
        'snapshot_file',
        'inventory_item',
        'retrieve_chunk',
        'snapshot_type_coverage',
        'snapshot_issue',
      ]) {
        expect(store.get(`SELECT count(*) AS n FROM ${table}`), table).toEqual({ n: 0 });
      }
      expect(store.get('SELECT count(*) AS n FROM blob')).toEqual({ n: 1 });
      store.close();
    });
  });
});
