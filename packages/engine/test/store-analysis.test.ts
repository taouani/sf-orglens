/**
 * The analysis of a snapshot in the store: components, their versions and their references, written by
 * `writeAnalysis` and read through `sqlGraph`.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '../src/core/errors.ts';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import {
  CONFIDENCE_TIERS,
  REFERENCE_KINDS,
  REFERENCE_ORIGINS,
  RESOLUTIONS,
  validateReference,
  type Reference,
} from '../src/core/references.ts';
import {
  PARTS_NOTE,
  readAnalysis,
  readOriginCoverage,
  REFERENCE_CODES,
  writeAnalysis,
  type AnalysedComponent,
  type Analysis,
  type OriginWork,
} from '../src/store/analysis.ts';
import {
  sqlGraph,
  type GraphComponent,
  type GraphEdge,
  type GraphLink,
  type GraphReference,
} from '../src/store/graph.ts';
import { MIGRATIONS } from '../src/store/migrate.ts';
import type { SqlValue } from '../src/store/driver.ts';
import { openStore, type Store } from '../src/store/open.ts';
import {
  addCoverage,
  addIssue,
  addSnapshotFile,
  countIssues,
  ensureSource,
  insertSnapshot,
  readIssues,
  readSnapshot,
} from '../src/store/snapshots.ts';
import { insertSnapshotBeforeLayout } from './helpers/old-store.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const T1 = '2026-01-31T09:30:05.250Z';

const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });
const keysOf = (components: readonly GraphComponent[]): ComponentKey[] => components.map((one) => one.key);
const sha = (text: string): Uint8Array => new Uint8Array(createHash('sha256').update(text).digest());

const INVOICE = key('CustomObject', 'Invoice__c');
const AMOUNT = key('CustomField', 'Invoice__c.Amount__c');
const TOTAL = key('CustomField', 'Invoice__c.Total__c');
const RULE = key('ValidationRule', 'Invoice__c.Amount_Positive');
const ACCOUNT = key('CustomObject', 'Account');
const ACCOUNT_NAME = key('CustomField', 'Account.Name');
const OBJECT_FILE = 'objects/Invoice__c/Invoice__c.object-meta.xml';
const TOTAL_FILE = 'objects/Invoice__c/fields/Total__c.field-meta.xml';
const RULE_FILE = 'objects/Invoice__c/validationRules/Amount_Positive.validationRule-meta.xml';

/** A reference that a parser found, checked against the vocabulary. */
function reference(
  from: ComponentKey,
  to: ComponentKey,
  file: string,
  line: number,
  more: Partial<Reference> = {},
): Reference {
  return validateReference({
    from,
    to,
    toType: to.slice(0, to.indexOf(':')),
    toNameRaw: to.slice(to.indexOf('.') + 1),
    kind: 'reads',
    origin: 'parser:formula',
    confidence: 'confirmed',
    resolution: 'resolved',
    location: { file, line, column: 5 },
    ...more,
  });
}

function component(
  componentKey: ComponentKey,
  name: string,
  path: string | null,
  references: readonly Reference[] = [],
  attrs: Record<string, JsonValue> | null = null,
): AnalysedComponent {
  return {
    key: componentKey,
    name,
    definition: path === null ? null : { path, contentHash: sha(`${path} v1`) },
    attrs,
    references,
  };
}

/** A small project: an object, two fields and a rule, with five references of every shape the store holds. */
function project(): AnalysedComponent[] {
  return [
    component(INVOICE, 'Invoice__c', OBJECT_FILE, [], { customSetting: false }),
    component(AMOUNT, 'Invoice__c.Amount__c', 'objects/Invoice__c/fields/Amount__c.field-meta.xml', [], {
      type: 'Currency',
    }),
    component(
      TOTAL,
      'Invoice__c.Total__c',
      TOTAL_FILE,
      [
        reference(TOTAL, AMOUNT, TOTAL_FILE, 7),
        // A standard field that no file defines keeps its key.
        reference(TOTAL, ACCOUNT_NAME, TOTAL_FILE, 7, {
          resolution: 'external',
          location: { file: TOTAL_FILE, line: 7, column: 31 },
        }),
        // A name that was not found has no key, and keeps its type and its spelling.
        validateReference({
          from: TOTAL,
          to: null,
          toType: 'CustomField',
          toNameRaw: 'Dicsount__c',
          kind: 'reads',
          origin: 'parser:formula',
          confidence: 'confirmed',
          resolution: 'unresolved',
          location: { file: TOTAL_FILE, line: 8, column: 3 },
        }),
      ],
      { type: 'Currency', formula: true },
    ),
    component(RULE, 'Invoice__c.Amount_Positive', RULE_FILE, [
      reference(RULE, AMOUNT, RULE_FILE, 4, { attrs: { compared: 'Paid', nested: { b: 2, a: 1 } } }),
      // What Salesforce reports has no place.
      validateReference({
        from: RULE,
        to: AMOUNT,
        toType: 'CustomField',
        toNameRaw: 'Amount__c',
        kind: 'references',
        origin: 'dependency-api',
        confidence: 'confirmed',
        resolution: 'resolved',
      }),
    ]),
    // A standard object of which the source holds nothing but a mention.
    component(ACCOUNT, 'Account', null),
  ];
}

const analysisOf = (components: Iterable<AnalysedComponent>, more: Partial<Analysis> = {}): Analysis => ({
  engineVersion: '0.2.0',
  analysedAt: T1,
  types: ['CustomObject', 'ValidationRule', 'CustomField'],
  components,
  work: [
    { origin: 'parser:formula', components: 2, failedFiles: 0 },
    { origin: 'dependency-api', components: 5, failedFiles: 0 },
  ],
  issues: [],
  ...more,
});

describe.each(DRIVERS)('the analysis of a snapshot with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = (): Store => openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });
  const snapshot = (store: Store, name = 'repo'): number =>
    store.write(() =>
      insertSnapshot(store, {
        sourceId: ensureSource(store, { name, kind: 'git', createdAt: T0 }),
        status: 'complete',
        startedAt: T0,
        finishedAt: T0,
        engineVersion: '0.2.0',
        gitCommit: 'a'.repeat(40),
      }),
    );
  const count = (store: Store, table: string): number => Number(store.get(`SELECT count(*) AS n FROM ${table}`)?.['n']);
  const counts = (store: Store): Record<string, number> =>
    Object.fromEntries(
      ['component', 'component_version', 'reference', 'snapshot_component', 'file_path', 'snapshot_analysis'].map(
        (table) => [table, count(store, table)],
      ),
    );

  it('counts per type the components it read something of, in the coverage of the snapshot', () => {
    const store = open();
    const id = snapshot(store);
    const coverage = (): unknown[] =>
      store.all('SELECT type, listed, retrieved, analysed, note FROM snapshot_type_coverage ORDER BY type');
    store.write(() => {
      addCoverage(store, id, { type: 'CustomObject', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null });
      addCoverage(store, id, { type: 'ApexClass', listed: 3, retrieved: 2, analysed: 0, listing: 'ok', note: 'Kept.' });
    });
    writeAnalysis(store, id, analysisOf(project()));
    // The object and two fields have attributes. The rule and the object without a file have none: they have a
    // row and were not read. The source listed no field, so the analysis adds the row of that type.
    expect(coverage()).toEqual([
      { type: 'ApexClass', listed: 3, retrieved: 2, analysed: 0, note: 'Kept.' },
      { type: 'CustomField', listed: 0, retrieved: 0, analysed: 2, note: PARTS_NOTE },
      { type: 'CustomObject', listed: 1, retrieved: 1, analysed: 1, note: null },
    ]);

    // An analysis that replaces it replaces the numbers too, and takes back the row that only it had added.
    writeAnalysis(
      store,
      id,
      analysisOf([component(RULE, 'Invoice__c.Amount_Positive', RULE_FILE, [], { active: true })], { work: [] }),
    );
    expect(coverage()).toEqual([
      { type: 'ApexClass', listed: 3, retrieved: 2, analysed: 0, note: 'Kept.' },
      { type: 'CustomObject', listed: 1, retrieved: 1, analysed: 0, note: null },
      { type: 'ValidationRule', listed: 0, retrieved: 0, analysed: 1, note: PARTS_NOTE },
    ]);

    // The coverage of another snapshot is not touched.
    const other = snapshot(store, 'other');
    writeAnalysis(store, other, analysisOf(project()));
    expect(
      store.all('SELECT type, analysed FROM snapshot_type_coverage WHERE snapshot_id = ? ORDER BY type', id),
    ).toEqual([
      { type: 'ApexClass', analysed: 0 },
      { type: 'CustomObject', analysed: 0 },
      { type: 'ValidationRule', analysed: 1 },
    ]);
    store.close();
  });

  it('writes the components of a snapshot and says what it wrote', () => {
    const store = open();
    const id = snapshot(store);
    expect(readAnalysis(store, id)).toBeUndefined();
    expect(writeAnalysis(store, id, analysisOf(project()))).toEqual({
      components: 5,
      references: 5,
      versionsAdded: 5,
      versionsRemoved: 0,
    });
    expect(readAnalysis(store, id)).toEqual({
      engineVersion: '0.2.0',
      analysedAt: T1,
      components: 5,
      references: 5,
      // Sorted, whatever order they were given in.
      types: ['CustomField', 'CustomObject', 'ValidationRule'],
      crossCheck: null,
    });
    // An analysis that a version before schema 5 wrote kept no list.
    store.write(() => store.run('UPDATE snapshot_analysis SET types = NULL WHERE snapshot_id = ?', id));
    expect(readAnalysis(store, id)?.types).toBeNull();
    store.write(() =>
      store.run(`UPDATE snapshot_analysis SET types = '["CustomField","CustomObject","ValidationRule"]'`),
    );
    // Five components and the standard field that is only referred to. Four files: the object without a file has none.
    expect(counts(store)).toEqual({
      component: 6,
      component_version: 5,
      reference: 5,
      snapshot_component: 5,
      file_path: 4,
      snapshot_analysis: 1,
    });
    store.close();
  });

  // `validateReference` lets nothing through that the database holds as something else.
  it('holds the largest place and a name outside the basic plane as they are', () => {
    const store = open();
    const id = snapshot(store);
    const location = { file: TOTAL_FILE, line: Number.MAX_SAFE_INTEGER, column: Number.MAX_SAFE_INTEGER };
    const written = reference(TOTAL, AMOUNT, TOTAL_FILE, 1, { location, toNameRaw: 'Amount__c \u{1F600}' });
    writeAnalysis(
      store,
      id,
      analysisOf([
        component(AMOUNT, 'Invoice__c.Amount__c', null),
        component(TOTAL, 'Invoice__c.Total__c', TOTAL_FILE, [written]),
      ]),
    );
    const graph = sqlGraph(store, id);
    const [read] = graph.referencesFrom(graph.find(TOTAL)?.id ?? 0);
    expect(read?.location).toEqual(location);
    expect(read?.toNameRaw).toBe('Amount__c \u{1F600}');
    store.close();
  });

  it('gives back a component with its name, its file and its attributes', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const graph = sqlGraph(store, id);
    const total = graph.find(TOTAL);
    expect(total).toEqual({
      id: total?.id,
      key: TOTAL,
      parentId: graph.find(INVOICE)?.id,
      version: { name: 'Invoice__c.Total__c', path: TOTAL_FILE, attrs: { formula: true, type: 'Currency' } },
    });
    expect(graph.component(total?.id ?? 0)).toEqual(total);
    // A component the source names and does not define.
    expect(graph.find(ACCOUNT)?.version).toEqual({ name: 'Account', path: null, attrs: null });
    // A component the snapshot does not hold, and refers to.
    expect(graph.find(ACCOUNT_NAME)).toEqual({
      id: graph.find(ACCOUNT_NAME)?.id,
      key: ACCOUNT_NAME,
      parentId: graph.find(ACCOUNT)?.id,
      version: null,
    });
    expect(graph.find(key('CustomField', 'Invoice__c.Nothing__c'))).toBeUndefined();
    expect(graph.component(123_456)).toBeUndefined();
    store.close();
  });

  it('gives back the references of a component, in the order of their places', () => {
    const store = open();
    const id = snapshot(store);
    const written = project();
    writeAnalysis(store, id, analysisOf(written));
    const graph = sqlGraph(store, id);
    const plain = (found: GraphReference): unknown =>
      Object.fromEntries(Object.entries(found).filter(([name]) => name !== 'fromId' && name !== 'toId'));
    const total = graph.find(TOTAL);
    const from = graph.referencesFrom(total?.id ?? 0);
    // What comes back is what was written: every field of a reference, and nothing more.
    expect(from.map(plain)).toEqual(written[2]?.references);
    expect(from.map(({ fromId, toId }) => [fromId, toId])).toEqual([
      [total?.id, graph.find(AMOUNT)?.id],
      [total?.id, graph.find(ACCOUNT_NAME)?.id],
      [total?.id, null],
    ]);
    // A reference without a place comes before those with one.
    const rule = graph.referencesFrom(graph.find(RULE)?.id ?? 0);
    expect(rule.map(plain)).toEqual([written[3]?.references[1], written[3]?.references[0]]);
    expect(rule[0]?.location).toBeUndefined();
    expect(rule[1]?.attrs).toEqual({ compared: 'Paid', nested: { a: 1, b: 2 } });
    expect(graph.referencesFrom(graph.find(INVOICE)?.id ?? 0)).toEqual([]);
    store.close();
  });

  it('gives back the references that point at a component, also at one the snapshot does not hold', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const graph = sqlGraph(store, id);
    const to = graph.referencesTo(graph.find(AMOUNT)?.id ?? 0);
    expect(to.map(({ from, kind, origin, location }) => [from, kind, origin, location?.line])).toEqual([
      [TOTAL, 'reads', 'parser:formula', 7],
      [RULE, 'references', 'dependency-api', undefined],
      [RULE, 'reads', 'parser:formula', 4],
    ]);
    expect(
      graph.referencesTo(graph.find(ACCOUNT_NAME)?.id ?? 0).map(({ from, resolution }) => [from, resolution]),
    ).toEqual([[TOTAL, 'external']]);
    expect(graph.referencesTo(graph.find(TOTAL)?.id ?? 0)).toEqual([]);
    store.close();
  });

  it('gives back what a component contains: what the snapshot holds and what it refers to', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const graph = sqlGraph(store, id);
    expect(keysOf(graph.childrenOf(graph.find(INVOICE)?.id ?? 0))).toEqual([AMOUNT, TOTAL, RULE].sort());
    expect(graph.childrenOf(graph.find(ACCOUNT)?.id ?? 0).map((child) => [child.key, child.version])).toEqual([
      [ACCOUNT_NAME, null],
    ]);
    expect(graph.childrenOf(graph.find(AMOUNT)?.id ?? 0)).toEqual([]);
    store.close();
  });

  it('gives back everything below a component, and nothing for one that contains nothing', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const graph = sqlGraph(store, id);
    const idOf = (componentKey: ComponentKey): number => graph.find(componentKey)?.id ?? 0;
    expect(graph.below(idOf(INVOICE)).sort()).toEqual([idOf(AMOUNT), idOf(TOTAL), idOf(RULE)].sort());
    expect(graph.below(idOf(ACCOUNT))).toEqual([idOf(ACCOUNT_NAME)]);
    expect(graph.below(idOf(AMOUNT))).toEqual([]);
    expect(graph.below(123_456)).toEqual([]);
    store.close();
  });

  it('gives back many components at once, each as it is asked for alone', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const graph = sqlGraph(store, id);
    const all = [INVOICE, AMOUNT, TOTAL, RULE, ACCOUNT, ACCOUNT_NAME].map((one) => graph.find(one));
    const ids = all.map((one) => one?.id ?? 0);
    const byId = (a: GraphComponent, b: GraphComponent): number => a.id - b.id;
    // An id the database does not know is left out, and so is nothing else.
    expect(graph.components([...ids, 123_456]).sort(byId)).toEqual(all.filter((one) => one !== undefined).sort(byId));
    expect(graph.components([])).toEqual([]);
    store.close();
  });

  it('gives back the references at many components at once: first their ends, then the rest of those asked for', () => {
    const store = open();
    const id = snapshot(store);
    const written = project();
    writeAnalysis(store, id, analysisOf(written));
    const graph = sqlGraph(store, id);
    const idOf = (componentKey: ComponentKey): number => graph.find(componentKey)?.id ?? 0;
    /** The links with the rest of each: the two calls a walk makes. */
    const whole = (links: readonly GraphLink[]): GraphEdge[] => graph.edges(links);
    const plain = ({ fromId, toId, kind, origin, location }: GraphEdge): unknown => [
      fromId,
      toId,
      kind,
      origin,
      location?.line ?? null,
    ];
    const sorted = (edges: readonly GraphEdge[]): unknown[] => edges.map(plain).sort();

    const to = graph.linksTo([idOf(AMOUNT), idOf(ACCOUNT_NAME), idOf(TOTAL)]);
    expect(sorted(whole(to))).toEqual(
      [
        [idOf(TOTAL), idOf(AMOUNT), 'reads', 'parser:formula', 7],
        [idOf(RULE), idOf(AMOUNT), 'references', 'dependency-api', null],
        [idOf(RULE), idOf(AMOUNT), 'reads', 'parser:formula', 4],
        [idOf(TOTAL), idOf(ACCOUNT_NAME), 'reads', 'parser:formula', 7],
      ].sort(),
    );
    // A link is the two ends of a reference and its confidence. The rest comes in the order of the links.
    expect(to.map(({ fromId, toId, confidence }) => [fromId, toId, confidence]).sort()).toEqual(
      whole(to)
        .map(({ fromId, toId, confidence }) => [fromId, toId, confidence])
        .sort(),
    );
    expect(whole([...to].reverse())).toEqual(whole(to).reverse());
    // An edge is the reference without its keys and its attributes, and with the type of its target.
    expect(whole(graph.linksTo([idOf(ACCOUNT_NAME)]))).toEqual([
      {
        fromId: idOf(TOTAL),
        toId: idOf(ACCOUNT_NAME),
        toType: 'CustomField',
        toNameRaw: 'name',
        kind: 'reads',
        origin: 'parser:formula',
        confidence: 'confirmed',
        resolution: 'external',
        location: { file: TOTAL_FILE, line: 7, column: 31 },
      },
    ]);

    const from = whole(graph.linksFrom([idOf(TOTAL), idOf(RULE), idOf(INVOICE)]));
    expect(sorted(from)).toEqual(
      [
        [idOf(TOTAL), idOf(AMOUNT), 'reads', 'parser:formula', 7],
        [idOf(TOTAL), idOf(ACCOUNT_NAME), 'reads', 'parser:formula', 7],
        [idOf(TOTAL), null, 'reads', 'parser:formula', 8],
        [idOf(RULE), idOf(AMOUNT), 'references', 'dependency-api', null],
        [idOf(RULE), idOf(AMOUNT), 'reads', 'parser:formula', 4],
      ].sort(),
    );
    // A target without a key keeps its type and its spelling.
    expect(from.find((edge) => edge.toId === null)).toMatchObject({ toType: 'CustomField', toNameRaw: 'Dicsount__c' });
    expect(graph.linksTo([])).toEqual([]);
    expect(graph.linksTo([idOf(TOTAL)])).toEqual([]);
    expect(graph.linksFrom([123_456])).toEqual([]);
    expect(graph.edges([])).toEqual([]);
    // A link that names no reference of the database is a fault, not an empty answer.
    expect(
      codeOf(() => graph.edges([{ fromId: 1, toId: 2, confidence: 'confirmed', versionId: 123_456, seq: 0 }])),
    ).toBe('INTERNAL');
    store.close();
  });

  it('leaves out the references that are less certain than was asked for', () => {
    const store = open();
    const id = snapshot(store);
    const tiers: Partial<Reference>[] = [
      { confidence: 'confirmed' },
      { confidence: 'probable' },
      { confidence: 'possible', resolution: 'dynamic' },
    ];
    writeAnalysis(
      store,
      id,
      analysisOf([
        component(AMOUNT, 'Invoice__c.Amount__c', 'objects/Invoice__c/fields/Amount__c.field-meta.xml'),
        component(
          TOTAL,
          'Invoice__c.Total__c',
          TOTAL_FILE,
          tiers.map((more, at) => reference(TOTAL, AMOUNT, TOTAL_FILE, at + 1, more)),
        ),
      ]),
    );
    const graph = sqlGraph(store, id);
    const amount = [graph.find(AMOUNT)?.id ?? 0];
    const total = [graph.find(TOTAL)?.id ?? 0];
    const lines = (links: readonly GraphLink[]): unknown[] =>
      graph
        .edges(links)
        .map((edge) => [edge.location?.line, edge.confidence])
        .sort();
    const all = [
      [1, 'confirmed'],
      [2, 'probable'],
      [3, 'possible'],
    ];
    for (const [weakest, expected] of [
      [undefined, all],
      ['possible', all],
      ['probable', all.slice(0, 2)],
      ['confirmed', all.slice(0, 1)],
    ] as const) {
      expect(lines(graph.linksTo(amount, weakest))).toEqual(expected);
      expect(lines(graph.linksFrom(total, weakest))).toEqual(expected);
    }
    store.close();
  });

  it('asks for a long list of components in parts, and gives back all of it', () => {
    const store = open();
    const id = snapshot(store);
    // More fields than one statement takes, each read by a rule of its own.
    const many = 4_500;
    const fields = Array.from({ length: many }, (_, at) => key('CustomField', `Invoice__c.F${String(at)}__c`));
    const rules = fields.map((_, at) => key('ValidationRule', `Invoice__c.R${String(at)}`));
    writeAnalysis(
      store,
      id,
      analysisOf([
        ...fields.map((field, at) => component(field, `Invoice__c.F${String(at)}__c`, `fields/F${String(at)}.xml`)),
        ...rules.map((rule, at) =>
          component(rule, `Invoice__c.R${String(at)}`, `rules/R${String(at)}.xml`, [
            reference(rule, fields[at] ?? AMOUNT, `rules/R${String(at)}.xml`, 3),
          ]),
        ),
      ]),
    );
    const graph = sqlGraph(store, id);
    const below = graph.below(graph.find(INVOICE)?.id ?? 0);
    expect(below).toHaveLength(2 * many);
    const components = graph.components(below);
    expect(new Set(components.map((one) => one.key))).toEqual(new Set([...fields, ...rules]));
    const fieldIds = components.filter((one) => one.key.startsWith('CustomField:')).map((one) => one.id);
    const ruleIds = components.filter((one) => one.key.startsWith('ValidationRule:')).map((one) => one.id);
    const to = graph.linksTo(fieldIds);
    expect(to).toHaveLength(many);
    expect(new Set(to.map((link) => link.fromId))).toEqual(new Set(ruleIds));
    const from = graph.linksFrom(below);
    expect(from).toHaveLength(many);
    expect(new Set(from.map((link) => link.toId))).toEqual(new Set(fieldIds));
    // The rest of every reference, asked for in parts too, in the order of the links.
    const edges = graph.edges(from);
    expect(edges.map((edge) => [edge.fromId, edge.toId])).toEqual(from.map((link) => [link.fromId, link.toId]));
    expect(new Set(edges.map((edge) => edge.location?.line))).toEqual(new Set([3]));
    store.close();
  });

  it('knows a component through what it contains, and so the parent of every component it knows', () => {
    const store = open();
    // Another snapshot knows an object with a field of which the snapshot under test knows nothing.
    const other = snapshot(store, 'other');
    const STRANGER = key('CustomObject', 'Stranger__c');
    const STRANGE_FIELD = key('CustomField', 'Stranger__c.Field__c');
    writeAnalysis(store, other, analysisOf([component(STRANGE_FIELD, 'Stranger__c.Field__c', 'strange.xml')]));
    // The snapshot holds one method. Its class is no component of it, and neither are the field it reads and
    // the object of that field.
    const id = snapshot(store);
    const CLASS = key('ApexClass', 'Billing');
    const METHOD = buildKey({ type: 'ApexClass', fullName: 'Billing', subs: [{ kind: 'method', name: 'run()' }] });
    const CLASS_FILE = 'classes/Billing.cls';
    writeAnalysis(
      store,
      id,
      analysisOf(
        [
          component(METHOD, 'run', CLASS_FILE, [
            reference(METHOD, ACCOUNT_NAME, CLASS_FILE, 12, { origin: 'parser:apex', resolution: 'external' }),
          ]),
        ],
        { work: [{ origin: 'parser:apex', components: 1, failedFiles: 0 }] },
      ),
    );
    const graph = sqlGraph(store, id);
    const method = graph.find(METHOD);
    const field = graph.find(ACCOUNT_NAME);
    // The key of a method says which class contains it.
    expect(method?.parentId).toBe(graph.find(CLASS)?.id);
    expect(graph.component(method?.parentId ?? 0)).toEqual({
      id: method?.parentId,
      key: CLASS,
      parentId: null,
      version: null,
    });
    expect(graph.component(field?.parentId ?? 0)).toEqual({
      id: field?.parentId,
      key: ACCOUNT,
      parentId: null,
      version: null,
    });
    expect(keysOf(graph.childrenOf(method?.parentId ?? 0))).toEqual([METHOD]);
    expect(keysOf(graph.childrenOf(field?.parentId ?? 0))).toEqual([ACCOUNT_NAME]);
    // What only the other snapshot knows stays unknown here, the object and what it contains.
    const stranger = sqlGraph(store, other).find(STRANGER);
    expect(stranger?.version).toBeNull();
    expect(graph.find(STRANGER)).toBeUndefined();
    expect(graph.component(stranger?.id ?? 0)).toBeUndefined();
    expect(graph.childrenOf(stranger?.id ?? 0)).toEqual([]);
    expect(keysOf(sqlGraph(store, other).childrenOf(stranger?.id ?? 0))).toEqual([STRANGE_FIELD]);
    store.close();
  });

  it('keeps the file of a reference, also when it is not the file of its component', () => {
    const store = open();
    const id = snapshot(store);
    const elsewhere = reference(TOTAL, AMOUNT, 'objects/Invoice__c/Invoice__c.object-meta.xml', 40);
    writeAnalysis(store, id, analysisOf([component(TOTAL, 'Invoice__c.Total__c', TOTAL_FILE, [elsewhere])]));
    const graph = sqlGraph(store, id);
    expect(graph.find(TOTAL)?.version?.path).toBe(TOTAL_FILE);
    expect(graph.referencesFrom(graph.find(TOTAL)?.id ?? 0).map((one) => one.location)).toEqual([
      { file: OBJECT_FILE, line: 40, column: 5 },
    ]);
    store.close();
  });

  it('adds a list and no version for a second snapshot of an unchanged source', () => {
    const store = open();
    const first = snapshot(store);
    writeAnalysis(store, first, analysisOf(project()));
    const before = counts(store);
    const second = snapshot(store);
    // The same project, with its references and the keys of its attributes in another order.
    const again = project().map((one) => ({
      ...one,
      references: one.references.toReversed(),
      attrs: one.attrs === null ? null : Object.fromEntries(Object.entries(one.attrs).toReversed()),
    }));
    expect(writeAnalysis(store, second, analysisOf(again.toReversed(), { analysedAt: T1 }))).toEqual({
      components: 5,
      references: 5,
      versionsAdded: 0,
      versionsRemoved: 0,
    });
    expect(counts(store)).toEqual({ ...before, snapshot_component: 10, snapshot_analysis: 2 });
    expect(sqlGraph(store, second).referencesFrom(sqlGraph(store, second).find(TOTAL)?.id ?? 0)).toEqual(
      sqlGraph(store, first).referencesFrom(sqlGraph(store, first).find(TOTAL)?.id ?? 0),
    );
    store.close();
  });

  it('takes attributes as the same whatever the order of their keys, at any depth, and a list as it is ordered', () => {
    const store = open();
    const field = (attrs: Record<string, JsonValue>): AnalysedComponent[] => [
      component(AMOUNT, 'Invoice__c.Amount__c', 'amount.xml', [], attrs),
    ];
    const write = (attrs: Record<string, JsonValue>): number =>
      writeAnalysis(store, snapshot(store), analysisOf(field(attrs))).versionsAdded;
    expect(write({ type: 'Picklist', values: [{ name: 'A', flags: { b: 1, a: 2 } }, { name: 'B' }] })).toBe(1);
    expect(write({ values: [{ flags: { a: 2, b: 1 }, name: 'A' }, { name: 'B' }], type: 'Picklist' })).toBe(0);
    expect(write({ type: 'Picklist', values: [{ name: 'B' }, { name: 'A', flags: { b: 1, a: 2 } }] })).toBe(1);
    // The text in the database has the keys in order, so two versions cannot hold the same text.
    expect(store.all('SELECT attrs FROM component_version ORDER BY id').map((row) => row['attrs'])).toEqual([
      '{"type":"Picklist","values":[{"flags":{"a":2,"b":1},"name":"A"},{"name":"B"}]}',
      '{"type":"Picklist","values":[{"name":"B"},{"flags":{"a":2,"b":1},"name":"A"}]}',
    ]);
    store.close();
  });

  it('reads the hash of a content from the bytes it is given, wherever they lie in memory', () => {
    const store = open();
    const memory = new Uint8Array(96);
    memory.set(sha('one'), 8);
    memory.set(sha('two'), 48);
    const field = (contentHash: Uint8Array): AnalysedComponent[] => [
      { ...component(AMOUNT, 'Invoice__c.Amount__c', 'amount.xml'), definition: { path: 'amount.xml', contentHash } },
    ];
    const write = (contentHash: Uint8Array): number =>
      writeAnalysis(store, snapshot(store), analysisOf(field(contentHash))).versionsAdded;
    expect(write(sha('one'))).toBe(1);
    expect(write(memory.subarray(8, 40))).toBe(0);
    expect(write(memory.subarray(48, 80))).toBe(1);
    store.close();
  });

  it('gives two components their own versions, also when everything but the key is the same', () => {
    const store = open();
    const id = snapshot(store);
    const same = (componentKey: ComponentKey): AnalysedComponent => ({
      ...component(componentKey, 'Same', 'same.xml'),
      definition: { path: 'same.xml', contentHash: sha('same') },
    });
    expect(writeAnalysis(store, id, analysisOf([same(AMOUNT), same(TOTAL)])).versionsAdded).toBe(2);
    expect(store.get('SELECT count(DISTINCT digest) AS digests, count(*) AS versions FROM component_version')).toEqual({
      digests: 1,
      versions: 2,
    });
    const graph = sqlGraph(store, id);
    expect(
      store.all(
        'SELECT m.component_id FROM snapshot_component m JOIN component_version v ON v.id = m.version_id WHERE v.component_id <> m.component_id',
      ),
    ).toEqual([]);
    expect(graph.find(AMOUNT)?.version).toEqual(graph.find(TOTAL)?.version);
    store.close();
  });

  it.each([
    [
      'its content',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        definition: { path: TOTAL_FILE, contentHash: sha('other') },
      }),
    ],
    [
      'its file',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        definition: { path: 'moved.xml', contentHash: sha(`${TOTAL_FILE} v1`) },
      }),
    ],
    [
      'the spelling of its name',
      (one: AnalysedComponent): AnalysedComponent => ({ ...one, name: 'Invoice__c.TOTAL__c' }),
    ],
    [
      'an attribute',
      (one: AnalysedComponent): AnalysedComponent => ({ ...one, attrs: { type: 'Currency', formula: false } }),
    ],
    [
      'the line of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 9), ...one.references.slice(1)],
      }),
    ],
    [
      'the column of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [
          reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { location: { file: TOTAL_FILE, line: 7, column: 6 } }),
          ...one.references.slice(1),
        ],
      }),
    ],
    [
      'the target of a reference, with the file as it was',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, INVOICE, TOTAL_FILE, 7, { toNameRaw: 'Amount__c' }), ...one.references.slice(1)],
      }),
    ],
    [
      'the confidence of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { confidence: 'probable' }), ...one.references.slice(1)],
      }),
    ],
    [
      'the kind of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { kind: 'writes' }), ...one.references.slice(1)],
      }),
    ],
    [
      'the origin of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { origin: 'dependency-api' }), ...one.references.slice(1)],
      }),
    ],
    [
      'the resolution of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { resolution: 'external' }), ...one.references.slice(1)],
      }),
    ],
    [
      'the target of a reference as it is written',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { toNameRaw: 'AMOUNT__C' }), ...one.references.slice(1)],
      }),
    ],
    [
      'an attribute of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, TOTAL_FILE, 7, { attrs: { op: 'sum' } }), ...one.references.slice(1)],
      }),
    ],
    [
      'the file of a reference',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: [reference(TOTAL, AMOUNT, OBJECT_FILE, 7), ...one.references.slice(1)],
      }),
    ],
    [
      'the type of a target that has no key',
      (one: AnalysedComponent): AnalysedComponent => ({
        ...one,
        references: one.references.map((found) => (found.to === null ? { ...found, toType: 'CustomObject' } : found)),
      }),
    ],
    [
      'one reference less',
      (one: AnalysedComponent): AnalysedComponent => ({ ...one, references: one.references.slice(1) }),
    ],
  ])('adds a version for a component when %s changed, and for no other', (_what, change) => {
    const store = open();
    const first = snapshot(store);
    writeAnalysis(store, first, analysisOf(project()));
    const second = snapshot(store);
    const changed = project().map((one) => (one.key === TOTAL ? change(one) : one));
    expect(writeAnalysis(store, second, analysisOf(changed)).versionsAdded).toBe(1);
    const versions = store.all(
      `SELECT c.key AS key, count(DISTINCT m.version_id) AS versions FROM snapshot_component m
         JOIN component c ON c.id = m.component_id GROUP BY c.key HAVING count(DISTINCT m.version_id) > 1`,
    );
    expect(versions).toEqual([{ key: TOTAL, versions: 2 }]);
    // The first snapshot still reads what it read before.
    expect(sqlGraph(store, first).referencesFrom(sqlGraph(store, first).find(TOTAL)?.id ?? 0)).toHaveLength(3);
    store.close();
  });

  it('puts the references of one place in one order, however they came', () => {
    const store = open();
    // What Salesforce reports has no place, so only what the references say can order them.
    const reported = (to: ComponentKey): Reference =>
      validateReference({
        from: RULE,
        to,
        toType: 'CustomField',
        toNameRaw: to.slice(to.indexOf('.') + 1),
        kind: 'references',
        origin: 'dependency-api',
        confidence: 'confirmed',
        resolution: 'resolved',
      });
    const rule = (references: readonly Reference[]): AnalysedComponent[] => [
      component(RULE, 'Invoice__c.Amount_Positive', RULE_FILE, references),
    ];
    writeAnalysis(store, snapshot(store), analysisOf(rule([reported(AMOUNT), reported(TOTAL)])));
    const second = snapshot(store);
    expect(writeAnalysis(store, second, analysisOf(rule([reported(TOTAL), reported(AMOUNT)]))).versionsAdded).toBe(0);
    const graph = sqlGraph(store, second);
    expect(graph.referencesFrom(graph.find(RULE)?.id ?? 0).map((one) => one.to)).toEqual([AMOUNT, TOTAL]);
    store.close();
  });

  it('reads in the order of the keys, in whatever order the components were written', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project().toReversed()));
    const graph = sqlGraph(store, id);
    expect(graph.referencesTo(graph.find(AMOUNT)?.id ?? 0).map((one) => one.from)).toEqual([TOTAL, RULE, RULE]);
    expect(keysOf(graph.childrenOf(graph.find(INVOICE)?.id ?? 0))).toEqual([AMOUNT, TOTAL, RULE]);
    store.close();
  });

  // A question about one component must not walk the list of a snapshot: an org has 100,000 components, and an
  // engine asks thousands of questions. SQLite chooses the order of the tables itself where a statement leaves
  // it open, and it chose the list. The plan of every statement is read here, so that this cannot come back.
  it('answers every question from an index, starting from the component that was asked about', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const asked: [string, SqlValue[]][] = [];
    const listening: Store = {
      ...store,
      get: (sql, ...parameters) => {
        asked.push([sql, parameters]);
        return store.get(sql, ...parameters);
      },
      all: (sql, ...parameters) => {
        asked.push([sql, parameters]);
        return store.all(sql, ...parameters);
      },
    };
    const graph = sqlGraph(listening, id);
    // Every question of the interface is asked below. A new one has to be added here.
    expect(Object.keys(graph).sort()).toEqual([
      'below',
      'childrenOf',
      'component',
      'components',
      'edges',
      'find',
      'linksFrom',
      'linksTo',
      'partsOf',
      'referencesFrom',
      'referencesTo',
      'snapshotId',
    ]);
    const amount = graph.find(AMOUNT)?.id ?? 0;
    // A key that only another snapshot would know makes `component` ask all it can ask.
    const stranger = store.run(
      'INSERT INTO component (key) VALUES (?)',
      key('CustomObject', 'Stranger__c'),
    ).lastInsertRowid;
    graph.component(stranger);
    graph.childrenOf(graph.find(INVOICE)?.id ?? 0);
    graph.referencesTo(amount);
    graph.referencesFrom(amount);
    graph.below(graph.find(INVOICE)?.id ?? 0);
    expect(graph.partsOf([graph.find(INVOICE)?.id ?? 0]).map((part) => part.key)).toContain(AMOUNT);
    graph.components([amount]);
    graph.edges([...graph.linksTo([amount]), ...graph.linksFrom([amount])]);
    expect(new Set(asked.map(([sql]) => sql)).size).toBe(13);
    for (const [sql, parameters] of asked) {
      const steps = store.all(`EXPLAIN QUERY PLAN ${sql}`, ...parameters).map((row) => String(row['detail']));
      // No table is walked. What is walked is a list a statement makes for itself or is handed: what a
      // component contains, which it calls `b` or `below`, and the ids it is asked about, which it calls `j`.
      expect(
        steps.filter((step) => step.startsWith('SCAN') && !/^SCAN (b|below|j VIRTUAL TABLE INDEX \d+:)$/.test(step)),
      ).toEqual([]);
      // An index that SQLite builds for the time of one statement means that it walks a table to build it.
      expect(steps.filter((step) => step.includes('AUTOMATIC'))).toEqual([]);
      // The list of a snapshot is entered with a component or a version, never with the snapshot alone.
      for (const step of steps.filter((one) => / USING (COVERING INDEX|INDEX|PRIMARY KEY) /.test(one))) {
        expect(step).not.toMatch(/\((snapshot_id=\?)\)/);
      }
      const first = steps.find((step) => step.startsWith('SEARCH'));
      expect(first).toMatch(
        /^SEARCH (c|r|m) USING .*\((key|rowid|parent_id|target_id|snapshot_id=\? AND component_id|version_id=\? AND seq)=\?\)/,
      );
    }
    store.close();
  });

  it('replaces the analysis of a snapshot, and removes the versions that only it held', () => {
    const store = open();
    const first = snapshot(store);
    const second = snapshot(store);
    writeAnalysis(store, first, analysisOf(project()));
    writeAnalysis(store, second, analysisOf(project()));
    // A newer engine finds one reference more in the rule, and no longer knows the object Account.
    const newer = project()
      .filter((one) => one.key !== ACCOUNT)
      .map((one) =>
        one.key === RULE ? { ...one, references: [...one.references, reference(RULE, TOTAL, RULE_FILE, 5)] } : one,
      );
    const work: OriginWork[] = [
      { origin: 'parser:formula', components: 3, failedFiles: 1 },
      { origin: 'dependency-api', components: 4, failedFiles: 0 },
    ];
    expect(writeAnalysis(store, second, analysisOf(newer, { engineVersion: '0.3.0', work }))).toEqual({
      components: 4,
      references: 6,
      versionsAdded: 1,
      // The first snapshot still holds the old version of the rule and the version of Account.
      versionsRemoved: 0,
    });
    expect(readAnalysis(store, second)).toEqual({
      engineVersion: '0.3.0',
      analysedAt: T1,
      components: 4,
      references: 6,
      types: ['CustomField', 'CustomObject', 'ValidationRule'],
      crossCheck: null,
    });
    expect(readAnalysis(store, first)?.engineVersion).toBe('0.2.0');
    // The second snapshot holds no Account any more. It still knows it, through the field a formula reads.
    expect(sqlGraph(store, second).find(ACCOUNT)?.version).toBeNull();
    expect(sqlGraph(store, first).find(ACCOUNT)?.version?.name).toBe('Account');
    expect(
      readOriginCoverage(store, second).map(({ origin, components, failedFiles }) => [origin, components, failedFiles]),
    ).toEqual([
      ['parser:formula', 3, 1],
      ['dependency-api', 4, 0],
    ]);
    // Now the first snapshot is analysed by the newer engine too: nothing holds the two old versions any more.
    expect(writeAnalysis(store, first, analysisOf(newer, { engineVersion: '0.3.0', work }))).toEqual({
      components: 4,
      references: 6,
      versionsAdded: 0,
      versionsRemoved: 2,
    });
    expect(counts(store)).toEqual({
      component: 6,
      component_version: 4,
      reference: 6,
      snapshot_component: 8,
      file_path: 4,
      snapshot_analysis: 2,
    });
    store.close();
  });

  it('counts per origin what was found, and keeps what the analysers say they looked at', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(
      store,
      id,
      analysisOf(project(), {
        work: [
          { origin: 'parser:xml', components: 5, failedFiles: 2 },
          { origin: 'parser:formula', components: 2, failedFiles: 0 },
          { origin: 'dependency-api', components: 5, failedFiles: 0 },
        ],
      }),
    );
    expect(readOriginCoverage(store, id)).toEqual([
      { origin: 'parser:xml', components: 5, failedFiles: 2, references: 0, unresolved: 0 },
      { origin: 'parser:formula', components: 2, failedFiles: 0, references: 4, unresolved: 1 },
      { origin: 'dependency-api', components: 5, failedFiles: 0, references: 1, unresolved: 0 },
    ]);
    expect(readOriginCoverage(store, id + 1)).toEqual([]);
    store.close();
  });

  it('counts as not resolved only what is unresolved, not every target without a key', () => {
    const store = open();
    const id = snapshot(store);
    // A target in a managed package that could not be given a key lies outside, and is not a name that was not found.
    const outside = validateReference({
      from: TOTAL,
      to: null,
      toType: 'ApexClass',
      toNameRaw: 'pkg.Rates',
      kind: 'reads',
      origin: 'parser:formula',
      confidence: 'probable',
      resolution: 'external',
      location: { file: TOTAL_FILE, line: 9, column: 1 },
    });
    const withOutside = project().map((one) =>
      one.key === TOTAL ? { ...one, references: [...one.references, outside] } : one,
    );
    writeAnalysis(store, id, analysisOf(withOutside));
    expect(readOriginCoverage(store, id)[0]).toEqual({
      origin: 'parser:formula',
      components: 2,
      failedFiles: 0,
      references: 5,
      unresolved: 1,
    });
    const graph = sqlGraph(store, id);
    expect(
      graph
        .referencesFrom(graph.find(TOTAL)?.id ?? 0)
        .filter((one) => one.to === null)
        .map(({ toType, toNameRaw, resolution }) => [toType, toNameRaw, resolution]),
    ).toEqual([
      ['CustomField', 'Dicsount__c', 'unresolved'],
      ['ApexClass', 'pkg.Rates', 'external'],
    ]);
    store.close();
  });

  // The digest is what makes a version the same in two snapshots. A change to the text it is taken over
  // gives every component of every workspace a new version, so the text is written out here once.
  it('takes the digest of a version over a text of this form', () => {
    const store = open();
    const id = snapshot(store);
    const found = [
      reference(RULE, AMOUNT, RULE_FILE, 4, { attrs: { b: 2, a: 1 } }),
      validateReference({
        from: RULE,
        to: null,
        toType: 'CustomField',
        toNameRaw: 'Dicsount__c',
        kind: 'reads',
        origin: 'dependency-api',
        confidence: 'confirmed',
        resolution: 'unresolved',
      }),
    ];
    writeAnalysis(
      store,
      id,
      analysisOf([component(RULE, 'Invoice__c.Amount_Positive', RULE_FILE, found, { active: true })]),
    );
    const text = [
      // The number of the form, the name, the file, the hash of the content, the attributes.
      JSON.stringify([
        1,
        'Invoice__c.Amount_Positive',
        RULE_FILE,
        Buffer.from(sha(`${RULE_FILE} v1`)).toString('hex'),
        '{"active":true}',
      ]),
      // The references in the order of their places, the one without a place first. Each: the target key,
      // the type of a target without a key, the name as written, kind, origin, confidence, resolution, file,
      // line, column, attributes.
      JSON.stringify([
        null,
        'CustomField',
        'Dicsount__c',
        'reads',
        'dependency-api',
        'confirmed',
        'unresolved',
        null,
        null,
        null,
        null,
      ]),
      JSON.stringify([
        AMOUNT,
        null,
        // The helper of this file takes the name from the key, which is in lower case.
        'amount__c',
        'reads',
        'parser:formula',
        'confirmed',
        'resolved',
        RULE_FILE,
        4,
        5,
        '{"a":1,"b":2}',
      ]),
    ].join('\n');
    expect(store.get('SELECT digest FROM component_version')?.['digest']).toEqual(
      new Uint8Array(createHash('sha256').update(text).digest()),
    );
    store.close();
  });

  it('looks for versions that no snapshot holds only when an analysis is replaced', () => {
    const store = open();
    const first = snapshot(store);
    writeAnalysis(store, first, analysisOf(project()));
    store.write(() => store.run('DELETE FROM snapshot WHERE id = ?', first));
    // Nothing holds the five versions now. An analysis that replaces none leaves them where they are.
    const second = snapshot(store);
    const one = [component(AMOUNT, 'Invoice__c.Amount__c', 'elsewhere.xml')];
    expect(writeAnalysis(store, second, analysisOf(one)).versionsRemoved).toBe(0);
    expect(count(store, 'component_version')).toBe(6);
    // One that replaces another removes all of them, with their references.
    expect(writeAnalysis(store, second, analysisOf(one)).versionsRemoved).toBe(5);
    expect(count(store, 'component_version')).toBe(1);
    expect(count(store, 'reference')).toBe(0);
    // The keys and the paths stay. Nothing removes them.
    expect(count(store, 'component')).toBe(6);
    expect(count(store, 'file_path')).toBe(5);
    store.close();
  });

  it('keeps the issues of the reading when the analysis is replaced, and replaces its own', () => {
    const store = open();
    const id = snapshot(store);
    const issue = (code: string) => ({
      severity: 'warning' as const,
      code,
      message: `${code}.`,
      componentKey: null,
      details: null,
    });
    store.write(() => {
      addIssue(store, id, issue('READ'));
    });
    writeAnalysis(
      store,
      id,
      analysisOf(project(), {
        issues: [issue('FIRST'), { ...issue('SECOND'), componentKey: TOTAL, details: { line: 3 } }],
      }),
    );
    expect(readIssues(store, id).map((one) => one.code)).toEqual(['READ', 'FIRST', 'SECOND']);
    expect(readIssues(store, id)[0]).toEqual({ ...issue('READ'), stage: 'read' });
    expect(readIssues(store, id)[2]).toEqual({
      ...issue('SECOND'),
      componentKey: TOTAL,
      details: { line: 3 },
      stage: 'analysis',
    });
    writeAnalysis(store, id, analysisOf(project(), { issues: [issue('THIRD')] }));
    expect(readIssues(store, id).map((one) => one.code)).toEqual(['READ', 'THIRD']);
    expect(store.all('SELECT code, stage FROM snapshot_issue ORDER BY id')).toEqual([
      { code: 'READ', stage: 'read' },
      { code: 'THIRD', stage: 'analysis' },
    ]);
    store.close();
  });

  it('counts the issues that bear on an answer: errors but for those the coverage tells, and warnings of the analysis', () => {
    const store = open();
    const id = snapshot(store);
    const other = snapshot(store, 'other');
    expect(countIssues(store, id, [])).toEqual({ read: 0, analysis: 0, analysisWarnings: 0 });
    const read = (severity: 'error' | 'warning', code: string, details: Record<string, JsonValue> | null): void => {
      addIssue(store, id, { severity, code, message: `${code} happened.`, componentKey: null, details });
    };
    store.write(() => {
      // The coverage of the type tells these two.
      read('error', 'NOT_RETRIEVED', { type: 'Report', count: 2 });
      read('error', 'LISTING_FAILED', { type: 'Dashboard', code: null });
      read('error', 'FILE_UNREADABLE', { path: 'classes/A.cls' });
      read('error', 'FOLDER_MISSING', null);
      // Another error counts also when it names a type, and one of the two that names none does too.
      read('error', 'ODD', { type: 'Report' });
      read('error', 'NOT_RETRIEVED', { type: 7 });
      read('warning', 'FILES_NOT_METADATA', { count: 1 });
      // What is missing outside the logic tier is a warning. It counts where an answer covers one of its types.
      read('warning', 'RESOLVE_FAILED', { at: 'ListView A.B', types: ['ListView'], tier: 'other' });
      read('warning', 'RETRIEVE_FAILED', { count: 2, types: ['Report', 'WebLink'], tier: 'other' });
      read('warning', 'RESOLVE_FAILED', { at: 'tabs/x', types: ['CustomTab'], tier: 'other' });
      // The coverage of the type tells these, and one without the mark of the tier is no such warning.
      read('warning', 'NOT_RETRIEVED', { type: 'ListView', types: ['ListView'], tier: 'other' });
      read('warning', 'ODD', { types: ['ListView'] });
      read('warning', 'ODD', { types: 'ListView', tier: 'other' });
      // A flow analysed as a version of which it is not known whether it runs counts with the warnings of the
      // analysis where an answer covers flows. Without the type it counts nowhere, and so does an error.
      read('warning', 'FLOW_VERSION_UNKNOWN', { flow: 'F', state: 'Draft', reason: 'no-definition', types: ['Flow'] });
      read('warning', 'FLOW_VERSION_UNKNOWN', { flow: 'G', state: 'Draft', reason: 'no-definition' });
      read('warning', 'FLOW_VERSION_UNKNOWN', { flow: 'H', types: 'Flow' });
      addIssue(store, other, {
        severity: 'error',
        code: 'FOLDER_MISSING',
        message: 'm',
        componentKey: null,
        details: null,
      });
    });
    expect(countIssues(store, id, [])).toEqual({ read: 4, analysis: 0, analysisWarnings: 0 });
    expect(countIssues(store, id, ['CustomObject'])).toEqual({ read: 4, analysis: 0, analysisWarnings: 0 });
    expect(countIssues(store, id, ['CustomObject', 'ListView'])).toMatchObject({ read: 5 });
    expect(countIssues(store, id, ['ListView', 'WebLink'])).toMatchObject({ read: 6 });
    expect(countIssues(store, id, ['CustomTab', 'ListView', 'Report', 'WebLink'])).toMatchObject({ read: 7 });
    expect(countIssues(store, id, ['Flow'])).toEqual({ read: 4, analysis: 0, analysisWarnings: 1 });
    expect(countIssues(store, id, ['ApexClass', 'Flow'])).toEqual({ read: 4, analysis: 0, analysisWarnings: 1 });
    writeAnalysis(
      store,
      id,
      analysisOf(project(), {
        issues: [
          { severity: 'error', code: 'RESOLVE_FAILED', message: 'm', componentKey: null, details: { at: 'x' } },
          { severity: 'error', code: 'COMPONENT_FAILED', message: 'm', componentKey: AMOUNT, details: { type: 'X' } },
          { severity: 'warning', code: 'PATH_NOT_FOLLOWED', message: 'm', componentKey: TOTAL, details: {} },
        ],
      }),
    );
    expect(countIssues(store, id, [])).toEqual({ read: 4, analysis: 2, analysisWarnings: 1 });
    expect(countIssues(store, id, ['Flow'])).toEqual({ read: 4, analysis: 2, analysisWarnings: 2 });
    expect(countIssues(store, other, [])).toEqual({ read: 1, analysis: 0, analysisWarnings: 0 });
    expect(countIssues(store, 123_456, ['ListView'])).toEqual({ read: 0, analysis: 0, analysisWarnings: 0 });
    store.close();
  });

  it('keeps the snapshots of two sources apart, and shares what is the same in both', () => {
    const store = open();
    const repo = snapshot(store, 'repo');
    const org = snapshot(store, 'org');
    writeAnalysis(store, repo, analysisOf(project()));
    writeAnalysis(store, org, analysisOf(project().filter((one) => one.key !== TOTAL && one.key !== ACCOUNT)));
    expect(count(store, 'component_version')).toBe(5);
    const graph = sqlGraph(store, org);
    expect(graph.find(TOTAL)).toBeUndefined();
    // The database knows the key from the other snapshot. This one neither holds it nor refers to it.
    expect(graph.find(ACCOUNT_NAME)).toBeUndefined();
    expect(graph.component(sqlGraph(store, repo).find(ACCOUNT_NAME)?.id ?? 0)).toBeUndefined();
    expect(graph.referencesTo(graph.find(AMOUNT)?.id ?? 0).map((one) => one.from)).toEqual([RULE, RULE]);
    expect(keysOf(graph.childrenOf(graph.find(INVOICE)?.id ?? 0))).toEqual([AMOUNT, RULE].sort());
    store.close();
  });

  it('removes the list of a snapshot with the snapshot, and leaves the versions', () => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    store.write(() => store.run('DELETE FROM snapshot WHERE id = ?', id));
    expect(counts(store)).toEqual({
      component: 6,
      component_version: 5,
      reference: 5,
      snapshot_component: 0,
      file_path: 4,
      snapshot_analysis: 0,
    });
    expect(count(store, 'snapshot_origin_coverage')).toBe(0);
    store.close();
  });

  it.each([
    [
      'one component twice',
      () => analysisOf([...project(), component(AMOUNT, 'Invoice__c.AMOUNT__c', 'other.xml')]),
      'INTERNAL',
    ],
    [
      'a reference that starts from another component',
      () => analysisOf([component(INVOICE, 'Invoice__c', OBJECT_FILE, [reference(TOTAL, AMOUNT, TOTAL_FILE, 7)])]),
      'REFERENCE_INVALID',
    ],
    [
      'a key that breaks the grammar',
      () => analysisOf([component('CustomField:Invoice__c.Amount__c' as ComponentKey, 'x', 'x.xml')]),
      'KEY_INVALID',
    ],
    [
      'a target that breaks the grammar',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            { ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), to: 'customfield:x' as ComponentKey },
          ]),
        ]),
      'KEY_INVALID',
    ],
    [
      'a kind outside the vocabulary',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            { ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), kind: 'contains' as 'reads' },
          ]),
        ]),
      'REFERENCE_INVALID',
    ],
    [
      'a word that every object of JavaScript knows, as a kind',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            { ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), kind: 'constructor' as 'reads' },
          ]),
        ]),
      'REFERENCE_INVALID',
    ],
    [
      'a resolved reference without a target',
      () => analysisOf([component(TOTAL, 'x', TOTAL_FILE, [{ ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), to: null }])]),
      'STORE_FAILED',
    ],
    [
      'an unresolved reference with a target',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            { ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), resolution: 'unresolved' as const },
          ]),
        ]),
      'STORE_FAILED',
    ],
    [
      'a possible reference without a target',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            {
              ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7),
              to: null,
              confidence: 'possible' as const,
              resolution: 'dynamic' as const,
            },
          ]),
        ]),
      'STORE_FAILED',
    ],
    [
      'a dynamic reference that is confirmed',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            { ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), resolution: 'dynamic' as const },
          ]),
        ]),
      'STORE_FAILED',
    ],
    [
      'an empty name for a target without a key',
      () =>
        analysisOf([
          component(TOTAL, 'x', TOTAL_FILE, [
            { ...reference(TOTAL, AMOUNT, TOTAL_FILE, 7), to: null, toType: '', resolution: 'external' as const },
          ]),
        ]),
      'STORE_FAILED',
    ],
    [
      'references of an origin whose analyser says nothing',
      () => analysisOf(project(), { work: [{ origin: 'parser:formula', components: 2, failedFiles: 0 }] }),
      'INTERNAL',
    ],
    [
      'the work of one origin twice',
      () =>
        analysisOf([], {
          work: [
            { origin: 'parser:xml', components: 1, failedFiles: 0 },
            { origin: 'parser:xml', components: 2, failedFiles: 0 },
          ],
        }),
      'INTERNAL',
    ],
    ['a time that is not UTC', () => analysisOf(project(), { analysedAt: '2026-01-31 09:30' }), 'STORE_FAILED'],
  ])('refuses %s, and writes nothing then', (_what, analysis, code) => {
    const store = open();
    const id = snapshot(store);
    writeAnalysis(store, id, analysisOf(project()));
    const before = counts(store);
    const second = snapshot(store);
    expect(codeOf(() => writeAnalysis(store, second, analysis()))).toBe(code);
    expect(counts(store)).toEqual(before);
    expect(readAnalysis(store, second)).toBeUndefined();
    // The analysis of the first snapshot is not replaced by one that is refused.
    expect(codeOf(() => writeAnalysis(store, id, analysis()))).toBe(code);
    expect(counts(store)).toEqual(before);
    expect(readAnalysis(store, id)?.components).toBe(5);
    store.close();
  });

  it('refuses an analysis for a snapshot that does not exist', () => {
    const store = open();
    expect(codeOf(() => writeAnalysis(store, 7, analysisOf(project())))).toBe('INTERNAL');
    expect(count(store, 'component')).toBe(0);
    store.close();
  });

  it('holds in the database the numbers the code writes for the reference vocabulary', () => {
    const store = open();
    const stored = Object.fromEntries(
      (['kind', 'origin', 'confidence', 'resolution'] as const).map((family) => [
        family,
        Object.fromEntries(
          store
            .all('SELECT name, code FROM reference_vocabulary WHERE family = ? ORDER BY code', family)
            .map((row) => [String(row['name']), Number(row['code'])]),
        ),
      ]),
    );
    expect(stored).toEqual(REFERENCE_CODES);
    // Every value of the vocabulary has a number, but for the kind that is never stored as a reference.
    expect(Object.keys(REFERENCE_CODES.kind)).toEqual(REFERENCE_KINDS.filter((kind) => kind !== 'contains'));
    expect(Object.keys(REFERENCE_CODES.origin)).toEqual([...REFERENCE_ORIGINS]);
    expect(Object.keys(REFERENCE_CODES.confidence)).toEqual([...CONFIDENCE_TIERS]);
    expect(Object.keys(REFERENCE_CODES.resolution)).toEqual([...RESOLUTIONS]);
    for (const codes of Object.values(REFERENCE_CODES)) {
      expect(Object.values(codes)).toEqual(Object.values(codes).map((_, index) => index + 1));
    }
    store.close();
  });

  it('migrates a database of schema version 2: its snapshots are still there and count as not analysed', () => {
    const path = join(temp.next(), 'orglens.sqlite');
    const old = openStore({ path, driver, migrations: MIGRATIONS.slice(0, 2) });
    expect(old.schemaVersion).toBe(2);
    const id = old.write(() =>
      insertSnapshotBeforeLayout(old, {
        sourceId: ensureSource(old, { name: 'repo', kind: 'git', createdAt: T0 }),
        status: 'complete',
        startedAt: T0,
        finishedAt: T0,
        engineVersion: '0.1.0',
        gitCommit: null,
      }),
    );
    old.write(() => {
      addSnapshotFile(old, id, OBJECT_FILE, new TextEncoder().encode('<CustomObject/>'));
      addIssue(old, id, { severity: 'warning', code: 'OLD', message: 'Old.', componentKey: null, details: null });
    });
    old.close();

    const store = openStore({ path, driver });
    expect(store.migrated).toEqual({ from: 2, to: MIGRATIONS.length });
    // A snapshot from before the layout was kept is one in the standard layout.
    expect(readSnapshot(store, 'repo')).toMatchObject({ id, status: 'complete', files: 1, layout: null });
    expect(readAnalysis(store, id)).toBeUndefined();
    expect(sqlGraph(store, id).find(INVOICE)).toBeUndefined();
    expect(store.all('SELECT code, stage FROM snapshot_issue')).toEqual([{ code: 'OLD', stage: 'read' }]);
    // And it can be analysed now.
    expect(writeAnalysis(store, id, analysisOf(project())).components).toBe(5);
    store.close();
  });
});
