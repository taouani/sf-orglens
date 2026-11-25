/**
 * The components of a managed package installed in an org (decision record 0076). The mock org holds the fixture
 * project and lists the flows that a test puts into a package with the prefix of the package and the state
 * `installed`, as an org does. It hands them out without the prefix, and its Dependency API reports them by the
 * ids it lists them with.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { fixtureDependencyRows, keyedPairs } from './helpers/fixture-dependencies.ts';
import { mockDependencies } from './helpers/mock-dependencies.ts';
import { metadataFromSource, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const WHOLE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const ORG_ID = '00Dxx0000000001EAA';
const CONFIG = `schema_version = 1\n\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`;
/** A flow that reads `Account.Credit_Limit__c`, and that the other flow calls. */
const RECALCULATE = 'Invoice_Recalculate';
/** The flow that calls it, and reads `Invoice__c.Amount__c`. The one warning of the analysis is about it. */
const AFTER_SAVE = 'Invoice_After_Save';

const dirs = tempDirs();
let mock: MockOrg;
let metadata: MockMetadata;

beforeAll(async () => {
  mock = await startMockOrg();
});
afterAll(async () => {
  await mock.close();
});
beforeEach(async () => {
  metadata = await metadataFromSource(WHOLE);
  mock.metadata = metadata;
  mock.dependencies = mockDependencies(fixtureDependencyRows(metadata));
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
  mock.dependencies = null;
  await forgetCliLogins();
  dirs.cleanUp();
});

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'the components of a managed package in a snapshot of an org, with %s',
  (driverName) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };

    /** A snapshot of the mock org, with these flows in the package `pkg`. */
    async function snapshotWith(flows: readonly string[]): Promise<{ workspace: Workspace; report: CoverageReport }> {
      for (const flow of flows) metadata.packaged.set(`Flow:${flow}`, 'pkg');
      const dir = dirs.next();
      writeFileSync(join(dir, 'orglens.toml'), CONFIG);
      const workspace = await openWorkspace({ root: dir, env });
      return { workspace, report: await workspace.snapshot('prod') };
    }

    it('knows a flow of a package that came back without its prefix, and matches its rows of the Dependency API', async () => {
      const { report } = await snapshotWith([RECALCULATE]);
      expect(report.snapshot.status).toBe('complete');
      expect(report.issues.map((issue) => issue.code)).toContain('RETRIEVED_WITHOUT_PREFIX');
      expect(report.types.filter((type) => type.packaged > 0).map(({ type, packaged }) => [type, packaged])).toEqual([
        ['Flow', 1],
      ]);
      // Every row is matched to a component the snapshot holds, also a row from or to the flow of the package,
      // and the analysis has every pair it has without the package.
      const pairs = keyedPairs();
      expect(pairs.filter((pair) => pair.from[0] === 'Flow' && pair.from[1] === RECALCULATE).length).toBeGreaterThan(3);
      expect(report.crossCheck?.comparison).toMatchObject({
        rowsNotMatched: 0,
        rowsNotHeld: 0,
        rowsOtherVersion: 0,
        agreed: pairs.filter((pair) => !pair.apex).length,
        missed: [],
      });
    });

    it('leaves a flow of a package out of what refers to a field, counts it, and goes on through it', async () => {
      const { workspace } = await snapshotWith([RECALCULATE]);
      const answer = await workspace.impact('prod', 'Account.Credit_Limit__c');
      const all = await workspace.impact('prod', 'Account.Credit_Limit__c', { packages: true });

      expect(all.packagesLeftOut).toBe(0);
      expect(all.results.filter((result) => result.package !== null).map(({ key, package: of }) => [key, of])).toEqual([
        ['Flow:invoice_recalculate', 'pkg'],
        ['Flow:invoice_recalculate#element:compare_totals', 'pkg'],
      ]);
      expect(answer.packagesLeftOut).toBe(2);
      expect(answer.results).toEqual(all.results.filter((result) => result.package === null));
      // What calls the flow of the package is of the answer, by its reference to that flow.
      expect(answer.results.find((result) => result.key === 'Flow:invoice_after_save')).toMatchObject({
        depth: 2,
        package: null,
        reference: { to: 'Flow:invoice_recalculate' },
      });
      expect(answer.component.package).toBeNull();
      // What the answer does not cover is reckoned with what it left out.
      expect({ ...answer, results: [], packagesLeftOut: 0 }).toEqual({ ...all, results: [] });
    });

    it('counts a warning of a component of a package that it leaves out', async () => {
      const { workspace } = await snapshotWith([AFTER_SAVE]);
      const answer = await workspace.impact('prod', 'Invoice__c.Amount__c');
      const all = await workspace.impact('prod', 'Invoice__c.Amount__c', { packages: true });

      const ofPackage = all.results.filter((result) => result.package === 'pkg').map((result) => result.key);
      expect(ofPackage).toEqual([
        'Flow:invoice_after_save',
        'Flow:invoice_after_save#element:amount_changed',
        'Flow:invoice_after_save#element:check_result',
        'Flow:invoice_after_save#element:recalculate',
      ]);
      expect(answer.packagesLeftOut).toBe(ofPackage.length);
      expect(answer.results.map((result) => result.key)).not.toContain('Flow:invoice_after_save');
      // The analysis did not follow a path of an element of the flow, which can lead to the field.
      expect(answer.notCovered.analysisWarnings).toBe(1);
      expect(answer.complete).toBe(false);
      expect(answer.notCovered).toEqual(all.notCovered);
    });

    it('answers for a component of a package as for any other, and keeps what of the org refers to it', async () => {
      const { workspace } = await snapshotWith([RECALCULATE]);
      // The org holds the definition of the flow under its name too, so the flow is asked about by its type.
      const answer = await workspace.impact('prod', `Flow:${RECALCULATE}`);
      expect(answer.component).toMatchObject({ key: 'Flow:invoice_recalculate', package: 'pkg' });
      expect(answer.results.map(({ key, package: of }) => [key, of])).toEqual([
        ['Flow:invoice_after_save', null],
        ['Flow:invoice_after_save#element:recalculate', null],
      ]);
      expect(answer.packagesLeftOut).toBe(0);
      // An element is of the package of its flow.
      const element = await workspace.impact('prod', `${RECALCULATE}.Set_Amount`);
      expect(element.component).toMatchObject({ key: 'Flow:invoice_recalculate#element:set_amount', package: 'pkg' });
      expect(element.elementOf).toBe('Flow:invoice_recalculate');
    });

    it('takes a component of a package that the org does not hand out for a warning, and its own for an error', async () => {
      metadata.withheld.add(`Flow:${RECALCULATE}`);
      const { workspace, report } = await snapshotWith([RECALCULATE]);
      const notRetrieved = (of: CoverageReport): unknown[] =>
        of.issues
          .filter((issue) => issue.code === 'NOT_RETRIEVED')
          .map(({ severity, message, details }) => ({ severity, message, details }));
      // The snapshot is complete: Salesforce does not hand out a protected component of a package (decision
      // record 0076).
      expect(report.snapshot.status).toBe('complete');
      expect(notRetrieved(report)).toEqual([
        {
          severity: 'warning',
          message:
            '1 component of the type Flow that the org listed as of a managed package installed in it did not come back. Salesforce does not hand out a protected component of a package, so the snapshot is not partial for it. The first: pkg__Invoice_Recalculate',
          details: {
            type: 'Flow',
            count: 1,
            components: ['pkg__Invoice_Recalculate'],
            tier: 'logic',
            ofPackages: true,
          },
        },
      ]);
      const flows = report.types.find((type) => type.type === 'Flow');
      expect(flows).toMatchObject({ packaged: 1, retrieved: (flows?.listed ?? 0) - 1 });

      // An answer that leaves the components of packages out misses nothing for it, and one that keeps them may.
      const answer = await workspace.impact('prod', 'Account.Credit_Limit__c');
      expect(answer.notCovered.partial).toEqual([]);
      expect(answer.mayMiss).toBe(false);
      const all = await workspace.impact('prod', 'Account.Credit_Limit__c', { packages: true });
      expect(all.notCovered.partial).toEqual([
        { type: 'Flow', listed: flows?.listed, retrieved: flows?.retrieved, listing: 'ok' },
      ]);
      expect(all.mayMiss).toBe(true);
      // As a target, it is a component the snapshot does not hold.
      const outgoing = await workspace.impact('prod', `Flow:${AFTER_SAVE}`, { outgoing: true });
      expect(outgoing.notCovered.partial).toEqual([]);
      expect(outgoing.notCovered.notHeld).toBeGreaterThan(0);
      expect(outgoing.mayMiss).toBe(false);

      // A flow of the org's own that does not come back makes the snapshot partial, as before.
      metadata.withheld.add('Flow:Invoice_Before_Save');
      const second = await snapshotWith([]);
      expect(second.report.snapshot.status).toBe('partial');
      expect(notRetrieved(second.report)).toEqual([
        {
          severity: 'error',
          message: '1 component of the type Flow that the org listed did not come back. The first: Invoice_Before_Save',
          details: { type: 'Flow', count: 1, components: ['Invoice_Before_Save'], tier: 'logic' },
        },
        {
          severity: 'warning',
          message: expect.stringContaining('managed package') as string,
          details: {
            type: 'Flow',
            count: 1,
            components: ['pkg__Invoice_Recalculate'],
            tier: 'logic',
            ofPackages: true,
          },
        },
      ]);
    });

    it('leaves nothing out of what a component refers to', async () => {
      const { workspace } = await snapshotWith([RECALCULATE]);
      const answer = await workspace.impact('prod', `Flow:${AFTER_SAVE}`, { outgoing: true });
      expect(await workspace.impact('prod', `Flow:${AFTER_SAVE}`, { outgoing: true, packages: true })).toEqual(answer);
      expect(answer.packagesLeftOut).toBe(0);
      expect(answer.results.find((result) => result.key === 'Flow:invoice_recalculate')).toMatchObject({
        depth: 1,
        package: 'pkg',
      });
      // What the flow of the package refers to is a target as well.
      expect(answer.results.find((result) => result.key === 'CustomField:account.credit_limit__c')).toMatchObject({
        depth: 2,
        package: null,
      });
    });
  },
);
