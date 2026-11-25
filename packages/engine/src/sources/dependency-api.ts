/**
 * The Dependency API of Salesforce: the rows of `MetadataComponentDependency`, read through the Tooling API.
 *
 * A row names two components: one, and one it refers to. It says nothing of where, how often or in which way.
 * OrgLens reads the rows as a second opinion on the references it finds itself (decision records 0034 and
 * 0045). They are never the source of an answer.
 *
 * One query gives at most 2,000 rows and cannot be continued, and an answer that Salesforce cut off can hold
 * fewer: on a large org the query for every row held fewer rows than the limit, and most rows were not among them
 * (decision record 0069). So the query for every row never stands for the org. The rows are always asked for per
 * type of the component that refers, then whatever is of no type that a query named, the rest. The types the rest
 * shows are asked for by name in one more round, and the rest again after them.
 *
 * An answer that holds half as many rows as the limit, or more, is near the limit, and its rows are asked for in
 * parts: per pair of types, with the rest of the types of target asked for in rounds as above, then per group of
 * components that refer, whose ids the caller knows from what the org listed. A standard object as the target
 * cannot be asked for by name, so its rows are asked for with the rest. A part that is still near the limit is
 * taken as cut off: rows are missing, and the reading says so. Where rows were asked for per component, the
 * reading is only as whole as the list of components: it asks for the rows of every other component in one more
 * query where the list is short enough for that, and says so where it is not.
 *
 * An answer that is not near the limit, and that did not fail, is taken as whole, and is held against the reading
 * when the reading has ended: a row that another query gave, and that its query asked for as well, shows that it
 * was cut off all the same, also where it held few rows.
 *
 * A row from a flow carries the id of a version of the flow, and the org lists a flow with the id of its latest
 * version only. So the versions of the flows are asked for as well: one more object of the Tooling API,
 * `FlowDefinition`, names the active and the latest version of each flow (decision record 0067), and another,
 * `Flow`, names every version with the flow it is of (decision record 0078).
 *
 * The three objects describe metadata. No record of the data of the org is read, and nothing is written. A failure
 * of the org never throws here: the reading says how far it came. Only a fault of this machine or of the code
 * is thrown.
 */
import type { OrgSession } from './org.ts';
import {
  MetadataRequestError,
  openOrgHttp,
  repeated,
  requestFailure,
  type OrgHttp,
  type RequestLimits,
} from './org-http.ts';

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
   * - `whole`: no answer shows that a row is missing. An answer that was cut off below half the limit, and whose
   *   rows no other query gives, goes unseen (decision record 0069).
   * - `partial`: rows are missing, or may be. `cutOff` and `failed` say how many queries left some out, or are
   *   shown to disagree with others, and `unproven` how many could have.
   * - `none`: the org answered no query, and no row was read.
   */
  readonly state: 'whole' | 'partial' | 'none';
  /** Requests that were sent. */
  readonly requests: number;
  /**
   * Queries that were cut off: near the limit of rows with no smaller part to ask for, or shown to be by another
   * answer, which gave a row that the query asked for and its answer lacks (decision record 0069). An org that
   * changes while it is read can show that as well. The queries for the groups of components of one part are
   * counted as one query where a row that the part itself gave did not come again with them.
   */
  readonly cutOff: number;
  /**
   * Of the queries in `cutOff`, those that another answer shows to be cut off. None of their answers was near the
   * limit: two answers of the org do not agree. It is not stored with a snapshot.
   */
  readonly disagreed: number;
  /** Queries that failed and whose rows no other query gave. */
  readonly failed: number;
  /**
   * Queries near the limit whose rows were asked for per component, for more components than one query can name.
   * Every row of a component the caller named was read. A row of a component it did not name, because the org
   * did not list it, is missing, and nothing shows whether there is one.
   */
  readonly unproven: number;
  /**
   * The code of the first failure of the reading, such as `INVALID_TYPE` or `TIMEOUT`, or `null`: where no query
   * failed, and where the reading is whole. It can be the code of a query whose rows other queries gave. Such a
   * failure is often why another query is then counted, since the rows are asked for in another way after it.
   */
  readonly code: string | null;
}

/** The numbers the Dependency API is read with. A test sets them to make things happen that are rare. */
export interface DependencyLimits extends RequestLimits {
  /**
   * The rows one answer holds at most. Salesforce stops at 2,000. An answer that holds half as many or more, or
   * says it does, is near the limit and may have left rows out: an answer that Salesforce cut off can hold fewer
   * rows than this (decision record 0069).
   */
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
   * writes it. With them, a part of a type that is near the limit is asked for per group of components: a pair
   * of types, or the rest of a type.
   */
  readonly idsOfType?: ((type: string) => readonly string[]) | undefined;
  /** Called after every query, with the number of requests and of different rows so far. */
  readonly onProgress?: ((requests: number, rows: number) => void) | undefined;
}

const FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType';
/**
 * The object of the rows. The others are `FLOW_VERSION_OBJECT` and `EVERY_VERSION_OBJECT`. A test holds every query
 * against each.
 */
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
  readonly totalSize?: unknown;
}

/** What one query gave. */
interface Asked {
  /** The rows of the answer. A row that two answers give is the same object in both. */
  readonly rows: DependencyRow[];
  /**
   * The number of rows the answer says it has (`totalSize`), or 0 where it says none. Should Salesforce count rows
   * it left out, this is more than `rows` holds (decision record 0069).
   */
  readonly total: number;
  /** Why rows of the answer are missing, or `null` if every page came. */
  readonly failure: MetadataRequestError | null;
}

/**
 * An answer that is taken as whole: it held fewer rows than half the limit, and every page of it came. So it has
 * to hold every row of the reading that its query asked for, whichever query gave that row (decision record 0069).
 */
interface Whole {
  /** The rows it gave. */
  readonly came: ReadonlySet<DependencyRow>;
  /** Whether a row is one its query asked for. */
  readonly fits: (row: DependencyRow) => boolean;
  /** The type of the component that refers, where its query named one. Only rows of that type can fit. */
  readonly type: string | null;
  /** The components its query named, each by the first 15 characters of its id. Only their rows can fit. */
  readonly components: ReadonlySet<string> | null;
}

/** A part of the rows of a type: the condition that asks for it, and whether a row is of it. */
interface Part {
  readonly where: string;
  readonly fits: (row: DependencyRow) => boolean;
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
  let disagreed = 0;
  let failed = 0;
  let unproven = 0;
  let code: string | null = null;
  /** The only address an answer may go on at: the same query of the Tooling API, further on. */
  const furtherOn = new RegExp(`^/services/data/v${apiVersion.replaceAll('.', '\\.')}/tooling/query/[A-Za-z0-9_-]+$`);
  /** The answers that are taken as whole. Each is held against the reading when the reading has ended. */
  const taken: Whole[] = [];

  /** Asks one query, follows its answer over its pages, and keeps the rows. */
  const ask = async (where: string): Promise<Asked> => {
    const found: DependencyRow[] = [];
    let total = 0;
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
        const size = page?.totalSize;
        if (typeof size === 'number' && Number.isSafeInteger(size)) total = Math.max(total, size);
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
    // A row that an earlier answer gave is that row: an answer is held against the others by the rows themselves.
    const kept = found.map((row) => {
      const id = identity(row);
      const known = rows.get(id);
      if (known === undefined) rows.set(id, row);
      return known ?? row;
    });
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
    return { rows: kept, total, failure };
  };

  /**
   * Whether an answer may have left rows out: it holds half as many rows as one answer can, or more, or says that
   * it does. An answer that Salesforce cut off can hold fewer rows than the limit (decision record 0069).
   */
  const nearLimit = (asked: Asked): boolean => 2 * Math.max(asked.rows.length, asked.total) >= limits.rowsPerQuery;
  const seen = (pick: (row: DependencyRow) => string): string[] =>
    [...new Set([...rows.values()].map(pick))].filter((type) => TYPE_NAME.test(type));
  /**
   * Takes an answer as whole. It is only called for an answer that is not near the limit and did not fail.
   * `type` and `components`: what its query named, so that only those rows are looked at.
   */
  const take = (
    asked: Asked,
    fits: Whole['fits'],
    type: string | null,
    components: ReadonlySet<string> | null = null,
  ): void => {
    taken.push({ came: new Set(asked.rows), fits, type, components });
  };

  /**
   * The rows of one part of a type that is near the limit, per group of the components that refer. A part is a
   * pair of types, the rest of a type, or the whole type. A group near the limit is asked for in two halves, down
   * to one component. `sample`: rows that are known to be of the part.
   */
  const askPerComponent = async (part: Part, sample: readonly DependencyRow[], type: string): Promise<void> => {
    // The ids of the org have 15 characters, or 18 with three more that repeat the case of the first 15. A
    // component that is given in both lengths is one component: it is asked for once, by the longer id.
    const byComponent = new Map<string, string>();
    for (const id of [...(options.idsOfType?.(type) ?? [])].sort()) {
      if (!ID.test(id)) continue;
      const other = byComponent.get(id.slice(0, 15));
      if (other === undefined || id.length > other.length) byComponent.set(id.slice(0, 15), id);
    }
    const ids = [...byComponent.values()].sort();
    const known = new Set(byComponent.keys());
    const component = (row: DependencyRow): string => row.from.id.slice(0, 15);
    // The rows the part gave before it was cut off show whether the ids are the ones the API uses. If a row is
    // from a component whose id is not among them, asking per id would leave its rows out without a trace.
    if (ids.length === 0 || sample.some((row) => !known.has(component(row)))) {
      cutOff += 1;
      return;
    }
    const groups: string[][] = [];
    for (let at = 0; at < ids.length; at += limits.idsPerQuery) groups.push(ids.slice(at, at + limits.idsPerQuery));
    const came = new Set<DependencyRow>();
    /** The answers of the groups that were not near the limit and did not fail, each with its components. */
    const answers: [Asked, ReadonlySet<string>][] = [];
    let groupsAnswered = 0;
    /** Whether a group left rows out, which is counted where it happens. */
    let lacking = false;
    /** Takes the answers of the groups as whole, each for the rows of the part that its components have. */
    const takeGroups = (): void => {
      for (const [asked, group] of answers) {
        take(asked, (row) => part.fits(row) && group.has(component(row)), type, group);
      }
    };
    try {
      for (let group = groups.shift(); group !== undefined; group = groups.shift()) {
        const asked = await ask(`${part.where} AND MetadataComponentId IN (${quoted(group)})`);
        for (const row of asked.rows) came.add(row);
        if (nearLimit(asked)) {
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
        } else answers.push([asked, new Set(group.map((id) => id.slice(0, 15)))]);
        if (asked.failure === null) groupsAnswered += 1;
      }
    } catch (error) {
      // The reading stops among the groups, so the rows the part gave cannot be looked for in all of them. What
      // the groups gave before is held against the reading like every other answer.
      if (error instanceof Stopped) takeGroups();
      throw error;
    }
    // The rows that are known to be of the part have to come again. Where one does not, the org does not read
    // a condition the way it is meant here, and the groups say nothing about what is there: their queries are
    // counted as one, and no group is taken as whole.
    if (!lacking && sample.some((row) => !came.has(row))) {
      cutOff += 1;
      disagreed += 1;
      return;
    }
    takeGroups();
    // The rows of a component that is not among the ids: one the org did not list, or made since. One query
    // can ask for them where it can name every id. Where it cannot, nothing shows that there is none.
    if (ids.length > limits.idsPerQuery) {
      unproven += 1;
      return;
    }
    const others = await ask(`${part.where} AND MetadataComponentId NOT IN (${quoted(ids)})`);
    if (nearLimit(others)) cutOff += 1;
    else if (others.failure !== null) failed += 1;
    else take(others, (row) => part.fits(row) && !known.has(component(row)), type);
  };

  /**
   * Whether the org refused a query as it is written: it gave no row and no page, and not because it took too
   * long. Asking for the same rows in another way can be answered. A query that ran out of time is not one:
   * a query for more rows would take longer still.
   */
  const refusedAsWritten = (asked: Asked): boolean =>
    asked.failure?.kind === 'refused' && asked.rows.length === 0 && !(asked.failure.code ?? '').includes('TIMEOUT');

  /**
   * The rows of one type of component, per type of the target where the type alone is near the limit.
   *
   * A type of target that cannot be asked for by name is never left out of the rest, so its rows come with the
   * rest. That holds for a standard object, and for a type whose query the org refused as it is written.
   */
  const askType = async (type: string): Promise<void> => {
    const whole = `MetadataComponentType = '${type}'`;
    const ofThisType = (row: DependencyRow): boolean => row.from.type === type;
    const ofType = await ask(whole);
    if (!nearLimit(ofType) && ofType.failure === null) {
      take(ofType, ofThisType, type);
      return;
    }
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
    /** The rest that was asked for last, and what the org answered. */
    let before: { readonly where: string; readonly answer: Asked } | null = null;
    for (let round = 0; ; round += 1) {
      for (const target of targets) {
        const pair: Part = {
          where: `${whole} AND RefMetadataComponentType = '${target}'`,
          fits: (row) => row.from.type === type && row.to.type === target,
        };
        const asked = await ask(pair.where);
        if (nearLimit(asked)) {
          done.add(target);
          await askPerComponent(pair, asked.rows, type);
        } else if (asked.failure === null) {
          done.add(target);
          take(asked, pair.fits, type);
        }
        // The rest gives the rows of a type the org refuses by its name, and counts as failed if it does not.
        else if (refusedAsWritten(asked)) unnamed.add(target);
        else {
          // A query that broke off or took too long. The rest would take longer with these rows in it.
          done.add(target);
          failed += 1;
        }
      }
      // After the last rest, the types of target it showed were asked for by name, and the rest is not asked for
      // again. That rest is held against what their queries gave, as every answer that is taken as whole.
      if (round === limits.rounds) return;
      /** The types of target the rest leaves out, as they are now. */
      const out = new Set(done);
      const rest: Part = {
        // With no type left out, the rest is the query for the whole type, which has been asked.
        where: out.size === 0 ? whole : `${whole} AND RefMetadataComponentType NOT IN (${quoted([...out].sort())})`,
        fits: (row) => row.from.type === type && !out.has(row.to.type),
      };
      // A round in which the org refused every type by its name put none on the list. The rest is then the query
      // it was before: it is not asked a second time, and its answer is not taken a second time.
      const again: Asked | null = before !== null && before.where === rest.where ? before.answer : null;
      const others: Asked = out.size === 0 ? ofType : (again ?? (await ask(rest.where)));
      before = { where: rest.where, answer: others };
      targets = left();
      if (nearLimit(others)) {
        // Near the limit with no type left to ask for by name, or after the last round: the rest is asked for per
        // component, which leaves no type out. The rows the query for the whole type gave that are of the rest
        // are known to be of it as well.
        if (targets.length === 0 || round === limits.rounds - 1) {
          await askPerComponent(rest, [...others.rows, ...ofType.rows.filter(rest.fits)], type);
          return;
        }
      } else if (others.failure === null) {
        // The rest is the only query that brings the rows to a standard object. It is taken as whole: so it has
        // to hold the rows of the rest that the query for the whole type gave, and the rows of every type of
        // target it shows, which are asked for by name in the next round, also where it held few rows.
        if (again === null) take(others, rest.fits, type);
        if (targets.length === 0) return;
      } else {
        // The org does not take the list of types. The conditions on the id of a component need none.
        if (others !== ofType && refusedAsWritten(others)) {
          await askPerComponent({ where: whole, fits: ofThisType }, ofType.rows, type);
        } else failed += 1;
        return;
      }
    }
  };

  /**
   * Holds every answer that was taken as whole against the reading. A row of the reading that the query of such an
   * answer asked for, and that the answer lacks, came with another query: the answer was cut off below half the
   * limit, or the org does not read a condition the way it is meant here, or it changed in between. The query is
   * counted, once.
   */
  const holdAgainstTheReading = (): void => {
    const all = [...rows.values()];
    const ofType = new Map<string, DependencyRow[]>();
    const ofComponent = new Map<string, DependencyRow[]>();
    const add = (to: Map<string, DependencyRow[]>, key: string, row: DependencyRow): void => {
      const list = to.get(key);
      if (list === undefined) to.set(key, [row]);
      else list.push(row);
    };
    for (const row of all) {
      add(ofType, row.from.type, row);
      add(ofComponent, row.from.id.slice(0, 15), row);
    }
    for (const { came, fits, type, components } of taken) {
      const among =
        components !== null
          ? [...components].flatMap((id) => ofComponent.get(id) ?? [])
          : type !== null
            ? (ofType.get(type) ?? [])
            : all;
      if (among.some((row) => fits(row) && !came.has(row))) {
        cutOff += 1;
        disagreed += 1;
      }
    }
  };

  try {
    try {
      const all = await ask('');
      // The first answer never stands for the org, also where it holds few rows: an answer that Salesforce cut
      // off can hold fewer rows than the limit, and nothing in it shows that (decision record 0069). So the rows
      // are asked for per type of the component that refers: the types that are known to refer and the ones the
      // rows show, then whatever is of another type. Where it is not near the limit, it has to hold every row
      // the other queries give, as every answer that is taken as whole.
      if (!nearLimit(all) && all.failure === null) take(all, () => true, null);
      const done = new Set<string>();
      let types = [...new Set([...REFERRING_TYPES, ...seen((row) => row.from.type)])].sort();
      for (let round = 0; ; round += 1) {
        for (const type of types) {
          done.add(type);
          await askType(type);
        }
        // After the last rest, the types it showed were asked for by name, and the rest is not asked for again.
        if (round === limits.rounds) break;
        /** The types the rest leaves out, as they are now. */
        const out = new Set(done);
        const others = await ask(`MetadataComponentType NOT IN (${quoted(out)})`);
        // The types it shows are asked for by name in the next round, also where it held few rows: an answer
        // below the limit can be cut off as well.
        types = seen((row) => row.from.type)
          .filter((type) => !done.has(type))
          .sort();
        if (nearLimit(others)) {
          // Its rows cannot be asked for in a smaller part than the types it shows. With no type to ask for, or
          // no rest after this one, nothing shows what it left out.
          if (types.length === 0 || round === limits.rounds - 1) cutOff += 1;
        } else if (others.failure !== null) {
          // Without this answer, a type that no row shows stays unseen.
          failed += 1;
          break;
        } else take(others, (row) => !out.has(row.from.type), null);
        if (types.length === 0) break;
      }
    } catch (error) {
      if (!(error instanceof Stopped)) throw error;
      // What stopped the reading left the rows of every query that was not asked out.
      failed += 1;
    }
    holdAgainstTheReading();
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
    disagreed,
    failed,
    unproven,
    // A query that failed and whose rows other queries gave left nothing out.
    code: state === 'whole' ? null : code,
  };
}

/** The ids of the versions of a flow, as the org names them. */
export interface FlowVersionIds {
  /** The full name of the flow, with the prefix of its package before two underscores. */
  readonly flow: string;
  /** The id of the active version, or `null` where no version of the flow is active. */
  readonly active: string | null;
  /** The id of the latest version, or `null` where the org names none. */
  readonly latest: string | null;
  /**
   * The ids of the other versions, sorted: those that are neither active nor the latest, such as one that a deploy
   * left behind (decision record 0078). Empty where the org named none.
   */
  readonly others: readonly string[];
}

/** What the org said about the versions of its flows. */
export interface FlowVersionReading {
  /**
   * What the org said about its flows (`FlowDefinition`):
   * - `whole`: the org answered, and `flows` names every flow it knows.
   * - `partial`: the answer broke off. `flows` holds what came before.
   * - `none`: the org did not answer.
   */
  readonly state: 'whole' | 'partial' | 'none';
  /** Sorted by flow. */
  readonly flows: readonly FlowVersionIds[];
  /** Requests that were sent, for both objects. */
  readonly requests: number;
  /** The code of the failure of the query of `FlowDefinition`, such as `INVALID_TYPE`, or `null`. */
  readonly code: string | null;
  /**
   * What the org said about every version of its flows (`Flow`, decision record 0078). The org is asked where it
   * named a flow.
   * - `whole`: the org answered, and the flows it named have all their other versions.
   * - `partial`: the answer broke off. The flows have the other versions that came before.
   * - `none`: the org did not answer, or was not asked because it named no flow.
   *
   * `code` is the code of the failure, or `null`.
   */
  readonly versions: { readonly state: 'whole' | 'partial' | 'none'; readonly code: string | null };
}

/** The second object that is queried, once per reading. A test holds every query against each of the three. */
export const FLOW_VERSION_OBJECT = 'FlowDefinition';
const FLOW_VERSIONS = `SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM ${FLOW_VERSION_OBJECT}`;
/** The third object that is queried, after the second, where the org named a flow (decision record 0078). */
export const EVERY_VERSION_OBJECT = 'Flow';
const EVERY_VERSION = `SELECT Id, DefinitionId FROM ${EVERY_VERSION_OBJECT}`;

/**
 * Asks one query of the Tooling API and follows its answer over its pages, handing each record to `take`. Returns
 * `null` where the answer is whole, and else the code of why it broke off: the code of the org, or one of OrgLens
 * where the answer went nowhere that is allowed or the limits stopped it. Only a fault of this machine or of the
 * code is thrown.
 */
async function followed(
  session: OrgSession,
  http: OrgHttp,
  limits: DependencyLimits,
  apiVersion: string,
  query: string,
  sent: { requests: number },
  take: (record: Row) => void,
): Promise<string | null> {
  /** The only address an answer may go on at: the same query of the Tooling API, further on. */
  const furtherOn = new RegExp(`^/services/data/v${apiVersion.replaceAll('.', '\\.')}/tooling/query/[A-Za-z0-9_-]+$`);
  try {
    let url: string | null = `/services/data/v${apiVersion}/tooling/query?q=${encodeURIComponent(query)}`;
    for (let pages = 0; url !== null; pages += 1) {
      if (pages >= limits.pages) return 'PAGES_LEFT';
      if (sent.requests >= limits.requestsInAll) return USED_UP;
      const address: string = url;
      const late: { failure: MetadataRequestError | null } = { failure: null };
      const page = await repeated(http, limits, async () => {
        sent.requests += 1;
        try {
          // What sends the request is an option the declaration of the client does not name.
          const options = { transport: http.transport(limits.requestMs) } as never;
          return await session.connection.request<Page | null>(address, options);
        } catch (error) {
          const thrown = requestFailure(error);
          // A query that took too long takes as long when it is asked again.
          if (thrown.code !== 'TIMEOUT') throw thrown;
          late.failure = thrown;
          return null;
        }
      });
      if (late.failure !== null) throw late.failure;
      for (const record of Array.isArray(page?.records) ? (page.records as Row[]) : []) take(record);
      const next = text(page?.nextRecordsUrl);
      if (page?.done === true) url = null;
      else if (furtherOn.test(next)) url = next;
      else return 'NOT_DONE';
    }
    return null;
  } catch (error) {
    if (!(error instanceof MetadataRequestError)) throw error;
    return error.code ?? 'NO_CODE';
  }
}

/**
 * Asks the org which version of each of its flows is active and which is the latest (decision record 0067), and
 * then for the ids of all their versions (decision record 0078): two queries, each followed over its pages. A row of
 * the Dependency API from a flow can carry the id of any of its versions.
 *
 * Never fails because of the org: an org that refuses a query, or stops answering, gives a reading that says so.
 * What came before is kept: the versions an answer names are right all the same.
 */
export async function readFlowVersions(
  session: OrgSession,
  options: Pick<DependencyOptions, 'limits' | 'apiVersion'> = {},
): Promise<FlowVersionReading> {
  const limits = dependencyLimits(options.limits);
  const apiVersion = options.apiVersion ?? session.apiVersion;
  const http = await openOrgHttp();
  const sent = { requests: 0 };
  /** The ids of an org have 15 characters, or 18 with three more that repeat the case of the first 15. */
  const short = (id: string): string => id.slice(0, 15);
  const idIn = (record: Row, field: string): string | null => {
    const id = text(record[field]);
    return ID.test(id) ? id : null;
  };
  const flows = new Map<string, { active: string | null; latest: string | null; others: Set<string> }>();
  /** The flows by the id of their definition, which a version names. */
  const byDefinition = new Map<string, string>();
  try {
    const code = await followed(session, http, limits, apiVersion, FLOW_VERSIONS, sent, (record) => {
      const name = text(record['DeveloperName']);
      if (name === '') return;
      const namespace = text(record['NamespacePrefix']);
      const flow = namespace === '' ? name : `${namespace}__${name}`;
      flows.set(flow, {
        active: idIn(record, 'ActiveVersionId'),
        latest: idIn(record, 'LatestVersionId'),
        others: new Set(),
      });
      const definition = idIn(record, 'Id');
      if (definition !== null) byDefinition.set(short(definition), flow);
    });
    const state = code === null ? 'whole' : flows.size === 0 ? 'none' : 'partial';
    let versions: FlowVersionReading['versions'] = { state: 'none', code: null };
    if (flows.size > 0) {
      let named = 0;
      const failure = await followed(session, http, limits, apiVersion, EVERY_VERSION, sent, (record) => {
        const id = idIn(record, 'Id');
        const definition = idIn(record, 'DefinitionId');
        if (id === null || definition === null) return;
        named += 1;
        const flow = flows.get(byDefinition.get(short(definition)) ?? '');
        if (flow === undefined) return;
        if (![flow.active, flow.latest].some((known) => known !== null && short(known) === short(id))) {
          flow.others.add(id);
        }
      });
      versions = { state: failure === null ? 'whole' : named === 0 ? 'none' : 'partial', code: failure };
    }
    return {
      state,
      flows: [...flows]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([flow, { active, latest, others }]) => ({
          flow,
          active,
          latest,
          others: [...others].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        })),
      requests: sent.requests,
      code,
      versions,
    };
  } finally {
    await http.close();
  }
}
