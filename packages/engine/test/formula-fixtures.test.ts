/**
 * Checks the two sets of formulas that Phase 1 added beside the fixture project: the probes
 * (`fixtures/formula-probes.yaml`) and the formulas that cannot be deployed (`fixtures/formula-negative`).
 *
 * Like the tests of the answer key, these tests analyse nothing. They check that the files say what they claim,
 * before the analyser exists that is scored with them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { buildKey, parseKey } from '../src/core/keys.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';

type Dict = Readonly<Record<string, unknown>>;
const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);
const dicts = (value: unknown): Dict[] => (Array.isArray(value) ? value.filter(isDict) : []);
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];

const key = loadAnswerKey();
/** The name of every custom field of the project, without its object, in lower case. */
const fieldNames = new Set(
  key.components.filter((one) => one.type === 'CustomField').map((one) => one.fullName.split('.')[1]?.toLowerCase()),
);
const known = new Set<string>([...key.components.map((one) => one.key), ...key.standard]);

/** The words of the formula language that are no names. */
const WORDS = new Set(['true', 'false', 'null', 'not']);

/**
 * The names of a formula, found in the simplest way: the formula without its comments and its texts, and in it
 * every word that no bracket follows. It is not a parser. It is a second opinion on what a probe lists by hand.
 */
function namesOf(formula: string): string[] {
  let code = '';
  for (let at = 0; at < formula.length;) {
    const here = formula[at] ?? '';
    if (formula.startsWith('/*', at)) {
      // A backslash keeps the end of a comment inside it.
      at += 2;
      while (at < formula.length && !formula.startsWith('*/', at)) at += formula.startsWith('\\*/', at) ? 3 : 1;
      at += 2;
      code += ' ';
    } else if (here === '"' || here === "'") {
      at += 1;
      while (at < formula.length && formula[at] !== here) at += formula[at] === '\\' ? 2 : 1;
      at += 1;
      code += ' ';
    } else {
      code += here;
      at += 1;
    }
  }
  const names: string[] = [];
  for (const found of code.matchAll(/[A-Za-z$][A-Za-z0-9_$:.#]*/g)) {
    const after = code.slice(found.index + found[0].length).trimStart();
    if (!after.startsWith('(') && !WORDS.has(found[0].toLowerCase())) names.push(found[0]);
  }
  return names;
}

describe('the formula probes', () => {
  const root = parse(readFileSync(join(FIXTURES_DIR, 'formula-probes.yaml'), 'utf8')) as Dict;
  const sources = Object.keys(isDict(root['sources']) ? root['sources'] : {});
  const probes = dicts(root['probes']);
  const functions = probes.filter((probe) => probe['seen'] !== undefined);

  it('are read as a list of probes, each with what it covers, a formula and its names', () => {
    expect(Object.keys(root).sort()).toEqual(['object', 'probes', 'sources', 'version']);
    expect(root['version']).toBe(1);
    expect(key.components.map((one) => one.key)).toContain(
      buildKey({ type: 'CustomObject', fullName: String(root['object']) }),
    );
    expect(sources).toEqual(['help', 'help-summary', 'engine']);
    expect(probes.length).toBe((root['probes'] as unknown[]).length);
    const wrong: string[] = [];
    for (const probe of probes) {
      const covers = String(probe['covers']);
      const unknown = Object.keys(probe).filter(
        (field) => !['covers', 'formula', 'names', 'seen', 'where', 'note'].includes(field),
      );
      if (unknown.length > 0) wrong.push(`${covers}: unknown field ${unknown.join(', ')}`);
      if (typeof probe['covers'] !== 'string' || covers === '') wrong.push(`${covers}: covers`);
      if (typeof probe['formula'] !== 'string' || probe['formula'] === '') wrong.push(`${covers}: formula`);
      if (!Array.isArray(probe['names']) || texts(probe['names']).length !== probe['names'].length) {
        wrong.push(`${covers}: names`);
      }
      if (probe['where'] !== undefined && probe['where'] !== 'elsewhere') wrong.push(`${covers}: where`);
      if (probe['note'] !== undefined && typeof probe['note'] !== 'string') wrong.push(`${covers}: note`);
      if (probe['where'] !== undefined && probe['seen'] === undefined) wrong.push(`${covers}: where without seen`);
    }
    expect(wrong).toEqual([]);
  });

  it('cover each thing once', () => {
    const covered = probes.map((probe) => String(probe['covers']));
    expect(covered.filter((one, index) => covered.indexOf(one) !== index)).toEqual([]);
  });

  it('list by hand the names that the formula holds outside its comments and its texts', () => {
    const wrong = probes
      .filter((probe) => JSON.stringify(namesOf(String(probe['formula']))) !== JSON.stringify(probe['names']))
      .map((probe) => `${String(probe['covers'])}: the formula holds ${namesOf(String(probe['formula'])).join(', ')}`);
    expect(wrong).toEqual([]);
  });

  it('call the function each probe of a function is there for, and say where its name was seen', () => {
    const wrong: string[] = [];
    for (const probe of functions) {
      const name = String(probe['covers']);
      if (!/^[A-Z][A-Z0-9]*$/.test(name)) wrong.push(`${name}: not the name of a function`);
      if (!new RegExp(`(?<![A-Za-z0-9_$.])${name}\\(`).test(String(probe['formula']))) {
        wrong.push(`${name}: the formula does not call it`);
      }
      const seen = texts(probe['seen']);
      if (seen.length === 0 || seen.some((one) => !sources.includes(one))) wrong.push(`${name}: seen`);
      // A name of the help page was read as written or in the summary, never both.
      if (seen.includes('help') && seen.includes('help-summary')) wrong.push(`${name}: seen twice on the help page`);
    }
    expect(wrong).toEqual([]);
    // The help page lists 104 functions.
    expect(functions.length).toBeGreaterThanOrEqual(100);
  });

  it('name only custom fields the project has, or fields of a namespace', () => {
    const wrong: string[] = [];
    for (const probe of probes) {
      // A report has columns and no fields.
      if (probe['where'] === 'elsewhere') continue;
      for (const name of texts(probe['names'])) {
        const last = name.slice(name.lastIndexOf('.') + 1);
        if (!last.endsWith('__c') || /^[A-Za-z0-9]+__\w+__c$/.test(last)) continue;
        if (!fieldNames.has(last.toLowerCase())) wrong.push(`${String(probe['covers'])}: ${name}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('have the numbers the documents quote', () => {
    expect({
      probes: probes.length,
      functions: functions.length,
      elsewhere: probes.filter((probe) => probe['where'] === 'elsewhere').length,
      summaryOnly: functions.filter((probe) => texts(probe['seen']).join() === 'help-summary').length,
    }).toEqual({ probes: 178, functions: 104, elsewhere: 9, summaryOnly: 2 });
  });
});

describe('the formulas that cannot be deployed', () => {
  const dir = join(FIXTURES_DIR, 'formula-negative');
  const root = parse(readFileSync(join(dir, 'expected.yaml'), 'utf8')) as Dict;
  const files = dicts(root['files']);
  const onDisk = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'expected.yaml')
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();

  it('have one entry for each file, and no file with the name of a file of the project', () => {
    expect(Object.keys(root).sort()).toEqual(['files', 'project', 'version']);
    expect(root['project']).toBe(key.project);
    expect(files.map((file) => String(file['file'])).sort()).toEqual(onDisk);
    const project = join(FIXTURES_DIR, key.project, 'force-app/main/default');
    expect(onDisk.filter((file) => existsSync(join(project, file)))).toEqual([]);
    // The folder of the object exists in the project, so the files can be laid over a copy of it.
    expect(onDisk.every((file) => existsSync(join(project, file, '../..')))).toBe(true);
  });

  it('say of each file what it starts from, whether it parses, and why it is there', () => {
    const wrong: string[] = [];
    for (const entry of files) {
      const file = String(entry['file']);
      const unknown = Object.keys(entry).filter(
        (field) => !['file', 'from', 'parses', 'why', 'refs', 'unresolved', 'external', 'negatives'].includes(field),
      );
      if (unknown.length > 0) wrong.push(`${file}: unknown field ${unknown.join(', ')}`);
      const [, object = '', folder = '', name = ''] = file.split('/');
      const type = folder === 'fields' ? 'CustomField' : folder === 'validationRules' ? 'ValidationRule' : '';
      const from = type === '' ? '' : buildKey({ type, fullName: `${object}.${name.slice(0, name.indexOf('.'))}` });
      if (entry['from'] !== from) wrong.push(`${file}: from ${from}`);
      if (typeof entry['parses'] !== 'boolean') wrong.push(`${file}: parses`);
      if (typeof entry['why'] !== 'string' || entry['why'] === '') wrong.push(`${file}: why`);
      const text = readFileSync(join(dir, file), 'utf8');
      if (text.includes('\r')) wrong.push(`${file}: not LF`);
      if (!/<(formula|errorConditionFormula)>/.test(text)) wrong.push(`${file}: holds no formula`);
    }
    expect(wrong).toEqual([]);
    // The numbers the documents quote.
    expect({
      files: files.length,
      rules: files.filter((entry) => String(entry['from']).startsWith('ValidationRule:')).length,
      notParsed: files.filter((entry) => entry['parses'] === false).length,
      withMissingName: files.filter((entry) => entry['unresolved'] !== undefined || entry['external'] !== undefined)
        .length,
    }).toEqual({ files: 10, rules: 1, notParsed: 5, withMissingName: 5 });
  });

  it('name places that exist, targets the project has, and missing names it has not', () => {
    const wrong: string[] = [];
    for (const entry of files) {
      const file = String(entry['file']);
      const lines = readFileSync(join(dir, file), 'utf8').split('\n');
      const placed = (what: Dict): boolean =>
        columnOf(lines[Number(what['line']) - 1] ?? '', String(what['match']), Number(what['nth'] ?? 1)) !== undefined;
      for (const ref of dicts(entry['refs'])) {
        const at = `${file}:${String(ref['line'])} ${String(ref['match'])}`;
        if (!placed(ref)) wrong.push(`${at}: no such place`);
        if (Object.keys(ref).some((field) => !['line', 'match', 'nth', 'kind', 'to', 'tier'].includes(field))) {
          wrong.push(`${at}: unknown field`);
        }
        if (!known.has(String(ref['to']))) wrong.push(`${at}: the project has no ${String(ref['to'])}`);
        if (ref['kind'] !== 'reads' && ref['kind'] !== 'references') wrong.push(`${at}: kind`);
        // A name found in a formula that does not parse is never more than probable.
        const tier = ref['tier'] ?? 'confirmed';
        if (tier !== (entry['parses'] === true ? 'confirmed' : 'probable')) wrong.push(`${at}: tier`);
      }
      for (const missing of [...dicts(entry['unresolved']), ...dicts(entry['external'])]) {
        const at = `${file}:${String(missing['line'])} ${String(missing['match'])}`;
        if (!placed(missing)) wrong.push(`${at}: no such place`);
        if (Object.keys(missing).some((field) => !['line', 'match', 'nth'].includes(field))) {
          wrong.push(`${at}: unknown field`);
        }
        const word = String(missing['match']).toLowerCase();
        if ([...known].some((one) => parseKey(one).name.split('.').includes(word.replace(/__r$/, '__c')))) {
          wrong.push(`${at}: the project has a component of that name`);
        }
      }
      for (const negative of dicts(entry['negatives'])) {
        const at = `${file}:${String(negative['line'])} ${String(negative['match'])}`;
        if (!placed(negative)) wrong.push(`${at}: no such place`);
        if (Object.keys(negative).some((field) => !['line', 'match', 'nth', 'not'].includes(field))) {
          wrong.push(`${at}: unknown field`);
        }
        if (!known.has(String(negative['not']))) wrong.push(`${at}: the project has no ${String(negative['not'])}`);
        if (dicts(entry['refs']).some((ref) => ref['line'] === negative['line'] && ref['to'] === negative['not'])) {
          wrong.push(`${at}: a reference of the file is forbidden by its own negative`);
        }
      }
      for (const external of dicts(entry['external'])) {
        if (!/^[A-Za-z0-9]+__\w+__[cr]$/.test(String(external['match']))) {
          wrong.push(`${file}: ${String(external['match'])} has no prefix of a package`);
        }
      }
      for (const unresolved of dicts(entry['unresolved'])) {
        if (/^[A-Za-z0-9]+__\w+__[cr]$/.test(String(unresolved['match']))) {
          wrong.push(`${file}: ${String(unresolved['match'])} has the prefix of a package`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
