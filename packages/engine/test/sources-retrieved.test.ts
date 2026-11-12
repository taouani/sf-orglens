import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { afterAll, describe, expect, it } from 'vitest';
import { readFolders } from '../src/sources/folder.ts';
import { unpackRetrieve } from '../src/sources/retrieved.ts';
import { metadataFromSource } from './helpers/mock-metadata.ts';
import { tempDirs } from './helpers/store.ts';

const FIXTURE = join(import.meta.dirname, '../../../fixtures/billing-sfdx/force-app');
const dirs = tempDirs();
afterAll(() => {
  dirs.cleanUp();
});

/** The zip file the mock org hands out for the members, each given as `Type:FullName`. */
async function retrieved(members: readonly string[]): Promise<Buffer> {
  const metadata = await metadataFromSource(FIXTURE);
  metadata.pollsBeforeDone = 0;
  const types = new Map<string, string[]>();
  for (const member of members) {
    const [type = '', fullName = ''] = member.split(':');
    types.set(type, [...(types.get(type) ?? []), fullName]);
  }
  const manifest = [...types]
    .map(
      ([type, names]) =>
        `<types>${names.map((name) => `<members>${name}</members>`).join('')}<name>${type}</name></types>`,
    )
    .join('');
  const started = await metadata.answer(
    `<soapenv:Body><retrieve><request>${manifest}</request></retrieve></soapenv:Body>`,
  );
  const id = /<id>([^<]+)<\/id>/.exec(started.body)?.[1] ?? '';
  const done = await metadata.answer(
    `<soapenv:Body><checkRetrieveStatus><asyncProcessId>${id}</asyncProcessId><includeZip>true</includeZip></checkRetrieveStatus></soapenv:Body>`,
  );
  return Buffer.from(/<zipFile>([^<]+)<\/zipFile>/.exec(done.body)?.[1] ?? '', 'base64');
}

const workDir = (): string => dirs.next();

/** Every file below a folder, relative to it, with forward slashes. */
const walk = (dir: string): string[] =>
  readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path).map((inner) => `${name}/${inner}`) : [name];
    })
    .sort();

describe('the files of a retrieve', () => {
  it('are converted to the form a repository holds them in, with the paths below the package directory', async () => {
    const zip = await retrieved(['ApexTrigger:InvoiceTrigger', 'CustomObject:Invoice_Line__c']);
    const unpacked = await unpackRetrieve(zip, workDir());
    expect(unpacked.problems).toEqual([]);
    expect(unpacked.unresolved).toEqual([]);
    expect(unpacked.tree.files).toContain('triggers/InvoiceTrigger.trigger');
    expect(unpacked.tree.files).toContain('triggers/InvoiceTrigger.trigger-meta.xml');
    expect(unpacked.tree.files).toContain('objects/Invoice_Line__c/Invoice_Line__c.object-meta.xml');
    expect(unpacked.tree.files).toContain('objects/Invoice_Line__c/fields/Quantity__c.field-meta.xml');
    expect(unpacked.components.map((one) => `${one.type}:${one.fullName}`)).toEqual(
      expect.arrayContaining([
        'ApexTrigger:InvoiceTrigger',
        'CustomField:Invoice_Line__c.Quantity__c',
        'CustomObject:Invoice_Line__c',
        'ValidationRule:Invoice_Line__c.Price_Not_Negative',
      ]),
    );
    const trigger = Buffer.from(unpacked.tree.read('triggers/InvoiceTrigger.trigger')).toString('utf8');
    expect(trigger).toContain('trigger InvoiceTrigger on Invoice__c');
  });

  it('are the files of the fixture project, and the file of each object the project has only parts of', async () => {
    const zip = await retrieved([
      ...readFolders(FIXTURE, ['main/default/classes'])
        .tree.files.filter((path) => path.endsWith('.cls'))
        .map((path) => `ApexClass:${path.slice(path.lastIndexOf('/') + 1, -'.cls'.length)}`),
      'ApexTrigger:InvoiceTrigger',
      'CustomObject:Account',
      'CustomObject:Invoice__c',
      'CustomObject:Invoice_Line__c',
    ]);
    const unpacked = await unpackRetrieve(zip, workDir());
    const fixture = readFolders(FIXTURE, ['main/default']).tree.files.map((path) => path.slice('main/default/'.length));
    expect(unpacked.tree.files.filter((path) => !fixture.includes(path))).toEqual([
      'objects/Account/Account.object-meta.xml',
    ]);
    expect(fixture.filter((path) => !unpacked.tree.files.includes(path))).toEqual([]);
    // Apex comes back byte for byte. XML is written again by the library and is compared by Phase 1, not here.
    for (const path of fixture.filter((one) => one.endsWith('.cls') || one.endsWith('.trigger'))) {
      expect(
        Buffer.from(unpacked.tree.read(path)).equals(
          readFolders(FIXTURE, ['main/default']).tree.read(`main/default/${path}`) as Buffer,
        ),
      ).toBe(true);
    }
  });

  it('are none for a retrieve that handed out nothing', async () => {
    const unpacked = await unpackRetrieve(await retrieved(['ApexClass:Gone']), workDir());
    expect(unpacked).toMatchObject({ components: [], problems: [], unresolved: [] });
    expect(unpacked.tree.files).toEqual([]);
  });

  it('name a file the library cannot place, and keep everything beside it', async () => {
    const zip = await JSZip.loadAsync(await retrieved(['ApexTrigger:InvoiceTrigger']));
    zip.file('unpackaged/mysteries/Thing.mystery', 'what is this');
    const unpacked = await unpackRetrieve(await zip.generateAsync({ type: 'nodebuffer' }), workDir());
    expect(unpacked.tree.files).toEqual([
      'triggers/InvoiceTrigger.trigger',
      'triggers/InvoiceTrigger.trigger-meta.xml',
    ]);
    expect(unpacked.problems.map((problem) => problem.at)).toEqual(['mysteries/Thing.mystery']);
  });

  it('name a file whose type the library cannot tell, down to the file, and keep everything beside it', async () => {
    const zip = await JSZip.loadAsync(await retrieved(['ApexTrigger:InvoiceTrigger']));
    zip.file('unpackaged/mysteries/deep/Thing.mystery-meta.xml', '<Mystery/>');
    const unpacked = await unpackRetrieve(await zip.generateAsync({ type: 'nodebuffer' }), workDir());
    expect(unpacked.tree.files).toEqual([
      'triggers/InvoiceTrigger.trigger',
      'triggers/InvoiceTrigger.trigger-meta.xml',
    ]);
    expect(unpacked.problems.map((problem) => problem.at)).toEqual(['mysteries/deep/Thing.mystery-meta.xml']);
    expect(unpacked.problems[0]?.message).not.toContain('unpackaged/');
  });

  it('name a component that cannot be converted, and convert the others', async () => {
    const zip = await JSZip.loadAsync(await retrieved(['ApexTrigger:InvoiceTrigger']));
    zip.file('unpackaged/objects/Broken__c.object', 'this is not XML <');
    const unpacked = await unpackRetrieve(await zip.generateAsync({ type: 'nodebuffer' }), workDir());
    expect(unpacked.tree.files).toEqual([
      'triggers/InvoiceTrigger.trigger',
      'triggers/InvoiceTrigger.trigger-meta.xml',
    ]);
    expect(unpacked.problems.map((problem) => problem.at)).toEqual(['CustomObject Broken__c']);
  });

  it('hold custom labels as one file, whatever the project around the work folder says about them', async () => {
    const labels = (names: readonly string[]): string =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">\n${names
        .map(
          (name) =>
            `    <labels>\n        <fullName>${name}</fullName>\n        <language>en_US</language>\n        <protected>false</protected>\n        <shortDescription>${name}</shortDescription>\n        <value>${name}</value>\n    </labels>\n`,
        )
        .join('')}</CustomLabels>\n`;
    const zip = new JSZip();
    zip.file('unpackaged/package.xml', '<Package xmlns="http://soap.sforce.com/2006/04/metadata"/>');
    zip.file('unpackaged/labels/CustomLabels.labels', labels(['Greeting', 'Farewell']));

    // The work folder lies in the repository of a user, whose project asks for another layout of labels and of
    // permission sets, and the command runs there. The library looks for a project from the folder it writes to
    // upwards, and from the folder the process runs in.
    const repository = workDir();
    writeFileSync(
      join(repository, 'sfdx-project.json'),
      JSON.stringify({
        packageDirectories: [{ path: 'force-app', default: true }],
        sourceBehaviorOptions: ['decomposeCustomLabelsBeta2', 'decomposePermissionSetBeta2'],
      }),
    );
    const inside = join(repository, '.orglens', 'tmp', 'chunk-0');
    mkdirSync(inside, { recursive: true });
    const homeBefore = walk(homedir());

    const startedIn = process.cwd();
    process.chdir(repository);
    let unpacked: Awaited<ReturnType<typeof unpackRetrieve>>;
    try {
      unpacked = await unpackRetrieve(await zip.generateAsync({ type: 'nodebuffer' }), inside);
    } finally {
      process.chdir(startedIn);
    }
    expect(unpacked.problems).toEqual([]);
    expect(unpacked.tree.files).toEqual(['labels/CustomLabels.labels-meta.xml']);
    expect(unpacked.components.map((component) => `${component.type}:${component.fullName}`)).toEqual([
      'CustomLabel:Farewell',
      'CustomLabel:Greeting',
      'CustomLabels:CustomLabels',
    ]);
    const stored = Buffer.from(unpacked.tree.read('labels/CustomLabels.labels-meta.xml')).toString('utf8');
    expect(stored).toContain('<fullName>Greeting</fullName>');
    expect(stored).toContain('<fullName>Farewell</fullName>');
    // Nothing was written beside the work folder: not into the repository, and not into the home folder.
    expect(walk(repository).filter((file) => !file.startsWith('.orglens/tmp/chunk-0/'))).toEqual(['sfdx-project.json']);
    expect(walk(homedir())).toEqual(homeBefore);
  });

  it('are read from a zip file that has no entries for its folders', async () => {
    const whole = await JSZip.loadAsync(await retrieved(['ApexTrigger:InvoiceTrigger']));
    const flat = new JSZip();
    for (const [path, entry] of Object.entries(whole.files)) {
      if (!entry.dir) flat.file(path, await entry.async('nodebuffer'), { createFolders: false });
    }
    expect(Object.keys(flat.files).some((path) => path.endsWith('/'))).toBe(false);
    const unpacked = await unpackRetrieve(await flat.generateAsync({ type: 'nodebuffer' }), workDir());
    expect(unpacked.tree.files).toEqual([
      'triggers/InvoiceTrigger.trigger',
      'triggers/InvoiceTrigger.trigger-meta.xml',
    ]);
    expect(unpacked.problems).toEqual([]);
  });

  it('name what a zip file holds beside the folder of the retrieve, which is not read', async () => {
    const zip = await JSZip.loadAsync(await retrieved(['ApexTrigger:InvoiceTrigger']));
    zip.file('elsewhere/classes/Stray.cls', 'public class Stray {}');
    zip.file('notes.txt', 'a note');
    const unpacked = await unpackRetrieve(await zip.generateAsync({ type: 'nodebuffer' }), workDir());
    expect(unpacked.tree.files).toEqual([
      'triggers/InvoiceTrigger.trigger',
      'triggers/InvoiceTrigger.trigger-meta.xml',
    ]);
    expect(unpacked.problems).toEqual([
      { at: 'elsewhere', message: 'It is outside the folder "unpackaged" of the zip file, so it was not read.' },
      { at: 'notes.txt', message: 'It is outside the folder "unpackaged" of the zip file, so it was not read.' },
    ]);
  });
});
