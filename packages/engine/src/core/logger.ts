/**
 * The engine's logger: one JSON object per line.
 *
 * Every record passes through `redact` before it is written, so a log never
 * holds a credential. Logs go to files in the workspace, a few recent ones
 * are kept, and nothing is ever sent anywhere.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { redact } from './redact.ts';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

/** Receives one finished log line, without the trailing newline. */
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

/**
 * Creates a logger. `event` is a short, stable name such as
 * `retrieve.chunk.done`; everything that varies goes into the fields.
 */
export function createLogger(options: LoggerOptions): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level ?? 'info');
  const now = options.now ?? (() => new Date());

  const build = (bound: Record<string, unknown>): Logger => {
    const write = (level: LogLevel, event: string, fields: Record<string, unknown> = {}): void => {
      if (LOG_LEVELS.indexOf(level) < threshold) return;
      const record: Record<string, unknown> = { time: now().toISOString(), level, event };
      for (const [name, value] of Object.entries({ ...bound, ...fields })) {
        record[RESERVED.has(name) ? `field.${name}` : name] = value;
      }
      try {
        options.sink(JSON.stringify(redact(record)));
      } catch {
        // A failing log sink must never take the operation down with it.
      }
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
      child: (fields) => build({ ...bound, ...fields }),
    };
  };
  return build({});
}

export interface FileSinkOptions {
  /** The folder for log files. It is created if missing. */
  readonly dir: string;
  /** How many log files to keep, counting the new one. Default 10. */
  readonly keep?: number;
  /** The clock, for tests. Default the system clock. */
  readonly now?: () => Date;
}

export interface FileSink {
  readonly sink: LogSink;
  /** The file this sink writes to. */
  readonly path: string;
}

const LOG_FILE = /^orglens-\d{8}T\d{6}Z-\d+\.jsonl$/;

/**
 * Creates a sink that appends to a new log file, and removes the oldest log
 * files beyond `keep`. One file is written per run. Lines are appended
 * synchronously, so a crash loses nothing that was logged before it.
 */
export function createFileSink(options: FileSinkOptions): FileSink {
  const keep = Math.max(1, options.keep ?? 10);
  const stamp = (options.now ?? (() => new Date()))()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  mkdirSync(options.dir, { recursive: true });

  const existing = readdirSync(options.dir).filter((name) => LOG_FILE.test(name));
  let sequence = process.pid;
  while (existing.includes(`orglens-${stamp}-${String(sequence)}.jsonl`)) sequence += 1;
  const name = `orglens-${stamp}-${String(sequence)}.jsonl`;
  const path = join(options.dir, name);
  appendFileSync(path, '');

  // File names sort by time. The new file always stays, so the oldest of the others go.
  const others = existing.sort();
  for (const old of others.slice(0, Math.max(0, others.length - (keep - 1)))) {
    rmSync(join(options.dir, old), { force: true });
  }

  return {
    path,
    sink: (line) => {
      appendFileSync(path, `${line}\n`);
    },
  };
}
