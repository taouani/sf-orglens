/**
 * The lock a command holds while it changes a configuration file.
 *
 * A change reads a file, edits the text and writes it back. Two commands doing that at the same moment would
 * each write their own result, and one of the two changes would be lost without a word. The lock is a file that
 * only one process can create. A hand-made edit in an editor is not held off by it.
 */
import { rmSync, statSync, writeFileSync } from 'node:fs';
import { EngineError } from '../core/errors.ts';
import { pause } from './atomic-write.ts';

/**
 * How long one command may hold the lock before a command that waits for it gives up.
 *
 * It is counted from the moment the lock was written, so each command that takes the lock has this time of its
 * own, however many are in the queue. An edit takes milliseconds on most machines. The wait was two seconds in
 * all at first. One CI run on Windows showed that this is too short: of eight commands that changed the
 * configuration at the same moment, one held the lock for more than two seconds and the seven others gave up.
 * What made that one slow is not known.
 */
export const LOCK_HELD_MS = 10_000;

/** How long a command waits in all while the lock goes from one command to the next. */
export const LOCK_WAIT_MS = 30_000;

/** A lock this old was left behind by a command that did not end properly. It is taken over. */
export const LOCK_STALE_MS = 30_000;

const LOCK_PAUSE_MS = 20;

/** What the wait takes from the system. A test puts its own in. */
export interface LockSystem {
  readonly now: () => number;
  readonly pause: (milliseconds: number) => void;
}

const SYSTEM: LockSystem = { now: Date.now, pause };

/**
 * Runs one change of the configuration files while no other command changes them.
 *
 * A command that finds the lock taken looks again every few milliseconds. It gives up when the lock it sees has
 * been held for `LOCK_HELD_MS`, or when it has waited `LOCK_WAIT_MS` in all, and the error says both times.
 * The age of a lock is read from the time the file was written, by the clock of this machine.
 */
export function withConfigLock<T>(lockFile: string, work: () => T, system: LockSystem = SYSTEM): T {
  const from = system.now();
  for (;;) {
    try {
      writeFileSync(lockFile, `${String(process.pid)}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
    }
    const now = system.now();
    // The lock may be gone again by now. Then nothing holds it, and the next try takes it.
    const lock = statSync(lockFile, { throwIfNoEntry: false });
    const heldMs = lock === undefined ? 0 : now - lock.mtimeMs;
    if (heldMs > LOCK_STALE_MS) {
      rmSync(lockFile, { force: true });
    } else if (heldMs >= LOCK_HELD_MS || now - from >= LOCK_WAIT_MS) {
      throw new EngineError('WORKSPACE_IO', 'Another OrgLens command is changing the configuration.', {
        hint: `Try again. If no other command is running, delete ${lockFile}.`,
        details: {
          reason: 'LOCKED',
          operation: 'lock',
          waitedMs: Math.round(now - from),
          heldMs: Math.max(0, Math.round(heldMs)),
        },
      });
    } else {
      system.pause(LOCK_PAUSE_MS);
    }
  }
  try {
    return work();
  } finally {
    rmSync(lockFile, { force: true });
  }
}
