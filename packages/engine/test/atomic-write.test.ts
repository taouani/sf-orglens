import { closeSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUSY_PAUSES_MS,
  pause,
  whileBusyOnWindows,
  writeFileAtomically,
  type AtomicWriteSystem,
} from '../src/api/atomic-write.ts';
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

  it.each(['EPERM', 'EBUSY'])('tries the move again on Windows when it is refused with %s', (code) => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', code, 3);
    writeFileAtomically(file, 'new\n', windows.system);
    expect(readFileSync(file, 'utf8')).toBe('new\n');
    expect(windows.tries()).toBe(4);
    expect(windows.pauses).toEqual(BUSY_PAUSES_MS.slice(0, 3));
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });

  it('still replaces the file at the last try', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', 'EPERM', BUSY_PAUSES_MS.length);
    writeFileAtomically(file, 'new\n', windows.system);
    expect(readFileSync(file, 'utf8')).toBe('new\n');
    expect(windows.pauses).toEqual(BUSY_PAUSES_MS);
  });

  it('gives up after seven tries, keeps the old file and removes the new one', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', 'EPERM', Number.POSITIVE_INFINITY);
    expect(() => {
      writeFileAtomically(file, 'new\n', windows.system);
    }).toThrow(expect.objectContaining({ code: 'EPERM' }) as Error);
    expect(windows.tries()).toBe(7);
    expect(windows.pauses).toEqual([5, 10, 20, 40, 80, 160]);
    expect(readFileSync(file, 'utf8')).toBe('old\n');
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });

  it('does not wait on another system, where waiting does not help', () => {
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

  it.each(['ENOSPC', 'EACCES'])('does not wait on Windows for a failure of another kind (%s)', (code) => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const windows = refusing('win32', code, 1);
    expect(() => {
      writeFileAtomically(file, 'new\n', windows.system);
    }).toThrow(expect.objectContaining({ code }) as Error);
    expect(windows.tries()).toBe(1);
    expect(windows.pauses).toEqual([]);
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });

  // This is the one test that asks Windows itself. It holds the file open as a reader in another command would,
  // and lets go at the first pause. If Windows did not refuse the move, there would be no pause.
  it.runIf(process.platform === 'win32')('is refused by Windows while the file is open, and gets through after', () => {
    const dir = dirs.next();
    const file = fileIn(dir);
    const reader = openSync(file, 'r');
    let open = true;
    const letGo = (): void => {
      if (open) closeSync(reader);
      open = false;
    };
    const pauses: number[] = [];
    try {
      writeFileAtomically(file, 'new\n', {
        platform: process.platform,
        rename: renameSync,
        pause: (milliseconds) => {
          pauses.push(milliseconds);
          letGo();
        },
      });
    } finally {
      letGo();
    }
    expect(pauses).toEqual([5]);
    expect(readFileSync(file, 'utf8')).toBe('new\n');
    expect(readdirSync(dir)).toEqual(['orglens.toml']);
  });
});

describe('a step on a file that may be busy', () => {
  it('returns what the step returns, also after refusals on Windows', () => {
    let tries = 0;
    const pauses: number[] = [];
    const text = whileBusyOnWindows(
      () => {
        tries += 1;
        if (tries <= 2) throw refusal('EBUSY');
        return 'read';
      },
      { platform: 'win32', pause: (milliseconds) => pauses.push(milliseconds) },
    );
    expect(text).toBe('read');
    expect(tries).toBe(3);
    expect(pauses).toEqual([5, 10]);
  });

  it('passes a missing file on at once', () => {
    let tries = 0;
    expect(() =>
      whileBusyOnWindows(
        () => {
          tries += 1;
          throw refusal('ENOENT');
        },
        { platform: 'win32', pause },
      ),
    ).toThrow(expect.objectContaining({ code: 'ENOENT' }) as Error);
    expect(tries).toBe(1);
  });

  it('uses this system when none is given', () => {
    let tries = 0;
    const step = (): string => {
      tries += 1;
      if (tries === 1) throw refusal('EPERM');
      return 'done';
    };
    if (process.platform === 'win32') {
      expect(whileBusyOnWindows(step)).toBe('done');
      expect(tries).toBe(2);
    } else {
      expect(() => whileBusyOnWindows(step)).toThrow(expect.objectContaining({ code: 'EPERM' }) as Error);
      expect(tries).toBe(1);
    }
  });
});
