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
 *   of the repository,
 * - the cross-check: what the Dependency API of Salesforce reports for the
 *   org, held by the engine against its analysis of the snapshot. A pair of
 *   components is named only if both are of the fixture project,
 * - the files of the fixture project that no analyser reads yet: which of
 *   the pairs its answer key has for them the Dependency API reports, by
 *   the ids the org listed, and which version of each flow the org handed
 *   out,
 * - the rows read twice more, with one query and then with every answer
 *   cut off at a few rows, to see that the parts the engine asks for then
 *   give every row, and that the org answers each way of asking. Of a
 *   request that failed, the condition of its query is shown: the names of
 *   the types, and the number of ids in the place of the ids.
 *
 * The step fails when the snapshot does not end, when the fixture project
 * is not whole in it, when the Dependency API gave nothing to compare, when
 * the analysis missed a reference that Salesforce reports, when the parts
 * give a row that one query just before did not give, or when a reading
 * in parts that the engine calls whole lacks a row of that query. A real
 * org lists components it does not hand out, so a snapshot that is partial
 * for that reason is a warning.
 *
 *   node --no-warnings packages/engine/test/live/read-org.ts
 */
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '@salesforce/source-deploy-retrieve';
import { workspacePaths } from '../../src/api/layout.ts';
import type { CrossCheckReport } from '../../src/api/analysis.ts';
import type { SnapshotProgress } from '../../src/api/org-snapshot.ts';
import type { CoverageReport } from '../../src/api/snapshot.ts';
import { openWorkspace } from '../../src/api/workspace.ts';
import { buildKey } from '../../src/core/keys.ts';
import { listedMatcher, type CrossCheckPair } from '../../src/engines/cross-check.ts';
import { readDependencies, type DependencyRow } from '../../src/sources/dependency-api.ts';
import { notFoundIn } from '../../src/sources/metadata-api.ts';
import { requestFailure } from '../../src/sources/org-http.ts';
import { connectToOrg, type OrgSession } from '../../src/sources/org.ts';
import { getBlob } from '../../src/store/blobs.ts';
import { readDependencyRows, readListedIds, type ListedId } from '../../src/store/dependencies.ts';
import { openStore, type Store } from '../../src/store/open.ts';
import { draftPlaces, FLOW_WITH_DRAFT } from './deploy-fixture.ts';
import { asStep } from './own-output.ts';
import { everydayWords, type PublicLog } from './public-log.ts';
import {
  answerKey,
  failureLines,
  fixtureComponents,
  fixtureFiles,
  loginEnvironment,
  SOURCE,
  SOURCE_NAME,
} from './test-org.ts';

const CONFIG = `schema_version = 1\n\n[sources.${SOURCE_NAME}]\nkind = "org"\n`;

/** At most this many lines are printed about files of the fixture project that differ. */
const DIFFERENCES_SHOWN = 80;
/** At most this many components or files of the fixture project are named as missing. */
const MISSING_SHOWN = 20;
/** At most this many chunks get a line of their own. */
const CHUNKS_SHOWN = 120;
/** At most this many pairs of one list of the cross-check are named. */
const PAIRS_SHOWN = 60;
/** How many forms of a condition are listed for the requests that failed. */
const CONDITIONS_SHOWN = 40;
/**
 * The rows of the Dependency API are read a second time with every answer cut off at this many rows. The test
 * org holds fewer rows than the 2,000 a query really gives, so the parts the engine asks for at that limit are
 * never asked for there otherwise.
 */
const PRETENDED_LIMIT = 30;

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

/** The endings Salesforce gives the name of an object by its kind. No org chooses them. */
const OBJECT_ENDINGS: ReadonlySet<string> = new Set([
  '__c',
  '__mdt',
  '__e',
  '__b',
  '__x',
  '__kav',
  '__ka',
  '__dlm',
  '__dll',
  '__chn',
]);

/** The types whose components are parts of an object, so that an object stands before the dot of their name. */
let partsOfObject: ReadonlySet<string> | undefined;
function isPartOfObject(type: string): boolean {
  partsOfObject ??= new Set(
    Object.values(registry.types['customobject']?.children?.types ?? {}).map((part) => part.name),
  );
  return partsOfObject.has(type);
}

/**
 * How the name of an object ends: with an ending Salesforce gives a kind of custom object, or with none, as the
 * name of a standard object does. It says what kind of object it is and nothing of its name. It is asked only
 * of the name of an object: of a component of the type `CustomObject`, and of what stands before the dot in the
 * name of a part of one.
 */
export function objectKind(name: string): string {
  const ending = /__[A-Za-z]{1,8}$/.exec(name)?.[0];
  if (ending === undefined) return 'no ending of a custom object';
  return OBJECT_ENDINGS.has(ending) ? `ends in ${ending}` : 'an ending that is not shown';
}

/** The names Salesforce said it cannot find in a retrieve, by type. The names are compared and never shown. */
function notFoundNames(remarks: readonly string[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const { type, fullName } of notFoundIn(remarks)) {
    found.set(type, (found.get(type) ?? new Set<string>()).add(fullName));
  }
  return found;
}

/** A letter, a digit or an underscore, of any script. */
const WORD = '[\\p{L}\\p{N}_]';

/**
 * A remark with a name cut out wherever it stands as a name of its own, or `null` if it stands nowhere so. A
 * name of its own has no letter, digit or underscore before or after it, and is not one side of a longer name
 * with a dot: `Plan` stands in neither `Plans` nor `Plan.Field__c` nor `My.Plan`. Upper and lower case count.
 */
function withoutName(remark: string, name: string): string | null {
  if (name === '') return null;
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alone = new RegExp(`(?<!${WORD})(?<!${WORD}\\.)${literal}(?!${WORD})(?!\\.${WORD})`, 'gu');
  const cut = remark.replace(alone, ' … ');
  return cut === remark ? null : cut;
}

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
 * object or the folder they belong to came back, whether they came back under a name that is nearly the same,
 * of how many Salesforce remarked that it cannot find them, and how many a remark of another form names.
 *
 * `remarks`: what Salesforce remarked about the retrieves, as the engine kept it. `remarksMade`: how many
 * remarks Salesforce made. The engine keeps the first of each retrieve, so the lines say when a count of what
 * Salesforce remarked can be too low.
 */
export function missingLines(
  log: PublicLog,
  items: readonly InventoryRow[],
  remarks: readonly string[] = [],
  remarksMade = remarks.length,
): string[] {
  interface Item {
    readonly name: string;
    readonly packaged: boolean;
    readonly prefix: string;
    readonly state: string;
  }
  const notFound = notFoundNames(remarks);
  /** The remarks that do not say "cannot be found". */
  const otherRemarks = remarks.filter((remark) => notFoundIn([remark]).length === 0);
  /** The names of the remarks "cannot be found" that a line has spoken of, as type and name. */
  const spokenOf = new Set<string>();
  const remarked = (type: string, names: readonly string[]): number => {
    const said = notFound.get(type);
    const hit = names.filter((name) => said?.has(name) === true);
    for (const name of hit) spokenOf.add(`${type}\u0000${name}`);
    return hit.length;
  };
  const types = new Map<string, { listed: number; missing: Item[]; unlisted: Item[] }>();
  const states = new Map<string, 'retrieved' | 'not retrieved'>();
  for (const row of items) {
    const group = types.get(row.type) ?? { listed: 0, missing: [], unlisted: [] };
    types.set(row.type, group);
    states.set(`${row.type}\u0000${row.fullName}`, row.retrieved ? 'retrieved' : 'not retrieved');
    const item: Item = {
      name: row.fullName,
      packaged: (row.namespacePrefix ?? '') !== '',
      prefix: row.namespacePrefix ?? '',
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
  const owners = (type: string, names: readonly Item[], mark: string, ownerType: string): string | null => {
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
    const said = `${mark === '.' ? 'What stands before the dot, as' : 'The folder before the slash, as'} ${shown(ownerType)}: ${tallied(found)}`;
    // The objects the org does not list: how many they are, of what kind, and whether Salesforce cannot find them.
    const strangers = [
      ...new Set(
        owned
          .map((item) => item.name.slice(0, item.name.indexOf(mark)))
          .filter((owner) => owner !== 'unfiled$public' && !states.has(`${ownerType}\u0000${owner}`)),
      ),
    ];
    // What stands before the dot is the name of an object only for a part of an object.
    if (mark !== '.' || strangers.length === 0 || !isPartOfObject(type)) return said;
    const cannot = remarked(ownerType, strangers);
    return (
      `${said}. Not in the list: ${plural(strangers.length, 'object', 'different objects')}, by how the name ends: ${tallied(tally(strangers.map(objectKind)))}` +
      (notFound.size > 0 ? `. Salesforce remarked of ${String(cannot)} of them that it cannot be found` : '')
    );
  };
  const about = (type: string, names: readonly Item[]): string[] => {
    const parts: string[] = [];
    const packaged = names.filter((item) => item.packaged).length;
    if (packaged > 0) parts.push(`Of a package: ${String(packaged)}`);
    const stated = tally(names.map((item) => item.state));
    if (stated.size > 1 || !stated.has('none')) parts.push(`State: ${tallied(stated)}`);
    parts.push(`Forms of the names: ${tallied(tally(names.map((item) => nameForm(item.name))), FORMS_SHOWN)}`);
    if (type === 'CustomObject')
      parts.push(`By how the name ends: ${tallied(tally(names.map((item) => objectKind(item.name))))}`);
    const object = owners(type, names, '.', 'CustomObject');
    if (object !== null) parts.push(object);
    const folder = owners(type, names, '/', type === 'EmailTemplate' ? 'EmailFolder' : `${type}Folder`);
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
      if (notFound.size > 0) {
        const cannot = remarked(
          type,
          group.missing.map((item) => item.name),
        );
        if (cannot > 0) parts.push(`Salesforce remarked of ${String(cannot)} that it cannot be found`);
      }
      // A remark of another form that holds the name of a missing component. It can be about the component, or
      // hold a word that is the same as its name. The remark is shown with the name cut out: a name can be an
      // everyday word, and then the line would say which of the words shown is a name.
      const forms = new Map<string, number>();
      let held = 0;
      for (const item of group.missing) {
        const about = new Set(
          otherRemarks
            .map((remark) => withoutName(remark, item.name))
            .filter((cut) => cut !== null)
            .map((cut) => everydayWords(cut)),
        );
        if (about.size > 0) held += 1;
        for (const form of about) forms.set(form, (forms.get(form) ?? 0) + 1);
      }
      if (held > 0) {
        parts.push(
          `A remark of Salesforce of another form holds the name of ${String(held)}. In everyday words, without the name: ${tallied(forms)}`,
        );
      }
      // A component that came back under a name that is nearly the one the org listed.
      const twins = new Map<string, number>();
      for (const item of group.missing) {
        // The prefix the org states for the component says more than the form of the name: a short name after a
        // prefix looks like the ending of a custom object.
        const short =
          item.prefix !== '' && item.name.startsWith(`${item.prefix}__`)
            ? item.name.slice(item.prefix.length + 2)
            : null;
        if (short !== null && group.unlisted.some((other) => other.name.toLowerCase() === short.toLowerCase())) {
          const how = 'only in the prefix of its package';
          twins.set(how, (twins.get(how) ?? 0) + 1);
          continue;
        }
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
  // What Salesforce cannot find and no line above has spoken of.
  const rest = new Map<string, number>();
  for (const [type, names] of notFound) {
    for (const name of names) {
      if (spokenOf.has(`${type}\u0000${name}`)) continue;
      const state = states.get(`${type}\u0000${name}`);
      const what = `${shown(type)}, ${state === undefined ? 'a name the org did not list' : state === 'retrieved' ? 'a component that came back all the same' : 'a component that did not come back'}`;
      rest.set(what, (rest.get(what) ?? 0) + 1);
    }
  }
  if (rest.size > 0) {
    lines.push('', `Other names Salesforce remarked it cannot find, by type: ${tallied(rest)}.`);
  }
  if (lines.length > 0 && remarksMade > remarks.length) {
    lines.push(
      '',
      `Salesforce made ${String(remarksMade)} remarks about the retrieves, and the snapshot keeps ${String(remarks.length)} of them. The counts above of what Salesforce remarked can be too low.`,
    );
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
  const allRemarks: string[] = [];
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
        allRemarks.push(text(remark));
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
    allRemarks,
    remarksInAll,
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
  for (const line of flowLines(log, (path) => {
    const blob = inSnapshot.get(path);
    return blob === undefined ? null : Buffer.from(getBlob(store, blob)).toString('utf8');
  })) {
    log.say(line);
  }
  return incomplete.length === 0 && missing.length === 0;
}

/** The keys of the fixture project: its components, and the targets of Salesforce its answer key names. */
function fixtureKeys(): Set<string> {
  const keys = new Set<string>(answerKey().standard ?? []);
  for (const component of fixtureComponents()) {
    try {
      keys.add(buildKey(component));
    } catch {
      // A component the engine has no key for is of no pair.
    }
  }
  return keys;
}

/** The roadmap phase whose files no analyser reads yet. The cross-check says nothing of them. */
const PHASE_NOT_READ = 2;

/**
 * What the Dependency API reports for the files of the fixture project that no analyser reads yet: the pairs of
 * components the answer key has for the files of a phase, held against the rows. An end of a row is matched to a
 * component as the engine does it in the cross-check: by the id the org listed the component with.
 *
 * The first lines say what the id of a row is the id of. A row from a flow can carry the id of a version of the
 * flow, which the org may not list.
 */
export function phaseLines(
  log: PublicLog,
  rows: readonly DependencyRow[],
  listed: readonly ListedId[],
  phase = PHASE_NOT_READ,
): string[] {
  const lines = [
    '',
    `The files of Phase ${String(phase)} of the fixture project, which no analyser reads yet, in the rows of the Dependency API`,
  ];
  const match = listedMatcher(listed);
  const typeOf = (key: string): string => key.slice(0, key.indexOf(':'));
  // A row writes the name of a custom metadata type as the type of a record of it. That name is not shown.
  const shownType = (type: string): string =>
    log.name(type) ?? (/__mdt$/i.test(type) ? '(the name of a custom metadata type)' : '(a type that is not shown)');
  const typesOfId = new Map<string, Set<string>>();
  for (const item of listed) {
    if (item.id === null || item.id === '') continue;
    const id = item.id.slice(0, 15);
    typesOfId.set(
      id,
      (typesOfId.get(id) ?? new Set<string>()).add(log.name(item.type) ?? '(a type that is not shown)'),
    );
  }
  const listedAs = (id: string): string =>
    [...(typesOfId.get(id.slice(0, 15)) ?? [])].sort().join(' and ') || 'not listed';
  for (const end of ['from', 'to'] as const) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const group = `${shownType(row[end].type)}\u0000${listedAs(row[end].id)}`;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    lines.push(
      end === 'from'
        ? 'Rows by the type the row writes for the component that refers, and by the type the org listed its id with:'
        : 'The same for the component that is referred to. A standard object has its name in the place of an id:',
      ...table([
        ['TYPE OF THE ROW', 'ID LISTED AS', 'ROWS'],
        ...[...counts]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([group, times]) => [...group.split('\u0000'), String(times)]),
      ]),
    );
  }

  // The pairs of the key for the files of the phase, component to component.
  const pairs = new Map<string, { from: string; to: string; via: Set<string> }>();
  const types = new Set<string>();
  const otherTypes = new Set<string>();
  for (const file of answerKey().references ?? []) {
    for (const member of file.members) {
      const from = member.from.split('#')[0] ?? '';
      (file.phase === phase ? types : otherTypes).add(typeOf(from));
      if (file.phase !== phase) continue;
      for (const ref of member.refs) {
        const to = ref.to.split('#')[0] ?? '';
        if (from === to) continue;
        const id = `${from} -> ${to}`;
        const pair = pairs.get(id) ?? { from, to, via: new Set<string>() };
        pair.via.add(ref.via);
        pairs.set(id, pair);
      }
    }
  }
  const reported = new Set<string>();
  for (const row of rows) {
    const from = match(row.from);
    const to = match(row.to);
    if (from !== null && to !== null && from !== to) reported.add(`${from} -> ${to}`);
  }
  const expected = [...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  lines.push(
    '',
    `The answer key holds ${plural(expected.length, 'pair', 'pairs')} of a component and a component it refers to for these files. The Dependency API reports ${String(expected.filter(([id]) => reported.has(id)).length)} of them.`,
  );
  const tally = (group: (pair: { from: string; to: string; via: Set<string> }) => string[]): string[][] => {
    const groups = new Map<string, { inKey: number; reported: number }>();
    for (const [id, pair] of expected) {
      for (const name of group(pair)) {
        const one = groups.get(name) ?? { inKey: 0, reported: 0 };
        one.inKey += 1;
        if (reported.has(id)) one.reported += 1;
        groups.set(name, one);
      }
    }
    return [...groups]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, one]) => [...name.split('\u0000'), String(one.inKey), String(one.reported)]);
  };
  lines.push(
    ...table([
      ['FROM', 'TO', 'IN THE KEY', 'REPORTED'],
      ...tally((pair) => [`${typeOf(pair.from)}\u0000${typeOf(pair.to)}`]),
    ]),
    'By the way the source names the target. A pair is counted under every way the key has for it:',
    ...table([['WAY', 'IN THE KEY', 'REPORTED'], ...tally((pair) => [...pair.via])]),
    'Every pair of these files:',
    ...expected.map(
      ([id, pair]) => `- ${reported.has(id) ? 'reported' : 'missing '}  ${id}  (${[...pair.via].sort().join(', ')})`,
    ),
  );

  // What Salesforce reports from a component of a type that only these files have, and the key does not hold.
  const fixture = fixtureKeys();
  const only = new Set([...types].filter((type) => !otherTypes.has(type)));
  const extra = [...reported].filter((id) => !pairs.has(id) && only.has(typeOf(id))).sort();
  const ours = extra.filter((id) => {
    const [from = '', to = ''] = id.split(' -> ');
    return fixture.has(from) && fixture.has(to) && log.clean(id);
  });
  lines.push(
    `Pairs the Dependency API reports from a component of the types ${[...only].sort().join(', ')} that the answer key does not hold: ${String(extra.length)}.`,
    ...ours.slice(0, PAIRS_SHOWN).map((id) => `- ${id}`),
  );
  if (ours.length > PAIRS_SHOWN)
    lines.push(`- and ${String(ours.length - PAIRS_SHOWN)} more pairs of the fixture project.`);
  if (ours.length < extra.length) {
    lines.push(
      `- ${plural(extra.length - ours.length, 'pair has', 'pairs have')} a component that is not of the fixture project, and ${extra.length - ours.length === 1 ? 'is' : 'are'} not named.`,
    );
  }
  return lines;
}

/**
 * Which version of each flow of the fixture project the org handed out: the state its file names, beside the
 * state the file of the repository names. The tool that deploys can send one flow once more as a draft
 * (`deploy-fixture.ts draft`). After that the org holds an active version of it and a newer draft, as run 21 of
 * the workflow showed on the test org. Of that flow it is said which of the two the file from the org is, by the
 * places in which the draft differs.
 *
 * `fileOf`: the text of a file of the snapshot, or `null` if the snapshot does not hold it.
 */
export function flowLines(log: PublicLog, fileOf: (path: string) => string | null): string[] {
  const flows = (answerKey().components?.['Flow'] ?? []).filter((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name));
  if (flows.length === 0) return [];
  const ours = fixtureFiles();
  const state = (text: string | null): string =>
    text === null ? 'no file' : (log.name(/<status>([A-Za-z]+)<\/status>/.exec(text)?.[1]) ?? 'no state');
  const rows = [['FLOW', 'STATE HERE', 'STATE FROM THE ORG']];
  let draft: string | null = null;
  for (const name of flows) {
    const path = `flows/${name}.flow-meta.xml`;
    const theirs = fileOf(path);
    rows.push([name, state(ours.get(path)?.toString('utf8') ?? null), state(theirs)]);
    if (name === FLOW_WITH_DRAFT) draft = theirs;
  }
  const lines = ['', 'The flows of the fixture project, by the state the file names:', ...table(rows)];
  if (draft !== null) {
    const { ofDraft, ofActive, all } = draftPlaces(draft);
    lines.push(
      `${FLOW_WITH_DRAFT} is the flow that the step "draft" sends once more as a draft, which differs in ${String(all)} places. ` +
        (ofDraft === all && ofActive === 0
          ? 'The file from the org is the draft.'
          : ofActive === all && ofDraft === 0
            ? 'The file from the org is the version that was sent as active.'
            : `The file from the org has ${String(ofDraft)} of them as the draft has them and ${String(ofActive)} as the version that was sent as active.`),
    );
  }
  return lines;
}

/** A word of the engine for a kind of reference, such as `lookup-filter`, or a marker. */
const reasonWord = (value: string): string => (/^[a-z][a-z-]{0,39}$/.test(value) ? value : '(not shown)');

/**
 * Says what the cross-check of the snapshot found. A pair is named if both of its components are of the fixture
 * project, and counted otherwise. Returns what the step makes of it: `ok`, or why it fails.
 */
export function crossCheckLines(log: PublicLog, crossCheck: CrossCheckReport | null): 'ok' | 'not compared' | 'missed' {
  log.say('');
  log.say('The cross-check with the Dependency API of Salesforce (MetadataComponentDependency)');
  if (crossCheck === null) {
    log.say('The snapshot holds nothing of the Dependency API: it was not asked.');
    return 'not compared';
  }
  if (crossCheck.state === 'none') {
    log.say(
      `The Dependency API gave no answer (${log.code(crossCheck.code) ?? 'a code that is not shown'}), after ${plural(crossCheck.requests, 'request', 'requests')}. Nothing was compared.`,
    );
    return 'not compared';
  }
  const left = crossCheck.queriesCutOff + crossCheck.queriesFailed;
  log.say(
    `Rows: ${String(crossCheck.rows)}, read with ${plural(crossCheck.requests, 'request', 'requests')}. ` +
      (crossCheck.state === 'whole'
        ? 'No query left a row out.'
        : `Rows are missing: ${plural(crossCheck.queriesCutOff, 'query was', 'queries were')} cut off at the limit, ${String(crossCheck.queriesFailed)} failed (${log.code(crossCheck.code) ?? 'a code that is not shown'}).`),
  );
  const { comparison } = crossCheck;
  if (comparison === null) {
    log.say('The rows were not compared: the snapshot has no analysis with a comparison.');
    return 'not compared';
  }

  // The type of a row is the name of a metadata type, or what the API writes in its place. Only a name of a
  // metadata type is shown.
  const byType = new Map<string, number>();
  for (const { type, rows } of comparison.notAnalysed) {
    const shown = log.name(type) ?? '(a type that is not shown)';
    byType.set(shown, (byType.get(shown) ?? 0) + rows);
  }
  log.say(
    `Rows from a component of a type that this phase does not analyse, which are not compared: ${String(comparison.rowsNotAnalysed)}` +
      (byType.size > 0 ? ` (${tallied(byType)}).` : '.'),
  );
  log.say(
    `Rows with an end that is no component the org listed: ${String(comparison.rowsNotMatched)}. ` +
      `Rows from a component the snapshot does not hold or that was not analysed: ${String(comparison.rowsNotHeld)}.`,
  );
  log.say(
    `Rows compared: ${String(comparison.rowsCompared)}, which are ${plural(comparison.pairs, 'pair', 'pairs')} of components. ` +
      `The analysis has ${String(comparison.agreed)} of them, has ${String(comparison.coveredByPart)} as a reference to a part of the object Salesforce names, and missed ${String(comparison.missed.length)}.`,
  );

  const fixture = fixtureKeys();
  const list = (pairs: readonly CrossCheckPair[], what: string): void => {
    const ours = pairs.filter(({ from, to }) => fixture.has(from) && fixture.has(to) && log.clean(`${from} ${to}`));
    for (const { from, to } of ours.slice(0, PAIRS_SHOWN)) log.say(`- ${what}  ${from} -> ${to}`);
    if (ours.length > PAIRS_SHOWN)
      log.say(`- and ${String(ours.length - PAIRS_SHOWN)} more pairs of the fixture project.`);
    if (ours.length < pairs.length) {
      log.say(
        `- ${plural(pairs.length - ours.length, 'pair has', 'pairs have')} a component that is not of the fixture project, and ${pairs.length - ours.length === 1 ? 'is' : 'are'} not named.`,
      );
    }
  };
  list(comparison.missed, 'missed');
  log.say(
    `References of the analysis of a kind Salesforce reports, for which it has no row: ${String(comparison.onlyOrgLens.length)}.`,
  );
  list(comparison.onlyOrgLens, 'only OrgLens');
  const reasons = new Map(comparison.notReported.map(({ reason, pairs }) => [reasonWord(reason), pairs]));
  log.say(
    `References of the analysis of kinds the API does not report: ${String([...reasons.values()].reduce((sum, pairs) => sum + pairs, 0))}` +
      (reasons.size > 0 ? ` (${tallied(reasons)}).` : '.'),
  );
  if (left > 0) {
    log.say('::warning::Rows of the Dependency API are missing. A reference the analysis missed can go unseen.');
  }
  return comparison.missed.length > 0 ? 'missed' : 'ok';
}

const rowIdentity = ({ from, to }: DependencyRow): string =>
  [from.type, from.id, from.name, from.namespace ?? '', to.type, to.id, to.name, to.namespace ?? ''].join('\u0000');

/**
 * The session of an org that gives at most `limit` rows for a query and says that the answer has ended, as
 * Salesforce does at 2,000 rows. Every request goes to the org as it is. Only the answer is shortened. A
 * request that fails is told to `failed` and fails as it did.
 */
function cutOffAt(session: OrgSession, limit: number, failed: (url: string, error: unknown) => void): OrgSession {
  const request = async (url: string, options: unknown): Promise<unknown> => {
    let page: { records?: unknown } | null;
    try {
      page = await session.connection.request<{ records?: unknown } | null>(url, options as never);
    } catch (error) {
      try {
        failed(url, error);
      } catch {
        // What the log is told must not change what the reader sees: the request fails as it did.
      }
      throw error;
    }
    return page !== null && Array.isArray(page.records) && page.records.length > limit
      ? { ...page, records: page.records.slice(0, limit), done: true }
      : page;
  };
  return { ...session, connection: { request } as never };
}

/** A query of the reader: what it selects, the one object, and a condition or none. */
const QUERY = /^SELECT [A-Za-z, ]+ FROM MetadataComponentDependency(?: WHERE (.+))?$/;
/**
 * A part of a condition as the reader of the engine writes it: one of three fields, and one value in quotes
 * or a list of them in brackets.
 */
const CONDITION =
  /^(MetadataComponentType|RefMetadataComponentType|MetadataComponentId) (?:(=) ('[^']*')|(IN|NOT IN) \(('[^']*'(?:, '[^']*')*)\))$/;
/** The request for the next page of an answer. It holds no query. */
const NEXT_PAGE = /^\/services\/data\/v\d{1,3}\.\d\/tooling\/query\/[A-Za-z0-9_-]+$/;

/**
 * The condition of a query of the reader, as the log may show it. The name of a type is shown where it has the
 * form of a word of the Metadata API. In the place of the ids stands their number. Nothing else of a request
 * is shown: a request that is no query of the reader, or a part of a condition in another form, is only said
 * to be there.
 */
export function conditionForm(log: PublicLog, url: string): string {
  let soql: string | null;
  let path: string;
  try {
    const address = new URL(url, 'https://org.invalid');
    soql = address.searchParams.get('q');
    path = address.pathname;
  } catch {
    return '(a request that is not shown)';
  }
  if (soql === null) return NEXT_PAGE.test(path) ? '(the next page of an answer)' : '(a request that is not shown)';
  const query = QUERY.exec(soql);
  if (query === null) return '(a request that is not shown)';
  const where = query[1];
  if (where === undefined) return 'no condition';
  return where
    .split(' AND ')
    .map((condition) => {
      const [, field, equals, value, operator, values] = CONDITION.exec(condition) ?? [];
      if (field === undefined) return '(a condition that is not shown)';
      const quoted = [...(value ?? values ?? '').matchAll(/'([^']*)'/g)].map((one) => one[1] ?? '');
      const sign = equals ?? operator ?? '';
      if (field === 'MetadataComponentId') return `${field} ${sign} (${plural(quoted.length, 'id', 'ids')})`;
      const names = quoted.map((one) => log.name(one) ?? '(a type that is not shown)');
      return equals === undefined ? `${field} ${sign} (${names.join(', ')})` : `${field} = ${names.join(', ')}`;
    })
    .join(' AND ');
}

/** A request that failed: its address, and what was thrown. */
export interface FailedRequest {
  readonly url: string;
  readonly error: unknown;
}

/**
 * The lines about the requests of a reading that failed, or none: by the form of the condition and the code of
 * the failure, how many different queries had it and how often they were sent. The reader sends a request
 * again when it got no answer, so one query can be several requests.
 */
export function failedRequestLines(log: PublicLog, failures: readonly FailedRequest[]): string[] {
  const byForm = new Map<string, { readonly queries: Set<string>; requests: number }>();
  for (const { url, error } of failures) {
    const code = log.code(requestFailure(error).code) ?? 'a code that is not shown';
    const form = `${conditionForm(log, url)}: ${code}`;
    const ofForm = byForm.get(form) ?? { queries: new Set<string>(), requests: 0 };
    ofForm.queries.add(url);
    ofForm.requests += 1;
    byForm.set(form, ofForm);
  }
  if (byForm.size === 0) return [];
  const forms = [...byForm].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const queries = forms.reduce((sum, [, ofForm]) => sum + ofForm.queries.size, 0);
  // This is not the number of queries that failed in the line before: a request that is answered when it is
  // sent again is counted here, and a query whose rows other queries gave is not counted there.
  const lines = [
    `Requests of this reading that failed: ${String(failures.length)}, for ${plural(queries, 'different query', 'different queries')}. A request that was answered when it was sent again is among them. ` +
      'By the condition of the query, with the number of ids in the place of the ids, and the code of the failure:',
  ];
  for (const [form, ofForm] of forms.slice(0, CONDITIONS_SHOWN)) {
    lines.push(`- ${form}. Queries: ${String(ofForm.queries.size)}. Requests: ${String(ofForm.requests)}.`);
  }
  if (forms.length > CONDITIONS_SHOWN) {
    lines.push(`- and ${String(forms.length - CONDITIONS_SHOWN)} more forms of a condition.`);
  }
  return lines;
}

/** Rows counted by the types of their two ends, as the log may show them. */
export function rowsByTypes(log: PublicLog, rows: readonly DependencyRow[]): string {
  const shown = (type: string): string => log.name(type) ?? '(a type that is not shown)';
  const pairs = new Map<string, number>();
  for (const { from, to } of rows) {
    const pair = `${shown(from.type)} to ${shown(to.type)}`;
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return [...pairs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([pair, count]) => `${pair} ${String(count)}`)
    .join(', ');
}

/**
 * Reads the rows of the Dependency API twice more: with one query, as the snapshot did, and then through a
 * session that cuts every answer off at a few rows. So the engine has to ask per type, per pair of types and
 * per component, and the org has to answer each of those queries. The two readings follow each other at once,
 * so that the org has no time to change between them: the rows of the snapshot are minutes old.
 *
 * Returns false if the reading in parts gives a row the one query did not give, or if the engine calls it whole
 * and it lacks one.
 */
export async function readInParts(
  log: PublicLog,
  session: OrgSession,
  store: Store,
  snapshotId: number,
  apiVersion: string | null,
  limit = PRETENDED_LIMIT,
): Promise<boolean> {
  const version = apiVersion === null ? {} : { apiVersion };
  const one = await readDependencies(session, version);
  if (one.state !== 'whole') {
    log.say('One query did not give every row this time, so reading them in parts was not tried.');
    return true;
  }
  if (one.rows.length < limit) {
    log.say(`The org holds fewer than ${String(limit)} rows, so reading them in parts was not tried.`);
    return true;
  }
  const ids = new Map<string, string[]>();
  for (const item of readListedIds(store, snapshotId)) {
    if (item.id === null) continue;
    const ofType = ids.get(item.type);
    if (ofType === undefined) ids.set(item.type, [item.id]);
    else ofType.push(item.id);
  }
  const failures: FailedRequest[] = [];
  const again = await readDependencies(
    cutOffAt(session, limit, (url, error) => {
      failures.push({ url, error });
    }),
    { ...version, limits: { rowsPerQuery: limit }, idsOfType: (type) => ids.get(type) ?? [] },
  );
  const whole = new Set(one.rows.map(rowIdentity));
  const parts = new Set(again.rows.map(rowIdentity));
  const lackingRows = one.rows.filter((row) => !parts.has(rowIdentity(row)));
  const moreRows = again.rows.filter((row) => !whole.has(rowIdentity(row)));
  const lacking = lackingRows.length;
  const more = moreRows.length;
  log.say(
    `Read once more with every answer cut off at ${String(limit)} rows: ${plural(again.requests, 'request', 'requests')}, ${plural(again.rows.length, 'row', 'rows')}, and the engine calls the reading ${log.name(again.state) ?? 'something that is not shown'}. ` +
      `Queries still at that number for a single component, or with no smaller part to ask for: ${String(again.cutOff)}. ` +
      `Queries that failed: ${String(again.failed)}${again.failed > 0 ? ` (${log.code(again.code) ?? 'a code that is not shown'})` : ''}. ` +
      `Queries asked again per component, for more components than one query names: ${String(again.unproven)}.`,
  );
  for (const line of failedRequestLines(log, failures)) log.say(line);
  if (failures.length === 0 && again.failed > 0) {
    log.say('No request of this reading failed. The queries that failed ended for another reason.');
  }
  log.say(
    lacking === 0 && more === 0
      ? 'The parts give the same rows as one query just before.'
      : `The parts lack ${plural(lacking, 'row', 'rows')} of the one query just before, and give ${plural(more, 'row', 'rows')} it does not have.`,
  );
  if (lacking > 0)
    log.say(`The rows the parts lack, by the types of their two ends: ${rowsByTypes(log, lackingRows)}.`);
  if (more > 0) log.say(`The rows only the parts give, by the types of their two ends: ${rowsByTypes(log, moreRows)}.`);
  if (again.failed > 0) {
    log.say('::warning::The org refused a query the engine asks when a query is at the limit of rows.');
  }
  // A reading that says that rows are missing may lack rows. One that says it is whole may not.
  return again.state === 'whole' ? lacking === 0 && more === 0 : more === 0;
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
  let session: OrgSession;
  try {
    session = await connectToOrg(SOURCE, undefined, env);
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
    } else if (event.step === 'flow-versions') {
      log.say(
        `After ${elapsed} s: ${plural(event.flows, 'flow has', 'flows have')} a latest version that is not active. The active version of each is asked for by its number.`,
      );
    }
  };

  try {
    let failure: unknown;
    let taken: CoverageReport['snapshot'] | undefined;
    let crossCheck: CrossCheckReport | null = null;
    try {
      const workspace = await openWorkspace({ root, env });
      const report = await workspace.snapshot(SOURCE_NAME, { onProgress });
      taken = report.snapshot;
      crossCheck = report.crossCheck;
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
    let compared: ReturnType<typeof crossCheckLines> = 'ok';
    let sameInParts = true;
    if (existsSync(database)) {
      const store = openStore({ path: database, readOnly: true });
      try {
        const row = store.get(
          `SELECT s.id FROM snapshot s JOIN source o ON o.id = s.source_id WHERE o.name = ? ORDER BY s.id DESC LIMIT 1`,
          SOURCE_NAME,
        );
        if (row !== undefined) fixtureWhole = describe(log, store, count(row['id']));
        // The cross-check is of a snapshot that ended. One that did not end has not asked the API yet.
        if (row !== undefined && taken !== undefined) {
          // What Salesforce reports for the files no analyser reads yet, which the cross-check leaves out.
          if (crossCheck !== null && crossCheck.state !== 'none') {
            const rows = readDependencyRows(store, taken.id);
            for (const line of phaseLines(log, rows, readListedIds(store, taken.id))) log.say(line);
          }
          compared = crossCheckLines(log, crossCheck);
          if (crossCheck?.state === 'whole') {
            sameInParts = await readInParts(log, session, store, taken.id, taken.apiVersion);
          }
        }
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
    } else if (compared === 'not compared') {
      log.say('');
      log.fail(['The analysis of the snapshot was not held against the Dependency API. The lines above say why.']);
    } else if (compared === 'missed') {
      log.say('');
      log.fail([
        'The analysis missed a reference that Salesforce reports. The lines above name it where it is of the fixture project.',
      ]);
    } else if (!sameInParts) {
      log.say('');
      log.fail([
        'Reading the Dependency API in parts gave other rows than one query just before. The lines above say how many. If the org was changed in that moment, a second run tells.',
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
