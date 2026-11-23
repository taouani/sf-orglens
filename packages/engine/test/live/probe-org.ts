/**
 * A step of the live-org workflow: asks the test org for the two things
 * Salesforce itself knows about references, and says how much of the answer
 * key of the fixture project each of them reports.
 *
 * - The Dependency API: the rows of `MetadataComponentDependency`. They
 *   are read by the reader of the engine (`sources/dependency-api.ts`),
 *   which this tool held until it moved there. The names behind the ids of
 *   the rows are read here, from objects of the Tooling API. The engine
 *   takes them from what the org listed for a snapshot, which this tool
 *   does not take: so the two find the components of a row in two ways.
 * - The symbol tables of the compiler: `ApexClass.SymbolTable`, as the org
 *   holds it for a class that is saved.
 *
 * With the first it says what the org holds of the flows of the fixture
 * project: how many versions each has, which one is active and which one is
 * the latest (`FlowDefinition` and `Flow`), and whether the id on a row of
 * the Dependency API from a flow is the id of a version or of the
 * definition. The tool that deploys can send one flow once more as a
 * draft (`deploy-fixture.ts draft`). After that, the flow should have an
 * active version and a newer one, which is not verified.
 *
 * All of it is read through the Tooling API, whose objects describe metadata.
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
import { readDependencies, type DependencyEnd, type DependencyRow } from '../../src/sources/dependency-api.ts';
import { connectToOrg, type OrgSession } from '../../src/sources/org.ts';
import { codeOf, DRAFT_ONLY_FIELD, fixtureWords, FLOW_WITH_DRAFT, PLATFORM_WORDS } from './deploy-fixture.ts';
import { asStep } from './own-output.ts';
import type { PublicLog } from './public-log.ts';
import { answerKey, failureLines, loginEnvironment, SOURCE } from './test-org.ts';

/** The query for the symbol tables can take long. */
const REQUEST = { timeout: 180_000 } as const;
/** No query is followed over more pages than this. */
const PAGES = 400;
/** At most this many lines are printed of one list, except of the pairs of the answer key. */
const SHOWN = 200;

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
  /** The names of its flows, as the key writes them. */
  readonly flowNames: readonly string[];
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
    flowNames: key.components?.['Flow'] ?? [],
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

const side = (end: DependencyEnd): Side => ({
  type: end.type,
  id: short(end.id),
  name: end.name,
  namespace: end.namespace ?? '',
});
const dependency = (row: DependencyRow): Dependency => ({ from: side(row.from), to: side(row.to) });

/**
 * Finds the key of the fixture project a side of a row stands for.
 *
 * The Dependency API names a field or a rule without its object, so the id decides where the org said what the
 * id belongs to. Without that, the name decides if one component of the fixture project has it. For a field, a
 * rule or an email template that is a guess: another object or folder can hold the same name. A key that rests
 * on the name of a custom object whose ending the org did not give (`built`) is a guess as well.
 */
function keyOf(side: Side, { byId, built }: Names, fixture: Fixture): { key: string; guessed: boolean } | null {
  if (side.namespace !== '') return null;
  const known = byId.get(side.id);
  if (known !== undefined) return fixture.keys.has(known) ? { key: known, guessed: built.has(side.id) } : null;
  const name = side.name.toLowerCase();
  if (side.type === 'StandardEntity') {
    const key = `CustomObject:${name}`;
    return fixture.keys.has(key) ? { key, guessed: false } : null;
  }
  // A record of a custom metadata type. The type of such a row is the name of the custom metadata type: run 8
  // of 15 November 2026 matched the record of the fixture project that way, after run 7 had printed the type as
  // one that is not shown. Whether the name of the row holds the type before a dot was not seen, so both are
  // read. The second way, the type `CustomMetadata` with the full name, was not seen in a run and is kept in
  // case another version of the API writes it.
  // Either way the type and the record together name one record, so this is not a guess by a name alone.
  const recordType = /^([a-z][a-z0-9_]*)__mdt$/.exec(side.type.toLowerCase())?.[1];
  if (recordType !== undefined) {
    const [first = '', second, ...more] = name.split('.');
    const record = second === undefined ? first : first === recordType && more.length === 0 ? second : null;
    const key = `CustomMetadata:${recordType}.${record ?? ''}`;
    return record !== null && fixture.keys.has(key) ? { key, guessed: false } : null;
  }
  if (side.type === 'CustomMetadata' && name.includes('.')) {
    const key = `CustomMetadata:${name}`;
    return fixture.keys.has(key) ? { key, guessed: false } : null;
  }
  // The whole name, with its object or its folder, if the row writes it so: that names one component.
  const whole = `${side.type}:${name}`;
  if (/[./]/.test(name) && fixture.ofType(side.type).includes(whole)) return { key: whole, guessed: false };
  const candidates = fixture.ofType(side.type).filter((key) => {
    // The name of a field without its object, and of a template without its folder.
    const last =
      key
        .slice(key.indexOf(':') + 1)
        .split(/[./]/)
        .at(-1) ?? '';
    return last === name || last === `${name}__c`;
  });
  const [key] = candidates;
  // A name without its object or its folder is a guess: another object or folder can hold the same name.
  return candidates.length === 1 && key !== undefined ? { key, guessed: /[./]/.test(key) } : null;
}

/** The name of the object of a row, as the org writes it, where the row was asked for with it. */
const OBJECT_NAME = 'EntityDefinition.QualifiedApiName';
const objectName = (row: Row): string => {
  const entity = row['EntityDefinition'];
  return typeof entity === 'object' && entity !== null ? text((entity as Row)['QualifiedApiName']) : '';
};
/** The codes an org refuses a query with because of a field it does not have. Only then is the field left out. */
const FIELD_REFUSED: ReadonlySet<string> = new Set(['INVALID_FIELD', 'MALFORMED_QUERY']);

/** A flow as the org holds it: its name, and the ids of its active and of its latest version, or an empty text. */
interface FlowDefinition {
  readonly name: string;
  readonly active: string;
  readonly latest: string;
}

/** One version of a flow: the id of its flow, its number and its state. */
interface FlowVersion {
  readonly definition: string;
  readonly number: number | null;
  readonly status: string;
}

/** The flows of the org and their versions, each by its id. */
interface Flows {
  readonly definitions: ReadonlyMap<string, FlowDefinition>;
  readonly versions: ReadonlyMap<string, FlowVersion>;
  /** Whether the org answered the query for the flows (`FlowDefinition`) and the one for their versions (`Flow`). */
  readonly definitionsRead: boolean;
  readonly versionsRead: boolean;
}

/** The names behind the ids of the rows. */
interface Names {
  /**
   * The key of a component by its id. A flow is found by the id of its definition and by the id of each version:
   * the active and the latest one as the definition names them, and the others where the versions could be read.
   */
  readonly byId: ReadonlyMap<string, string>;
  readonly flows: Flows;
  /** The ids whose key rests on the name of a custom object that is built with `__c`: a guess about the ending. */
  readonly built: ReadonlySet<string>;
  /** How many of the reads failed, or gave no name of the object where one was asked for. */
  readonly failed: number;
}

/**
 * Reads the names behind the ids of the rows: which object a field or a rule belongs to.
 *
 * The row of a custom object holds its name without the ending: `Invoice` for `Invoice__c`, and `Billing_Rule`
 * for the custom metadata type `Billing_Rule__mdt`. So a field and a rule are asked for with the name of their
 * object, and that name is taken for the custom object. The test org accepted that in both queries and named
 * all 5 of its custom objects (run 8 of 15 November 2026). The log does not say whether a name came from a
 * field, from a rule or from both. Where an org refuses it, the rows are read without it. A custom object that
 * no field and no rule names gets the ending `__c`, and every key that rests on such a name is a guess.
 */
async function namesBehindIds(log: PublicLog, session: OrgSession, counter: { requests: number }): Promise<Names> {
  const byId = new Map<string, string>();
  const said: string[] = [];
  let failed = 0;
  /**
   * Reads the rows of an object. A field that not every org or object has is left out when the org refuses the
   * query for a field: first the prefix of a package, then the name of the object, then both.
   */
  const read = async (object: string, fields: string, withObjectName = false): Promise<Row[]> => {
    const bare = fields.replace(', NamespacePrefix', '');
    const all: (readonly [select: string, without: string])[] = withObjectName
      ? [
          [`${fields}, ${OBJECT_NAME}`, ''],
          [`${bare}, ${OBJECT_NAME}`, ' without NamespacePrefix'],
          [fields, ' without the name of the object'],
          [bare, ' without NamespacePrefix and the name of the object'],
        ]
      : [
          [fields, ''],
          [bare, ' without NamespacePrefix'],
        ];
    // A query that asks for no prefix of a package is not asked a second time without one.
    const tries = all.filter(([select], index) => all.findIndex(([other]) => other === select) === index);
    let first: string | null = null;
    for (const [select, without] of tries) {
      const asked = await ask(log, session, `SELECT ${select} FROM ${object}`, counter);
      if (asked.failed === null) {
        said.push(`${object} ${String(asked.rows.length)}${first === null ? '' : `${without} (${first})`}`);
        // Without the name of the object, a custom metadata type and its fields cannot be matched.
        if (withObjectName && !select.includes(OBJECT_NAME)) failed += 1;
        return asked.rows;
      }
      first ??= asked.failed;
      // A failure that is not about a field is not answered by asking for less.
      if (!FIELD_REFUSED.has(asked.failed)) {
        first = asked.failed;
        break;
      }
    }
    said.push(`${object} failed (${first ?? 'NO_CODE'})`);
    failed += 1;
    return [];
  };
  const prefixed = (row: Row, name: string): string => {
    const namespace = text(row['NamespacePrefix']);
    return namespace === '' ? name : `${namespace}__${name}`;
  };

  // A custom object, by its id. A field and a rule name their object by that id, or by the name of a standard object.
  const objects = new Map<string, string>();
  /** The name of a custom object without its ending, in lower case, to check what a field or a rule says. */
  const bases = new Map<string, string>();
  for (const row of await read('CustomObject', 'Id, DeveloperName, NamespacePrefix')) {
    const base = prefixed(row, text(row['DeveloperName']));
    objects.set(short(row['Id']), `${base}__c`);
    bases.set(short(row['Id']), base.toLowerCase());
  }
  const fields = await read('CustomField', 'Id, DeveloperName, NamespacePrefix, TableEnumOrId', true);
  const rules = await read('ValidationRule', 'Id, ValidationName, NamespacePrefix, EntityDefinitionId', true);

  // The names the fields and the rules of a custom object give for it. A name is taken if it is the only one
  // and is the name without the ending, two underscores and an ending.
  const given = new Map<string, Set<string>>();
  const says = (row: Row, object: unknown): void => {
    const id = short(object);
    const name = objectName(row);
    if (name === '' || !bases.has(id)) return;
    given.set(id, (given.get(id) ?? new Set<string>()).add(name));
  };
  for (const row of fields) says(row, row['TableEnumOrId']);
  for (const row of rules) says(row, row['EntityDefinitionId']);
  const named = new Set<string>();
  for (const [id, names] of given) {
    const [name = '', ...others] = names;
    const base = bases.get(id) ?? '';
    const lower = name.toLowerCase();
    if (others.length > 0 || !lower.startsWith(`${base}__`) || !/^[a-z0-9]+$/.test(lower.slice(base.length + 2))) {
      continue;
    }
    objects.set(id, name);
    named.add(id);
  }

  // A key that rests on a name that is built is a guess: the object, and its fields and rules.
  const built = new Set<string>();
  const objectOf = (id: string, value: unknown): string => {
    const object = short(value);
    if (objects.has(object) && !named.has(object)) built.add(id);
    return objects.get(object) ?? text(value);
  };
  for (const [id, name] of objects) {
    byId.set(id, `CustomObject:${name.toLowerCase()}`);
    if (!named.has(id)) built.add(id);
  }
  for (const row of fields) {
    const id = short(row['Id']);
    const name = prefixed(row, `${text(row['DeveloperName'])}__c`);
    byId.set(id, `CustomField:${`${objectOf(id, row['TableEnumOrId'])}.${name}`.toLowerCase()}`);
  }
  for (const row of rules) {
    const id = short(row['Id']);
    const name = prefixed(row, text(row['ValidationName']));
    byId.set(id, `ValidationRule:${`${objectOf(id, row['EntityDefinitionId'])}.${name}`.toLowerCase()}`);
  }
  for (const type of ['ApexClass', 'ApexTrigger']) {
    for (const row of await read(type, 'Id, Name, NamespacePrefix')) {
      byId.set(short(row['Id']), `${type}:${prefixed(row, text(row['Name'])).toLowerCase()}`);
    }
  }
  // A flow. The org holds the flow and each of its versions as rows of their own, and a row of the Dependency
  // API can carry the id of either. Both are read as the Tooling API was documented when this was written. Whether
  // the test org answers the two queries is for the run to say: a query it refuses is said and counted.
  const definitions = new Map<string, FlowDefinition>();
  const versions = new Map<string, FlowVersion>();
  let before = failed;
  for (const row of await read(
    'FlowDefinition',
    'Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId',
  )) {
    const id = short(row['Id']);
    const name = prefixed(row, text(row['DeveloperName']));
    const flow = { name, active: short(row['ActiveVersionId']), latest: short(row['LatestVersionId']) };
    definitions.set(id, flow);
    // The two versions the flow names are found without the query for the versions, which the org may refuse.
    for (const one of [id, flow.active, flow.latest]) if (one !== '') byId.set(one, `Flow:${name.toLowerCase()}`);
  }
  const definitionsRead = failed === before;
  before = failed;
  for (const row of await read('Flow', 'Id, DefinitionId, VersionNumber, Status')) {
    const id = short(row['Id']);
    const definition = short(row['DefinitionId']);
    const number = row['VersionNumber'];
    versions.set(id, { definition, number: typeof number === 'number' ? number : null, status: text(row['Status']) });
    const flow = definitions.get(definition);
    if (flow !== undefined) byId.set(id, `Flow:${flow.name.toLowerCase()}`);
  }
  const flows: Flows = { definitions, versions, definitionsRead, versionsRead: failed === before };
  log.say(`Rows read to find the names behind the ids: ${said.join(', ')}.`);
  if (objects.size > 0) {
    const others = objects.size - named.size;
    const unfit = [...given.keys()].filter((id) => !named.has(id)).length;
    log.say(
      `Custom objects: ${String(objects.size)}. A field or a rule of the object gave the name of ${String(named.size)}.` +
        (others > 0
          ? ` ${others === 1 ? 'The name of the other one is' : `The names of the other ${String(others)} are`} built with the ending __c, which is a guess: a custom metadata type ends in __mdt. A pair that rests on such a name is marked "by name".`
          : '') +
        (unfit > 0
          ? ` For ${String(unfit)} of them the org gave a name that does not fit the object, or more than one name.`
          : ''),
    );
  }
  return { byId, flows, built, failed };
}

/** What was read of the Dependency API: the different rows, the names behind their ids, and the pairs they are. */
interface Probed {
  /** `none` if the API could not be asked at all, `partly` if rows are missing or names could not all be read. */
  readonly state: 'none' | 'partly' | 'whole';
  readonly rows: readonly Dependency[];
  readonly names: Names | null;
}

/** The Dependency API. */
async function probeDependencies(
  log: PublicLog,
  session: OrgSession,
  fixture: Fixture,
  counter: { requests: number },
): Promise<Probed> {
  // A type that is not the name of a metadata type is not shown, with two exceptions that say how the API
  // writes a record of a custom metadata type (`keyOf`): the name of a custom metadata type of the fixture
  // project is shown, and of any other type it is said whether it ends in `__mdt`.
  const shownType = (type: string): string => {
    const shown = log.name(type);
    if (shown !== null) return shown;
    const lower = type.toLowerCase();
    if (!lower.endsWith('__mdt')) return '(a type that is not shown)';
    return fixture.objectNames.has(lower) && log.clean(lower)
      ? `${lower} (a custom metadata type of the fixture project)`
      : '(a type that is not shown, and ends in __mdt)';
  };
  log.say('The Dependency API (MetadataComponentDependency)');
  const reading = await readDependencies(session);
  counter.requests += reading.requests;
  if (reading.state === 'none') {
    log.say(`No query of the Dependency API was answered (${log.code(reading.code) ?? 'a code that is not shown'}).`);
    return { state: 'none', rows: [], names: null };
  }
  // The same component can stand in two rows with its id in two lengths.
  const rows = new Map<string, Dependency>();
  for (const row of reading.rows) {
    const one = dependency(row);
    const { from, to } = one;
    rows.set([from.type, from.id, from.name, to.type, to.id, to.name].join('\u0000'), one);
  }
  const cutOff = reading.cutOff + reading.failed;
  const code = log.code(reading.code);
  log.say(`The reader of the engine sent ${plural(reading.requests, 'request', 'requests')}.`);
  log.say(
    `Different rows in all: ${String(rows.size)}.` +
      (cutOff > 0
        ? ` ${plural(cutOff, 'query was', 'queries were')} cut off at the limit or failed${code === null ? '' : ` (${code})`}, so rows are missing.`
        : ' No query was cut off or failed in a way that leaves a row out.'),
  );

  const names = await namesBehindIds(log, session, counter);
  const { byId, failed: namesFailed } = names;

  // Every row, as a pair of keys of the fixture project where both sides are of it. A pair is "by name" if no
  // row gives it with ids the org said the objects of, in full.
  const reported = new Map<string, { from: string; to: string; guessed: boolean }>();
  const outside = new Map<string, number>();
  let inside = 0;
  const sides = [...rows.values()].flatMap((one) => [one.from, one.to]);
  log.say(
    `Of the ${String(sides.length)} ends of the rows, the org gave a name for the id of ${String(sides.filter((side) => byId.has(side.id)).length)}.`,
  );
  for (const one of rows.values()) {
    const from = keyOf(one.from, names, fixture);
    const to = keyOf(one.to, names, fixture);
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
        ? ` ${String(byName.length)} more are matched by a name alone: the name of a component of a type this step reads no ids for, such as an email template, a part of the workflow rules of an object, a record type or a field set, or the name of a field or of a rule whose object the org did not give, or of a custom object whose ending it did not give. They are marked "by name" and not counted as reported.`
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
  // The list is not cut off: the key is written by hand, so it is of a known length, and a pair that is left out
  // is a pair nobody can read the answer of Salesforce for.
  log.say('Every pair of the answer key:');
  for (const [id, pair] of expected) {
    const state = sure(id) ? 'reported' : reported.has(id) ? 'by name ' : 'missing ';
    log.say(`- ${state}  ${id}  (${[...pair.via].sort().join(', ')})`);
  }

  const extra = [...reported.keys()].filter((id) => !fixture.pairs.has(id)).sort();
  log.say('');
  log.say(`Pairs the Dependency API reports that the answer key does not hold: ${String(extra.length)}.`);
  for (const id of extra.slice(0, SHOWN)) log.say(`- ${id}${sure(id) ? '' : '  (by name)'}`);
  if (extra.length > SHOWN) log.say(`- and ${String(extra.length - SHOWN)} more pairs.`);

  const used = fixture.unreferenced.filter((key) => [...reported.values()].some((pair) => pair.to === key));
  log.say(
    `Fields the answer key calls unreferenced: ${String(fixture.unreferenced.length)}. The Dependency API reports a reference to ${String(used.length)} of them${used.length > 0 ? `: ${used.join(', ')}` : ''}.`,
  );
  return { state: cutOff > 0 || namesFailed > 0 ? 'partly' : 'whole', rows: [...rows.values()], names };
}

/**
 * The flows of the fixture project as the org holds them, and what the id on a row of the Dependency API from
 * or to a flow stands for: a version of a flow, or the flow.
 *
 * A row about a flow that is not of the fixture project is counted and not named.
 */
function probeFlows(log: PublicLog, fixture: Fixture, { rows, names }: Probed): void {
  if (names === null) return;
  const { definitions, versions, definitionsRead, versionsRead } = names.flows;
  log.say('');
  log.say('The flows of the fixture project and their versions (FlowDefinition and Flow)');
  if (!definitionsRead || !versionsRead) {
    log.say(
      (definitionsRead
        ? 'The org did not answer the query for the versions of its flows (Flow). Of a flow, only the ids of its active and of its latest version are known, and neither a number nor a state.'
        : versionsRead
          ? 'The org did not answer the query for its flows (FlowDefinition). No version can be given to a flow, so nothing is said about the flows of the fixture project.'
          : 'The org answered neither the query for its flows (FlowDefinition) nor the one for their versions (Flow). Nothing is known about the flows of the fixture project.') +
        ' The line about the rows read to find the names has the code.',
    );
  }
  const state = (version: FlowVersion | undefined): string =>
    version === undefined ? 'unknown' : (log.name(version.status) ?? 'a state that is not shown');
  const numbered = (version: FlowVersion | undefined): string =>
    version?.number === null || version === undefined ? 'unknown' : String(version.number);
  /** The flows of the fixture project the org holds, by the id of the definition. A flow of a package has a prefix. */
  const ours = new Map<string, string>();
  const lines: string[][] = [['FLOW', 'VERSIONS', 'ACTIVE', 'LATEST', 'STATE OF THE LATEST']];
  for (const name of fixture.flowNames) {
    const found = [...definitions].find(([, flow]) => flow.name.toLowerCase() === name.toLowerCase());
    if (found === undefined) {
      lines.push([name, definitionsRead ? 'not in the org' : 'unknown']);
      continue;
    }
    const [id, flow] = found;
    ours.set(id, name);
    const count = [...versions.values()].filter((version) => version.definition === id).length;
    lines.push([
      name,
      versionsRead ? String(count) : 'unknown',
      flow.active === '' ? 'none' : numbered(versions.get(flow.active)),
      flow.latest === '' ? 'none' : numbered(versions.get(flow.latest)),
      flow.latest === '' ? '' : state(versions.get(flow.latest)),
    ]);
  }
  for (const line of table(lines)) log.say(line);
  log.say(
    `Flows the org holds: ${definitionsRead ? String(definitions.size) : 'unknown'}, with ${versionsRead ? plural(versions.size, 'version', 'versions') : 'a number of versions that is not known'}. Of the fixture project: ${definitionsRead ? String(ours.size) : 'unknown'} of ${String(fixture.flowNames.length)}.`,
  );

  // The flow a version is of, where a row of the versions or the flow itself says so.
  const flowOf = (id: string): string | undefined =>
    versions.get(id)?.definition ?? [...definitions].find(([, flow]) => flow.active === id || flow.latest === id)?.[0];
  /**
   * What the id of a row stands for. Which version is the active one, the flow says. Where the flows could not
   * be read, the state of the version says it: only the active version of a flow has the state `Active`.
   */
  const standsFor = (id: string): string => {
    if (definitions.has(id)) return 'a flow, not a version';
    const version = versions.get(id);
    const flow = flowOf(id);
    const active = flow === undefined ? undefined : definitions.get(flow)?.active;
    if (active === id || (active === undefined && version?.status === 'Active')) return 'the active version of a flow';
    if (version !== undefined) return `a version that is not the active one (${state(version)})`;
    if (flow !== undefined) return 'the latest version of a flow, which is not the active one';
    return versionsRead && definitionsRead
      ? 'no flow and no version the org named'
      : 'no flow and no version among those the org named, which are not all';
  };
  const tallied = (ends: readonly Side[]): string => {
    const counts = new Map<string, number>();
    for (const end of ends) {
      const what = `${log.name(end.type) ?? '(a type that is not shown)'}, ${standsFor(end.id)}`;
      counts.set(what, (counts.get(what) ?? 0) + 1);
    }
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([what, count]) => `${what}: ${String(count)}`)
      .join('; ');
  };
  // `Flow` and `FlowDefinition`. The name of a custom metadata type that begins the same has an underscore.
  const aboutFlow = (end: Side): boolean => /^Flow[A-Za-z]*$/.test(end.type);
  const from = rows.filter((row) => aboutFlow(row.from)).map((row) => row.from);
  const to = rows.filter((row) => aboutFlow(row.to)).map((row) => row.to);
  log.say(
    `Rows of the Dependency API from a flow: ${String(from.length)}.` +
      (from.length > 0 ? ` By the type the row writes and what its id stands for: ${tallied(from)}.` : ''),
  );
  log.say(
    `Rows to a flow: ${String(to.length)}.` +
      (to.length > 0 ? ` By the type the row writes and what its id stands for: ${tallied(to)}.` : ''),
  );

  // The rows from each flow of the fixture project, by the version their id is of.
  for (const [id, name] of ours) {
    const parts = new Map<string, number>();
    for (const row of rows) {
      if (row.from.id !== id && flowOf(row.from.id) !== id) continue;
      const version = versions.get(row.from.id);
      const what =
        row.from.id === id
          ? 'the flow itself'
          : version !== undefined
            ? `version ${numbered(version)} (${state(version)})`
            : definitions.get(id)?.active === row.from.id
              ? 'the active version'
              : 'the latest version, which is not the active one';
      parts.set(what, (parts.get(what) ?? 0) + 1);
    }
    log.say(
      `- Rows from ${name}: ${
        parts.size === 0
          ? 'none'
          : [...parts]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([what, count]) => `${what} ${String(count)}`)
              .join(', ')
      }`,
    );
  }

  // The draft that the tool that deploys sends reads a field that the active version does not read.
  const flow = `Flow:${FLOW_WITH_DRAFT.toLowerCase()}`;
  const field = `CustomField:${DRAFT_ONLY_FIELD.toLowerCase()}`;
  if (![...ours.values()].includes(FLOW_WITH_DRAFT)) {
    log.say(
      `The flow ${FLOW_WITH_DRAFT} ${definitionsRead ? 'is not in the org' : 'could not be found, because the flows could not be read'}, so nothing is said about a draft of it.`,
    );
    return;
  }
  const ofDraft = rows.filter(
    (row) => keyOf(row.from, names, fixture)?.key === flow && keyOf(row.to, names, fixture)?.key === field,
  );
  log.say(
    `A draft of ${FLOW_WITH_DRAFT}, as the tool that deploys sends it, reads ${DRAFT_ONLY_FIELD}, which the version of the project does not. Rows from that flow to that field: ${String(ofDraft.length)}` +
      (ofDraft.length > 0
        ? `, with the id of ${[...new Set(ofDraft.map((row) => standsFor(row.from.id)))].sort().join(' and of ')}.`
        : '.'),
  );
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
  const probed = await probeDependencies(log, session, fixture, counter);
  const dependencies = probed.state;
  probeFlows(log, fixture, probed);
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
