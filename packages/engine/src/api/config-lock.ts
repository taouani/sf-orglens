/**
 * The lock a command holds while it changes a configuration file.
 *
 * A change reads a file, edits the text and writes it back. Two commands doing that at the same moment would
 * each write their own result, and one of the two changes would be lost without a word. The lock is a file that
 * only one process can create. A hand-made edit in an editor is not held off by it.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { EngineError } from '../core/errors.ts';
import { pause, whileBusyOnWindows, type BusySystem } from './atomic-write.ts';

/**
 * How long one command may hold the lock before a command that waits for it gives up.
 *
 * It is counted from the time the lock file was written, so each command that takes the lock has this time of
 * its own, however many are in the queue. An edit takes milliseconds on most machines. The wait was two seconds
 * in all at first. One CI run on Windows showed that this is too short: of eight commands that changed the
 * configuration at the same moment, one got the lock and the seven others gave up, each after its two seconds.
 * So the one must have held the lock for longer than that. How long it held it and what made it slow is not
 * known, and ten seconds is a guess.
 */
export const LOCK_HELD_MS = 10_000;

/** How long a command waits in all while the lock goes from one command to the next. */
export const LOCK_WAIT_MS = 30_000;

/**
 * A lock this old is taken for one that a command left behind when it did not end properly, and is taken over.
 * A command that is still running after this time loses its lock, and its change can be lost.
 */
export const LOCK_STALE_MS = 30_000;

/** A command that waited this long for the lock, or held it this long, says so afterwards. */
export const LOCK_SLOW_MS = 1_000;

const LOCK_PAUSE_MS = 20;

/** What the wait takes from the system. A test puts its own in. */
export interface LockSystem {
  readonly now: () => number;
  readonly pause: (milliseconds: number) => void;
  /** The system the command runs on, when it is not the one of this process. */
  readonly platform?: string | undefined;
  /** Creates the lock file or the second file with its content, and fails with `EEXIST` when the file is there. */
  readonly create?: ((file: string, mark: string) => void) | undefined;
}

/** How long a command waited for the lock and how long it held it, in milliseconds. */
export interface LockTimes {
  readonly waitedMs: number;
  readonly heldMs: number;
}

/** The steps on the lock that Windows refused and that were tried again. */
export interface LockRefusals {
  /** How many times a step was refused and tried again. */
  readonly refusals: number;
  /** The codes of the refusals, each once, sorted. */
  readonly codes: readonly string[];
}

export interface LockOptions {
  readonly system?: LockSystem | undefined;
  /** Called after the lock is given back, if the command waited or held it for `LOCK_SLOW_MS` or longer. */
  readonly slow?: ((times: LockTimes) => void) | undefined;
  /**
   * Called when the command is done with the lock, if Windows refused a step on the lock and the step was tried
   * again. It is called whether the tries ended well or not.
   */
  readonly refused?: ((refusals: LockRefusals) => void) | undefined;
}

const SYSTEM: LockSystem = { now: Date.now, pause };

function createLock(file: string, mark: string): void {
  writeFileSync(file, mark, { flag: 'wx' });
}

const codeOf = (error: unknown): unknown => (error as { code?: unknown }).code;

/** How old a file is by the time it was written, or `undefined` if it is not there. */
function ageOf(file: string, system: LockSystem): number | undefined {
  // The clock first: time that passes while the file system answers must not count against the lock.
  const now = system.now();
  const found = statSync(file, { throwIfNoEntry: false });
  return found === undefined ? undefined : now - found.mtimeMs;
}

/**
 * Removes a lock that was left behind, and says whether this command was the one to look.
 *
 * Two commands that both see the old lock must not both remove a lock: the second would remove the fresh lock
 * of the first, and both would change the file. So a command removes the old lock only while it holds a second
 * file, and looks at the lock again once it does. A second file that is itself left behind is removed after the
 * same time, without such a guard: for that, a command has to stop within these few lines.
 */
function takeOver(lockFile: string, mark: string, system: LockSystem, busy: BusySystem): boolean {
  const claim = `${lockFile}.takeover`;
  const remove = (file: string): void => {
    whileBusyOnWindows(() => {
      rmSync(file, { force: true });
    }, busy);
  };
  try {
    whileBusyOnWindows(() => {
      (system.create ?? createLock)(claim, mark);
    }, busy);
  } catch (error) {
    if (codeOf(error) !== 'EEXIST') throw error;
    if ((ageOf(claim, system) ?? 0) > LOCK_STALE_MS) remove(claim);
    return false;
  }
  try {
    if ((ageOf(lockFile, system) ?? 0) > LOCK_STALE_MS) remove(lockFile);
  } finally {
    remove(claim);
  }
  return true;
}

/** Whether the lock is still the one this command wrote. */
function holds(lockFile: string, mark: string, busy: BusySystem): boolean {
  try {
    return whileBusyOnWindows(() => readFileSync(lockFile, 'utf8'), busy) === mark;
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Runs one change of the configuration files while no other command changes them.
 *
 * A command that finds the lock taken looks again every few milliseconds, and prints nothing while it waits. It
 * gives up when the lock it sees has been held for `LOCK_HELD_MS`, or when it has waited `LOCK_WAIT_MS` in all,
 * and the error says both times. The age of a lock is the time on the clock of this machine minus the time the
 * file system gave the file. On a folder whose clock is behind by more than `LOCK_HELD_MS`, a command that
 * finds the lock taken gives up at once. Behind by more than `LOCK_STALE_MS`, the lock keeps nobody out.
 */
export function withConfigLock<T>(lockFile: string, work: () => T, options: LockOptions = {}): T {
  const system = options.system ?? SYSTEM;
  const codes: string[] = [];
  const busy: BusySystem = {
    platform: system.platform ?? process.platform,
    pause: system.pause,
    refused: (code) => codes.push(code),
  };
  try {
    return underLock(lockFile, work, options, system, busy);
  } finally {
    // The only trace that Windows refused a step, when the tries ended well.
    if (codes.length > 0) options.refused?.({ refusals: codes.length, codes: [...new Set(codes)].sort() });
  }
}

/** Takes the lock, runs the work and gives the lock back. Every step on the lock file goes through `busy`. */
function underLock<T>(lockFile: string, work: () => T, options: LockOptions, system: LockSystem, busy: BusySystem): T {
  // The id of the process is for a person who reads the file. The rest tells this lock from any other.
  const mark = `${String(process.pid)} ${randomBytes(6).toString('hex')}\n`;
  const from = system.now();
  const create = system.create ?? createLock;
  for (;;) {
    try {
      // Windows can refuse to create the lock with "access denied", which Node.js gives as `EPERM`, and not
      // with `EEXIST`. One CI run on Windows failed that way: of eight commands that changed the configuration
      // at the same moment, one ended with `EPERM` from this line. Why Windows refused is not known. It is
      // known to answer so for a file that is marked for removal and not gone yet, and the command in front
      // removes its lock at that moment. Whether that happened, and whether anything had the file open, was not
      // watched. The step is tried again for a third of a second, as a read and a removal of the lock are, and
      // the pauses count in the time the command waited.
      whileBusyOnWindows(() => {
        create(lockFile, mark);
      }, busy);
      break;
    } catch (error) {
      if (codeOf(error) !== 'EEXIST') throw error;
    }
    const heldMs = ageOf(lockFile, system);
    // The lock is gone again: nothing holds it, and the next try may take it.
    if (heldMs === undefined) continue;
    const stale = heldMs > LOCK_STALE_MS;
    if (stale && takeOver(lockFile, mark, system, busy)) continue;
    const waitedMs = system.now() - from;
    if ((!stale && heldMs >= LOCK_HELD_MS) || waitedMs >= LOCK_WAIT_MS) {
      throw new EngineError('WORKSPACE_IO', 'Another OrgLens command is changing the configuration.', {
        hint: `Try again. If no other command is running, delete ${lockFile}.`,
        details: {
          reason: 'LOCKED',
          operation: 'lock',
          waitedMs: Math.round(waitedMs),
          heldMs: Math.max(0, Math.round(heldMs)),
        },
      });
    }
    system.pause(LOCK_PAUSE_MS);
  }
  const taken = system.now();
  try {
    return work();
  } finally {
    // After `LOCK_STALE_MS` another command may have taken the lock over. Its lock stays.
    if (holds(lockFile, mark, busy)) {
      whileBusyOnWindows(() => {
        rmSync(lockFile, { force: true });
      }, busy);
    }
    const times = { waitedMs: Math.round(taken - from), heldMs: Math.round(system.now() - taken) };
    if (times.waitedMs >= LOCK_SLOW_MS || times.heldMs >= LOCK_SLOW_MS) options.slow?.(times);
  }
}
