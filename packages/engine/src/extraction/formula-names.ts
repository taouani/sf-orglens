/**
 * What a name in a formula stands for, as far as the name itself says it: a path of fields from the object of
 * the formula, a field behind a global variable, a custom label, a custom permission, a record of a custom
 * metadata type, or nothing that can change. The name of a merge field is read the same way, with one
 * difference: its first name is something the text around it knows, and the caller says what.
 *
 * Nothing is resolved here. `names-in-text.ts` gives each part its place in the file, and the names are resolved
 * against the model when every file was read.
 */
import { GLOBAL_OBJECTS } from './model.ts';

/** One name of a path, and where it starts in the name of the formula it is a part of. */
export interface NamePart {
  readonly name: string;
  readonly from: number;
  /** For a relationship: the object the formula says it leads to, as `Owner:User` does. */
  readonly leadsTo?: string;
  /** For a field: the name it has in metadata, where the formula language has another. */
  readonly resolveAs?: string;
}

/** What a name stands for. */
export type NameUse =
  /** A path from an object: relationships, and a field at the end. */
  | { readonly form: 'path'; readonly start: string; readonly parts: readonly NamePart[] }
  /** A component that is no field, by its type and its full name. */
  | { readonly form: 'component'; readonly type: string; readonly fullName: string; readonly part: NamePart }
  /** An object. */
  | { readonly form: 'object'; readonly part: NamePart };

/** One name between two dots: a name, and after a colon the kind of record a relationship is taken as. */
const SEGMENT = /^([A-Za-z][A-Za-z0-9_]*)(?::([A-Za-z][A-Za-z0-9_]*))?$/;

/** The global variables that name nothing that can change. */
const NOTHING: ReadonlySet<string> = new Set(['$api', '$system']);

/**
 * What stands behind `$User` and is no field of the user: which interface the user sees. By folded name.
 */
const NO_FIELD_OF_USER: ReadonlySet<string> = new Set(['uitheme', 'uithemedisplayed']);

/**
 * The objects that a formula names otherwise than metadata does: the owner of a record can be a queue, which is
 * a group, and the formula language calls the name of that group `QueueName`. No other name of a queue is known
 * here. By folded name, in maps: a name of a formula can be `constructor`.
 */
const TAKEN_AS: ReadonlyMap<string, { object: string; fields: ReadonlyMap<string, string> }> = new Map([
  ['queue', { object: 'Group', fields: new Map([['queuename', 'Name']]) }],
]);

/** One name between two dots, and where it starts in the whole name. */
interface Segment {
  readonly text: string;
  readonly from: number;
}

function segmentsOf(name: string): Segment[] {
  const segments: Segment[] = [];
  let from = 0;
  for (const text of name.split('.')) {
    segments.push({ text, from });
    from += text.length + 1;
  }
  return segments;
}

/** A path of plain names from the object `start`. `null` if there is none, or if one of them is not a name. */
function plain(start: string, path: readonly Segment[]): NameUse[] | null {
  if (path.length === 0) return null;
  const parts: NamePart[] = [];
  let fields: ReadonlyMap<string, string> | undefined;
  for (const [index, { text, from: at }] of path.entries()) {
    const found = SEGMENT.exec(text);
    const [, word, kind] = found ?? [];
    if (word === undefined) return null;
    const last = index === path.length - 1;
    // The kind of record is said of a relationship, never of the field at the end.
    if (kind !== undefined && last) return null;
    const resolveAs = last ? fields?.get(word.toLowerCase()) : undefined;
    const taken = kind === undefined ? undefined : TAKEN_AS.get(kind.toLowerCase());
    fields = taken?.fields;
    parts.push({
      name: word,
      from: at,
      ...(kind === undefined ? {} : { leadsTo: taken?.object ?? kind }),
      ...(resolveAs === undefined ? {} : { resolveAs }),
    });
  }
  return [{ form: 'path', start, parts }];
}

/** One name that is the name of a component. */
const one = (segment: Segment | undefined): NamePart | null =>
  segment !== undefined && /^[A-Za-z][A-Za-z0-9_]*$/.test(segment.text)
    ? { name: segment.text, from: segment.from }
    : null;

/**
 * What stands behind a global variable. `variable` is its name in lower case, `rest` the names after it, and
 * `own` the object of the formula, or `null` where there is none, as for a merge field.
 */
function usesOfVariable(variable: string, rest: readonly Segment[], own: string | null): readonly NameUse[] | null {
  if (NOTHING.has(variable)) return [];

  if (variable === '$user' && rest.length === 1 && NO_FIELD_OF_USER.has(rest[0]?.text.toLowerCase() ?? '')) return [];
  const object = GLOBAL_OBJECTS.get(variable);
  if (object !== undefined) return plain(object, rest);
  if (variable === '$recordtype') return plain('RecordType', rest);
  // The record that holds a lookup, in its filter. A formula of a field has no such variable.
  if (variable === '$source') return own === null ? null : plain(own, rest);

  if (variable === '$label' || variable === '$permission') {
    const part = rest.length === 1 ? one(rest[0]) : null;
    if (part === null) return null;
    const type = variable === '$label' ? 'CustomLabel' : 'CustomPermission';
    return [{ form: 'component', type, fullName: part.name, part }];
  }

  if (variable === '$setup') {
    // `$Setup.Settings__c.Field__c`: a field of a custom setting. The setting is no reference.
    const setting = one(rest[0]);
    return setting === null ? null : plain(setting.name, rest.slice(1));
  }

  if (variable === '$custommetadata') {
    // `$CustomMetadata.Type__mdt.Record.Field__c`: the record, and a field of its type. A type that is written
    // without its ending is not guessed at.
    const [type, record] = [one(rest[0]), one(rest[1])];
    if (type === null || record === null || rest.length < 3 || !/__mdt$/i.test(type.name)) return null;
    const fields = plain(type.name, rest.slice(2));
    if (fields === null) return null;
    const fullName = `${type.name.slice(0, -'__mdt'.length)}.${record.name}`;
    return [{ form: 'component', type: 'CustomMetadata', fullName, part: record }, ...fields];
  }

  if (variable === '$objecttype') {
    // `$ObjectType.Object__c` is the object, and `$ObjectType.Object__c.Fields.Field__c` a field of it.
    const named = one(rest[0]);
    if (named === null) return null;
    if (rest.length === 1) return [{ form: 'object', part: named }];
    if (rest.length !== 3 || rest[1]?.text.toLowerCase() !== 'fields') return null;
    return plain(named.name, rest.slice(2));
  }
  return null;
}

/**
 * What the name of a formula stands for. `own` is the object the formula belongs to.
 *
 * Gives the uses of the name, which are none for a name that stands for nothing that can change, or `null` for
 * a name that is not read: one that is not built like a name, or one behind a global variable this reader does
 * not know.
 */
export function usesOfName(name: string, own: string): readonly NameUse[] | null {
  const segments = segmentsOf(name);
  const [first, ...rest] = segments;
  if (first === undefined) return null;
  if (!first.text.startsWith('$')) return plain(own, segments);
  return usesOfVariable(first.text.toLowerCase(), rest, own);
}

/**
 * What the first name of a merge field is, as the text around it knows it: a resource of a flow, or the object an
 * email template is written for.
 *
 * - `{ object: 'Invoice__c' }`: a record of that object. The names after it are a path from the object.
 * - `{ object: null }`: something that holds no record and names nothing that can change, such as a number, a
 *   text or the time. Whatever stands after it gives no reference.
 */
export interface MergeStart {
  readonly object: string | null;
}

/**
 * What the name of a merge field stands for: what stands between `{!` and `}`. `startOf` says what the first
 * name is, as it is written, and gives `undefined` for one it does not know. It is asked before anything else,
 * so that `$Record` of a flow is what the flow says. A first name it does not know is read as the global
 * variable of a formula, if it is one.
 *
 * Gives the uses of the name, as `usesOfName` does: none for a name that stands for nothing that can change,
 * and for a record that is named as a whole, and `null` for a name that is not read.
 */
export function usesOfMergeField(
  name: string,
  startOf: (first: string) => MergeStart | undefined,
): readonly NameUse[] | null {
  const [first, ...rest] = segmentsOf(name);
  // A first name that is not built like one is not asked about: nothing can be known of it.
  if (first === undefined || !/^\$?[A-Za-z][A-Za-z0-9_]*$/.test(first.text)) return null;
  const start = startOf(first.text);
  if (start !== undefined) {
    if (start.object === null || rest.length === 0) return [];
    return plain(start.object, rest);
  }
  return first.text.startsWith('$') ? usesOfVariable(first.text.toLowerCase(), rest, null) : null;
}
