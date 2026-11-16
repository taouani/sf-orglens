/**
 * Analyses the public codebases of `fixtures/corpora.toml`: every component gets a row, and the objects, fields
 * and validation rules are read for the references that are written in XML and for those in their formulas.
 *
 * The codebases are not part of this repository. A codebase that was not downloaded (`pnpm run corpora:fetch`)
 * is skipped, so the test needs no network. CI does not download them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { analyseSource } from '../src/extraction/analyse.ts';
import { namesOfTree, parseFormula } from '../src/extraction/formula.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { scanNames } from './helpers/formula-scan.ts';

const root = join(import.meta.dirname, '../../..');
const corpora = join(root, '.corpora');
const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
  corpus: { name: string; paths: string[] }[];
};

/**
 * What the analysis gave on 16 November 2026, in the package folders that `fixtures/corpora.toml` names. A
 * codebase is pinned by its commit, so a number moves only when the pin or the analysis moves.
 *
 * - `components`: the rows. NPSP has 15 more than the source library lists: objects of which it holds fields
 *   and no file, most of them objects of the packages it builds on.
 * - `analysed`: the objects, fields and validation rules that were read.
 * - `withFormula`: those of them that hold a formula, a default value or a condition. Most are the default
 *   value of a checkbox.
 * - `references`: the references by how the source names the target. The controlling fields are those of
 *   relationships to a field definition: no file of the three names one for a picklist.
 * - `issues`: the issues by their code. The four of NPSP stand in one formula of an opportunity, which goes
 *   through a lookup of another package four times: no file says where that lookup leads.
 */
interface Expected {
  readonly components: number;
  readonly analysed: number;
  readonly withFormula: number;
  readonly references: Readonly<Record<string, number>>;
  readonly issues: Readonly<Record<string, number>>;
}
const EXPECTED: Readonly<Record<string, Expected>> = {
  'apex-recipes': {
    components: 255,
    analysed: 44,
    withFormula: 1,
    references: { 'controlling-field': 1, lookup: 8 },
    issues: {},
  },
  'nebula-logger': {
    components: 894,
    analysed: 622,
    withFormula: 142,
    references: {
      'controlling-field': 3,
      'display-field': 4,
      filter: 7,
      formula: 387,
      lookup: 17,
      summary: 16,
      'value-set': 2,
    },
    issues: {},
  },
  npsp: {
    components: 11_722,
    analysed: 819,
    withFormula: 168,
    references: {
      'controlling-field': 5,
      'display-field': 2,
      filter: 7,
      formula: 58,
      lookup: 77,
      summary: 4,
      'value-set': 2,
    },
    issues: { PATH_NOT_FOLLOWED: 4 },
  },
};

const counted = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
};

describe('the analysis of the public codebases', () => {
  for (const { name, paths } of manifest.corpus) {
    // A codebase that is not there shows in the report of the run as skipped, not as passed.
    it.skipIf(!existsSync(join(corpora, name)))(
      `analyses ${name}, and reads every formula of it`,
      async () => {
        const { tree } = readFolders(join(corpora, name), paths);
        const listed = (await resolveComponents(tree, paths)).components;
        const analysis = analyseSource(tree, listed);
        const references = analysis.components.flatMap((one) => one.references);

        expect({
          components: analysis.components.length,
          analysed: analysis.work[0]?.components,
          withFormula: analysis.work[1]?.components,
          references: counted(
            references.map((one) => {
              const via = one.attrs?.['via'];
              return typeof via === 'string' ? via : 'none';
            }),
          ),
          // No file that the reader refuses, no name it does not read, no formula it does not read as a whole.
          issues: counted(analysis.issues.map((issue) => issue.code)),
        }).toEqual(EXPECTED[name]);
        expect(analysis.work.map((work) => `${work.origin} ${String(work.failedFiles)}`)).toEqual([
          'parser:xml 0',
          'parser:formula 0',
        ]);
        // Every name of a formula was found or has a key: none is unresolved, and none is less than confirmed.
        const inFormulas = references.filter((one) => one.origin === 'parser:formula');
        expect(counted(inFormulas.map((one) => one.confidence))).toEqual(
          inFormulas.length === 0 ? {} : { confirmed: inFormulas.length },
        );
        expect(inFormulas.filter((one) => one.resolution === 'unresolved')).toEqual([]);
        // Every key once.
        expect(new Set(analysis.components.map((one) => one.key)).size).toBe(analysis.components.length);
      },
      300_000,
    );

    it.skipIf(!existsSync(join(corpora, name)))(
      `finds in every formula of ${name} the names that a simple scan finds`,
      () => {
        const { tree } = readFolders(join(corpora, name), paths);
        const entity: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
        const differ: string[] = [];
        let formulas = 0;
        for (const path of tree.files) {
          if (!/\.(?:field|validationRule|object)(?:-meta\.xml)?$/.test(path)) continue;
          const text = Buffer.from(tree.read(path)).toString('utf8');
          // The files are searched as text here, not read as XML. None of the three writes a formula in CDATA.
          for (const [, , body = ''] of text.matchAll(
            /<(formula|errorConditionFormula|defaultValue)>([\s\S]*?)<\/\1>/g,
          )) {
            const formula = body.replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => entity[name] ?? '').trim();
            if (formula === '') continue;
            formulas += 1;
            const parsed = parseFormula(formula);
            const names = parsed.tree === null ? null : namesOfTree(parsed.tree).map((one) => one.text);
            if (JSON.stringify(names) !== JSON.stringify(scanNames(formula))) differ.push(`${path}: ${formula}`);
          }
        }
        expect(differ).toEqual([]);
        expect(formulas).toBe(EXPECTED[name]?.withFormula);
      },
      300_000,
    );
  }
});
