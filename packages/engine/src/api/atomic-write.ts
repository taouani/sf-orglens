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

/** What the write takes from the system. A test puts its own in. */
export interface AtomicWriteSystem {
  readonly platform: string;
  readonly rename: (from: string, to: string) => void;
  readonly pause: (milliseconds: number) => void;
}

const SYSTEM: AtomicWriteSystem = { platform: process.platform, rename: renameSync, pause };

/**
 * How long the move waits before each further try on Windows. Eight tries in all, over 635 milliseconds at most:
 * less than the two seconds another command waits for the lock of the configuration.
 */
export const RENAME_PAUSES_MS: readonly number[] = [5, 10, 20, 40, 80, 160, 320];

/** What Windows answers when the file to replace is open somewhere. */
const BUSY_ON_WINDOWS: ReadonlySet<unknown> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Moves the new file over the old one.
 *
 * Windows refuses to replace a file for as long as any process has it open, and a virus scanner or another
 * OrgLens command that reads the configuration at that moment has it open for a few milliseconds. The move is
 * safe to repeat, so on Windows it is tried again for a short while. On other systems the same codes mean that
 * the folder may not be written, and waiting would only delay the message.
 */
function renameOver(from: string, to: string, system: AtomicWriteSystem): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      system.rename(from, to);
      return;
    } catch (error) {
      const wait = system.platform === 'win32' ? RENAME_PAUSES_MS[attempt] : undefined;
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
    renameOver(temporary, target, system);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}
