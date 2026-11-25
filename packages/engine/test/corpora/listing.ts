/**
 * Lists what a check by hand needs: every formula field, default value, validation rule, lookup filter and
 * roll-up summary of the public codebases of `fixtures/corpora.toml`, each with its text as the file holds it
 * and with the references and issues the analysis reports for it. A second listing, of Phase 2, holds every flow
 * with each of its elements, every rule and action of a file of workflow rules, every record type and every field
 * set, each with every reference and issue of its component. It reads the folders of `FLOW_FOLDERS` where a
 * codebase keeps flows outside its package folders.
 *
 *   pnpm run corpora:listing              every codebase that was downloaded
 *   pnpm run corpora:listing pmm npsp     the named ones
 *   pnpm run corpora:listing --short pmm  without the default values that are a literal and have no reference
 *
 * The text of an entry is cut out of the file as text, not read with the reader of the engine, so that the
 * listing shows what the reader may have missed. The codebases are not part of this repository
 * (`pnpm run corpora:fetch`), and the listing is printed, not stored: it holds their text. The numbers of each
 * codebase go to the error output: its entries, the time of the analysis, and its references by each of their
 * properties.
 */
import { hash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { buildKey } from '../../src/core/keys.ts';
import type { Reference } from '../../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../../src/extraction/analyse.ts';
import { KINDS } from '../../src/extraction/flows.ts';
import { readFolders } from '../../src/sources/folder.ts';
import { resolveComponents } from '../../src/sources/resolve.ts';

/** What an entry of the listing is, by the element that makes it one. */
export type EntryKind = 'formula' | 'default' | 'rule' | 'filter' | 'summary';

export interface ListingEntry {
  readonly kind: EntryKind;
  readonly file: string;
  /** The key of the component the file defines, or `null` if the analysis has no component for the file. */
  readonly key: string | null;
  /** The text to check: a formula with its entities undone, or the elements of a filter or a summary. */
  readonly text: string;
  /**
   * The references of the component that belong to this entry, as lines. They are chosen by `via`, so a
   * component with two entries of one `via` would show the references of both under each. No component of the
   * codebases has two entries, and the test that holds the check says so.
   */
  readonly references: readonly string[];
  /** The issues of the analysis about the component, as lines. */
  readonly issues: readonly string[];
}

export interface Listing {
  readonly entries: readonly ListingEntry[];
  /** The analysis of the whole codebase, for the numbers of the note. */
  readonly analysis: SourceAnalysis;
  /** The time of `analyseSource` alone: without the reading of the folders and the listing of the components. */
  readonly milliseconds: number;
}

const ENTITY: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
/** A text of a file with its entities undone, and with the line ends of every system as one. */
const decoded = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => ENTITY[name] ?? '')
    .trim();

/**
 * The `via` of the references that belong to an entry of a kind. The conditions of a roll-up summary are read
 * as a filter, and no field has a lookup filter and a summary.
 */
const VIA: Readonly<Record<EntryKind, readonly string[]>> = {
  formula: ['formula'],
  default: ['formula'],
  rule: ['formula'],
  filter: ['filter'],
  summary: ['summary', 'filter'],
};

/** A default value that is a literal and can hold no name: a number, a text in quotes, or true or false. */
export const isLiteral = (formula: string): boolean =>
  /^(?:true|false|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')$/i.test(formula.trim());

/** How the source names the target of a reference, as the analysis says it in `attrs.via`. */
export function viaOf(reference: Reference): string {
  const via = reference.attrs?.['via'];
  return typeof via === 'string' ? via : 'none';
}

function lineOf(reference: Reference): string {
  const place =
    reference.location === undefined
      ? ''
      : ` at ${String(reference.location.line)}:${String(reference.location.column ?? 0)}`;
  const rest = Object.entries(reference.attrs ?? {}).filter(([name]) => name !== 'via');
  const more = rest.length === 0 ? '' : ` ${JSON.stringify(Object.fromEntries(rest))}`;
  const target = reference.to ?? `"${reference.toNameRaw}"`;
  return (
    `${reference.kind} ${reference.toType} ${target} [${reference.confidence}, ${reference.resolution}] ` +
    `via ${viaOf(reference)}, written "${reference.toNameRaw}"${place}${more}`
  );
}

/**
 * The parts of a file that are entries, cut out as text. A tag can end on a line of its own (`<formula\n    >`), as a
 * formatter writes it.
 */
function entriesOfFile(text: string): { kind: EntryKind; text: string }[] {
  const found: { kind: EntryKind; text: string }[] = [];
  const all = (pattern: RegExp): string[] => [...text.matchAll(pattern)].map((match) => match[1] ?? '');
  for (const body of all(/<formula\s*>([\s\S]*?)<\/formula\s*>/g)) found.push({ kind: 'formula', text: decoded(body) });
  for (const body of all(/<errorConditionFormula\s*>([\s\S]*?)<\/errorConditionFormula\s*>/g)) {
    found.push({ kind: 'rule', text: decoded(body) });
  }
  for (const body of all(/<defaultValue\s*>([\s\S]*?)<\/defaultValue\s*>/g)) {
    if (decoded(body) !== '') found.push({ kind: 'default', text: decoded(body) });
  }
  for (const body of all(/<lookupFilter\s*>([\s\S]*?)<\/lookupFilter\s*>/g)) {
    found.push({ kind: 'filter', text: decoded(body.replace(/^\s+/gm, '')) });
  }
  const summary = all(
    /(<(summarizedField|summaryForeignKey|summaryOperation)\s*>[\s\S]*?<\/\2\s*>|<summaryFilterItems\s*>[\s\S]*?<\/summaryFilterItems\s*>)/g,
  );
  if (summary.length > 0) {
    found.push({ kind: 'summary', text: decoded(summary.map((one) => one.replace(/\s+/g, ' ')).join('\n')) });
  }
  return found;
}

/** The files whose entries are listed: those of fields, validation rules and objects. */
export const LISTED_FILE = /\.(?:field|validationRule|object)(?:-meta\.xml)?$/;

/** The groups of a file of an object in the metadata format that are components with entries of their own. */
const PARTS: Readonly<Record<string, string>> = { fields: 'CustomField', validationRules: 'ValidationRule' };

/**
 * The parts of a file, each with the key of the component it is of. A file of an object in the metadata format,
 * such as `objects/Contact.object`, holds every field and rule of the object: each of them is a part, and what is
 * left is a part of the object. Any other file is one part, of the component the file defines.
 */
function partsOf(file: string, text: string): { readonly key: string | null; readonly text: string }[] {
  const object = /(?:^|\/)([^/]+)\.object$/.exec(file)?.[1];
  if (object === undefined) return [{ key: null, text }];
  const parts: { key: string | null; text: string }[] = [];
  const rest = text.replace(
    /<(fields|validationRules)\s*>([\s\S]*?)<\/\1\s*>/g,
    (whole, group: string, body: string) => {
      // A compact layout names its fields as `<fields>Name</fields>`: such a group has no name of its own.
      const name = /<fullName\s*>([^<]*)<\/fullName\s*>/.exec(body)?.[1];
      if (name === undefined) return whole;
      parts.push({ key: buildKey({ type: PARTS[group] ?? group, fullName: `${object}.${name}` }), text: body });
      return '';
    },
  );
  return [{ key: buildKey({ type: 'CustomObject', fullName: object }), text: rest }, ...parts];
}

export async function listCodebase(root: string, paths: readonly string[]): Promise<Listing> {
  const { tree } = readFolders(root, paths);
  const listed = (await resolveComponents(tree, paths)).components;
  const start = performance.now();
  const analysis = analyseSource(tree, listed);
  const milliseconds = performance.now() - start;
  const byFile = new Map(analysis.components.map((one) => [one.definition?.path ?? '', one]));
  const byKey = new Map(analysis.components.map((one) => [String(one.key), one]));
  const entries: ListingEntry[] = [];
  for (const file of tree.files) {
    if (!LISTED_FILE.test(file)) continue;
    for (const part of partsOf(file, Buffer.from(tree.read(file)).toString('utf8'))) {
      const component = part.key === null ? byFile.get(file) : byKey.get(part.key);
      // An issue without a component is of no entry, and neither is one of a file without a component.
      const issues =
        component === undefined ? [] : analysis.issues.filter((issue) => issue.componentKey === component.key);
      for (const entry of entriesOfFile(part.text)) {
        entries.push({
          ...entry,
          file,
          key: component?.key ?? null,
          references: (component?.references ?? []).filter((one) => VIA[entry.kind].includes(viaOf(one))).map(lineOf),
          issues: issues.map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`),
        });
      }
    }
  }
  return { entries, analysis, milliseconds };
}

/** The listing as text: what was read by hand. `withLiterals` false leaves out the default values that are literals. */
function printed(name: string, listing: Listing, withLiterals = true): string {
  const lines: string[] = [`# ${name}`];
  for (const entry of listing.entries) {
    if (!withLiterals && entry.kind === 'default' && isLiteral(entry.text) && entry.references.length === 0) continue;
    lines.push('', `## ${entry.kind} ${entry.key ?? '(no component)'}`, entry.file, '', entry.text, '');
    lines.push(...(entry.references.length === 0 ? ['(no reference)'] : entry.references.map((one) => `-> ${one}`)));
    lines.push(...entry.issues.map((one) => `!! ${one}`));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The SHA-256 of the whole listing. A check by hand is recorded with it, so that a test can say when the
 * listing is no longer the one that was checked.
 */
export const digestOf = (name: string, listing: Listing): string => hash('sha256', printed(name, listing), 'hex');

/**
 * What an entry of the listing of Phase 2 is: a flow without its elements, an element or resource of a flow, a
 * rule or an action of a file of workflow rules, a record type, or a field set.
 */
export type MoreKind = 'flow' | 'element' | 'workflow' | 'record-type' | 'field-set';

export interface MoreEntry {
  readonly kind: MoreKind;
  readonly file: string;
  /** The key of the component, or `null` if the analysis has no component for it. */
  readonly key: string | null;
  /**
   * The attributes the analysis gives the component, as JSON: such as whether it is active, the status and the
   * type of a flow, and the kind of an element. An answer carries `active` through the component.
   */
  readonly attrs: string;
  /** The element of the file, cut out as text and printed in short: one line for each value. */
  readonly text: string;
  /** Every reference of the component, as lines. Each component has one entry. */
  readonly references: readonly string[];
  /** The issues of the analysis about the component, as lines. */
  readonly issues: readonly string[];
}

export interface MoreListing {
  readonly entries: readonly MoreEntry[];
  readonly analysis: SourceAnalysis;
  readonly milliseconds: number;
}

/**
 * The folders whose flows, workflow rules, record types and field sets are listed, where they are not the package
 * folders of the manifest. Most flows of the codebases stand outside the package: in recipes, in tests and in the
 * settings of a developer org. The folders are read with the package folders the flows need for their objects.
 */
export const FLOW_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  'nebula-logger': [
    'nebula-logger/core',
    'nebula-logger/recipes',
    'nebula-logger/extra-tests',
    'nebula-logger/plugins/async-failure-additions/plugin',
  ],
  pmm: ['force-app', 'unpackaged/config/dev'],
};

/** An element of a file, read as text without the reader of the engine. */
interface Node {
  readonly tag: string;
  /** The text of an element that holds no element, with its entities undone. */
  text: string;
  readonly children: Node[];
}

const NUMBERED = /&#(x?)([0-9A-Fa-f]+);/g;
/** A text of a file with every entity undone, numbered ones too. A text in CDATA keeps what it holds. */
const undone = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(NUMBERED, (_, hex: string, code: string) =>
      String.fromCodePoint(Number.parseInt(code, hex === '' ? 10 : 16)),
    )
    .replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => ENTITY[name] ?? '');

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/?)>|[^<]+/g;

/** The root element of a file of XML, as a tree of elements. */
function treeOf(text: string): Node {
  const top: Node = { tag: '', text: '', children: [] };
  const open: { node: Node; text: string[] }[] = [{ node: top, text: [] }];
  for (const [whole, cdata, close, tag, empty] of text.matchAll(TOKEN)) {
    const current = open.at(-1);
    if (current === undefined) break;
    if (tag === undefined) {
      if (cdata !== undefined) current.text.push(cdata.replaceAll('&', '&amp;'));
      else if (!whole.startsWith('<')) current.text.push(whole);
      continue;
    }
    if (close === '/') {
      const done = open.pop();
      if (done !== undefined) done.node.text = done.node.children.length === 0 ? undone(done.text.join('')).trim() : '';
      continue;
    }
    const node: Node = { tag, text: '', children: [] };
    current.node.children.push(node);
    if (empty !== '/') open.push({ node, text: [] });
  }
  const root = top.children[0];
  if (root === undefined) throw new Error('The file holds no element.');
  return root;
}

const childText = (node: Node, tag: string): string | undefined => node.children.find((one) => one.tag === tag)?.text;

/** Values of the builder that say where an element stands on its canvas, and nothing else. */
const PLACES: ReadonlySet<string> = new Set(['locationX', 'locationY']);

/**
 * An element in short. A value is one line, `tag: text`, and a text of several lines is shown with a bar before
 * each line. An element that holds only values on one line each is one line, `tag: a=1, b=2`.
 */
function shown(node: Node, depth = 0): string[] {
  const pad = '  '.repeat(depth);
  if (node.children.length === 0) {
    if (!node.text.includes('\n')) return [`${pad}${node.tag}: ${node.text}`];
    return [`${pad}${node.tag}:`, ...node.text.split('\n').map((line) => `${pad}  | ${line}`)];
  }
  const children = node.children.filter((one) => !PLACES.has(one.tag));
  if (children.every((one) => one.children.length === 0 && !one.text.includes('\n'))) {
    return [`${pad}${node.tag}: ${children.map((one) => `${one.tag}=${one.text}`).join(', ')}`];
  }
  return [`${pad}${node.tag}:`, ...children.flatMap((one) => shown(one, depth + 1))];
}

/** The type of each part of a file of workflow rules, by the group that holds it. */
const WORKFLOW_GROUPS: Readonly<Record<string, string>> = {
  alerts: 'WorkflowAlert',
  fieldUpdates: 'WorkflowFieldUpdate',
  flowActions: 'WorkflowFlowAction',
  knowledgePublishes: 'WorkflowKnowledgePublish',
  outboundMessages: 'WorkflowOutboundMessage',
  rules: 'WorkflowRule',
  send: 'WorkflowSend',
  tasks: 'WorkflowTask',
};

/** The files whose entries the listing of Phase 2 shows. */
const MORE_FILE = /\.(?:flow|workflow|recordType|fieldSet|object)(?:-meta\.xml)?$/;
/** The name a file gives the component it defines, from its name alone: `Invoice__c` of `Invoice__c.workflow`. */
const baseName = (file: string): string => (file.split('/').at(-1) ?? '').replace(/\.[^.]+(?:-meta\.xml)?$/, '');

/** The parts of a file that are entries of Phase 2, each with the key of its component. */
function morePartsOf(
  file: string,
  root: Node,
  flowName: string | undefined,
): Omit<MoreEntry, 'attrs' | 'references' | 'issues'>[] {
  const entry = (kind: MoreKind, key: string | null, node: Node | readonly Node[]) => ({
    kind,
    file,
    key,
    text: ('tag' in node ? [node] : node).flatMap((one) => shown(one)).join('\n'),
  });
  if (root.tag === 'Flow') {
    // The name of the flow is the one the analysis gives the component of the file.
    if (flowName === undefined) return [entry('flow', null, root.children)];
    const elements = root.children.filter((one) => KINDS.has(one.tag));
    return [
      entry(
        'flow',
        buildKey({ type: 'Flow', fullName: flowName }),
        root.children.filter((one) => !KINDS.has(one.tag)),
      ),
      ...elements.map((one) => {
        const name = one.tag === 'start' ? 'flow-start' : childText(one, 'name');
        const key =
          name === undefined ? null : buildKey({ type: 'Flow', fullName: flowName, subs: [{ kind: 'element', name }] });
        return entry('element', key, one);
      }),
    ];
  }
  const object = baseName(file);
  if (root.tag === 'Workflow') {
    return root.children.flatMap((one) => {
      const name = childText(one, 'fullName');
      if (name === undefined) return [];
      const type = WORKFLOW_GROUPS[one.tag];
      return [entry('workflow', type === undefined ? null : buildKey({ type, fullName: `${object}.${name}` }), one)];
    });
  }
  // A record type or a field set in a file of its own, of the source format, names its object by its folder.
  const folder = file.split('/').at(-3) ?? '';
  if (root.tag === 'RecordType' || root.tag === 'FieldSet') {
    const name = childText(root, 'fullName') ?? baseName(file);
    const type = root.tag;
    return [
      entry(
        type === 'RecordType' ? 'record-type' : 'field-set',
        buildKey({ type, fullName: `${folder}.${name}` }),
        root,
      ),
    ];
  }
  // A file of an object in the metadata format holds its record types and field sets.
  if (root.tag !== 'CustomObject') return [];
  return root.children.flatMap((one) => {
    const name = childText(one, 'fullName');
    if (name === undefined || (one.tag !== 'recordTypes' && one.tag !== 'fieldSets')) return [];
    const type = one.tag === 'recordTypes' ? 'RecordType' : 'FieldSet';
    return [
      entry(
        type === 'RecordType' ? 'record-type' : 'field-set',
        buildKey({ type, fullName: `${object}.${name}` }),
        one,
      ),
    ];
  });
}

/**
 * Lists the flows with their elements, the rules and actions of the files of workflow rules, the record types and
 * the field sets of the folders, each with every reference and issue the analysis reports for its component.
 */
export async function listFlowsAndConfiguration(root: string, paths: readonly string[]): Promise<MoreListing> {
  const { tree } = readFolders(root, paths);
  const listed = (await resolveComponents(tree, paths)).components;
  const start = performance.now();
  const analysis = analyseSource(tree, listed);
  const milliseconds = performance.now() - start;
  const flowOfFile = new Map(
    analysis.components
      .filter((one) => one.key.startsWith('Flow:') && !one.key.includes('#'))
      .map((one) => [one.definition?.path ?? '', one.name]),
  );
  const byKey = new Map(analysis.components.map((one) => [String(one.key), one]));
  const entries: MoreEntry[] = [];
  for (const file of tree.files) {
    if (!MORE_FILE.test(file)) continue;
    for (const part of morePartsOf(file, treeOf(Buffer.from(tree.read(file)).toString('utf8')), flowOfFile.get(file))) {
      const component = part.key === null ? undefined : byKey.get(part.key);
      entries.push({
        ...part,
        key: component === undefined ? null : part.key,
        attrs: component === undefined ? '(no component)' : JSON.stringify(component.attrs),
        references: (component?.references ?? []).map(lineOf),
        issues: (component === undefined
          ? []
          : analysis.issues.filter((issue) => issue.componentKey === component.key)
        ).map((issue) => `${issue.severity} ${issue.code}: ${issue.message}`),
      });
    }
  }
  return { entries, analysis, milliseconds };
}

/** The listing of Phase 2 as text: what was read by hand. */
function printedMore(name: string, listing: MoreListing): string {
  const lines: string[] = [`# ${name}: flows and configuration`];
  for (const entry of listing.entries) {
    lines.push('', `## ${entry.kind} ${entry.key ?? '(no component)'}`, entry.file, `attrs ${entry.attrs}`, '');
    lines.push(entry.text, '');
    lines.push(...(entry.references.length === 0 ? ['(no reference)'] : entry.references.map((one) => `-> ${one}`)));
    lines.push(...entry.issues.map((one) => `!! ${one}`));
  }
  return `${lines.join('\n')}\n`;
}

/** The SHA-256 of the whole listing of Phase 2, as `digestOf` is of that of Phase 1. */
export const digestOfMore = (name: string, listing: MoreListing): string =>
  hash('sha256', printedMore(name, listing), 'hex');

/** The references of the whole codebase, counted by each of their properties, and the issues by their code. */
function numbersOf(analysis: SourceAnalysis): Record<string, Record<string, number>> {
  const counted = (values: readonly string[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
    return Object.fromEntries(Object.entries(counts).sort());
  };
  const references = analysis.components.flatMap((one) => one.references);
  return {
    via: counted(references.map(viaOf)),
    kind: counted(references.map((one) => one.kind)),
    toType: counted(references.map((one) => one.toType)),
    resolution: counted(references.map((one) => one.resolution)),
    confidence: counted(references.map((one) => one.confidence)),
    issues: counted(analysis.issues.map((issue) => issue.code)),
  };
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '../../../..');
  const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
    corpus: { name: string; paths: string[] }[];
  };
  const short = process.argv.includes('--short');
  const asked = process.argv.slice(2).filter((one) => one !== '--short');
  for (const { name, paths } of manifest.corpus) {
    if (asked.length > 0 && !asked.includes(name)) continue;
    const folder = join(root, '.corpora', name);
    if (!existsSync(folder)) {
      console.error(`${name}: not downloaded. Run "pnpm run corpora:fetch".`);
      continue;
    }
    const listing = await listCodebase(folder, paths);
    process.stdout.write(printed(name, listing, !short));
    console.error(
      `${name}: ${String(listing.entries.length)} entries, analysed in ${listing.milliseconds.toFixed(0)} ms, ` +
        `SHA-256 of the whole listing ${digestOf(name, listing)}`,
    );
    const entries: Record<string, number> = {};
    for (const entry of listing.entries) entries[entry.kind] = (entries[entry.kind] ?? 0) + 1;
    console.error(`  entries ${JSON.stringify(Object.fromEntries(Object.entries(entries).sort()))}`);
    console.error(`  components ${String(listing.analysis.components.length)}`);
    for (const [what, counts] of Object.entries(numbersOf(listing.analysis))) {
      console.error(`  ${what} ${JSON.stringify(counts)}`);
    }
    const more = await listFlowsAndConfiguration(folder, FLOW_FOLDERS[name] ?? paths);
    process.stdout.write(`\n${printedMore(name, more)}`);
    const kinds: Record<string, number> = {};
    for (const entry of more.entries) kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
    console.error(
      `${name}, flows and configuration: ${String(more.entries.length)} entries, analysed in ` +
        `${more.milliseconds.toFixed(0)} ms, SHA-256 of the whole listing ${digestOfMore(name, more)}`,
    );
    console.error(`  entries ${JSON.stringify(Object.fromEntries(Object.entries(kinds).sort()))}`);
    const references = more.entries.flatMap((entry) => entry.references).length;
    const issues = more.entries.flatMap((entry) => entry.issues).length;
    console.error(`  references ${String(references)}, issues ${String(issues)}`);
    // The references of the entries counted by the kind of the entry, with their kind, the type of their target,
    // their tier, their resolution and their way, as the note of the check gives them.
    const ways: Record<string, number> = {};
    for (const entry of more.entries) {
      for (const line of entry.references) {
        const parts = /^(\S+) (\S+) \S+ \[(\w+), (\w+)\] via ([^,]+),/.exec(line)?.slice(1) ?? [line];
        const counted = [entry.kind, ...parts].join(' ');
        ways[counted] = (ways[counted] ?? 0) + 1;
      }
    }
    for (const [counted, count] of Object.entries(ways).sort()) console.error(`  ${String(count)} ${counted}`);
  }
}
