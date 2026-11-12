/**
 * The reference vocabulary.
 *
 * A reference is a directed link from one component to another: "this method
 * reads that field". The vocabulary is closed. A new kind, origin or
 * confidence tier is a design decision, never a side effect of a new parser.
 */
import { EngineError, type JsonValue } from './errors.ts';
import { isComponentKey, type ComponentKey } from './keys.ts';

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
export type StoredReferenceKind = Exclude<ReferenceKind, 'contains'>;

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
export interface SourceLocation {
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
  /** The metadata type of the target, known even when `to` is `null`. */
  readonly toType: string;
  /** The target as it was written in the source. */
  readonly toNameRaw: string;
  readonly kind: StoredReferenceKind;
  readonly origin: ReferenceOrigin;
  readonly confidence: ConfidenceTier;
  readonly resolution: Resolution;
  /** Where in the source the reference was found. Absent for origins that carry no position. */
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

/**
 * Checks a reference against the rules of the vocabulary and returns it.
 *
 * The rules that go beyond the types:
 * - `contains` is never stored as a reference;
 * - a `resolved` reference has a target key, and only a `resolved` one has;
 * - a `dynamic` reference is never `confirmed`;
 * - lines and columns start at 1, and file paths use forward slashes.
 */
export function validateReference(reference: Reference): Reference {
  const fail = (message: string): never => {
    throw new EngineError('REFERENCE_INVALID', message, {
      details: { from: String(reference.from), to: reference.to === null ? null : String(reference.to) },
    });
  };

  if (!isComponentKey(reference.from)) fail('The start of a reference must be a component key.');
  if (reference.to !== null && !isComponentKey(reference.to)) {
    fail('The target of a reference must be a component key or null.');
  }
  if (!isReferenceKind(reference.kind)) fail(`"${String(reference.kind)}" is not a kind of reference.`);
  if ((reference.kind as ReferenceKind) === 'contains') {
    fail('Containment is stored on the component and never as a reference.');
  }
  if (!isReferenceOrigin(reference.origin)) fail(`"${String(reference.origin)}" is not a reference origin.`);
  if (!isConfidenceTier(reference.confidence)) fail(`"${String(reference.confidence)}" is not a confidence tier.`);
  if (!isResolution(reference.resolution)) fail(`"${String(reference.resolution)}" is not a resolution.`);
  if (reference.toType === '') fail('A reference must state the metadata type of its target.');
  if (reference.toNameRaw === '') fail('A reference must keep the target as it was written.');

  if (reference.resolution === 'resolved' && reference.to === null) {
    fail('A resolved reference must have a target key.');
  }
  if (reference.resolution === 'unresolved' && reference.to !== null) {
    fail('An unresolved reference must not have a target key.');
  }
  if (reference.resolution === 'dynamic' && reference.confidence === 'confirmed') {
    fail('A reference whose target is decided at run time cannot be confirmed.');
  }

  const location = reference.location;
  if (location !== undefined) {
    if (location.file === '' || location.file.includes('\\')) {
      fail('The file of a source location is a non-empty path with forward slashes.');
    }
    if (!isPositiveInteger(location.line)) fail('The line of a source location starts at 1.');
    if (location.column !== undefined && !isPositiveInteger(location.column)) {
      fail('The column of a source location starts at 1.');
    }
  }
  return reference;
}
