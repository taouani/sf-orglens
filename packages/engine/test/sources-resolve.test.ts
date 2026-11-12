import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { projectFiles } from './helpers/git-repo.ts';
import { libraryFiles, libraryReading } from './helpers/library-reading.ts';
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

  it('finds the components and the files that the resolver of Salesforce finds on disk itself', async () => {
    // The fixture project, and a project with types the fixture has not: labels in one file, parts in two folders.
    const synthetic = project({
      ...projectFiles('core/main'),
      'core/main/labels/CustomLabels.labels-meta.xml': LABELS,
      'extension/main/objects/Parcel__c/fields/Colour__c.field-meta.xml': '<CustomField/>',
      'extension/main/objects/Account/fields/Region__c.field-meta.xml': '<CustomField/>',
      'extension/main/lwc/hello/hello.js': 'export default class Hello {}',
      'extension/main/lwc/hello/hello.html': '<template></template>',
      'extension/main/lwc/hello/hello.js-meta.xml': '<LightningComponentBundle/>',
      'extension/main/lwc/hello/__tests__/hello.test.js': '// a test',
      'extension/main/staticresources/logo.resource-meta.xml':
        '<StaticResource><contentType>image/png</contentType></StaticResource>',
      'extension/main/staticresources/logo.png': 'not really an image',
      'extension/main/staticresources/bundle.resource-meta.xml':
        '<StaticResource><contentType>application/zip</contentType></StaticResource>',
      'extension/main/staticresources/bundle/a/b.js': '// b',
      'extension/main/staticresources/bundle/c.css': '/* c */',
    });
    for (const [root, dirs] of [
      [join(FIXTURES_DIR, 'billing-sfdx'), ['force-app']],
      [synthetic, ['core', 'extension']],
    ] as const) {
      const { tree } = readFolders(root, dirs);
      const ours = await resolveComponents(tree, dirs);
      const theirs = libraryReading(root, dirs);
      expect(ours.problems).toEqual([]);
      expect(ours.components.map((component) => `${component.type}:${component.fullName}`).sort()).toEqual(
        [...theirs.keys()].sort(),
      );
      const owned = ours.components.flatMap((component) => component.files).sort();
      // No file twice, and exactly the files the library names for any component.
      expect(new Set(owned).size).toBe(owned.length);
      expect(owned).toEqual(libraryFiles(theirs));
      expect(theirs.size).toBeGreaterThan(8);
    }
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
    const { components, unresolved, duplicates } = await resolveComponents(readFolders(root, dirs).tree, dirs);
    expect(unresolved).toEqual([]);
    expect(duplicates).toEqual([]);
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

  it('loses one file, not the folder, when the library cannot place a -meta.xml file', async () => {
    const orphan = 'force-app/main/default/classes/Orphan.cls-meta.xml';
    const root = project({
      ...projectFiles(),
      // The file of a class that is not there. The library gives up on the whole package directory for it.
      [orphan]: '<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>65.0</apiVersion></ApexClass>',
      'force-app/main/default/classes/NoMeta.cls': 'public class NoMeta {}',
      'force-app/main/default/classes/notes.txt': 'not metadata',
      'force-app/main/default/labels/CustomLabels.labels-meta.xml': LABELS,
    });
    const { tree } = readFolders(root, ['force-app']);
    const resolution = await resolveComponents(tree, ['force-app']);

    expect(resolution.problems).toHaveLength(1);
    expect(resolution.problems[0]?.at).toBe(orphan);
    expect(resolution.problems[0]?.message).not.toContain('orglens-source');
    // Everything else is found, with all its files, as if the file were not there.
    const without = await resolveComponents(
      { files: tree.files.filter((file) => file !== orphan), read: (path) => tree.read(path) },
      ['force-app'],
    );
    expect(without.problems).toEqual([]);
    expect(resolution.components).toEqual(without.components);
    expect(resolution.components.map((component) => `${component.type}:${component.fullName}`)).toEqual([
      'ApexClass:Greeter',
      'CustomField:Parcel__c.Weight__c',
      'CustomLabel:Farewell',
      'CustomLabel:Greeting',
      'CustomLabels:CustomLabels',
      'CustomObject:Parcel__c',
    ]);
    // The file is named by the problem and not once more. Files that belong to nothing are still listed.
    expect(resolution.unresolved).toEqual([
      'force-app/main/default/classes/NoMeta.cls',
      'force-app/main/default/classes/notes.txt',
    ]);
  });

  it('narrows several failures in several folders down to each file', async () => {
    const meta =
      '<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>65.0</apiVersion></ApexTrigger>';
    const root = project({
      ...projectFiles('one/main'),
      ...projectFiles('two/main'),
      'one/main/classes/Orphan.cls-meta.xml': meta.replaceAll('ApexTrigger', 'ApexClass'),
      'one/main/triggers/Lost.trigger-meta.xml': meta,
      'two/main/triggers/Gone.trigger-meta.xml': meta,
    });
    const dirs = ['one', 'two'];
    const resolution = await resolveComponents(readFolders(root, dirs).tree, dirs);
    expect(resolution.problems.map((problem) => problem.at)).toEqual([
      'one/main/classes/Orphan.cls-meta.xml',
      'one/main/triggers/Lost.trigger-meta.xml',
      'two/main/triggers/Gone.trigger-meta.xml',
    ]);
    expect(resolution.unresolved).toEqual([]);
    expect(resolution.components.map((component) => component.type)).toEqual([
      'ApexClass',
      'CustomField',
      'CustomObject',
    ]);
    expect(resolution.components.find((component) => component.type === 'ApexClass')?.files).toHaveLength(4);
  });

  it('says so when a component without parts is defined in two places', async () => {
    const root = project({
      ...projectFiles('core/main'),
      ...projectFiles('extension/main'),
      'core/test/classes/Greeter.cls': 'public class Greeter { /* a third one */ }',
      'core/test/classes/Greeter.cls-meta.xml': '<ApexClass/>',
    });
    const dirs = ['core', 'extension'];
    const resolution = await resolveComponents(readFolders(root, dirs).tree, dirs);
    expect(resolution.duplicates).toEqual([
      {
        type: 'ApexClass',
        fullName: 'Greeter',
        paths: [
          'core/main/classes/Greeter.cls-meta.xml',
          'core/test/classes/Greeter.cls-meta.xml',
          'extension/main/classes/Greeter.cls-meta.xml',
        ],
      },
      {
        type: 'CustomField',
        fullName: 'Parcel__c.Weight__c',
        paths: [
          'core/main/objects/Parcel__c/fields/Weight__c.field-meta.xml',
          'extension/main/objects/Parcel__c/fields/Weight__c.field-meta.xml',
        ],
      },
    ]);
    // It is still one component by name, and it owns the files of every definition, so none is lost from view.
    expect(resolution.components.find((component) => component.type === 'ApexClass')?.files).toHaveLength(6);
    expect(resolution.unresolved).toEqual([]);
  });

  it('says so when one custom label is in two files, and not when two files hold different labels', async () => {
    const other = LABELS.replaceAll('Greeting', 'Welcome').replaceAll('Farewell', 'Thanks');
    const apart = project({
      'core/labels/CustomLabels.labels-meta.xml': LABELS,
      'extension/labels/CustomLabels.labels-meta.xml': other,
    });
    const dirs = ['core', 'extension'];
    const fine = await resolveComponents(readFolders(apart, dirs).tree, dirs);
    expect(fine.duplicates).toEqual([]);
    expect(fine.components.map((component) => component.fullName)).toEqual([
      'Farewell',
      'Greeting',
      'Thanks',
      'Welcome',
      'CustomLabels',
    ]);

    const twice = project({
      'core/labels/CustomLabels.labels-meta.xml': LABELS,
      'extension/labels/CustomLabels.labels-meta.xml': other.replaceAll('Thanks', 'Farewell'),
    });
    expect((await resolveComponents(readFolders(twice, dirs).tree, dirs)).duplicates).toEqual([
      {
        type: 'CustomLabel',
        fullName: 'Farewell',
        paths: ['core/labels/CustomLabels.labels-meta.xml', 'extension/labels/CustomLabels.labels-meta.xml'],
      },
    ]);
  });

  it('skips a folder that the tree does not have', async () => {
    const root = project(projectFiles());
    const resolution = await resolveComponents(readFolders(root, ['force-app']).tree, ['force-app', 'nowhere']);
    expect(resolution.components).toHaveLength(3);
    expect(resolution.problems).toEqual([]);
  });
});
