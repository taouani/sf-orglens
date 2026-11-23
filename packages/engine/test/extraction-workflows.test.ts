/**
 * The analysis of workflow rules: a component for the file of an object, and one for each rule and each action in
 * it, with the references each of them holds.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second runs on small files
 * that are written here, for what the fixture does not have. The last holds the names the reader knows against
 * the types of the Salesforce library.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { registry } from '@salesforce/source-deploy-retrieve';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import { ACTION_TYPES, WORKFLOW_PARTS } from '../src/extraction/workflows.ts';
import { readFolders } from '../src/sources/folder.ts';
import type { ProjectLayout } from '../src/sources/project.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { Source, viaOf, xml } from './helpers/written-source.ts';

const WORKFLOWS = 'force-app/main/default/workflows/';

/** A reference as the answer key says one: where it starts, where it stands, what it is, and how sure. */
const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  const where = `${file}:${String(line)}:${String(column)}`;
  return `${reference.from} ${where}:${reference.kind}:${String(reference.to)} ${viaOf(reference)} ${reference.confidence}`;
};

/** The components of workflow rules of an analysis: the files, and the rules and actions in them. */
const ofWorkflows = (analysis: SourceAnalysis): AnalysedComponent[] =>
  analysis.components.filter((one) => /^Workflow[A-Za-z]*:/.test(one.key));

describe('the workflow rules of the fixture project', () => {
  const answers = loadAnswerKey();
  const keyed = answers.references.filter((one) => one.file.startsWith(WORKFLOWS));
  const idOfKeyed = (one: (typeof keyed)[number]): string => `${one.from} ${one.id} ${one.via} ${one.tier}`;
  let analysis: SourceAnalysis;
  let components: AnalysedComponent[];
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    components = ofWorkflows(analysis);
    references = components.flatMap((one) => one.references);
  });

  it('give every reference of the key, from the rule or the action the key says, and no other', () => {
    expect(keyed).toHaveLength(33);
    expect(keyed.every((one) => one.phase === 2 && !one.stretch && one.op === undefined)).toBe(true);
    expect(references.map(idOf).sort()).toEqual(keyed.map(idOfKeyed).sort());
  });

  it('say where each name was read: in a formula by the reader of formulas, elsewhere by the reader of XML', () => {
    for (const one of references) {
      expect(one.origin, idOf(one)).toBe(viaOf(one) === 'formula' ? 'parser:formula' : 'parser:xml');
      expect(one.resolution, idOf(one)).not.toBe('unresolved');
    }
    // A target the project does not hold is one Salesforce provides, and the key lists it as such.
    const standard = new Set<string>(answers.standard);
    const external = references.filter((one) => one.resolution === 'external');
    expect(external.map((one) => String(one.to))).toEqual(['CustomField:account.name']);
    for (const one of external) expect(standard.has(String(one.to)), idOf(one)).toBe(true);
  });

  it('report no reference where the key forbids one, and know of nothing they do not read', () => {
    const forbidden = answers.negatives.filter((one) => one.file.startsWith(WORKFLOWS));
    expect(forbidden).toHaveLength(5);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
    expect(answers.unknowns.filter((one) => one.file.startsWith(WORKFLOWS))).toEqual([]);
    expect(analysis.issues.filter((issue) => /^Workflow[A-Za-z]*:/.test(String(issue.componentKey)))).toEqual([]);
  });

  it('are a component each: the file of an object, and every rule and action in it', () => {
    const listed = answers.components.filter((one) => /^Workflow[A-Za-z]*$/.test(one.type));
    expect(components.map((one) => one.key)).toEqual(listed.map((one) => one.key).sort());
    expect(components.map((one) => one.name)).toEqual(
      [...listed].sort((a, b) => (a.key < b.key ? -1 : 1)).map((one) => one.fullName),
    );
    // A rule says whether it is active. Nothing else holds an attribute.
    expect(components.map((one) => `${one.key} ${JSON.stringify(one.attrs)}`)).toEqual([
      'Workflow:invoice__c {}',
      'Workflow:invoice_line__c {}',
      'WorkflowAlert:invoice__c.invoice_overdue_alert {}',
      'WorkflowFieldUpdate:invoice__c.set_sub_status_reminder {}',
      'WorkflowFieldUpdate:invoice__c.stamp_legacy_code {}',
      'WorkflowFieldUpdate:invoice_line__c.stamp_tax_code_of_invoice {}',
      'WorkflowOutboundMessage:invoice__c.notify_ledger {}',
      'WorkflowRule:invoice__c.follow_up_when_void {"active":false}',
      'WorkflowRule:invoice__c.remind_when_sent {"active":true}',
      'WorkflowRule:invoice__c.stamp_code_when_paid {"active":true}',
      'WorkflowRule:invoice_line__c.stamp_when_billed {"active":true}',
      'WorkflowTask:invoice__c.follow_up_on_void {}',
    ]);
    // A rule or an action is defined by its own element of the file of its object. The file holds none.
    for (const one of components) {
      const object = one.name.split('.', 1)[0] ?? '';
      expect(one.definition?.path, one.key).toBe(`${WORKFLOWS}${object}.workflow-meta.xml`);
    }
    const hashes = components.map((one) => one.definition?.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(components.filter((one) => one.key.startsWith('Workflow:')).flatMap((one) => one.references)).toEqual([]);
  });

  it('are counted for the reader of XML', () => {
    expect(analysis.types).toEqual(expect.arrayContaining(['Workflow', ...WORKFLOW_PARTS]));
    expect(components).toHaveLength(12);
  });
});

describe('small files of workflow rules that are written here', () => {
  /** Two objects with a relationship between them, a lookup to a standard object, and a field of that object. */
  const project = (): Source => {
    const source = new Source();
    source.object('Invoice__c', '<label>Invoice</label>');
    source.field('Invoice__c', 'Amount__c', '<type>Number</type>');
    source.field('Invoice__c', 'Limit__c', '<type>Number</type>');
    source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
    source.field('Invoice__c', 'Due_Date__c', '<type>Date</type>');
    source.field(
      'Invoice__c',
      'Account__c',
      '<type>Lookup</type>',
      '<referenceTo>Account</referenceTo>',
      '<relationshipName>Invoices</relationshipName>',
    );
    source.field(
      'Invoice__c',
      'Approver__c',
      '<type>Lookup</type>',
      '<referenceTo>User</referenceTo>',
      '<relationshipName>Approved_Invoices</relationshipName>',
    );
    source.field('Account', 'Tier__c', '<type>Picklist</type>');
    return source;
  };
  /** A group of the file with a full name. `lines` stand inside it. */
  const group = (kind: string, name: string, ...lines: string[]): string[] => [
    `<${kind}>`,
    `    <fullName>${name}</fullName>`,
    ...lines.map((line) => `    ${line}`),
    `</${kind}>`,
  ];
  /** An action of a rule. Without a type, the action has none. */
  const action = (name: string, type?: string): string[] => [
    '<actions>',
    `    <name>${name}</name>`,
    ...(type === undefined ? [] : [`    <type>${type}</type>`]),
    '</actions>',
  ];
  const listedOf = async (source: Source, layout: ProjectLayout | null = null): Promise<SourceAnalysis> =>
    analyseSource(source.tree, (await resolveComponents(source.tree, [''], layout)).components);
  /**
   * The analysis of the project with a file of workflow rules of `object` of these lines. The first of them is
   * line 3 of the file.
   */
  const analysed = async (
    lines: readonly string[],
    object = 'Invoice__c',
    change: (source: Source) => void = () => undefined,
  ): Promise<SourceAnalysis> => {
    const source = project();
    change(source);
    source.file(`workflows/${object}.workflow-meta.xml`, xml('Workflow', ...lines));
    return listedOf(source);
  };
  /** The references of a component, as `line:column kind target [name] via tier`. */
  const from = (analysis: SourceAnalysis, key: string): string[] =>
    (analysis.components.find((one) => one.key === key)?.references ?? []).map(
      (one) =>
        `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${one.to ?? one.resolution} [${one.toNameRaw}] ${viaOf(one)} ${one.confidence}`,
    );
  /** The issues of an analysis, as `severity CODE component message`. */
  const issuesOf = (analysis: SourceAnalysis): string[] =>
    analysis.issues.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)} ${issue.message}`);
  const FILE = 'workflows/Invoice__c.workflow-meta.xml';

  it('read the criteria of a rule: a field of the object, the field it is compared with, and a field of the user', async () => {
    const analysis = await analysed(
      group(
        'rules',
        'Over_Limit',
        '<active>false</active>',
        '<criteriaItems>',
        '    <field>Invoice__c.Amount__c</field>',
        '    <operation>greaterThan</operation>',
        '    <valueField>Invoice__c.Limit__c</valueField>',
        '</criteriaItems>',
        '<criteriaItems>',
        '    <field>User.Department</field>',
        '    <operation>equals</operation>',
        '    <value>Billing</value>',
        '</criteriaItems>',
        '<triggerType>onAllChanges</triggerType>',
      ),
    );
    expect(from(analysis, 'WorkflowRule:invoice__c.over_limit')).toEqual([
      '7:31 reads CustomField:invoice__c.amount__c [Amount__c] filter confirmed',
      '9:36 reads CustomField:invoice__c.limit__c [Limit__c] filter confirmed',
      '12:25 reads CustomField:user.department [Department] filter confirmed',
    ]);
    // A rule that is not active says so, and its references say it through the rule.
    expect(analysis.components.find((one) => one.key === 'WorkflowRule:invoice__c.over_limit')?.attrs).toEqual({
      active: false,
    });
    expect(issuesOf(analysis)).toEqual([]);
  });

  it('read what a rule starts, at once and after a time, by the type of the action', async () => {
    const analysis = await analysed([
      ...group(
        'alerts',
        'Tell_Owner',
        '<protected>false</protected>',
        '<recipients>',
        '    <type>owner</type>',
        '</recipients>',
        '<senderType>CurrentUser</senderType>',
        '<template>unfiled$public/Overdue</template>',
      ),
      ...group('flowActions', 'Start_Flow', '<flow>Recalculate</flow>', '<label>Start</label>'),
      ...group(
        'rules',
        'Everything',
        ...action('Tell_Owner', 'Alert'),
        ...action('Start_Flow', 'FlowAction'),
        ...action('Publish', 'KnowledgePublish'),
        ...action('Run_Flow', 'FlowAutomation'),
        ...action('Ping', 'Notification'),
        ...action('Mail', 'Send'),
        ...action('Teleport', 'Teleport'),
        ...action('Nothing'),
        '<active>true</active>',
        '<formula>true</formula>',
        '<triggerType>onAllChanges</triggerType>',
        '<workflowTimeTriggers>',
        ...action('Tell_Owner', 'Alert').map((line) => `    ${line}`),
        '    <offsetFromField>Invoice__c.Due_Date__c</offsetFromField>',
        '    <timeLength>1</timeLength>',
        '    <workflowTimeTriggerUnit>Days</workflowTimeTriggerUnit>',
        '</workflowTimeTriggers>',
      ),
    ]);
    // An action names the alert, the field update or the message of the object of the rule. Salesforce names it
    // with that object. A flow action is a component that is not read. The source holds no knowledge action and
    // no action that sends, and nothing of two types the Salesforce library does not know: those are not found.
    expect(from(analysis, 'WorkflowRule:invoice__c.everything')).toEqual([
      '20:19 references WorkflowAlert:invoice__c.tell_owner [Tell_Owner] action confirmed',
      '24:19 references WorkflowFlowAction:invoice__c.start_flow [Start_Flow] action confirmed',
      '28:19 references unresolved [Publish] action confirmed',
      '32:19 references unresolved [Run_Flow] action confirmed',
      '36:19 references unresolved [Ping] action confirmed',
      '40:19 references unresolved [Mail] action confirmed',
      '55:23 references WorkflowAlert:invoice__c.tell_owner [Tell_Owner] action confirmed',
      '58:41 reads CustomField:invoice__c.due_date__c [Due_Date__c] time confirmed',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ WorkflowRule:invoice__c.everything ${FILE}, line 45: the element "type" holds "Teleport", which is no type of action of a workflow rule that is known here. The action is not read.`,
      `warning NAME_NOT_READ WorkflowRule:invoice__c.everything ${FILE}, line 48: the element "name" holds "Nothing", and the action has no type. The action is not read.`,
    ]);
    // The alert sends to the owner, which names no field, with a template the source does not hold.
    expect(from(analysis, 'WorkflowAlert:invoice__c.tell_owner')).toEqual([
      '10:34 references unresolved [Overdue] template confirmed',
    ]);
    // The flow action has its row, defined by its element of the file, and nothing of it is read.
    expect(analysis.components.find((one) => one.key === 'WorkflowFlowAction:invoice__c.start_flow')).toMatchObject({
      name: 'Invoice__c.Start_Flow',
      definition: { path: FILE },
      attrs: null,
      references: [],
    });
    expect(analysis.types).not.toContain('WorkflowFlowAction');
  });

  it('write a field of the record, or of the parent that a lookup of the record leads to', async () => {
    /** A field update of the lines `more`, which sets `field` to a literal value. */
    const update = (name: string, field: string, ...more: string[]): string[] =>
      group('fieldUpdates', name, `<field>${field}</field>`, '<literalValue>Gold</literalValue>', ...more);
    const analysis = await analysed([
      ...update('Own', 'Status__c'),
      ...update('Through_Lookup', 'Tier__c', '<targetObject>Account__c</targetObject>'),
      ...update('Through_Nothing', 'Tier__c', '<targetObject>Nowhere__c</targetObject>'),
      ...update('Through_No_Name', 'Tier__c', '<targetObject>Account Id</targetObject>'),
      ...group('fieldUpdates', 'By_Formula', '<field>Limit__c</field>', '<formula>Amount__c * 2</formula>'),
    ]);
    const updates = ['own', 'through_lookup', 'through_nothing', 'through_no_name', 'by_formula'];
    expect(
      Object.fromEntries(updates.map((name) => [name, from(analysis, `WorkflowFieldUpdate:invoice__c.${name}`)])),
    ).toEqual({
      own: ['5:16 writes CustomField:invoice__c.status__c [Status__c] assignment confirmed'],
      // The update names the lookup it goes through by the name of its field. Reading the lookup is part of it.
      through_lookup: [
        '12:23 reads CustomField:invoice__c.account__c [Account__c] path confirmed',
        '10:16 writes CustomField:account.tier__c [Tier__c] assignment confirmed',
      ],
      // A lookup the object does not have leads nowhere that is known, and the field is not guessed.
      through_nothing: ['18:23 reads unresolved [Nowhere__c] path confirmed'],
      through_no_name: [],
      // The formula of an update is about the record, and reads its fields.
      by_formula: [
        '28:16 writes CustomField:invoice__c.limit__c [Limit__c] assignment confirmed',
        '29:18 reads CustomField:invoice__c.amount__c [Amount__c] formula confirmed',
      ],
    });
    // A relationship that is no name is not read, and then nothing says which object the field is of.
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ WorkflowFieldUpdate:invoice__c.through_no_name ${FILE}, line 24: the element "targetObject" holds "Account Id", which is not read as a name.`,
      `warning PATH_NOT_FOLLOWED WorkflowFieldUpdate:invoice__c.through_no_name ${FILE}, line 22: nothing says which object "Tier__c" is a field of, so it was not followed.`,
      `warning PATH_NOT_FOLLOWED WorkflowFieldUpdate:invoice__c.through_nothing ${FILE}, line 18: it is not known which object "Nowhere__c" leads to, so its field "Tier__c" was not followed.`,
    ]);

    // A standard lookup is named by its field, and leads where its name says.
    const contact = await analysed(
      update('Of_Account', 'Tier__c', '<targetObject>AccountId</targetObject>'),
      'Contact',
    );
    expect(from(contact, 'WorkflowFieldUpdate:contact.of_account')).toEqual([
      '7:23 reads CustomField:contact.accountid [AccountId] path confirmed',
      '5:16 writes CustomField:account.tier__c [Tier__c] assignment confirmed',
    ]);
    const [lookup, written] =
      contact.components.find((one) => one.key === 'WorkflowFieldUpdate:contact.of_account')?.references ?? [];
    expect([lookup?.resolution, written?.resolution]).toEqual(['external', 'resolved']);
    expect(issuesOf(contact)).toEqual([]);
  });

  it('read the fields an alert sends to and an outbound message sends, and the template of an alert', async () => {
    const analysis = await analysed(
      [
        ...group(
          'alerts',
          'To_Approver',
          '<protected>false</protected>',
          '<recipients>',
          '    <field>Approver__c</field>',
          '    <type>userLookup</type>',
          '</recipients>',
          '<recipients>',
          '    <recipient>Billing_Team</recipient>',
          '    <type>group</type>',
          '</recipients>',
          '<senderType>CurrentUser</senderType>',
          '<template>unfiled$public/Overdue</template>',
        ),
        ...group('alerts', 'No_Folder', '<protected>false</protected>', '<template>Overdue</template>'),
        ...group(
          'outboundMessages',
          'To_Ledger',
          '<apiVersion>66.0</apiVersion>',
          '<endpointUrl>https://ledger.example.com/invoices</endpointUrl>',
          '<fields>Amount__c</fields>',
          '<fields>Id</fields>',
          '<fields>Nothing__c</fields>',
          '<includeSessionId>false</includeSessionId>',
          '<name>To Ledger</name>',
          '<protected>false</protected>',
          '<useDeadLetterQueue>false</useDeadLetterQueue>',
        ),
      ],
      'Invoice__c',
      (source) => {
        source.file('email/unfiled$public/Overdue.email', 'Dear {!Invoice__c.Name}');
        source.file(
          'email/unfiled$public/Overdue.email-meta.xml',
          xml('EmailTemplate', '<available>true</available>', '<name>Overdue</name>', '<type>text</type>'),
        );
      },
    );
    // A recipient that is a field of the record is read. A recipient named by itself, here a group, is not.
    expect(from(analysis, 'WorkflowAlert:invoice__c.to_approver')).toEqual([
      '7:20 reads CustomField:invoice__c.approver__c [Approver__c] listed-field confirmed',
      '15:34 references EmailTemplate:unfiled$public/overdue [Overdue] template confirmed',
    ]);
    // A template is named with its folder. A name without one is not read.
    expect(from(analysis, 'WorkflowAlert:invoice__c.no_folder')).toEqual([]);
    // The id of the record is sent by every message, and is no reference.
    expect(from(analysis, 'WorkflowOutboundMessage:invoice__c.to_ledger')).toEqual([
      '26:17 reads CustomField:invoice__c.amount__c [Amount__c] listed-field confirmed',
      '28:17 reads unresolved [Nothing__c] listed-field confirmed',
    ]);
    expect(issuesOf(analysis)).toEqual([
      `warning NAME_NOT_READ WorkflowAlert:invoice__c.no_folder ${FILE}, line 20: the element "template" holds "Overdue", which is not read as a name.`,
    ]);
  });

  it('read the same from a file of each rule and action, as a project with "decomposeWorkflowBeta" lays them out', async () => {
    const parts = {
      alerts: [
        'Tell_Approver',
        'workflowAlerts',
        'workflowAlert',
        'WorkflowAlert',
        [
          '<protected>false</protected>',
          '<recipients>',
          '    <field>Approver__c</field>',
          '    <type>userLookup</type>',
          '</recipients>',
          '<senderType>CurrentUser</senderType>',
          '<template>unfiled$public/Overdue</template>',
        ],
      ],
      fieldUpdates: [
        'Stamp',
        'workflowFieldUpdates',
        'workflowFieldUpdate',
        'WorkflowFieldUpdate',
        [
          '<field>Limit__c</field>',
          '<formula>Amount__c * 2</formula>',
          '<name>Stamp</name>',
          '<notifyAssignee>false</notifyAssignee>',
          '<operation>Formula</operation>',
          '<protected>false</protected>',
        ],
      ],
      rules: [
        'Big',
        'workflowRules',
        'workflowRule',
        'WorkflowRule',
        [
          ...action('Stamp', 'FieldUpdate'),
          ...action('Tell_Approver', 'Alert'),
          '<active>true</active>',
          '<criteriaItems>',
          '    <field>Invoice__c.Amount__c</field>',
          '    <operation>greaterThan</operation>',
          '    <value>1000</value>',
          '</criteriaItems>',
          '<triggerType>onAllChanges</triggerType>',
        ],
      ],
    } as const;
    const whole = project();
    whole.file(
      FILE,
      xml('Workflow', ...Object.entries(parts).flatMap(([kind, [name, , , , lines]]) => group(kind, name, ...lines))),
    );
    // Salesforce writes the file of the object as well, which holds nothing else here.
    const split = project();
    split.file('workflows/Invoice__c/Invoice__c.workflow-meta.xml', xml('Workflow'));
    for (const [name, folder, suffix, type, lines] of Object.values(parts)) {
      split.file(
        `workflows/Invoice__c/${folder}/${name}.${suffix}-meta.xml`,
        xml(type, `<fullName>${name}</fullName>`, ...lines),
      );
    }
    const decomposed = { presets: ['decomposeWorkflowBeta'], customizations: null };
    const [one, many] = [await listedOf(whole), await listedOf(split, decomposed)];
    const shown = (analysis: SourceAnalysis): string[] =>
      ofWorkflows(analysis).map((one) => `${one.key} ${one.name} ${JSON.stringify(one.attrs)}`);
    expect(shown(many)).toEqual(shown(one));
    expect(shown(one)).toHaveLength(4);
    // The same references, each at its place in the file of its rule or action.
    const said = (analysis: SourceAnalysis): string[] =>
      ofWorkflows(analysis).flatMap((component) =>
        component.references.map((one) => `${one.from} ${one.kind} ${String(one.to)} ${viaOf(one)} ${one.confidence}`),
      );
    expect(said(many)).toEqual(said(one));
    expect(said(one)).toHaveLength(7);
    for (const component of ofWorkflows(many)) {
      for (const one of component.references) expect(one.location?.file).toBe(component.definition?.path);
    }
    expect(ofWorkflows(many).map((one) => one.definition?.path)).toEqual([
      'workflows/Invoice__c/Invoice__c.workflow-meta.xml',
      'workflows/Invoice__c/workflowAlerts/Tell_Approver.workflowAlert-meta.xml',
      'workflows/Invoice__c/workflowFieldUpdates/Stamp.workflowFieldUpdate-meta.xml',
      'workflows/Invoice__c/workflowRules/Big.workflowRule-meta.xml',
    ]);
    expect(issuesOf(one)).toEqual([]);
    expect(issuesOf(many)).toEqual([]);
  });
});

describe('the names the reader of workflow rules knows', () => {
  it('are those of the Metadata API and of the Salesforce library', () => {
    // The library of the engine brings the types of the Metadata API, which hold the types of an action.
    const library = createRequire(import.meta.url).resolve('@salesforce/source-deploy-retrieve');
    const types = createRequire(library).resolve('@salesforce/types/metadata').replace(/\.js$/, '.d.ts');
    const union = /^export type WorkflowActionType = (.*);$/m.exec(readFileSync(types, 'utf8'))?.[1] ?? '';
    const actionTypes = [...union.matchAll(/'([^']*)'/g)].map(([, value]) => String(value));
    expect([...ACTION_TYPES.keys()].sort()).toEqual(actionTypes.sort());

    // Every other type of action is a part of a file of workflow rules that the library knows. Of the two, it knows
    // one as a type of its own, and the other not at all.
    const parts = Object.values(registry.types['workflow']?.children?.types ?? {}).map((type) => type.name);
    const unknown = ['WorkflowFlowAutomation', 'WorkflowNotification'];
    expect(
      [...ACTION_TYPES.values()]
        .filter((type) => !unknown.includes(type))
        .concat('WorkflowRule')
        .sort(),
    ).toEqual(parts.sort());
    expect(registry.types['workflowflowautomation']?.name).toBe('WorkflowFlowAutomation');
    expect(registry.types['workflownotification']).toBeUndefined();
    // The parts that are read are among them, with the element of the file each stands in.
    expect([...WORKFLOW_PARTS].filter((type) => !parts.includes(type))).toEqual([]);
    const elements = Object.values(registry.types['workflow']?.children?.types ?? {})
      .filter((type) => WORKFLOW_PARTS.has(type.name))
      .map((type) => `${type.name} ${String(type.xmlElementName)}`);
    expect(elements.sort()).toEqual([
      'WorkflowAlert alerts',
      'WorkflowFieldUpdate fieldUpdates',
      'WorkflowOutboundMessage outboundMessages',
      'WorkflowRule rules',
      'WorkflowTask tasks',
    ]);
  });
});
