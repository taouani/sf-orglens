/**
 * Runs one parser and the resolver on a codebase and prints what it took and what it found.
 *
 *   node trial/apex/src/run-corpus.ts <apex-parser|tree-sitter> <folder> [<file for the result as JSON>]
 *
 * One process per run, so that the peak of memory belongs to one parser.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createApexParserAdapter } from './adapters/apex-parser.ts';
import { createTreeSitterAdapter } from './adapters/tree-sitter.ts';
import { parseFiles, readApexFiles } from './project.ts';
import { analyse } from './resolver.ts';
import { readSchema } from './schema.ts';

const [parser, root, out] = process.argv.slice(2);
if (root === undefined || (parser !== 'apex-parser' && parser !== 'tree-sitter')) {
  throw new Error('Usage: run-corpus.ts <apex-parser|tree-sitter> <folder> [<file for the result as JSON>]');
}

const started = performance.now();
const adapter = parser === 'tree-sitter' ? await createTreeSitterAdapter() : createApexParserAdapter();
const loaded = performance.now();
const sources = readApexFiles(root);
const read = performance.now();
const files = parseFiles(sources, adapter);
const parsed = performance.now();
const schema = readSchema([root]);
const analysis = analyse(files, schema, adapter);
const done = performance.now();

const withProblems = files.filter((file) => file.unit.problems.length > 0);
const withoutTree = files.filter((file) => file.unit.types.length === 0 && file.unit.trigger === undefined);
const count = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of [...values].sort()) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};
const ms = (from: number, to: number): number => Math.round(to - from);
const summary = {
  parser: adapter.name,
  files: files.length,
  lines: sources.reduce((sum, file) => sum + file.source.split('\n').length, 0),
  filesWithProblems: withProblems.length,
  filesWithoutTree: withoutTree.length,
  loadMs: ms(started, loaded),
  parseMs: ms(read, parsed),
  analyseMs: ms(parsed, done),
  totalMs: ms(started, done),
  peakMemoryMb: Math.round(process.resourceUsage().maxRSS / 1024),
  objects: schema.objects.size,
  references: analysis.references.length,
  byVia: count(analysis.references.map((found) => found.via)),
  byKind: count(analysis.references.map((found) => found.kind)),
  byTier: count(analysis.references.map((found) => found.tier)),
  unknowns: analysis.unknowns.length,
  calls: analysis.calls.length,
  dynamicQueries: analysis.dynamicQueries,
};
console.log(JSON.stringify(summary, null, 2));
if (out !== undefined) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        summary,
        problems: withProblems.map((file) => ({ file: file.path, problems: file.unit.problems.slice(0, 3) })),
        references: analysis.references,
        unknowns: analysis.unknowns,
        calls: analysis.calls,
      },
      null,
      1,
    ),
  );
}
