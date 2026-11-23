import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource } from '../src/core/config/config.ts';
import {
  DEPENDENCY_OBJECT,
  FLOW_VERSION_OBJECT,
  readDependencies,
  readFlowVersions,
  type DependencyLimits,
  type DependencyOptions,
  type DependencyReading,
  type FlowVersionReading,
} from '../src/sources/dependency-api.ts';
import { connectToOrg } from '../src/sources/org.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { dependencyRow, mockDependencies, type MockDependencyRow, type MockEnd } from './helpers/mock-dependencies.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';

const ORG_ID = '00Dxx0000000001EAA';
const source: OrgSource = {
  name: 'prod',
  kind: 'org',
  description: null,
  orgId: ORG_ID,
  loginUrl: null,
  excludeTypes: [],
};
const FAST: Partial<DependencyLimits> = { requestMs: 2_000, repeats: 1, repeatAfterMs: 10 };

let mock: MockOrg;

async function read(options: DependencyOptions = {}): Promise<DependencyReading> {
  await seedCliLogin({ username: 'dev@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'the-session' });
  mock.sessions.add('the-session');
  const session = await connectToOrg(source, undefined, {});
  mock.requests.length = 0;
  return readDependencies(session, { ...options, limits: { ...FAST, ...options.limits } });
}

/** Asks the mock org which versions of its flows are active and latest. */
async function readVersions(limits: Partial<DependencyLimits> = {}): Promise<FlowVersionReading> {
  await seedCliLogin({ username: 'dev@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'the-session' });
  mock.sessions.add('the-session');
  const session = await connectToOrg(source, undefined, {});
  mock.requests.length = 0;
  return readFlowVersions(session, { limits: { ...FAST, ...limits } });
}

/** Rows of `FlowDefinition` as the Tooling API gives them. */
const DEFINITIONS: Record<string, string | null>[] = [
  {
    Id: '300xx0000000001AAA',
    DeveloperName: 'Invoice_Recalculate',
    NamespacePrefix: null,
    ActiveVersionId: '301xx0000000001AAA',
    LatestVersionId: '301xx0000000002AAA',
  },
  {
    Id: '300xx0000000002AAA',
    DeveloperName: 'Renew',
    NamespacePrefix: 'acme',
    ActiveVersionId: '301xx0000000003AAA',
    LatestVersionId: '301xx0000000003AAA',
  },
  // A flow no version of which is active, and one whose ids are not ids.
  {
    Id: '300xx0000000003AAA',
    DeveloperName: 'Never_Active',
    NamespacePrefix: null,
    ActiveVersionId: null,
    LatestVersionId: '301xx0000000004AAA',
  },
  { Id: '300xx0000000004AAA', DeveloperName: 'Odd', NamespacePrefix: '', ActiveVersionId: 'none', LatestVersionId: '' },
  // A row without a name says nothing.
  { Id: '300xx0000000005AAA', DeveloperName: '', NamespacePrefix: null, ActiveVersionId: null, LatestVersionId: null },
];
/** What the reading makes of them, sorted by flow. */
const VERSIONS = [
  { flow: 'Invoice_Recalculate', active: '301xx0000000001AAA', latest: '301xx0000000002AAA' },
  { flow: 'Never_Active', active: null, latest: '301xx0000000004AAA' },
  { flow: 'Odd', active: null, latest: null },
  { flow: 'acme__Renew', active: '301xx0000000003AAA', latest: '301xx0000000003AAA' },
];

/** Rows from `count` components of one type to one component each of another type. */
function rowsOf(from: string, to: string, count: number, perComponent = 1): MockDependencyRow[] {
  const rows: MockDependencyRow[] = [];
  for (let at = 0; at < count; at += 1) {
    for (let target = 0; target < perComponent; target += 1) {
      const a: MockEnd = [from, `${from}_${String(at)}`];
      const b: MockEnd = [to, `${to}_${String(at)}_${String(target)}`];
      rows.push(dependencyRow(null, a, b));
    }
  }
  return rows;
}

const idsIn = (rows: readonly MockDependencyRow[], type: string): string[] => [
  ...new Set(
    rows.filter((row) => row['MetadataComponentType'] === type).map((row) => row['MetadataComponentId'] ?? ''),
  ),
];
/** The rows of a reading, each as `type name > type name`, sorted. */
const pairs = (reading: DependencyReading): string[] =>
  reading.rows.map(({ from, to }) => `${from.type} ${from.name} > ${to.type} ${to.name}`).sort();
const pairsOf = (rows: readonly MockDependencyRow[]): string[] =>
  rows
    .map(
      (row) =>
        `${row['MetadataComponentType'] ?? ''} ${row['MetadataComponentName'] ?? ''} > ${row['RefMetadataComponentType'] ?? ''} ${row['RefMetadataComponentName'] ?? ''}`,
    )
    .sort();

beforeAll(async () => {
  mock = await startMockOrg({ versions: ['65.0', '66.0'] });
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.intercept = null;
  mock.dependencies = null;
  mock.stall = false;
  await forgetCliLogins();
});

describe('reading the Dependency API', () => {
  it('reads the rows of a small org with one query', async () => {
    mock.dependencies = mockDependencies([
      dependencyRow(null, ['CustomField', 'Invoice__c.Total__c'], ['CustomField', 'Invoice__c.Amount__c']),
      dependencyRow(null, ['ValidationRule', 'Invoice__c.Amount_Positive'], ['CustomField', 'Invoice__c.Amount__c']),
      dependencyRow(null, ['ApexClass', 'InvoiceService'], ['CustomObject', 'Invoice__c']),
      dependencyRow(null, ['ApexClass', 'InvoiceService'], ['CustomObject', 'Account']),
      dependencyRow(null, ['ValidationRule', 'Invoice__c.Rate_Ok'], ['CustomMetadata', 'Billing_Rule.Default']),
      { ...dependencyRow(null, ['ApexClass', 'A'], ['ApexClass', 'B']), RefMetadataComponentNamespace: 'pkg' },
    ]);
    const reading = await read();
    expect(reading).toMatchObject({ state: 'whole', requests: 1, cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual([
      'ApexClass A > ApexClass B',
      'ApexClass InvoiceService > CustomObject Invoice',
      'ApexClass InvoiceService > StandardEntity Account',
      'CustomField Total > CustomField Amount',
      'ValidationRule Amount_Positive > CustomField Amount',
      'ValidationRule Rate_Ok > Billing_Rule__mdt Default',
    ]);
    expect(reading.rows.find((row) => row.to.name === 'B')?.to).toEqual({
      type: 'ApexClass',
      id: expect.stringMatching(/^0Zzxx\d{10}AAA$/) as string,
      name: 'B',
      namespace: 'pkg',
    });
    expect(reading.rows.find((row) => row.to.type === 'StandardEntity')?.to).toMatchObject({
      id: 'Account',
      namespace: null,
    });
    expect(mock.asked()).toEqual(['GET /services/data/v66.0/tooling/query']);
  });

  it('gives the rows in the same order whatever order the org gives them in', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('CustomField', 'CustomField', 3)];
    mock.dependencies = mockDependencies(rows);
    const one = await read();
    mock.dependencies = mockDependencies([...rows].reverse());
    expect((await read()).rows).toEqual(one.rows);
    // The same row twice is one row.
    mock.dependencies = mockDependencies([...rows, ...rows]);
    expect((await read()).rows).toEqual(one.rows);
  });

  it('asks per type of the component that refers when one query does not give every row', async () => {
    const rows = [
      ...rowsOf('ApexClass', 'CustomField', 4),
      ...rowsOf('CustomField', 'CustomField', 3),
      ...rowsOf('Layout', 'CustomField', 2),
      // Types the engine does not know by name: a lookup filter, and something else.
      ...rowsOf('LookupFilter', 'CustomField', 2),
      ...rowsOf('Odd_Thing', 'CustomField', 1),
    ];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const asked = mock.dependencies.queries.map((soql) => soql.slice(soql.indexOf(' FROM ')));
    expect(asked[0]).toBe(' FROM MetadataComponentDependency');
    expect(asked).toContain(" FROM MetadataComponentDependency WHERE MetadataComponentType = 'ApexClass'");
    expect(asked).toContain(" FROM MetadataComponentDependency WHERE MetadataComponentType = 'WorkflowRule'");
    // What is of no type that was asked for by name is asked for at the end, until nothing is left.
    expect(asked.filter((soql) => soql.includes('MetadataComponentType NOT IN'))).toHaveLength(1);
    expect(asked.at(-1)).toContain("'ApexClass'");
    expect(asked.at(-1)).not.toContain('Ref');
  });

  it('finds a type that only the rest shows, and asks for it by name', async () => {
    // Seven types that the engine does not know, each with as many rows as a query gives: the first query shows
    // one of them, and the rest shows the next one every time.
    const rows = ['Aa', 'Bb', 'Cc', 'Dd'].flatMap((type) => rowsOf(type, 'CustomField', 3));
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 3;
    const reading = await read({ limits: { rowsPerQuery: 3, rounds: 6 } });
    // A type alone is at the limit too, so it is asked per type of target, and per component, of which no id
    // is known here.
    expect(reading.state).toBe('partial');
    expect(pairs(reading)).toEqual(pairsOf(rows));
    // With too few rounds, a type stays unseen and the reading says that rows are missing.
    mock.dependencies.queries.length = 0;
    const short = await read({ limits: { rowsPerQuery: 3, rounds: 2 } });
    expect(short.state).toBe('partial');
    expect(short.rows.length).toBeLessThan(rows.length);
  });

  it('asks per pair of types where one type alone is at the limit', async () => {
    const rows = [
      ...rowsOf('ApexClass', 'CustomField', 4),
      ...rowsOf('ApexClass', 'CustomObject', 4),
      ...rowsOf('ApexClass', 'ApexClass', 3),
      ...rowsOf('CustomField', 'CustomField', 2),
    ];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0 });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const where = mock.dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(where).toContain("MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'CustomField'");
    // The rest holds the rows to a class and to a standard object, and is at the limit. A class is a type that
    // can be asked for by name, so it is, and the rest is asked for again without it.
    expect(where).toContain("MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField')");
    expect(where).toContain("MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'ApexClass'");
    expect(where).toContain(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('ApexClass', 'CustomField')",
    );
    // A type that is not at the limit is not asked for per pair.
    expect(where.some((one) => one.startsWith("MetadataComponentType = 'CustomField' AND"))).toBe(false);
  });

  it('never names a standard object as the type of a target, and reads its rows with the rest', async () => {
    // The mock org refuses a condition that names `StandardEntity`, as Salesforce does.
    const standard = rowsOf('ApexClass', 'CustomObject', 3);
    expect(standard.every((row) => row['RefMetadataComponentType'] === 'StandardEntity')).toBe(true);
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...standard, ...rowsOf('CustomField', 'CustomField', 2)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    expect(dependencies.queries.filter((soql) => soql.includes('StandardEntity'))).toEqual([]);
    expect(dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '')).toContain(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField')",
    );
    // The mock org does refuse such a condition: alone, and first, last or in the middle of a list.
    for (const condition of [
      "RefMetadataComponentType = 'StandardEntity'",
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField', 'StandardEntity')",
      "RefMetadataComponentType NOT IN ('StandardEntity', 'CustomField')",
      "RefMetadataComponentType NOT IN ('ApexClass', 'StandardEntity', 'CustomField')",
      "RefMetadataComponentType NOT IN ('StandardEntity')",
    ]) {
      const answer = dependencies.answer(`${dependencies.queries[0] ?? ''} WHERE ${condition}`);
      expect(answer).toMatchObject({ status: 400 });
      expect(answer.body).toContain('INVALID_TYPE_FOR_OPERATION');
    }
    // It answers a condition on the type of the component that refers, and a type with a name that is like it.
    for (const condition of [
      "MetadataComponentType = 'StandardEntity'",
      "MetadataComponentType NOT IN ('ApexClass', 'StandardEntity')",
      "RefMetadataComponentType = 'StandardEntityX'",
    ]) {
      expect(dependencies.answer(`${dependencies.queries[0] ?? ''} WHERE ${condition}`)).toMatchObject({ status: 200 });
    }
  });

  it('says that rows are missing when the rest does not bring a row that is known to be of it', async () => {
    // An org that answers the rest and leaves the rows to standard objects out of it. Nothing has shown that
    // Salesforce puts them in, and the rest is the only query that asks for them.
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('ApexClass', 'CustomObject', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    const answer = dependencies.answer.bind(dependencies);
    dependencies.answer = (soql) => {
      const answered = answer(soql);
      if (!soql.includes('RefMetadataComponentType NOT IN') || answered.status !== 200) return answered;
      const body = JSON.parse(answered.body) as { records: MockDependencyRow[] };
      const records = body.records.filter((row) => row['RefMetadataComponentType'] !== 'StandardEntity');
      return { status: 200, body: JSON.stringify({ ...body, records, size: records.length }) };
    };
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    // The query for all classes showed one row to a standard object before it was cut off, and the rest did
    // not bring it again.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, failed: 0 });
    expect(reading.rows.length).toBeLessThan(rows.length);
  });

  it('asks for the rows to standard objects per component where the rest is at the limit', async () => {
    // 3 classes that refer to a field, and 12 that each refer to one standard object.
    const rows = [...rowsOf('ApexClass', 'CustomField', 3), ...rowsOf('ApexClass', 'CustomObject', 12)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: 5, idsPerQuery: 16 }, idsOfType: () => ids });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    expect(dependencies.queries.filter((soql) => soql.includes('StandardEntity'))).toEqual([]);
    const where = dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    // The rows to a field are asked for by name. The rest holds the rows to standard objects and is at the
    // limit, with no type left to name: it is asked for per group of classes, and once for every other class.
    const rest = "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField')";
    expect(where).toContain(rest);
    expect(where.some((one) => one.startsWith(`${rest} AND MetadataComponentId IN (`))).toBe(true);
    expect(where.filter((one) => one.startsWith(`${rest} AND MetadataComponentId NOT IN (`))).toHaveLength(1);

    // Without the ids of the classes, the rest cannot be asked for in smaller parts, and the reading says so.
    const blind = await read({ limits: { rowsPerQuery: 5 } });
    expect(blind).toMatchObject({ state: 'partial', cutOff: 1, failed: 0 });

    // Where every row the type shows is to a standard object, no type is left out of the rest: the rest is the
    // query for the whole type, which is not asked a second time, and its rows are asked for per class.
    const only = rowsOf('ApexClass', 'CustomObject', 12);
    const alone = mockDependencies(only);
    alone.limit = 5;
    mock.dependencies = alone;
    const all = await read({ limits: { rowsPerQuery: 5, idsPerQuery: 16 }, idsOfType: () => idsIn(only, 'ApexClass') });
    expect(all).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(all)).toEqual(pairsOf(only));
    const asked = alone.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(asked.filter((one) => one.includes('Ref'))).toEqual([]);
    expect(asked.filter((one) => one === "MetadataComponentType = 'ApexClass'")).toHaveLength(1);
    expect(
      asked.some((one) => one.startsWith("MetadataComponentType = 'ApexClass' AND MetadataComponentId IN (")),
    ).toBe(true);
  });

  it('leaves the rows of a type of target that the org refuses by name to the rest', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('ApexClass', 'CustomLabel', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    dependencies.refuse = (soql) =>
      soql.includes("RefMetadataComponentType = 'CustomLabel'") ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    // The rest gave the rows of the type that got no answer, so nothing is missing.
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const where = dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(where.filter((one) => one.includes("RefMetadataComponentType = 'CustomLabel'"))).toHaveLength(1);
    expect(where).toContain("MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField')");

    // The type that is refused by name has more rows than a query gives: the rest is at the limit with no type
    // left to name, and is asked for per group of classes.
    const many = [...rowsOf('ApexClass', 'CustomField', 3), ...rowsOf('ApexClass', 'CustomLabel', 12)];
    const large = mockDependencies(many);
    large.limit = 5;
    large.refuse = dependencies.refuse;
    mock.dependencies = large;
    const perClass = await read({
      limits: { rowsPerQuery: 5, idsPerQuery: 16 },
      idsOfType: () => idsIn(many, 'ApexClass'),
    });
    expect(perClass).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(perClass)).toEqual(pairsOf(many));
  });

  it('asks for the whole type per component when the org refuses the list of types of the rest', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('ApexClass', 'CustomObject', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    // The test org has not shown that it answers a list of types of the target. An org that does not:
    dependencies.refuse = (soql) =>
      soql.includes('RefMetadataComponentType NOT IN') ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: 5, idsPerQuery: 16 }, idsOfType: () => ids });
    // The conditions on the id of a component need no list of types, and give every row of the classes.
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const where = dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(where.filter((one) => one.includes('RefMetadataComponentType NOT IN'))).toHaveLength(1);
    expect(
      where.some((one) => one.startsWith("MetadataComponentType = 'ApexClass' AND MetadataComponentId IN (")),
    ).toBe(true);

    // Without the ids of the classes there is no other way to ask, and the reading says that rows are missing.
    const blind = await read({ limits: { rowsPerQuery: 5 } });
    expect(blind).toMatchObject({ state: 'partial', cutOff: 1, failed: 0, code: 'INVALID_TYPE_FOR_OPERATION' });
    expect(blind.rows.length).toBeLessThan(rows.length);
  });

  it('does not leave the rows of a type to the rest when its query took too long or broke off', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('ApexClass', 'CustomLabel', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    dependencies.refuse = (soql) =>
      soql.includes("RefMetadataComponentType = 'CustomLabel'") ? 'QUERY_TIMEOUT' : undefined;
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    // A rest with these rows in it would take longer still. The type is counted, and the rest leaves it out.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 0, failed: 1, code: 'QUERY_TIMEOUT' });
    expect(dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '')).toContain(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField', 'CustomLabel')",
    );
  });

  it('asks for the rest per component after the last round, where a type is still left to name', async () => {
    // Three types of target with more rows each than a query gives: every rest shows one more type.
    const rows = ['CustomField', 'CustomLabel', 'CustomPermission'].flatMap((to) => rowsOf('ApexClass', to, 6));
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: 5, idsPerQuery: 32, rounds: 1 }, idsOfType: () => ids });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(reading)).toEqual(pairsOf(rows));
  });

  it('asks per group of components where a pair of types is at the limit, and halves a group that is', async () => {
    // 12 classes with 2 rows each, and one class with 4.
    const rows = [...rowsOf('ApexClass', 'CustomField', 12, 2), ...rowsOf('ApexClass', 'CustomObject', 1, 4)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({
      limits: { rowsPerQuery: 5, idsPerQuery: 4 },
      idsOfType: (type) => (type === 'ApexClass' ? ids : []),
    });
    // Every row is there. The classes are more than one query names, so no query can ask for the rows of a class
    // that is not among the ids, and the reading says that it cannot know of one.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 0, failed: 0, unproven: 1, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const groups = mock.dependencies.queries
      .filter((soql) => soql.includes('MetadataComponentId IN'))
      .map((soql) => (soql.match(/'0Zzxx/g) ?? []).length);
    // Four ids give 8 rows, which is over the limit, so each group is asked for again in two halves.
    expect(groups).toContain(4);
    expect(groups).toContain(2);
    expect(Math.max(...groups)).toBe(4);
    expect(mock.dependencies.queries.some((soql) => soql.includes('MetadataComponentId NOT IN'))).toBe(false);

    // Where one query names every class, a last query asks for the rows of every other class. It gives none
    // here, and the reading is whole.
    mock.dependencies.queries.length = 0;
    const proven = await read({
      limits: { rowsPerQuery: 5, idsPerQuery: 16 },
      idsOfType: (type) => (type === 'ApexClass' ? ids : []),
    });
    expect(proven).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0, code: null });
    expect(pairs(proven)).toEqual(pairsOf(rows));
    expect(mock.dependencies.queries.filter((soql) => soql.includes('MetadataComponentId NOT IN'))).toHaveLength(1);
  });

  it('reads the rows of a component the org did not list, or says that they are missing', async () => {
    // 12 classes with one row each. The listing knows 10 of them: two were made after it, say.
    const rows = rowsOf('ApexClass', 'CustomField', 12);
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    const ids = idsIn(rows, 'ApexClass');
    const most = await read({ limits: { rowsPerQuery: 5 }, idsOfType: () => ids.slice(0, 10) });
    expect(most).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(most)).toEqual(pairsOf(rows));

    // The listing knows 6. The other 6 are as many as a query gives: the query for them is cut off.
    const half = await read({ limits: { rowsPerQuery: 5 }, idsOfType: () => ids.slice(0, 6) });
    expect(half).toMatchObject({ state: 'partial', cutOff: 1, failed: 0, unproven: 0 });
    expect(half.rows.length).toBeLessThan(rows.length);

    // More ids than one query names: the 6 other classes cannot be asked for, and the reading says so.
    const unknown = await read({ limits: { rowsPerQuery: 5, idsPerQuery: 3 }, idsOfType: () => ids.slice(0, 6) });
    expect(unknown).toMatchObject({ state: 'partial', cutOff: 0, failed: 0, unproven: 1 });
  });

  it('does not trust the groups when a row the pair gave does not come again', async () => {
    // An org that answers a condition on the id with no row: because it reads the id otherwise, say.
    const rows = rowsOf('ApexClass', 'CustomField', 12);
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    mock.intercept = (request) =>
      (request.query.get('q') ?? '').includes('MetadataComponentId IN')
        ? { status: 200, body: JSON.stringify({ done: true, records: [] }) }
        : undefined;
    const reading = await read({ limits: { rowsPerQuery: 5 }, idsOfType: () => idsIn(rows, 'ApexClass') });
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, failed: 0, unproven: 0 });
    // The query for every other class is not asked: what the groups gave says nothing.
    expect(dependencies.queries.some((soql) => soql.includes('MetadataComponentId NOT IN'))).toBe(false);
  });

  it('says that rows are missing when one component alone is at the limit', async () => {
    const rows = rowsOf('ApexClass', 'CustomField', 2, 7);
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: 5 }, idsOfType: () => ids });
    expect(reading).toMatchObject({ state: 'partial', cutOff: 2, failed: 0 });
    expect(reading.rows).toHaveLength(10);
  });

  it('does not ask per component when the ids it has are not the ones of the rows', async () => {
    const rows = rowsOf('ApexClass', 'CustomField', 12);
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    // No id at all.
    expect(await read({ limits: { rowsPerQuery: 5 } })).toMatchObject({ state: 'partial', cutOff: 1 });
    // Ids of something else: asking per id would give nothing, and look complete.
    mock.dependencies.queries.length = 0;
    const other = await read({ limits: { rowsPerQuery: 5 }, idsOfType: () => ['0Axxx0000000001AAA'] });
    expect(other).toMatchObject({ state: 'partial', cutOff: 1 });
    expect(mock.dependencies.queries.some((soql) => soql.includes('MetadataComponentId IN'))).toBe(false);
    // An id that is none never stands in a query.
    mock.dependencies.queries.length = 0;
    await read({ limits: { rowsPerQuery: 5 }, idsOfType: () => ["x' OR Id != '", ...idsIn(rows, 'ApexClass')] });
    expect(mock.dependencies.queries.some((soql) => soql.includes(' OR '))).toBe(false);
  });

  it('queries one object, and only reads', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 12, 2), ...rowsOf('CustomField', 'CustomField', 7)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    await read({ limits: { rowsPerQuery: 5, idsPerQuery: 8 }, idsOfType: (type) => idsIn(rows, type) });
    expect(mock.dependencies.queries.length).toBeGreaterThan(20);
    for (const soql of mock.dependencies.queries) {
      expect(soql).toMatch(new RegExp(`^SELECT [A-Za-z, ]+ FROM ${DEPENDENCY_OBJECT}( WHERE |$)`));
      // No query inside the query: one SELECT, and one FROM.
      expect(soql.match(/\b(?:SELECT|FROM)\b/gi)).toHaveLength(2);
    }
    expect(mock.dependencies.queries.some((soql) => soql.includes('MetadataComponentId NOT IN'))).toBe(true);
    expect(DEPENDENCY_OBJECT).toBe('MetadataComponentDependency');
    expect(new Set(mock.requests.map((request) => `${request.method} ${request.path}`))).toEqual(
      new Set(['GET /services/data/v66.0/tooling/query']),
    );
  });

  it('gives a reading that says so when the org does not have the API', async () => {
    mock.dependencies = null;
    const reading = await read();
    // It stops after the third query in a row that the org refused.
    expect(reading).toMatchObject({ rows: [], state: 'none', requests: 3, cutOff: 0, code: 'INVALID_TYPE' });
  });

  it('goes on when the query for everything is refused and the queries per type are answered', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('Odd_Thing', 'CustomField', 1)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.refuse = (soql) => (soql.includes(' WHERE ') ? undefined : 'QUERY_TIMEOUT');
    const reading = await read();
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
  });

  it('asks for a type whose query is refused in its parts, and counts what is refused there', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('CustomField', 'CustomField', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 5;
    mock.dependencies = dependencies;
    // The org refuses the query for all rows of the type, as it does when that query takes it too long.
    dependencies.refuse = (soql) =>
      soql.endsWith("MetadataComponentType = 'ApexClass'") ? 'QUERY_TIMEOUT' : undefined;
    const inParts = await read({ limits: { rowsPerQuery: 5 } });
    expect(inParts).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(inParts)).toEqual(pairsOf(rows));
    expect(dependencies.queries).toContain(
      `${dependencies.queries[0] ?? ''} WHERE MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'CustomField'`,
    );

    // It refuses every query about the type. The rows of the pair are left to the rest, and with no pair
    // answered the rest is the query for the whole type, which failed: that is counted once. The other types
    // are read.
    dependencies.queries.length = 0;
    dependencies.refuse = (soql) =>
      soql.includes("MetadataComponentType = 'ApexClass'") ? 'UNKNOWN_EXCEPTION' : undefined;
    const refused = await read({ limits: { rowsPerQuery: 5 } });
    expect(refused).toMatchObject({ state: 'partial', cutOff: 0, failed: 1, code: 'UNKNOWN_EXCEPTION' });
    expect(dependencies.queries.filter((soql) => soql.endsWith("MetadataComponentType = 'ApexClass'"))).toHaveLength(1);
    expect(refused.rows.filter((row) => row.from.type === 'CustomField')).toHaveLength(3);

    // Without a row, no part of the type is known, and the query that failed is not asked a second time.
    dependencies.queries.length = 0;
    dependencies.refuse = (soql) =>
      !soql.includes(' WHERE ') || soql.includes("MetadataComponentType = 'ApexClass'")
        ? 'UNKNOWN_EXCEPTION'
        : undefined;
    const blind = await read({ limits: { rowsPerQuery: 5 } });
    expect(blind).toMatchObject({ state: 'partial', failed: 1 });
    expect(dependencies.queries.filter((soql) => soql.includes("MetadataComponentType = 'ApexClass'"))).toHaveLength(1);
  });

  it('stops without failing when the org no longer accepts the session', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('CustomField', 'CustomField', 3)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    let answered = 0;
    mock.intercept = (request) => {
      if (!request.path.endsWith('/tooling/query')) return undefined;
      answered += 1;
      if (answered === 3) mock.sessions.clear();
      return undefined;
    };
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    expect(reading).toMatchObject({ state: 'partial', code: 'INVALID_SESSION_ID' });
    expect(reading.failed).toBeGreaterThan(0);
    // No query after the one that was refused for the session.
    expect(mock.dependencies.queries).toHaveLength(2);
  });

  it('stops without failing when the org does not answer', async () => {
    mock.dependencies = mockDependencies(rowsOf('ApexClass', 'CustomField', 4));
    mock.intercept = (request) =>
      request.path.endsWith('/tooling/query')
        ? { status: 200, body: JSON.stringify({ done: true, records: [] }), halfway: 'stall' }
        : undefined;
    const reading = await read({ limits: { requestMs: 300, repeats: 1 } });
    // A query that took too long is not asked again. After three of them in a row the reading stops: the
    // query for everything, whose parts were to follow, and two queries for a type.
    expect(reading).toEqual({
      rows: [],
      state: 'none',
      requests: 3,
      cutOff: 0,
      failed: 2,
      unproven: 0,
      code: 'TIMEOUT',
    });
  });

  it('goes on with the parts when the query for everything takes too long', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('CustomField', 'CustomField', 3)];
    const dependencies = mockDependencies(rows);
    mock.dependencies = dependencies;
    mock.intercept = (request) =>
      request.path.endsWith('/tooling/query') && !(request.query.get('q') ?? '').includes(' WHERE ')
        ? { status: 200, body: JSON.stringify({ done: true, records: [] }), halfway: 'stall' }
        : undefined;
    const reading = await read({ limits: { requestMs: 300 } });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    // The query that took too long was sent once.
    expect(mock.requests.filter((request) => !(request.query.get('q') ?? '').includes(' WHERE '))).toHaveLength(1);
  });

  it('stops at its limit of requests, and says that rows are missing', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 12, 2), ...rowsOf('CustomField', 'CustomField', 7)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    const reading = await read({ limits: { rowsPerQuery: 5, requestsInAll: 4 } });
    expect(reading).toMatchObject({ state: 'partial', requests: 4, code: 'REQUESTS_USED_UP' });
    expect(reading.failed).toBeGreaterThan(0);
    expect(reading.rows.length).toBeLessThan(rows.length);
    expect(mock.requests).toHaveLength(4);
  });

  it('follows an answer over its pages, and says so when it does not end', async () => {
    const rows = rowsOf('ApexClass', 'CustomField', 4);
    const page = (records: MockDependencyRow[], next: string | null): { status: number; body: string } => ({
      status: 200,
      body: JSON.stringify({ done: next === null, ...(next === null ? {} : { nextRecordsUrl: next }), records }),
    });
    mock.intercept = (request) => {
      if (request.path.endsWith('/tooling/query')) {
        return page(rows.slice(0, 2), '/services/data/v66.0/tooling/query/01gxx-2');
      }
      if (request.path.endsWith('/01gxx-2')) return page(rows.slice(2), null);
      return undefined;
    };
    const reading = await read();
    expect(reading).toMatchObject({ state: 'whole', requests: 2 });
    expect(pairs(reading)).toEqual(pairsOf(rows));

    // An answer that says neither that it is done nor where it goes on.
    mock.intercept = (request) =>
      request.path.endsWith('/tooling/query')
        ? { status: 200, body: JSON.stringify({ done: false, records: rows.slice(0, 1) }) }
        : undefined;
    const open = await read();
    // The org gave a row and not the rest: that is something, and not all of it.
    expect(open).toMatchObject({ state: 'partial', code: 'NOT_DONE' });
    expect(open.rows).toHaveLength(1);

    // An answer that never ends is given up after the pages the limits allow.
    mock.intercept = (request) =>
      request.path.includes('/tooling/query')
        ? page(rows.slice(0, 1), '/services/data/v66.0/tooling/query/again')
        : undefined;
    expect(await read({ limits: { pages: 3 } })).toMatchObject({ state: 'partial', code: 'PAGES_LEFT' });

    // An answer that goes on somewhere else is not followed there: only the same query of the Tooling API is.
    for (const elsewhere of [
      '/services/data/v66.0/query?q=SELECT+Id+FROM+Account',
      '/services/data/v66.0/tooling/query?q=SELECT+Id+FROM+ApexClass',
      '/services/data/v65.0/tooling/query/01gxx-2',
      'https://elsewhere.example/services/data/v66.0/tooling/query/01gxx-2',
    ]) {
      mock.intercept = (request) =>
        request.path.endsWith('/tooling/query') ? page(rows.slice(0, 1), elsewhere) : undefined;
      mock.requests.length = 0;
      expect(await read(), elsewhere).toMatchObject({ code: 'NOT_DONE' });
      expect(new Set(mock.asked()), elsewhere).toEqual(new Set(['GET /services/data/v66.0/tooling/query']));
    }
  });

  it('asks one query of the versions of the flows, which names the active and the latest version of each', async () => {
    mock.dependencies = mockDependencies([]);
    mock.dependencies.flowDefinitions = DEFINITIONS;
    expect(await readVersions()).toEqual({ state: 'whole', flows: VERSIONS, requests: 1, code: null });
    expect(mock.dependencies.queries).toEqual([
      `SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM ${FLOW_VERSION_OBJECT}`,
    ]);
    expect(FLOW_VERSION_OBJECT).toBe('FlowDefinition');
    expect(new Set(mock.asked())).toEqual(new Set(['GET /services/data/v66.0/tooling/query']));
    // An org without flows names none.
    mock.dependencies.flowDefinitions = [];
    expect(await readVersions()).toEqual({ state: 'whole', flows: [], requests: 1, code: null });
  });

  it('follows the versions of the flows over their pages, and keeps what came where the answer breaks off', async () => {
    const page = (records: unknown[], next: string | null): { status: number; body: string } => ({
      status: 200,
      body: JSON.stringify({ done: next === null, ...(next === null ? {} : { nextRecordsUrl: next }), records }),
    });
    mock.intercept = (request) => {
      if (request.path.endsWith('/tooling/query'))
        return page(DEFINITIONS.slice(0, 2), '/services/data/v66.0/tooling/query/01gxx-2');
      if (request.path.endsWith('/01gxx-2')) return page(DEFINITIONS.slice(2), null);
      return undefined;
    };
    expect(await readVersions()).toEqual({ state: 'whole', flows: VERSIONS, requests: 2, code: null });
    // The limit of requests is reached after the first page: what it named is right all the same.
    expect(await readVersions({ requestsInAll: 1 })).toEqual({
      state: 'partial',
      flows: [VERSIONS[0], VERSIONS[3]],
      requests: 1,
      code: 'REQUESTS_USED_UP',
    });
    expect(await readVersions({ pages: 1 })).toMatchObject({ state: 'partial', requests: 1, code: 'PAGES_LEFT' });
    // An answer that is not done and does not say where it goes on, or goes on somewhere else.
    mock.intercept = (request) =>
      request.path.endsWith('/tooling/query')
        ? page(DEFINITIONS.slice(0, 1), '/services/data/v66.0/query?q=SELECT+Id+FROM+Account')
        : undefined;
    expect(await readVersions()).toEqual({ state: 'partial', flows: [VERSIONS[0]], requests: 1, code: 'NOT_DONE' });
    expect(new Set(mock.asked())).toEqual(new Set(['GET /services/data/v66.0/tooling/query']));
  });

  it('gives a reading that says so when the org refuses the versions of its flows or does not answer', async () => {
    mock.dependencies = mockDependencies([]);
    mock.dependencies.refuse = (soql) => (soql.includes(FLOW_VERSION_OBJECT) ? 'INVALID_TYPE' : undefined);
    expect(await readVersions()).toEqual({ state: 'none', flows: [], requests: 1, code: 'INVALID_TYPE' });
    // A query that takes too long is not asked again.
    mock.intercept = (request) =>
      request.path.endsWith('/tooling/query')
        ? { status: 200, body: JSON.stringify({ done: true, records: [] }), halfway: 'stall' }
        : undefined;
    expect(await readVersions({ requestMs: 300 })).toEqual({ state: 'none', flows: [], requests: 1, code: 'TIMEOUT' });
    // Nor is one whose session the org no longer accepts.
    mock.intercept = null;
    mock.dependencies.refuse = null;
    await seedCliLogin({
      username: 'dev@example.com',
      orgId: ORG_ID,
      instanceUrl: mock.url,
      accessToken: 'the-session',
    });
    mock.sessions.add('the-session');
    const session = await connectToOrg(source, undefined, {});
    mock.sessions.clear();
    expect(await readFlowVersions(session, { limits: FAST })).toMatchObject({
      state: 'none',
      code: 'INVALID_SESSION_ID',
    });
  });

  it('never follows a redirect', async () => {
    mock.dependencies = mockDependencies(rowsOf('ApexClass', 'CustomField', 1));
    mock.intercept = (request) =>
      request.path.endsWith('/tooling/query')
        ? { status: 302, body: '', headers: { location: 'http://127.0.0.1:9/elsewhere' } }
        : undefined;
    expect(await read()).toMatchObject({ state: 'none', code: 'REDIRECT', rows: [] });
  });
});
