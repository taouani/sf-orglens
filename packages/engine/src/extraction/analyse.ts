/**
 * The analysis of a source: a component for everything it holds, and for objects, fields, validation rules,
 * record types, field sets, records of custom metadata types, flows, workflow rules and their actions, email
 * templates, report types and quick actions their attributes, the references that are written in XML and those
 * that stand in a formula or a text. A flow gets a component for each of its elements and resources as well.
 *
 * It works on a tree of files and on the list of the components the files make up (`sources/resolve.ts`), and
 * on nothing else: it does not know whether the files come from an org or from a repository.
 *
 * The code of an Apex class and of a trigger is parsed, where a reader of Apex is given, and a file that does not
 * parse is an error of its component (decision record 0083). A class or a trigger that parses is a component with
 * a component for each of its members, which refer to the types they use (`apex.ts`, decision record 0084).
 *
 * A component it is handed is never dropped without an issue, and a failure costs the one component it happens
 * in. Decision records 0041 and 0042 list what it does not read.
 */
import { hash } from 'node:crypto';
import type { JsonValue } from '../core/errors.ts';
import {
  buildKey,
  foldName,
  KeyRegistry,
  parentKey,
  parseKey,
  type ComponentKey,
  type SubComponent,
} from '../core/keys.ts';
import type { Reference, ReferenceOrigin } from '../core/references.ts';
import type { ObjectDescription } from '../sources/describe.ts';
import type { ResolvedComponent } from '../sources/resolve.ts';
import { byCodeUnit, type SourceTree } from '../sources/tree.ts';
import { cut, type AnalysedComponent, type AnalysisIssue, type OriginWork } from './analysed.ts';
import {
  buildApexTypes,
  readApexUnit,
  resolveApex,
  type ApexPart,
  type ApexUnitReading,
  type TypeUse,
} from './apex.ts';
import { buildApexResolver, type ApexUnitInput } from './apex-resolver.ts';
import { buildApexSchema } from './apex-schema.ts';
import type { ApexReader, Problem, Span, Unit } from './apex-syntax.ts';
import { readRecord } from './custom-metadata.ts';
import { readEmailTemplate } from './email-templates.ts';
import { readFlow, type FlowReading } from './flows.ts';
import { buildModel, type FieldFacts } from './model.ts';
import { readField, readFieldSet, readObject, readRecordType, readRule, type ElementReading } from './objects.ts';
import { readQuickAction } from './quick-actions.ts';
import { resolveReferences, type Unread } from './raw-references.ts';
import { readReportType } from './report-types.ts';
import { textOf } from './values.ts';
import { readWorkflow, readWorkflowPart, WORKFLOW_PARTS } from './workflows.ts';
import { childOf, childrenOf, readText, readXml, type XmlDocument, type XmlElement, type XmlReading } from './xml.ts';

export interface SourceAnalysis {
  /**
   * The metadata types that are read, sorted: an answer counts what refers to a component through them as known. A
   * component of another type gets a row and nothing else, but for classes and triggers, which are read in part.
   */
  readonly types: readonly string[];
  /** Every component of the source, each key once, sorted by key. */
  readonly components: readonly AnalysedComponent[];
  readonly work: readonly OriginWork[];
  readonly issues: readonly AnalysisIssue[];
}

/** What an analysis is given besides the files and the list of components. */
export interface AnalysisOptions {
  /**
   * The reader of Apex (`loadApexReader`). Without it the code of classes and triggers is not parsed. A source
   * that holds Apex is analysed with it (`readsApex`).
   */
  readonly apex?: ApexReader;
  /**
   * The descriptions of the objects of the org the snapshot was taken of (decision record 0080). The resolver of
   * Apex checks names against them where no file defines them (decision record 0087).
   */
  readonly descriptions?: readonly ObjectDescription[];
}

/** The types whose code is Apex. They are analysed where a reader of Apex is given. */
const APEX_KINDS: ReadonlySet<string> = new Set(['ApexClass', 'ApexTrigger']);

/** Whether an analysis of these components needs the reader of Apex: whether one of them is a class or a trigger. */
export const readsApex = (listed: readonly ResolvedComponent[]): boolean =>
  listed.some((component) => APEX_KINDS.has(component.type));

/** The text that Salesforce hands out for a class whose code it hides, as it does for a class of a managed package. */
const HIDDEN = '(hidden)';
/** It drops a byte order mark, which is no Apex, so that the places of the text are those the reader gives. */
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** The text a span of a declaration covers. */
function spannedText(source: string, starts: readonly number[], span: Span): string {
  const offset = (line: number, column: number): number => (starts[line - 1] ?? source.length) + column - 1;
  return source.slice(offset(span.start.line, span.start.column), offset(span.end.line, span.end.column));
}

/** The types whose files are XML and are read as such. A component of another type gets a row and nothing else. */
const ANALYSED: ReadonlySet<string> = new Set([
  'CustomObject',
  'CustomField',
  'CustomMetadata',
  'EmailTemplate',
  'FieldSet',
  'Flow',
  'QuickAction',
  'RecordType',
  'ReportType',
  'ValidationRule',
  'Workflow',
  ...WORKFLOW_PARTS,
]);

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
/**
 * The custom metadata type of a record, by the full name of the record, which starts with the type, with or
 * without its suffix.
 */
const typeOfRecord = (fullName: string): string => {
  const type = beforeDot(fullName);
  return /__mdt$/i.test(type) ? type : `${type}__mdt`;
};

/** The reader whose names the references of a component of this type are, outside its formulas. */
const originOf = (type: string): ReferenceOrigin => (type === 'Flow' ? 'parser:flow' : 'parser:xml');

/** A component with a row, while the model is not built yet. */
interface Entry {
  readonly key: ComponentKey;
  /** The metadata type. An element of a flow has the type of the flow. */
  readonly type: string;
  readonly name: string;
  readonly definition: AnalysedComponent['definition'];
  /** What was read of it, with the file each reading is of. Empty: nothing of it was analysed. */
  readonly readings: readonly { readonly file: string; readonly reading: ElementReading }[];
  /** Of a class or a trigger that parsed, and of each of its members: what the reader of Apex found. */
  readonly apex?: {
    readonly file: string;
    /** The class or the trigger it belongs to. */
    readonly unit: ComponentKey;
    readonly attrs: Readonly<Record<string, JsonValue>>;
    readonly uses: readonly TypeUse[];
  };
}

/**
 * Analyses a source.
 *
 * `listed` is what `resolveComponents` found in the tree, in any order. A component of any type gets a row. An
 * object that the source holds only parts of gets one that is not defined. The parts that stand inside the
 * file of their object, as Salesforce hands them out, get a row each, and fields and rules are read from there.
 */
export function analyseSource(
  tree: SourceTree,
  listed: readonly ResolvedComponent[],
  options: AnalysisOptions = {},
): SourceAnalysis {
  const issues: AnalysisIssue[] = [];
  const registry = new KeyRegistry();
  const { apex } = options;
  const entries: Entry[] = [];
  /** Files the reader refused, and files that could not be opened. Each is reported once. */
  const refused = new Set<string>();
  const unreadable = new Set<string>();
  /** The documents of files that hold several components, and in each the elements by kind and name. */
  const shared = new Map<string, XmlDocument | null>();
  const elements = new Map<string, Map<string, XmlElement>>();
  /** The hash of such a file as a whole, for the parts that cannot be told from the rest of it. */
  const wholeHashes = new Map<string, Uint8Array>();
  /** The files of flows: one that cannot be read is counted for the reader of flows. */
  const flowFiles = new Set<string>();
  /** The files of classes and triggers, and those of them that do not parse, which are counted for Apex. */
  const apexFiles = new Set<string>();
  const malformed = new Set<string>();
  /** The inner types of each class or trigger that parsed. */
  const innerTypes = new Map<ComponentKey, ApexUnitReading['inner']>();
  /** Each class and trigger that parsed, with the parts of it that are components, for the resolver of Apex. */
  const apexUnits: ApexUnitInput[] = [];

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

  /** Says why a file was not read, once for each file. */
  const refuse = (path: string, issue: NonNullable<XmlReading['issue']>): void => {
    if (refused.has(path)) return;
    refused.add(path);
    issues.push({
      severity: 'error',
      code: issue.code,
      message: `${path}: ${issue.message}`,
      componentKey: null,
      details: { path, line: issue.place?.line ?? null, column: issue.place?.column ?? null },
    });
  };

  const parse = (path: string, bytes: Uint8Array): XmlDocument | null => {
    const { document, issue } = readXml(bytes);
    if (issue !== null) refuse(path, issue);
    return document;
  };

  /** True if the root element of the file of a component is of its type. Says so where it is not. */
  const rootIs = (key: ComponentKey, type: string, file: string, document: XmlDocument): boolean => {
    if (document.root.local === type) return true;
    const { line, column } = document.place(document.root.start);
    issues.push({
      severity: 'error',
      code: 'METADATA_UNEXPECTED',
      message: `${file} is the file of a ${type}, and its root element is "${cut(document.root.local, 60)}".`,
      componentKey: key,
      details: { path: file, line, column },
    });
    return false;
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

  /**
   * Gives a component its key, or reports why it has none. `part` is its place below the component of the type and
   * the full name, for a component that is a part of one, such as an element of a flow, with its name and what it
   * is called in a message.
   */
  const register = (
    type: string,
    fullName: string,
    file: string | undefined,
    part?: { readonly subs: readonly SubComponent[]; readonly shown: string; readonly what: string },
  ): ComponentKey | null => {
    const shown = part?.shown ?? fullName;
    let key: ComponentKey;
    try {
      key = buildKey({ type, fullName, ...(part === undefined ? {} : { subs: part.subs }) });
    } catch (error) {
      issues.push({
        severity: 'error',
        code: 'KEY_INVALID',
        message: `The ${part?.what ?? type} "${cut(shown, 80)}" cannot be given a key: ${messageOf(error)}`,
        componentKey: null,
        details: { type, path: file ?? null },
      });
      return null;
    }
    const collision = registry.register({ key, displayName: shown, ...(file === undefined ? {} : { file }) });
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
      if (type === 'CustomObject') return readObject(document, element);
      if (type === 'CustomField') return readField(document, element, beforeDot(fullName));
      if (type === 'ValidationRule') return readRule(document, element, beforeDot(fullName));
      if (type === 'RecordType') return readRecordType(document, element, beforeDot(fullName));
      if (type === 'FieldSet') return readFieldSet(document, element, beforeDot(fullName));
      if (type === 'CustomMetadata') return readRecord(document, element, typeOfRecord(fullName));
      if (type === 'ReportType') return readReportType(document, element);
      if (type === 'QuickAction') return readQuickAction(document, element, fullName);
      if (type === 'Workflow') return readWorkflow();
      // The parts of a file of workflow rules are of the object the file is named after.
      if (WORKFLOW_PARTS.has(type)) return readWorkflowPart(type, document, element, beforeDot(fullName));
      return null;
    } catch (error) {
      failed(key, type, file, error);
      return null;
    }
  };
  /**
   * Parses the code of a class or a trigger, and says where it cannot be read. Gives the file of its code with the
   * unit the reader made of it, or `null` where nothing of it can be analysed. A class whose code Salesforce hides
   * is not parsed, and a warning says that what it refers to is not known. A reader that throws has a fault of its
   * own, which costs the component as any fault of an analyser.
   */
  const parseApex = (
    reader: ApexReader,
    key: ComponentKey,
    type: string,
    contents: readonly { readonly file: string; readonly bytes: Uint8Array | null }[],
  ): { readonly file: string; readonly source: string; readonly unit: Unit } | null => {
    const what = type === 'ApexTrigger' ? 'trigger' : 'class';
    const code = contents.filter(({ file }) => !file.endsWith('-meta.xml'));
    for (const { file } of contents) apexFiles.add(file);
    const noCode = (file: string, said: string): null => {
      issues.push({
        severity: 'warning',
        code: 'APEX_NO_CODE',
        message: `${file} ${said} Nothing of the ${what} is analysed, so what it refers to is not known.`,
        componentKey: key,
        details: { path: file },
      });
      return null;
    };
    const [only] = code;
    if (only === undefined) {
      const meta = contents[0]?.file;
      return meta === undefined ? null : noCode(meta, `stands for a ${what} that has no file of code.`);
    }
    const { file, bytes } = only;
    if (bytes === null) return null;
    let source: string;
    try {
      source = utf8.decode(bytes);
    } catch {
      malformed.add(file);
      issues.push({
        severity: 'error',
        code: 'APEX_MALFORMED',
        message: `${file} is not text in UTF-8. Nothing of its Apex is analysed.`,
        componentKey: key,
        details: { path: file, line: null, column: null },
      });
      return null;
    }
    if (source.trim() === HIDDEN) {
      return noCode(
        file,
        `holds "${HIDDEN}" in the place of its code: Salesforce hides the code of a ${what} of a managed package.`,
      );
    }
    let unit: Unit;
    try {
      unit = reader.parseUnit(source, what);
    } catch (error) {
      failed(key, type, file, error);
      return null;
    }
    const [first]: readonly Problem[] = unit.problems;
    if (first === undefined) return { file, source, unit };
    const { line, column } = first.at;
    malformed.add(file);
    issues.push({
      severity: 'error',
      code: 'APEX_MALFORMED',
      message: `${file}, line ${String(line)}, column ${String(column)}: ${first.message} The parser of Apex cannot read the file, and nothing of it is analysed.`,
      componentKey: key,
      details: { path: file, line, column },
    });
    return null;
  };

  /**
   * A class or a trigger that parsed, and its members, each a component below it. A member whose key another one
   * has already is reported and left out, with what it holds.
   */
  const apexParts = (
    key: ComponentKey,
    type: string,
    name: string,
    definition: Entry['definition'],
    parsed: { readonly file: string; readonly source: string; readonly unit: Unit },
  ): void => {
    const { file, source } = parsed;
    const reading = readApexUnit(parsed.unit, name);
    innerTypes.set(key, reading.inner);
    const unitParts: { key: ComponentKey; part: ApexPart }[] = [];
    apexUnits.push({ key, type: type === 'ApexTrigger' ? 'ApexTrigger' : 'ApexClass', file, parts: unitParts });
    const starts = [0];
    for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
    const what = type === 'ApexTrigger' ? 'member of a trigger' : 'member of a class';
    const dropped: string[] = [];
    for (const part of reading.parts) {
      const apexOf = { file, unit: key, attrs: part.attrs, uses: part.uses };
      if (part.subs.length === 0) {
        entries.push({ key, type, name, definition, readings: [], apex: apexOf });
        unitParts.push({ key, part });
        continue;
      }
      const path = part.subs.map((sub) => `${sub.kind}:${foldName(sub.name)}/`).join('');
      if (dropped.some((one) => path.startsWith(one))) continue;
      const member = register(type, name, file, { subs: part.subs, shown: part.name, what });
      if (member === null) {
        dropped.push(path);
        continue;
      }
      unitParts.push({ key: member, part });
      const text = part.spans.map((span) => spannedText(source, starts, span)).join('\n');
      entries.push({
        key: member,
        type,
        name: part.name,
        definition: { path: file, contentHash: sha256(text) },
        readings: [],
        apex: apexOf,
      });
    }
  };

  const readingsOf = (file: string, reading: ElementReading | null): Entry['readings'] =>
    reading === null ? [] : [{ file, reading }];

  /** The elements and resources of a flow, each a component below it. */
  const elementsOf = (
    flow: ComponentKey,
    name: string,
    file: string,
    document: XmlDocument,
    read: FlowReading,
  ): void => {
    for (const { group, line, column } of read.nameless) {
      issues.push({
        severity: 'error',
        code: 'METADATA_UNEXPECTED',
        message: `${file}, line ${String(line)}: an element "${group}" has no name.`,
        componentKey: flow,
        details: { path: file, line, column },
      });
    }
    for (const { name: element, element: xml, reading } of read.elements) {
      const key = register('Flow', name, file, {
        subs: [{ kind: 'element', name: element }],
        shown: `${name}.${element}`,
        what: 'element of a Flow',
      });
      if (key === null) continue;
      entries.push({
        key,
        type: 'Flow',
        name: `${name}.${element}`,
        definition: { path: file, contentHash: sha256(document.text.slice(xml.start, xml.end)) },
        readings: [{ file, reading }],
      });
    }
  };

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

  /**
   * What an email template says. The file of its metadata is XML, and the file of its body is read as text, in
   * the way the metadata says. Nothing is read of the body where the metadata cannot be read.
   */
  const templateReadings = (
    key: ComponentKey,
    contents: readonly { readonly file: string; readonly bytes: Uint8Array | null }[],
  ): Entry['readings'] => {
    const meta = contents.find((one) => one.file.endsWith('-meta.xml'));
    const document = meta === undefined || meta.bytes === null ? null : parse(meta.file, meta.bytes);
    if (meta === undefined || document === null || !rootIs(key, 'EmailTemplate', meta.file, document)) return [];
    // Salesforce keeps the encoding of the email, which can be that of the file.
    const encoding = textOf(childOf(document.root, 'encodingKey'));
    const bodies = contents.flatMap(({ file, bytes }) => {
      if (file === meta.file || bytes === null) return [];
      const { document: body, issue } = readText(bytes, encoding);
      if (issue !== null) refuse(file, issue);
      return body === null ? [] : [{ file, body }];
    });
    try {
      const read = readEmailTemplate(
        document,
        bodies.map((one) => one.body),
      );
      const ofBodies = bodies.flatMap(({ file }, index) => {
        const reading = read.bodies[index];
        return reading === undefined ? [] : [{ file, reading }];
      });
      return [{ file: meta.file, reading: read.meta }, ...ofBodies];
    } catch (error) {
      failed(key, 'EmailTemplate', meta.file, error);
      return [];
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
    if (APEX_KINDS.has(type) && apex !== undefined) {
      const parsed = parseApex(apex, key, type, contents);
      if (parsed === null) entries.push({ key, type, name, definition, readings: [] });
      else apexParts(key, type, name, definition, parsed);
      return;
    }
    // An object, a field and a rule have no file that is not XML. An object that lies in two package folders
    // can have a file of its own in each, and both are read. An email template is read on its own.
    const readings: { file: string; reading: ElementReading }[] = [];
    const documents: { file: string; document: XmlDocument }[] = [];
    const flows: { file: string; document: XmlDocument; read: FlowReading }[] = [];
    if (type === 'Flow') for (const file of files) flowFiles.add(file);
    if (type === 'EmailTemplate') for (const one of templateReadings(key, contents)) readings.push(one);
    for (const { file, bytes } of ANALYSED.has(type) && type !== 'EmailTemplate' ? contents : []) {
      const document = bytes === null ? null : parse(file, bytes);
      if (document === null || !rootIs(key, type, file, document)) continue;
      if (type === 'Flow') {
        try {
          const flow = readFlow(document);
          readings.push({ file, reading: flow.flow });
          flows.push({ file, document, read: flow });
        } catch (error) {
          failed(key, type, file, error);
        }
        continue;
      }
      const reading = read(key, type, name, file, document, document.root);
      if (reading !== null) readings.push({ file, reading });
      documents.push({ file, document });
    }
    // The component first, so that it has its row whatever happens in its parts.
    entries.push({ key, type, name, definition, readings });
    if (type === 'CustomObject') for (const { file, document } of documents) partsOf(name, file, document);
    for (const { file, document, read: flow } of flows) elementsOf(key, name, file, document, flow);
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
    const name = entry.type === 'CustomMetadata' ? typeOfRecord(entry.name) : beforeDot(entry.name);
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
  // Every class and trigger is a type a name can stand for, also one that did not parse.
  const apexTypes = buildApexTypes({
    units: entries.flatMap(({ key, type, name }) =>
      (type === 'ApexClass' || type === 'ApexTrigger') && !key.includes('#') ? [{ key, type, name }] : [],
    ),
    inner: innerTypes,
  });
  const apexResolver = buildApexResolver(apexUnits, buildApexSchema(model, options.descriptions), apexTypes);

  const analysed = new Map<ReferenceOrigin, number>();
  let withFormula = 0;
  const formulasNotRead = new Set<string>();

  /**
   * The issue for something a reader did not read as a name. `where` says in what it stands, and `type` is the
   * type of the component. The body of an email template is no XML, so a merge field there stands in no element.
   */
  const notRead = (key: ComponentKey, type: string, file: string, unread: Unread, where: string): AnalysisIssue => {
    const inElement = unread.element !== '';
    const details = {
      path: file,
      line: unread.line,
      column: unread.column,
      ...(inElement ? { element: unread.element } : {}),
    };
    const place = `${file}, line ${String(unread.line)}`;
    const holder = inElement ? `${where} "${unread.element}"` : 'a merge field';
    const issue = (code: string, message: string): AnalysisIssue => ({
      severity: 'warning',
      code,
      message: `${place}: ${holder} holds "${unread.text}", ${message}`,
      componentKey: key,
      details,
    });
    if (unread.why === 'action-type') {
      // The type of an action that is not known here, or the name of an action that has no type.
      const said =
        unread.element === 'type'
          ? 'which is no type of action of a workflow rule that is known here'
          : 'and the action has no type';
      return issue('NAME_NOT_READ', `${said}. The action is not read.`);
    }
    if (unread.why === 'override-type') {
      // The type of an override that is not known here, or the name in an override that has no type.
      const said =
        unread.element === 'type'
          ? 'which is no type of an override of an action that is known here'
          : 'and the override has no type';
      return issue('NAME_NOT_READ', `${said}. The override is not read.`);
    }
    if (unread.why === 'start') {
      const [first = ''] = unread.text.split('.', 1);
      if (type === 'Flow')
        return issue('RESOURCE_NOT_FOUND', `and the flow has no resource "${first}". It is not read.`);
      // The first name of a merge field of an email template, of a name in a formula of a quick action, or of the
      // table of a column of a report type.
      const said =
        type === 'QuickAction'
          ? `and "${first}" is not the object of the record the action runs on`
          : type === 'ReportType'
            ? `and "${first}" is not the object of the report type`
            : `and the template knows no "${first}"`;
      return issue('NAME_NOT_READ', `${said}. It is not read.`);
    }
    return issue('NAME_NOT_READ', 'which is not read as a name.');
  };

  const components = entries.map((entry): AnalysedComponent => {
    const { key, name, definition, readings } = entry;
    const bare: AnalysedComponent = { key, name, definition, attrs: null, references: [] };
    if (entry.apex !== undefined) {
      const { file, unit, attrs, uses } = entry.apex;
      try {
        const events = attrs['events'];
        const types = resolveApex(
          model,
          apexTypes,
          { key, unit, file },
          uses,
          Array.isArray(events) ? events.map(String) : undefined,
        );
        const code = apexResolver.resolve(key);
        for (const issue of code.issues) issues.push(issue);
        analysed.set('parser:apex', (analysed.get('parser:apex') ?? 0) + 1);
        return { key, name, definition, attrs, references: [...types, ...code.references] };
      } catch (error) {
        failed(key, entry.type, file, error);
        return bare;
      }
    }
    if (readings.length === 0) return bare;
    try {
      const found: AnalysisIssue[] = [];
      const references: Reference[] = [];
      const notReadAsAWhole: string[] = [];
      let formulas = 0;
      const object =
        entry.type === 'CustomObject' ? name : entry.type === 'CustomMetadata' ? typeOfRecord(name) : beforeDot(name);
      const origin = originOf(entry.type);
      for (const { file, reading } of readings) {
        for (const unknown of reading.unknown ?? []) {
          found.push({
            severity: 'warning',
            code: 'FLOW_ELEMENT_UNKNOWN',
            message: `${file}, line ${String(unknown.line)}: "${cut(unknown.element, 60)}" is no kind of element of a flow that is known here. The names in it are read as in the kinds that are known, and recorded as probable.`,
            componentKey: key,
            details: { path: file, line: unknown.line, column: unknown.column, element: cut(unknown.element, 60) },
          });
        }
        for (const unread of reading.unread) found.push(notRead(key, entry.type, file, unread, 'the element'));
        const owner = { key, file, object };
        const resolved = resolveReferences(model, owner, reading.references, origin);
        // One at a time: a formula can hold more names than a call takes arguments.
        for (const issue of resolved.issues) found.push(issue);
        for (const reference of resolved.references) references.push(reference);
        for (const text of reading.texts ?? []) {
          for (const unread of text.unread) found.push(notRead(key, entry.type, file, unread, 'a merge field in'));
          for (const open of text.notClosed) {
            const inElement = text.element !== '';
            found.push({
              severity: 'warning',
              code: 'MERGE_FIELD_NOT_CLOSED',
              message: `${file}, line ${String(open.line)}: a merge field${inElement ? ` in "${text.element}"` : ''} is not closed. Nothing is read of it.`,
              componentKey: key,
              details: {
                path: file,
                line: open.line,
                column: open.column,
                ...(inElement ? { element: text.element } : {}),
              },
            });
          }
          const inText = resolveReferences(model, owner, text.references, origin);
          for (const issue of inText.issues) found.push(issue);
          for (const reference of inText.references) references.push(reference);
        }
        for (const formula of reading.formulas) {
          formulas += 1;
          const { problem, element } = formula;
          if (problem !== null) {
            notReadAsAWhole.push(file);
            found.push({
              severity: 'warning',
              code: 'FORMULA_NOT_READ',
              message: `${file}, line ${String(problem.line)}: the formula in "${element}" was not read as a whole. ${problem.message} The names in it are recorded as probable.`,
              componentKey: key,
              details: { path: file, line: problem.line, column: problem.column, element },
            });
          }
          for (const unread of formula.unread) found.push(notRead(key, entry.type, file, unread, 'the formula in'));
          const inFormula = resolveReferences(model, owner, formula.references, 'parser:formula');
          for (const issue of inFormula.issues) found.push(issue);
          for (const reference of inFormula.references) references.push(reference);
        }
      }
      // Of two files of one object, the first says what both say.
      const attrs: Record<string, JsonValue> = {};
      for (const { reading } of [...readings].reverse()) Object.assign(attrs, reading.attrs);
      for (const issue of found) issues.push(issue);
      analysed.set(origin, (analysed.get(origin) ?? 0) + 1);
      if (formulas > 0) withFormula += 1;
      for (const file of notReadAsAWhole) formulasNotRead.add(file);
      return { key, name, definition, attrs, references };
    } catch (error) {
      failed(key, entry.type, readings[0]?.file ?? null, error);
      return bare;
    }
  });
  components.sort((a, b) => byCodeUnit(a.key, b.key));

  const failedFiles = [...new Set([...refused, ...unreadable])];
  const ofFlows = failedFiles.filter((file) => flowFiles.has(file)).length;
  const ofApex = new Set([...malformed, ...failedFiles.filter((file) => apexFiles.has(file))]).size;
  const ofXml = failedFiles.filter((file) => !flowFiles.has(file) && !apexFiles.has(file)).length;
  return {
    // Classes and triggers are read in part: what their members use as a type, and not yet what their code refers
    // to. An answer counts them as not analysed, and the cross-check does not compare their rows (decision record
    // 0084).
    types: [...ANALYSED].sort(byCodeUnit),
    components,
    work: [
      { origin: 'parser:xml', components: analysed.get('parser:xml') ?? 0, failedFiles: ofXml },
      // Components with a formula, and files with a formula that was not read as a whole.
      { origin: 'parser:formula', components: withFormula, failedFiles: formulasNotRead.size },
      // Flows and their elements, and files of flows that could not be read.
      { origin: 'parser:flow', components: analysed.get('parser:flow') ?? 0, failedFiles: ofFlows },
      // Classes and triggers with their members, and their files that do not parse or could not be read.
      { origin: 'parser:apex', components: analysed.get('parser:apex') ?? 0, failedFiles: ofApex },
    ],
    issues,
  };
}
