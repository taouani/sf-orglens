/**
 * Engine errors.
 *
 * Every failure the engine reports on purpose is an `EngineError` with a code
 * from `ERROR_CODES`. Codes are part of the public contract: clients branch
 * on them and the CLI prints them in `--json` output. A code is never renamed
 * or reused for a different meaning. New codes are added with the feature
 * that raises them, never ahead of it.
 */

/** A value that survives `JSON.stringify` unchanged. Everything that crosses the engine API is one. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The stable error codes, each with the situation it stands for. */
export const ERROR_CODES = {
  KEY_INVALID: 'A component key, or the parts given to build one, do not follow the key grammar.',
  REFERENCE_INVALID: 'A reference record breaks one of the rules of the reference vocabulary.',
  INTERNAL: 'An unexpected failure inside the engine. This is a bug in OrgLens.',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface EngineErrorOptions {
  /** What the user can do about it, in one sentence. */
  readonly hint?: string;
  /** Machine-readable facts about the failure. Never contains credentials. */
  readonly details?: Readonly<Record<string, JsonValue>>;
  /** The underlying error, kept for logs. It is not part of the JSON form. */
  readonly cause?: unknown;
}

/** The JSON form of an engine error, as it appears in `--json` output. */
export interface EngineErrorJson {
  readonly code: ErrorCode;
  readonly message: string;
  readonly hint?: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly details: Readonly<Record<string, JsonValue>> | undefined;

  constructor(code: ErrorCode, message: string, options: EngineErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EngineError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }

  toJSON(): EngineErrorJson {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint === undefined ? {} : { hint: this.hint }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/**
 * True for an `EngineError`, including one created by another copy of the
 * engine package, where `instanceof` would fail.
 */
export function isEngineError(value: unknown): value is EngineError {
  if (value instanceof EngineError) return true;
  if (!(value instanceof Error) || value.name !== 'EngineError') return false;
  const code: unknown = (value as { code?: unknown }).code;
  return typeof code === 'string' && Object.hasOwn(ERROR_CODES, code);
}

/** Returns the value itself if it is an engine error, and wraps anything else as `INTERNAL`. */
export function toEngineError(value: unknown): EngineError {
  if (isEngineError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new EngineError('INTERNAL', message === '' ? 'Unknown error' : message, { cause: value });
}
