/**
 * What a Lightning web component refers to (decision record 0094): the JavaScript of its bundle for what it imports,
 * and its templates for the components they hold and the objects and fields that the attributes of base components
 * name. The JavaScript is read for its imports and for nothing else, and of a template only the names of elements and
 * a few attributes are read: no expression in braces.
 *
 * A reader here takes the names with their places out of one file. The names of objects, fields, labels, permissions
 * and components are resolved as every other reader's are (`raw-references.ts`). An Apex method is resolved against
 * the classes of the snapshot once they are read (`resolveApexImports`).
 */
import { buildKey, foldName, parseKey, type ComponentKey } from '../core/keys.ts';
import { validateReference, type Reference } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { readModule } from './javascript.ts';
import { readMarkup } from './markup.ts';
import type { ObjectModel } from './model.ts';
import { LONGEST_TEXT_SHOWN, type RawReference } from './raw-references.ts';
import type { NameAt } from './values.ts';
import type { TextDocument } from './xml.ts';

/** An Apex method a module imports, by the name of its class and its own, each with its place. */
export interface ApexImport {
  /** The namespace of a class of a managed package, as `ns` of `@salesforce/apex/ns.Class.method`. */
  readonly namespace: NameAt | null;
  readonly class: NameAt;
  readonly method: NameAt;
}

/** What one file of a bundle names, before the names are resolved. */
export interface BundleFileReading {
  readonly references: readonly RawReference[];
  /** The Apex methods a module imports. A template imports none. */
  readonly apex: readonly ApexImport[];
  readonly issues: readonly AnalysisIssue[];
  /** Whether the reader read the whole file. */
  readonly whole: boolean;
}

/** The name of an object, a field, a class, a method, a label, a permission or a component, as Salesforce allows it. */
const ONE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The modules of Salesforce that name no component of the logic tier: an import of them gives nothing. */
const NAMING_NOTHING: ReadonlySet<string> = new Set([
  '@salesforce/client',
  '@salesforce/community',
  '@salesforce/contentAssetUrl',
  '@salesforce/i18n',
  '@salesforce/messageChannel',
  '@salesforce/resourceUrl',
  '@salesforce/site',
  '@salesforce/user',
  '@salesforce/userPermission',
]);

/** The prefixes of the modules of Salesforce whose names are read. */
const APEX = ['@salesforce/apex/', '@salesforce/apexContinuation/'];
const SCHEMA = '@salesforce/schema/';
const LABEL = '@salesforce/label/';
const PERMISSION = '@salesforce/customPermission/';

/** The parts of a name between dots, each with its index in the text. */
function partsOf(text: string, start: number): { name: string; start: number }[] {
  const parts: { name: string; start: number }[] = [];
  let at = start;
  for (const name of text.split('.')) {
    parts.push({ name, start: at });
    at += name.length + 1;
  }
  return parts;
}

/** `invoice-badge` of a tag `c-invoice-badge` is the component `invoiceBadge`. */
const componentOfTag = (tail: string): string => tail.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/** The issue of a name in a file of a bundle that is not read. */
function notRead(key: ComponentKey, file: string, at: NameAt, message: string): AnalysisIssue {
  return {
    severity: 'warning',
    code: 'NAME_NOT_READ',
    message: `${file}, line ${String(at.line)}: ${message}`,
    componentKey: key,
    details: { path: file, line: at.line, column: at.column },
  };
}

/**
 * Reads the imports of a module of a Lightning web component. An import of a module of Salesforce that names a
 * component refers to it: an Apex method, an object, a field, also across relationships, a label and a custom
 * permission. An import of another component of the project (`c/name`) refers to that component. An import of a
 * module that names no component, of `lwc`, of a base module (`lightning/...`) or of a module of the same bundle
 * gives nothing. Any other module, a name that is not built like one and an import while the code runs are not read,
 * and a warning says so.
 */
export function readLightningScript(key: ComponentKey, file: string, document: TextDocument): BundleFileReading {
  const { text } = document;
  const reading = readModule(text);
  const references: RawReference[] = [];
  const apex: ApexImport[] = [];
  const issues: AnalysisIssue[] = [];
  const nameAt = (name: string, index: number): NameAt => ({ name, ...placeOf(document, index) });
  for (const { what, start } of reading.unread) {
    const said =
      what === 'dynamic'
        ? 'a module is imported while the code runs, which is not read, so what it names is not known.'
        : 'an import or an export is of a form that is not known here, so what it names is not known.';
    issues.push(notRead(key, file, nameAt('', start), said));
  }
  for (const { specifier, start, end, escaped } of reading.imports) {
    const at = nameAt(specifier, start);
    if (escaped) {
      const written = `"${cut(text.slice(start, end), LONGEST_TEXT_SHOWN)}"`;
      issues.push(
        notRead(key, file, at, `the name of the module ${written} is written with an escape, and is not read.`),
      );
      continue;
    }
    const shown = `"${cut(specifier, LONGEST_TEXT_SHOWN)}"`;
    const slash = specifier.indexOf('/', specifier.startsWith('@') ? specifier.indexOf('/') + 1 : 0);
    const module = slash === -1 ? specifier : specifier.slice(0, slash);
    const prefix = APEX.find((one) => specifier.startsWith(one));
    const parts = (from: string): { name: string; start: number }[] =>
      partsOf(specifier.slice(from.length), start + from.length);
    const wrong = (all: readonly { name: string }[]): boolean => all.some((part) => !ONE_NAME.test(part.name));
    if (specifier === 'lwc' || specifier.startsWith('lightning/') || specifier.startsWith('.')) continue;
    if (specifier === '@salesforce/apex' || NAMING_NOTHING.has(module)) continue;
    if (prefix !== undefined) {
      const named = parts(prefix);
      const [first, second, third] = named;
      if (wrong(named) || first === undefined || second === undefined || named.length > 3) {
        issues.push(notRead(key, file, at, `${shown} names no Apex method in a form that is known here.`));
      } else if (third === undefined) {
        apex.push({
          namespace: null,
          class: nameAt(first.name, first.start),
          method: nameAt(second.name, second.start),
        });
      } else {
        const { name, start: from } = third;
        apex.push({
          namespace: nameAt(first.name, first.start),
          class: nameAt(second.name, second.start),
          method: nameAt(name, from),
        });
      }
    } else if (specifier.startsWith(SCHEMA)) {
      const named = parts(SCHEMA);
      const [object, ...path] = named;
      if (wrong(named) || object === undefined) {
        issues.push(notRead(key, file, at, `${shown} names no object or field in a form that is known here.`));
      } else if (path.length === 0 || (path.length === 1 && foldName(path[0]?.name ?? '') === 'id')) {
        // The field `Id` is no component: an import of it names the object.
        references.push({ form: 'object', at: nameAt(object.name, object.start), via: 'import' });
      } else {
        // An import serves to read and to write a field, and the JavaScript is not followed.
        references.push({
          form: 'path',
          start: object.name,
          names: path.map((part) => nameAt(part.name, part.start)),
          kind: 'references',
          through: 'references',
          via: 'import',
        });
      }
    } else if (specifier.startsWith(LABEL)) {
      const named = parts(LABEL);
      const [namespace, label] = named;
      if (wrong(named) || namespace === undefined || label === undefined || named.length !== 2) {
        issues.push(notRead(key, file, at, `${shown} names no label in a form that is known here.`));
      } else {
        const fullName = foldName(namespace.name) === 'c' ? label.name : `${namespace.name}__${label.name}`;
        references.push({
          form: 'component',
          type: 'CustomLabel',
          at: nameAt(label.name, label.start),
          fullName,
          via: 'import',
        });
      }
    } else if (specifier.startsWith(PERMISSION)) {
      const name = specifier.slice(PERMISSION.length);
      if (!ONE_NAME.test(name)) {
        issues.push(notRead(key, file, at, `${shown} names no custom permission in a form that is known here.`));
      } else {
        references.push({
          form: 'component',
          type: 'CustomPermission',
          at: nameAt(name, start + PERMISSION.length),
          via: 'import',
        });
      }
    } else if (specifier.startsWith('c/')) {
      const name = specifier.slice(2);
      if (!ONE_NAME.test(name)) {
        issues.push(notRead(key, file, at, `${shown} names no component in a form that is known here.`));
      } else {
        references.push({
          form: 'component',
          type: 'LightningComponentBundle',
          at: nameAt(name, start + 2),
          via: 'import',
        });
      }
    } else {
      issues.push(
        notRead(
          key,
          file,
          at,
          `${shown} is no module of Salesforce or of the project that is known here, so nothing is read of its import.`,
        ),
      );
    }
  }
  if (reading.stop !== null) issues.push(stopped(key, file, document, reading.stop.at, NOT_CLOSED[reading.stop.what]));
  return { references, apex, issues, whole: reading.stop === null };
}

/** The base components whose field is of the object of the form around them. */
const FIELDS_OF_FORM: ReadonlySet<string> = new Set(['lightning-input-field', 'lightning-output-field']);

/**
 * Reads a template of a Lightning web component. A tag of a component of the project (`<c-name>`) refers to it. The
 * literal object of a base component (`object-api-name`) refers to the object, and the literal field of an input or
 * an output field (`field-name`) to the field of the object of the form around it, both `probable`: the template
 * names them as an attribute, which the base component reads. An expression in braces is not read.
 */
export function readLightningTemplate(key: ComponentKey, file: string, document: TextDocument): BundleFileReading {
  const { text } = document;
  const reading = readMarkup(text);
  const references: RawReference[] = [];
  const issues: AnalysisIssue[] = [];
  const nameAt = (name: string, index: number): NameAt => ({ name, ...placeOf(document, index) });
  /** The object each element names with `object-api-name`, or that of the element around it. `null`: not known. */
  const objects: (string | null | undefined)[] = [];
  reading.elements.forEach((element, index) => {
    const tag = element.name.toLowerCase();
    const outer = element.parent === -1 ? undefined : objects[element.parent];
    let object: string | null | undefined = outer;
    if (tag.startsWith('c-')) {
      const tail = element.name.slice(2);
      // A tag is read in lower case, as HTML reads it.
      const name = componentOfTag(tag.slice(2));
      if (ONE_NAME.test(name)) {
        references.push({
          form: 'component',
          type: 'LightningComponentBundle',
          at: nameAt(tail, element.start + 2),
          fullName: name,
          via: 'tag',
        });
      } else
        issues.push(
          notRead(
            key,
            file,
            nameAt(tail, element.start),
            `the tag "${cut(element.name, LONGEST_TEXT_SHOWN)}" names no component in a form that is known here.`,
          ),
        );
    } else if (tag.includes('-') && !tag.startsWith('lightning-')) {
      issues.push(
        notRead(
          key,
          file,
          nameAt(element.name, element.start),
          `the tag "${cut(element.name, LONGEST_TEXT_SHOWN)}" is of a namespace that is not known here, so the component it names is not known.`,
        ),
      );
    }
    if (tag.startsWith('lightning-')) {
      for (const attribute of element.attributes) {
        const name = attribute.name.toLowerCase();
        const { value } = attribute;
        if (value === null || (name !== 'object-api-name' && name !== 'field-name')) continue;
        const literal = !value.trimStart().startsWith('{');
        if (name === 'object-api-name') {
          object = literal && ONE_NAME.test(value) ? value : null;
          if (object !== null) {
            references.push({
              form: 'object',
              at: nameAt(value, attribute.valueStart),
              via: 'attribute',
              tier: 'probable',
            });
          } else if (literal) {
            issues.push(
              notRead(
                key,
                file,
                nameAt(value, attribute.valueStart),
                `the object "${cut(value, LONGEST_TEXT_SHOWN)}" is not built like the name of one.`,
              ),
            );
          }
        } else if (FIELDS_OF_FORM.has(tag) && literal) {
          const named = partsOf(value, attribute.valueStart).map((part) => nameAt(part.name, part.start));
          if (named.some((one) => !ONE_NAME.test(one.name))) {
            issues.push(
              notRead(
                key,
                file,
                nameAt(value, attribute.valueStart),
                `the field "${cut(value, LONGEST_TEXT_SHOWN)}" is not built like the name of one.`,
              ),
            );
          } else if (outer === undefined || outer === null) {
            // Nothing says which object the field is of: the form around it names none, or one in braces.
            references.push({ form: 'unfollowed', after: null, names: named, via: 'attribute', tier: 'probable' });
          } else {
            references.push({
              form: 'path',
              start: outer,
              names: named,
              kind: 'references',
              through: 'references',
              via: 'attribute',
              tier: 'probable',
            });
          }
        }
      }
    }
    objects[index] = object;
  });
  if (reading.stop !== null) issues.push(stopped(key, file, document, reading.stop.at, NOT_CLOSED[reading.stop.what]));
  return { references, apex: [], issues, whole: reading.stop === null };
}

/** What a reader of a file stopped in, as the warning says it. */
const NOT_CLOSED = {
  string: 'a string',
  comment: 'a comment',
  template: 'a template',
  expression: 'a regular expression',
  tag: 'a tag',
} as const;

/** The place of an index of a text. */
function placeOf(document: TextDocument, index: number): { line: number; column: number } {
  const { line, column } = document.place(index);
  return { line, column };
}

/** The warning that a reader stopped before the end of a file, at a place, in something that is not closed. */
function stopped(key: ComponentKey, file: string, document: TextDocument, index: number, what: string): AnalysisIssue {
  const { line, column } = placeOf(document, index);
  return {
    severity: 'warning',
    code: 'FILE_NOT_READ',
    message: `${file}, line ${String(line)}: ${what} is not closed, so the file was not read beyond it. What it names after that is not known.`,
    componentKey: key,
    details: { path: file, line, column },
  };
}

/**
 * The methods of each class of the snapshot by their name: of the top-level class only, since a component imports
 * no method of an inner class. A name that a class gives several methods, with other parameters, has all of them,
 * unless some of them are `@AuraEnabled`: a component can import only such a method, so then it has only those.
 */
export type ApexMethods = ReadonlyMap<ComponentKey, ReadonlyMap<string, readonly ComponentKey[]>>;

/** The methods of the classes of the snapshot, each with whether it is `@AuraEnabled`. */
export function apexMethodsOf(
  methods: Iterable<{ readonly key: ComponentKey; readonly auraEnabled: boolean }>,
): ApexMethods {
  const all = new Map<ComponentKey, Map<string, { key: ComponentKey; auraEnabled: boolean }[]>>();
  for (const { key, auraEnabled } of methods) {
    const { type, name, subs } = parseKey(key);
    const [only, ...more] = subs;
    if (type !== 'ApexClass' || only?.kind !== 'method' || more.length > 0) continue;
    const method = only.name.slice(0, only.name.indexOf('('));
    const of = buildKey({ type: 'ApexClass', fullName: name });
    const byName = all.get(of) ?? new Map<string, { key: ComponentKey; auraEnabled: boolean }[]>();
    byName.set(method, [...(byName.get(method) ?? []), { key, auraEnabled }]);
    all.set(of, byName);
  }
  return new Map(
    [...all].map(([of, byName]) => [
      of,
      new Map(
        [...byName].map(([method, found]) => {
          const enabled = found.filter((one) => one.auraEnabled);
          return [method, (enabled.length > 0 ? enabled : found).map((one) => one.key)];
        }),
      ),
    ]),
  );
}

/**
 * The calls of the Apex methods a module imports. A method of a class of the snapshot is the method of that name,
 * `confirmed`, and each of several of that name `probable`. A class that has no method of that name, whose code is
 * not read or that the snapshot does not hold is called with the name of the method in `attrs.method`, as Apex refers
 * to a method of a class whose code is not read.
 */
export function resolveApexImports(
  model: ObjectModel,
  methods: ApexMethods,
  owner: { readonly key: ComponentKey; readonly file: string },
  imports: readonly ApexImport[],
): Reference[] {
  return imports.flatMap(({ namespace, class: named, method }) => {
    const fullName = namespace === null ? named.name : `${namespace.name}__${named.name}`;
    const target = model.component('ApexClass', fullName);
    const found = target.to === null ? [] : (methods.get(target.to)?.get(foldName(method.name)) ?? []);
    const reference = (to: ComponentKey | null, confidence: 'confirmed' | 'probable', more = {}): Reference =>
      validateReference({
        from: owner.key,
        to,
        toType: 'ApexClass',
        toNameRaw: method.name,
        kind: 'calls',
        origin: 'parser:javascript',
        confidence,
        resolution: target.resolution,
        location: { file: owner.file, line: method.line, column: method.column },
        attrs: { via: 'import', ...more },
      });
    if (found.length === 0) return [reference(target.to, 'confirmed', { method: method.name })];
    const confidence = found.length === 1 ? 'confirmed' : 'probable';
    return found.map((key) => reference(key, confidence));
  });
}
