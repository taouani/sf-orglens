/**
 * The Apex trial as tests: each parser with the one resolver against the answer key of the fixture project, on
 * recent syntax and on files that are not Apex. The runs on the public codebases are not tests. They are started
 * by hand (`trial/apex/README.md`).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES_DIR, loadAnswerKey } from '../../../packages/engine/test/helpers/answer-key.ts';
import { createApexParserAdapter } from '../src/adapters/apex-parser.ts';
import { createTreeSitterAdapter } from '../src/adapters/tree-sitter.ts';
import { parseFiles, readApexFiles } from '../src/project.ts';
import { analyse, type Analysis } from '../src/resolver.ts';
import { readSchema } from '../src/schema.ts';
import { report, score } from '../src/score.ts';
import type { SyntaxAdapter } from '../src/syntax.ts';
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
    // Recall at least 95 %, precision at least 98 %, the kind right on at least 99 % of the matches, and no
    // reference where the key says there is none.
    expect(result.expected, lines).toBe(181);
    expect(result.recall, lines).toBeGreaterThanOrEqual(0.95);
    expect(result.precision, lines).toBeGreaterThanOrEqual(0.98);
    expect(result.kindAccuracy, lines).toBeGreaterThanOrEqual(0.99);
    expect(result.negativesHit, lines).toEqual([]);
    expect(result.unknownsFound, lines).toBe(key.unknowns.length);
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

describe('the two parsers', () => {
  it('give the resolver the same references, unknown places and calls on the fixture project', () => {
    expect(analyses.get('tree-sitter')).toEqual(analyses.get('apex-parser'));
  });
});
