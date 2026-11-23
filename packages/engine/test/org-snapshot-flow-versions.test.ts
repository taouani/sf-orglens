/**
 * A snapshot of an org that holds a flow with an active version and a newer one (decision record 0060): the org
 * hands out the newer version for the name of the flow, and the snapshot asks for the active version by its
 * number. The mock org holds the fixture project and answers for a name with a number as run 22 of "Live org"
 * showed the test org does (`helpers/mock-metadata.ts`).
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import { getBlob } from '../src/store/blobs.ts';
import { openStore, type Store } from '../src/store/open.ts';
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

const fileOf = (flow: string): string => readFileSync(join(FLOWS, `${flow}.flow-meta.xml`), 'utf8');
/** The text of the active version of the flow, as the project has it. */
const ACTIVE = fileOf(FLOW_WITH_DRAFT);
/** The text of its draft, as the tool that deploys the fixture sends it. */
const DRAFT = DRAFT_CHANGES.reduce((text, [from, to]) => text.replace(from, to), ACTIVE);
const definition = (active: number | null): string =>
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
    join(TWO_DRAFTS, 'main', 'default', 'flows', `${SECOND}.flow-meta.xml`),
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

function workspaceDir(): string {
  const dir = dirs.next();
  writeFileSync(join(dir, 'orglens.toml'), CONFIG);
  mkdirSync(join(dir, '.orglens'), { recursive: true });
  return dir;
}

/** The issues of the reading, as `severity CODE`, and the ones about flows with all they say. */
const codesOf = (report: CoverageReport): string[] =>
  report.issues.filter((issue) => issue.stage === 'read').map((issue) => `${issue.severity} ${issue.code}`);
const aboutFlows = (report: CoverageReport): unknown[] =>
  report.issues
    .filter((issue) => issue.stage === 'read' && issue.code.includes('FLOW'))
    .map(({ severity, code, message, component, details }) => ({ severity, code, message, component, details }));
const flowRow = (report: CoverageReport): unknown => report.types.find((type) => type.type === 'Flow');

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'a snapshot of an org with a newer version of a flow, with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };

    async function snap(dir: string): Promise<CoverageReport> {
      const workspace = await openWorkspace({ root: dir, env });
      return workspace.snapshot('prod');
    }

    function reading<T>(dir: string, work: (store: Store) => T): T {
      const store = openStore({ path: join(dir, '.orglens', 'orglens.db'), driver, readOnly: true });
      try {
        return work(store);
      } finally {
        store.close();
      }
    }

    /** The file of the flow in a snapshot, or null. */
    const flowFile = (dir: string, snapshot: number): string | null =>
      reading(dir, (store) => {
        const row = store.get('SELECT blob_id FROM snapshot_file WHERE snapshot_id = ? AND path = ?', snapshot, PATH);
        return row === undefined ? null : Buffer.from(getBlob(store, Number(row['blob_id']))).toString('utf8');
      });

    it('holds the active version under the path of the flow, and says that there is a newer one', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('complete');
      // The chunk of every component, and then the flow by the number its definition names.
      expect(metadata.retrieves).toHaveLength(2);
      expect(metadata.retrieves[0]).toContain(`Flow:${FLOW_WITH_DRAFT}`);
      expect(metadata.retrieves[0]).toContain(`FlowDefinition:${FLOW_WITH_DRAFT}`);
      expect(metadata.retrieves[1]).toEqual([`Flow:${FLOW_WITH_DRAFT}-1`]);
      // The file of the snapshot is the active version: in every place the draft differs, it says what the active
      // version says.
      const held = flowFile(dir, 1) ?? '';
      expect(draftPlaces(held)).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
      expect(
        reading(dir, (store) => store.all("SELECT path FROM snapshot_file WHERE path LIKE 'flows/%'")),
      ).toHaveLength(6);
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
        listed: 6,
        retrieved: 6,
        analysed: 61,
        listing: 'ok',
        note: null,
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
    });

    it('takes the active version out, with the newer one, where the org does not hand it out for its number', async () => {
      // The org keeps no file of version 1, and its definition names version 1 all the same.
      await orgOf(WITH_DRAFT, new Map());
      metadata.handedOut.set(`FlowDefinition:${FLOW_WITH_DRAFT}`, {
        path: `flowDefinitions/${FLOW_WITH_DRAFT}.flowDefinition`,
        text: definition(1),
      });
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(metadata.retrieves[1]).toEqual([`Flow:${FLOW_WITH_DRAFT}-1`]);
      // A flow of the logic tier that the org listed is not in the snapshot: the snapshot is partial.
      expect(report.snapshot.status).toBe('partial');
      // The remark of Salesforce that it cannot find the name with the number is given with the note.
      expect(codesOf(report)).toEqual(['info ACTIVE_FLOW_NOT_RETRIEVED', 'error NOT_RETRIEVED']);
      const said = `No file of it came back. Salesforce remarked: Entity of type 'Flow' named '${FLOW_WITH_DRAFT}-1' cannot be found`;
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
      // Five flows are analysed, with 41 of the 55 elements: the flow that is left out has 14.
      expect(flowRow(report)).toEqual({
        type: 'Flow',
        listed: 6,
        retrieved: 5,
        analysed: 46,
        listing: 'ok',
        note: null,
      });
      // Nothing of the flow is analysed: not the draft, and not its elements.
      const keys = reading(dir, (store) => storedComponents(store, 1).map((one) => one.key));
      expect(keys.filter((key) => key.startsWith(KEY))).toEqual([]);
    });

    it('takes no file that is not active, under either name', async () => {
      // Asked for by the number of its active version, the org hands out a file that says it is a draft.
      await orgOf(WITH_DRAFT, new Map([[1, DRAFT]]));
      metadata.handedOut.set(`FlowDefinition:${FLOW_WITH_DRAFT}`, {
        path: `flowDefinitions/${FLOW_WITH_DRAFT}.flowDefinition`,
        text: definition(1),
      });
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('partial');
      expect(codesOf(report)).toEqual(['info ACTIVE_FLOW_NOT_RETRIEVED', 'error NOT_RETRIEVED']);
      expect(report.issues.find((issue) => issue.code === 'ACTIVE_FLOW_NOT_RETRIEVED')?.details).toEqual({
        flow: FLOW_WITH_DRAFT,
        version: 1,
        newer: 'Draft',
        said: 'What came back is Draft.',
      });
      expect(flowFile(dir, 1)).toBeNull();
    });

    it('keeps the newer version, as not active, where the snapshot holds no definition of the flow', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      // The org lists the definition and does not hand it out.
      metadata.withheld.add(`FlowDefinition:${FLOW_WITH_DRAFT}`);
      const dir = workspaceDir();
      const report = await snap(dir);

      // Nothing is asked for by a number.
      expect(metadata.retrieves).toHaveLength(1);
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
          details: { flow: FLOW_WITH_DRAFT, state: 'Draft', reason: 'no-definition' },
        },
      ]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
      // The draft is analysed, and what it refers to says that the flow is not active.
      const fromFlow = reading(dir, (store) =>
        storedReferences(store, 1).filter((one) => one.from.startsWith(KEY) && (one.to ?? '').endsWith('paid_date__c')),
      );
      expect(fromFlow.length).toBeGreaterThan(0);
    });

    it('asks for the active versions of several flows in one retrieve, and for each alone when that is refused', async () => {
      await orgOf(TWO_DRAFTS, new Map([[1, ACTIVE]]));
      metadata.flowVersions.set(SECOND, { latest: 2, older: new Map([[1, fileOf(SECOND)]]) });
      // The org refuses to start a retrieve that names the second flow by its number.
      mock.intercept = (request) =>
        /<soapenv:Body[^>]*>\s*<retrieve\b/.test(request.body) &&
        request.body.includes(`<members>${SECOND}-1</members>`)
          ? soapFault('INSUFFICIENT_ACCESS', 'insufficient access rights on object id')
          : undefined;
      const dir = workspaceDir();
      const report = await snap(dir);

      // The two flows, then each alone. The refused starts are not answered by the org, so they are not counted
      // among its retrieves.
      const asked = mock.requests
        .filter((request) => request.body.includes('-1</members>'))
        .map((request) => [...request.body.matchAll(/<members>([^<]*-1)<\/members>/g)].map((match) => match[1]));
      expect(asked).toEqual([
        [SECOND, FLOW_WITH_DRAFT].map((one) => `${one}-1`).sort(),
        [`${SECOND}-1`],
        [`${FLOW_WITH_DRAFT}-1`],
      ]);
      expect(report.snapshot.status).toBe('partial');
      const notes = report.issues.filter((issue) => issue.code.includes('FLOW'));
      expect(notes.map((issue) => `${issue.code} ${issue.component ?? ''}`)).toEqual([
        'ACTIVE_FLOW_NOT_RETRIEVED Flow:invoice_after_save',
        `FLOW_NEWER_VERSION ${KEY}`,
      ]);
      expect(notes[0]?.details['said']).toMatch(/^Salesforce did not start the retrieve\. INSUFFICIENT_ACCESS: /);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 0, ofActive: 3, all: 3 });
    });

    it('asks for the active version again when the snapshot is continued after it stopped there', async () => {
      await orgOf(WITH_DRAFT, new Map([[1, ACTIVE]]));
      // The org refuses the retrieve of the version for a reason that holds for every request: the snapshot stops.
      mock.intercept = (request) =>
        request.body.includes(`<members>${FLOW_WITH_DRAFT}-1</members>`)
          ? soapFault('REQUEST_LIMIT_EXCEEDED', 'TotalRequests Limit exceeded.')
          : undefined;
      const dir = workspaceDir();
      await expect(snap(dir)).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' });
      // Nothing of the step was written: the snapshot still holds the draft, and no note about the flow.
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });

      mock.intercept = null;
      const report = await snap(dir);
      expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
      expect(codesOf(report)).toEqual(['info SNAPSHOT_RESUMED', 'info FLOW_NEWER_VERSION']);
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
      expect(aboutFlows(report)).toEqual([
        {
          severity: 'warning',
          code: 'FLOW_VERSION_UNKNOWN',
          message: `The flow ${FLOW_WITH_DRAFT} came back as a version that is Draft. The org lists no flow under the name of its file, so it is not asked for by the number of its active version. It is analysed as it came, and it is not known whether another version of it is active.`,
          component: KEY,
          details: { flow: FLOW_WITH_DRAFT, state: 'Draft', reason: 'not-listed' },
        },
      ]);
      expect(draftPlaces(flowFile(dir, 1) ?? '')).toEqual({ ofDraft: 3, ofActive: 0, all: 3 });
    });
  },
);
