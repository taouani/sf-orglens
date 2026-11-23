/**
 * The analysis of a source: a component for everything it holds, and for objects, fields and validation rules
 * their attributes, the references that are written in XML and those that stand in a formula.
 *
 * It works on a tree of files and on the list of the components the files make up (`sources/resolve.ts`), and
 * on nothing else: it does not know whether the files come from an org or from a repository.
 *
 * A component it is handed is never dropped without an issue, and a failure costs the one component it happens
 * in. Decision records 0041 and 0042 list what it does not read.
 */
import { hash } from 'node:crypto';
import type { JsonValue } from '../core/errors.ts';
import { buildKey, KeyRegistry, parentKey, parseKey, type ComponentKey } from '../core/keys.ts';
import type { Reference } from '../core/references.ts';
import type { ResolvedComponent } from '../sources/resolve.ts';
import { byCodeUnit, type SourceTree } from '../sources/tree.ts';
import { cut, type AnalysedComponent, type AnalysisIssue, type OriginWork } from './analysed.ts';
import { buildModel, type FieldFacts } from './model.ts';
import { readField, readObject, readRule, type ElementReading } from './objects.ts';
import { resolveReferences } from './raw-references.ts';
import { childOf, childrenOf, readXml, type XmlDocument, type XmlElement } from './xml.ts';

export interface SourceAnalysis {
  /** The metadata types that are read, sorted. A component of another type gets a row and nothing else. */
  readonly types: readonly string[];
  /** Every component of the source, each key once, sorted by key. */
  readonly components: readonly AnalysedComponent[];
  readonly work: readonly OriginWork[];
  readonly issues: readonly AnalysisIssue[];
}

/** The types that are read. A component of another type gets a row and nothing else. */
const ANALYSED: ReadonlySet<string> = new Set(['CustomObject', 'CustomField', 'ValidationRule']);

/**
 * The elements of the file of an object that are components of their own, each with the type of those. An org
 * hands out an object as one file, and so does a repository in the metadata format. A project in the source
 * format has a folder of the same name for each. A test holds the list against that of the Salesforce library.
 */
export const OBJECT_PARTS: Readonly<Record<string, string>> = {
  businessProcesses: 'BusinessProcess',
  compactLayouts: 'CompactLayout',
  fields: 'CustomField',
  fieldSets: 'FieldSet',
  indexes: 'Index',
  listViews: 'ListView',
  recordTypes: 'RecordType',
  sharingReasons: 'SharingReason',
  validationRules: 'ValidationRule',
  webLinks: 'WebLink',
};

const sha256 = (content: Uint8Array | string): Uint8Array => hash('sha256', content, 'buffer');
const XML_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;
const text = (element: XmlElement | null): string => element?.text?.value.replace(XML_SPACE, '') ?? '';
const messageOf = (error: unknown): string => cut(error instanceof Error ? error.message : String(error), 200);
/** The name of the parent in a full name such as `Invoice__c.Amount__c`, or the name itself if it has no parent. */
const beforeDot = (fullName: string): string => {
  const dot = fullName.indexOf('.');
  return dot === -1 ? fullName : fullName.slice(0, dot);
};

/** A component with a row, while the model is not built yet. */
interface Entry {
  readonly key: ComponentKey;
  readonly type: string;
  readonly name: string;
  readonly definition: AnalysedComponent['definition'];
  /** What was read of it, with the file each reading is of. Empty: nothing of it was analysed. */
  readonly readings: readonly { readonly file: string; readonly reading: ElementReading }[];
}

/**
 * Analyses a source.
 *
 * `listed` is what `resolveComponents` found in the tree, in any order. A component of any type gets a row. An
 * object that the source holds only parts of gets one that is not defined. The parts that stand inside the
 * file of their object, as Salesforce hands them out, get a row each, and fields and rules are read from there.
 */
export function analyseSource(tree: SourceTree, listed: readonly ResolvedComponent[]): SourceAnalysis {
  const issues: AnalysisIssue[] = [];
  const registry = new KeyRegistry();
  const entries: Entry[] = [];
  /** Files the reader refused, and files that could not be opened. Each is reported once. */
  const refused = new Set<string>();
  const unreadable = new Set<string>();
  /** The documents of files that hold several components, and in each the elements by kind and name. */
  const shared = new Map<string, XmlDocument | null>();
  const elements = new Map<string, Map<string, XmlElement>>();
  /** The hash of such a file as a whole, for the parts that cannot be told from the rest of it. */
  const wholeHashes = new Map<string, Uint8Array>();

  const bytesOf = (path: string): Uint8Array | null => {
    if (unreadable.has(path)) return null;
    try {
      return tree.read(path);
    } catch {
      unreadable.add(path);
      issues.push({
        severity: 'error',
        code: 'FILE_UNREADABLE',
        message: `${path} could not be read.`,
        componentKey: null,
        details: { path },
      });
      return null;
    }
  };

  const parse = (path: string, bytes: Uint8Array): XmlDocument | null => {
    const { document, issue } = readXml(bytes);
    if (issue !== null && !refused.has(path)) {
      refused.add(path);
      issues.push({
        severity: 'error',
        code: issue.code,
        message: `${path}: ${issue.message}`,
        componentKey: null,
        details: { path, line: issue.place?.line ?? null, column: issue.place?.column ?? null },
      });
    }
    return document;
  };

  const sharedDocument = (path: string): XmlDocument | null => {
    let document = shared.get(path);
    if (document === undefined) {
      const bytes = bytesOf(path);
      document = bytes === null ? null : parse(path, bytes);
      shared.set(path, document);
    }
    return document;
  };

  /** The element of a component that stands inside the file of its parent. */
  const elementIn = (within: NonNullable<ResolvedComponent['within']>, fullName: string): XmlElement | null => {
    const document = sharedDocument(within.file);
    if (document === null) return null;
    const id = `${within.file}\n${within.element}\n${within.nameElement}`;
    let byName = elements.get(id);
    if (byName === undefined) {
      byName = new Map();
      for (const element of childrenOf(document.root, within.element)) {
        const name = text(childOf(element, within.nameElement));
        if (name !== '' && !byName.has(name)) byName.set(name, element);
      }
      elements.set(id, byName);
    }
    // The full name of a part of a component starts with the name of that component, and the file does not repeat it.
    return byName.get(fullName) ?? byName.get(fullName.slice(fullName.indexOf('.') + 1)) ?? null;
  };

  /** The hash of a file as a whole. Of a file that cannot be read, it is taken over its path. */
  const wholeHash = (path: string): Uint8Array => {
    let contentHash = wholeHashes.get(path);
    if (contentHash === undefined) {
      const bytes = bytesOf(path);
      contentHash = sha256(bytes ?? `- ${path}\n`);
      wholeHashes.set(path, contentHash);
    }
    return contentHash;
  };

  /**
   * What defines a component as its files say it: the file it is said to be defined in, which is its first
   * metadata file, and the hash of its content. `null` for a component the list gives no file for.
   */
  const definitionOf = (
    { files, within }: ResolvedComponent,
    contents?: readonly { file: string; bytes: Uint8Array | null }[],
  ): Entry['definition'] => {
    const path = files.find((file) => file.endsWith('-meta.xml')) ?? files[0];
    if (path === undefined)
      return within === undefined ? null : { path: within.file, contentHash: wholeHash(within.file) };
    const all = contents ?? files.map((file) => ({ file, bytes: bytesOf(file) }));
    const [only] = all;
    if (all.length === 1 && only !== undefined && only.bytes !== null) return { path, contentHash: sha256(only.bytes) };
    const lines = all.map(
      ({ file, bytes }) => `${bytes === null ? '-' : Buffer.from(sha256(bytes)).toString('hex')} ${file}\n`,
    );
    return { path, contentHash: sha256(lines.join('')) };
  };

  /** Gives a component its key, or reports why it has none. */
  const register = (type: string, fullName: string, file: string | undefined): ComponentKey | null => {
    let key: ComponentKey;
    try {
      key = buildKey({ type, fullName });
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'KEY_INVALID',
        message: `The ${type} "${cut(fullName, 80)}" cannot be given a key: ${messageOf(error)}`,
        componentKey: null,
        details: { type, path: file ?? null },
      });
      return null;
    }
    const collision = registry.register({ key, displayName: fullName, ...(file === undefined ? {} : { file }) });
    if (collision === undefined) return key;
    issues.push({
      severity: collision.severity,
      code: collision.code,
      message: collision.message,
      componentKey: key,
      details: { kept: collision.kept, dropped: collision.dropped },
    });
    return null;
  };

  /** A fault of the analyser, not of the source. It costs the component its analysis and nothing else. */
  const failed = (key: ComponentKey | null, type: string, file: string | null, error: unknown): void => {
    issues.push({
      severity: 'error',
      code: 'ANALYSIS_FAILED',
      message: `The analysis of a ${type} failed: ${messageOf(error)}`,
      componentKey: key,
      details: { type, path: file },
    });
  };

  /** Reads the element of a component, if its type is one that is read. `null`: it was not read. */
  const read = (
    key: ComponentKey,
    type: string,
    fullName: string,
    file: string,
    document: XmlDocument,
    element: XmlElement,
  ): ElementReading | null => {
    if (!ANALYSED.has(type)) return null;
    try {
      if (type === 'CustomObject') return readObject(element);
      if (type === 'CustomField') return readField(document, element, beforeDot(fullName));
      return readRule(document, element, beforeDot(fullName));
    } catch (error) {
      failed(key, type, file, error);
      return null;
    }
  };
  const readingsOf = (file: string, reading: ElementReading | null): Entry['readings'] =>
    reading === null ? [] : [{ file, reading }];

  /** The components that stand inside the file of an object. */
  const partsOf = (object: string, file: string, document: XmlDocument): void => {
    for (const [group, type] of Object.entries(OBJECT_PARTS)) {
      for (const element of childrenOf(document.root, group)) {
        const name = text(childOf(element, 'fullName'));
        if (name === '') {
          const { line, column } = document.place(element.start);
          issues.push({
            severity: 'error',
            code: 'METADATA_UNEXPECTED',
            message: `${file}, line ${String(line)}: an element "${group}" has no name.`,
            componentKey: null,
            details: { path: file, line, column },
          });
          continue;
        }
        const fullName = `${object}.${name}`;
        const key = register(type, fullName, file);
        if (key === null) continue;
        entries.push({
          key,
          type,
          name: fullName,
          definition: { path: file, contentHash: sha256(document.text.slice(element.start, element.end)) },
          readings: readingsOf(file, read(key, type, fullName, file, document, element)),
        });
      }
    }
  };

  const add = (component: ResolvedComponent, key: ComponentKey): void => {
    const { type, fullName: name, files, within } = component;

    if (files.length === 0) {
      const element = within === undefined ? null : elementIn(within, name);
      const document = within === undefined ? null : (shared.get(within.file) ?? null);
      if (within === undefined || element === null || document === null) {
        // The part cannot be told from the rest of the file. The component is defined there all the same.
        if (within !== undefined && document !== null) {
          issues.push({
            severity: 'warning',
            code: 'ELEMENT_NOT_FOUND',
            message: `${within.file} holds no element "${within.element}" for the ${type} "${cut(name, 80)}".`,
            componentKey: key,
            details: { path: within.file, element: within.element },
          });
        }
        entries.push({ key, type, name, definition: definitionOf(component), readings: [] });
        return;
      }
      entries.push({
        key,
        type,
        name,
        definition: { path: within.file, contentHash: sha256(document.text.slice(element.start, element.end)) },
        readings: readingsOf(within.file, read(key, type, name, within.file, document, element)),
      });
      return;
    }

    const contents = files.map((file) => ({ file, bytes: bytesOf(file) }));
    const definition = definitionOf(component, contents);
    // An object, a field and a rule have no file that is not XML. An object that lies in two package folders
    // can have a file of its own in each, and both are read.
    const readings: { file: string; reading: ElementReading }[] = [];
    const documents: { file: string; document: XmlDocument }[] = [];
    for (const { file, bytes } of ANALYSED.has(type) ? contents : []) {
      const document = bytes === null ? null : parse(file, bytes);
      if (document === null) continue;
      if (document.root.local !== type) {
        const { line, column } = document.place(document.root.start);
        issues.push({
          severity: 'error',
          code: 'METADATA_UNEXPECTED',
          message: `${file} is the file of a ${type}, and its root element is "${cut(document.root.local, 60)}".`,
          componentKey: key,
          details: { path: file, line, column },
        });
        continue;
      }
      const reading = read(key, type, name, file, document, document.root);
      if (reading !== null) readings.push({ file, reading });
      documents.push({ file, document });
    }
    // The component first, so that it has its row whatever happens in its parts.
    entries.push({ key, type, name, definition, readings });
    if (type === 'CustomObject') for (const { file, document } of documents) partsOf(name, file, document);
  };

  // In a fixed order, so that the same components give the same analysis however they are listed.
  const ordered = [...listed].sort(
    (a, b) =>
      byCodeUnit(a.type, b.type) ||
      byCodeUnit(a.fullName, b.fullName) ||
      byCodeUnit(a.files[0] ?? a.within?.file ?? '', b.files[0] ?? b.within?.file ?? ''),
  );
  for (const component of ordered) {
    const { type, fullName } = component;
    const file = component.files.find((one) => one.endsWith('-meta.xml')) ?? component.files[0];
    const key = register(type, fullName, file ?? component.within?.file);
    if (key === null) continue;
    try {
      add(component, key);
    } catch (error) {
      failed(key, type, file ?? null, error);
      if (!entries.some((entry) => entry.key === key)) {
        let definition: Entry['definition'] = null;
        try {
          definition = definitionOf(component);
        } catch {
          // Then the row says that the component is not defined, and the issue says why.
        }
        entries.push({ key, type, name: fullName, definition, readings: [] });
      }
    }
  }

  // An object that the source holds only parts of gets a component that is not defined.
  for (const entry of [...entries]) {
    const parent = parentKey(entry.key);
    if (parent === undefined || registry.has(parent) || parseKey(parent).type !== 'CustomObject') continue;
    const before = beforeDot(entry.name);
    // The full name of a record of a custom metadata type starts with the type, with or without its suffix.
    const name = entry.type === 'CustomMetadata' && !/__mdt$/i.test(before) ? `${before}__mdt` : before;
    registry.register({ key: parent, displayName: name });
    entries.push({ key: parent, type: 'CustomObject', name, definition: null, readings: [] });
  }

  const fields = new Map<ComponentKey, FieldFacts>();
  const namedObjects = new Set<string>();
  for (const { key, readings } of entries) {
    for (const { reading } of readings) {
      if (reading.facts === null) continue;
      if (!fields.has(key)) fields.set(key, reading.facts);
      for (const name of reading.facts.referenceTo) namedObjects.add(name);
    }
  }
  const model = buildModel({
    defined: new Set(entries.filter((entry) => entry.definition !== null).map((entry) => entry.key)),
    objects: entries.filter((entry) => entry.type === 'CustomObject').map((entry) => entry.name),
    namedObjects,
    fields,
  });

  let analysed = 0;
  let withFormula = 0;
  const formulasNotRead = new Set<string>();
  const components = entries.map((entry): AnalysedComponent => {
    const { key, name, definition, readings } = entry;
    const bare: AnalysedComponent = { key, name, definition, attrs: null, references: [] };
    if (readings.length === 0) return bare;
    try {
      const found: AnalysisIssue[] = [];
      const references: Reference[] = [];
      const notRead: string[] = [];
      let formulas = 0;
      const object = entry.type === 'CustomObject' ? name : beforeDot(name);
      for (const { file, reading } of readings) {
        for (const unread of reading.unread) {
          found.push({
            severity: 'warning',
            code: 'NAME_NOT_READ',
            message: `${file}, line ${String(unread.line)}: the element "${unread.element}" holds "${unread.text}", which is not read as a name.`,
            componentKey: key,
            details: { path: file, line: unread.line, column: unread.column, element: unread.element },
          });
        }
        const owner = { key, file, object };
        const resolved = resolveReferences(model, owner, reading.references, 'parser:xml');
        // One at a time: a formula can hold more names than a call takes arguments.
        for (const issue of resolved.issues) found.push(issue);
        for (const reference of resolved.references) references.push(reference);
        for (const formula of reading.formulas) {
          formulas += 1;
          const { problem, element } = formula;
          if (problem !== null) {
            notRead.push(file);
            found.push({
              severity: 'warning',
              code: 'FORMULA_NOT_READ',
              message: `${file}, line ${String(problem.line)}: the formula in "${element}" was not read as a whole. ${problem.message} The names in it are recorded as probable.`,
              componentKey: key,
              details: { path: file, line: problem.line, column: problem.column, element },
            });
          }
          for (const unread of formula.unread) {
            found.push({
              severity: 'warning',
              code: 'NAME_NOT_READ',
              message: `${file}, line ${String(unread.line)}: the formula in "${unread.element}" holds "${unread.text}", which is not read as a name.`,
              componentKey: key,
              details: { path: file, line: unread.line, column: unread.column, element: unread.element },
            });
          }
          const inFormula = resolveReferences(model, owner, formula.references, 'parser:formula');
          for (const issue of inFormula.issues) found.push(issue);
          for (const reference of inFormula.references) references.push(reference);
        }
      }
      // Of two files of one object, the first says what both say.
      const attrs: Record<string, JsonValue> = {};
      for (const { reading } of [...readings].reverse()) Object.assign(attrs, reading.attrs);
      for (const issue of found) issues.push(issue);
      analysed += 1;
      if (formulas > 0) withFormula += 1;
      for (const file of notRead) formulasNotRead.add(file);
      return { key, name, definition, attrs, references };
    } catch (error) {
      failed(key, entry.type, readings[0]?.file ?? null, error);
      return bare;
    }
  });
  components.sort((a, b) => byCodeUnit(a.key, b.key));

  const failedFiles = new Set([...refused, ...unreadable]).size;
  return {
    types: [...ANALYSED].sort(byCodeUnit),
    components,
    work: [
      { origin: 'parser:xml', components: analysed, failedFiles },
      // Components with a formula, and files with a formula that was not read as a whole.
      { origin: 'parser:formula', components: withFormula, failedFiles: formulasNotRead.size },
    ],
    issues,
  };
}
