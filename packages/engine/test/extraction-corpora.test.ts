/**
 * Analyses the public codebases of `fixtures/corpora.toml`: every component gets a row, and the objects, fields
 * and validation rules are read for the references that are written in XML and for those in their formulas, and
 * so are the email templates, report types and quick actions. Every flow of them is read too, and every record of
 * a custom metadata type, also those outside the package folders the file names. Every class and trigger of their
 * package folders is parsed.
 *
 * The codebases are not part of this repository. A codebase that was not downloaded (`pnpm run corpora:fetch`)
 * is skipped, so the test needs no network. CI does not download them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { analyseSource } from '../src/extraction/analyse.ts';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import { namesOfTree, parseFormula } from '../src/extraction/formula.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FLOW_FOLDERS } from './corpora/listing.ts';
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
 * - `analysed`: the objects, fields, validation rules and workflow rules that were read. NPSP has 7 more since
 *   workflow rules are read: its one file of workflow rules, with 2 rules, 3 field updates and an alert. Since
 *   records of custom metadata types, field sets and record types are read, Apex Recipes has 11 more (its
 *   records), Nebula Logger 56 (55 records and a field set), NPSP 211 (193 records and 18 field sets) and PMM 34
 *   (27 records and 7 field sets). No package folder of the four holds a record type.
 * - `withFormula`: those of them that hold a formula, a default value or a condition. Most are the default
 *   value of a checkbox. NPSP has 3 more since workflow rules are read: 2 field updates and a rule.
 * - `references`: the references by how the source names the target. The controlling fields are those of
 *   relationships to a field definition: no file of the four names one for a picklist. The one by `object` is
 *   the object that the flow of Apex Recipes looks up. The 24 of the workflow rules of NPSP were checked by
 *   hand on 23 November 2026: 4 actions of its rules, the 3 fields its field updates write, the 4 criteria of
 *   one rule, 11 names in the formulas of a rule and a field update, the field of the recipient of its alert,
 *   and the email template of the alert. Of `listed-field`, one is a field that the outbound message of NPSP
 *   sends, and the others are a field a record gives a value or a field set lists. `record-of` is the type of
 *   each record, and `value` a value of a record that names an object, a field or another record.
 *   `action-override` is the page or component that overrides an action of an object, read since 23 November 2026
 *   and checked by hand that day against the files: in Nebula Logger the Lightning record pages of five objects,
 *   each for the desktop and for the phone, in NPSP 11 overrides by four Visualforce pages and the record page of
 *   one object, and in PMM the record pages of two objects and an Aura component that overrides the action New
 *   of a third. Apex Recipes overrides nothing. Each names a page or a component that the codebase defines.
 * - `issues`: the issues by their code. The four of NPSP stand in one formula of an opportunity, which goes
 *   through a lookup of another package four times: no file says where that lookup leads. The five of PMM stand in
 *   the formula of one quick action, which holds `%%%NAMESPACED_ORG%%%` before each name: a token that the build
 *   tool of that project replaces before it deploys. The formula is not read, and the reader of formulas counts
 *   its file as one it failed on (`FAILED_FORMULAS`).
 *
 * Since 25 November 2026 the email templates, report types and quick actions are read (decision record 0077), and
 * V4S and Outbound Funds were added for them. In the package folders, Nebula Logger has 2 quick actions, NPSP 26
 * quick actions, an email template and a report type, PMM 18 quick actions and a report type, V4S 30 email
 * templates and 4 report types, and Outbound Funds 8 quick actions and 2 report types: they are counted in
 * `analysed`, and the quick actions that set a field with a formula in `withFormula`. What they refer to was read
 * beside their files that day: `object` is the object a quick action creates or a report type starts from,
 * `assignment` a field a quick action sets, `action` the flow, page or component a quick action opens, `join` the
 * lookup by which a report type joins an object, `listed-field` also a column of a report type and a field the
 * layout of a quick action shows, twice where the user types in it (`Edit`, `Required`: 7 in Nebula Logger, 135 in
 * NPSP, 74 in PMM and 24 in Outbound Funds), `template` also the letterhead of an email template (1 in NPSP, 6 in
 * V4S), and `merge-field` a merge field of an email template. A column `Id` gives none, and `Owner` is the field
 * `OwnerId`. NPSP and PMM name objects and fields of the packages they build on, which are
 * `external`. V4S is in the metadata format: an object and its fields are one file. The workflow rules of V4S give
 * `action`, `assignment` and `template`, as those of NPSP do.
 *
 * Coral Cloud and EDA were added on 25 November 2026 for the check by hand of Phase 2: Coral Cloud for its ten flows,
 * which stand in its package folders, and EDA for its eight record types, which give its `listed-field`. Three
 * formulas of Coral Cloud are written with the tag broken before its bracket (`<formula` and `>` on the next line), as
 * a formatter writes them. Its `object`, `output`, `path`, `record` and `assignment` are of its flows, and so are 10
 * of its 11 `filter`: the other is the condition of a roll-up summary. Its `override` is the flow of a package that
 * one of its flows overrides, read since 26 November 2026 (decision record 0082).
 *
 * Since 26 November 2026 the members of every class and trigger are components, and refer to the types they use
 * (decision record 0084): Apex Recipes has 937 more components, Nebula Logger 3,085, NPSP 18,039, PMM 1,452, V4S 874,
 * Outbound Funds 186, Coral Cloud 132 and EDA 5,787. `declaration` is a class that a class extends, an interface that
 * it implements and the object of a trigger, `type` a class or an object that a member uses as a type, `new` an object
 * of which a member makes a record, and `text` a class that `Type.forName` is given by its name. These counts were
 * not checked by hand: the fixture project and its key hold each case. Of `type`, 1,016 are class literals, read since
 * the review of the pull request: 909 name the class or the object itself (`StubExample.class`), 106 a type argument
 * (`List<Rollup__mdt>.class`) and one the type of an array. A script found each at a class literal of its line, and
 * 30 of them were read by hand.
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
    components: 1195,
    analysed: 55,
    withFormula: 1,
    references: {
      'controlling-field': 1,
      declaration: 14,
      'listed-field': 19,
      lookup: 8,
      new: 161,
      object: 1,
      'record-of': 11,
      type: 1011,
      value: 12,
    },
    issues: {},
  },
  'nebula-logger': {
    components: 3979,
    analysed: 680,
    withFormula: 142,
    references: {
      action: 1,
      'action-override': 10,
      'controlling-field': 3,
      declaration: 45,
      'display-field': 4,
      filter: 7,
      formula: 387,
      'listed-field': 153,
      lookup: 17,
      new: 627,
      'record-of': 55,
      summary: 16,
      text: 32,
      type: 4022,
      value: 6,
      'value-set': 2,
    },
    issues: {},
  },
  npsp: {
    components: 29_761,
    analysed: 1065,
    withFormula: 176,
    references: {
      action: 6,
      'action-override': 12,
      assignment: 19,
      'controlling-field': 5,
      declaration: 407,
      'display-field': 2,
      filter: 11,
      formula: 70,
      'listed-field': 2241,
      lookup: 77,
      'merge-field': 8,
      new: 3401,
      object: 16,
      'record-of': 193,
      summary: 4,
      template: 2,
      text: 18,
      type: 26_036,
      value: 318,
      'value-set': 2,
    },
    issues: { PATH_NOT_FOLLOWED: 4 },
  },
  // Added on 17 November 2026, with the codebase.
  pmm: {
    components: 3119,
    analysed: 182,
    withFormula: 44,
    references: {
      action: 4,
      'action-override': 3,
      assignment: 16,
      'controlling-field': 1,
      declaration: 19,
      filter: 4,
      formula: 133,
      join: 1,
      'listed-field': 652,
      lookup: 26,
      new: 187,
      object: 14,
      'record-of': 27,
      type: 1816,
      value: 25,
    },
    issues: { FORMULA_NOT_READ: 1, NAME_NOT_READ: 4 },
  },
  // Added on 25 November 2026, with the codebases.
  'volunteers-for-salesforce': {
    components: 1534,
    analysed: 195,
    withFormula: 35,
    references: {
      action: 10,
      'action-override': 2,
      assignment: 2,
      declaration: 9,
      'display-field': 7,
      filter: 11,
      formula: 43,
      join: 6,
      'listed-field': 766,
      lookup: 10,
      'merge-field': 404,
      new: 241,
      object: 4,
      summary: 24,
      template: 13,
      type: 973,
    },
    issues: {},
  },
  'outbound-funds': {
    components: 841,
    analysed: 72,
    withFormula: 3,
    references: {
      action: 1,
      'action-override': 3,
      assignment: 3,
      declaration: 3,
      filter: 3,
      formula: 3,
      join: 4,
      'listed-field': 167,
      lookup: 15,
      new: 25,
      object: 6,
      summary: 6,
      type: 239,
    },
    issues: {},
  },
  // Added on 25 November 2026, for the check by hand of Phase 2.
  'coral-cloud': {
    components: 444,
    analysed: 70,
    withFormula: 23,
    references: {
      action: 1,
      'action-override': 5,
      assignment: 10,
      filter: 11,
      formula: 42,
      lookup: 6,
      new: 21,
      object: 12,
      output: 12,
      override: 1,
      path: 4,
      record: 1,
      summary: 6,
      type: 161,
    },
    issues: {},
  },
  eda: {
    components: 11_868,
    analysed: 491,
    withFormula: 90,
    references: {
      'action-override': 10,
      declaration: 380,
      'display-field': 2,
      formula: 76,
      'listed-field': 32,
      lookup: 69,
      new: 1720,
      'record-of': 2,
      text: 3,
      type: 12_910,
    },
    issues: {},
  },
};

/**
 * The elements of flows with a formula, which the analysis counts and the search for formulas below does not: it
 * searches no file of a flow. Coral Cloud keeps its flows in its package folders, with two formulas in one flow.
 */
const FLOW_FORMULAS: Readonly<Record<string, number>> = { 'coral-cloud': 2 };

/** The files the reader of formulas failed on, of the codebases where it failed on one. */
const FAILED_FORMULAS: Readonly<Record<string, number>> = { pmm: 1 };

/**
 * The formulas of quick actions beyond one per action, which the search for formulas below counts and the analysis
 * does not: 6 quick actions of PMM hold 11 formulas.
 */
const MORE_TEXTS: Readonly<Record<string, number>> = { pmm: 5 };

/**
 * The formulas in which the reader of formulas finds other names than the simple scan: the formula of a quick action
 * of PMM, which holds a token of its build tool and is not read.
 */
const SCAN_DIFFERS: Readonly<Record<string, readonly string[]>> = {
  pmm: [
    'force-app/main/default/quickActions/ProgramEngagement__c.CreateServiceDelivery.quickAction-meta.xml: %%%NAMESPACED_ORG%%%ProgramEngagement__c.%%%NAMESPACED_ORG%%%Contact__c',
  ],
};

/**
 * What the reader of flows gave on 23 November 2026, and for Coral Cloud on 25 November 2026. Every flow of it was
 * checked by hand on 25 November 2026, in work package 9 of the Phase 2 plan: `extraction-corpora-checked.test.ts`
 * holds that check. The numbers say that every flow is read, and how much of it is not known.
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
 * every name of them has a warning, but the 10 that are `Id`. Reading the token as an empty prefix is not built.
 *
 * Since 26 November 2026 (decision record 0082), six actions of Nebula Logger refer to the object they give their
 * generic Apex class (`dataTypeMappings`): three to `Account`, of which the codebase holds a file, two to `User` and
 * one to `Organization`, which are `external`. A flow of Coral Cloud refers to the flow of a package that it
 * overrides (`overriddenFlow`), which is `external`. The field `Id` at the end of a path that is not followed gives
 * no warning any more: 10 of PMM.
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
  'coral-cloud': { flows: 10, processes: 0, elements: 85, references: { external: 20, resolved: 30 }, issues: {} },
  'nebula-logger': {
    flows: 10,
    processes: 1,
    elements: 42,
    references: { external: 19, resolved: 19 },
    issues: {},
  },
  pmm: {
    flows: 2,
    processes: 2,
    elements: 21,
    references: {},
    issues: { NAME_NOT_READ: 78, PATH_NOT_FOLLOWED: 14 },
  },
};

/**
 * The folders of a codebase that hold its records of custom metadata types, with the package folders the records
 * need for their types. The plan of Phase 2 counts 335 records: every file of a record in the four codebases of
 * Phase 1. EDA adds four, and the other three codebases have none. Nebula Logger keeps records in its tests and
 * plugins as well, PMM four in the settings of a developer org, and EDA two in two such folders.
 */
const RECORD_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  'apex-recipes': ['force-app'],
  'nebula-logger': [
    'nebula-logger/core',
    'nebula-logger/extra-tests',
    'nebula-logger/managed-package',
    'nebula-logger/plugins',
  ],
  npsp: ['force-app'],
  pmm: ['force-app', 'unpackaged/config/cmdts'],
  eda: ['force-app', 'unpackaged/config/settings_product', 'unpackaged/config/release_gating'],
};

/**
 * What the analysis gave for the records on 23 November 2026, and for those of EDA on 25 November 2026.
 *
 * - `files`: the files of records, 335 in the four codebases of Phase 1 and 4 in EDA. `records`: the components.
 *   Seven records of Nebula Logger stand in two folders of its tests, as the same file, and both files are read.
 * - `references`: the references of the records, by how the record names the target and whether it was found. A
 *   field that a record gives no value is no reference: Nebula Logger has 136 such values and NPSP 139, all nil.
 * - `issues`: the issues about a record, by their code.
 *
 * Only the four records of PMM in `unpackaged/config/cmdts`, and the two of EDA in `unpackaged/config`, are not found
 * whole. Their type is named with `___NAMESPACE___`, and their fields with `%%%NAMESPACE%%%`: tokens that the build
 * tool of those projects replaces before it deploys. No file defines a type of that name, and the snapshot holds a
 * part of it, the record, so the type is `external`, as the type of any record is that no file defines. The
 * analysis says of each field that it is not read: one field in each record of PMM, and four in each of EDA, whose
 * fifth field has an empty value, which is no value. No value of a text field gives a reference at the tier
 * `probable`: decision record 0065 reads values of each codebase of Phase 1 by hand and says why, and the note of
 * work package 9 those of EDA.
 */
interface ExpectedRecords {
  readonly files: number;
  readonly records: number;
  readonly references: Readonly<Record<string, number>>;
  readonly issues: Readonly<Record<string, number>>;
}
const EXPECTED_RECORDS: Readonly<Record<string, ExpectedRecords>> = {
  'apex-recipes': {
    files: 11,
    records: 11,
    references: { 'listed-field resolved': 19, 'record-of resolved': 11, 'value resolved': 12 },
    issues: {},
  },
  'nebula-logger': {
    files: 100,
    records: 93,
    references: { 'listed-field resolved': 306, 'record-of resolved': 100, 'value resolved': 40 },
    issues: {},
  },
  npsp: {
    files: 193,
    records: 193,
    references: { 'listed-field resolved': 1258, 'record-of resolved': 193, 'value resolved': 318 },
    issues: {},
  },
  pmm: {
    files: 31,
    records: 31,
    references: {
      'listed-field resolved': 40,
      'record-of external': 4,
      'record-of resolved': 27,
      'value resolved': 25,
    },
    issues: { NAME_NOT_READ: 4 },
  },
  eda: {
    files: 4,
    records: 4,
    references: { 'listed-field resolved': 10, 'record-of external': 2, 'record-of resolved': 2 },
    issues: { NAME_NOT_READ: 8 },
  },
};

const counted = (values: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
};

/**
 * The classes and triggers of the package folders, parsed by the reader of Apex on 26 November 2026: every one of
 * them parses. These are the counts of finding 7 of the Phase 3 plan. Outside the package folders, 13 files of
 * Apex do not parse, and a snapshot does not read them: 8 scripts of anonymous Apex that declare no class (4 of
 * NPSP, one of them under `datasets`, 1 of V4S and 3 of EDA), and 5 classes of EDA under `unpackaged` that hold the
 * token `%%%NAMESPACE_DOT%%%`, which the build tool of that project replaces before it deploys.
 */
const APEX_FILES: Readonly<Record<string, { readonly classes: number; readonly triggers: number }>> = {
  'apex-recipes': { classes: 139, triggers: 3 },
  'coral-cloud': { classes: 26, triggers: 0 },
  eda: { classes: 601, triggers: 37 },
  'nebula-logger': { classes: 87, triggers: 6 },
  npsp: { classes: 1035, triggers: 26 },
  'outbound-funds': { classes: 8, triggers: 0 },
  pmm: { classes: 107, triggers: 2 },
  'volunteers-for-salesforce': { classes: 71, triggers: 7 },
};

describe('the analysis of the public codebases', () => {
  for (const { name, paths } of manifest.corpus) {
    // A codebase that is not there shows in the report of the run as skipped, not as passed.
    it.skipIf(!existsSync(join(corpora, name)))(
      `analyses ${name}, and reads every formula of it`,
      async () => {
        const { tree } = readFolders(join(corpora, name), paths);
        const listed = (await resolveComponents(tree, paths)).components;
        const analysis = analyseSource(tree, listed, { apex: await loadApexReader() });
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
          // No file that the reader refuses, no name it does not read, no formula it does not read as a whole, and no
          // Apex that does not parse.
          issues: counted(analysis.issues.map((issue) => issue.code)),
        }).toEqual(EXPECTED[name]);
        expect(analysis.work.map((work) => `${work.origin} ${String(work.failedFiles)}`)).toEqual([
          'parser:xml 0',
          `parser:formula ${String(FAILED_FORMULAS[name] ?? 0)}`,
          'parser:flow 0',
          'parser:apex 0',
        ]);
        // Every class and trigger is read, and so is each of its members.
        const apex = analysis.components.filter((one) => /^Apex(?:Class|Trigger):/.test(one.key));
        expect(apex.filter((one) => one.attrs === null).map((one) => one.key)).toEqual([]);
        expect(analysis.work[3]?.components).toBe(apex.length);
        // Every name of a formula was found or has a key: none is unresolved, and none is less than confirmed.
        const inFormulas = references.filter((one) => one.origin === 'parser:formula');
        expect(counted(inFormulas.map((one) => one.confidence))).toEqual(
          inFormulas.length === 0 ? {} : { confirmed: inFormulas.length },
        );
        expect(inFormulas.filter((one) => one.resolution === 'unresolved')).toEqual([]);
        // Every override of an action names a page or a component that the codebase defines.
        const overrides = references.filter((one) => one.attrs?.['via'] === 'action-override');
        expect(overrides.filter((one) => one.resolution !== 'resolved')).toEqual([]);
        // Every key once.
        expect(new Set(analysis.components.map((one) => one.key)).size).toBe(analysis.components.length);
      },
      300_000,
    );

    it.skipIf(!existsSync(join(corpora, name)))(
      `parses every class and trigger of ${name}`,
      async () => {
        const reader = await loadApexReader();
        const { tree } = readFolders(join(corpora, name), paths);
        const code = tree.files.filter((path) => path.endsWith('.cls') || path.endsWith('.trigger'));
        const notRead = code.flatMap((path) => {
          const { problems } = reader.parseUnit(
            Buffer.from(tree.read(path)).toString('utf8'),
            path.endsWith('.trigger') ? 'trigger' : 'class',
          );
          return problems.length === 0 ? [] : [path];
        });
        expect({
          classes: code.filter((path) => path.endsWith('.cls')).length,
          triggers: code.filter((path) => path.endsWith('.trigger')).length,
          notRead,
        }).toEqual({ ...APEX_FILES[name], notRead: [] });
      },
      300_000,
    );

    // Most flows of the codebases stand outside the package: the listing of the check by hand names the folders.
    const folders = EXPECTED_FLOWS[name] === undefined ? undefined : (FLOW_FOLDERS[name] ?? paths);
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

    const recordFolders = RECORD_FOLDERS[name];
    it.skipIf(!existsSync(join(corpora, name)) || recordFolders === undefined)(
      `reads every record of a custom metadata type of ${name}`,
      async () => {
        const paths = [...(recordFolders ?? [])];
        const { tree } = readFolders(join(corpora, name), paths);
        const files = tree.files.filter((path) => path.endsWith('.md-meta.xml'));
        const listed = (await resolveComponents(tree, paths)).components;
        const analysis = analyseSource(tree, listed);
        const records = analysis.components.filter((one) => one.key.startsWith('CustomMetadata:'));
        const issues = analysis.issues.filter((issue) => issue.componentKey?.startsWith('CustomMetadata:') === true);

        // Every record was read, no file of the codebase was refused, and nothing is an error.
        expect(records.filter((one) => one.attrs === null)).toEqual([]);
        expect(analysis.work.map((work) => work.failedFiles)).toEqual([0, FAILED_FORMULAS[name] ?? 0, 0, 0]);
        expect(analysis.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
        expect({
          files: files.length,
          records: records.length,
          references: counted(
            records.flatMap((one) =>
              one.references.map((reference) => {
                const via = reference.attrs?.['via'];
                return `${typeof via === 'string' ? via : 'none'} ${reference.resolution}`;
              }),
            ),
          ),
          issues: counted(issues.map((issue) => issue.code)),
        }).toEqual(EXPECTED_RECORDS[name]);
        // No value gives a reference at the tier `probable`.
        expect(records.flatMap((one) => one.references).filter((one) => one.confidence !== 'confirmed')).toEqual([]);
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
          if (!/\.(?:field|validationRule|object|workflow|quickAction)(?:-meta\.xml)?$/.test(path)) continue;
          const text = Buffer.from(tree.read(path)).toString('utf8');
          // The files are searched as text here, not read as XML. None of the codebases writes a formula in CDATA.
          // A file of workflow rules holds the formulas of its rules and field updates, and a quick action the
          // formulas that set its fields.
          for (const [, , body = ''] of text.matchAll(
            /<(formula|errorConditionFormula|defaultValue)\s*>([\s\S]*?)<\/\1\s*>/g,
          )) {
            const formula = body
              .replace(/&#(x?)([0-9A-Fa-f]+);/g, (_, hex: string, code: string) =>
                String.fromCodePoint(Number.parseInt(code, hex === '' ? 10 : 16)),
              )
              .replace(/&(lt|gt|amp|quot|apos);/g, (_, name: string) => entity[name] ?? '')
              .trim();
            if (formula === '') continue;
            formulas += 1;
            const parsed = parseFormula(formula);
            const names = parsed.tree === null ? null : namesOfTree(parsed.tree).map((one) => one.text);
            if (JSON.stringify(names) !== JSON.stringify(scanNames(formula))) differ.push(`${path}: ${formula}`);
          }
        }
        expect(differ).toEqual(SCAN_DIFFERS[name] ?? []);
        // Texts are counted here and components above. The numbers are the same where no field has a formula and
        // a default value and no quick action has two formulas.
        expect(formulas + (FLOW_FORMULAS[name] ?? 0)).toBe(
          (EXPECTED[name]?.withFormula ?? 0) + (MORE_TEXTS[name] ?? 0),
        );
      },
      300_000,
    );
  }
});
