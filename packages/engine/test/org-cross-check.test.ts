/**
 * The cross-check of a snapshot of an org: the Dependency API of a mock org is read with the snapshot, and what
 * it reports is held against the analysis (decision record 0045).
 *
 * The mock org holds the fixture project. Its Dependency API reports what the answer key of the project, which
 * is written by hand, has for a formula, and what it has for Apex, which this phase does not analyse
 * (`helpers/fixture-dependencies.ts`).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot, type OrgSnapshotTuning, type SnapshotProgress } from '../src/api/org-snapshot.ts';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { DEPENDENCY_OBJECT } from '../src/sources/dependency-api.ts';
import { readDependencyRows, writeDependencies } from '../src/store/dependencies.ts';
import { openStore } from '../src/store/open.ts';
import { addIssue } from '../src/store/snapshots.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { fixtureDependencyRows, keyedPairs } from './helpers/fixture-dependencies.ts';
import { besidesKnownGap } from './helpers/known-gap.ts';
import { mockDependencies, type MockDependencies } from './helpers/mock-dependencies.ts';
import { metadataFromSource, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const WHOLE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const ORG_ID = '00Dxx0000000001EAA';
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CONFIG = `schema_version = 1\n\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`;

/** The rule whose formula the second org of these tests hands out without one of its names. */
const RULE = 'ValidationRule:invoice__c.tax_rate_matches_code';
const RULE_FILE = 'main/default/objects/Invoice__c/validationRules/Tax_Rate_Matches_Code.validationRule-meta.xml';
const TAKEN_OUT = 'CustomField:invoice__c.tax_code_name__c';

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

/** The requests for rows of the Dependency API, and every other request that is a query. */
const queryPaths = (): string[] => [
  ...new Set(mock.requests.filter((request) => request.path.includes('query')).map((request) => request.path)),
];
const ofReading = (report: CoverageReport): string[] =>
  report.issues.filter((issue) => issue.stage === 'read').map((issue) => `${issue.severity} ${issue.code}`);
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
      expect(report.crossCheck).toEqual({
        state: 'whole',
        readAt: expect.stringMatching(UTC) as string,
        // The org holds fewer rows than one query gives.
        requests: 1,
        rows: pairs.length + 3,
        queriesCutOff: 0,
        queriesFailed: 0,
        queriesNotProven: 0,
        code: null,
        comparison: {
          rows: pairs.length + 3,
          // The rows of Apex, which this phase does not analyse, and the row of the record of a custom metadata
          // type. Its type is counted as the metadata type, not under the name the API writes.
          rowsNotAnalysed: apex + 1,
          notAnalysed: [
            { type: 'ApexClass', rows: pairs.filter((pair) => pair.from[0] === 'ApexClass').length },
            { type: 'ApexTrigger', rows: pairs.filter((pair) => pair.from[0] === 'ApexTrigger').length },
            { type: 'CustomMetadata', rows: 1 },
          ],
          // Every end of a row is a component the org listed, found by its id.
          rowsNotMatched: 0,
          rowsNotHeld: 0,
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
      // What the analysis has and the API never reports is counted by its reason, and is no issue. The mock org
      // reports every formula, also the one of a rule that is not active and the one in a default value. Of the
      // workflow rules, it reports what the test org reports: the custom fields the formula of a field update
      // reads.
      const reasons = report.crossCheck?.comparison?.notReported.map((one) => one.reason);
      expect(reasons).toEqual([
        'controlling-field',
        'field-update',
        'lookup',
        'lookup-filter',
        'roll-up-summary',
        'standard-field',
        'standard-object',
        'value-set',
        'workflow-action',
        'workflow-rule',
      ]);

      // Only metadata is read: one object of the Tooling API is queried, and nothing else is.
      expect(dependencies.queries).toHaveLength(1);
      for (const soql of dependencies.queries)
        expect(soql).toMatch(new RegExp(` FROM ${DEPENDENCY_OBJECT}(?: WHERE |$)`));
      expect(DEPENDENCY_OBJECT).toBe('MetadataComponentDependency');
      expect(queryPaths()).toEqual(['/services/data/v66.0/tooling/query']);

      // The rows are kept as Salesforce wrote them, and none of them became a reference.
      expect(count(dir, 'SELECT count(*) AS n FROM snapshot_dependency')).toBe(pairs.length + 3);
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
          // The org refused three queries in a row from the start, and was asked no further.
          details: { code: 'INVALID_TYPE', requests: 3 },
        },
      ]);
      expect(report.crossCheck).toEqual({
        state: 'none',
        readAt: expect.stringMatching(UTC) as string,
        requests: 3,
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
      // Three queries in a row got no answer in time, each asked once.
      expect(stalled.crossCheck).toMatchObject({ state: 'none', code: 'TIMEOUT', requests: 3, comparison: null });

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
      // A query of this org gives at most 20 rows. No component of the project has that many rows to one type.
      const LIMIT = 20;
      dependencies.limit = LIMIT;
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { dependencies: { rowsPerQuery: LIMIT } } });
      const all = rowsOf(metadata).length;
      // Per type, per pair of types and per group of components every row was found: no query is left at the limit.
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
      for (const soql of dependencies.queries) expect(soql).toContain(` FROM ${DEPENDENCY_OBJECT}`);

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
      const unproven = await snap(many, { tuning: { dependencies: { rowsPerQuery: LIMIT, idsPerQuery: 8 } } });
      expect(unproven.crossCheck).toMatchObject({ state: 'partial', rows: all, queriesCutOff: 0, queriesFailed: 0 });
      const notProven = unproven.crossCheck?.queriesNotProven ?? 0;
      expect(notProven).toBeGreaterThan(0);
      expect(unproven.snapshot.status).toBe('complete');
      expect(unproven.issues.filter((issue) => issue.stage === 'read')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'CROSS_CHECK_PARTIAL',
          message: `${String(notProven)} ${notProven === 1 ? 'query' : 'queries'} at the limit of rows ${notProven === 1 ? 'was' : 'were'} asked again component by component. The rows of a component the org did not list may be missing. A reference that Salesforce knows and the analysis missed may go unseen.`,
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
          message: `${String(left)} ${left === 1 ? 'query' : 'queries'} of the Dependency API ${left === 1 ? 'was' : 'were'} cut off at its limit of rows or failed. Rows are missing. A reference that Salesforce knows and the analysis missed may go unseen.`,
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

    it('asks the API when a snapshot that was interrupted is continued, and not before', async () => {
      metadata.maxFiles = 1;
      const dir = workspaceDir();
      await expect(snap(dir, { tuning: { failuresInARow: 3 } })).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' });
      expect(dependencies.queries).toEqual([]);

      metadata.maxFiles = 10_000;
      const events: SnapshotProgress[] = [];
      const report = await snap(dir, { onProgress: (event) => events.push(event) });
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      // The step is told before the first request, and after every query with how far it is.
      expect(events.slice(-3)).toEqual([
        { step: 'cross-checking', snapshot: 1, requests: 0, rows: 0 },
        { step: 'cross-checking', snapshot: 1, requests: 1, rows: rowsOf(metadata).length },
        { step: 'analysing', snapshot: 1 },
      ]);
      expect(dependencies.queries).toHaveLength(1);
      expect(report.crossCheck).toMatchObject({ state: 'whole', requests: 1, comparison: { missed: [] } });
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
