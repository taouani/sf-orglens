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
import {
  dependencyRow,
  mockDependencies,
  type MockDependencies,
  type MockDependencyRow,
  type MockEnd,
} from './helpers/mock-dependencies.ts';
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
/** The mock org cuts an answer off at this many rows, in most tests here. */
const CUT = 5;
/**
 * The limit those tests give the reader. They are about the parts a reading asks for, not about where the limit
 * is. The reader takes an answer that holds half its limit as near it (decision record 0069), so with twice the
 * cut of the mock org an answer is near the limit exactly where the mock org cut it off.
 */
const LIMIT = 2 * CUT;

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

/**
 * The first ten rows of an org that cuts an answer off at ten: its first answer is at the limit, and shows no type
 * but these three.
 */
const KNOWN = [
  ...rowsOf('ApexClass', 'CustomField', 4),
  ...rowsOf('Layout', 'CustomField', 3),
  ...rowsOf('CustomField', 'CustomField', 3),
];
/** The reader is told twice what such an org gives at most, so an answer is near the limit where it was cut off. */
const HALF: DependencyOptions = { limits: { rowsPerQuery: 20 } };

/** An org that cuts an answer off at 10 rows, and then leaves the rows of reports out of it where `hides` is set. */
function cutting(rows: readonly MockDependencyRow[], hides = true): MockDependencies {
  const org = mockDependencies(rows);
  org.limit = 10;
  if (hides) org.hidden = (row) => row['MetadataComponentType'] === 'Report';
  return org;
}

/**
 * The same org, whose answers to the queries `query` picks lack the rows of the component `name`. `saysSo`: whether
 * such an answer says that it holds as many rows as it gives. Otherwise it says what it said with those rows.
 */
function dropping(
  org: MockDependencies,
  query: (soql: string) => boolean,
  name: string,
  saysSo = true,
): MockDependencies {
  const answer = org.answer.bind(org);
  org.answer = (soql, metadata) => {
    const answered = answer(soql, metadata);
    if (!query(soql) || answered.status !== 200) return answered;
    const body = JSON.parse(answered.body) as { records: MockDependencyRow[] };
    const records = body.records.filter((row) => row['MetadataComponentName'] !== name);
    const says = saysSo ? { size: records.length, totalSize: records.length } : {};
    return { status: 200, body: JSON.stringify({ ...body, records, ...says }) };
  };
  return org;
}

const idsIn = (rows: readonly MockDependencyRow[], type: string): string[] => [
  ...new Set(
    rows.filter((row) => row['MetadataComponentType'] === type).map((row) => row['MetadataComponentId'] ?? ''),
  ),
];
/** The rows of a reading, each as `type name > type name`, sorted. */
const pairs = (reading: DependencyReading): string[] =>
  reading.rows.map(({ from, to }) => `${from.type} ${from.name} > ${to.type} ${to.name}`).sort();
const rowsFrom = (reading: DependencyReading, type: string): number =>
  reading.rows.filter((row) => row.from.type === type).length;
/** The queries for what is of no type that was asked for by name. */
const restsOf = (org: MockDependencies): string[] =>
  org.queries.filter((soql) => soql.includes(' WHERE MetadataComponentType NOT IN'));
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
  it('reads the rows of a small org per type, and holds them against the query for every row', async () => {
    mock.dependencies = mockDependencies([
      dependencyRow(null, ['CustomField', 'Invoice__c.Total__c'], ['CustomField', 'Invoice__c.Amount__c']),
      dependencyRow(null, ['ValidationRule', 'Invoice__c.Amount_Positive'], ['CustomField', 'Invoice__c.Amount__c']),
      dependencyRow(null, ['ApexClass', 'InvoiceService'], ['CustomObject', 'Invoice__c']),
      dependencyRow(null, ['ApexClass', 'InvoiceService'], ['CustomObject', 'Account']),
      dependencyRow(null, ['ValidationRule', 'Invoice__c.Rate_Ok'], ['CustomMetadata', 'Billing_Rule.Default']),
      { ...dependencyRow(null, ['ApexClass', 'A'], ['ApexClass', 'B']), RefMetadataComponentNamespace: 'pkg' },
    ]);
    const reading = await read();
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0, code: null });
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
    // The query for every row, one for each of the 17 types that are known to refer, and one for the rest. The
    // first answer does not stand for the org, however few rows it holds (decision record 0069).
    const where = mock.dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(where[0]).toBe('');
    expect(where.filter((one) => /^MetadataComponentType = '\w+'$/.test(one))).toHaveLength(17);
    expect(where.at(-1)).toMatch(/^MetadataComponentType NOT IN \(/);
    expect(where).toHaveLength(19);
    expect(reading.requests).toBe(19);
    expect(new Set(mock.asked())).toEqual(new Set(['GET /services/data/v66.0/tooling/query']));
  });

  it('does not take an answer as whole that holds fewer rows than the limit and was cut off', async () => {
    // The org cuts an answer off at 10 rows and then leaves out the rows it never hands out, here those of a
    // report. The answer for every row holds 8 rows, fewer than the limit, and lacks the rows of the fields: what
    // a large org did, which the reading took as whole.
    const rows = [
      ...rowsOf('Report', 'CustomField', 2),
      ...rowsOf('Layout', 'CustomField', 4),
      ...rowsOf('ApexClass', 'CustomField', 4),
      ...rowsOf('CustomField', 'CustomField', 3),
    ];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 10;
    dependencies.hidden = (row) => row['MetadataComponentType'] === 'Report';
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: 10 } });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows.filter((row) => row['MetadataComponentType'] !== 'Report')));
    const first = JSON.parse(dependencies.answer(dependencies.queries[0] ?? '').body) as {
      records: MockDependencyRow[];
    };
    expect(dependencies.queries[0]).not.toContain(' WHERE ');
    expect(first.records).toHaveLength(8);
    expect(first.records.some((row) => row['MetadataComponentType'] === 'CustomField')).toBe(false);
  });

  it('says that rows may be missing where an answer below half the limit was cut off', async () => {
    // Most of what the org cut the answer for every row off with is left out of it: it holds 2 rows, fewer than
    // half the limit. The queries per type give rows it lacks, so it was cut off, and an answer below the limit
    // can be cut off on this org. No answer the reading took as whole is then proven so.
    const rows = [
      ...rowsOf('Report', 'CustomField', 8),
      ...rowsOf('ApexClass', 'CustomField', 4),
      ...rowsOf('CustomField', 'CustomField', 4),
    ];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 10;
    dependencies.hidden = (row) => row['MetadataComponentType'] === 'Report';
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: 10 } });
    // It is the first answer that is counted: it was taken as whole, and lacks rows the reading holds.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(reading.rows).toHaveLength(8);

    // The same where the answer for every row gives a row that no query per type gives again. Here it is the
    // query of the classes that is counted: its answer lacks a row of a class.
    const leavingOutAClass = (org: MockDependencies): MockDependencies => {
      const answer = org.answer.bind(org);
      org.answer = (soql, metadata) => {
        const answered = answer(soql, metadata);
        if (!soql.includes(' WHERE ')) return answered;
        const body = JSON.parse(answered.body) as { records: MockDependencyRow[] };
        const records = body.records.filter((row) => row['MetadataComponentName'] !== 'ApexClass_0');
        return {
          status: 200,
          body: JSON.stringify({ ...body, records, size: records.length, totalSize: records.length }),
        };
      };
      return org;
    };
    mock.dependencies = leavingOutAClass(mockDependencies(rowsOf('ApexClass', 'CustomField', 4)));
    const lacking = await read({ limits: { rowsPerQuery: 10 } });
    expect(lacking).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(lacking.rows).toHaveLength(4);

    // The same where the query of another type is cut off as well, with no smaller part to ask for: the layouts
    // have more rows than a query gives, and no id of a layout is known here. Each of the two is counted, and
    // only the query of the classes because another answer shows it.
    const both = leavingOutAClass(
      mockDependencies([...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('Layout', 'CustomField', 12)]),
    );
    both.limit = 10;
    mock.dependencies = both;
    expect(await read({ limits: { rowsPerQuery: 10 } })).toMatchObject({
      state: 'partial',
      cutOff: 2,
      disagreed: 1,
      failed: 0,
      unproven: 0,
    });
  });

  it('takes an answer that says it has more rows than it gave as near the limit', async () => {
    // Of the rows of the classes, the org cuts the answer off with 8 it then leaves out: the answer holds 2 rows.
    // Where it says nothing of the 8, the reading cannot see them, and takes the answer as whole: an answer that
    // lost more than half its rows after it was cut off looks like any other (decision record 0069).
    const hidden = Array.from({ length: 8 }, (_, at) =>
      dependencyRow(null, ['ApexClass', `Hidden_${String(at)}`], ['Report', `Report_${String(at)}`]),
    );
    const rows = [...hidden, ...rowsOf('ApexClass', 'CustomField', 4)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 10;
    dependencies.hidden = (row) => row['RefMetadataComponentType'] === 'Report';
    mock.dependencies = dependencies;
    const ids = idsIn(rows, 'ApexClass');
    const blind = await read({ limits: { rowsPerQuery: 10 }, idsOfType: () => ids });
    expect(blind).toMatchObject({ state: 'whole', cutOff: 0, failed: 0 });
    expect(blind.rows).toHaveLength(2);

    // Where its total counts them, the answer is near the limit, and its parts give every row.
    dependencies.countsHidden = true;
    const counted = await read({ limits: { rowsPerQuery: 10 }, idsOfType: () => ids });
    expect(counted).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(counted)).toEqual(pairsOf(rows.slice(8)));
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
    mock.dependencies.limit = CUT;
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const asked = mock.dependencies.queries.map((soql) => soql.slice(soql.indexOf(' FROM ')));
    expect(asked[0]).toBe(' FROM MetadataComponentDependency');
    expect(asked).toContain(" FROM MetadataComponentDependency WHERE MetadataComponentType = 'ApexClass'");
    expect(asked).toContain(" FROM MetadataComponentDependency WHERE MetadataComponentType = 'WorkflowRule'");
    // What is of no type that was asked for by name is asked for at the end. It holds few rows, and the types it
    // shows are asked for by name all the same, since an answer below the limit can be cut off as well. Then the
    // rest is asked for again, until nothing is left.
    expect(asked).toContain(" FROM MetadataComponentDependency WHERE MetadataComponentType = 'LookupFilter'");
    expect(asked).toContain(" FROM MetadataComponentDependency WHERE MetadataComponentType = 'Odd_Thing'");
    const rests = asked.filter((soql) => soql.includes('MetadataComponentType NOT IN'));
    expect(rests).toHaveLength(2);
    expect(rests[0]).not.toContain("'LookupFilter'");
    expect(rests[1]).toContain("'LookupFilter', 'Odd_Thing'");
    expect(asked.at(-1)).toBe(rests[1]);
    expect(asked.at(-1)).toContain("'ApexClass'");
    expect(asked.at(-1)).not.toContain('Ref');
    // The first answer, 17 types that are known to refer, the rest, its 2 types and the rest again.
    expect(asked).toHaveLength(22);
  });

  it('holds a rest below half the limit against the rows of the types it did not leave out', async () => {
    // The first answer is near the limit, so it does not show what an answer below it lacks. The rest holds 2 rows
    // of lookup filters, fewer than half the limit, and the org cut it off with the rows of reports it leaves out:
    // the lookup filters have 4 rows. A reading that took the rest as whole would have lacked 2 of them.
    const rows = [
      ...rowsOf('ApexClass', 'CustomField', 4),
      ...rowsOf('Layout', 'CustomField', 3),
      ...rowsOf('CustomField', 'CustomField', 3),
      ...rowsOf('Report', 'CustomField', 8),
      ...rowsOf('LookupFilter', 'CustomField', 4),
    ];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 10;
    dependencies.hidden = (row) => row['MetadataComponentType'] === 'Report';
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: 20 } });
    // The query of the lookup filters gives the rows the rest lacks: the rest was cut off.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(pairs(reading)).toEqual(pairsOf(rows.filter((row) => row['MetadataComponentType'] !== 'Report')));
    const where = dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(where[0]).toBe('');
    const first = JSON.parse(dependencies.answer(dependencies.queries[0] ?? '').body) as {
      records: MockDependencyRow[];
    };
    expect(first.records).toHaveLength(10);
    const rest = where.findIndex((one) => one.startsWith('MetadataComponentType NOT IN ('));
    const answer = JSON.parse(dependencies.answer(dependencies.queries[rest] ?? '').body) as {
      records: MockDependencyRow[];
    };
    expect(answer.records.map((row) => row['MetadataComponentType'])).toEqual(['LookupFilter', 'LookupFilter']);
    expect(where.slice(rest + 1)).toContain("MetadataComponentType = 'LookupFilter'");

    // Where the rest gives every row of the types it shows, nothing is missing.
    const whole = mockDependencies(rows.filter((row) => row['MetadataComponentType'] !== 'Report'));
    whole.limit = 10;
    mock.dependencies = whole;
    const read2 = await read({ limits: { rowsPerQuery: 20 } });
    expect(read2).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0, unproven: 0, code: null });
    expect(whole.queries.map((soql) => soql.split(' WHERE ')[1] ?? '')).toContain(
      "MetadataComponentType = 'LookupFilter'",
    );

    // The other way round: the rest gave a row that the query of its type does not give again. Then it is that
    // query whose answer lacks a row.
    mock.dependencies = dropping(
      cutting([...KNOWN, ...rowsOf('LookupFilter', 'CustomField', 4)], false),
      (soql) => soql.endsWith("MetadataComponentType = 'LookupFilter'"),
      'LookupFilter_0',
    );
    const other = await read(HALF);
    expect(other).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0 });
    expect(rowsFrom(other, 'LookupFilter')).toBe(4);
  });

  it('counts a rest below half the limit that a later rest shows to be cut off', async () => {
    // The first rest holds the 2 rows of the lookup filters, and the query of the lookup filters gives the same 2:
    // nothing there shows that the org cut the rest off with the rows of reports it leaves out. The rest after it
    // gives 2 rows of a type that the first rest did not leave out either, and did not give.
    const rows = [
      ...KNOWN,
      ...rowsOf('LookupFilter', 'CustomField', 2),
      ...rowsOf('Report', 'CustomField', 8),
      ...rowsOf('Odd_Thing', 'CustomField', 2),
    ];
    const dependencies = cutting(rows);
    mock.dependencies = dependencies;
    const reading = await read(HALF);
    expect(restsOf(dependencies)).toHaveLength(3);
    expect(restsOf(dependencies)[0]).not.toContain("'Odd_Thing'");
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0, requests: 23 });
    expect(pairs(reading)).toEqual(pairsOf(rows.filter((row) => row['MetadataComponentType'] !== 'Report')));

    // Where the org leaves as many rows out of the last rest as an answer holds, a further type stays unseen
    // behind it. The reading says that rows are missing all the same: the first rest is counted.
    const further = cutting([...rows, ...rowsOf('Report', 'CustomLabel', 10), ...rowsOf('Zed', 'CustomField', 3)]);
    mock.dependencies = further;
    const unseen = await read(HALF);
    expect(unseen).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1 });
    expect(rowsFrom(unseen, 'Zed')).toBe(0);
    expect(unseen.rows).toHaveLength(14);
  });

  it('asks for the types the last rest shows by name, and holds that rest against them', async () => {
    // One round: the rest is asked for once. It holds 2 of the 4 rows of the lookup filters, since the org cut
    // it off with the rows of reports. The lookup filters are asked for by name after it, and it is counted.
    const rows = [
      ...KNOWN,
      ...rowsOf('LookupFilter', 'CustomField', 2),
      ...rowsOf('Report', 'CustomField', 8),
      ...rowsOf('LookupFilter', 'CustomLabel', 2),
    ];
    const once = cutting(rows);
    mock.dependencies = once;
    const last = await read({ limits: { rowsPerQuery: 20, rounds: 1 } });
    expect(last).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0 });
    expect(rowsFrom(last, 'LookupFilter')).toBe(4);
    expect(restsOf(once)).toHaveLength(1);
    expect(once.queries.at(-1)).toMatch(/ WHERE MetadataComponentType = 'LookupFilter'$/);

    // Where the query of the type gives what the rest gave, no answer shows that a row is missing.
    const agreeing = cutting([...KNOWN, ...rowsOf('LookupFilter', 'CustomField', 2)], false);
    mock.dependencies = agreeing;
    const whole = await read({ limits: { rowsPerQuery: 20, rounds: 1 } });
    expect(whole).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0 });
    expect(whole.rows).toHaveLength(12);
    expect(restsOf(agreeing)).toHaveLength(1);
    expect(agreeing.queries.at(-1)).toMatch(/ WHERE MetadataComponentType = 'LookupFilter'$/);

    // A last rest near the limit is counted: no rest after it shows what it left out. The type it shows is asked
    // for by name all the same, here per component, which gives every row of it.
    const filters = rowsOf('LookupFilter', 'CustomField', 12);
    const near = cutting([...KNOWN, ...filters], false);
    mock.dependencies = near;
    const ids = idsIn(filters, 'LookupFilter');
    const counted = await read({ limits: { rowsPerQuery: 20, rounds: 1 }, idsOfType: () => ids });
    expect(counted).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 0, failed: 0, unproven: 0 });
    expect(rowsFrom(counted, 'LookupFilter')).toBe(12);
    expect(restsOf(near)).toHaveLength(1);
    // With a rest after it, which shows nothing more, nothing is counted.
    near.queries.length = 0;
    const asked = await read({ ...HALF, idsOfType: () => ids });
    expect(asked).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0, unproven: 0 });
    expect(restsOf(near)).toHaveLength(2);

    // Six rests in a row, each of which shows one type that the rest before did not give: the type the sixth
    // shows is asked for by name, and no rest is asked for after that. Each rest lacks rows that a later query
    // gave, the sixth 2 of the 7 rows of its type, so each is counted. A seventh type stays unseen.
    const types = ['T1', 'T2', 'T3', 'T4', 'T5'];
    const chain = cutting([
      ...KNOWN,
      ...rowsOf('T1', 'CustomField', 5),
      ...rowsOf('Report', 'CustomField', 5),
      ...types.slice(1).flatMap((type) => rowsOf(type, 'CustomField', 5)),
      ...rowsOf('T6', 'CustomField', 7),
      ...rowsOf('T7', 'CustomField', 3),
    ]);
    mock.dependencies = chain;
    const six = await read(HALF);
    expect(restsOf(chain)).toHaveLength(6);
    expect(chain.queries.at(-1)).toMatch(/ WHERE MetadataComponentType = 'T6'$/);
    expect(six).toMatchObject({ state: 'partial', cutOff: 6, disagreed: 6, failed: 0, requests: 30 });
    expect(rowsFrom(six, 'T6')).toBe(7);
    expect(rowsFrom(six, 'T7')).toBe(0);
    expect(six.rows).toHaveLength(42);
  });

  it('holds the rest against a row of a type that is never asked for by name', async () => {
    // A type whose name cannot stand in a query as it is. The first answer gives its row, and the rest, which
    // leaves out only the types that were asked for by name, has to give it again.
    const odd = {
      ...dependencyRow(null, ['ApexClass', 'X'], ['CustomField', 'Invoice__c.Amount__c']),
      MetadataComponentType: 'Odd-Type',
    };
    const rows = [...rowsOf('ApexClass', 'CustomField', 2), odd];
    mock.dependencies = mockDependencies(rows);
    const given = await read();
    expect(given).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0 });
    expect(given.rows).toHaveLength(3);
    expect(mock.dependencies.queries.some((soql) => soql.includes('Odd-Type'))).toBe(false);

    // An org whose queries with a condition never give that row: the rest lacks it.
    const dependencies = mockDependencies(rows);
    const answer = dependencies.answer.bind(dependencies);
    dependencies.answer = (soql, metadata) => {
      const answered = answer(soql, metadata);
      if (!soql.includes(' WHERE ') || answered.status !== 200) return answered;
      const body = JSON.parse(answered.body) as { records: MockDependencyRow[] };
      const records = body.records.filter((row) => row['MetadataComponentType'] !== 'Odd-Type');
      return {
        status: 200,
        body: JSON.stringify({ ...body, records, size: records.length, totalSize: records.length }),
      };
    };
    mock.dependencies = dependencies;
    const lacking = await read();
    expect(lacking).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0 });
    expect(lacking.rows).toHaveLength(3);
  });

  it('does not hold a rest near the limit against the types it shows', async () => {
    // The rest is cut off at the limit, on an org that leaves nothing out: it gives 4 of the 7 rows of a type it
    // shows. That is what a rest near the limit is expected to do. Its types are asked for by name, and the rest
    // again.
    const rows = [
      ...KNOWN,
      ...rowsOf('LookupFilter', 'CustomField', 6),
      ...rowsOf('Odd_Thing', 'CustomField', 7),
      ...rowsOf('Zed', 'CustomField', 4),
    ];
    mock.dependencies = cutting(rows, false);
    const reading = await read(HALF);
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0 });
    expect(pairs(reading)).toEqual(pairsOf(rows));
  });

  it('says that a query failed where the org refuses a type by name that only the rest showed', async () => {
    // The rest gave the rows of the type, and nothing asks for them a second time: the query that should have
    // is the one that failed. This is not known to happen on an org.
    const dependencies = cutting([...KNOWN, ...rowsOf('Odd_Thing', 'CustomField', 2)], false);
    dependencies.refuse = (soql) =>
      soql.includes("MetadataComponentType = 'Odd_Thing'") ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
    mock.dependencies = dependencies;
    const reading = await read(HALF);
    expect(reading).toMatchObject({
      state: 'partial',
      cutOff: 0,
      disagreed: 0,
      failed: 1,
      code: 'INVALID_TYPE_FOR_OPERATION',
    });
    expect(reading.rows).toHaveLength(12);
  });

  it('holds the rest within a type below half the limit against the rows of the types of target it did not leave out', async () => {
    // The classes are near the limit and are asked for per type of target. What is left of them holds 2 rows to
    // pages, fewer than half the limit, and the org cut it off with the rows to reports it leaves out: there are
    // 4 rows to pages.
    const rows = [
      ...rowsOf('ApexClass', 'CustomField', 6),
      ...rowsOf('ApexClass', 'Layout', 4),
      ...rowsOf('ApexClass', 'Report', 8),
      ...rowsOf('ApexClass', 'ApexPage', 4),
    ];
    const dependencies = mockDependencies(rows);
    dependencies.limit = 10;
    dependencies.hidden = (row) => row['RefMetadataComponentType'] === 'Report';
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: 20 } });
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(pairs(reading)).toEqual(pairsOf(rows.filter((row) => row['RefMetadataComponentType'] !== 'Report')));
    const where = dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    const rest = "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('CustomField', 'Layout')";
    expect(where).toContain(rest);
    expect(where.slice(where.indexOf(rest) + 1)).toContain(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'ApexPage'",
    );
    expect(where).toContain(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType NOT IN ('ApexPage', 'CustomField', 'Layout')",
    );

    // Where the rest gives every row of the types it shows, nothing is missing.
    const whole = mockDependencies(rows.filter((row) => row['RefMetadataComponentType'] !== 'Report'));
    whole.limit = 10;
    mock.dependencies = whole;
    expect(await read({ limits: { rowsPerQuery: 20 } })).toMatchObject({
      state: 'whole',
      cutOff: 0,
      disagreed: 0,
      failed: 0,
      unproven: 0,
      code: null,
    });

    // The other way round: the rest gave a row that the query of its pair of types does not give again.
    mock.dependencies = dropping(
      cutting(
        [
          ...rowsOf('ApexClass', 'CustomField', 8),
          ...rowsOf('ApexClass', 'Layout', 2),
          ...rowsOf('ApexClass', 'ApexPage', 4),
        ],
        false,
      ),
      (soql) => soql.endsWith("RefMetadataComponentType = 'ApexPage'"),
      'ApexClass_0',
    );
    expect(await read(HALF)).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0 });

    // A type of target the org refuses by name comes with every rest, beside a type that a rest shows and that
    // is then asked for by name: no rest lacks a row, and nothing is counted.
    const refusing = cutting(
      [
        ...rowsOf('ApexClass', 'CustomField', 8),
        ...rowsOf('ApexClass', 'CustomLabel', 2),
        ...rowsOf('ApexClass', 'ApexPage', 2),
      ],
      false,
    );
    refusing.refuse = (soql) =>
      soql.includes("RefMetadataComponentType = 'CustomLabel'") ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
    mock.dependencies = refusing;
    const refused = await read(HALF);
    expect(refused).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0 });
    expect(refused.rows).toHaveLength(12);
  });

  it('asks for the types of target the last rest of a type shows by name, and holds that rest against them', async () => {
    // One round: the rest of the types of target is asked for once. It holds 2 of the 4 rows to pages, since the
    // org cut it off with the rows to reports. The rows to pages are asked for by name after it, and it is counted.
    const rows = [
      ...rowsOf('ApexClass', 'CustomField', 8),
      ...rowsOf('ApexClass', 'Layout', 2),
      ...rowsOf('ApexClass', 'Report', 8),
      ...rowsOf('ApexClass', 'ApexPage', 4),
    ];
    const once = mockDependencies(rows);
    once.limit = 10;
    once.hidden = (row) => row['RefMetadataComponentType'] === 'Report';
    mock.dependencies = once;
    const last = await read({ limits: { rowsPerQuery: 20, rounds: 1 } });
    expect(last).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(last.rows.filter((row) => row.to.type === 'ApexPage')).toHaveLength(4);
    const ofClasses = (org: MockDependencies): string[] =>
      org.queries
        .map((soql) => soql.split(' WHERE ')[1] ?? '')
        .filter((where) => where.startsWith("MetadataComponentType = 'ApexClass' AND "));
    expect(ofClasses(once).filter((where) => where.includes('NOT IN'))).toHaveLength(1);
    expect(ofClasses(once).at(-1)).toBe(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'ApexPage'",
    );

    // Where the query of the pair of types gives what the rest gave, no answer shows that a row is missing.
    const agreeing = mockDependencies(rows.filter((row) => row['RefMetadataComponentType'] !== 'Report'));
    agreeing.limit = 10;
    mock.dependencies = agreeing;
    const whole = await read({ limits: { rowsPerQuery: 20, rounds: 1 } });
    expect(whole).toMatchObject({ state: 'whole', cutOff: 0, disagreed: 0, failed: 0, unproven: 0 });
    expect(whole.rows).toHaveLength(14);
    expect(ofClasses(agreeing).filter((where) => where.includes('NOT IN'))).toHaveLength(1);
    expect(ofClasses(agreeing).at(-1)).toBe(
      "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'ApexPage'",
    );
  });

  it('finds a type that only the rest shows, and asks for it by name', async () => {
    // Seven types that the engine does not know, each with as many rows as a query gives: the first query shows
    // one of them, and the rest shows the next one every time.
    const rows = ['Aa', 'Bb', 'Cc', 'Dd'].flatMap((type) => rowsOf(type, 'CustomField', 3));
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = 3;
    const reading = await read({ limits: { rowsPerQuery: 6, rounds: 6 } });
    // A type alone is at the limit too, so it is asked per type of target, and per component, of which no id
    // is known here.
    expect(reading.state).toBe('partial');
    expect(pairs(reading)).toEqual(pairsOf(rows));
    // With too few rounds, a type stays unseen and the reading says that rows are missing.
    mock.dependencies.queries.length = 0;
    const short = await read({ limits: { rowsPerQuery: 6, rounds: 2 } });
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
    mock.dependencies.limit = CUT;
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
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
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
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
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    const answer = dependencies.answer.bind(dependencies);
    dependencies.answer = (soql) => {
      const answered = answer(soql);
      if (!soql.includes('RefMetadataComponentType NOT IN') || answered.status !== 200) return answered;
      const body = JSON.parse(answered.body) as { records: MockDependencyRow[] };
      const records = body.records.filter((row) => row['RefMetadataComponentType'] !== 'StandardEntity');
      return { status: 200, body: JSON.stringify({ ...body, records, size: records.length }) };
    };
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
    // The query for all classes showed one row to a standard object before it was cut off, and the rest did
    // not bring it again.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, failed: 0 });
    expect(reading.rows.length).toBeLessThan(rows.length);
  });

  it('asks for the rows to standard objects per component where the rest is at the limit', async () => {
    // 3 classes that refer to a field, and 12 that each refer to one standard object.
    const rows = [...rowsOf('ApexClass', 'CustomField', 3), ...rowsOf('ApexClass', 'CustomObject', 12)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 }, idsOfType: () => ids });
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
    const blind = await read({ limits: { rowsPerQuery: LIMIT } });
    expect(blind).toMatchObject({ state: 'partial', cutOff: 1, failed: 0 });

    // Where every row the type shows is to a standard object, no type is left out of the rest: the rest is the
    // query for the whole type, which is not asked a second time, and its rows are asked for per class.
    const only = rowsOf('ApexClass', 'CustomObject', 12);
    const alone = mockDependencies(only);
    alone.limit = CUT;
    mock.dependencies = alone;
    const all = await read({
      limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 },
      idsOfType: () => idsIn(only, 'ApexClass'),
    });
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
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    dependencies.refuse = (soql) =>
      soql.includes("RefMetadataComponentType = 'CustomLabel'") ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
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
    large.limit = CUT;
    large.refuse = dependencies.refuse;
    mock.dependencies = large;
    const perClass = await read({
      limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 },
      idsOfType: () => idsIn(many, 'ApexClass'),
    });
    expect(perClass).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(perClass)).toEqual(pairsOf(many));
  });

  it('asks for the whole type per component when the org refuses the list of types of the rest', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('ApexClass', 'CustomObject', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    // The test org has not shown that it answers a list of types of the target. An org that does not:
    dependencies.refuse = (soql) =>
      soql.includes('RefMetadataComponentType NOT IN') ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 }, idsOfType: () => ids });
    // The conditions on the id of a component need no list of types, and give every row of the classes.
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0, code: null });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    const where = dependencies.queries.map((soql) => soql.split(' WHERE ')[1] ?? '');
    expect(where.filter((one) => one.includes('RefMetadataComponentType NOT IN'))).toHaveLength(1);
    expect(
      where.some((one) => one.startsWith("MetadataComponentType = 'ApexClass' AND MetadataComponentId IN (")),
    ).toBe(true);

    // Without the ids of the classes there is no other way to ask, and the reading says that rows are missing.
    const blind = await read({ limits: { rowsPerQuery: LIMIT } });
    expect(blind).toMatchObject({ state: 'partial', cutOff: 1, failed: 0, code: 'INVALID_TYPE_FOR_OPERATION' });
    expect(blind.rows.length).toBeLessThan(rows.length);
  });

  it('does not leave the rows of a type to the rest when its query took too long or broke off', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('ApexClass', 'CustomLabel', 3)];
    const dependencies = mockDependencies(rows);
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    dependencies.refuse = (soql) =>
      soql.includes("RefMetadataComponentType = 'CustomLabel'") ? 'QUERY_TIMEOUT' : undefined;
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
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
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: LIMIT, idsPerQuery: 32, rounds: 1 }, idsOfType: () => ids });
    expect(reading).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(reading)).toEqual(pairsOf(rows));
  });

  it('asks per group of components where a pair of types is at the limit, and halves a group that is', async () => {
    // 12 classes with 2 rows each, and one class with 4.
    const rows = [...rowsOf('ApexClass', 'CustomField', 12, 2), ...rowsOf('ApexClass', 'CustomObject', 1, 4)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = CUT;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({
      limits: { rowsPerQuery: LIMIT, idsPerQuery: 4 },
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
      limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 },
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
    mock.dependencies.limit = CUT;
    const ids = idsIn(rows, 'ApexClass');
    const most = await read({ limits: { rowsPerQuery: LIMIT }, idsOfType: () => ids.slice(0, 10) });
    expect(most).toMatchObject({ state: 'whole', cutOff: 0, failed: 0, unproven: 0 });
    expect(pairs(most)).toEqual(pairsOf(rows));

    // The listing knows 6. The other 6 are as many as a query gives: the query for them is cut off.
    const half = await read({ limits: { rowsPerQuery: LIMIT }, idsOfType: () => ids.slice(0, 6) });
    expect(half).toMatchObject({ state: 'partial', cutOff: 1, failed: 0, unproven: 0 });
    expect(half.rows.length).toBeLessThan(rows.length);

    // More ids than one query names: the 6 other classes cannot be asked for, and the reading says so.
    const unknown = await read({ limits: { rowsPerQuery: LIMIT, idsPerQuery: 3 }, idsOfType: () => ids.slice(0, 6) });
    expect(unknown).toMatchObject({ state: 'partial', cutOff: 0, failed: 0, unproven: 1 });
  });

  it('holds the answers per component against the rows the other queries gave', async () => {
    // 12 classes with one row each. The query of the classes shows the row of the first class before it is cut
    // off. The org leaves that row out of every answer to a query that names the type of the target: the query
    // of the pair of types, which is near the limit all the same by what it says it holds, and the queries per
    // group of classes. So the answer of the group with that class lacks a row the reading holds.
    const rows = rowsOf('ApexClass', 'CustomField', 12);
    const ids = idsIn(rows, 'ApexClass');
    const leavingOut = (): MockDependencies => {
      const org = dropping(
        mockDependencies(rows),
        (soql) => (soql.split(' WHERE ')[1] ?? '').includes('RefMetadataComponentType'),
        'ApexClass_0',
        false,
      );
      org.limit = CUT;
      return org;
    };
    mock.dependencies = leavingOut();
    const listed = await read({ limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 }, idsOfType: () => ids });
    expect(listed).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(pairs(listed)).toEqual(pairsOf(rows));
    expect(mock.dependencies.queries.filter((soql) => soql.includes('MetadataComponentId NOT IN'))).toHaveLength(1);

    // Where the org did not list that class, the row is one for the query of every other class, which lacks it.
    const first = rows[0]?.['MetadataComponentId'] ?? '';
    mock.dependencies = leavingOut();
    const unlisted = await read({
      limits: { rowsPerQuery: LIMIT, idsPerQuery: 16 },
      idsOfType: () => ids.filter((id) => id !== first),
    });
    expect(unlisted).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    expect(pairs(unlisted)).toEqual(pairsOf(rows));
    expect(mock.dependencies.queries.filter((soql) => soql.includes('MetadataComponentId NOT IN'))).toHaveLength(1);
  });

  it('does not trust the groups when a row the pair gave does not come again', async () => {
    // An org that answers a condition on the id with no row: because it reads the id otherwise, say.
    const rows = rowsOf('ApexClass', 'CustomField', 12);
    const dependencies = mockDependencies(rows);
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    mock.intercept = (request) =>
      (request.query.get('q') ?? '').includes('MetadataComponentId IN')
        ? { status: 200, body: JSON.stringify({ done: true, records: [] }) }
        : undefined;
    const reading = await read({ limits: { rowsPerQuery: LIMIT }, idsOfType: () => idsIn(rows, 'ApexClass') });
    // The pair of types is counted, once, and no group is taken as whole and counted beside it.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 0, unproven: 0 });
    // The query for every other class is not asked: what the groups gave says nothing.
    expect(dependencies.queries.some((soql) => soql.includes('MetadataComponentId NOT IN'))).toBe(false);
  });

  it('says that rows are missing when one component alone is at the limit', async () => {
    const rows = rowsOf('ApexClass', 'CustomField', 2, 7);
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = CUT;
    const ids = idsIn(rows, 'ApexClass');
    const reading = await read({ limits: { rowsPerQuery: LIMIT }, idsOfType: () => ids });
    // Both are near the limit. No answer shows that another one was cut off.
    expect(reading).toMatchObject({ state: 'partial', cutOff: 2, disagreed: 0, failed: 0 });
    expect(reading.rows).toHaveLength(10);
  });

  it('does not ask per component when the ids it has are not the ones of the rows', async () => {
    const rows = rowsOf('ApexClass', 'CustomField', 12);
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = CUT;
    // No id at all. The pair of types is counted for being near the limit, not because answers disagree: this
    // is what the step that reads the test org tells apart (`disagreed`).
    expect(await read({ limits: { rowsPerQuery: LIMIT } })).toMatchObject({
      state: 'partial',
      cutOff: 1,
      disagreed: 0,
    });
    // Ids of something else: asking per id would give nothing, and look complete.
    mock.dependencies.queries.length = 0;
    const other = await read({ limits: { rowsPerQuery: LIMIT }, idsOfType: () => ['0Axxx0000000001AAA'] });
    expect(other).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 0 });
    expect(mock.dependencies.queries.some((soql) => soql.includes('MetadataComponentId IN'))).toBe(false);
    // An id that is none never stands in a query.
    mock.dependencies.queries.length = 0;
    await read({ limits: { rowsPerQuery: LIMIT }, idsOfType: () => ["x' OR Id != '", ...idsIn(rows, 'ApexClass')] });
    expect(mock.dependencies.queries.some((soql) => soql.includes(' OR '))).toBe(false);
  });

  it('queries one object, and only reads', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 12, 2), ...rowsOf('CustomField', 'CustomField', 7)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = CUT;
    await read({ limits: { rowsPerQuery: LIMIT, idsPerQuery: 8 }, idsOfType: (type) => idsIn(rows, type) });
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
    dependencies.limit = CUT;
    mock.dependencies = dependencies;
    // The org refuses the query for all rows of the type, as it does when that query takes it too long.
    dependencies.refuse = (soql) =>
      soql.endsWith("MetadataComponentType = 'ApexClass'") ? 'QUERY_TIMEOUT' : undefined;
    const inParts = await read({ limits: { rowsPerQuery: LIMIT } });
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
    const refused = await read({ limits: { rowsPerQuery: LIMIT } });
    expect(refused).toMatchObject({ state: 'partial', cutOff: 0, failed: 1, code: 'UNKNOWN_EXCEPTION' });
    expect(dependencies.queries.filter((soql) => soql.endsWith("MetadataComponentType = 'ApexClass'"))).toHaveLength(1);
    expect(refused.rows.filter((row) => row.from.type === 'CustomField')).toHaveLength(3);

    // Without a row, no part of the type is known, and the query that failed is not asked a second time.
    dependencies.queries.length = 0;
    dependencies.refuse = (soql) =>
      !soql.includes(' WHERE ') || soql.includes("MetadataComponentType = 'ApexClass'")
        ? 'UNKNOWN_EXCEPTION'
        : undefined;
    const blind = await read({ limits: { rowsPerQuery: LIMIT } });
    expect(blind).toMatchObject({ state: 'partial', failed: 1 });
    expect(dependencies.queries.filter((soql) => soql.includes("MetadataComponentType = 'ApexClass'"))).toHaveLength(1);
  });

  it('counts answers that do not agree also where a query failed, and where the reading stopped', async () => {
    // The query of one pair of types takes the org too long, which is counted. And the rest gave a row of a
    // lookup filter that the query of the lookup filters does not give again, which is counted beside it.
    const rows = [
      ...rowsOf('ApexClass', 'CustomField', 4),
      ...rowsOf('ApexClass', 'CustomLabel', 3),
      ...rowsOf('LookupFilter', 'CustomField', 2),
    ];
    const dependencies = dropping(
      mockDependencies(rows),
      (soql) => soql.endsWith("MetadataComponentType = 'LookupFilter'"),
      'LookupFilter_0',
    );
    dependencies.limit = CUT;
    dependencies.refuse = (soql) =>
      soql.includes("RefMetadataComponentType = 'CustomLabel'") ? 'QUERY_TIMEOUT' : undefined;
    mock.dependencies = dependencies;
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
    expect(reading).toMatchObject({ state: 'partial', cutOff: 1, disagreed: 1, failed: 1, code: 'QUERY_TIMEOUT' });

    // The reading stops at its limit of requests. Before that, the query of the classes did not give a row
    // again that the first answer gave.
    const few = rowsOf('ApexClass', 'CustomField', 4);
    mock.dependencies = dropping(mockDependencies(few), (soql) => soql.includes(' WHERE '), 'ApexClass_0');
    const stopped = await read({ limits: { requestsInAll: 4 } });
    expect(stopped).toMatchObject({
      state: 'partial',
      requests: 4,
      cutOff: 1,
      disagreed: 1,
      failed: 1,
      code: 'REQUESTS_USED_UP',
    });
    expect(stopped.rows).toHaveLength(4);
  });

  it('stops without failing when the org no longer accepts the session', async () => {
    const rows = [...rowsOf('ApexClass', 'CustomField', 4), ...rowsOf('CustomField', 'CustomField', 3)];
    mock.dependencies = mockDependencies(rows);
    mock.dependencies.limit = CUT;
    let answered = 0;
    mock.intercept = (request) => {
      if (!request.path.endsWith('/tooling/query')) return undefined;
      answered += 1;
      if (answered === 3) mock.sessions.clear();
      return undefined;
    };
    const reading = await read({ limits: { rowsPerQuery: LIMIT } });
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
      disagreed: 0,
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
    mock.dependencies.limit = CUT;
    const reading = await read({ limits: { rowsPerQuery: LIMIT, requestsInAll: 4 } });
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
    expect(reading).toMatchObject({ state: 'whole' });
    expect(pairs(reading)).toEqual(pairsOf(rows));
    // Every query was answered in two pages, and the second page of each was asked for.
    const firstPages = mock.requests.filter((request) => request.path.endsWith('/tooling/query')).length;
    expect(firstPages).toBeGreaterThan(1);
    expect(reading.requests).toBe(2 * firstPages);

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
