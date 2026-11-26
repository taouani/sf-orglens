/**
 * Checks the answer key against the fixture project.
 *
 * The key is the measure every analyser is scored with, so it must be right about the project before any analyser
 * exists. These tests do not analyse anything. They check that the key and the project agree on what the project
 * contains, that every place the key names exists, and that the key follows its own rules.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MetadataResolver, type SourceComponent } from '@salesforce/source-deploy-retrieve';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  buildKey,
  isComponentKey,
  parentKey,
  parseKey,
  type ComponentKey,
  type SubComponent,
} from '../src/core/keys.ts';
import { readXml } from '../src/extraction/xml.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { outlineApex, type ApexOutline } from './helpers/apex-outline.ts';

const key = loadAnswerKey();
const projectDir = join(FIXTURES_DIR, key.project);

/**
 * The components of the project and the component that owns each file, as the Salesforce library sees them.
 *
 * A file of labels holds a component for the file and one for each label in it. The file is owned by the first.
 * `inFile` has all of them: a file of workflow rules holds a component for each rule and each action, and a
 * reference starts from one of those. A Lightning web component and an Aura component are a folder of files, and the
 * component owns every one of them.
 */
const BUNDLES: ReadonlySet<string> = new Set(['LightningComponentBundle', 'AuraDefinitionBundle']);
function resolveProject(): {
  owners: Map<string, ComponentKey>;
  inFile: Map<string, Set<ComponentKey>>;
  resolved: Set<ComponentKey>;
} {
  const owners = new Map<string, ComponentKey>();
  const inFile = new Map<string, Set<ComponentKey>>();
  const resolved = new Set<ComponentKey>();
  const visit = (component: SourceComponent): void => {
    const owner = buildKey({ type: component.type.name, fullName: component.fullName });
    resolved.add(owner);
    const bundle = BUNDLES.has(component.type.name) ? component.walkContent() : [];
    for (const file of [component.xml, component.content, ...bundle]) {
      // The content of an object is its folder. Only files are owned.
      if (file !== undefined && statSync(file).isFile()) {
        const path = relative(projectDir, file).split(sep).join('/');
        if (!owners.has(path)) owners.set(path, owner);
        inFile.set(path, (inFile.get(path) ?? new Set()).add(owner));
      }
    }
    component.getChildren().forEach(visit);
  };
  new MetadataResolver().getComponentsFromPath(join(projectDir, 'force-app')).forEach(visit);
  return { owners, inFile, resolved };
}

const { owners, inFile, resolved } = resolveProject();
const inProject = new Set<ComponentKey>(key.components.map((component) => component.key));
const standard = new Set<ComponentKey>(key.standard);

/** The key of the metadata component a key belongs to: itself, or the class of a method. */
function componentOf(of: ComponentKey): ComponentKey {
  let current = of;
  while (parseKey(current).subs.length > 0) {
    const parent = parentKey(current);
    if (parent === undefined) break;
    current = parent;
  }
  return current;
}

const isApex = (file: string): boolean => file.endsWith('.cls') || file.endsWith('.trigger');
const readProjectFile = (file: string): string => readFileSync(join(projectDir, file), 'utf8');

const outlines = new Map<string, ApexOutline>();
function outline(file: string): ApexOutline {
  let found = outlines.get(file);
  if (found === undefined) outlines.set(file, (found = outlineApex(readProjectFile(file))));
  return found;
}

/**
 * The files of markup and JavaScript that version 3 reads: of a Lightning web component, of an Aura component and
 * of a page. They are no XML of the Metadata API, and they are no Apex.
 */
const isMarkup = (file: string): boolean => /\/(?:lwc|aura)\/[^/]+\/[^/]+\.(?:js|html|cmp)$|\.page$/.test(file);
/** What kind of file of markup or JavaScript it is: `lwc-js`, `lwc-html`, `aura-cmp`, `aura-js` or `page`. */
function markupKind(file: string): string {
  if (file.endsWith('.page')) return 'page';
  const bundle = file.includes('/lwc/') ? 'lwc' : 'aura';
  return `${bundle}-${file.endsWith('.cmp') ? 'cmp' : file.endsWith('.html') ? 'html' : 'js'}`;
}

/**
 * Every type and every member that the Apex of the project declares, by its key, with what it is. The outer type of
 * a file has the key of its component.
 */
const apexDeclared = new Map<ComponentKey, 'type' | 'interface' | SubComponent['kind']>();
for (const [file, owner] of owners) {
  if (!isApex(file)) continue;
  const { type, name } = parseKey(owner);
  const { members, types } = outline(file);
  for (const { subs } of members) {
    const last = subs.at(-1);
    if (last !== undefined && last.kind !== 'inner')
      apexDeclared.set(buildKey({ type, fullName: name, subs }), last.kind);
  }
  for (const declared of types) {
    apexDeclared.set(
      buildKey({ type, fullName: name, subs: declared.subs }),
      declared.isInterface ? 'interface' : 'type',
    );
  }
}
/** Whether a target is a type of the project, a class or an interface, outer or inner. */
const isApexType = (target: ComponentKey): boolean =>
  apexDeclared.get(target) === 'type' || apexDeclared.get(target) === 'interface';
/** Whether a type of the project declares a constructor. */
const declaresConstructor = (target: ComponentKey): boolean =>
  [...apexDeclared].some(([member, what]) => what === 'ctor' && parentKey(member) === target);
/** The name a member of Apex is called by: a method without its parameters, a constructor by its type. */
function memberName(target: ComponentKey): string {
  const last = parseKey(target).subs.at(-1);
  if (last === undefined) return parseKey(target).name;
  if (last.kind === 'ctor') return memberName(parentKey(target) ?? target);
  return last.name.replace(/\(.*$/, '');
}

/** The ways a metadata file names a target, besides `text` and `credential`, which Apex uses too. */
const METADATA_VIA: ReadonlySet<string> = new Set([
  'parameter',
  'formula',
  'filter',
  'summary',
  'lookup',
  'display-field',
  'controlling-field',
  'value-set',
  'object',
  'record',
  'sort',
  'output',
  'assignment',
  'path',
  'merge-field',
  'time',
  'action',
  'template',
  'listed-field',
  'value',
  'record-of',
  'join',
]);

/** The ways Apex names a target. */
const APEX_VIA: ReadonlySet<string> = new Set([
  'field',
  'soql',
  'sosl',
  'dml',
  'token',
  'text',
  'declaration',
  'call',
  'new',
  'type',
  'credential',
]);

/** The ways each kind of file of markup and JavaScript names a target (see `markupKind`). */
const MARKUP_VIA: Readonly<Record<string, ReadonlySet<string>>> = {
  'lwc-js': new Set(['import']),
  'lwc-html': new Set(['attribute', 'tag']),
  'aura-cmp': new Set(['attribute', 'tag', 'merge-field']),
  'aura-js': new Set(['text']),
  page: new Set(['attribute']),
};

/** The ways a file of the project can name a target. */
function viasOf(file: string): ReadonlySet<string> {
  if (isApex(file)) return APEX_VIA;
  if (isMarkup(file)) return MARKUP_VIA[markupKind(file)] ?? new Set();
  return new Set([...METADATA_VIA, 'text', 'credential']);
}

/**
 * The types a metadata file can name besides fields and objects. Such a target is referred to, never read. A
 * flow and an Apex class are among them where they are not called.
 */
const NAMED_ONLY: ReadonlySet<string> = new Set([
  'CustomLabel',
  'CustomMetadata',
  'CustomPermission',
  'EmailTemplate',
  'GlobalValueSet',
  'RecordType',
  'WorkflowAlert',
  'WorkflowFieldUpdate',
  'WorkflowOutboundMessage',
  'WorkflowTask',
]);

/** The operators of an assignment of a flow that read the value they change. */
const READS_AND_WRITES = ['Add', 'Subtract'];

/**
 * Where a reference of each kind of naming stands in a metadata file: the element that holds the word, and where
 * that is not enough an element around that one. The body of an email is no XML, so it has no element.
 */
const PLACE_OF_VIA: Readonly<Record<string, { in: readonly string[]; within?: readonly string[] }>> = {
  formula: {
    in: ['formula', 'errorConditionFormula', 'defaultValue', 'expression', 'filterFormula', 'formulaExpression'],
  },
  filter: { in: ['field', 'valueField'], within: ['lookupFilter', 'summaryFilterItems', 'filters', 'criteriaItems'] },
  summary: { in: ['summarizedField', 'summaryForeignKey'] },
  lookup: { in: ['referenceTo'] },
  'display-field': { in: ['errorDisplayField', 'fieldSelection'] },
  'controlling-field': { in: ['controllingField', 'metadataRelationshipControllingField'] },
  'value-set': { in: ['valueSetName'] },
  object: {
    in: ['object', 'stringValue', 'baseObject', 'targetObject', 'typeValue'],
    within: ['Flow', 'ReportType', 'QuickAction'],
  },
  record: { in: ['inputReference'] },
  sort: { in: ['sortField'] },
  output: {
    in: ['queriedFields', 'field', 'displayField', 'valueField'],
    within: ['recordLookups', 'outputAssignments', 'dynamicChoiceSets'],
  },
  assignment: { in: ['field', 'targetParentField'], within: ['inputAssignments', 'fieldUpdates', 'QuickAction'] },
  path: {
    in: [
      'leftValueReference',
      'elementReference',
      'assignToReference',
      'inputReference',
      'objectFieldReference',
      'targetObject',
    ],
  },
  'merge-field': { in: ['errorMessage', 'fieldText', 'text', 'subject', ''] },
  time: { in: ['recordField', 'offsetFromField'] },
  action: { in: ['actionName', 'flowName', 'name'], within: ['actionCalls', 'subflows', 'actions'] },
  template: { in: ['template'] },
  'listed-field': {
    in: ['field', 'fields', 'picklist'],
    within: [
      'availableFields',
      'displayedFields',
      'recipients',
      'outboundMessages',
      'picklistValues',
      'values',
      'columns',
      'quickActionLayoutItems',
    ],
  },
  join: { in: ['relationship'], within: ['join'] },
  value: { in: ['value'], within: ['values'] },
  text: { in: ['value', 'stringValue'], within: ['values', 'conditions'] },
  'record-of': { in: ['CustomMetadata'] },
  // Version 3: the external credential a named credential signs in with, and a parameter of an Apex action.
  credential: { in: ['externalCredential'], within: ['namedCredentialParameters'] },
  parameter: { in: ['name'], within: ['inputParameters'] },
};

/**
 * Where the element that holds the word says too little: the element that must stand directly around it. A
 * `field` is a field a query stores only in an output assignment, and in a filter it is a filter.
 */
const PARENT_OF: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  output: {
    field: ['outputAssignments'],
    queriedFields: ['recordLookups'],
    displayField: ['dynamicChoiceSets'],
    valueField: ['dynamicChoiceSets'],
  },
  action: { actionName: ['actionCalls'], flowName: ['subflows'], name: ['actions'] },
  // The object of a process stands in a value at the top of its file.
  // The object of a generic type of an Apex action stands in its mapping of types.
  object: {
    stringValue: ['value'],
    baseObject: ['ReportType'],
    targetObject: ['QuickAction'],
    typeValue: ['dataTypeMappings'],
  },
  // A quick action sets a field of its predefined values, and the lookup to the record it runs on.
  assignment: {
    field: ['inputAssignments', 'fieldUpdates', 'fieldOverrides'],
    targetParentField: ['QuickAction'],
  },
  text: { stringValue: ['rightValue'] },
  parameter: { name: ['inputParameters'] },
};

/** What each record element of a flow does to the records of its object. A choice set and a schedule read them. */
const OP_OF_ELEMENT: Readonly<Record<string, string>> = {
  recordLookups: 'lookup',
  recordCreates: 'create',
  recordUpdates: 'update',
  recordDeletes: 'delete',
  dynamicChoiceSets: 'lookup',
  start: 'lookup',
};

/** A reference of a metadata file, as far as the rules about its place read it. */
interface Placed {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
  readonly kind: string;
  readonly to: ComponentKey;
  readonly via: string;
  readonly op?: string | undefined;
}

/**
 * The kinds a reference in a metadata file must have, by where it stands, as a sorted list joined by a space.
 * Most places allow one kind. Two stand at the same place where a value is read and written at once.
 */
function kindsAt(reference: Placed, elements: readonly string[]): string {
  const innermost = elements.at(-1) ?? '';
  const target = parseKey(reference.to).type;
  const used = target === 'CustomField' ? 'reads' : 'references';
  const text = readProjectFile(reference.file);
  const lines = text.split('\n');
  const line = lines[reference.line - 1] ?? '';
  const isLast = line.charAt(reference.column - 1 + reference.match.length) === '<';
  switch (reference.via) {
    case 'formula':
    case 'filter':
    case 'sort':
    case 'output':
    case 'time':
    case 'merge-field':
      return used;
    case 'summary':
      return innermost === 'summarizedField' ? 'reads' : 'references';
    case 'listed-field': {
      // A field set, an alert, an outbound message and the layout of a quick action use the field, and the layout
      // sets one the user types in. A record type and a record of a custom metadata type name it, and so does a
      // report type, which reads the lookup fields of a path.
      if (elements.includes('columns'))
        return line.charAt(reference.column - 1 + reference.match.length) === '.' ? 'reads' : 'references';
      if (elements.includes('quickActionLayoutItems')) {
        const item = lines.slice(reference.line).join('\n').split('</quickActionLayoutItems>')[0] ?? '';
        const behavior = /<uiBehavior>(\w+)<\/uiBehavior>/.exec(item)?.[1] ?? '';
        return behavior === 'Edit' || behavior === 'Required' ? 'reads writes' : 'reads';
      }
      return elements.includes('values') || elements.includes('picklistValues') ? 'references' : 'reads';
    }
    // A flow sets a parameter of an Apex action, which is an invocable variable of the class.
    case 'assignment':
    case 'parameter':
      return 'writes';
    case 'path': {
      if (target !== 'CustomField') return 'references';
      // The last step of a path that is assigned to is written. Every step before it is read.
      if (innermost === 'objectFieldReference' && isLast) return 'reads writes';
      if (innermost === 'assignToReference' && isLast) {
        const operator = /<operator>(\w+)<\/operator>/.exec(lines.slice(reference.line).join('\n'))?.[1] ?? '';
        return READS_AND_WRITES.includes(operator) ? 'reads writes' : 'writes';
      }
      return 'reads';
    }
    case 'object': {
      // A record starts the flow, or the flow reads and writes records of the object.
      const starts =
        (innermost === 'stringValue' && elements[1] === 'processMetadataValues') ||
        (elements.includes('start') && text.includes('<recordTriggerType>'));
      return starts ? 'triggers-on' : 'references';
    }
    case 'action':
      return target === 'Flow' || target === 'ApexClass' ? 'calls' : 'references';
    default:
      return 'references';
  }
}

/**
 * Where a place of a metadata file stands: the elements around it, from the outside in, and whether it is code of a
 * formula, a comment of it or a text of it. The formula is read as the file holds it, with its entities.
 */
function metadataPlace(file: string, line: number, column: number): { elements: string[]; region: string } {
  const text = readProjectFile(file);
  const lines = text.split('\n');
  const offset = lines.slice(0, line - 1).reduce((sum, one) => sum + one.length + 1, 0) + column - 1;
  const elements: string[] = [];
  let contentStart = 0;
  for (const tag of text.matchAll(/<(\/?)([A-Za-z]\w*)[^>]*?(\/?)>/g)) {
    if (tag.index >= offset) break;
    if (tag[1] === '/') elements.pop();
    else if (tag[3] !== '/') elements.push(tag[2] ?? '');
    contentStart = tag.index + tag[0].length;
  }
  let region = 'code';
  let at = contentStart;
  while (at < offset) {
    const rest = text.slice(at, at + 6);
    const quote = rest.startsWith('&quot;') ? '"' : rest.startsWith('&apos;') ? "'" : /^["']/.test(rest) ? rest[0] : '';
    const step = rest.startsWith('&quot;') || rest.startsWith('&apos;') ? 6 : 1;
    if (region === 'code') {
      if (rest.startsWith('/*')) region = 'comment';
      else if (quote !== '') region = `text ${quote ?? ''}`;
      at += rest.startsWith('/*') ? 2 : step;
    } else if (region === 'comment') {
      // A backslash keeps the end of a comment inside it.
      if (rest.startsWith('\\*/')) at += 3;
      else {
        if (rest.startsWith('*/')) region = 'code';
        at += rest.startsWith('*/') ? 2 : 1;
      }
    } else {
      // In a text, a backslash takes the next character with it.
      if (rest.startsWith('\\')) at += 2;
      else {
        if (region === `text ${quote ?? ''}`) region = 'code';
        at += step;
      }
    }
  }
  return { elements, region: region.startsWith('text') ? 'text' : region };
}

/** The blocks of a file of workflow rules, and the type of the component each of them holds. */
const WORKFLOW_BLOCKS: Readonly<Record<string, string>> = {
  alerts: 'WorkflowAlert',
  fieldUpdates: 'WorkflowFieldUpdate',
  outboundMessages: 'WorkflowOutboundMessage',
  rules: 'WorkflowRule',
  tasks: 'WorkflowTask',
};

/**
 * The member a line of a metadata file belongs to. In a flow it is the element or the resource around the line,
 * the start element for the start, and the flow itself for what stands outside every element. In a file of
 * workflow rules it is the rule or the action around the line. Every other file has one member, its component.
 *
 * The files of the project are indented by four spaces, and the name of an element is its own child.
 */
function metadataMemberAt(
  file: string,
  line: number,
  owner: ComponentKey | undefined = owners.get(file),
): ComponentKey | undefined {
  if (owner === undefined) return undefined;
  const { type, name } = parseKey(owner);
  if (type !== 'Flow' && type !== 'Workflow') return owner;
  const lines = readProjectFile(file).split('\n');
  let start = line - 1;
  while (start > 0 && !/^ {4}<\w+>$/.test(lines[start] ?? '')) start -= 1;
  const block = /^ {4}<(\w+)>$/.exec(lines[start] ?? '')?.[1];
  // A line of the top level that is no block, such as the label of a flow.
  if (block === undefined) return owner;
  let end = start;
  while (end < lines.length && lines[end] !== `    </${block}>`) end += 1;
  if (line - 1 > end) return owner;
  const own = lines.slice(start, end);
  if (type === 'Workflow') {
    const fullName = own.map((one) => /^ {8}<fullName>([^<]+)<\/fullName>$/.exec(one)?.[1]).find(Boolean);
    const of = WORKFLOW_BLOCKS[block];
    return fullName === undefined || of === undefined ? owner : buildKey({ type: of, fullName: `${name}.${fullName}` });
  }
  if (block === 'start') return buildKey({ type, fullName: name, subs: [{ kind: 'element', name: 'flow-start' }] });
  const element = own.map((one) => /^ {8}<name>([^<]+)<\/name>$/.exec(one)?.[1]).find(Boolean);
  // A value at the top of a process has a name too. It is no element: it belongs to the flow.
  if (element === undefined || block === 'processMetadataValues') return owner;
  return buildKey({ type, fullName: name, subs: [{ kind: 'element', name: element }] });
}

/** The type of a field of a custom metadata type, as the file of the field names it, or an empty text. */
function typeOfRecordField(recordFile: string, field: string): string {
  const type = /\/([^/.]+)\.[^/]+\.md-meta\.xml$/.exec(recordFile)?.[1] ?? '';
  const file = `force-app/main/default/objects/${type}__mdt/fields/${field}.field-meta.xml`;
  return owners.has(file) ? (/<type>(\w+)<\/type>/.exec(readProjectFile(file))?.[1] ?? '') : '';
}

/**
 * What is wrong with the place of a reference of a metadata file, or nothing: the element it stands in, by the
 * way it names its target, the kind that follows from the place, and the operation of a record element. `all`:
 * the references that can stand at the same place. The file is a path from the folder of the project.
 */
function placeProblems(reference: Placed, all: readonly Placed[]): string[] {
  const wrong: string[] = [];
  const placed = (one: Placed): string => `${one.file}:${String(one.line)}:${String(one.column)}:${one.to}`;
  const lines = readProjectFile(reference.file).split('\n');
  const isBody = reference.file.endsWith('.email');
  const { elements, region } = isBody
    ? { elements: [], region: 'code' }
    : metadataPlace(reference.file, reference.line, reference.column);
  const place = PLACE_OF_VIA[reference.via];
  const innermost = elements.at(-1) ?? '';
  const around = place?.within;
  const parents = PARENT_OF[reference.via]?.[innermost];
  if (
    place === undefined ||
    !place.in.includes(innermost) ||
    (innermost === '') !== isBody ||
    (around !== undefined && !elements.some((element) => around.includes(element))) ||
    (parents !== undefined && !parents.includes(elements.at(-2) ?? ''))
  ) {
    return [`${reference.id} (${reference.via}): stands in ${elements.join(' > ')}`];
  }
  if (reference.via === 'formula' && region !== 'code') wrong.push(`${reference.id}: stands in a ${region}`);
  // A name in a text counts only between the braces of a merge field.
  if (reference.via === 'merge-field') {
    const before = (lines[reference.line - 1] ?? '').slice(0, reference.column - 1);
    if (before.lastIndexOf('{!') <= before.lastIndexOf('}')) wrong.push(`${reference.id}: not in a merge field`);
  }
  // The object of a process is the one value at the top of its file, not a value somewhere in an element.
  if (reference.via === 'object' && innermost === 'stringValue' && elements[1] !== 'processMetadataValues') {
    wrong.push(`${reference.id}: a value inside ${elements[1] ?? 'nothing'} is not the object of a process`);
  }
  // A text in a condition names a record type only where the other side is the name of the record type.
  if (reference.via === 'text' && innermost === 'stringValue') {
    let left = reference.line - 1;
    while (left > 0 && !(lines[left] ?? '').includes('<leftValueReference>')) left -= 1;
    if (!/[.>]RecordType\.DeveloperName</.test(lines[left] ?? '')) {
      wrong.push(`${reference.id}: the text is not compared with the name of a record type`);
    }
  }
  // A value of a record of a custom metadata type points at a definition where the field of the type is a
  // relationship. In every other field it is a text.
  if (reference.file.endsWith('.md-meta.xml') && (reference.via === 'value' || reference.via === 'text')) {
    let above = reference.line - 1;
    while (above > 0 && !(lines[above] ?? '').includes('<field>')) above -= 1;
    const field = /<field>(\w+)<\/field>/.exec(lines[above] ?? '')?.[1] ?? '';
    const expected = typeOfRecordField(reference.file, field) === 'MetadataRelationship' ? 'value' : 'text';
    if (reference.via !== expected) wrong.push(`${reference.id}: a value of the field ${field} is ${expected}`);
  }
  // The operation of a record element is the one of the element the object stands in.
  if (reference.op !== undefined && reference.file.endsWith('.flow-meta.xml')) {
    const expected = OP_OF_ELEMENT[elements[1] ?? ''];
    if (reference.op !== expected) {
      wrong.push(`${reference.id}: ${reference.op} in ${elements[1] ?? 'nothing'}, expected ${expected ?? 'none'}`);
    }
  }
  // A field that is used is read. A field or an object that is only named is referred to, and so is everything
  // that is neither a field nor an object. Where a value is read and written at once, the key has both.
  const kinds = all
    .filter((other) => placed(other) === placed(reference) && other.via === reference.via)
    .map((other) => other.kind)
    .sort()
    .join(' ');
  const expected = kindsAt(reference, elements);
  if (kinds !== expected) wrong.push(`${reference.id}: ${kinds}, expected ${expected}`);
  return wrong;
}

/**
 * The attributes of markup that name a target, by the kind of file, with the tier of the name. A base component
 * takes the name of an object or a field in an attribute, and so does force:recordData in its list of fields:
 * a convention, not a name the platform checks when the markup is saved.
 */
const ATTRIBUTES: Readonly<Record<string, Readonly<Record<string, 'confirmed' | 'probable'>>>> = {
  'lwc-html': { 'object-api-name': 'probable', 'field-name': 'probable' },
  'aura-cmp': { controller: 'confirmed', type: 'confirmed', fields: 'probable' },
  page: { controller: 'confirmed', extensions: 'confirmed', standardController: 'confirmed' },
};

/** What stands on the line of a place before its word. */
const lineBefore = (place: { file: string; line: number; column: number }): string =>
  (readProjectFile(place.file).split('\n')[place.line - 1] ?? '').slice(0, place.column - 1);

/** The attribute of markup a place stands in, or an empty text. */
const attributeAt = (place: { file: string; line: number; column: number }): string =>
  /([\w:-]+)="[^"]*$/.exec(lineBefore(place))?.[1] ?? '';

/** The tier of a name in an attribute of markup, or `undefined` where the attribute names nothing. */
const attributeTier = (place: { file: string; line: number; column: number }): string | undefined =>
  isMarkup(place.file) ? ATTRIBUTES[markupKind(place.file)]?.[attributeAt(place)] : undefined;

/**
 * Whether a call names a method that another one overrides: the call is confirmed to the method it names and
 * probable to the method of the same signature in another class, which runs when the object is of that class.
 */
function overridesAt(reference: (typeof key.references)[number]): boolean {
  const signature = parseKey(reference.to).subs.at(-1)?.name;
  return key.references.some(
    (other) =>
      other.file === reference.file &&
      other.line === reference.line &&
      other.column === reference.column &&
      other.via === 'call' &&
      other.tier === 'confirmed' &&
      other.to !== reference.to &&
      parseKey(other.to).subs.at(-1)?.name === signature,
  );
}

/** Every `static final` field of the project, by its name in lower case, with the text it is set to. */
const constants = new Map<string, string>();
/** The name of each child relationship in lower case, as a query writes it, with the lookup field that defines it. */
const childRelationships = new Map<string, ComponentKey>();
for (const [file, owner] of owners) {
  if (isApex(file)) for (const [name, value] of outline(file).constants) constants.set(name, value.toLowerCase());
  const relationship = /<relationshipName>(\w+)<\/relationshipName>/.exec(readProjectFile(file))?.[1];
  if (relationship !== undefined) childRelationships.set(`${relationship.toLowerCase()}__r`, owner);
}

/** The child relationships of standard objects that the project reads, with the lookup field that defines each. */
const STANDARD_CHILD_RELATIONSHIPS: ReadonlyMap<string, ComponentKey> = new Map([
  ['contacts', buildKey({ type: 'CustomField', fullName: 'Contact.AccountId' })],
]);

/** Whether a method of an Apex file, by its name in lower case, holds a whole word in its lines. */
function methodHolds(file: string, method: string, word: string): boolean {
  const lines = readProjectFile(file).split('\n');
  return outline(file).members.some(({ subs, from, to }) => {
    const last = subs.at(-1);
    if (last?.kind !== 'method' || last.name.toLowerCase().replace(/\(.*$/, '') !== method) return false;
    return (
      columnOf(
        lines
          .slice(from - 1, to)
          .join(' ')
          .toLowerCase(),
        word,
        1,
      ) !== undefined
    );
  });
}

/** Whether a record of a custom metadata type of the project gives a field, by its name, a value. */
const recordGives = (field: string, value: string): boolean =>
  [...owners.keys()].some(
    (file) =>
      file.endsWith('.md-meta.xml') &&
      new RegExp(`<field>${field}</field>\\s*<value[^>]*>${value}</value>`, 'i').test(readProjectFile(file)),
  );

/**
 * The fields of a field set of the project, by the name of the field set, in lower case: the last step of each path
 * and every lookup on the way, as `account__c` for `Account__r.Tier__c`. `within` is `displayedFields` for the fields
 * of the field set and `availableFields` for the fields it only makes available.
 */
function fieldSetFields(name: string, within: 'displayedFields' | 'availableFields'): string[] {
  const file = [...owners.keys()].find((one) => one.toLowerCase().endsWith(`/fieldsets/${name}.fieldset-meta.xml`));
  if (file === undefined) return [];
  const blocks = readProjectFile(file).matchAll(new RegExp(`<${within}>\\s*<field>([^<]+)</field>`, 'g'));
  return [...blocks].flatMap((block) =>
    (block[1] ?? '')
      .toLowerCase()
      .split('.')
      .map((step) => step.replace(/__r$/, '__c')),
  );
}

/**
 * How the word of a reference stands for its target, or `undefined` if it does not:
 * - `name`: it is the name of the target, or the relationship name of a lookup field (`Account__r`, `Owner`). The
 *   name of a member of Apex is that of the method, the variable, the property or the inner type, and a constructor
 *   is named by its type. A flow names the class of the method it calls, and a tag the component in kebab case;
 * - `keyword`: the keyword of a DML statement;
 * - `relationship`: a child relationship, defined by the lookup field that is the target or by a field of the
 *   object that is the target, or a child relationship of a standard object (`Contacts`);
 * - `constant`: a constant of the project whose value holds the name of the target;
 * - `variable`: a variable, where the target is an object that is named in the member above the place;
 * - `resource`: a resource of a flow that holds records of the object that is the target: the record that started
 *   the flow, a variable that is declared with the object, or the record behind a relationship;
 * - `file`: the root element of a record of a custom metadata type, whose type is in the name of its file;
 * - `method`: a call of a method of the same class whose text holds the name, as the query `paidQuery()` gives back;
 * - `record-field`: a field of a custom metadata type that a record of the project sets to the name;
 * - `field-set`: a field set, named by a literal, that has the target among its fields;
 * - `stretch`: an entry that is marked as hard to find. It is not checked.
 */
function namedBy(reference: (typeof key.references)[number]): string | undefined {
  const word = reference.match.toLowerCase();
  const target = parseKey(reference.to);
  // The name of a field without its object, and of a template without its folder.
  const last = target.name.slice(Math.max(target.name.lastIndexOf('.'), target.name.lastIndexOf('/')) + 1);
  if (reference.via === 'record-of') {
    const type = /\/([^/.]+)\.[^/]+\.md-meta\.xml$/.exec(reference.file)?.[1] ?? '';
    return word === 'custommetadata' && `${type.toLowerCase()}__mdt` === target.name ? 'file' : undefined;
  }
  if (reference.via === 'record') {
    const text = readProjectFile(reference.file);
    const object = (pattern: RegExp): string => (pattern.exec(text)?.[1] ?? '').toLowerCase();
    const of =
      word === '$record'
        ? object(/<start>[\s\S]*?<object>(\w+)<\/object>[\s\S]*?<\/start>/)
        : word.endsWith('__r')
          ? word.replace(/__r$/, '')
          : object(
              new RegExp(`<name>${reference.match}</name>(?:(?!</variables>)[\\s\\S])*<objectType>(\\w+)</objectType>`),
            );
    return of === target.name ? 'resource' : undefined;
  }
  if (target.subs.length > 0) {
    if (word === memberName(reference.to)) return 'name';
    if (reference.via === 'action' && word === parseKey(componentOf(reference.to)).name) return 'name';
    return reference.stretch ? 'stretch' : undefined;
  }
  if (word === last || word.replace(/__r$/, '__c') === last || `${word}id` === last) return 'name';
  if (reference.via === 'tag' && word.replaceAll('-', '') === last) return 'name';
  if (reference.via === 'dml' && reference.op === word) return 'keyword';
  const lookup = childRelationships.get(word) ?? STANDARD_CHILD_RELATIONSHIPS.get(word);
  if (lookup !== undefined && (lookup === reference.to || parseKey(lookup).name.startsWith(`${target.name}.`))) {
    return 'relationship';
  }
  if (constants.get(word)?.includes(last) === true) return 'constant';
  if (reference.via === 'text' && isApex(reference.file)) {
    if (methodHolds(reference.file, word, last)) return 'method';
    if (recordGives(word, last)) return 'record-field';
    if (fieldSetFields(word, 'displayedFields').includes(last)) return 'field-set';
  }
  if (reference.stretch) return 'stretch';
  if (target.type === 'CustomObject' && isApex(reference.file)) {
    const { code } = outline(reference.file);
    const member = parseKey(reference.from).subs.at(-1)?.name.replace(/\(.*$/, '') ?? '';
    let start = reference.line;
    while (start > 1 && columnOf((code[start - 1] ?? '').toLowerCase(), member, 1) === undefined) start -= 1;
    // The object can be named in code, as the type of a parameter, or in the text of a query.
    const above = readProjectFile(reference.file)
      .split('\n')
      .slice(start - 1, reference.line)
      .join(' ')
      .toLowerCase();
    if (columnOf(above, target.name, 1) !== undefined) return 'variable';
  }
  return undefined;
}

/**
 * The roadmap phase whose analyser must find a reference: 3 for Apex, for the markup and JavaScript of components
 * and pages and for a named credential, 1 for what the file of a field or of a validation rule says, and 2 for
 * everything else. A flow names an Apex class in Phase 2, and the method and the variables of it that only the
 * analysis of Apex knows in Phase 3.
 */
function phaseOf(reference: (typeof key.references)[number]): number {
  if (isApex(reference.file) || isMarkup(reference.file) || reference.file.includes('/namedCredentials/')) return 3;
  if (/\.(?:field|validationRule)-meta\.xml$/.test(reference.file)) return 1;
  return reference.file.includes('/flows/') && parseKey(reference.to).subs.length > 0 ? 3 : 2;
}

/**
 * What is wrong with the place of a reference in markup or JavaScript, or nothing. A web component imports what it
 * uses from a module of `@salesforce` and names objects and fields in attributes of base components. An Aura
 * component names its controller and the types of its attributes in attributes, a label in a merge field, and a
 * method of its controller and a label in texts of its JavaScript. A page names its controllers in attributes. A
 * component of the project stands in markup as a tag.
 */
function markupProblems(reference: (typeof key.references)[number]): string[] {
  const line = readProjectFile(reference.file).split('\n')[reference.line - 1] ?? '';
  const before = line.slice(0, reference.column - 1);
  const after = line.slice(reference.column - 1 + reference.match.length);
  const target = parseKey(reference.to).type;
  const classOf = (name: string | undefined): ComponentKey | undefined =>
    name === undefined ? undefined : buildKey({ type: 'ApexClass', fullName: name });
  const is = (ok: boolean, what: string): string[] => (ok ? [] : [`${reference.id} (${reference.via}): ${what}`]);
  switch (reference.via) {
    case 'import': {
      // The path of a module: `apex/Class.method`, `schema/Object.Field`, `label/c.Name`, `customPermission/Name`.
      const module = /^import \w+ from '@salesforce\/(\w+)\/[\w.]*$/.exec(before)?.[1] ?? '';
      const types: Readonly<Record<string, readonly string[]>> = {
        apex: ['ApexClass'],
        schema: ['CustomObject', 'CustomField'],
        label: ['CustomLabel'],
        customPermission: ['CustomPermission'],
      };
      const ofClass = module !== 'apex' || classOf(/apex\/(\w+)\.$/.exec(before)?.[1]) === componentOf(reference.to);
      return is(types[module]?.includes(target) === true && ofClass && /^[\w.]*';$/.test(after), `in ${module}`);
    }
    case 'attribute':
      // The word is the value of the attribute, or one name of a list of them.
      return is(
        attributeTier(reference) !== undefined && /="(?:\w+,)*$/.test(before) && /^(?:\[\])?(?:,\w+)*"/.test(after),
        `in the attribute ${attributeAt(reference) || 'of nothing'}`,
      );
    case 'tag':
      return is(before.endsWith('<c-') || before.endsWith('<c:'), 'not the tag of a component of the project');
    case 'merge-field':
      return is(before.endsWith('{!$Label.c.') && after.startsWith('}'), 'not a label in a merge field');
    case 'text': {
      // `c.name` is a method of the Apex controller of the component. `$Label.c.Name` is a label.
      const folder = reference.file.slice(0, reference.file.lastIndexOf('/'));
      const markup = readProjectFile(`${folder}/${folder.slice(folder.lastIndexOf('/') + 1)}.cmp`);
      const controller = classOf(/controller="(\w+)"/.exec(markup)?.[1]);
      const method = before.endsWith("'c.") && componentOf(reference.to) === controller;
      return is((method || before.endsWith("'$Label.c.")) && after.startsWith("'"), 'not a method or a label');
    }
    default:
      return [`${reference.id}: markup does not name a target ${reference.via}`];
  }
}

/** What kind of file a file of the project is: `apex`, `metadata`, or a kind of markup (see `markupKind`). */
const fileKind = (file: string): string => (isApex(file) ? 'apex' : isMarkup(file) ? markupKind(file) : 'metadata');

/**
 * The types besides fields and objects that version 3 refers to, with the kinds of file and the ways that name them.
 * A class is named by a page and by an Aura component as its controller, and a component of the project by the
 * tag of the markup that holds it.
 */
const REFERENCED_FROM: Readonly<Record<string, readonly string[]>> = {
  NamedCredential: ['apex credential'],
  ExternalCredential: ['metadata credential'],
  ApexClass: ['page attribute', 'aura-cmp attribute'],
  LightningComponentBundle: ['lwc-html tag', 'aura-cmp tag'],
  CustomLabel: ['lwc-js import', 'aura-cmp merge-field', 'aura-js text'],
  CustomPermission: ['lwc-js import'],
  CustomMetadata: ['apex text'],
  FieldSet: ['apex text'],
};

/** Whether the kind of a reference fits its target, the member it starts from and the way it names the target. */
function kindFits(reference: (typeof key.references)[number]): boolean {
  const target = parseKey(reference.to).type;
  const declared = apexDeclared.get(reference.to);
  const from = parseKey(reference.from).type;
  const where = fileKind(reference.file);
  const { via } = reference;
  const isField = target === 'CustomField' || target === 'CustomObject';
  switch (reference.kind) {
    case 'extends':
      return declared === 'type' && via === 'declaration';
    case 'implements':
      return declared === 'interface' && via === 'declaration';
    case 'triggers-on':
      return (
        target === 'CustomObject' &&
        ((from === 'ApexTrigger' && via === 'declaration') || (from === 'Flow' && via === 'object'))
      );
    case 'uses-type':
      return (
        where === 'apex' &&
        (target === 'CustomObject' || isApexType(reference.to)) &&
        ['type', 'new', 'text'].includes(via)
      );
    case 'calls':
      // A flow starts a flow or an Apex action: the class, and the invocable method of it. Apex calls a method, or
      // makes an object with a constructor or, where its class declares none, with the class. A web component
      // imports a method of Apex, and an Aura component names one in its JavaScript.
      if (from === 'Flow')
        return via === 'action' && (target === 'Flow' || declared === 'type' || declared === 'method');
      if (where === 'apex') {
        if (via === 'call') return declared === 'method';
        const made = declared === 'ctor' || (isApexType(reference.to) && !declaresConstructor(reference.to));
        return via === 'new' && made;
      }
      return declared === 'method' && (`${where} ${via}` === 'lwc-js import' || `${where} ${via}` === 'aura-js text');
    case 'reads':
    case 'writes':
      // A variable or a property of a class is read and written by Apex, and read by a query as a bind variable.
      // A flow sets an invocable variable as a parameter of an action.
      if (isField) return true;
      if (declared !== 'var' && declared !== 'prop') return false;
      return where === 'apex'
        ? via === 'field' || (via === 'soql' && reference.kind === 'reads')
        : via === 'parameter' && reference.kind === 'writes';
    case 'references':
      if (isField || (NAMED_ONLY.has(target) && where === 'metadata')) return true;
      if (target === 'ApexClass' && declared !== 'type') return false;
      return REFERENCED_FROM[target]?.includes(`${where} ${via}`) === true;
  }
}

describe('the fixture project', () => {
  it('contains exactly the components the key lists', () => {
    expect([...resolved].sort()).toEqual([...inProject].sort());
    expect(inProject.size).toBe(key.components.length);
  });

  it('has no file that belongs to no component', () => {
    const files = readdirSync(join(projectDir, 'force-app'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(projectDir, join(entry.parentPath, entry.name)).split(sep).join('/'));
    expect(files.filter((file) => !owners.has(file))).toEqual([]);
    expect(files.length).toBe(owners.size);
  });

  it('is a Salesforce project that names its folder and its API version', () => {
    const project = JSON.parse(readFileSync(join(projectDir, 'sfdx-project.json'), 'utf8')) as {
      packageDirectories: { path: string }[];
      sourceApiVersion: string;
    };
    expect(project.packageDirectories.map((directory) => directory.path)).toEqual(['force-app']);
    expect(project.sourceApiVersion).toMatch(/^\d+\.0$/);
  });

  it('keeps its files in LF, so that lines and columns are the same on every system', () => {
    const withCarriageReturn = [...owners.keys()].filter((file) =>
      readFileSync(join(projectDir, file), 'utf8').includes('\r'),
    );
    expect(withCarriageReturn).toEqual([]);
  });

  it('has a folder of files that do not compile, outside the project', () => {
    // A file manager may leave files of its own in the folder. Their names start with a dot.
    const files = readdirSync(join(FIXTURES_DIR, 'parser-negative')).filter((file) => !file.startsWith('.'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.every((file) => file.endsWith('.cls'))).toBe(true);
  });
});

describe('the manifest of public codebases', () => {
  it('pins every codebase to a full commit id, and can be listed without the network', () => {
    const script = join(FIXTURES_DIR, '../scripts/fetch-corpora.mjs');
    const listed = spawnSync(process.execPath, [script, '--list'], { encoding: 'utf8' });
    expect(listed.stderr).toBe('');
    expect(listed.status).toBe(0);
    const rows = listed.stdout.trim().split('\n');
    expect(rows.map((row) => row.split('  ')[0])).toEqual([
      'apex-recipes',
      'nebula-logger',
      'npsp',
      'pmm',
      'volunteers-for-salesforce',
      'outbound-funds',
      'coral-cloud',
      'eda',
    ]);
    for (const row of rows)
      expect(row).toMatch(/^[a-z0-9-]+ {2}[0-9a-f]{40} {2}\S+ {2}https:\/\/github\.com\/\S+\.git$/);
  });
});

describe('the answer key', () => {
  it('finds a whole word and its column, and no part of a longer name', () => {
    expect(columnOf('Total__c + Lines_Total__c', 'Total__c', 1)).toBe(1);
    expect(columnOf('Total__c + Lines_Total__c', 'Total__c', 2)).toBeUndefined();
    expect(columnOf('a.Status__c == b.Status__c', 'Status__c', 2)).toBe(18);
    expect(columnOf('Invoice__c x = [SELECT Id FROM invoice__c]', 'Invoice__c', 2)).toBeUndefined();
  });

  it('starts every reference from a component that the file holds', () => {
    const wrong = key.references
      .filter((reference) => inFile.get(reference.file)?.has(componentOf(reference.from)) !== true)
      .map((reference) => `${reference.id} from ${reference.from}`);
    expect(wrong).toEqual([]);
  });

  it('starts every reference and every unknown from the member its line belongs to', () => {
    const wrong: string[] = [];
    for (const place of [...key.references, ...key.unknowns]) {
      const owner = owners.get(place.file);
      if (owner === undefined) continue;
      const { type, name } = parseKey(owner);
      const expected = isApex(place.file)
        ? buildKey({ type, fullName: name, subs: outline(place.file).memberAt(place.line) })
        : (metadataMemberAt(place.file, place.line) ?? owner);
      if (place.from !== expected) wrong.push(`${place.file}:${String(place.line)} ${place.match}: from ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  it('tells the elements of a flow and the rules of a file of workflow rules apart', () => {
    const flow = 'force-app/main/default/flows/Invoice_After_Save.flow-meta.xml';
    const workflow = 'force-app/main/default/workflows/Invoice__c.workflow-meta.xml';
    const lineOf = (file: string, text: string): number =>
      readProjectFile(file)
        .split('\n')
        .findIndex((line) => line.includes(text)) + 1;
    expect(metadataMemberAt(flow, lineOf(flow, '<sortField>'))).toBe('Flow:invoice_after_save#element:get_open_lines');
    expect(metadataMemberAt(flow, lineOf(flow, '<recordField>'))).toBe('Flow:invoice_after_save#element:flow-start');
    expect(metadataMemberAt(flow, lineOf(flow, '<description>'))).toBe('Flow:invoice_after_save');
    expect(metadataMemberAt(flow, lineOf(flow, 'CanvasMode'))).toBe('Flow:invoice_after_save');
    expect(metadataMemberAt(workflow, lineOf(workflow, '<offsetFromField>'))).toBe(
      'WorkflowRule:invoice__c.remind_when_sent',
    );
    expect(metadataMemberAt(workflow, lineOf(workflow, '<template>'))).toBe(
      'WorkflowAlert:invoice__c.invoice_overdue_alert',
    );
    const members = new Set(key.references.map((reference) => reference.from));
    // Every element that holds a reference is a member, and so is every rule and every action of a rule.
    expect([...members].filter((member) => member.startsWith('Flow:')).length).toBeGreaterThanOrEqual(30);
    for (const part of [...resolved].filter((one) => /^Workflow[A-Z]/.test(one))) expect(members).toContain(part);
  });

  it('points every reference at a component of the project, a member of its Apex or a listed standard target', () => {
    const wrong = key.references
      .filter((reference) => !inProject.has(reference.to) && !standard.has(reference.to))
      .filter((reference) => !apexDeclared.has(reference.to))
      .map((reference) => reference.id);
    expect(wrong).toEqual([]);
  });

  it('lists no standard target that nothing refers to, and none that the project contains', () => {
    const targets = new Set(key.references.map((reference) => reference.to));
    expect(key.standard.filter((target) => !targets.has(target))).toEqual([]);
    expect(key.standard.filter((target) => inProject.has(target))).toEqual([]);
  });

  it('lists exactly the fields of the project that nothing refers to', () => {
    const targets = new Set(key.references.map((reference) => reference.to));
    const fields = key.components
      .filter((component) => component.type === 'CustomField')
      .map(({ key: field }) => field);
    expect([...key.unreferenced].sort()).toEqual(fields.filter((field) => !targets.has(field)).sort());
    expect(key.unreferenced).toContain('CustomField:invoice__c.unused_field__c');
  });

  it('follows its own rules about tiers and operations', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const target = parseKey(reference.to);
      // A name that stands in text is never as certain as a name the compiler checks. Nor is the name of a named
      // credential in the text of a callout, a name in an attribute of a base component, a field that
      // force:recordData loads, or a method that overrides the one a call names.
      const lessCertain =
        reference.via === 'text' ||
        (reference.via === 'credential' && isApex(reference.file)) ||
        (reference.via === 'attribute' && attributeTier(reference) === 'probable') ||
        (reference.via === 'call' && overridesAt(reference));
      if (lessCertain === (reference.tier === 'confirmed')) wrong.push(`${reference.id}: ${reference.tier}`);
      if (lessCertain && reference.via !== 'text' && reference.tier !== 'probable') {
        wrong.push(`${reference.id}: ${reference.tier}, expected probable`);
      }
      // "possible" means the object is known and the field is not.
      if (reference.tier === 'possible' && target.type !== 'CustomObject') {
        wrong.push(`${reference.id}: possible and not an object`);
      }
      // A DML statement writes an object and says how, and so does the publishing of a platform event. A record
      // element of a flow refers to an object and says what it does to its records. Nothing else carries an
      // operation: the object of a generic type of an Apex action has none.
      const isDml = reference.via === 'dml' && reference.kind === 'writes';
      const isRecordElement =
        reference.file.includes('/flows/') &&
        (reference.via === 'object' || reference.via === 'record') &&
        reference.kind === 'references' &&
        metadataPlace(reference.file, reference.line, reference.column).elements.at(-1) !== 'typeValue';
      if ((isDml || isRecordElement) !== (reference.op !== undefined)) wrong.push(`${reference.id}: operation`);
      if (isDml && (target.type !== 'CustomObject' || reference.match !== reference.op)) {
        wrong.push(`${reference.id}: a DML statement is keyed at its keyword and writes an object`);
      }
      const ofFlow = ['lookup', 'create', 'update', 'delete'];
      if (isRecordElement && (target.type !== 'CustomObject' || !ofFlow.includes(reference.op ?? ''))) {
        wrong.push(`${reference.id}: a record element refers to an object and looks up, creates, updates or deletes`);
      }
      if (isDml && (reference.op === 'lookup' || reference.op === 'create')) {
        wrong.push(`${reference.id}: not an operation of a DML statement`);
      }
      // A part of a component is a target only where it is a member of Apex.
      if (target.subs.length > 0 && !apexDeclared.has(reference.to)) {
        wrong.push(`${reference.id}: the target is a part of a component`);
      }
      if (reference.phase !== phaseOf(reference)) wrong.push(`${reference.id}: phase`);
    }
    expect(wrong).toEqual([]);
  });

  it('has no expected reference that one of its negatives forbids, and none where it says "unknown"', () => {
    const forbidden = key.negatives.filter((negative) =>
      key.references.some(
        (reference) =>
          reference.file === negative.file && reference.line === negative.line && reference.to === negative.not,
      ),
    );
    expect(forbidden).toEqual([]);
    const overlapping = key.unknowns.filter((unknown) =>
      key.references.some(
        (reference) =>
          reference.file === unknown.file && reference.line === unknown.line && reference.column === unknown.column,
      ),
    );
    expect(overlapping).toEqual([]);
    for (const unknown of key.unknowns) expect(owners.get(unknown.file)).toBe(componentOf(unknown.from));
    // An unknown of a flow is a path from a resource. It is no text.
    for (const unknown of key.unknowns.filter((one) => !isApex(one.file))) {
      const { elements } = metadataPlace(unknown.file, unknown.line, unknown.column);
      expect(PLACE_OF_VIA['path']?.in).toContain(elements.at(-1));
    }
    // A negative forbids a wrong guess, so its target need not exist. But a negative whose target is misspelled
    // forbids nothing: the word on the line must be the name of the target, and the object must be a known one.
    // A child relationship is a negative of the field it is not.
    const objects = new Set([...inProject, ...standard].map((one) => parseKey(one).name.split('.')[0]));
    const bare = (name: string): string => name.toLowerCase().replace(/__[cr]$/, '');
    const misspelled = key.negatives.filter((negative) => {
      const target = parseKey(negative.not);
      // A member of Apex must exist. The word is its name, or the name of the property a getter gives in a page.
      if (target.subs.length > 0) {
        const name = memberName(negative.not);
        const word = negative.match.toLowerCase();
        return !apexDeclared.has(negative.not) || (name !== word && name !== `get${word}`);
      }
      const [object = '', field = object] = target.name.split('.');
      // A field set that is read by its name is a negative of a field that it only makes available.
      if (fieldSetFields(negative.match.toLowerCase(), 'availableFields').includes(field)) return false;
      return !objects.has(object) || bare(field) !== bare(negative.match);
    });
    expect(misspelled).toEqual([]);
  });

  it('names no place in a comment, and each place in the kind of text its entry says', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const at = `${reference.id} (${reference.via})`;
      if (!viasOf(reference.file).has(reference.via))
        wrong.push(`${at}: not a way a ${fileKind(reference.file)} file names a target`);
      if (!isApex(reference.file)) continue;
      const region = outline(reference.file).regionAt(reference.line, reference.column);
      // A name in a query built as text stands in a literal, and so do a named credential of a callout and a field
      // set read by its name. A constant or a variable that holds a name is code, and so is a method that gives
      // one back and a field of a custom metadata type that holds one.
      const how = namedBy(reference);
      const expected =
        reference.via === 'soql' || reference.via === 'sosl'
          ? 'query'
          : reference.via === 'credential' || (reference.via === 'text' && (how === 'name' || how === 'field-set'))
            ? 'text'
            : 'code';
      if (region !== expected) wrong.push(`${at}: stands in ${region}, expected ${expected}`);
    }
    for (const unknown of key.unknowns.filter((one) => isApex(one.file))) {
      const region = outline(unknown.file).regionAt(unknown.line, unknown.column);
      if (region === 'comment') wrong.push(`unknown ${unknown.file}:${String(unknown.line)}: stands in a comment`);
    }
    expect(wrong).toEqual([]);
  });

  it('names every place of a metadata file in the element its entry says, with the kind that fits it, and none in a comment or a text', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      if (fileKind(reference.file) === 'metadata') wrong.push(...placeProblems(reference, key.references));
    }
    expect(wrong).toEqual([]);
    // A negative of a text with merge fields stands outside every merge field. In markup, an expression is a
    // negative by decision record 0079.
    for (const negative of key.negatives) {
      if (fileKind(negative.file) !== 'metadata' || negative.file.includes('/objects/')) continue;
      const before = (readProjectFile(negative.file).split('\n')[negative.line - 1] ?? '').slice(
        0,
        negative.column - 1,
      );
      const inMergeField = before.lastIndexOf('{!') > before.lastIndexOf('}');
      const sameWord = key.references.some(
        (reference) =>
          reference.file === negative.file && reference.line === negative.line && reference.column === negative.column,
      );
      // A negative in a merge field forbids one target at a place that names another, as `Status__c` of the line.
      if (inMergeField && !sameWord) wrong.push(`negative ${negative.file}:${String(negative.line)}: in a merge field`);
    }
    expect(wrong).toEqual([]);
    // The check can tell the three apart. The names in the comment and in the texts of this field are negatives.
    const notice = 'force-app/main/default/objects/Invoice__c/fields/Status_Notice__c.field-meta.xml';
    const regions = key.negatives
      .filter((negative) => negative.file === notice)
      .map((negative) => metadataPlace(notice, negative.line, negative.column).region);
    expect(regions).toContain('comment');
    expect(regions).toContain('text');
    expect(regions).not.toContain('code');
  });

  it('names every target by a word that stands for it', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const how = namedBy(reference);
      if (how === undefined) wrong.push(`${reference.id}: "${reference.match}" does not name ${reference.to}`);
      // The tier "possible" is for a name that comes from a variable, and for nothing else.
      if ((how === 'variable') !== (reference.tier === 'possible')) wrong.push(`${reference.id}: ${reference.tier}`);
    }
    expect(wrong).toEqual([]);
  });

  it('names every place of a component and of a page where its markup or its JavaScript names the target', () => {
    const wrong = key.references.filter((reference) => isMarkup(reference.file)).flatMap(markupProblems);
    expect(wrong).toEqual([]);
    // Every kind of file of a component and of a page holds a reference.
    const kinds = new Set(key.references.map((reference) => fileKind(reference.file)));
    for (const kind of Object.keys(MARKUP_VIA)) expect(kinds).toContain(kind);
  });

  it('gives every reference a kind that fits its target and its place', () => {
    const wrong: string[] = [];
    const placed = (reference: (typeof key.references)[number]): string =>
      `${reference.file}:${String(reference.line)}:${String(reference.column)}`;
    for (const reference of key.references) {
      const target = parseKey(reference.to);
      if (!kindFits(reference))
        wrong.push(`${reference.id}: ${reference.kind} to a ${target.type} via ${reference.via}`);

      if (!isApex(reference.file)) continue;
      const code = outline(reference.file).code[reference.line - 1] ?? '';
      const before = code.slice(0, reference.column - 1).trimEnd();
      const after = code.slice(reference.column - 1 + reference.match.length).trimStart();
      if (reference.via === 'field') {
        // `x.F = v` writes, `x.F += v` and `x.F++` read and write, anything else reads.
        const assigns = /^=(?!=)/.test(after);
        const both = /^(?:[-+*/]=|\+\+|--)/.test(after);
        const same = key.references.filter((other) => placed(other) === placed(reference) && other.to === reference.to);
        const kinds = same
          .map((other) => other.kind)
          .sort()
          .join(' ');
        const expected = both ? 'reads writes' : assigns ? 'writes' : 'reads';
        if (kinds !== expected && reference.kind !== 'references') {
          wrong.push(`${reference.id}: the code ${expected}, the key says ${kinds}`);
        }
      }
      // The name of an object in code is a reference as a token: `Invoice__c.SObjectType`. In front of a variable it
      // is a type, which version 3 keys as a use of the type.
      if (target.type === 'CustomObject' && namedBy(reference) === 'name' && reference.via === 'token') {
        if (!before.endsWith('.') && !after.startsWith('.'))
          wrong.push(`${reference.id}: the object is used as a type`);
      }
      // A call is followed by its arguments, `new` stands before a type that is made, and a type that is used
      // stands without either. An inner type can be named with its outer type in front.
      if (reference.via === 'call' && !after.startsWith('(')) wrong.push(`${reference.id}: no call`);
      const made = /\bnew(?:\s+\w+\s*\.)?$/.test(before);
      if (reference.via === 'new' && !made) wrong.push(`${reference.id}: new does not stand before it`);
      if ((reference.via === 'type' || reference.via === 'call') && made)
        wrong.push(`${reference.id}: new stands before it`);
      if (reference.via === 'type') {
        const qualified = before.endsWith('.') && target.subs.length > 0;
        if (after.startsWith('(') || after.startsWith('.') || (before.endsWith('.') && !qualified)) {
          wrong.push(`${reference.id}: not a type`);
        }
      }
      if (reference.via === 'declaration' && reference.kind !== 'triggers-on') {
        if (!/\b(?:implements|extends)\b[\w\s,.<>]*$/.test(before))
          wrong.push(`${reference.id}: not after implements or extends`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keys every name of a type that Apex code holds', () => {
    // A name of an object or of a class of the project in code is a use of the type, a call of a constructor, a
    // token or a declaration, and each of them is keyed. A name with a dot in front of it is a member of what
    // stands before the dot; a class with a dot after it is the class of a static member, which is keyed at the
    // member. The name of a type where it is declared is no reference.
    const objects = [...inProject, ...standard].filter((one) => parseKey(one).type === 'CustomObject');
    const classes = [...inProject].filter((one) => parseKey(one).type === 'ApexClass');
    const outer = new Set([...objects, ...classes].map((one) => parseKey(one).name));
    const keyed = new Set(
      [...key.references, ...key.negatives, ...key.unknowns].map(
        (place) => `${place.file}:${String(place.line)}:${String(place.column)}`,
      ),
    );
    const missing: string[] = [];
    for (const file of [...owners.keys()].filter(isApex)) {
      const { code, types } = outline(file);
      const inner = new Set(types.filter((one) => one.subs.length > 0).map((one) => one.name.toLowerCase()));
      code.forEach((text, index) => {
        for (const word of text.matchAll(/\b[A-Z]\w*\b/g)) {
          const name = word[0].toLowerCase();
          if (!outer.has(name) && !inner.has(name)) continue;
          const before = text.slice(0, word.index).trimEnd();
          const after = text.slice(word.index + word[0].length).trimStart();
          if (before.endsWith('.') || /\b(?:class|interface|enum|trigger)$/.test(before)) continue;
          if (after.startsWith('.') && !objects.some((one) => parseKey(one).name === name)) continue;
          // A constructor where it is declared.
          if (after.startsWith('(') && /^\s*(?:(?:public|private|protected|global)\s*)?$/.test(before)) continue;
          const at = `${file}:${String(index + 1)}:${String(word.index + 1)}`;
          if (!keyed.has(at)) missing.push(`${at} ${word[0]}`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it('is large enough to score an analyser, as the plan of Phase 0 asks', () => {
    const apex = key.references.filter((reference) => reference.phase === 3);
    expect(apex.length).toBeGreaterThanOrEqual(150);
    expect(apex.filter((reference) => reference.kind === 'writes').length).toBeGreaterThanOrEqual(30);
    expect(apex.filter((reference) => reference.tier !== 'confirmed').length).toBeGreaterThanOrEqual(20);
    expect(key.references.filter((reference) => reference.phase === 1).length).toBeGreaterThanOrEqual(40);
    expect(key.negatives.length).toBeGreaterThanOrEqual(12);
    expect(key.references.filter((reference) => reference.phase === 2).length).toBeGreaterThanOrEqual(150);
    // Stretch entries stay rare, or the pass marks would mean little: fewer than 3 in 100, as in version 1.
    const stretch = key.references.filter((reference) => reference.stretch).length;
    expect(stretch * 100).toBeLessThan(key.references.length * 3);
  });

  it('has the numbers the documents quote', () => {
    const byPhase = (phase: number): number => key.references.filter((reference) => reference.phase === phase).length;
    expect({
      version: key.version,
      components: key.components.length,
      phase1: byPhase(1),
      phase2: byPhase(2),
      phase3: byPhase(3),
      stretch: key.references.filter((reference) => reference.stretch).length,
      negatives: key.negatives.length,
      unknowns: key.unknowns.length,
    }).toEqual({
      version: 3,
      components: 147,
      phase1: 112,
      phase2: 222,
      phase3: 552,
      stretch: 12,
      negatives: 96,
      unknowns: 9,
    });
  });
});

describe('the flows that cannot be deployed', () => {
  interface Expected {
    readonly files: readonly {
      readonly file: string;
      readonly flow: string;
      readonly reads: boolean;
      readonly unknown?: readonly { element: string; line: number; match: string }[];
      readonly refs?: readonly {
        from: string;
        line: number;
        match: string;
        kind: string;
        to: string;
        via: string;
        op?: string;
        tier?: string;
      }[];
      readonly unresolved?: readonly { from: string; line: number; match: string }[];
      readonly negatives?: readonly { line: number; match: string; not: string }[];
    }[];
  }
  const folder = join(FIXTURES_DIR, 'flow-negative');
  const expected = parse(readFileSync(join(folder, 'expected.yaml'), 'utf8')) as Expected;

  it('are listed with what is expected of them, and none has the name of a flow of the project', () => {
    // A file manager may leave files of its own in the folder. Their names start with a dot.
    const files = readdirSync(join(folder, 'flows')).filter((file) => !file.startsWith('.'));
    expect(expected.files.map((one) => one.file).sort()).toEqual(files.map((file) => `flows/${file}`).sort());
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const one of expected.files) {
      expect(owners.has(`force-app/main/default/${one.file}`)).toBe(false);
      const name = /^flows\/(\w+)\.flow-meta\.xml$/.exec(one.file)?.[1] ?? '';
      expect(one.flow).toBe(buildKey({ type: 'Flow', fullName: name }));
    }
    // One of them cannot be read at all, and one holds an element of a kind that no flow has.
    expect(expected.files.filter((one) => !one.reads).length).toBe(1);
    expect(expected.files.filter((one) => (one.unknown ?? []).length > 0).length).toBe(1);
  });

  it('names places that exist, members of the flow and targets that are known', () => {
    const wrong: string[] = [];
    for (const one of expected.files) {
      const lines = readFileSync(join(folder, one.file), 'utf8').split('\n');
      const places = [...(one.refs ?? []), ...(one.unresolved ?? []), ...(one.negatives ?? []), ...(one.unknown ?? [])];
      for (const place of places) {
        if (columnOf(lines[place.line - 1] ?? '', place.match, 1) === undefined) {
          wrong.push(`${one.file}:${String(place.line)} has no word "${place.match}"`);
        }
      }
      const members = [
        ...(one.refs ?? []).map((ref) => ref.from),
        ...(one.unresolved ?? []).map((name) => name.from),
        ...(one.unknown ?? []).map((element) => element.element),
      ];
      for (const member of members) {
        if (!isComponentKey(member) || componentOf(member) !== one.flow) wrong.push(`${one.file}: ${member}`);
      }
      const targets = [
        ...(one.refs ?? []).map((ref) => ref.to),
        ...(one.negatives ?? []).map((negative) => negative.not),
      ];
      for (const target of targets) {
        if (!isComponentKey(target) || (!inProject.has(target) && !standard.has(target))) {
          wrong.push(`${one.file}: ${target} is no component of the project`);
        }
      }
      // A file that cannot be read gives no reference and no finding.
      if (!one.reads && members.length > 0) wrong.push(`${one.file}: expects something of a file that cannot be read`);
    }
    expect(wrong).toEqual([]);
  });

  it('are XML where they are to be read, and no XML where not', () => {
    for (const one of expected.files) {
      const reading = readXml(readFileSync(join(folder, one.file)));
      expect(reading.issue === null, one.file).toBe(one.reads);
      if (!one.reads) expect(reading.issue?.code).toBe('XML_MALFORMED');
    }
  });

  it('hold their references to the rules of the answer key: the element, the kind and the operation', () => {
    const wrong: string[] = [];
    for (const one of expected.files) {
      // The path of the file from the folder of the project, which the rules read files from.
      const file = `../flow-negative/${one.file}`;
      const lines = readFileSync(join(folder, one.file), 'utf8').split('\n');
      const placed = (place: { line: number; match: string }): { id: string; column: number } => ({
        id: `${one.file}:${String(place.line)}:${place.match}`,
        column: columnOf(lines[place.line - 1] ?? '', place.match, 1) ?? 0,
      });
      const refs = (one.refs ?? []).map((ref) => ({ ...ref, ...placed(ref), file, to: ref.to as ComponentKey }));
      for (const ref of refs) {
        // Only a name in an element of an unknown kind is read with less confidence. Nothing says what the
        // elements inside such an element are, so only a merge field is read there: a name between braces.
        const inUnknown = (one.unknown ?? []).some((element) => element.element === ref.from);
        if (inUnknown) {
          const before = (lines[ref.line - 1] ?? '').slice(0, ref.column - 1);
          const used = parseKey(ref.to).type === 'CustomField' ? 'reads' : 'references';
          if (ref.via !== 'merge-field' || before.lastIndexOf('{!') <= before.lastIndexOf('}') || ref.kind !== used) {
            wrong.push(`${ref.id}: not a merge field that ${used}`);
          }
        } else {
          wrong.push(...placeProblems(ref, refs));
        }
        if ((ref.tier ?? 'confirmed') !== (inUnknown ? 'probable' : 'confirmed')) wrong.push(`${ref.id}: tier`);
        if ((ref.op !== undefined) !== ((ref.via === 'object' || ref.via === 'record') && ref.kind === 'references')) {
          wrong.push(`${ref.id}: operation`);
        }
      }
      // Every place starts from the element its line stands in.
      for (const place of [...(one.refs ?? []), ...(one.unresolved ?? [])]) {
        const member = metadataMemberAt(file, place.line, one.flow as ComponentKey);
        if (member !== place.from) wrong.push(`${placed(place).id}: from ${place.from}, stands in ${member ?? ''}`);
      }
      // An element of an unknown kind is named at the line that opens it, by a word no flow of the project has
      // for an element.
      for (const element of one.unknown ?? []) {
        if (lines[element.line - 1] !== `    <${element.match}>`) wrong.push(`${placed(element).id}: no element`);
        if (metadataMemberAt(file, element.line + 1, one.flow as ComponentKey) !== element.element) {
          wrong.push(`${placed(element).id}: not ${element.element}`);
        }
        const known = [...owners.keys()].some(
          (path) => path.endsWith('.flow-meta.xml') && readProjectFile(path).includes(`\n    <${element.match}>`),
        );
        if (known) wrong.push(`${placed(element).id}: a flow of the project has such an element`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the older versions of the answer key', () => {
  // The Apex trial of Phase 0 was scored with version 0, Phase 1 with version 1 and Phase 2 with version 2, and
  // their reports quote the numbers of those keys. An old version lists the project as it was then, so it is not
  // checked against the components of the project of today.
  const old = loadAnswerKey(0);
  const first = loadAnswerKey(1);
  const second = loadAnswerKey(2);
  const idOf = (place: { file: string; line: number; column: number }, target: string): string =>
    `${place.file}:${String(place.line)}:${String(place.column)}:${target}`;
  const numbers = (of: typeof key): Record<string, number> => {
    const byPhase = (phase: number): number => of.references.filter((reference) => reference.phase === phase).length;
    return {
      version: of.version,
      components: of.components.length,
      phase1: byPhase(1),
      phase2: byPhase(2),
      phase3: byPhase(3),
      stretch: of.references.filter((reference) => reference.stretch).length,
      negatives: of.negatives.length,
      unknowns: of.unknowns.length,
    };
  };

  it('still name places that exist, and have the numbers the reports of their phases quote', () => {
    expect(numbers(old)).toEqual({
      version: 0,
      components: 52,
      phase1: 44,
      phase2: 0,
      phase3: 184,
      stretch: 4,
      negatives: 21,
      unknowns: 5,
    });
    expect(numbers(first)).toEqual({
      version: 1,
      components: 87,
      phase1: 106,
      phase2: 0,
      phase3: 184,
      stretch: 7,
      negatives: 31,
      unknowns: 5,
    });
    expect(numbers(second)).toEqual({
      version: 2,
      components: 120,
      phase1: 112,
      phase2: 214,
      phase3: 184,
      stretch: 9,
      negatives: 64,
      unknowns: 6,
    });
  });

  it('have the Apex part of version 2, entry for entry, up to version 2', () => {
    const apex = (from: typeof key): unknown[] => from.references.filter((reference) => reference.phase === 3);
    const apexOnly = <T extends { file: string }>(places: readonly T[]): T[] =>
      places.filter((place) => isApex(place.file));
    for (const older of [old, first]) {
      expect(apex(second)).toEqual(apex(older));
      expect(apexOnly(second.unknowns)).toEqual(older.unknowns);
      expect(apexOnly(second.negatives)).toEqual(apexOnly(older.negatives));
    }
  });

  it('have nothing that version 3 has not', () => {
    const whole = (reference: (typeof key.references)[number]): string =>
      `${reference.id}:${reference.from}:${reference.via}:${reference.tier}:${String(reference.stretch)}:${String(reference.phase)}`;
    const now = new Set(key.references.map(whole));
    const forbidden = new Set(key.negatives.map((negative) => idOf(negative, negative.not)));
    const unknown = new Set(key.unknowns.map((one) => idOf(one, one.from)));
    for (const older of [old, first, second]) {
      expect(older.references.filter((reference) => !now.has(whole(reference)))).toEqual([]);
      expect(older.negatives.filter((negative) => !forbidden.has(idOf(negative, negative.not)))).toEqual([]);
      expect(older.unknowns.filter((one) => !unknown.has(idOf(one, one.from)))).toEqual([]);
      expect(older.components.filter((component) => !inProject.has(component.key))).toEqual([]);
      expect(older.standard.filter((target) => !standard.has(target))).toEqual([]);
    }
  });

  it('say the same about a field or a rule in versions 1 to 3, and nothing else about its files', () => {
    const files = new Set(first.references.filter((reference) => reference.phase === 1).map((one) => one.file));
    const about = (of: typeof key): string[] =>
      of.references.filter((reference) => files.has(reference.file)).map((reference) => reference.id);
    expect(about(second)).toEqual(about(first));
    expect(about(key)).toEqual(about(first));
  });

  it('say in version 3 what version 2 says about a file of Phase 2, and more only in its own entries', () => {
    // Version 3 adds to a file of Phase 2 the entries of Phase 3, as the method an Apex action calls, and the new
    // files of Phase 2. What Phase 2 must find in the files of version 2 is the same.
    const files = new Set(second.references.filter((reference) => reference.phase === 2).map((one) => one.file));
    const ofPhase2 = (of: typeof key): string[] =>
      of.references
        .filter((reference) => files.has(reference.file) && reference.phase === 2)
        .map((reference) => reference.id);
    expect(ofPhase2(key)).toEqual(ofPhase2(second));
  });
});
