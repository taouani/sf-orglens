/**
 * Reads the answer key of the fixture project (`fixtures/expected/answer-key.v0.yaml`).
 *
 * The key is written by hand, so it is read strictly: an unknown field, a wrong value or a place that the text of the
 * project does not contain is a problem, and all problems are reported together. A place is written as a line and a
 * word, and the column is worked out here, so that nobody counts columns by hand.
 *
 * The format and the rules of what is keyed are described in `fixtures/README.md`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { buildKey, parseKey, type ComponentKey } from '../../src/core/keys.ts';
import { isConfidenceTier, type ConfidenceTier } from '../../src/core/references.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The folder `fixtures` of the repository. */
export const FIXTURES_DIR = join(here, '../../../../fixtures');
const KEY_FILE = join(FIXTURES_DIR, 'expected/answer-key.v0.yaml');

/** The kinds of reference the key uses. Calls and uses of a type are not keyed in version 0. */
const KEY_KINDS = ['reads', 'writes', 'references', 'extends', 'triggers-on'] as const;
type KeyKind = (typeof KEY_KINDS)[number];

/** How the source names the target. */
const KEY_VIAS = [
  'formula',
  'filter',
  'summary',
  'lookup',
  'display-field',
  'field',
  'soql',
  'sosl',
  'dml',
  'token',
  'text',
  'declaration',
] as const;
type KeyVia = (typeof KEY_VIAS)[number];

const DML_OPS = ['insert', 'update', 'upsert', 'delete', 'undelete', 'merge'] as const;
type DmlOp = (typeof DML_OPS)[number];

/** A place in a file of the project: the word, and where it starts. Lines and columns start at 1. */
interface KeyPlace {
  /** Path inside the project, with forward slashes. */
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly match: string;
}

interface KeyComponent {
  readonly key: ComponentKey;
  readonly type: string;
  readonly fullName: string;
}

interface KeyReference extends KeyPlace {
  /** File, line, column, kind and target. No two references share it. */
  readonly id: string;
  readonly from: ComponentKey;
  readonly to: ComponentKey;
  readonly kind: KeyKind;
  readonly tier: ConfidenceTier;
  readonly via: KeyVia;
  readonly op: DmlOp | undefined;
  /** The roadmap phase whose analyser must find the reference. */
  readonly phase: number;
  /** A stretch reference counts neither against recall when it is missed nor against precision when it is found. */
  readonly stretch: boolean;
  readonly note: string | undefined;
}

interface KeyNegative extends KeyPlace {
  /** No reference to this target may be reported on the line. */
  readonly not: ComponentKey;
  readonly why: string;
}

interface KeyUnknown extends KeyPlace {
  readonly from: ComponentKey;
  readonly why: string;
}

interface AnswerKey {
  readonly version: number;
  /** The folder of the project inside `fixtures`. */
  readonly project: string;
  readonly components: readonly KeyComponent[];
  readonly standard: readonly ComponentKey[];
  readonly unreferenced: readonly ComponentKey[];
  readonly references: readonly KeyReference[];
  readonly negatives: readonly KeyNegative[];
  readonly unknowns: readonly KeyUnknown[];
}

type Dict = Readonly<Record<string, unknown>>;

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

const WORD = /[A-Za-z0-9_]/;

/** The column of the nth whole word `match` in a line, or `undefined`. A word is not part of a longer name. */
export function columnOf(line: string, match: string, nth: number): number | undefined {
  let seen = 0;
  for (let at = line.indexOf(match); at !== -1; at = line.indexOf(match, at + 1)) {
    const before = at === 0 ? '' : line.charAt(at - 1);
    const after = line.charAt(at + match.length);
    if (WORD.test(before) || WORD.test(after)) continue;
    seen += 1;
    if (seen === nth) return at + 1;
  }
  return undefined;
}

/** Reads and checks the answer key. Throws one error that lists every problem. */
export function loadAnswerKey(): AnswerKey {
  const problems: string[] = [];
  const root: unknown = parse(readFileSync(KEY_FILE, 'utf8'));
  if (!isDict(root)) throw new Error('The answer key is not a mapping.');

  /** Reports the fields of a mapping that are not allowed. */
  const onlyFields = (where: string, value: Dict, allowed: readonly string[]): void => {
    for (const field of Object.keys(value)) {
      if (!allowed.includes(field)) problems.push(`${where}: unknown field "${field}".`);
    }
  };
  const text = (where: string, value: unknown): string => {
    if (typeof value === 'string' && value !== '') return value;
    problems.push(`${where}: a text is expected.`);
    return '';
  };
  const count = (where: string, value: unknown): number => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    problems.push(`${where}: a whole number is expected.`);
    return 0;
  };
  const list = (where: string, value: unknown): readonly unknown[] => {
    if (Array.isArray(value)) return value as readonly unknown[];
    problems.push(`${where}: a list is expected.`);
    return [];
  };
  const dict = (where: string, value: unknown): Dict => {
    if (isDict(value)) return value;
    problems.push(`${where}: a mapping is expected.`);
    return {};
  };
  /** A component key in exactly the spelling `buildKey` gives it. */
  const key = (where: string, value: unknown): ComponentKey => {
    const written = text(where, value);
    try {
      const parsed = parseKey(written);
      const canonical = buildKey({ type: parsed.type, fullName: parsed.name, subs: parsed.subs });
      if (canonical !== written) problems.push(`${where}: "${written}" must be written as "${canonical}".`);
      return canonical;
    } catch (error) {
      problems.push(`${where}: "${written}" is not a component key (${(error as Error).message}).`);
      return written as ComponentKey;
    }
  };

  onlyFields('key', root, [
    'version',
    'project',
    'components',
    'standard',
    'unreferenced',
    'references',
    'negatives',
    'unknowns',
  ]);
  const version = count('version', root['version']);
  const project = text('project', root['project']);
  const projectDir = join(FIXTURES_DIR, project);

  const components: KeyComponent[] = [];
  for (const [type, names] of Object.entries(dict('components', root['components']))) {
    for (const name of list(`components.${type}`, names)) {
      const fullName = text(`components.${type}`, name);
      try {
        components.push({ key: buildKey({ type, fullName }), type, fullName });
      } catch (error) {
        problems.push(`components.${type}: "${fullName}" gives no key (${(error as Error).message}).`);
      }
    }
  }
  const standard = list('standard', root['standard']).map((value, index) => key(`standard[${String(index)}]`, value));
  const unreferenced = list('unreferenced', root['unreferenced']).map((value, index) =>
    key(`unreferenced[${String(index)}]`, value),
  );

  const linesOf = new Map<string, readonly string[] | undefined>();
  /** Works out the column of a place, and reports a place the file does not contain. */
  const place = (where: string, file: string, entry: Dict): KeyPlace => {
    const line = count(`${where}.line`, entry['line']);
    const match = text(`${where}.match`, entry['match']);
    const nth = entry['nth'] === undefined ? 1 : count(`${where}.nth`, entry['nth']);
    if (!linesOf.has(file)) {
      let lines: readonly string[] | undefined;
      try {
        lines = readFileSync(join(projectDir, file), 'utf8').split('\n');
      } catch {
        problems.push(`${where}: the file ${file} cannot be read.`);
      }
      linesOf.set(file, lines);
    }
    const lines = linesOf.get(file);
    let column = 0;
    if (lines !== undefined && match !== '') {
      const found = columnOf(lines[line - 1] ?? '', match, nth);
      if (found === undefined) {
        problems.push(`${where}: line ${String(line)} of ${file} has no ${String(nth)}. word "${match}".`);
      } else {
        column = found;
      }
    }
    return { file, line, column, match };
  };
  const filePath = (where: string, value: unknown): string => {
    const file = text(where, value);
    if (file.includes('\\') || file.startsWith('/') || file.split('/').includes('..')) {
      problems.push(`${where}: "${file}" must be a path inside the project, with forward slashes.`);
    }
    return file;
  };

  const references: KeyReference[] = [];
  const ids = new Set<string>();
  list('references', root['references']).forEach((value, groupIndex) => {
    const group = dict(`references[${String(groupIndex)}]`, value);
    const file = filePath(`references[${String(groupIndex)}].file`, group['file']);
    onlyFields(`references(${file})`, group, ['file', 'phase', 'members']);
    const phase = count(`references(${file}).phase`, group['phase']);
    for (const memberValue of list(`references(${file}).members`, group['members'])) {
      const member = dict(`references(${file}).members`, memberValue);
      onlyFields(`references(${file}).members`, member, ['from', 'refs']);
      const from = key(`references(${file}).from`, member['from']);
      list(`references(${file}) ${from}`, member['refs']).forEach((refValue, refIndex) => {
        const where = `${file} ${from} [${String(refIndex)}]`;
        const entry = dict(where, refValue);
        onlyFields(where, entry, ['line', 'match', 'nth', 'kind', 'to', 'via', 'tier', 'op', 'stretch', 'note']);
        const at = place(where, file, entry);
        const to = key(`${where}.to`, entry['to']);
        const kind = isOneOf(KEY_KINDS, entry['kind']) ? entry['kind'] : undefined;
        if (kind === undefined) problems.push(`${where}: kind must be one of ${KEY_KINDS.join(', ')}.`);
        const via = isOneOf(KEY_VIAS, entry['via']) ? entry['via'] : undefined;
        if (via === undefined) problems.push(`${where}: via must be one of ${KEY_VIAS.join(', ')}.`);
        const tier = entry['tier'] === undefined ? 'confirmed' : entry['tier'];
        if (!isConfidenceTier(tier)) problems.push(`${where}: ${JSON.stringify(tier)} is not a confidence tier.`);
        const op = entry['op'];
        if (op !== undefined && !isOneOf(DML_OPS, op))
          problems.push(`${where}: ${JSON.stringify(op)} is not a DML operation.`);
        const stretch = entry['stretch'] ?? false;
        if (typeof stretch !== 'boolean') problems.push(`${where}: stretch must be true or false.`);
        const note = entry['note'] === undefined ? undefined : text(`${where}.note`, entry['note']);
        if (kind === undefined || via === undefined || !isConfidenceTier(tier) || typeof stretch !== 'boolean') return;
        const id = `${file}:${String(at.line)}:${String(at.column)}:${kind}:${to}`;
        if (ids.has(id)) problems.push(`${where}: the reference ${id} stands in the key twice.`);
        ids.add(id);
        references.push({
          ...at,
          id,
          from,
          to,
          kind,
          tier,
          via,
          op: isOneOf(DML_OPS, op) ? op : undefined,
          phase,
          stretch,
          note,
        });
      });
    }
  });

  const negatives = list('negatives', root['negatives']).map((value, index): KeyNegative => {
    const where = `negatives[${String(index)}]`;
    const entry = dict(where, value);
    onlyFields(where, entry, ['file', 'line', 'match', 'nth', 'not', 'why']);
    const file = filePath(`${where}.file`, entry['file']);
    return {
      ...place(where, file, entry),
      not: key(`${where}.not`, entry['not']),
      why: text(`${where}.why`, entry['why']),
    };
  });

  const unknowns = list('unknowns', root['unknowns']).map((value, index): KeyUnknown => {
    const where = `unknowns[${String(index)}]`;
    const entry = dict(where, value);
    onlyFields(where, entry, ['file', 'line', 'match', 'nth', 'from', 'why']);
    const file = filePath(`${where}.file`, entry['file']);
    return {
      ...place(where, file, entry),
      from: key(`${where}.from`, entry['from']),
      why: text(`${where}.why`, entry['why']),
    };
  });

  if (problems.length > 0) {
    throw new Error(`The answer key has ${String(problems.length)} problem(s):\n${problems.join('\n')}`);
  }
  return { version, project, components, standard, unreferenced, references, negatives, unknowns };
}
