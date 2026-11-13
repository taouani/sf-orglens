/**
 * The Apex trial as tests: each parser with the one resolver against the answer key of the fixture project, on
 * recent syntax and on files that are not Apex. The runs on the public codebases are not tests. They are started
 * by hand (`trial/apex/README.md`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES_DIR, loadAnswerKey } from '../../../packages/engine/test/helpers/answer-key.ts';
import { createApexParserAdapter, emptyApexParserCache } from '../src/adapters/apex-parser.ts';
import { createTreeSitterAdapter } from '../src/adapters/tree-sitter.ts';
import { parseFiles, readApexFiles } from '../src/project.ts';
import { analyse, type Analysis } from '../src/resolver.ts';
import { readSchema } from '../src/schema.ts';
import { report, score } from '../src/score.ts';
import type { Member, SyntaxAdapter } from '../src/syntax.ts';
import { PROBES, probeSource } from '../src/syntax-probes.ts';

const PROJECT = join(FIXTURES_DIR, 'billing-sfdx');
const NEGATIVE = join(FIXTURES_DIR, 'parser-negative');

const adapters = new Map<string, SyntaxAdapter>();
const analyses = new Map<string, Analysis>();

beforeAll(async () => {
  adapters.set('apex-parser', createApexParserAdapter());
  adapters.set('tree-sitter', await createTreeSitterAdapter());
  const schema = readSchema([PROJECT]);
  const sources = readApexFiles(PROJECT);
  for (const [name, adapter] of adapters) analyses.set(name, analyse(parseFiles(sources, adapter), schema, adapter));
});

const adapterOf = (name: string): SyntaxAdapter => {
  const adapter = adapters.get(name);
  if (adapter === undefined) throw new Error(`No adapter ${name}.`);
  return adapter;
};

describe.each(['apex-parser', 'tree-sitter'])('the resolver on %s', (name) => {
  it('reads every file of the fixture project without a problem', () => {
    const files = parseFiles(readApexFiles(PROJECT), adapterOf(name));
    expect(files).toHaveLength(13);
    expect(files.flatMap((file) => file.unit.problems.map((problem) => `${file.path}: ${problem.message}`))).toEqual(
      [],
    );
  });

  it('reaches the pass marks of the plan on the answer key', () => {
    const analysis = analyses.get(name);
    if (analysis === undefined) throw new Error('No analysis.');
    const key = loadAnswerKey();
    const result = score(analysis, key);
    const lines = report(name, result).join('\n');
    // The pass marks of the plan: recall at least 95 %, precision at least 98 %, the kind right on at least 99 %
    // of the matches, and no reference where the key says there is none.
    expect(result.expected, lines).toBe(181);
    expect(result.recall, lines).toBeGreaterThanOrEqual(0.95);
    expect(result.precision, lines).toBeGreaterThanOrEqual(0.98);
    expect(result.kindAccuracy, lines).toBeGreaterThanOrEqual(0.99);
    expect(result.negativesHit, lines).toEqual([]);
  });

  it('has the score the report of the trial states', () => {
    // The report says more than the pass marks ask for. This test fails when a number of the report stops being
    // true, so that the report cannot say 181 of 181 while the resolver finds 172.
    const analysis = analyses.get(name);
    if (analysis === undefined) throw new Error('No analysis.');
    const key = loadAnswerKey();
    const result = score(analysis, key);
    const lines = report(name, result).join('\n');
    expect(
      {
        expected: result.expected,
        matched: result.matched.length,
        missed: result.missed.length,
        extra: result.extra.length,
        wrongKind: result.wrongKind.length,
        wrongFrom: result.wrongFrom.length,
        wrongVia: result.wrongVia.length,
        wrongTier: result.wrongTier.length,
        wrongOp: result.wrongOp.length,
        stretch: result.stretch.length,
        negatives: result.negatives,
        negativesHit: result.negativesHit.length,
        unknownsExpected: result.unknownsExpected,
        unknownsFound: result.unknownsFound,
        unknownsExtra: result.unknownsExtra.length,
      },
      lines,
    ).toEqual({
      expected: 181,
      matched: 181,
      missed: 0,
      extra: 0,
      wrongKind: 0,
      wrongFrom: 0,
      wrongVia: 0,
      wrongTier: 0,
      wrongOp: 0,
      stretch: 3,
      negatives: 16,
      negativesHit: 0,
      unknownsExpected: 5,
      unknownsFound: 5,
      unknownsExtra: 0,
    });
  });

  it.each(PROBES)('reads $name', (probe) => {
    const { source, kind } = probeSource(probe);
    expect(adapterOf(name).parseUnit(source, kind).problems).toEqual([]);
  });

  it('does not throw on a file that is not Apex, and says that it has a problem', () => {
    const files = readdirSync(NEGATIVE).filter((file) => file.endsWith('.cls'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const unit = adapterOf(name).parseUnit(readFileSync(join(NEGATIVE, file), 'utf8'), 'class');
      expect(unit.problems.length, file).toBeGreaterThan(0);
    }
  });

  it('does not stop on a member without a name, which a damaged file can give', () => {
    const adapter = adapterOf(name);
    const unit = adapter.parseUnit('class C { void good(Invoice__c inv) { inv.Amount__c = 1; } }', 'class');
    const [type] = unit.types;
    const [good] = type?.members ?? [];
    if (type === undefined || good?.kind !== 'method') throw new Error('The class has no method.');
    const [param] = good.params;
    if (param === undefined) throw new Error('The method has no parameter.');
    const nameless: Member = { ...good, name: { ...good.name, text: '' } };
    const typeless: Member = { ...good, params: [{ ...param, type: { ...param.type, name: '' } }] };
    const field: Member = {
      kind: 'field',
      type: param.type,
      static: false,
      final: false,
      vars: [{ name: { ...good.name, text: '' }, init: { kind: 'this' } }],
    };
    const damaged = { ...unit, types: [{ ...type, members: [nameless, typeless, field, good] }] };
    const found = analyse([{ path: 'C.cls', unit: damaged }], readSchema([PROJECT]), adapter);
    expect(found.references.map((reference) => `${reference.kind} ${reference.match}`)).toEqual(['writes Amount__c']);
  });

  it('reads a query that is built as text, and refuses text that is not one query', () => {
    const adapter = adapterOf(name);
    const query = adapter.parseQuery(
      'SELECT Id, Account__r.Name FROM Invoice__c WHERE Status__c = :status ORDER BY zqh1qz',
    );
    expect(query?.from.map((part) => part.text)).toEqual(['Invoice__c']);
    expect(query?.fields.map((path) => path.map((part) => part.text).join('.'))).toEqual([
      'Id',
      'Account__r.Name',
      'Status__c',
      'zqh1qz',
    ]);
    // The places are places in the text: the first line, and the column of the word.
    expect(query?.from[0]?.at).toEqual({ line: 1, column: 33 });
    // `SELECT Id FROM Account WHERE` alone is not tested: apex-parser reads the last word as an alias.
    expect(adapter.parseQuery('SELECT Id FROM Account WHERE Name = ')).toBeUndefined();
    expect(adapter.parseQuery('SELECT Id FROM Account]; delete [SELECT Id FROM Contact')).toBeUndefined();
    expect(adapter.parseQuery('this is not a query')).toBeUndefined();
  });
});

/** What an adapter makes of a text, without the wording of its problems: the two parsers word them differently. */
const lowered = (name: string, source: string, kind: 'class' | 'trigger'): unknown => {
  const unit = adapterOf(name).parseUnit(source, kind);
  return { types: unit.types, trigger: unit.trigger, problems: unit.problems.length > 0 };
};

describe('the two parsers', () => {
  it('give the resolver the same references, unknown places and calls on the fixture project', () => {
    expect(analyses.get('tree-sitter')).toEqual(analyses.get('apex-parser'));
  });

  it('are lowered into the same model for every file of the fixture project', () => {
    for (const file of readApexFiles(PROJECT)) {
      expect(lowered('tree-sitter', file.source, file.kind), file.path).toEqual(
        lowered('apex-parser', file.source, file.kind),
      );
    }
  });

  it.each(PROBES)('are lowered into the same model for $name', (probe) => {
    const { source, kind } = probeSource(probe);
    expect(lowered('tree-sitter', source, kind)).toEqual(lowered('apex-parser', source, kind));
  });

  // Three differences that the code review of the trial found between the adapters. The codebases of the trial
  // did not show them.
  it.each([
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
      name: 'a file that starts with a byte order mark',
      source: '\uFEFFclass C { void m(Invoice__c inv) { inv.Amount__c = 1; } }',
    },
  ])('are lowered into the same model for $name', ({ source }) => {
    const model = lowered('apex-parser', source, 'class');
    expect(model).toMatchObject({ problems: false });
    expect(lowered('tree-sitter', source, 'class')).toEqual(model);
  });

  it('are lowered into the same model after the cache of apex-parser was emptied', () => {
    const files = readApexFiles(PROJECT);
    const before = files.map((file) => lowered('apex-parser', file.source, file.kind));
    emptyApexParserCache();
    expect(files.map((file) => lowered('apex-parser', file.source, file.kind))).toEqual(before);
    expect(files.map((file) => lowered('tree-sitter', file.source, file.kind))).toEqual(before);
  });

  it('count a column in UTF-16 units, as the answer key does', () => {
    const source = "class C { void m(Invoice__c inv) { String e = '\u{1F600}\u{1F600}'; inv.Amount__c = 1; } }";
    for (const name of ['apex-parser', 'tree-sitter']) {
      expect(JSON.stringify(lowered(name, source, 'class')), name).toContain(
        `"text":"Amount__c","at":{"line":1,"column":${String(source.indexOf('Amount__c') + 1)}}`,
      );
    }
  });
});
