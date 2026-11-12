/*
 * A second process for the store tests. It opens the workspace database,
 * starts a write transaction, inserts one source, reports "locked", and
 * keeps the transaction open until the release file appears. Then it
 * commits and exits.
 *
 *   node hold-write-lock.ts <database> <driver> <release file>
 */
import { existsSync } from 'node:fs';
import { loadBetterSqlite3Driver } from '../../src/store/better-sqlite3.ts';
import { nodeSqliteDriver } from '../../src/store/node-sqlite.ts';
import { openStore } from '../../src/store/open.ts';

const [path, driverName, releaseFile] = process.argv.slice(2);
if (path === undefined || releaseFile === undefined) throw new Error('usage: <database> <driver> <release file>');

const driver = driverName === 'better-sqlite3' ? await loadBetterSqlite3Driver() : nodeSqliteDriver;
const store = openStore({ path, driver });
const pause = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 30_000;

store.write(() => {
  store.run("INSERT INTO source (name, kind, created_at) VALUES ('second', 'git', '2026-01-02T00:00:00Z')");
  process.stdout.write('locked\n');
  while (!existsSync(releaseFile)) {
    if (Date.now() > deadline) throw new Error('nobody released the lock');
    Atomics.wait(pause, 0, 0, 20);
  }
});
store.close();
