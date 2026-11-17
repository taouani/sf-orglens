/**
 * The impact engine (decision record 0044), on small graphs written for each rule: what is found and at which
 * depth, which chain is kept, where the walk starts and stops, and what an answer does not cover.
 *
 * The graphs are stored and read through `sqlGraph`, with both drivers, so that the engine is tested with the
 * order in which a database hands out references, which is no order.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import { validateReference, type ConfidenceTier, type Reference } from '../src/core/references.ts';
import {
  coversEverything,
  findComponent,
  impactGaps,
  mayMissSomething,
  walkImpact,
  type ImpactOptions,
  type ImpactWalk,
  type TypeCount,
} from '../src/engines/impact.ts';
import { writeAnalysis, type AnalysedComponent } from '../src/store/analysis.ts';
import { sqlGraph, type SnapshotGraph } from '../src/store/graph.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { ensureSource, insertSnapshot } from '../src/store/snapshots.ts';
import { chainOf } from './helpers/impact-chain.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const T0 = '2026-01-31T09:30:00.000Z';
const sha = (text: string): Uint8Array => new Uint8Array(createHash('sha256').update(text).digest());

const field = (name: string): ComponentKey => buildKey({ type: 'CustomField', fullName: name });
const rule = (name: string): ComponentKey => buildKey({ type: 'ValidationRule', fullName: name });
const object = (name: string): ComponentKey => buildKey({ type: 'CustomObject', fullName: name });
const fileOf = (key: ComponentKey): string => `files/${key.replace(':', '/')}.xml`;

/** A reference from one component to another, on a line of the file of the first. */
function to(target: ComponentKey, line = 1, more: Partial<Reference> = {}): (from: ComponentKey) => Reference {
  return (from) =>
    validateReference({
      from,
      to: target,
      toType: target.slice(0, target.indexOf(':')),
      toNameRaw: target.slice(target.indexOf(':') + 1),
      kind: 'reads',
      origin: 'parser:formula',
      confidence: 'confirmed',
      resolution: 'resolved',
      location: { file: fileOf(from), line, column: 3 },
      ...more,
    });
}
const tier = (target: ComponentKey, confidence: ConfidenceTier, line = 1): ((from: ComponentKey) => Reference) =>
  to(target, line, { confidence, ...(confidence === 'possible' ? { resolution: 'dynamic' as const } : {}) });

/** A component with a file, and the references it holds. */
function holds(key: ComponentKey, ...references: ((from: ComponentKey) => Reference)[]): AnalysedComponent {
  return {
    key,
    name: key.slice(key.indexOf(':') + 1).toUpperCase(),
    definition: { path: fileOf(key), contentHash: sha(key) },
    attrs: null,
    references: references.map((make) => make(key)),
  };
}

/**
 * What a test compares of a walk: each result with its depth, its confidence and the keys along its chain,
 * which is followed from result to result.
 */
const outline = (walk: ImpactWalk, outgoing = false): unknown[] =>
  walk.results.map((result) => [
    result.key,
    result.depth,
    result.confidence,
    chainOf(walk.results, result, outgoing)
      .map((step) => `${step.from} > ${step.to}`)
      .join(' | '),
  ]);

const A = field('Thing__c.A__c');
const B = field('Thing__c.B__c');
const C = field('Thing__c.C__c');
const D = field('Thing__c.D__c');
const X = field('Other__c.X__c');
const P1 = field('Other__c.P1__c');
const P2 = field('Other__c.P2__c');
const THING = object('Thing__c');
const OTHER = object('Other__c');

describe.each(DRIVERS)('the impact engine with $name', (driver) => {
  const temp = tempDirs();
  const stores: Store[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    temp.cleanUp();
  });

  /** A database for the snapshots of one test. */
  function newStore(): Store {
    const store = openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });
    stores.push(store);
    return store;
  }

  /** A snapshot that holds the components, read as a graph. Without a store, it is alone in a database. */
  function graphOf(components: readonly AnalysedComponent[], store = newStore()): SnapshotGraph {
    const id = store.write(() =>
      insertSnapshot(store, {
        sourceId: ensureSource(store, { name: 'repo', kind: 'git', createdAt: T0 }),
        status: 'complete',
        startedAt: T0,
        finishedAt: T0,
        engineVersion: '0.2.0',
        gitCommit: null,
      }),
    );
    writeAnalysis(store, id, {
      engineVersion: '0.2.0',
      analysedAt: T0,
      types: ['CustomField', 'CustomObject', 'ValidationRule'],
      components,
      work: (['parser:xml', 'parser:formula', 'dependency-api'] as const).map((origin) => ({
        origin,
        components: components.length,
        failedFiles: 0,
      })),
      issues: [],
    });
    return sqlGraph(store, id);
  }

  const walk = (graph: SnapshotGraph, key: ComponentKey, options?: ImpactOptions): ImpactWalk => {
    const start = graph.find(key);
    if (start === undefined) throw new Error(`The graph does not know ${key}.`);
    return walkImpact(graph, start, options);
  };

  it('finds what refers to a component directly and through others, with the chain and its weakest confidence', () => {
    const graph = graphOf([holds(A), holds(B, to(A, 4)), holds(C, tier(B, 'probable', 7)), holds(D, to(C, 2))]);
    const found = walk(graph, A);
    expect(outline(found)).toEqual([
      [B, 1, 'confirmed', `${B} > ${A}`],
      [C, 2, 'probable', `${C} > ${B} | ${B} > ${A}`],
      // The reference of D is confirmed. The path is as certain as its weakest reference.
      [D, 3, 'probable', `${D} > ${C} | ${C} > ${B} | ${B} > ${A}`],
    ]);
    expect(found.results[1]).toEqual({
      key: C,
      type: 'CustomField',
      name: 'THING__C.C__C',
      file: fileOf(C),
      depth: 2,
      confidence: 'probable',
      // The reference C is found by. Its other end is B, the result before, which holds the next one.
      reference: {
        from: C,
        to: B,
        kind: 'reads',
        origin: 'parser:formula',
        confidence: 'probable',
        resolution: 'resolved',
        file: fileOf(C),
        line: 7,
        column: 3,
      },
    });
    const last = found.results[2];
    expect(last === undefined ? [] : chainOf(found.results, last).map((step) => [step.line, step.confidence])).toEqual([
      [2, 'confirmed'],
      [7, 'probable'],
      [4, 'confirmed'],
    ]);
    expect(found).toMatchObject({ parts: 0, unresolved: [], beyondDepth: false });
    // Nothing refers to the last of the chain.
    expect(walk(graph, D)).toEqual({
      parts: 0,
      startTypes: ['CustomField'],
      notHeld: 0,
      results: [],
      unresolved: [],
      beyondDepth: false,
    });
  });

  it('keeps the shortest path, also when a longer one is more certain', () => {
    const graph = graphOf([holds(A), holds(B, to(A)), holds(X, tier(A, 'possible'), to(B))]);
    expect(outline(walk(graph, A))).toEqual([
      [X, 1, 'possible', `${X} > ${A}`],
      [B, 1, 'confirmed', `${B} > ${A}`],
    ]);
    // Without the uncertain reference, the longer path is the shortest one.
    expect(outline(walk(graph, A, { minConfidence: 'confirmed' }))).toEqual([
      [B, 1, 'confirmed', `${B} > ${A}`],
      [X, 2, 'confirmed', `${X} > ${B} | ${B} > ${A}`],
    ]);
    expect(outline(walk(graph, A, { minConfidence: 'probable' }))).toEqual(
      outline(walk(graph, A, { minConfidence: 'confirmed' })),
    );
  });

  it('keeps the most certain of the shortest paths', () => {
    // Through P1 the weakest reference is possible, through P2 it is probable.
    const graph = graphOf([
      holds(A),
      holds(P1, tier(A, 'possible')),
      holds(P2, to(A)),
      holds(X, to(P1, 1), tier(P2, 'probable', 2)),
    ]);
    expect(outline(walk(graph, A)).at(-1)).toEqual([X, 2, 'probable', `${X} > ${P2} | ${P2} > ${A}`]);
  });

  it('chooses among equal paths by keys and places, in whatever order the database holds them', () => {
    // Two paths of the same length and the same confidence, and two references of the same component.
    const components = [
      holds(A),
      holds(P1, to(A, 9), to(A, 3, { kind: 'references', origin: 'parser:xml' }), to(A, 3)),
      holds(P2, to(A, 1)),
      holds(X, to(P2, 1), to(P1, 2)),
    ];
    const expected = [
      [P1, 1, 'confirmed', `${P1} > ${A}`],
      [P2, 1, 'confirmed', `${P2} > ${A}`],
      // P1 comes before P2 in the order of keys.
      [X, 2, 'confirmed', `${X} > ${P1} | ${P1} > ${A}`],
    ];
    for (const order of [components, [...components].reverse()]) {
      const found = walk(graphOf(order), A);
      expect(outline(found)).toEqual(expected);
      // Of the three references of P1, the first by line, then by kind.
      expect(found.results[0]?.reference).toMatchObject({ line: 3, kind: 'reads', origin: 'parser:formula' });
    }
  });

  it('shows a reference with a place before one without, and one without when there is no other', () => {
    // What Salesforce reports has no place. The reference a parser found says where to look.
    const reported = (from: ComponentKey): Reference =>
      validateReference({
        from,
        to: A,
        toType: 'CustomField',
        toNameRaw: 'A__c',
        kind: 'references',
        origin: 'dependency-api',
        confidence: 'confirmed',
        resolution: 'resolved',
      });
    const both = [holds(A), holds(B, reported, to(A, 5)), holds(C, reported)];
    for (const order of [both, [...both].reverse()]) {
      const [first, second] = walk(graphOf(order), A).results;
      expect(first?.reference).toMatchObject({ from: B, origin: 'parser:formula', file: fileOf(B), line: 5 });
      expect(second?.reference).toEqual({
        from: C,
        to: A,
        kind: 'references',
        origin: 'dependency-api',
        confidence: 'confirmed',
        resolution: 'resolved',
        file: null,
        line: null,
        column: null,
      });
    }
  });

  it('shows the most certain of the references between two components, whatever the chain before it', () => {
    // B is found over an uncertain reference, so every chain through B is uncertain. X names B twice at the
    // same place, once as a guess and once for sure: the answer shows the one that is sure.
    const twice = [
      holds(A),
      holds(B, tier(A, 'possible')),
      holds(X, tier(B, 'possible', 4), tier(B, 'probable', 4), tier(B, 'possible', 2)),
    ];
    for (const order of [twice, [...twice].reverse()]) {
      const found = walk(graphOf(order), A).results[1];
      expect(found).toMatchObject({ key: X, depth: 2, confidence: 'possible' });
      expect(found?.reference).toMatchObject({ confidence: 'probable', line: 4 });
    }
  });

  it('answers from one snapshot, whatever the other snapshots of the database hold', () => {
    const store = newStore();
    // The older snapshot: C, D and the object Other__c refer to A as well.
    const before = graphOf(
      [holds(A), holds(B, to(A)), holds(C, to(A, 2), to(B, 3)), holds(D, to(A)), holds(THING), holds(OTHER, to(A))],
      store,
    );
    // The newer one: D is gone, C no longer refers to A, and X is new.
    const after = graphOf([holds(A), holds(B, to(A)), holds(C, to(B, 3)), holds(X, to(C)), holds(THING)], store);
    expect(outline(walk(after, A))).toEqual([
      [B, 1, 'confirmed', `${B} > ${A}`],
      [C, 2, 'confirmed', `${C} > ${B} | ${B} > ${A}`],
      [X, 3, 'confirmed', `${X} > ${C} | ${C} > ${B} | ${B} > ${A}`],
    ]);
    expect(outline(walk(before, A))).toEqual([
      [B, 1, 'confirmed', `${B} > ${A}`],
      [C, 1, 'confirmed', `${C} > ${A}`],
      [D, 1, 'confirmed', `${D} > ${A}`],
      [OTHER, 1, 'confirmed', `${OTHER} > ${A}`],
    ]);
    // The object of the newer snapshot starts from the fields that snapshot holds, and counts only those.
    expect(walk(after, THING)).toMatchObject({ parts: 3, results: [{ key: X, depth: 1 }] });
    expect(walk(before, THING)).toMatchObject({ parts: 4, results: [{ key: OTHER, depth: 1 }] });
    expect(walk(after, X, { direction: 'outgoing' }).results.map((result) => result.key)).toEqual([C, B, A]);
  });

  it('walks a level of more components than one statement takes, with as many references to choose between', () => {
    const many = 4_500;
    const wide = (at: number): ComponentKey => field(`Wide__c.F${String(at).padStart(4, '0')}__c`);
    const components = [holds(A)];
    // Every field refers to A twice, so each of them is a choice between two references by their places.
    for (let at = 0; at < many; at += 1) components.push(holds(wide(at), to(A, 7), to(A, 3)));
    components.push(holds(X, ...Array.from({ length: many }, (_, at) => to(wide(at), at + 1))));
    const found = walk(graphOf(components), A);
    expect(found.results).toHaveLength(many + 1);
    expect(found.results.slice(0, many).every((result) => result.depth === 1 && result.reference.line === 3)).toBe(
      true,
    );
    // X refers to all of them. The one whose key comes first is the way that is kept.
    expect(found.results.at(-1)).toMatchObject({ key: X, depth: 2, reference: { to: wide(0), line: 1 } });
    // The other way round, the walk starts from one component and finds all of them at once.
    const down = walk(graphOf(components), X, { direction: 'outgoing' });
    expect(down.results.map((result) => result.depth)).toEqual([...Array.from({ length: many }, () => 1), 2]);
    expect(down.results.at(-1)).toMatchObject({ key: A, reference: { from: wide(0), line: 3 } });
  });

  it('ends on references that go round in a circle, and never finds the component itself', () => {
    const graph = graphOf([holds(A, to(A, 2), to(C, 3)), holds(B, to(A), to(C, 2)), holds(C, to(B))]);
    expect(outline(walk(graph, A))).toEqual([
      [B, 1, 'confirmed', `${B} > ${A}`],
      [C, 2, 'confirmed', `${C} > ${B} | ${B} > ${A}`],
    ]);
    expect(outline(walk(graph, A, { direction: 'outgoing' }), true)).toEqual([
      [C, 1, 'confirmed', `${A} > ${C}`],
      [B, 2, 'confirmed', `${A} > ${C} | ${C} > ${B}`],
    ]);
  });

  it('starts from a component and everything it contains, and never gives what it contains as a result', () => {
    const lookup = field('Other__c.Thing__c');
    const check = rule('Other__c.Check');
    const graph = graphOf([
      holds(THING),
      holds(A),
      // A reference inside the object: both ends are part of the start.
      holds(B, to(A)),
      holds(OTHER),
      holds(lookup, to(THING, 5, { kind: 'references', origin: 'parser:xml' })),
      holds(check, to(B, 6)),
      holds(X, to(lookup)),
    ]);
    const found = walk(graph, THING);
    expect(found.parts).toBe(2);
    expect(outline(found)).toEqual([
      [lookup, 1, 'confirmed', `${lookup} > ${THING}`],
      [check, 1, 'confirmed', `${check} > ${B}`],
      [X, 2, 'confirmed', `${X} > ${lookup} | ${lookup} > ${THING}`],
    ]);
    // The other way round, the object refers to what its parts refer to.
    const lookupOnly = walk(graph, OTHER, { direction: 'outgoing' });
    expect(lookupOnly.parts).toBe(3);
    expect(outline(lookupOnly, true)).toEqual([
      [B, 1, 'confirmed', `${check} > ${B}`],
      [THING, 1, 'confirmed', `${lookup} > ${THING}`],
      [A, 2, 'confirmed', `${check} > ${B} | ${B} > ${A}`],
    ]);
  });

  it('counts as parts what the snapshot holds, and starts from what it only refers to as well', () => {
    const name = field('Account.Name');
    const graph = graphOf([
      { key: object('Account'), name: 'Account', definition: null, attrs: null, references: [] },
      holds(field('Account.Tier__c')),
      holds(B, to(name, 1, { resolution: 'external' })),
    ]);
    const found = walk(graph, object('Account'));
    // The standard field has no file in the snapshot. A reference to it is one to the object all the same.
    expect(found.parts).toBe(1);
    expect(outline(found)).toEqual([[B, 1, 'confirmed', `${B} > ${name}`]]);
  });

  it('continues from a component it found, not from what that component contains or is contained in', () => {
    const inner = field('Other__c.Inner__c');
    const graph = graphOf([
      holds(A),
      // An object that refers to the field, and a field of another object that does.
      holds(OTHER, to(A, 1, { kind: 'references', origin: 'parser:xml' })),
      holds(inner),
      holds(D, to(A)),
      // These refer to a part of the object that was found, and to the object of the field that was found.
      holds(B, to(inner)),
      holds(C, to(THING, 1, { kind: 'references', origin: 'parser:xml' })),
      holds(THING),
    ]);
    expect(outline(walk(graph, A))).toEqual([
      [D, 1, 'confirmed', `${D} > ${A}`],
      [OTHER, 1, 'confirmed', `${OTHER} > ${A}`],
    ]);
  });

  it('stops at the depth that was asked for, and says whether references lead further', () => {
    const graph = graphOf([holds(A), holds(B, to(A)), holds(C, to(B)), holds(D, to(C))]);
    const keys = (depth: number | undefined): unknown => {
      const found = walk(graph, A, { depth });
      return [found.results.map((result) => result.key), found.beyondDepth];
    };
    expect(keys(1)).toEqual([[B], true]);
    expect(keys(2)).toEqual([[B, C], true]);
    expect(keys(3)).toEqual([[B, C, D], false]);
    expect(keys(7)).toEqual([[B, C, D], false]);
    expect(keys(undefined)).toEqual([[B, C, D], false]);
    // What lies beyond the depth and is already in the answer is not "further".
    const round = graphOf([holds(A, to(B)), holds(B, to(A))]);
    expect(walk(round, A, { depth: 1 })).toMatchObject({ results: [{ key: B }], beyondDepth: false });
  });

  it('gives what a component refers to, with the names that have no component', () => {
    const name = field('Account.Name');
    const nameless = (line: number, raw: string) => (from: ComponentKey) =>
      validateReference({
        from,
        to: null,
        toType: 'CustomField',
        toNameRaw: raw,
        kind: 'reads',
        origin: 'parser:formula',
        confidence: 'confirmed',
        resolution: 'unresolved',
        location: { file: fileOf(from), line, column: 9 },
      });
    const graph = graphOf([
      holds(A, to(B, 2), to(name, 3, { resolution: 'external' }), nameless(4, 'Gone__c')),
      holds(B, to(C), nameless(8, 'Lost__c')),
      holds(C),
    ]);
    const found = walk(graph, A, { direction: 'outgoing' });
    expect(outline(found, true)).toEqual([
      [name, 1, 'confirmed', `${A} > ${name}`],
      [B, 1, 'confirmed', `${A} > ${B}`],
      [C, 2, 'confirmed', `${A} > ${B} | ${B} > ${C}`],
    ]);
    // A component the snapshot refers to and does not hold has a key, and neither a name nor a file.
    expect(found.results[0]).toMatchObject({ key: name, type: 'CustomField', name: null, file: null });
    expect(found.unresolved).toEqual([
      {
        from: A,
        type: 'CustomField',
        name: 'Gone__c',
        kind: 'reads',
        origin: 'parser:formula',
        confidence: 'confirmed',
        resolution: 'unresolved',
        file: fileOf(A),
        line: 4,
        column: 9,
        depth: 1,
      },
      expect.objectContaining({ from: B, name: 'Lost__c', line: 8, depth: 2 }),
    ]);
    // A name without a component beyond the depth is something the answer leaves out.
    expect(
      walk(graphOf([holds(A, to(B)), holds(B, nameless(1, 'Lost__c'))]), A, { direction: 'outgoing', depth: 1 }),
    ).toMatchObject({ results: [{ key: B }], unresolved: [], beyondDepth: true });
    // What refers to a component never has such a name.
    expect(walk(graph, C).unresolved).toEqual([]);
  });

  it('finds the component a person names, by key, by type and name, and by name alone', () => {
    const same = 'Thing__c.Same';
    const permission = buildKey({ type: 'CustomPermission', fullName: 'Approve' });
    const graph = graphOf([
      holds(THING),
      holds(A, to(field('Account.Name'), 1, { resolution: 'external' })),
      holds(field(same)),
      holds(rule(same)),
      holds(permission),
    ]);
    const found = (named: string, types: readonly string[] = []): string => findComponent(graph, named, types).key;
    expect(found(A)).toBe(A);
    expect(found('CustomField:Thing__c.A__c')).toBe(A);
    expect(found('customfield:THING__C.a__C')).toBe(A);
    expect(found('  Thing__c.A__c ')).toBe(A);
    expect(found('thing__c')).toBe(THING);
    // A component the snapshot only refers to, and the object that contains it.
    expect(found('Account.Name')).toBe(field('Account.Name'));
    expect(found('Account')).toBe(object('Account'));
    // A type the engine does not know by name is looked in when the snapshot has it.
    expect(codeOf(() => found('Approve'))).toBe('COMPONENT_NOT_FOUND');
    expect(found('Approve', ['CustomPermission', 'CustomField'])).toBe(permission);
    expect(found('CustomPermission:Approve')).toBe(permission);

    const failure = (named: string): unknown => {
      try {
        findComponent(graph, named, []);
      } catch (error) {
        return (error as { toJSON: () => unknown }).toJSON();
      }
      return undefined;
    };
    expect(failure(same)).toEqual({
      code: 'COMPONENT_AMBIGUOUS',
      message: `"${same}" names 2 components: ${field(same)}, ${rule(same)}.`,
      hint: `Name the one you mean by its key, such as ${field(same)}.`,
      details: { component: same, snapshot: graph.snapshotId, candidates: [field(same), rule(same)] },
    });
    expect(found(`ValidationRule:${same}`)).toBe(rule(same));
    expect(failure('Thing__c.Nope__c')).toMatchObject({
      code: 'COMPONENT_NOT_FOUND',
      message: 'The snapshot knows no component "Thing__c.Nope__c".',
      details: { component: 'Thing__c.Nope__c', snapshot: graph.snapshotId },
    });
    for (const named of ['', '   ', 'CustomField:Thing__c.Nope__c', field('Thing__c.Nope__c')]) {
      expect(codeOf(() => found(named))).toBe('COMPONENT_NOT_FOUND');
    }
    // A type that is none, and a name no key can hold.
    expect(codeOf(() => found('not a type:Thing__c.A__c'))).toBe('KEY_INVALID');
    expect(codeOf(() => found('Thing__c.\u0007'))).toBe('KEY_INVALID');
  });
});

describe('what an answer does not cover', () => {
  const type = (name: string, more: Partial<TypeCount> = {}): TypeCount => ({
    type: name,
    listed: 3,
    retrieved: 3,
    analysed: 3,
    listing: 'ok',
    ...more,
  });
  const none = { read: 0, analysis: 0, analysisWarnings: 0 };
  /** The types the analysis of the snapshot read. */
  const READ = ['CustomField', 'CustomObject', 'ValidationRule'];
  const clean = { readErrors: 0, analysisErrors: 0, analysisWarnings: 0, notHeld: 0 };

  it('is nothing when every type was analysed and nothing is missing', () => {
    const gaps = impactGaps([type('CustomField'), type('CustomObject', { listed: 0, retrieved: 0 })], none, READ);
    expect(gaps).toEqual({ notAnalysed: [], partial: [], ...clean });
    expect([coversEverything(gaps), mayMissSomething(gaps)]).toEqual([true, false]);
    // A type of which the source has nothing is not one that was left out.
    expect(coversEverything(impactGaps([type('Flow', { listed: 0, retrieved: 0, analysed: 0 })], none, READ))).toBe(
      true,
    );
  });

  it('names the types that were not analysed, sorted, and misses nothing it claims to cover', () => {
    const gaps = impactGaps(
      [
        type('Flow', { analysed: 0 }),
        type('CustomField'),
        type('ApexClass', { listed: 5, retrieved: 4, analysed: 0 }),
        // A type that was listed and of which nothing came back, one that could not be listed, and one that
        // Salesforce never lists.
        type('Report', { listed: 2, retrieved: 0, analysed: 0 }),
        type('Dashboard', { listed: 0, retrieved: 0, analysed: 0, listing: 'failed' }),
        type('StandardValueSet', { listed: 0, retrieved: 0, analysed: 0, listing: 'unlistable' }),
      ],
      none,
      READ,
    );
    expect(gaps.notAnalysed).toEqual([
      { type: 'ApexClass', listed: 5, retrieved: 4, listing: 'ok' },
      { type: 'Dashboard', listed: 0, retrieved: 0, listing: 'failed' },
      { type: 'Flow', listed: 3, retrieved: 3, listing: 'ok' },
      { type: 'Report', listed: 2, retrieved: 0, listing: 'ok' },
      { type: 'StandardValueSet', listed: 0, retrieved: 0, listing: 'unlistable' },
    ]);
    expect(gaps.partial).toEqual([]);
    expect([coversEverything(gaps), mayMissSomething(gaps)]).toEqual([false, false]);
  });

  it('names the analysed types the snapshot holds in part, which an answer may miss something of', () => {
    const gaps = impactGaps(
      [
        type('CustomField', { listed: 60, retrieved: 54, analysed: 54 }),
        type('ValidationRule', { listing: 'failed' }),
        // The parts found inside the files of objects count more than was listed. Nothing is missing.
        type('CustomObject', { listed: 5, retrieved: 5, analysed: 7 }),
        type('RecordType', { listed: 0, retrieved: 0, analysed: 2, listing: 'unlistable' }),
      ],
      none,
      READ,
    );
    expect(gaps).toEqual({
      notAnalysed: [],
      partial: [
        { type: 'CustomField', listed: 60, retrieved: 54, listing: 'ok' },
        { type: 'ValidationRule', listed: 3, retrieved: 3, listing: 'failed' },
      ],
      ...clean,
    });
    expect([coversEverything(gaps), mayMissSomething(gaps)]).toEqual([false, true]);
  });

  it('names a type the configuration leaves out: as not analysed, or as missing if the analysis reads it', () => {
    const leftOut = type('EmailTemplate', { listed: 0, retrieved: 0, analysed: 0, listing: 'excluded' });
    const notRead = impactGaps([type('CustomField'), leftOut], none, READ);
    expect(notRead.notAnalysed).toEqual([{ type: 'EmailTemplate', listed: 0, retrieved: 0, listing: 'excluded' }]);
    expect(notRead.partial).toEqual([]);
    expect([coversEverything(notRead), mayMissSomething(notRead)]).toEqual([false, false]);
    // Once an analyser reads the type, an answer claims to cover it, and the snapshot holds nothing of it.
    const read = impactGaps([type('CustomField'), leftOut], none, [...READ, 'EmailTemplate']);
    expect(read.notAnalysed).toEqual([]);
    expect(read.partial).toEqual([{ type: 'EmailTemplate', listed: 0, retrieved: 0, listing: 'excluded' }]);
    expect([coversEverything(read), mayMissSomething(read)]).toEqual([false, true]);
  });

  it('takes a type the analysis reads as analysed also when the snapshot holds nothing of it', () => {
    const types = [
      type('CustomField'),
      // Four rules are listed and none came back, and the fields of the org could not be listed at all.
      type('ValidationRule', { listed: 4, retrieved: 0, analysed: 0 }),
      type('CustomObject', { listed: 0, retrieved: 0, analysed: 0, listing: 'failed' }),
      // The same of a type no analyser reads.
      type('Report', { listed: 4, retrieved: 0, analysed: 0 }),
    ];
    const gaps = impactGaps(types, none, READ);
    expect(gaps.partial).toEqual([
      { type: 'CustomObject', listed: 0, retrieved: 0, listing: 'failed' },
      { type: 'ValidationRule', listed: 4, retrieved: 0, listing: 'ok' },
    ]);
    expect(gaps.notAnalysed).toEqual([{ type: 'Report', listed: 4, retrieved: 0, listing: 'ok' }]);
    expect(mayMissSomething(gaps)).toBe(true);
    // A type that is read and of which the source has nothing misses nothing.
    expect(impactGaps([type('ValidationRule', { listed: 0, retrieved: 0, analysed: 0 })], none, READ)).toEqual({
      notAnalysed: [],
      partial: [],
      ...clean,
    });
    // An analysis that kept no list of its types: the number of analysed components decides alone.
    const old = impactGaps(types, none, null);
    expect(old.partial).toEqual([]);
    expect(old.notAnalysed.map((gap) => gap.type)).toEqual(['CustomObject', 'Report', 'ValidationRule']);
  });

  it('counts an error of the reading or of the analysis as something an answer may miss', () => {
    for (const errors of [
      { read: 1, analysis: 0, analysisWarnings: 0 },
      { read: 0, analysis: 2, analysisWarnings: 0 },
    ]) {
      const gaps = impactGaps([type('CustomField')], errors, READ);
      expect(gaps).toMatchObject({ readErrors: errors.read, analysisErrors: errors.analysis });
      expect([coversEverything(gaps), mayMissSomething(gaps)]).toEqual([false, true]);
    }
  });

  it('is not complete with a warning of the analysis or a component the snapshot does not hold', () => {
    // A name that was not followed can be a reference the answer lacks. It is not an error, and the exit code
    // follows errors.
    const warned = impactGaps([type('CustomField')], { read: 0, analysis: 0, analysisWarnings: 3 }, READ);
    expect(warned).toEqual({ notAnalysed: [], partial: [], ...clean, analysisWarnings: 3 });
    expect([coversEverything(warned), mayMissSomething(warned)]).toEqual([false, false]);
    const outside = { ...impactGaps([type('CustomField')], none, READ), notHeld: 1 };
    expect([coversEverything(outside), mayMissSomething(outside)]).toEqual([false, false]);
  });
});
