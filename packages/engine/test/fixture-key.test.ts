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
import { buildKey, isComponentKey, parentKey, parseKey, type ComponentKey } from '../src/core/keys.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { outlineApex, type ApexOutline } from './helpers/apex-outline.ts';

const key = loadAnswerKey();
const projectDir = join(FIXTURES_DIR, key.project);

/**
 * The components of the project and the component that owns each file, as the Salesforce library sees them.
 *
 * A file of labels holds a component for the file and one for each label in it. The file is owned by the first.
 * `inFile` has all of them: a file of workflow rules holds a component for each rule and each action, and a
 * reference starts from one of those.
 */
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
    for (const file of [component.xml, component.content]) {
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

/** The ways a metadata file names a target. Every other way belongs to Apex. `text` belongs to both. */
const METADATA_VIA: ReadonlySet<string> = new Set([
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
]);

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
  object: { in: ['object', 'stringValue'], within: ['Flow'] },
  record: { in: ['inputReference'] },
  sort: { in: ['sortField'] },
  output: {
    in: ['queriedFields', 'field', 'displayField', 'valueField'],
    within: ['recordLookups', 'outputAssignments', 'dynamicChoiceSets'],
  },
  assignment: { in: ['field'], within: ['inputAssignments', 'fieldUpdates'] },
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
    within: ['availableFields', 'displayedFields', 'recipients', 'outboundMessages', 'picklistValues', 'values'],
  },
  value: { in: ['value'], within: ['values'] },
  text: { in: ['value', 'stringValue'], within: ['values', 'conditions'] },
  'record-of': { in: ['CustomMetadata'] },
};

/**
 * The kinds a reference in a metadata file must have, by where it stands, as a sorted list joined by a space.
 * Most places allow one kind. Two stand at the same place where a value is read and written at once.
 */
function kindsAt(reference: (typeof key.references)[number], elements: readonly string[]): string {
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
    case 'listed-field':
      // A field set, an alert and an outbound message use the field. A record type and a record of a custom
      // metadata type name it.
      return elements.includes('values') || elements.includes('picklistValues') ? 'references' : 'reads';
    case 'assignment':
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
function metadataMemberAt(file: string, line: number): ComponentKey | undefined {
  const owner = owners.get(file);
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

/** Every `static final` field of the project, by its name in lower case, with the text it is set to. */
const constants = new Map<string, string>();
/** The name of each child relationship in lower case, as a query writes it, with the lookup field that defines it. */
const childRelationships = new Map<string, ComponentKey>();
for (const [file, owner] of owners) {
  if (isApex(file)) for (const [name, value] of outline(file).constants) constants.set(name, value.toLowerCase());
  const relationship = /<relationshipName>(\w+)<\/relationshipName>/.exec(readProjectFile(file))?.[1];
  if (relationship !== undefined) childRelationships.set(`${relationship.toLowerCase()}__r`, owner);
}

/**
 * How the word of a reference stands for its target, or `undefined` if it does not:
 * - `name`: it is the name of the target, or the relationship name of a lookup field (`Account__r`, `Owner`);
 * - `keyword`: the keyword of a DML statement;
 * - `relationship`: a child relationship, defined by the lookup field that is the target or by a field of the
 *   object that is the target;
 * - `constant`: a constant of the project whose value holds the name of the target;
 * - `variable`: a variable, where the target is an object that is named in the member above the place;
 * - `resource`: a resource of a flow that holds records of the object that is the target: the record that started
 *   the flow, a variable that is declared with the object, or the record behind a relationship;
 * - `file`: the root element of a record of a custom metadata type, whose type is in the name of its file;
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
  if (word === last || word.replace(/__r$/, '__c') === last || `${word}id` === last) return 'name';
  if (reference.via === 'dml' && reference.op === word) return 'keyword';
  const lookup = childRelationships.get(word);
  if (lookup !== undefined && (lookup === reference.to || parseKey(lookup).name.startsWith(`${target.name}.`))) {
    return 'relationship';
  }
  if (constants.get(word)?.includes(last) === true) return 'constant';
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
 * The roadmap phase whose analyser must find a reference: 3 for Apex, 1 for what the file of a field or of a
 * validation rule says, and 2 for everything else.
 */
function phaseOf(reference: (typeof key.references)[number]): number {
  if (isApex(reference.file)) return 3;
  return /\.(?:field|validationRule)-meta\.xml$/.test(reference.file) ? 1 : 2;
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
    expect(rows.map((row) => row.split('  ')[0])).toEqual(['apex-recipes', 'nebula-logger', 'npsp', 'pmm']);
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

  it('points every reference at a component of the project or at a listed standard target', () => {
    const wrong = key.references
      .filter((reference) => !inProject.has(reference.to) && !standard.has(reference.to))
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
      // A name that stands in text is never as certain as a name the compiler checks.
      if (reference.via === 'text' && reference.tier === 'confirmed') wrong.push(`${reference.id}: text is confirmed`);
      if (reference.via !== 'text' && reference.tier !== 'confirmed') wrong.push(`${reference.id}: not confirmed`);
      // "possible" means the object is known and the field is not.
      if (reference.tier === 'possible' && target.type !== 'CustomObject') {
        wrong.push(`${reference.id}: possible and not an object`);
      }
      // A DML statement writes an object and says how. A record element of a flow refers to an object and says
      // what it does to its records. Nothing else carries an operation.
      const isDml = reference.via === 'dml' && reference.kind === 'writes';
      const isRecordElement =
        (reference.via === 'object' || reference.via === 'record') && reference.kind === 'references';
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
      if (target.subs.length > 0) wrong.push(`${reference.id}: the target is a part of a component`);
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
    const objects = new Set([...inProject, ...standard].map((one) => parseKey(one).name.split('.')[0]));
    const bare = (name: string): string => name.toLowerCase().replace(/__c$/, '');
    const misspelled = key.negatives.filter((negative) => {
      const [object = '', field = object] = parseKey(negative.not).name.split('.');
      return !objects.has(object) || bare(field) !== bare(negative.match);
    });
    expect(misspelled).toEqual([]);
  });

  it('names no place in a comment, and each place in the kind of text its entry says', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const at = `${reference.id} (${reference.via})`;
      if (!isApex(reference.file)) {
        if (!METADATA_VIA.has(reference.via) && reference.via !== 'text') {
          wrong.push(`${at}: not a way a metadata file names a target`);
        }
        continue;
      }
      if (METADATA_VIA.has(reference.via)) wrong.push(`${at}: not a way Apex names a target`);
      const region = outline(reference.file).regionAt(reference.line, reference.column);
      // A name in a query built as text stands in a literal. A constant or a variable that holds one is code.
      const expected =
        reference.via === 'soql' || reference.via === 'sosl'
          ? 'query'
          : reference.via === 'text' && namedBy(reference) === 'name'
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
    const placed = (reference: (typeof key.references)[number]): string =>
      `${reference.file}:${String(reference.line)}:${String(reference.column)}:${reference.to}`;
    for (const reference of key.references) {
      if (isApex(reference.file)) continue;
      const isBody = reference.file.endsWith('.email');
      const { elements, region } = isBody
        ? { elements: [], region: 'code' }
        : metadataPlace(reference.file, reference.line, reference.column);
      const place = PLACE_OF_VIA[reference.via];
      const innermost = elements.at(-1) ?? '';
      const around = place?.within;
      if (
        place === undefined ||
        !place.in.includes(innermost) ||
        (innermost === '') !== isBody ||
        (around !== undefined && !elements.some((element) => around.includes(element)))
      ) {
        wrong.push(`${reference.id} (${reference.via}): stands in ${elements.join(' > ')}`);
        continue;
      }
      if (reference.via === 'formula' && region !== 'code') wrong.push(`${reference.id}: stands in a ${region}`);
      // A name in a text counts only between the braces of a merge field.
      if (reference.via === 'merge-field') {
        const before = (readProjectFile(reference.file).split('\n')[reference.line - 1] ?? '').slice(
          0,
          reference.column - 1,
        );
        if (before.lastIndexOf('{!') <= before.lastIndexOf('}')) wrong.push(`${reference.id}: not in a merge field`);
      }
      // A field that is used is read. A field or an object that is only named is referred to, and so is everything
      // that is neither a field nor an object. Where a value is read and written at once, the key has both.
      const kinds = key.references
        .filter((other) => placed(other) === placed(reference) && other.via === reference.via)
        .map((other) => other.kind)
        .sort()
        .join(' ');
      const expected = kindsAt(reference, elements);
      if (kinds !== expected) wrong.push(`${reference.id}: ${kinds}, expected ${expected}`);
    }
    expect(wrong).toEqual([]);
    // A negative of a text with merge fields stands outside every merge field.
    for (const negative of key.negatives) {
      if (isApex(negative.file) || negative.file.includes('/objects/')) continue;
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

  it('gives every reference a kind that fits its target and its place', () => {
    const wrong: string[] = [];
    const placed = (reference: (typeof key.references)[number]): string =>
      `${reference.file}:${String(reference.line)}:${String(reference.column)}`;
    for (const reference of key.references) {
      const target = parseKey(reference.to).type;
      const from = parseKey(reference.from);
      const fits =
        reference.kind === 'extends'
          ? target === 'ApexClass' && reference.via === 'declaration'
          : reference.kind === 'triggers-on'
            ? target === 'CustomObject' &&
              ((from.type === 'ApexTrigger' && reference.via === 'declaration') ||
                (from.type === 'Flow' && reference.via === 'object'))
            : reference.kind === 'calls'
              ? (target === 'Flow' || target === 'ApexClass') && from.type === 'Flow' && reference.via === 'action'
              : target === 'CustomField' ||
                target === 'CustomObject' ||
                (NAMED_ONLY.has(target) && reference.kind === 'references' && !isApex(reference.file));
      if (!fits) wrong.push(`${reference.id}: ${reference.kind} to a ${target}`);

      if (!isApex(reference.file)) continue;
      const code = outline(reference.file).code[reference.line - 1] ?? '';
      const before = code.slice(0, reference.column - 1).trimEnd();
      const after = code.slice(reference.column - 1 + reference.match.length).trimStart();
      if (reference.via === 'field') {
        // `x.F = v` writes, `x.F += v` reads and writes, anything else reads.
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
      // The name of an object in code is a reference only as a token or in a declaration: `Invoice__c.SObjectType`.
      // In front of a variable it is a type, which is not keyed.
      if (target === 'CustomObject' && namedBy(reference) === 'name' && reference.via === 'token') {
        if (!before.endsWith('.') && !after.startsWith('.'))
          wrong.push(`${reference.id}: the object is used as a type`);
      }
    }
    expect(wrong).toEqual([]);
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
      version: 2,
      components: 118,
      phase1: 112,
      phase2: 196,
      phase3: 184,
      stretch: 9,
      negatives: 63,
      unknowns: 6,
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
      readonly refs?: readonly { from: string; line: number; match: string; to: string }[];
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
});

describe('the older versions of the answer key', () => {
  // The Apex trial of Phase 0 was scored with version 0 and Phase 1 with version 1, and their reports quote the
  // numbers of those keys. An old version lists the project as it was then, so it is not checked against the
  // components of the project of today.
  const old = loadAnswerKey(0);
  const first = loadAnswerKey(1);
  const idOf = (place: { file: string; line: number; column: number }, target: string): string =>
    `${place.file}:${String(place.line)}:${String(place.column)}:${target}`;
  const numbers = (of: typeof key): Record<string, number> => {
    const byPhase = (phase: number): number => of.references.filter((reference) => reference.phase === phase).length;
    return {
      version: of.version,
      components: of.components.length,
      phase1: byPhase(1),
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
      phase3: 184,
      stretch: 4,
      negatives: 21,
      unknowns: 5,
    });
    expect(numbers(first)).toEqual({
      version: 1,
      components: 87,
      phase1: 106,
      phase3: 184,
      stretch: 7,
      negatives: 31,
      unknowns: 5,
    });
    expect(first.references.filter((reference) => reference.phase === 2)).toEqual([]);
  });

  it('have the Apex part of version 2, entry for entry', () => {
    const apex = (from: typeof key): unknown[] => from.references.filter((reference) => reference.phase === 3);
    const apexOnly = <T extends { file: string }>(places: readonly T[]): T[] =>
      places.filter((place) => isApex(place.file));
    for (const older of [old, first]) {
      expect(apex(key)).toEqual(apex(older));
      expect(apexOnly(key.unknowns)).toEqual(older.unknowns);
      expect(apexOnly(key.negatives)).toEqual(apexOnly(older.negatives));
    }
  });

  it('have nothing that version 2 has not', () => {
    const whole = (reference: (typeof key.references)[number]): string =>
      `${reference.id}:${reference.from}:${reference.via}:${reference.tier}:${String(reference.stretch)}`;
    const now = new Set(key.references.map(whole));
    const forbidden = new Set(key.negatives.map((negative) => idOf(negative, negative.not)));
    for (const older of [old, first]) {
      expect(older.references.filter((reference) => !now.has(whole(reference)))).toEqual([]);
      expect(older.negatives.filter((negative) => !forbidden.has(idOf(negative, negative.not)))).toEqual([]);
      expect(older.components.filter((component) => !inProject.has(component.key))).toEqual([]);
      expect(older.standard.filter((target) => !standard.has(target))).toEqual([]);
    }
  });

  it('has in version 2 everything version 1 says about a field or a rule, and nothing else about its files', () => {
    const files = new Set(first.references.filter((reference) => reference.phase === 1).map((one) => one.file));
    const about = (of: typeof key): string[] =>
      of.references.filter((reference) => files.has(reference.file)).map((reference) => reference.id);
    expect(about(key)).toEqual(about(first));
  });
});
