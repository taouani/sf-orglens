/**
 * Runs one parser and the resolver on a codebase and prints what it took and what it found.
 *
 *   node trial/apex/src/run-corpus.ts <apex-parser|tree-sitter> <folder> [<file for the result as JSON>]
 *
 * With `ORGLENS_TRIAL_EMPTY_CACHE=<n>` the prediction cache of apex-parser is emptied after every n files.
 *
 * One process per run, and only the chosen parser is loaded, so that the time and the peak of memory belong to
 * one parser. The time starts before the parser is loaded. The peak of memory is the largest resident set of
 * the process in MiB.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseFiles, readApexFiles } from './project.ts';
import type { SourceFile } from './resolver.ts';
import { analyse } from './resolver.ts';
import { readSchema } from './schema.ts';

const [parser, root, out] = process.argv.slice(2);
if (root === undefined || (parser !== 'apex-parser' && parser !== 'tree-sitter')) {
  throw new Error('Usage: run-corpus.ts <apex-parser|tree-sitter> <folder> [<file for the result as JSON>]');
}

const emptyEvery = Number(process.env['ORGLENS_TRIAL_EMPTY_CACHE'] ?? '0');
if (!Number.isInteger(emptyEvery) || emptyEvery < 0 || (emptyEvery > 0 && parser !== 'apex-parser')) {
  throw new Error('ORGLENS_TRIAL_EMPTY_CACHE must be a whole number, and it is for apex-parser only.');
}

const started = performance.now();
const apexParser = parser === 'apex-parser' ? await import('./adapters/apex-parser.ts') : undefined;
const adapter =
  apexParser === undefined
    ? await (await import('./adapters/tree-sitter.ts')).createTreeSitterAdapter()
    : apexParser.createApexParserAdapter();
const loaded = performance.now();
const sources = readApexFiles(root);
const read = performance.now();
const files: SourceFile[] = [];
if (apexParser !== undefined && emptyEvery > 0) {
  for (let from = 0; from < sources.length; from += emptyEvery) {
    files.push(...parseFiles(sources.slice(from, from + emptyEvery), adapter));
    apexParser.emptyApexParserCache();
  }
} else {
  files.push(...parseFiles(sources, adapter));
}
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
/** The lines of a text: its line ends, and one more when the last line has none. */
const linesOf = (text: string): number => {
  const ends = text.split('\n').length - 1;
  return text.length > 0 && !text.endsWith('\n') ? ends + 1 : ends;
};
const summary = {
  parser: adapter.name,
  cacheEmptiedEvery: emptyEvery,
  files: files.length,
  lines: sources.reduce((sum, file) => sum + linesOf(file.source), 0),
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
