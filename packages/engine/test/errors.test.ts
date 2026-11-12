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
    expect(Object.keys(ERROR_CODES).sort()).toEqual(['INTERNAL', 'KEY_INVALID', 'REFERENCE_INVALID']);
    for (const description of Object.values(ERROR_CODES)) expect(description).toMatch(/\.$/);
  });
});

describe('isEngineError', () => {
  it('recognises an engine error, also one from another copy of the package', () => {
    expect(isEngineError(new EngineError('INTERNAL', 'x'))).toBe(true);
    const foreign = Object.assign(new Error('x'), { name: 'EngineError', code: 'KEY_INVALID' });
    expect(isEngineError(foreign)).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isEngineError(new Error('x'))).toBe(false);
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 'NOT_A_CODE' }))).toBe(false);
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 7 }))).toBe(false);
    expect(isEngineError(Object.assign(new Error('x'), { name: 'EngineError', code: 'toString' }))).toBe(false);
    expect(isEngineError({ name: 'EngineError', code: 'INTERNAL', message: 'x' })).toBe(false);
    expect(isEngineError(undefined)).toBe(false);
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
});
