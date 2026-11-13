/**
 * Writing a file in one step.
 *
 * The configuration files of a workspace are replaced, never written into, so that a crash leaves either the old
 * file or the new one.
 */
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';

/** Stops this thread for a moment. */
export function pause(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** What the tries take from the system. A test puts its own in. */
export interface BusySystem {
  readonly platform: string;
  readonly pause: (milliseconds: number) => void;
}

/** What the write takes from the system. A test puts its own in. */
export interface AtomicWriteSystem extends BusySystem {
  readonly rename: (from: string, to: string) => void;
}

const SYSTEM: AtomicWriteSystem = { platform: process.platform, rename: renameSync, pause };

/**
 * How long a step waits before each further try on Windows: seven tries in all, with 315 milliseconds of pauses.
 *
 * A write happens while the lock of the configuration is held, and another command waits two seconds for that
 * lock. A refusal that passes costs a few milliseconds. One that does not pass, such as a file that is
 * read-only, costs each command the whole wait while it holds the lock, so the last of several commands in a
 * queue can end with the message of the lock in place of the real cause.
 */
export const BUSY_PAUSES_MS: readonly number[] = [5, 10, 20, 40, 80, 160];

/** What Windows answers through Node.js when a file is open elsewhere or is being replaced. */
const BUSY_ON_WINDOWS: ReadonlySet<unknown> = new Set(['EPERM', 'EBUSY']);

/**
 * Does one step on a file, and on Windows does it again for a short while if the file is busy.
 *
 * Windows refuses to replace a file for as long as any process has it open, and it can refuse to open a file at
 * the moment another process replaces it. One CI run failed in that way: eight commands changed the
 * configuration at the same moment, and one move was refused with `EPERM`. Most likely another of the commands
 * was reading the file. Which process had it open is not known. A virus scanner does the same. Both steps are
 * safe to repeat. On other systems these codes do not pass by waiting, and the error is passed on at once.
 * Windows gives the same codes for a file that is read-only, so there a failure that stays is reported a third
 * of a second later.
 */
export function whileBusyOnWindows<T>(step: () => T, system: BusySystem = SYSTEM): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return step();
    } catch (error) {
      const wait = system.platform === 'win32' ? BUSY_PAUSES_MS[attempt] : undefined;
      if (wait === undefined || !BUSY_ON_WINDOWS.has((error as { code?: unknown }).code)) throw error;
      system.pause(wait);
    }
  }
}

/**
 * Writes the content of a file in one step, so that a crash never leaves half a configuration.
 *
 * The new content is written to a file beside the old one, flushed to disk, and moved over it. A link is
 * followed first: the file it points at is replaced and the link stays. The new file gets the permissions of
 * the old one. A file that does not exist yet is created with the permissions the system gives a new file.
 * If the move fails, the file beside the old one is removed and the old one stays as it was.
 */
export function writeFileAtomically(file: string, text: string, system: AtomicWriteSystem = SYSTEM): void {
  const exists = existsSync(file);
  const target = exists ? realpathSync(file) : file;
  const mode = exists ? statSync(target).mode & 0o777 : undefined;
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'wx', mode);
    writeFileSync(descriptor, text);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    // The mode given to `open` is cut down by the umask of the process.
    if (mode !== undefined) chmodSync(temporary, mode);
    whileBusyOnWindows(() => {
      system.rename(temporary, target);
    }, system);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}
