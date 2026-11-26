/**
 * The reader of Apex of the engine against a second parser (decision record 0083). Both lower their trees into the
 * model of `src/extraction/apex-syntax.ts`, and the models are compared name by name and place by place, for every
 * Apex file of the fixture project and for each of the 48 pieces of recent syntax. A change of the grammar of
 * either parser shows here, and the engine can change its parser by taking the other reader.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import type { ApexReader } from '../src/extraction/apex-syntax.ts';
import { createApexParserAdapter, emptyApexParserCache } from './helpers/apex-parser-adapter.ts';
import { PROBES, probeSource, readApexFiles } from './helpers/apex-sources.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';

const PROJECT = join(FIXTURES_DIR, 'billing-sfdx');

let engine: ApexReader;
const second = createApexParserAdapter();
beforeAll(async () => {
  engine = await loadApexReader();
});

/** What a reader makes of a text, without the wording of its problems: the two parsers word them differently. */
const lowered = (reader: ApexReader, source: string, kind: 'class' | 'trigger'): unknown => {
  const unit = reader.parseUnit(source, kind);
  return { types: unit.types, trigger: unit.trigger, problems: unit.problems.length > 0 };
};

describe('the two readers of Apex', () => {
  it('lower every Apex file of the fixture project into the same model, without a problem', () => {
    const files = readApexFiles(PROJECT);
    expect(files).toHaveLength(30);
    for (const file of files) {
      const model = lowered(second, file.source, file.kind);
      expect(model, file.path).toMatchObject({ problems: false });
      expect(lowered(engine, file.source, file.kind), file.path).toEqual(model);
    }
  });

  it.each(PROBES)('lower $name into the same model', (probe) => {
    const { source, kind } = probeSource(probe);
    const model = lowered(second, source, kind);
    expect(model).toMatchObject({ problems: false });
    expect(lowered(engine, source, kind)).toEqual(model);
  });

  // The interfaces of a class and of an interface, and the values of a `when`, which the model of the trial did not
  // have, three differences that the code review of the trial found between its adapters, and an operator written
  // with a space inside it, as a class of a public codebase writes one.
  it.each([
    {
      name: 'the interfaces a class implements and an interface extends',
      source:
        'public virtual class A extends Base implements I1, Outer.I2, Database.Batchable<SObject> { interface J extends K, Outer.L { void m(); } }',
    },
    {
      name: 'the values of a when',
      source:
        "public class S { void m() { switch on i { when -1, 2 { } when (3) { } when 5L { } when null { } when else { } } switch on c { when RED, Color.GREEN { } } switch on s { when 'a', 'b' { } } switch on o { when Account a { } } } }",
    },
    {
      name: 'a collection that is created empty with braces',
      source:
        'class C { void m() { List<String> l = new List<String>{}; Set<Id> s = new Set<Id>{}; Map<Id, String> n = new Map<Id, String>{}; } }',
    },
    {
      name: 'a column behind a character of two UTF-16 units',
      source: "class C { void m(Invoice__c inv) { String e = '\u{1F600}\u{1F600}'; inv.Amount__c = 1; } }",
    },
    {
      name: 'an operator written with a space inside it',
      source: 'class C { void m(Integer a) { Boolean b = a > = 0; Integer s = a > > 1; } }',
    },
    {
      name: 'a file that starts with a byte order mark',
      source: '﻿class C { void m(Invoice__c inv) { inv.Amount__c = 1; } }',
    },
  ])('lower $name into the same model', ({ source }) => {
    const model = lowered(second, source, 'class');
    expect(model).toMatchObject({ problems: false });
    expect(lowered(engine, source, 'class')).toEqual(model);
  });

  it('both say that a file which is not Apex has a problem', () => {
    const folder = join(FIXTURES_DIR, 'parser-negative');
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.cls'))) {
      const source = readFileSync(join(folder, file), 'utf8');
      for (const reader of [engine, second]) {
        expect(reader.parseUnit(source, 'class').problems.length, `${reader.name} ${file}`).toBeGreaterThan(0);
      }
    }
  });

  it.each([
    { name: 'a statement beside a class', source: "public class A { } System.debug('x');", kind: 'class' },
    { name: 'a statement before a class', source: 'Integer i = 1; public class A { }', kind: 'class' },
    { name: 'two classes', source: 'public class A { } public class B { }', kind: 'class' },
    {
      name: 'a class beside a trigger',
      source: 'public class A { } trigger T on Account (before insert) { }',
      kind: 'trigger',
    },
  ] as const)('both say that a file with $name has a problem', ({ source, kind }) => {
    for (const reader of [engine, second]) {
      expect(reader.parseUnit(source, kind).problems.length, reader.name).toBeGreaterThan(0);
    }
  });

  it('both say where they cannot read a file without quoting it', () => {
    const source = [
      'public class Broken {',
      "    String wide = '\u{1F600}';",
      '    void first() {',
      '        Integer secretValue = ;',
      '        Integer secretOne secretOther;',
      '    }',
      '    void second() {',
      '        if (secretCondition {',
      '    }',
      '}',
      '',
    ].join('\n');
    for (const reader of [engine, second]) {
      const { problems } = reader.parseUnit(source, 'class');
      expect(problems.length, reader.name).toBeGreaterThan(0);
      for (const problem of problems) expect(problem.message, reader.name).not.toMatch(/secret/i);
    }
  });

  it('lower into the same model after the cache of the second parser was emptied', () => {
    const files = readApexFiles(PROJECT);
    const before = files.map((file) => lowered(second, file.source, file.kind));
    emptyApexParserCache();
    expect(files.map((file) => lowered(second, file.source, file.kind))).toEqual(before);
    expect(files.map((file) => lowered(engine, file.source, file.kind))).toEqual(before);
  });

  it('read the same query from a text', () => {
    const text = 'SELECT Id, Account__r.Name, (SELECT Id FROM Lines__r) FROM Invoice__c i WHERE Status__c = :status';
    expect(engine.parseQuery(text)).toEqual(second.parseQuery(text));
    expect(engine.parseQuery(text)?.alias).toBe('i');
    // A text that closes the class it is read in is not one query.
    const escape = 'SELECT Id FROM Account];} class Z{Object z=[SELECT Name FROM Contact';
    expect([engine.parseQuery(escape), second.parseQuery(escape)]).toEqual([undefined, undefined]);
  });
});
