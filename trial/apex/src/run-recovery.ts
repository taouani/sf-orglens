/**
 * Measures what each parser still delivers when a file is broken: the first tie-break of the plan.
 *
 *   node trial/apex/src/run-recovery.ts <folder> <how many files> <seed> [<file for the result as JSON>]
 *
 * A file takes part when both parsers read it without a problem, when the resolver finds the same references in
 * it with either parser, and when it has at least five of them. Of these files a sample is drawn. Each file of
 * the sample is damaged in five ways, one at a time: one character is deleted at a place the seed chooses, a
 * closing brace, an opening brace, a closing parenthesis, a semicolon or a quote of a text. Characters in
 * comments and in texts are not candidates.
 *
 * The damaged file is parsed and resolved alone, with the schema of the whole folder. The measure is what the
 * resolver still finds: how many references of the whole file are found again (same member, kind, target, way,
 * tier, line and word), how many are found again when the member they are counted to is left out of the
 * comparison, and how many references appear that the whole file does not have at all. The reference that stands
 * in the damaged statement can be lost by any parser.
 *
 * The same seed gives the same files and the same damage.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createApexParserAdapter } from './adapters/apex-parser.ts';
import { createTreeSitterAdapter } from './adapters/tree-sitter.ts';
import type { ApexFile } from './project.ts';
import { readApexFiles } from './project.ts';
import type { Found } from './resolver.ts';
import { analyse } from './resolver.ts';
import { readSchema } from './schema.ts';
import type { SyntaxAdapter } from './syntax.ts';

const [root, howMany, seedText, out] = process.argv.slice(2);
const wanted = Number(howMany ?? '200');
const seed = Number(seedText ?? '1');
if (root === undefined || !Number.isInteger(wanted) || wanted < 1 || !Number.isInteger(seed)) {
  throw new Error('Usage: run-recovery.ts <folder> <how many files> <seed> [<file for the result as JSON>]');
}

/** A small generator of random numbers with a seed (mulberry32). */
function random(from: number): () => number {
  let state = from >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAMAGE = ['closing brace', 'opening brace', 'closing parenthesis', 'semicolon', 'quote'] as const;
type Damage = (typeof DAMAGE)[number];
const CHARACTER: Record<Damage, string> = {
  'closing brace': '}',
  'opening brace': '{',
  'closing parenthesis': ')',
  semicolon: ';',
  quote: "'",
};

/** The places of each character of interest in the code of a file: not in a comment, and not inside a text. */
function places(source: string): Record<Damage, number[]> {
  const found: Record<Damage, number[]> = {
    'closing brace': [],
    'opening brace': [],
    'closing parenthesis': [],
    semicolon: [],
    quote: [],
  };
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
    } else if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
    } else if (character === "'") {
      found.quote.push(index);
      index += 1;
      while (index < source.length && source[index] !== "'" && source[index] !== '\n') {
        index += source[index] === '\\' ? 2 : 1;
      }
      if (source[index] === "'") found.quote.push(index);
      index += 1;
    } else {
      for (const damage of DAMAGE) if (damage !== 'quote' && character === CHARACTER[damage]) found[damage].push(index);
      index += 1;
    }
  }
  return found;
}

const schema = readSchema([root]);

interface Read {
  readonly problems: number;
  readonly references: readonly string[];
  readonly ms: number;
  /** The message of the error, when the resolver stopped on what the parser delivered. */
  readonly stopped: string | undefined;
}

/**
 * A reference without its column: a deleted character moves the columns of its line. The member the reference is
 * counted to comes first, so that it can be cut off.
 */
const keyOf = (found: Found): string =>
  [found.from, found.kind, found.to, found.via, found.tier, found.op ?? '', String(found.line), found.match].join(' ');
const withoutMember = (keys: readonly string[]): string[] => keys.map((key) => key.slice(key.indexOf(' ') + 1));

function read(adapter: SyntaxAdapter, file: ApexFile, source: string): Read {
  const started = performance.now();
  const unit = adapter.parseUnit(source, file.kind);
  try {
    const analysis = analyse([{ path: file.path, unit }], schema, adapter);
    return {
      problems: unit.problems.length,
      references: analysis.references.map(keyOf).sort(),
      ms: performance.now() - started,
      stopped: undefined,
    };
  } catch (error) {
    // The resolver stopped on what the parser delivered. Nothing of the file is found.
    return {
      problems: unit.problems.length,
      references: [],
      ms: performance.now() - started,
      stopped: error instanceof Error ? error.message : String(error),
    };
  }
}

/** How many entries of `now` are entries of `before`, each entry counted as often as it is there. */
function kept(before: readonly string[], now: readonly string[]): number {
  const left = new Map<string, number>();
  for (const entry of before) left.set(entry, (left.get(entry) ?? 0) + 1);
  let count = 0;
  for (const entry of now) {
    const still = left.get(entry) ?? 0;
    if (still > 0) {
      left.set(entry, still - 1);
      count += 1;
    }
  }
  return count;
}

const adapters = [createApexParserAdapter(), await createTreeSitterAdapter()] as const;
const [first, second] = adapters;

const eligible: { file: ApexFile; references: readonly string[] }[] = [];
for (const file of readApexFiles(root)) {
  const a = read(first, file, file.source);
  const b = read(second, file, file.source);
  if (a.problems > 0 || b.problems > 0 || a.references.length < 5) continue;
  if (a.references.join('\n') !== b.references.join('\n')) continue;
  eligible.push({ file, references: a.references });
}

const next = random(seed);
const pool = [...eligible];
const sample: typeof eligible = [];
while (sample.length < Math.min(wanted, eligible.length)) {
  const [picked] = pool.splice(Math.floor(next() * pool.length), 1);
  if (picked !== undefined) sample.push(picked);
}

interface Tally {
  cases: number;
  /** The references of the whole files. */
  before: number;
  /** Found again, with the same member. */
  kept: number;
  /** Found again at the same place with the same target, whatever the member. */
  keptPlace: number;
  /** References that the whole file does not have at any member. */
  added: number;
  /** Cases in which the parser reported no problem. */
  silent: number;
  /** Cases in which no reference of the whole file was found again. */
  nothing: number;
  /** Cases in which the resolver stopped with an error on what the parser delivered. */
  stopped: number;
  slowestMs: number;
}
const empty = (): Tally => ({
  cases: 0,
  before: 0,
  kept: 0,
  keptPlace: 0,
  added: 0,
  silent: 0,
  nothing: 0,
  stopped: 0,
  slowestMs: 0,
});
const tallies = new Map<string, Tally>();
const tally = (parser: string, damage: string): Tally => {
  const key = `${parser} | ${damage}`;
  let entry = tallies.get(key);
  if (entry === undefined) {
    entry = empty();
    tallies.set(key, entry);
  }
  return entry;
};
/** Per kind of damage: in how many cases which parser kept more references. */
const duels = new Map<string, { first: number; second: number; same: number }>();
const cases: unknown[] = [];

for (const { file, references } of sample) {
  const candidates = places(file.source);
  for (const damage of DAMAGE) {
    const at = candidates[damage];
    if (at.length === 0) continue;
    const offset = at[Math.floor(next() * at.length)];
    if (offset === undefined) continue;
    const source = file.source.slice(0, offset) + file.source.slice(offset + 1);
    const line = file.source.slice(0, offset).split('\n').length;
    const results = adapters.map((adapter) => {
      const result = read(adapter, file, source);
      const same = kept(references, result.references);
      const samePlace = kept(withoutMember(references), withoutMember(result.references));
      const added = result.references.length - samePlace;
      for (const group of [damage, 'all']) {
        const entry = tally(adapter.name, group);
        entry.cases += 1;
        entry.before += references.length;
        entry.kept += same;
        entry.keptPlace += samePlace;
        entry.added += added;
        if (result.problems === 0) entry.silent += 1;
        if (same === 0) entry.nothing += 1;
        if (result.stopped !== undefined) entry.stopped += 1;
        entry.slowestMs = Math.max(entry.slowestMs, Math.round(result.ms));
      }
      return {
        parser: adapter.name,
        kept: same,
        keptPlace: samePlace,
        added,
        problems: result.problems,
        stopped: result.stopped,
      };
    });
    const [a, b] = results;
    if (a !== undefined && b !== undefined) {
      for (const group of [damage, 'all']) {
        const duel = duels.get(group) ?? { first: 0, second: 0, same: 0 };
        if (a.kept > b.kept) duel.first += 1;
        else if (b.kept > a.kept) duel.second += 1;
        else duel.same += 1;
        duels.set(group, duel);
      }
    }
    cases.push({ file: file.path, damage, line, before: references.length, results });
  }
}

const percent = (part: number, whole: number): string => (whole === 0 ? '-' : ((100 * part) / whole).toFixed(1));
console.log(`files that take part ${String(eligible.length)}, files in the sample ${String(sample.length)}`);
for (const damage of [...DAMAGE, 'all']) {
  for (const adapter of adapters) {
    const entry = tally(adapter.name, damage);
    console.log(
      `${damage} | ${adapter.name} | cases ${String(entry.cases)} | kept ${String(entry.kept)} of ${String(entry.before)} (${percent(entry.kept, entry.before)}%) | kept at another member ${String(entry.keptPlace - entry.kept)} | added ${String(entry.added)} | nothing kept ${String(entry.nothing)} | resolver stopped ${String(entry.stopped)} | no problem reported ${String(entry.silent)} | slowest ${String(entry.slowestMs)} ms`,
    );
  }
  const duel = duels.get(damage);
  if (duel !== undefined) {
    console.log(
      `${damage} | ${first.name} kept more in ${String(duel.first)} cases, ${second.name} in ${String(duel.second)}, the same in ${String(duel.same)}`,
    );
  }
}
if (out !== undefined) {
  writeFileSync(
    out,
    JSON.stringify({ root, seed, eligible: eligible.length, tallies: Object.fromEntries(tallies), cases }, null, 1),
  );
}
