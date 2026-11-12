/**
 * Component keys.
 *
 * A key names one component: a metadata component, or a part of one such as
 * an Apex method or a flow element. The same component has the same key in
 * production, in a sandbox and in a Git repository, so two snapshots can be
 * compared with a join. A key therefore never contains the org, the source,
 * the snapshot, a Salesforce record id, a flow version or a file path.
 *
 * Grammar:
 *
 *   key  = type ":" name [ "#" sub { "/" sub } ]
 *   sub  = kind ":" subname
 *
 * - `type` is the Metadata API type name in its registry spelling, for
 *   example `ApexClass`. All objects are `CustomObject` and all fields are
 *   `CustomField`, standard ones included.
 * - `name` is the Metadata API full name, case-folded. It already contains
 *   the parent object (`account.region__c`) and any namespace prefix.
 * - `kind` is one of `SUB_KINDS`. `subname` is case-folded too.
 *
 * Names are folded so that Apex text such as `ACCOUNT.region__C` resolves,
 * and so that a rename that only changes case is not a delete plus an add.
 * The original spelling is kept by the caller as the display name.
 *
 * Escaping. A key is split at the first ":" and then at the first "#".
 * In `name`, "#" is written `%23` and nothing else is changed: the percent
 * encoding that Salesforce itself applies to full names (`Custom%3A Profile`)
 * is kept as delivered, and the name is never decoded. In `subname`, "%",
 * "#" and "/" are percent-encoded, and decoded again by `parseKey`.
 * Control characters and text that is not well-formed Unicode (a lone
 * surrogate) are rejected everywhere.
 *
 * The name of a method or a constructor ends with its signature, exactly as
 * `apexSignature` writes it. Any other spelling is rejected, so that two
 * producers cannot give one method two keys.
 */
import { EngineError } from './errors.ts';

/** A component key. Build one with `buildKey`, or check a string with `parseKey`. */
export type ComponentKey = string & { readonly __componentKey: unique symbol };

/** The kinds of sub-component a key can address. */
export const SUB_KINDS = ['method', 'ctor', 'prop', 'var', 'inner', 'init', 'element', 'file', 'value'] as const;
type SubKind = (typeof SUB_KINDS)[number];

export interface SubComponent {
  readonly kind: SubKind;
  /**
   * The name of the sub-component, in any case. For a method or a constructor: its name followed by
   * `apexSignature(...)`, for example `run(account,list<string>)`. No other spelling of the signature is accepted.
   */
  readonly name: string;
}

export interface KeyParts {
  /** The Metadata API type name, in any case if it is a known type. */
  readonly type: string;
  /** The Metadata API full name, in its original spelling. */
  readonly fullName: string;
  readonly subs?: readonly SubComponent[];
}

export interface ParsedKey {
  /** The type in registry spelling. */
  readonly type: string;
  /** The folded full name, exactly as it appears in the key. */
  readonly name: string;
  /** The sub-components, with folded and decoded names. */
  readonly subs: readonly SubComponent[];
}

/**
 * Metadata types the engine knows by name, in registry spelling. A known
 * type is accepted in any case and written in this spelling. A type that is
 * not listed is accepted only in the spelling the Metadata API uses (an
 * upper-case letter followed by letters and digits) and is kept as given, so
 * that a new Salesforce metadata type never needs a change here to get a key.
 */
export const KNOWN_TYPES = [
  // Logic tier, covered by the first release.
  'CustomObject',
  'CustomField',
  'ValidationRule',
  'RecordType',
  'FieldSet',
  'ApexClass',
  'ApexTrigger',
  'Flow',
  'WorkflowRule',
  'CustomMetadata',
  'Profile',
  'PermissionSet',
  'PermissionSetGroup',
  'LightningComponentBundle',
  'AuraDefinitionBundle',
  'NamedCredential',
  // Presentation tier, covered later. Listed so that their keys are spelled one way from the start.
  'Layout',
  'FlexiPage',
  'ListView',
  'Report',
  'EmailTemplate',
  'SharingRules',
] as const;

const KNOWN_TYPE_BY_FOLDED_NAME = new Map<string, string>(KNOWN_TYPES.map((type) => [type.toLowerCase(), type]));
const TYPE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const ASCII_LETTERS_AND_DIGITS = /^[A-Za-z0-9]+$/;
/** A signature in canonical form: no whitespace and no empty parameter. A method name stands in front of it. */
const SIGNATURE = String.raw`\((?:[^(),\s]+(?:,[^(),\s]+)*)?\)`;
const METHOD_NAME = new RegExp(`^[^()\\s]+${SIGNATURE}$`);
const CTOR_NAME = new RegExp(`^${SIGNATURE}$`);
const SUB_KIND_SET: ReadonlySet<string> = new Set(SUB_KINDS);
// C0 controls, DEL, C1 controls, and the Unicode line and paragraph separators.
const CONTROL_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** Types whose full name is `Parent.Child`, where the parent is an object. */
const CHILD_OF_OBJECT: ReadonlySet<string> = new Set([
  'CustomField',
  'ValidationRule',
  'RecordType',
  'FieldSet',
  'ListView',
]);

function invalid(message: string, details: Record<string, string>): EngineError {
  return new EngineError('KEY_INVALID', message, { details });
}

/**
 * Folds a name the way keys do: Unicode NFC and lower case, independent of
 * the locale. Folding a folded name changes nothing.
 *
 * This is lower-casing, not full Unicode case folding. Lower-casing has one
 * rule that depends on the neighbours of a letter: a Greek capital sigma
 * becomes "ς" at the end of a word and "σ" elsewhere. Both are written "σ"
 * here, so that a name folds the same way alone and as part of a longer name.
 */
export function foldName(name: string): string {
  return name.normalize('NFC').toLowerCase().replaceAll('\u03C2', '\u03C3').normalize('NFC');
}

/** Returns the registry spelling of a metadata type name. */
export function canonicalType(type: string): string {
  // Only ASCII is compared without case: the Kelvin sign lower-cases to "k" and must not pass as one.
  const known = ASCII_LETTERS_AND_DIGITS.test(type) ? KNOWN_TYPE_BY_FOLDED_NAME.get(type.toLowerCase()) : undefined;
  if (known !== undefined) return known;
  if (!TYPE_PATTERN.test(type)) {
    throw invalid(`"${type}" is not a metadata type name.`, { type });
  }
  return type;
}

function checkText(label: string, text: string, key: string): void {
  if (text === '') throw invalid(`The ${label} of a component key must not be empty.`, { key });
  if (!text.isWellFormed()) {
    // A lone surrogate has no UTF-8 form: stored, two different names would become the same text.
    throw invalid(`The ${label} of a component key must be well-formed Unicode.`, { key: text.toWellFormed() });
  }
  if (CONTROL_CHARACTERS.test(text)) {
    throw invalid(`The ${label} of a component key must not contain control characters.`, { key });
  }
}

function checkSignature(kind: string, name: string, key: string): void {
  const pattern = kind === 'method' ? METHOD_NAME : kind === 'ctor' ? CTOR_NAME : undefined;
  if (pattern === undefined) return;
  if (!pattern.test(name) || name.includes('[]')) {
    const example = kind === 'method' ? 'run(account,list<string>)' : '(account,list<string>)';
    throw invalid(`The name of a ${kind} is written with its signature as apexSignature gives it, like "${example}".`, {
      key,
    });
  }
}

const encodeName = (name: string): string => name.replaceAll('#', '%23');
const encodeSubName = (name: string): string =>
  name.replaceAll('%', '%25').replaceAll('#', '%23').replaceAll('/', '%2F');
const SUB_NAME_ESCAPES: Readonly<Record<string, string>> = { '%25': '%', '%23': '#', '%2F': '/' };
const decodeSubName = (name: string): string =>
  name.replace(/%(?:25|23|2F)/g, (escape) => SUB_NAME_ESCAPES[escape] ?? escape);

function formatKey(type: string, name: string, subs: readonly SubComponent[]): ComponentKey {
  const head = `${type}:${name}`;
  if (subs.length === 0) return head as ComponentKey;
  return `${head}#${subs.map((sub) => `${sub.kind}:${encodeSubName(sub.name)}`).join('/')}` as ComponentKey;
}

/** Builds the key of a component from its type, its full name and an optional path of sub-components. */
export function buildKey(parts: KeyParts): ComponentKey {
  const described = `${parts.type}:${parts.fullName}`;
  const type = canonicalType(parts.type);
  checkText('name', parts.fullName, described);
  const subs = (parts.subs ?? []).map((sub): SubComponent => {
    if (!SUB_KIND_SET.has(sub.kind)) {
      throw invalid(`"${sub.kind}" is not a kind of sub-component.`, { key: described });
    }
    checkText(`${sub.kind} name`, sub.name, described);
    const name = foldName(sub.name);
    checkSignature(sub.kind, name, described);
    return { kind: sub.kind, name };
  });
  return formatKey(type, encodeName(foldName(parts.fullName)), subs);
}

/**
 * Parses a key into its parts and checks that it is in canonical form: the
 * type in registry spelling, the names folded, the escapes as `buildKey`
 * writes them. A string that parses is a `ComponentKey`.
 */
export function parseKey(key: string): ParsedKey {
  const colon = key.indexOf(':');
  if (colon < 1) throw invalid('A component key starts with a metadata type and a colon.', { key });
  const hash = key.indexOf('#', colon);
  const type = key.slice(0, colon);
  const name = key.slice(colon + 1, hash === -1 ? undefined : hash);

  if (canonicalType(type) !== type) {
    throw invalid(`The type of a component key is written "${canonicalType(type)}".`, { key });
  }
  checkText('name', name, key);
  if (foldName(name) !== name) throw invalid('The name in a component key is lower case.', { key });

  const subs: SubComponent[] = [];
  if (hash !== -1) {
    for (const part of key.slice(hash + 1).split('/')) {
      const separator = part.indexOf(':');
      const kind = separator === -1 ? part : part.slice(0, separator);
      if (!SUB_KIND_SET.has(kind)) throw invalid(`"${kind}" is not a kind of sub-component.`, { key });
      const encoded = separator === -1 ? '' : part.slice(separator + 1);
      const subName = decodeSubName(encoded);
      checkText(`${kind} name`, subName, key);
      if (foldName(subName) !== subName || encodeSubName(subName) !== encoded) {
        throw invalid(`The ${kind} name in a component key is lower case and percent-encoded.`, { key });
      }
      checkSignature(kind, subName, key);
      subs.push({ kind: kind as SubKind, name: subName });
    }
  }
  return { type, name, subs };
}

/** True if the text is a component key in canonical form. */
export function isComponentKey(text: string): text is ComponentKey {
  try {
    parseKey(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The key of the component that contains this one, or `undefined` for a
 * top-level component.
 *
 * A sub-component is contained in the component one step up its path. A
 * field, validation rule, record type, field set or list view is contained
 * in its object. A custom metadata record is contained in its type.
 */
export function parentKey(key: ComponentKey): ComponentKey | undefined {
  const { type, name, subs } = parseKey(key);
  if (subs.length > 0) return formatKey(type, name, subs.slice(0, -1));
  // The parent ends at the first dot. A name with nothing before or after it has no parent.
  const dot = name.indexOf('.');
  if (dot < 1 || dot === name.length - 1) return undefined;
  const parent = name.slice(0, dot);
  if (CHILD_OF_OBJECT.has(type)) return formatKey('CustomObject', parent, []);
  if (type === 'CustomMetadata') {
    // The full name of a record is `Type.Record`, without the suffix of the type.
    return formatKey('CustomObject', parent.endsWith('__mdt') ? parent : `${parent}__mdt`, []);
  }
  return undefined;
}

/** Rewrites every array type `T[]` in an Apex type as `list<T>`, also inside type arguments. */
function arraysAsLists(type: string): string {
  let text = type;
  for (let at = text.indexOf('[]'); at !== -1; at = text.indexOf('[]')) {
    // Find where the element type starts: skip back over its type arguments, then over its name.
    let start = at;
    if (text[start - 1] === '>') {
      let depth = 0;
      do {
        start -= 1;
        if (text[start] === '>') depth += 1;
        else if (text[start] === '<') depth -= 1;
      } while (depth > 0 && start > 0);
    }
    while (start > 0 && !'<>,[]'.includes(text.charAt(start - 1))) start -= 1;
    text = `${text.slice(0, start)}list<${text.slice(start, at)}>${text.slice(at + 2)}`;
  }
  return text;
}

/**
 * The canonical signature of an Apex method or constructor: its parameter
 * types, folded, without whitespace, with every `T[]` written as `list<t>`.
 * `apexSignature(['Account', 'String[]'])` is `(account,list<string>)`.
 *
 * A type is taken as it is spelled in the declaration: `Schema.Account` and
 * `Account` give different signatures. Which spelling the Apex resolver
 * hands in is decided with the Apex analysis.
 */
export function apexSignature(parameterTypes: readonly string[]): string {
  const canonical = parameterTypes.map((parameterType) => {
    const type = arraysAsLists(foldName(parameterType).replace(/\s+/g, ''));
    if (type === '' || /[()]/.test(type)) {
      throw invalid(`"${parameterType}" is not an Apex parameter type.`, { type: parameterType });
    }
    return type;
  });
  return `(${canonical.join(',')})`;
}

/** What is known about one component when its key is registered. */
export interface KeyRegistration {
  readonly key: ComponentKey;
  /** The name in its original spelling. */
  readonly displayName: string;
  /** The file the component was read from, if there is one. It tells two components apart whose names look alike. */
  readonly file?: string;
}

/**
 * Two components whose names fold to the same key. The first one registered
 * is kept.
 *
 * A collision is an issue of a snapshot, not a failure of a call, so its code
 * is not one of `ERROR_CODES`. Issue codes are stored with the snapshot.
 */
export interface KeyCollision {
  readonly code: 'KEY_COLLISION';
  readonly severity: 'error';
  readonly key: ComponentKey;
  readonly kept: string;
  readonly dropped: string;
  readonly message: string;
}

/**
 * Collects the keys of one snapshot and reports collisions.
 *
 * Salesforce names are unique without regard to case, so two components with
 * the same key should not exist. If they do (a repository on a case-sensitive
 * file system can hold both `Foo.cls` and `foo.cls`), the second one is not
 * merged into the first and is not dropped silently: it is reported.
 */
export class KeyRegistry {
  readonly #registered = new Map<ComponentKey, KeyRegistration>();
  readonly #collisions: KeyCollision[] = [];

  /** Registers a component. Returns `undefined` if the key was free, and the collision if it was taken. */
  register(registration: KeyRegistration): KeyCollision | undefined {
    const kept = this.#registered.get(registration.key);
    if (kept === undefined) {
      this.#registered.set(registration.key, registration);
      return undefined;
    }
    const describe = (one: KeyRegistration): string =>
      one.file === undefined ? `"${one.displayName}"` : `"${one.displayName}" (${one.file})`;
    const collision: KeyCollision = {
      code: 'KEY_COLLISION',
      severity: 'error',
      key: registration.key,
      kept: kept.displayName,
      dropped: registration.displayName,
      message: `${describe(registration)} and ${describe(kept)} have the same key ${registration.key}. The first one is kept.`,
    };
    this.#collisions.push(collision);
    return collision;
  }

  has(key: ComponentKey): boolean {
    return this.#registered.has(key);
  }

  /** The original spelling of the component registered under this key. */
  displayName(key: ComponentKey): string | undefined {
    return this.#registered.get(key)?.displayName;
  }

  get size(): number {
    return this.#registered.size;
  }

  get collisions(): readonly KeyCollision[] {
    return this.#collisions;
  }
}
