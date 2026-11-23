/**
 * The analysis of record types, field sets and records of custom metadata types, with the references each of them
 * holds.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second runs on small files
 * that are written here, for what the fixture does not have.
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { HEAD, Source, viaOf, xml, XMLNS } from './helpers/written-source.ts';

/** The files of the three types in the fixture project. */
const FILES = /^force-app\/main\/default\/(?:customMetadata\/|objects\/[^/]+\/(?:recordTypes|fieldSets)\/)/;
/** The keys of the three types. */
const TYPES = /^(?:CustomMetadata|FieldSet|RecordType):/;

/** A reference as the answer key says one: where it starts, where it stands, what it is, and how sure. */
const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  const where = `${file}:${String(line)}:${String(column)}`;
  return `${reference.from} ${where}:${reference.kind}:${String(reference.to)} ${viaOf(reference)} ${reference.confidence}`;
};

describe('the record types, field sets and records of custom metadata of the fixture project', () => {
  const answers = loadAnswerKey();
  const keyed = answers.references.filter((one) => FILES.test(one.file));
  const idOfKeyed = (one: (typeof keyed)[number]): string => `${one.from} ${one.id} ${one.via} ${one.tier}`;
  let analysis: SourceAnalysis;
  let components: AnalysedComponent[];
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    components = analysis.components.filter((one) => TYPES.test(one.key));
    references = components.flatMap((one) => one.references);
  });

  it('give every reference of the key, from the component the key says, and no other', () => {
    expect(keyed).toHaveLength(28);
    expect(keyed.every((one) => one.phase === 2 && !one.stretch && one.op === undefined)).toBe(true);
    expect(references.map(idOf).sort()).toEqual(keyed.map(idOfKeyed).sort());
  });

  it('are read by the reader of XML, and name what the project holds or Salesforce provides', () => {
    for (const one of references) {
      expect(one.origin, idOf(one)).toBe('parser:xml');
      expect(one.resolution, idOf(one)).not.toBe('unresolved');
    }
    const standard = new Set<string>(answers.standard);
    const external = references.filter((one) => one.resolution === 'external');
    expect(external.map((one) => String(one.to))).toEqual(['CustomField:invoice__c.name']);
    for (const one of external) expect(standard.has(String(one.to)), idOf(one)).toBe(true);
  });

  it('keep each name as the file writes it, and for the type of a record the name of the type', () => {
    // The file of a record never names its type. The key places that reference at the name of the root element,
    // and the reference holds the name of the type, which the name of the file gives.
    const byId = new Map(keyed.map((one) => [idOfKeyed(one), one]));
    for (const one of references) {
      const entry = byId.get(idOf(one));
      if (viaOf(one) === 'record-of') {
        expect(entry?.match, idOf(one)).toBe('CustomMetadata');
        expect(one.toNameRaw, idOf(one)).toBe('Billing_Rule__mdt');
      } else expect(one.toNameRaw, idOf(one)).toBe(entry?.match);
    }
  });

  it('report no reference where the key forbids one, and know of nothing they do not read', () => {
    const forbidden = answers.negatives.filter((one) => FILES.test(one.file));
    expect(forbidden).toHaveLength(4);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
    expect(answers.unknowns.filter((one) => FILES.test(one.file))).toEqual([]);
    expect(analysis.issues.filter((issue) => TYPES.test(String(issue.componentKey)))).toEqual([]);
  });

  it('are a component each, and a record type says whether it is active and which values it allows', () => {
    const listed = answers.components.filter((one) => TYPES.test(one.key));
    expect(components.map((one) => one.key)).toEqual(listed.map((one) => one.key).sort());
    expect(components.map((one) => `${one.key} ${JSON.stringify(one.attrs)}`)).toEqual([
      'CustomMetadata:billing_rule.account_limit {}',
      'CustomMetadata:billing_rule.default {}',
      'CustomMetadata:billing_rule.invoice_amount {}',
      'CustomMetadata:billing_rule.line_quantity {}',
      'FieldSet:invoice__c.invoice_summary {}',
      'RecordType:invoice__c.credit_note {"active":true}',
      'RecordType:invoice__c.standard_invoice {"active":true}',
    ]);
    const allowed = components
      .filter((one) => one.key.startsWith('RecordType:'))
      .flatMap((one) =>
        one.references.map((reference) => `${one.name} ${String(reference.to)} ${JSON.stringify(reference.attrs)}`),
      );
    expect(allowed).toEqual([
      'Invoice__c.Credit_Note CustomField:invoice__c.channels__c {"via":"listed-field","values":["Email"]}',
      'Invoice__c.Credit_Note CustomField:invoice__c.status__c {"via":"listed-field","values":["Draft","Void"]}',
      'Invoice__c.Standard_Invoice CustomField:invoice__c.channels__c {"via":"listed-field","values":["Email","Portal","Post"]}',
      'Invoice__c.Standard_Invoice CustomField:invoice__c.status__c {"via":"listed-field","values":["Draft","Paid","Sent","Void"]}',
    ]);
  });

  it('are counted for the reader of XML', () => {
    expect(analysis.types).toEqual(expect.arrayContaining(['CustomMetadata', 'FieldSet', 'RecordType']));
    expect(components).toHaveLength(7);
  });
});

/** The references of a component, as `line:column kind target [name] via tier`. */
const from = (analysis: SourceAnalysis, key: string): string[] =>
  (analysis.components.find((one) => one.key === key)?.references ?? []).map(
    (one) =>
      `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${one.to ?? one.resolution} [${one.toNameRaw}] ${viaOf(one)} ${one.confidence}`,
  );
/** The issues of an analysis, as `severity CODE component message`. */
const issuesOf = (analysis: SourceAnalysis): string[] =>
  analysis.issues.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)} ${issue.message}`);

describe('small record types and field sets that are written here', () => {
  /** An invoice with a lookup to an account, and an opportunity. */
  const project = (): Source => {
    const source = new Source();
    source.object('Invoice__c', '<label>Invoice</label>');
    source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
    source.field('Invoice__c', 'Amount__c', '<type>Number</type>');
    source.field(
      'Invoice__c',
      'Account__c',
      '<type>Lookup</type>',
      '<referenceTo>Account</referenceTo>',
      '<relationshipName>Invoices</relationshipName>',
    );
    source.field('Invoice__c', 'Ledger__c', '<type>Text</type>');
    source.field('Account', 'Tier__c', '<type>Picklist</type>');
    return source;
  };
  /** A record type of `object` in a file of its own. The first of `lines` is line 4 of the file. */
  const recordType = (source: Source, object: string, name: string, ...lines: string[]): string => {
    const path = source.file(
      `objects/${object}/recordTypes/${name}.recordType-meta.xml`,
      xml('RecordType', `<fullName>${name}</fullName>`, ...lines),
    );
    source.listed.push({ type: 'RecordType', fullName: `${object}.${name}`, files: [path] });
    return path;
  };
  /** A field set of `object` in a file of its own. The first of `lines` is line 4 of the file. */
  const fieldSet = (source: Source, object: string, name: string, ...lines: string[]): string => {
    const path = source.file(
      `objects/${object}/fieldSets/${name}.fieldSet-meta.xml`,
      xml('FieldSet', `<fullName>${name}</fullName>`, ...lines),
    );
    source.listed.push({ type: 'FieldSet', fullName: `${object}.${name}`, files: [path] });
    return path;
  };
  const picklist = (field: string, ...values: string[]): string[] => [
    '<picklistValues>',
    `    <picklist>${field}</picklist>`,
    ...values.flatMap((value) => [
      '    <values>',
      `        <fullName>${value}</fullName>`,
      '        <default>false</default>',
      '    </values>',
    ]),
    '</picklistValues>',
  ];

  it('read the picklists of a record type with the values it allows, and its business process', () => {
    const source = project();
    const process = source.file(
      'objects/Opportunity/businessProcesses/New Business.businessProcess-meta.xml',
      xml('BusinessProcess', '<fullName>New Business</fullName>', '<isActive>true</isActive>'),
    );
    source.listed.push({ type: 'BusinessProcess', fullName: 'Opportunity.New Business', files: [process] });
    recordType(
      source,
      'Opportunity',
      'Big_Deal',
      '<active>false</active>',
      '<businessProcess>New Business</businessProcess>',
      ...picklist('StageName', 'Prospecting', 'Closed%2FWon'),
      ...picklist('Bad Name', 'A'),
    );
    recordType(source, 'Opportunity', 'Small_Deal', '<active>true</active>', '<businessProcess>Gone</businessProcess>');
    const analysis = source.analyse();
    expect(from(analysis, 'RecordType:opportunity.big_deal')).toEqual([
      '7:19 references CustomField:opportunity.stagename [StageName] listed-field confirmed',
      '5:22 references BusinessProcess:opportunity.new business [New Business] business-process confirmed',
    ]);
    const deal = analysis.components.find((one) => one.key === 'RecordType:opportunity.big_deal');
    expect(deal?.attrs).toEqual({ active: false });
    expect(deal?.references.map((one) => [one.resolution, one.attrs])).toEqual([
      ['external', { via: 'listed-field', values: ['Prospecting', 'Closed%2FWon'] }],
      ['resolved', { via: 'business-process' }],
    ]);
    // A business process the source does not hold is not found. A name of a field with a space is no name.
    expect(from(analysis, 'RecordType:opportunity.small_deal')).toEqual([
      '5:22 references unresolved [Gone] business-process confirmed',
    ]);
    expect(issuesOf(analysis)).toEqual([
      'warning NAME_NOT_READ RecordType:opportunity.big_deal objects/Opportunity/recordTypes/Big_Deal.recordType-meta.xml, line 18: the element "picklist" holds "Bad Name", which is not read as a name.',
    ]);
  });

  it('read the fields of a field set, also through relationships, and say what they cannot follow', () => {
    const source = project();
    const lines = (field: string): string[] => [
      '<displayedFields>',
      `    <field>${field}</field>`,
      '</displayedFields>',
    ];
    fieldSet(
      source,
      'Invoice__c',
      'Everything',
      '<availableFields>',
      '    <field>Status__c</field>',
      '</availableFields>',
      ...lines('Account__r.Tier__c'),
      ...lines('Account__r.Owner.Email'),
      ...lines('Gone__r.Name'),
      ...lines('CreatedDate'),
      ...lines('Not a name'),
    );
    const analysis = source.analyse();
    expect(from(analysis, 'FieldSet:invoice__c.everything')).toEqual([
      '5:16 reads CustomField:invoice__c.status__c [Status__c] listed-field confirmed',
      '8:16 reads CustomField:invoice__c.account__c [Account__r] listed-field confirmed',
      '8:27 reads CustomField:account.tier__c [Tier__c] listed-field confirmed',
      '11:16 reads CustomField:invoice__c.account__c [Account__r] listed-field confirmed',
      '11:27 reads CustomField:account.ownerid [Owner] listed-field confirmed',
      '11:33 reads CustomField:user.email [Email] listed-field confirmed',
      '14:16 reads unresolved [Gone__r] listed-field confirmed',
      '17:16 reads CustomField:invoice__c.createddate [CreatedDate] listed-field confirmed',
    ]);
    expect(issuesOf(analysis)).toEqual([
      'warning NAME_NOT_READ FieldSet:invoice__c.everything objects/Invoice__c/fieldSets/Everything.fieldSet-meta.xml, line 20: the element "field" holds "Not a name", which is not read as a name.',
      'warning PATH_NOT_FOLLOWED FieldSet:invoice__c.everything objects/Invoice__c/fieldSets/Everything.fieldSet-meta.xml, line 14: it is not known which object "Gone__r" leads to, so "Name" after it was not followed.',
    ]);
  });

  it('read a record type and a field set that stand in the file of their object', async () => {
    const source = new Source();
    source.file(
      'objects/Invoice__c.object',
      xml(
        'CustomObject',
        '<fieldSets>',
        '    <fullName>Summary</fullName>',
        '    <displayedFields>',
        '        <field>Status__c</field>',
        '    </displayedFields>',
        '</fieldSets>',
        '<fields>',
        '    <fullName>Status__c</fullName>',
        '    <type>Picklist</type>',
        '</fields>',
        '<recordTypes>',
        '    <fullName>Credit</fullName>',
        '    <active>true</active>',
        '    <picklistValues>',
        '        <picklist>Status__c</picklist>',
        '        <values>',
        '            <fullName>Draft</fullName>',
        '            <default>true</default>',
        '        </values>',
        '    </picklistValues>',
        '</recordTypes>',
      ),
    );
    const analysis = analyseSource(source.tree, (await resolveComponents(source.tree, [''])).components);
    expect(from(analysis, 'FieldSet:invoice__c.summary')).toEqual([
      '6:20 reads CustomField:invoice__c.status__c [Status__c] listed-field confirmed',
    ]);
    expect(from(analysis, 'RecordType:invoice__c.credit')).toEqual([
      '17:23 references CustomField:invoice__c.status__c [Status__c] listed-field confirmed',
    ]);
    expect(analysis.components.find((one) => one.key === 'RecordType:invoice__c.credit')?.attrs).toEqual({
      active: true,
    });
    expect(issuesOf(analysis)).toEqual([]);
  });
});

describe('small records of custom metadata types that are written here', () => {
  const XSI = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"';
  /**
   * A type with relationships to the definition of an object, of a field and to another type, and fields of
   * other types. Two objects with a field of the same name, and a field of an account.
   */
  const project = (): Source => {
    const source = new Source();
    source.object('Invoice__c', '<label>Invoice</label>');
    source.field('Invoice__c', 'Amount__c', '<type>Number</type>');
    source.object('Ledger__c', '<label>Ledger</label>');
    source.field('Ledger__c', 'Amount__c', '<type>Number</type>');
    source.field('Account', 'Tier__c', '<type>Picklist</type>');
    source.object('Rule__mdt', '<label>Rule</label>');
    const relationship = (name: string, to: string, controlling?: string): void => {
      source.field(
        'Rule__mdt',
        name,
        ...(controlling === undefined
          ? []
          : [`<metadataRelationshipControllingField>Rule__mdt.${controlling}</metadataRelationshipControllingField>`]),
        `<referenceTo>${to}</referenceTo>`,
        '<type>MetadataRelationship</type>',
      );
    };
    relationship('Object__c', 'EntityDefinition');
    relationship('Other_Object__c', 'EntityDefinition');
    relationship('Field__c', 'FieldDefinition', 'Object__c');
    relationship('Other_Field__c', 'FieldDefinition', 'Other_Object__c');
    relationship('Group__c', 'Group__mdt');
    for (const [name, type] of [
      ['Name_Text__c', 'Text'],
      ['Area__c', 'TextArea'],
      ['Long__c', 'LongTextArea'],
      ['Choice__c', 'Picklist'],
      ['Limit__c', 'Number'],
    ] as const) {
      source.field('Rule__mdt', name, `<type>${type}</type>`);
    }
    source.object('Group__mdt', '<label>Group</label>');
    record(source, 'Group.Main');
    return source;
  };
  /**
   * A record with these values: a field, and its value as text, or `null` for none. The first field is on line 6
   * of the file, its value on line 7, and every next one four lines below.
   */
  const record = (source: Source, fullName: string, ...values: (readonly [string, string | null])[]): string => {
    const lines = values.flatMap(([field, value]) => [
      '<values>',
      `    <field>${field}</field>`,
      value === null ? '    <value xsi:nil="true"/>' : `    <value xsi:type="xsd:string">${value}</value>`,
      '</values>',
    ]);
    const text = [
      HEAD,
      `<CustomMetadata xmlns="${XMLNS}" ${XSI}>`,
      ...['<label>A rule</label>', '<protected>false</protected>', ...lines].map((line) => `    ${line}`),
      '</CustomMetadata>',
      '',
    ].join('\n');
    const path = source.file(`customMetadata/${fullName}.md-meta.xml`, text);
    source.listed.push({ type: 'CustomMetadata', fullName, files: [path] });
    return path;
  };

  it('read the type of a record, the fields it gives a value, and the values of its relationships', () => {
    const source = project();
    record(
      source,
      'Rule.Mapping',
      ['Object__c', 'Invoice__c'],
      ['Field__c', 'Amount__c'],
      ['Other_Field__c', 'Amount__c'],
      ['Group__c', 'Main'],
    );
    record(source, 'Rule.Standard', ['Object__c', 'Account'], ['Field__c', 'Industry'], ['Group__c', 'Gone']);
    const analysis = source.analyse();
    expect(from(analysis, 'CustomMetadata:rule.mapping')).toEqual([
      '2:2 references CustomObject:rule__mdt [Rule__mdt] record-of confirmed',
      '6:16 references CustomField:rule__mdt.object__c [Object__c] listed-field confirmed',
      '7:38 references CustomObject:invoice__c [Invoice__c] value confirmed',
      '10:16 references CustomField:rule__mdt.field__c [Field__c] listed-field confirmed',
      '11:38 references CustomField:invoice__c.amount__c [Amount__c] value confirmed',
      '14:16 references CustomField:rule__mdt.other_field__c [Other_Field__c] listed-field confirmed',
      '18:16 references CustomField:rule__mdt.group__c [Group__c] listed-field confirmed',
      '19:38 references CustomMetadata:group.main [Main] value confirmed',
    ]);
    // Salesforce provides an account and its field Industry. A record of another type that the source does not
    // hold is not found.
    expect(from(analysis, 'CustomMetadata:rule.standard')).toEqual([
      '2:2 references CustomObject:rule__mdt [Rule__mdt] record-of confirmed',
      '6:16 references CustomField:rule__mdt.object__c [Object__c] listed-field confirmed',
      '7:38 references CustomObject:account [Account] value confirmed',
      '10:16 references CustomField:rule__mdt.field__c [Field__c] listed-field confirmed',
      '11:38 references CustomField:account.industry [Industry] value confirmed',
      '14:16 references CustomField:rule__mdt.group__c [Group__c] listed-field confirmed',
      '15:38 references unresolved [Gone] value confirmed',
    ]);
    // The field whose value says the object of `Other_Field__c` has no value in the record.
    expect(issuesOf(analysis)).toEqual([
      'warning PATH_NOT_FOLLOWED CustomMetadata:rule.mapping customMetadata/Rule.Mapping.md-meta.xml, line 15: nothing says which object "Amount__c" is a field of, so it was not followed.',
    ]);
  });

  it('take a text for the name of a field only where it is exactly one that the source defines', () => {
    const source = project();
    record(
      source,
      'Rule.Texts',
      ['Object__c', 'Invoice__c'],
      ['Other_Object__c', 'Ledger__c'],
      ['Name_Text__c', 'Amount__c'],
      ['Area__c', 'Account.Tier__c'],
      ['Long__c', 'Account.Industry'],
      ['Choice__c', 'Amount__c'],
      ['Limit__c', 'Invoice__c.Amount__c'],
    );
    record(
      source,
      'Rule.Words',
      ['Name_Text__c', 'the Amount__c of an invoice'],
      ['Area__c', '$User.Email'],
      ['Long__c', 'Invoice__c.Amount__c.Extra'],
      ['Gone__c', 'Invoice__c.Amount__c'],
      ['Choice__c', null],
    );
    // A text that names a field of no object the record names, and a record named with the suffix of its type.
    record(source, 'Rule__mdt.Suffixed', ['Name_Text__c', 'Amount__c']);
    const analysis = source.analyse();
    // A field of each object the record names. A field that Salesforce provides is no file of the source, and a
    // picklist and a number are no text.
    expect(from(analysis, 'CustomMetadata:rule.texts')).toEqual([
      '2:2 references CustomObject:rule__mdt [Rule__mdt] record-of confirmed',
      '6:16 references CustomField:rule__mdt.object__c [Object__c] listed-field confirmed',
      '7:38 references CustomObject:invoice__c [Invoice__c] value confirmed',
      '10:16 references CustomField:rule__mdt.other_object__c [Other_Object__c] listed-field confirmed',
      '11:38 references CustomObject:ledger__c [Ledger__c] value confirmed',
      '14:16 references CustomField:rule__mdt.name_text__c [Name_Text__c] listed-field confirmed',
      '15:38 references CustomField:invoice__c.amount__c [Amount__c] text probable',
      '15:38 references CustomField:ledger__c.amount__c [Amount__c] text probable',
      '18:16 references CustomField:rule__mdt.area__c [Area__c] listed-field confirmed',
      '19:46 references CustomField:account.tier__c [Tier__c] text probable',
      '22:16 references CustomField:rule__mdt.long__c [Long__c] listed-field confirmed',
      '26:16 references CustomField:rule__mdt.choice__c [Choice__c] listed-field confirmed',
      '30:16 references CustomField:rule__mdt.limit__c [Limit__c] listed-field confirmed',
    ]);
    // Words around a name, a global variable, three names and a field the type does not define. A field without
    // a value, as Salesforce writes one for each field a record leaves out, gives nothing.
    expect(from(analysis, 'CustomMetadata:rule.words')).toEqual([
      '2:2 references CustomObject:rule__mdt [Rule__mdt] record-of confirmed',
      '6:16 references CustomField:rule__mdt.name_text__c [Name_Text__c] listed-field confirmed',
      '10:16 references CustomField:rule__mdt.area__c [Area__c] listed-field confirmed',
      '14:16 references CustomField:rule__mdt.long__c [Long__c] listed-field confirmed',
      '18:16 references unresolved [Gone__c] listed-field confirmed',
    ]);
    expect(from(analysis, 'CustomMetadata:rule__mdt.suffixed')).toEqual([
      '2:2 references CustomObject:rule__mdt [Rule__mdt] record-of confirmed',
      '6:16 references CustomField:rule__mdt.name_text__c [Name_Text__c] listed-field confirmed',
    ]);
    expect(analysis.components.filter((one) => one.key.startsWith('CustomMetadata:')).map((one) => one.attrs)).toEqual([
      {},
      {},
      {},
      {},
    ]);
    expect(issuesOf(analysis)).toEqual([]);
  });

  it('place the type of a record at the name of the root element, also with a prefix', () => {
    const source = project();
    const path = source.file(
      'customMetadata/Rule.Prefixed.md-meta.xml',
      [
        HEAD,
        `<md:CustomMetadata xmlns:md="${XMLNS}" ${XSI}>`,
        '    <md:label>A rule</md:label>',
        '    <md:values>',
        '        <md:field>Limit__c</md:field>',
        '        <md:value xsi:type="xsd:double">1.0</md:value>',
        '    </md:values>',
        '</md:CustomMetadata>',
        '',
      ].join('\n'),
    );
    source.listed.push({ type: 'CustomMetadata', fullName: 'Rule.Prefixed', files: [path] });
    const analysis = source.analyse();
    expect(from(analysis, 'CustomMetadata:rule.prefixed')).toEqual([
      '2:5 references CustomObject:rule__mdt [Rule__mdt] record-of confirmed',
      '5:19 references CustomField:rule__mdt.limit__c [Limit__c] listed-field confirmed',
    ]);
    expect(issuesOf(analysis)).toEqual([]);
  });
});
