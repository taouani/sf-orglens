/**
 * The `api` layer: the only layer clients see.
 *
 * It may import from every other layer. No other layer may import from it.
 */
export { engineVersion } from '../core/version.ts';

export { EngineError, ERROR_CODES, isEngineError } from '../core/errors.ts';
export type { EngineErrorJson, EngineErrorOptions, ErrorCode, JsonValue } from '../core/errors.ts';

export { apexSignature, buildKey, isComponentKey, parentKey, parseKey, SUB_KINDS } from '../core/keys.ts';
export type { ComponentKey, KeyParts, ParsedKey, SubComponent, SubKind } from '../core/keys.ts';

export { CONFIDENCE_TIERS, REFERENCE_KINDS, REFERENCE_ORIGINS, RESOLUTIONS } from '../core/references.ts';
export type {
  ConfidenceTier,
  Reference,
  ReferenceKind,
  ReferenceOrigin,
  Resolution,
  SourceLocation,
  StoredReferenceKind,
} from '../core/references.ts';
