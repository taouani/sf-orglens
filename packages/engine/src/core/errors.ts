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
  WORKSPACE_NOT_FOUND: 'No workspace was found: no orglens.toml in this folder or in a folder above it.',
  WORKSPACE_EXISTS: 'A workspace cannot be created here, because this folder already belongs to one.',
  WORKSPACE_IO: 'A file or folder of the workspace could not be read or written.',
  CONFIG_INVALID: 'A configuration file, or an environment variable that overrides it, has a problem.',
  CONFIG_NOT_EDITABLE: 'orglens.toml is written in a way OrgLens cannot change safely. It has to be edited by hand.',
  SOURCE_NOT_FOUND: 'No source with this name is declared in orglens.toml.',
  SOURCE_EXISTS: 'A source with this name is already declared in orglens.toml.',
  SOURCE_INVALID: 'The declaration of a source breaks a rule of the configuration.',
  SOURCE_IN_USE: 'The source cannot be removed, because another source refers to it.',
  SOURCE_READ_FAILED:
    'A source could not be read: its repository, its folders or the commit it names, or an org that stopped answering as expected while it was read.',
  SNAPSHOT_NOT_FOUND: 'The source has no snapshot yet, or none with the given number.',
  SNAPSHOT_RUNNING: 'Another process is taking a snapshot of this source.',
  LOGIN_FAILED: 'No login for the org of a source was found, or the login did not work, or the org did not answer.',
  ORG_MISMATCH: 'The login belongs to another org than the one the source declares.',
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
