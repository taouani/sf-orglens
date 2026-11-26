/**
 * The analysis of a source: a component for everything it holds, and the references of objects, fields and
 * validation rules, those that are written in XML and those that stand in a formula.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second part runs on
 * small sources that are written here, for what the fixture project does not have. The flows and the workflow
 * rules of the project and what they say have files of their own, `extraction-flows.test.ts` and
 * `extraction-workflows.test.ts`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registry } from '@salesforce/source-deploy-retrieve';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parentKey } from '../src/core/keys.ts';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, OBJECT_PARTS, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents, type ResolvedComponent } from '../src/sources/resolve.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { writeAnalysis } from '../src/store/analysis.ts';
import { sqlGraph } from '../src/store/graph.ts';
import { openStore } from '../src/store/open.ts';
import { ensureSource, insertSnapshot } from '../src/store/snapshots.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';
import { codes, HEAD, key, Source, told, valueOf, viaOf, xml, XMLNS } from './helpers/written-source.ts';

/** The work of the reader of formulas on a source that holds no formula it could look at. */
const NO_FORMULA = { origin: 'parser:formula', components: 0, failedFiles: 0 };
/** The work of the reader of flows on a source without a flow. */
const NO_FLOW = { origin: 'parser:flow', components: 0, failedFiles: 0 };

const hex = (bytes: Uint8Array | undefined): string => Buffer.from(bytes ?? []).toString('hex');
const sha = (content: Uint8Array | string): string => createHash('sha256').update(content).digest('hex');

/** How the answer key names the references that are written in XML. Everything else in a field or a rule is a formula. */
const XML_VIAS = ['lookup', 'filter', 'summary', 'display-field', 'controlling-field', 'value-set'];

/** A reference as the answer key identifies one, and how the source names its target. */
const idOf = (reference: Reference): string =>
  `${String(reference.location?.file)}:${String(reference.location?.line)}:${String(reference.location?.column)}:${reference.kind}:${String(reference.to)} ${viaOf(reference)}`;

const componentOf = (analysis: SourceAnalysis, type: string, fullName: string): AnalysedComponent => {
  const found = analysis.components.find((one) => one.key === key(type, fullName));
  if (found === undefined) throw new Error(`The analysis has no ${type} ${fullName}.`);
  return found;
};

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
    // What the objects, fields and rules say. What the flows, the workflow rules, the record types, the field sets,
    // the records of custom metadata, the email templates, the report types and the quick actions say is measured
    // in their files.
    references = analysis.components
      .filter(
        (one) =>
          !/^(?:Flow|Workflow[A-Za-z]*|RecordType|FieldSet|CustomMetadata|EmailTemplate|ReportType|QuickAction):/.test(
            one.key,
          ),
      )
      .flatMap((one) => one.references);
  });

  it('has a component for everything the key lists, and for the two standard objects it holds fields of', () => {
    const account = key('CustomObject', 'Account');
    const user = key('CustomObject', 'User');
    // An element of a flow is a component too, which the key does not list as one.
    const elements = analysis.components.filter((one) => one.key.includes('#element:'));
    expect(analysis.components.filter((one) => !elements.includes(one)).map((one) => one.key)).toEqual(
      [...answers.components.map((one) => one.key), account, user].sort(),
    );
    expect(elements).toHaveLength(57);
    expect(elements.every((one) => one.key.startsWith('Flow:'))).toBe(true);
    expect(analysis.components).toHaveLength(206);
    // Only those two are not defined: the project holds fields of them and no file of the object.
    expect(analysis.components.filter((one) => one.definition === null)).toEqual([
      { key: account, name: 'Account', definition: null, attrs: null, references: [] },
      { key: user, name: 'User', definition: null, attrs: null, references: [] },
    ]);
    for (const { type, fullName } of answers.components) {
      expect(componentOf(analysis, type, fullName).name).toBe(fullName);
    }
  });

  it('finds every reference of the key for a field or a rule, where the key says, and no other', () => {
    // Phase 1 of the key is what fields and validation rules say. Everything else in it is of a later phase.
    const keyed = answers.references.filter((one) => one.phase === 1);
    expect(keyed.filter((one) => XML_VIAS.includes(one.via))).toHaveLength(30);
    expect(keyed.filter((one) => one.via === 'formula')).toHaveLength(82);
    expect(keyed).toHaveLength(112);
    // The key calls four of them a stretch: a miss would not count. All four are found, so the lists are equal.
    expect(keyed.filter((one) => one.stretch)).toHaveLength(4);
    expect(references.map(idOf).sort()).toEqual(keyed.map((one) => `${one.id} ${one.via}`).sort());
  });

  it('gives each reference the component its file defines, the tier of the key and the origin of its reader', () => {
    const starts = new Map(answers.references.map((one) => [`${one.id} ${one.via}`, one]));
    for (const reference of references) {
      const keyed = starts.get(idOf(reference));
      expect(reference.from, idOf(reference)).toBe(keyed?.from);
      expect(reference.toNameRaw, idOf(reference)).toBe(keyed?.match);
      expect(reference.confidence, idOf(reference)).toBe(keyed?.tier);
      expect(reference.confidence, idOf(reference)).toBe('confirmed');
      expect(reference.origin, idOf(reference)).toBe(keyed?.via === 'formula' ? 'parser:formula' : 'parser:xml');
    }
  });

  it('calls a target resolved when the project defines it, and external when Salesforce provides it', () => {
    for (const reference of references) {
      const standard = reference.to !== null && answers.standard.includes(reference.to);
      expect(reference.resolution, idOf(reference)).toBe(standard ? 'external' : 'resolved');
    }
    // What Salesforce provides and a field or a rule of the project names. The key lists more, for Apex and for
    // what Phase 2 reads.
    const external = new Set(references.filter((one) => one.resolution === 'external').map((one) => one.to));
    expect([...external].sort()).toEqual([
      'CustomField:account.industry',
      'CustomField:account.name',
      'CustomField:account.ownerid',
      'CustomField:account.parentid',
      'CustomField:contact.accountid',
      'CustomField:group.name',
      'CustomField:invoice__c.name',
      'CustomField:invoice__c.ownerid',
      'CustomField:organization.country',
      'CustomField:profile.name',
      'CustomField:recordtype.developername',
      'CustomField:tax_code__c.name',
      'CustomField:user.department',
      'CustomField:user.email',
      'CustomField:user.managerid',
      'CustomField:user.username',
      'CustomField:userrole.name',
      'CustomObject:account',
      'CustomObject:contact',
      'CustomObject:entitydefinition',
      'CustomObject:fielddefinition',
      'CustomObject:user',
    ]);
  });

  it('refers to a label, a permission and a record of a custom metadata type by their keys', () => {
    const others = references.filter((one) => one.origin === 'parser:formula' && one.toType !== 'CustomField');
    expect(others.map((one) => `${one.kind} ${String(one.to)} [${one.toNameRaw}] ${one.resolution}`).sort()).toEqual([
      'references CustomLabel:overdue_notice [Overdue_Notice] resolved',
      'references CustomMetadata:billing_rule.default [Default] resolved',
      'references CustomPermission:approve_large_invoices [Approve_Large_Invoices] resolved',
    ]);
  });

  it('keeps the value a formula compares a picklist with', () => {
    const compared = references.filter((one) => valueOf(one) !== null);
    expect(compared.map((one) => `${String(one.to)} ${String(valueOf(one))}`).sort()).toEqual([
      'CustomField:account.tier__c Gold',
      'CustomField:invoice__c.channels__c Email',
      'CustomField:invoice__c.status__c Paid',
      'CustomField:invoice__c.status__c Paid',
      'CustomField:invoice__c.status__c Paid',
      'CustomField:invoice__c.status__c Paid',
      'CustomField:invoice__c.status__c Void',
      'CustomField:invoice__c.status__c Void',
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

  it('raises no issue outside the flows, and counts the components and the flows it looked at', () => {
    // The one issue is the path of a flow that the key calls unknown.
    expect(analysis.issues.map((issue) => `${issue.code} ${String(issue.componentKey)}`)).toEqual([
      'PATH_NOT_FOLLOWED Flow:invoice_after_save#element:check_result',
    ]);
    // 6 objects, 58 fields and 11 rules, 2 files of workflow rules with 4 rules and 6 actions, 2 record types, a
    // field set, 5 records of custom metadata, an email template, a report type and a quick action. The two objects
    // without a file were not looked at. 35 of the fields and rules hold a formula or a default value, and so do 7
    // elements of flows, 2 workflow rules, 2 field updates and the quick action. The 7 flows have 57 elements.
    expect(analysis.work).toEqual([
      { origin: 'parser:xml', components: 98, failedFiles: 0 },
      { origin: 'parser:formula', components: 47, failedFiles: 0 },
      { origin: 'parser:flow', components: 64, failedFiles: 0 },
    ]);
    const withFormula = analysis.components.filter((one) =>
      one.references.some((reference) => reference.origin === 'parser:formula'),
    );
    expect(withFormula.filter((one) => one.key.startsWith('Flow:')).map((one) => one.key)).toEqual([
      'Flow:invoice_before_save#element:default_tax_rate',
      // The formula that says which records start the flow.
      'Flow:invoice_before_save#element:flow-start',
      'Flow:invoice_recalculate#element:is_late',
      'Flow:invoice_recalculate#element:line_value',
      'Flow:invoice_review_screen#element:fee',
      // The formula that checks what was typed into a field of the screen.
      'Flow:invoice_review_screen#element:review',
      'Flow:invoice_sent_process#element:formula_myrule_1',
    ]);
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
    const others = analysis.components.filter(
      (one) =>
        !/^(?:CustomObject|CustomField|Flow|ValidationRule|Workflow[A-Za-z]*|RecordType|FieldSet|CustomMetadata|EmailTemplate|ReportType|QuickAction):/.test(
          one.key,
        ),
    );
    expect(others).toHaveLength(42);
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
        types: analysis.types,
        components: analysis.components,
        work: analysis.work,
        issues: analysis.issues,
      });
      // 112 references of fields and rules, 129 of flows, 33 of workflow rules, 33 of record types, a field set
      // and records of custom metadata, and 27 of an email template, a report type and a quick action.
      expect(written).toMatchObject({ components: 206, references: 334 });

      const graph = sqlGraph(store, snapshot);
      const status = graph.find(key('CustomField', 'Invoice__c.Status__c'));
      expect(
        graph
          .referencesTo(status?.id ?? 0)
          .map((one) => `${one.from} ${one.kind} ${viaOf(one)} ${one.origin}`)
          .sort(),
      ).toEqual([
        'CustomField:invoice__c.approver__c reads filter parser:xml',
        'CustomField:invoice__c.days_overdue__c reads formula parser:formula',
        'CustomField:invoice__c.status_rank__c reads formula parser:formula',
        'CustomField:invoice__c.sub_status__c references controlling-field parser:xml',
        // The email template, in its body.
        'EmailTemplate:billing/invoice_overdue reads merge-field parser:xml',
        // Four elements of flows: two starts that filter by the field, and two formulas.
        'Flow:invoice_after_save#element:flow-start reads filter parser:flow',
        'Flow:invoice_before_save#element:flow-start reads formula parser:formula',
        'Flow:invoice_purge_void#element:flow-start reads filter parser:flow',
        'Flow:invoice_sent_process#element:formula_myrule_1 reads formula parser:formula',
        // The two record types, which limit the values of the field.
        'RecordType:invoice__c.credit_note references listed-field parser:xml',
        'RecordType:invoice__c.standard_invoice references listed-field parser:xml',
        'ValidationRule:invoice__c.locked_when_paid reads formula parser:formula',
        // The rule names the field three times in its formula, and once as the field of its message.
        'ValidationRule:invoice__c.paid_cannot_be_reopened reads formula parser:formula',
        'ValidationRule:invoice__c.paid_cannot_be_reopened reads formula parser:formula',
        'ValidationRule:invoice__c.paid_cannot_be_reopened reads formula parser:formula',
        'ValidationRule:invoice__c.paid_cannot_be_reopened references display-field parser:xml',
        'ValidationRule:invoice__c.paid_requires_paid_date reads formula parser:formula',
        'ValidationRule:invoice__c.void_needs_admin reads formula parser:formula',
        // The formula of a field update, the fields an outbound message sends, and three workflow rules.
        'WorkflowFieldUpdate:invoice__c.stamp_legacy_code reads formula parser:formula',
        'WorkflowOutboundMessage:invoice__c.notify_ledger reads listed-field parser:xml',
        'WorkflowRule:invoice__c.follow_up_when_void reads filter parser:xml',
        'WorkflowRule:invoice__c.remind_when_sent reads filter parser:xml',
        'WorkflowRule:invoice__c.stamp_code_when_paid reads formula parser:formula',
      ]);
      // The standard object the project holds fields of is a component of the snapshot, without a file.
      expect(graph.find(key('CustomObject', 'Account'))?.version).toEqual({ name: 'Account', path: null, attrs: null });
      store.close();
    });
  });
});

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
    // A field that has no key says which object it was looked for on. An object and a value set have no such object.
    expect(unresolved.map((one) => one.attrs)).toEqual([
      { via: 'lookup' },
      { via: 'controlling-field', object: 'Invoice__c' },
      { via: 'value-set' },
      { via: 'summary', object: 'Ghost__c' },
      { via: 'summary', object: 'Ghost__c' },
    ]);
    // A name that is not found is a reference, not an issue.
    expect(analysis.issues).toEqual([]);
  });

  it('finds a custom field of an activity from a task, and a field of a person account at the contact', () => {
    const source = new Source();
    source.field('Activity', 'Stage__c', '<type>Text</type>');
    source.field('Contact', 'Level__c', '<type>Text</type>');
    source.rule('Task', 'Staged', '<errorDisplayField>Stage__c</errorDisplayField>');
    source.rule('Event', 'Staged', '<errorDisplayField>Stage__c</errorDisplayField>');
    source.rule('Account', 'Levelled', '<errorDisplayField>Level__pc</errorDisplayField>');
    source.rule('Account', 'Lost', '<errorDisplayField>Lost__pc</errorDisplayField>');
    const analysis = source.analyse();
    expect(told(analysis)).toEqual([
      '4:24 references CustomField:contact.level__c [Level__pc] resolved display-field',
      '4:24 references null [Lost__pc] unresolved display-field',
      '4:24 references CustomField:activity.stage__c [Stage__c] resolved display-field',
      '4:24 references CustomField:activity.stage__c [Stage__c] resolved display-field',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('follows a standard relationship to an object that only a lookup names', () => {
    const source = new Source();
    source.field('Opportunity', 'Region__c', '<referenceTo>Territory2</referenceTo>', '<type>Lookup</type>');
    source.field(
      'Opportunity',
      'Depot__c',
      '<lookupFilter><filterItems><field>$Source.Territory2.Name</field></filterItems></lookupFilter>',
    );
    const analysis = source.analyse();
    expect(told(analysis, key('CustomField', 'Opportunity.Depot__c'))).toEqual([
      // `$Source` starts at column 39, after four spaces and three start tags of 14, 13 and 7 characters.
      '4:47 reads CustomField:opportunity.territory2id [Territory2] external filter',
      '4:58 reads CustomField:territory2.name [Name] external filter',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('reads the field that says which object a relationship to a field definition is about', () => {
    const source = new Source();
    source.object('Rule__mdt');
    source.field('Rule__mdt', 'Object__c', '<referenceTo>EntityDefinition</referenceTo>');
    source.field(
      'Rule__mdt',
      'Field__c',
      '<metadataRelationshipControllingField',
      '>Rule__mdt.Object__c</metadataRelationshipControllingField>',
      '<referenceTo>FieldDefinition</referenceTo>',
    );
    expect(told(source.analyse(), key('CustomField', 'Rule__mdt.Field__c'))).toEqual([
      // The targets of a lookup are read first. The path stands on the line after its start tag.
      '6:18 references CustomObject:fielddefinition [FieldDefinition] external lookup',
      '5:16 references CustomField:rule__mdt.object__c [Object__c] resolved controlling-field',
    ]);
  });
});

describe('the overrides of the actions of an object', () => {
  /** An override in the file of an object: six lines, or five without a form factor, and one less without a value. */
  const override = (action: string, type: string | null, content: string | null, formFactor?: string): string[] => [
    '<actionOverrides>',
    `    <actionName>${action}</actionName>`,
    ...(content === null ? [] : [`    <content>${content}</content>`]),
    ...(formFactor === undefined ? [] : [`    <formFactor>${formFactor}</formFactor>`]),
    ...(type === null ? [] : [`    <type>${type}</type>`]),
    '</actionOverrides>',
  ];
  /** A component of a type that is not analysed. Its file is not read, so it can be empty. */
  const defined = (source: Source, type: string, fullName: string, path: string): void => {
    source.listed.push({ type, fullName, files: [source.file(path, '')] });
  };
  const issuesOf = (analysis: SourceAnalysis): string[] =>
    analysis.issues.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)} ${issue.message}`);

  it('refer to the page or the component each override names, of the type the override says', () => {
    const source = new Source();
    source.object(
      'Invoice__c',
      '<label>Invoice</label>',
      ...override('View', 'Flexipage', 'Invoice_Record_Page', 'Large'),
      ...override('View', 'Flexipage', 'Invoice_Record_Page', 'Small'),
      ...override('Edit', 'Visualforce', 'Invoice_Edit'),
      ...override('New', 'LightningComponent', 'createInvoice', 'Large'),
      ...override('Clone', 'lightningcomponent', 'cloneInvoice', 'Large'),
      ...override('Delete', 'Scontrol', 'Old_Delete'),
      ...override('Tab', 'LightningComponent', 'npsp__Tab_Home', 'Large'),
      ...override('Accept', 'Default', null),
      ...override('List', 'Standard', null),
      ...override('Follow', 'default', 'Not_Named'),
      ...override('SaveEdit', 'LightningComponent', 'saveInvoice', 'Large'),
      ...override('CancelEdit', 'LightningComponent', 'cancelInvoice', 'Large'),
    );
    defined(source, 'FlexiPage', 'Invoice_Record_Page', 'flexipages/Invoice_Record_Page.flexipage-meta.xml');
    defined(source, 'ApexPage', 'Invoice_Edit', 'pages/Invoice_Edit.page-meta.xml');
    defined(source, 'AuraDefinitionBundle', 'createInvoice', 'aura/createInvoice/createInvoice.cmp-meta.xml');
    defined(source, 'LightningComponentBundle', 'cloneInvoice', 'lwc/cloneInvoice/cloneInvoice.js-meta.xml');
    defined(source, 'AuraDefinitionBundle', 'saveInvoice', 'aura/saveInvoice/saveInvoice.cmp-meta.xml');
    defined(source, 'LightningComponentBundle', 'saveInvoice', 'lwc/saveInvoice/saveInvoice.js-meta.xml');
    const analysis = source.analyse();

    // A Lightning component is an Aura component, or a Lightning web component where only that is defined. Where
    // both are defined, it is the Aura component. One that nothing defines is taken for an Aura component too: of
    // a package, it is external, and else it is not found.
    expect(told(analysis)).toEqual([
      '6:18 references FlexiPage:invoice_record_page [Invoice_Record_Page] resolved action-override',
      '12:18 references FlexiPage:invoice_record_page [Invoice_Record_Page] resolved action-override',
      '18:18 references ApexPage:invoice_edit [Invoice_Edit] resolved action-override',
      '23:18 references AuraDefinitionBundle:createinvoice [createInvoice] resolved action-override',
      '29:18 references LightningComponentBundle:cloneinvoice [cloneInvoice] resolved action-override',
      '35:18 references null [Old_Delete] unresolved action-override',
      '40:18 references AuraDefinitionBundle:npsp__tab_home [npsp__Tab_Home] external action-override',
      '59:18 references AuraDefinitionBundle:saveinvoice [saveInvoice] resolved action-override',
      '65:18 references null [cancelInvoice] unresolved action-override',
    ]);
    const invoice = componentOf(analysis, 'CustomObject', 'Invoice__c');
    expect(invoice.references.map((one) => `${one.toType} ${one.origin} ${one.confidence}`)).toEqual([
      'FlexiPage parser:xml confirmed',
      'FlexiPage parser:xml confirmed',
      'ApexPage parser:xml confirmed',
      'AuraDefinitionBundle parser:xml confirmed',
      'LightningComponentBundle parser:xml confirmed',
      'Scontrol parser:xml confirmed',
      'AuraDefinitionBundle parser:xml confirmed',
      'AuraDefinitionBundle parser:xml confirmed',
      'AuraDefinitionBundle parser:xml confirmed',
    ]);
    // The pages and components are not read: what they refer to is not known.
    expect(analysis.components.filter((one) => one.key !== invoice.key).map((one) => one.references)).toEqual([
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    expect(analysis.issues).toEqual([]);
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 1, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);
  });

  it('say that an override of a type they do not know is not read, and so is one without a type', () => {
    const source = new Source();
    const file = source.object(
      'Invoice__c',
      ...override('View', 'Experience', 'Invoice_Page'),
      ...override('Edit', null, 'Invoice_Edit'),
      ...override('New', 'LightningComponent', 'c:createInvoice', 'Large'),
      // An override that names nothing gives nothing, and no warning: with a type that is known, or with none.
      ...override('Clone', null, null),
      ...override('Delete', 'Flexipage', null, 'Large'),
      '<customSettingsType>List</customSettingsType>',
    );
    const analysis = source.analyse();
    expect(told(analysis)).toEqual([]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ CustomObject:invoice__c ${file}, line 6: the element "type" holds "Experience", which is no type of an override of an action that is known here. The override is not read.`,
      `warning NAME_NOT_READ CustomObject:invoice__c ${file}, line 10: the element "content" holds "Invoice_Edit", and the override has no type. The override is not read.`,
      `warning NAME_NOT_READ CustomObject:invoice__c ${file}, line 14: the element "content" holds "c:createInvoice", which is not read as a name.`,
    ]);
    expect(analysis.issues.map((issue) => issue.details)).toEqual([
      { path: file, line: 6, column: 15, element: 'type' },
      { path: file, line: 10, column: 18, element: 'content' },
      { path: file, line: 14, column: 18, element: 'content' },
    ]);
    // The rest of the object is read all the same.
    expect(componentOf(analysis, 'CustomObject', 'Invoice__c').attrs).toEqual({ customSettingsType: 'List' });
  });

  it('are read in the file of an object as an org hands it out, beside its fields', () => {
    const source = new Source();
    const lines = [
      HEAD,
      `<CustomObject xmlns="${XMLNS}">`,
      ...['Accept', 'CancelEdit', 'Clone', 'Delete', 'Edit', 'List', 'New', 'SaveEdit', 'Tab', 'View'].flatMap(
        (action) => override(action, 'Default', null).map((line) => `    ${line}`),
      ),
      ...override('View', 'Flexipage', 'Account_Record_Page', 'Large').map((line) => `    ${line}`),
      '    <fields><fullName>Tier__c</fullName><type>Text</type></fields>',
      '</CustomObject>',
      '',
    ];
    const file = source.file('objects/Account.object', lines.join('\n'));
    source.listed.push({ type: 'CustomObject', fullName: 'Account', files: [file] });
    defined(source, 'FlexiPage', 'Account_Record_Page', 'flexipages/Account_Record_Page.flexipage');
    const analysis = source.analyse();
    expect(told(analysis)).toEqual([
      '45:18 references FlexiPage:account_record_page [Account_Record_Page] resolved action-override',
    ]);
    expect(analysis.components.map((one) => one.key)).toEqual([
      'CustomField:account.tier__c',
      'CustomObject:account',
      'FlexiPage:account_record_page',
    ]);
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
        details: {
          path: file,
          line: 5,
          column: 37,
          relationship: 'Sponsor',
          notFollowed: ['Region', 'Name'],
          endsAt: 'field',
          origin: 'parser:xml',
        },
      },
      {
        severity: 'warning',
        code: 'PATH_NOT_FOLLOWED',
        message: `${file}, line 6: it is not known which object "Missing__r" leads to, so "Name" after it was not followed.`,
        componentKey: CONTACT,
        details: {
          path: file,
          line: 6,
          column: 37,
          relationship: 'Missing__r',
          notFollowed: ['Name'],
          endsAt: 'field',
          origin: 'parser:xml',
        },
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

describe('a value that is almost a name', () => {
  it('is not read when a path ends with a dot, and the rest of the field is', () => {
    const source = new Source();
    source.object('Invoice__c');
    source.field(
      'Invoice__c',
      'Contact__c',
      '<lookupFilter><filterItems><field>Contact.</field></filterItems></lookupFilter>',
      '<referenceTo>Contact</referenceTo>',
      '<summarizedField>Line__c.</summarizedField>',
      '<type>Lookup</type>',
    );
    const analysis = source.analyse();
    expect(told(analysis)).toEqual(['5:18 references CustomObject:contact [Contact] external lookup']);
    expect(analysis.issues.map((issue) => `${issue.code} ${issue.message}`)).toEqual([
      'NAME_NOT_READ objects/Invoice__c/fields/Contact__c.field-meta.xml, line 4: the element "field" holds "Contact.", which is not read as a name.',
      'NAME_NOT_READ objects/Invoice__c/fields/Contact__c.field-meta.xml, line 6: the element "summarizedField" holds "Line__c.", which is not read as a name.',
    ]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Contact__c').attrs).toEqual({
      type: 'Lookup',
      referenceTo: ['Contact'],
    });
  });

  it('is not read when a global variable stands where one name belongs', () => {
    const source = new Source();
    source.field('Invoice__c', 'Owner__c', '<referenceTo>$User</referenceTo>');
    source.rule('Invoice__c', 'Shown', '<errorDisplayField>$Name</errorDisplayField>');
    const analysis = source.analyse();
    expect(told(analysis)).toEqual([]);
    expect(codes(analysis.issues)).toEqual(['warning NAME_NOT_READ', 'warning NAME_NOT_READ']);
  });

  it('reads nothing from an element that says it has no value', () => {
    const source = new Source();
    const nil = 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"';
    source.field(
      'Invoice__c',
      'Empty__c',
      `<referenceTo ${nil}/>`,
      `<summarizedField ${nil}>Line__c.Amount__c</summarizedField>`,
    );
    source.rule('Invoice__c', 'Shown', `<errorDisplayField ${nil}/>`, `<active ${nil}>true</active>`);
    const analysis = source.analyse();
    expect(told(analysis)).toEqual([]);
    expect(analysis.issues).toEqual([]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Empty__c').attrs).toEqual({});
    expect(componentOf(analysis, 'ValidationRule', 'Invoice__c.Shown').attrs).toEqual({});
  });

  it('reads the variable for the own object in any case, and every object a lookup names', () => {
    const source = new Source();
    source.object('Invoice__c');
    source.field('Invoice__c', 'Amount__c', '<type>Currency</type>');
    source.field(
      'Invoice__c',
      'Who__c',
      '<lookupFilter><filterItems><valueField>$SOURCE.Amount__c</valueField></filterItems></lookupFilter>',
      '<referenceTo>Contact</referenceTo>',
      '<referenceTo>Lead</referenceTo>',
    );
    const analysis = source.analyse();
    expect(told(analysis)).toEqual([
      '5:18 references CustomObject:contact [Contact] external lookup',
      '6:18 references CustomObject:lead [Lead] external lookup',
      // `$SOURCE` starts at column 44, after four spaces and three start tags of 14, 13 and 12 characters.
      '4:52 reads CustomField:invoice__c.amount__c [Amount__c] resolved filter',
    ]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Who__c').attrs).toEqual({
      referenceTo: ['Contact', 'Lead'],
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
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 4, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);

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
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 0, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);
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
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 0, failedFiles: 1 }, NO_FORMULA, NO_FLOW]);
  });

  it('is defined by the first element of its name when the file holds two', () => {
    const first = '<labels><fullName>Greeting</fullName><value>first</value></labels>';
    const { source } = build(
      xml('CustomLabels', first, '<labels><fullName>Greeting</fullName><value>second</value></labels>'),
    );
    const analysis = source.analyse();
    expect(hex(componentOf(analysis, 'CustomLabel', 'Greeting').definition?.contentHash)).toBe(sha(first));
  });

  it('is defined by the path of a file that cannot be read, which is reported once', () => {
    const { source, file } = build(labels('Greeting', 'Farewell'));
    source.broken.add(file);
    const analysis = source.analyse();
    // The file is asked for three times: for the labels as a whole, and for each of the two.
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'FILE_UNREADABLE',
        message: `${file} could not be read.`,
        componentKey: null,
        details: { path: file },
      },
    ]);
    expect(
      analysis.components.map((one) => `${String(one.definition?.path)} ${hex(one.definition?.contentHash)}`),
    ).toEqual([`${file} ${sha(`- ${file}\n`)}`, `${file} ${sha(`- ${file}\n`)}`, `${file} ${sha(`- ${file}\n`)}`]);
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 0, failedFiles: 1 }, NO_FORMULA, NO_FLOW]);
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

  it('gets one for a part of any kind, and for a record that spells the suffix of its type', () => {
    const source = new Source();
    const type = source.file('objects/Lead/recordTypes/Web.recordType-meta.xml', xml('RecordType'));
    source.listed.push({ type: 'RecordType', fullName: 'Lead.Web', files: [type] });
    const layout = source.file('objects/Asset/compactLayouts/Short.compactLayout-meta.xml', xml('CompactLayout'));
    source.listed.push({ type: 'CompactLayout', fullName: 'Asset.Short', files: [layout] });
    const record = source.file('customMetadata/Other__mdt.Default.md-meta.xml', xml('CustomMetadata'));
    source.listed.push({ type: 'CustomMetadata', fullName: 'Other__mdt.Default', files: [record] });
    source.field('Invoice__c', 'Other__c', '<referenceTo>Other__mdt</referenceTo>');
    const analysis = source.analyse();
    expect(analysis.components.filter((one) => one.definition === null).map((one) => `${one.key} ${one.name}`)).toEqual(
      [
        'CustomObject:asset Asset',
        'CustomObject:invoice__c Invoice__c',
        'CustomObject:lead Lead',
        'CustomObject:other__mdt Other__mdt',
      ],
    );
    // The snapshot knows the type of the record, so a lookup to it has a key, and so has the record's own
    // reference to its type.
    expect(told(analysis)).toEqual([
      '4:18 references CustomObject:other__mdt [Other__mdt] external lookup',
      '2:2 references CustomObject:other__mdt [Other__mdt] external record-of',
    ]);
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
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 1 }, NO_FORMULA, NO_FLOW]);
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
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);
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
    // Both files count as files that could not be read, also the one of a type that is not analysed.
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 2 }, NO_FORMULA, NO_FLOW]);
  });

  it('reports two names that fold to one key, keeps the first by name and merges nothing', () => {
    const source = build();
    const second = source.fieldFile(
      'Invoice__c',
      'AMOUNT__c',
      xml('CustomField', '<fullName>AMOUNT__c</fullName>', '<type>Text</type>'),
    );
    const analysis = source.analyse();
    // `AMOUNT__c` comes before `Amount__c` in the order of code units, wherever it stands in the list.
    expect(analysis.components.filter((one) => one.key === amount.key)).toMatchObject([
      { name: 'Invoice__c.AMOUNT__c', definition: { path: second }, attrs: { type: 'Text' } },
    ]);
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'KEY_COLLISION',
        message: `"Invoice__c.Amount__c" (objects/Invoice__c/fields/Amount__c.field-meta.xml) and "Invoice__c.AMOUNT__c" (${second}) have the same key ${amount.key}. The first one is kept.`,
        componentKey: amount.key,
        details: { kept: 'Invoice__c.AMOUNT__c', dropped: 'Invoice__c.Amount__c' },
      },
    ]);
    expect(analyseSource(source.tree, [...source.listed].reverse())).toEqual(analysis);
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
    const file = source.file(
      'objects/Invoice__c/fields/Faulty__c.field-meta.xml',
      xml('CustomField', '<fullName>Faulty__c</fullName>'),
    );
    // A component that fails the first time it is asked where it stands, which no source does.
    let asked = 0;
    const faulty: ResolvedComponent = {
      type: 'CustomField',
      fullName: 'Invoice__c.Faulty__c',
      files: [file],
      get within(): never {
        asked += 1;
        if (asked === 1) throw new Error(`A fault that no source causes. ${'x'.repeat(300)}`);
        return undefined as never;
      },
    };
    const analysis = analyseSource(source.tree, [faulty, ...source.listed]);
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'ANALYSIS_FAILED',
        // The message of a fault is cut.
        message: `The analysis of a CustomField failed: A fault that no source causes. ${'x'.repeat(169)}`,
        componentKey: 'CustomField:invoice__c.faulty__c',
        details: { type: 'CustomField', path: file },
      },
    ]);
    // The file is there, so the component is defined, and nothing of it was analysed.
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Faulty__c')).toEqual({
      key: 'CustomField:invoice__c.faulty__c',
      name: 'Invoice__c.Faulty__c',
      definition: { path: file, contentHash: Buffer.from(sha(source.files.get(file) ?? ''), 'hex') },
      attrs: null,
      references: [],
    });
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Amount__c')).toMatchObject(amount);
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);
  });

  it('survives a path that a reference cannot hold: the component is defined and not analysed', () => {
    const source = build();
    // A backslash can be part of a file name on Linux and macOS, and the place of a reference refuses it.
    const file = source.file(
      'objects/Invoice__c/fields/Odd\\Name__c.field-meta.xml',
      xml('CustomField', '<fullName>Odd__c</fullName>', '<referenceTo>Account</referenceTo>', '<type>Lookup</type>'),
    );
    source.listed.push({ type: 'CustomField', fullName: 'Invoice__c.Odd__c', files: [file] });
    const analysis = source.analyse();
    expect(analysis.issues).toMatchObject([
      {
        severity: 'error',
        code: 'ANALYSIS_FAILED',
        componentKey: 'CustomField:invoice__c.odd__c',
        details: { type: 'CustomField', path: file },
      },
    ]);
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Odd__c')).toMatchObject({
      definition: { path: file },
      attrs: null,
      references: [],
    });
    expect(componentOf(analysis, 'CustomField', 'Invoice__c.Amount__c')).toMatchObject(amount);
    // The component that failed is not counted as looked at.
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);
  });

  it('cuts a text it shows between two characters, never inside one', () => {
    const source = build();
    const long = `${'x'.repeat(59)}\u{1F600} tail`;
    source.field('Invoice__c', 'Long__c', `<referenceTo>${long}</referenceTo>`);
    const [issue] = source.analyse().issues;
    expect(issue).toMatchObject({ severity: 'warning', code: 'NAME_NOT_READ' });
    expect(issue?.message.isWellFormed()).toBe(true);
    expect(issue?.message).toContain(`holds "${'x'.repeat(59)}", which`);
  });
});

describe('the parts of the file of an object', () => {
  /** One part of each kind, as an element of the file of the object and as a file of its own. */
  const PARTS: readonly { group: string; type: string; suffix: string; name: string }[] = [
    { group: 'businessProcesses', type: 'BusinessProcess', suffix: 'businessProcess', name: 'Retail' },
    { group: 'compactLayouts', type: 'CompactLayout', suffix: 'compactLayout', name: 'Short' },
    { group: 'fields', type: 'CustomField', suffix: 'field', name: 'Weight__c' },
    { group: 'fieldSets', type: 'FieldSet', suffix: 'fieldSet', name: 'Sizes' },
    { group: 'indexes', type: 'Index', suffix: 'index', name: 'ByWeight' },
    { group: 'listViews', type: 'ListView', suffix: 'listView', name: 'Heavy' },
    { group: 'recordTypes', type: 'RecordType', suffix: 'recordType', name: 'Big' },
    { group: 'sharingReasons', type: 'SharingReason', suffix: 'sharingReason', name: 'Carrier__c' },
    { group: 'validationRules', type: 'ValidationRule', suffix: 'validationRule', name: 'Weighed' },
    { group: 'webLinks', type: 'WebLink', suffix: 'webLink', name: 'Track' },
  ];

  it('knows the parts the Salesforce library knows, and each has the object as its parent', () => {
    const known = Object.values(registry.types['customobject']?.children?.types ?? {}).map(
      (type) => [type.directoryName, type.name] as const,
    );
    expect(Object.entries(OBJECT_PARTS).sort()).toEqual(known.sort());
    expect(PARTS.map((part) => [part.group, part.type]).sort()).toEqual(Object.entries(OBJECT_PARTS).sort());
    for (const type of Object.values(OBJECT_PARTS)) {
      expect(parentKey(key(type, 'Parcel__c.Part')), type).toBe('CustomObject:parcel__c');
    }
  });

  it('are the same components whether the object is one file or a folder of files', async () => {
    // As an org hands the object out, and as a repository in the metadata format holds it.
    const whole = new Source();
    const file = whole.file(
      'objects/Parcel__c.object',
      xml('CustomObject', ...PARTS.map((part) => `<${part.group}><fullName>${part.name}</fullName></${part.group}>`)),
    );
    // As a project in the source format holds it.
    const split = new Source();
    split.file('objects/Parcel__c/Parcel__c.object-meta.xml', xml('CustomObject'));
    for (const part of PARTS) {
      split.file(
        `objects/Parcel__c/${part.group}/${part.name}.${part.suffix}-meta.xml`,
        xml(part.type, `<fullName>${part.name}</fullName>`),
      );
    }
    const analysed = async (source: Source): Promise<SourceAnalysis> =>
      analyseSource(source.tree, (await resolveComponents(source.tree, [''])).components);
    const [one, many] = [await analysed(whole), await analysed(split)];

    const expected = ['CustomObject:parcel__c', ...PARTS.map((part) => key(part.type, `Parcel__c.${part.name}`))];
    expect(one.components.map((component) => component.key)).toEqual(expected.sort());
    expect(many.components.map((component) => component.key)).toEqual(expected.sort());
    expect(one.components.map((component) => component.name)).toEqual(
      many.components.map((component) => component.name),
    );
    expect([...one.issues, ...many.issues]).toEqual([]);
    // Each part of the one file is defined by its element. Only the object, the field, the field set, the record
    // type and the rule are read.
    for (const part of PARTS) {
      const component = componentOf(one, part.type, `Parcel__c.${part.name}`);
      expect(component.definition?.path).toBe(file);
      expect(hex(component.definition?.contentHash)).toBe(
        sha(`<${part.group}><fullName>${part.name}</fullName></${part.group}>`),
      );
    }
    const read = (analysis: SourceAnalysis): string[] =>
      analysis.components.filter((component) => component.attrs !== null).map((component) => component.key);
    expect(read(one)).toEqual([
      'CustomField:parcel__c.weight__c',
      'CustomObject:parcel__c',
      'FieldSet:parcel__c.sizes',
      'RecordType:parcel__c.big',
      'ValidationRule:parcel__c.weighed',
    ]);
    expect(read(many)).toEqual(read(one));
    expect(one.work).toEqual(many.work);
  });

  it('are read with the object of the file as their own, and their names without the space around them', () => {
    const source = new Source();
    const file = source.file(
      'objects/Parcel__c.object',
      xml(
        'CustomObject',
        '<fields><fullName>Weight__c</fullName><type>Number</type></fields>',
        '<fields>',
        '    <fullName>',
        '        Carrier__c',
        '    </fullName>',
        '    <lookupFilter><filterItems><valueField>$Source.Weight__c</valueField></filterItems></lookupFilter>',
        '    <referenceTo>Account</referenceTo>',
        '</fields>',
      ),
    );
    source.listed.push({ type: 'CustomObject', fullName: 'Parcel__c', files: [file] });
    const analysis = source.analyse();
    expect(analysis.components.map((one) => one.name)).toEqual([
      'Parcel__c.Carrier__c',
      'Parcel__c.Weight__c',
      'Parcel__c',
    ]);
    expect(told(analysis, key('CustomField', 'Parcel__c.Carrier__c'))).toEqual([
      '9:22 references CustomObject:account [Account] external lookup',
      // `$Source` starts at column 48, after eight spaces and three start tags of 14, 13 and 12 characters.
      '8:56 reads CustomField:parcel__c.weight__c [Weight__c] resolved filter',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('keep their rows when one of them holds a value that is no name', () => {
    const source = new Source();
    const file = source.file(
      'objects/Parcel__c.object',
      xml(
        'CustomObject',
        '<fields><fullName>A__c</fullName><type>Text</type></fields>',
        '<fields><fullName>B__c</fullName><summarizedField>Line__c.</summarizedField></fields>',
        '<fields><fullName>C__c</fullName><type>Text</type></fields>',
        '<validationRules><fullName>R</fullName><errorDisplayField>C__c</errorDisplayField></validationRules>',
      ),
    );
    source.listed.push({ type: 'CustomObject', fullName: 'Parcel__c', files: [file] });
    const analysis = source.analyse();
    expect(
      analysis.components.map((one) => `${one.key} ${String(one.definition?.path)} ${String(one.attrs !== null)}`),
    ).toEqual([
      `CustomField:parcel__c.a__c ${file} true`,
      `CustomField:parcel__c.b__c ${file} true`,
      `CustomField:parcel__c.c__c ${file} true`,
      `CustomObject:parcel__c ${file} true`,
      `ValidationRule:parcel__c.r ${file} true`,
    ]);
    expect(codes(analysis.issues)).toEqual(['warning NAME_NOT_READ']);
    expect(told(analysis)).toEqual(['6:63 references CustomField:parcel__c.c__c [C__c] resolved display-field']);
  });
});

describe('an object that lies in two package folders', () => {
  it('is read from both of its files, and the first says what both say', () => {
    const source = new Source();
    const first = source.file(
      'a/objects/Parcel__c/Parcel__c.object-meta.xml',
      xml('CustomObject', '<customSettingsType>List</customSettingsType>', '<label>Parcel</label>'),
    );
    const second = source.file(
      'b/objects/Parcel__c/Parcel__c.object-meta.xml',
      xml(
        'CustomObject',
        '<customSettingsType>Hierarchy</customSettingsType>',
        '<fields><fullName>Weight__c</fullName><type>Number</type></fields>',
      ),
    );
    source.listed.push({ type: 'CustomObject', fullName: 'Parcel__c', files: [first, second] });
    const analysis = source.analyse();
    const parcel = componentOf(analysis, 'CustomObject', 'Parcel__c');
    expect(parcel.attrs).toEqual({ customSettingsType: 'List' });
    expect(parcel.definition?.path).toBe(first);
    expect(hex(parcel.definition?.contentHash)).toBe(
      sha(`${sha(source.files.get(first) ?? '')} ${first}\n${sha(source.files.get(second) ?? '')} ${second}\n`),
    );
    // The field in the second file is a component too.
    expect(componentOf(analysis, 'CustomField', 'Parcel__c.Weight__c')).toMatchObject({
      definition: { path: second },
      attrs: { type: 'Number' },
    });
    expect(analysis.issues).toEqual([]);
    expect(analysis.work).toEqual([{ origin: 'parser:xml', components: 2, failedFiles: 0 }, NO_FORMULA, NO_FLOW]);
  });

  it('gets the same name for an object without a file however its parts are listed', () => {
    const source = new Source();
    source.file('a/objects/account/fields/X__c.field-meta.xml', xml('CustomField', '<fullName>X__c</fullName>'));
    source.file('b/objects/Account/fields/Y__c.field-meta.xml', xml('CustomField', '<fullName>Y__c</fullName>'));
    source.listed.push({ type: 'CustomField', fullName: 'account.X__c', files: [...source.files.keys()].slice(0, 1) });
    source.listed.push({ type: 'CustomField', fullName: 'Account.Y__c', files: [...source.files.keys()].slice(1) });
    const analysis = source.analyse();
    // `Account.Y__c` comes before `account.X__c` in the order of code units, and its spelling is taken.
    expect(componentOf(analysis, 'CustomObject', 'Account').name).toBe('Account');
    expect(analyseSource(source.tree, [...source.listed].reverse())).toEqual(analysis);
  });
});
