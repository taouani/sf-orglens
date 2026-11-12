/**
 * Engine errors.
 *
 * Every failure the engine reports on purpose is an `EngineError` with a code
 * from `ERROR_CODES`. Codes are part of the public contract: clients branch
 * on them and the CLI prints them in `--json` output. A code is never renamed
 * or reused for a different meaning. New codes are added with the feature
 * that raises them, never ahead of it.
 */
import { redactText } from './redact.ts';

/** A value that survives `JSON.stringify` unchanged. Everything that crosses the engine API is one. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** The stable error codes, each with the situation it stands for. */
export const ERROR_CODES = {
  KEY_INVALID: 'A component key, or the parts given to build one, do not follow the key grammar.',
  REFERENCE_INVALID: 'A reference record breaks one of the rules of the reference vocabulary.',
  STORE_NOT_FOUND: 'The workspace has no database yet, and the command only reads.',
  STORE_FOREIGN: 'The file at the place of the workspace database was not created by OrgLens.',
  STORE_NEWER: 'The workspace database was written by a newer version of OrgLens.',
  STORE_OUTDATED: 'The workspace database needs a migration, and the command only reads.',
  STORE_BUSY: 'Another process holds the write lock of the workspace database.',
  STORE_MIGRATION_FAILED: 'A migration of the workspace database failed and was rolled back.',
  STORE_FAILED: 'The workspace database could not be opened, read or written.',
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
 * engine package, where `instanceof` would fail. Such a copy is recognised by
 * its name, a code this copy knows, and the `toJSON` method.
 */
export function isEngineError(value: unknown): value is EngineError {
  if (value instanceof EngineError) return true;
  if (!(value instanceof Error) || value.name !== 'EngineError') return false;
  const { code, toJSON } = value as { code?: unknown; toJSON?: unknown };
  return typeof code === 'string' && Object.hasOwn(ERROR_CODES, code) && typeof toJSON === 'function';
}

/** The text of anything that was thrown. It never throws itself. */
function describeThrown(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      const message: unknown = (value as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return String(value);
  } catch {
    return '';
  }
}

/**
 * Returns the value itself if it is an engine error, and wraps anything else
 * as `INTERNAL`.
 *
 * The message of a wrapped value was not written by the engine, so it is
 * passed through `redactText` before it can reach a client. An engine error
 * from a newer copy of the package, with a code this copy does not know, is
 * wrapped too, and the code it reported is kept in the details.
 */
export function toEngineError(value: unknown): EngineError {
  if (isEngineError(value)) return value;
  const message = redactText(describeThrown(value));
  const reportedCode: unknown =
    value instanceof Error && value.name === 'EngineError' ? (value as { code?: unknown }).code : undefined;
  return new EngineError('INTERNAL', message === '' ? 'Unknown error' : message, {
    cause: value,
    ...(typeof reportedCode === 'string' ? { details: { reportedCode: redactText(reportedCode) } } : {}),
  });
}
