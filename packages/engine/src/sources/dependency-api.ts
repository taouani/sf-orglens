/**
 * The Dependency API of Salesforce: the rows of `MetadataComponentDependency`, read through the Tooling API.
 *
 * A row names two components: one, and one it refers to. It says nothing of where, how often or in which way.
 * OrgLens reads the rows as a second opinion on the references it finds itself (decision records 0034 and
 * 0045). They are never the source of an answer.
 *
 * One query gives at most 2,000 rows and cannot be continued. So the rows are asked for in parts where a query
 * reaches that number: per type of the component that refers, then per pair of types, then per group of
 * components that refer, whose ids the caller knows from what the org listed. A standard object as the target
 * cannot be asked for by name, so its rows are asked for with the rest: whatever is of no type that a query
 * named. A part that is still at the limit
 * is cut off: rows are missing, and the reading says so. Where rows were asked for per component, the reading
 * is only as whole as the list of components: it asks for the rows of every other component in one more query
 * where the list is short enough for that, and says so where it is not.
 *
 * A row from a flow carries the id of a version of the flow, and the org lists a flow with the id of its latest
 * version only. So the versions of the flows are asked for as well: one more object of the Tooling API,
 * `FlowDefinition`, names the active and the latest version of each flow (decision record 0067).
 *
 * The two objects describe metadata. No record of the data of the org is read, and nothing is written. A failure
 * of the org never throws here: the reading says how far it came. Only a fault of this machine or of the code
 * is thrown.
 */
import type { OrgSession } from './org.ts';
import { MetadataRequestError, openOrgHttp, repeated, requestFailure, type RequestLimits } from './org-http.ts';

/** One end of a row, as Salesforce names it. */
export interface DependencyEnd {
  /**
   * The type as the API writes it. It is mostly the name of a metadata type. For a standard object it is
   * `StandardEntity`, and for a record of a custom metadata type it is the name of that type.
   */
  readonly type: string;
  /** The id of the component in the org. For a standard object it is the name of the object. */
  readonly id: string;
  /** The name without what contains the component: a field without its object. */
  readonly name: string;
  /** The prefix of the package the component belongs to, or `null`. */
  readonly namespace: string | null;
}

/** A row of the Dependency API: a component, and a component it refers to. */
export interface DependencyRow {
  readonly from: DependencyEnd;
  readonly to: DependencyEnd;
}

/** What was read of the Dependency API of an org. */
export interface DependencyReading {
  /** The different rows, in a fixed order. */
  readonly rows: readonly DependencyRow[];
  /**
   * - `whole`: no query was cut off or failed in a way that leaves a row out.
   * - `partial`: rows are missing, or may be. `cutOff` and `failed` say how many queries left some out, and
   *   `unproven` how many could have.
   * - `none`: the org answered no query, and no row was read.
   */
  readonly state: 'whole' | 'partial' | 'none';
  /** Requests that were sent. */
  readonly requests: number;
  /** Queries that reached the limit of rows and could not be asked in smaller parts. */
  readonly cutOff: number;
  /** Queries that failed and whose rows no other query gave. */
  readonly failed: number;
  /**
   * Queries at the limit whose rows were asked for per component, for more components than one query can name.
   * Every row of a component the caller named was read. A row of a component it did not name, because the org
   * did not list it, is missing, and nothing shows whether there is one.
   */
  readonly unproven: number;
  /** The code of the first failure, such as `INVALID_TYPE` or `TIMEOUT`, or `null`. */
  readonly code: string | null;
}

/** The numbers the Dependency API is read with. A test sets them to make things happen that are rare. */
export interface DependencyLimits extends RequestLimits {
  /** A query that gives this many rows may have left rows out. Salesforce stops at 2,000. */
  readonly rowsPerQuery: number;
  /** No answer is followed over more pages than this. */
  readonly pages: number;
  /** How often the types that are left are asked for, where the types that are known do not give every row. */
  readonly rounds: number;
  /** How many components a query names at most, where a part of a type is asked for per component. */
  readonly idsPerQuery: number;
  /** After this many queries in a row from the start that the org refused, the reading stops. */
  readonly refusalsAtStart: number;
  /** After this many queries in a row that got no answer in time, the reading stops. */
  readonly timeoutsInARow: number;
  /** After this many requests the reading stops with what it has. They count against the daily limit of the org. */
  readonly requestsInAll: number;
}

const DEFAULT_DEPENDENCY_LIMITS: DependencyLimits = {
  // The org takes long for a query over many rows.
  requestMs: 180_000,
  repeats: 2,
  repeatAfterMs: 1_000,
  rowsPerQuery: 2_000,
  pages: 400,
  rounds: 6,
  idsPerQuery: 200,
  refusalsAtStart: 3,
  timeoutsInARow: 3,
  requestsInAll: 2_000,
};

/** The limits a reading keeps to: the defaults, and what `limits` changes of them. */
export function dependencyLimits(limits: Partial<DependencyLimits> = {}): DependencyLimits {
  return { ...DEFAULT_DEPENDENCY_LIMITS, ...limits };
}

export interface DependencyOptions {
  readonly limits?: Partial<DependencyLimits> | undefined;
  /** The version of the API to ask, such as `66.0`. Default: the one of the session. */
  readonly apiVersion?: string | undefined;
  /**
   * The ids of the components of a type that the org listed, where the type is given as the Dependency API
   * writes it. With them, a part of a type that is at the limit is asked for per group of components: a pair
   * of types, or the rest of a type.
   */
  readonly idsOfType?: ((type: string) => readonly string[]) | undefined;
  /** Called after every query, with the number of requests and of different rows so far. */
  readonly onProgress?: ((requests: number, rows: number) => void) | undefined;
}

const FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType';
/** The object of the rows. The other one is `FLOW_VERSION_OBJECT`. A test holds every query against each. */
export const DEPENDENCY_OBJECT = 'MetadataComponentDependency';
const BASE = `SELECT ${FIELDS} FROM ${DEPENDENCY_OBJECT}`;

/**
 * Types of components that refer to others. They are asked for whatever the first query shows: it may be cut
 * off before the rows of a type.
 */
const REFERRING_TYPES = [
  'ApexClass',
  'ApexComponent',
  'ApexPage',
  'ApexTrigger',
  'AuraDefinitionBundle',
  'CustomField',
  'CustomObject',
  'EmailTemplate',
  'FlexiPage',
  'Flow',
  'Layout',
  'LightningComponentBundle',
  'QuickAction',
  'ValidationRule',
  'WebLink',
  'WorkflowFieldUpdate',
  'WorkflowRule',
];

/**
 * Types of target that no condition names. Salesforce does not answer a query that filters on a standard object
 * as the type of the target: its documentation of the object says so, and the test org refused every such
 * query, also the one that leaves the type out by name (`docs/research/phase-1/real-org.md`).
 */
const TARGETS_NOT_NAMED: readonly string[] = ['StandardEntity'];

/** A type or an id that can stand between quotes in a query as it is. Anything else is never put into one. */
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const ID = /^[A-Za-z0-9]{15,18}$/;

/** The code of the stop at the limit of requests. It is a code of OrgLens, not of Salesforce. */
const USED_UP = 'REQUESTS_USED_UP';

type Row = Readonly<Record<string, unknown>>;

/** One page of an answer of the Tooling API to a query. */
interface Page {
  readonly done?: unknown;
  readonly nextRecordsUrl?: unknown;
  readonly records?: unknown;
}

/** What one query gave. */
interface Asked {
  readonly rows: DependencyRow[];
  /** Why rows of the answer are missing, or `null` if every page came. */
  readonly failure: MetadataRequestError | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function endOf(row: Row, prefix: 'MetadataComponent' | 'RefMetadataComponent'): DependencyEnd {
  const namespace = text(row[`${prefix}Namespace`]);
  return {
    type: text(row[`${prefix}Type`]),
    id: text(row[`${prefix}Id`]),
    name: text(row[`${prefix}Name`]),
    namespace: namespace === '' ? null : namespace,
  };
}

const identity = ({ from, to }: DependencyRow): string =>
  [from.type, from.id, from.name, from.namespace ?? '', to.type, to.id, to.name, to.namespace ?? ''].join('\u0000');

const quoted = (values: Iterable<string>): string => [...values].map((value) => `'${value}'`).join(', ');

/** The stop of a reading: the org cannot be asked any further. */
class Stopped extends Error {
  readonly failure: MetadataRequestError;
  constructor(failure: MetadataRequestError) {
    super(failure.message);
    this.failure = failure;
  }
}

/**
 * Reads the rows of the Dependency API of an org.
 *
 * Never fails because of the org: an org that does not have the API, refuses a query or goes away gives a
 * reading that is `none` or `partial`.
 */
export async function readDependencies(
  session: OrgSession,
  options: DependencyOptions = {},
): Promise<DependencyReading> {
  const limits = dependencyLimits(options.limits);
  const apiVersion = options.apiVersion ?? session.apiVersion;
  const http = await openOrgHttp();
  const rows = new Map<string, DependencyRow>();
  let requests = 0;
  let answered = 0;
  /** Queries the org refused before it answered one. */
  let refusedAtStart = 0;
  /** Queries in a row, up to now, that got no answer in time. */
  let timeouts = 0;
  let cutOff = 0;
  let failed = 0;
  let unproven = 0;
  let code: string | null = null;
  /** The only address an answer may go on at: the same query of the Tooling API, further on. */
  const furtherOn = new RegExp(`^/services/data/v${apiVersion.replaceAll('.', '\\.')}/tooling/query/[A-Za-z0-9_-]+$`);

  /** Asks one query, follows its answer over its pages, and keeps the rows. */
  const ask = async (where: string): Promise<Asked> => {
    const found: DependencyRow[] = [];
    const soql = where === '' ? BASE : `${BASE} WHERE ${where}`;
    let url: string | null = `/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(soql)}`;
    let failure: MetadataRequestError | null = null;
    try {
      for (let pages = 0; url !== null; pages += 1) {
        if (pages >= limits.pages) {
          failure = new MetadataRequestError('refused', 'PAGES_LEFT', 'The answer went on after the last page read.');
          break;
        }
        if (requests >= limits.requestsInAll) {
          failure = new MetadataRequestError('refused', USED_UP, 'The reading reached its limit of requests.');
          break;
        }
        const address: string = url;
        const late: { failure: MetadataRequestError | null } = { failure: null };
        const page = await repeated(http, limits, async () => {
          requests += 1;
          try {
            // What sends the request is an option the declaration of the client does not name.
            const sent = { transport: http.transport(limits.requestMs) } as never;
            return await session.connection.request<Page | null>(address, sent);
          } catch (error) {
            const thrown = requestFailure(error);
            // A query that took too long takes as long when it is asked again. Its parts may not.
            if (thrown.code !== 'TIMEOUT') throw thrown;
            late.failure = thrown;
            return null;
          }
        });
        if (late.failure !== null) throw late.failure;
        if (Array.isArray(page?.records)) {
          for (const record of page.records as Row[]) {
            found.push({ from: endOf(record, 'MetadataComponent'), to: endOf(record, 'RefMetadataComponent') });
          }
        }
        const next = text(page?.nextRecordsUrl);
        if (page?.done === true) url = null;
        else if (furtherOn.test(next)) url = next;
        else {
          failure = new MetadataRequestError('refused', 'NOT_DONE', 'The org did not say that the answer had ended.');
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof MetadataRequestError)) throw error;
      failure = error;
    }
    for (const row of found) rows.set(identity(row), row);
    options.onProgress?.(requests, rows.size);
    if (failure === null) {
      answered += 1;
      timeouts = 0;
    } else {
      code ??= failure.code ?? 'NO_CODE';
      if (answered === 0) refusedAtStart += 1;
      timeouts = failure.code === 'TIMEOUT' ? timeouts + 1 : 0;
      // Without a session or a network no further query is answered either. Nor is one after the org has
      // refused every query from the start: it does not have the API, or not for this user. A query that
      // took too long says nothing about the next one, which asks for less, until several in a row did.
      const stops =
        failure.code === USED_UP ||
        failure.kind === 'session' ||
        (failure.kind === 'unreachable' && (failure.code !== 'TIMEOUT' || timeouts >= limits.timeoutsInARow)) ||
        (answered === 0 && refusedAtStart >= limits.refusalsAtStart);
      if (stops) throw new Stopped(failure);
    }
    return { rows: found, failure };
  };

  const atLimit = (asked: Asked): boolean => asked.rows.length >= limits.rowsPerQuery;
  const seen = (pick: (row: DependencyRow) => string): string[] =>
    [...new Set([...rows.values()].map(pick))].filter((type) => TYPE_NAME.test(type));

  /**
   * The rows of one part of a type that is at the limit, per group of the components that refer. A part is a
   * pair of types, the rest of a type, or the whole type. A group at the limit is asked for in two halves, down
   * to one component. `sample`: rows that are known to be of the part.
   */
  const askPerComponent = async (part: string, sample: readonly DependencyRow[], type: string): Promise<void> => {
    const ids = [...new Set((options.idsOfType?.(type) ?? []).filter((id) => ID.test(id)))].sort();
    // The ids of the org have 15 characters, or 18 with three more that repeat the case of the first 15.
    const known = new Set(ids.map((id) => id.slice(0, 15)));
    // The rows the part gave before it was cut off show whether the ids are the ones the API uses. If a row is
    // from a component whose id is not among them, asking per id would leave its rows out without a trace.
    if (ids.length === 0 || sample.some((row) => !known.has(row.from.id.slice(0, 15)))) {
      cutOff += 1;
      return;
    }
    const groups: string[][] = [];
    for (let at = 0; at < ids.length; at += limits.idsPerQuery) groups.push(ids.slice(at, at + limits.idsPerQuery));
    const came = new Set<string>();
    let groupsAnswered = 0;
    /** Whether a group left rows out, which is counted where it happens. */
    let lacking = false;
    for (let group = groups.shift(); group !== undefined; group = groups.shift()) {
      const asked = await ask(`${part} AND MetadataComponentId IN (${quoted(group)})`);
      for (const row of asked.rows) came.add(identity(row));
      if (atLimit(asked)) {
        if (group.length === 1) {
          cutOff += 1;
          lacking = true;
        } else {
          groups.unshift(group.slice(0, Math.ceil(group.length / 2)), group.slice(Math.ceil(group.length / 2)));
        }
      } else if (asked.failure !== null) {
        failed += 1;
        lacking = true;
        // An org that refuses the first group refuses the way of asking, and every other group with it.
        if (groupsAnswered === 0) return;
      }
      if (asked.failure === null) groupsAnswered += 1;
    }
    // The rows that are known to be of the part have to come again. Where one does not, the org does not read
    // a condition the way it is meant here, and the groups say nothing about what is there.
    if (!lacking && sample.some((row) => !came.has(identity(row)))) {
      cutOff += 1;
      return;
    }
    // The rows of a component that is not among the ids: one the org did not list, or made since. One query
    // can ask for them where it can name every id. Where it cannot, nothing shows that there is none.
    if (ids.length > limits.idsPerQuery) {
      unproven += 1;
      return;
    }
    const others = await ask(`${part} AND MetadataComponentId NOT IN (${quoted(ids)})`);
    if (atLimit(others)) cutOff += 1;
    else if (others.failure !== null) failed += 1;
  };

  /**
   * Whether the org refused a query as it is written: it gave no row and no page, and not because it took too
   * long. Asking for the same rows in another way can be answered. A query that ran out of time is not one:
   * a query for more rows would take longer still.
   */
  const refusedAsWritten = (asked: Asked): boolean =>
    asked.failure?.kind === 'refused' && asked.rows.length === 0 && !(asked.failure.code ?? '').includes('TIMEOUT');

  /**
   * The rows of one type of component, per type of the target where the type alone is at the limit.
   *
   * A type of target that cannot be asked for by name is never left out of the rest, so its rows come with the
   * rest. That holds for a standard object, and for a type whose query the org refused as it is written.
   */
  const askType = async (type: string): Promise<void> => {
    const whole = `MetadataComponentType = '${type}'`;
    const ofType = await ask(whole);
    if (!atLimit(ofType) && ofType.failure === null) return;
    // The types of target the rows so far show, then whatever is of another type: the limit may hide a type.
    // A type whose query failed is asked for in the same parts: a part can be answered where the whole is not.
    /** The types of target that a query of their own was asked for and that the rest leaves out. */
    const done = new Set<string>();
    /** The types of target that are not asked for by name, or were and were refused. */
    const unnamed = new Set(TARGETS_NOT_NAMED);
    const left = (): string[] =>
      seen((row) => row.to.type)
        .filter((target) => !done.has(target) && !unnamed.has(target))
        .sort();
    let targets = left();
    for (let round = 0; round < limits.rounds; round += 1) {
      for (const target of targets) {
        const pair = `${whole} AND RefMetadataComponentType = '${target}'`;
        const asked = await ask(pair);
        if (atLimit(asked)) {
          done.add(target);
          await askPerComponent(pair, asked.rows, type);
        } else if (asked.failure === null) done.add(target);
        // The rest gives the rows of a type the org refuses by its name, and counts as failed if it does not.
        else if (refusedAsWritten(asked)) unnamed.add(target);
        else {
          // A query that broke off or took too long. The rest would take longer with these rows in it.
          done.add(target);
          failed += 1;
        }
      }
      const rest =
        done.size === 0 ? whole : `${whole} AND RefMetadataComponentType NOT IN (${quoted([...done].sort())})`;
      // With no type left out, the rest is the query for the whole type, which has been asked.
      const others = done.size === 0 ? ofType : await ask(rest);
      // The rows the query for the whole type gave that are of the rest. The rest is the only query that brings
      // the rows to a standard object, and nothing else shows that the org puts them into its answer.
      const known = ofType.rows.filter((row) => !done.has(row.to.type));
      targets = left();
      if (!atLimit(others)) {
        if (others.failure === null) {
          const came = new Set(others.rows.map(identity));
          // A row that is of the rest and did not come with it: the org does not read the list of types the
          // way it is meant here, and the rest says nothing about what is there.
          if (known.some((row) => !came.has(identity(row)))) cutOff += 1;
        } else if (others !== ofType && refusedAsWritten(others)) {
          // The org does not take the list of types. The conditions on the id of a component need none.
          await askPerComponent(whole, ofType.rows, type);
        } else failed += 1;
        return;
      }
      // At the limit with no type left to ask for by name, or after the last round: the rest is asked for per
      // component, which leaves no type out.
      if (targets.length === 0 || round === limits.rounds - 1) {
        await askPerComponent(rest, [...others.rows, ...known], type);
        return;
      }
    }
  };

  try {
    try {
      const all = await ask('');
      // Whether the first query gave every row of the org. Then no later query can add one.
      const whole = all.failure === null && !atLimit(all);
      if (!whole) {
        // The types that are known to refer and the ones the rows show, then whatever is of another type.
        const done = new Set<string>();
        let types = [...new Set([...REFERRING_TYPES, ...seen((row) => row.from.type)])].sort();
        for (let round = 0; round < limits.rounds; round += 1) {
          for (const type of types) {
            done.add(type);
            await askType(type);
          }
          const others = await ask(`MetadataComponentType NOT IN (${quoted(done)})`);
          types = seen((row) => row.from.type)
            .filter((type) => !done.has(type))
            .sort();
          if (!atLimit(others)) {
            // Without this answer, a type that no row shows stays unseen.
            if (others.failure !== null) failed += 1;
            break;
          }
          if (types.length === 0 || round === limits.rounds - 1) {
            cutOff += 1;
            break;
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Stopped)) throw error;
      // What stopped the reading left the rows of every query that was not asked out.
      failed += 1;
    }
  } finally {
    await http.close();
  }

  const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  // A query that broke off after a page left rows behind: the org gave something, and not all of it.
  const lacks = cutOff > 0 || failed > 0 || unproven > 0;
  const state = answered === 0 ? (rows.size === 0 ? 'none' : 'partial') : lacks ? 'partial' : 'whole';
  return {
    rows: [...rows.entries()].sort(([a], [b]) => compare(a, b)).map(([, row]) => row),
    state,
    requests,
    cutOff,
    failed,
    unproven,
    // A query that failed and whose rows other queries gave left nothing out.
    code: state === 'whole' ? null : code,
  };
}

/** The ids of the active and of the latest version of a flow, as the org names them. */
export interface FlowVersionIds {
  /** The full name of the flow, with the prefix of its package before two underscores. */
  readonly flow: string;
  /** The id of the active version, or `null` where no version of the flow is active. */
  readonly active: string | null;
  /** The id of the latest version, or `null` where the org names none. */
  readonly latest: string | null;
}

/** What the org said about the versions of its flows. */
export interface FlowVersionReading {
  /**
   * - `whole`: the org answered, and `flows` names every flow it knows.
   * - `partial`: the answer broke off. `flows` holds what came before.
   * - `none`: the org did not answer.
   */
  readonly state: 'whole' | 'partial' | 'none';
  /** Sorted by flow. */
  readonly flows: readonly FlowVersionIds[];
  /** Requests that were sent. */
  readonly requests: number;
  /** The code of the failure, such as `INVALID_TYPE`, or `null`. */
  readonly code: string | null;
}

/** The other object that is queried, once per reading. A test holds every query against it and the one above. */
export const FLOW_VERSION_OBJECT = 'FlowDefinition';
const FLOW_VERSIONS = `SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM ${FLOW_VERSION_OBJECT}`;

/**
 * Asks the org which version of each of its flows is active and which is the latest: one query, followed over its
 * pages (decision record 0067).
 *
 * Never fails because of the org: an org that refuses the query, or stops answering, gives a reading that is
 * `none` or `partial`.
 */
export async function readFlowVersions(
  session: OrgSession,
  options: Pick<DependencyOptions, 'limits' | 'apiVersion'> = {},
): Promise<FlowVersionReading> {
  const limits = dependencyLimits(options.limits);
  const apiVersion = options.apiVersion ?? session.apiVersion;
  const http = await openOrgHttp();
  const flows = new Map<string, FlowVersionIds>();
  let requests = 0;
  /** The only address an answer may go on at: the same query of the Tooling API, further on. */
  const furtherOn = new RegExp(`^/services/data/v${apiVersion.replaceAll('.', '\\.')}/tooling/query/[A-Za-z0-9_-]+$`);
  const idIn = (record: Row, field: string): string | null => {
    const id = text(record[field]);
    return ID.test(id) ? id : null;
  };
  const sorted = (): FlowVersionIds[] =>
    [...flows.values()].sort((a, b) => (a.flow < b.flow ? -1 : a.flow > b.flow ? 1 : 0));
  /** What came before the answer broke off. The versions it names are right all the same. */
  const ended = (code: string): FlowVersionReading => ({
    state: flows.size === 0 ? 'none' : 'partial',
    flows: sorted(),
    requests,
    code,
  });
  try {
    let url: string | null = `/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(FLOW_VERSIONS)}`;
    for (let pages = 0; url !== null; pages += 1) {
      if (pages >= limits.pages) return ended('PAGES_LEFT');
      if (requests >= limits.requestsInAll) return ended(USED_UP);
      const address: string = url;
      const late: { failure: MetadataRequestError | null } = { failure: null };
      const page = await repeated(http, limits, async () => {
        requests += 1;
        try {
          // What sends the request is an option the declaration of the client does not name.
          const sent = { transport: http.transport(limits.requestMs) } as never;
          return await session.connection.request<Page | null>(address, sent);
        } catch (error) {
          const thrown = requestFailure(error);
          // A query that took too long takes as long when it is asked again.
          if (thrown.code !== 'TIMEOUT') throw thrown;
          late.failure = thrown;
          return null;
        }
      });
      if (late.failure !== null) throw late.failure;
      for (const record of Array.isArray(page?.records) ? (page.records as Row[]) : []) {
        const name = text(record['DeveloperName']);
        if (name === '') continue;
        const namespace = text(record['NamespacePrefix']);
        const flow = namespace === '' ? name : `${namespace}__${name}`;
        flows.set(flow, { flow, active: idIn(record, 'ActiveVersionId'), latest: idIn(record, 'LatestVersionId') });
      }
      const next = text(page?.nextRecordsUrl);
      if (page?.done === true) url = null;
      else if (furtherOn.test(next)) url = next;
      else return ended('NOT_DONE');
    }
  } catch (error) {
    if (!(error instanceof MetadataRequestError)) throw error;
    return ended(error.code ?? 'NO_CODE');
  } finally {
    await http.close();
  }
  return { state: 'whole', flows: sorted(), requests, code: null };
}
