/**
 * The Dependency API of a mock org: the rows of `MetadataComponentDependency`, and the queries of the Tooling
 * API that the engine asks for them.
 *
 * It answers the way the probe of the test org saw Salesforce answer (`docs/research/phase-1/real-org.md`):
 * a query gives at most `limit` rows and says that it is done, a field and a rule are named without their
 * object, a custom object without its ending, a standard object has the type `StandardEntity` and its name as
 * its id, and a record of a custom metadata type has the name of that type as its type.
 *
 * It knows the few conditions the engine writes and refuses every other query, so that a test fails when the
 * engine asks for something else.
 */
import type { MockMetadata } from './mock-metadata.ts';

/** One row, as the Tooling API hands it out. */
export type MockDependencyRow = Readonly<Record<string, string | null>>;

/** A component of a row: its metadata type and its full name, such as `CustomField` and `Invoice__c.Amount__c`. */
export type MockEnd = readonly [type: string, fullName: string];

export interface MockDependencies {
  /** The rows the org holds. */
  readonly rows: MockDependencyRow[];
  /** A query gives at most this many rows. Salesforce stops at 2,000. */
  limit: number;
  /** Every query that was asked, in order, as its SOQL. */
  readonly queries: string[];
  /** Set by a test to refuse a query: returns the code the org refuses it with, or `undefined` to answer it. */
  refuse: ((soql: string) => string | undefined) | null;
  /** Answers one query of the Tooling API. */
  answer(soql: string): { status: number; body: string };
}

/** The end of a row for a component, in the form Salesforce writes it. `id`: the id the org lists it with. */
function endOf([type, fullName]: MockEnd, id: string | null): { type: string; id: string; name: string } {
  const last = fullName.slice(fullName.lastIndexOf('.') + 1);
  if (type === 'CustomObject') {
    if (!fullName.includes('__')) return { type: 'StandardEntity', id: fullName, name: fullName };
    return { type, id: id ?? '', name: fullName.slice(0, fullName.lastIndexOf('__')) };
  }
  if (type === 'CustomMetadata') {
    return { type: `${fullName.slice(0, fullName.indexOf('.'))}__mdt`, id: id ?? '', name: last };
  }
  if (type === 'CustomField') return { type, id: id ?? '', name: last.replace(/__c$/, '') };
  return { type, id: id ?? '', name: last };
}

/**
 * A row from one component to another, as Salesforce would report it. With the metadata of the mock org, an end
 * has the id the org lists the component with. Without, or for a component the org does not list, it has an id
 * of its own that no listing holds.
 */
export function dependencyRow(metadata: MockMetadata | null, from: MockEnd, to: MockEnd): MockDependencyRow {
  const unlisted = (end: MockEnd): string => {
    let sum = 0;
    for (const char of `${end[0]}:${end[1]}`) sum = (sum * 31 + (char.codePointAt(0) ?? 0)) % 1_000_000_000;
    return `0Zzxx${String(sum).padStart(10, '0')}AAA`;
  };
  const a = endOf(from, metadata?.idOf(from[0], from[1]) ?? unlisted(from));
  const b = endOf(to, metadata?.idOf(to[0], to[1]) ?? unlisted(to));
  return {
    MetadataComponentId: a.id,
    MetadataComponentName: a.name,
    MetadataComponentNamespace: null,
    MetadataComponentType: a.type,
    RefMetadataComponentId: b.id,
    RefMetadataComponentName: b.name,
    RefMetadataComponentNamespace: null,
    RefMetadataComponentType: b.type,
  };
}

const refused = (errorCode: string, message: string): { status: number; body: string } => ({
  status: 400,
  body: JSON.stringify([{ message, errorCode }]),
});

const SELECT =
  /^SELECT MetadataComponentId, MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType FROM (\w+)(?: WHERE (.+))?$/;
const quotedList = (list: string): string[] => [...list.matchAll(/'([^']*)'/g)].map(([, value]) => value ?? '');

/** The test one condition of a query stands for, or `null` for a condition the mock does not know. */
function condition(clause: string): ((row: MockDependencyRow) => boolean) | null {
  const equal = /^(MetadataComponentType|RefMetadataComponentType) = '([A-Za-z0-9_]+)'$/.exec(clause);
  if (equal !== null) return (row) => row[equal[1] ?? ''] === equal[2];
  const notIn = /^(MetadataComponentType|RefMetadataComponentType) NOT IN \(((?:'[A-Za-z0-9_]+'(?:, )?)+)\)$/.exec(
    clause,
  );
  if (notIn !== null) {
    const values = new Set(quotedList(notIn[2] ?? ''));
    return (row) => !values.has(row[notIn[1] ?? ''] ?? '');
  }
  const ids = /^MetadataComponentId (IN|NOT IN) \(((?:'[A-Za-z0-9]{15,18}'(?:, )?)+)\)$/.exec(clause);
  if (ids !== null) {
    const values = new Set(quotedList(ids[2] ?? '').map((id) => id.slice(0, 15)));
    return (row) => values.has((row['MetadataComponentId'] ?? '').slice(0, 15)) === (ids[1] === 'IN');
  }
  return null;
}

export function mockDependencies(rows: readonly MockDependencyRow[] = []): MockDependencies {
  const dependencies: MockDependencies = {
    rows: [...rows],
    limit: 2_000,
    queries: [],
    refuse: null,
    answer: (soql) => {
      dependencies.queries.push(soql);
      const code = dependencies.refuse?.(soql);
      if (code !== undefined) return refused(code, `The mock org refuses the query (${code}).`);
      const parsed = SELECT.exec(soql);
      if (parsed === null) return refused('MALFORMED_QUERY', 'The mock org does not know this query.');
      if (parsed[1] !== 'MetadataComponentDependency') {
        return refused('INVALID_TYPE', `sObject type '${parsed[1] ?? ''}' is not supported.`);
      }
      const tests = (parsed[2] ?? '') === '' ? [] : (parsed[2] ?? '').split(' AND ').map(condition);
      if (tests.includes(null)) return refused('MALFORMED_QUERY', 'The mock org does not know this condition.');
      const records = dependencies.rows
        .filter((row) => tests.every((test) => test?.(row) === true))
        .slice(0, dependencies.limit)
        .map((row) => ({ attributes: { type: 'MetadataComponentDependency' }, ...row }));
      return {
        status: 200,
        body: JSON.stringify({
          size: records.length,
          totalSize: records.length,
          done: true,
          queryLocator: null,
          entityTypeName: 'MetadataComponentDependency',
          records,
        }),
      };
    },
  };
  return dependencies;
}
