/**
 * What `coverage` says about the cross-check of a snapshot of an org.
 *
 * The mock org of these tests holds Apex classes, which this phase does not analyse, so a snapshot of it has
 * nothing to compare (`org-snapshot.test.ts`). A test of the command line reaches the database only through
 * the engine. So the engine is wrapped here, and hands out the report of a real snapshot with a cross-check a
 * test sets. The tests of the engine show that it makes such a cross-check (`org-cross-check.test.ts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Engine from '@sf-orglens/engine';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

const engineState = vi.hoisted(() => ({
  crossCheck: undefined as Engine.CrossCheckReport | null | undefined,
  analysed: true,
}));

vi.mock('@sf-orglens/engine', async (original) => {
  const engine = await original<typeof Engine>();
  return {
    ...engine,
    openWorkspace: async (locator?: Engine.WorkspaceLocator): Promise<Engine.Workspace> => {
      const workspace = await engine.openWorkspace(locator);
      if (engineState.crossCheck === undefined) return workspace;
      const { crossCheck, analysed } = engineState;
      return {
        ...workspace,
        coverage: async (source, options) => {
          const report = await workspace.coverage(source, options);
          return {
            ...report,
            snapshot: { ...report.snapshot, kind: 'org', commit: null, apiVersion: '66.0' },
            analysis: analysed ? report.analysis : null,
            crossCheck,
            issues: [],
          };
        },
      };
    },
  };
});

const dirs = tempDirs();
afterEach(() => {
  engineState.crossCheck = undefined;
  engineState.analysed = true;
  dirs.cleanUp();
});

const OBJECT = 'force-app/main/default/objects/Parcel__c';
const FILES: Readonly<Record<string, string>> = {
  'orglens.toml': 'schema_version = 1\n[sources.work]\nkind = "git"\n',
  'sfdx-project.json': '{ "packageDirectories": [{ "path": "force-app" }] }\n',
  [`${OBJECT}/Parcel__c.object-meta.xml`]:
    '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n    <deploymentStatus>Deployed</deploymentStatus>\n    <label>Parcel</label>\n    <nameField>\n        <label>Parcel Name</label>\n        <type>Text</type>\n    </nameField>\n    <pluralLabel>Parcels</pluralLabel>\n    <sharingModel>ReadWrite</sharingModel>\n</CustomObject>\n',
};

/** A workspace with one snapshot. What its coverage says about a cross-check is set by the test. */
async function snapshotTaken(): Promise<string> {
  const dir = dirs.next();
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split('/')), content);
  }
  expect(await orglens(dir, ['snapshot', 'work'])).toMatchObject({ code: 0 });
  return dir;
}

const READ: Omit<Engine.CrossCheckReport, 'comparison'> = {
  state: 'whole',
  readAt: '2026-02-01T08:30:00.000Z',
  requests: 1,
  rows: 40,
  queriesCutOff: 0,
  queriesFailed: 0,
  queriesNotProven: 0,
  code: null,
};

const NOTHING: Engine.CrossCheck = {
  rows: 40,
  rowsNotAnalysed: 0,
  notAnalysed: [],
  rowsNotMatched: 0,
  rowsNotHeld: 0,
  rowsOtherVersion: 0,
  rowsCompared: 40,
  pairs: 38,
  agreed: 38,
  coveredByPart: 0,
  missed: [],
  onlyOrgLens: [],
  notReported: [],
};

/** The lines of the coverage after the ones about the analysis. */
async function crossCheckLines(dir: string): Promise<string[]> {
  const shown = await orglens(dir, ['coverage', 'work']);
  expect(shown).toMatchObject({ code: 0, stderr: '' });
  const lines = shown.stdout.split('\n');
  const at = lines.findIndex((line) => line.startsWith('Cross-check:') || line.startsWith('The Dependency API'));
  return at === -1 ? [] : lines.slice(at);
}

describe('the cross-check of a snapshot, as the coverage shows it', () => {
  it('says in one sentence each what was read and what was compared when the two agree', async () => {
    const dir = await snapshotTaken();
    // A snapshot of a repository has no cross-check, and the coverage says nothing about one.
    expect(await crossCheckLines(dir)).toEqual([]);

    engineState.crossCheck = { ...READ, comparison: NOTHING };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 40 rows. No answer shows that a row is missing.',
      '40 rows were compared. They are 38 pairs of components: the analysis has 38 of them, has 0 as a reference to a part of the object Salesforce names, and missed 0.',
      '',
    ]);
    expect((await orglensJson(dir, ['coverage', 'work'])).data).toMatchObject({
      crossCheck: { state: 'whole', rows: 40, comparison: NOTHING },
    });
  });

  it('lists the pairs the analysis missed and the ones only it has, and counts what is not compared', async () => {
    const dir = await snapshotTaken();
    const only = Array.from({ length: 22 }, (_, index) => ({
      from: `CustomField:invoice__c.f${String(index).padStart(2, '0')}__c`,
      to: 'CustomField:invoice__c.amount__c',
    }));
    engineState.crossCheck = {
      ...READ,
      rows: 136,
      comparison: {
        rows: 136,
        rowsNotAnalysed: 61,
        notAnalysed: [
          { type: 'ApexClass', rows: 60 },
          { type: 'CustomMetadata', rows: 1 },
        ],
        rowsNotMatched: 1,
        rowsNotHeld: 2,
        rowsOtherVersion: 16,
        rowsCompared: 56,
        pairs: 50,
        agreed: 46,
        coveredByPart: 2,
        missed: [
          { from: 'CustomField:invoice__c.total__c', to: 'CustomField:invoice__c.status__c' },
          { from: 'ValidationRule:invoice__c.amount_positive', to: 'CustomField:invoice__c.amount__c' },
        ],
        onlyOrgLens: only,
        notReported: [
          { reason: 'lookup', pairs: 7 },
          { reason: 'standard-field', pairs: 31 },
        ],
      },
    };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 136 rows. No answer shows that a row is missing.',
      '61 rows are from a component of a type whose rows this version does not compare: ApexClass 60, CustomMetadata 1.',
      '1 row names a component the org did not list, and is not compared.',
      '2 rows are from a component the snapshot does not hold or that was not analysed, and are not compared.',
      '16 rows are from a version of a flow that the snapshot does not hold, such as a draft, and are not compared.',
      '56 rows were compared. They are 50 pairs of components: the analysis has 46 of them, has 2 as a reference to a part of the object Salesforce names, and missed 2.',
      '',
      'Salesforce reports these references, and the analysis has none. Each is an error of the analysis:',
      'FROM                                       TO',
      'CustomField:invoice__c.total__c            CustomField:invoice__c.status__c',
      'ValidationRule:invoice__c.amount_positive  CustomField:invoice__c.amount__c',
      '',
      // One row names a component the org did not list, so a pair without a row can be the pair of that row.
      'The analysis has 22 references of a kind Salesforce reports, without a row that was compared. Either the analysis is wrong there, or the API left them out, or their rows are among those that are missing or not compared:',
      'FROM                           TO',
      ...only.slice(0, 20).map(({ from, to }) => `${from}  ${to}`),
      '2 more pairs: --json has all of them.',
      '',
      'The analysis has 38 more references of kinds the API does not report: lookup 7, standard-field 31.',
      '',
    ]);
    // The output for a script has every pair, and matches the schema.
    const json = await orglensJson(dir, ['coverage', 'work']);
    expect(json.data).toMatchObject({ crossCheck: { comparison: { onlyOrgLens: only } } });
  });

  it('says that rows are missing, with the code, when a query was cut off or failed', async () => {
    const dir = await snapshotTaken();
    engineState.crossCheck = {
      ...READ,
      state: 'partial',
      requests: 31,
      queriesCutOff: 1,
      queriesFailed: 2,
      code: 'TIMEOUT',
      comparison: { ...NOTHING, missed: [{ from: 'CustomField:a__c.b__c', to: 'CustomField:a__c.c__c' }], agreed: 37 },
    };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 40 rows. Rows are missing, or may be: 3 queries were cut off or failed (TIMEOUT).',
      '40 rows were compared. They are 38 pairs of components: the analysis has 37 of them, has 0 as a reference to a part of the object Salesforce names, and missed 1.',
      '',
      'Salesforce reports this reference, and the analysis has none. It is an error of the analysis:',
      'FROM                   TO',
      'CustomField:a__c.b__c  CustomField:a__c.c__c',
      '',
    ]);

    // Every row of a component the org listed is there. A component it did not list could have rows.
    engineState.crossCheck = {
      ...READ,
      state: 'partial',
      requests: 212,
      queriesNotProven: 2,
      comparison: { ...NOTHING, onlyOrgLens: [{ from: 'CustomField:a__c.b__c', to: 'CustomField:a__c.c__c' }] },
    };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 40 rows. Rows of a component the org did not list may be missing: 2 queries near the limit of the API were asked again component by component.',
      '40 rows were compared. They are 38 pairs of components: the analysis has 38 of them, has 0 as a reference to a part of the object Salesforce names, and missed 0.',
      '',
      'The analysis has 1 reference of a kind Salesforce reports, without a row that was compared. Either the analysis is wrong there, or the API left it out, or its row is among those that are missing or not compared:',
      'FROM                   TO',
      'CustomField:a__c.b__c  CustomField:a__c.c__c',
      '',
    ]);
    // Both at once.
    engineState.crossCheck = {
      ...READ,
      state: 'partial',
      queriesCutOff: 1,
      queriesNotProven: 1,
      code: null,
      comparison: NOTHING,
    };
    expect((await crossCheckLines(dir))[0]).toBe(
      'Cross-check: the Dependency API of Salesforce reports 40 rows. Rows are missing, or may be: 1 query was cut off or failed. Rows of a component the org did not list may be missing: 1 query near the limit of the API was asked again component by component.',
    );
  });

  it('says when nothing was compared: no answer of the API, no analysis, or a comparison it cannot show', async () => {
    const dir = await snapshotTaken();
    engineState.crossCheck = {
      ...READ,
      state: 'none',
      rows: 0,
      requests: 3,
      queriesFailed: 2,
      code: 'INVALID_TYPE',
      comparison: null,
    };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce gave no answer (INVALID_TYPE). Nothing was compared.',
      '',
    ]);

    // The rows are there, and the analysis the snapshot has was made by a version whose comparison is not read.
    engineState.crossCheck = { ...READ, comparison: null };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 40 rows. No answer shows that a row is missing.',
      'They were not compared by this version of OrgLens. Compare them with: orglens analyse work --snapshot 1',
      '',
    ]);

    engineState.analysed = false;
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 40 rows. No answer shows that a row is missing.',
      'They were not compared: the snapshot is not analysed.',
      '',
    ]);

    // A snapshot of an org that was taken without the cross-check says so.
    engineState.analysed = true;
    engineState.crossCheck = null;
    expect(await crossCheckLines(dir)).toEqual([
      'The Dependency API of Salesforce was not asked for this snapshot. Its analysis is not cross-checked.',
      '',
    ]);
    expect((await orglensJson(dir, ['coverage', 'work'])).data).toMatchObject({ crossCheck: null });
  });

  it('counts a single row and a single reference in the singular', async () => {
    const dir = await snapshotTaken();
    engineState.crossCheck = {
      ...READ,
      rows: 4,
      comparison: {
        ...NOTHING,
        rows: 4,
        rowsNotAnalysed: 1,
        notAnalysed: [{ type: 'ApexClass', rows: 1 }],
        rowsNotHeld: 1,
        rowsOtherVersion: 1,
        rowsCompared: 1,
        pairs: 1,
        agreed: 1,
        onlyOrgLens: [{ from: 'CustomField:a__c.b__c', to: 'CustomField:a__c.c__c' }],
        notReported: [{ reason: 'lookup', pairs: 1 }],
      },
    };
    expect(await crossCheckLines(dir)).toEqual([
      'Cross-check: the Dependency API of Salesforce reports 4 rows. No answer shows that a row is missing.',
      '1 row is from a component of a type whose rows this version does not compare: ApexClass 1.',
      '1 row is from a component the snapshot does not hold or that was not analysed, and is not compared.',
      '1 row is from a version of a flow that the snapshot does not hold, such as a draft, and is not compared.',
      '1 row was compared. It is 1 pair of components: the analysis has 1 of them, has 0 as a reference to a part of the object Salesforce names, and missed 0.',
      '',
      'The analysis has 1 reference of a kind Salesforce reports, without a row. Either the analysis is wrong there, or the API left it out:',
      'FROM                   TO',
      'CustomField:a__c.b__c  CustomField:a__c.c__c',
      '',
      'The analysis has 1 more reference of kinds the API does not report: lookup 1.',
      '',
    ]);
  });
});
