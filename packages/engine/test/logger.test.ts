import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileSink, createLogger, type LoggerOptions } from '../src/core/logger.ts';
import { REDACTED } from '../src/core/redact.ts';

const at = (iso: string) => (): Date => new Date(iso);

const capture = (options: Partial<LoggerOptions> = {}) => {
  const lines: string[] = [];
  const logger = createLogger({ sink: (line) => lines.push(line), now: at('2026-11-12T08:09:10.123Z'), ...options });
  const records = (): Record<string, unknown>[] => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, records };
};

describe('createLogger', () => {
  it('writes one JSON object per line with time, level, event and fields', () => {
    const { logger, lines, records } = capture();
    logger.info('retrieve.chunk.done', { chunk: 2, components: 120 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(records()).toEqual([
      { time: '2026-11-12T08:09:10.123Z', level: 'info', event: 'retrieve.chunk.done', chunk: 2, components: 120 },
    ]);
  });

  it('writes info and above by default, and from the chosen level otherwise', () => {
    const normal = capture();
    normal.logger.debug('a');
    normal.logger.info('b');
    normal.logger.warn('c');
    normal.logger.error('d');
    expect(normal.records().map((record) => record['level'])).toEqual(['info', 'warn', 'error']);

    const verbose = capture({ level: 'debug' });
    verbose.logger.debug('a');
    expect(verbose.records().map((record) => record['event'])).toEqual(['a']);

    const quiet = capture({ level: 'error' });
    quiet.logger.warn('a');
    quiet.logger.error('b');
    expect(quiet.records().map((record) => record['event'])).toEqual(['b']);
  });

  it('adds the fields of a child logger to every record, and lets a call override them', () => {
    const { logger, records } = capture();
    const child = logger.child({ source: 'prod', snapshot: 7 }).child({ step: 'retrieve' });
    child.info('start');
    child.info('retry', { step: 'retrieve-again' });
    logger.info('other');
    expect(records().map((record) => ({ ...record, time: undefined, level: undefined }))).toEqual([
      { event: 'start', source: 'prod', snapshot: 7, step: 'retrieve' },
      { event: 'retry', source: 'prod', snapshot: 7, step: 'retrieve-again' },
      { event: 'other' },
    ]);
  });

  it('never lets a field replace the time, the level or the event', () => {
    const { logger, records } = capture();
    logger.warn('real', { time: 'fake', level: 'fake', event: 'fake' });
    expect(records()).toEqual([
      {
        time: '2026-11-12T08:09:10.123Z',
        level: 'warn',
        event: 'real',
        'field.time': 'fake',
        'field.level': 'fake',
        'field.event': 'fake',
      },
    ]);
  });

  it('masks credentials before a record reaches the sink', () => {
    const { logger, lines } = capture();
    const token = ['00D5g00000', 'AbCdE', '!', 'AQEAQ', 'y'.repeat(40)].join('');
    logger.error('login.failed', {
      accessToken: token,
      error: new Error(`server said: invalid session ${token}`),
      url: `https://acme.my.salesforce.example/?sid=${token}`,
    });
    expect(lines[0]).not.toContain('AQEAQ');
    expect(lines[0]).toContain(REDACTED);
  });

  it('writes a record even when a field cannot be expressed in JSON', () => {
    const { logger, records } = capture();
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    logger.info('odd', { loop, big: 10n });
    expect(records()[0]).toMatchObject({ event: 'odd', loop: { self: '[circular]' }, big: '10' });
  });

  it('survives a sink that throws', () => {
    const logger = createLogger({
      sink: () => {
        throw new Error('disk full');
      },
    });
    expect(() => {
      logger.error('anything');
    }).not.toThrow();
  });

  it('treats a level it does not know as the default, never as "write everything"', () => {
    const typo = capture({ level: 'verbose' as 'debug' });
    typo.logger.debug('a');
    typo.logger.info('b');
    expect(typo.records().map((record) => record['event'])).toEqual(['b']);
  });

  it('never throws, and writes a short record when the real one cannot be built', () => {
    const { logger, records } = capture();
    const fields = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get: () => {
        throw new Error('no');
      },
    }) as Record<string, unknown>;
    expect(() => {
      logger.error('direct', fields);
      logger.child(fields).warn('child');
      logger.info('nested', { deep: fields });
    }).not.toThrow();
    expect(records()).toEqual([
      {
        time: '2026-11-12T08:09:10.123Z',
        level: 'error',
        event: 'direct',
        logError: 'The record could not be built: Error',
      },
      {
        time: '2026-11-12T08:09:10.123Z',
        level: 'warn',
        event: 'child',
        logError: 'The record could not be built: Error',
      },
      { time: '2026-11-12T08:09:10.123Z', level: 'info', event: 'nested', deep: '[unreadable]' },
    ]);
  });

  it('falls back to the system clock when the given clock fails', () => {
    for (const now of [
      (): Date => new Date(Number.NaN),
      (): Date => {
        throw new Error('no clock');
      },
    ]) {
      const { logger, records } = capture({ now });
      logger.info('still written');
      expect(Math.abs(Date.now() - Date.parse(String(records()[0]?.['time'])))).toBeLessThan(60_000);
    }
  });

  it('does not leave a rejection unhandled when the sink turns out to be asynchronous', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', listener);
    try {
      const sink = (() => Promise.reject(new Error('disk full'))) as unknown as LoggerOptions['sink'];
      createLogger({ sink }).error('anything');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', listener);
    }
  });

  it('uses the system clock when none is given', () => {
    const lines: string[] = [];
    createLogger({ sink: (line) => lines.push(line) }).info('now');
    const time = (JSON.parse(lines[0] ?? '{}') as { time: string }).time;
    expect(Math.abs(Date.now() - Date.parse(time))).toBeLessThan(60_000);
  });
});

describe('createFileSink', () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'orglens-logs-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('creates the folder and appends lines to the file of the day', () => {
    const dir = join(tempDir(), 'nested', 'logs');
    const { sink, path } = createFileSink({ dir, now: at('2026-11-12T23:59:59.999Z') });
    expect(basename(path)).toBe('orglens-2026-11-12.jsonl');
    expect(readFileSync(path, 'utf8')).toBe('');
    sink('{"a":1}');
    sink('{"b":2}');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  it.skipIf(process.platform === 'win32')('keeps the folder and the file to the owner', () => {
    const dir = join(tempDir(), 'logs');
    const { path } = createFileSink({ dir });
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('works as the sink of a logger', () => {
    const { sink, path } = createFileSink({ dir: tempDir() });
    createLogger({ sink, now: at('2026-11-12T08:09:10.000Z') }).info('snapshot.done', { components: 3 });
    expect(readFileSync(path, 'utf8')).toBe(
      '{"time":"2026-11-12T08:09:10.000Z","level":"info","event":"snapshot.done","components":3}\n',
    );
  });

  it('lets every run of one day append to the same file', () => {
    const dir = tempDir();
    const first = createFileSink({ dir, now: at('2026-11-12T00:00:00Z') });
    const second = createFileSink({ dir, now: at('2026-11-12T18:00:00Z') });
    expect(second.path).toBe(first.path);
    first.sink('1');
    second.sink('2');
    first.sink('3');
    expect(readFileSync(first.path, 'utf8')).toBe('1\n2\n3\n');
  });

  const days = (dir: string): string[] =>
    readdirSync(dir)
      .sort()
      .map((name) => name.slice(8, 18));

  it('keeps the files of the last days and removes older ones', () => {
    const dir = tempDir();
    for (let day = 1; day <= 9; day += 1) {
      createFileSink({ dir, keepDays: 3, now: at(`2026-11-0${String(day)}T12:00:00Z`) });
    }
    expect(days(dir)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
  });

  it('keeps 14 days when nothing else is asked for, or when what is asked for is no number of days', () => {
    for (const keepDays of [undefined, Number.NaN, 0, -1, 2.5]) {
      const dir = tempDir();
      for (const day of ['2026-10-01', '2026-10-29', '2026-10-30', '2026-11-11']) {
        writeFileSync(join(dir, `orglens-${day}.jsonl`), 'old\n');
      }
      createFileSink({ dir, ...(keepDays === undefined ? {} : { keepDays }), now: at('2026-11-12T00:00:00Z') });
      expect(days(dir)).toEqual(['2026-10-30', '2026-11-11', '2026-11-12']);
    }
  });

  it('never removes the file a longer run is still writing to', () => {
    const dir = tempDir();
    const longRun = createFileSink({ dir, keepDays: 2, now: at('2026-11-11T23:00:00Z') });
    longRun.sink('before midnight');
    createFileSink({ dir, keepDays: 2, now: at('2026-11-12T00:30:00Z') });
    longRun.sink('after midnight');
    expect(readFileSync(longRun.path, 'utf8')).toBe('before midnight\nafter midnight\n');
  });

  it('never touches other files, and is not stopped by something it cannot remove', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    writeFileSync(join(dir, 'orglens-custom.jsonl'), 'not ours\n');
    writeFileSync(join(dir, 'orglens-20200101T000000Z-1.jsonl'), 'not ours either\n');
    // A folder with the name of an old log file cannot be removed like a file.
    mkdirSync(join(dir, 'orglens-2020-01-01.jsonl'));
    writeFileSync(join(dir, 'orglens-2020-01-02.jsonl'), 'old\n');
    const { path } = createFileSink({ dir, now: at('2026-11-12T00:00:00Z') });
    expect(readdirSync(dir).sort()).toEqual(
      [
        basename(path),
        'notes.txt',
        'orglens-custom.jsonl',
        'orglens-20200101T000000Z-1.jsonl',
        'orglens-2020-01-01.jsonl',
      ].sort(),
    );
  });
});
