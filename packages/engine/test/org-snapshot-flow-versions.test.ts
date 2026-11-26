/**
 * A snapshot of an org that holds a flow with an active version and a newer one (decision records 0060 and
 * 0062): the org hands out the newer version for the name of the flow, and the snapshot asks for the active
 * version by its number. The mock org holds the fixture project and answers for a name with a number as run 22
 * of "Live org" showed the test org does (`helpers/mock-metadata.ts`).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot, type OrgSnapshotTuning, type SnapshotProgress } from '../src/api/org-snapshot.ts';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { getBlob } from '../src/store/blobs.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { countIssues, readAnalysisWarnings, readCoverage, readIssues } from '../src/store/snapshots.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { besidesKnownGap } from './helpers/known-gap.ts';
import { mockDependencies } from './helpers/mock-dependencies.ts';
import { metadataFromSource, soapFault, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';
import { storedComponents, storedReferences, withoutPlace } from './helpers/stored-analysis.ts';
import { DRAFT_CHANGES, draftPlaces, FLOW_WITH_DRAFT } from './live/deploy-fixture.ts';

const WHOLE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const FLOWS = join(WHOLE, 'main', 'default', 'flows');
const ORG_ID = '00Dxx0000000001EAA';
const CONFIG = `schema_version = 1\n\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`;
/** The path of the flow with a draft in a snapshot. */
const PATH = `flows/${FLOW_WITH_DRAFT}.flow-meta.xml`;
const KEY = 'Flow:invoice_recalculate';
/** A second flow of the project that gets a draft in some tests. Its draft differs in its state only. */
const SECOND = 'Invoice_After_Save';
const SECOND_PATH = `flows/${SECOND}.flow-meta.xml`;
/** What the snapshot says of a start of a retrieve that the org refused each time it was asked. */
const REFUSED = 'Salesforce did not start the retrieve. INSUFFICIENT_ACCESS: insufficient access rights on object id';

const fileOf = (flow: string): string => readFileSync(join(FLOWS, `${flow}.flow-meta.xml`), 'utf8');
/** The text of the active version of the flow, as the project has it. */
const ACTIVE = fileOf(FLOW_WITH_DRAFT);
/** The text of its draft, as the tool that deploys the fixture sends it. */
const DRAFT = DRAFT_CHANGES.reduce((text, [from, to]) => text.replace(from, to), ACTIVE);
const definition = (active: number | string | null): string =>
  '<?xml version="1.0" encoding="UTF-8"?>\n<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
  (active === null ? '' : `    <activeVersionNumber>${String(active)}</activeVersionNumber>\n`) +
  '</FlowDefinition>\n';

const dirs = tempDirs();
const copies = tempDirs();
let mock: MockOrg;
let metadata: MockMetadata;
/** The project with the draft of the flow in the place of the file of the flow: the latest version the org has. */
let WITH_DRAFT: string;
/** The same, with a draft of a second flow. */
let TWO_DRAFTS: string;

beforeAll(async () => {
  mock = await startMockOrg();
  WITH_DRAFT = join(copies.next(), 'force-app');
  cpSync(WHOLE, WITH_DRAFT, { recursive: true });
  writeFileSync(join(WITH_DRAFT, 'main', 'default', PATH), DRAFT);
  TWO_DRAFTS = join(copies.next(), 'force-app');
  cpSync(WITH_DRAFT, TWO_DRAFTS, { recursive: true });
  writeFileSync(
    join(TWO_DRAFTS, 'main', 'default', SECOND_PATH),
    fileOf(SECOND).replace('<status>Active</status>', '<status>Draft</status>'),
  );
});
afterAll(async () => {
  await mock.close();
  copies.cleanUp();
});
beforeEach(async () => {
  mock.dependencies = mockDependencies([]);
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
  await forgetCliLogins();
  dirs.cleanUp();
});

/** A mock org made from a folder. Version 2 of the flow is the file of the folder, and version 1 is `older`. */
async function orgOf(folder: string, older: ReadonlyMap<number, string> | null): Promise<void> {
  metadata = await metadataFromSource(folder);
  if (older !== null) metadata.flowVersions.set(FLOW_WITH_DRAFT, { latest: 2, older });
  mock.metadata = metadata;
}

/** The org hands out this definition for the flow with a draft, in the place of the one it would make. */
function handOutDefinition(active: number | string | null): void {
  metadata.handedOut.set(`FlowDefinition:${FLOW_WITH_DRAFT}`, {
    path: `flowDefinitions/${FLOW_WITH_DRAFT}.flowDefinition`,
    text: definition(active),
  });
}

function workspaceDir(config = CONFIG): string {
  const dir = dirs.next();
  writeFileSync(join(dir, 'orglens.toml'), config);
  mkdirSync(join(dir, '.orglens'), { recursive: true });
  return dir;
}

const databaseOf = (dir: string): string => join(dir, '.orglens', 'orglens.db');

/** True for a request that starts a retrieve and names `member`. */
const startsRetrieveOf = (body: string, member: string): boolean =>
  /<soapenv:Body[^>]*>\s*<retrieve\b/.test(body) && body.includes(`<members>${member}</members>`);

/** The versions each start of a retrieve by a number named, in order, also a start the org refused. */
const askedByNumber = (): string[][] =>
  mock.requests
    .filter((request) => /<soapenv:Body[^>]*>\s*<retrieve\b/.test(request.body))
    .map((request) => [...request.body.matchAll(/<members>([^<]*-[0-9]+)<\/members>/g)].map((match) => match[1] ?? ''))
    .filter((members) => members.length > 0);

/** The issues of the reading, as `severity CODE`, and the ones about flows with all they say. */
const codesOf = (report: CoverageReport): string[] =>
  report.issues.filter((issue) => issue.stage === 'read').map((issue) => `${issue.severity} ${issue.code}`);
const aboutFlows = (report: CoverageReport): unknown[] =>
  report.issues
    .filter((issue) => issue.stage === 'read' && issue.code.includes('FLOW'))
    .map(({ severity, code, message, component, details }) => ({ severity, code, message, component, details }));
const flowRow = (report: CoverageReport): unknown => report.types.find((type) => type.type === 'Flow');
const detailsOf = (report: CoverageReport, code: string): unknown =>
  report.issues.find((issue) => issue.code === code)?.details;

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'a snapshot of an org with a newer version of a flow, with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };

    /**
     * Takes a snapshot the way the workspace does, with the numbers a test sets, and with pauses a test can
     * afford: a start the org refuses is asked for again after 5 ms.
     */
    async function snap(
      dir: string,
      options: { tuning?: Partial<OrgSnapshotTuning>; onProgress?: (event: SnapshotProgress) => void } = {},
    ): Promise<CoverageReport> {
      const workspace = await openWorkspace({ root: dir, env });
      const source = (await workspace.sources.list()).find((one) => one.name === 'prod') as OrgSource;
      return takeOrgSnapshot({
        paths: workspacePaths(dir),
        source,
        linked: undefined,
        env,
        openStore: () => openStore({ path: databaseOf(dir), driver }),
        onProgress: options.onProgress,
        tuning: { pollFirstMs: 5, pollMaxMs: 5, ...options.tuning },
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

    /** A file of a snapshot, or null. */
    const fileAt = (dir: string, snapshot: number, path: string): string | null =>
      reading(dir, (store) => {
        const row = store.get('SELECT blob_id FROM snapshot_file WHERE snapshot_id = ? AND path = ?', snapshot, path);
        return row === undefined ? null : Buffer.from(getBlob(store, Number(row['blob_id']))).toString('utf8');
      });
    /** The file of the flow with a draft in a snapshot, or null. */
    const flowFile = (dir: string, snapshot: number): string | null => fileAt(dir, snapshot, PATH);

    it('holds the active version under the path of the flow, and says that there is a newer one', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      const dir = workspaceDir();
      const steps = new Set<string>();
      const report = await snap(dir, {
        onProgress: (event) => {
          steps.add(event.step === 'flow-versions' ? `${event.step} ${String(event.flows)}` : event.step);
        },
      });

      expect(report.snapshot.status).toBe('complete');
      // The chunk of every component, and then the flow by the number its definition names.
      expect(metadata.retrieves).toHaveLength(2);
      expect(metadata.retrieves[0]).toContain(`Flow:${FLOW_WITH_DRAFT}`);
      expect(metadata.retrieves[0]).toContain(`FlowDefinition:${FLOW_WITH_DRAFT}`);
      expect(metadata.retrieves[1]).toEqual([`Flow:${FLOW_WITH_DRAFT}-1`]);
      // After the last chunk, the snapshot says how many flows it asks for by their numbers.
      expect([...steps]).toEqual([
        'connected',
        'listing',
        'planned',
        'retrieved',
        'flow-versions 1',
        'cross-checking',
        'describing',
        'analysing',
      ]);
      // The file of the snapshot is the active version: in every place the draft differs, it says what the active
      // version says.
      const held = flowFile(dir, 1) ?? '';
      expect(draftPlaces(held)).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
      expect(
        reading(dir, (store) => store.all("SELECT path FROM snapshot_file WHERE path LIKE 'flows/%'")),
      ).toHaveLength(7);
      expect(codesOf(report)).toEqual(['info FLOW_NEWER_VERSION']);
      expect(aboutFlows(report)).toEqual([
        {
          severity: 'info',
          code: 'FLOW_NEWER_VERSION',
          message: `The flow ${FLOW_WITH_DRAFT} has a version that is newer than its active version 1, and is Draft. The snapshot holds the active version, and the newer one is not analysed.`,
          component: KEY,
          details: { flow: FLOW_WITH_DRAFT, version: 1, newer: 'Draft' },
        },
      ]);
      expect(flowRow(report)).toEqual({
        type: 'Flow',
        listed: 7,
        retrieved: 7,
        analysed: 64,
        listing: 'ok',
        note: null,
        packaged: 0,
      });
      expect(besidesKnownGap(report.issues.filter((issue) => issue.stage === 'analysis'))).toEqual([]);

      // The analysis is the one of an org without the draft: the same components and references, and no
      // reference to the field only the draft reads.
      await orgOf(WHOLE, null);
      const plain = workspaceDir();
      await snap(plain);
      const of = (at: string): { components: string[]; references: string[] } =>
        reading(at, (store) => ({
          components: storedComponents(store, 1).map((one) => `${one.key} ${JSON.stringify(one.attrs)}`),
          references: storedReferences(store, 1).map(withoutPlace).sort(),
        }));
      expect(of(dir)).toEqual(of(plain));
      expect(of(dir).references.filter((one) => one.includes('paid_date__c') && one.includes(KEY))).toEqual([]);

      // An impact answer is the one of the org without the draft, and names the newer version where the flow is
      // in the answer: asked about, an element of it asked about, among what refers to a field, or among what a
      // flow refers to (decision record 0066). The note is no gap: it changes neither `complete` nor `mayMiss`.
      const ask = async (at: string, component: string, outgoing: boolean) => {
        const { snapshot, newerVersions, ...rest } = await (
          await openWorkspace({ root: at, env })
        ).impact('prod', component, { outgoing });
        expect(snapshot.status).toBe('complete');
        return { newerVersions, rest };
      };
      for (const [component, outgoing] of [
        [KEY, false],
        // The org lists a definition under the name of every flow: the name alone means the flow (record 0082).
        [FLOW_WITH_DRAFT, false],
        [`${FLOW_WITH_DRAFT}.Set_Amount`, false],
        ['Invoice__c.Amount__c', false],
        ['Flow:invoice_after_save', true],
      ] as const) {
        const withDraft = await ask(dir, component, outgoing);
        const without = await ask(plain, component, outgoing);
        expect(withDraft.newerVersions, component).toEqual([{ flow: KEY, active: 1, newer: 'Draft' }]);
        expect(without.newerVersions, component).toEqual([]);
        expect(withDraft.rest, component).toEqual(without.rest);
        expect(withDraft.rest.results.length + withDraft.rest.parts, component).toBeGreaterThan(0);
      }
      const bare = (await ask(dir, FLOW_WITH_DRAFT, false)).rest;
      expect([bare.component.key, bare.sameName]).toEqual([KEY, ['FlowDefinition:invoice_recalculate']]);
      // A flow that has no newer version is not named, and neither is a flow that is not in the answer.
      for (const component of ['Flow:invoice_before_save', 'Invoice__c.Legacy_Code__c']) {
        expect((await ask(dir, component, false)).newerVersions, component).toEqual([]);
      }
    });

    it('takes a file that came back as the latest version without a note: the flow was made active since', async () => {
      // The definition names the latest version, and the org hands it out under the name of the flow, now active.
      await orgOf(WITH_DRAFT, null);
      handOutDefinition(2);
      metadata.handedOut.set(`Flow:${FLOW_WITH_DRAFT}-2`, { path: `flows/${FLOW_WITH_DRAFT}.flow`, text: ACTIVE });
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(metadata.retrieves[1]).toEqual([`Flow:${FLOW_WITH_DRAFT}-2`]);
      expect(report.snapshot.status).toBe('complete');
      // No note claims a newer version that is not active.
      expect(codesOf(report)).toEqual([]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
    });

    it('takes the active version out, with the newer one, where the org does not hand it out for its number', async () => {
      // The org keeps no file of version 1, and its definition names version 1 all the same.
      await orgOf(WITH_DRAFT, new Map());
      handOutDefinition(1);
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(metadata.retrieves[1]).toEqual([`Flow:${FLOW_WITH_DRAFT}-1`]);
      // A flow of the logic tier that the org listed is not in the snapshot: the snapshot is partial.
      expect(report.snapshot.status).toBe('partial');
      // The remark of Salesforce that it cannot find the name with the number is given with the note.
      expect(codesOf(report)).toEqual(['info ACTIVE_FLOW_NOT_RETRIEVED', 'error NOT_RETRIEVED']);
      const said = `No file of it came back. Salesforce remarked: Entity of type 'Flow' named '${FLOW_WITH_DRAFT}-1' cannot be found.`;
      expect(aboutFlows(report)).toEqual([
        {
          severity: 'info',
          code: 'ACTIVE_FLOW_NOT_RETRIEVED',
          message: `The flow ${FLOW_WITH_DRAFT} came back as a version that is Draft, and its active version 1 did not come back when it was asked for by its number. ${said} The flow is not in the snapshot, and the newer version is not analysed in its place.`,
          component: KEY,
          details: { flow: FLOW_WITH_DRAFT, version: 1, newer: 'Draft', said },
        },
      ]);
      expect(report.issues.find((issue) => issue.code === 'NOT_RETRIEVED')).toMatchObject({
        severity: 'error',
        details: { type: 'Flow', count: 1, components: [FLOW_WITH_DRAFT], tier: 'logic' },
      });
      expect(flowFile(dir, 1)).toBeNull();
      // Six flows are analysed, with 43 of the 57 elements: the flow that is left out has 14.
      expect(flowRow(report)).toEqual({
        type: 'Flow',
        listed: 7,
        retrieved: 6,
        analysed: 49,
        listing: 'ok',
        note: null,
        packaged: 0,
      });
      // Nothing of the flow is analysed: not the draft, and not its elements.
      const keys = reading(dir, (store) => storedComponents(store, 1).map((one) => one.key));
      expect(keys.filter((key) => key.startsWith(KEY))).toEqual([]);
    });

    it('says which files of the retrieve could not be read as metadata, where the active version is not among them', async () => {
      await orgOf(WITH_DRAFT, new Map());
      handOutDefinition(1);
      const dir = workspaceDir();
      // Once every chunk is stored, the org puts a file into every retrieve that is no metadata.
      const report = await snap(dir, {
        onProgress: (event) => {
          if (event.step === 'flow-versions') metadata.extraFiles.set('tabs/Thing.mystery', 'What is this?\n');
        },
      });

      expect(report.snapshot.status).toBe('partial');
      expect(detailsOf(report, 'ACTIVE_FLOW_NOT_RETRIEVED')).toMatchObject({
        said: `No file of it came back. Salesforce remarked: Entity of type 'Flow' named '${FLOW_WITH_DRAFT}-1' cannot be found. 1 file of the retrieve could not be read as metadata. The first: tabs/Thing.mystery: The file belongs to no metadata type that is known.`,
      });
    });

    it('takes no file that is not active, under either name', async () => {
      // Asked for by the number of its active version, the org hands out a file that says it is a draft.
      await orgOf(WITH_DRAFT, new Map([[1, DRAFT]]));
      handOutDefinition(1);
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('partial');
      expect(codesOf(report)).toEqual(['info ACTIVE_FLOW_NOT_RETRIEVED', 'error NOT_RETRIEVED']);
      expect(detailsOf(report, 'ACTIVE_FLOW_NOT_RETRIEVED')).toEqual({
        flow: FLOW_WITH_DRAFT,
        version: 1,
        newer: 'Draft',
        said: 'What came back is Draft.',
      });
      expect(flowFile(dir, 1)).toBeNull();
    });

    it('takes the flow out where Salesforce fails the retrieve of its active version, and says why', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      const dir = workspaceDir();
      // Once every chunk is stored, the org fails a retrieve that would hand out a file.
      const report = await snap(dir, {
        onProgress: (event) => {
          if (event.step === 'flow-versions') metadata.maxFiles = 0;
        },
      });

      // A retrieve that Salesforce failed is not started again.
      expect(metadata.retrieves.slice(1)).toEqual([[`Flow:${FLOW_WITH_DRAFT}-1`]]);
      expect(report.snapshot.status).toBe('partial');
      expect(codesOf(report)).toEqual(['info ACTIVE_FLOW_NOT_RETRIEVED', 'error NOT_RETRIEVED']);
      expect(detailsOf(report, 'ACTIVE_FLOW_NOT_RETRIEVED')).toEqual({
        flow: FLOW_WITH_DRAFT,
        version: 1,
        newer: 'Draft',
        said: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is 0.',
      });
      expect(flowFile(dir, 1)).toBeNull();
    });

    it('keeps the newer version, as not active, where the snapshot holds no definition of the flow', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      // The org lists the definition and does not hand it out.
      metadata.withheld.add(`FlowDefinition:${FLOW_WITH_DRAFT}`);
      const dir = workspaceDir();
      const steps: string[] = [];
      const report = await snap(dir, { onProgress: (event) => steps.push(event.step) });

      // Nothing is asked for by a number, and nothing is said about it.
      expect(metadata.retrieves).toHaveLength(1);
      expect(steps).not.toContain('flow-versions');
      // The definition is outside the logic tier: the snapshot is complete.
      expect(report.snapshot.status).toBe('complete');
      expect(codesOf(report)).toEqual([
        'warning RETRIEVE_MESSAGES',
        'warning FLOW_VERSION_UNKNOWN',
        'warning NOT_RETRIEVED',
      ]);
      expect(aboutFlows(report)).toEqual([
        {
          severity: 'warning',
          code: 'FLOW_VERSION_UNKNOWN',
          message: `The flow ${FLOW_WITH_DRAFT} came back as a version that is Draft. The snapshot holds no definition of the flow, which would name its active version. It is analysed as it came, and it is not known whether another version of it is active.`,
          component: KEY,
          details: { flow: FLOW_WITH_DRAFT, state: 'Draft', reason: 'no-definition', types: ['Flow'] },
        },
      ]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
      // The draft is analysed, and what it refers to says that the flow is not active.
      const fromFlow = reading(dir, (store) =>
        storedReferences(store, 1).filter((one) => one.from.startsWith(KEY) && (one.to ?? '').endsWith('paid_date__c')),
      );
      expect(fromFlow.length).toBeGreaterThan(0);

      // An impact answer covers flows: it counts the warning with those of the analysis, and is not complete. The
      // warning says nothing that is missed for certain, so it does not make the answer one that may miss. The one
      // warning of the analysis is about an element of another flow, which the answer does not walk from, so it
      // does not count (decision record 0074).
      expect(reading(dir, (store) => countIssues(store, 1, []).readWarnings)).toBe(0);
      expect(reading(dir, (store) => countIssues(store, 1, ['Flow']).readWarnings)).toBe(1);
      expect(reading(dir, (store) => readAnalysisWarnings(store, 1).map((one) => one.componentKey))).toEqual([
        'Flow:invoice_after_save#element:check_result',
      ]);
      const answer = await (await openWorkspace({ root: dir, env })).impact('prod', KEY, { outgoing: true });
      expect(answer.results.some((one) => one.key.startsWith('Flow:invoice_after_save'))).toBe(false);
      expect(answer.notCovered.analysisWarnings).toBe(1);
      expect(answer.complete).toBe(false);
      expect(answer.mayMiss).toBe(false);
    });

    it('says of a flow whose definition names no number that can be read that nothing is known', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      handOutDefinition('1.5');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(metadata.retrieves).toHaveLength(1);
      expect(report.snapshot.status).toBe('complete');
      expect(aboutFlows(report)).toEqual([
        {
          severity: 'warning',
          code: 'FLOW_VERSION_UNKNOWN',
          message: `The flow ${FLOW_WITH_DRAFT} came back as a version that is Draft. The file of its definition cannot be read, or names no number that can be read. It is analysed as it came, and it is not known whether another version of it is active.`,
          component: KEY,
          details: { flow: FLOW_WITH_DRAFT, state: 'Draft', reason: 'definition-unreadable', types: ['Flow'] },
        },
      ]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
    });

    it('says that the source leaves the definitions of flows out, where it does', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      const dir = workspaceDir(`${CONFIG}exclude_types = ["FlowDefinition"]\n`);
      const report = await snap(dir);

      expect(metadata.retrieves).toHaveLength(1);
      expect(metadata.retrieves[0]?.filter((member) => member.startsWith('FlowDefinition:'))).toEqual([]);
      expect(report.snapshot.status).toBe('complete');
      // Without its definition, a flow that was never active cannot be told from one with an older active version.
      const because =
        'The snapshot holds no definition of the flow, which would name its active version: the source leaves the type FlowDefinition out (exclude_types). It is analysed as it came, and it is not known whether another version of it is active.';
      expect(aboutFlows(report)).toEqual(
        [
          ['Invoice_Purge_Void', 'Flow:invoice_purge_void'],
          [FLOW_WITH_DRAFT, KEY],
        ].map(([flow, component]) => ({
          severity: 'warning',
          code: 'FLOW_VERSION_UNKNOWN',
          message: `The flow ${String(flow)} came back as a version that is Draft. ${because}`,
          component,
          details: { flow, state: 'Draft', reason: 'excluded', types: ['Flow'] },
        })),
      );
    });

    it('asks for the active versions of several flows in one retrieve, and for each half when that fails', async () => {
      await orgOf(TWO_DRAFTS, new Map([[1, ACTIVE]]));
      metadata.flowVersions.set(SECOND, { latest: 2, older: new Map([[1, fileOf(SECOND)]]) });
      // The org refuses to start a retrieve that names the second flow by its number, also when it is asked again.
      mock.intercept = (request) =>
        startsRetrieveOf(request.body, `${SECOND}-1`)
          ? soapFault('INSUFFICIENT_ACCESS', 'insufficient access rights on object id')
          : undefined;
      const dir = workspaceDir();
      const report = await snap(dir);

      // The two flows, then each half. A start is asked for three times before the retrieve counts as failed.
      const both = [SECOND, FLOW_WITH_DRAFT].map((one) => `${one}-1`).sort();
      const second = [`${SECOND}-1`];
      expect(askedByNumber()).toEqual([both, both, both, second, second, second, [`${FLOW_WITH_DRAFT}-1`]]);
      expect(report.snapshot.status).toBe('partial');
      expect(report.issues.find((issue) => issue.code === 'CHUNK_SPLIT')).toMatchObject({
        severity: 'info',
        message: `A retrieve of the active versions of 2 flows failed and was tried again in two halves. ${REFUSED}`,
        details: { members: 2, said: REFUSED, code: 'INSUFFICIENT_ACCESS' },
      });
      const notes = report.issues.filter((issue) => issue.code.includes('FLOW'));
      expect(notes.map((issue) => `${issue.code} ${issue.component ?? ''}`)).toEqual([
        'ACTIVE_FLOW_NOT_RETRIEVED Flow:invoice_after_save',
        `FLOW_NEWER_VERSION ${KEY}`,
      ]);
      expect(notes[0]?.details['said']).toBe(REFUSED);
      // The flow whose active version did not come back left the snapshot with its draft.
      expect(fileAt(dir, 1, SECOND_PATH)).toBeNull();
      expect(report.issues.find((issue) => issue.code === 'NOT_RETRIEVED')).toMatchObject({
        severity: 'error',
        details: { type: 'Flow', count: 1, components: [SECOND], tier: 'logic' },
      });
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
    });

    it('asks for as many active versions in one retrieve as the tuning says', async () => {
      await orgOf(TWO_DRAFTS, new Map([[1, ACTIVE]]));
      metadata.flowVersions.set(SECOND, { latest: 2, older: new Map([[1, fileOf(SECOND)]]) });
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { flowsPerRetrieve: 1 } });

      expect(metadata.retrieves.slice(1)).toEqual([[`Flow:${SECOND}-1`], [`Flow:${FLOW_WITH_DRAFT}-1`]]);
      expect(report.snapshot.status).toBe('complete');
      expect(codesOf(report)).toEqual(['info FLOW_NEWER_VERSION', 'info FLOW_NEWER_VERSION']);
      expect(fileAt(dir, 1, SECOND_PATH)).toBe(fileOf(SECOND));
    });

    it('asks again for the start of a retrieve the org refused, and starts again a retrieve Salesforce forgot', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      let starts = 0;
      let forgot = false;
      mock.intercept = (request) => {
        if (startsRetrieveOf(request.body, `${FLOW_WITH_DRAFT}-1`)) {
          starts += 1;
          // The org refuses the first start, for a reason that passes.
          return starts === 1 ? soapFault('UNKNOWN_EXCEPTION', 'An unexpected error occurred.') : undefined;
        }
        // Salesforce no longer knows the job of the second start when it is first asked about it.
        if (starts === 2 && !forgot && /<soapenv:Body[^>]*>\s*<checkRetrieveStatus\b/.test(request.body)) {
          forgot = true;
          return soapFault('INVALID_CROSS_REFERENCE_KEY', 'invalid cross reference id');
        }
        return undefined;
      };
      const dir = workspaceDir();
      const report = await snap(dir);

      const version = [`${FLOW_WITH_DRAFT}-1`];
      expect(askedByNumber()).toEqual([version, version, version]);
      // The org started the second and the third.
      expect(metadata.retrieves.slice(1)).toEqual([[`Flow:${FLOW_WITH_DRAFT}-1`], [`Flow:${FLOW_WITH_DRAFT}-1`]]);
      expect(report.snapshot.status).toBe('complete');
      expect(codesOf(report)).toEqual(['info FLOW_NEWER_VERSION']);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
    });

    it('gives up the active version after three starts of a retrieve that does not end, and ends the snapshot', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      // The chunk is done when it is first asked about, so that only a retrieve of the version can be too slow.
      metadata.pollsBeforeDone = 0;
      const dir = workspaceDir();
      const report = await snap(dir, {
        tuning: { jobMs: 30 },
        onProgress: (event) => {
          if (event.step === 'flow-versions') metadata.hold = true;
        },
      });

      // The job is not kept with the snapshot. It is started again in the same run, up to three times.
      expect(metadata.retrieves.slice(1)).toEqual([
        [`Flow:${FLOW_WITH_DRAFT}-1`],
        [`Flow:${FLOW_WITH_DRAFT}-1`],
        [`Flow:${FLOW_WITH_DRAFT}-1`],
      ]);
      expect(report.snapshot.status).toBe('partial');
      expect(codesOf(report)).toEqual(['info ACTIVE_FLOW_NOT_RETRIEVED', 'error NOT_RETRIEVED']);
      expect(detailsOf(report, 'ACTIVE_FLOW_NOT_RETRIEVED')).toEqual({
        flow: FLOW_WITH_DRAFT,
        version: 1,
        newer: 'Draft',
        said: 'The retrieve was started 3 times and gave no result. The retrieve did not end within 0 minutes.',
      });
      expect(flowFile(dir, 1)).toBeNull();
    });

    it('stops after retrieves in a row that gave nothing, and asks only for what it had not done when continued', async () => {
      await orgOf(TWO_DRAFTS, new Map([[1, ACTIVE]]));
      metadata.flowVersions.set(SECOND, { latest: 2, older: new Map([[1, fileOf(SECOND)]]) });
      // The org refuses to start a retrieve of a version.
      mock.intercept = (request) =>
        startsRetrieveOf(request.body, `${SECOND}-1`) || startsRetrieveOf(request.body, `${FLOW_WITH_DRAFT}-1`)
          ? soapFault('INSUFFICIENT_ACCESS', 'insufficient access rights on object id')
          : undefined;
      const dir = workspaceDir();
      // The retrieve of both, then the one of the first half: two that failed in a row stop the snapshot.
      await expect(snap(dir, { tuning: { failuresInARow: 2 } })).rejects.toMatchObject({
        code: 'SOURCE_READ_FAILED',
        message: `2 retrieves in a row from the org of the source "prod" failed. The last: ${REFUSED}`,
        details: {
          reason: 'RETRIEVES_FAILING',
          source: 'prod',
          said: REFUSED,
          code: 'INSUFFICIENT_ACCESS',
          snapshot: 1,
        },
      });
      // What was done is kept: the first half is taken out, and the second still holds the draft. The coverage of
      // the stopped snapshot counts the flow that was taken out.
      expect(fileAt(dir, 1, SECOND_PATH)).toBeNull();
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
      expect(reading(dir, (store) => readCoverage(store, 1).find((type) => type.type === 'Flow'))).toMatchObject({
        listed: 7,
        retrieved: 6,
      });

      mock.intercept = null;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'partial' });
      // Only the flow that was not done is asked for.
      expect(askedByNumber().slice(6)).toEqual([[`${FLOW_WITH_DRAFT}-1`]]);
      expect(codesOf(report)).toEqual([
        'info CHUNK_SPLIT',
        'info ACTIVE_FLOW_NOT_RETRIEVED',
        'info SNAPSHOT_RESUMED',
        'info FLOW_NEWER_VERSION',
        'error NOT_RETRIEVED',
      ]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
    });

    it('asks for the active version again when the snapshot is continued after it stopped there', async () => {
      await orgOf(TWO_DRAFTS, new Map([[1, ACTIVE]]));
      // The org does not hand out the definition of the second flow: nothing is known of its active version.
      metadata.withheld.add(`FlowDefinition:${SECOND}`);
      // The org refuses the retrieve of the version for a reason that holds for every request: the snapshot stops.
      mock.intercept = (request) =>
        request.body.includes(`<members>${FLOW_WITH_DRAFT}-1</members>`)
          ? soapFault('REQUEST_LIMIT_EXCEEDED', 'TotalRequests Limit exceeded.')
          : undefined;
      const dir = workspaceDir();
      await expect(snap(dir)).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' });
      // Nothing of the retrieve was written: the snapshot still holds the draft. The warning about the second flow
      // is written.
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
      const unknown = (): string[] =>
        reading(dir, (store) =>
          readIssues(store, 1)
            .filter((issue) => issue.code === 'FLOW_VERSION_UNKNOWN')
            .map((issue) => issue.componentKey ?? ''),
        );
      expect(unknown()).toEqual(['Flow:invoice_after_save']);

      mock.intercept = null;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(codesOf(report)).toEqual([
        'warning RETRIEVE_MESSAGES',
        'info SNAPSHOT_RESUMED',
        'warning FLOW_VERSION_UNKNOWN',
        'info FLOW_NEWER_VERSION',
        'warning NOT_RETRIEVED',
      ]);
      // The warning is said once, also though it was written in both runs.
      expect(unknown()).toEqual(['Flow:invoice_after_save']);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
      // The chunk was not retrieved again: one retrieve of the chunk, and the version once it was answered.
      expect(metadata.retrieves.map((members) => members.length > 1)).toEqual([true, false]);
    });

    it('does not ask by a number for a flow the org lists under another name than that of its file', async () => {
      // The flow is of a package: the org lists it with the prefix and hands it out without it.
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      metadata.packaged.set(`Flow:${FLOW_WITH_DRAFT}`, 'pkg');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(metadata.retrieves).toHaveLength(1);
      expect(report.snapshot.status).toBe('complete');
      // What the snapshot analyses is not the active version, and the warning says so (decision record 0062).
      expect(aboutFlows(report)).toEqual([
        {
          severity: 'warning',
          code: 'FLOW_VERSION_UNKNOWN',
          message: `The flow ${FLOW_WITH_DRAFT} came back as a version that is Draft. Its definition names version 1 as active, and the org lists no flow under the name of its file, so that version is not asked for by its number. The flow is analysed as it came, which is not its active version.`,
          component: KEY,
          details: { flow: FLOW_WITH_DRAFT, state: 'Draft', reason: 'not-listed', version: 1, types: ['Flow'] },
        },
      ]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
    });
  },
);
