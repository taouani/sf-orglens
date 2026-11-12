import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/core/errors.ts';
import { buildKey } from '../src/core/keys.ts';
import {
  compareConfidence,
  CONFIDENCE_TIERS,
  isConfidenceTier,
  isReferenceKind,
  isReferenceOrigin,
  isResolution,
  REFERENCE_KINDS,
  REFERENCE_ORIGINS,
  RESOLUTIONS,
  validateReference,
  type Reference,
} from '../src/core/references.ts';

const from = buildKey({ type: 'ApexClass', fullName: 'AccountService', subs: [{ kind: 'method', name: 'run()' }] });
const to = buildKey({ type: 'CustomField', fullName: 'Account.Industry' });

const valid: Reference = {
  from,
  to,
  toType: 'CustomField',
  toNameRaw: 'Account.Industry',
  kind: 'reads',
  origin: 'parser:apex',
  confidence: 'confirmed',
  resolution: 'resolved',
  location: { file: 'force-app/main/default/classes/AccountService.cls', line: 12, column: 9 },
  attrs: { via: 'soql-select' },
};

const expectRejected = (change: Record<string, unknown>, message: RegExp): void => {
  let thrown: unknown;
  try {
    validateReference({ ...valid, ...change });
  } catch (error) {
    thrown = error;
  }
  expect(thrown, JSON.stringify(change)).toBeInstanceOf(EngineError);
  expect((thrown as EngineError).code).toBe('REFERENCE_INVALID');
  expect((thrown as EngineError).message).toMatch(message);
};

describe('the reference vocabulary', () => {
  // The vocabulary is closed. A change to any of these lists is a design decision and shows up here.
  it('is exactly the agreed lists', () => {
    expect(REFERENCE_KINDS).toEqual([
      'contains',
      'reads',
      'writes',
      'calls',
      'extends',
      'implements',
      'uses-type',
      'triggers-on',
      'grants',
      'references',
    ]);
    expect(REFERENCE_ORIGINS).toEqual([
      'parser:xml',
      'parser:formula',
      'parser:flow',
      'parser:apex',
      'symboltable',
      'dependency-api',
    ]);
    expect(CONFIDENCE_TIERS).toEqual(['confirmed', 'probable', 'possible']);
    expect(RESOLUTIONS).toEqual(['resolved', 'unresolved', 'external', 'dynamic']);
  });

  it('has guards that accept the members and nothing else', () => {
    expect(REFERENCE_KINDS.every(isReferenceKind)).toBe(true);
    expect(REFERENCE_ORIGINS.every(isReferenceOrigin)).toBe(true);
    expect(CONFIDENCE_TIERS.every(isConfidenceTier)).toBe(true);
    expect(RESOLUTIONS.every(isResolution)).toBe(true);
    for (const guard of [isReferenceKind, isReferenceOrigin, isConfidenceTier, isResolution]) {
      expect(guard('READS')).toBe(false);
      expect(guard('')).toBe(false);
      expect(guard(1)).toBe(false);
      expect(guard(undefined)).toBe(false);
    }
  });

  it('orders confidence tiers strongest first', () => {
    expect([...CONFIDENCE_TIERS].reverse().sort(compareConfidence)).toEqual(['confirmed', 'probable', 'possible']);
    expect(compareConfidence('confirmed', 'possible')).toBeLessThan(0);
    expect(compareConfidence('probable', 'probable')).toBe(0);
  });
});

describe('validateReference', () => {
  it('returns a valid reference unchanged', () => {
    expect(validateReference(valid)).toBe(valid);
  });

  it('accepts the other shapes a reference can have', () => {
    const accepted = (change: Partial<Reference>): void => {
      expect(() => validateReference({ ...valid, ...change }), JSON.stringify(change)).not.toThrow();
    };
    // A named target the snapshot does not hold, whether the source is certain of the name or not.
    accepted({ to: null, resolution: 'unresolved', confidence: 'probable' });
    accepted({ to: null, resolution: 'unresolved', confidence: 'confirmed' });
    // A target outside the snapshot, with or without a key.
    accepted({ to: null, resolution: 'external' });
    accepted({ resolution: 'external' });
    // A field decided at run time: the reference points at the object.
    const object = buildKey({ type: 'CustomObject', fullName: 'Account' });
    accepted({ to: object, toType: 'CustomObject', resolution: 'dynamic', confidence: 'possible' });
    accepted({ to: object, toType: 'CustomObject', resolution: 'dynamic', confidence: 'probable' });
    // A type the engine does not know by name.
    accepted({ to: buildKey({ type: 'CustomLabel', fullName: 'Greeting' }), toType: 'CustomLabel' });
  });

  it('asks a parser for a full location, and lets Salesforce data come without one', () => {
    const bare: Reference = {
      from: valid.from,
      to: valid.to,
      toType: valid.toType,
      toNameRaw: valid.toNameRaw,
      kind: valid.kind,
      origin: 'dependency-api',
      confidence: valid.confidence,
      resolution: valid.resolution,
    };
    expect(() => validateReference(bare)).not.toThrow();
    expect(() => validateReference({ ...bare, origin: 'symboltable' })).not.toThrow();
    expect(() =>
      validateReference({ ...bare, origin: 'symboltable', location: { file: 'a.cls', line: 1 } }),
    ).not.toThrow();
    for (const origin of REFERENCE_ORIGINS.filter((one) => one.startsWith('parser:'))) {
      expect(() => validateReference({ ...valid, origin })).not.toThrow();
      expectRejected({ origin, location: undefined }, /must have a source location/);
      expectRejected({ origin, location: { file: 'a.cls', line: 1 } }, /a parser always gives one/);
    }
  });

  it('rejects ends that are not component keys', () => {
    expectRejected({ from: 'AccountService' }, /start of a reference/);
    expectRejected({ to: 'Account.Industry' }, /target of a reference/);
  });

  it('rejects words outside the vocabulary', () => {
    expectRejected({ kind: 'uses' }, /"uses" is not a kind of reference/);
    expectRejected({ origin: 'guess' }, /not a reference origin/);
    expectRejected({ confidence: 'certain' }, /not a confidence tier/);
    expectRejected({ resolution: 'found' }, /not a resolution/);
  });

  it('never stores containment as a reference', () => {
    expectRejected({ kind: 'contains' }, /Containment is stored on the component/);
  });

  it('requires the type and the written form of the target', () => {
    expectRejected({ toType: '' }, /metadata type of its target/);
    expectRejected({ toType: 'custom field!' }, /metadata type of its target/);
    expectRejected({ toType: 'customfield' }, /metadata type of its target/);
    expectRejected({ toType: 7 }, /metadata type of its target/);
    expectRejected({ toType: 'CustomObject' }, /must be the type of the target key/);
    expectRejected({ toNameRaw: '' }, /as it was written/);
    expectRejected({ toNameRaw: undefined }, /as it was written/);
  });

  it('keeps resolution and target consistent', () => {
    expectRejected({ to: null }, /resolved reference must have a target key/);
    expectRejected({ resolution: 'unresolved' }, /unresolved reference must not have a target key/);
  });

  it('gives every possible reference a target: the object is known, or it is no reference', () => {
    expectRejected(
      { to: null, resolution: 'dynamic', confidence: 'possible' },
      /possible reference must have a target/,
    );
    expectRejected(
      { to: null, resolution: 'external', confidence: 'possible' },
      /possible reference must have a target/,
    );
  });

  it('never calls a run-time target confirmed', () => {
    expectRejected({ resolution: 'dynamic' }, /cannot be confirmed/);
  });

  it('rejects positions that do not start at 1 and paths with backslashes', () => {
    expectRejected({ location: { file: 'a.cls', line: 0 } }, /line of a source location/);
    expectRejected({ location: { file: 'a.cls', line: -1, column: 1 } }, /line of a source location/);
    expectRejected({ location: { file: 'a.cls', line: '3', column: 1 } }, /line of a source location/);
    expectRejected({ location: { file: 'a.cls', line: 3, column: -2 } }, /column of a source location/);
    expectRejected({ location: { file: 'a.cls', line: 3, column: 1.5 } }, /column of a source location/);
    expectRejected({ location: null }, /source location is an object/);
    expectRejected({ location: 'a.cls:3' }, /source location is an object/);
    expectRejected({ location: { line: 3, column: 1 } }, /forward slashes/);
    expectRejected({ location: { file: 'a.cls', line: 1.5 } }, /line of a source location/);
    expectRejected({ location: { file: 'a.cls', line: 3, column: 0 } }, /column of a source location/);
    expectRejected({ location: { file: 'classes\\a.cls', line: 3 } }, /forward slashes/);
    expectRejected({ location: { file: '', line: 3 } }, /forward slashes/);
  });

  it('names both ends in the error details', () => {
    try {
      validateReference({ ...valid, kind: 'contains' as 'reads' });
      expect.unreachable();
    } catch (error) {
      expect((error as EngineError).details).toEqual({ from, to });
    }
  });
});
