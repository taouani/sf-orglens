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

const key = loadAnswerKey();
const projectDir = join(FIXTURES_DIR, key.project);

/** The component that owns each file of the project, as the Salesforce library sees it. */
function resolveProject(): Map<string, ComponentKey> {
  const owners = new Map<string, ComponentKey>();
  const visit = (component: SourceComponent): void => {
    const owner = buildKey({ type: component.type.name, fullName: component.fullName });
    for (const file of [component.xml, component.content]) {
      // The content of an object is its folder. Only files are owned.
      if (file !== undefined && statSync(file).isFile()) {
        owners.set(relative(projectDir, file).split(sep).join('/'), owner);
      }
    }
    component.getChildren().forEach(visit);
  };
  new MetadataResolver().getComponentsFromPath(join(projectDir, 'force-app')).forEach(visit);
  return owners;
}

const owners = resolveProject();
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

describe('the fixture project', () => {
  it('contains exactly the components the key lists', () => {
    expect([...new Set(owners.values())].sort()).toEqual([...inProject].sort());
    expect(inProject.size).toBe(key.components.length);
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
    const files = readdirSync(join(FIXTURES_DIR, 'parser-negative'));
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

  it('names a member of the file as the start of a reference, at or above the line of the reference', () => {
    const wrong: string[] = [];
    for (const reference of key.references) {
      const member = parseKey(reference.from).subs.at(-1);
      if (member === undefined) continue;
      const name = member.name.replace(/\(.*$/, '');
      const lines = readFileSync(join(projectDir, reference.file), 'utf8').split('\n').slice(0, reference.line);
      if (!lines.some((line) => columnOf(line.toLowerCase(), name, 1) !== undefined)) {
        wrong.push(`${reference.id}: no "${name}" at or above line ${String(reference.line)}`);
      }
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
      // "possible" means the object is known and the field is not, unless the entry is a stretch.
      if (reference.tier === 'possible' && target.type !== 'CustomObject' && !reference.stretch) {
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
    }).toEqual({ version: 0, components: 52, phase1: 44, phase3: 182, stretch: 5, negatives: 15, unknowns: 3 });
  });
});
