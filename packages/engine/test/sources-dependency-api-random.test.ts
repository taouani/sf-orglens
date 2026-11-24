/**
 * The reader of the Dependency API against mock orgs that are made at random from a fixed seed, so that every run
 * reads the same orgs.
 *
 * What an org holds varies, and where it cuts an answer off, which rows it never hands out, whether an answer
 * says how many rows it was cut off with, which query it refuses, how it answers a query for a group of components,
 * which ids the caller knows, how many components one query names, and how many rounds the reader makes. Where the
 * limit the reader is given is more than twice the number of rows the org cuts an answer off at, an answer is cut
 * off below half the limit, as an answer of a large org was (decision record 0069).
 *
 * What an answer has to hold is said by something that knows nothing of the reader: a twin of the org that cuts
 * nothing off and hands out every row says which rows a query asks for. A reading that is called whole has to hold
 * every row only of an org that cuts no answer off below half the limit of the reader. Of another org it can lack
 * rows: an answer that is cut off below half the limit, and whose rows no other query gives, goes unseen (decision
 * record 0069), which a test of the reader shows on an org of one type.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgSource } from '../src/core/config/config.ts';
import { readDependencies, type DependencyReading } from '../src/sources/dependency-api.ts';
import { connectToOrg } from '../src/sources/org.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { dependencyRow, mockDependencies, type MockDependencyRow } from './helpers/mock-dependencies.ts';
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
/** How many orgs are read. */
const ORGS = 60;
const SEED = 2026;

/** Numbers from 0 up to 1, the same ones for the same seed on every machine. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Types of components that refer. Some are types the reader asks for whatever the first answer shows, the others
 * it only learns from a row. The name of `Odd-Thing` cannot stand in a query, so no query asks for it by name.
 */
const FROM = [
  'ApexClass',
  'CustomField',
  'Layout',
  'Flow',
  'ValidationRule',
  'LookupFilter',
  'Odd_Thing',
  'Odd-Thing',
  'Zed',
  'Report',
  'T1',
  'T2',
  'T3',
];
/** Types of target. `Standard` stands for a standard object, which no query can name as the type of a target. */
const TO = ['CustomField', 'CustomObject', 'ApexClass', 'CustomLabel', 'Layout', 'Report', 'ApexPage', 'Standard'];
/** The type whose rows an org never hands out, where it hides some. */
const HIDDEN = 'Report';
/** What a query for a group of components holds, after the condition that names its part. */
const GROUP = ' AND MetadataComponentId IN (';

interface Org {
  readonly rows: MockDependencyRow[];
  /** The org cuts an answer off at this many rows. */
  readonly limit: number;
  /** The limit the reader is given: what it takes one answer to hold at most. */
  readonly rowsPerQuery: number;
  /** Which rows the org never hands out: those from the hidden type, those to it, both or none. */
  readonly hidden: 'none' | 'from' | 'to' | 'both';
  readonly countsHidden: boolean;
  /** The ids the caller knows: of every component, of none, or of every second one. */
  readonly ids: 'all' | 'none' | 'some';
  readonly idsPerQuery: number;
  readonly rounds: number;
  /** A type of target the org refuses to be asked for by name, or `null`. */
  readonly refused: string | null;
  /**
   * How the org answers a query for a group of components: with the rows it asks for, with no row, or without the
   * first of them. The last two are an org that does not read the condition on the id the way it is meant here.
   */
  readonly groups: 'whole' | 'none' | 'not the first';
}

/**
 * Makes an org. How it answers a query for a group of components is drawn from numbers of its own (`other`), so
 * that it changes nothing else of the org.
 */
function make(next: () => number, other: () => number): Org {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const between = (low: number, high: number): number => low + Math.floor(next() * (high - low + 1));
  const rows: MockDependencyRow[] = [];
  for (const type of FROM.filter(() => next() < 0.5)) {
    const components = between(1, 6);
    for (let component = 0; component < components; component += 1) {
      const targets = between(1, 5);
      for (let target = 0; target < targets; target += 1) {
        const to = pick(TO);
        const name =
          to === 'Standard'
            ? pick(['Account', 'Contact', 'Case'])
            : `${to}_${String(between(0, 9))}${to === 'CustomObject' ? '__c' : ''}`;
        rows.push(
          dependencyRow(null, [type, `${type}_${String(component)}`], [to === 'Standard' ? 'CustomObject' : to, name]),
        );
      }
    }
  }
  // The order an org gives its rows in is not known.
  for (let at = rows.length - 1; at > 0; at -= 1) {
    const other = Math.floor(next() * (at + 1));
    const [one, another] = [rows[at], rows[other]];
    if (one !== undefined && another !== undefined) {
      rows[at] = another;
      rows[other] = one;
    }
  }
  const limit = between(3, 12);
  return {
    rows,
    limit,
    rowsPerQuery: pick([limit, 2 * limit, 2 * limit, 2 * limit, 3 * limit, 4 * limit]),
    hidden: pick(['none', 'none', 'none', 'from', 'to', 'both']),
    countsHidden: next() < 0.3,
    ids: pick(['all', 'all', 'none', 'some']),
    idsPerQuery: pick([1, 2, 3, 200]),
    rounds: pick([1, 2, 6, 6]),
    refused: next() < 0.15 ? pick(['CustomLabel', 'ApexPage', 'Layout']) : null,
    groups: (['whole', 'whole', 'none', 'not the first'] as const)[Math.floor(other() * 4)] ?? 'whole',
  };
}

const hides = (org: Org, row: MockDependencyRow): boolean =>
  ((org.hidden === 'from' || org.hidden === 'both') && row['MetadataComponentType'] === HIDDEN) ||
  ((org.hidden === 'to' || org.hidden === 'both') && row['RefMetadataComponentType'] === HIDDEN);

/** A row by the types and the ids of its two ends, as the org gives it and as the reader does. */
const ofOrg = (row: MockDependencyRow): string =>
  ['MetadataComponentType', 'MetadataComponentId', 'RefMetadataComponentType', 'RefMetadataComponentId']
    .map((field) => String(row[field]))
    .join('|');

/** One answer of the org to a query for rows. */
interface Answer {
  readonly soql: string;
  readonly answered: boolean;
  readonly rows: readonly MockDependencyRow[];
  /** The number of rows the answer says it has. */
  readonly total: number;
}

let mock: MockOrg;

/** Reads the org, and says what it answered to each query. */
async function read(org: Org): Promise<{ reading: DependencyReading; answers: Answer[] }> {
  const dependencies = mockDependencies(org.rows);
  dependencies.limit = org.limit;
  if (org.hidden !== 'none') dependencies.hidden = (row) => hides(org, row);
  dependencies.countsHidden = org.countsHidden;
  const { refused } = org;
  if (refused !== null) {
    dependencies.refuse = (soql) =>
      soql.includes(`RefMetadataComponentType = '${refused}'`) ? 'INVALID_TYPE_FOR_OPERATION' : undefined;
  }
  const answers: Answer[] = [];
  const answer = dependencies.answer.bind(dependencies);
  dependencies.answer = (soql, metadata) => {
    const given = answer(soql, metadata);
    const whole =
      given.status === 200 ? (JSON.parse(given.body) as { records: MockDependencyRow[]; totalSize: number }) : null;
    const records = org.groups === 'none' ? [] : (whole?.records.slice(1) ?? []);
    const body =
      whole === null || org.groups === 'whole' || !soql.includes(GROUP)
        ? whole
        : { ...whole, records, size: records.length, totalSize: records.length };
    answers.push({ soql, answered: body !== null, rows: body?.records ?? [], total: body?.totalSize ?? 0 });
    return body === null || body === whole ? given : { status: 200, body: JSON.stringify(body) };
  };
  mock.dependencies = dependencies;
  await seedCliLogin({ username: 'dev@example.com', orgId: ORG_ID, instanceUrl: mock.url, accessToken: 'the-session' });
  mock.sessions.add('the-session');
  const session = await connectToOrg(source, undefined, {});
  const reading = await readDependencies(session, {
    // No request of the mock org takes long: a request that is taken to be late would be a failure of this test.
    limits: {
      requestMs: 30_000,
      repeats: 1,
      repeatAfterMs: 10,
      rowsPerQuery: org.rowsPerQuery,
      idsPerQuery: org.idsPerQuery,
      rounds: org.rounds,
    },
    idsOfType: (type) => {
      const ids = [
        ...new Set(
          org.rows
            .filter((row) => row['MetadataComponentType'] === type)
            .map((row) => row['MetadataComponentId'] ?? ''),
        ),
      ];
      return org.ids === 'all' ? ids : org.ids === 'none' ? [] : ids.filter((_, index) => index % 2 === 0);
    },
  });
  await forgetCliLogins();
  mock.sessions.clear();
  return { reading, answers };
}

beforeAll(async () => {
  mock = await startMockOrg({ versions: ['65.0', '66.0'] });
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.dependencies = null;
  await forgetCliLogins();
});

describe('the Dependency API of orgs made at random', () => {
  it('counts an answer that lacks a row where one does, and calls no reading whole that lacks a row of an org that cuts nothing off unseen', async () => {
    const next = random(SEED);
    const other = random(SEED + 1);
    const wrong: string[] = [];
    const seen = {
      whole: 0,
      partial: 0,
      disagreeing: 0,
      cutBelowHalf: 0,
      perComponent: 0,
      groupsLacking: 0,
      afterTheLastRest: 0,
    };
    for (let at = 0; at < ORGS; at += 1) {
      const org = make(next, other);
      const { reading, answers } = await read(org);
      const held = new Set(reading.rows.map(({ from, to }) => [from.type, from.id, to.type, to.id].join('|')));
      const all = new Set(org.rows.map(ofOrg));
      // The twin of the org says which rows a query asks for. An answer that the org gave, and that is not near
      // the limit of the reader, is one the reader takes as whole: it lacks a row where the reading holds a row
      // its query asks for and it does not.
      const twin = mockDependencies(org.rows);
      twin.limit = Number.POSITIVE_INFINITY;
      const lacking = answers.filter(({ soql, answered, rows, total }) => {
        if (!answered || 2 * Math.max(rows.length, total) >= org.rowsPerQuery) return false;
        const full = twin.answer(soql);
        if (full.status !== 200) return false;
        const gave = new Set(rows.map(ofOrg));
        return (JSON.parse(full.body) as { records: MockDependencyRow[] }).records.some(
          (row) => held.has(ofOrg(row)) && !gave.has(ofOrg(row)),
        );
      });
      // Of them, the answers for a group of components, and the parts those groups are of.
      const ofGroups = lacking.filter(({ soql }) => soql.includes(GROUP));
      const parts = new Set(ofGroups.map(({ soql }) => soql.slice(0, soql.indexOf(GROUP))));
      // The org cuts no answer off below half the limit of the reader, hands out every row, and answers a query
      // for a group of components with the rows it asks for.
      const plain = org.hidden === 'none' && org.rowsPerQuery <= 2 * org.limit && org.groups === 'whole';
      const perComponent = answers.some(({ soql }) => soql.includes(GROUP));

      const problems: string[] = [];
      if ([...held].some((row) => !all.has(row))) problems.push('the reading holds a row the org does not hold');
      if (reading.disagreed > reading.cutOff) problems.push('more queries disagree than are counted as cut off');
      // Each answer that lacks a row is counted, once. Only the answers for the groups of components of one part
      // can be counted as one, where a row the part gave did not come again with them. So the reader counts every
      // other answer, and of the answers for groups at least one for each part and at most each of them.
      const least = lacking.length - ofGroups.length + parts.size;
      if (reading.disagreed < least || reading.disagreed > lacking.length) {
        problems.push(
          `${String(lacking.length)} answers lack a row of the reading, ${String(ofGroups.length)} of them for groups ` +
            `of components of ${String(parts.size)} parts, and the reader counts ${String(reading.disagreed)}`,
        );
      }
      if (plain && reading.disagreed > 0) problems.push('answers of an org that cuts nothing off unseen disagree');
      if (plain && reading.state === 'whole' && held.size !== all.size) {
        problems.push(`the reading is whole and lacks ${String(all.size - held.size)} rows the org hands out`);
      }
      if (problems.length > 0) {
        wrong.push(
          `org ${String(at)}: ${problems.join('; ')}. The org: ${JSON.stringify({ ...org, rows: org.rows.length })}. ` +
            `The reading: ${JSON.stringify({ ...reading, rows: reading.rows.length })}.`,
        );
      }

      if (reading.state === 'whole') seen.whole += 1;
      if (reading.state === 'partial') seen.partial += 1;
      if (reading.disagreed > 0) seen.disagreeing += 1;
      if (org.rowsPerQuery > 2 * org.limit) seen.cutBelowHalf += 1;
      if (perComponent) seen.perComponent += 1;
      if (ofGroups.length > 0) seen.groupsLacking += 1;
      const rests = answers.filter(({ soql }) => soql.includes(' WHERE MetadataComponentType NOT IN ('));
      const last = rests.at(-1);
      if (last !== undefined && rests.length === org.rounds && answers.indexOf(last) < answers.length - 1) {
        seen.afterTheLastRest += 1;
      }
    }
    expect(wrong).toEqual([]);
    // What the orgs cover. The numbers change with the reader and with how the orgs are made, and are read again then.
    expect(seen).toEqual({
      whole: 15,
      partial: 45,
      disagreeing: 32,
      cutBelowHalf: 20,
      perComponent: 13,
      groupsLacking: 6,
      afterTheLastRest: 14,
    });
  }, 120_000);
});
