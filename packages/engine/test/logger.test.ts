import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      url: `https://example.my.salesforce.com/?sid=${token}`,
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

  it('creates the folder and appends lines to a file named after the start time', () => {
    const dir = join(tempDir(), 'nested', 'logs');
    const { sink, path } = createFileSink({ dir, now: at('2026-11-12T08:09:10.123Z') });
    expect(basename(path)).toBe(`orglens-20261112T080910Z-${String(process.pid)}.jsonl`);
    expect(readFileSync(path, 'utf8')).toBe('');
    sink('{"a":1}');
    sink('{"b":2}');
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('works as the sink of a logger', () => {
    const { sink, path } = createFileSink({ dir: tempDir() });
    createLogger({ sink, now: at('2026-11-12T08:09:10.000Z') }).info('snapshot.done', { components: 3 });
    expect(readFileSync(path, 'utf8')).toBe(
      '{"time":"2026-11-12T08:09:10.000Z","level":"info","event":"snapshot.done","components":3}\n',
    );
  });

  it('keeps the most recent files and removes the oldest', () => {
    const dir = tempDir();
    for (let day = 1; day <= 5; day += 1) {
      createFileSink({ dir, keep: 3, now: at(`2026-11-0${String(day)}T00:00:00Z`) });
    }
    expect(readdirSync(dir).map((name) => name.slice(0, 24))).toEqual([
      'orglens-20261103T000000Z',
      'orglens-20261104T000000Z',
      'orglens-20261105T000000Z',
    ]);
  });

  it('never removes the file it has just created, and never touches other files', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    writeFileSync(join(dir, 'orglens-20991231T235959Z-1.jsonl'), 'from the future\n');
    writeFileSync(join(dir, 'orglens-custom.jsonl'), 'not ours\n');
    const { path } = createFileSink({ dir, keep: 0, now: at('2026-11-12T00:00:00Z') });
    expect(readdirSync(dir).sort()).toEqual([basename(path), 'notes.txt', 'orglens-custom.jsonl'].sort());
  });

  it('gives two sinks started in the same second different files', () => {
    const dir = tempDir();
    const first = createFileSink({ dir, now: at('2026-11-12T00:00:00Z') });
    const second = createFileSink({ dir, now: at('2026-11-12T00:00:00Z') });
    expect(second.path).not.toBe(first.path);
    first.sink('1');
    second.sink('2');
    expect(readFileSync(first.path, 'utf8')).toBe('1\n');
    expect(readFileSync(second.path, 'utf8')).toBe('2\n');
  });
});
