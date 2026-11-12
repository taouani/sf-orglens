/**
 * Snapshots of an org, against a mock org on this machine that holds the
 * fixture project (`helpers/mock-org.ts`, `helpers/mock-metadata.ts`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot, type OrgSnapshotTuning, type SnapshotProgress } from '../src/api/org-snapshot.ts';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { readLocalSource } from '../src/sources/local.ts';
import { getBlob } from '../src/store/blobs.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { metadataFromSource, soapFault, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const FIXTURE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const ORG_ID = '00Dxx0000000001EAA';
const OTHER_ORG_ID = '00Dxx0000000002EAA';
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

const CONFIG = `schema_version = 1

[sources.prod]
kind = "org"
org_id = "${ORG_ID}"
`;

const dirs = tempDirs();
let mock: MockOrg;
let metadata: MockMetadata;
/** The files of the fixture project as a repository holds them, without the package directory. */
let fixtureFiles: string[];

beforeAll(async () => {
  mock = await startMockOrg();
  const reading = await readLocalSource(FIXTURES_DIR, {
    kind: 'git',
    name: 'fixture',
    description: null,
    repo: 'billing-sfdx',
    ref: null,
    paths: ['force-app'],
    tracks: null,
  });
  fixtureFiles = reading.tree.files.map((path) => path.replace('force-app/main/default/', ''));
});
afterAll(async () => {
  await mock.close();
});
beforeEach(async () => {
  metadata = await metadataFromSource(FIXTURE);
  mock.metadata = metadata;
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
  mock.refreshTokens.clear();
  mock.versions.splice(0, Infinity, '65.0', '66.0', '9.0');
  mock.key = null;
  mock.intercept = null;
  mock.stall = false;
  await forgetCliLogins();
  dirs.cleanUp();
});

/** What an org snapshot of the fixture holds: its files, and the file of the standard object it has fields of. */
const expectedFiles = (): string[] => [...fixtureFiles, 'objects/Account/Account.object-meta.xml'].sort();

async function failure(
  run: () => Promise<unknown>,
): Promise<{ code: string; message: string; hint?: string; details?: Record<string, unknown> }> {
  try {
    await run();
  } catch (error) {
    return (error as { toJSON: () => { code: string; message: string } }).toJSON();
  }
  throw new Error('did not throw');
}

/** A workspace that declares the mock org as `prod`. */
function workspaceDir(config = CONFIG): string {
  const dir = dirs.next();
  writeFileSync(join(dir, 'orglens.toml'), config);
  return dir;
}

const databaseOf = (dir: string): string => join(dir, '.orglens', 'orglens.db');
const lockOf = (dir: string): string => join(dir, '.orglens', 'snapshot-prod.lock');
const workFolderOf = (dir: string): string => join(dir, '.orglens', 'tmp', 'snapshot-prod');

/** The job a request asks about, if it asks about one. */
const jobOf = (body: string): string | undefined => /<asyncProcessId>([^<]+)<\/asyncProcessId>/.exec(body)?.[1];

/** The operations the Metadata API of the mock org was asked for, without the listings. */
const operations = (): string[] =>
  metadata.calls
    .filter((call) => call.operation !== 'listMetadata' && call.operation !== 'describeMetadata')
    .map((call) =>
      call.operation === 'checkRetrieveStatus'
        ? `${call.about === 'zip' ? 'zip' : 'state'} ${call.job ?? ''}`
        : `retrieve ${call.job ?? ''}`,
    );

const codes = (report: CoverageReport): string[] => report.issues.map((issue) => `${issue.severity} ${issue.code}`);
const typeOf = (report: CoverageReport, type: string): CoverageReport['types'][number] | undefined =>
  report.types.find((one) => one.type === type);

/** Every file below a folder, relative to it, with forward slashes. */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path).map((inner) => `${name}/${inner}`) : [name];
  });

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'a snapshot of an org with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };

    /** Takes a snapshot the way the workspace does, with pauses a test can afford and the numbers it sets. */
    async function snap(
      dir: string,
      options: {
        restart?: boolean;
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
        restart: options.restart,
        onProgress: options.onProgress,
        tuning: { pollFirstMs: 5, ...options.tuning },
      });
    }

    function reading<T>(dir: string, work: (store: Store) => T): T {
      const store = openStore({ path: databaseOf(dir), driver, readOnly: true });
      try {
        return work(store);
      } finally {
        store.close();
      }
    }

    /** The paths of the files a snapshot holds. */
    const stored = (dir: string, snapshot: number): string[] =>
      reading(dir, (store) =>
        store
          .all('SELECT path FROM snapshot_file WHERE snapshot_id = ? ORDER BY path', snapshot)
          .map((row) => String(row['path'])),
      );

    const content = (dir: string, snapshot: number, path: string): Buffer =>
      reading(dir, (store) => {
        const row = store.get('SELECT blob_id FROM snapshot_file WHERE snapshot_id = ? AND path = ?', snapshot, path);
        return Buffer.from(getBlob(store, Number(row?.['blob_id'])));
      });

    const chunks = (dir: string, snapshot: number): string[] =>
      reading(dir, (store) =>
        store
          .all('SELECT seq, status, job_id, attempts FROM retrieve_chunk WHERE snapshot_id = ? ORDER BY seq', snapshot)
          .map(
            (row) =>
              `${String(row['seq'])} ${String(row['status'])} ${row['job_id'] === null ? '-' : 'job'} ${String(row['attempts'])}`,
          ),
      );

    it('stores the files of every component the org lists, in the form a repository holds them', async () => {
      const dir = workspaceDir();
      const workspace = await openWorkspace({ root: dir, env });
      const events: SnapshotProgress[] = [];
      const report = await workspace.snapshot('prod', { onProgress: (event) => events.push(event) });

      expect(report.snapshot).toMatchObject({
        id: 1,
        source: 'prod',
        kind: 'org',
        status: 'complete',
        apiVersion: '66.0',
        commit: null,
        files: expectedFiles().length,
      });
      expect(report.snapshot.startedAt).toMatch(UTC);
      expect(report.snapshot.finishedAt).toMatch(UTC);
      expect(report.issues).toEqual([]);
      expect(report.types.filter((type) => type.listed > 0)).toEqual([
        { type: 'ApexClass', listed: 12, retrieved: 12, analysed: 0, listing: 'ok', note: null },
        { type: 'ApexTrigger', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null },
        { type: 'CustomField', listed: 31, retrieved: 31, analysed: 0, listing: 'ok', note: null },
        { type: 'CustomObject', listed: 3, retrieved: 3, analysed: 0, listing: 'ok', note: null },
        { type: 'ValidationRule', listed: 6, retrieved: 6, analysed: 0, listing: 'ok', note: null },
      ]);
      // A type the org describes and has nothing of is in the report as well: it was asked for.
      expect(typeOf(report, 'RecordType')).toEqual({
        type: 'RecordType',
        listed: 0,
        retrieved: 0,
        analysed: 0,
        listing: 'ok',
        note: null,
      });

      // The same files as a snapshot of the folder, and the same content for what Salesforce does not rewrite.
      expect(stored(dir, 1)).toEqual(expectedFiles());
      for (const path of fixtureFiles.filter((one) => /\.(?:cls|trigger)$/.test(one))) {
        expect(content(dir, 1, path).equals(readFileSync(join(FIXTURE, 'main/default', path))), path).toBe(true);
      }

      expect(events[0]).toEqual({ step: 'connected', apiVersion: '66.0' });
      expect(events.filter((event) => event.step === 'listing').length).toBeGreaterThan(5);
      expect(events.slice(-2)).toEqual([
        { step: 'planned', snapshot: 1, components: 53, chunks: 1 },
        { step: 'retrieved', snapshot: 1, done: 1, chunks: 1 },
      ]);
      // One retrieve of every component by its name, asked for until it was done, and its zip file fetched once.
      expect(metadata.retrieves).toHaveLength(1);
      expect(metadata.retrieves[0]).toContain('CustomObject:Account');
      expect(metadata.retrieves[0]).not.toContain('CustomField:Account.Billing_Tier__c');
      expect(operations().filter((one) => one.startsWith('zip'))).toHaveLength(1);

      reading(dir, (store) => {
        expect(store.get('SELECT api_version, git_commit FROM snapshot WHERE id = 1')).toEqual({
          api_version: '66.0',
          git_commit: null,
        });
        expect(store.get("SELECT org_id FROM source WHERE name = 'prod'")).toEqual({ org_id: ORG_ID });
        expect(
          store.get(
            `SELECT COUNT(*) AS items, SUM(listed) AS listed, SUM(retrieved) AS retrieved,
                  SUM(salesforce_id IS NOT NULL) AS ids, SUM(last_modified_at IS NOT NULL) AS dates
             FROM inventory_item WHERE snapshot_id = 1`,
          ),
        ).toEqual({ items: 53, listed: 53, retrieved: 53, ids: 53, dates: 53 });
      });
      expect(chunks(dir, 1)).toEqual(['0 done - 1']);
      // Nothing is left of the work: not the lock, and not the folder the files were converted in.
      expect(walk(join(dir, '.orglens')).filter((file) => !/^(?:orglens\.db|logs\/|\.gitignore$)/.test(file))).toEqual(
        [],
      );

      expect((await workspace.status()).sources).toEqual([
        expect.objectContaining({
          name: 'prod',
          snapshots: 1,
          latestSnapshot: expect.objectContaining({ id: 1, status: 'complete' }) as unknown,
          unfinishedSnapshot: null,
        }),
      ]);
      expect(await workspace.coverage('prod')).toEqual(report);
    });

    it('splits a retrieve that Salesforce refuses as too large, until every half goes through', async () => {
      metadata.maxFiles = 10;
      const dir = workspaceDir();
      const events: SnapshotProgress[] = [];
      const report = await snap(dir, { onProgress: (event) => events.push(event) });

      expect(report.snapshot.status).toBe('complete');
      expect(stored(dir, 1)).toEqual(expectedFiles());
      // 16 members in 29 files: the whole fails, its first half fails, and so does its second half.
      expect(metadata.retrieves.map((members) => members.length)).toEqual([16, 8, 4, 8, 4, 4, 4]);
      expect(codes(report)).toEqual(['info CHUNK_SPLIT', 'info CHUNK_SPLIT', 'info CHUNK_SPLIT']);
      expect(report.issues[0]).toEqual({
        severity: 'info',
        code: 'CHUNK_SPLIT',
        message:
          'A retrieve of 16 components failed and was tried again in two halves. LIMIT_EXCEEDED: Too many files in retrieve call, limit is 10.',
        details: { members: 16, said: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is 10.' },
      });
      expect(chunks(dir, 1)).toEqual(['0 done - 1', '1 done - 1', '2 done - 1', '3 done - 1']);
      expect(
        events
          .filter((event) => event.step === 'retrieved')
          .map((event) => `${String(event.done)}/${String(event.chunks)}`),
      ).toEqual(['0/2', '0/3', '1/3', '1/4', '2/4', '3/4', '4/4']);
      // No component is in two retrieves that succeeded.
      const succeeded = metadata.retrieves.filter((members) => members.length === 4).flat();
      expect(new Set(succeeded).size).toBe(16);
    });

    it('names a component Salesforce cannot hand out, stores everything else, and calls the snapshot partial', async () => {
      // A class is two files, so no class and no trigger can be retrieved, and each object can.
      metadata.maxFiles = 1;
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { failuresInARow: 100 } });

      expect(report.snapshot.status).toBe('partial');
      expect(stored(dir, 1)).toEqual(expectedFiles().filter((path) => path.startsWith('objects/')));
      expect(typeOf(report, 'ApexClass')).toMatchObject({ listed: 12, retrieved: 0 });
      expect(typeOf(report, 'CustomField')).toMatchObject({ listed: 31, retrieved: 31 });
      const failed = report.issues.filter((issue) => issue.code === 'RETRIEVE_FAILED');
      expect(failed).toHaveLength(13);
      expect(failed[0]).toEqual({
        severity: 'error',
        code: 'RETRIEVE_FAILED',
        message:
          'Salesforce did not hand out ApexClass DynamicAccess. LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1.',
        details: {
          count: 1,
          components: ['ApexClass DynamicAccess'],
          said: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1.',
        },
      });
      const missing = report.issues.filter((issue) => issue.code === 'NOT_RETRIEVED');
      expect(missing.map((issue) => [issue.details['type'], issue.details['count']])).toEqual([
        ['ApexClass', 12],
        ['ApexTrigger', 1],
      ]);
      expect(missing[1]?.message).toBe(
        '1 component of the type ApexTrigger that the org listed did not come back. The first: InvoiceTrigger',
      );
      expect(
        reading(dir, (store) => store.get("SELECT COUNT(*) AS failed FROM retrieve_chunk WHERE status = 'failed'")),
      ).toEqual({
        failed: 13,
      });
    });

    it('stops when Salesforce fails one retrieve after the other, and goes on when it is run again', async () => {
      metadata.maxFiles = 1;
      const dir = workspaceDir();
      const stoppedWith = await failure(() => snap(dir, { tuning: { failuresInARow: 3 } }));
      expect(stoppedWith).toEqual({
        code: 'SOURCE_READ_FAILED',
        message:
          '3 retrieves in a row from the org of the source "prod" failed. The last: LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1.',
        hint: 'Run the command again: snapshot #1 is picked up where it stopped. With --restart it is given up and a new one is taken.',
        details: {
          reason: 'RETRIEVES_FAILING',
          source: 'prod',
          said: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1.',
          snapshot: 1,
        },
      });
      expect(metadata.retrieves).toHaveLength(3);
      expect(existsSync(lockOf(dir))).toBe(false);

      metadata.maxFiles = 10_000;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(codes(report)).toEqual([
        'info CHUNK_SPLIT',
        'info CHUNK_SPLIT',
        'info CHUNK_SPLIT',
        'info SNAPSHOT_RESUMED',
      ]);
    });

    it('records a type the org refuses to list as failed, never as empty, and calls the snapshot partial', async () => {
      metadata.failing.add('ApexClass');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('partial');
      expect(typeOf(report, 'ApexClass')).toEqual({
        type: 'ApexClass',
        listed: 0,
        retrieved: 0,
        analysed: 0,
        listing: 'failed',
        note: 'INVALID_TYPE: Cannot use: ApexClass in this organization',
      });
      expect(report.issues).toEqual([
        {
          severity: 'error',
          code: 'LISTING_FAILED',
          message:
            'The org did not say which components of the type ApexClass it has. INVALID_TYPE: Cannot use: ApexClass in this organization',
          details: { type: 'ApexClass' },
        },
      ]);
      expect(stored(dir, 1)).toEqual(expectedFiles().filter((path) => !path.startsWith('classes/')));
    });

    it('names a component the org lists and does not hand out, with what Salesforce said about it', async () => {
      metadata.withheld.add('ApexClass:InvoiceService');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('partial');
      expect(typeOf(report, 'ApexClass')).toMatchObject({ listed: 12, retrieved: 11 });
      expect(report.issues).toEqual([
        {
          severity: 'warning',
          code: 'RETRIEVE_MESSAGES',
          message:
            "Salesforce made 1 remark about a retrieve. The first: Entity of type 'ApexClass' named 'InvoiceService' cannot be found",
          details: { count: 1, messages: ["Entity of type 'ApexClass' named 'InvoiceService' cannot be found"] },
        },
        {
          severity: 'error',
          code: 'NOT_RETRIEVED',
          message: '1 component of the type ApexClass that the org listed did not come back. The first: InvoiceService',
          details: { type: 'ApexClass', count: 1, components: ['InvoiceService'] },
        },
      ]);
      expect(stored(dir, 1)).toEqual(expectedFiles().filter((path) => !path.startsWith('classes/InvoiceService.')));
    });

    it('retrieves a parent the org does not list for the sake of its parts, and says that it came back unlisted', async () => {
      metadata.unlistedParents.add('CustomObject:Account');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('complete');
      expect(metadata.retrieves[0]).toContain('CustomObject:Account');
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(typeOf(report, 'CustomObject')).toEqual({
        type: 'CustomObject',
        listed: 2,
        retrieved: 2,
        analysed: 0,
        listing: 'ok',
        note: '1 component more came back that the org had not listed.',
      });
      expect(report.issues).toEqual([
        {
          severity: 'info',
          code: 'UNLISTED_COMPONENTS',
          message:
            '1 component of the type CustomObject came back that the org had not listed. It is in the snapshot. The first: Account',
          details: { type: 'CustomObject', count: 1, components: ['Account'] },
        },
      ]);
      expect(
        reading(dir, (store) =>
          store.get(
            "SELECT listed, retrieved, salesforce_id FROM inventory_item WHERE type = 'CustomObject' AND full_name = 'Account'",
          ),
        ),
      ).toEqual({ listed: 0, retrieved: 1, salesforce_id: null });
    });

    it('stores a file that comes back in two retrieves as it came last, and names it', async () => {
      // An org that hands out the trigger with every retrieve, whether it was asked for or not.
      const extra = '<types><members>InvoiceTrigger</members><name>ApexTrigger</name></types>';
      mock.intercept = (request) =>
        request.body.includes('<retrieve>')
          ? metadata.answer(request.body.replace('<types>', `${extra}<types>`))
          : undefined;
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { chunkWeight: 20 } });

      expect(metadata.retrieves.length).toBeGreaterThan(1);
      expect(report.snapshot.status).toBe('complete');
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(report.issues).toEqual(
        metadata.retrieves.slice(1).map(() => ({
          severity: 'warning',
          code: 'FILE_RETRIEVED_TWICE',
          message: '2 files came back in two retrieves. The snapshot holds what came last.',
          details: { count: 2, paths: ['triggers/InvoiceTrigger.trigger', 'triggers/InvoiceTrigger.trigger-meta.xml'] },
        })),
      );
      expect(typeOf(report, 'ApexTrigger')).toMatchObject({ listed: 1, retrieved: 1 });
    });

    it('says which types are not read at all, and asks for what lies in folders folder by folder', async () => {
      metadata.emptyTypes.push('StandardValueSet', 'Report');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('complete');
      expect(typeOf(report, 'StandardValueSet')).toEqual({
        type: 'StandardValueSet',
        listed: 0,
        retrieved: 0,
        analysed: 0,
        listing: 'unlistable',
        note: 'Salesforce does not list standard value sets. They are not read yet.',
      });
      expect(report.issues).toEqual([
        {
          severity: 'warning',
          code: 'TYPE_NOT_READ',
          message:
            'Components of the type StandardValueSet are not in the snapshot. Salesforce does not list standard value sets. They are not read yet.',
          details: { type: 'StandardValueSet' },
        },
      ]);
      const listings = metadata.calls.filter((call) => call.operation === 'listMetadata').map((call) => call.about);
      expect(listings).toContain('ReportFolder');
      expect(listings).toContain('Report/unfiled$public');
      expect(listings).not.toContain('Report');
      expect(listings).not.toContain('StandardValueSet');
      expect(typeOf(report, 'ReportFolder')).toMatchObject({ listed: 0, listing: 'ok' });
    });

    it('keeps a snapshot whose login expired on the way, and continues it without asking twice for what it has', async () => {
      metadata.maxFiles = 10;
      const dir = workspaceDir();
      // The session ends when the fourth retrieve is started: one chunk is stored by then.
      mock.intercept = (request) => {
        if (request.body.includes('<retrieve>') && metadata.retrieves.length === 3) mock.sessions.clear();
        return undefined;
      };
      const expired = await failure(() => snap(dir));
      expect(expired).toMatchObject({
        code: 'LOGIN_FAILED',
        message: 'The org of the source "prod" no longer accepts the login, and it could not be renewed.',
        hint: 'Log in again. Run the command again: snapshot #1 is picked up where it stopped. With --restart it is given up and a new one is taken.',
        details: { reason: 'SESSION_EXPIRED', source: 'prod', snapshot: 1 },
      });
      expect(chunks(dir, 1)).toEqual(['0 done - 1', '1 pending - 0', '2 pending - 0']);
      expect(existsSync(lockOf(dir))).toBe(false);

      // What is known while it is interrupted: no finished snapshot, and one that the next run continues.
      const workspace = await openWorkspace({ root: dir, env });
      expect((await workspace.status()).sources[0]).toMatchObject({
        snapshots: 0,
        latestSnapshot: null,
        unfinishedSnapshot: { id: 1, chunksDone: 1, chunks: 3 },
      });
      expect((await failure(() => workspace.coverage('prod'))).code).toBe('SNAPSHOT_NOT_FOUND');
      const half = await workspace.coverage('prod', { snapshot: 1 });
      expect(half.snapshot).toMatchObject({ status: 'running', finishedAt: null, files: 8 });
      expect(typeOf(half, 'ApexClass')).toMatchObject({ listed: 12, retrieved: 4 });

      mock.intercept = null;
      mock.sessions.add('valid-session');
      const before = metadata.calls.length;
      const events: SnapshotProgress[] = [];
      const report = await snap(dir, { onProgress: (event) => events.push(event) });
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(events.slice(0, 2)).toEqual([
        { step: 'connected', apiVersion: '66.0' },
        { step: 'resumed', snapshot: 1, done: 1, chunks: 3 },
      ]);
      // The org is not asked again what it holds, and the chunk that is stored is not retrieved again.
      const after = metadata.calls.slice(before);
      expect(
        after.filter((call) => call.operation === 'describeMetadata' || call.operation === 'listMetadata'),
      ).toEqual([]);
      expect(metadata.retrieves.slice(3).map((members) => members.length)).toEqual([8, 4, 4, 4]);
      expect(report.issues.find((issue) => issue.code === 'SNAPSHOT_RESUMED')).toMatchObject({
        severity: 'info',
        details: { chunksDone: 1, chunks: 3 },
      });
      expect((await workspace.status()).sources[0]).toMatchObject({ snapshots: 1, unfinishedSnapshot: null });
    });

    it('asks for the job it had started when a retrieve took too long, and starts no second one', async () => {
      metadata.hold = true;
      const dir = workspaceDir();
      const slow = await failure(() => snap(dir, { tuning: { jobMs: 40 } }));
      expect(slow).toMatchObject({
        code: 'SOURCE_READ_FAILED',
        message: 'A retrieve from the org of the source "prod" did not end within 0 minutes.',
        details: { reason: 'RETRIEVE_TOO_SLOW', source: 'prod', snapshot: 1 },
      });
      expect(chunks(dir, 1)).toEqual(['0 running job 1']);

      metadata.hold = false;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(metadata.retrieves).toHaveLength(1);
      expect(chunks(dir, 1)).toEqual(['0 done - 1']);
    });

    it('starts a retrieve again when Salesforce no longer knows its job, and gives the chunk up after three times', async () => {
      const dir = workspaceDir();
      // The org forgets the first job as soon as it is asked about it.
      mock.intercept = (request) => {
        const job = /<asyncProcessId>([^<]+)<\/asyncProcessId>/.exec(request.body)?.[1];
        if (job !== undefined && metadata.retrieves.length === 1) metadata.forgotten.add(job);
        return undefined;
      };
      const report = await snap(dir);
      expect(report.snapshot.status).toBe('complete');
      expect(metadata.retrieves).toHaveLength(2);
      expect(chunks(dir, 1)).toEqual(['0 done - 2']);

      // An org that forgets every job.
      mock.intercept = (request) => {
        const job = /<asyncProcessId>([^<]+)<\/asyncProcessId>/.exec(request.body)?.[1];
        if (job !== undefined) metadata.forgotten.add(job);
        return undefined;
      };
      const second = await snap(dir);
      expect(second.snapshot).toMatchObject({ id: 2, status: 'partial', files: 0 });
      expect(metadata.retrieves).toHaveLength(5);
      expect(chunks(dir, 2)).toEqual(['0 failed - 3']);
      expect(second.issues[0]).toMatchObject({
        severity: 'error',
        code: 'RETRIEVE_FAILED',
        message:
          'Salesforce did not hand out 16 components. The retrieve was started 3 times and gave no result. Salesforce no longer knows the retrieve.',
      });
      expect(second.issues.filter((issue) => issue.code === 'NOT_RETRIEVED')).toHaveLength(5);
    });

    it('reports a request the org refuses with the code of Salesforce, and takes no snapshot when the org says nothing about itself', async () => {
      const dir = workspaceDir();
      mock.intercept = (request) =>
        request.body.includes('<describeMetadata>')
          ? soapFault(
              'INSUFFICIENT_ACCESS',
              'use of the Metadata API requires a user with the ModifyMetadata permission',
            )
          : undefined;
      expect(await failure(() => snap(dir))).toEqual({
        code: 'SOURCE_READ_FAILED',
        message:
          'The org of the source "prod" refused a request for its metadata. INSUFFICIENT_ACCESS: use of the Metadata API requires a user with the ModifyMetadata permission',
        details: { reason: 'REQUEST_REFUSED', source: 'prod', code: 'INSUFFICIENT_ACCESS' },
      });
      expect(reading(dir, (store) => store.get('SELECT COUNT(*) AS snapshots FROM snapshot'))).toEqual({
        snapshots: 0,
      });
      expect(reading(dir, (store) => store.get('SELECT COUNT(*) AS sources FROM source'))).toEqual({ sources: 0 });
    });

    it('reports an org that stops answering as unreachable, and continues the snapshot later', async () => {
      const dir = workspaceDir();
      mock.intercept = (request) => {
        if (request.body.includes('<retrieve>')) mock.stall = true;
        return undefined;
      };
      const gone = await failure(() =>
        snap(dir, { tuning: { requests: { requestMs: 100, zipMs: 100, repeats: 1, repeatAfterMs: 5 } } }),
      );
      expect(gone).toMatchObject({
        code: 'LOGIN_FAILED',
        message: 'The org of the source "prod" did not answer in time.',
        details: { reason: 'ORG_UNREACHABLE', source: 'prod', network: 'TIMEOUT', snapshot: 1 },
      });
      mock.intercept = null;
      mock.stall = false;
      expect((await snap(dir)).snapshot).toMatchObject({ id: 1, status: 'complete' });
    });

    it('gives up an interrupted snapshot when it is told to restart, and takes a new one', async () => {
      metadata.hold = true;
      const dir = workspaceDir();
      await failure(() => snap(dir, { tuning: { jobMs: 20 } }));
      metadata.hold = false;

      const report = await snap(dir, { restart: true });
      expect(report.snapshot).toMatchObject({ id: 2, status: 'complete' });
      expect(report.issues).toEqual([]);
      expect(metadata.retrieves).toHaveLength(2);
      const workspace = await openWorkspace({ root: dir, env });
      const givenUp = await workspace.coverage('prod', { snapshot: 1 });
      expect(givenUp.snapshot.status).toBe('failed');
      expect(givenUp.snapshot.finishedAt).toMatch(UTC);
      expect(givenUp.issues).toEqual([
        {
          severity: 'info',
          code: 'SNAPSHOT_GIVEN_UP',
          message: 'The snapshot was interrupted and was given up, because a new one was asked for with --restart.',
          details: { engineVersion: givenUp.snapshot.engineVersion },
        },
      ]);
      expect((await workspace.status()).sources[0]).toMatchObject({
        snapshots: 1,
        latestSnapshot: { id: 2 },
        unfinishedSnapshot: null,
      });
      // With nothing to give up, a restart is a snapshot like any other.
      expect((await snap(dir, { restart: true })).snapshot).toMatchObject({ id: 3, status: 'complete' });
    });

    it('does not continue a snapshot that another version of OrgLens began', async () => {
      metadata.hold = true;
      const dir = workspaceDir();
      await failure(() => snap(dir, { tuning: { jobMs: 20 } }));
      metadata.hold = false;
      const store = openStore({ path: databaseOf(dir), driver });
      store.run("UPDATE snapshot SET engine_version = '0.0.0-older' WHERE id = 1");
      store.close();

      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 2, status: 'complete' });
      const workspace = await openWorkspace({ root: dir, env });
      const givenUp = await workspace.coverage('prod', { snapshot: 1 });
      expect(givenUp.snapshot.status).toBe('failed');
      expect(givenUp.issues[0]?.message).toBe(
        'The snapshot was interrupted and was given up, because it was begun by another version of OrgLens (0.0.0-older).',
      );
    });

    it('refuses a second snapshot of the source while one is taken, and takes over the lock of a process that is gone', async () => {
      const dir = workspaceDir();
      mkdirSync(join(dir, '.orglens'), { recursive: true });
      // The process that runs the tests is alive and is not this one.
      writeFileSync(lockOf(dir), `${String(process.ppid)}\n`);
      expect(await failure(() => snap(dir))).toEqual({
        code: 'SNAPSHOT_RUNNING',
        message: 'Another process is taking a snapshot of the source "prod".',
        hint: `Wait for it to end. If no other OrgLens command is running, delete ${lockOf(dir)}.`,
        details: { source: 'prod' },
      });
      expect(readFileSync(lockOf(dir), 'utf8')).toBe(`${String(process.ppid)}\n`);
      expect(metadata.calls).toEqual([]);

      // A process that has ended.
      const gone = spawnSync(process.execPath, ['-e', '']).pid;
      writeFileSync(lockOf(dir), `${String(gone)}\n`);
      expect((await snap(dir)).snapshot.status).toBe('complete');
      expect(existsSync(lockOf(dir))).toBe(false);

      // Two at the same moment in one process: one of them is refused.
      const both = await Promise.allSettled([snap(dir), snap(dir)]);
      expect(both.map((one) => one.status).sort()).toEqual(['fulfilled', 'rejected']);
      const refused = both.find((one) => one.status === 'rejected');
      expect((refused?.reason as { code?: string }).code).toBe('SNAPSHOT_RUNNING');
      expect(existsSync(lockOf(dir))).toBe(false);
    });

    it('goes on counting failures in a row from zero after a retrieve that worked', async () => {
      // The whole fails, its first half fails, a quarter works: never three failures in a row.
      metadata.maxFiles = 10;
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { failuresInARow: 3 } });
      expect(report.snapshot.status).toBe('complete');
      expect(stored(dir, 1)).toEqual(expectedFiles());
    });

    it('handles a start that Salesforce refuses like a retrieve that failed, and does not ask without end', async () => {
      const dir = workspaceDir();
      // Also with the code Salesforce has for a job it does not know.
      mock.intercept = (request) =>
        request.body.includes('<retrieve>')
          ? soapFault('INVALID_CROSS_REFERENCE_KEY', 'invalid cross reference id')
          : undefined;
      const refused = await failure(() => snap(dir, { tuning: { failuresInARow: 3, pollMaxMs: 5 } }));
      expect(refused).toMatchObject({
        code: 'SOURCE_READ_FAILED',
        message:
          '3 retrieves in a row from the org of the source "prod" failed. The last: Salesforce did not start the retrieve. INVALID_CROSS_REFERENCE_KEY: invalid cross reference id',
        details: { reason: 'RETRIEVES_FAILING', snapshot: 1 },
      });
      // Each start was asked for three times before the refusal was taken for one of the retrieve.
      expect(mock.requests.filter((request) => request.body.includes('<retrieve>'))).toHaveLength(9);
      // Each failure halved the chunk: the journal went forward, and no job was noted.
      expect(chunks(dir, 1)).toEqual(['0 pending - 0', '1 pending - 0', '2 pending - 0', '3 pending - 0']);

      // The org starts retrieves again: the snapshot is continued and loses nothing.
      mock.intercept = null;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(stored(dir, 1)).toEqual(expectedFiles());

      // An org that is busy for a moment: the start is asked for again, and nothing is halved.
      const busy = workspaceDir();
      let starts = 0;
      mock.intercept = (request) => {
        if (!request.body.includes('<retrieve>')) return undefined;
        starts += 1;
        return starts < 3 ? soapFault('UNKNOWN_EXCEPTION', 'The org is busy') : undefined;
      };
      const later = await snap(busy, { tuning: { pollMaxMs: 5 } });
      expect(later.snapshot.status).toBe('complete');
      expect(later.issues).toEqual([]);
      expect(chunks(busy, 1)).toEqual(['0 done - 1']);
    });

    it('stops at once when the org refuses for a reason that holds for the whole org', async () => {
      const limit = (): ReturnType<typeof soapFault> =>
        soapFault('REQUEST_LIMIT_EXCEEDED', 'TotalRequests Limit exceeded.');
      const expected = {
        code: 'SOURCE_READ_FAILED',
        message:
          'The org of the source "prod" refused a request for its metadata. REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded.',
      };

      // While it lists: no snapshot is stored, and nothing is taken for a type that failed.
      const listing = workspaceDir();
      let listings = 0;
      mock.intercept = (request) => {
        if (!request.body.includes('<listMetadata>')) return undefined;
        listings += 1;
        return listings > 3 ? limit() : undefined;
      };
      expect(await failure(() => snap(listing))).toMatchObject({
        ...expected,
        details: { reason: 'REQUEST_REFUSED', source: 'prod', code: 'REQUEST_LIMIT_EXCEEDED' },
      });
      expect(reading(listing, (store) => store.get('SELECT COUNT(*) AS snapshots FROM snapshot'))).toEqual({
        snapshots: 0,
      });

      // While it retrieves: the snapshot stays as it is and is continued later.
      const retrieving = workspaceDir();
      mock.intercept = (request) => (request.body.includes('<retrieve>') ? limit() : undefined);
      expect(await failure(() => snap(retrieving))).toMatchObject({
        ...expected,
        details: { reason: 'REQUEST_REFUSED', code: 'REQUEST_LIMIT_EXCEEDED', snapshot: 1 },
      });
      expect(chunks(retrieving, 1)).toEqual(['0 pending - 0']);
      mock.intercept = (request) => (jobOf(request.body) === undefined ? undefined : limit());
      expect(await failure(() => snap(retrieving))).toMatchObject(expected);
      expect(chunks(retrieving, 1)).toEqual(['0 running job 1']);

      mock.intercept = null;
      const report = await snap(retrieving);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(metadata.retrieves).toHaveLength(1);
    });

    it('starts a retrieve again when the org refuses to say how far it is, and gives the chunk up after three starts', async () => {
      const dir = workspaceDir();
      mock.intercept = (request) =>
        jobOf(request.body) === undefined
          ? undefined
          : soapFault('UNKNOWN_EXCEPTION', 'An unexpected error occurred. Please include this ErrorId: 123-456');
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'partial', files: 0 });
      expect(metadata.retrieves).toHaveLength(3);
      expect(chunks(dir, 1)).toEqual(['0 failed - 3']);
      expect(report.issues[0]).toMatchObject({
        severity: 'error',
        code: 'RETRIEVE_FAILED',
        message:
          'Salesforce did not hand out 16 components. The retrieve was started 3 times and gave no result. Salesforce did not say how far the retrieve is. UNKNOWN_EXCEPTION: An unexpected error occurred. Please include this ErrorId: 123-456',
      });
    });

    it('does not wait for ever for a retrieve that never ends: it is started again, and given up after three starts', async () => {
      metadata.hold = true;
      const dir = workspaceDir();
      const tuning = { jobMs: 30 };
      const slow = { code: 'SOURCE_READ_FAILED', details: { reason: 'RETRIEVE_TOO_SLOW' } };
      // The job of this run is waited for, and kept for the next run.
      expect(await failure(() => snap(dir, { tuning }))).toMatchObject(slow);
      expect(chunks(dir, 1)).toEqual(['0 running job 1']);
      // The job of an earlier run that still does not end is given up, and a new one is started and waited for.
      expect(await failure(() => snap(dir, { tuning }))).toMatchObject(slow);
      expect(chunks(dir, 1)).toEqual(['0 running job 2']);
      expect(await failure(() => snap(dir, { tuning }))).toMatchObject(slow);
      expect(chunks(dir, 1)).toEqual(['0 running job 3']);
      // After three starts the chunk is given up, and the snapshot ends.
      const report = await snap(dir, { tuning });
      expect(report.snapshot).toMatchObject({ id: 1, status: 'partial' });
      expect(metadata.retrieves).toHaveLength(3);
      expect(report.issues.find((issue) => issue.code === 'RETRIEVE_FAILED')?.message).toBe(
        'Salesforce did not hand out 16 components. The retrieve was started 3 times and gave no result. The retrieve did not end within 0 minutes, also after the snapshot was continued.',
      );
    });

    it('handles something that is not a zip file like a retrieve that failed, and is not blocked by it', async () => {
      const dir = workspaceDir();
      let zips = 0;
      const held = metadata;
      mock.intercept = async (request) => {
        if (!request.body.includes('<includeZip>true</includeZip>')) return undefined;
        zips += 1;
        const real = await held.answer(request.body);
        const broken = Buffer.from('this is no zip file').toString('base64');
        return zips === 1
          ? { ...real, body: real.body.replace(/<zipFile>[^<]*<\/zipFile>/, `<zipFile>${broken}</zipFile>`) }
          : real;
      };
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(report.issues).toEqual([
        {
          severity: 'info',
          code: 'CHUNK_SPLIT',
          message:
            'A retrieve of 16 components failed and was tried again in two halves. What Salesforce handed out could not be read. It is not a zip file that can be read.',
          details: {
            members: 16,
            said: 'What Salesforce handed out could not be read. It is not a zip file that can be read.',
          },
        },
      ]);
    });

    it('survives a connection that is cut in the middle of the zip file, and stops cleanly when every answer is cut', async () => {
      const dir = workspaceDir();
      let zips = 0;
      const held = metadata;
      let always = false;
      mock.intercept = async (request) => {
        if (!request.body.includes('<includeZip>true</includeZip>')) return undefined;
        zips += 1;
        return zips === 1 || always ? { ...(await held.answer(request.body)), halfway: 'cut' } : undefined;
      };
      const requests = { requestMs: 2_000, zipMs: 2_000, repeats: 1, repeatAfterMs: 5 };
      // Once: the request is made again, and the snapshot is whole.
      const report = await snap(dir, { tuning: { requests } });
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(report.issues).toEqual([]);
      expect(zips).toBe(2);

      // Every time: the snapshot stops, says that the org cannot be reached, and can be continued.
      always = true;
      const cut = await failure(() => snap(dir, { tuning: { requests } }));
      expect(cut).toMatchObject({ code: 'LOGIN_FAILED', details: { reason: 'ORG_UNREACHABLE', snapshot: 2 } });
      expect(chunks(dir, 2)).toEqual(['0 running job 1']);
      always = false;
      expect((await snap(dir)).snapshot).toMatchObject({ id: 2, status: 'complete' });
      expect(metadata.retrieves).toHaveLength(2);
    });

    it('goes on after the library has renewed a session that expired on the way', async () => {
      await forgetCliLogins();
      mock.refreshTokens.add('the-refresh-token');
      await seedCliLogin({
        username: 'zoe@example.com',
        alias: 'main',
        orgId: ORG_ID,
        instanceUrl: mock.url,
        accessToken: 'valid-session',
        refreshToken: 'the-refresh-token',
      });
      metadata.maxFiles = 10;
      const dir = workspaceDir();
      // The session ends when the fourth retrieve is started.
      let ended = false;
      mock.intercept = (request) => {
        if (!ended && request.body.includes('<retrieve>') && metadata.retrieves.length === 3) {
          ended = true;
          mock.sessions.delete('valid-session');
        }
        return undefined;
      };
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(mock.asked()).toContain('POST /services/oauth2/token');
      expect(codes(report)).toEqual(['info CHUNK_SPLIT', 'info CHUNK_SPLIT', 'info CHUNK_SPLIT']);
    });

    it('continues a snapshot with the API version it was begun with, also when the org has a newer one by now', async () => {
      metadata.hold = true;
      const dir = workspaceDir();
      await failure(() => snap(dir, { tuning: { jobMs: 20 } }));
      metadata.hold = false;
      mock.versions.push('67.0');
      mock.requests.length = 0;

      const events: SnapshotProgress[] = [];
      const report = await snap(dir, { onProgress: (event) => events.push(event) });
      expect(events[0]).toEqual({ step: 'connected', apiVersion: '67.0' });
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete', apiVersion: '66.0' });
      const asked = mock.requests.filter((request) => request.path.startsWith('/services/Soap/'));
      expect(asked.length).toBeGreaterThan(0);
      expect(new Set(asked.map((request) => request.path))).toEqual(new Set(['/services/Soap/m/66.0']));

      // A new snapshot is of the newer version.
      mock.requests.length = 0;
      expect((await snap(dir)).snapshot).toMatchObject({ id: 2, apiVersion: '67.0' });
      expect(mock.requests.some((request) => request.path === '/services/Soap/m/67.0')).toBe(true);
    });

    it('says that profiles and permission sets hold only a part of the access settings', async () => {
      const project = dirs.next();
      const folder = join(project, 'main', 'default');
      mkdirSync(join(folder, 'permissionsets'), { recursive: true });
      mkdirSync(join(folder, 'classes'), { recursive: true });
      writeFileSync(
        join(folder, 'permissionsets', 'Billing.permissionset-meta.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">\n    <label>Billing</label>\n    <hasActivationRequired>false</hasActivationRequired>\n</PermissionSet>\n',
      );
      writeFileSync(join(folder, 'classes', 'Plain.cls'), 'public class Plain {}\n');
      writeFileSync(
        join(folder, 'classes', 'Plain.cls-meta.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>66.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n',
      );
      metadata = await metadataFromSource(project);
      mock.metadata = metadata;

      const report = await snap(workspaceDir());
      // A warning: the snapshot is complete in what the org listed, and still not all there is to know.
      expect(report.snapshot.status).toBe('complete');
      expect(report.issues).toEqual([
        {
          severity: 'warning',
          code: 'ACCESS_INCOMPLETE',
          message:
            'Components of the type PermissionSet hold only a part of the access settings: Salesforce hands such a component out with the access to the components of the same retrieve, and the org is retrieved in chunks. Reading access completely is not built yet.',
          details: { types: ['PermissionSet'] },
        },
      ]);
      expect(typeOf(report, 'PermissionSet')).toMatchObject({
        listed: 1,
        retrieved: 1,
        note: 'Holds only a part of the access settings.',
      });
      expect(typeOf(report, 'ApexClass')?.note).toBeNull();
    });

    it('names a file Salesforce hands out that is no metadata it knows, and calls the snapshot partial', async () => {
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      const dir = workspaceDir();
      const report = await snap(dir);
      expect(report.snapshot.status).toBe('partial');
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(report.issues).toEqual([
        {
          severity: 'error',
          code: 'RESOLVE_FAILED',
          message:
            'mysteries/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known.',
          details: { at: 'mysteries/Thing.mystery' },
        },
      ]);
    });

    it('leaves the work folder of a snapshot that runs alone when it is refused the lock', async () => {
      const dir = workspaceDir();
      mkdirSync(workFolderOf(dir), { recursive: true });
      // The process that runs the tests is alive and is not this one: it stands for the snapshot that runs.
      writeFileSync(lockOf(dir), `${String(process.ppid)}\n`);
      writeFileSync(join(workFolderOf(dir), 'of-the-other-process'), 'in use');
      expect((await failure(() => snap(dir))).code).toBe('SNAPSHOT_RUNNING');
      expect(readFileSync(join(workFolderOf(dir), 'of-the-other-process'), 'utf8')).toBe('in use');

      // The same for a second snapshot in this process.
      rmSync(lockOf(dir));
      let seen: string[] | undefined;
      let second: Promise<{ code: string }> | undefined;
      mock.intercept = (request) => {
        if (request.body.includes('<includeZip>true</includeZip>') && second === undefined) {
          mkdirSync(workFolderOf(dir), { recursive: true });
          writeFileSync(join(workFolderOf(dir), 'marker'), 'in use');
          second = failure(() => snap(dir)).then((refused) => {
            seen = readdirSync(workFolderOf(dir));
            return refused;
          });
          return second.then(() => undefined);
        }
        return undefined;
      };
      expect((await snap(dir)).snapshot.status).toBe('complete');
      expect((await second)?.code).toBe('SNAPSHOT_RUNNING');
      expect(seen).toContain('marker');
      // The one that held the lock tidied up at its end.
      expect(existsSync(workFolderOf(dir))).toBe(false);
    });

    it('takes the lock inside a write transaction of the database, and removes only a lock of its own', async () => {
      const dir = workspaceDir();
      expect((await snap(dir)).snapshot.status).toBe('complete');

      // Another process is in a write transaction, and the lock file is left from a process that is gone.
      const gone = spawnSync(process.execPath, ['-e', '']).pid;
      writeFileSync(lockOf(dir), `${String(gone)}\n`);
      const holder = driver.open(databaseOf(dir), { readOnly: false, busyTimeoutMs: 50 });
      holder.exec('BEGIN IMMEDIATE');
      try {
        const workspace = await openWorkspace({ root: dir, env });
        const source = (await workspace.sources.list()).find((one) => one.name === 'prod') as OrgSource;
        const busy = await failure(() =>
          takeOrgSnapshot({
            paths: workspacePaths(dir),
            source,
            linked: undefined,
            env,
            openStore: () => openStore({ path: databaseOf(dir), driver, busyTimeoutMs: 50 }),
          }),
        );
        expect(busy.code).toBe('STORE_BUSY');
      } finally {
        holder.exec('ROLLBACK');
        holder.close();
      }
      // The lock was not looked at and not taken: the file is as it was.
      expect(readFileSync(lockOf(dir), 'utf8')).toBe(`${String(gone)}\n`);

      // While this snapshot runs, its lock file is deleted by hand and another process takes the lock.
      mock.intercept = (request) => {
        if (request.body.includes('<retrieve>')) writeFileSync(lockOf(dir), `${String(process.ppid)}\n`);
        return undefined;
      };
      expect((await snap(dir)).snapshot.status).toBe('complete');
      expect(readFileSync(lockOf(dir), 'utf8')).toBe(`${String(process.ppid)}\n`);
    });

    it('ties the name of a source to the org of its first snapshot', async () => {
      const other = await startMockOrg({ orgId: OTHER_ORG_ID });
      try {
        other.metadata = await metadataFromSource(FIXTURE);
        other.sessions.add('other-session');
        await seedCliLogin({
          username: 'yan@example.com',
          alias: 'other',
          orgId: OTHER_ORG_ID,
          instanceUrl: other.url,
          accessToken: 'other-session',
        });
        // The source declares no org, so the login alone says which org is read.
        const dir = workspaceDir('schema_version = 1\n[sources.prod]\nkind = "org"\n');
        const workspace = await openWorkspace({ root: dir, env });
        await workspace.sources.link('prod', 'main');
        expect((await (await openWorkspace({ root: dir, env })).snapshot('prod')).snapshot.status).toBe('complete');

        await workspace.sources.link('prod', 'other');
        const linked = await openWorkspace({ root: dir, env });
        expect(await failure(() => linked.snapshot('prod'))).toEqual({
          code: 'ORG_MISMATCH',
          message: `The database holds snapshots of the source "prod" from the org ${ORG_ID}, and the login belongs to the org ${OTHER_ORG_ID}.`,
          hint: 'Snapshots of two orgs under one name would be compared as if they were one org. Give the other org a source of its own in orglens.toml.',
          details: { source: 'prod', declared: ORG_ID, found: OTHER_ORG_ID },
        });
        expect(other.metadata.calls).toEqual([]);
      } finally {
        await other.close();
      }
    });
  },
);

describe('a snapshot of an org in a process of its own', () => {
  const helper = fileURLToPath(new URL('./helpers/take-snapshot.ts', import.meta.url));

  /** Starts the helper. It must not block this process, which is where the mock org answers. */
  const start = (
    args: string[],
    environment: Record<string, string | undefined>,
    script = helper,
  ): {
    pid: number | undefined;
    kill: () => void;
    done: Promise<{ stdout: string; stderr: string; code: number | null }>;
  } => {
    const child = spawn(process.execPath, [script, ...args], { env: environment });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    return {
      pid: child.pid,
      kill: () => child.kill('SIGKILL'),
      done: new Promise((resolve) => {
        child.on('close', (code) => {
          resolve({ stdout, stderr, code });
        });
      }),
    };
  };

  it('is continued by the next run after the process was killed', async () => {
    metadata.maxFiles = 10;
    const dir = workspaceDir();
    // The org stops finishing retrieves once two chunks are handed out. The process then waits for the third.
    let waiting = 0;
    mock.intercept = (request) => {
      const zips = metadata.calls.filter((call) => call.operation === 'checkRetrieveStatus' && call.about === 'zip');
      if (zips.length >= 2) {
        metadata.hold = true;
        if (request.body.includes('<checkRetrieveStatus>')) waiting += 1;
      }
      return undefined;
    };
    // The login lies in a home folder of its own, written by a process that has that home folder.
    const home = dirs.next();
    const environment = { ...process.env, HOME: home, USERPROFILE: home, NODE_NO_WARNINGS: '1' };
    const seeded = await start(
      ['zoe@example.com', 'main', ORG_ID, mock.url, 'valid-session'],
      environment,
      fileURLToPath(new URL('./helpers/seed-login.ts', import.meta.url)),
    ).done;
    expect(seeded).toEqual({ stdout: '', stderr: '', code: 0 });

    const first = start([dir, 'prod'], environment);
    let ended: { stdout: string; stderr: string; code: number | null } | undefined;
    void first.done.then((result) => (ended = result));
    while (waiting < 2 && ended === undefined) await new Promise((resolve) => setTimeout(resolve, 20));
    // If the process ended by itself, what it printed says why.
    expect(ended).toBeUndefined();
    first.kill();
    const killed = await first.done;
    expect(killed.code).not.toBe(0);
    expect(killed.stdout).toBe('');

    // What the process left: its lock, and a snapshot that says how far it came.
    const lock = join(dir, '.orglens', 'snapshot-prod.lock');
    expect(readFileSync(lock, 'utf8')).toBe(`${String(first.pid)}\n`);
    const workspace = await openWorkspace({ root: dir, env: {} });
    expect((await workspace.status()).sources[0]).toMatchObject({
      snapshots: 0,
      unfinishedSnapshot: { id: 1, chunksDone: 2, chunks: 4 },
    });
    const retrievesBefore = metadata.retrieves.length;
    const jobs = new Set(metadata.calls.map((call) => call.job).filter((job) => job !== null));
    const callsBefore = metadata.calls.length;

    mock.intercept = null;
    metadata.hold = false;
    const second = await start([dir, 'prod'], environment).done;
    expect(second).toEqual({ stdout: `complete ${String(expectedFiles().length)}\n`, stderr: '', code: 0 });
    const report = await workspace.coverage('prod');
    expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'CHUNK_SPLIT',
      'CHUNK_SPLIT',
      'CHUNK_SPLIT',
      'SNAPSHOT_RESUMED',
    ]);
    // The retrieve that was under way is asked for by its job, and only the chunk that was not begun is started.
    expect(metadata.retrieves.length).toBe(retrievesBefore + 1);
    const after = metadata.calls.slice(callsBefore);
    expect(after[0]).toMatchObject({ operation: 'checkRetrieveStatus', about: '' });
    expect(jobs.has(after[0]?.job ?? '')).toBe(true);
    expect(after.filter((call) => call.operation === 'describeMetadata' || call.operation === 'listMetadata')).toEqual(
      [],
    );
    expect(existsSync(lock)).toBe(false);

    // The same files as a snapshot that was never interrupted.
    const store = openStore({ path: join(dir, '.orglens', 'orglens.db'), readOnly: true });
    const paths = store
      .all('SELECT path FROM snapshot_file WHERE snapshot_id = 1 ORDER BY path')
      .map((row) => String(row['path']));
    store.close();
    expect(paths).toEqual(expectedFiles());
  }, 60_000);

  it('with a key leaves no login, no session and no log in the home folder, and names the org in no file of the workspace', async () => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    mock.key = { username: 'ci@example.com', clientId: 'client-id', publicKey: pair.publicKey };
    const dir = workspaceDir();
    const home = dirs.next();
    const environment: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ORGLENS_JWT_PROD_LOGIN_URL: mock.url,
      ORGLENS_JWT_PROD_USERNAME: 'ci@example.com',
      ORGLENS_JWT_PROD_CLIENT_ID: 'client-id',
      ORGLENS_JWT_PROD_KEY: pair.privateKey.trim().split('\n').join('\\n'),
      // The library warns about an address without TLS, which is what a test server on this machine has.
      NODE_NO_WARNINGS: '1',
    };
    for (let round = 1; round <= 2; round += 1) {
      const run = await start([dir, 'prod', '--environment'], environment).done;
      expect(`${run.stdout}${run.stderr}`).toBe(`complete ${String(expectedFiles().length)}\n`);
      expect(run.code).toBe(0);
    }
    // What the library creates on its way: an empty list of aliases, and the key it would encrypt logins with.
    expect(walk(home).sort()).toEqual(['.sfdx/alias.json', '.sfdx/key.json']);
    const workspaceFiles = walk(join(dir, '.orglens')).filter((file) => !file.startsWith('orglens.db'));
    expect(workspaceFiles.map((file) => file.replace(/logs\/.*/, 'logs/…'))).toEqual(['.gitignore', 'logs/…']);
    for (const file of [
      ...walk(home).map((name) => join(home, name)),
      ...workspaceFiles.map((name) => join(dir, '.orglens', name)),
    ]) {
      const text = readFileSync(file, 'utf8');
      for (const secret of [...mock.sessions, 'ci@example.com', 'PRIVATE KEY', 'client-id', '127.0.0.1']) {
        expect(text, relative(dir, file)).not.toContain(secret);
      }
    }
  }, 60_000);
});
