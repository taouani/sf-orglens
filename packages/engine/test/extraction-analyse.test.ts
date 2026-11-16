/**
 * The analysis of a source: a component for everything it holds, and the references of objects, fields and
 * validation rules that are written in XML.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second part runs on
 * small sources that are written here, for what the fixture project does not have.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent, AnalysisIssue } from '../src/extraction/analysed.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents, type ResolvedComponent } from '../src/sources/resolve.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { writeAnalysis } from '../src/store/analysis.ts';
import { sqlGraph } from '../src/store/graph.ts';
import { openStore } from '../src/store/open.ts';
import { ensureSource, insertSnapshot } from '../src/store/snapshots.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });
const hex = (bytes: Uint8Array | undefined): string => Buffer.from(bytes ?? []).toString('hex');
const sha = (content: Uint8Array | string): string => createHash('sha256').update(content).digest('hex');

/** How the answer key names the references that are written in XML. Everything else in a field or a rule is a formula. */
const XML_VIAS = ['lookup', 'filter', 'summary', 'display-field', 'controlling-field', 'value-set'];

/** How the source names the target of a reference, as the reference keeps it. */
const viaOf = (reference: Reference): string => {
  const via = reference.attrs?.['via'];
  return typeof via === 'string' ? via : 'none';
};

/** A reference as the answer key identifies one, and how the source names its target. */
const idOf = (reference: Reference): string =>
  `${String(reference.location?.file)}:${String(reference.location?.line)}:${String(reference.location?.column)}:${reference.kind}:${String(reference.to)} ${viaOf(reference)}`;

const componentOf = (analysis: SourceAnalysis, type: string, fullName: string): AnalysedComponent => {
  const found = analysis.components.find((one) => one.key === key(type, fullName));
  if (found === undefined) throw new Error(`The analysis has no ${type} ${fullName}.`);
  return found;
};
const codes = (issues: readonly AnalysisIssue[]): string[] => issues.map((issue) => `${issue.severity} ${issue.code}`);

describe('the analysis of the fixture project', () => {
  const answers = loadAnswerKey();
  const project = join(FIXTURES_DIR, answers.project);
  let tree: SourceTree;
  let listed: readonly ResolvedComponent[];
  let analysis: SourceAnalysis;
  let references: readonly Reference[];

  beforeAll(async () => {
    tree = readFolders(project, ['force-app']).tree;
    listed = (await resolveComponents(tree, ['force-app'])).components;
    analysis = analyseSource(tree, listed);
    references = analysis.components.flatMap((one) => one.references);
  });

  it('has a component for everything the key lists, and for the two standard objects it holds fields of', () => {
    const account = key('CustomObject', 'Account');
    const user = key('CustomObject', 'User');
    expect(analysis.components.map((one) => one.key)).toEqual(
      [...answers.components.map((one) => one.key), account, user].sort(),
    );
    expect(analysis.components).toHaveLength(89);
    // Only those two are not defined: the project holds fields of them and no file of the object.
    expect(analysis.components.filter((one) => one.definition === null)).toEqual([
      { key: account, name: 'Account', definition: null, attrs: null, references: [] },
      { key: user, name: 'User', definition: null, attrs: null, references: [] },
    ]);
    for (const { type, fullName } of answers.components) {
      expect(componentOf(analysis, type, fullName).name).toBe(fullName);
    }
  });

  it('finds every reference of the key that is written in XML, where the key says, and no other', () => {
    const expected = answers.references
      .filter((one) => XML_VIAS.includes(one.via))
      .map((one) => `${one.id} ${one.via}`);
    expect(expected).toHaveLength(26);
    expect(references.map(idOf).sort()).toEqual(expected.sort());
  });

  it('gives each reference the component its file defines, the tier confirmed and the origin of the reader', () => {
    const starts = new Map(
      answers.references.map((one) => [`${one.id} ${one.via}`, { from: one.from, match: one.match }]),
    );
    for (const reference of references) {
      const keyed = starts.get(idOf(reference));
      expect(reference.from, idOf(reference)).toBe(keyed?.from);
      expect(reference.toNameRaw, idOf(reference)).toBe(keyed?.match);
      expect(reference).toMatchObject({ origin: 'parser:xml', confidence: 'confirmed' });
    }
  });

  it('calls a target resolved when the project defines it, and external when Salesforce provides it', () => {
    for (const reference of references) {
      const standard = reference.to !== null && answers.standard.includes(reference.to);
      expect(reference.resolution, idOf(reference)).toBe(standard ? 'external' : 'resolved');
    }
    expect(references.filter((one) => one.resolution === 'external').map((one) => one.to)).toEqual([
      'CustomObject:contact',
      'CustomObject:account',
      'CustomObject:user',
      'CustomField:user.department',
      'CustomField:user.department',
      'CustomObject:contact',
      'CustomField:contact.accountid',
    ]);
  });

  it('reports no reference where the key forbids one', () => {
    for (const negative of answers.negatives) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), negative.why).toEqual([]);
    }
  });

  it('raises no issue, and counts the objects, fields and rules it looked at', () => {
    expect(analysis.issues).toEqual([]);
    // 5 objects, 54 fields and 10 rules. The two objects without a file were not looked at.
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 69, failedFiles: 0 }]);
  });

  it('keeps what later steps need of a field, a rule and an object', () => {
    const attrs = (type: string, fullName: string): unknown => componentOf(analysis, type, fullName).attrs;
    expect(attrs('CustomField', 'Invoice__c.Account__c')).toEqual({
      type: 'Lookup',
      referenceTo: ['Account'],
      relationshipName: 'Invoices',
    });
    expect(attrs('CustomField', 'Invoice_Line__c.Invoice__c')).toEqual({
      type: 'MasterDetail',
      referenceTo: ['Invoice__c'],
      relationshipName: 'Lines',
    });
    expect(attrs('CustomField', 'User.Backup_Approver__c')).toEqual({
      type: 'Hierarchy',
      relationshipName: 'Backup_Approver_For',
    });
    expect(attrs('CustomField', 'Invoice__c.Total__c')).toEqual({ type: 'Currency', formula: true });
    expect(attrs('CustomField', 'Invoice__c.Amount__c')).toEqual({ type: 'Currency' });
    // A default value is a formula too, and the field is no formula field.
    expect(attrs('CustomField', 'Invoice__c.Region__c')).toEqual({ type: 'Text' });
    expect(attrs('CustomField', 'Invoice__c.Lines_Total__c')).toEqual({ type: 'Summary' });

    expect(attrs('ValidationRule', 'Invoice__c.Locked_When_Paid')).toEqual({ active: true });
    expect(attrs('ValidationRule', 'Invoice_Line__c.Quantity_Positive')).toEqual({ active: false });

    expect(attrs('CustomObject', 'Billing_Settings__c')).toEqual({ customSettingsType: 'Hierarchy' });
    expect(attrs('CustomObject', 'Invoice__c')).toEqual({});
  });

  it('leaves the components of every other type without attributes and without references', () => {
    const others = analysis.components.filter((one) => !/^(?:CustomObject|CustomField|ValidationRule):/.test(one.key));
    expect(others).toHaveLength(18);
    for (const one of others) expect(one).toMatchObject({ attrs: null, references: [] });
  });

  it('says where each component is defined, with the hash of what defines it', () => {
    const base = 'force-app/main/default';
    const content = (path: string): Buffer => readFileSync(join(project, path));

    // One file: the hash of the file.
    const amount = `${base}/objects/Invoice__c/fields/Amount__c.field-meta.xml`;
    const field = componentOf(analysis, 'CustomField', 'Invoice__c.Amount__c').definition;
    expect(field?.path).toBe(amount);
    expect(hex(field?.contentHash)).toBe(sha(content(amount)));

    // Two files: the metadata file is named, and the hash is taken over the hash and the path of each.
    const code = `${base}/classes/InvoiceService.cls`;
    const apex = componentOf(analysis, 'ApexClass', 'InvoiceService').definition;
    expect(apex?.path).toBe(`${code}-meta.xml`);
    expect(hex(apex?.contentHash)).toBe(
      sha(`${sha(content(code))} ${code}\n${sha(content(`${code}-meta.xml`))} ${code}-meta.xml\n`),
    );

    // A part of a file: the hash of the part.
    const labels = `${base}/labels/CustomLabels.labels-meta.xml`;
    const part = /<labels>.*?<\/labels>/s.exec(content(labels).toString('utf8'))?.[0];
    expect(part).toContain('<fullName>Overdue_Notice</fullName>');
    const label = componentOf(analysis, 'CustomLabel', 'Overdue_Notice').definition;
    expect(label?.path).toBe(labels);
    expect(hex(label?.contentHash)).toBe(sha(part ?? ''));
    expect(hex(componentOf(analysis, 'CustomLabels', 'CustomLabels').definition?.contentHash)).toBe(
      sha(content(labels)),
    );
  });

  it('gives the same analysis in whatever order the components are listed', () => {
    const turned = analyseSource(tree, [...listed].reverse());
    expect(turned.components).toEqual(analysis.components);
    expect(turned.work).toEqual(analysis.work);
  });

  describe.each(DRIVERS)('written into the store with $name', (driver) => {
    const temp = tempDirs();
    afterEach(temp.cleanUp);

    it('is accepted as it is, and answers what refers to a field', () => {
      const store = openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });
      const at = '2026-01-31T09:30:00.000Z';
      const snapshot = store.write(() =>
        insertSnapshot(store, {
          sourceId: ensureSource(store, { name: 'repo', kind: 'git', createdAt: at }),
          status: 'complete',
          startedAt: at,
          finishedAt: at,
          engineVersion: '0.2.0',
          gitCommit: null,
        }),
      );
      const written = writeAnalysis(store, snapshot, {
        engineVersion: '0.2.0',
        analysedAt: at,
        components: analysis.components,
        work: analysis.work,
        issues: analysis.issues,
      });
      expect(written).toMatchObject({ components: 89, references: 26 });

      const graph = sqlGraph(store, snapshot);
      const status = graph.find(key('CustomField', 'Invoice__c.Status__c'));
      expect(
        graph
          .referencesTo(status?.id ?? 0)
          .map((one) => `${one.from} ${one.kind} ${viaOf(one)}`)
          .sort(),
      ).toEqual([
        'CustomField:invoice__c.approver__c reads filter',
        'CustomField:invoice__c.sub_status__c references controlling-field',
        'ValidationRule:invoice__c.paid_cannot_be_reopened references display-field',
      ]);
      // The standard object the project holds fields of is a component of the snapshot, without a file.
      expect(graph.find(key('CustomObject', 'Account'))?.version).toEqual({ name: 'Account', path: null, attrs: null });
      store.close();
    });
  });
});

const XMLNS = 'http://soap.sforce.com/2006/04/metadata';
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
const xml = (root: string, ...lines: string[]): string =>
  [HEAD, `<${root} xmlns="${XMLNS}">`, ...lines.map((line) => `    ${line}`), `</${root}>`, ''].join('\n');

/** A source that is written in a test: files by path, and the components they make up. */
class Source {
  readonly files = new Map<string, Uint8Array>();
  readonly listed: ResolvedComponent[] = [];
  /** Paths that fail when they are read. */
  readonly broken = new Set<string>();

  file(path: string, content: string | Uint8Array): string {
    this.files.set(path, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
    return path;
  }

  object(name: string, ...lines: string[]): string {
    const path = this.file(`objects/${name}/${name}.object-meta.xml`, xml('CustomObject', ...lines));
    this.listed.push({ type: 'CustomObject', fullName: name, files: [path] });
    return path;
  }

  field(object: string, name: string, ...lines: string[]): string {
    return this.fieldFile(object, name, xml('CustomField', `<fullName>${name}</fullName>`, ...lines));
  }

  fieldFile(object: string, name: string, content: string | Uint8Array): string {
    const path = this.file(`objects/${object}/fields/${name}.field-meta.xml`, content);
    this.listed.push({ type: 'CustomField', fullName: `${object}.${name}`, files: [path] });
    return path;
  }

  rule(object: string, name: string, ...lines: string[]): string {
    const path = this.file(
      `objects/${object}/validationRules/${name}.validationRule-meta.xml`,
      xml('ValidationRule', `<fullName>${name}</fullName>`, ...lines),
    );
    this.listed.push({ type: 'ValidationRule', fullName: `${object}.${name}`, files: [path] });
    return path;
  }

  get tree(): SourceTree {
    return {
      files: [...this.files.keys()].sort(),
      read: (path) => {
        const content = this.files.get(path);
        if (content === undefined || this.broken.has(path)) throw new Error(`${path} cannot be read.`);
        return content;
      },
    };
  }

  analyse(): SourceAnalysis {
    return analyseSource(this.tree, this.listed);
  }
}

/** The references of an analysis as `line:column kind target [name] resolution via`, in the order of the files. */
const told = (analysis: SourceAnalysis, from?: ComponentKey): string[] =>
  analysis.components
    .filter((one) => from === undefined || one.key === from)
    .flatMap((one) => one.references)
    .map(
      (one) =>
        `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} [${one.toNameRaw}] ${one.resolution} ${viaOf(one)}`,
    );

describe('names that are not found', () => {
  it('are unresolved without a key when they are custom, and external with a key otherwise', () => {
    const source = new Source();
    source.object('Invoice__c');
    source.field('Invoice__c', 'Batch__c', '<referenceTo>npsp__Batch__c</referenceTo>', '<type>Lookup</type>');
    source.field('Invoice__c', 'Ghost__c', '<referenceTo>Ghost__c</referenceTo>', '<type>Lookup</type>');
    source.field(
      'Invoice__c',
      'Kind__c',
      '<type>Picklist</type>',
      '<valueSet>',
      '    <controllingField>Nope__c</controllingField>',
      '    <valueSetName>Missing_Set</valueSetName>',
      '</valueSet>',
    );
    source.field('Invoice__c', 'Size__c', '<valueSet><valueSetName>npsp__Sizes</valueSetName></valueSet>');
    source.field(
      'Invoice__c',
      'Sum__c',
      '<summarizedField>Ghost__c.Amount__c</summarizedField>',
      '<summaryForeignKey>Ghost__c.Invoice__c</summaryForeignKey>',
      '<type>Summary</type>',
    );
    source.rule('Invoice__c', 'Named', '<active>true</active>', '<errorDisplayField>Name</errorDisplayField>');
    const analysis = source.analyse();

    expect(told(analysis)).toEqual([
      '4:18 references CustomObject:npsp__batch__c [npsp__Batch__c] external lookup',
      '4:18 references null [Ghost__c] unresolved lookup',
      '6:27 references null [Nope__c] unresolved controlling-field',
      '7:23 references null [Missing_Set] unresolved value-set',
      '4:29 references GlobalValueSet:npsp__sizes [npsp__Sizes] external value-set',
      '4:31 reads null [Amount__c] unresolved summary',
      '5:33 references null [Invoice__c] unresolved summary',
      '5:24 references CustomField:invoice__c.name [Name] external display-field',
    ]);
    // A name that has no key keeps its type.
    const unresolved = analysis.components.flatMap((one) => one.references).filter((one) => one.to === null);
    expect(unresolved.map((one) => one.toType)).toEqual([
      'CustomObject',
      'CustomField',
      'GlobalValueSet',
      'CustomField',
      'CustomField',
    ]);
    // A name that is not found is a reference, not an issue.
    expect(analysis.issues).toEqual([]);
  });
});

describe('a path of names in a filter', () => {
  const build = (): Source => {
    const source = new Source();
    source.object('Invoice__c');
    source.field('Invoice__c', 'Account__c', '<referenceTo>Account</referenceTo>', '<type>Lookup</type>');
    return source;
  };
  const filter = (...items: string[]): string[] => [
    '<lookupFilter>',
    ...items.map((item) => `    <filterItems>${item}</filterItems>`),
    '</lookupFilter>',
    '<referenceTo>Contact</referenceTo>',
    '<type>Lookup</type>',
  ];
  const CONTACT = key('CustomField', 'Invoice__c.Contact__c');

  it('reads the field behind every relationship and the field at the end, each at its own name', () => {
    const source = build();
    source.field(
      'Invoice__c',
      'Contact__c',
      ...filter(
        '<field>Contact.Account.Owner.Email</field><valueField>$Source.Account__r.Parent.Name</valueField>',
        '<field>$Profile.Name</field><valueField>$UserRole.Name</valueField>',
        '<field>$user.Manager.Department</field>',
      ),
    );
    const analysis = source.analyse();
    expect(told(analysis, CONTACT)).toEqual([
      // The object in front of a path and a global variable are no references.
      '9:18 references CustomObject:contact [Contact] external lookup',
      '5:37 reads CustomField:contact.accountid [Account] external filter',
      '5:45 reads CustomField:account.ownerid [Owner] external filter',
      '5:51 reads CustomField:user.email [Email] external filter',
      '5:84 reads CustomField:invoice__c.account__c [Account__r] resolved filter',
      '5:95 reads CustomField:account.parentid [Parent] external filter',
      '5:102 reads CustomField:account.name [Name] external filter',
      '6:38 reads CustomField:profile.name [Name] external filter',
      '6:72 reads CustomField:userrole.name [Name] external filter',
      '7:35 reads CustomField:user.managerid [Manager] external filter',
      '7:43 reads CustomField:user.department [Department] external filter',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('says so when it does not know where a relationship leads, and keeps what it reached', () => {
    const source = build();
    const file = source.field(
      'Invoice__c',
      'Contact__c',
      ...filter('<field>Contact.Sponsor.Region.Name</field>', '<field>Contact.Missing__r.Name</field>'),
    );
    const analysis = source.analyse();
    expect(told(analysis, CONTACT)).toEqual([
      '8:18 references CustomObject:contact [Contact] external lookup',
      '5:37 reads CustomField:contact.sponsorid [Sponsor] external filter',
      '6:37 reads null [Missing__r] unresolved filter',
    ]);
    expect(analysis.issues).toEqual([
      {
        severity: 'warning',
        code: 'PATH_NOT_FOLLOWED',
        message: `${file}, line 5: it is not known which object "Sponsor" leads to, so "Region.Name" after it was not followed.`,
        componentKey: CONTACT,
        details: { path: file, line: 5, column: 37, relationship: 'Sponsor', notFollowed: ['Region', 'Name'] },
      },
      {
        severity: 'warning',
        code: 'PATH_NOT_FOLLOWED',
        message: `${file}, line 6: it is not known which object "Missing__r" leads to, so "Name" after it was not followed.`,
        componentKey: CONTACT,
        details: { path: file, line: 6, column: 37, relationship: 'Missing__r', notFollowed: ['Name'] },
      },
    ]);
  });

  it('reads nothing from a text that is no name, and says where it stands', () => {
    const source = build();
    const long = `Contact.${'x'.repeat(80)} y`;
    const file = source.field(
      'Invoice__c',
      'Contact__c',
      ...filter(
        '<field>$Api.Session_ID</field>',
        '<field>AccountId</field>',
        '<field>Contact..Name</field>',
        '<field>Contact.$User.Name</field>',
        `<field>${long}</field>`,
        '<field>$Source</field>',
      ),
    );
    source.field('Invoice__c', 'Odd__c', '<referenceTo>My Object</referenceTo>', '<type>Lookup</type>');
    source.rule('Invoice__c', 'Odd', '<errorDisplayField>$User.Name</errorDisplayField>');
    const analysis = source.analyse();

    expect(told(analysis)).toEqual([
      '4:18 references CustomObject:account [Account] external lookup',
      '12:18 references CustomObject:contact [Contact] external lookup',
    ]);
    expect(analysis.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.message}`)).toEqual([
      `warning NAME_NOT_READ ${file}, line 5: the element "field" holds "$Api.Session_ID", which is not read as a name.`,
      `warning NAME_NOT_READ ${file}, line 6: the element "field" holds "AccountId", which is not read as a name.`,
      `warning NAME_NOT_READ ${file}, line 7: the element "field" holds "Contact..Name", which is not read as a name.`,
      `warning NAME_NOT_READ ${file}, line 8: the element "field" holds "Contact.$User.Name", which is not read as a name.`,
      `warning NAME_NOT_READ ${file}, line 9: the element "field" holds "${long.slice(0, 60)}", which is not read as a name.`,
      `warning NAME_NOT_READ ${file}, line 10: the element "field" holds "$Source", which is not read as a name.`,
      'warning NAME_NOT_READ objects/Invoice__c/fields/Odd__c.field-meta.xml, line 4: the element "referenceTo" holds "My Object", which is not read as a name.',
      'warning NAME_NOT_READ objects/Invoice__c/validationRules/Odd.validationRule-meta.xml, line 4: the element "errorDisplayField" holds "$User.Name", which is not read as a name.',
    ]);
    expect(analysis.issues[0]).toMatchObject({
      componentKey: CONTACT,
      details: { path: file, line: 5, column: 29, element: 'field' },
    });
    // The attributes keep what the file says, also where it names no object.
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Odd__c').attrs).toEqual({
      type: 'Lookup',
      referenceTo: ['My Object'],
    });
  });
});

describe('the place of a name', () => {
  it('is where the name stands: after white space, in a CDATA section, behind a comment, in a file with CRLF', () => {
    const source = new Source();
    const lines = [
      `${String.fromCharCode(0xfeff)}${HEAD}`,
      `<CustomField xmlns="${XMLNS}">`,
      '    <fullName>Total__c</fullName>',
      '    <referenceTo>',
      '        Contact',
      '    </referenceTo>',
      '    <summarizedField><![CDATA[Line__c.Amount__c]]></summarizedField>',
      '    <summaryForeignKey>Line__c.<!-- the key -->Invoice__c</summaryForeignKey>',
      '    <valueSet><controllingField>  Status__c </controllingField></valueSet>',
      '</CustomField>',
      '',
    ];
    source.fieldFile('Invoice__c', 'Total__c', lines.join('\r\n'));
    const column = (line: number, name: string): number => (lines[line - 1] ?? '').indexOf(name) + 1;

    expect(told(source.analyse())).toEqual([
      `5:${String(column(5, 'Contact'))} references CustomObject:contact [Contact] external lookup`,
      `7:${String(column(7, 'Amount__c'))} reads null [Amount__c] unresolved summary`,
      `8:${String(column(8, 'Invoice__c'))} references null [Invoice__c] unresolved summary`,
      `9:${String(column(9, 'Status__c'))} references null [Status__c] unresolved controlling-field`,
    ]);
    expect([column(5, 'Contact'), column(7, 'Amount__c'), column(8, 'Invoice__c'), column(9, 'Status__c')]).toEqual([
      9, 39, 48, 35,
    ]);
  });

  it('reads the controlling field of a picklist that is written the way files were before API version 38', () => {
    const source = new Source();
    source.object('Invoice__c');
    source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
    source.field(
      'Invoice__c',
      'Sub__c',
      '<picklist>',
      '    <controllingField>Status__c</controllingField>',
      '    <picklistValues><fullName>A</fullName></picklistValues>',
      '</picklist>',
      '<type>Picklist</type>',
    );
    expect(told(source.analyse())).toEqual([
      '5:27 references CustomField:invoice__c.status__c [Status__c] resolved controlling-field',
    ]);
  });
});

describe('fields and rules inside the file of their object', () => {
  it('are components with the part of the file that defines them, and are read like files of their own', () => {
    const source = new Source();
    const lines = [
      HEAD,
      `<CustomObject xmlns="${XMLNS}">`,
      '    <customSettingsType>List</customSettingsType>',
      '    <fields>',
      '        <fullName>Account__c</fullName>',
      '        <referenceTo>Account</referenceTo>',
      '        <type>Lookup</type>',
      '    </fields>',
      '    <fields><fullName>Amount__c</fullName><type>Currency</type></fields>',
      '    <fields><type>Text</type></fields>',
      '    <validationRules>',
      '        <fullName>Amount_Positive</fullName>',
      '        <active>false</active>',
      '        <errorDisplayField>Amount__c</errorDisplayField>',
      '    </validationRules>',
      '</CustomObject>',
      '',
    ];
    const file = source.file('objects/Parcel__c.object', lines.join('\n'));
    source.listed.push({ type: 'CustomObject', fullName: 'Parcel__c', files: [file] });
    const analysis = source.analyse();

    expect(analysis.components.map((one) => `${one.key} ${one.name} ${String(one.definition?.path)}`)).toEqual([
      `CustomField:parcel__c.account__c Parcel__c.Account__c ${file}`,
      `CustomField:parcel__c.amount__c Parcel__c.Amount__c ${file}`,
      `CustomObject:parcel__c Parcel__c ${file}`,
      `ValidationRule:parcel__c.amount_positive Parcel__c.Amount_Positive ${file}`,
    ]);
    expect(analysis.components.map((one) => one.attrs)).toEqual([
      { type: 'Lookup', referenceTo: ['Account'] },
      { type: 'Currency' },
      { customSettingsType: 'List' },
      { active: false },
    ]);
    expect(told(analysis)).toEqual([
      '6:22 references CustomObject:account [Account] external lookup',
      '14:28 references CustomField:parcel__c.amount__c [Amount__c] resolved display-field',
    ]);
    // Each part has the hash of its own text, and the object that of the file.
    const hashes = analysis.components.map((one) => hex(one.definition?.contentHash));
    expect(hashes).toEqual([
      sha(lines.slice(3, 8).join('\n').trim()),
      sha((lines[8] ?? '').trim()),
      sha(lines.join('\n')),
      sha(lines.slice(10, 15).join('\n').trim()),
    ]);
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 4, failedFiles: 0 }]);

    // The element without a name is not dropped in silence.
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'METADATA_UNEXPECTED',
        message: `${file}, line 10: an element "fields" has no name.`,
        componentKey: null,
        details: { path: file, line: 10, column: 5 },
      },
    ]);
  });
});

describe('a component that is an element of the file of its parent', () => {
  const labels = (...names: string[]): string =>
    xml('CustomLabels', ...names.map((name) => `<labels><fullName>${name}</fullName><value>v</value></labels>`));
  const build = (content: string | Uint8Array): { source: Source; file: string } => {
    const source = new Source();
    const file = source.file('labels/CustomLabels.labels-meta.xml', content);
    const within = { file, element: 'labels', nameElement: 'fullName' };
    source.listed.push({ type: 'CustomLabels', fullName: 'CustomLabels', files: [file] });
    source.listed.push({ type: 'CustomLabel', fullName: 'Greeting', files: [], within });
    source.listed.push({ type: 'CustomLabel', fullName: 'Farewell', files: [], within });
    return { source, file };
  };

  it('is defined by its element', () => {
    const { source, file } = build(labels('Greeting', 'Farewell'));
    const analysis = source.analyse();
    const part = (name: string): string => sha(`<labels><fullName>${name}</fullName><value>v</value></labels>`);
    expect(
      analysis.components.map(
        (one) => `${one.key} ${String(one.definition?.path)} ${hex(one.definition?.contentHash)}`,
      ),
    ).toEqual([
      `CustomLabel:farewell ${file} ${part('Farewell')}`,
      `CustomLabel:greeting ${file} ${part('Greeting')}`,
      `CustomLabels:customlabels ${file} ${sha(labels('Greeting', 'Farewell'))}`,
    ]);
    expect(analysis.issues).toEqual([]);
    // No file of an analysed type was read.
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 0, failedFiles: 0 }]);
  });

  it('is defined by the whole file when its element is not found, and an issue says so', () => {
    const content = labels('Greeting');
    const { source, file } = build(content);
    const analysis = source.analyse();
    expect(hex(componentOf(analysis, 'CustomLabel', 'Farewell').definition?.contentHash)).toBe(sha(content));
    expect(analysis.issues).toEqual([
      {
        severity: 'warning',
        code: 'ELEMENT_NOT_FOUND',
        message: `${file} holds no element "labels" for the CustomLabel "Farewell".`,
        componentKey: 'CustomLabel:farewell',
        details: { path: file, element: 'labels' },
      },
    ]);
  });

  it('is defined by the whole file when the file is no XML, which is reported once', () => {
    const content = '<CustomLabels><labels>';
    const { source, file } = build(content);
    const analysis = source.analyse();
    expect(analysis.components.map((one) => hex(one.definition?.contentHash))).toEqual([
      sha(content),
      sha(content),
      sha(content),
    ]);
    expect(codes(analysis.issues)).toEqual(['error XML_MALFORMED']);
    expect(analysis.issues[0]?.details).toMatchObject({ path: file });
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 0, failedFiles: 1 }]);
  });

  it('finds a part whose full name starts with the name of its parent', () => {
    const source = new Source();
    const content = xml('Workflow', '<rules><fullName>Late Fee</fullName></rules>');
    const file = source.file('workflows/Invoice__c.workflow-meta.xml', content);
    source.listed.push({ type: 'Workflow', fullName: 'Invoice__c', files: [file] });
    source.listed.push({
      type: 'WorkflowRule',
      fullName: 'Invoice__c.Late Fee',
      files: [],
      within: { file, element: 'rules', nameElement: 'fullName' },
    });
    const analysis = source.analyse();
    expect(hex(componentOf(analysis, 'WorkflowRule', 'Invoice__c.Late Fee').definition?.contentHash)).toBe(
      sha('<rules><fullName>Late Fee</fullName></rules>'),
    );
    expect(analysis.issues).toEqual([]);
  });
});

describe('an object the source holds only parts of', () => {
  it('gets a component that is not defined, with the name its parts spell', () => {
    const source = new Source();
    source.field('Account', 'Tier__c', '<type>Picklist</type>');
    source.rule('npsp__Batch__c', 'Sized', '<active>true</active>');
    const record = source.file('customMetadata/Billing_Rule.Default.md-meta.xml', xml('CustomMetadata'));
    source.listed.push({ type: 'CustomMetadata', fullName: 'Billing_Rule.Default', files: [record] });
    const view = source.file('objects/Case/listViews/Mine.listView-meta.xml', xml('ListView'));
    source.listed.push({ type: 'ListView', fullName: 'Case.Mine', files: [view] });
    const analysis = source.analyse();

    expect(analysis.components.filter((one) => one.definition === null)).toEqual([
      { key: 'CustomObject:account', name: 'Account', definition: null, attrs: null, references: [] },
      {
        key: 'CustomObject:billing_rule__mdt',
        name: 'Billing_Rule__mdt',
        definition: null,
        attrs: null,
        references: [],
      },
      { key: 'CustomObject:case', name: 'Case', definition: null, attrs: null, references: [] },
      { key: 'CustomObject:npsp__batch__c', name: 'npsp__Batch__c', definition: null, attrs: null, references: [] },
    ]);
    expect(analysis.components).toHaveLength(8);
    expect(analysis.issues).toEqual([]);
  });

  it('is not defined either when the list names a component and gives no file for it', () => {
    const source = new Source();
    source.listed.push({ type: 'CustomObject', fullName: 'Ghost__c', files: [] });
    source.field('Invoice__c', 'Ghost__c', '<referenceTo>Ghost__c</referenceTo>', '<type>Lookup</type>');
    const analysis = source.analyse();
    expect(componentOf(analysis, 'CustomObject', 'Ghost__c')).toEqual({
      key: 'CustomObject:ghost__c',
      name: 'Ghost__c',
      definition: null,
      attrs: null,
      references: [],
    });
    // The snapshot has a component for the object and no file of it.
    expect(told(analysis)).toEqual(['4:18 references CustomObject:ghost__c [Ghost__c] external lookup']);
  });

  it('is external for what refers to it, and its fields are resolved', () => {
    const source = new Source();
    source.field('Account', 'Tier__c', '<type>Picklist</type>');
    source.field('Account', 'Parent_Account__c', '<referenceTo>Account</referenceTo>', '<type>Lookup</type>');
    source.rule('Account', 'Tiered', '<errorDisplayField>Tier__c</errorDisplayField>');
    expect(told(source.analyse())).toEqual([
      '4:18 references CustomObject:account [Account] external lookup',
      '4:24 references CustomField:account.tier__c [Tier__c] resolved display-field',
    ]);
  });
});

describe('what goes wrong in one component', () => {
  const build = (): Source => {
    const source = new Source();
    source.object('Invoice__c');
    source.field('Invoice__c', 'Amount__c', '<type>Currency</type>');
    return source;
  };
  const amount = { key: 'CustomField:invoice__c.amount__c', attrs: { type: 'Currency' } };

  it('costs a file that is no XML its analysis, and nothing else', () => {
    const source = build();
    const content = `${HEAD}\n<CustomField xmlns="${XMLNS}">\n    <fullName>Broken__c</fullName>\n    <type>Text</typ>\n`;
    const file = source.fieldFile('Invoice__c', 'Broken__c', content);
    const analysis = source.analyse();

    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Broken__c')).toEqual({
      key: 'CustomField:invoice__c.broken__c',
      name: 'Invoice__c.Broken__c',
      definition: { path: file, contentHash: Buffer.from(sha(content), 'hex') },
      attrs: null,
      references: [],
    });
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Amount__c')).toMatchObject(amount);
    expect(analysis.issues).toHaveLength(1);
    expect(analysis.issues[0]).toMatchObject({
      severity: 'error',
      code: 'XML_MALFORMED',
      componentKey: null,
      // Where the end tag starts that closes no element.
      details: { path: file, line: 4, column: 15 },
    });
    expect(analysis.issues[0]?.message.startsWith(`${file}: `)).toBe(true);
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 1 }]);
  });

  it('reports bytes that are no text without a place', () => {
    const source = build();
    const file = source.fieldFile('Invoice__c', 'Bytes__c', new Uint8Array([0x3c, 0xff, 0xfe, 0x3e]));
    const analysis = source.analyse();
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'XML_NOT_UTF8',
        message: `${file}: The bytes of the file are not text in UTF-8.`,
        componentKey: null,
        details: { path: file, line: null, column: null },
      },
    ]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Bytes__c').attrs).toBeNull();
  });

  it('does not read a file whose root element is of another type', () => {
    const source = build();
    const file = source.fieldFile('Invoice__c', 'Rule__c', xml('ValidationRule', '<active>true</active>'));
    const analysis = source.analyse();
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'METADATA_UNEXPECTED',
        message: `${file} is the file of a CustomField, and its root element is "ValidationRule".`,
        componentKey: 'CustomField:invoice__c.rule__c',
        // The root element stands on the second line, after the declaration.
        details: { path: file, line: 2, column: 1 },
      },
    ]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Rule__c')).toMatchObject({ attrs: null, references: [] });
    // The file was read as XML: it did not fail.
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 0 }]);
  });

  it('keeps a component whose file cannot be read, and says so once', () => {
    const source = build();
    const code = source.file('classes/Service.cls', 'class Service {}');
    const meta = source.file('classes/Service.cls-meta.xml', xml('ApexClass'));
    source.listed.push({ type: 'ApexClass', fullName: 'Service', files: [code, meta] });
    const lost = source.field('Invoice__c', 'Lost__c', '<type>Text</type>');
    source.broken.add(code);
    source.broken.add(lost);
    const analysis = source.analyse();

    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'FILE_UNREADABLE',
        message: `${code} could not be read.`,
        componentKey: null,
        details: { path: code },
      },
      {
        severity: 'error',
        code: 'FILE_UNREADABLE',
        message: `${lost} could not be read.`,
        componentKey: null,
        details: { path: lost },
      },
    ]);
    const service = componentOf(analysis, 'ApexClass', 'Service').definition;
    expect(service?.path).toBe(meta);
    expect(hex(service?.contentHash)).toBe(sha(`- ${code}\n${sha(xml('ApexClass'))} ${meta}\n`));
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Lost__c')).toMatchObject({
      definition: { path: lost },
      attrs: null,
    });
    expect(hex(componentOf(analysis, 'CustomField', 'Invoice__c.Lost__c').definition?.contentHash)).toBe(
      sha(`- ${lost}\n`),
    );
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Amount__c')).toMatchObject(amount);
  });

  it('reports two names that fold to one key, keeps the first and merges nothing', () => {
    const source = build();
    const second = source.fieldFile(
      'Invoice__c',
      'AMOUNT__c',
      xml('CustomField', '<fullName>AMOUNT__c</fullName>', '<type>Text</type>'),
    );
    const analysis = source.analyse();
    expect(analysis.components.filter((one) => one.key === amount.key)).toMatchObject([
      { name: 'Invoice__c.Amount__c', attrs: { type: 'Currency' } },
    ]);
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'KEY_COLLISION',
        message: `"Invoice__c.AMOUNT__c" (${second}) and "Invoice__c.Amount__c" (objects/Invoice__c/fields/Amount__c.field-meta.xml) have the same key ${amount.key}. The first one is kept.`,
        componentKey: amount.key,
        details: { kept: 'Invoice__c.Amount__c', dropped: 'Invoice__c.AMOUNT__c' },
      },
    ]);
  });

  it('reports a name that cannot be a key, and gives it no component', () => {
    const source = build();
    const file = source.file('objects/Invoice__c/fields/Odd.field-meta.xml', xml('CustomField'));
    source.listed.push({ type: 'CustomField', fullName: 'Invoice__c.Od\u0001d__c', files: [file] });
    const analysis = source.analyse();
    expect(analysis.components.map((one) => one.key)).toEqual([
      'CustomField:invoice__c.amount__c',
      'CustomObject:invoice__c',
    ]);
    expect(analysis.issues).toMatchObject([
      { severity: 'error', code: 'KEY_INVALID', componentKey: null, details: { type: 'CustomField', path: file } },
    ]);
  });

  it('survives a fault of its own: the component keeps its row, and the others their analysis', () => {
    const source = build();
    const faulty: ResolvedComponent = {
      type: 'CustomField',
      fullName: 'Invoice__c.Faulty__c',
      get files(): readonly string[] {
        throw new Error('A fault that no source causes.');
      },
    };
    const analysis = analyseSource(source.tree, [faulty, ...source.listed]);
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'ANALYSIS_FAILED',
        message: 'The analysis of a CustomField failed: A fault that no source causes.',
        componentKey: 'CustomField:invoice__c.faulty__c',
        details: { type: 'CustomField' },
      },
    ]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Faulty__c')).toEqual({
      key: 'CustomField:invoice__c.faulty__c',
      name: 'Invoice__c.Faulty__c',
      definition: null,
      attrs: null,
      references: [],
    });
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Amount__c')).toMatchObject(amount);
  });
});
