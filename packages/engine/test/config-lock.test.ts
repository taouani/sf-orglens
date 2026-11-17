import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCK_HELD_MS,
  LOCK_SLOW_MS,
  LOCK_STALE_MS,
  LOCK_WAIT_MS,
  withConfigLock,
  type LockSystem,
  type LockTimes,
} from '../src/api/config-lock.ts';
import { tempDirs } from './helpers/store.ts';

const dirs = tempDirs();
afterEach(dirs.cleanUp);

/** A whole second, so that a file is read back with exactly the time the test gave it. */
const START = Math.floor(Date.now() / 1000) * 1000;

/** What this process writes into a lock: its id, and twelve characters that tell the lock from any other. */
const OWN = new RegExp(`^${String(process.pid)} [0-9a-f]{12}\\n$`);

/** Writes the lock, or another file, as another command would, at a moment of the clock of the test. */
function hold(lock: string, holder: number, at: number): void {
  writeFileSync(lock, `${String(holder)}\n`);
  utimesSync(lock, new Date(at), new Date(at));
}

/**
 * A clock that moves only when the command pauses or the test lets time pass. `tick` runs after every pause
 * with the time it is then, and plays the other commands.
 */
function clock(tick: (now: number) => void = () => undefined): {
  system: LockSystem;
  waited: () => number;
  pass: (milliseconds: number) => void;
} {
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
    pass: (milliseconds) => {
      now += milliseconds;
    },
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
    const result = withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system });
    expect(result).toMatch(OWN);
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
    expect(thrownBy(() => withConfigLock(lock, () => 'done', { system }))).toMatchObject({ code: 'ENOENT' });
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
        { system },
      );
    });
    expect(LOCK_HELD_MS).toBe(10_000);
    expect(error).toMatchObject(locked(lock, LOCK_HELD_MS, LOCK_HELD_MS));
    expect(waited()).toBe(LOCK_HELD_MS);
    // The lock of the other command is left alone, and the work did not run.
    expect(readFileSync(lock, 'utf8')).toBe('1\n');
    expect(ran).toBe(false);
  });

  it('counts the ten seconds from the time the lock was written, not from the time this command came', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - 4000);
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', { system }))).toMatchObject(
      locked(lock, 6000, LOCK_HELD_MS),
    );
    expect(waited()).toBe(6000);
  });

  it('takes the lock as soon as the other command gives it back', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START);
    // The other command holds the lock for six seconds. The wait was two seconds once.
    const { system, waited } = clock((now) => {
      if (now === START + 6000) rmSync(lock);
    });
    expect(withConfigLock(lock, () => 'done', { system })).toBe('done');
    expect(waited()).toBe(6000);
    expect(existsSync(lock)).toBe(false);
  });

  it('tries again at once when the lock is gone between the try and the look at it', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START);
    let looks = 0;
    const pauses: number[] = [];
    const system: LockSystem = {
      // The first reading of the clock is the start. The second is the look at the lock that was in the way.
      now: () => {
        looks += 1;
        if (looks === 2) rmSync(lock);
        return START;
      },
      pause: (milliseconds) => pauses.push(milliseconds),
    };
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system })).toMatch(OWN);
    expect(pauses).toEqual([]);
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
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system })).toMatch(OWN);
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
    expect(thrownBy(() => withConfigLock(lock, () => 'done', { system }))).toMatchObject(locked(lock, LOCK_WAIT_MS, 0));
    expect(waited()).toBe(LOCK_WAIT_MS);
    expect(readFileSync(lock, 'utf8')).toBe('10\n');
  });

  it('does not wait for a lock that has been held for ten seconds already', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - 15_000);
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', { system }))).toMatchObject(locked(lock, 0, 15_000));
    expect(waited()).toBe(0);
    expect(readFileSync(lock, 'utf8')).toBe('1\n');
  });

  it('waits the whole thirty seconds for a lock whose time is ahead of the clock of this machine', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START + 3_600_000);
    const { system, waited } = clock();
    expect(thrownBy(() => withConfigLock(lock, () => 'done', { system }))).toMatchObject(locked(lock, LOCK_WAIT_MS, 0));
    expect(waited()).toBe(LOCK_WAIT_MS);
  });
});

describe('a lock of the configuration that was left behind', () => {
  it('is taken over when it is older than thirty seconds, and no younger one is', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - LOCK_STALE_MS);
    const { system, waited } = clock();
    expect(LOCK_STALE_MS).toBe(30_000);
    expect(thrownBy(() => withConfigLock(lock, () => 'done', { system }))).toMatchObject(
      locked(lock, 0, LOCK_STALE_MS),
    );
    expect(readFileSync(lock, 'utf8')).toBe('1\n');

    hold(lock, 1, START - LOCK_STALE_MS - 1000);
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system })).toMatch(OWN);
    expect(readdirSync(dirname(lock))).toEqual([]);
    expect(waited()).toBe(0);
  });

  it('is not removed by a command that finds another command has taken it over in the meantime', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - 60_000);
    let looks = 0;
    let now = START;
    /** The lock as this command finds it at its first pause. */
    let found = '';
    const system: LockSystem = {
      now: () => {
        looks += 1;
        // The first reading of the clock is the start, the second the look that finds the old lock. The third
        // is the look under the second file. Before it, another command took the old lock over and holds a
        // fresh one.
        if (looks === 3) hold(lock, 7, START);
        return now;
      },
      pause: (milliseconds) => {
        if (found === '') found = readFileSync(lock, 'utf8');
        now += milliseconds;
        if (now === START + 1000) rmSync(lock);
      },
    };
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system })).toMatch(OWN);
    // The fresh lock of the other command stayed, and this command waited for it.
    expect(found).toBe('7\n');
    expect(now).toBe(START + 1000);
    expect(readdirSync(dirname(lock))).toEqual([]);
  });

  it('is left to another command that is taking it over at this moment', () => {
    const lock = join(dirs.next(), 'config.lock');
    const claim = `${lock}.takeover`;
    hold(lock, 1, START - 60_000);
    hold(claim, 2, START);
    let found = '';
    const { system, waited } = clock((now) => {
      if (found === '') found = readFileSync(lock, 'utf8');
      // The other command stops without removing the lock, and gives its second file back.
      if (now === START + 100) rmSync(claim);
    });
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system })).toMatch(OWN);
    expect(found).toBe('1\n');
    expect(waited()).toBe(100);
    expect(readdirSync(dirname(lock))).toEqual([]);
  });

  it('is taken over although a command left the second file behind too', () => {
    const lock = join(dirs.next(), 'config.lock');
    hold(lock, 1, START - 60_000);
    hold(`${lock}.takeover`, 2, START - 60_000);
    const { system, waited } = clock();
    expect(withConfigLock(lock, () => readFileSync(lock, 'utf8'), { system })).toMatch(OWN);
    // One pause: the first look removes the second file, the next one takes the lock over.
    expect(waited()).toBe(20);
    expect(readdirSync(dirname(lock))).toEqual([]);
  });

  it('stays when the command that gives its lock back finds the lock of another command', () => {
    const lock = join(dirs.next(), 'config.lock');
    const { system } = clock();
    withConfigLock(
      lock,
      () => {
        // This command took longer than thirty seconds, and another one took the lock over.
        hold(lock, 7, START);
      },
      { system },
    );
    expect(readFileSync(lock, 'utf8')).toBe('7\n');
  });
});

describe('a lock of the configuration that was slow', () => {
  /** What a command says that waits `waitMs` for another one and then does `work`, which can let time pass. */
  function slowOf(waitMs: number, work: (pass: (milliseconds: number) => void) => void): LockTimes[] {
    const lock = join(dirs.next(), 'config.lock');
    if (waitMs > 0) hold(lock, 1, START);
    const { system, pass } = clock((now) => {
      if (now === START + waitMs) rmSync(lock);
    });
    const slow: LockTimes[] = [];
    try {
      withConfigLock(
        lock,
        () => {
          work(pass);
        },
        { system, slow: (times) => slow.push(times) },
      );
    } catch {
      // The test is about what the command says, also when its work fails.
    }
    return slow;
  }

  it('says nothing when the command neither waited nor held the lock for a second', () => {
    expect(LOCK_SLOW_MS).toBe(1000);
    expect(
      slowOf(980, (pass) => {
        pass(999);
      }),
    ).toEqual([]);
  });

  it('says how long the command held the lock, also when its work fails', () => {
    expect(
      slowOf(0, (pass) => {
        pass(1500);
      }),
    ).toEqual([{ waitedMs: 0, heldMs: 1500 }]);
    expect(
      slowOf(0, (pass) => {
        pass(1000);
        throw new Error('The work failed.');
      }),
    ).toEqual([{ waitedMs: 0, heldMs: 1000 }]);
  });

  it('says how long the command waited', () => {
    expect(slowOf(2000, () => undefined)).toEqual([{ waitedMs: 2000, heldMs: 0 }]);
  });
});
