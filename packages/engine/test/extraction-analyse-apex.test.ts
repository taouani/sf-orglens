/**
 * How the analysis parses Apex (decision records 0083 and 0084): it parses the code of every class and trigger with
 * the reader it is given, a file that does not parse is an error of its component, and a class whose code
 * Salesforce hides is not parsed. What it reads of the code that parses is held by `extraction-apex.test.ts`.
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyseSource, readsApex } from '../src/extraction/analyse.ts';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import type { ApexReader } from '../src/extraction/apex-syntax.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { ApexSource, codes, key, Source } from './helpers/written-source.ts';

let apex: ApexReader;
beforeAll(async () => {
  apex = await loadApexReader();
});

const BROKEN = ['public class Broken {', '    void m() {', '        Integer x = ;', '    }', '}', ''].join('\n');

describe('the analysis of Apex', () => {
  it('parses every class and trigger of the fixture project without an error, and changes nothing else', async () => {
    const { tree } = readFolders(join(FIXTURES_DIR, 'billing-sfdx'), ['force-app']);
    const listed = (await resolveComponents(tree, ['force-app'])).components;
    expect(listed.filter((one) => one.type === 'ApexClass' || one.type === 'ApexTrigger')).toHaveLength(30);
    expect(readsApex(listed)).toBe(true);
    const isApex = (key: string): boolean => /^Apex(?:Class|Trigger):/.test(key);
    const withApex = analyseSource(tree, listed, { apex });
    const without = analyseSource(tree, listed);
    // The code adds the issues of its own components, none an error, and nothing else.
    expect(withApex.issues.filter((one) => one.severity === 'error')).toEqual([]);
    expect(withApex.issues.filter((one) => one.componentKey === null || !isApex(one.componentKey))).toEqual(
      without.issues,
    );
    expect(withApex.components.filter((one) => !isApex(one.key))).toEqual(
      without.components.filter((one) => !isApex(one.key)),
    );
    // Without the reader, a class and a trigger are components that are not analysed, and have no members.
    expect(without.components.filter((one) => isApex(one.key)).map((one) => one.attrs)).toEqual(
      Array.from({ length: 30 }, () => null),
    );
    // Classes and triggers are read in part, and are not among the types an answer counts as read.
    expect(withApex.types).toEqual(without.types);
    expect(withApex.types).not.toContain('ApexClass');
    expect(withApex.types).not.toContain('ApexTrigger');
  });

  it('makes a file that does not parse an error of its class, at the first place the parser cannot read', () => {
    const source = new ApexSource();
    source.apexClass('Good', 'public class Good { }\n');
    const path = source.apexClass('Broken', BROKEN);
    const analysis = analyseSource(source.tree, source.listed, { apex });
    expect(analysis.issues).toHaveLength(1);
    const [issue] = analysis.issues;
    expect(issue).toMatchObject({
      severity: 'error',
      code: 'APEX_MALFORMED',
      componentKey: key('ApexClass', 'Broken'),
      details: { path, line: 3 },
    });
    expect(issue?.message).toMatch(/^classes\/Broken\.cls, line 3, column \d+: .+ nothing of it is analysed\.$/);
    expect(issue?.details?.['column']).toEqual(expect.any(Number));
    // The class keeps its row, is not analysed, and costs nothing else.
    expect(analysis.components.map((one) => one.key)).toEqual([key('ApexClass', 'Broken'), key('ApexClass', 'Good')]);
    expect(analysis.components.find((one) => one.key === key('ApexClass', 'Broken'))).toMatchObject({
      definition: { path: `${path}-meta.xml` },
      attrs: null,
      references: [],
    });
    expect(analysis.components.find((one) => one.key === key('ApexClass', 'Good'))?.attrs).toEqual({ kind: 'class' });
    expect(analysis.work.find((row) => row.origin === 'parser:apex')).toEqual({
      origin: 'parser:apex',
      components: 1,
      failedFiles: 1,
    });
  });

  it('makes a trigger that does not parse an error of the trigger', () => {
    const source = new ApexSource();
    const path = source.apexTrigger('Half', 'trigger Half on Invoice__c (before insert) {\n    Integer x = ;\n}\n');
    const analysis = analyseSource(source.tree, source.listed, { apex });
    expect(analysis.issues).toMatchObject([
      {
        severity: 'error',
        code: 'APEX_MALFORMED',
        componentKey: key('ApexTrigger', 'Half'),
        details: { path, line: 2 },
      },
    ]);
  });

  it('makes a file that is not UTF-8 an error, without a place', () => {
    const source = new ApexSource();
    const path = source.apexClass('Latin', Buffer.from("public class Latin { String s = 'caf\xe9'; }\n", 'latin1'));
    const analysis = analyseSource(source.tree, source.listed, { apex });
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'APEX_MALFORMED',
        message: 'classes/Latin.cls is not text in UTF-8. Nothing of its Apex is analysed.',
        componentKey: key('ApexClass', 'Latin'),
        details: { path, line: null, column: null },
      },
    ]);
  });

  it('does not parse a class whose code Salesforce hides, and says that what it refers to is not known', () => {
    const source = new ApexSource();
    const path = source.apexClass('Packaged', '(hidden)');
    source.apexClass('PackagedToo', '(hidden)\n');
    const analysis = analyseSource(source.tree, source.listed, { apex });
    expect(analysis.issues).toHaveLength(2);
    expect(analysis.issues[0]).toEqual({
      severity: 'warning',
      code: 'APEX_NO_CODE',
      message: `${path} holds "(hidden)" in the place of its code: Salesforce hides the code of a class of a managed package. Nothing of the class is analysed, so what it refers to is not known.`,
      componentKey: key('ApexClass', 'Packaged'),
      details: { path },
    });
    // Each is a component that is defined and not analysed, and no file of it counts as one that was not read.
    expect(analysis.components.map((one) => [one.key, one.attrs, one.definition?.path])).toEqual([
      [key('ApexClass', 'Packaged'), null, `${path}-meta.xml`],
      [key('ApexClass', 'PackagedToo'), null, 'classes/PackagedToo.cls-meta.xml'],
    ]);
    expect(analysis.work.find((row) => row.origin === 'parser:apex')).toMatchObject({ components: 0, failedFiles: 0 });
  });

  it('says the same of a class that has no file of code', () => {
    const source = new ApexSource();
    source.listed.push({
      type: 'ApexClass',
      fullName: 'Bare',
      files: [source.file('classes/Bare.cls-meta.xml', '<ApexClass/>')],
    });
    expect(analyseSource(source.tree, source.listed, { apex }).issues).toEqual([
      {
        severity: 'warning',
        code: 'APEX_NO_CODE',
        message:
          'classes/Bare.cls-meta.xml stands for a class that has no file of code. Nothing of the class is analysed, so what it refers to is not known.',
        componentKey: key('ApexClass', 'Bare'),
        details: { path: 'classes/Bare.cls-meta.xml' },
      },
    ]);
  });

  it('parses nothing without the reader of Apex, and needs it only for a class or a trigger', () => {
    const source = new ApexSource();
    source.apexClass('Broken', BROKEN);
    expect(codes(analyseSource(source.tree, source.listed).issues)).toEqual([]);
    expect(readsApex(source.listed)).toBe(true);

    const withoutApex = new Source();
    withoutApex.object('Invoice__c', '<label>Invoice</label>');
    expect(readsApex(withoutApex.listed)).toBe(false);
  });

  it('makes a fault of the reader a failed analysis of the class, not a file that does not parse', () => {
    const source = new ApexSource();
    const path = source.apexClass('Good', 'public class Good { }\n');
    const faulty: ApexReader = {
      name: 'faulty',
      parseUnit: () => {
        throw new Error('The reader has a bug.');
      },
      parseQuery: () => undefined,
      parseSearch: () => undefined,
    };
    const analysis = analyseSource(source.tree, source.listed, { apex: faulty });
    expect(analysis.issues).toEqual([
      {
        severity: 'error',
        code: 'ANALYSIS_FAILED',
        message: 'The analysis of a ApexClass failed: The reader has a bug.',
        componentKey: key('ApexClass', 'Good'),
        details: { type: 'ApexClass', path },
      },
    ]);
    expect(analysis.components.map((one) => one.key)).toEqual([key('ApexClass', 'Good')]);
  });

  it('reports a file of a class that cannot be read once, as the analysis does for every file', () => {
    const source = new ApexSource();
    const path = source.apexClass('Gone', 'public class Gone { }\n');
    source.broken.add(path);
    const analysis = analyseSource(source.tree, source.listed, { apex });
    expect(codes(analysis.issues)).toEqual(['error FILE_UNREADABLE']);
    // It counts for the reader of Apex, and not for the reader of XML.
    expect(analysis.work.map((row) => [row.origin, row.failedFiles])).toEqual([
      ['parser:xml', 0],
      ['parser:formula', 0],
      ['parser:flow', 0],
      ['parser:apex', 1],
    ]);
  });
});
