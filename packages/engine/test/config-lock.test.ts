import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_HELD_MS, LOCK_STALE_MS, LOCK_WAIT_MS, withConfigLock, type LockSystem } from '../src/api/config-lock.ts';
import { tempDirs } from './helpers/store.ts';

const dirs = tempDirs();
afterEach(dirs.cleanUp);

/** A whole second, so that a file is read back with exactly the time the test gave it. */
const START = Math.floor(Date.now() / 1000) * 1000;

/** Writes the lock as another command would, at a moment of the clock of the test. */
function hold(lock: string, holder: number, at: number): void {
  writeFileSync(lock, `${String(holder)}\n`);
  utimesSync(lock, new Date(at), new Date(at));
}

/**
 * A clock that moves only when the command pauses. `tick` runs after every pause with the time it is then, and
 * plays the other commands.
 */
function clock(tick: (now: number) => void = () => undefined): { system: LockSystem; waited: () => number } {
  let now = START;
  return {
    system: {
      now: () => now,
      pause: (milliseconds) => {
        now += milliseconds;
        tick(now);
      },
    },
    waited: () => now - START,
  };
}

/** What `run` throws. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('It did not throw.');
}

const locked = (lock: string, waitedMs: number, heldMs: number): object => ({
  code: 'WORKSPACE_IO',
  message: 'Another OrgLens command is changing the configuration.',
  hint: `Try again. If no other command is running, delete ${lock}.`,
  details: { reason: 'LOCKED', operation: 'lock', waitedMs, heldMs },
});

describe('the lock of the configuration', () => {
  it('holds the lock while the work runs, and gives it back afterwards', () => {
    const lock = join(dirs.next(), 'config.lock');
    const { system, waited } = clock();
    const result = withConfigLock(lock, () => readFileSync(lock, 'utf8'), system);
    expect(result).toBe(`${String(process.pid)}\n`);
    expect(existsSync(lock)).toBe(false);
    expect(waited()).toBe(0);
  });

  it('gives the lock back when the work fails, and passes the failure on', () => {
    const lock = join(dirs.next(), 'config.lock');
    const failure = new Error('The work failed.');
    expect(
      thrownBy(() =>
        withConfigLock(lock, () => {
          throw failure;
        }),
      ),
    ).toBe(failure);
    expect(existsSync(lock)).toBe(false);
  });

  it('passes on a failure to write the lock that is no lock of another command', () => {
    const lock = join(dirs.next(), 'no-such-folder', 'config.lock');
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', system))).toMatchObject({ code: 'ENOENT' });
    expect(waited()).toBe(0);
  });

  it('waits for one command that holds the lock, and gives up when that one has held it for ten seconds', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START);
    const { system, waited } = clock();
    let ran = false;
    const error = thrownBy(() => {
      withConfigLock(
        lock,
        () => {
          ran = true;
        },
        system,
      );
    });
    expect(LOCK_HELD_MS).toBe(10_000);
    expect(error).toMatchObject(locked(lock, LOCK_HELD_MS, LOCK_HELD_MS));
    expect(waited()).toBe(LOCK_HELD_MS);
    // The lock of the other command is left alone, and the work did not run.
    expect(readFileSync(lock, 'utf8')).toBe('1\n');
    expect(ran).toBe(false);
  });

  it('takes the lock as soon as the other command gives it back', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START);
    // The other command holds the lock for six seconds. The wait was two seconds once.
    const { system, waited } = clock((now) => {
      if (now === START + 6000) rmSync(lock);
    });
    expect(withConfigLock(lock, () => 'done', system)).toBe('done');
    expect(waited()).toBe(6000);
    expect(existsSync(lock)).toBe(false);
  });

  it('waits on while the lock goes from one command to the next, each with its own time', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 0, START);
    // Eight commands in front, three seconds each: 24 seconds in all, and no command holds the lock for ten.
    const { system, waited } = clock((now) => {
      if ((now - START) % 3000 !== 0) return;
      const holder = (now - START) / 3000;
      if (holder < 8) hold(lock, holder, now);
      else rmSync(lock);
    });
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), system)).toBe(`${String(process.pid)}\n`);
    expect(waited()).toBe(24_000);
    expect(existsSync(lock)).toBe(false);
  });

  it('gives up after thirty seconds in all when the lock never comes free', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 0, START);
    const { system, waited } = clock((now) => {
      if ((now - START) % 3000 === 0) hold(lock, (now - START) / 3000, now);
    });
    expect(LOCK_WAIT_MS).toBe(30_000);
    // The command that holds the lock at that moment has only just taken it.
    expect(thrownBy(() => withConfigLock(lock, () => 'done', system))).toMatchObject(locked(lock, LOCK_WAIT_MS, 0));
    expect(waited()).toBe(LOCK_WAIT_MS);
    expect(readFileSync(lock, 'utf8')).toBe('10\n');
  });

  it('does not wait for a lock that has been held for ten seconds already', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - 15_000);
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', system))).toMatchObject(locked(lock, 0, 15_000));
    expect(waited()).toBe(0);
    expect(readFileSync(lock, 'utf8')).toBe('1\n');
  });

  it('takes over a lock that is older than thirty seconds, and no younger one', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - LOCK_STALE_MS);
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', system))).toMatchObject(locked(lock, 0, LOCK_STALE_MS));
    expect(readFileSync(lock, 'utf8')).toBe('1\n');

    hold(lock, 1, START - LOCK_STALE_MS - 1000);
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), system)).toBe(`${String(process.pid)}\n`);
    expect(existsSync(lock)).toBe(false);
    expect(waited()).toBe(0);
  });

  it('waits the whole thirty seconds for a lock whose time is ahead of the clock of this machine', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START + 3_600_000);
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', system))).toMatchObject(locked(lock, LOCK_WAIT_MS, 0));
    expect(waited()).toBe(LOCK_WAIT_MS);
  });
});
