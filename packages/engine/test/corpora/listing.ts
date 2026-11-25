/**
 * Lists what a check by hand needs: every formula field, default value, validation rule, lookup filter and
 * roll-up summary of the public codebases of `fixtures/corpora.toml`, each with its text as the file holds it
 * and with the references and issues the analysis reports for it.
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

/** The parts of a file that are entries, cut out as text. */
function entriesOfFile(text: string): { kind: EntryKind; text: string }[] {
  const found: { kind: EntryKind; text: string }[] = [];
  const all = (pattern: RegExp): string[] => [...text.matchAll(pattern)].map((match) => match[1] ?? '');
  for (const body of all(/<formula>([\s\S]*?)<\/formula>/g)) found.push({ kind: 'formula', text: decoded(body) });
  for (const body of all(/<errorConditionFormula>([\s\S]*?)<\/errorConditionFormula>/g)) {
    found.push({ kind: 'rule', text: decoded(body) });
  }
  for (const body of all(/<defaultValue>([\s\S]*?)<\/defaultValue>/g)) {
    if (decoded(body) !== '') found.push({ kind: 'default', text: decoded(body) });
  }
  for (const body of all(/<lookupFilter>([\s\S]*?)<\/lookupFilter>/g)) {
    found.push({ kind: 'filter', text: decoded(body.replace(/^\s+/gm, '')) });
  }
  const summary = all(
    /(<(summarizedField|summaryForeignKey|summaryOperation)>[\s\S]*?<\/\2>|<summaryFilterItems>[\s\S]*?<\/summaryFilterItems>)/g,
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
  const rest = text.replace(/<(fields|validationRules)>([\s\S]*?)<\/\1>/g, (whole, group: string, body: string) => {
    // A compact layout names its fields as `<fields>Name</fields>`: such a group has no name of its own.
    const name = /<fullName>([^<]*)<\/fullName>/.exec(body)?.[1];
    if (name === undefined) return whole;
    parts.push({ key: buildKey({ type: PARTS[group] ?? group, fullName: `${object}.${name}` }), text: body });
    return '';
  });
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
  }
}
