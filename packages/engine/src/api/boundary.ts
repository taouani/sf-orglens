import { EngineError, isEngineError, toEngineError } from '../core/errors.ts';
import { redactText } from '../core/redact.ts';

/**
 * Runs one call of the public API, and makes sure that whatever it throws
 * leaves the engine as an `EngineError`.
 *
 * A failure of the file system (no permission, a full disk, a folder where a
 * file should be) is the user's to fix and becomes `WORKSPACE_IO`. Anything
 * else that is not an engine error is a bug and becomes `INTERNAL`.
 */
export async function boundary<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isEngineError(error)) throw error;
    const { code, syscall } = error as { code?: unknown; syscall?: unknown };
    if (error instanceof Error && typeof code === 'string' && typeof syscall === 'string') {
      throw new EngineError('WORKSPACE_IO', redactText(error.message), {
        details: { reason: code, operation: syscall },
        cause: error,
      });
    }
    throw toEngineError(error);
  }
}
