/**
 * The cross-check of a snapshot of an org: the Dependency API of a mock org is read with the snapshot, and what
 * it reports is held against the analysis (decision record 0045).
 *
 * The mock org holds the fixture project. Its Dependency API reports what the answer key of the project, which
 * is written by hand, has for a formula, and what it has for Apex, which this phase does not analyse. Of the
 * files of Phase 2, it reports what the test org reports (`helpers/fixture-dependencies.ts`).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot, type OrgSnapshotTuning, type SnapshotProgress } from '../src/api/org-snapshot.ts';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { DEPENDENCY_OBJECT, FLOW_VERSION_OBJECT } from '../src/sources/dependency-api.ts';
import { readDependencyRows, writeDependencies } from '../src/store/dependencies.ts';
import { openStore } from '../src/store/open.ts';
import { addIssue } from '../src/store/snapshots.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { fixtureDependencyRows, keyedPairs } from './helpers/fixture-dependencies.ts';
import { besidesKnownGap } from './helpers/known-gap.ts';
import {
  dependencyRow,
  mockDependencies,
  type MockDependencies,
  type MockDependencyRow,
} from './helpers/mock-dependencies.ts';
import { metadataFromSource, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';
import { DRAFT_CHANGES, DRAFT_ONLY_FIELD, FLOW_WITH_DRAFT } from './live/deploy-fixture.ts';

const WHOLE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const ORG_ID = '00Dxx0000000001EAA';
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CONFIG = `schema_version = 1\n\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`;

/** The rule whose formula the second org of these tests hands out without one of its names. */
const RULE = 'ValidationRule:invoice__c.tax_rate_matches_code';
const RULE_FILE = 'main/default/objects/Invoice__c/validationRules/Tax_Rate_Matches_Code.validationRule-meta.xml';
const TAKEN_OUT = 'CustomField:invoice__c.tax_code_name__c';
/** The flow whose file another org of these tests hands out without one of its fields, and that field. */
const FLOW = 'Flow:invoice_before_save';
const FLOW_FILE = 'main/default/flows/Invoice_Before_Save.flow-meta.xml';
const TAKEN_FROM_FLOW = 'CustomField:invoice__c.legacy_code__c';
/** The file of the flow that some orgs of these tests hold a draft of, beside its active version. */
const DRAFTED_FILE = `main/default/flows/${FLOW_WITH_DRAFT}.flow-meta.xml`;

const rowsOf = fixtureDependencyRows;

const dirs = tempDirs();
const copies = tempDirs();
let mock: MockOrg;
let metadata: MockMetadata;
let dependencies: MockDependencies;

beforeAll(async () => {
  mock = await startMockOrg();
});
afterAll(async () => {
  await mock.close();
  copies.cleanUp();
});
beforeEach(async () => {
  metadata = await metadataFromSource(WHOLE);
  dependencies = mockDependencies(rowsOf(metadata));
  mock.metadata = metadata;
  mock.dependencies = dependencies;
  mock.sessions.add('valid-session');
  await seedCliLogin({
    username: 'zoe@example.com',
    alias: 'main',
    orgId: ORG_ID,
    instanceUrl: mock.url,
    accessToken: 'valid-session',
  });
});
afterEach(async () => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.intercept = null;
  mock.dependencies = null;
  await forgetCliLogins();
  dirs.cleanUp();
});

function workspaceDir(): string {
  const dir = dirs.next();
  writeFileSync(join(dir, 'orglens.toml'), CONFIG);
  return dir;
}

/**
 * The queries a snapshot of the mock org asks for the rows of the Dependency API, where no answer is near the
 * limit: the query for every row, one for each of the 17 types that are known to refer and of the 2 others the rows
 * show, a record of a custom metadata type and a field set, and one for the rest (decision record 0069). The number
 * is written out, so that a reading that asks more is seen here.
 */
const QUERIES_FOR_ROWS = 21;

/** The requests for rows of the Dependency API, and every other request that is a query. */
const queryPaths = (): string[] => [
  ...new Set(mock.requests.filter((request) => request.path.includes('query')).map((request) => request.path)),
];
const ofReading = (report: CoverageReport): string[] =>
  report.issues.filter((issue) => issue.stage === 'read').map((issue) => `${issue.severity} ${issue.code}`);

/**
 * Makes the mock org hold a draft of a flow beside its active version, as the test org does after the step that
 * sends the draft. The Dependency API has the rows of both versions, each with the id of its version: the rows of
 * the draft carry the id the org lists the flow with, and one more of them names the field only the draft reads.
 */
async function orgWithDraft(): Promise<{
  readonly activeId: string;
  readonly ofActive: readonly MockDependencyRow[];
  readonly ofDraft: readonly MockDependencyRow[];
}> {
  const copy = join(copies.next(), 'force-app');
  cpSync(WHOLE, copy, { recursive: true });
  const file = join(copy, DRAFTED_FILE);
  const active = readFileSync(file, 'utf8');
  writeFileSync(
    file,
    DRAFT_CHANGES.reduce((text, [from, to]) => text.replace(from, to), active),
  );
  metadata = await metadataFromSource(copy);
  metadata.flowVersions.set(FLOW_WITH_DRAFT, { latest: 2, older: new Map([[1, active]]) });
  mock.metadata = metadata;
  const activeId = metadata.versionIdOf(FLOW_WITH_DRAFT, 1) ?? '';
  const ofFlow = rowsOf(metadata).filter(
    (row) => row['MetadataComponentType'] === 'Flow' && row['MetadataComponentName'] === FLOW_WITH_DRAFT,
  );
  const onlyOfDraft = dependencyRow(metadata, ['Flow', FLOW_WITH_DRAFT], ['CustomField', DRAFT_ONLY_FIELD]);
  const ofActive = ofFlow.map((row) => ({ ...row, MetadataComponentId: activeId }));
  dependencies = mockDependencies([...rowsOf(metadata), onlyOfDraft, ...ofActive]);
  mock.dependencies = dependencies;
  return { activeId, ofActive, ofDraft: [...ofFlow, onlyOfDraft] };
}
/** The issues of the analysis, without the one warning about a flow that every analysis of the project holds. */
const ofAnalysis = (report: CoverageReport): string[] =>
  besidesKnownGap(report.issues.filter((issue) => issue.stage === 'analysis')).map(
    (issue) => `${issue.severity} ${issue.code}`,
  );

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'the cross-check of a snapshot of an org with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };
    const databaseOf = (dir: string): string => join(dir, '.orglens', 'orglens.db');

    /** Takes a snapshot the way the workspace does, with the numbers a test sets. */
    async function snap(
      dir: string,
      options: {
        crossCheck?: boolean;
        tuning?: Partial<OrgSnapshotTuning>;
        onProgress?: (event: SnapshotProgress) => void;
      } = {},
    ): Promise<CoverageReport> {
      const workspace = await openWorkspace({ root: dir, env });
      const source = (await workspace.sources.list()).find((one) => one.name === 'prod') as OrgSource;
      mkdirSync(join(dir, '.orglens'), { recursive: true });
      return takeOrgSnapshot({
        paths: workspacePaths(dir),
        source,
        linked: undefined,
        env,
        openStore: () => openStore({ path: databaseOf(dir), driver }),
        crossCheck: options.crossCheck,
        onProgress: options.onProgress,
        tuning: { pollFirstMs: 5, ...options.tuning },
      });
    }

    const count = (dir: string, sql: string): number => {
      const store = openStore({ path: databaseOf(dir), driver, readOnly: true });
      try {
        return Number(store.get(sql)?.['n']);
      } finally {
        store.close();
      }
    };

    it('holds what Salesforce reports against the analysis, and finds every pair of the fixture project', async () => {
      const dir = workspaceDir();
      const workspace = await openWorkspace({ root: dir, env });
      const report = await workspace.snapshot('prod');
      const pairs = keyedPairs();
      const apex = pairs.filter((pair) => pair.apex).length;
      const compared = pairs.length - apex;

      expect(report.snapshot.status).toBe('complete');
      expect(besidesKnownGap(report.issues)).toEqual([]);
      expect(report.analysis?.complete).toBe(true);
      // One query for the versions of the flows, then the query for every row, one for each type of component that
      // refers and one for the rest. No answer is near the limit here, and the first does not stand for the org
      // however few rows it holds (decision record 0069).
      const where = dependencies.queries.slice(1).map((soql) => soql.split(' WHERE ')[1] ?? '');
      expect(dependencies.queries[0]).toContain(` FROM ${FLOW_VERSION_OBJECT}`);
      expect(where[0]).toBe('');
      expect(where.slice(1, -1).every((one) => /^MetadataComponentType = '\w+'$/.test(one))).toBe(true);
      expect(where.at(-1)).toMatch(/^MetadataComponentType NOT IN \(/);
      expect(dependencies.queries).toHaveLength(1 + QUERIES_FOR_ROWS);
      expect(report.crossCheck).toEqual({
        state: 'whole',
        readAt: expect.stringMatching(UTC) as string,
        requests: 1 + QUERIES_FOR_ROWS,
        rows: pairs.length + 2,
        queriesCutOff: 0,
        queriesFailed: 0,
        queriesNotProven: 0,
        code: null,
        comparison: {
          rows: pairs.length + 2,
          // The rows of Apex, which this phase does not analyse.
          rowsNotAnalysed: apex,
          notAnalysed: [
            { type: 'ApexClass', rows: pairs.filter((pair) => pair.from[0] === 'ApexClass').length },
            { type: 'ApexTrigger', rows: pairs.filter((pair) => pair.from[0] === 'ApexTrigger').length },
          ],
          // Every end of a row is a component the org listed, found by its id.
          rowsNotMatched: 0,
          rowsNotHeld: 0,
          // The project has one version of each flow, which is the one the snapshot holds.
          rowsOtherVersion: 0,
          rowsCompared: compared + 2,
          pairs: compared + 2,
          agreed: compared,
          // The two rows from a rule to an object: the analysis has the field and the record of it.
          coveredByPart: 2,
          missed: [],
          onlyOrgLens: [],
          notReported: expect.any(Array) as unknown[],
        },
      });
      // The fixture project is made to have something of every kind.
      expect(apex).toBeGreaterThan(20);
      expect(compared).toBeGreaterThan(40);
      expect(pairs.filter((pair) => pair.from[0] === 'Flow').length).toBeGreaterThan(40);
      // What the analysis has and the API never reports is counted by its reason, and is no issue. The mock org
      // reports every formula, also the one of a rule that is not active and the one in a default value. Of the
      // workflow rules, it reports what the test org reports: the custom fields the formula of a field update
      // reads. Of the records of custom metadata types, the type, and of a record type, nothing. Of a flow, what
      // the test org reports: not a flow it starts, not a record type a condition names in a text, and not a field
      // of a custom setting or a custom permission that only a formula names.
      const reasons = report.crossCheck?.comparison?.notReported.map((one) => one.reason);
      expect(reasons).toEqual([
        'controlling-field',
        'custom-metadata',
        'field-update',
        'global-variable',
        'lookup',
        'lookup-filter',
        'name-in-text',
        'record-type',
        'roll-up-summary',
        'standard-field',
        'standard-object',
        'subflow',
        'value-set',
        'workflow-action',
        'workflow-rule',
      ]);

      // Only metadata is read: two objects of the Tooling API are queried, the versions of the flows first, and
      // nothing else is.
      expect(dependencies.queries[0]).toBe(
        `SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM ${FLOW_VERSION_OBJECT}`,
      );
      for (const soql of dependencies.queries.slice(1)) {
        expect(soql).toMatch(new RegExp(` FROM ${DEPENDENCY_OBJECT}(?: WHERE |$)`));
      }
      expect(DEPENDENCY_OBJECT).toBe('MetadataComponentDependency');
      expect(FLOW_VERSION_OBJECT).toBe('FlowDefinition');
      expect(queryPaths()).toEqual(['/services/data/v66.0/tooling/query']);

      // The rows are kept as Salesforce wrote them, and none of them became a reference.
      expect(count(dir, 'SELECT count(*) AS n FROM snapshot_dependency')).toBe(pairs.length + 2);
      expect(count(dir, `SELECT count(*) AS n FROM reference WHERE origin = 'dependency-api'`)).toBe(0);
      // The coverage of the snapshot says the same later.
      expect(await workspace.coverage('prod')).toEqual(report);
    });

    it('answers an impact question the same with and without the rows of the API', async () => {
      const withRows = workspaceDir();
      const without = workspaceDir();
      await snap(withRows);
      await snap(without, { crossCheck: false });
      // A class refers to this field, and the API has a row for it. The analysis of this phase does not read
      // classes, so no answer may show the class.
      const ask = async (dir: string): Promise<unknown> => {
        const answer = await (await openWorkspace({ root: dir, env })).impact('prod', 'Invoice__c.Amount__c');
        return {
          ...answer,
          snapshot: { ...answer.snapshot, analysedAt: 'TIME', startedAt: 'TIME', finishedAt: 'TIME' },
        };
      };
      const answer = await ask(withRows);
      expect(JSON.stringify(answer)).not.toContain('ApexClass:');
      expect(JSON.stringify(answer)).not.toContain('dependency-api');
      expect(answer).toEqual(await ask(without));
      expect(count(without, 'SELECT count(*) AS n FROM snapshot_dependency_reading')).toBe(0);
      expect((await (await openWorkspace({ root: without, env })).coverage('prod')).crossCheck).toBeNull();
    });

    it('finds a pair that is taken out of the result of the analysis on purpose, and calls the analysis incomplete', async () => {
      // The org hands out the rule with a formula that does not name the field any more. Its Dependency API
      // still reports the reference: for this test, Salesforce knows something the analysis cannot find.
      const copy = join(copies.next(), 'force-app');
      cpSync(WHOLE, copy, { recursive: true });
      const file = join(copy, RULE_FILE);
      const formula = readFileSync(file, 'utf8');
      expect(formula.split('Tax_Code_Name__c')).toHaveLength(3);
      writeFileSync(file, formula.replaceAll('Tax_Code_Name__c', '&quot;no name&quot;'));
      metadata = await metadataFromSource(copy);
      mock.metadata = metadata;
      dependencies = mockDependencies(rowsOf(metadata));
      mock.dependencies = dependencies;

      const dir = workspaceDir();
      const workspace = await openWorkspace({ root: dir, env });
      const report = await workspace.snapshot('prod');
      // Everything was read. What is not complete is the analysis.
      expect(report.snapshot.status).toBe('complete');
      expect(ofReading(report)).toEqual([]);
      expect(report.analysis?.complete).toBe(false);
      expect(report.crossCheck?.comparison).toMatchObject({ missed: [{ from: RULE, to: TAKEN_OUT }], onlyOrgLens: [] });
      expect(besidesKnownGap(report.issues.filter((issue) => issue.stage === 'analysis'))).toEqual([
        {
          stage: 'analysis',
          severity: 'error',
          code: 'REFERENCE_MISSED',
          message: `Salesforce reports that ${RULE} refers to ${TAKEN_OUT}, and the analysis found no such reference.`,
          component: RULE,
          details: { from: RULE, to: TAKEN_OUT, origin: 'dependency-api' },
        },
      ]);
      // An answer about the field says that it can miss something, and does not show the rule as found.
      const answer = await workspace.impact('prod', 'Invoice__c.Tax_Code_Name__c');
      expect(answer.mayMiss).toBe(true);
      expect(answer.complete).toBe(false);
      expect(answer.results.map((result) => result.key)).not.toContain(RULE);

      // A second analysis compares again, from the rows the snapshot holds: the org is not asked.
      const asked = mock.requests.length;
      const again = await workspace.analyse('prod');
      expect(mock.requests.length).toBe(asked);
      expect(again.crossCheck).toEqual(report.crossCheck);
      expect(ofAnalysis(again)).toEqual(['error REFERENCE_MISSED']);
    });

    it('finds a pair that is taken out of a flow on purpose, and calls the analysis incomplete', async () => {
      // The org hands out the flow with an assignment to another field. Its Dependency API still reports the field
      // the flow of the project writes, from the one version of the flow.
      const copy = join(copies.next(), 'force-app');
      cpSync(WHOLE, copy, { recursive: true });
      const file = join(copy, FLOW_FILE);
      const flow = readFileSync(file, 'utf8');
      expect(flow.split('Legacy_Code__c')).toHaveLength(2);
      writeFileSync(file, flow.replace('$Record.Legacy_Code__c', '$Record.Description'));
      metadata = await metadataFromSource(copy);
      mock.metadata = metadata;
      dependencies = mockDependencies(rowsOf(metadata));
      mock.dependencies = dependencies;

      const dir = workspaceDir();
      const workspace = await openWorkspace({ root: dir, env });
      const report = await workspace.snapshot('prod');
      expect(report.snapshot.status).toBe('complete');
      expect(ofReading(report)).toEqual([]);
      expect(report.analysis?.complete).toBe(false);
      expect(report.crossCheck?.comparison).toMatchObject({
        rowsOtherVersion: 0,
        missed: [{ from: FLOW, to: TAKEN_FROM_FLOW }],
        onlyOrgLens: [],
      });
      expect(besidesKnownGap(report.issues.filter((issue) => issue.stage === 'analysis'))).toEqual([
        {
          stage: 'analysis',
          severity: 'error',
          code: 'REFERENCE_MISSED',
          message: `Salesforce reports that ${FLOW} refers to ${TAKEN_FROM_FLOW}, and the analysis found no such reference.`,
          component: FLOW,
          details: { from: FLOW, to: TAKEN_FROM_FLOW, origin: 'dependency-api' },
        },
      ]);
      // An answer about the field says that it can miss something, and does not show the flow as found.
      const answer = await workspace.impact('prod', 'Invoice__c.Legacy_Code__c');
      expect(answer.mayMiss).toBe(true);
      expect(answer.results.map((result) => result.key)).not.toContain(FLOW);
    });

    it('compares the rows of the version of a flow the snapshot holds, and counts those of a newer one', async () => {
      const { activeId, ofActive, ofDraft } = await orgWithDraft();
      expect(activeId).not.toBe(metadata.idOf('Flow', FLOW_WITH_DRAFT));
      expect(ofActive.length).toBeGreaterThan(5);
      const pairs = keyedPairs();
      const apex = pairs.filter((pair) => pair.apex).length;
      const dir = workspaceDir();
      const workspace = await openWorkspace({ root: dir, env });
      const report = await workspace.snapshot('prod');

      // The snapshot holds the active version, which the answer key describes.
      expect(report.snapshot.status).toBe('complete');
      expect(ofReading(report)).toEqual(['info FLOW_NEWER_VERSION']);
      expect(report.analysis?.complete).toBe(true);
      expect(report.crossCheck).toMatchObject({
        state: 'whole',
        requests: 1 + QUERIES_FOR_ROWS,
        rows: pairs.length + 2 + ofDraft.length,
        queriesNotProven: 0,
        comparison: {
          rows: pairs.length + 2 + ofDraft.length,
          rowsNotAnalysed: apex,
          rowsNotMatched: 0,
          rowsNotHeld: 0,
          // The rows of the draft, also the one to the field only the draft reads, which is no error.
          rowsOtherVersion: ofDraft.length,
          // The rows of the active version are compared in the place of those the project has.
          rowsCompared: pairs.length - apex + 2,
          missed: [],
          onlyOrgLens: [],
        },
      });
      // The ids are kept with the snapshot, so that an analysis compares again without the org.
      expect(count(dir, 'SELECT count(*) AS n FROM snapshot_flow_version')).toBe(metadata.flowDefinitionRows().length);
      const again = await (await openWorkspace({ root: dir, env })).analyse('prod');
      expect(again.crossCheck).toEqual(report.crossCheck);

      // Asked in parts, the rows of the active version are asked for by the id the org named for it. The org cuts an
      // answer off at 20 rows, and the reader is given twice that: it takes an answer of half its limit as near it.
      dependencies.limit = 20;
      const parts = await snap(workspaceDir(), { tuning: { dependencies: { rowsPerQuery: 40 } } });
      expect(parts.crossCheck).toMatchObject({ state: 'whole', rows: pairs.length + 2 + ofDraft.length });
      expect(parts.crossCheck?.comparison).toEqual(report.crossCheck?.comparison);
      expect(
        dependencies.queries.some((soql) => soql.includes('MetadataComponentId IN (') && soql.includes(activeId)),
      ).toBe(true);
    });

    it('says when the org does not name the versions of its flows, and compares what the listed ids allow', async () => {
      const { ofActive, ofDraft } = await orgWithDraft();
      dependencies.refuse = (soql) => (soql.includes(` FROM ${FLOW_VERSION_OBJECT}`) ? 'INVALID_TYPE' : undefined);
      const report = await snap(workspaceDir());
      expect(report.snapshot.status).toBe('complete');
      expect(report.issues.filter((issue) => issue.code === 'FLOW_VERSIONS_NOT_READ')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'FLOW_VERSIONS_NOT_READ',
          message:
            'The org did not name the versions of its flows (INVALID_TYPE). A row of the Dependency API from the active version of a flow that has a newer version is not compared: the org does not list the id of that version.',
          component: null,
          details: {
            code: 'INVALID_TYPE',
            state: 'none',
            flows: 0,
            notNamed: metadata.flowDefinitionRows().length,
            requests: 1,
          },
        },
      ]);
      // The rows of the active version carry an id the org did not list. The rows of the draft carry the listed
      // one, and the snapshot holds the active version: neither is compared, and nothing is missed.
      // The query for the versions, which the org refused, counts as one request.
      expect(report.crossCheck).toMatchObject({
        state: 'whole',
        requests: 1 + QUERIES_FOR_ROWS,
        comparison: { rowsNotMatched: ofActive.length, rowsOtherVersion: ofDraft.length, missed: [] },
      });
      const only = report.crossCheck?.comparison?.onlyOrgLens ?? [];
      expect(only.length).toBeGreaterThan(0);
      expect(only.filter((pair) => pair.from !== `Flow:${FLOW_WITH_DRAFT.toLowerCase()}`)).toEqual([]);
      expect(report.analysis?.complete).toBe(true);

      // An org that holds no newer version of a flow has its rows compared by the listed ids all the same.
      metadata = await metadataFromSource(WHOLE);
      mock.metadata = metadata;
      dependencies = mockDependencies(rowsOf(metadata));
      dependencies.refuse = (soql) => (soql.includes(` FROM ${FLOW_VERSION_OBJECT}`) ? 'INVALID_TYPE' : undefined);
      mock.dependencies = dependencies;
      const plain = await snap(workspaceDir());
      expect(ofReading(plain)).toEqual(['warning FLOW_VERSIONS_NOT_READ']);
      expect(plain.crossCheck?.comparison).toMatchObject({
        rowsNotMatched: 0,
        rowsOtherVersion: 0,
        missed: [],
        onlyOrgLens: [],
      });
    });

    it('says when a whole answer leaves out a flow the org listed, and compares the rows of the others', async () => {
      const { ofActive, ofDraft } = await orgWithDraft();
      const others = metadata.flowDefinitionRows().filter((one) => one['DeveloperName'] !== FLOW_WITH_DRAFT);
      dependencies.flowDefinitions = others;
      const report = await snap(workspaceDir());
      expect(report.issues.filter((issue) => issue.code === 'FLOW_VERSIONS_NOT_READ')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'FLOW_VERSIONS_NOT_READ',
          message:
            'The org did not name the versions of 1 flow it listed. A row of the Dependency API from the active version of a flow that has a newer version is not compared: the org does not list the id of that version.',
          component: null,
          details: { code: null, state: 'whole', flows: others.length, notNamed: 1, requests: 1 },
        },
      ]);
      expect(report.crossCheck?.comparison).toMatchObject({
        rowsNotMatched: ofActive.length,
        rowsOtherVersion: ofDraft.length,
        missed: [],
      });
    });

    it('says when the answer of the versions breaks off, and compares by what it named', async () => {
      const { ofDraft } = await orgWithDraft();
      // The first page names the flow with the draft and one more. The org does not answer the second.
      const rows = metadata.flowDefinitionRows();
      const first = [
        ...rows.filter((one) => one['DeveloperName'] === FLOW_WITH_DRAFT),
        ...rows.filter((one) => one['DeveloperName'] !== FLOW_WITH_DRAFT).slice(0, 1),
      ];
      const next = '/services/data/v66.0/tooling/query/01gxx0000000001-2000';
      mock.intercept = (request) => {
        if (request.path.endsWith('/tooling/query') && (request.query.get('q') ?? '').includes(FLOW_VERSION_OBJECT)) {
          const records = first.map((one) => ({ attributes: { type: FLOW_VERSION_OBJECT }, ...one }));
          return { status: 200, body: JSON.stringify({ done: false, nextRecordsUrl: next, records }) };
        }
        if (request.path === next) {
          return { status: 400, body: JSON.stringify([{ message: 'Not now.', errorCode: 'QUERY_TIMEOUT' }]) };
        }
        return undefined;
      };
      const report = await snap(workspaceDir());
      expect(report.issues.filter((issue) => issue.code === 'FLOW_VERSIONS_NOT_READ')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'FLOW_VERSIONS_NOT_READ',
          message:
            'The org did not name the versions of all of its flows (QUERY_TIMEOUT). A row of the Dependency API from the active version of a flow that has a newer version is not compared: the org does not list the id of that version.',
          component: null,
          details: {
            code: 'QUERY_TIMEOUT',
            state: 'partial',
            flows: 2,
            notNamed: rows.length - 2,
            requests: 2,
          },
        },
      ]);
      // The flow with the draft was named: the rows of its active version are compared all the same.
      // The two pages of the versions, and the queries for rows.
      const ofRows = dependencies.queries.filter((soql) => soql.includes(` FROM ${DEPENDENCY_OBJECT}`)).length;
      expect(ofRows).toBe(QUERIES_FOR_ROWS);
      expect(report.crossCheck).toMatchObject({
        state: 'whole',
        requests: 2 + QUERIES_FOR_ROWS,
        comparison: { rowsNotMatched: 0, rowsOtherVersion: ofDraft.length, missed: [] },
      });
    });

    it('takes a flow under the name the org listed it with, where FlowDefinition writes it with a prefix', async () => {
      await orgWithDraft();
      const plain = await snap(workspaceDir());
      // The org gives the prefix of a package in a field of its own, and a listing need not write it.
      dependencies.flowDefinitions = metadata.flowDefinitionRows().map((one) => ({ ...one, NamespacePrefix: 'acme' }));
      const prefixed = await snap(workspaceDir());
      expect(ofReading(prefixed)).toEqual(['info FLOW_NEWER_VERSION']);
      expect(prefixed.crossCheck?.comparison).toMatchObject({ rowsNotHeld: 0, rowsNotMatched: 0, missed: [] });
      expect(prefixed.crossCheck?.comparison).toEqual(plain.crossCheck?.comparison);
    });

    it('shows a comparison an earlier version stored without the rows of another version as one it cannot read', async () => {
      const dir = workspaceDir();
      const report = await snap(dir);
      expect(report.crossCheck?.comparison).toMatchObject({ rowsOtherVersion: 0, missed: [] });
      // What a version before decision record 0067 stored: the same comparison, without that number.
      const store = openStore({ path: databaseOf(dir), driver });
      try {
        store.run("UPDATE snapshot_analysis SET cross_check = json_remove(cross_check, '$.rowsOtherVersion')");
      } finally {
        store.close();
      }
      const workspace = await openWorkspace({ root: dir, env });
      expect((await workspace.coverage('prod')).crossCheck).toEqual({ ...report.crossCheck, comparison: null });
      // `analyse` compares again from the rows the snapshot holds, and the comparison is back.
      expect((await workspace.analyse('prod')).crossCheck).toEqual(report.crossCheck);
    });

    it('takes the snapshot of an org without the Dependency API all the same, and says that nothing was compared', async () => {
      mock.dependencies = null;
      const dir = workspaceDir();
      const report = await snap(dir);
      expect(report.snapshot.status).toBe('complete');
      expect(report.analysis?.complete).toBe(true);
      expect(besidesKnownGap(report.issues)).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'CROSS_CHECK_NOT_READ',
          message:
            'The Dependency API of the org gave no answer (INVALID_TYPE). What the analysis of this snapshot finds is not held against what Salesforce knows.',
          component: null,
          // The org refused the query for the versions of its flows, then three queries for rows in a row from the
          // start, and was asked no further. That the versions were not named is not said as well.
          details: { code: 'INVALID_TYPE', requests: 4 },
        },
      ]);
      expect(report.crossCheck).toEqual({
        state: 'none',
        readAt: expect.stringMatching(UTC) as string,
        requests: 4,
        rows: 0,
        queriesCutOff: 0,
        queriesFailed: expect.any(Number) as number,
        queriesNotProven: 0,
        code: 'INVALID_TYPE',
        comparison: null,
      });
      // The analysis of such a snapshot is made again without a comparison as well.
      const again = await (await openWorkspace({ root: dir, env })).analyse('prod');
      expect(again.crossCheck).toEqual(report.crossCheck);
      expect(again.analysis?.complete).toBe(true);
    });

    it('takes the snapshot when the org stops answering the Dependency API, and when it loses the session there', async () => {
      // No answer to any query of the Tooling API.
      mock.intercept = (request) =>
        request.path.includes('/tooling/query') ? { status: 200, body: '{"records": [', halfway: 'stall' } : undefined;
      const stalled = await snap(workspaceDir(), {
        tuning: { dependencies: { requestMs: 150, repeats: 1, repeatAfterMs: 5 } },
      });
      expect(stalled.snapshot.status).toBe('complete');
      expect(ofReading(stalled)).toEqual(['warning CROSS_CHECK_NOT_READ']);
      // The query for the versions of the flows and three queries for rows in a row got no answer in time, each
      // asked once.
      expect(stalled.crossCheck).toMatchObject({ state: 'none', code: 'TIMEOUT', requests: 4, comparison: null });

      // The session ends between the retrieve and the query, and nothing renews it.
      mock.intercept = (request) =>
        request.path.includes('/tooling/query')
          ? {
              status: 401,
              body: JSON.stringify([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }]),
            }
          : undefined;
      const expired = await snap(workspaceDir());
      expect(expired.snapshot.status).toBe('complete');
      expect(expired.crossCheck).toMatchObject({ state: 'none', code: 'INVALID_SESSION_ID', comparison: null });
    });

    it('asks in parts where a query is at the limit, with the ids the org listed its components with', async () => {
      // A query of this org gives at most 20 rows. No component of the project has that many rows to one type. The
      // reader takes an answer that holds half its limit as near it (decision record 0069), so it is given twice as
      // many: an answer is near the limit where this org cut it off.
      const LIMIT = 20;
      dependencies.limit = LIMIT;
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { dependencies: { rowsPerQuery: 2 * LIMIT } } });
      const all = rowsOf(metadata).length;
      // Per type, per pair of types and per group of components every row was found: no query is left near the limit.
      expect(report.crossCheck).toMatchObject({
        state: 'whole',
        rows: all,
        queriesCutOff: 0,
        queriesFailed: 0,
        queriesNotProven: 0,
      });
      expect(ofReading(report)).toEqual([]);
      expect(report.crossCheck?.comparison).toMatchObject({ missed: [], rowsNotMatched: 0 });
      // The third level names components by the ids of the listing, and the org knows them.
      const perComponent = dependencies.queries.filter((soql) => soql.includes('MetadataComponentId IN ('));
      expect(perComponent.length).toBeGreaterThan(2);
      // One query names every component of a type here, so a last one asks for the rows of every other
      // component, and gives none: the org listed them all.
      expect(dependencies.queries.some((soql) => soql.includes('MetadataComponentId NOT IN ('))).toBe(true);
      expect(report.crossCheck?.requests).toBe(dependencies.queries.length);
      expect(dependencies.queries[0]).toContain(` FROM ${FLOW_VERSION_OBJECT}`);
      for (const soql of dependencies.queries.slice(1)) expect(soql).toContain(` FROM ${DEPENDENCY_OBJECT}`);

      // The same rows as one query gives of an org that has no limit.
      const store = openStore({ path: databaseOf(dir), driver, readOnly: true });
      const stored = readDependencyRows(store, 1);
      store.close();
      dependencies.limit = 2_000;
      const other = workspaceDir();
      await snap(other);
      const whole = openStore({ path: databaseOf(other), driver, readOnly: true });
      expect(stored).toEqual(readDependencyRows(whole, 1));
      whole.close();

      // Where a type has more components than one query names, the rows of a component the org did not list
      // cannot be asked for. The rows are the same, and the snapshot says what it cannot know.
      dependencies.limit = LIMIT;
      const many = workspaceDir();
      const unproven = await snap(many, { tuning: { dependencies: { rowsPerQuery: 2 * LIMIT, idsPerQuery: 8 } } });
      expect(unproven.crossCheck).toMatchObject({ state: 'partial', rows: all, queriesCutOff: 0, queriesFailed: 0 });
      const notProven = unproven.crossCheck?.queriesNotProven ?? 0;
      expect(notProven).toBeGreaterThan(0);
      expect(unproven.snapshot.status).toBe('complete');
      expect(unproven.issues.filter((issue) => issue.stage === 'read')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'CROSS_CHECK_PARTIAL',
          message: `${String(notProven)} ${notProven === 1 ? 'query' : 'queries'} near the limit of rows ${notProven === 1 ? 'was' : 'were'} asked again component by component. The rows of a component the org did not list may be missing. A reference that Salesforce knows and the analysis missed may go unseen.`,
          component: null,
          details: { cutOff: 0, failed: 0, unproven: notProven, code: null, rows: all },
        },
      ]);
    });

    it('says that rows are missing when a part cannot be asked for in smaller parts, and compares what it has', async () => {
      dependencies.limit = 12;
      // The org refuses to be asked for single components, so a pair of types at the limit stays cut off.
      dependencies.refuse = (soql) => (soql.includes('MetadataComponentId IN (') ? 'MALFORMED_QUERY' : undefined);
      const report = await snap(workspaceDir(), { tuning: { dependencies: { rowsPerQuery: 12 } } });
      expect(report.snapshot.status).toBe('complete');
      expect(report.crossCheck?.state).toBe('partial');
      expect(report.crossCheck?.rows).toBeLessThan(rowsOf(metadata).length);
      const left = (report.crossCheck?.queriesCutOff ?? 0) + (report.crossCheck?.queriesFailed ?? 0);
      expect(left).toBeGreaterThan(0);
      expect(report.issues.filter((issue) => issue.stage === 'read')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'CROSS_CHECK_PARTIAL',
          message: `${String(left)} ${left === 1 ? 'query' : 'queries'} of the Dependency API ${left === 1 ? 'was' : 'were'} cut off or failed. Rows are missing, or may be. A reference that Salesforce knows and the analysis missed may go unseen.`,
          component: null,
          details: {
            cutOff: report.crossCheck?.queriesCutOff,
            failed: report.crossCheck?.queriesFailed,
            unproven: 0,
            code: 'MALFORMED_QUERY',
            rows: report.crossCheck?.rows,
          },
        },
      ]);
      // The rows that came are compared. A reference of the analysis without a row says less now, and is still no issue.
      expect(report.crossCheck?.comparison).toMatchObject({ missed: [] });
      expect(report.crossCheck?.comparison?.onlyOrgLens.length).toBeGreaterThan(0);
      expect(report.analysis?.complete).toBe(true);
    });

    it('reads the versions of the flows and the rows within one limit of requests', async () => {
      dependencies.limit = 20;
      const report = await snap(workspaceDir(), { tuning: { dependencies: { rowsPerQuery: 20, requestsInAll: 3 } } });
      expect(report.snapshot.status).toBe('complete');
      // The query for the versions took one of the three requests, and the rows the two that were left.
      expect(report.crossCheck).toMatchObject({ state: 'partial', requests: 3, code: 'REQUESTS_USED_UP' });
      expect(dependencies.queries).toHaveLength(3);
      expect(dependencies.queries[0]).toContain(` FROM ${FLOW_VERSION_OBJECT}`);
      expect(ofReading(report)).toEqual(['warning CROSS_CHECK_PARTIAL']);
    });

    it('asks the API when a snapshot that was interrupted is continued, and not before', async () => {
      metadata.maxFiles = 1;
      const dir = workspaceDir();
      await expect(snap(dir, { tuning: { failuresInARow: 3 } })).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' });
      expect(dependencies.queries).toEqual([]);

      metadata.maxFiles = 10_000;
      const events: SnapshotProgress[] = [];
      const report = await snap(dir, { onProgress: (event) => events.push(event) });
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      // The step is told before the first request, and after every query for rows with how far it is. The query for
      // the versions of the flows counts with them.
      const told = events.filter((event) => event.step === 'cross-checking');
      const asked = dependencies.queries.length;
      expect(told).toEqual([
        { step: 'cross-checking', snapshot: 1, requests: 0, rows: 0 },
        ...Array.from({ length: asked - 1 }, (_, at) => ({
          step: 'cross-checking',
          snapshot: 1,
          requests: at + 2,
          rows: expect.any(Number) as number,
        })),
      ]);
      expect(told.at(-1)).toMatchObject({ requests: asked, rows: rowsOf(metadata).length });
      expect(events.at(-1)).toEqual({ step: 'analysing', snapshot: 1 });
      expect(report.crossCheck).toMatchObject({ state: 'whole', requests: asked, comparison: { missed: [] } });
    });

    it('replaces an earlier reading and its warning when a snapshot is continued, and keeps both without the cross-check', async () => {
      // A snapshot that was interrupted after the API was asked and before it ended: it holds a reading that
      // gave nothing, with the warning of that reading.
      const interrupted = async (): Promise<string> => {
        metadata.maxFiles = 1;
        const dir = workspaceDir();
        await expect(snap(dir, { tuning: { failuresInARow: 3 } })).rejects.toMatchObject({
          code: 'SOURCE_READ_FAILED',
        });
        metadata.maxFiles = 10_000;
        const store = openStore({ path: databaseOf(dir), driver });
        store.write(() => {
          writeDependencies(
            store,
            1,
            { rows: [], state: 'none', requests: 3, cutOff: 0, failed: 2, unproven: 0, code: 'INVALID_TYPE' },
            '2026-01-31T09:30:00.000Z',
          );
          addIssue(store, 1, {
            severity: 'warning',
            code: 'CROSS_CHECK_NOT_READ',
            message: 'The Dependency API of the org gave no answer (INVALID_TYPE).',
            componentKey: null,
            details: { code: 'INVALID_TYPE', requests: 3 },
          });
        });
        store.close();
        return dir;
      };

      // Continued, the snapshot asks again. What it says is about the reading it holds now.
      const again = await snap(await interrupted());
      expect(again.crossCheck).toMatchObject({ state: 'whole', rows: rowsOf(metadata).length });
      expect(ofReading(again).filter((issue) => issue.includes('CROSS_CHECK'))).toEqual([]);

      // Continued without the cross-check, the org is not asked, and what the snapshot had read stays.
      dependencies.queries.length = 0;
      const kept = await snap(await interrupted(), { crossCheck: false });
      expect(dependencies.queries).toEqual([]);
      expect(kept.crossCheck).toMatchObject({ state: 'none', code: 'INVALID_TYPE', comparison: null });
      expect(ofReading(kept).filter((issue) => issue.includes('CROSS_CHECK'))).toEqual([
        'warning CROSS_CHECK_NOT_READ',
      ]);
    });
  },
);
