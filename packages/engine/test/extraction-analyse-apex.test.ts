/**
 * What the analysis does with Apex in work package 2 of the Phase 3 plan (decision record 0083): it parses the code
 * of every class and trigger with the reader it is given, and a file that does not parse is an error of its
 * component. Nothing else of Apex is analysed yet.
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyseSource, readsApex } from '../src/extraction/analyse.ts';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import type { ApexReader } from '../src/extraction/apex-syntax.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { codes, HEAD, key, Source, XMLNS } from './helpers/written-source.ts';

let apex: ApexReader;
beforeAll(async () => {
  apex = await loadApexReader();
});

const META = (type: string): string =>
  `${HEAD}\n<${type} xmlns="${XMLNS}">\n    <apiVersion>65.0</apiVersion>\n    <status>Active</status>\n</${type}>\n`;

/** A source with classes and triggers, each a file of code and its file of metadata. */
class ApexSource extends Source {
  apexClass(name: string, code: string | Uint8Array): string {
    const path = this.file(`classes/${name}.cls`, code);
    this.listed.push({
      type: 'ApexClass',
      fullName: name,
      files: [path, this.file(`${path}-meta.xml`, META('ApexClass'))],
    });
    return path;
  }

  apexTrigger(name: string, code: string): string {
    const path = this.file(`triggers/${name}.trigger`, code);
    this.listed.push({
      type: 'ApexTrigger',
      fullName: name,
      files: [path, this.file(`${path}-meta.xml`, META('ApexTrigger'))],
    });
    return path;
  }
}

const BROKEN = ['public class Broken {', '    void m() {', '        Integer x = ;', '    }', '}', ''].join('\n');

describe('the analysis of Apex', () => {
  it('parses every class and trigger of the fixture project without an issue, and changes nothing else', async () => {
    const { tree } = readFolders(join(FIXTURES_DIR, 'billing-sfdx'), ['force-app']);
    const listed = (await resolveComponents(tree, ['force-app'])).components;
    expect(listed.filter((one) => one.type === 'ApexClass' || one.type === 'ApexTrigger')).toHaveLength(30);
    expect(readsApex(listed)).toBe(true);
    expect(analyseSource(tree, listed, { apex })).toEqual(analyseSource(tree, listed));
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
    // The class keeps its row, and costs nothing else: the analysis reads no Apex yet.
    expect(analysis.components.map((one) => one.key)).toEqual([key('ApexClass', 'Broken'), key('ApexClass', 'Good')]);
    expect(analysis.components.find((one) => one.key === key('ApexClass', 'Broken'))).toMatchObject({
      definition: { path: `${path}-meta.xml` },
      attrs: null,
      references: [],
    });
    expect(analysis.types).not.toContain('ApexClass');
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

  it('does not parse a class whose code Salesforce hides', () => {
    const source = new ApexSource();
    source.apexClass('Packaged', '(hidden)');
    source.apexClass('PackagedToo', '(hidden)\n');
    expect(analyseSource(source.tree, source.listed, { apex }).issues).toEqual([]);
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
    expect(codes(analyseSource(source.tree, source.listed, { apex }).issues)).toEqual(['error FILE_UNREADABLE']);
  });
});
