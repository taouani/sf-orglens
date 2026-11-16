/**
 * The analysis of a source: a component for everything it holds, and for objects, fields and validation rules
 * their attributes and the references that are written in XML.
 *
 * It works on a tree of files and on the list of the components the files make up (`sources/resolve.ts`), and
 * on nothing else: it does not know whether the files come from an org or from a repository.
 *
 * Nothing is dropped without an issue, and a failure costs the one component it happens in.
 */
import { hash } from 'node:crypto';
import { buildKey, KeyRegistry, parentKey, parseKey, type ComponentKey } from '../core/keys.ts';
import type { ResolvedComponent } from '../sources/resolve.ts';
import { byCodeUnit, type SourceTree } from '../sources/tree.ts';
import type { AnalysedComponent, AnalysisIssue, OriginWork } from './analysed.ts';
import { buildModel, type FieldFacts } from './model.ts';
import { readField, readObject, readRule, resolveReferences, type ElementReading } from './objects.ts';
import { childOf, childrenOf, readXml, type XmlDocument, type XmlElement } from './xml.ts';

export interface SourceAnalysis {
  /** Every component of the source, each key once, sorted by key. */
  readonly components: readonly AnalysedComponent[];
  readonly work: readonly OriginWork[];
  readonly issues: readonly AnalysisIssue[];
}

/** The types that are analysed, each with the elements of an object file that hold components of it. */
const ANALYSED: Readonly<Record<string, string | undefined>> = {
  CustomObject: undefined,
  CustomField: 'fields',
  ValidationRule: 'validationRules',
};
const isAnalysed = (type: string): boolean => Object.hasOwn(ANALYSED, type);

const sha256 = (content: Uint8Array | string): Uint8Array => hash('sha256', content, 'buffer');
const text = (element: XmlElement | null): string => element?.text?.value.trim() ?? '';
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
  /** The file its element stands in, if it was read. */
  readonly file: string | null;
  readonly reading: ElementReading | null;
}

/**
 * Analyses a source.
 *
 * `listed` is what `resolveComponents` found in the tree. A component of any type gets a row. A standard object
 * that the source holds only as fields or rules gets one that is not defined. Fields and rules that stand
 * inside the file of their object, as Salesforce hands them out, are read from there.
 */
export function analyseSource(tree: SourceTree, listed: readonly ResolvedComponent[]): SourceAnalysis {
  const issues: AnalysisIssue[] = [];
  const registry = new KeyRegistry();
  const entries: Entry[] = [];
  const failedFiles = new Set<string>();
  const unreadable = new Set<string>();
  /** The documents of files that hold several components, and in each the elements by kind and name. */
  const shared = new Map<string, XmlDocument | null>();
  const elements = new Map<string, Map<string, XmlElement>>();
  /** The hash of such a file as a whole, for the parts that cannot be told from the rest of it. */
  const wholeHashes = new Map<string, Uint8Array>();

  const bytesOf = (path: string): Uint8Array | null => {
    try {
      return tree.read(path);
    } catch {
      if (!unreadable.has(path)) {
        unreadable.add(path);
        issues.push({
          severity: 'error',
          code: 'FILE_UNREADABLE',
          message: `${path} could not be read.`,
          componentKey: null,
          details: { path },
        });
      }
      return null;
    }
  };

  const parse = (path: string, bytes: Uint8Array): XmlDocument | null => {
    const { document, issue } = readXml(bytes);
    if (issue !== null && !failedFiles.has(path)) {
      failedFiles.add(path);
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

  /** Gives a component its key, or reports why it has none. */
  const register = (type: string, fullName: string, file: string | undefined): ComponentKey | null => {
    let key: ComponentKey;
    try {
      key = buildKey({ type, fullName });
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'KEY_INVALID',
        message: `The ${type} "${fullName.slice(0, 80)}" cannot be given a key: ${error instanceof Error ? error.message : String(error)}`,
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

  /** Reads the element of a component of an analysed type. */
  const read = (type: string, fullName: string, document: XmlDocument, element: XmlElement): ElementReading =>
    type === 'CustomObject'
      ? readObject(element)
      : type === 'CustomField'
        ? readField(document, element, beforeDot(fullName))
        : readRule(document, element);

  /** The fields and rules that stand inside the file of an object. */
  const partsOf = (object: string, file: string, document: XmlDocument): void => {
    for (const [type, group] of Object.entries(ANALYSED)) {
      if (group === undefined) continue;
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
          file,
          reading: read(type, fullName, document, element),
        });
      }
    }
  };

  const add = (component: ResolvedComponent): void => {
    const { type, fullName, files, within } = component;
    // The file a component is said to be defined in: its metadata file if it has one.
    const main = files.find((file) => file.endsWith('-meta.xml')) ?? files[0];
    const key = register(type, fullName, main ?? within?.file);
    if (key === null) return;

    if (main === undefined) {
      if (within === undefined) {
        entries.push({ key, type, name: fullName, definition: null, file: null, reading: null });
        return;
      }
      const element = elementIn(within, fullName);
      const document = shared.get(within.file) ?? null;
      if (element === null || document === null) {
        // The part cannot be told from the rest of the file. The component is defined there all the same.
        if (document !== null) {
          issues.push({
            severity: 'warning',
            code: 'ELEMENT_NOT_FOUND',
            message: `${within.file} holds no element "${within.element}" for the ${type} "${fullName}".`,
            componentKey: key,
            details: { path: within.file, element: within.element },
          });
        }
        let contentHash = wholeHashes.get(within.file);
        if (contentHash === undefined) {
          contentHash = sha256(bytesOf(within.file) ?? '');
          wholeHashes.set(within.file, contentHash);
        }
        const definition = { path: within.file, contentHash };
        entries.push({ key, type, name: fullName, definition, file: null, reading: null });
        return;
      }
      entries.push({
        key,
        type,
        name: fullName,
        definition: { path: within.file, contentHash: sha256(document.text.slice(element.start, element.end)) },
        file: within.file,
        reading: isAnalysed(type) ? read(type, fullName, document, element) : null,
      });
      return;
    }

    const contents = files.map((file) => ({ file, bytes: bytesOf(file) }));
    const [only] = contents;
    const contentHash =
      contents.length === 1 && only !== undefined && only.bytes !== null
        ? sha256(only.bytes)
        : sha256(
            contents
              .map(
                ({ file, bytes }) => `${bytes === null ? '-' : Buffer.from(sha256(bytes)).toString('hex')} ${file}\n`,
              )
              .join(''),
          );
    const definition = { path: main, contentHash };

    let reading: ElementReading | null = null;
    const bytes = isAnalysed(type) ? (contents.find((one) => one.file === main)?.bytes ?? null) : null;
    const document = bytes === null ? null : parse(main, bytes);
    if (document !== null) {
      if (document.root.local === type) {
        reading = read(type, fullName, document, document.root);
        if (type === 'CustomObject') partsOf(fullName, main, document);
      } else {
        const { line, column } = document.place(document.root.start);
        issues.push({
          severity: 'error',
          code: 'METADATA_UNEXPECTED',
          message: `${main} is the file of a ${type}, and its root element is "${document.root.local.slice(0, 60)}".`,
          componentKey: key,
          details: { path: main, line, column },
        });
      }
    }
    entries.push({ key, type, name: fullName, definition, file: reading === null ? null : main, reading });
  };

  for (const component of listed) {
    try {
      add(component);
    } catch (error) {
      // A fault of the analyser, not of the source. It costs this component its analysis and nothing else.
      let key: ComponentKey | null = null;
      try {
        key = buildKey({ type: component.type, fullName: component.fullName });
      } catch {
        // A component without a key has no row.
      }
      issues.push({
        severity: 'error',
        code: 'ANALYSIS_FAILED',
        message: `The analysis of a ${component.type} failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`,
        componentKey: key,
        details: { type: component.type },
      });
      if (key !== null && !entries.some((entry) => entry.key === key)) {
        if (!registry.has(key)) registry.register({ key, displayName: component.fullName });
        if (registry.displayName(key) === component.fullName) {
          const { type, fullName: name } = component;
          entries.push({ key, type, name, definition: null, file: null, reading: null });
        }
      }
    }
  }

  // An object that the source holds only parts of gets a component that is not defined.
  for (const entry of [...entries]) {
    const parent = parentKey(entry.key);
    if (parent === undefined || registry.has(parent) || parseKey(parent).type !== 'CustomObject') continue;
    const name = entry.type === 'CustomMetadata' ? `${beforeDot(entry.name)}__mdt` : beforeDot(entry.name);
    registry.register({ key: parent, displayName: name });
    entries.push({ key: parent, type: 'CustomObject', name, definition: null, file: null, reading: null });
  }

  const fields = new Map<ComponentKey, FieldFacts>();
  const namedObjects = new Set<string>();
  for (const { key, reading } of entries) {
    const facts = reading?.facts ?? null;
    if (facts === null) continue;
    fields.set(key, facts);
    for (const name of facts.referenceTo) namedObjects.add(name);
  }
  const model = buildModel({
    defined: new Set(entries.filter((entry) => entry.definition !== null).map((entry) => entry.key)),
    objects: entries.filter((entry) => entry.type === 'CustomObject').map((entry) => entry.name),
    namedObjects,
    fields,
  });

  const components = entries.map((entry): AnalysedComponent => {
    const { key, name, definition, file, reading } = entry;
    if (reading === null || file === null) return { key, name, definition, attrs: null, references: [] };
    for (const unread of reading.unread) {
      issues.push({
        severity: 'warning',
        code: 'NAME_NOT_READ',
        message: `${file}, line ${String(unread.line)}: the element "${unread.element}" holds "${unread.text}", which is not read as a name.`,
        componentKey: key,
        details: { path: file, line: unread.line, column: unread.column, element: unread.element },
      });
    }
    const object = entry.type === 'CustomObject' ? name : beforeDot(name);
    const resolved = resolveReferences(model, { key, file, object }, reading.references);
    issues.push(...resolved.issues);
    return { key, name, definition, attrs: reading.attrs, references: resolved.references };
  });
  components.sort((a, b) => byCodeUnit(a.key, b.key));

  const analysed = entries.filter((entry) => entry.reading !== null).length;
  return {
    components,
    work: [{ origin: 'parser:xml', components: analysed, failedFiles: failedFiles.size }],
    issues,
  };
}
