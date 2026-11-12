import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { projectFiles } from './helpers/git-repo.ts';
import { tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

function project(files: Record<string, string>): string {
  const root = temp.next();
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, ...path.split('/'), '..'), { recursive: true });
    writeFileSync(join(root, ...path.split('/')), content);
  }
  return root;
}

const LABELS = `<?xml version="1.0" encoding="UTF-8"?>
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>Greeting</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Greeting</shortDescription>
        <value>Hello</value>
    </labels>
    <labels>
        <fullName>Farewell</fullName>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Farewell</shortDescription>
        <value>Goodbye</value>
    </labels>
</CustomLabels>
`;

describe('resolving components', () => {
  it('finds exactly the components of the fixture project that its answer key lists', async () => {
    const key = loadAnswerKey();
    const root = join(FIXTURES_DIR, key.project);
    const { tree } = readFolders(root, ['force-app']);
    const resolution = await resolveComponents(tree, ['force-app']);

    expect(resolution.components.map((component) => `${component.type}:${component.fullName}`).sort()).toEqual(
      key.components.map((component) => `${component.type}:${component.fullName}`).sort(),
    );
    expect(resolution).toMatchObject({ unresolved: [], problems: [] });
  });

  it('gives every file of the fixture to exactly one component', async () => {
    const root = join(FIXTURES_DIR, loadAnswerKey().project);
    const { tree } = readFolders(root, ['force-app']);
    const { components } = await resolveComponents(tree, ['force-app']);

    const owned = components.flatMap((component) => component.files);
    expect([...owned].sort()).toEqual([...tree.files].sort());
    expect(new Set(owned).size).toBe(owned.length);
    // A class owns its two files. An object owns its own file, and each field owns its own.
    const files = (type: string, fullName: string): readonly string[] | undefined =>
      components.find((component) => component.type === type && component.fullName === fullName)?.files;
    expect(files('ApexClass', 'InvoiceService')).toEqual([
      'force-app/main/default/classes/InvoiceService.cls',
      'force-app/main/default/classes/InvoiceService.cls-meta.xml',
    ]);
    expect(files('CustomObject', 'Invoice__c')).toEqual([
      'force-app/main/default/objects/Invoice__c/Invoice__c.object-meta.xml',
    ]);
    expect(files('CustomField', 'Account.Tier__c')).toEqual([
      'force-app/main/default/objects/Account/fields/Tier__c.field-meta.xml',
    ]);
  });

  it('gives the same result for a copy of the project in another folder', async () => {
    // The paths the library works with are not paths of the disk, so the place of the files cannot matter.
    const root = temp.next();
    cpSync(join(FIXTURES_DIR, loadAnswerKey().project, 'force-app'), join(root, 'src with space', 'ünï'), {
      recursive: true,
    });
    const dir = 'src with space/ünï';
    const { tree } = readFolders(root, [dir]);
    const resolution = await resolveComponents(tree, [dir]);
    expect(resolution.components).toHaveLength(52);
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.components.flatMap((component) => component.files).every((file) => file.startsWith(dir))).toBe(
      true,
    );
  });

  it('sorts the components by type and name, and their files by path', async () => {
    const root = project(projectFiles());
    const { components } = await resolveComponents(readFolders(root, ['force-app']).tree, ['force-app']);
    expect(components).toEqual([
      {
        type: 'ApexClass',
        fullName: 'Greeter',
        files: ['force-app/main/default/classes/Greeter.cls', 'force-app/main/default/classes/Greeter.cls-meta.xml'],
      },
      {
        type: 'CustomField',
        fullName: 'Parcel__c.Weight__c',
        files: ['force-app/main/default/objects/Parcel__c/fields/Weight__c.field-meta.xml'],
      },
      {
        type: 'CustomObject',
        fullName: 'Parcel__c',
        files: ['force-app/main/default/objects/Parcel__c/Parcel__c.object-meta.xml'],
      },
    ]);
  });

  it('finds the components that are elements of one file, and gives the file to the parent', async () => {
    const root = project({ 'force-app/main/default/labels/CustomLabels.labels-meta.xml': LABELS });
    const { components, problems } = await resolveComponents(readFolders(root, ['force-app']).tree, ['force-app']);
    expect(problems).toEqual([]);
    expect(components).toEqual([
      { type: 'CustomLabel', fullName: 'Farewell', files: [] },
      { type: 'CustomLabel', fullName: 'Greeting', files: [] },
      {
        type: 'CustomLabels',
        fullName: 'CustomLabels',
        files: ['force-app/main/default/labels/CustomLabels.labels-meta.xml'],
      },
    ]);
  });

  it('puts the parts of one object together when they lie in two package directories', async () => {
    const root = project({
      ...projectFiles('core/main'),
      'extension/main/objects/Parcel__c/fields/Colour__c.field-meta.xml': '<CustomField/>',
      'extension/main/objects/Account/fields/Region__c.field-meta.xml': '<CustomField/>',
    });
    const dirs = ['core', 'extension'];
    const { components, unresolved } = await resolveComponents(readFolders(root, dirs).tree, dirs);
    expect(unresolved).toEqual([]);
    expect(components.map((component) => `${component.type}:${component.fullName}`)).toEqual([
      'ApexClass:Greeter',
      'CustomField:Account.Region__c',
      'CustomField:Parcel__c.Colour__c',
      'CustomField:Parcel__c.Weight__c',
      'CustomObject:Parcel__c',
    ]);
  });

  it('lists the files that belong to no component, and only those below the folders it was given', async () => {
    const root = project({
      ...projectFiles(),
      'force-app/main/default/classes/NoMeta.cls': 'public class NoMeta {}',
      'force-app/main/default/classes/notes.txt': 'not metadata',
      'force-app/README.md': '# not metadata',
      'docs/guide.md': 'outside the package directory',
    });
    const { tree } = readFolders(root, ['force-app', 'docs']);
    const resolution = await resolveComponents(tree, ['force-app']);
    expect(resolution.unresolved).toEqual([
      'force-app/README.md',
      'force-app/main/default/classes/NoMeta.cls',
      'force-app/main/default/classes/notes.txt',
    ]);
    expect(resolution.components).toHaveLength(3);
  });

  it('reports a file it cannot read as metadata, and still resolves the rest', async () => {
    const root = project({
      ...projectFiles(),
      'force-app/main/default/labels/CustomLabels.labels-meta.xml': '<CustomLabels><labels><fullName>Broken',
    });
    const resolution = await resolveComponents(readFolders(root, ['force-app']).tree, ['force-app']);
    expect(resolution.problems).toHaveLength(1);
    expect(resolution.problems[0]?.at).toBe('CustomLabels CustomLabels');
    // The message names the file as a path of the source, not as a path of the machine.
    expect(resolution.problems[0]?.message).not.toContain('orglens-source');
    expect(resolution.components.map((component) => component.type)).toEqual([
      'ApexClass',
      'CustomField',
      'CustomLabels',
      'CustomObject',
    ]);
  });

  it('reports a file that cannot be opened without the path it has on this machine', async () => {
    const labels = 'force-app/main/default/labels/CustomLabels.labels-meta.xml';
    const root = project({ ...projectFiles(), [labels]: LABELS });
    const { tree } = readFolders(root, ['force-app']);
    const { components, problems } = await resolveComponents(
      {
        files: tree.files,
        read: (path) => {
          if (path !== labels) return tree.read(path);
          throw Object.assign(new Error(`EACCES: permission denied, open '${join(root, labels)}'`), { code: 'EACCES' });
        },
      },
      ['force-app'],
    );
    expect(problems).toEqual([{ at: 'CustomLabels CustomLabels', message: `${labels} could not be read (EACCES).` }]);
    expect(components.map((component) => component.type)).toEqual([
      'ApexClass',
      'CustomField',
      'CustomLabels',
      'CustomObject',
    ]);
  });

  it('skips a folder that the tree does not have', async () => {
    const root = project(projectFiles());
    const resolution = await resolveComponents(readFolders(root, ['force-app']).tree, ['force-app', 'nowhere']);
    expect(resolution.components).toHaveLength(3);
    expect(resolution.problems).toEqual([]);
  });
});
