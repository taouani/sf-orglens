/**
 * The descriptions of the objects of a snapshot of an org (decision records 0085 and 0086): the mock org describes
 * the objects of the fixture project through its REST API, and the snapshot keeps the descriptions.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot, type OrgSnapshotTuning, type SnapshotProgress } from '../src/api/org-snapshot.ts';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { objectsWithFiles, readDescriptions, writeDescriptions } from '../src/store/descriptions.ts';
import { openStore } from '../src/store/open.ts';
import { addIssue } from '../src/store/snapshots.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { fixtureDependencyRows } from './helpers/fixture-dependencies.ts';
import { mockDependencies } from './helpers/mock-dependencies.ts';
import { metadataFromSource, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const WHOLE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const ORG_ID = '00Dxx0000000001EAA';
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CONFIG = `schema_version = 1\n\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`;
/** The objects of the fixture project, of which a snapshot of the mock org holds a file. */
const OBJECTS = [
  'Account',
  'Billing_Rule__mdt',
  'Billing_Settings__c',
  'Invoice_Line__c',
  'Invoice_Paid__e',
  'Invoice__c',
  'Tax_Code__c',
  'User',
];
const DESCRIBE = /^GET \/services\/data\/v66\.0\/sobjects\/([^/]+)\/describe$/;

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

/** The objects the snapshot asked the org to describe, in the order of the requests. */
const described = (): string[] =>
  mock.asked().flatMap((request) => {
    const object = DESCRIBE.exec(request)?.[1];
    return object === undefined ? [] : [object];
  });
const ofReading = (report: CoverageReport): CoverageReport['issues'] =>
  report.issues.filter((issue) => issue.stage === 'read');

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'the descriptions of the objects of a snapshot of an org with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };
    const databaseOf = (dir: string): string => join(dir, '.orglens', 'orglens.db');

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

    function reading<T>(dir: string, work: (store: ReturnType<typeof openStore>) => T): T {
      const store = openStore({ path: databaseOf(dir), driver, readOnly: true });
      try {
        return work(store);
      } finally {
        store.close();
      }
    }

    it('asks the org to describe every object of which the snapshot holds a file, and keeps what the resolver reads', async () => {
      const dir = workspaceDir();
      const events: SnapshotProgress[] = [];
      // Each description takes a while, so that the time of the reading shows.
      mock.intercept = async (request) => {
        if (DESCRIBE.test(`${request.method} ${request.path}`)) await new Promise((resolve) => setTimeout(resolve, 25));
        return undefined;
      };
      const report = await snap(dir, { onProgress: (event) => events.push(event) });

      expect(report.snapshot.status).toBe('complete');
      expect(report.descriptions).toEqual({
        state: 'whole',
        startedAt: expect.stringMatching(UTC) as string,
        readAt: expect.stringMatching(UTC) as string,
        requests: 8,
        asked: 8,
        described: 8,
        unknown: 0,
        failed: 0,
        code: null,
      });
      expect(ofReading(report).filter((issue) => issue.code.startsWith('DESCRIPTIONS'))).toEqual([]);
      // The reading started after the snapshot and before it ended.
      const { startedAt, readAt } = report.descriptions ?? { startedAt: '', readAt: '' };
      expect(report.snapshot.startedAt <= startedAt).toBe(true);
      expect(Date.parse(readAt) - Date.parse(startedAt)).toBeGreaterThanOrEqual(25);
      expect(readAt <= (report.snapshot.finishedAt ?? '')).toBe(true);
      expect(described().sort()).toEqual(OBJECTS);
      // After the cross-check and before the analysis, once before the first request and after every object.
      const steps = events.map((event) => event.step);
      expect(steps.indexOf('describing')).toBeGreaterThan(steps.lastIndexOf('cross-checking'));
      expect(steps.lastIndexOf('describing')).toBeLessThan(steps.indexOf('analysing'));
      expect(
        events
          .filter((event) => event.step === 'describing')
          .map((event) => `${String(event.done)}/${String(event.total)}`),
      ).toEqual(Array.from({ length: 9 }, (_, done) => `${String(done)}/8`));

      reading(dir, (store) => {
        expect(objectsWithFiles(store, 1)).toEqual(OBJECTS);
        const kept = readDescriptions(store, 1);
        expect(kept.map((one) => one.name)).toEqual(OBJECTS);
        const invoice = kept.find((one) => one.name === 'Invoice__c');
        // A lookup with the object it points at and its relationship, a field that is none, and the child
        // relationship that the lookup of the line names. Labels and the values of picklists are not kept.
        expect(invoice?.fields.find((field) => field.name === 'Account__c')).toEqual({
          name: 'Account__c',
          type: 'reference',
          referenceTo: ['Account'],
          relationshipName: 'Account__r',
        });
        expect(invoice?.fields.find((field) => field.name === 'Amount__c')).toEqual({
          name: 'Amount__c',
          type: 'currency',
          referenceTo: [],
          relationshipName: null,
        });
        expect(invoice?.childRelationships).toEqual([
          { relationshipName: 'Lines__r', childSObject: 'Invoice_Line__c', field: 'Invoice__c' },
        ]);
        // What the store holds is what the reading kept, and nothing of the rest of an answer.
        const stored = store.all('SELECT description FROM snapshot_object_description WHERE snapshot_id = 1');
        expect(stored).toHaveLength(8);
        for (const row of stored) expect(String(row['description'])).not.toMatch(/label|picklistValues|cascadeDelete/);
      });
    });

    it('holds every request the snapshot makes: the Metadata API, the Tooling API and the descriptions of the objects it holds', async () => {
      const dir = workspaceDir();
      const report = await snap(dir);
      expect(report.snapshot.status).toBe('complete');
      const objects = reading(dir, (store) => objectsWithFiles(store, 1));
      // Every request but those of the login, which record 0031 names and `sources-logins.test.ts` pins. A request
      // of another form, or to describe an object the snapshot holds no file of, fails here.
      expect(new Set(mock.asked())).toEqual(
        new Set([
          // The check of the login (record 0031).
          'GET /services/data/v66.0/',
          'POST /services/Soap/m/66.0',
          'GET /services/data/v66.0/tooling/query',
          ...objects.map((object) => `GET /services/data/v66.0/sobjects/${object}/describe`),
        ]),
      );
      expect(
        mock.requests.every((request) => request.method === 'GET' || request.path.startsWith('/services/Soap/m/')),
      ).toBe(true);
    });

    it('asks for the descriptions also without the cross-check, and keeps them for an analysis without the org', async () => {
      const dir = workspaceDir();
      const report = await snap(dir, { crossCheck: false });
      expect(report.crossCheck).toBeNull();
      expect(report.descriptions).toMatchObject({ state: 'whole', asked: 8 });

      mock.requests.length = 0;
      const again = await (await openWorkspace({ root: dir, env })).analyse('prod');
      expect(mock.requests).toEqual([]);
      expect(again.descriptions).toEqual(report.descriptions);
      expect(reading(dir, (store) => readDescriptions(store, 1).map((one) => one.name))).toEqual(OBJECTS);
    });

    it('takes the snapshot all the same when the org does not know an object or describes none, and says so', async () => {
      metadata.descriptions.delete('Tax_Code__c');
      metadata.descriptions.delete('Invoice_Paid__e');
      const report = await snap(workspaceDir());
      expect(report.snapshot.status).toBe('complete');
      expect(report.analysis?.complete).toBe(true);
      expect(report.descriptions).toMatchObject({ state: 'partial', asked: 8, described: 6, unknown: 2, failed: 0 });
      expect(ofReading(report).filter((issue) => issue.code === 'DESCRIPTIONS_PARTIAL')).toEqual([
        {
          stage: 'read',
          severity: 'warning',
          code: 'DESCRIPTIONS_PARTIAL',
          message: 'The org did not describe 2 of the 8 objects the snapshot holds a file of: it does not know 2.',
          component: null,
          details: {
            asked: 8,
            unknown: 2,
            failed: 0,
            code: null,
            requests: 8,
            unknownObjects: ['Invoice_Paid__e', 'Tax_Code__c'],
            failedObjects: [],
          },
        },
      ]);

      // The org refuses one object, and then loses the session: the objects that are left are not asked for.
      mock.requests.length = 0;
      let answered = 0;
      mock.intercept = (request) => {
        if (!DESCRIBE.test(`${request.method} ${request.path}`)) return undefined;
        answered += 1;
        if (answered === 1) {
          return {
            status: 500,
            body: JSON.stringify([{ errorCode: 'UNKNOWN_EXCEPTION', message: 'Something broke.' }]),
          };
        }
        if (answered === 3) mock.sessions.clear();
        return undefined;
      };
      const stopped = await snap(workspaceDir(), { tuning: { descriptions: { parallel: 1 } } });
      expect(stopped.snapshot.status).toBe('complete');
      expect(stopped.descriptions).toMatchObject({
        state: 'partial',
        described: 1,
        unknown: 0,
        failed: 7,
        code: 'UNKNOWN_EXCEPTION',
      });
      expect(ofReading(stopped).find((issue) => issue.code === 'DESCRIPTIONS_PARTIAL')?.message).toBe(
        'The org did not describe 7 of the 8 objects the snapshot holds a file of: it gave no description of 7 (UNKNOWN_EXCEPTION).',
      );
      expect(described()).toHaveLength(3);
    });

    it('asks for an object of a package by the name the org lists it with', async () => {
      // The org lists the object and its field with the prefix of the package, and hands them out without it.
      metadata.packaged.set('CustomObject:Tax_Code__c', 'pkg');
      metadata.packaged.set('CustomField:Tax_Code__c.Rate__c', 'pkg');
      const report = await snap(workspaceDir());
      expect(report.descriptions).toMatchObject({ state: 'whole', asked: 8, described: 8 });
      expect(described()).toContain('pkg__Tax_Code__c');
      expect(described()).not.toContain('Tax_Code__c');
    });

    it('asks when a snapshot that was interrupted is continued, not before, and replaces an earlier reading and its warning', async () => {
      metadata.maxFiles = 1;
      const dir = workspaceDir();
      await expect(snap(dir, { tuning: { failuresInARow: 3 } })).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' });
      expect(described()).toEqual([]);

      // As if the snapshot had been interrupted after a reading that described nothing.
      const store = openStore({ path: databaseOf(dir), driver });
      store.write(() => {
        writeDescriptions(
          store,
          1,
          { descriptions: [], state: 'none', requests: 1, unknown: [], failed: ['Account'], code: 'TIMEOUT' },
          { startedAt: '2026-01-31T09:30:00.000Z', readAt: '2026-01-31T09:30:00.000Z' },
        );
        addIssue(store, 1, {
          severity: 'warning',
          code: 'DESCRIPTIONS_PARTIAL',
          message: 'The org did not describe 1 of the 1 object the snapshot holds a file of.',
          componentKey: null,
          details: { asked: 1, unknown: 0, failed: 1, code: 'TIMEOUT', requests: 1 },
        });
      });
      store.close();

      metadata.maxFiles = 10_000;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(report.descriptions).toMatchObject({ state: 'whole', asked: 8, described: 8 });
      expect(ofReading(report).filter((issue) => issue.code === 'DESCRIPTIONS_PARTIAL')).toEqual([]);
      expect(described().sort()).toEqual(OBJECTS);
    });
  },
);
