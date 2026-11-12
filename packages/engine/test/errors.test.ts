import { describe, expect, it } from 'vitest';
import { EngineError, ERROR_CODES, isEngineError, toEngineError } from '../src/core/errors.ts';

describe('EngineError', () => {
  it('carries a stable code, a message, a hint and details', () => {
    const cause = new Error('low-level');
    const error = new EngineError('KEY_INVALID', 'Bad key.', { hint: 'Check the name.', details: { key: 'x' }, cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EngineError');
    expect(error.code).toBe('KEY_INVALID');
    expect(error.message).toBe('Bad key.');
    expect(error.hint).toBe('Check the name.');
    expect(error.details).toEqual({ key: 'x' });
    expect(error.cause).toBe(cause);
  });

  it('has a JSON form without the cause and without empty fields', () => {
    const full = new EngineError('KEY_INVALID', 'Bad key.', {
      hint: 'h',
      details: { key: 'x' },
      cause: new Error('c'),
    });
    expect(JSON.parse(JSON.stringify(full))).toEqual({
      code: 'KEY_INVALID',
      message: 'Bad key.',
      hint: 'h',
      details: { key: 'x' },
    });
    expect(JSON.parse(JSON.stringify(new EngineError('INTERNAL', 'Broken.')))).toEqual({
      code: 'INTERNAL',
      message: 'Broken.',
    });
  });

  // The codes are a public contract. Adding one is a deliberate change to this list.
  it('has exactly the documented codes', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual([
      'CONFIG_INVALID',
      'CONFIG_NOT_EDITABLE',
      'INTERNAL',
      'KEY_INVALID',
      'REFERENCE_INVALID',
      'SNAPSHOT_NOT_FOUND',
      'SOURCE_EXISTS',
      'SOURCE_INVALID',
      'SOURCE_IN_USE',
      'SOURCE_NOT_FOUND',
      'SOURCE_READ_FAILED',
      'STORE_BUSY',
      'STORE_FAILED',
      'STORE_FOREIGN',
      'STORE_MIGRATION_FAILED',
      'STORE_NEWER',
      'STORE_NOT_FOUND',
      'STORE_OUTDATED',
      'WORKSPACE_EXISTS',
      'WORKSPACE_IO',
      'WORKSPACE_NOT_FOUND',
    ]);
    for (const description of Object.values(ERROR_CODES)) expect(description).toMatch(/\.$/);
  });
});

describe('isEngineError', () => {
  it('recognises an engine error, also one from another copy of the package', () => {
    expect(isEngineError(new EngineError('INTERNAL', 'x'))).toBe(true);
    // A second copy of the class, as a second installed copy of the package would have.
    class OtherCopy extends Error {
      readonly code = 'KEY_INVALID';
      override readonly name = 'EngineError';
      toJSON(): { code: string; message: string } {
        return { code: this.code, message: this.message };
      }
    }
    const foreign: unknown = new OtherCopy('x');
    expect(isEngineError(foreign)).toBe(true);
    expect(toEngineError(foreign)).toBe(foreign);
    expect(toEngineError(foreign).toJSON()).toEqual({ code: 'KEY_INVALID', message: 'x' });
  });

  it('rejects everything else', () => {
    expect(isEngineError(new Error('x'))).toBe(false);
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 'NOT_A_CODE' }))).toBe(false);
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 7 }))).toBe(false);
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 'toString' }))).toBe(false);
    expect(isEngineError({ name: 'EngineError', code: 'INTERNAL', message: 'x' })).toBe(false);
    expect(isEngineError(undefined)).toBe(false);
    // The name and a code are not enough: without `toJSON` it cannot be used as an engine error.
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 'KEY_INVALID' }))).toBe(false);
  });
});

describe('toEngineError', () => {
  it('returns an engine error unchanged', () => {
    const error = new EngineError('KEY_INVALID', 'x');
    expect(toEngineError(error)).toBe(error);
  });

  it('wraps anything else as INTERNAL and keeps it as the cause', () => {
    const original = new TypeError('boom');
    const wrapped = toEngineError(original);
    expect(wrapped.code).toBe('INTERNAL');
    expect(wrapped.message).toBe('boom');
    expect(wrapped.cause).toBe(original);

    expect(toEngineError('text').message).toBe('text');
    expect(toEngineError(new Error('')).message).toBe('Unknown error');
    expect(toEngineError(undefined).message).toBe('undefined');
  });

  it('never throws, whatever was thrown at it', () => {
    expect(toEngineError(Object.create(null)).message).toBe('Unknown error');
    expect(toEngineError({ message: 'real reason' }).message).toBe('real reason');
    expect(toEngineError({ message: 7 }).message).toBe('[object Object]');
    expect(toEngineError(Symbol('s')).message).toBe('Symbol(s)');
    expect(toEngineError(null).message).toBe('null');
  });

  it('masks credentials in a message the engine did not write', () => {
    const token = ['00D5g00000', 'AbCdE', '!', 'AQEAQ', 'z'.repeat(40)].join('');
    const wrapped = toEngineError(new Error(`session ${token} is invalid, see https://x.example/?sid=abc`));
    expect(wrapped.toJSON()).toEqual({
      code: 'INTERNAL',
      message: 'session [REDACTED] is invalid, see https://x.example/?sid=[REDACTED]',
    });
  });

  it('keeps the code an engine error from a newer copy of the package reported', () => {
    const newer = Object.assign(new Error('The snapshot is locked.'), { name: 'EngineError', code: 'NOT_YET_KNOWN' });
    expect(toEngineError(newer).toJSON()).toEqual({
      code: 'INTERNAL',
      message: 'The snapshot is locked.',
      details: { reportedCode: 'NOT_YET_KNOWN' },
    });
  });
});
