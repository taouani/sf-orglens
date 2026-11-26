/**
 * `impact`: what refers to a component in a snapshot (decision record 0044), asked through the workspace.
 *
 * The answers for the fixture project are held against two things: golden files, which a person reviews, and the
 * answer key, from which a test works out what every answer must be. `engines-impact.test.ts` has the rules of
 * the walk on graphs written for them.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImpactReport } from '../src/api/impact.ts';
import { openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { buildKey, parentKey, type ComponentKey } from '../src/core/keys.ts';
import { CONFIDENCE_TIERS, type ConfidenceTier } from '../src/core/references.ts';
import { engineVersion } from '../src/core/version.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { addCoverage, addIssue, ensureSource, insertSnapshot, readCoverage } from '../src/store/snapshots.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { chainOf } from './helpers/impact-chain.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const T0 = '2026-01-31T09:30:00.000Z';
const OBJECTS = 'force-app/main/default/objects';
const AMOUNT = 'CustomField:invoice__c.amount__c';

interface Failure {
  code: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

async function failure(run: () => Promise<unknown>): Promise<Failure> {
  try {
    await run();
  } catch (error) {
    return (error as { toJSON: () => Failure }).toJSON();
  }
  throw new Error('did not throw');
}

/**
 * A report without the two things that are not of the fixture project: the moment its snapshot was taken, which
 * differs from run to run, and the version of the engine that analysed it, which differs from release to release.
 * A test of its own holds the version against the engine.
 */
const timeless = (report: ImpactReport): unknown => ({
  ...report,
  snapshot: { ...report.snapshot, finishedAt: 'TIME', analysedBy: 'VERSION' },
});

/** What a test compares of an answer: each result with its depth and its confidence. */
const outline = (report: ImpactReport): (readonly [string, number, string])[] =>
  report.results.map((result) => [result.key, result.depth, result.confidence] as const);

/** The types of the fixture project that no analyser reads yet, with the number of components of each. */
const NOT_ANALYSED: readonly (readonly [string, number])[] = [
  ['ApexClass', 28],
  ['ApexPage', 2],
  ['ApexTrigger', 2],
  ['AuraDefinitionBundle', 1],
  ['CustomLabel', 1],
  ['CustomLabels', 1],
  ['CustomPermission', 1],
  ['EmailFolder', 1],
  ['ExternalCredential', 1],
  ['GlobalValueSet', 1],
  ['LightningComponentBundle', 2],
  ['NamedCredential', 1],
];
/** Of them, the types whose components can name no field: the table of `engines/can-name.ts` has a line for each. */
const NAME_NO_FIELD: readonly string[] = [
  'CustomLabel',
  'CustomLabels',
  'CustomPermission',
  'EmailFolder',
  'GlobalValueSet',
];

/** The questions whose answers are golden files, as the plan of the phase lists them. */
const GOLDEN: readonly (readonly [string, string, string])[] = [
  ['a field that formulas and rules read', 'Invoice__c.Amount__c', 'amount'],
  ['a field of a standard object', 'Account.Tier__c', 'account-tier'],
  ['a standard field', 'User.Department', 'standard-field'],
  // The file of workflow rules of the object has the name of the object. The name alone means the object.
  ['an object', 'Invoice__c', 'object'],
  ['a field that nothing refers to', 'Invoice__c.Unused_Field__c', 'unreferenced'],
  ['a field that is reached through a chain of formulas', 'Invoice_Line__c.Quantity__c', 'chain'],
  // The questions of Phase 2. A flow is found beside its elements, and what calls it after them.
  ['a field a flow writes', 'Account.Risk_Score__c', 'risk-score'],
  ['a field a flow reads through a relationship', 'Account.Credit_Limit__c', 'credit-limit'],
  ['a field a field update writes', 'Invoice__c.Legacy_Code__c', 'legacy-code'],
  ['a record type', 'Invoice__c.Credit_Note', 'record-type'],
  ['a flow', 'Invoice_Recalculate', 'flow'],
  // An element is named after its flow. What calls the flow runs the element.
  ['an element of a flow', 'Invoice_Recalculate.Set_Amount', 'element'],
];

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'an impact question with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };

    /** A workspace with a copy of the fixture project as the source `fixture`, and an org that is only declared. */
    async function setUp(
      snapshots = 1,
    ): Promise<{ root: string; project: string; database: string; workspace: Workspace }> {
      const root = temp.next();
      cpSync(join(FIXTURES_DIR, 'billing-sfdx'), join(root, 'project'), { recursive: true });
      writeFileSync(
        join(root, 'orglens.toml'),
        'schema_version = 1\n[sources.fixture]\nkind = "git"\nrepo = "project"\n[sources.prod]\nkind = "org"\n',
      );
      const workspace = await openWorkspace({ root, env });
      for (let taken = 0; taken < snapshots; taken += 1) await workspace.snapshot('fixture');
      return { root, project: join(root, 'project'), database: join(root, '.orglens', 'orglens.db'), workspace };
    }

    function inStore<T>(database: string, work: (store: Store) => T): T {
      const store = openStore({ path: database, driver });
      try {
        return store.write(() => work(store));
      } finally {
        store.close();
      }
    }

    it.each(GOLDEN)('answers for %s as its golden file says', async (_what, component, file) => {
      const { workspace } = await setUp();
      const report = await workspace.impact('fixture', component);
      await expect(`${JSON.stringify(timeless(report), null, 2)}\n`).toMatchFileSnapshot(
        `./golden/impact/${file}.json`,
      );
    });

    it('says which version of the engine analysed the snapshot, not which one answers', async () => {
      const { database, workspace } = await setUp();
      const report = await workspace.impact('fixture', 'Invoice__c.Amount__c');
      expect(report.snapshot.analysedBy).toBe(engineVersion());

      inStore(database, (store) => store.run("UPDATE snapshot_analysis SET engine_version = '0.0.0-older'"));
      const later = await workspace.impact('fixture', 'Invoice__c.Amount__c');
      expect(later.snapshot.analysedBy).toBe('0.0.0-older');
    });

    it('gives every component of the fixture the answer that the answer key implies', async () => {
      const { workspace } = await setUp();
      const answers = loadAnswerKey();
      // What the analysers must find so far, which are the references of Phases 1 and 2: of fields and rules, of
      // flows, of workflow rules, of record types, of field sets, of records of custom metadata, of the email
      // template, of the report type and of the quick action. An entry of Phase 3 in a file of flows is not.
      const keyed = answers.references.filter((reference) => reference.phase === 1 || reference.phase === 2);
      const placeOf = (step: {
        from: string;
        to: string;
        kind: string;
        file: string | null;
        line: number | null;
        column: number | null;
      }): string =>
        `${step.from} ${step.kind} ${step.to} ${String(step.file)}:${String(step.line)}:${String(step.column)}`;
      const places = new Set(keyed.map(placeOf));
      const weaker = (a: ConfidenceTier, b: ConfidenceTier): ConfidenceTier =>
        CONFIDENCE_TIERS.indexOf(a) > CONFIDENCE_TIERS.indexOf(b) ? a : b;
      /** The flow of an element of a flow. A flow runs its elements and refers to what they refer to. */
      const flowOf = (one: string): string | undefined =>
        one.startsWith('Flow:') && one.includes('#element:') ? parentKey(one as ComponentKey) : undefined;

      // Every component a reference of the key starts from or points at, and every component the key lists
      // of the types that are analysed. An object is asked about too when the key names only a field of it.
      const asked = new Set<ComponentKey>();
      for (const one of keyed.flatMap((reference) => [reference.from, reference.to])) asked.add(one);
      for (const one of answers.components) {
        if (
          /^(?:CustomObject|CustomField|CustomMetadata|EmailTemplate|FieldSet|Flow|QuickAction|RecordType|ReportType|ValidationRule|Workflow[A-Za-z]*)$/.test(
            one.type,
          )
        ) {
          asked.add(one.key);
        }
      }
      for (const one of [...asked]) {
        const parent = parentKey(one);
        if (parent !== undefined) asked.add(parent);
      }

      /** The answer for a component, from the key alone: level by level, the most certain way to each. */
      const implied = (start: ComponentKey): unknown[] => {
        const reached = new Map<ComponentKey, { depth: number; tier: ConfidenceTier }>();
        let level = [...asked].filter((one) => one === start || parentKey(one) === start);
        // What calls the flow of an element runs the element: the flow is part of the start.
        const startFlow = flowOf(start);
        if (startFlow !== undefined) level.push(startFlow as ComponentKey);
        for (const one of level) reached.set(one, { depth: 0, tier: 'confirmed' });
        for (let depth = 1; level.length > 0; depth += 1) {
          const found = new Map<ComponentKey, ConfidenceTier>();
          for (const reference of keyed) {
            const near = reached.get(reference.to);
            if (near?.depth !== depth - 1 || reached.has(reference.from)) continue;
            const tier = weaker(near.tier, reference.tier);
            const best = found.get(reference.from);
            found.set(reference.from, best === undefined || weaker(best, tier) === best ? tier : best);
          }
          // A flow is found beside its elements, as certain as the most certain of them.
          for (const [one, tier] of [...found]) {
            const of = flowOf(one) as ComponentKey | undefined;
            if (of === undefined || reached.has(of)) continue;
            const best = found.get(of);
            found.set(of, best === undefined || weaker(best, tier) === best ? tier : best);
          }
          for (const [one, tier] of found) reached.set(one, { depth, tier });
          level = [...found.keys()];
        }
        return [...reached]
          .filter(([, how]) => how.depth > 0)
          .map(([one, how]) => [one, how.depth, how.tier])
          .sort(([a, depthA], [b, depthB]) => Number(depthA) - Number(depthB) || (String(a) < String(b) ? -1 : 1));
      };

      let results = 0;
      for (const component of [...asked].sort()) {
        const report = await workspace.impact('fixture', component);
        expect([component, outline(report)]).toEqual([component, implied(component)]);
        // Every reference of every chain is one the key holds, at the place the key gives it. A chain is
        // followed from result to result, and ends at the component, at something it contains or at the flow of
        // the element it is. A flow is found by the reference of one of its elements.
        for (const result of report.results) {
          const chain = chainOf(report.results, result);
          expect(chain).toHaveLength(result.depth);
          expect(chain.map(placeOf).filter((step) => !places.has(step))).toEqual([]);
          const { from } = result.reference;
          expect(from === result.key ? from : flowOf(from)).toBe(result.key);
          chain.forEach((step, at) => {
            const next = chain[at + 1]?.from ?? step.to;
            expect(next === step.to ? next : flowOf(next)).toBe(step.to);
          });
          const last = chain.at(-1)?.to;
          expect(
            last === component || last === flowOf(component) || (last !== undefined && parentKey(last) === component),
          ).toBe(true);
        }
        results += report.results.length;
      }
      // The numbers say that the loop asked what it was meant to ask. They move with the fixture.
      expect(asked.size).toBe(181);
      expect(results).toBe(671);

      // The fields the key lists as referred to by nothing have an empty answer. Apex is not analysed yet, so
      // other fields have one too.
      for (const component of answers.unreferenced) {
        expect((await workspace.impact('fixture', component)).results).toEqual([]);
      }
    });

    it('says in every answer which types it does not cover, and that nothing it covers is missing', async () => {
      const { workspace } = await setUp();
      const report = await workspace.impact('fixture', AMOUNT);
      expect(report).toMatchObject({
        snapshot: { id: 1, source: 'fixture', kind: 'git', status: 'complete' },
        component: { key: AMOUNT, type: 'CustomField', name: 'Invoice__c.Amount__c' },
        parts: 0,
        direction: 'incoming',
        depth: null,
        beyondDepth: false,
        minConfidence: 'possible',
        unresolved: [],
        complete: false,
        mayMiss: false,
      });
      // Of the types that are not analysed, the answer names those whose components can name a field: a label, the
      // file of labels, a custom permission, a folder and a global value set cannot (decision record 0073). The
      // table has no line for a named or an external credential yet, so they stay.
      expect(report.notCovered).toEqual({
        notAnalysed: NOT_ANALYSED.filter(([type]) => !NAME_NO_FIELD.includes(type)).map(([type, held]) => ({
          type,
          listed: held,
          retrieved: held,
          listing: 'ok',
        })),
        partial: [],
        readErrors: 0,
        analysisErrors: 0,
        // The path of a flow that is not followed, which the answer key calls unknown. It ends in a field of the
        // name that is asked about.
        analysisWarnings: 1,
        notHeld: 0,
      });
      // The file of labels names labels, and a custom permission names custom permissions: so they stay for an
      // answer about one of their own.
      const named = async (component: string): Promise<string[]> =>
        (await workspace.impact('fixture', component)).notCovered.notAnalysed.map((gap) => gap.type);
      const nameAField = NOT_ANALYSED.map(([type]) => type).filter((type) => !NAME_NO_FIELD.includes(type));
      const and = (type: string): string[] => [...nameAField, type].sort();
      expect(await named('CustomLabel:Overdue_Notice')).toEqual(and('CustomLabels'));
      expect(await named('Approve_Large_Invoices')).toEqual(and('CustomPermission'));
    });

    /** A file of metadata of a type, with the elements that are given. */
    const xml = (type: string, body: string): string =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<${type} xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}</${type}>\n`;

    /**
     * A workspace whose source `work` holds one object with two fields, and nothing of a type that is not
     * analysed. The field `Heavy__c` has the formula that is given. A flow `Ship` on the records of the object
     * has the elements that are given, if any.
     */
    async function parcels(
      formula = 'Weight__c &gt; 30',
      elements?: string,
    ): Promise<{ database: string; workspace: Workspace }> {
      const root = temp.next();
      if (elements !== undefined) {
        const flows = join(root, 'force-app', 'main', 'default', 'flows');
        mkdirSync(flows, { recursive: true });
        const start =
          '    <start>\n        <object>Parcel__c</object>\n        <triggerType>RecordAfterSave</triggerType>\n    </start>\n';
        writeFileSync(
          join(flows, 'Ship.flow-meta.xml'),
          xml('Flow', `    <status>Active</status>\n${start}${elements}`),
        );
      }
      const object = join(root, OBJECTS, 'Parcel__c');
      mkdirSync(join(object, 'fields'), { recursive: true });
      writeFileSync(join(root, 'orglens.toml'), 'schema_version = 1\n[sources.work]\nkind = "git"\n');
      writeFileSync(join(root, 'sfdx-project.json'), '{ "packageDirectories": [{ "path": "force-app" }] }\n');
      writeFileSync(join(object, 'Parcel__c.object-meta.xml'), xml('CustomObject', '    <label>Parcel</label>\n'));
      writeFileSync(
        join(object, 'fields', 'Weight__c.field-meta.xml'),
        xml('CustomField', '    <fullName>Weight__c</fullName>\n    <type>Number</type>\n'),
      );
      writeFileSync(
        join(object, 'fields', 'Heavy__c.field-meta.xml'),
        xml(
          'CustomField',
          `    <fullName>Heavy__c</fullName>\n    <formula>${formula}</formula>\n    <type>Checkbox</type>\n`,
        ),
      );
      const workspace = await openWorkspace({ root, env });
      await workspace.snapshot('work');
      return { database: join(root, '.orglens', 'orglens.db'), workspace };
    }
    const NOTHING = {
      notAnalysed: [],
      partial: [],
      readErrors: 0,
      analysisErrors: 0,
      analysisWarnings: 0,
      notHeld: 0,
    };

    /**
     * A workspace whose source `work` holds an object with a Lightning page for its records, and a second object
     * with a lookup to the first and a rule that reads the lookup. The first object names the page as what
     * overrides its action `View`, unless that is left out. The page can be left out too, and the first object
     * can have a sharing reason.
     */
    async function invoicePage({ overridden = true, page = true, reason = false } = {}): Promise<Workspace> {
      const root = temp.next();
      const invoice = join(root, OBJECTS, 'Invoice__c');
      const payment = join(root, OBJECTS, 'Payment__c');
      const pages = join(root, 'force-app', 'main', 'default', 'flexipages');
      for (const folder of [invoice, join(payment, 'fields'), join(payment, 'validationRules'), pages]) {
        mkdirSync(folder, { recursive: true });
      }
      writeFileSync(join(root, 'orglens.toml'), 'schema_version = 1\n[sources.work]\nkind = "git"\n');
      writeFileSync(join(root, 'sfdx-project.json'), '{ "packageDirectories": [{ "path": "force-app" }] }\n');
      const override = [
        '    <actionOverrides>',
        '        <actionName>View</actionName>',
        '        <content>Invoice_Record_Page</content>',
        '        <formFactor>Large</formFactor>',
        '        <skipRecordTypeSelect>false</skipRecordTypeSelect>',
        '        <type>Flexipage</type>',
        '    </actionOverrides>',
        '',
      ].join('\n');
      writeFileSync(
        join(invoice, 'Invoice__c.object-meta.xml'),
        xml('CustomObject', `${overridden ? override : ''}    <label>Invoice</label>\n`),
      );
      if (page) {
        writeFileSync(
          join(pages, 'Invoice_Record_Page.flexipage-meta.xml'),
          xml('FlexiPage', '    <masterLabel>Invoice record page</masterLabel>\n    <type>RecordPage</type>\n'),
        );
      }
      if (reason) {
        mkdirSync(join(invoice, 'sharingReasons'));
        writeFileSync(
          join(invoice, 'sharingReasons', 'Billed__c.sharingReason-meta.xml'),
          xml('SharingReason', '    <fullName>Billed__c</fullName>\n    <label>Billed</label>\n'),
        );
      }
      writeFileSync(join(payment, 'Payment__c.object-meta.xml'), xml('CustomObject', '    <label>Payment</label>\n'));
      writeFileSync(
        join(payment, 'fields', 'Invoice__c.field-meta.xml'),
        xml(
          'CustomField',
          '    <fullName>Invoice__c</fullName>\n    <referenceTo>Invoice__c</referenceTo>\n    <type>Lookup</type>\n',
        ),
      );
      writeFileSync(
        join(payment, 'validationRules', 'Needs_Invoice.validationRule-meta.xml'),
        xml(
          'ValidationRule',
          '    <fullName>Needs_Invoice</fullName>\n    <errorConditionFormula>ISBLANK(Invoice__c)</errorConditionFormula>\n',
        ),
      );
      const workspace = await openWorkspace({ root, env });
      await workspace.snapshot('work');
      return workspace;
    }

    it('is complete for a snapshot whose every type was analysed', async () => {
      const { workspace } = await parcels();
      const report = await workspace.impact('work', 'Parcel__c.Weight__c');
      expect(outline(report)).toEqual([['CustomField:parcel__c.heavy__c', 1, 'confirmed']]);
      expect(report).toMatchObject({ complete: true, mayMiss: false, notCovered: NOTHING });
      // The other way round too: the snapshot holds both ends.
      expect(await workspace.impact('work', 'Parcel__c.Heavy__c', { outgoing: true })).toMatchObject({
        results: [{ key: 'CustomField:parcel__c.weight__c' }],
        complete: true,
        notCovered: NOTHING,
      });
    });

    it('is not complete when the analysis did not follow a name, and does not call that a miss', async () => {
      // Nothing says where the relationship leads, so the field after it is not looked up. It may be the one
      // that is asked about.
      const { workspace } = await parcels('Mystery__r.Weight__c &gt; 30');
      const report = await workspace.impact('work', 'Parcel__c.Weight__c');
      expect(report.results).toEqual([]);
      expect(report).toMatchObject({
        complete: false,
        mayMiss: false,
        notCovered: { ...NOTHING, analysisWarnings: 1 },
      });
      // The warning is about the formula of Heavy__c. What Heavy__c refers to may lack a field, and what refers to
      // Heavy__c lacks nothing for it: a reference from what is asked about never refers to it. What Weight__c
      // refers to is not walked from Heavy__c (decision record 0074).
      expect(await workspace.impact('work', 'Parcel__c.Heavy__c', { outgoing: true })).toMatchObject({
        complete: false,
        notCovered: { ...NOTHING, analysisWarnings: 1 },
      });
      for (const [component, outgoing] of [
        ['Parcel__c.Heavy__c', false],
        ['Parcel__c.Weight__c', true],
        ['Parcel__c', false],
      ] as const) {
        expect(await workspace.impact('work', component, { outgoing })).toMatchObject({
          complete: true,
          notCovered: NOTHING,
        });
      }
    });

    it('does not count a path that was not followed for an answer that holds nothing its names can be', async () => {
      const { workspace } = await parcels('Mystery__r.Width__c &gt; 30');
      // Width__c can be a field of any object, but not Weight__c: the answer about Weight__c is complete.
      expect(await workspace.impact('work', 'Parcel__c.Weight__c')).toMatchObject({
        complete: true,
        notCovered: NOTHING,
      });
    });

    it('counts a field of a flow element behind a record of no known object for an answer about a field of its name', async () => {
      // The element updates the record behind a lookup the snapshot does not hold, and sets its field Weight__c.
      // Before decision record 0074, only the record had a warning, and that warning did not name the field.
      const { workspace } = await parcels(
        undefined,
        [
          '    <recordUpdates>',
          '        <name>Save_Box</name>',
          '        <inputReference>$Record.ns__Box__r</inputReference>',
          '        <inputAssignments>',
          '            <field>Weight__c</field>',
          '            <value><numberValue>1</numberValue></value>',
          '        </inputAssignments>',
          '    </recordUpdates>',
          '',
        ].join('\n'),
      );
      const counted = async (component: string, outgoing = false): Promise<number> =>
        (await workspace.impact('work', component, { outgoing })).notCovered.analysisWarnings;
      // The field: the warning of the field. The object: that of the record, whose object it can be, and that of
      // the field, which it holds. What refers to Heavy__c: neither. What the element refers to: both.
      expect(await counted('Parcel__c.Weight__c')).toBe(1);
      expect(await counted('Parcel__c')).toBe(2);
      expect(await counted('Parcel__c.Heavy__c')).toBe(0);
      expect(await counted('Ship.Save_Box', true)).toBe(2);
    });

    it('may miss something when the snapshot holds nothing of a type that the analysis reads', async () => {
      const { database, workspace } = await parcels();
      // What an org leaves behind that lists four rules and hands out none, and that cannot list its reports.
      inStore(database, (store) => {
        addCoverage(store, 1, {
          type: 'ValidationRule',
          listed: 4,
          retrieved: 0,
          analysed: 0,
          listing: 'ok',
          note: null,
        });
        addCoverage(store, 1, { type: 'Report', listed: 0, retrieved: 0, analysed: 0, listing: 'failed', note: null });
      });
      const report = await workspace.impact('work', 'Parcel__c.Weight__c');
      // A rule may read the field. Rules are analysed, so the answer claims to cover them, and it cannot.
      expect(report).toMatchObject({
        complete: false,
        mayMiss: true,
        notCovered: {
          ...NOTHING,
          partial: [{ type: 'ValidationRule', listed: 4, retrieved: 0, listing: 'ok' }],
          notAnalysed: [{ type: 'Report', listed: 0, retrieved: 0, listing: 'failed' }],
        },
      });
      // An analysis that an older version wrote kept no list of the types it read.
      inStore(database, (store) => store.run('UPDATE snapshot_analysis SET types = NULL'));
      expect((await workspace.impact('work', 'Parcel__c.Weight__c')).notCovered).toMatchObject({
        partial: [],
        notAnalysed: [{ type: 'Report' }, { type: 'ValidationRule' }],
      });
    });

    it('may miss something when a folder of the source was not read', async () => {
      const { root } = await setUp(0);
      writeFileSync(
        join(root, 'orglens.toml'),
        'schema_version = 1\n[sources.fixture]\nkind = "git"\nrepo = "project"\npaths = ["force-app", "not-there"]\n',
      );
      const again = await openWorkspace({ root, env });
      expect((await again.snapshot('fixture')).snapshot.status).toBe('partial');
      const report = await again.impact('fixture', AMOUNT);
      expect(report.snapshot.status).toBe('partial');
      // 8 fields and validation rules, 10 elements of flows and the 4 flows they are of, an element that calls one
      // of those flows, 2 workflow rules and an outbound message, a field set, 2 records of custom metadata, the
      // email template with the alert that sends it and the element of a flow that starts the alert, the report type
      // and the quick action.
      expect(report.results).toHaveLength(34);
      // The error names no type, so nothing says that what is missing is of a type the answer does not cover.
      expect(report).toMatchObject({ complete: false, mayMiss: true, notCovered: { partial: [], readErrors: 1 } });
    });

    it('may miss something when a file of an analysed type could not be read', async () => {
      const { project, workspace } = await setUp(0);
      writeFileSync(
        join(project, OBJECTS, 'Invoice__c', 'fields', 'Total__c.field-meta.xml'),
        '<CustomField xmlns="x"><label>Total',
      );
      const taken = await workspace.snapshot('fixture');
      expect([taken.snapshot.status, taken.analysis?.complete]).toEqual(['complete', false]);
      const report = await workspace.impact('fixture', AMOUNT);
      // The field that could not be read, and the one that is reached through it, are not in the answer.
      expect(report.results.map((result) => result.key)).not.toContain('CustomField:invoice__c.total__c');
      expect(report.results).toHaveLength(32);
      expect(report).toMatchObject({
        complete: false,
        mayMiss: true,
        notCovered: { partial: [], readErrors: 0, analysisErrors: 1 },
      });
    });

    it('may miss something when a warning outside the logic tier is about a type the answer covers', async () => {
      const { database, workspace } = await setUp();
      const warn = (types: string[]): void => {
        inStore(database, (store) => {
          addIssue(store, 1, {
            severity: 'warning',
            code: 'RESOLVE_FAILED',
            message: 'Something could not be read as metadata.',
            componentKey: null,
            details: { at: 'somewhere', types, tier: 'other' },
          });
        });
      };
      // What a snapshot of an org leaves behind for a file in the folder of a type that is not analysed.
      warn(['CustomTab']);
      expect(await workspace.impact('fixture', AMOUNT)).toMatchObject({
        mayMiss: false,
        notCovered: { readErrors: 0 },
      });
      // A list view is outside the logic tier too. Once the analysis has analysed one, an answer covers the type.
      warn(['ListView', 'Report']);
      expect(await workspace.impact('fixture', AMOUNT)).toMatchObject({
        mayMiss: false,
        notCovered: { readErrors: 0 },
      });
      inStore(database, (store) => {
        addCoverage(store, 1, { type: 'ListView', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null });
      });
      expect(await workspace.impact('fixture', AMOUNT)).toMatchObject({
        complete: false,
        mayMiss: true,
        notCovered: { partial: [], readErrors: 1 },
      });
      // No snapshot is known to hold a warning outside the logic tier about a type an answer covers (decision
      // records 0046 and 0068), so the row is written by hand. An email alert is analysed: every answer covers it.
      warn(['WorkflowAlert']);
      expect(await workspace.impact('fixture', AMOUNT)).toMatchObject({ mayMiss: true, notCovered: { readErrors: 2 } });
    });

    it('may miss something when the snapshot holds an analysed type in part', async () => {
      const { database, workspace } = await setUp();
      // What an org leaves behind when it lists six fields more than it hands out.
      inStore(database, (store) => {
        const fields = readCoverage(store, 1).find((type) => type.type === 'CustomField');
        if (fields === undefined) throw new Error('The snapshot has no fields.');
        addCoverage(store, 1, { ...fields, listed: fields.listed + 6 });
        addCoverage(store, 1, { type: 'Report', listed: 9, retrieved: 2, analysed: 0, listing: 'failed', note: null });
      });
      const report = await workspace.impact('fixture', AMOUNT);
      expect(report).toMatchObject({ complete: false, mayMiss: true });
      expect(report.notCovered.partial).toEqual([{ type: 'CustomField', listed: 65, retrieved: 59, listing: 'ok' }]);
      // A type that is not analysed is named, in part or not. It is not something the answer claims to cover.
      expect(report.notCovered.notAnalysed).toContainEqual({
        type: 'Report',
        listed: 9,
        retrieved: 2,
        listing: 'failed',
      });
    });

    it('answers what a component refers to, and names only the types that matter for that', async () => {
      const { workspace } = await setUp();
      const total = await workspace.impact('fixture', 'Invoice__c.Total__c', { outgoing: true });
      expect(total.direction).toBe('outgoing');
      expect(outline(total)).toEqual([
        [AMOUNT, 1, 'confirmed'],
        ['CustomField:invoice__c.tax_rate__c', 1, 'confirmed'],
      ]);
      expect(total.results[0]?.reference).toMatchObject({ from: 'CustomField:invoice__c.total__c', to: AMOUNT });
      // Both ends were analysed: what a field refers to does not depend on Apex. The one warning of the analysis
      // is about an element of a flow, which the walk does not go from, so the answer is complete (decision
      // record 0074).
      expect(total).toMatchObject({
        complete: true,
        mayMiss: false,
        notCovered: { notAnalysed: [], analysisWarnings: 0, notHeld: 0 },
      });
      // What a flow refers to is walked from its elements, so the warning of one of them counts. What refers to
      // the element does not lack a reference the element names.
      const element = 'Invoice_After_Save.Check_Result';
      expect((await workspace.impact('fixture', 'Invoice_After_Save', { outgoing: true })).notCovered).toMatchObject({
        analysisWarnings: 1,
      });
      expect((await workspace.impact('fixture', element, { outgoing: true })).notCovered).toMatchObject({
        analysisWarnings: 1,
      });
      expect((await workspace.impact('fixture', element)).notCovered).toMatchObject({ analysisWarnings: 0 });
      // The names the path kept are `invoice` and `Amount__c`: what refers to a field of another name, in an
      // answer that holds no object, does not lack the reference either.
      const tax = await workspace.impact('fixture', 'Invoice__c.Tax_Rate__c');
      expect(tax.results.some((one) => one.key.startsWith('CustomObject:'))).toBe(false);
      expect(tax.notCovered).toMatchObject({ analysisWarnings: 0 });

      // What an object contains counts too: the type of custom metadata contains its fields and its records. Two
      // of its fields point at the objects of Salesforce that describe objects and fields, which no repository
      // holds. The records name two objects and a field through those fields, and three fields in a text. A record
      // or a field that points at a field of the type gives no result: both are of what was asked about. Of the
      // fields in a text, one is a formula, and what it reads is found behind it, as probable as the text.
      const settings = await workspace.impact('fixture', 'Billing_Rule__mdt', { outgoing: true });
      expect(settings.parts).toBe(9);
      expect(outline(settings)).toEqual([
        ['CustomField:account.credit_limit__c', 1, 'probable'],
        [AMOUNT, 1, 'confirmed'],
        ['CustomField:invoice__c.late_fee__c', 1, 'probable'],
        ['CustomField:invoice_line__c.quantity__c', 1, 'probable'],
        ['CustomObject:entitydefinition', 1, 'confirmed'],
        ['CustomObject:fielddefinition', 1, 'confirmed'],
        ['CustomObject:invoice__c', 1, 'confirmed'],
        ['CustomObject:invoice_line__c', 1, 'confirmed'],
        ['CustomField:billing_settings__c.grace_days__c', 2, 'probable'],
        ['CustomField:billing_settings__c.late_fee_percent__c', 2, 'probable'],
        ['CustomField:invoice__c.days_overdue__c', 2, 'probable'],
        ['CustomField:invoice__c.due_date__c', 3, 'probable'],
        ['CustomField:invoice__c.status__c', 3, 'probable'],
      ]);
      expect(settings).toMatchObject({
        complete: false,
        notCovered: { notAnalysed: [], notHeld: 2 },
      });

      // A standard field has no file in a repository. What it refers to is not known, and neither is what a
      // result refers to that the snapshot does not hold.
      const standard = await workspace.impact('fixture', 'User.Department', { outgoing: true });
      expect(standard).toMatchObject({
        component: { name: null, file: null },
        results: [],
        complete: false,
        mayMiss: false,
        notCovered: { notAnalysed: [], notHeld: 1 },
      });
      const account = await workspace.impact('fixture', 'Account', { outgoing: true });
      expect(account.results.filter((result) => result.name === null).map((result) => result.key)).toEqual([
        'CustomObject:contact',
      ]);
      expect(account).toMatchObject({ complete: false, notCovered: { notHeld: 1 } });
      // What refers to a component is asked of the components that are held, so this never counts there.
      expect((await workspace.impact('fixture', 'User.Department')).notCovered.notHeld).toBe(0);

      // A rule that reads a custom permission and a record of custom metadata: what the permission refers to is not
      // known. The record refers to its type and to the field it gives a value.
      const rule = await workspace.impact('fixture', 'Invoice__c.Large_Amount_Needs_Permission', { outgoing: true });
      expect([...new Set(rule.results.map((result) => result.type))].sort()).toEqual([
        'CustomField',
        'CustomMetadata',
        'CustomObject',
        'CustomPermission',
      ]);
      expect(rule.notCovered.notAnalysed.map((gap) => gap.type)).toEqual(['CustomPermission']);
      expect(rule).toMatchObject({ complete: false, mayMiss: false });

      // A class is not analysed, so the empty answer is not a finding.
      const apex = await workspace.impact('fixture', 'InvoiceService', { outgoing: true });
      expect(apex).toMatchObject({ results: [], complete: false, component: { key: 'ApexClass:invoiceservice' } });
      expect(apex.notCovered.notAnalysed.map((gap) => gap.type)).toEqual(['ApexClass']);
    });

    it('goes on through an object that names the page of one of its actions, in both directions', async () => {
      // An object refers to the page that overrides one of its actions (decision record 0070), and an answer
      // goes on from an object as from any component it finds. So what refers to the object is found behind the
      // page, each by the reference that leads one step nearer.
      const workspace = await invoicePage();
      const page = await workspace.impact('work', 'Invoice_Record_Page');
      expect(outline(page)).toEqual([
        ['CustomObject:invoice__c', 1, 'confirmed'],
        ['CustomField:payment__c.invoice__c', 2, 'confirmed'],
        ['ValidationRule:payment__c.needs_invoice', 3, 'confirmed'],
      ]);
      expect(page.results.map((result) => [result.reference.from, result.reference.to])).toEqual([
        ['CustomObject:invoice__c', 'FlexiPage:invoice_record_page'],
        ['CustomField:payment__c.invoice__c', 'CustomObject:invoice__c'],
        ['ValidationRule:payment__c.needs_invoice', 'CustomField:payment__c.invoice__c'],
      ]);
      expect(page.notCovered.notAnalysed.map((gap) => gap.type)).toEqual(['FlexiPage']);

      // The other way round, what reaches the object reaches the page. A page is not analysed, so what it refers
      // to is not known, and the answer is not complete. Nothing of what the answer covers is missing.
      const lookup = await workspace.impact('work', 'Payment__c.Invoice__c', { outgoing: true });
      expect(outline(lookup)).toEqual([
        ['CustomObject:invoice__c', 1, 'confirmed'],
        ['FlexiPage:invoice_record_page', 2, 'confirmed'],
      ]);
      expect(lookup).toMatchObject({
        complete: false,
        mayMiss: false,
        notCovered: { ...NOTHING, notAnalysed: [{ type: 'FlexiPage' }] },
      });

      // Without the override the object refers to nothing. Nothing is found behind the page, and what the
      // lookup refers to ends at the object: that answer is complete, though the snapshot holds the page.
      const plain = await invoicePage({ overridden: false });
      expect((await plain.impact('work', 'Invoice_Record_Page')).results).toEqual([]);
      const ends = await plain.impact('work', 'Payment__c.Invoice__c', { outgoing: true });
      expect(outline(ends)).toEqual([['CustomObject:invoice__c', 1, 'confirmed']]);
      expect(ends).toMatchObject({ complete: true, mayMiss: false, notCovered: NOTHING });
    });

    it('names a sharing reason where its object is of the answer, or once another type stays', async () => {
      // A sharing reason names its object (decision record 0073). Without the page, it is the only type that is
      // not analysed, and it cannot refer to the lookup.
      const types = (report: ImpactReport): string[] => report.notCovered.notAnalysed.map((gap) => gap.type);
      const alone = await invoicePage({ overridden: false, page: false, reason: true });
      const lookup = await alone.impact('work', 'Payment__c.Invoice__c');
      expect(outline(lookup)).toEqual([['ValidationRule:payment__c.needs_invoice', 1, 'confirmed']]);
      expect(lookup).toMatchObject({ complete: true, notCovered: NOTHING });
      expect(types(await alone.impact('work', 'Invoice__c'))).toEqual(['SharingReason']);
      // The page is not analysed and may refer to the lookup. The object, which is analysed and no result, refers
      // to the page, and so may the reason through the object.
      const paged = await invoicePage({ reason: true });
      expect(types(await paged.impact('work', 'Payment__c.Invoice__c'))).toEqual(['FlexiPage', 'SharingReason']);
    });

    it('takes a depth and a least confidence, and reports both', async () => {
      const { workspace } = await setUp();
      const near = await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c', { depth: 2 });
      expect(near).toMatchObject({ depth: 2, beyondDepth: true });
      expect(Math.max(...near.results.map((result) => result.depth))).toBe(2);
      const all = await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c', { depth: 3 });
      expect(all).toMatchObject({ depth: 3, beyondDepth: false });
      // A formula field and an element of a flow are reached at the third step.
      expect(all.results.filter((result) => result.depth === 3).map((result) => result.key)).toEqual([
        'CustomField:invoice__c.grand_total__c',
        'Flow:invoice_recalculate#element:compare_totals',
      ]);
      expect(all.results).toHaveLength(near.results.length + 2);
      // A record of custom metadata names the field in a text, which is probable. Every other reference to it, or
      // to what refers to it, is confirmed, so the strictest question gives the same answer without the record.
      const strict = await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c', { minConfidence: 'confirmed' });
      expect(strict.minConfidence).toBe('confirmed');
      const record = 'CustomMetadata:billing_rule.line_quantity';
      expect(outline(all).filter(([key]) => key === record)).toEqual([[record, 1, 'probable']]);
      expect(outline(strict)).toEqual(outline(all).filter(([key]) => key !== record));

      for (const depth of [0, -1, 1.5, Number.NaN]) {
        expect(await failure(() => workspace.impact('fixture', AMOUNT, { depth }))).toMatchObject({
          code: 'INTERNAL',
          message: 'The depth of an impact question is a whole number from 1.',
        });
      }
      expect(
        await failure(() => workspace.impact('fixture', AMOUNT, { minConfidence: 'certain' as ConfidenceTier })),
      ).toMatchObject({ code: 'INTERNAL' });
    });

    it('has no component of a package in a snapshot of a repository, which has no listing', async () => {
      // Decision record 0076. `--packages` changes nothing, in either direction.
      const { workspace } = await setUp();
      for (const outgoing of [false, true]) {
        const answer = await workspace.impact('fixture', AMOUNT, { outgoing });
        expect(await workspace.impact('fixture', AMOUNT, { outgoing, packages: true })).toEqual(answer);
        expect(answer.packagesLeftOut).toBe(0);
        expect([answer.component, ...answer.results].filter((one) => one.package !== null)).toEqual([]);
      }
    });

    it('asks the latest snapshot, or the one that is named', async () => {
      const { project, workspace } = await setUp();
      rmSync(join(project, OBJECTS, 'Invoice__c', 'fields', 'Late_Fee__c.field-meta.xml'));
      await workspace.snapshot('fixture');
      const latest = await workspace.impact('fixture', AMOUNT);
      const first = await workspace.impact('fixture', AMOUNT, { snapshot: 1 });
      expect([latest.snapshot.id, latest.results.length]).toEqual([2, 32]);
      expect([first.snapshot.id, first.results.length]).toEqual([1, 34]);
      // The field is known to the first snapshot only.
      expect((await workspace.impact('fixture', 'Invoice__c.Late_Fee__c', { snapshot: 1 })).component.key).toBe(
        'CustomField:invoice__c.late_fee__c',
      );
      expect(await failure(() => workspace.impact('fixture', 'Invoice__c.Late_Fee__c'))).toMatchObject({
        code: 'COMPONENT_NOT_FOUND',
        details: { component: 'Invoice__c.Late_Fee__c', snapshot: 2 },
      });
    });

    it('refuses a name that fits no component, or several', async () => {
      const { project, workspace } = await setUp(0);
      // A rule with the name of a field.
      cpSync(
        join(project, OBJECTS, 'Invoice__c', 'validationRules', 'Locked_When_Paid.validationRule-meta.xml'),
        join(project, OBJECTS, 'Invoice__c', 'validationRules', 'Amount__c.validationRule-meta.xml'),
      );
      await workspace.snapshot('fixture');
      expect(await failure(() => workspace.impact('fixture', 'Invoice__c.Amount__c'))).toEqual({
        code: 'COMPONENT_AMBIGUOUS',
        message: `"Invoice__c.Amount__c" names 2 components: ${AMOUNT}, ValidationRule:invoice__c.amount__c.`,
        hint: `Name the one you mean by its key, such as ${AMOUNT}.`,
        details: {
          component: 'Invoice__c.Amount__c',
          snapshot: 1,
          candidates: [AMOUNT, 'ValidationRule:invoice__c.amount__c'],
        },
      });
      expect((await workspace.impact('fixture', 'ValidationRule:Invoice__c.Amount__c')).component.type).toBe(
        'ValidationRule',
      );
      expect(await failure(() => workspace.impact('fixture', 'Invoice__c.Nope__c'))).toEqual({
        code: 'COMPONENT_NOT_FOUND',
        message: 'The snapshot knows no component "Invoice__c.Nope__c".',
        hint: 'Name a component by its name, such as Account.Industry, or by its type and name, such as CustomField:Account.Industry.',
        details: { component: 'Invoice__c.Nope__c', snapshot: 1 },
      });
    });

    it('takes the name of an object for the object, and names the file of its workflow rules, which has it too', async () => {
      // A file of workflow rules is a component with the name of its object, on every org with workflow rules.
      // The name alone means the object, and the answer names the other (decision record 0064).
      const { workspace } = await setUp();
      const named = await workspace.impact('fixture', 'Invoice__c');
      expect(named).toMatchObject({ component: { key: 'CustomObject:invoice__c' }, sameName: ['Workflow:invoice__c'] });
      // Asked for by its type or by its key, the object is the same answer, and nothing else is named.
      const { sameName, ...rest } = named;
      for (const asked of ['CustomObject:Invoice__c', 'CustomObject:invoice__c']) {
        expect(await workspace.impact('fixture', asked)).toEqual({ ...rest, sameName: [] });
      }
      expect(sameName).toEqual(['Workflow:invoice__c']);
      expect(await workspace.impact('fixture', 'Workflow:Invoice__c')).toMatchObject({
        component: { key: 'Workflow:invoice__c', type: 'Workflow' },
        sameName: [],
      });
      // A name that fits one component names nothing else.
      expect((await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c')).sameName).toEqual([]);
    });

    it('answers for a file of workflow rules with its rules and actions, which it contains', async () => {
      // The rules and actions of a file are parts of it (decision record 0063). What refers to one of them refers
      // to the file, what one of them refers to is what the file refers to, and they are no result of each other.
      const { workspace } = await setUp();
      const incoming = await workspace.impact('fixture', 'Workflow:Invoice__c');
      expect(incoming.parts).toBe(8);
      // The flow is found beside its element (decision record 0066).
      expect(outline(incoming)).toEqual([
        ['Flow:invoice_after_save', 1, 'confirmed'],
        ['Flow:invoice_after_save#element:send_overdue_alert', 1, 'confirmed'],
      ]);
      for (const result of incoming.results) {
        expect(result.reference).toMatchObject({
          from: 'Flow:invoice_after_save#element:send_overdue_alert',
          to: 'WorkflowAlert:invoice__c.invoice_overdue_alert',
        });
      }

      const outgoing = await workspace.impact('fixture', 'Workflow:Invoice__c', { outgoing: true });
      expect(outgoing.parts).toBe(8);
      const RULE = 'WorkflowRule:invoice__c.stamp_code_when_paid';
      const STAMP = 'WorkflowFieldUpdate:invoice__c.stamp_legacy_code';
      const ALERT = 'WorkflowAlert:invoice__c.invoice_overdue_alert';
      const MESSAGE = 'WorkflowOutboundMessage:invoice__c.notify_ledger';
      expect(
        outgoing.results
          .filter((result) => result.depth === 1)
          .map((result) => [result.key, result.reference.kind, result.reference.from]),
      ).toEqual([
        ['CustomField:account.is_key_account__c', 'reads', RULE],
        ['CustomField:account.name', 'reads', STAMP],
        ['CustomField:billing_settings__c.grace_days__c', 'reads', RULE],
        ['CustomField:invoice__c.account__c', 'reads', STAMP],
        [AMOUNT, 'reads', MESSAGE],
        ['CustomField:invoice__c.approver__c', 'reads', ALERT],
        ['CustomField:invoice__c.billing_contact__c', 'reads', ALERT],
        ['CustomField:invoice__c.due_date__c', 'reads', MESSAGE],
        ['CustomField:invoice__c.legacy_code__c', 'writes', STAMP],
        ['CustomField:invoice__c.paid_date__c', 'reads', RULE],
        ['CustomField:invoice__c.status__c', 'reads', STAMP],
        ['CustomField:invoice__c.sub_status__c', 'writes', 'WorkflowFieldUpdate:invoice__c.set_sub_status_reminder'],
        ['EmailTemplate:billing/invoice_overdue', 'references', ALERT],
      ]);
      expect(outgoing.results.filter((result) => result.type.startsWith('Workflow'))).toEqual([]);
      // The email template is analysed, and the walk goes on from it to the fields it names. Eight of the fields
      // and objects the walk reaches are provided by Salesforce, and the snapshot does not hold them.
      expect(outgoing).toMatchObject({ complete: false, notCovered: { notAnalysed: [], notHeld: 8 } });
    });

    it('refuses a snapshot that was never analysed, and says how to analyse it', async () => {
      const { database, workspace } = await setUp();
      // A snapshot as a version before the analysis left it: finished, and without an analysis.
      const old = inStore(database, (store) =>
        insertSnapshot(store, {
          sourceId: ensureSource(store, { name: 'fixture', kind: 'git', createdAt: T0 }),
          status: 'complete',
          startedAt: T0,
          finishedAt: T0,
          engineVersion: '0.0.0',
          gitCommit: null,
        }),
      );
      const expected = {
        code: 'SNAPSHOT_NOT_ANALYSED',
        message: `Snapshot ${String(old)} of the source "fixture" was not analysed, so nothing is known about what refers to what in it.`,
        hint: `Analyse it with: orglens analyse fixture --snapshot ${String(old)}`,
        details: { source: 'fixture', snapshot: old },
      };
      // It is the latest snapshot of the source, and the one that is named.
      expect(await failure(() => workspace.impact('fixture', AMOUNT))).toEqual(expected);
      expect(await failure(() => workspace.impact('fixture', AMOUNT, { snapshot: old }))).toEqual(expected);
      expect((await workspace.impact('fixture', AMOUNT, { snapshot: 1 })).results).toHaveLength(34);
    });

    it('refuses a source without a snapshot, and a snapshot that has not ended or was given up', async () => {
      const { database, workspace } = await setUp(0);
      // No database yet, and a database without a snapshot of the source.
      const none = { code: 'SNAPSHOT_NOT_FOUND', message: 'There is no snapshot of the source "fixture" yet.' };
      expect(await failure(() => workspace.impact('fixture', AMOUNT))).toMatchObject(none);
      expect(await failure(() => workspace.impact('nope', AMOUNT))).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
      await workspace.snapshot('fixture');
      expect(await failure(() => workspace.impact('prod', AMOUNT))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'There is no snapshot of the source "prod" yet.',
      });
      expect(await failure(() => workspace.impact('fixture', AMOUNT, { snapshot: 7 }))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'The source "fixture" has no snapshot 7.',
      });

      const [running, givenUp] = inStore(database, (store) => {
        const sourceId = ensureSource(store, { name: 'prod', kind: 'org', createdAt: T0 });
        return (['running', 'failed'] as const).map((status) =>
          insertSnapshot(store, {
            sourceId,
            status,
            startedAt: T0,
            finishedAt: null,
            engineVersion: '0.0.0',
            apiVersion: '66.0',
            gitCommit: null,
          }),
        );
      });
      expect(await failure(() => workspace.impact('prod', AMOUNT, { snapshot: running }))).toEqual({
        code: 'SNAPSHOT_NOT_FOUND',
        message: `Snapshot ${String(running)} of the source "prod" has not ended, so nothing can be asked of it.`,
        hint: 'It is continued and then analysed by: orglens snapshot prod',
        details: { source: 'prod', snapshot: running, status: 'running' },
      });
      expect(await failure(() => workspace.impact('prod', AMOUNT, { snapshot: givenUp }))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        details: { source: 'prod', snapshot: givenUp, status: 'failed' },
      });
    });

    it('reads only: a question leaves the database as it was', async () => {
      const { database, workspace } = await setUp();
      const rows = (): unknown =>
        inStore(database, (store) =>
          ['component', 'component_version', 'reference', 'snapshot_component', 'snapshot_issue'].map(
            (table) => store.get(`SELECT count(*) AS n FROM ${table}`)?.['n'],
          ),
        );
      const before = rows();
      await workspace.impact('fixture', 'CustomObject:Invoice__c');
      await failure(() => workspace.impact('fixture', 'Invoice__c.Nope__c'));
      expect(rows()).toEqual(before);
    });

    it('takes the key of a component as it is written in an answer', async () => {
      const { workspace } = await setUp();
      const byName = await workspace.impact('fixture', 'Invoice__c.Amount__c');
      for (const named of [
        AMOUNT,
        'CustomField:Invoice__c.Amount__c',
        buildKey({ type: 'customfield', fullName: 'INVOICE__C.AMOUNT__C' }),
      ]) {
        expect(timeless(await workspace.impact('fixture', named))).toEqual(timeless(byName));
      }
    });
  },
);

/** NPSP, a public codebase of `fixtures/corpora.toml`, where `pnpm run corpora:fetch` downloaded it. */
const NPSP = join(import.meta.dirname, '../../../.corpora/npsp');

describe('an impact question about a repository of a package project', () => {
  it.skipIf(!existsSync(NPSP))(
    'takes the components of NPSP for its own, also those named after a component of another package',
    async () => {
      const root = temp.next();
      cpSync(join(NPSP, 'force-app'), join(root, 'npsp', 'force-app'), { recursive: true });
      cpSync(join(NPSP, 'sfdx-project.json'), join(root, 'npsp', 'sfdx-project.json'));
      writeFileSync(join(root, 'orglens.toml'), 'schema_version = 1\n[sources.npsp]\nkind = "git"\nrepo = "npsp"\n');
      const workspace = await openWorkspace({ root, env: {} });
      const report = await workspace.snapshot('npsp');
      expect(report.types.filter((type) => type.packaged > 0)).toEqual([]);
      // NPSP holds the tab of an object of another package of the same family, and reads its fields.
      expect(report.types.find((type) => type.type === 'CustomTab')?.listed).toBeGreaterThan(0);
      const answer = await workspace.impact('npsp', 'Contact.npo02__TotalOppAmount__c', { packages: false });
      expect(answer.results).not.toEqual([]);
      expect(answer.packagesLeftOut).toBe(0);
      expect([answer.component, ...answer.results].filter((one) => one.package !== null)).toEqual([]);
    },
    120_000,
  );
});
