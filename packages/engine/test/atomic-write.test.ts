import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RENAME_PAUSES_MS, writeFileAtomically, type AtomicWriteSystem } from '../src/api/atomic-write.ts';
import { tempDirs } from './helpers/store.ts';

const dirs = tempDirs();
afterEach(dirs.cleanUp);

const refusal = (code: string): Error => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

/**
 * A system whose move fails the first `failures` times with `code`, as Windows does while a file is open
 * elsewhere, and then moves the file. It notes every try and every pause.
 */
function refusing(
  platform: string,
  code: string,
  failures: number,
): { system: AtomicWriteSystem; tries: () => number; pauses: number[] } {
  let tries = 0;
  const pauses: number[] = [];
  return {
    system: {
      platform,
      rename: (from, to) => {
        tries += 1;
        if (tries <= failures) throw refusal(code);
        renameSync(from, to);
      },
      pause: (milliseconds) => pauses.push(milliseconds),
    },
    tries: () => tries,
    pauses,
  };
}

function fileIn(dir: string): string {
  const file = join(dir, 'orglens.toml');
  writeFileSync(file, 'old\n');
  return file;
}

describe('writing a file in one step', () => {
  it('replaces the file and leaves nothing beside it', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    writeFileAtomically(file, 'new\n');
    expect(readFileSync(file, 'utf8')).toBe('new\n');
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'tries the move again on Windows when the file is open elsewhere (%s)',
    (code) => {
      const dir = dirs.next();
      const file = fileIn(dir);
      const windows = refusing('win32', code, 3);
      writeFileAtomically(file, 'new\n', windows.system);
      expect(readFileSync(file, 'utf8')).toBe('new\n');
      expect(windows.tries()).toBe(4);
      expect(windows.pauses).toEqual(RENAME_PAUSES_MS.slice(0, 3));
      expect(readdirSync(dir)).toEqual(['orglens.toml']);
    },
  );

  it('still replaces the file at the last try', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', 'EPERM', RENAME_PAUSES_MS.length);
    writeFileAtomically(file, 'new\n', windows.system);
    expect(readFileSync(file, 'utf8')).toBe('new\n');
    expect(windows.pauses).toEqual(RENAME_PAUSES_MS);
  });

  it('gives up after eight tries, keeps the old file and removes the new one', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', 'EPERM', Number.POSITIVE_INFINITY);
    expect(() => {
      writeFileAtomically(file, 'new\n', windows.system);
    }).toThrow(expect.objectContaining({ code: 'EPERM' }) as Error);
    expect(windows.tries()).toBe(RENAME_PAUSES_MS.length + 1);
    expect(windows.tries()).toBe(8);
    expect(windows.pauses).toEqual(RENAME_PAUSES_MS);
    expect(RENAME_PAUSES_MS.reduce((sum, one) => sum + one, 0)).toBeLessThan(2000);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });

  it('does not wait on another system, where the same code means that the folder may not be written', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const linux = refusing('linux', 'EPERM', 1);
    expect(() => {
      writeFileAtomically(file, 'new\n', linux.system);
    }).toThrow(expect.objectContaining({ code: 'EPERM' }) as Error);
    expect(linux.tries()).toBe(1);
    expect(linux.pauses).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });

  it('does not wait on Windows for a failure of another kind', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', 'ENOSPC', 1);
    expect(() => {
      writeFileAtomically(file, 'new\n', windows.system);
    }).toThrow(expect.objectContaining({ code: 'ENOSPC' }) as Error);
    expect(windows.tries()).toBe(1);
    expect(windows.pauses).toEqual([]);
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });
});
