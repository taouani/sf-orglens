/**
 * Analyses the public codebases of `fixtures/corpora.toml`: every component gets a row, and the objects, fields
 * and validation rules are read for the references that are written in XML.
 *
 * The codebases are not part of this repository. A codebase that was not downloaded (`pnpm run corpora:fetch`)
 * is skipped, so the test needs no network. CI does not download them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { analyseSource } from '../src/extraction/analyse.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';

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
 * - `references`: the references written in XML, by how the source names the target. The controlling fields are
 *   those of relationships to a field definition: no file of the three names one for a picklist.
 */
const EXPECTED: Readonly<Record<string, { components: number; analysed: number; references: Record<string, number> }>> =
  {
    'apex-recipes': { components: 255, analysed: 44, references: { 'controlling-field': 1, lookup: 8 } },
    'nebula-logger': {
      components: 894,
      analysed: 622,
      references: { 'controlling-field': 3, 'display-field': 4, filter: 7, lookup: 17, summary: 16, 'value-set': 2 },
    },
    npsp: {
      components: 11_722,
      analysed: 819,
      references: { 'controlling-field': 5, 'display-field': 2, filter: 7, lookup: 77, summary: 4, 'value-set': 2 },
    },
  };

describe('the analysis of the public codebases', () => {
  for (const { name, paths } of manifest.corpus) {
    // A codebase that is not there shows in the report of the run as skipped, not as passed.
    it.skipIf(!existsSync(join(corpora, name)))(
      `analyses ${name} without an issue`,
      async () => {
        const { tree } = readFolders(join(corpora, name), paths);
        const listed = (await resolveComponents(tree, paths)).components;
        const analysis = analyseSource(tree, listed);

        // No file that the reader refuses, no name it does not read, and no path it cannot follow.
        expect(analysis.issues).toEqual([]);
        const references: Record<string, number> = {};
        for (const reference of analysis.components.flatMap((one) => one.references)) {
          const found = reference.attrs?.['via'];
          const via = typeof found === 'string' ? found : 'none';
          references[via] = (references[via] ?? 0) + 1;
        }
        expect({
          components: analysis.components.length,
          analysed: analysis.work[0]?.components,
          references: Object.fromEntries(Object.entries(references).sort()),
        }).toEqual(EXPECTED[name]);
        expect(analysis.work).toHaveLength(1);
        expect(analysis.work[0]?.failedFiles).toBe(0);
        // Every key once.
        expect(new Set(analysis.components.map((one) => one.key)).size).toBe(analysis.components.length);
      },
      300_000,
    );
  }
});
