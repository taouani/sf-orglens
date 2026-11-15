/**
 * Checks the answer key against the fixture project.
 *
 * The key is the measure every analyser is scored with, so it must be right about the project before any analyser
 * exists. These tests do not analyse anything. They check that the key and the project agree on what the project
 * contains, that every place the key names exists, and that the key follows its own rules.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MetadataResolver, type SourceComponent } from '@salesforce/source-deploy-retrieve';
import { describe, expect, it } from 'vitest';
import { buildKey, parentKey, parseKey, type ComponentKey } from '../src/core/keys.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { outlineApex, type ApexOutline } from './helpers/apex-outline.ts';

const key = loadAnswerKey();
const projectDir = join(FIXTURES_DIR, key.project);

/**
 * The components of the project and the component that owns each file, as the Salesforce library sees them.
 *
 * A file of labels holds a component for the file and one for each label in it. The file is owned by the first.
 */
function resolveProject(): { owners: Map<string, ComponentKey>; resolved: Set<ComponentKey> } {
  const owners = new Map<string, ComponentKey>();
  const resolved = new Set<ComponentKey>();
  const visit = (component: SourceComponent): void => {
    const owner = buildKey({ type: component.type.name, fullName: component.fullName });
    resolved.add(owner);
    for (const file of [component.xml, component.content]) {
      // The content of an object is its folder. Only files are owned.
      if (file !== undefined && statSync(file).isFile()) {
        const path = relative(projectDir, file).split(sep).join('/');
        if (!owners.has(path)) owners.set(path, owner);
      }
    }
    component.getChildren().forEach(visit);
  };
  new MetadataResolver().getComponentsFromPath(join(projectDir, 'force-app')).forEach(visit);
  return { owners, resolved };
}

const { owners, resolved } = resolveProject();
const inProject = new Set<ComponentKey>(key.components.map((component) => component.key));
const standard = new Set<ComponentKey>(key.standard);

/** The key of the metadata component a key belongs to: itself, or the class of a method. */
function componentOf(of: ComponentKey): ComponentKey {
  let current = of;
  while (parseKey(current).subs.length > 0) {
    const parent = parentKey(current);
    if (parent === undefined) break;
    current = parent;
  }
  return current;
}

const isApex = (file: string): boolean => file.endsWith('.cls') || file.endsWith('.trigger');
const readProjectFile = (file: string): string => readFileSync(join(projectDir, file), 'utf8');

const outlines = new Map<string, ApexOutline>();
function outline(file: string): ApexOutline {
  let found = outlines.get(file);
  if (found === undefined) outlines.set(file, (found = outlineApex(readProjectFile(file))));
  return found;
}

/** The ways a metadata file names a target. Every other way belongs to Apex. */
const METADATA_VIA: ReadonlySet<string> = new Set([
  'formula',
  'filter',
  'summary',
  'lookup',
  'display-field',
  'controlling-field',
  'value-set',
]);

/** The types a formula or a field can name besides fields and objects. Such a target is referred to, never read. */
const NAMED_ONLY: ReadonlySet<string> = new Set([
  'CustomLabel',
  'CustomMetadata',
  'CustomPermission',
  'GlobalValueSet',
]);

/**
 * Where a reference of each kind of naming stands in a field or a rule: the element that holds the word, and for a
 * filter the element around that one. `reads` lists the elements in which the reference is a read. In every other
 * element it is a `references`.
 */
const PLACE_OF_VIA: Readonly<
  Record<string, { in: readonly string[]; within?: readonly string[]; reads: readonly string[] }>
> = {
  formula: {
    in: ['formula', 'errorConditionFormula', 'defaultValue'],
    reads: ['formula', 'errorConditionFormula', 'defaultValue'],
  },
  filter: {
    in: ['field', 'valueField'],
    within: ['lookupFilter', 'summaryFilterItems'],
    reads: ['field', 'valueField'],
  },
  summary: { in: ['summarizedField', 'summaryForeignKey'], reads: ['summarizedField'] },
  lookup: { in: ['referenceTo'], reads: [] },
  'display-field': { in: ['errorDisplayField'], reads: [] },
  'controlling-field': { in: ['controllingField'], reads: [] },
  'value-set': { in: ['valueSetName'], reads: [] },
};

/**
 * Where a place of a metadata file stands: the elements around it, from the outside in, and whether it is code of a
 * formula, a comment of it or a text of it. The formula is read as the file holds it, with its entities.
 */
function metadataPlace(file: string, line: number, column: number): { elements: string[]; region: string } {
  const text = readProjectFile(file);
  const lines = text.split('\n');
  const offset = lines.slice(0, line - 1).reduce((sum, one) => sum + one.length + 1, 0) + column - 1;
  const elements: string[] = [];
  let contentStart = 0;
  for (const tag of text.matchAll(/<(\/?)([A-Za-z]\w*)[^>]*?(\/?)>/g)) {
    if (tag.index >= offset) break;
    if (tag[1] === '/') elements.pop();
    else if (tag[3] !== '/') elements.push(tag[2] ?? '');
    contentStart = tag.index + tag[0].length;
  }
  let region = 'code';
  let at = contentStart;
  while (at < offset) {
    const rest = text.slice(at, at + 6);
    const quote = rest.startsWith('&quot;') ? '"' : rest.startsWith('&apos;') ? "'" : /^["']/.test(rest) ? rest[0] : '';
    const step = rest.startsWith('&quot;') || rest.startsWith('&apos;') ? 6 : 1;
    if (region === 'code') {
      if (rest.startsWith('/*')) region = 'comment';
      else if (quote !== '') region = `text ${quote ?? ''}`;
      at += rest.startsWith('/*') ? 2 : step;
    } else if (region === 'comment') {
      // A backslash keeps the end of a comment inside it.
      if (rest.startsWith('\\*/')) at += 3;
      else {
        if (rest.startsWith('*/')) region = 'code';
        at += rest.startsWith('*/') ? 2 : 1;
      }
    } else {
      // In a text, a backslash takes the next character with it.
      if (rest.startsWith('\\')) at += 2;
      else {
        if (region === `text ${quote ?? ''}`) region = 'code';
        at += step;
      }
    }
  }
  return { elements, region: region.startsWith('text') ? 'text' : region };
}

/** Every `static final` field of the project, by its name in lower case, with the text it is set to. */
const constants = new Map<string, string>();
/** The name of each child relationship in lower case, as a query writes it, with the lookup field that defines it. */
const childRelationships = new Map<string, ComponentKey>();
for (const [file, owner] of owners) {
  if (isApex(file)) for (const [name, value] of outline(file).constants) constants.set(name, value.toLowerCase());
  const relationship = /<relationshipName>(\w+)<\/relationshipName>/.exec(readProjectFile(file))?.[1];
  if (relationship !== undefined) childRelationships.set(`${relationship.toLowerCase()}__r`, owner);
}

/**
 * How the word of a reference stands for its target, or `undefined` if it does not:
 * - `name`: it is the name of the target, or the relationship name of a lookup field (`Account__r`, `Owner`);
 * - `keyword`: the keyword of a DML statement;
 * - `relationship`: a child relationship, defined by the lookup field that is the target or by a field of the
 *   object that is the target;
 * - `constant`: a constant of the project whose value holds the name of the target;
 * - `variable`: a variable, where the target is an object that is named in the member above the place;
 * - `stretch`: an entry that is marked as hard to find. It is not checked.
 */
function namedBy(reference: (typeof key.references)[number]): string | undefined {
  const word = reference.match.toLowerCase();
  const target = parseKey(reference.to);
  const last = target.name.slice(target.name.lastIndexOf('.') + 1);
  if (word === last || word.replace(/__r$/, '__c') === last || `${word}id` === last) return 'name';
  if (reference.via === 'dml' && reference.op === word) return 'keyword';
  const lookup = childRelationships.get(word);
  if (lookup !== undefined && (lookup === reference.to || parseKey(lookup).name.startsWith(`${target.name}.`))) {
    return 'relationship';
  }
  if (constants.get(word)?.includes(last) === true) return 'constant';
  if (reference.stretch) return 'stretch';
  if (target.type === 'CustomObject' && isApex(reference.file)) {
    const { code } = outline(reference.file);
    const member = parseKey(reference.from).subs.at(-1)?.name.replace(/\(.*$/, '') ?? '';
    let start = reference.line;
    while (start > 1 && columnOf((code[start - 1] ?? '').toLowerCase(), member, 1) === undefined) start -= 1;
    // The object can be named in code, as the type of a parameter, or in the text of a query.
    const above = readProjectFile(reference.file)
      .split('\n')
      .slice(start - 1, reference.line)
      .join(' ')
      .toLowerCase();
    if (columnOf(above, target.name, 1) !== undefined) return 'variable';
  }
  return undefined;
}

describe('the fixture project', () => {
  it('contains exactly the components the key lists', () => {
    expect([...resolved].sort()).toEqual([...inProject].sort());
    expect(inProject.size).toBe(key.components.length);
  });

  it('has no file that belongs to no component', () => {
    const files = readdirSync(join(projectDir, 'force-app'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(projectDir, join(entry.parentPath, entry.name)).split(sep).join('/'));
    expect(files.filter((file) => !owners.has(file))).toEqual([]);
    expect(files.length).toBe(owners.size);
  });

  it('is a Salesforce project that names its folder and its API version', () => {
    const project = JSON.parse(readFileSync(join(projectDir, 'sfdx-project.json'), 'utf8')) as {
      packageDirectories: { path: string }[];
      sourceApiVersion: string;
    };
    expect(project.packageDirectories.map((directory) => directory.path)).toEqual(['force-app']);
    expect(project.sourceApiVersion).toMatch(/^\d+\.0$/);
  });

  it('keeps its files in LF, so that lines and columns are the same on every system', () => {
    const withCarriageReturn = [...owners.keys()].filter((file) =>
      readFileSync(join(projectDir, file), 'utf8').includes('\r'),
    );
    expect(withCarriageReturn).toEqual([]);
  });

  it('has a folder of files that do not compile, outside the project', () => {
    // A file manager may leave files of its own in the folder. Their names start with a dot.
    const files = readdirSync(join(FIXTURES_DIR, 'parser-negative')).filter((file) => !file.startsWith('.'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files.every((file) => file.endsWith('.cls'))).toBe(true);
  });
});

describe('the manifest of public codebases', () => {
  it('pins every codebase to a full commit id, and can be listed without the network', () => {
    const script = join(FIXTURES_DIR, '../scripts/fetch-corpora.mjs');
    const listed = spawnSync(process.execPath, [script, '--list'], { encoding: 'utf8' });
    expect(listed.stderr).toBe('');
    expect(listed.status).toBe(0);
    const rows = listed.stdout.trim().split('\n');
    expect(rows.map((row) => row.split('  ')[0])).toEqual(['apex-recipes', 'nebula-logger', 'npsp']);
    for (const row of rows)
      expect(row).toMatch(/^[a-z0-9-]+ {2}[0-9a-f]{40} {2}\S+ {2}https:\/\/github\.com\/\S+\.git$/);
  });
});

describe('the answer key', () => {
  it('finds a whole word and its column, and no part of a longer name', () => {
    expect(columnOf('Total__c + Lines_Total__c', 'Total__c', 1)).toBe(1);
    expect(columnOf('Total__c + Lines_Total__c', 'Total__c', 2)).toBeUndefined();
    expect(columnOf('a.Status__c == b.Status__c', 'Status__c', 2)).toBe(18);
    expect(columnOf('Invoice__c x = [SELECT Id FROM invoice__c]', 'Invoice__c', 2)).toBeUndefined();
  });

  it('starts every reference from the component that owns the file', () => {
    const wrong = key.references
      .filter((reference) => owners.get(reference.file) !== componentOf(reference.from))
      .map((reference) => `${reference.id} from ${reference.from}`);
    expect(wrong).toEqual([]);
  });

  it('starts every reference and every unknown from the member its line belongs to', () => {
    const wrong: string[] = [];
    for (const place of [...key.references, ...key.unknowns]) {
      const owner = owners.get(place.file);
      if (owner === undefined) continue;
      const { type, name } = parseKey(owner);
      const subs = isApex(place.file) ? outline(place.file).memberAt(place.line) : [];
      const expected = buildKey({ type, fullName: name, subs });
      if (place.from !== expected) wrong.push(`${place.file}:${String(place.line)} ${place.match}: from ${expected}`);
    }
    expect(wrong).toEqual([]);
  });

  it('points every reference at a component of the project or at a listed standard target', () => {
    const wrong = key.references
      .filter((reference) => !inProject.has(reference.to) && !standard.has(reference.to))
      .map((reference) => reference.id);
    expect(wrong).toEqual([]);
  });

  it('lists no standard target that nothing refers to, and none that the project contains', () => {
    const targets = new Set(key.references.map((reference) => reference.to));
    expect(key.standard.filter((target) => !targets.has(target))).toEqual([]);
    expect(key.standard.filter((target) => inProject.has(target))).toEqual([]);
  });

  it('lists exactly the fields of the project that nothing refers to', () => {
    const targets = new Set(key.references.map((reference) => reference.to));
    const fields = key.components
      .filter((component) => component.type === 'CustomField')
      .map(({ key: field }) => field);
    expect([...key.unreferenced].sort()).toEqual(fields.filter((field) => !targets.has(field)).sort());
    expect(key.unreferenced).toContain('CustomField:invoice__c.unused_field__c');
  });

  it('follows its own rules about tiers and operations', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const target = parseKey(reference.to);
      // A name that stands in text is never as certain as a name the compiler checks.
      if (reference.via === 'text' && reference.tier === 'confirmed') wrong.push(`${reference.id}: text is confirmed`);
      if (reference.via !== 'text' && reference.tier !== 'confirmed') wrong.push(`${reference.id}: not confirmed`);
      // "possible" means the object is known and the field is not.
      if (reference.tier === 'possible' && target.type !== 'CustomObject') {
        wrong.push(`${reference.id}: possible and not an object`);
      }
      // A DML statement writes an object and says how. Nothing else carries an operation.
      const isDml = reference.via === 'dml' && reference.kind === 'writes';
      if (isDml !== (reference.op !== undefined)) wrong.push(`${reference.id}: operation`);
      if (isDml && (target.type !== 'CustomObject' || reference.match !== reference.op)) {
        wrong.push(`${reference.id}: a DML statement is keyed at its keyword and writes an object`);
      }
      if (target.subs.length > 0) wrong.push(`${reference.id}: the target is a part of a component`);
      if (reference.phase !== (reference.file.includes('/objects/') ? 1 : 3)) wrong.push(`${reference.id}: phase`);
    }
    expect(wrong).toEqual([]);
  });

  it('has no expected reference that one of its negatives forbids, and none where it says "unknown"', () => {
    const forbidden = key.negatives.filter((negative) =>
      key.references.some(
        (reference) =>
          reference.file === negative.file && reference.line === negative.line && reference.to === negative.not,
      ),
    );
    expect(forbidden).toEqual([]);
    const overlapping = key.unknowns.filter((unknown) =>
      key.references.some(
        (reference) =>
          reference.file === unknown.file && reference.line === unknown.line && reference.column === unknown.column,
      ),
    );
    expect(overlapping).toEqual([]);
    for (const unknown of key.unknowns) expect(owners.get(unknown.file)).toBe(componentOf(unknown.from));
    // A negative forbids a wrong guess, so its target need not exist. But a negative whose target is misspelled
    // forbids nothing: the word on the line must be the name of the target, and the object must be a known one.
    const objects = new Set([...inProject, ...standard].map((one) => parseKey(one).name.split('.')[0]));
    const bare = (name: string): string => name.toLowerCase().replace(/__c$/, '');
    const misspelled = key.negatives.filter((negative) => {
      const [object = '', field = object] = parseKey(negative.not).name.split('.');
      return !objects.has(object) || bare(field) !== bare(negative.match);
    });
    expect(misspelled).toEqual([]);
  });

  it('names no place in a comment, and each place in the kind of text its entry says', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const at = `${reference.id} (${reference.via})`;
      if (!isApex(reference.file)) {
        if (!METADATA_VIA.has(reference.via)) wrong.push(`${at}: not a way a metadata file names a target`);
        continue;
      }
      if (METADATA_VIA.has(reference.via)) wrong.push(`${at}: not a way Apex names a target`);
      const region = outline(reference.file).regionAt(reference.line, reference.column);
      // A name in a query built as text stands in a literal. A constant or a variable that holds one is code.
      const expected =
        reference.via === 'soql' || reference.via === 'sosl'
          ? 'query'
          : reference.via === 'text' && namedBy(reference) === 'name'
            ? 'text'
            : 'code';
      if (region !== expected) wrong.push(`${at}: stands in ${region}, expected ${expected}`);
    }
    for (const unknown of key.unknowns) {
      const region = outline(unknown.file).regionAt(unknown.line, unknown.column);
      if (region === 'comment') wrong.push(`unknown ${unknown.file}:${String(unknown.line)}: stands in a comment`);
    }
    expect(wrong).toEqual([]);
  });

  it('names every place of a field or a rule in the element its entry says, with the kind that fits it, and none in a comment or a text', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      if (isApex(reference.file)) continue;
      const { elements, region } = metadataPlace(reference.file, reference.line, reference.column);
      const place = PLACE_OF_VIA[reference.via];
      const innermost = elements.at(-1) ?? '';
      const around = place?.within;
      if (
        place === undefined ||
        !place.in.includes(innermost) ||
        (around !== undefined && !elements.some((element) => around.includes(element)))
      ) {
        wrong.push(`${reference.id} (${reference.via}): stands in ${elements.join(' > ')}`);
        continue;
      }
      if (reference.via === 'formula' && region !== 'code') wrong.push(`${reference.id}: stands in a ${region}`);
      // A field that is used is read. A field or an object that is only named is referred to, and so is everything
      // that is neither a field nor an object.
      const target = parseKey(reference.to).type;
      const expected = place.reads.includes(innermost) && target === 'CustomField' ? 'reads' : 'references';
      if (reference.kind !== expected) wrong.push(`${reference.id}: ${reference.kind}, expected ${expected}`);
    }
    expect(wrong).toEqual([]);
    // The check can tell the three apart. The names in the comment and in the texts of this field are negatives.
    const notice = 'force-app/main/default/objects/Invoice__c/fields/Status_Notice__c.field-meta.xml';
    const regions = key.negatives
      .filter((negative) => negative.file === notice)
      .map((negative) => metadataPlace(notice, negative.line, negative.column).region);
    expect(regions).toContain('comment');
    expect(regions).toContain('text');
    expect(regions).not.toContain('code');
  });

  it('names every target by a word that stands for it', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const how = namedBy(reference);
      if (how === undefined) wrong.push(`${reference.id}: "${reference.match}" does not name ${reference.to}`);
      // The tier "possible" is for a name that comes from a variable, and for nothing else.
      if ((how === 'variable') !== (reference.tier === 'possible')) wrong.push(`${reference.id}: ${reference.tier}`);
    }
    expect(wrong).toEqual([]);
  });

  it('gives every reference a kind that fits its target and its place', () => {
    const wrong: string[] = [];
    const placed = (reference: (typeof key.references)[number]): string =>
      `${reference.file}:${String(reference.line)}:${String(reference.column)}`;
    for (const reference of key.references) {
      const target = parseKey(reference.to).type;
      const from = parseKey(reference.from);
      const fits =
        reference.kind === 'extends'
          ? target === 'ApexClass' && reference.via === 'declaration'
          : reference.kind === 'triggers-on'
            ? target === 'CustomObject' && from.type === 'ApexTrigger' && reference.via === 'declaration'
            : target === 'CustomField' ||
              target === 'CustomObject' ||
              (NAMED_ONLY.has(target) && reference.kind === 'references' && !isApex(reference.file));
      if (!fits) wrong.push(`${reference.id}: ${reference.kind} to a ${target}`);

      if (!isApex(reference.file)) continue;
      const code = outline(reference.file).code[reference.line - 1] ?? '';
      const before = code.slice(0, reference.column - 1).trimEnd();
      const after = code.slice(reference.column - 1 + reference.match.length).trimStart();
      if (reference.via === 'field') {
        // `x.F = v` writes, `x.F += v` reads and writes, anything else reads.
        const assigns = /^=(?!=)/.test(after);
        const both = /^(?:[-+*/]=|\+\+|--)/.test(after);
        const same = key.references.filter((other) => placed(other) === placed(reference) && other.to === reference.to);
        const kinds = same
          .map((other) => other.kind)
          .sort()
          .join(' ');
        const expected = both ? 'reads writes' : assigns ? 'writes' : 'reads';
        if (kinds !== expected && reference.kind !== 'references') {
          wrong.push(`${reference.id}: the code ${expected}, the key says ${kinds}`);
        }
      }
      // The name of an object in code is a reference only as a token or in a declaration: `Invoice__c.SObjectType`.
      // In front of a variable it is a type, which is not keyed.
      if (target === 'CustomObject' && namedBy(reference) === 'name' && reference.via === 'token') {
        if (!before.endsWith('.') && !after.startsWith('.'))
          wrong.push(`${reference.id}: the object is used as a type`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('is large enough to score an analyser, as the plan of Phase 0 asks', () => {
    const apex = key.references.filter((reference) => reference.phase === 3);
    expect(apex.length).toBeGreaterThanOrEqual(150);
    expect(apex.filter((reference) => reference.kind === 'writes').length).toBeGreaterThanOrEqual(30);
    expect(apex.filter((reference) => reference.tier !== 'confirmed').length).toBeGreaterThanOrEqual(20);
    expect(key.references.filter((reference) => reference.phase === 1).length).toBeGreaterThanOrEqual(40);
    expect(key.negatives.length).toBeGreaterThanOrEqual(12);
    // Stretch entries stay rare, or the pass marks would mean little.
    expect(key.references.filter((reference) => reference.stretch).length).toBeLessThanOrEqual(8);
  });

  it('has the numbers the documents quote', () => {
    const byPhase = (phase: number): number => key.references.filter((reference) => reference.phase === phase).length;
    expect({
      version: key.version,
      components: key.components.length,
      phase1: byPhase(1),
      phase3: byPhase(3),
      stretch: key.references.filter((reference) => reference.stretch).length,
      negatives: key.negatives.length,
      unknowns: key.unknowns.length,
    }).toEqual({ version: 1, components: 87, phase1: 106, phase3: 184, stretch: 7, negatives: 31, unknowns: 5 });
  });
});

describe('version 0 of the answer key', () => {
  // The Apex trial of Phase 0 was scored with version 0, and its report quotes the numbers of that key. Version 0
  // lists the project as it was then, so it is not checked against the components of the project of today.
  const old = loadAnswerKey(0);
  const idOf = (place: { file: string; line: number; column: number }, target: string): string =>
    `${place.file}:${String(place.line)}:${String(place.column)}:${target}`;

  it('still names places that exist, and has the numbers the report of Phase 0 quotes', () => {
    const byPhase = (phase: number): number => old.references.filter((reference) => reference.phase === phase).length;
    expect({
      version: old.version,
      components: old.components.length,
      phase1: byPhase(1),
      phase3: byPhase(3),
      stretch: old.references.filter((reference) => reference.stretch).length,
      negatives: old.negatives.length,
      unknowns: old.unknowns.length,
    }).toEqual({ version: 0, components: 52, phase1: 44, phase3: 184, stretch: 4, negatives: 21, unknowns: 5 });
  });

  it('has the Apex part of version 1, entry for entry', () => {
    const apex = (from: typeof key): unknown[] => from.references.filter((reference) => reference.phase === 3);
    expect(apex(key)).toEqual(apex(old));
    expect(key.unknowns).toEqual(old.unknowns);
    expect(key.negatives.filter((negative) => isApex(negative.file))).toEqual(
      old.negatives.filter((negative) => isApex(negative.file)),
    );
  });

  it('has nothing that version 1 has not', () => {
    const whole = (reference: (typeof key.references)[number]): string =>
      `${reference.id}:${reference.from}:${reference.via}:${reference.tier}:${String(reference.stretch)}`;
    const now = new Set(key.references.map(whole));
    expect(old.references.filter((reference) => !now.has(whole(reference)))).toEqual([]);
    const forbidden = new Set(key.negatives.map((negative) => idOf(negative, negative.not)));
    expect(old.negatives.filter((negative) => !forbidden.has(idOf(negative, negative.not)))).toEqual([]);
    expect(old.components.filter((component) => !inProject.has(component.key))).toEqual([]);
    expect(old.standard.filter((target) => !standard.has(target))).toEqual([]);
  });
});
