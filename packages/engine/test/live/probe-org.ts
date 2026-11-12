/**
 * A step of the live-org workflow: asks the test org for the two things
 * Salesforce itself knows about references, and says how much of the answer
 * key of the fixture project each of them reports.
 *
 * - The Dependency API: the rows of `MetadataComponentDependency`. One
 *   query gives at most 2,000 rows and cannot be continued, so the rows are
 *   asked for per type of the component that refers, and per pair of types
 *   where that is still too many.
 * - The symbol tables of the compiler: `ApexClass.SymbolTable`, as the org
 *   holds it for a class that is saved.
 *
 * Both are read through the Tooling API, whose objects describe metadata.
 * No record of the data of the org is read, and nothing is written. A
 * symbol table that holds references to other classes can only be had by
 * compiling a copy of a class in the org (`ApexClassMember` in a
 * `MetadataContainer`). That writes to the org, so it is not done here.
 *
 * What is printed follows the rule of `public-log.ts`: names of metadata
 * types, of the fields of the Tooling API, and of the fixture project. A
 * row about a component that is not of the fixture project is counted and
 * not named.
 *
 * The step fails when the org answers neither of the two. Where rows are
 * known to be missing, it ends with a warning: what it counted is a lower
 * bound then.
 *
 *   node --no-warnings packages/engine/test/live/probe-org.ts
 */
import { connectToOrg, type OrgSession } from '../../src/sources/org.ts';
import { codeOf, fixtureWords, PLATFORM_WORDS } from './deploy-fixture.ts';
import { asStep } from './own-output.ts';
import type { PublicLog } from './public-log.ts';
import { answerKey, failureLines, loginEnvironment, SOURCE } from './test-org.ts';

/** The most rows one query of the Dependency API gives. A query that gives this many may have left rows out. */
const CUT_OFF = 2000;
/** The query for the symbol tables can take long. */
const REQUEST = { timeout: 180_000 } as const;
/** No query is followed over more pages than this. */
const PAGES = 400;
/** How often the types of target that are left are asked for, where a type of component is at the limit. */
const ROUNDS = 6;
/** At most this many lines are printed of one list. */
const SHOWN = 200;

const DEPENDENCY_FIELDS =
  'MetadataComponentId, MetadataComponentName, MetadataComponentNamespace, MetadataComponentType, ' +
  'RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentNamespace, RefMetadataComponentType';

/**
 * Types of components that refer to others, asked for whatever the first query shows: it may be cut off before
 * the rows of a type.
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

type Row = Readonly<Record<string, unknown>>;

/** What a query of the Tooling API gave. */
interface Asked {
  readonly rows: Row[];
  readonly pages: number;
  /**
   * The code of the failure, or `null` if every page came. `PAGES_LEFT` and `NOT_DONE` are codes of this tool: the
   * answer went on after the last page that was read, or the org did not say that it had ended.
   */
  readonly failed: string | null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
/** An id in the form it has in every place: its first 15 characters. */
const short = (value: unknown): string => text(value).slice(0, 15);
const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;
const TYPE_NAME = /^[A-Za-z][A-Za-z0-9]{0,79}$/;

/** Lines of a table: the columns are as wide as their widest cell. */
function table(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, index) => (widths[index] = Math.max(widths[index] ?? 0, cell.length)));
  return rows.map((row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd(),
  );
}

/** One page of an answer of the Tooling API to a query. */
interface Page {
  readonly done?: unknown;
  readonly nextRecordsUrl?: unknown;
  readonly records?: unknown;
}

/** Asks the Tooling API, and follows the answer over its pages. */
async function ask(log: PublicLog, session: OrgSession, soql: string, counter: { requests: number }): Promise<Asked> {
  const rows: Row[] = [];
  let pages = 0;
  let url: string | null = `/services/data/v${session.apiVersion}/tooling/query?q=${encodeURIComponent(soql)}`;
  try {
    while (url !== null) {
      if (pages >= PAGES) return { rows, pages, failed: 'PAGES_LEFT' };
      counter.requests += 1;
      const page: Page | null = await session.connection.request<Page | null>(url, REQUEST);
      pages += 1;
      if (Array.isArray(page?.records)) rows.push(...(page.records as Row[]));
      const next = text(page?.nextRecordsUrl);
      if (page?.done === true) url = null;
      else if (next.startsWith('/services/data/')) url = next;
      else return { rows, pages, failed: 'NOT_DONE' };
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : undefined;
    return { rows, pages, failed: codeOf(log, error) ?? log.code(name) ?? 'NO_CODE' };
  }
  return { rows, pages, failed: null };
}

/** The keys of the fixture project and the references between them, as its answer key has them. */
interface Fixture {
  /** The keys of the components, and of the targets that Salesforce provides. */
  readonly keys: ReadonlySet<string>;
  /** The keys of the components by type, in lower case: `ApexClass` to `ApexClass:invoiceservice`. */
  readonly ofType: (type: string) => string[];
  /** `from -> to`, component to component, with the ways and the tiers the key names for the pair. */
  readonly pairs: ReadonlyMap<string, { from: string; to: string; via: Set<string>; tiers: Set<string> }>;
  readonly unreferenced: readonly string[];
  /** The names of the classes of the fixture project, in lower case, and as the key writes them. */
  readonly classes: ReadonlySet<string>;
  readonly classNames: readonly string[];
  /** The names of its custom objects and of its custom fields without the object, in lower case. */
  readonly objectNames: ReadonlySet<string>;
  readonly fieldNames: ReadonlySet<string>;
}

function readFixture(): Fixture {
  const key = answerKey();
  const components = Object.entries(key.components ?? {});
  const keys = new Set<string>(key.standard ?? []);
  for (const [type, names] of components) for (const name of names) keys.add(`${type}:${name.toLowerCase()}`);
  const pairs = new Map<string, { from: string; to: string; via: Set<string>; tiers: Set<string> }>();
  for (const file of key.references ?? []) {
    for (const member of file.members) {
      for (const ref of member.refs) {
        // The Dependency API knows components, not methods.
        const from = member.from.split('#')[0] ?? '';
        const to = ref.to.split('#')[0] ?? '';
        if (from === to) continue;
        const id = `${from} -> ${to}`;
        const pair = pairs.get(id) ?? { from, to, via: new Set<string>(), tiers: new Set<string>() };
        pair.via.add(ref.via);
        pair.tiers.add(ref.tier ?? 'confirmed');
        pairs.set(id, pair);
      }
    }
  }
  const lower = (type: string): string[] => (key.components?.[type] ?? []).map((name) => name.toLowerCase());
  const objectNames = new Set(lower('CustomObject'));
  return {
    keys,
    ofType: (type) => lower(type).map((name) => `${type}:${name}`),
    pairs,
    unreferenced: key.unreferenced ?? [],
    classes: new Set(lower('ApexClass')),
    classNames: key.components?.['ApexClass'] ?? [],
    objectNames,
    fieldNames: new Set(
      lower('CustomField')
        .map((name) => name.split('.')[1] ?? '')
        .filter((name) => name !== '' && !objectNames.has(name)),
    ),
  };
}

/** One side of a row of the Dependency API. */
interface Side {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly namespace: string;
}

/** A row of the Dependency API: a component, and a component it refers to. */
interface Dependency {
  readonly from: Side;
  readonly to: Side;
}

const dependency = (row: Row): Dependency => ({
  from: {
    type: text(row['MetadataComponentType']),
    id: short(row['MetadataComponentId']),
    name: text(row['MetadataComponentName']),
    namespace: text(row['MetadataComponentNamespace']),
  },
  to: {
    type: text(row['RefMetadataComponentType']),
    id: short(row['RefMetadataComponentId']),
    name: text(row['RefMetadataComponentName']),
    namespace: text(row['RefMetadataComponentNamespace']),
  },
});

const identity = ({ from, to }: Dependency): string =>
  [from.type, from.id, from.name, to.type, to.id, to.name].join('\u0000');

/**
 * Finds the key of the fixture project a side of a row stands for.
 *
 * The Dependency API names a field or a rule without its object, so the id decides where the org said what the
 * id belongs to. Without that, the name decides if one component of the fixture project has it. For a field or
 * a rule that is a guess: a field of another object can have the same name.
 */
function keyOf(
  side: Side,
  byId: ReadonlyMap<string, string>,
  fixture: Fixture,
): { key: string; guessed: boolean } | null {
  if (side.namespace !== '') return null;
  const known = byId.get(side.id);
  if (known !== undefined) return fixture.keys.has(known) ? { key: known, guessed: false } : null;
  const name = side.name.toLowerCase();
  if (side.type === 'StandardEntity') {
    const key = `CustomObject:${name}`;
    return fixture.keys.has(key) ? { key, guessed: false } : null;
  }
  const candidates = fixture.ofType(side.type).filter((key) => {
    const last =
      key
        .slice(key.indexOf(':') + 1)
        .split('.')
        .at(-1) ?? '';
    return last === name || last === `${name}__c`;
  });
  const [key] = candidates;
  return candidates.length === 1 && key !== undefined ? { key, guessed: key.includes('.') } : null;
}

/** Reads the names behind the ids of the rows: which object a field or a rule belongs to. */
async function namesBehindIds(
  log: PublicLog,
  session: OrgSession,
  counter: { requests: number },
): Promise<{ byId: Map<string, string>; failed: number }> {
  const byId = new Map<string, string>();
  const said: string[] = [];
  let failed = 0;
  const read = async (object: string, fields: string): Promise<Row[]> => {
    let asked = await ask(log, session, `SELECT ${fields} FROM ${object}`, counter);
    let note = '';
    if (asked.failed !== null) {
      // An object that has no field for the prefix of a package is read without it.
      const first = asked.failed;
      asked = await ask(log, session, `SELECT ${fields.replace(', NamespacePrefix', '')} FROM ${object}`, counter);
      if (asked.failed === null) note = ` without NamespacePrefix (${first})`;
    }
    said.push(
      `${object} ${asked.failed === null ? `${String(asked.rows.length)}${note}` : `failed (${asked.failed})`}`,
    );
    if (asked.failed !== null) failed += 1;
    return asked.failed === null ? asked.rows : [];
  };
  const prefixed = (row: Row, name: string): string => {
    const namespace = text(row['NamespacePrefix']);
    return namespace === '' ? name : `${namespace}__${name}`;
  };

  // A custom object, by its id. A field and a rule name their object by that id, or by the name of a standard object.
  const objects = new Map<string, string>();
  for (const row of await read('CustomObject', 'Id, DeveloperName, NamespacePrefix')) {
    const name = prefixed(row, `${text(row['DeveloperName'])}__c`);
    objects.set(short(row['Id']), name);
    byId.set(short(row['Id']), `CustomObject:${name.toLowerCase()}`);
  }
  const objectOf = (value: unknown): string => objects.get(short(value)) ?? text(value);
  for (const row of await read('CustomField', 'Id, DeveloperName, NamespacePrefix, TableEnumOrId')) {
    const name = prefixed(row, `${text(row['DeveloperName'])}__c`);
    byId.set(short(row['Id']), `CustomField:${`${objectOf(row['TableEnumOrId'])}.${name}`.toLowerCase()}`);
  }
  for (const row of await read('ValidationRule', 'Id, ValidationName, NamespacePrefix, EntityDefinitionId')) {
    const name = prefixed(row, text(row['ValidationName']));
    byId.set(short(row['Id']), `ValidationRule:${`${objectOf(row['EntityDefinitionId'])}.${name}`.toLowerCase()}`);
  }
  for (const type of ['ApexClass', 'ApexTrigger']) {
    for (const row of await read(type, 'Id, Name, NamespacePrefix')) {
      byId.set(short(row['Id']), `${type}:${prefixed(row, text(row['Name'])).toLowerCase()}`);
    }
  }
  log.say(`Rows read to find the names behind the ids: ${said.join(', ')}.`);
  return { byId, failed };
}

/**
 * The Dependency API. Returns `none` if it could not be asked at all, and `partly` if rows are missing or the
 * names behind the ids could not all be read.
 */
async function probeDependencies(
  log: PublicLog,
  session: OrgSession,
  fixture: Fixture,
  counter: { requests: number },
): Promise<'none' | 'partly' | 'whole'> {
  const shownType = (type: string): string => log.name(type) ?? '(a type that is not shown)';
  const base = `SELECT ${DEPENDENCY_FIELDS} FROM MetadataComponentDependency`;
  const rows = new Map<string, Dependency>();
  const keep = (asked: Asked): void => {
    for (const row of asked.rows) {
      const one = dependency(row);
      rows.set(identity(one), one);
    }
  };

  log.say('The Dependency API (MetadataComponentDependency)');
  const all = await ask(log, session, base, counter);
  keep(all);
  log.say(
    all.failed === null
      ? `One query without a filter: ${plural(all.rows.length, 'row', 'rows')} in ${plural(all.pages, 'page', 'pages')}.` +
          (all.rows.length >= CUT_OFF ? ` That is the limit of ${String(CUT_OFF)} rows: the org may hold more.` : '')
      : `One query without a filter failed (${all.failed}).`,
  );

  // Per type of the component that refers, and per pair of types where one type alone hits the limit.
  const seen = (pick: (one: Dependency) => string): string[] =>
    [...new Set([...rows.values()].map(pick))].filter((type) => TYPE_NAME.test(type));
  const lines: string[][] = [['TYPE THAT REFERS', 'ROWS', 'STATE']];
  let answered = all.failed === null;
  /** Whether the first query gave every row of the org. Then no later query can add a row. */
  const whole = all.failed === null && all.rows.length < CUT_OFF;
  let cutOff = 0;
  const quoted = (types: Iterable<string>): string => [...types].map((type) => `'${type}'`).join(', ');

  /** The rows of one type of component, per type of the target where the type alone is at the limit. */
  const askType = async (type: string): Promise<void> => {
    const ofType = await ask(log, session, `${base} WHERE MetadataComponentType = '${type}'`, counter);
    keep(ofType);
    // An answer that broke off after the limit is at the limit as well.
    const atLimit = ofType.rows.length >= CUT_OFF;
    if (ofType.failed !== null && !atLimit) {
      // The rows of the type are missing, unless the first query gave every row.
      if (!whole) cutOff += 1;
      lines.push([shownType(type), '', `failed (${ofType.failed})${whole ? '' : ': rows may be missing'}`]);
      return;
    }
    answered = true;
    if (!atLimit) {
      if (ofType.rows.length > 0) lines.push([shownType(type), String(ofType.rows.length), 'ok']);
      return;
    }
    lines.push([shownType(type), String(ofType.rows.length), 'at the limit, asked again per type of the target']);
    // The types of target the rows so far show, then whatever is of another type: the limit may hide a type.
    const asked = new Set<string>();
    let targets = seen((one) => one.to.type).sort();
    if (targets.length === 0) {
      cutOff += 1;
      lines.push(['  to a type', '', 'no type of a target is known: rows are missing']);
    }
    for (let round = 0; round < ROUNDS && targets.length > 0; round += 1) {
      for (const target of targets) {
        asked.add(target);
        const pair = await ask(
          log,
          session,
          `${base} WHERE MetadataComponentType = '${type}' AND RefMetadataComponentType = '${target}'`,
          counter,
        );
        keep(pair);
        if (pair.rows.length >= CUT_OFF) {
          cutOff += 1;
          lines.push([`  to ${shownType(target)}`, String(pair.rows.length), 'at the limit: rows are missing']);
        } else if (pair.failed !== null) {
          cutOff += 1;
          lines.push([`  to ${shownType(target)}`, '', `failed (${pair.failed}): rows are missing`]);
        } else if (pair.rows.length > 0) {
          lines.push([`  to ${shownType(target)}`, String(pair.rows.length), 'ok']);
        }
      }
      const others = await ask(
        log,
        session,
        `${base} WHERE MetadataComponentType = '${type}' AND RefMetadataComponentType NOT IN (${quoted(asked)})`,
        counter,
      );
      keep(others);
      targets = seen((one) => one.to.type)
        .filter((target) => !asked.has(target))
        .sort();
      if (others.failed !== null) {
        cutOff += 1;
        lines.push(['  to every other type', '', `failed (${others.failed}): rows may be missing`]);
        return;
      }
      if (others.rows.length < CUT_OFF) {
        if (others.rows.length > 0) lines.push(['  to every other type', String(others.rows.length), 'ok']);
        return;
      }
      if (targets.length === 0 || round === ROUNDS - 1) {
        cutOff += 1;
        lines.push(['  to every other type', String(others.rows.length), 'at the limit: rows are missing']);
      }
    }
  };

  // The types that are known to refer and the ones the first query shows, then whatever is of another type.
  const done = new Set<string>();
  let types = [...new Set([...REFERRING_TYPES, ...seen((one) => one.from.type)])].sort();
  for (let round = 0; round < ROUNDS && types.length > 0; round += 1) {
    for (const type of types) {
      done.add(type);
      await askType(type);
    }
    const others = await ask(log, session, `${base} WHERE MetadataComponentType NOT IN (${quoted(done)})`, counter);
    keep(others);
    types = seen((one) => one.from.type)
      .filter((type) => !done.has(type))
      .sort();
    if (others.failed !== null) {
      // Without this answer, a type that the first query does not show stays unseen.
      if (!whole) cutOff += 1;
      lines.push(['every other type', '', `failed (${others.failed})${whole ? '' : ': rows may be missing'}`]);
      break;
    }
    if (others.rows.length < CUT_OFF) {
      if (others.rows.length > 0) lines.push(['every other type', String(others.rows.length), 'ok']);
      break;
    }
    if (types.length === 0 || round === ROUNDS - 1) {
      cutOff += 1;
      lines.push(['every other type', String(others.rows.length), 'at the limit: rows are missing']);
    }
  }
  for (const line of table(lines)) log.say(line);
  if (!answered) {
    log.say('No query of the Dependency API was answered.');
    return 'none';
  }
  log.say(
    `Different rows in all: ${String(rows.size)}.` +
      (cutOff > 0
        ? ` ${plural(cutOff, 'query was', 'queries were')} cut off at the limit or failed, so rows are missing.`
        : ' No query was cut off or failed in a way that leaves a row out.'),
  );

  const { byId, failed: namesFailed } = await namesBehindIds(log, session, counter);

  // Every row, as a pair of keys of the fixture project where both sides are of it. A pair is "by name" if no
  // row gives it with ids the org said the objects of.
  const reported = new Map<string, { from: string; to: string; guessed: boolean }>();
  const outside = new Map<string, number>();
  let inside = 0;
  const sides = [...rows.values()].flatMap((one) => [one.from, one.to]);
  log.say(
    `Of the ${String(sides.length)} ends of the rows, the org gave a name for the id of ${String(sides.filter((side) => byId.has(side.id)).length)}.`,
  );
  for (const one of rows.values()) {
    const from = keyOf(one.from, byId, fixture);
    const to = keyOf(one.to, byId, fixture);
    if (from !== null && to !== null) {
      inside += 1;
      const id = `${from.key} -> ${to.key}`;
      const guessed = (from.guessed || to.guessed) && (reported.get(id)?.guessed ?? true);
      reported.set(id, { from: from.key, to: to.key, guessed });
    } else {
      const pair = `${shownType(one.from.type)} to ${shownType(one.to.type)}`;
      outside.set(pair, (outside.get(pair) ?? 0) + 1);
    }
  }
  log.say(
    `Rows between two components of the fixture project: ${String(inside)}, which are ${plural(reported.size, 'pair', 'pairs')}. Rows with a component that is not of it: ${String(rows.size - inside)}.`,
  );
  if (outside.size > 0) {
    log.say(
      `The rows with a component that is not of the fixture project, by type: ${[...outside]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pair, count]) => `${pair} ${String(count)}`)
        .join(', ')}`,
    );
  }

  // The answer key against the rows.
  const typeOf = (key: string): string => key.slice(0, key.indexOf(':'));
  const kindOf = (key: string): string =>
    `${typeOf(key)}${fixture.ofType(typeOf(key)).includes(key) ? '' : ' (of Salesforce)'}`;
  const expected = [...fixture.pairs].sort(([a], [b]) => a.localeCompare(b));
  const sure = (id: string): boolean => reported.get(id)?.guessed === false;
  const found = expected.filter(([id]) => sure(id));
  const byName = expected.filter(([id]) => reported.get(id)?.guessed === true);
  log.say('');
  log.say(
    `The answer key holds ${String(expected.length)} pairs of a component and a component it refers to. The Dependency API reports ${String(found.length)} of them.` +
      (byName.length > 0
        ? ` ${String(byName.length)} more are matched by the name of a field or of a rule alone, because the org gave no object for the id. They are marked "by name" and not counted as reported.`
        : ''),
  );
  const tally = (group: (pair: { from: string; to: string; via: Set<string>; tiers: Set<string> }) => string[]) => {
    const groups = new Map<string, { inKey: number; reported: number }>();
    for (const [id, pair] of expected) {
      for (const name of group(pair)) {
        const one = groups.get(name) ?? { inKey: 0, reported: 0 };
        one.inKey += 1;
        if (sure(id)) one.reported += 1;
        groups.set(name, one);
      }
    }
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, one]) => [name, String(one.inKey), String(one.reported)]);
  };
  for (const line of table([
    ['FROM', 'TO', 'IN THE KEY', 'REPORTED'],
    ...tally((pair) => [`${kindOf(pair.from)}\u0000${kindOf(pair.to)}`]).map(([name = '', ...counts]) => [
      ...name.split('\u0000'),
      ...counts,
    ]),
  ])) {
    log.say(line);
  }
  log.say('By the way the source names the target. A pair is counted under every way the key has for it:');
  for (const line of table([['WAY', 'IN THE KEY', 'REPORTED'], ...tally((pair) => [...pair.via])])) log.say(line);
  log.say('By the best tier the key gives a reference of the pair:');
  const best = (tiers: Set<string>): string =>
    ['confirmed', 'probable', 'possible'].find((tier) => tiers.has(tier)) ?? 'unknown';
  for (const line of table([['TIER', 'IN THE KEY', 'REPORTED'], ...tally((pair) => [best(pair.tiers)])])) log.say(line);

  log.say('');
  log.say('Every pair of the answer key:');
  for (const [id, pair] of expected.slice(0, SHOWN)) {
    const state = sure(id) ? 'reported' : reported.has(id) ? 'by name ' : 'missing ';
    log.say(`- ${state}  ${id}  (${[...pair.via].sort().join(', ')})`);
  }
  if (expected.length > SHOWN) log.say(`- and ${String(expected.length - SHOWN)} more pairs.`);

  const extra = [...reported.keys()].filter((id) => !fixture.pairs.has(id)).sort();
  log.say('');
  log.say(`Pairs the Dependency API reports that the answer key does not hold: ${String(extra.length)}.`);
  for (const id of extra.slice(0, SHOWN)) log.say(`- ${id}${sure(id) ? '' : '  (by name)'}`);
  if (extra.length > SHOWN) log.say(`- and ${String(extra.length - SHOWN)} more pairs.`);

  const used = fixture.unreferenced.filter((key) => [...reported.values()].some((pair) => pair.to === key));
  log.say(
    `Fields the answer key calls unreferenced: ${String(fixture.unreferenced.length)}. The Dependency API reports a reference to ${String(used.length)} of them${used.length > 0 ? `: ${used.join(', ')}` : ''}.`,
  );
  return cutOff > 0 || namesFailed > 0 ? 'partly' : 'whole';
}

/** How many entries the arrays named `references` hold, anywhere in a value. */
function referencesIn(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((sum, one) => sum + referencesIn(one), 0);
  if (typeof value !== 'object' || value === null) return 0;
  let sum = 0;
  for (const [name, inner] of Object.entries(value)) {
    sum += name === 'references' && Array.isArray(inner) ? inner.length : referencesIn(inner);
  }
  return sum;
}

/** Every text in a value, with the names of the fields that lead to it: `methods.parameters.type`. */
function* textsIn(value: unknown, path: string): Generator<{ path: string; text: string }> {
  if (typeof value === 'string') {
    yield { path, text: value };
  } else if (Array.isArray(value)) {
    for (const one of value) yield* textsIn(one, path);
  } else if (typeof value === 'object' && value !== null) {
    for (const [name, inner] of Object.entries(value)) yield* textsIn(inner, path === '' ? name : `${path}.${name}`);
  }
}

/** The symbol tables of the compiler. Returns false if they could not be asked for. */
async function probeSymbolTables(
  log: PublicLog,
  session: OrgSession,
  fixture: Fixture,
  counter: { requests: number },
): Promise<boolean> {
  const words = fixtureWords();
  /** A text of a symbol table of a class of the fixture project, if every word of it is one of the project or of Apex. */
  const shown = (value: unknown): string => {
    const said = text(value);
    const safe =
      /^[A-Za-z0-9_.<>,()[\] ]{1,120}$/.test(said) &&
      log.clean(said) &&
      (said.match(WORD) ?? []).every((word) => words.has(word.toLowerCase()) || PLATFORM_WORDS.has(word.toLowerCase()));
    return safe ? said : '(not shown)';
  };
  const list = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
  const path = (value: string): string =>
    value
      .split('.')
      .map((part) => log.name(part) ?? '(a field that is not shown)')
      .join('.');

  log.say('');
  log.say('The symbol tables of the compiler (ApexClass.SymbolTable)');
  const started = Date.now();
  // Only the classes that have a name of the fixture project are asked for: the org holds classes of its own.
  const select = 'SELECT Id, Name, NamespacePrefix, SymbolTable FROM ApexClass';
  const named = fixture.classNames.filter((name) => /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name));
  let asked = await ask(
    log,
    session,
    `${select} WHERE Name IN (${named.map((name) => `'${name}'`).join(', ')})`,
    counter,
  );
  let which = 'Classes with a name of the fixture project';
  if (asked.failed !== null) {
    log.say(`The query for the classes by their names failed (${asked.failed}). Every class of the org is asked for.`);
    asked = await ask(log, session, select, counter);
    which = 'Classes';
  }
  if (asked.failed !== null) {
    log.say(`The classes could not be read with their symbol tables (${asked.failed}).`);
    return false;
  }
  const ours = asked.rows.filter(
    (row) => text(row['NamespacePrefix']) === '' && fixture.classes.has(text(row['Name']).toLowerCase()),
  );
  const withTable = (rows: readonly Row[]): number =>
    rows.filter((row) => typeof row['SymbolTable'] === 'object' && row['SymbolTable'] !== null).length;
  log.say(
    `${which}: ${String(asked.rows.length)} in ${plural(asked.pages, 'page', 'pages')}, after ${((Date.now() - started) / 1000).toFixed(1)} s. With a symbol table: ${String(withTable(asked.rows))}.`,
  );
  log.say(
    `Classes of the fixture project: ${String(fixture.classes.size)}. Found: ${String(ours.length)}. With a symbol table: ${String(withTable(ours))}.`,
  );

  const fields = new Set<string>();
  const places = new Map<string, { objects: number; fields: number; example: string }>();
  const signatures: string[] = [];
  const external: string[] = [];
  let references = 0;
  const counts: string[][] = [
    ['CLASS', 'METHODS', 'CONSTRUCTORS', 'PROPERTIES', 'VARIABLES', 'INNER', 'EXTERNAL', 'REFERENCES'],
  ];
  for (const row of [...ours].sort((a, b) => text(a['Name']).localeCompare(text(b['Name'])))) {
    const name = shown(row['Name']);
    const symbols = row['SymbolTable'];
    if (typeof symbols !== 'object' || symbols === null) {
      counts.push([name, 'no symbol table']);
      continue;
    }
    const symbolTable = symbols as Row;
    for (const field of Object.keys(symbolTable)) fields.add(log.name(field) ?? '(a field that is not shown)');
    const inside = referencesIn(symbolTable);
    references += inside;
    counts.push([
      name,
      ...['methods', 'constructors', 'properties', 'variables', 'innerClasses', 'externalReferences'].map((field) =>
        String(list(symbolTable[field]).length),
      ),
      String(inside),
    ]);
    for (const method of list(symbolTable['methods'])) {
      const parameters = list(method['parameters']).map((parameter) => shown(parameter['type']));
      signatures.push(`- ${name}.${shown(method['name'])}(${parameters.join(', ')}): ${shown(method['returnType'])}`);
    }
    for (const reference of list(symbolTable['externalReferences'])) {
      external.push(
        `- ${name} to ${shown(reference['name'])}: methods ${String(list(reference['methods']).length)}, variables ${String(list(reference['variables']).length)}, places ${String(referencesIn(reference))}`,
      );
    }
    for (const one of textsIn(symbolTable, '')) {
      const named = (one.text.match(WORD) ?? []).map((word) => word.toLowerCase());
      const object = named.some((word) => fixture.objectNames.has(word));
      const field = named.some((word) => fixture.fieldNames.has(word));
      if (!object && !field) continue;
      const place = places.get(one.path) ?? { objects: 0, fields: 0, example: shown(one.text) };
      if (field) place.fields += 1;
      else place.objects += 1;
      places.set(one.path, place);
    }
  }
  for (const line of table(counts)) log.say(line);
  log.say(`Fields of a symbol table: ${[...fields].sort().join(', ') || 'none'}.`);
  log.say(
    `Places of use the symbol tables hold (entries of "references"): ${String(references)}. External references: ${String(external.length)}.`,
  );
  for (const line of external.slice(0, SHOWN)) log.say(line);

  const inFields = [...places.values()].reduce((sum, place) => sum + place.fields, 0);
  const inObjects = [...places.values()].reduce((sum, place) => sum + place.objects, 0);
  log.say(
    `Texts in the symbol tables that name a custom field of the fixture project: ${String(inFields)}. That name one of its custom objects and no field: ${String(inObjects)}.`,
  );
  for (const [place, found] of [...places].sort(([a], [b]) => a.localeCompare(b))) {
    log.say(
      `- ${path(place)}: ${String(found.fields)} with a field, ${String(found.objects)} with an object only, for example ${found.example}`,
    );
  }
  log.say(`How the compiler writes the methods (${String(signatures.length)}):`);
  for (const line of signatures.slice(0, SHOWN)) log.say(line);
  if (signatures.length > SHOWN) log.say(`- and ${String(signatures.length - SHOWN)} more methods.`);

  // A trigger is said to have no symbol table at all.
  const triggers = await ask(log, session, 'SELECT Id, Name, SymbolTable FROM ApexTrigger', counter);
  log.say(
    triggers.failed === null
      ? `Triggers asked for with a symbol table: ${String(triggers.rows.length)}. With one: ${String(withTable(triggers.rows))}.`
      : `Triggers cannot be asked for with a symbol table (${triggers.failed}).`,
  );
  return true;
}

export async function probeOrg(
  log: PublicLog,
  options: { env?: Readonly<Record<string, string | undefined>> } = {},
): Promise<void> {
  const env = loginEnvironment(log, options.env);
  if (env === undefined) return;

  let session: OrgSession;
  try {
    session = await connectToOrg(SOURCE, undefined, env);
  } catch (error) {
    log.fail(failureLines(log, 'The test org was not asked, because the login to it failed', error));
    return;
  }
  log.forbid(session.instanceUrl, session.orgId, session.orgId.slice(0, 15), session.username);

  const fixture = readFixture();
  const counter = { requests: 0 };
  const dependencies = await probeDependencies(log, session, fixture, counter);
  const symbols = await probeSymbolTables(log, session, fixture, counter);
  log.say('');
  log.say(
    `Requests to the Tooling API: ${String(counter.requests)}. A request the library sent again after an error is counted once.`,
  );
  if (dependencies === 'none' || !symbols) {
    log.fail([
      `The org did not answer ${dependencies === 'none' && !symbols ? 'either of the two' : dependencies === 'none' ? 'the Dependency API' : 'the query for the symbol tables'}. The codes above say why.`,
    ]);
  } else if (dependencies === 'partly') {
    log.say(
      '::warning::What the Dependency API gave is not whole: rows are missing, or the names behind the ids could not all be read. The lines above say which. The number of pairs it reports is a lower bound.',
    );
  }
}

if (import.meta.main) await asStep(import.meta.filename, probeOrg);
