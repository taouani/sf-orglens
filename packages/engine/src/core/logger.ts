/**
 * The engine's logger: one JSON object per line.
 *
 * Every record passes through `redact` before it is written, so a log never
 * holds a credential. Logs go to files in the workspace, one per day, the
 * recent ones are kept, and nothing is ever sent anywhere.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.ts';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/** Receives one finished log line, without the trailing newline. A sink is synchronous. */
type LogSink = (line: string) => void;

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** A logger that adds the given fields to every record it writes. */
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  readonly sink: LogSink;
  /** The lowest level that is written. Default `info`. */
  readonly level?: LogLevel;
  /** The clock, for tests. Default the system clock. */
  readonly now?: () => Date;
}

/** Field names every record owns. A caller's field with one of these names is written with a `field.` prefix. */
const RESERVED = new Set(['time', 'level', 'event']);

/** The time of a record. A clock that fails or returns no valid date must not cost the record. */
function timestamp(now: () => Date): string {
  try {
    return now().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Creates a logger. `event` is a short, stable name such as
 * `retrieve.chunk.done`; everything that varies goes into the fields.
 *
 * A logging call never throws and never rejects, whatever it is given and
 * whatever the sink does. A record that cannot be built is replaced by a
 * short one that says so, and a sink that fails loses the record.
 */
export function createLogger(options: LoggerOptions): Logger {
  // A level that is not one of the four is treated as the default, never as "write everything".
  const requested = LOG_LEVELS.indexOf(options.level ?? 'info');
  const threshold = requested === -1 ? LOG_LEVELS.indexOf('info') : requested;
  const now = options.now ?? (() => new Date());

  // Typed as it may behave: a function that returns a promise is accepted wherever one returning nothing is.
  const sink: (line: string) => unknown = options.sink;
  const send = (line: string): void => {
    try {
      const pending = sink(line);
      // A sink that turns out to be asynchronous must not leave a rejection unhandled.
      if (pending instanceof Promise) pending.catch(() => undefined);
    } catch {
      // A failing log sink must never take the operation down with it.
    }
  };

  const build = (bound: readonly Record<string, unknown>[]): Logger => {
    const write = (level: LogLevel, event: string, fields?: Record<string, unknown>): void => {
      if (LOG_LEVELS.indexOf(level) < threshold) return;
      const time = timestamp(now);
      let line: string;
      try {
        const record: Record<string, unknown> = { time, level, event };
        for (const source of fields === undefined ? bound : [...bound, fields]) {
          for (const [name, value] of Object.entries(source)) {
            record[RESERVED.has(name) ? `field.${name}` : name] = value;
          }
        }
        line = JSON.stringify(redact(record));
      } catch (error) {
        const reason = error instanceof Error ? error.name : typeof error;
        line = JSON.stringify({
          time,
          level,
          event,
          logError: `The record could not be built: ${reason}`,
        });
      }
      send(line);
    };
    return {
      debug: (event, fields) => {
        write('debug', event, fields);
      },
      info: (event, fields) => {
        write('info', event, fields);
      },
      warn: (event, fields) => {
        write('warn', event, fields);
      },
      error: (event, fields) => {
        write('error', event, fields);
      },
      // The fields are read when a record is written, inside the guard, not here.
      child: (fields) => build([...bound, fields]),
    };
  };
  return build([]);
}

export interface FileSinkOptions {
  /** The folder for log files. It is created if missing. */
  readonly dir: string;
  /** How many days of log files to keep, counting today. Default 14. */
  readonly keepDays?: number;
  /** The clock, for tests. Default the system clock. */
  readonly now?: () => Date;
}

export interface FileSink {
  readonly sink: LogSink;
  /** The file this sink writes to. */
  readonly path: string;
}

const LOG_FILE = /^orglens-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DEFAULT_KEEP_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Creates a sink that appends to the log file of the current day (UTC), and
 * removes log files older than `keepDays` days.
 *
 * All runs of one day share a file, so a long run never loses its file to
 * the clean-up of a later run. Lines are appended synchronously, so a crash
 * loses nothing that was logged before it. The folder and the files are
 * readable by the owner only, where the platform supports that.
 *
 * Setting up can fail: this function throws if the folder cannot be created
 * or the file cannot be opened for appending (no permission, read-only
 * disk). The caller decides whether to go on without a log file. An old file
 * that cannot be removed is left in place and never stops the program.
 */
export function createFileSink(options: FileSinkOptions): FileSink {
  const keepDays =
    Number.isInteger(options.keepDays) && (options.keepDays ?? 0) >= 1
      ? (options.keepDays ?? DEFAULT_KEEP_DAYS)
      : DEFAULT_KEEP_DAYS;
  const today = (options.now ?? (() => new Date()))().toISOString().slice(0, 10);
  mkdirSync(options.dir, { recursive: true, mode: 0o700 });

  const path = join(options.dir, `orglens-${today}.jsonl`);
  appendFileSync(path, '', { mode: 0o600 });

  // The oldest day that is kept. Dates in this form compare as text.
  const oldestKept = new Date(Date.parse(`${today}T00:00:00Z`) - (keepDays - 1) * DAY_MS).toISOString().slice(0, 10);
  for (const entry of readdirSync(options.dir, { withFileTypes: true })) {
    const day = LOG_FILE.exec(entry.name)?.[1];
    if (day === undefined || !entry.isFile() || day >= oldestKept) continue;
    try {
      rmSync(join(options.dir, entry.name), { force: true });
    } catch {
      // Open in another program, or not ours to delete. It is tried again on the next run.
    }
  }

  return {
    path,
    sink: (line) => {
      appendFileSync(path, `${line}\n`, { mode: 0o600 });
    },
  };
}
