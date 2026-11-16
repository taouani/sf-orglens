/**
 * `impact`: what refers to a component in a snapshot (decision record 0044), asked through the workspace.
 *
 * The answers for the fixture project are held against two things: golden files, which a person reviews, and the
 * answer key, from which a test works out what every answer must be. `engines-impact.test.ts` has the rules of
 * the walk on graphs written for them.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ImpactReport } from '../src/api/impact.ts';
import { openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { buildKey, parentKey, type ComponentKey } from '../src/core/keys.ts';
import { CONFIDENCE_TIERS, type ConfidenceTier } from '../src/core/references.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { addCoverage, ensureSource, insertSnapshot, readCoverage } from '../src/store/snapshots.ts';
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

/** A report without the moment its snapshot was taken, which is the one thing that differs from run to run. */
const timeless = (report: ImpactReport): unknown => ({
  ...report,
  snapshot: { ...report.snapshot, finishedAt: 'TIME' },
});

/** What a test compares of an answer: each result with its depth and its confidence. */
const outline = (report: ImpactReport): unknown[] =>
  report.results.map((result) => [result.key, result.depth, result.confidence]);

/** The types of the fixture project that no analyser reads in this phase. */
const NOT_ANALYSED = [
  'ApexClass',
  'ApexTrigger',
  'CustomLabel',
  'CustomLabels',
  'CustomMetadata',
  'CustomPermission',
  'GlobalValueSet',
];

/** The questions whose answers are golden files, as the plan of the phase lists them. */
const GOLDEN: readonly (readonly [string, string, string])[] = [
  ['a field that formulas and rules read', 'Invoice__c.Amount__c', 'amount'],
  ['a field of a standard object', 'Account.Tier__c', 'account-tier'],
  ['a standard field', 'User.Department', 'standard-field'],
  ['an object', 'Invoice__c', 'object'],
  ['a field that nothing refers to', 'Invoice__c.Unused_Field__c', 'unreferenced'],
  ['a field that is reached through a chain of formulas', 'Invoice_Line__c.Quantity__c', 'chain'],
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

    it('gives every component of the fixture the answer that the answer key implies', async () => {
      const { workspace } = await setUp();
      const answers = loadAnswerKey();
      // What the analysers of this phase must find: the references of fields and rules.
      const keyed = answers.references.filter((reference) => reference.phase === 1);
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

      // Every component a reference of the key starts from or points at, and every component the key lists
      // of the types that are analysed. An object is asked about too when the key names only a field of it.
      const asked = new Set<ComponentKey>();
      for (const one of keyed.flatMap((reference) => [reference.from, reference.to])) asked.add(one);
      for (const one of answers.components) {
        if (['CustomObject', 'CustomField', 'ValidationRule'].includes(one.type)) asked.add(one.key);
      }
      for (const one of [...asked]) {
        const parent = parentKey(one);
        if (parent !== undefined) asked.add(parent);
      }

      /** The answer for a component, from the key alone: level by level, the most certain way to each. */
      const implied = (start: ComponentKey): unknown[] => {
        const reached = new Map<ComponentKey, { depth: number; tier: ConfidenceTier }>();
        let level = [...asked].filter((one) => one === start || parentKey(one) === start);
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
        // followed from result to result, and ends at the component or at something it contains.
        for (const result of report.results) {
          const chain = chainOf(report.results, result);
          expect(chain).toHaveLength(result.depth);
          expect(chain.map(placeOf).filter((step) => !places.has(step))).toEqual([]);
          expect(result.reference.from).toBe(result.key);
          chain.forEach((step, at) => {
            expect(step.to).toBe(chain[at + 1]?.from ?? step.to);
          });
          const last = chain.at(-1)?.to;
          expect(last === component || (last !== undefined && parentKey(last) === component)).toBe(true);
        }
        results += report.results.length;
      }
      // The numbers say that the loop asked what it was meant to ask. They move with the fixture.
      expect(asked.size).toBe(96);
      expect(results).toBe(141);

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
      expect(report.notCovered).toEqual({
        notAnalysed: NOT_ANALYSED.map((type) => ({
          type,
          listed: type === 'ApexClass' ? 12 : 1,
          retrieved: type === 'ApexClass' ? 12 : 1,
          listing: 'ok',
        })),
        partial: [],
        readErrors: 0,
        analysisErrors: 0,
      });
    });

    it('is complete for a snapshot whose every type was analysed', async () => {
      const root = temp.next();
      const object = join(root, OBJECTS, 'Parcel__c');
      mkdirSync(join(object, 'fields'), { recursive: true });
      writeFileSync(join(root, 'orglens.toml'), 'schema_version = 1\n[sources.work]\nkind = "git"\n');
      writeFileSync(join(root, 'sfdx-project.json'), '{ "packageDirectories": [{ "path": "force-app" }] }\n');
      const xml = (type: string, body: string): string =>
        `<?xml version="1.0" encoding="UTF-8"?>\n<${type} xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}</${type}>\n`;
      writeFileSync(join(object, 'Parcel__c.object-meta.xml'), xml('CustomObject', '    <label>Parcel</label>\n'));
      writeFileSync(
        join(object, 'fields', 'Weight__c.field-meta.xml'),
        xml('CustomField', '    <fullName>Weight__c</fullName>\n    <type>Number</type>\n'),
      );
      writeFileSync(
        join(object, 'fields', 'Heavy__c.field-meta.xml'),
        xml(
          'CustomField',
          '    <fullName>Heavy__c</fullName>\n    <formula>Weight__c &gt; 30</formula>\n    <type>Checkbox</type>\n',
        ),
      );
      const workspace = await openWorkspace({ root, env });
      await workspace.snapshot('work');
      const report = await workspace.impact('work', 'Parcel__c.Weight__c');
      expect(outline(report)).toEqual([['CustomField:parcel__c.heavy__c', 1, 'confirmed']]);
      expect(report).toMatchObject({
        complete: true,
        mayMiss: false,
        notCovered: { notAnalysed: [], partial: [], readErrors: 0, analysisErrors: 0 },
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
      expect(report.results).toHaveLength(7);
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
      expect(report.results).toHaveLength(5);
      expect(report).toMatchObject({
        complete: false,
        mayMiss: true,
        notCovered: { partial: [], readErrors: 0, analysisErrors: 1 },
      });
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
      expect(report.notCovered.partial).toEqual([{ type: 'CustomField', listed: 60, retrieved: 54, listing: 'ok' }]);
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
      // Both ends were analysed: what a field refers to does not depend on Apex.
      expect(total).toMatchObject({ complete: true, mayMiss: false, notCovered: { notAnalysed: [] } });

      // A rule that reads a custom permission and a record of custom metadata: what those refer to is not known.
      const rule = await workspace.impact('fixture', 'Invoice__c.Large_Amount_Needs_Permission', { outgoing: true });
      expect([...new Set(rule.results.map((result) => result.type))].sort()).toEqual([
        'CustomField',
        'CustomMetadata',
        'CustomPermission',
      ]);
      expect(rule.notCovered.notAnalysed.map((gap) => gap.type)).toEqual(['CustomMetadata', 'CustomPermission']);
      expect(rule).toMatchObject({ complete: false, mayMiss: false });

      // A class is not analysed, so the empty answer is not a finding.
      const apex = await workspace.impact('fixture', 'InvoiceService', { outgoing: true });
      expect(apex).toMatchObject({ results: [], complete: false, component: { key: 'ApexClass:invoiceservice' } });
      expect(apex.notCovered.notAnalysed.map((gap) => gap.type)).toEqual(['ApexClass']);
    });

    it('takes a depth and a least confidence, and reports both', async () => {
      const { workspace } = await setUp();
      const near = await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c', { depth: 2 });
      expect(near).toMatchObject({ depth: 2, beyondDepth: true });
      expect(Math.max(...near.results.map((result) => result.depth))).toBe(2);
      const all = await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c', { depth: 3 });
      expect(all).toMatchObject({ depth: 3, beyondDepth: false });
      expect(all.results).toHaveLength(near.results.length + 1);
      // Every reference of the fixture is confirmed, so the strictest question gives the same answer.
      const strict = await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c', { minConfidence: 'confirmed' });
      expect(strict.minConfidence).toBe('confirmed');
      expect(outline(strict)).toEqual(outline(await workspace.impact('fixture', 'Invoice_Line__c.Quantity__c')));

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

    it('asks the latest snapshot, or the one that is named', async () => {
      const { project, workspace } = await setUp();
      rmSync(join(project, OBJECTS, 'Invoice__c', 'fields', 'Late_Fee__c.field-meta.xml'));
      await workspace.snapshot('fixture');
      const latest = await workspace.impact('fixture', AMOUNT);
      const first = await workspace.impact('fixture', AMOUNT, { snapshot: 1 });
      expect([latest.snapshot.id, latest.results.length]).toEqual([2, 6]);
      expect([first.snapshot.id, first.results.length]).toEqual([1, 7]);
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
      expect((await workspace.impact('fixture', AMOUNT, { snapshot: 1 })).results).toHaveLength(7);
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
      await workspace.impact('fixture', 'Invoice__c');
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
