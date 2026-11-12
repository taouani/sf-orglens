/**
 * What the CLI writes, and the exit code it ends with.
 *
 * Both are a contract (decision record 0027). A command returns an
 * `Outcome`: the data for `--json` and the text for a person. This module
 * turns it into the JSON envelope or into lines on the terminal, and turns a
 * failure into an error on the standard error stream, or into an envelope
 * with `ok: false`.
 */
import { isEngineError, type ErrorCode, type JsonValue } from '@sf-orglens/engine';

/** The version of the envelope. It changes only when a field is removed or changes its meaning. */
const OUTPUT_SCHEMA_VERSION = 1;

/** Every exit code of `orglens`. */
export const EXIT = {
  /** The command did what it was asked to do. */
  ok: 0,
  /** The command failed, or `doctor` found a check that failed. */
  failure: 1,
  /** The command line or the configuration is wrong. Nothing was changed. */
  usage: 2,
  /** A gate was breached. Used by the commands that compare against a threshold. */
  gate: 3,
  /** A login is missing or has expired, or the org cannot be reached. */
  connection: 4,
  /** The result is there, and it is incomplete. */
  partial: 5,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The code of an error in the envelope: a code of the engine, or `USAGE` for a command line that cannot be understood. */
type OutputErrorCode = ErrorCode | 'USAGE';

/**
 * The exit code of every error code. A new error code of the engine does not
 * compile until it has a line here.
 */
const EXIT_OF_ERROR: Readonly<Record<OutputErrorCode, ExitCode>> = {
  USAGE: EXIT.usage,
  KEY_INVALID: EXIT.usage,
  CONFIG_INVALID: EXIT.usage,
  CONFIG_NOT_EDITABLE: EXIT.usage,
  WORKSPACE_NOT_FOUND: EXIT.usage,
  WORKSPACE_EXISTS: EXIT.usage,
  SOURCE_NOT_FOUND: EXIT.usage,
  SOURCE_EXISTS: EXIT.usage,
  SOURCE_INVALID: EXIT.usage,
  SOURCE_IN_USE: EXIT.usage,
  SNAPSHOT_NOT_FOUND: EXIT.usage,
  SNAPSHOT_RUNNING: EXIT.failure,
  LOGIN_FAILED: EXIT.connection,
  ORG_MISMATCH: EXIT.connection,
  WORKSPACE_IO: EXIT.failure,
  SOURCE_READ_FAILED: EXIT.failure,
  REFERENCE_INVALID: EXIT.failure,
  STORE_NOT_FOUND: EXIT.failure,
  STORE_FOREIGN: EXIT.failure,
  STORE_NEWER: EXIT.failure,
  STORE_OUTDATED: EXIT.failure,
  STORE_BUSY: EXIT.failure,
  STORE_MIGRATION_FAILED: EXIT.failure,
  STORE_FAILED: EXIT.failure,
  INTERNAL: EXIT.failure,
};

interface OutputError {
  readonly code: OutputErrorCode;
  readonly message: string;
  readonly hint: string | null;
  readonly details: Readonly<Record<string, JsonValue>>;
}

/** Where the CLI reads from and writes to. Tests replace it. */
export interface Io {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** What a command hands back when it has done its work. */
export interface Outcome {
  /** The `data` of the envelope. */
  readonly data: unknown;
  /** The lines a person reads. */
  readonly lines: readonly string[];
  /** Default: 0. A command sets it when it has a result and the result is not a success. */
  readonly exitCode?: ExitCode;
}

/** A command line the CLI cannot act on, found after the argument parser was done. */
export class UsageError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UsageError';
    this.hint = hint;
  }
}

// Characters that change what a terminal shows or does: the control characters except the tab, and the marks that
// reorder text. The line feed is one of them: every line is printed on its own, so a line feed inside one comes
// from a name or a message, and would let the content of a file add lines that look like output of OrgLens.
// eslint-disable-next-line no-control-regex -- control characters are what this expression is for
const UNSAFE_IN_TERMINAL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// JSON.stringify leaves these as they are. They are escaped so that the output is one line of printable text.
const UNSAFE_IN_JSON = /[\u007f-\u009f\u2028\u2029]/g;

/** One line of text that is safe to print: each unsafe character is replaced by the replacement character. */
export function printable(text: string): string {
  return text.replace(UNSAFE_IN_TERMINAL, '\ufffd');
}

function encode(value: unknown): string {
  return JSON.stringify(value).replace(
    UNSAFE_IN_JSON,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Lays out rows in columns. The last column is not padded. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(...all.map((row) => (row[column] ?? '').length)));
  return all.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}

/** Turns anything that was thrown into the error of the envelope. */
function describeError(thrown: unknown): OutputError {
  if (isEngineError(thrown)) {
    return { code: thrown.code, message: thrown.message, hint: thrown.hint ?? null, details: thrown.details ?? {} };
  }
  if (thrown instanceof UsageError) {
    return { code: 'USAGE', message: thrown.message, hint: thrown.hint ?? null, details: {} };
  }
  // The engine turns everything it throws into an engine error, so this is a bug in the CLI itself.
  return {
    code: 'INTERNAL',
    message: thrown instanceof Error ? thrown.message : String(thrown),
    hint: 'This is a bug in OrgLens. Please report it.',
    details: {},
  };
}

/** Where an error keeps the list of its problems. The message names the first of them. */
const PROBLEM_LISTS: Readonly<Partial<Record<OutputErrorCode, string>>> = {
  CONFIG_INVALID: 'diagnostics',
  SOURCE_INVALID: 'problems',
};

/** The lines below the first one for an error that has more to say than its message. */
function errorDetailLines(error: OutputError): string[] {
  const list = PROBLEM_LISTS[error.code];
  const problems = list === undefined ? undefined : error.details[list];
  if (!Array.isArray(problems)) return [];
  // The message names the first problem. The others follow, one per line.
  return (problems as readonly JsonValue[]).slice(1).flatMap((one) => {
    const text = typeof one === 'object' && one !== null && 'text' in one ? one['text'] : undefined;
    return typeof text === 'string' ? [`  ${text}`] : [];
  });
}

export interface Writer {
  /**
   * Says what a command that takes long is doing. A person reads it on the standard error stream, so the result
   * on the standard output stays what it is. With `--json` nothing is written.
   */
  progress(line: string): void;
  /** Writes the result of a command and returns the exit code. */
  succeed(command: string, outcome: Outcome): ExitCode;
  /** Writes a failure and returns the exit code. `command` is `null` when the command line was rejected before a command ran. */
  fail(command: string | null, thrown: unknown): ExitCode;
}

export function createWriter(io: Io, json: boolean): Writer {
  const envelope = (command: string | null, data: unknown, error: OutputError | null): void => {
    io.stdout(
      `${encode({ schemaVersion: OUTPUT_SCHEMA_VERSION, command, ok: error === null, data, warnings: [], error })}\n`,
    );
  };
  return {
    progress(line) {
      if (!json) io.stderr(`${printable(line)}\n`);
    },
    succeed(command, outcome) {
      if (json) envelope(command, outcome.data, null);
      else io.stdout(outcome.lines.map((line) => `${printable(line)}\n`).join(''));
      return outcome.exitCode ?? EXIT.ok;
    },
    fail(command, thrown) {
      const error = describeError(thrown);
      if (json) {
        envelope(command, null, error);
      } else {
        const lines = [`error: ${error.message}`, ...errorDetailLines(error)];
        if (error.hint !== null) lines.push(`hint: ${error.hint}`);
        io.stderr(lines.map((line) => `${printable(line)}\n`).join(''));
      }
      // A copy of the engine newer than this CLI can report a code this table does not have.
      return (EXIT_OF_ERROR as Readonly<Partial<Record<string, ExitCode>>>)[error.code] ?? EXIT.failure;
    },
  };
}
