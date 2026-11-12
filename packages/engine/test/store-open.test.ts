import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineError } from '../src/core/errors.ts';
import type { SqlDriver } from '../src/store/driver.ts';
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
    expect((thrown as EngineError).message).toContain('Migration 2 ("broken")');
    expect((thrown as EngineError).details).toEqual({ path, migration: 2 });

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
    expect(tables(store)).toEqual(['a', 'b']);
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
        writer.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00Z')"),
      );
      writer.close();

      const reader = openStore({ path, driver, readOnly: true });
      expect(reader.readOnly).toBe(true);
      expect(reader.all('SELECT name, kind FROM source')).toEqual([{ name: 'prod', kind: 'org' }]);
      expect(codeOf(() => reader.write(() => 1))).toBe('INTERNAL');
      expect(() => reader.run("INSERT INTO source (name, kind, created_at) VALUES ('x', 'org', 'now')")).toThrow();
      expect(() => {
        reader.checkpoint();
      }).not.toThrow();
      reader.close();
    });
  });

  describe('write', () => {
    it('keeps everything a transaction wrote, and returns its result', () => {
      const store = openStore({ path: newFile(), driver });
      const id = store.write(
        () => store.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', 'now')").lastInsertRowid,
      );
      expect(store.get('SELECT name FROM source WHERE id = ?', id)).toEqual({ name: 'prod' });
      store.checkpoint();
      store.close();
    });

    it('keeps nothing when the work throws, and passes the error on', () => {
      const store = openStore({ path: newFile(), driver });
      const failure = new Error('stop');
      expect(() =>
        store.write(() => {
          store.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', 'now')");
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

  describe('the first schema', () => {
    const source = "INSERT INTO source (name, kind, created_at) VALUES ('prod', 'org', '2026-01-01T00:00:00Z')";
    const snapshot = (status: string): string =>
      `INSERT INTO snapshot (source_id, status, started_at, engine_version) VALUES (1, '${status}', '2026-01-01T00:00:00Z', '0.0.0')`;

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
      ]);
      const indexes = store
        .all("SELECT name FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map((row) => row['name']);
      expect(indexes).toEqual(['snapshot_by_source', 'snapshot_file_by_blob', 'snapshot_issue_by_snapshot']);
      expect(
        store.all('SELECT name FROM pragma_table_list WHERE schema = ? AND type = ? AND strict = 0', 'main', 'table'),
      ).toEqual([{ name: 'sqlite_schema' }]);
      store.close();
    });

    it('enforces references between tables and the allowed values', () => {
      const store = openStore({ path: newFile(), driver });
      // A snapshot needs its source.
      expect(() => store.run(snapshot('running'))).toThrow();
      store.run(source);
      store.run(snapshot('running'));
      expect(() => store.run(snapshot('finished'))).toThrow();
      expect(() => store.run("INSERT INTO source (name, kind, created_at) VALUES ('prod', 'git', 'now')")).toThrow();
      expect(() =>
        store.run("INSERT INTO source (name, kind, created_at) VALUES ('other', 'database', 'now')"),
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
