/**
 * Runs the resolver with a parser on the fixture project and prints the score against the answer key.
 *
 *   node trial/apex/src/run-fixture.ts [apex-parser|tree-sitter]
 */
import { join } from 'node:path';
import { FIXTURES_DIR } from '../../../packages/engine/test/helpers/answer-key.ts';
import { createApexParserAdapter } from './adapters/apex-parser.ts';
import { createTreeSitterAdapter } from './adapters/tree-sitter.ts';
import { parseFiles, readApexFiles } from './project.ts';
import { analyse } from './resolver.ts';
import { readSchema } from './schema.ts';
import { report, score } from './score.ts';

const project = join(FIXTURES_DIR, 'billing-sfdx');
const adapter = process.argv[2] === 'tree-sitter' ? await createTreeSitterAdapter() : createApexParserAdapter();
const files = parseFiles(readApexFiles(project), adapter);
for (const file of files) {
  for (const problem of file.unit.problems) {
    console.log(`problem ${file.path}:${String(problem.at.line)}:${String(problem.at.column)} ${problem.message}`);
  }
}
const analysis = analyse(files, readSchema([project]), adapter);
console.log(report(adapter.name, score(analysis)).join('\n'));
console.log(
  `  calls ${String(analysis.calls.length)}, queries in text ${String(analysis.dynamicQueries.found)}, unread ${String(analysis.dynamicQueries.unread)}`,
);
