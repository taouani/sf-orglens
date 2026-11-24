/**
 * The table of what the components of a type can name (decision record 0073), held against the types of the
 * Metadata API as the pinned `@jsforce/jsforce-node` declares them, and the rule an answer applies with it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { RegistryAccess } from '@salesforce/source-deploy-retrieve';
import { describe, expect, it } from 'vitest';
import { namingTypes, WHAT_A_TYPE_CAN_NAME } from '../src/engines/can-name.ts';
import { analyseSource } from '../src/extraction/analyse.ts';

const require = createRequire(import.meta.url);
const SCHEMA = readFileSync(require.resolve('@jsforce/jsforce-node/lib/api/metadata/schema.d.ts'), 'utf8');
/** The version of the library, which the table and decision record 0073 name. */
const LIBRARY = JSON.parse(readFileSync(require.resolve('@jsforce/jsforce-node/package.json'), 'utf8')) as {
  readonly version: string;
};

const NOTHING = {
  files: [],
  read: (path: string): Uint8Array => {
    throw new Error(`The tree holds no file, and ${path} was asked for.`);
  },
};
/** The types an analysis reads. */
const ANALYSED = analyseSource(NOTHING, []).types;

interface Declared {
  readonly bases: readonly string[];
  readonly fields: ReadonlyMap<string, string>;
}

/** Every type of the schema: `export type Name = Base & Other & { field?: Type | null | undefined; ... };`. */
function declaredTypes(text: string): Map<string, Declared> {
  const types = new Map<string, Declared>();
  for (const match of text.matchAll(/^export type (\w+) = ([\s\S]*?);\n(?=export |$)/gm)) {
    const [, name = '', body = ''] = match;
    const open = body.indexOf('{');
    const head = open === -1 ? body : body.slice(0, open);
    const fields = new Map<string, string>();
    if (open !== -1) {
      for (const field of body.slice(open).matchAll(/^\s+(\w+)\??: ([^;]+);$/gm)) {
        fields.set(field[1] ?? '', field[2] ?? '');
      }
    }
    const bases = head
      .split('&')
      .map((one) => one.trim())
      .filter((one) => one !== '');
    types.set(name, { bases, fields });
  }
  return types;
}

const DECLARED = declaredTypes(SCHEMA);

/** The paths of every field of a type, of the types it is built on and of the types of its fields. */
function pathsOf(name: string, prefix = '', seen: ReadonlySet<string> = new Set()): string[] {
  const type = DECLARED.get(name);
  if (type === undefined) throw new Error(`The schema declares no type ${name}`);
  const paths: string[] = [];
  for (const base of type.bases) if (DECLARED.has(base)) paths.push(...pathsOf(base, prefix, seen));
  for (const [field, declared] of type.fields) {
    const path = `${prefix}${field}`;
    paths.push(path);
    const inner = declared
      .replace(/\| null|\| undefined/g, '')
      .replace(/\[\]/g, '')
      .trim();
    if (DECLARED.has(inner) && !seen.has(inner)) paths.push(...pathsOf(inner, `${path}.`, new Set([...seen, inner])));
  }
  return paths;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe('the table of what a type can name', () => {
  it('reads the schema of the library, as a control', () => {
    expect(LIBRARY.version).toBe('3.13.1');
    expect(DECLARED.size).toBe(SCHEMA.match(/^export type /gm)?.length);
    expect(pathsOf('SharingReason')).toEqual(['fullName', 'label']);
    expect(pathsOf('ReportFolder')).toContain('folderShares.sharedTo');
  });

  it('has the fields of each type as the pinned library declares them', () => {
    for (const [type, line] of WHAT_A_TYPE_CAN_NAME) {
      expect([type, [...new Set(pathsOf(type))].sort(byCodeUnit)]).toEqual([type, line.fields]);
    }
  });

  it('names only types the Salesforce library knows, sorted, and no type the analysis reads', () => {
    const registry = new RegistryAccess();
    const analysed = new Set(ANALYSED);
    expect(analysed.has('CustomField')).toBe(true);
    for (const [type, line] of WHAT_A_TYPE_CAN_NAME) {
      expect(registry.getTypeByName(type).name).toBe(type);
      for (const named of line.names) expect(registry.getTypeByName(named).name).toBe(named);
      expect(line.names).toEqual([...new Set(line.names)].sort(byCodeUnit));
      // A line for a type that is analysed would say nothing: such a type is never among those not covered.
      expect([type, analysed.has(type)]).toEqual([type, false]);
      expect(line.why).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe('the types an answer about what refers to a component does not cover', () => {
  const gaps = (...types: string[]): { type: string }[] => types.map((type) => ({ type }));
  const field = ['CustomField'];

  it('leaves out a type whose components can name nothing of the answer', () => {
    expect(namingTypes(gaps('ApexClass', 'CustomLabel', 'CustomLabels', 'GlobalValueSet'), field, ANALYSED)).toEqual(
      gaps('ApexClass'),
    );
  });

  it('keeps a type the table does not know, and one whose components can name a type of the answer', () => {
    expect(
      namingTypes(gaps('ApexTestSuite', 'CustomLabels', 'FlexiPage'), ['ApexClass', 'CustomField'], ANALYSED),
    ).toEqual(gaps('ApexTestSuite', 'FlexiPage'));
    expect(namingTypes(gaps('CustomLabels'), ['CustomLabel'], ANALYSED)).toEqual(gaps('CustomLabels'));
  });

  it('keeps a type whose components can name one that stays, in any order of the list', () => {
    // A suite names a class, which is not analysed and may refer to the field. A group names permission sets.
    expect(namingTypes(gaps('ApexTestSuite', 'ApexClass'), field, ANALYSED)).toEqual(
      gaps('ApexTestSuite', 'ApexClass'),
    );
    expect(namingTypes(gaps('PermissionSetGroup', 'PermissionSet'), field, ANALYSED)).toEqual(
      gaps('PermissionSetGroup', 'PermissionSet'),
    );
    // A letterhead names a document, and a document names its folder: not the document asked about.
    expect(namingTypes(gaps('Letterhead', 'Document', 'DocumentFolder'), field, ANALYSED)).toEqual([]);
    expect(namingTypes(gaps('Letterhead', 'Document'), ['Document'], ANALYSED)).toEqual(gaps('Letterhead'));
    expect(namingTypes(gaps('Letterhead', 'Document', 'DocumentFolder'), ['DocumentFolder'], ANALYSED)).toEqual(
      gaps('Letterhead', 'Document', 'DocumentFolder'),
    );
  });

  it('does not keep a type for naming its own type, unless that type is of the answer', () => {
    expect(namingTypes(gaps('CustomPermission'), field, ANALYSED)).toEqual([]);
    expect(namingTypes(gaps('CustomPermission'), ['CustomPermission'], ANALYSED)).toEqual(gaps('CustomPermission'));
    // A folder of reports or dashboards can lie in another of its type.
    const folders = gaps('DashboardFolder', 'DocumentFolder', 'EmailFolder', 'ReportFolder');
    for (const { type } of folders) expect(namingTypes(folders, [type], ANALYSED)).toEqual(gaps(type));
    expect(namingTypes(folders, field, ANALYSED)).toEqual([]);
  });

  it('keeps a type that names an analysed type once another type stays, in any order of the list', () => {
    // A reason names its object. An object that is no result can name a page that refers to the field.
    expect(namingTypes(gaps('SharingReason'), field, ANALYSED)).toEqual([]);
    expect(namingTypes(gaps('SharingReason', 'CustomLabels'), field, ANALYSED)).toEqual([]);
    expect(namingTypes(gaps('SharingReason', 'ApexPage'), field, ANALYSED)).toEqual(gaps('SharingReason', 'ApexPage'));
    expect(namingTypes(gaps('ApexPage', 'SharingReason'), field, ANALYSED)).toEqual(gaps('ApexPage', 'SharingReason'));
    expect(namingTypes(gaps('SharingReason'), ['CustomField', 'CustomObject'], ANALYSED)).toEqual(
      gaps('SharingReason'),
    );
    // What is not analysed does not join the answer for that: a custom permission names one of its own type.
    expect(namingTypes(gaps('CustomPermission', 'ApexPage'), field, ANALYSED)).toEqual(gaps('ApexPage'));
    expect(namingTypes(gaps('SharingReason', 'ApexPage'), field, [])).toEqual(gaps('ApexPage'));
    expect(namingTypes(gaps('SharingReason', 'ApexPage'), field, new Set(['CustomObject']))).toEqual(
      gaps('SharingReason', 'ApexPage'),
    );
  });

  it('leaves the entries as they are', () => {
    const entry = { type: 'ApexClass', listed: 2, retrieved: 1, listing: 'ok' };
    expect(namingTypes([entry], [], [])).toEqual([entry]);
    expect(namingTypes([entry], [], [])[0]).toBe(entry);
  });
});
