import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBetterSqlite3Driver } from '../../src/store/better-sqlite3.ts';
import type { SqlDriver } from '../../src/store/driver.ts';
import { nodeSqliteDriver } from '../../src/store/node-sqlite.ts';

/** Both drivers. Every store test runs against each of them. */
export const DRIVERS: readonly SqlDriver[] = [nodeSqliteDriver, await loadBetterSqlite3Driver()];

/** Temporary folders for database files, removed by `cleanUp`. */
export function tempDirs(): { next: () => string; cleanUp: () => void } {
  const dirs: string[] = [];
  return {
    next: () => {
      const dir = mkdtempSync(join(tmpdir(), 'orglens-store-'));
      dirs.push(dir);
      return dir;
    },
    cleanUp: () => {
      // On Windows a database file can stay locked for a moment after it is closed.
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

/** The engine error code thrown by `run`, or a marker if it did not throw one. */
export function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? `not an engine error: ${String(error)}`;
  }
  return 'did not throw';
}

/**
 * True if taking the permissions of a file away keeps this process from reading it. It does not on Windows, and
 * not for the administrator, who reads every file.
 */
export const canLoseAccess = ((): boolean => {
  const dir = mkdtempSync(join(tmpdir(), 'orglens-access-'));
  try {
    const file = join(dir, 'probe');
    writeFileSync(file, 'x');
    chmodSync(file, 0o000);
    readFileSync(file);
    return false;
  } catch {
    return true;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
