/**
 * The reference vocabulary.
 *
 * A reference is a directed link from one component to another: "this method
 * reads that field". The vocabulary is closed. A new kind, origin or
 * confidence tier is a design decision, never a side effect of a new parser.
 */
import { EngineError, type JsonValue } from './errors.ts';
import { canonicalType, parseKey, type ComponentKey } from './keys.ts';

/**
 * What a reference says about its two ends.
 *
 * `contains` is special: containment is stored on the component (its parent
 * key) and is offered by the engines as if it were a reference. It is never
 * stored as a reference record.
 */
export const REFERENCE_KINDS = [
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
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/** The kinds that are stored as reference records. */
type StoredReferenceKind = Exclude<ReferenceKind, 'contains'>;

/** Where a reference was learned from. */
export const REFERENCE_ORIGINS = [
  'parser:xml',
  'parser:formula',
  'parser:flow',
  'parser:apex',
  'symboltable',
  'dependency-api',
] as const;
export type ReferenceOrigin = (typeof REFERENCE_ORIGINS)[number];

/**
 * How certain a reference is, strongest first.
 *
 * - `confirmed`: resolved statically or fully.
 * - `probable`: resolved from text or metadata, with the object identified.
 * - `possible`: the object is known and the field is decided at run time.
 */
export const CONFIDENCE_TIERS = ['confirmed', 'probable', 'possible'] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/**
 * What became of the target of a reference.
 *
 * - `resolved`: the target is a component of the same snapshot.
 * - `unresolved`: the target was named but no such component was found.
 * - `external`: the target lies outside the snapshot, for example in a managed package.
 * - `dynamic`: the target is decided at run time and only partly known.
 */
export const RESOLUTIONS = ['resolved', 'unresolved', 'external', 'dynamic'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** A position in a source file. Lines and columns start at 1. */
interface SourceLocation {
  /** Path of the file inside the source, with forward slashes. */
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

export interface Reference {
  /** The component the reference starts from. */
  readonly from: ComponentKey;
  /** The component it points at, or `null` when the target could not be resolved to a key. */
  readonly to: ComponentKey | null;
  /** The metadata type of the target, known even when `to` is `null`. With a target key, it is the type of that key. */
  readonly toType: string;
  /** The target as it was written in the source. */
  readonly toNameRaw: string;
  readonly kind: StoredReferenceKind;
  readonly origin: ReferenceOrigin;
  readonly confidence: ConfidenceTier;
  readonly resolution: Resolution;
  /**
   * Where in the source the reference was found. A reference a parser found always has one, with a column. The
   * origins `symboltable` and `dependency-api` report what Salesforce knows and may carry no position.
   */
  readonly location?: SourceLocation;
  /** Details that depend on the kind, such as `{ op: 'update' }` on a write. */
  readonly attrs?: Readonly<Record<string, JsonValue>>;
}

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

export const isReferenceKind = (value: unknown): value is ReferenceKind => isOneOf(REFERENCE_KINDS, value);
export const isReferenceOrigin = (value: unknown): value is ReferenceOrigin => isOneOf(REFERENCE_ORIGINS, value);
export const isConfidenceTier = (value: unknown): value is ConfidenceTier => isOneOf(CONFIDENCE_TIERS, value);
export const isResolution = (value: unknown): value is Resolution => isOneOf(RESOLUTIONS, value);

/** Orders confidence tiers, strongest first: negative if `a` is stronger than `b`. */
export function compareConfidence(a: ConfidenceTier, b: ConfidenceTier): number {
  return CONFIDENCE_TIERS.indexOf(a) - CONFIDENCE_TIERS.indexOf(b);
}

const isPositiveInteger = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 1;

/** The type of a key, or `undefined` if the text is no key. */
function typeOfKey(key: unknown): string | undefined {
  if (typeof key !== 'string') return undefined;
  try {
    return parseKey(key).type;
  } catch {
    return undefined;
  }
}

function isTypeName(type: unknown): boolean {
  if (typeof type !== 'string') return false;
  try {
    return canonicalType(type) === type;
  } catch {
    return false;
  }
}

/**
 * Checks a reference against the rules of the vocabulary and returns it.
 *
 * The rules that go beyond the types:
 * - `contains` is never stored as a reference;
 * - the type of the target is a metadata type name, and the type of the target key if there is one;
 * - a `resolved` reference has a target key and an `unresolved` one has none. An `external` or `dynamic` one may
 *   have one: the component in a managed package, or the object whose field is decided at run time;
 * - a `possible` reference has a target key: the object is known, or it would not be a reference;
 * - a `dynamic` reference is never `confirmed`. A `confirmed` one may be `unresolved`: the source names the target
 *   with certainty and the snapshot does not hold it;
 * - a reference a parser found has a location with a line and a column, both starting at 1, and file paths use
 *   forward slashes.
 */
export function validateReference(reference: Reference): Reference {
  const fail = (message: string): never => {
    throw new EngineError('REFERENCE_INVALID', message, {
      details: { from: String(reference.from), to: reference.to === null ? null : String(reference.to) },
    });
  };

  if (typeOfKey(reference.from) === undefined) fail('The start of a reference must be a component key.');
  const targetType = reference.to === null ? null : typeOfKey(reference.to);
  if (targetType === undefined) fail('The target of a reference must be a component key or null.');
  if (!isReferenceKind(reference.kind)) fail(`"${String(reference.kind)}" is not a kind of reference.`);
  if ((reference.kind as ReferenceKind) === 'contains') {
    fail('Containment is stored on the component and never as a reference.');
  }
  if (!isReferenceOrigin(reference.origin)) fail(`"${String(reference.origin)}" is not a reference origin.`);
  if (!isConfidenceTier(reference.confidence)) fail(`"${String(reference.confidence)}" is not a confidence tier.`);
  if (!isResolution(reference.resolution)) fail(`"${String(reference.resolution)}" is not a resolution.`);
  if (!isTypeName(reference.toType)) fail('A reference must state the metadata type of its target.');
  if (targetType !== null && targetType !== reference.toType) {
    fail('The stated type of the target must be the type of the target key.');
  }
  if (typeof reference.toNameRaw !== 'string' || reference.toNameRaw === '') {
    fail('A reference must keep the target as it was written.');
  }

  if (reference.resolution === 'resolved' && reference.to === null) {
    fail('A resolved reference must have a target key.');
  }
  if (reference.resolution === 'unresolved' && reference.to !== null) {
    fail('An unresolved reference must not have a target key.');
  }
  if (reference.confidence === 'possible' && reference.to === null) {
    fail('A possible reference must have a target key: the object whose field is decided at run time.');
  }
  if (reference.resolution === 'dynamic' && reference.confidence === 'confirmed') {
    fail('A reference whose target is decided at run time cannot be confirmed.');
  }

  const location: unknown = reference.location;
  const fromParser = reference.origin.startsWith('parser:');
  if (location === undefined) {
    if (fromParser) fail('A reference found by a parser must have a source location.');
    return reference;
  }
  if (typeof location !== 'object' || location === null) fail('A source location is an object.');
  const { file, line, column } = location as { file?: unknown; line?: unknown; column?: unknown };
  if (typeof file !== 'string' || file === '' || file.includes('\\')) {
    fail('The file of a source location is a non-empty path with forward slashes.');
  }
  if (!isPositiveInteger(line)) fail('The line of a source location starts at 1.');
  if (column === undefined ? fromParser : !isPositiveInteger(column)) {
    fail('The column of a source location starts at 1, and a parser always gives one.');
  }
  return reference;
}
