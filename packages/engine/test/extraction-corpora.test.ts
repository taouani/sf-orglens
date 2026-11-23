/**
 * Analyses the public codebases of `fixtures/corpora.toml`: every component gets a row, and the objects, fields
 * and validation rules are read for the references that are written in XML and for those in their formulas.
 * Every flow of them is read too, also the flows outside the package folders the file names.
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
 * - `components`: the rows. Apex Recipes has 3 more since 23 November 2026: the elements of its one flow, which
 *   are components since flows are read. NPSP has 15 more than the source library lists: objects of which it holds fields
 *   and no file, most of them objects of the packages it builds on. PMM has one more than a snapshot of it:
 *   this test reads the folders as they are, without `.forceignore`, and the source library takes the folder
 *   `lwc/__tests__`, which holds data of tests and which that file leaves out, for a component.
 * - `analysed`: the objects, fields and validation rules that were read.
 * - `withFormula`: those of them that hold a formula, a default value or a condition. Most are the default
 *   value of a checkbox.
 * - `references`: the references by how the source names the target. The controlling fields are those of
 *   relationships to a field definition: no file of the four names one for a picklist. The one by `object` is
 *   the object that the flow of Apex Recipes looks up.
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
    components: 258,
    analysed: 44,
    withFormula: 1,
    references: { 'controlling-field': 1, lookup: 8, object: 1 },
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
  // Added on 17 November 2026, with the codebase.
  pmm: {
    components: 1667,
    analysed: 129,
    withFormula: 38,
    references: { 'controlling-field': 1, filter: 4, formula: 133, lookup: 26 },
    issues: {},
  },
};

/**
 * The folders of a codebase that hold its flows, with the package folders the flows need for their objects.
 * Most flows of the codebases stand outside the package: in recipes, in tests and in the settings of a
 * developer org. NPSP holds no flow.
 */
const FLOW_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  'apex-recipes': ['force-app'],
  'nebula-logger': [
    'nebula-logger/core',
    'nebula-logger/recipes',
    'nebula-logger/extra-tests',
    'nebula-logger/plugins/async-failure-additions/plugin',
  ],
  pmm: ['force-app', 'unpackaged/config/dev'],
};

/**
 * What the reader of flows gave on 23 November 2026. Nothing of it was checked by hand yet: that is work package
 * 9 of the Phase 2 plan. The numbers say that every flow is read, and how much of it is not known.
 *
 * - `flows`, `elements`: the components. `processes`: the flows of them that the Process Builder made.
 * - `references`: the references of flows and of their elements, by whether their target was found. A target
 *   that is `external` is a standard object, a standard field or an Apex class: the folders hold no file for the
 *   first two, and a class is not a component the model of objects knows.
 * - `issues`: the issues about a flow or an element, by their code. None is an error.
 *
 * The process of Nebula Logger was read beside its file: the object it starts on, the two fields its decisions
 * read, the two it sets, its two Apex actions and its subflow are found, and the file names nothing else.
 *
 * The two flows of PMM are processes, and hold `%%%NAMESPACE%%%` before every name of the package: a token that
 * the build tool of that project replaces before it deploys. Such a value is no name, so the reader says that it
 * is not read, and a path from the record of the process is not followed. Nothing of the two is found, and
 * every name of them has a warning. Reading the token as an empty prefix is not built.
 */
interface ExpectedFlows {
  readonly flows: number;
  readonly processes: number;
  readonly elements: number;
  readonly references: Readonly<Record<string, number>>;
  readonly issues: Readonly<Record<string, number>>;
}
const EXPECTED_FLOWS: Readonly<Record<string, ExpectedFlows>> = {
  'apex-recipes': { flows: 1, processes: 0, elements: 3, references: { resolved: 1 }, issues: {} },
  'nebula-logger': {
    flows: 10,
    processes: 1,
    elements: 42,
    references: { external: 16, resolved: 16 },
    issues: {},
  },
  pmm: {
    flows: 2,
    processes: 2,
    elements: 21,
    references: {},
    issues: { NAME_NOT_READ: 78, PATH_NOT_FOLLOWED: 24 },
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
          'parser:flow 0',
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

    const folders = FLOW_FOLDERS[name];
    it.skipIf(!existsSync(join(corpora, name)) || folders === undefined)(
      `reads every flow of ${name}`,
      async () => {
        const paths = [...(folders ?? [])];
        const { tree } = readFolders(join(corpora, name), paths);
        const flowFiles = tree.files.filter((path) => path.endsWith('.flow-meta.xml'));
        const listed = (await resolveComponents(tree, paths)).components;
        const analysis = analyseSource(tree, listed);
        const ofFlows = analysis.components.filter((one) => one.key.startsWith('Flow:'));
        const flows = ofFlows.filter((one) => !one.key.includes('#'));
        const issues = analysis.issues.filter((issue) => issue.componentKey?.startsWith('Flow:') === true);

        // Every file of a flow is a component, and none could not be read.
        expect(flows).toHaveLength(flowFiles.length);
        expect(analysis.work[2]).toEqual({ origin: 'parser:flow', components: ofFlows.length, failedFiles: 0 });
        expect(analysis.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
        expect({
          flows: flows.length,
          processes: flows.filter((one) => one.attrs?.['processType'] === 'Workflow').length,
          elements: ofFlows.length - flows.length,
          references: counted(ofFlows.flatMap((one) => one.references.map((reference) => reference.resolution))),
          issues: counted(issues.map((issue) => issue.code)),
        }).toEqual(EXPECTED_FLOWS[name]);
        // No element is of a kind the reader does not know, so nothing of a flow is less than confirmed.
        expect(ofFlows.filter((one) => one.attrs?.['kind'] === 'unknown')).toEqual([]);
        expect(ofFlows.flatMap((one) => one.references).filter((one) => one.confidence !== 'confirmed')).toEqual([]);
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
          // The files are searched as text here, not read as XML. None of the four writes a formula in CDATA.
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
        // Texts are counted here and components above. The numbers are the same in these four codebases,
        // because no field of them has a formula and a default value.
        expect(formulas).toBe(EXPECTED[name]?.withFormula);
      },
      300_000,
    );
  }
});
