import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource } from '../src/core/config/config.ts';
import {
  DEPENDENCY_OBJECT,
  readDependencies,
  type DependencyLimits,
  type DependencyOptions,
  type DependencyReading,
} from '../src/sources/dependency-api.ts';
import { connectToOrg } from '../src/sources/org.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { dependencyRow, mockDependencies, type MockDependencyRow, type MockEnd } from './helpers/mock-dependencies.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';

const ORG_ID = '00Dxx0000000001EAA';
const source: OrgSource = { name: 'prod', kind: 'org', description: null, orgId: ORG_ID, loginUrl: null };
const FAST: Partial<DependencyLimits> = { requestMs: 2_000, repeats: 1, repeatAfterMs: 10 };

let mock: MockOrg;

async function read(options: DependencyOptions = {}): Promise<DependencyReading> {
  await seedCliLogin({ username: 'dev@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'the-session' });
  mock.sessions.add('the-session');
  const session = await connectToOrg(source, undefined, {});
  mock.requests.length = 0;
  return readDependencies(session, { ...options, limits: { ...FAST, ...options.limits } });
}

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
    // A standard object is a target of a type of its own.
    expect(where).toContain("MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'StandardEntity'");
    // The rows to a class come with the rest, which is not at the limit, so no pair is asked for them.
    expect(where).toContain(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField', 'StandardEntity')",
    );
    expect(where).not.toContain("MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'ApexClass'");
    // A type that is not at the limit is not asked for per pair.
    expect(where.some((one) => one.startsWith("MetadataComponentType = 'CustomField' AND"))).toBe(false);
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
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const groups = mock.dependencies.queries
      .filter((soql) => soql.includes('MetadataComponentId IN'))
      .map((soql) => (soql.match(/'0Zzxx/g) ?? []).length);
    // Four ids give 8 rows, which is over the limit, so each group is asked for again in two halves.
    expect(groups).toContain(4);
    expect(groups).toContain(2);
    expect(Math.max(...groups)).toBe(4);
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
    await read({ limits: { rowsPerQuery: 5, idsPerQuery: 3 }, idsOfType: (type) => idsIn(rows, type) });
    expect(mock.dependencies.queries.length).toBeGreaterThan(20);
    for (const soql of mock.dependencies.queries) {
      expect(soql).toMatch(new RegExp(`^SELECT [A-Za-z, ]+ FROM ${DEPENDENCY_OBJECT}( WHERE |$)`));
    }
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

  it('counts a query for a type that is refused, and keeps the rows of the others', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('CustomField', 'CustomField', 3)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 5;
    mock.dependencies.refuse = (soql) =>
      soql.endsWith("MetadataComponentType = 'ApexClass'") ? 'UNKNOWN_EXCEPTION' : undefined;
    const reading = await read({ limits: { rowsPerQuery: 5 } });
    expect(reading).toMatchObject({ state: 'partial', cutOff: 0, failed: 1, code: 'UNKNOWN_EXCEPTION' });
    expect(reading.rows.filter((row) => row.from.type === 'CustomField')).toHaveLength(3);
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
    // The request is made once more, and then the reading stops.
    expect(reading).toEqual({ rows: [], state: 'none', requests: 2, cutOff: 0, failed: 1, code: 'TIMEOUT' });
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
    expect(open).toMatchObject({ state: 'none', code: 'NOT_DONE' });
    expect(open.rows).toHaveLength(1);

    // An answer that never ends is given up after the pages the limits allow.
    mock.intercept = (request) =>
      request.path.includes('/tooling/query')
        ? page(rows.slice(0, 1), '/services/data/v66.0/tooling/query/again')
        : undefined;
    expect(await read({ limits: { pages: 3 } })).toMatchObject({ state: 'none', code: 'PAGES_LEFT' });
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
