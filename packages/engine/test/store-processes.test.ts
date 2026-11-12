import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../src/store/open.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const helper = fileURLToPath(new URL('./helpers/hold-write-lock.ts', import.meta.url));

/** Starts the second process and resolves once it holds the write lock. */
function startWriter(path: string, driverName: string, releaseFile: string) {
  const child = spawn(process.execPath, [helper, path, driverName, releaseFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  child.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on('close', resolve));
  const locked = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('locked')) resolve();
    });
    void exited.then((code) => {
      reject(new Error(`the writer exited with code ${String(code)} before it took the lock: ${errors}`));
    });
  });
  return { locked, exited, errors: () => errors };
}

const names = (store: { all: (sql: string) => readonly Record<string, unknown>[] }): unknown[] =>
  store.all('SELECT name FROM source ORDER BY id').map((row) => row['name']);

// Two processes on one workspace: one writes, one reads, and a second writer is told to wait.
describe.each(DRIVERS)('two processes with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);

  it('lets a reader read while another process writes, and stops a second writer with a clear error', async () => {
    const dir = temp.next();
    const path = join(dir, 'orglens.sqlite');
    const releaseFile = join(dir, 'release');

    const setup = openStore({ path, driver });
    setup.write(() =>
      setup.run("INSERT INTO source (name, kind, created_at) VALUES ('first', 'org', '2026-01-01T00:00:00Z')"),
    );
    setup.close();

    const writer = startWriter(path, driver.name, releaseFile);
    try {
      await writer.locked;

      // The reader sees the last committed state, not the half-written one, and is not blocked.
      const reader = openStore({ path, driver, readOnly: true, busyTimeoutMs: 100 });
      expect(names(reader)).toEqual(['first']);

      // A second writer can open the database, and is refused when it starts to write.
      const second = openStore({ path, driver, busyTimeoutMs: 100 });
      expect(codeOf(() => second.write(() => second.run("UPDATE source SET name = 'changed'")))).toBe('STORE_BUSY');
      expect(names(second)).toEqual(['first']);

      writeFileSync(releaseFile, '');
      expect(await writer.exited, writer.errors()).toBe(0);

      // Once the first writer has committed, both see its work and the second writer may write.
      expect(names(reader)).toEqual(['first', 'second']);
      expect(second.write(() => second.run("UPDATE source SET name = 'changed' WHERE name = 'second'").changes)).toBe(
        1,
      );
      expect(names(reader)).toEqual(['first', 'changed']);
      reader.close();
      second.close();
    } finally {
      writeFileSync(releaseFile, '');
      await writer.exited;
    }
  }, 30_000);
});
