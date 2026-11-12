/**
 * A step of the live-org workflow: takes a snapshot of the test org with
 * the engine, as `orglens snapshot` does, and says in numbers what came of
 * it.
 *
 * The snapshot goes to a workspace in a temporary folder, which is deleted
 * at the end, unless the process is killed from outside: then the folder
 * goes with the machine of the run. Nothing of it is kept or uploaded: the files of a real org
 * stay out of everything a reader of the repository can get at. What is
 * printed is counted from the database of that workspace:
 *
 * - per metadata type: how many components the org listed and handed out,
 * - what was observed, by code,
 * - the retrieves: how many, how large, how long,
 * - the components the org listed and did not hand out, and the other way
 *   round: how many, and how their names are built, without a name,
 * - the components and the files of the fixture project: whether they are
 *   in the snapshot, and how a file that came back differs from the file
 *   of the repository.
 *
 * The step fails when the snapshot does not end, or when the fixture
 * project is not whole in it. A real org lists components it does not hand
 * out, so a snapshot that is partial for that reason is a warning.
 *
 *   node --no-warnings packages/engine/test/live/read-org.ts
 */
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '@salesforce/source-deploy-retrieve';
import { workspacePaths } from '../../src/api/layout.ts';
import type { SnapshotProgress } from '../../src/api/org-snapshot.ts';
import { openWorkspace } from '../../src/api/workspace.ts';
import { connectToOrg } from '../../src/sources/org.ts';
import { getBlob } from '../../src/store/blobs.ts';
import { openStore, type Store } from '../../src/store/open.ts';
import { asStep } from './own-output.ts';
import type { PublicLog } from './public-log.ts';
import { failureLines, fixtureComponents, fixtureFiles, loginEnvironment, SOURCE, SOURCE_NAME } from './test-org.ts';

const CONFIG = `schema_version = 1\n\n[sources.${SOURCE_NAME}]\nkind = "org"\n`;

/** At most this many lines are printed about files of the fixture project that differ. */
const DIFFERENCES_SHOWN = 80;
/** At most this many components or files of the fixture project are named as missing. */
const MISSING_SHOWN = 20;
/** At most this many chunks get a line of their own. */
const CHUNKS_SHOWN = 120;

const seconds = (ms: number): string => (ms / 1000).toFixed(1);
const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;

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

const count = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The characters a metadata file can write as a reference. */
const REFERENCES: Readonly<Record<string, string>> = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };

/** How often each element stands in a metadata file. */
function elementsOf(xml: string): Map<string, number> {
  const elements = new Map<string, number>();
  for (const [, name = ''] of xml.matchAll(/<([A-Za-z][A-Za-z0-9]*)(?=[\s>/])/g)) {
    elements.set(name, (elements.get(name) ?? 0) + 1);
  }
  return elements;
}

/**
 * How the file of the fixture project that came back from an org differs
 * from the file of the repository, in words that hold nothing of either
 * but the names of elements. `null` if the two are the same, byte for byte.
 */
export function fileDifference(log: PublicLog, path: string, ours: Uint8Array, theirs: Uint8Array): string | null {
  if (Buffer.compare(ours, theirs) === 0) return null;
  const mine = Buffer.from(ours).toString('utf8');
  const other = Buffer.from(theirs).toString('utf8');
  const size = `${String(ours.length)} bytes here, ${String(theirs.length)} from the org`;
  if (mine.replace(/\r\n/g, '\n') === other.replace(/\r\n/g, '\n')) return `only the line ends differ (${size})`;
  const trimmed = (value: string): string =>
    value
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .join('\n')
      .trim();
  if (trimmed(mine) === trimmed(other)) return `only white space at the end of lines or of the file differs (${size})`;

  if (path.endsWith('.xml')) {
    const here = elementsOf(mine);
    const there = elementsOf(other);
    const added: string[] = [];
    const removed: string[] = [];
    for (const name of [...new Set([...here.keys(), ...there.keys()])].sort()) {
      const shown = log.name(name) ?? '(an element that is not shown)';
      const change = (there.get(name) ?? 0) - (here.get(name) ?? 0);
      if (change > 0) added.push(`${shown} (${String(change)})`);
      if (change < 0) removed.push(`${shown} (${String(-change)})`);
    }
    if (added.length === 0 && removed.length === 0) {
      const flat = (value: string): string => value.replace(/>\s+</g, '><').trim();
      if (flat(mine) === flat(other)) return `only white space between elements differs (${size})`;
      // A character can be written as itself or as a reference to it: `'` or `&apos;`.
      const plain = (value: string): string =>
        flat(value).replace(/&(quot|apos|lt|gt|amp);/g, (_, name: string) => REFERENCES[name] ?? '');
      return plain(mine) === plain(other)
        ? `only how characters such as quotes are written differs (${size})`
        : `the same elements, in another order or with other values (${size})`;
    }
    return [
      added.length > 0 ? `the org added ${added.join(', ')}` : null,
      removed.length > 0 ? `the org left out ${removed.join(', ')}` : null,
      size,
    ]
      .filter((part) => part !== null)
      .join('; ');
  }

  const here = trimmed(mine).split('\n');
  const there = trimmed(other).split('\n');
  if (here.length !== there.length) {
    return `${String(here.length)} lines here, ${String(there.length)} from the org (${size})`;
  }
  const differing = here.filter((line, index) => line !== there[index]).length;
  return `${plural(differing, 'line differs', 'lines differ')} of ${String(here.length)} (${size})`;
}

/**
 * Words a message of Salesforce or of a library is made of whatever it is about, in lower case. A message of a
 * form that is not known is shown in these words only (`everydayWords`).
 */
const EVERYDAY_WORDS: ReadonlySet<string> = new Set(
  (
    'a an the of in on at to for from with without by into as and or not no nor is are was were be been being it ' +
    'its this that these those there here if when while because than then so but all any each every some one ' +
    'more most only also already still currently can cannot could may might must should will would do does did ' +
    'done has have had please you your we our unable failed fail fails failure error errors warning warnings ' +
    'problem invalid valid unknown known missing found find exist exists existing available unavailable ' +
    'supported unsupported enabled disabled allowed required requires need needs ensure check correct ' +
    'incorrect proper improper insufficient too many much large larger small limit limits exceeded maximum ' +
    'minimum size number count during before after retrieve retrieved retrieving retrieval retrievable deploy ' +
    'deployed load loaded loading read reading write access accessible permission permissions input output ' +
    'received request requested result results entity entities type types name named names file files folder ' +
    'folders metadata component components package packages packaged namespace managed unmanaged installed ' +
    'organization org api version versions object objects field fields record records standard custom value ' +
    'values set sets translation translations translated language languages setting settings feature features ' +
    'license licenses user users profile profiles id ids db database capitalization member members wildcard ' +
    'manifest zip xml parse parsed parsing resolve resolved element elements expected unexpected ' +
    'duplicate empty null undefined defined registry suffix directory path content parent child children'
  ).split(' '),
);

/** What stands in quotes or in brackets in a message is a name or a value: straight and curly quotes, backticks. */
const QUOTED = /'[^']*'|"[^"]*"|\u2018[^\u2019]*\u2019|\u201C[^\u201D]*\u201D|`[^`]*`|\[[^\]]*\]/g;
/** A quote that has no partner. */
const QUOTE = /['"\u2018\u2019\u201C\u201D`[\]]/;
/** The end of the name of a file: a dot and an ending. */
const FILE_END = /\.[A-Za-z0-9]+(?:-meta\.xml)?[.,:;)]*$/;
/** A path with spaces in it is looked for over this many words at most. */
const PATH_WORDS = 12;

/**
 * A text that is not ours, in the words of a short list of everyday words and nothing else: every other word,
 * every number, everything in quotes or brackets and every path of a file is left out and shown as `…`. `names`
 * are words that are kept as well where they follow the word "type", such as the names of the metadata types.
 *
 * It says what kind of message it is. No word comes out that is not of the list. A name that stands in a message
 * without quotes and holds words of the list can leave those words behind: "Error" of a layout that is called
 * "Error Layout".
 */
export function everydayWords(said: unknown, names: ReadonlySet<string> = new Set()): string {
  // The apostrophe of "can't" is no quote: the word is left out as a whole.
  let plain = text(said)
    .replace(/(?<=[A-Za-z])['\u2019](?=[A-Za-z])/g, '\u0001')
    .replace(QUOTED, ' \u0000 ');
  // A quote without a partner: what follows may be a name, so the text ends there.
  const open = plain.search(QUOTE);
  if (open !== -1) plain = `${plain.slice(0, open)} \u0000`;
  const words = plain
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 60);
  const kept: string[] = [];
  const leaveOut = (): void => {
    if (kept.at(-1) !== '…') kept.push('…');
  };
  let afterType = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (/[/\\]/.test(word) && !FILE_END.test(word)) {
      // A path whose folders or file have spaces in their names goes on to the word with the ending of the file.
      const end = words.slice(index + 1, index + 1 + PATH_WORDS).findIndex((later) => FILE_END.test(later));
      if (end !== -1) index += end + 1;
      leaveOut();
      afterType = false;
      continue;
    }
    const [, opening = '', core = '', closing = ''] = /^(\(?)(.*?)([.,:;)]*)$/.exec(word) ?? [];
    const letters = /^[A-Za-z]+$/.test(core);
    if (letters && (EVERYDAY_WORDS.has(core.toLowerCase()) || (afterType && names.has(core)))) {
      kept.push(`${opening}${core}${closing}`);
    } else {
      leaveOut();
    }
    afterType = letters && core.toLowerCase() === 'type';
  }
  return kept.join(' ');
}

/**
 * A remark of Salesforce about a retrieve, as it may be printed: its form,
 * without the name of the component it is about. A remark of a form that
 * is not known is shown in everyday words.
 */
export function remarkForm(log: PublicLog, remark: unknown, names: ReadonlySet<string> = new Set()): string {
  const said = text(remark).trim();
  const notFound = /^Entity of type '([^']*)' named '[^']*' cannot be found$/.exec(said);
  if (notFound !== null) {
    return `Entity of type '${log.name(notFound[1]) ?? '(not shown)'}' named '(a name)' cannot be found`;
  }
  return `a remark of a form that is not known. Its everyday words: ${everydayWords(said, names)}`;
}

/**
 * The form of a name: every run of letters, digits and underscores is written as `a`, and what stands between
 * them stays. `Account.My_View` and `Contact.Other` both have the form `a.a`. It says how a name is built and
 * nothing of the name.
 */
export function nameForm(name: string): string {
  // The folder of unfiled items has the same name in every org.
  const form = name
    .split('unfiled$public')
    .map((part) =>
      part
        .replace(/%[0-9A-Fa-f]{2}/g, '%')
        .replace(/[A-Za-z0-9_]+/g, 'a')
        .replace(/[^a%./$ ()&'+,:-]/g, '?'),
    )
    .join('unfiled$public');
  return form.length > 40 ? `${form.slice(0, 40)}…` : form;
}

/** The words of the source format, which are the same in every org: its folders, the endings of its files, its types. */
let format: { folders: Set<string>; endings: Set<string>; types: Set<string> } | undefined;
function sourceFormat(): { folders: Set<string>; endings: Set<string>; types: Set<string> } {
  if (format !== undefined) return format;
  interface Type {
    readonly name?: string;
    readonly directoryName?: string;
    readonly suffix?: string;
    readonly children?: { readonly types?: Readonly<Record<string, Type>> };
  }
  const found = {
    folders: new Set<string>(),
    // Endings a file has whatever it is about.
    endings: new Set('xml txt json js css html htm png jpg jpeg gif svg ico pdf zip csv md'.split(' ')),
    types: new Set<string>(),
  };
  const add = (type: Type): void => {
    if (type.name !== undefined) found.types.add(type.name);
    if (type.directoryName !== undefined) found.folders.add(type.directoryName);
    if (type.suffix !== undefined) found.endings.add(type.suffix);
    for (const child of Object.values(type.children?.types ?? {})) add(child);
  };
  for (const type of Object.values(registry.types as Readonly<Record<string, Type>>)) add(type);
  for (const ending of Object.keys(registry.suffixes)) found.endings.add(ending);
  format = found;
  return found;
}

/**
 * The place of something that could not be read as metadata, without a name of the org. The place is a path in
 * what the org handed out, or a type and the name of a component. Of a path, the first folder and the ending of
 * the file are shown if they are words of the source format, which the org cannot choose. Of a component, the
 * type and the form of the name.
 */
export function placeForm(log: PublicLog, at: string): string {
  const known = sourceFormat();
  const component = /^([A-Za-z][A-Za-z0-9]*) (.+)$/.exec(at);
  if (component !== null) {
    const type = component[1] ?? '';
    return `a component of the type ${known.types.has(type) ? (log.name(type) ?? '(not shown)') : '(not shown)'}, with a name of the form ${nameForm(component[2] ?? '')}`;
  }
  const parts = at.split('/');
  const folder = parts[0] ?? '';
  const [, ending = '', meta = ''] = /\.([A-Za-z0-9]+)(-meta\.xml)?$/.exec(parts.at(-1) ?? '') ?? [];
  return (
    `in ${parts.length > 1 && known.folders.has(folder) ? (log.name(folder) ?? '(a folder that is not shown)') : '(a folder that is not shown)'}, ` +
    `${String(parts.length - 1)} ${parts.length === 2 ? 'level' : 'levels'} deep, ` +
    `a name that ends in ${known.endings.has(ending) ? `.${ending}${meta}` : '(an ending that is not shown)'}`
  );
}

/** A name without what an org is known to write in two ways: case, encoded characters, the prefix of a package. */
const ALIKE: readonly { readonly how: string; readonly of: (name: string) => string }[] = [
  { how: 'only in upper and lower case', of: (name) => name.toLowerCase() },
  {
    how: 'only in how a character is encoded',
    of: (name) => {
      try {
        return decodeURIComponent(name).toLowerCase();
      } catch {
        return name.toLowerCase();
      }
    },
  },
  {
    how: 'only in the prefix of a package',
    // `ns__Name__c` and `Name__c`, not `Name__c` and `c`.
    of: (name) => name.toLowerCase().replace(/(^|[./])[a-z0-9]+__(?![a-z]{1,7}(?:$|[./]))/g, '$1'),
  },
  {
    how: 'in what stands before its last dot or slash',
    of: (name) => name.toLowerCase().split(/[./]/).at(-1) ?? '',
  },
];

/** The most forms of names that are shown for one type. */
const FORMS_SHOWN = 4;

const tallied = (counts: ReadonlyMap<string, number>, most = Infinity): string =>
  [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, most)
    .map(([name, times]) => `${name} (${String(times)})`)
    .join(', ') + (counts.size > most ? `, and ${String(counts.size - most)} more` : '');

/** A component as the inventory of a snapshot has it. */
export interface InventoryRow {
  readonly type: string;
  readonly fullName: string;
  readonly listed: boolean;
  readonly retrieved: boolean;
  readonly namespacePrefix: string | null;
  readonly manageableState: string | null;
}

/**
 * What can be said about the components the org listed and did not hand out, and about the ones it handed out
 * and had not listed, without a name: how many, of which package state, how their names are built, whether the
 * object or the folder they belong to came back, and whether they came back under a name that is nearly the
 * same.
 */
export function missingLines(log: PublicLog, items: readonly InventoryRow[]): string[] {
  interface Item {
    readonly name: string;
    readonly packaged: boolean;
    readonly state: string;
  }
  const types = new Map<string, { listed: number; missing: Item[]; unlisted: Item[] }>();
  const states = new Map<string, 'retrieved' | 'not retrieved'>();
  for (const row of items) {
    const group = types.get(row.type) ?? { listed: 0, missing: [], unlisted: [] };
    types.set(row.type, group);
    states.set(`${row.type}\u0000${row.fullName}`, row.retrieved ? 'retrieved' : 'not retrieved');
    const item: Item = {
      name: row.fullName,
      packaged: (row.namespacePrefix ?? '') !== '',
      state: log.name(row.manageableState) ?? 'none',
    };
    if (row.listed) group.listed += 1;
    if (row.listed && !row.retrieved) group.missing.push(item);
    if (!row.listed && row.retrieved) group.unlisted.push(item);
  }
  const shown = (type: string): string => log.name(type) ?? '(a type that is not shown)';
  const tally = (values: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  /** Whether what a name belongs to, an object or a folder, is in the snapshot. */
  const owners = (names: readonly Item[], mark: string, ownerType: string): string | null => {
    // A name in a folder can hold a dot of its own. It belongs to the folder, not to an object.
    const owned = names.filter((item) => item.name.includes(mark) && (mark === '/' || !item.name.includes('/')));
    if (owned.length === 0) return null;
    const found = tally(
      owned.map((item) => {
        const owner = item.name.slice(0, item.name.indexOf(mark));
        if (owner === 'unfiled$public') return 'is the folder of unfiled items';
        const state = states.get(`${ownerType}\u0000${owner}`);
        return state === undefined ? 'is not in the list' : state === 'retrieved' ? 'came back' : 'did not come back';
      }),
    );
    return `${mark === '.' ? 'What stands before the dot, as' : 'The folder before the slash, as'} ${shown(ownerType)}: ${tallied(found)}`;
  };
  const about = (type: string, names: readonly Item[]): string[] => {
    const parts: string[] = [];
    const packaged = names.filter((item) => item.packaged).length;
    if (packaged > 0) parts.push(`Of a package: ${String(packaged)}`);
    const stated = tally(names.map((item) => item.state));
    if (stated.size > 1 || !stated.has('none')) parts.push(`State: ${tallied(stated)}`);
    parts.push(`Forms of the names: ${tallied(tally(names.map((item) => nameForm(item.name))), FORMS_SHOWN)}`);
    const object = owners(names, '.', 'CustomObject');
    if (object !== null) parts.push(object);
    const folder = owners(names, '/', type === 'EmailTemplate' ? 'EmailFolder' : `${type}Folder`);
    if (folder !== null) parts.push(folder);
    return parts;
  };

  const lines: string[] = [];
  const byName = ([a]: [string, unknown], [b]: [string, unknown]): number => a.localeCompare(b);
  const withMissing = [...types].filter(([, group]) => group.missing.length > 0).sort(byName);
  if (withMissing.length > 0) {
    lines.push(
      '',
      'Components the org listed and did not hand out, by type. A name is shown as its form only: "a" stands for letters, digits and underscores.',
    );
    for (const [type, group] of withMissing) {
      const parts = [
        `${String(group.missing.length)} of ${String(group.listed)} did not come back`,
        ...about(type, group.missing),
      ];
      // A component that came back under a name that is nearly the one the org listed.
      const twins = new Map<string, number>();
      for (const item of group.missing) {
        const rule = ALIKE.find(({ of }) => group.unlisted.some((other) => of(other.name) === of(item.name)));
        if (rule !== undefined) twins.set(rule.how, (twins.get(rule.how) ?? 0) + 1);
      }
      if (twins.size > 0) parts.push(`Came back, not listed, under a name that differs ${tallied(twins)}`);
      lines.push(`- ${shown(type)}: ${parts.join('. ')}.`);
    }
  }
  const withUnlisted = [...types].filter(([, group]) => group.unlisted.length > 0).sort(byName);
  if (withUnlisted.length > 0) {
    lines.push('', 'Components the org handed out and had not listed, by type:');
    for (const [type, group] of withUnlisted) {
      lines.push(`- ${shown(type)}: ${[String(group.unlisted.length), ...about(type, group.unlisted)].join('. ')}.`);
    }
  }
  return lines;
}

/** Says what the database holds of a snapshot. Returns whether every component and file of the fixture project is in it. */
function describe(log: PublicLog, store: Store, snapshotId: number): boolean {
  const files = store.get(
    `SELECT COUNT(*) AS files, COALESCE(SUM(b.raw_size), 0) AS bytes
       FROM snapshot_file f JOIN blob b ON b.id = f.blob_id WHERE f.snapshot_id = ?`,
    snapshotId,
  );
  const inventory = store.get(
    `SELECT COUNT(*) AS items, COALESCE(SUM(listed), 0) AS listed,
            COALESCE(SUM(listed = 1 AND retrieved = 1), 0) AS retrieved, COALESCE(SUM(listed = 0), 0) AS unlisted, COALESCE(SUM(namespace_prefix IS NOT NULL AND namespace_prefix <> ''), 0) AS packaged
       FROM inventory_item WHERE snapshot_id = ?`,
    snapshotId,
  );
  log.say(
    `Components: ${log.count(count(inventory?.['listed']))} listed by the org, ${log.count(count(inventory?.['retrieved']))} of them retrieved, ` +
      `${log.count(count(inventory?.['unlisted']))} retrieved that the org had not listed, ${log.count(count(inventory?.['packaged']))} of a package with a namespace.`,
  );
  log.say(`Files: ${log.count(count(files?.['files']))}, together ${log.count(count(files?.['bytes']))} bytes.`);

  // The retrieves.
  const chunks = store.all(
    `SELECT seq, status, attempts, json_array_length(members) AS types,
            (SELECT COALESCE(SUM(json_array_length(g.value, '$.members')), 0) FROM json_each(members) g) AS members,
            (julianday(finished_at) - julianday(started_at)) * 86400.0 AS took
       FROM retrieve_chunk WHERE snapshot_id = ? ORDER BY seq`,
    snapshotId,
  );
  if (chunks.length > 0) {
    const by = (status: string): number => chunks.filter((chunk) => chunk['status'] === status).length;
    const took = chunks
      .map((chunk) => chunk['took'])
      .filter((value): value is number => typeof value === 'number')
      .sort((a, b) => a - b);
    const members = chunks.map((chunk) => count(chunk['members']));
    log.say(
      `Retrieves: ${plural(chunks.length, 'chunk', 'chunks')}, ${String(by('done'))} stored, ${String(by('failed'))} failed, ` +
        `${String(by('pending') + by('running'))} not ended. Started more than once: ${String(chunks.filter((chunk) => count(chunk['attempts']) > 1).length)}.`,
    );
    log.say(
      `Components asked for per chunk: ${String(Math.min(...members))} to ${String(Math.max(...members))}.` +
        (took.length > 0
          ? ` Seconds per chunk: shortest ${(took[0] ?? 0).toFixed(1)}, median ${(took[Math.floor(took.length / 2)] ?? 0).toFixed(1)}, longest ${(took.at(-1) ?? 0).toFixed(1)}.`
          : ''),
    );
    for (const line of table([
      ['CHUNK', 'COMPONENTS', 'TYPES', 'SECONDS', 'STARTS', 'STATE'],
      ...chunks
        .slice(0, CHUNKS_SHOWN)
        .map((chunk) => [
          String(count(chunk['seq'])),
          String(count(chunk['members'])),
          String(count(chunk['types'])),
          typeof chunk['took'] === 'number' ? chunk['took'].toFixed(1) : '',
          String(count(chunk['attempts'])),
          log.name(chunk['status']) ?? 'unknown',
        ]),
    ])) {
      log.say(line);
    }
    if (chunks.length > CHUNKS_SHOWN) log.say(`and ${String(chunks.length - CHUNKS_SHOWN)} more chunks.`);
  }

  // The types.
  const types = store.all(
    'SELECT type, listed, retrieved, listing FROM snapshot_type_coverage WHERE snapshot_id = ? ORDER BY type',
    snapshotId,
  );
  const shown = (type: unknown): string => log.name(type) ?? '(a type that is not shown)';
  const withSomething = types.filter(
    (type) => count(type['listed']) > 0 || count(type['retrieved']) > 0 || type['listing'] !== 'ok',
  );
  const empty = types.filter((type) => !withSomething.includes(type));
  if (types.length > 0) {
    log.say('');
    log.say(
      `Metadata types: ${String(types.length)}. With a component or with a listing that is not ok: ${String(withSomething.length)}.`,
    );
    for (const line of table([
      ['TYPE', 'LISTED', 'RETRIEVED', 'LISTING'],
      ...withSomething.map((type) => [
        shown(type['type']),
        String(count(type['listed'])),
        String(count(type['retrieved'])),
        log.name(type['listing']) ?? 'unknown',
      ]),
    ])) {
      log.say(line);
    }
    if (empty.length > 0) {
      log.say(
        `Types the org describes and lists no component of (${String(empty.length)}): ${empty.map((type) => shown(type['type'])).join(', ')}`,
      );
    }
  }

  // What was observed.
  const issues = store.all(
    'SELECT severity, code, message, details FROM snapshot_issue WHERE snapshot_id = ? ORDER BY id',
    snapshotId,
  );
  log.say('');
  log.say(`Observations: ${String(issues.length)}.`);
  const groups = new Map<
    string,
    { issues: number; components: number; types: Set<string>; codes: Map<string, number> }
  >();
  const remarks = new Map<string, number>();
  const unread = new Map<string, number>();
  const typeNames = new Set(types.map((type) => log.name(type['type'])).filter((name) => name !== null));
  let remarksInAll = 0;
  for (const issue of issues) {
    const code = log.code(issue['code']) ?? 'UNKNOWN';
    const id = `${log.name(issue['severity']) ?? 'unknown'} ${code}`;
    const group = groups.get(id) ?? {
      issues: 0,
      components: 0,
      types: new Set<string>(),
      codes: new Map<string, number>(),
    };
    groups.set(id, group);
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse(text(issue['details']) || '{}') as Record<string, unknown>;
    } catch {
      // Details that cannot be read are counted as none.
    }
    group.issues += 1;
    if (typeof details['count'] === 'number') group.components += details['count'];
    for (const type of [details['type'], ...(Array.isArray(details['types']) ? (details['types'] as unknown[]) : [])]) {
      const name = log.name(type);
      if (name !== null) group.types.add(name);
    }
    // What Salesforce said is kept by the engine in a text. Only its code is shown, which the engine keeps apart.
    const said = log.code(details['code']);
    if (said !== null) group.codes.set(said, (group.codes.get(said) ?? 0) + 1);
    if (code === 'RETRIEVE_MESSAGES') {
      remarksInAll += count(details['count']);
      for (const remark of Array.isArray(details['messages']) ? (details['messages'] as unknown[]) : []) {
        const form = remarkForm(log, remark, typeNames);
        remarks.set(form, (remarks.get(form) ?? 0) + 1);
      }
    }
    if (code === 'RESOLVE_FAILED') {
      const place = `${placeForm(log, text(details['at']))}. In everyday words: ${everydayWords(text(issue['message']).split(' could not be read as metadata: ')[1] ?? '', typeNames)}`;
      unread.set(place, (unread.get(place) ?? 0) + 1);
    }
  }
  for (const [id, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    log.say(
      `- ${id}: ${plural(group.issues, 'observation', 'observations')}` +
        (group.components > 0 ? `, about ${String(group.components)} components, files or remarks` : '') +
        (group.types.size > 0 ? `. Types: ${[...group.types].sort().join(', ')}` : '') +
        (group.codes.size > 0
          ? `. Codes of Salesforce: ${[...group.codes]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([code, times]) => `${code} (${String(times)})`)
              .join(', ')}`
          : ''),
    );
  }
  if (remarksInAll > 0) {
    log.say(`Remarks of Salesforce about retrieves: ${String(remarksInAll)}. By form, of the ones that were kept:`);
    for (const [form, times] of [...remarks].sort(([, a], [, b]) => b - a)) {
      log.say(`- ${plural(times, 'time', 'times')}: ${form}`);
    }
  }
  if (unread.size > 0) {
    log.say('What could not be read as metadata (RESOLVE_FAILED):');
    for (const [place, times] of [...unread].sort(([, a], [, b]) => b - a)) {
      log.say(`- ${plural(times, 'time', 'times')}: ${place}`);
    }
  }
  const items = store.all(
    'SELECT type, full_name, listed, retrieved, namespace_prefix, manageable_state FROM inventory_item WHERE snapshot_id = ?',
    snapshotId,
  );
  for (const line of missingLines(
    log,
    items.map((row) => ({
      type: text(row['type']),
      fullName: text(row['full_name']),
      listed: count(row['listed']) === 1,
      retrieved: count(row['retrieved']) === 1,
      namespacePrefix: text(row['namespace_prefix']) || null,
      manageableState: text(row['manageable_state']) || null,
    })),
  )) {
    log.say(line);
  }

  // The files, by the folder of the source format they are in.
  const folders = new Map<string, number>();
  const paths = store.all('SELECT path, blob_id FROM snapshot_file WHERE snapshot_id = ? ORDER BY path', snapshotId);
  for (const { path } of paths) {
    const folder = log.name(text(path).split('/')[0]) ?? '(a folder that is not shown)';
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  if (folders.size > 0) {
    log.say('');
    log.say(`Files by folder: ${[...folders].map(([folder, files]) => `${folder} ${String(files)}`).join(', ')}`);
  }

  // The fixture project.
  const expected = fixtureComponents();
  const state = (component: { type: string; fullName: string }): { listed: boolean; retrieved: boolean } => {
    const row = store.get(
      'SELECT listed, retrieved FROM inventory_item WHERE snapshot_id = ? AND type = ? AND full_name = ?',
      snapshotId,
      component.type,
      component.fullName,
    );
    return { listed: count(row?.['listed']) === 1, retrieved: count(row?.['retrieved']) === 1 };
  };
  const states = expected.map((component) => ({ component, ...state(component) }));
  log.say('');
  log.say(
    `Fixture project: ${String(expected.length)} components. Listed by the org: ${String(states.filter((one) => one.listed).length)}. Retrieved: ${String(states.filter((one) => one.retrieved).length)}.`,
  );
  const incomplete = states.filter((one) => !one.listed || !one.retrieved);
  for (const { component, listed, retrieved } of incomplete.slice(0, MISSING_SHOWN)) {
    const name = `${component.type} ${component.fullName}`;
    log.say(`- ${name}: ${listed ? 'listed' : 'not listed'}, ${retrieved ? 'retrieved' : 'not retrieved'}`);
  }
  if (incomplete.length > MISSING_SHOWN) log.say(`- and ${String(incomplete.length - MISSING_SHOWN)} more components.`);

  const inSnapshot = new Map(paths.map((row) => [text(row['path']), count(row['blob_id'])]));
  const ours = fixtureFiles();
  const missing: string[] = [];
  const differences: string[] = [];
  let same = 0;
  for (const [path, content] of ours) {
    const blob = inSnapshot.get(path);
    if (blob === undefined) {
      missing.push(path);
      continue;
    }
    const difference = fileDifference(log, path, content, getBlob(store, blob));
    if (difference === null) same += 1;
    else differences.push(`- ${path}: ${difference}`);
  }
  log.say(
    `Files of the fixture project: ${String(ours.size)}. In the snapshot: ${String(ours.size - missing.length)}. ` +
      `The same byte for byte: ${String(same)}. Different: ${String(differences.length)}.`,
  );
  for (const path of missing.slice(0, MISSING_SHOWN)) log.say(`- ${path}: not in the snapshot`);
  if (missing.length > MISSING_SHOWN)
    log.say(`- and ${String(missing.length - MISSING_SHOWN)} more files that are not in the snapshot.`);
  for (const line of differences.slice(0, DIFFERENCES_SHOWN)) log.say(line);
  if (differences.length > DIFFERENCES_SHOWN) {
    log.say(`- and ${String(differences.length - DIFFERENCES_SHOWN)} more files that differ.`);
  }
  return incomplete.length === 0 && missing.length === 0;
}

export async function readOrg(
  log: PublicLog,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    /** The folder the temporary workspace is made in. Default: the one of the system. */
    tmp?: string;
  } = {},
): Promise<void> {
  const env = loginEnvironment(log, options.env);
  if (env === undefined) return;

  // A login of its own, before the snapshot logs in: it tells this tool the address and the id of the org and the
  // user, which the engine hands to no client. Nothing that holds a word of them is printed from here on.
  try {
    const session = await connectToOrg(SOURCE, undefined, env);
    log.forbid(session.instanceUrl, session.orgId, session.orgId.slice(0, 15), session.username);
  } catch (error) {
    log.fail(failureLines(log, 'The test org was not read, because the login to it failed', error));
    return;
  }

  const root = mkdtempSync(join(options.tmp ?? tmpdir(), 'orglens-live-org-'));
  // The folder holds the metadata of the org. It is removed when this function ends, and also when the process
  // is ended on the way by an error nobody caught.
  const remove = (): void => {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  };
  process.once('exit', remove);
  writeFileSync(join(root, 'orglens.toml'), CONFIG);

  // Every request the engine sends to the Metadata API, counted where the HTTP library announces it.
  let requests = 0;
  const counted = (message: unknown): void => {
    const path = (message as { request?: { path?: unknown } } | null)?.request?.path;
    if (typeof path === 'string' && path.startsWith('/services/Soap/m/')) requests += 1;
  };
  subscribe('undici:request:create', counted);

  const started = Date.now();
  const at: { connected?: number; planned?: number } = {};
  let listings = 0;
  let version: string | null = null;
  const onProgress = (event: SnapshotProgress): void => {
    const elapsed = seconds(Date.now() - started);
    if (event.step === 'connected') {
      at.connected = Date.now();
      version = log.version(event.apiVersion);
      log.say(`After ${elapsed} s: logged in. The org is read with API version ${version ?? 'unknown'}.`);
    } else if (event.step === 'listing') {
      listings = event.total;
    } else if (event.step === 'planned') {
      at.planned = Date.now();
      log.say(
        `After ${elapsed} s: the org answered ${String(listings)} requests for what it holds. It lists ${String(event.components)} components. They are retrieved in ${plural(event.chunks, 'chunk', 'chunks')}.`,
      );
    } else if (event.step === 'retrieved') {
      log.say(`After ${elapsed} s: ${String(event.done)} of ${plural(event.chunks, 'chunk', 'chunks')} ended.`);
    }
  };

  try {
    let failure: unknown;
    let taken: { id: number; status: string } | undefined;
    try {
      const workspace = await openWorkspace({ root, env });
      const report = await workspace.snapshot(SOURCE_NAME, { onProgress });
      taken = report.snapshot;
    } catch (error) {
      failure = error;
    }
    const ended = Date.now();

    const database = workspacePaths(root).databaseFile;
    log.say('');
    if (taken !== undefined) {
      log.say(
        `The snapshot of the test org is ${log.name(taken.status) ?? 'in a state that is not shown'}. It took ${seconds(ended - started)} s` +
          (at.connected !== undefined && at.planned !== undefined
            ? `: ${seconds(at.connected - started)} s to log in, ${seconds(at.planned - at.connected)} s to ask what the org holds, ${seconds(ended - at.planned)} s to retrieve it.`
            : '.'),
      );
    }
    log.say(
      `Requests to the Metadata API: ${String(requests)}. Largest memory of the process: ${String(Math.round(process.resourceUsage().maxRSS / 1024))} MB.`,
    );

    let fixtureWhole = false;
    if (existsSync(database)) {
      const store = openStore({ path: database, readOnly: true });
      try {
        const row = store.get(
          `SELECT s.id FROM snapshot s JOIN source o ON o.id = s.source_id WHERE o.name = ? ORDER BY s.id DESC LIMIT 1`,
          SOURCE_NAME,
        );
        if (row !== undefined) fixtureWhole = describe(log, store, count(row['id']));
      } finally {
        store.close();
      }
    }

    if (failure !== undefined) {
      log.say('');
      log.fail(failureLines(log, 'The snapshot of the test org did not end', failure));
    } else if (!fixtureWhole) {
      log.say('');
      log.fail([
        'The fixture project is not whole in the snapshot of the test org. The lines above say what is missing.',
      ]);
    } else if (taken?.status !== 'complete') {
      // A real org lists components it does not hand out. The step says so and does not fail for it: it fails
      // when the snapshot did not end or when the fixture project is not whole in it.
      log.say('');
      log.say(
        '::warning::The snapshot of the test org is not complete, and the fixture project is whole in it. The observations above say what is missing.',
      );
    }
  } finally {
    unsubscribe('undici:request:create', counted);
    process.off('exit', remove);
    remove();
  }
}

if (import.meta.main) await asStep(import.meta.filename, readOrg);
