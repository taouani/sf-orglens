/**
 * The analysis of flows: a component for each element and resource, what each resource holds, and the
 * references a flow writes as the name of a field, as the name of a resource and as a merge field.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second lays the flows of
 * `fixtures/flow-negative` over the project and holds the analysis against what `expected.yaml` says. The third
 * runs on small flows that are written here, for what the fixtures do not have.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parentKey } from '../src/core/keys.ts';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import { KINDS, NO_ELEMENTS, ON_RECORDS, ON_SCHEDULE, PROCESS_ON_RECORDS, STARTS } from '../src/extraction/flows.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { codes, key, Source, viaOf, xml } from './helpers/written-source.ts';

const FLOWS = 'force-app/main/default/flows/';
const GOLDEN = join(import.meta.dirname, 'golden');

const opOf = (reference: Reference): string => {
  const op = reference.attrs?.['op'];
  return typeof op === 'string' ? ` ${op}` : '';
};

/** A reference as the answer key says one: where it starts, where it stands, what it is, and how sure. */
const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  const where = `${file}:${String(line)}:${String(column)}`;
  return `${reference.from} ${where}:${reference.kind}:${String(reference.to)} ${viaOf(reference)}${opOf(reference)} ${reference.confidence}`;
};

/** The components of flows of an analysis: the flows and their elements. */
const ofFlows = (analysis: SourceAnalysis): AnalysedComponent[] =>
  analysis.components.filter((one) => one.key.startsWith('Flow:'));

describe('the flows of the fixture project', () => {
  const answers = loadAnswerKey();
  // A flow names the method and the variables of an Apex action that only the analysis of Apex knows: Phase 3.
  const keyed = answers.references.filter((one) => one.file.startsWith(FLOWS) && one.phase === 2);
  const idOfKeyed = (one: (typeof keyed)[number]): string =>
    `${one.from} ${one.id} ${one.via}${one.op === undefined ? '' : ` ${one.op}`} ${one.tier}`;
  let analysis: SourceAnalysis;
  let flows: AnalysedComponent[];
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    flows = ofFlows(analysis);
    references = flows.flatMap((one) => one.references);
  });

  it('give every reference of the key, from the element and with the tier the key says, and no other', () => {
    expect(keyed).toHaveLength(129);
    expect(answers.references.filter((one) => one.file.startsWith(FLOWS) && one.phase !== 2)).toHaveLength(3);
    const found = references.map(idOf).sort();
    // A stretch entry may be missed. Nothing may be found that the key does not hold.
    const must = keyed.filter((one) => !one.stretch).map(idOfKeyed);
    expect(must.filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(keyed.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
    // The two stretch entries are found as well: every entry of the key is.
    expect(found).toHaveLength(keyed.length);
  });

  it('say where each name was read: in a formula by the reader of formulas, elsewhere by the reader of flows', () => {
    for (const one of references) {
      expect(one.origin, idOf(one)).toBe(viaOf(one) === 'formula' ? 'parser:formula' : 'parser:flow');
      expect(one.resolution, idOf(one)).not.toBe('unresolved');
      expect(one.to, idOf(one)).not.toBeNull();
    }
    expect(references.filter((one) => one.origin === 'parser:formula')).not.toHaveLength(0);
    // A target the project does not hold is one Salesforce provides, and the key lists it as such.
    const standard = new Set<string>(answers.standard);
    for (const one of references.filter((reference) => reference.resolution === 'external')) {
      expect(standard.has(String(one.to)), idOf(one)).toBe(true);
    }
  });

  it('report no reference where the key forbids one', () => {
    const forbidden = answers.negatives.filter((one) => one.file.startsWith(FLOWS));
    expect(forbidden).toHaveLength(22);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
  });

  it('say what they do not know where the key says "unknown", and guess nothing there', () => {
    const unknown = answers.unknowns.filter((one) => one.file.startsWith(FLOWS));
    expect(unknown).toHaveLength(1);
    const issues = analysis.issues.filter((issue) => issue.componentKey?.startsWith('Flow:'));
    expect(
      issues.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)} ${issue.message}`),
    ).toEqual(
      unknown.map(
        (one) =>
          `warning PATH_NOT_FOLLOWED ${one.from} ${one.file}, line ${String(one.line)}: it is not known which object "Recalculate" holds, so "invoice.${one.match}" after it was not followed.`,
      ),
    );
    for (const one of unknown) {
      expect(
        references.filter((reference) => reference.location?.file === one.file && reference.location.line === one.line),
      ).toEqual([]);
      expect(issues[0]?.details).toEqual({
        path: one.file,
        line: one.line,
        column: one.column - 'Recalculate.invoice.'.length,
        resource: 'Recalculate',
        notFollowed: ['invoice', one.match],
        endsAt: 'field',
        origin: 'parser:flow',
      });
    }
  });

  it('are a component each, with a component for every element and resource', async () => {
    const said = flows.map((one) => `${one.key}  ${one.name}  ${JSON.stringify(one.attrs)}`);
    await expect(`${said.join('\n')}\n`).toMatchFileSnapshot(join(GOLDEN, 'flow-components.txt'));
    const own = flows.filter((one) => !one.key.includes('#'));
    expect(own.map((one) => one.name)).toEqual(
      answers.components.filter((one) => one.type === 'Flow').map((one) => one.fullName),
    );
    for (const one of flows.filter((flow) => flow.key.includes('#'))) {
      const flow = own.find((candidate) => candidate.key === parentKey(one.key));
      // An element is of the file of its flow, and its definition is its own part of that file.
      expect(one.definition?.path, one.key).toBe(flow?.definition?.path);
      expect(one.definition?.contentHash, one.key).not.toEqual(flow?.definition?.contentHash);
      expect(one.name, one.key).toMatch(new RegExp(`^${String(flow?.name)}\\.[A-Za-z_$-]`));
    }
    // Every reference starts from a component of the analysis, and a flow itself holds few: its elements do.
    const keys = new Set(flows.map((one) => one.key));
    expect(references.every((one) => keys.has(one.from))).toBe(true);
    expect(own.map((one) => `${one.name} ${String(one.references.length)}`)).toEqual([
      'Invoice_After_Save 0',
      'Invoice_Before_Save 0',
      'Invoice_Object_Name 0',
      'Invoice_Purge_Void 0',
      'Invoice_Recalculate 0',
      'Invoice_Review_Screen 0',
      'Invoice_Sent_Process 1',
    ]);
  });

  it('are counted for the reader of flows', () => {
    expect(analysis.types).toContain('Flow');
    expect(analysis.work.find((row) => row.origin === 'parser:flow')).toEqual({
      origin: 'parser:flow',
      components: flows.length,
      failedFiles: 0,
    });
    expect(flows).toHaveLength(64);
  });
});

describe('the flows that cannot be deployed', () => {
  interface Place {
    readonly line: number;
    readonly match: string;
  }
  interface Expected {
    readonly file: string;
    readonly flow: string;
    readonly reads: boolean;
    readonly unknown?: readonly (Place & { element: string })[];
    readonly refs?: readonly (Place & {
      from: string;
      kind: string;
      to: string;
      via: string;
      op?: string;
      tier?: string;
    })[];
    readonly unresolved?: readonly (Place & { from: string })[];
    readonly negatives?: readonly (Place & { not: string })[];
  }
  const dir = join(FIXTURES_DIR, 'flow-negative');
  const expected = (parse(readFileSync(join(dir, 'expected.yaml'), 'utf8')) as { files: Expected[] }).files;
  const inProject = (file: string): string => `force-app/main/default/${file}`;
  let analysis: SourceAnalysis;
  let alone: SourceAnalysis;

  beforeAll(async () => {
    const project = readFolders(join(FIXTURES_DIR, loadAnswerKey().project), ['force-app']).tree;
    const extra = readFolders(dir, ['flows']).tree;
    const laid = new Map(extra.files.map((path) => [inProject(path), path]));
    const tree: SourceTree = {
      files: [...project.files, ...laid.keys()].sort(),
      read: (path) => {
        const from = laid.get(path);
        return from === undefined ? project.read(path) : extra.read(from);
      },
    };
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    alone = analyseSource(project, (await resolveComponents(project, ['force-app'])).components);
  });

  /** The place of an entry of `expected.yaml` in its file, as `line:column`. */
  const placeOf = (file: string, place: Place): string => {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    return `${String(place.line)}:${String(columnOf(lines[place.line - 1] ?? '', place.match, 1))}`;
  };
  const of = (entry: Expected): AnalysedComponent[] =>
    analysis.components.filter((one) => one.key === entry.flow || one.key.startsWith(`${entry.flow}#`));
  const placeIn = (one: Reference): string => `${String(one.location?.line)}:${String(one.location?.column)}`;

  it('are a component each, and leave the analysis of the project as it was', () => {
    expect(expected.map((entry) => entry.flow)).toEqual(['Flow:missing_field', 'Flow:unknown_element', 'Flow:cut_off']);
    const added = analysis.components.filter((one) => expected.some((entry) => of(entry).includes(one)));
    expect(analysis.components.filter((one) => !added.includes(one))).toEqual(alone.components);
    for (const entry of expected) {
      expect(of(entry).every((one) => one.definition?.path === inProject(entry.file))).toBe(true);
    }
    // A file that cannot be read gives the flow its row, and no element.
    expect(expected.map((entry) => of(entry).length)).toEqual([5, 5, 1]);
  });

  it('give the references each file is expected to hold, and no other to a component', () => {
    for (const entry of expected) {
      const found = of(entry)
        .flatMap((one) => one.references)
        .filter((one) => one.to !== null)
        .map(
          (one) =>
            `${one.from} ${placeIn(one)} ${one.kind} ${String(one.to)} ${viaOf(one)}${opOf(one)} ${one.confidence}`,
        );
      const wanted = (entry.refs ?? []).map(
        (ref) =>
          `${ref.from} ${placeOf(entry.file, ref)} ${ref.kind} ${ref.to} ${ref.via}${ref.op === undefined ? '' : ` ${ref.op}`} ${ref.tier ?? 'confirmed'}`,
      );
      expect(found.sort(), entry.file).toEqual(wanted.sort());
    }
  });

  it('report every name that nothing defines, at its place', () => {
    for (const entry of expected) {
      // A field, an object or a relationship that nothing defines is a reference without a target.
      const references = of(entry)
        .flatMap((one) => one.references)
        .filter((one) => one.to === null)
        .map((one) => `${one.from} ${placeIn(one)} [${one.toNameRaw}] ${one.resolution}`);
      // A resource the flow does not have is an issue: nothing says what the name would be a reference to.
      const resources = analysis.issues
        .filter(
          (issue) => issue.code === 'RESOURCE_NOT_FOUND' && of(entry).some((one) => one.key === issue.componentKey),
        )
        .map((issue) => {
          const { line, column } = issue.details as { line: number; column: number };
          return `${String(issue.componentKey)} ${String(line)}:${String(column)}`;
        });
      const wanted = (entry.unresolved ?? []).map((one) => ({
        reference: `${one.from} ${placeOf(entry.file, one)} [${one.match}] unresolved`,
        resource: `${one.from} ${placeOf(entry.file, one)}`,
      }));
      const missed = wanted.filter((one) => !references.includes(one.reference) && !resources.includes(one.resource));
      expect(missed, entry.file).toEqual([]);
      expect(resources, entry.file).toEqual(
        entry.file.includes('Missing_Field') ? ['Flow:missing_field#element:check 24:39'] : [],
      );
      // One name more than the file lists: the field of the object that does not exist. It is looked for on
      // that object, which is why it is not found, and is not guessed to be the field of another.
      const listed = new Set(wanted.map((one) => one.reference));
      expect(
        references.filter((one) => !listed.has(one)),
        entry.file,
      ).toEqual(
        entry.file.includes('Missing_Field')
          ? ['Flow:missing_field#element:save_nothing 65:20 [Amount__c] unresolved']
          : [],
      );
    }
  });

  it('report no reference where a file forbids one', () => {
    for (const entry of expected) {
      for (const negative of entry.negatives ?? []) {
        const hit = of(entry)
          .flatMap((one) => one.references)
          .filter((one) => one.location?.line === negative.line && one.to === negative.not);
        expect(hit, `${entry.file}:${String(negative.line)}`).toEqual([]);
      }
    }
  });

  it('say of the element of an unknown kind that it is one, and read what is in it as probable', () => {
    const unknown = expected.flatMap((entry) => (entry.unknown ?? []).map((one) => ({ ...one, file: entry.file })));
    expect(unknown).toHaveLength(1);
    const issues = analysis.issues.filter((issue) => issue.code === 'FLOW_ELEMENT_UNKNOWN');
    expect(issues.map((issue) => `${issue.severity} ${String(issue.componentKey)} ${issue.message}`)).toEqual(
      unknown.map(
        (one) =>
          `warning ${one.element} ${inProject(one.file)}, line ${String(one.line)}: "${one.match}" is no kind of element of a flow that is known here. The names in it are read as in the kinds that are known, and recorded as probable.`,
      ),
    );
    const beam = analysis.components.find((one) => one.key === unknown[0]?.element);
    expect(beam?.attrs).toEqual({ kind: 'unknown', element: 'recordTeleports', active: true });
    expect(beam?.references.map((one) => one.confidence)).toEqual(['probable', 'probable', 'probable']);
  });

  it('say of the file that cannot be read that it was not, and count it for the reader of flows', () => {
    const added = analysis.issues.filter((issue) => !alone.issues.some((one) => one.message === issue.message));
    expect(added.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)}`).sort()).toEqual([
      'error XML_MALFORMED null',
      'warning FLOW_ELEMENT_UNKNOWN Flow:unknown_element#element:beam',
      'warning PATH_NOT_FOLLOWED Flow:missing_field#element:check',
      'warning RESOURCE_NOT_FOUND Flow:missing_field#element:check',
    ]);
    const cutOff = analysis.components.find((one) => one.key === 'Flow:cut_off');
    expect(cutOff).toMatchObject({ name: 'Cut_Off', attrs: null, references: [] });
    expect(added.find((issue) => issue.code === 'RESOURCE_NOT_FOUND')?.message).toBe(
      `${inProject('flows/Missing_Field.flow-meta.xml')}, line 24: the element "elementReference" holds "No_Such_Resource.Amount__c", and the flow has no resource "No_Such_Resource". It is not read.`,
    );
    expect(added.find((issue) => issue.code === 'PATH_NOT_FOLLOWED')?.message).toBe(
      `${inProject('flows/Missing_Field.flow-meta.xml')}, line 21: it is not known which object "Nowhere__r" leads to, so "Name" after it was not followed.`,
    );
    const [xml, formula, flow] = alone.work;
    expect(analysis.work).toEqual([
      xml,
      formula,
      { origin: 'parser:flow', components: (flow?.components ?? 0) + 10, failedFiles: 1 },
    ]);
  });
});

describe('small flows that are written here', () => {
  /** Two objects with a relationship between them, a lookup to a standard object, and a field of that object. */
  const project = (): Source => {
    const source = new Source();
    source.object('Invoice__c', '<label>Invoice</label>');
    source.field('Invoice__c', 'Amount__c', '<type>Number</type>');
    source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
    source.field(
      'Invoice__c',
      'Account__c',
      '<type>Lookup</type>',
      '<referenceTo>Account</referenceTo>',
      '<relationshipName>Invoices</relationshipName>',
    );
    source.object('Invoice_Line__c', '<label>Line</label>');
    source.field(
      'Invoice_Line__c',
      'Invoice__c',
      '<type>MasterDetail</type>',
      '<referenceTo>Invoice__c</referenceTo>',
      '<relationshipName>Lines</relationshipName>',
    );
    source.field('Invoice_Line__c', 'Quantity__c', '<type>Number</type>');
    source.field('Account', 'Tier__c', '<type>Picklist</type>');
    return source;
  };
  const FILE = 'flows/F.flow-meta.xml';
  const ACTIVE = '<status>Active</status>';
  /** A start that a record of an invoice sets off. It stands on the lines 4 to 7 of a flow that begins with it. */
  const ON_INVOICE = [
    '<start>',
    '    <object>Invoice__c</object>',
    '    <triggerType>RecordAfterSave</triggerType>',
    '</start>',
  ];
  /** A group of the file with a name. `lines` stand inside it. */
  const group = (kind: string, name: string, ...lines: string[]): string[] => [
    `<${kind}>`,
    `    <name>${name}</name>`,
    ...lines.map((line) => `    ${line}`),
    `</${kind}>`,
  ];
  /** A condition of a decision or of a step that filters, on the resource and path `left`. */
  const condition = (left: string, ...more: string[]): string[] => [
    '<conditions>',
    `    <leftValueReference>${left}</leftValueReference>`,
    ...more.map((line) => `    ${line}`),
    '</conditions>',
  ];
  const variable = (name: string, type: string, object?: string): string[] =>
    group(
      'variables',
      name,
      `<dataType>${type}</dataType>`,
      ...(object === undefined ? [] : [`<objectType>${object}</objectType>`]),
    );

  /** The analysis of the project with the flow `F` of these lines. The first of them is line 3 of the file. */
  const analysed = (lines: readonly string[], change: (source: Source) => void = () => undefined): SourceAnalysis => {
    const source = project();
    change(source);
    source.flow('F', ...lines);
    return source.analyse();
  };
  const element = (name: string): string => (name === '' ? 'Flow:f' : `Flow:f#element:${name}`);
  /** The references of the flow (`''`) or of one element, as `line:column kind target [name] via op tier`. */
  const from = (analysis: SourceAnalysis, name: string): string[] =>
    (analysis.components.find((one) => one.key === element(name))?.references ?? []).map(
      (one) =>
        `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${one.to ?? one.resolution} [${one.toNameRaw}] ${viaOf(one)}${opOf(one)} ${one.confidence}`,
    );
  /** The issues about the flow and its elements, as `severity CODE element line:column`. */
  const issuesOf = (analysis: SourceAnalysis): string[] =>
    analysis.issues.map((issue) => {
      const { line, column } = (issue.details ?? {}) as { line?: number; column?: number };
      const at = line === undefined ? '' : ` ${String(line)}:${String(column)}`;
      return `${issue.severity} ${issue.code} ${String(issue.componentKey).replace(/^Flow:f(#element:)?/, '')}${at}`;
    });
  const messages = (analysis: SourceAnalysis): string[] => analysis.issues.map((issue) => issue.message);
  const attrsOf = (analysis: SourceAnalysis, name: string): unknown =>
    analysis.components.find((one) => one.key === element(name))?.attrs;

  it('say of every element of a flow that is not active that it is not', () => {
    const analysis = analysed([
      '<status>Draft</status>',
      ...ON_INVOICE,
      ...group('decisions', 'Check', '<rules>', '    <name>Big</name>', ...condition('$Record.Amount__c'), '</rules>'),
    ]);
    expect(ofFlows(analysis).map((one) => `${one.key} ${JSON.stringify(one.attrs)}`)).toEqual([
      'Flow:f {"status":"Draft","active":false,"triggerType":"RecordAfterSave"}',
      'Flow:f#element:check {"kind":"decision","active":false}',
      'Flow:f#element:flow-start {"kind":"start","active":false}',
    ]);
    // The outcome of a decision is a name of the flow and no component.
    expect(from(analysis, 'check')).toEqual([
      '13:41 reads CustomField:invoice__c.amount__c [Amount__c] path confirmed',
    ]);
    expect(from(analysis, 'flow-start')).toEqual([
      '5:17 triggers-on CustomObject:invoice__c [Invoice__c] object confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('read a lookup that stores what it finds field by field, or in a variable', () => {
    const analysis = analysed([
      ACTIVE,
      ...group(
        'recordLookups',
        'Get_Line',
        '<filters>',
        '    <field>Invoice__c</field>',
        '    <operator>EqualTo</operator>',
        '    <value>',
        '        <elementReference>Wanted.Id</elementReference>',
        '    </value>',
        '</filters>',
        '<object>Invoice_Line__c</object>',
        '<outputAssignments>',
        '    <assignToReference>Count</assignToReference>',
        '    <field>Quantity__c</field>',
        '</outputAssignments>',
        '<sortField>Quantity__c</sortField>',
      ),
      ...group(
        'recordLookups',
        'Get_Invoice',
        '<object>Invoice__c</object>',
        '<outputReference>Wanted</outputReference>',
        '<queriedFields>Id</queriedFields>',
        '<queriedFields>Amount__c</queriedFields>',
      ),
      ...variable('Wanted', 'SObject', 'Invoice__c'),
      ...variable('Count', 'Number'),
    ]);
    // The id of a record is no reference, and neither is the variable a value is stored in.
    expect(from(analysis, 'get_line')).toEqual([
      '13:17 references CustomObject:invoice_line__c [Invoice_Line__c] object lookup confirmed',
      '7:20 reads CustomField:invoice_line__c.invoice__c [Invoice__c] filter confirmed',
      '16:20 reads CustomField:invoice_line__c.quantity__c [Quantity__c] output confirmed',
      '18:20 reads CustomField:invoice_line__c.quantity__c [Quantity__c] sort confirmed',
    ]);
    expect(from(analysis, 'get_invoice')).toEqual([
      '22:17 references CustomObject:invoice__c [Invoice__c] object lookup confirmed',
      '25:24 reads CustomField:invoice__c.amount__c [Amount__c] output confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('read the field a set of choices takes its values from, and the fields of a set of records', () => {
    const analysis = analysed([
      ACTIVE,
      ...group(
        'dynamicChoiceSets',
        'Statuses',
        '<dataType>Picklist</dataType>',
        '<picklistField>Status__c</picklistField>',
        '<picklistObject>Invoice__c</picklistObject>',
      ),
      ...group(
        'dynamicChoiceSets',
        'Lines',
        '<dataType>String</dataType>',
        '<displayField>Name</displayField>',
        '<filters>',
        '    <field>Quantity__c</field>',
        '    <operator>GreaterThan</operator>',
        '</filters>',
        '<object>Invoice_Line__c</object>',
        '<valueField>Quantity__c</valueField>',
      ),
      ...group(
        'dynamicChoiceSets',
        'Lost',
        '<dataType>Picklist</dataType>',
        '<picklistField>Status__c</picklistField>',
      ),
    ]);
    // The object of a picklist is named for its field only: the set reads no records of it.
    expect(from(analysis, 'statuses')).toEqual([
      '7:24 references CustomField:invoice__c.status__c [Status__c] picklist confirmed',
    ]);
    expect(from(analysis, 'lines')).toEqual([
      '18:17 references CustomObject:invoice_line__c [Invoice_Line__c] object lookup confirmed',
      '13:23 reads CustomField:invoice_line__c.name [Name] output confirmed',
      '15:20 reads CustomField:invoice_line__c.quantity__c [Quantity__c] filter confirmed',
      '19:21 reads CustomField:invoice_line__c.quantity__c [Quantity__c] output confirmed',
    ]);
    expect(from(analysis, 'lost')).toEqual([]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 24: nothing says which object "Status__c" is a field of, so it was not followed.`,
    ]);
  });

  it('know what a step holds that filters or sorts a list, and the record it looks at', () => {
    const analysis = analysed([
      ACTIVE,
      ...group('recordLookups', 'Get_Lines', '<object>Invoice_Line__c</object>'),
      ...group(
        'collectionProcessors',
        'Big_Lines',
        '<assignNextValueToReference>currentItem_Big_Lines</assignNextValueToReference>',
        '<collectionProcessorType>FilterCollectionProcessor</collectionProcessorType>',
        '<collectionReference>Get_Lines</collectionReference>',
        ...condition('currentItem_Big_Lines.Quantity__c'),
      ),
      ...group(
        'collectionProcessors',
        'Sorted',
        '<collectionProcessorType>SortCollectionProcessor</collectionProcessorType>',
        '<collectionReference>Big_Lines</collectionReference>',
        '<sortOptions>',
        '    <sortField>Quantity__c</sortField>',
        '</sortOptions>',
      ),
      ...group(
        'decisions',
        'Any',
        '<rules>',
        '    <name>Some</name>',
        ...condition('Sorted.Invoice__r.Amount__c'),
        '</rules>',
      ),
    ]);
    expect(attrsOf(analysis, 'big_lines')).toEqual({ kind: 'collection-processor', active: true });
    expect(from(analysis, 'big_lines')).toEqual([
      '14:55 reads CustomField:invoice_line__c.quantity__c [Quantity__c] path confirmed',
    ]);
    // The second step goes over what the first one gives, which goes over what the lookup found.
    expect(from(analysis, 'sorted')).toEqual([
      '22:24 reads CustomField:invoice_line__c.quantity__c [Quantity__c] sort confirmed',
    ]);
    expect(from(analysis, 'any')).toEqual([
      '30:40 reads CustomField:invoice_line__c.invoice__c [Invoice__r] path confirmed',
      '30:51 reads CustomField:invoice__c.amount__c [Amount__c] path confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('read what an action starts: a class, a flow or an alert, and nothing for another kind of action', () => {
    const action = (name: string, target: string, type: string, ...more: string[]): string[] =>
      group('actionCalls', name, `<actionName>${target}</actionName>`, `<actionType>${type}</actionType>`, ...more);
    const analysis = analysed(
      [
        ACTIVE,
        ...ON_INVOICE,
        ...action('Do_Apex', 'InvoiceService', 'apex'),
        ...action('Do_Flow', 'Other_Flow', 'flow'),
        ...action('Do_Alert', 'Invoice__c.Overdue', 'emailAlert'),
        ...action(
          'Do_Post',
          'chatterPost',
          'chatterPost',
          '<inputParameters>',
          '    <name>text</name>',
          '    <value>',
          '        <stringValue>About {!$Record.Amount__c}</stringValue>',
          '    </value>',
          '</inputParameters>',
        ),
        ...action('Do_Odd', 'Not a name', 'apex'),
        ...group('apexPluginCalls', 'Do_Plugin', '<apexClass>OldPlugin</apexClass>'),
        ...group(
          'subflows',
          'Do_Sub',
          '<flowName>Other_Flow</flowName>',
          '<inputAssignments>',
          '    <name>tier</name>',
          '    <value>',
          '        <elementReference>$Record.Account__r.Tier__c</elementReference>',
          '    </value>',
          '</inputAssignments>',
        ),
        ...group(
          'decisions',
          'After',
          '<rules>',
          '    <name>Ok</name>',
          ...condition('Do_Sub.result.Amount__c'),
          '</rules>',
        ),
      ],
      (source) => {
        source.flow('Other_Flow', ACTIVE);
        // An alert is a part of the file of the workflow rules of its object, as the Salesforce library lists it.
        const alerts = source.file(
          'workflows/Invoice__c.workflow-meta.xml',
          xml('Workflow', '<alerts><fullName>Overdue</fullName></alerts>'),
        );
        source.listed.push({ type: 'Workflow', fullName: 'Invoice__c', files: [alerts] });
        source.listed.push({
          type: 'WorkflowAlert',
          fullName: 'Invoice__c.Overdue',
          files: [],
          within: { file: alerts, element: 'alerts', nameElement: 'fullName' },
        });
      },
    );
    // No file of the source defines the two classes. A class is looked for all the same.
    expect(from(analysis, 'do_apex')).toEqual(['10:21 calls unresolved [InvoiceService] action confirmed']);
    expect(from(analysis, 'do_plugin')).toEqual(['41:20 calls unresolved [OldPlugin] action confirmed']);
    expect(from(analysis, 'do_flow')).toEqual(['15:21 calls Flow:other_flow [Other_Flow] action confirmed']);
    // The reference stands at the name of the alert, behind the object.
    expect(from(analysis, 'do_alert')).toEqual([
      '20:32 references WorkflowAlert:invoice__c.overdue [Overdue] action confirmed',
    ]);
    expect(attrsOf(analysis, 'do_post')).toEqual({ kind: 'action', actionType: 'chatterPost', active: true });
    expect(from(analysis, 'do_post')).toEqual([
      '30:46 reads CustomField:invoice__c.amount__c [Amount__c] merge-field confirmed',
    ]);
    expect(from(analysis, 'do_odd')).toEqual([]);
    expect(from(analysis, 'do_sub')).toEqual([
      '45:19 calls Flow:other_flow [Other_Flow] action confirmed',
      '49:43 reads CustomField:invoice__c.account__c [Account__r] path confirmed',
      '49:54 reads CustomField:account.tier__c [Tier__c] path confirmed',
    ]);
    // What a subflow gives back is of no known object.
    expect(from(analysis, 'after')).toEqual([]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 36: the element "actionName" holds "Not a name", which is not read as a name.`,
      `${FILE}, line 58: it is not known which object "Do_Sub" holds, so "result.Amount__c" after it was not followed.`,
    ]);
  });

  it('read an element of a kind it does not know as probable, on the flow where the element has no name', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group(
        'fancyNewThings',
        'Fancy',
        '<someReference>$Record.Amount__c</someReference>',
        '<assignSomethingReference>$Record.Status__c</assignSomethingReference>',
        '<sortField>Amount__c</sortField>',
        '<note>Has {!$Record.Account__r.Tier__c}</note>',
        // An element this reader knows, in an element of a kind it does not know.
        '<elementReference>$Record.Amount__c</elementReference>',
        '<stringValue>Is {!$Record.Status__c}</stringValue>',
      ),
      '<namelessThings>',
      '    <otherReference>$Record.Amount__c</otherReference>',
      '</namelessThings>',
      ...group(
        'decisions',
        'Known',
        '<strangeReference>$Record.Amount__c</strangeReference>',
        '<strange>{!$Record.Status__c}</strange>',
      ),
      '<someSetting>{!$Record.Amount__c}</someSetting>',
      '<interviewLabel>Run for {!$Record.Status__c}</interviewLabel>',
      ...group(
        'otherNewThings',
        'Other',
        '<object>Invoice__c</object>',
        '<filters>',
        '    <field>Status__c</field>',
        '</filters>',
        '<queriedFields>Amount__c</queriedFields>',
        '<expression>{!$Record.Amount__c} &gt; 0</expression>',
      ),
    ]);
    expect(attrsOf(analysis, 'fancy')).toEqual({ kind: 'unknown', element: 'fancyNewThings', active: true });
    // A name of a field is read as in an element of a known kind. This element names no object, so the field it
    // sorts by is not followed.
    expect(from(analysis, 'fancy')).toEqual([
      '10:32 reads CustomField:invoice__c.amount__c [Amount__c] path probable',
      '11:43 writes CustomField:invoice__c.status__c [Status__c] path probable',
      '14:35 reads CustomField:invoice__c.amount__c [Amount__c] path probable',
      '13:29 reads CustomField:invoice__c.account__c [Account__r] merge-field probable',
      '13:40 reads CustomField:account.tier__c [Tier__c] merge-field probable',
      '15:35 reads CustomField:invoice__c.status__c [Status__c] merge-field probable',
    ]);
    // An element of a known kind can hold something this reader has no rule for.
    expect(from(analysis, 'known')).toEqual([
      '22:35 reads CustomField:invoice__c.amount__c [Amount__c] path probable',
      '23:28 reads CustomField:invoice__c.status__c [Status__c] merge-field probable',
    ]);
    // The flow holds what its nameless element and its own settings say. The label of an interview is known.
    expect(from(analysis, '')).toEqual([
      '18:33 reads CustomField:invoice__c.amount__c [Amount__c] path probable',
      '25:28 reads CustomField:invoice__c.amount__c [Amount__c] merge-field probable',
      '26:39 reads CustomField:invoice__c.status__c [Status__c] merge-field confirmed',
    ]);
    // The names of fields of an element that names an object are fields of it, and a formula is less certain too.
    expect(from(analysis, 'other')).toEqual([
      '29:17 references CustomObject:invoice__c [Invoice__c] object probable',
      '31:20 reads CustomField:invoice__c.status__c [Status__c] filter probable',
      '33:24 reads CustomField:invoice__c.amount__c [Amount__c] output probable',
      '34:31 reads CustomField:invoice__c.amount__c [Amount__c] formula probable',
    ]);
    expect(issuesOf(analysis)).toEqual([
      'warning FLOW_ELEMENT_UNKNOWN  17:5',
      'warning FLOW_ELEMENT_UNKNOWN fancy 8:5',
      'warning PATH_NOT_FOLLOWED fancy 12:20',
      'warning FLOW_ELEMENT_UNKNOWN other 27:5',
    ]);
  });

  it('say what they do not read of a text, of an element without a name and of a name that is there twice', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group(
        'textTemplates',
        'Body',
        '<text>Amount {!$Record.Amount__c and {!$Record.Status__c} more {!Nope.Amount__c} {!$Record.Bad Name}</text>',
      ),
      '<decisions>',
      '    <label>No name</label>',
      '</decisions>',
      ...variable('Twice', 'String'),
      ...group('constants', 'twice', '<dataType>String</dataType>'),
    ]);
    expect(from(analysis, 'body')).toEqual([
      '10:56 reads CustomField:invoice__c.status__c [Status__c] merge-field confirmed',
    ]);
    expect(issuesOf(analysis)).toEqual([
      'error METADATA_UNEXPECTED  12:5',
      'error KEY_COLLISION twice',
      'warning RESOURCE_NOT_FOUND body 10:74',
      'warning NAME_NOT_READ body 10:92',
      'warning MERGE_FIELD_NOT_CLOSED body 10:22',
    ]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 12: an element "decisions" has no name.`,
      `"F.twice" (${FILE}) and "F.Twice" (${FILE}) have the same key Flow:f#element:twice. The first one is kept.`,
      `${FILE}, line 10: a merge field in "text" holds "Nope.Amount__c", and the flow has no resource "Nope". It is not read.`,
      `${FILE}, line 10: a merge field in "text" holds "$Record.Bad Name", which is not read as a name.`,
      `${FILE}, line 10: a merge field in "text" is not closed. Nothing is read of it.`,
    ]);
    // The first of the two is kept, with its kind.
    expect(attrsOf(analysis, 'twice')).toEqual({ kind: 'variable', active: true });
    expect(codes(analysis.issues.filter((issue) => issue.code === 'MERGE_FIELD_NOT_CLOSED'))).toEqual([
      'warning MERGE_FIELD_NOT_CLOSED',
    ]);
  });

  it('read a start on a schedule as a reading of records, a path on a date, and a flow without a start', () => {
    const scheduled = analysed([
      ACTIVE,
      '<start>',
      '    <filters>',
      '        <field>Status__c</field>',
      '        <operator>EqualTo</operator>',
      '    </filters>',
      '    <object>Invoice__c</object>',
      '    <triggerType>Scheduled</triggerType>',
      '</start>',
    ]);
    expect(attrsOf(scheduled, '')).toEqual({ status: 'Active', active: true, triggerType: 'Scheduled' });
    // No record sets such a flow off: it reads the records of the object.
    expect(from(scheduled, 'flow-start')).toEqual([
      '9:17 references CustomObject:invoice__c [Invoice__c] object lookup confirmed',
      '6:20 reads CustomField:invoice__c.status__c [Status__c] filter confirmed',
    ]);

    const later = analysed([
      ACTIVE,
      '<start>',
      '    <object>Invoice__c</object>',
      '    <scheduledPaths>',
      '        <name>Later</name>',
      '        <recordField>Amount__c</recordField>',
      '    </scheduledPaths>',
      '    <triggerType>RecordAfterSave</triggerType>',
      '</start>',
    ]);
    expect(from(later, 'flow-start')).toEqual([
      '5:17 triggers-on CustomObject:invoice__c [Invoice__c] object confirmed',
      '8:26 reads CustomField:invoice__c.amount__c [Amount__c] time confirmed',
    ]);

    const none = analysed([ACTIVE, ...variable('V', 'String')]);
    expect(ofFlows(none).map((one) => one.key)).toEqual(['Flow:f', 'Flow:f#element:v']);
    expect([...scheduled.issues, ...later.issues, ...none.issues]).toEqual([]);
  });

  it('read the record an element writes as a whole, and say when it is not known what that record is', () => {
    const whole = (kind: string, name: string, record: string, ...more: string[]): string[] =>
      group(kind, name, ...more, `<inputReference>${record}</inputReference>`);
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...whole('recordUpdates', 'Save_Record', '$Record'),
      ...whole(
        'recordUpdates',
        'Save_Parent',
        '$Record.Account__r',
        '<inputAssignments>',
        '    <field>Tier__c</field>',
        '</inputAssignments>',
      ),
      ...whole('recordDeletes', 'Drop_Some', 'Some'),
      ...whole('recordCreates', 'Make_Text', 'Words'),
      ...whole('recordCreates', 'Make_Nothing', 'Nope'),
      ...whole('recordCreates', 'Make_Odd', '$Record.Bad Name'),
      ...whole(
        'recordUpdates',
        'Save_Nowhere',
        '$Record.Nowhere__r',
        '<inputAssignments>',
        '    <field>Tier__c</field>',
        '</inputAssignments>',
      ),
      ...variable('Some', 'SObject'),
      ...variable('Words', 'String'),
    ]);
    expect(from(analysis, 'save_record')).toEqual([
      '10:25 references CustomObject:invoice__c [$Record] record update confirmed',
    ]);
    // The record behind a relationship: the relationship is read, its object is written, and the field is of it.
    expect(from(analysis, 'save_parent')).toEqual([
      '17:33 reads CustomField:invoice__c.account__c [Account__r] path confirmed',
      '17:33 references CustomObject:account [Account__r] record update confirmed',
      '15:20 writes CustomField:account.tier__c [Tier__c] assignment confirmed',
    ]);
    for (const name of ['drop_some', 'make_text', 'make_nothing', 'make_odd']) expect(from(analysis, name)).toEqual([]);
    // A relationship that leads nowhere known: the record and the field the element sets behind it each have a
    // warning, and the warning of the field keeps its name (decision record 0074).
    expect(from(analysis, 'save_nowhere')).toEqual(['40:33 reads unresolved [Nowhere__r] path confirmed']);
    expect(messages(analysis)).toEqual([
      // A record variable that names no object.
      `${FILE}, line 21: it is not known which object "Some" holds, so the record it names is of no known object.`,
      // A variable that holds a text.
      `${FILE}, line 25: the element "inputReference" holds "Words", which is not read as a name.`,
      `${FILE}, line 29: the element "inputReference" holds "Nope", and the flow has no resource "Nope". It is not read.`,
      `${FILE}, line 33: the element "inputReference" holds "$Record.Bad Name", which is not read as a name.`,
      `${FILE}, line 40: it is not known which object "Nowhere__r" leads to, so the record it names is of no known object.`,
      `${FILE}, line 40: it is not known which object "Nowhere__r" leads to, so its field "Tier__c" was not followed.`,
    ]);
    expect(issuesOf(analysis)).toEqual([
      'warning PATH_NOT_FOLLOWED drop_some 21:25',
      'warning NAME_NOT_READ make_text 25:25',
      'warning RESOURCE_NOT_FOUND make_nothing 29:25',
      'warning NAME_NOT_READ make_odd 33:25',
      'warning PATH_NOT_FOLLOWED save_nowhere 40:33',
      'warning PATH_NOT_FOLLOWED save_nowhere 40:33',
    ]);
    // The record of a variable and that behind a relationship end at an object, the field at a field.
    expect(
      analysis.issues
        .filter((issue) => issue.code === 'PATH_NOT_FOLLOWED')
        .map((issue) => [issue.details?.['notFollowed'], issue.details?.['endsAt']]),
    ).toEqual([
      [[], 'object'],
      [[], 'object'],
      [['Tier__c'], 'field'],
    ]);
  });

  it('follow a loop to the list it goes over, read and write by the operator of an assignment', () => {
    const item = (target: string, operator: string, ...value: string[]): string[] => [
      '<assignmentItems>',
      `    <assignToReference>${target}</assignToReference>`,
      `    <operator>${operator}</operator>`,
      ...value.map((line) => `    ${line}`),
      '</assignmentItems>',
    ];
    const loop = (name: string, list: string): string[] =>
      group('loops', name, `<collectionReference>${list}</collectionReference>`);
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group('recordLookups', 'Get_Lines', '<object>Invoice_Line__c</object>'),
      ...loop('Each', 'Get_Lines'),
      // Two loops that go over each other, and one over a list that is named with a path.
      ...loop('Round', 'Back'),
      ...loop('Back', 'Round'),
      ...loop('Deep', 'Get_Lines.Children'),
      ...group(
        'assignments',
        'Sum',
        ...item(
          'Each.Quantity__c',
          'Add',
          '<value>',
          '    <elementReference>$Record__Prior.Amount__c</elementReference>',
          '</value>',
        ),
        ...item('Each.Quantity__c', 'Assign'),
        ...item('Each.Quantity__c', 'AssignCount'),
        ...item('Round.Quantity__c', 'Assign'),
        ...item('Deep.Quantity__c', 'Assign'),
      ),
    ]);
    expect(from(analysis, 'each')).toEqual([]);
    expect(from(analysis, 'sum')).toEqual([
      // To add to a field reads it and writes it.
      '31:37 reads CustomField:invoice_line__c.quantity__c [Quantity__c] path confirmed',
      '31:37 writes CustomField:invoice_line__c.quantity__c [Quantity__c] path confirmed',
      // The value the record had before the save is a value of the same field.
      '34:50 reads CustomField:invoice__c.amount__c [Amount__c] path confirmed',
      '38:37 writes CustomField:invoice_line__c.quantity__c [Quantity__c] path confirmed',
      '42:37 writes CustomField:invoice_line__c.quantity__c [Quantity__c] path confirmed',
    ]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 46: it is not known which object "Round" holds, so "Quantity__c" after it was not followed.`,
      `${FILE}, line 50: it is not known which object "Deep" holds, so "Quantity__c" after it was not followed.`,
    ]);
  });

  it('read a field of a screen that is bound to a field of a record, and what a component of a screen gives', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group(
        'screens',
        'Ask',
        '<fields>',
        '    <name>Amount_Input</name>',
        '    <fieldType>ObjectProvided</fieldType>',
        '    <objectFieldReference>$Record.Amount__c</objectFieldReference>',
        '</fields>',
        '<fields>',
        '    <name>Picker</name>',
        '    <extensionName>c:picker</extensionName>',
        '    <fieldText>See {!$Record.Status__c}</fieldText>',
        '</fields>',
      ),
      ...group(
        'decisions',
        'Typed',
        '<rules>',
        '    <name>Something</name>',
        ...condition('Picker.value.Amount__c'),
        ...condition('Amount_Input.Amount__c'),
        '</rules>',
      ),
    ]);
    // The field shows the value and stores what is typed. The fields of a screen are no components.
    expect(from(analysis, 'ask')).toEqual([
      '13:43 reads CustomField:invoice__c.amount__c [Amount__c] path confirmed',
      '13:43 writes CustomField:invoice__c.amount__c [Amount__c] path confirmed',
      '18:38 reads CustomField:invoice__c.status__c [Status__c] merge-field confirmed',
    ]);
    expect(ofFlows(analysis).map((one) => one.key)).toEqual([
      'Flow:f',
      'Flow:f#element:ask',
      'Flow:f#element:flow-start',
      'Flow:f#element:typed',
    ]);
    // What a component gives back is of no known object. A plain field holds what was typed, and no record.
    expect(from(analysis, 'typed')).toEqual([]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 26: it is not known which object "Picker" holds, so "value.Amount__c" after it was not followed.`,
    ]);
  });

  it('leave alone what names no field: an outcome, the next element, and a value that is no name', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group(
        'decisions',
        'Check',
        // The element that comes next does not exist. That is no name of a field, and nothing is said of it.
        '<defaultConnector>',
        '    <targetReference>Nowhere</targetReference>',
        '</defaultConnector>',
        '<rules>',
        '    <name>Big</name>',
        ...condition('$Record.Amount__c'),
        '</rules>',
      ),
      // The outcome of a decision is a name of the flow, which holds no record.
      ...group('decisions', 'Then', '<rules>', '    <name>Was_Big</name>', ...condition('Big'), '</rules>'),
      ...group(
        'recordLookups',
        'Get',
        '<filters>',
        '    <field>Bad Name</field>',
        '</filters>',
        '<object>Invoice__c</object>',
        // The field a scheduled path counts from has a meaning in a start only.
        '<recordField>Amount__c</recordField>',
      ),
    ]);
    expect(from(analysis, 'check')).toEqual([
      '16:41 reads CustomField:invoice__c.amount__c [Amount__c] path confirmed',
    ]);
    expect(from(analysis, 'then')).toEqual([]);
    expect(from(analysis, 'get')).toEqual([
      '34:17 references CustomObject:invoice__c [Invoice__c] object lookup confirmed',
    ]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 32: the element "field" holds "Bad Name", which is not read as a name.`,
    ]);
  });

  it('read the flow it overrides and the object of a generic type, and say nothing of Id where a path stops', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      '<overriddenFlow>Pkg__Template_Flow</overriddenFlow>',
      ...group(
        'actionCalls',
        'Log_It',
        '<actionName>Logger</actionName>',
        '<actionType>apex</actionType>',
        '<dataTypeMappings>',
        '    <typeName>T__record</typeName>',
        '    <typeValue>Invoice__c</typeValue>',
        '</dataTypeMappings>',
        '<dataTypeMappings>',
        '    <typeName>U__record</typeName>',
        '    <typeValue>Not a name</typeValue>',
        '</dataTypeMappings>',
      ),
      ...variable('Some', 'SObject'),
      ...group(
        'decisions',
        'Check',
        '<rules>',
        '    <name>Ok</name>',
        ...condition('Some.Id'),
        ...condition('Some.Name'),
        ...condition('Some.Account__r.Id'),
        ...condition('$Record.Nowhere__r.Id'),
        ...condition('$Record.Nowhere__r.Tier__c'),
        '</rules>',
      ),
      ...group(
        'recordLookups',
        'Find_Odd',
        '<object>Not a name</object>',
        '<filters>',
        '    <field>Id</field>',
        '</filters>',
        '<filters>',
        '    <field>Status__c</field>',
        '</filters>',
      ),
    ]);
    // The flow it overrides is of a package, which the source does not hold.
    expect(from(analysis, '')).toEqual([
      '8:21 references Flow:pkg__template_flow [Pkg__Template_Flow] override confirmed',
    ]);
    const overrides = analysis.components.find((one) => one.key === element(''))?.references ?? [];
    expect(overrides.map((one) => one.resolution)).toEqual(['external']);
    // A value that is no name is not read, and says so.
    const odd = analysed([ACTIVE, ...ON_INVOICE, '<overriddenFlow>Not a name</overriddenFlow>']);
    expect(from(odd, '')).toEqual([]);
    expect(messages(odd)).toEqual([
      `${FILE}, line 8: the element "overriddenFlow" holds "Not a name", which is not read as a name.`,
    ]);
    // The action is given records of the object its generic class stands for. A value that is no name is not read.
    expect(from(analysis, 'log_it')).toEqual([
      '11:21 calls unresolved [Logger] action confirmed',
      '15:24 references CustomObject:invoice__c [Invoice__c] object confirmed',
    ]);
    expect(from(analysis, 'check')).toEqual([
      '40:41 reads unresolved [Nowhere__r] path confirmed',
      '43:41 reads unresolved [Nowhere__r] path confirmed',
    ]);
    // `Id` gives no reference where the object is known, so nothing is missed where it is not, and no warning says
    // it. Another field after the same stop is still a warning, and so is a relationship before `Id`.
    expect(messages(analysis)).toEqual([
      `${FILE}, line 19: the element "typeValue" holds "Not a name", which is not read as a name.`,
      `${FILE}, line 34: it is not known which object "Some" holds, so "Name" after it was not followed.`,
      `${FILE}, line 37: it is not known which object "Some" holds, so "Account__r.Id" after it was not followed.`,
      `${FILE}, line 43: it is not known which object "Nowhere__r" leads to, so "Tier__c" after it was not followed.`,
      `${FILE}, line 49: the element "object" holds "Not a name", which is not read as a name.`,
      `${FILE}, line 54: nothing says which object "Status__c" is a field of, so it was not followed.`,
    ]);
  });

  it('take a text for the name of a record type only where the object has one of that name', () => {
    const compared = (name: string, left = '$Record.RecordType.DeveloperName', operator = 'EqualTo'): string[] =>
      condition(
        left,
        `<operator>${operator}</operator>`,
        '<rightValue>',
        `    <stringValue>${name}</stringValue>`,
        '</rightValue>',
      );
    const analysis = analysed(
      [
        ACTIVE,
        ...ON_INVOICE,
        ...group(
          'decisions',
          'Kind',
          '<rules>',
          '    <name>Is</name>',
          ...compared('Special'),
          ...compared('Missing'),
          // A text that is searched for is no name, and neither is the name of something that is no record type.
          ...compared('Special', '$Record.RecordType.DeveloperName', 'Contains'),
          ...compared('Special', '$Record.Owner.DeveloperName'),
          '</rules>',
        ),
      ],
      (source) => {
        const type = source.file('objects/Invoice__c/recordTypes/Special.recordType-meta.xml', xml('RecordType'));
        source.listed.push({ type: 'RecordType', fullName: 'Invoice__c.Special', files: [type] });
      },
    );
    expect(from(analysis, 'kind')).toEqual([
      '13:41 reads CustomField:invoice__c.recordtypeid [RecordType] path confirmed',
      '13:52 reads CustomField:recordtype.developername [DeveloperName] path confirmed',
      '16:30 references RecordType:invoice__c.special [Special] text probable',
      '20:41 reads CustomField:invoice__c.recordtypeid [RecordType] path confirmed',
      '20:52 reads CustomField:recordtype.developername [DeveloperName] path confirmed',
      '27:41 reads CustomField:invoice__c.recordtypeid [RecordType] path confirmed',
      '27:52 reads CustomField:recordtype.developername [DeveloperName] path confirmed',
      '34:41 reads CustomField:invoice__c.ownerid [Owner] path confirmed',
      '34:47 reads CustomField:user.developername [DeveloperName] path confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('read the object and the formulas of a process of the Process Builder', () => {
    const builder = (name: string, value: string): string[] =>
      group('processMetadataValues', name, '<value>', `    <stringValue>${value}</stringValue>`, '</value>');
    const process = analysed([
      '<processType>Workflow</processType>',
      ACTIVE,
      ...builder('ObjectType', 'Invoice__c'),
      ...builder('TriggerType', 'onAllChanges'),
      ...variable('myVariable_current', 'SObject', 'Invoice__c'),
      ...group(
        'formulas',
        'formula_1',
        '<dataType>Boolean</dataType>',
        '<expression>{!myVariable_current.Amount__c} &gt; 0 &amp;&amp; ISPICKVAL({!myVariable_current.Status__c}, "Open")</expression>',
      ),
    ]);
    // A process has no start. The flow itself is set off by a record of the object the builder names.
    expect(from(process, '')).toEqual(['8:26 triggers-on CustomObject:invoice__c [Invoice__c] object confirmed']);
    expect(from(process, 'formula_1')).toEqual([
      '25:42 reads CustomField:invoice__c.amount__c [Amount__c] formula confirmed',
      '25:102 reads CustomField:invoice__c.status__c [Status__c] formula confirmed',
    ]);
    expect(process.work.map((row) => `${row.origin} ${String(row.components)}`)).toEqual([
      'parser:xml 8',
      'parser:formula 1',
      'parser:flow 3',
    ]);
    // A process another process starts is set off by no record.
    const invoked = analysed([
      '<processType>InvocableProcess</processType>',
      ACTIVE,
      ...builder('ObjectType', 'Invoice__c'),
    ]);
    expect(from(invoked, '')).toEqual(['8:26 references CustomObject:invoice__c [Invoice__c] object confirmed']);
    expect([...process.issues, ...invoked.issues]).toEqual([]);
  });

  it('follow nothing from an object that is not named, or that is named with something that is no name', () => {
    const analysis = analysed([
      ACTIVE,
      ...group('recordLookups', 'Get_What', '<filters>', '    <field>Amount__c</field>', '</filters>'),
      // A token that a build tool replaces before it deploys stands where a name should.
      ...variable('Tok', 'SObject', '%%%NAMESPACE%%%Thing__c'),
      ...group(
        'decisions',
        'D',
        '<rules>',
        '    <name>R</name>',
        ...condition('Tok.Amount__c'),
        ...condition('Get_What.Amount__c'),
        '</rules>',
      ),
      '<start>',
      '    <object>%%%NAMESPACE%%%Thing__c</object>',
      '    <triggerType>RecordAfterSave</triggerType>',
      '    <filters>',
      '        <field>Amount__c</field>',
      '    </filters>',
      '</start>',
      ...group(
        'customErrors',
        'Err',
        '<customErrorMessages>',
        '    <errorMessage>No {!$Record.Amount__c}</errorMessage>',
        '    <fieldSelection>Amount__c</fieldSelection>',
        '</customErrorMessages>',
      ),
    ]);
    expect(ofFlows(analysis).flatMap((one) => one.references)).toEqual([]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 7: nothing says which object "Amount__c" is a field of, so it was not followed.`,
      `${FILE}, line 20: it is not known which object "Tok" holds, so "Amount__c" after it was not followed.`,
      `${FILE}, line 23: it is not known which object "Get_What" holds, so "Amount__c" after it was not followed.`,
      `${FILE}, line 28: the element "object" holds "%%%NAMESPACE%%%Thing__c", which is not read as a name.`,
      `${FILE}, line 31: nothing says which object "Amount__c" is a field of, so it was not followed.`,
      `${FILE}, line 38: nothing says which object "Amount__c" is a field of, so it was not followed.`,
      `${FILE}, line 37: it is not known which object "$Record" holds, so "Amount__c" after it was not followed.`,
    ]);
    expect(new Set(codes(analysis.issues))).toEqual(new Set(['warning PATH_NOT_FOLLOWED', 'warning NAME_NOT_READ']));
  });

  it('read the records a lookup reads with its own as records of their object, and a field elsewhere as of none', () => {
    const analysis = analysed([
      ACTIVE,
      ...group(
        'recordLookups',
        'Get_Invoices',
        '<object>Invoice__c</object>',
        '<queriedFields>Amount__c</queriedFields>',
        '<relatedRecords>',
        '    <filters>',
        '        <field>Quantity__c</field>',
        '        <operator>GreaterThan</operator>',
        '    </filters>',
        '    <queriedFields>Quantity__c</queriedFields>',
        '    <relatedObject>Invoice_Line__c</relatedObject>',
        '    <relationshipField>Invoice__c</relationshipField>',
        '    <sortField>Quantity__c</sortField>',
        '</relatedRecords>',
        '<somethingNew>',
        '    <queriedFields>Status__c</queriedFields>',
        '</somethingNew>',
      ),
    ]);
    // The field that relates the two is less certain: it is not known on which side Salesforce writes it.
    expect(from(analysis, 'get_invoices')).toEqual([
      '6:17 references CustomObject:invoice__c [Invoice__c] object lookup confirmed',
      '7:24 reads CustomField:invoice__c.amount__c [Amount__c] output confirmed',
      '14:28 references CustomObject:invoice_line__c [Invoice_Line__c] object lookup confirmed',
      '10:24 reads CustomField:invoice_line__c.quantity__c [Quantity__c] filter confirmed',
      '13:28 reads CustomField:invoice_line__c.quantity__c [Quantity__c] output confirmed',
      '15:32 reads CustomField:invoice_line__c.invoice__c [Invoice__c] filter probable',
      '16:24 reads CustomField:invoice_line__c.quantity__c [Quantity__c] sort confirmed',
    ]);
    // A group this reader has no rule for can hold fields of another object: nothing says which.
    expect(messages(analysis)).toEqual([
      `${FILE}, line 19: nothing says which object "Status__c" is a field of, so it was not followed.`,
    ]);
  });

  it('take $GlobalConstant for something that names nothing', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group(
        'assignments',
        'Clear',
        '<assignmentItems>',
        '    <assignToReference>$Record.Status__c</assignToReference>',
        '    <operator>Assign</operator>',
        '    <value>',
        '        <elementReference>$GlobalConstant.EmptyString</elementReference>',
        '    </value>',
        '</assignmentItems>',
      ),
      ...group('decisions', 'D', '<rules>', '    <name>R</name>', ...condition('$GlobalConstant.True'), '</rules>'),
      ...group('formulas', 'Fm', '<dataType>Boolean</dataType>', '<expression>{!$GlobalConstant.False}</expression>'),
      ...group('textTemplates', 'T', '<text>Is {!$GlobalConstant.EmptyString}</text>'),
    ]);
    expect(from(analysis, 'clear')).toEqual([
      '11:40 writes CustomField:invoice__c.status__c [Status__c] path confirmed',
    ]);
    expect(['d', 'fm', 't'].flatMap((name) => from(analysis, name))).toEqual([]);
    expect(analysis.issues).toEqual([]);
  });

  it('know the kinds of element of the type of a flow, and say of an empty one that it has no name', () => {
    const analysis = analysed([
      ACTIVE,
      ...ON_INVOICE,
      ...group('ends', 'End_1', '<locationX>0</locationX>'),
      ...group('groups', 'Group_1', '<groupType>generic</groupType>', '<sourceReference>Set_Status</sourceReference>'),
      '<variables/>',
      ...group(
        'assignments',
        'Set_Status',
        '<assignmentItems>',
        '    <assignToReference>$Record.Status__c</assignToReference>',
        '    <operator>Assign</operator>',
        '    <value>',
        '        <setupReference>Special</setupReference>',
        '        <setupReferenceType>RecordType</setupReferenceType>',
        '    </value>',
        '</assignmentItems>',
      ),
    ]);
    expect(attrsOf(analysis, 'end_1')).toEqual({ kind: 'end', active: true });
    expect(attrsOf(analysis, 'group_1')).toEqual({ kind: 'group', active: true });
    expect(from(analysis, 'group_1')).toEqual([]);
    // The name of an item of the setup is no resource of the flow, and is not read.
    expect(from(analysis, 'set_status')).toEqual([
      '21:40 writes CustomField:invoice__c.status__c [Status__c] path confirmed',
    ]);
    expect(messages(analysis)).toEqual([`${FILE}, line 17: an element "variables" has no name.`]);
    expect(codes(analysis.issues)).toEqual(['error METADATA_UNEXPECTED']);
  });

  it('read the object of a start as set off by a record only where a change of records or an event sets it off', () => {
    const started = (trigger: string): string[] =>
      from(
        analysed([
          ACTIVE,
          '<start>',
          '    <object>Invoice__c</object>',
          `    <triggerType>${trigger}</triggerType>`,
          '</start>',
        ]),
        'flow-start',
      );
    const set = '5:17 triggers-on CustomObject:invoice__c [Invoice__c] object confirmed';
    expect(['RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete', 'PlatformEvent'].map(started)).toEqual([
      [set],
      [set],
      [set],
      [set],
    ]);
    // A schedule reads the records of the object. Of a start of another kind, nothing more is said.
    expect(started('Scheduled')).toEqual([
      '5:17 references CustomObject:invoice__c [Invoice__c] object lookup confirmed',
    ]);
    expect(started('Segment')).toEqual(['5:17 references CustomObject:invoice__c [Invoice__c] object confirmed']);
    // A process of the Process Builder that an event of the platform sets off, as a flow on such an event.
    const process = analysed([
      '<processType>CustomEvent</processType>',
      ACTIVE,
      ...group(
        'processMetadataValues',
        'ObjectType',
        '<value>',
        '    <stringValue>Invoice__c</stringValue>',
        '</value>',
      ),
    ]);
    expect(from(process, '')).toEqual(['8:26 triggers-on CustomObject:invoice__c [Invoice__c] object confirmed']);
  });

  it('read a set of choices made of a list as reading no records, and a step that makes records of another object', () => {
    const analysis = analysed([
      ACTIVE,
      ...group('recordLookups', 'Get_Lines', '<object>Invoice_Line__c</object>'),
      ...group(
        'dynamicChoiceSets',
        'Of_Lines',
        '<collectionReference>Get_Lines</collectionReference>',
        '<dataType>String</dataType>',
        '<displayField>Quantity__c</displayField>',
        '<object>Invoice_Line__c</object>',
      ),
      ...group(
        'collectionProcessors',
        'Make_Invoices',
        '<assignNextValueToReference>currentItem_Make_Invoices</assignNextValueToReference>',
        '<collectionProcessorType>RecommendationMapCollectionProcessor</collectionProcessorType>',
        '<collectionReference>Get_Lines</collectionReference>',
        '<mapItems>',
        '    <assignToFieldReference>Amount__c</assignToFieldReference>',
        '    <operator>Assign</operator>',
        '    <value>',
        '        <elementReference>currentItem_Make_Invoices.Quantity__c</elementReference>',
        '    </value>',
        '</mapItems>',
        '<outputSObjectType>Invoice__c</outputSObjectType>',
      ),
      ...group('loops', 'Each', '<collectionReference>Make_Invoices</collectionReference>'),
      ...group('decisions', 'D', '<rules>', '    <name>R</name>', ...condition('Each.Amount__c'), '</rules>'),
    ]);
    expect(from(analysis, 'of_lines')).toEqual([
      '13:17 references CustomObject:invoice_line__c [Invoice_Line__c] object confirmed',
      '12:23 reads CustomField:invoice_line__c.quantity__c [Quantity__c] output confirmed',
    ]);
    // What the step sets is a field of the records it makes, and it holds those. No file here holds such a step.
    expect(from(analysis, 'make_invoices')).toEqual([
      '27:28 references CustomObject:invoice__c [Invoice__c] object confirmed',
      '21:37 writes CustomField:invoice__c.amount__c [Amount__c] assignment probable',
      '24:61 reads CustomField:invoice_line__c.quantity__c [Quantity__c] path confirmed',
    ]);
    expect(from(analysis, 'd')).toEqual(['38:38 reads CustomField:invoice__c.amount__c [Amount__c] path confirmed']);
    expect(analysis.issues).toEqual([]);
  });

  it('read what the actions of a screen and the steps of an orchestration start', () => {
    const analysis = analysed(
      [
        ACTIVE,
        ...group(
          'screens',
          'Scr',
          '<actions>',
          '    <name>Act</name>',
          '    <actionName>Other_Flow</actionName>',
          '    <actionType>flow</actionType>',
          '</actions>',
        ),
        ...group(
          'orchestratedStages',
          'Stage_1',
          '<stageSteps>',
          '    <name>Step_1</name>',
          '    <actionName>Other_Flow</actionName>',
          '    <actionType>stepBackground</actionType>',
          '    <entryActionName>Other_Flow</entryActionName>',
          '    <entryActionType>evaluationFlow</entryActionType>',
          '</stageSteps>',
        ),
        ...group(
          'decisions',
          'D',
          '<rules>',
          '    <name>R</name>',
          ...condition('Step_1.Outputs'),
          ...condition('Stage_1.Step_1.Outputs.rec'),
          '</rules>',
        ),
      ],
      (source) => source.flow('Other_Flow', ACTIVE),
    );
    expect(from(analysis, 'scr')).toEqual(['8:25 calls Flow:other_flow [Other_Flow] action confirmed']);
    // No file here holds a step of an orchestration, so what it runs is less certain.
    expect(from(analysis, 'stage_1')).toEqual([
      '16:25 calls Flow:other_flow [Other_Flow] action probable',
      '18:30 calls Flow:other_flow [Other_Flow] action probable',
    ]);
    // A stage and a step give values back under names of their own, as an action does.
    expect(from(analysis, 'd')).toEqual([]);
    expect(messages(analysis)).toEqual([
      `${FILE}, line 30: it is not known which object "Stage_1" holds, so "Step_1.Outputs.rec" after it was not followed.`,
    ]);
  });

  it('read the records a wait waits for, the field an upsert finds records by, and the fields a transform sets', () => {
    const analysis = analysed([
      ACTIVE,
      ...group(
        'waits',
        'Wait_For_Line',
        '<waitEvents>',
        '    <name>Changed</name>',
        '    <filters>',
        '        <field>Quantity__c</field>',
        '        <operator>GreaterThan</operator>',
        '    </filters>',
        '    <object>Invoice_Line__c</object>',
        '</waitEvents>',
      ),
      ...group(
        'recordCreates',
        'Upsert_Invoice',
        '<doesUpsert>true</doesUpsert>',
        '<inputAssignments>',
        '    <field>Amount__c</field>',
        '</inputAssignments>',
        '<object>Invoice__c</object>',
        '<upsertExternalIdField>Status__c</upsertExternalIdField>',
      ),
      ...group(
        'transforms',
        'To_Invoice',
        '<dataType>SObject</dataType>',
        '<objectType>Invoice__c</objectType>',
        '<transformValues>',
        '    <transformValueActions>',
        '        <outputFieldApiName>Amount__c</outputFieldApiName>',
        '        <transformType>Map</transformType>',
        '    </transformValueActions>',
        '</transformValues>',
      ),
      ...group(
        'transforms',
        'To_Apex',
        '<apexClass>InvoiceDto</apexClass>',
        '<dataType>Apex</dataType>',
        '<transformValues>',
        '    <transformValueActions>',
        '        <outputFieldApiName>total</outputFieldApiName>',
        '    </transformValueActions>',
        '</transformValues>',
      ),
    ]);
    expect(from(analysis, 'wait_for_line')).toEqual([
      '12:21 references CustomObject:invoice_line__c [Invoice_Line__c] object confirmed',
      '9:24 reads CustomField:invoice_line__c.quantity__c [Quantity__c] filter confirmed',
    ]);
    expect(from(analysis, 'upsert_invoice')).toEqual([
      '21:17 references CustomObject:invoice__c [Invoice__c] object upsert confirmed',
      '19:20 writes CustomField:invoice__c.amount__c [Amount__c] assignment confirmed',
      '22:32 reads CustomField:invoice__c.status__c [Status__c] filter confirmed',
    ]);
    // No file here holds a transform. One that makes a value of an Apex type sets a property, which is no field.
    expect(from(analysis, 'to_invoice')).toEqual([
      '30:37 writes CustomField:invoice__c.amount__c [Amount__c] assignment probable',
    ]);
    expect(from(analysis, 'to_apex')).toEqual([]);
    expect(analysis.issues).toEqual([]);
  });

  it('give a file that is no flow its row, and an error', () => {
    const source = project();
    const path = source.file('flows/Not_A_Flow.flow-meta.xml', xml('CustomObject', '<label>x</label>'));
    source.listed.push({ type: 'Flow', fullName: 'Not_A_Flow', files: [path] });
    const analysis = source.analyse();
    expect(analysis.components.find((one) => one.key === key('Flow', 'Not_A_Flow'))).toMatchObject({
      name: 'Not_A_Flow',
      attrs: null,
      references: [],
    });
    expect(messages(analysis)).toEqual([`${path} is the file of a Flow, and its root element is "CustomObject".`]);
    expect(codes(analysis.issues)).toEqual(['error METADATA_UNEXPECTED']);
    // The file was read, and holds no flow: it is no file that failed.
    expect(analysis.work[2]).toEqual({ origin: 'parser:flow', components: 0, failedFiles: 0 });
  });
});

describe('the names the reader of flows knows', () => {
  it('are those of the type of a flow that the Salesforce library brings', () => {
    // The library of the engine brings the types, which hold the type of a flow as the Metadata API has it.
    const library = createRequire(import.meta.url).resolve('@salesforce/source-deploy-retrieve');
    const types = createRequire(library).resolve('@salesforce/types/metadata').replace(/\.js$/, '.d.ts');
    const text = readFileSync(types, 'utf8');
    const block = /^export type Flow = Metadata & \{\n([\s\S]*?)\n\};$/m.exec(text)?.[1] ?? '';
    // A list of something that is no list of values, such as the environments of a flow, is a group of elements.
    const groups = [...block.matchAll(/^ {4}(\w+)\??: (\w+)\[\];$/gm)]
      .filter(([, , type]) => new RegExp(`^export type ${String(type)} = [A-Z{]`, 'm').test(text))
      .map(([, name]) => String(name));
    expect(new Set(groups)).toEqual(new Set([...KINDS.keys(), ...NO_ELEMENTS].filter((one) => one !== 'start')));
    expect(block).toMatch(/^ {4}start\?: FlowStart;$/m);

    const values = (type: string): string[] => {
      const union = new RegExp(`^export type ${type} = (.*);$`, 'm').exec(text)?.[1] ?? '';
      return [...union.matchAll(/'([^']*)'/g)].map(([, value]) => String(value));
    };
    expect(values('FlowTriggerType')).toEqual(expect.arrayContaining([...ON_RECORDS, ON_SCHEDULE]));
    expect(values('FlowProcessType')).toEqual(expect.arrayContaining([...PROCESS_ON_RECORDS]));
    expect(values('InvocableActionType')).toEqual(expect.arrayContaining([...STARTS.keys()]));
  });
});
