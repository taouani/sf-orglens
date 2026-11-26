/**
 * Snapshots of an org, against a mock org on this machine that holds the
 * fixture project or a part of it (`helpers/mock-org.ts`,
 * `helpers/mock-metadata.ts`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot, type OrgSnapshotTuning, type SnapshotProgress } from '../src/api/org-snapshot.ts';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { getBlob } from '../src/store/blobs.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { besidesKnownGap } from './helpers/known-gap.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { mockDependencies } from './helpers/mock-dependencies.ts';
import { metadataFromSource, soapFault, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';
import {
  storedComponents,
  storedReferences,
  withoutPlace,
  type StoredComponent,
  type StoredReference,
} from './helpers/stored-analysis.ts';

/** The package directory of the fixture project. */
const WHOLE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
/**
 * The part of the fixture project that the mock org of these tests holds: its classes, its trigger and three of its
 * objects with their fields and rules. An org retrieves that as 16 components by name, in 29 files. The tests of how
 * a retrieve is split, repeated and continued count with these two numbers, so the part does not grow when the
 * project gets a new type. One test takes a snapshot of an org that holds the whole project.
 */
const PART = ['classes', 'triggers', 'objects/Account', 'objects/Invoice__c', 'objects/Invoice_Line__c'];
/**
 * What these folders got with the fixtures of Phases 2 and 3: classes and a trigger, a field set, record types and a
 * rule. It is left out, so that the two numbers stay.
 */
const NOT_OF_THE_PART = [
  ...[
    'AccountInvoices',
    'EmailNotifier',
    'InvoiceEvents',
    'InvoiceNotifications',
    'InvoiceNotifier',
    'InvoicePageController',
    'InvoicePageExtension',
    'InvoicePaidAction',
    'InvoicePricing',
    'InvoicePricingTest',
    'InvoiceQueries',
    'InvoiceReminderJob',
    'InvoiceReminderSchedule',
    'RecordObjectAction',
    'StandardPricing',
    'TaskNotifier',
  ].flatMap((name) => [`classes/${name}.cls`, `classes/${name}.cls-meta.xml`]),
  'triggers/InvoiceLineTrigger.trigger',
  'triggers/InvoiceLineTrigger.trigger-meta.xml',
  'objects/Invoice__c/fieldSets',
  'objects/Invoice__c/recordTypes',
  'objects/Invoice__c/validationRules/Credit_Note_Is_Negative.validationRule-meta.xml',
];
const ORG_ID = '00Dxx0000000001EAA';
const OTHER_ORG_ID = '00Dxx0000000002EAA';
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

const CONFIG = `schema_version = 1

[sources.prod]
kind = "org"
org_id = "${ORG_ID}"
`;

const dirs = tempDirs();
const copies = tempDirs();
let mock: MockOrg;
let metadata: MockMetadata;
/** A copy of the part of the project: the folder the mock org is made from. */
let FIXTURE: string;
/** The files of the part as a repository holds them, without the package directory. */
let fixtureFiles: string[];
/** The files of the whole project, in the same form. */
let wholeFiles: string[];
/**
 * The part with one component of a type outside the logic tier: a static resource, which is two files. It is
 * written here, because the fixture project holds only types of the logic tier.
 */
let WITH_RESOURCE: string;
/** The part with the file of custom labels, and no label in it. */
let WITHOUT_LABEL: string;
const RESOURCE_FILES = ['staticresources/Notice.resource-meta.xml', 'staticresources/Notice.txt'];
/**
 * The part with components that an org lists under another name than they come back with: a document, and a record
 * type, a matching rule and a duplicate rule of person accounts. The org lists the three under the object `Account`,
 * so it is asked for the matching rules of that object, and has one. The names are made up.
 */
let WITH_OTHER_NAMES: string;
const OTHER_NAME_FILES: Readonly<Record<string, string>> = {
  'documents/Assets.documentFolder-meta.xml': `<DocumentFolder xmlns="http://soap.sforce.com/2006/04/metadata">
    <accessType>Public</accessType>
    <name>Assets</name>
    <publicFolderAccess>ReadOnly</publicFolderAccess>
</DocumentFolder>
`,
  'documents/Assets/Logo.document-meta.xml': `<Document xmlns="http://soap.sforce.com/2006/04/metadata">
    <internalUseOnly>false</internalUseOnly>
    <name>Logo</name>
    <public>true</public>
</Document>
`,
  'documents/Assets/Logo.png': 'not a picture\n',
  'duplicateRules/PersonAccount.Same_Person.duplicateRule-meta.xml': `<DuplicateRule xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionOnInsert>Allow</actionOnInsert>
    <actionOnUpdate>Allow</actionOnUpdate>
    <isActive>true</isActive>
    <masterLabel>Same person</masterLabel>
    <securityOption>EnforceSharingRules</securityOption>
    <sortOrder>1</sortOrder>
</DuplicateRule>
`,
  'matchingRules/Account.matchingRule-meta.xml': `<MatchingRules xmlns="http://soap.sforce.com/2006/04/metadata">
    <matchingRules>
        <fullName>By_Name</fullName>
        <label>By name</label>
        <matchingRuleItems>
            <fieldName>Name</fieldName>
            <matchingMethod>Exact</matchingMethod>
        </matchingRuleItems>
        <ruleStatus>Active</ruleStatus>
    </matchingRules>
</MatchingRules>
`,
  'matchingRules/PersonAccount.matchingRule-meta.xml': `<MatchingRules xmlns="http://soap.sforce.com/2006/04/metadata">
    <matchingRules>
        <fullName>Person_By_Name</fullName>
        <label>Person by name</label>
        <matchingRuleItems>
            <fieldName>LastName</fieldName>
            <matchingMethod>Exact</matchingMethod>
        </matchingRuleItems>
        <ruleStatus>Active</ruleStatus>
    </matchingRules>
</MatchingRules>
`,
  'objects/PersonAccount/recordTypes/Client.recordType-meta.xml': `<RecordType xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Client</fullName>
    <active>true</active>
    <label>Client</label>
</RecordType>
`,
};

/**
 * The part with reports and a dashboard in folders inside folders. An org lists such a folder by its own name and
 * what lies in it with that name, and hands both out under the whole path. Two documents, which come back under
 * another name too, are there for the order of the notes: by rule, and in each by the listed names, by code unit.
 * The names are made up.
 */
let WITH_NESTED_FOLDERS: string;
const folderFile = (type: string, name: string): string => `<${type} xmlns="http://soap.sforce.com/2006/04/metadata">
    <accessType>Public</accessType>
    <name>${name}</name>
    <publicFolderAccess>ReadOnly</publicFolderAccess>
</${type}>
`;
const reportFile = (name: string): string => `<Report xmlns="http://soap.sforce.com/2006/04/metadata">
    <columns>
        <field>ACCOUNT.NAME</field>
    </columns>
    <format>Tabular</format>
    <name>${name}</name>
    <reportType>AccountList</reportType>
    <scope>organization</scope>
    <showDetails>true</showDetails>
</Report>
`;
const documentFile = (name: string): string => `<Document xmlns="http://soap.sforce.com/2006/04/metadata">
    <internalUseOnly>false</internalUseOnly>
    <name>${name}</name>
    <public>true</public>
</Document>
`;
const NESTED_FOLDER_FILES: Readonly<Record<string, string>> = {
  'dashboards/Board.dashboardFolder-meta.xml': folderFile('DashboardFolder', 'Board'),
  'documents/Assets.documentFolder-meta.xml': folderFile('DocumentFolder', 'Assets'),
  'documents/Assets/Logo-dark.document-meta.xml': documentFile('Logo dark'),
  'documents/Assets/Logo-dark.png': 'not a picture\n',
  'documents/Assets/Logo.document-meta.xml': documentFile('Logo'),
  'documents/Assets/Logo.png': 'not a picture\n',
  'dashboards/Board/Inner.dashboardFolder-meta.xml': folderFile('DashboardFolder', 'Inner'),
  'dashboards/Board/Inner/Overview.dashboard-meta.xml': `<Dashboard xmlns="http://soap.sforce.com/2006/04/metadata">
    <backgroundEndColor>#FFFFFF</backgroundEndColor>
    <backgroundFadeDirection>Diagonal</backgroundFadeDirection>
    <backgroundStartColor>#FFFFFF</backgroundStartColor>
    <dashboardType>LoggedInUser</dashboardType>
    <textColor>#000000</textColor>
    <title>Overview</title>
    <titleColor>#000000</titleColor>
    <titleSize>12</titleSize>
</Dashboard>
`,
  'reports/Finance.reportFolder-meta.xml': folderFile('ReportFolder', 'Finance'),
  'reports/Finance/Quarterly.reportFolder-meta.xml': folderFile('ReportFolder', 'Quarterly'),
  'reports/Finance/Quarterly/Archive.reportFolder-meta.xml': folderFile('ReportFolder', 'Archive'),
  'reports/Finance/Quarterly/Archive/Old_Revenue.report-meta.xml': reportFile('Old revenue'),
  'reports/Finance/Quarterly/Revenue.report-meta.xml': reportFile('Revenue'),
  'reports/Finance/Totals.report-meta.xml': reportFile('Totals'),
  'reports/Finance/budget.reportFolder-meta.xml': folderFile('ReportFolder', 'budget'),
};

beforeAll(async () => {
  mock = await startMockOrg();
  FIXTURE = join(copies.next(), 'force-app');
  for (const folder of PART) {
    cpSync(join(WHOLE, 'main/default', folder), join(FIXTURE, 'main/default', folder), { recursive: true });
  }
  for (const path of NOT_OF_THE_PART) rmSync(join(FIXTURE, 'main/default', path), { recursive: true });
  fixtureFiles = walk(join(FIXTURE, 'main/default'));
  wholeFiles = walk(join(WHOLE, 'main/default'));
  WITH_RESOURCE = join(copies.next(), 'force-app');
  cpSync(FIXTURE, WITH_RESOURCE, { recursive: true });
  mkdirSync(join(WITH_RESOURCE, 'main/default/staticresources'));
  writeFileSync(
    join(WITH_RESOURCE, 'main/default/staticresources/Notice.resource-meta.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Private</cacheControl>
    <contentType>text/plain</contentType>
</StaticResource>
`,
  );
  writeFileSync(join(WITH_RESOURCE, 'main/default/staticresources/Notice.txt'), 'Invoices are due in 30 days.\n');
  WITH_OTHER_NAMES = join(copies.next(), 'force-app');
  cpSync(FIXTURE, WITH_OTHER_NAMES, { recursive: true });
  for (const [path, text] of Object.entries(OTHER_NAME_FILES)) {
    const file = join(WITH_OTHER_NAMES, 'main/default', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path.endsWith('.xml') ? `<?xml version="1.0" encoding="UTF-8"?>\n${text}` : text);
  }
  WITH_NESTED_FOLDERS = join(copies.next(), 'force-app');
  cpSync(FIXTURE, WITH_NESTED_FOLDERS, { recursive: true });
  for (const [path, text] of Object.entries(NESTED_FOLDER_FILES)) {
    const file = join(WITH_NESTED_FOLDERS, 'main/default', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path.endsWith('.xml') ? `<?xml version="1.0" encoding="UTF-8"?>\n${text}` : text);
  }
  WITHOUT_LABEL = join(copies.next(), 'force-app');
  cpSync(FIXTURE, WITHOUT_LABEL, { recursive: true });
  mkdirSync(join(WITHOUT_LABEL, 'main/default/labels'));
  writeFileSync(
    join(WITHOUT_LABEL, 'main/default/labels/CustomLabels.labels-meta.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata"/>\n',
  );
});
afterAll(async () => {
  await mock.close();
  copies.cleanUp();
});
beforeEach(async () => {
  metadata = await metadataFromSource(FIXTURE);
  mock.metadata = metadata;
  // The org has the Dependency API, and the API knows no reference. A snapshot that asks it gets an answer.
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
  mock.refreshTokens.clear();
  mock.versions.splice(0, Infinity, '65.0', '66.0', '9.0');
  mock.key = null;
  mock.intercept = null;
  mock.stall = false;
  await forgetCliLogins();
  dirs.cleanUp();
});

/** What a snapshot of the mock org holds: the files of the part, and the file of the standard object it has fields of. */
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

/**
 * The issues of the reading. The part of the project that these tests retrieve holds one formula with a
 * relationship that no file of the part defines, so its analysis has a warning of its own, which is not what
 * a test about the reading looks at.
 */
const ofReading = (report: CoverageReport): Omit<CoverageReport['issues'][number], 'stage' | 'component'>[] =>
  report.issues
    .filter((issue) => issue.stage === 'read')
    .map(({ severity, code, message, details }) => ({ severity, code, message, details }));
/** A report without the moment of its analysis, which is the one thing a second analysis changes. */
const timeless = (report: CoverageReport): unknown => ({
  ...report,
  analysis: report.analysis === null ? null : { ...report.analysis, analysedAt: 'TIME' },
});
const codes = (report: CoverageReport): string[] => ofReading(report).map((issue) => `${issue.severity} ${issue.code}`);
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

    /**
     * Takes a snapshot the way the workspace does, with pauses a test can afford and the numbers it sets.
     *
     * The Dependency API is left unasked unless a test asks for it: these tests count the requests of a
     * reading of metadata. What the cross-check does to a snapshot is tested in `org-cross-check.test.ts`.
     */
    async function snap(
      dir: string,
      options: {
        restart?: boolean;
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
        restart: options.restart,
        crossCheck: options.crossCheck ?? false,
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
      // This org holds the whole project, with every type it has. The project has only fields of two standard
      // objects, and the org hands out the file of each of them. It keeps a definition of each of the seven flows.
      metadata = await metadataFromSource(WHOLE);
      mock.metadata = metadata;
      const flows = wholeFiles.filter((path) => path.startsWith('flows/'));
      expect(flows).toHaveLength(7);
      const expected = [
        ...wholeFiles,
        ...flows.map((path) =>
          path.replace(/^flows\/(.*)\.flow-meta\.xml$/, 'flowDefinitions/$1.flowDefinition-meta.xml'),
        ),
        'objects/Account/Account.object-meta.xml',
        'objects/User/User.object-meta.xml',
      ].sort();
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
        files: expected.length,
      });
      expect(report.snapshot.startedAt).toMatch(UTC);
      expect(report.snapshot.finishedAt).toMatch(UTC);
      // Neither the reading nor the analysis has anything to say about the whole project, but for the one
      // path of a flow that the answer key calls unknown.
      expect(besidesKnownGap(report.issues)).toEqual([]);
      expect(report.analysis?.complete).toBe(true);
      expect(report.types.filter((type) => type.listed > 0)).toEqual([
        { type: 'ApexClass', listed: 28, retrieved: 28, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'ApexPage', listed: 2, retrieved: 2, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'ApexTrigger', listed: 2, retrieved: 2, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'AuraDefinitionBundle', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'CustomField', listed: 58, retrieved: 58, analysed: 58, listing: 'ok', note: null, packaged: 0 },
        { type: 'CustomLabel', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'CustomLabels', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'CustomMetadata', listed: 5, retrieved: 5, analysed: 5, listing: 'ok', note: null, packaged: 0 },
        { type: 'CustomObject', listed: 8, retrieved: 8, analysed: 8, listing: 'ok', note: null, packaged: 0 },
        { type: 'CustomPermission', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'EmailFolder', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'EmailTemplate', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
        { type: 'ExternalCredential', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'FieldSet', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
        // A flow is counted with its 57 elements.
        { type: 'Flow', listed: 7, retrieved: 7, analysed: 64, listing: 'ok', note: null, packaged: 0 },
        { type: 'FlowDefinition', listed: 7, retrieved: 7, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'GlobalValueSet', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        {
          type: 'LightningComponentBundle',
          listed: 2,
          retrieved: 2,
          analysed: 0,
          listing: 'ok',
          note: null,
          packaged: 0,
        },
        { type: 'NamedCredential', listed: 1, retrieved: 1, analysed: 0, listing: 'ok', note: null, packaged: 0 },
        { type: 'QuickAction', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
        { type: 'RecordType', listed: 2, retrieved: 2, analysed: 2, listing: 'ok', note: null, packaged: 0 },
        { type: 'ReportType', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
        { type: 'ValidationRule', listed: 11, retrieved: 11, analysed: 11, listing: 'ok', note: null, packaged: 0 },
        { type: 'Workflow', listed: 2, retrieved: 2, analysed: 2, listing: 'ok', note: null, packaged: 0 },
        { type: 'WorkflowAlert', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
        { type: 'WorkflowFieldUpdate', listed: 3, retrieved: 3, analysed: 3, listing: 'ok', note: null, packaged: 0 },
        {
          type: 'WorkflowOutboundMessage',
          listed: 1,
          retrieved: 1,
          analysed: 1,
          listing: 'ok',
          note: null,
          packaged: 0,
        },
        { type: 'WorkflowRule', listed: 4, retrieved: 4, analysed: 4, listing: 'ok', note: null, packaged: 0 },
        { type: 'WorkflowTask', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
      ]);
      // A type the org describes and has nothing of is in the report as well: it was asked for.
      expect(typeOf(report, 'ListView')).toEqual({
        type: 'ListView',
        listed: 0,
        retrieved: 0,
        analysed: 0,
        listing: 'ok',
        note: null,
        packaged: 0,
      });

      // The files of the folder, and the same content for what Salesforce does not rewrite.
      expect(stored(dir, 1)).toEqual(expected);
      for (const path of wholeFiles.filter((one) => /\.(?:cls|trigger)$/.test(one))) {
        expect(content(dir, 1, path).equals(readFileSync(join(WHOLE, 'main/default', path))), path).toBe(true);
      }

      expect(events[0]).toEqual({ step: 'connected', apiVersion: '66.0' });
      expect(events.filter((event) => event.step === 'listing').length).toBeGreaterThan(5);
      const fromPlan = events.slice(events.findIndex((event) => event.step === 'planned'));
      expect(fromPlan.slice(0, 3)).toEqual([
        { step: 'planned', snapshot: 1, components: 156, chunks: 1 },
        { step: 'retrieved', snapshot: 1, done: 1, chunks: 1 },
        // Before the first request to the Dependency API.
        { step: 'cross-checking', snapshot: 1, requests: 0, rows: 0 },
      ]);
      // After every query for rows, none of which gave a row here: the query for every row, one for each of the 17
      // types that are known to refer, and one for the rest (decision record 0069). The two queries for the versions
      // of the flows came before them, and count with them (decision records 0067 and 0078).
      expect(fromPlan.slice(3, -1)).toEqual(
        Array.from({ length: 19 }, (_, at) => ({ step: 'cross-checking', snapshot: 1, requests: at + 3, rows: 0 })),
      );
      expect(fromPlan.at(-1)).toEqual({ step: 'analysing', snapshot: 1 });
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
        ).toEqual({ items: 156, listed: 156, retrieved: 156, ids: 156, dates: 156 });
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
      // Analysed again, it gives the same, and keeps the lines of the types the org listed with nothing in them.
      expect(timeless(await workspace.analyse('prod'))).toEqual(timeless(report));
    });

    it('is analysed to the components and the references that the folder of the project gives', async () => {
      metadata = await metadataFromSource(WHOLE);
      mock.metadata = metadata;
      // One workspace with the org and with the folder the org was made from.
      const dir = workspaceDir(`${CONFIG}\n[sources.repo]\nkind = "git"\nrepo = "project"\n`);
      cpSync(join(FIXTURES_DIR, 'billing-sfdx'), join(dir, 'project'), { recursive: true });
      const workspace = await openWorkspace({ root: dir, env });
      const events: SnapshotProgress[] = [];
      const fromOrg = await workspace.snapshot('prod', { onProgress: (event) => events.push(event) });
      const fromFolder = await workspace.snapshot('repo');
      expect([fromOrg.snapshot, fromFolder.snapshot]).toMatchObject([
        { id: 1, status: 'complete' },
        { id: 2, status: 'complete' },
      ]);
      // The analysis is the last thing a snapshot of an org says it does.
      expect(events.at(-1)).toEqual({ step: 'analysing', snapshot: 1 });

      // An org keeps a definition of every flow, which the folder of the project does not have. It is a component
      // of a type that is not analysed, and refers to nothing.
      const definitions = reading(dir, (store) => storedComponents(store, 1))
        .map((one) => one.key)
        .filter((key) => key.startsWith('FlowDefinition:'));
      expect(definitions).toHaveLength(7);
      const org = reading(dir, (store) => ({
        components: storedComponents(store, 1).filter((one) => !one.key.startsWith('FlowDefinition:')),
        references: storedReferences(store, 1),
      }));
      const folder = reading(dir, (store) => ({
        components: storedComponents(store, 2),
        references: storedReferences(store, 2),
      }));

      // The same keys and the same references. A line of a reference is compared within one snapshot only: an
      // org rewrites the files.
      expect(org.components.map((one) => one.key)).toEqual(folder.components.map((one) => one.key));
      expect(org.components).toHaveLength(206);
      expect(org.references.map(withoutPlace).sort()).toEqual(folder.references.map(withoutPlace).sort());
      expect(org.references).toHaveLength(334);
      // The flows among them: 7 flows with 57 elements, and the 129 references of Phase 2 the answer key holds.
      const ofFlow = (one: { key?: string; from?: string }): boolean => (one.key ?? one.from ?? '').startsWith('Flow:');
      expect(org.components.filter(ofFlow)).toHaveLength(64);
      expect(org.references.filter(ofFlow)).toHaveLength(129);
      // Every reference has its place in a file of its own snapshot.
      const orgFiles = new Set(stored(dir, 1));
      const folderFiles = new Set(stored(dir, 2));
      expect(org.references.filter((one) => one.file === null || !orgFiles.has(one.file) || one.line === null)).toEqual(
        [],
      );
      expect(
        folder.references.filter((one) => one.file === null || !folderFiles.has(one.file) || one.line === null),
      ).toEqual([]);
      expect(org.components.map((one) => one.attrs)).toEqual(
        folder.components.map((one) => (one.path === null ? {} : one.attrs)),
      );

      // The org hands out a file for the two standard objects, which the folder does not have. So the objects
      // are defined in the snapshot of the org, and a reference to one of them is resolved there: the lookup of
      // a field, and the record a flow updates.
      const undefinedIn = (components: readonly StoredComponent[]): string[] =>
        components.filter((one) => one.path === null).map((one) => one.key);
      const lookupToAccount = (references: readonly StoredReference[]): string[] =>
        references.filter((one) => one.to === 'CustomObject:account').map((one) => one.resolution);
      expect(undefinedIn(org.components)).toEqual([]);
      expect(undefinedIn(folder.components)).toEqual(['CustomObject:account', 'CustomObject:user']);
      expect(lookupToAccount(org.references)).toEqual(['resolved', 'resolved']);
      expect(lookupToAccount(folder.references)).toEqual(['external', 'external']);

      // What the reports say about it: no issue, and the two objects more that the org has a file of.
      // The 12 components of the two files of workflow rules are read as XML too, with 21 references, and so are
      // the 2 record types, the field set and the 5 records of custom metadata, with 33, and the email template,
      // the report type and the quick action, with 26.
      const xml = { failedFiles: 0, references: 110, unresolved: 0, pathsNotFollowed: 0 };
      // The formulas of 35 fields and rules, of 7 elements of flows, of 2 workflow rules and 2 field updates and of
      // the quick action: 82 names, 19, 12 and 1. Of the 129 references of flows, the other 110 are of the reader
      // of flows. One path of a flow is not followed.
      const formula = { components: 47, failedFiles: 0, references: 114, unresolved: 0, pathsNotFollowed: 0 };
      const flow = { components: 64, failedFiles: 0, references: 110, unresolved: 0, pathsNotFollowed: 1 };
      expect(ofReading(fromOrg)).toEqual([]);
      expect(fromOrg.analysis).toEqual({
        engineVersion: fromOrg.snapshot.engineVersion,
        analysedAt: expect.stringMatching(UTC) as string,
        components: 213,
        references: 334,
        complete: true,
        origins: [
          { origin: 'parser:xml', components: 100, ...xml },
          { origin: 'parser:formula', ...formula },
          { origin: 'parser:flow', ...flow },
        ],
      });
      expect(fromFolder.analysis).toMatchObject({
        components: 206,
        references: 334,
        complete: true,
        origins: [
          { origin: 'parser:xml', components: 98, ...xml },
          { origin: 'parser:formula', ...formula },
          { origin: 'parser:flow', ...flow },
        ],
      });
      const analysed = (report: CoverageReport): Record<string, number> =>
        Object.fromEntries(report.types.filter((type) => type.analysed > 0).map((type) => [type.type, type.analysed]));
      // A flow is counted with its elements. The other types of Phase 2:
      const ofPhase2 = {
        CustomMetadata: 5,
        EmailTemplate: 1,
        FieldSet: 1,
        QuickAction: 1,
        RecordType: 2,
        ReportType: 1,
        Workflow: 2,
        WorkflowAlert: 1,
        WorkflowFieldUpdate: 3,
        WorkflowOutboundMessage: 1,
        WorkflowRule: 4,
        WorkflowTask: 1,
      };
      expect(analysed(fromOrg)).toEqual({
        CustomField: 58,
        CustomObject: 8,
        Flow: 64,
        ValidationRule: 11,
        ...ofPhase2,
      });
      expect(analysed(fromFolder)).toEqual({
        CustomField: 58,
        CustomObject: 6,
        Flow: 64,
        ValidationRule: 11,
        ...ofPhase2,
      });
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
      expect(ofReading(report)[0]).toEqual({
        severity: 'info',
        code: 'CHUNK_SPLIT',
        message:
          'A retrieve of 16 components failed and was tried again in two halves. LIMIT_EXCEEDED: Too many files in retrieve call, limit is 10.',
        details: {
          members: 16,
          said: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is 10.',
          code: 'LIMIT_EXCEEDED',
        },
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
      expect(typeOf(report, 'CustomField')).toMatchObject({ listed: 48, retrieved: 48 });
      const failed = ofReading(report).filter((issue) => issue.code === 'RETRIEVE_FAILED');
      expect(failed).toHaveLength(13);
      expect(failed[0]).toEqual({
        severity: 'error',
        code: 'RETRIEVE_FAILED',
        message:
          'Salesforce did not hand out ApexClass DynamicAccess. LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1.',
        details: {
          count: 1,
          components: ['ApexClass DynamicAccess'],
          types: ['ApexClass'],
          said: 'LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1.',
          code: 'LIMIT_EXCEEDED',
          tier: 'logic',
        },
      });
      const missing = ofReading(report).filter((issue) => issue.code === 'NOT_RETRIEVED');
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
          code: 'LIMIT_EXCEEDED',
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
        packaged: 0,
      });
      expect(ofReading(report)).toEqual([
        {
          severity: 'error',
          code: 'LISTING_FAILED',
          message:
            'The org did not say which components of the type ApexClass it has. INVALID_TYPE: Cannot use: ApexClass in this organization',
          details: { type: 'ApexClass', code: 'INVALID_TYPE', tier: 'logic' },
        },
      ]);
      expect(stored(dir, 1)).toEqual(expectedFiles().filter((path) => !path.startsWith('classes/')));
      // A second analysis keeps the line of the type and what the org said about it.
      const again = await (await openWorkspace({ root: dir, env })).analyse('prod');
      expect(typeOf(again, 'ApexClass')).toEqual(typeOf(report, 'ApexClass'));
      expect(timeless(again)).toEqual(timeless(report));
    });

    it('keeps a snapshot that has ended when its analysis fails, and does not continue it', async () => {
      const dir = workspaceDir();
      const workspace = await openWorkspace({ root: dir, env });
      await workspace.snapshot('prod');
      // From here on the database refuses to store an analysis.
      const direct = new DatabaseSync(databaseOf(dir));
      direct.exec(
        `CREATE TRIGGER refuse_analysis BEFORE INSERT ON snapshot_analysis
         BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
      );
      direct.close();

      const failed = await workspace.snapshot('prod').then(
        () => undefined,
        (error: unknown) =>
          (error as { toJSON: () => { code: string; message: string; hint?: string; details?: unknown } }).toJSON(),
      );
      expect(failed).toMatchObject({ code: 'STORE_FAILED', details: { source: 'prod', snapshot: 2 } });
      expect(failed?.message).toMatch(/^Snapshot #2 of the source "prod" is stored, and its analysis failed\. /);
      expect(failed?.hint).toMatch(/Analyse it with: orglens analyse prod --snapshot 2$/);
      // The snapshot has ended, so there is nothing to continue, and no work folder or lock is left.
      expect((await workspace.status()).sources[0]).toMatchObject({
        latestSnapshot: { id: 2, status: 'complete', analysis: null },
        unfinishedSnapshot: null,
      });
      expect(existsSync(lockOf(dir))).toBe(false);
      expect(existsSync(workFolderOf(dir))).toBe(false);
      // The log says that it is stored and not analysed, not that it stopped.
      const logs = join(dir, '.orglens', 'logs');
      const events = readdirSync(logs)
        .flatMap((file) => readFileSync(join(logs, file), 'utf8').trim().split('\n'))
        .map((line) => (JSON.parse(line) as { event: string }).event)
        .filter((event) => event.startsWith('snapshot.'));
      expect(events).toEqual(['snapshot.taken', 'snapshot.not_analysed']);

      // The next snapshot is a new one, and `analyse` analyses this one once the database lets it.
      const db = new DatabaseSync(databaseOf(dir));
      db.exec('DROP TRIGGER refuse_analysis');
      db.close();
      expect((await workspace.analyse('prod', { snapshot: 2 })).analysis).toMatchObject({ complete: true });
      expect((await workspace.snapshot('prod')).snapshot.id).toBe(3);
    });

    it('names a component the org lists and does not hand out, with what Salesforce said about it', async () => {
      metadata.withheld.add('ApexClass:InvoiceService');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('partial');
      expect(typeOf(report, 'ApexClass')).toMatchObject({ listed: 12, retrieved: 11 });
      expect(ofReading(report)).toEqual([
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
          details: { type: 'ApexClass', count: 1, components: ['InvoiceService'], tier: 'logic' },
        },
      ]);
      expect(stored(dir, 1)).toEqual(expectedFiles().filter((path) => !path.startsWith('classes/InvoiceService.')));
    });

    it('calls the snapshot partial when an action of a workflow rule that the org listed does not come back', async () => {
      // The actions of a workflow rule are analysed, and so are of the logic tier (decision record 0068). This org
      // lists the task of the workflow rules of Invoice__c and hands out their file without it.
      metadata = await metadataFromSource(WHOLE);
      mock.metadata = metadata;
      const file = readFileSync(join(WHOLE, 'main/default/workflows/Invoice__c.workflow-meta.xml'), 'utf8');
      const withoutTask = file.replace(/ {4}<tasks>[\s\S]*<\/tasks>\n/, '');
      expect(withoutTask).not.toContain('Follow_Up_On_Void</fullName>');
      metadata.handedOut.set('Workflow:Invoice__c', { path: 'workflows/Invoice__c.workflow', text: withoutTask });
      const report = await snap(workspaceDir());

      expect(report.snapshot.status).toBe('partial');
      expect(typeOf(report, 'WorkflowTask')).toMatchObject({ listed: 1, retrieved: 0 });
      expect(codes(report).filter((code) => code.startsWith('error'))).toEqual(['error NOT_RETRIEVED']);
      expect(ofReading(report)).toContainEqual({
        severity: 'error',
        code: 'NOT_RETRIEVED',
        message:
          '1 component of the type WorkflowTask that the org listed did not come back. The first: Invoice__c.Follow_Up_On_Void',
        details: { type: 'WorkflowTask', count: 1, components: ['Invoice__c.Follow_Up_On_Void'], tier: 'logic' },
      });
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
        // The object that was not listed is analysed like the two that were.
        analysed: 3,
        listing: 'ok',
        note: '1 component more came back that the org had not listed.',
        packaged: 0,
      });
      expect(ofReading(report)).toEqual([
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

    describe('with a parent the org does not list and Salesforce cannot find', () => {
      beforeEach(() => {
        metadata.unlistedParents.add('CustomObject:Account');
        metadata.withheld.add('CustomObject:Account');
      });

      const PARTS = [
        'CustomField:Account.Billing_Region__c',
        'CustomField:Account.Credit_Limit__c',
        'CustomField:Account.Is_Key_Account__c',
        'CustomField:Account.Primary_Contact__c',
        'CustomField:Account.Risk_Score__c',
        'CustomField:Account.Tier__c',
        'ValidationRule:Account.Key_Account_Needs_Contact',
      ];
      const ASKED_BY_NAME = {
        severity: 'info',
        code: 'PARTS_ASKED_BY_NAME',
        message:
          'Salesforce cannot find 1 component that the org does not list and lists parts of. 7 parts are asked for by their own names in another retrieve. The first component: CustomObject Account',
        details: { count: 1, components: ['CustomObject Account'], parts: 7 },
      };
      const CANNOT_FIND = "Entity of type 'CustomObject' named 'Account' cannot be found";

      it('asks for its parts by their own names in a retrieve of their own, and is complete', async () => {
        const dir = workspaceDir();
        const events: SnapshotProgress[] = [];
        const report = await snap(dir, { onProgress: (event) => events.push(event) });

        expect(report.snapshot.status).toBe('complete');
        expect(metadata.retrieves).toHaveLength(2);
        expect(metadata.retrieves[0]).toContain('CustomObject:Account');
        expect(metadata.retrieves[1]).toEqual(PARTS);
        expect(stored(dir, 1)).toEqual(expectedFiles());
        expect(chunks(dir, 1)).toEqual(['0 done - 1', '1 done - 1']);
        expect(
          events
            .filter((event) => event.step === 'retrieved')
            .map((event) => `${String(event.done)}/${String(event.chunks)}`),
        ).toEqual(['1/2', '2/2']);
        expect(typeOf(report, 'CustomField')).toMatchObject({ listed: 48, retrieved: 48 });
        expect(typeOf(report, 'ValidationRule')?.retrieved).toBe(typeOf(report, 'ValidationRule')?.listed);
        expect(ofReading(report)).toEqual([
          ASKED_BY_NAME,
          {
            severity: 'warning',
            code: 'RETRIEVE_MESSAGES',
            message: `Salesforce made 1 remark about a retrieve. The first: ${CANNOT_FIND}`,
            details: { count: 1, messages: [CANNOT_FIND] },
          },
          // The file of the parent came back with these parts alone, and counts as the parent.
          {
            severity: 'info',
            code: 'UNLISTED_COMPONENTS',
            message:
              '1 component of the type CustomObject came back that the org had not listed. It is in the snapshot. The first: Account',
            details: { type: 'CustomObject', count: 1, components: ['Account'] },
          },
        ]);
      });

      it('leaves a part missing that Salesforce cannot find by its own name either, and asks no third time', async () => {
        metadata.withheld.add('CustomField:Account.Tier__c');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('partial');
        expect(metadata.retrieves).toHaveLength(2);
        expect(metadata.retrieves[1]).toEqual(PARTS);
        expect(typeOf(report, 'CustomField')).toMatchObject({ listed: 48, retrieved: 47 });
        expect(codes(report)).toEqual([
          'info PARTS_ASKED_BY_NAME',
          'warning RETRIEVE_MESSAGES',
          'warning RETRIEVE_MESSAGES',
          'error NOT_RETRIEVED',
          'info UNLISTED_COMPONENTS',
        ]);
        expect(ofReading(report).find((issue) => issue.code === 'NOT_RETRIEVED')?.details).toEqual({
          type: 'CustomField',
          count: 1,
          components: ['Account.Tier__c'],
          tier: 'logic',
        });
        expect(stored(dir, 1)).toEqual(
          expectedFiles().filter((path) => path !== 'objects/Account/fields/Tier__c.field-meta.xml'),
        );
      });

      it('splits the retrieve of the parts like any other when it fails, and names the file that came twice', async () => {
        // The org refuses a retrieve that asks for these two fields together.
        mock.intercept = (request) =>
          request.body.includes('<retrieve>') &&
          request.body.includes('<members>Account.Billing_Region__c</members>') &&
          request.body.includes('<members>Account.Tier__c</members>')
            ? soapFault('UNKNOWN_EXCEPTION', 'An unexpected error occurred.')
            : undefined;
        const dir = workspaceDir();
        const report = await snap(dir, { tuning: { pollMaxMs: 5 } });

        expect(report.snapshot.status).toBe('complete');
        expect(metadata.retrieves.slice(1)).toEqual([PARTS.slice(0, 4), PARTS.slice(4)]);
        // Every part is a file of its own, so the second half does not take the place of the first.
        expect(stored(dir, 1)).toEqual(expectedFiles());
        expect(typeOf(report, 'CustomField')).toMatchObject({ listed: 48, retrieved: 48 });
        expect(codes(report)).toEqual([
          'info PARTS_ASKED_BY_NAME',
          'warning RETRIEVE_MESSAGES',
          'info CHUNK_SPLIT',
          'warning FILE_RETRIEVED_TWICE',
          'info UNLISTED_COMPONENTS',
        ]);
        // Only the file of the parent came twice, and it holds nothing of the parent either time.
        expect(ofReading(report).find((issue) => issue.code === 'FILE_RETRIEVED_TWICE')?.details).toEqual({
          count: 1,
          paths: ['objects/Account/Account.object-meta.xml'],
        });
        expect(chunks(dir, 1)).toEqual(['0 done - 1', '1 done - 1', '2 done - 1']);
      });

      it('names the parts of a retrieve that fails down to the last half as not retrieved', async () => {
        mock.intercept = (request) =>
          request.body.includes('<retrieve>') && request.body.includes('<members>Account.Tier__c</members>')
            ? soapFault('UNKNOWN_EXCEPTION', 'An unexpected error occurred.')
            : undefined;
        const dir = workspaceDir();
        const report = await snap(dir, { tuning: { pollMaxMs: 5 } });

        expect(report.snapshot.status).toBe('partial');
        // The field that fails every retrieve it is in stays missing alone.
        expect(typeOf(report, 'CustomField')).toMatchObject({ listed: 48, retrieved: 47 });
        expect(typeOf(report, 'ValidationRule')?.retrieved).toBe(typeOf(report, 'ValidationRule')?.listed);
        expect(ofReading(report).find((issue) => issue.code === 'RETRIEVE_FAILED')?.details).toMatchObject({
          count: 1,
          components: ['CustomField Account.Tier__c'],
          tier: 'logic',
        });
        expect(ofReading(report).find((issue) => issue.code === 'NOT_RETRIEVED')?.details).toMatchObject({
          type: 'CustomField',
          components: ['Account.Tier__c'],
        });
      });

      it('asks once for the parts when Salesforce makes its remark twice, and not again when it makes it about their retrieve', async () => {
        // Every answer about a retrieve that has ended carries the remark about the object once more.
        mock.intercept = async (request) => {
          if (!request.body.includes('<checkRetrieveStatus>')) return undefined;
          const answer = await metadata.answer(request.body);
          const remark = `<messages><fileName>unpackaged/package.xml</fileName><problem>${CANNOT_FIND.replaceAll("'", '&apos;')}</problem></messages>`;
          return { ...answer, body: answer.body.replace('<done>true</done>', `${remark}<done>true</done>`) };
        };
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('complete');
        expect(metadata.retrieves).toHaveLength(2);
        expect(metadata.retrieves[1]).toEqual(PARTS);
        expect(ofReading(report).filter((issue) => issue.code === 'PARTS_ASKED_BY_NAME')).toEqual([ASKED_BY_NAME]);
        expect(
          ofReading(report)
            .filter((issue) => issue.code === 'RETRIEVE_MESSAGES')
            .map((issue) => issue.details['count']),
        ).toEqual([2, 1]);
        expect(stored(dir, 1)).toEqual(expectedFiles());
      });

      it('asks once for the parts when the retrieve of their parent is split and when its job is lost', async () => {
        metadata.maxFiles = 10;
        const dir = workspaceDir();
        const report = await snap(dir);
        expect(report.snapshot.status).toBe('complete');
        expect(stored(dir, 1)).toEqual(expectedFiles());
        expect(ofReading(report).filter((issue) => issue.code === 'PARTS_ASKED_BY_NAME')).toEqual([ASKED_BY_NAME]);
        expect(metadata.retrieves.filter((members) => members.includes('CustomField:Account.Tier__c'))).toEqual([
          PARTS,
        ]);

        // The org forgets the first job once, so the retrieve with the parent is started twice.
        metadata.maxFiles = Infinity;
        metadata.retrieves.length = 0;
        let forgotten = false;
        mock.intercept = (request) => {
          if (forgotten || !request.body.includes('<checkRetrieveStatus>')) return undefined;
          forgotten = true;
          return soapFault('INVALID_CROSS_REFERENCE_KEY', 'invalid cross reference id');
        };
        const other = workspaceDir();
        const again = await snap(other, { tuning: { pollMaxMs: 5 } });
        expect(again.snapshot.status).toBe('complete');
        expect(metadata.retrieves.map((members) => members.length)).toEqual([16, 16, 7]);
        expect(ofReading(again).filter((issue) => issue.code === 'PARTS_ASKED_BY_NAME')).toEqual([ASKED_BY_NAME]);
        expect(stored(other, 1)).toEqual(expectedFiles());
      });

      it('retrieves the parts when the snapshot is continued after it was interrupted before their retrieve', async () => {
        const dir = workspaceDir();
        // The session ends when the retrieve of the parts is started.
        mock.intercept = (request) => {
          if (request.body.includes('<retrieve>') && metadata.retrieves.length === 1) mock.sessions.clear();
          return undefined;
        };
        expect((await failure(() => snap(dir))).code).toBe('LOGIN_FAILED');
        expect(chunks(dir, 1)).toEqual(['0 done - 1', '1 pending - 0']);

        mock.intercept = null;
        mock.sessions.add('valid-session');
        const report = await snap(dir);
        expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
        expect(metadata.retrieves).toHaveLength(2);
        expect(metadata.retrieves[1]).toEqual(PARTS);
        expect(stored(dir, 1)).toEqual(expectedFiles());
        expect(ofReading(report)[0]).toEqual(ASKED_BY_NAME);
      });
    });

    it('stores nothing of a parent that has a file of its own when its parts are asked for by their own names', async () => {
      // A custom object, which has a label and more in the project. The org lists its parts and not the object.
      metadata.unlistedParents.add('CustomObject:Invoice__c');
      metadata.withheld.add('CustomObject:Invoice__c');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('complete');
      expect(metadata.retrieves).toHaveLength(2);
      expect(metadata.retrieves[1]?.every((member) => /^(CustomField|ValidationRule):Invoice__c\./.test(member))).toBe(
        true,
      );
      expect(stored(dir, 1)).toEqual(expectedFiles());
      const own = 'objects/Invoice__c/Invoice__c.object-meta.xml';
      expect(readFileSync(join(FIXTURE, 'main/default', own), 'utf8')).toContain('<label>');
      // The file of the object is in the snapshot, and it holds none of the settings of the object.
      expect(content(dir, 1, own).toString('utf8')).toBe(
        content(dir, 1, 'objects/Account/Account.object-meta.xml').toString('utf8').replaceAll('Account', 'Invoice__c'),
      );
      expect(content(dir, 1, own).toString('utf8')).not.toContain('<label>');
    });

    it('asks for no part by its own name when Salesforce cannot find a parent that the org lists', async () => {
      metadata.withheld.add('CustomObject:Invoice__c');
      const dir = workspaceDir();
      const report = await snap(dir);

      expect(report.snapshot.status).toBe('partial');
      expect(metadata.retrieves).toHaveLength(1);
      expect(codes(report)).not.toContain('info PARTS_ASKED_BY_NAME');
      expect(
        ofReading(report)
          .filter((issue) => issue.code === 'NOT_RETRIEVED')
          .map((issue) => issue.details['type']),
      ).toContain('CustomObject');
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
      expect(ofReading(report)).toEqual(
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
        packaged: 0,
      });
      expect(ofReading(report)).toEqual([
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
      expect(ofReading(report).find((issue) => issue.code === 'SNAPSHOT_RESUMED')).toMatchObject({
        severity: 'info',
        details: { chunksDone: 1, chunks: 3 },
      });
      expect((await workspace.status()).sources[0]).toMatchObject({ snapshots: 1, unfinishedSnapshot: null });
      // A snapshot that was continued is analysed when it ends, like one that was read in one go.
      expect(events.at(-1)).toEqual({ step: 'analysing', snapshot: 1 });
      expect(report.analysis).toMatchObject({ complete: true });
      expect(report.analysis?.components).toBeGreaterThan(0);
      // It was analysed once, when it had ended: the one warning of the part is there once.
      expect(report.issues.filter((issue) => issue.stage === 'analysis').map((issue) => issue.code)).toEqual([
        'PATH_NOT_FOLLOWED',
      ]);
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
      expect(ofReading(second)[0]).toMatchObject({
        severity: 'error',
        code: 'RETRIEVE_FAILED',
        message:
          'Salesforce did not hand out 16 components. The retrieve was started 3 times and gave no result. Salesforce no longer knows the retrieve.',
      });
      expect(ofReading(second).filter((issue) => issue.code === 'NOT_RETRIEVED')).toHaveLength(5);
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
      expect(ofReading(report)).toEqual([]);
      expect(metadata.retrieves).toHaveLength(2);
      const workspace = await openWorkspace({ root: dir, env });
      const givenUp = await workspace.coverage('prod', { snapshot: 1 });
      expect(givenUp.snapshot.status).toBe('failed');
      expect(givenUp.snapshot.finishedAt).toMatch(UTC);
      expect(ofReading(givenUp)).toEqual([
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
      expect(ofReading(givenUp)[0]?.message).toBe(
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
      expect(ofReading(later)).toEqual([]);
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
      expect(ofReading(report)[0]).toMatchObject({
        severity: 'error',
        code: 'RETRIEVE_FAILED',
        message:
          'Salesforce did not hand out 16 components. The retrieve was started 3 times and gave no result. Salesforce did not say how far the retrieve is. UNKNOWN_EXCEPTION: An unexpected error occurred. Please include this ErrorId: 123-456',
        // A chunk that is given up is not narrowed to a component: it counts with every type in it.
        details: { count: 16, types: ['ApexClass', 'ApexTrigger', 'CustomObject'], tier: 'logic' },
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
      expect(ofReading(report).find((issue) => issue.code === 'RETRIEVE_FAILED')?.message).toBe(
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
      expect(ofReading(report)).toEqual([
        {
          severity: 'info',
          code: 'CHUNK_SPLIT',
          message:
            'A retrieve of 16 components failed and was tried again in two halves. What Salesforce handed out could not be read. It is not a zip file that can be read.',
          details: {
            members: 16,
            said: 'What Salesforce handed out could not be read. It is not a zip file that can be read.',
            code: null,
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
      expect(ofReading(report)).toEqual([]);
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
      expect(ofReading(report)).toEqual([
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

    it('names a file Salesforce hands out in a folder of no type it knows, and calls the snapshot partial', async () => {
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      const dir = workspaceDir();
      const report = await snap(dir);
      expect(report.snapshot.status).toBe('partial');
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(ofReading(report)).toEqual([
        {
          severity: 'error',
          code: 'RESOLVE_FAILED',
          message:
            'mysteries/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known.',
          // Nothing tells the type of the file, so it counts against the logic tier.
          details: { at: 'mysteries/Thing.mystery', types: [], tier: 'logic' },
        },
      ]);
      // The org was asked what it has when the snapshot began, and once more for the file.
      expect(metadata.calls.filter((call) => call.operation === 'describeMetadata')).toHaveLength(2);
    });

    it('counts such a file by the type the org describes with its folder, which the library does not know', async () => {
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      metadata.extraFiles.set('mysteries/Other.mystery', 'and this');
      metadata.unknownTypes.set('Mystery', { directory: 'mysteries' });
      const dir = workspaceDir();
      const report = await snap(dir);
      expect(report.snapshot.status).toBe('complete');
      expect(stored(dir, 1)).toEqual(expectedFiles());
      expect(typeOf(report, 'Mystery')).toMatchObject({ listed: 0, retrieved: 0, listing: 'ok' });
      expect(ofReading(report)).toEqual(
        ['Other', 'Thing'].map((name) => ({
          severity: 'warning',
          code: 'RESOLVE_FAILED',
          message:
            `mysteries/${name}.mystery could not be read as metadata: The file belongs to no metadata type that is known. ` +
            'The org describes a type that keeps its files in this folder, and the Salesforce library OrgLens reads with does not know it. ' +
            'It is counted with the type Mystery, which is outside the logic tier, and does not make the snapshot partial.',
          details: { at: `mysteries/${name}.mystery`, types: ['Mystery'], tier: 'other', describedByOrg: true },
        })),
      );
      // The org was asked what it has when the snapshot began, and once for the two files.
      expect(metadata.calls.filter((call) => call.operation === 'describeMetadata')).toHaveLength(2);
    });

    it('counts such a file with the parts of the type too, and asks the org once for all retrieves', async () => {
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      metadata.unknownTypes.set('Mystery', { directory: 'mysteries', children: ['MysteryPart'] });
      const dir = workspaceDir();
      const report = await snap(dir, { tuning: { chunkWeight: 20 } });
      expect(metadata.retrieves.length).toBeGreaterThan(1);
      expect(report.snapshot.status).toBe('complete');
      // The mock puts the file into every retrieve.
      expect(ofReading(report)).toEqual(
        metadata.retrieves.map(() => ({
          severity: 'warning',
          code: 'RESOLVE_FAILED',
          message:
            'mysteries/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known. ' +
            'The org describes a type that keeps its files in this folder, and the Salesforce library OrgLens reads with does not know it. ' +
            'It is counted with the types Mystery, MysteryPart, which are outside the logic tier, and does not make the snapshot partial.',
          details: {
            at: 'mysteries/Thing.mystery',
            types: ['Mystery', 'MysteryPart'],
            tier: 'other',
            describedByOrg: true,
          },
        })),
      );
      expect(metadata.calls.filter((call) => call.operation === 'describeMetadata')).toHaveLength(2);
    });

    it('calls the snapshot partial when the type the org describes with the folder is of the logic tier', async () => {
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      // The tier is a list of names the library knows. So the org of this test keeps a type of the tier in a
      // folder the library does not know for it.
      metadata.unknownTypes.set('Flow', { directory: 'mysteries' });
      const report = await snap(workspaceDir());
      expect(report.snapshot.status).toBe('partial');
      expect(ofReading(report)).toEqual([
        {
          severity: 'error',
          code: 'RESOLVE_FAILED',
          message:
            'mysteries/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known. ' +
            'The org describes a type that keeps its files in this folder, and the Salesforce library OrgLens reads with does not know it.',
          details: { at: 'mysteries/Thing.mystery', types: ['Flow'], tier: 'logic', describedByOrg: true },
        },
      ]);
    });

    it('says so when the org does not tell which type keeps its files in the folder', async () => {
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      metadata.unknownTypes.set('Mystery', { directory: 'mysteries' });
      // The org answers when the snapshot begins, and refuses the same question later.
      let asked = 0;
      mock.intercept = (request) => {
        if (!request.body.includes('describeMetadata')) return undefined;
        asked += 1;
        return asked === 1 ? undefined : soapFault('UNKNOWN_EXCEPTION', 'An unexpected error occurred.');
      };
      const report = await snap(workspaceDir());
      expect(asked).toBe(2);
      expect(report.snapshot.status).toBe('partial');
      expect(ofReading(report)).toEqual([
        {
          severity: 'error',
          code: 'RESOLVE_FAILED',
          message:
            'mysteries/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known. ' +
            'The org was asked which type keeps its files in this folder, and did not say: UNKNOWN_EXCEPTION: An unexpected error occurred.',
          details: { at: 'mysteries/Thing.mystery', types: [], tier: 'logic' },
        },
      ]);
    });

    it('ends what the Salesforce library says of such a file as a sentence, before what is said of the org', async () => {
      // A file with the ending of a file beside a source file, and no source file. The library cannot place it
      // and gives up the folder, and each file of the folder then gets the words of the library, which end
      // without a full stop.
      metadata.extraFiles.set('mysteries/Thing.mystery', 'what is this');
      metadata.extraFiles.set('mysteries/Stray.mystery-meta.xml', '<Mystery/>');
      metadata.unknownTypes.set('Mystery', { directory: 'mysteries' });
      const described = await snap(workspaceDir());
      expect(ofReading(described).map(({ message }) => message)).toEqual(
        ['Stray.mystery-meta.xml', 'Thing.mystery'].map(
          (name) =>
            `mysteries/${name} could not be read as metadata: mysteries/${name}: Could not infer a metadata type. ` +
            'The org describes a type that keeps its files in this folder, and the Salesforce library OrgLens reads with does not know it. ' +
            'It is counted with the type Mystery, which is outside the logic tier, and does not make the snapshot partial.',
        ),
      );

      // The org answers when the snapshot begins, and refuses the same question later.
      let asked = 0;
      mock.intercept = (request) => {
        if (!request.body.includes('describeMetadata')) return undefined;
        asked += 1;
        return asked === 1 ? undefined : soapFault('UNKNOWN_EXCEPTION', 'An unexpected error occurred.');
      };
      const refused = await snap(workspaceDir());
      expect(ofReading(refused).map(({ message }) => message)).toEqual(
        ['Stray.mystery-meta.xml', 'Thing.mystery'].map(
          (name) =>
            `mysteries/${name} could not be read as metadata: mysteries/${name}: Could not infer a metadata type. ` +
            'The org was asked which type keeps its files in this folder, and did not say: UNKNOWN_EXCEPTION: An unexpected error occurred.',
        ),
      );
    });

    describe('with components of a package, which the org lists with a prefix and hands out without', () => {
      it('takes what comes back for the listed components, and is complete in a type of the logic tier', async () => {
        metadata.packaged.set('ApexClass:InvoiceService', 'pkg');
        metadata.packaged.set('ApexClass:InvoiceSelector', 'pkg');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(metadata.retrieves.flat()).toContain('ApexClass:pkg__InvoiceService');
        expect(metadata.retrieves.flat()).not.toContain('ApexClass:InvoiceService');
        expect(report.snapshot.status).toBe('complete');
        expect(stored(dir, 1)).toEqual(expectedFiles());
        const classes = typeOf(report, 'ApexClass');
        expect(classes?.listed).toBeGreaterThan(2);
        expect(classes?.retrieved).toBe(classes?.listed);
        expect(ofReading(report)).toEqual([
          {
            severity: 'info',
            code: 'RETRIEVED_WITHOUT_PREFIX',
            message:
              '2 components of the type ApexClass came back under their name without the prefix of their package. The org lists them with the prefix, and the files of the snapshot are named without it. The first: pkg__InvoiceSelector',
            details: { type: 'ApexClass', count: 2, components: ['pkg__InvoiceSelector', 'pkg__InvoiceService'] },
          },
        ]);
      });

      it('does not take it when the retrieve asked for the name without the prefix as well', async () => {
        // The org lists the fields of the object under its name without the prefix, and no object of that name.
        // So the object is asked for under both names, and nothing says which of the two came back.
        metadata.packaged.set('CustomObject:Invoice__c', 'pkg');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(metadata.retrieves.flat()).toContain('CustomObject:pkg__Invoice__c');
        expect(metadata.retrieves.flat()).toContain('CustomObject:Invoice__c');
        expect(stored(dir, 1)).toEqual(expectedFiles());
        // The listed object stays missing. It is of a package, so that is a warning, and the snapshot is complete
        // (decision record 0076).
        expect(report.snapshot.status).toBe('complete');
        expect(ofReading(report).filter((issue) => issue.code === 'NOT_RETRIEVED')).toEqual([
          {
            severity: 'warning',
            code: 'NOT_RETRIEVED',
            message:
              '1 component of the type CustomObject that the org listed as of a managed package installed in it did not come back. A component of a package does not make the snapshot partial: Salesforce does not hand out one that is protected. The first: pkg__Invoice__c',
            details: {
              type: 'CustomObject',
              count: 1,
              components: ['pkg__Invoice__c'],
              tier: 'logic',
              ofPackages: true,
            },
          },
        ]);
        expect(ofReading(report).map((issue) => issue.code)).not.toContain('RETRIEVED_WITHOUT_PREFIX');
      });
    });

    describe('with components the org lists under another name than they come back with', () => {
      beforeEach(async () => {
        metadata = await metadataFromSource(WITH_OTHER_NAMES);
        mock.metadata = metadata;
      });
      /** The files of the snapshot: those of the folder, and the file of each object the org has parts of. */
      const withOtherNames = (): string[] =>
        [
          ...expectedFiles(),
          ...Object.keys(OTHER_NAME_FILES),
          'objects/PersonAccount/PersonAccount.object-meta.xml',
        ].sort();
      const note = (
        type: string,
        said: string,
        reason: string,
        name: string,
      ): ReturnType<typeof ofReading>[number] => ({
        severity: 'info',
        code: 'RETRIEVED_UNDER_ANOTHER_NAME',
        message: `1 component of the type ${type} came back under ${said} The first: ${name}`,
        details: { type, reason, count: 1, components: [name] },
      });
      const UNDER_PERSON_ACCOUNT =
        'the object PersonAccount. The org lists it under the object Account, and the snapshot names it after PersonAccount.';

      it('takes a document and what belongs to person accounts for the listed components, and is complete', async () => {
        const dir = workspaceDir();
        const report = await snap(dir);

        // The org is asked by the names it lists: the document with the ending of its file, the rule under Account.
        const asked = metadata.retrieves.flat();
        expect(asked).toEqual(
          expect.arrayContaining(['Document:Assets', 'Document:Assets/Logo.png', 'DuplicateRule:Account.Same_Person']),
        );
        expect(asked.filter((member) => /^(Document|DuplicateRule|RecordType|MatchingRule):/.test(member))).toEqual([
          'Document:Assets',
          'Document:Assets/Logo.png',
          'DuplicateRule:Account.Same_Person',
        ]);
        expect(report.snapshot.status).toBe('complete');
        // The files keep the names they came with.
        expect(stored(dir, 1)).toEqual(withOtherNames());
        for (const type of ['Document', 'DocumentFolder', 'DuplicateRule']) {
          expect(typeOf(report, type)).toMatchObject({ type, listed: 1, retrieved: 1, note: null });
        }
        // The rule of the business account came back under the name the org lists, and the other one did not.
        for (const type of ['MatchingRule', 'MatchingRules']) {
          expect(typeOf(report, type)).toMatchObject({ type, listed: 2, retrieved: 2, note: null });
        }
        const recordTypes = typeOf(report, 'RecordType');
        expect(recordTypes?.listed).toBe(1);
        expect(recordTypes?.retrieved).toBe(1);
        expect(ofReading(report)).toEqual([
          note(
            'Document',
            'its name without the ending of its file. The org lists it with the ending, and the snapshot names it without it.',
            'file-ending',
            'Assets/Logo.png',
          ),
          note('DuplicateRule', UNDER_PERSON_ACCOUNT, 'person-account', 'Account.Same_Person'),
          note('MatchingRule', UNDER_PERSON_ACCOUNT, 'person-account', 'Account.Person_By_Name'),
          note('RecordType', UNDER_PERSON_ACCOUNT, 'person-account', 'Account.Client'),
        ]);
      });

      it('leaves a listed component missing that the org does not hand out, under the name the org lists', async () => {
        metadata.withheld.add('Document:Assets/Logo');
        metadata.withheld.add('DuplicateRule:PersonAccount.Same_Person');
        const dir = workspaceDir();
        const report = await snap(dir);

        // Neither type is of the logic tier.
        expect(report.snapshot.status).toBe('complete');
        expect(typeOf(report, 'Document')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(typeOf(report, 'DuplicateRule')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(
          ofReading(report)
            .filter((issue) => issue.code !== 'RETRIEVED_UNDER_ANOTHER_NAME')
            .map((issue) => [issue.code, issue.details['components'] ?? issue.details['messages']]),
        ).toEqual([
          [
            'RETRIEVE_MESSAGES',
            [
              "Entity of type 'Document' named 'Assets/Logo.png' cannot be found",
              "Entity of type 'DuplicateRule' named 'Account.Same_Person' cannot be found",
            ],
          ],
          ['NOT_RETRIEVED', ['Assets/Logo.png']],
          ['NOT_RETRIEVED', ['Account.Same_Person']],
        ]);
        expect(
          ofReading(report)
            .filter((issue) => issue.code === 'RETRIEVED_UNDER_ANOTHER_NAME')
            .map((issue) => issue.details['type']),
        ).toEqual(['MatchingRule', 'RecordType']);
      });

      it('leaves the record type of person accounts missing where the org does not list the object PersonAccount', async () => {
        // The object is then never asked for, and its file does not come back (decision record 0071).
        metadata.unlistedParents.add('CustomObject:PersonAccount');
        const report = await snap(workspaceDir());

        expect(report.snapshot.status).toBe('partial');
        expect(typeOf(report, 'RecordType')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(
          ofReading(report)
            .filter((issue) => issue.code === 'NOT_RETRIEVED')
            .map((issue) => [issue.details['type'], issue.details['components']]),
        ).toEqual([['RecordType', ['Account.Client']]]);
      });

      it('leaves the document missing that Salesforce cannot find, though a file of it comes back', async () => {
        // Salesforce remarks that it cannot find the name the org lists, and hands out a file under the other one.
        metadata.withheld.add('Document:Assets/Logo');
        metadata.extraFiles.set('documents/Assets/Logo.png', 'not a picture\n');
        metadata.extraFiles.set(
          'documents/Assets/Logo.png-meta.xml',
          `<?xml version="1.0" encoding="UTF-8"?>\n${OTHER_NAME_FILES['documents/Assets/Logo.document-meta.xml'] ?? ''}`,
        );
        const report = await snap(workspaceDir());

        expect(typeOf(report, 'Document')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(
          ofReading(report)
            .filter((issue) => issue.details['type'] === 'Document')
            .map((issue) => [issue.code, issue.details['components']]),
        ).toEqual([
          ['NOT_RETRIEVED', ['Assets/Logo.png']],
          ['UNLISTED_COMPONENTS', ['Assets/Logo']],
        ]);
      });
    });

    describe('with reports and a dashboard in a folder inside a folder', () => {
      beforeEach(async () => {
        metadata = await metadataFromSource(WITH_NESTED_FOLDERS);
        mock.metadata = metadata;
      });
      const UNDER_THE_PATH = (one: boolean): string =>
        `came back under the whole path of the folders ${one ? 'it lies' : 'they lie'} in. The org lists ${one ? 'it' : 'them'} without the outer folders, and the snapshot names ${one ? 'it' : 'them'} with the whole path.`;
      const note = (type: string, names: string[]): ReturnType<typeof ofReading>[number] => ({
        severity: 'info',
        code: 'RETRIEVED_UNDER_ANOTHER_NAME',
        message: `${String(names.length)} ${names.length === 1 ? 'component' : 'components'} of the type ${type} ${UNDER_THE_PATH(names.length === 1)} The first: ${names[0] ?? ''}`,
        details: { type, reason: 'folder-path', count: names.length, components: names },
      });

      it('takes what comes back under the whole path for what the org lists by the innermost folder', async () => {
        const dir = workspaceDir();
        const report = await snap(dir);

        // The org is asked by the names it lists. A folder is asked for under the type of what it holds.
        expect(metadata.retrieves.flat().filter((member) => /^(Report|Dashboard)/.test(member))).toEqual([
          'Dashboard:Board',
          'Dashboard:Inner',
          'Dashboard:Inner/Overview',
          'Report:Archive',
          'Report:Archive/Old_Revenue',
          'Report:Finance',
          'Report:Finance/Totals',
          'Report:Quarterly',
          'Report:Quarterly/Revenue',
          'Report:budget',
        ]);
        expect(report.snapshot.status).toBe('complete');
        // The files keep the path they came with.
        expect(stored(dir, 1)).toEqual([...expectedFiles(), ...Object.keys(NESTED_FOLDER_FILES)].sort());
        expect(typeOf(report, 'Report')).toMatchObject({ listed: 3, retrieved: 3, note: null });
        expect(typeOf(report, 'ReportFolder')).toMatchObject({ listed: 4, retrieved: 4, note: null });
        expect(typeOf(report, 'Dashboard')).toMatchObject({ listed: 1, retrieved: 1, note: null });
        expect(typeOf(report, 'DashboardFolder')).toMatchObject({ listed: 2, retrieved: 2, note: null });
        expect(typeOf(report, 'Document')).toMatchObject({ listed: 2, retrieved: 2, note: null });
        // The notes go by rule, and name the listed names by code unit: `budget` after `Quarterly`.
        const names = ['Assets/Logo-dark.png', 'Assets/Logo.png'];
        expect(ofReading(report)).toEqual([
          {
            severity: 'info',
            code: 'RETRIEVED_UNDER_ANOTHER_NAME',
            message: `2 components of the type Document came back under their name without the ending of their file. The org lists them with the ending, and the snapshot names them without it. The first: ${names[0] ?? ''}`,
            details: { type: 'Document', reason: 'file-ending', count: 2, components: names },
          },
          note('Dashboard', ['Inner/Overview']),
          note('DashboardFolder', ['Inner']),
          note('Report', ['Archive/Old_Revenue', 'Quarterly/Revenue']),
          note('ReportFolder', ['Archive', 'Quarterly', 'budget']),
        ]);
      });

      it('leaves a listed report missing that the org does not hand out, under the name the org lists', async () => {
        metadata.withheld.add('Report:Finance/Quarterly/Revenue');
        const dir = workspaceDir();
        const report = await snap(dir);

        // A report is outside the logic tier.
        expect(report.snapshot.status).toBe('complete');
        expect(typeOf(report, 'Report')).toMatchObject({ listed: 3, retrieved: 2 });
        expect(
          ofReading(report)
            .filter((issue) => issue.code !== 'RETRIEVED_UNDER_ANOTHER_NAME')
            .map((issue) => [issue.code, issue.details['components'] ?? issue.details['messages']]),
        ).toEqual([
          ['RETRIEVE_MESSAGES', ["Entity of type 'Report' named 'Quarterly/Revenue' cannot be found"]],
          ['NOT_RETRIEVED', ['Quarterly/Revenue']],
        ]);
        expect(
          ofReading(report)
            .filter((issue) => issue.code === 'RETRIEVED_UNDER_ANOTHER_NAME')
            .map((issue) => [issue.details['type'], issue.details['components']]),
        ).toEqual([
          ['Document', ['Assets/Logo-dark.png', 'Assets/Logo.png']],
          ['Dashboard', ['Inner/Overview']],
          ['DashboardFolder', ['Inner']],
          ['Report', ['Archive/Old_Revenue']],
          ['ReportFolder', ['Archive', 'Quarterly', 'budget']],
        ]);
      });

      it('leaves a folder missing that Salesforce cannot find, though a file of it comes back', async () => {
        // A folder is asked for under the type of what it holds, and Salesforce remarks on it under that type.
        metadata.withheld.add('Report:Quarterly');
        metadata.extraFiles.set(
          'reports/Finance/Quarterly-meta.xml',
          `<?xml version="1.0" encoding="UTF-8"?>\n${folderFile('ReportFolder', 'Quarterly')}`,
        );
        const report = await snap(workspaceDir());

        expect(typeOf(report, 'ReportFolder')).toMatchObject({ listed: 4, retrieved: 3 });
        expect(
          ofReading(report)
            .filter((issue) => issue.details['type'] === 'ReportFolder' || issue.code === 'RETRIEVE_MESSAGES')
            .map((issue) => [issue.code, issue.details['components'] ?? issue.details['messages']]),
        ).toEqual([
          ['RETRIEVED_UNDER_ANOTHER_NAME', ['Archive', 'budget']],
          ['RETRIEVE_MESSAGES', ["Entity of type 'Report' named 'Quarterly' cannot be found"]],
          ['NOT_RETRIEVED', ['Quarterly']],
          ['UNLISTED_COMPONENTS', ['Finance/Quarterly']],
        ]);
      });
    });

    describe('with the file of custom labels, which the org lists and does not hand out', () => {
      const notRetrieved = (report: CoverageReport): ReturnType<typeof ofReading> =>
        ofReading(report).filter((issue) => issue.code === 'NOT_RETRIEVED');

      it('is complete when the org lists no label: the file holds nothing else', async () => {
        metadata = await metadataFromSource(WITHOUT_LABEL);
        mock.metadata = metadata;
        metadata.withheld.add('CustomLabels:CustomLabels');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(typeOf(report, 'CustomLabels')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(typeOf(report, 'CustomLabel')?.listed ?? 0).toBe(0);
        expect(report.snapshot.status).toBe('complete');
        expect(notRetrieved(report)).toEqual([
          {
            severity: 'warning',
            code: 'NOT_RETRIEVED',
            message:
              '1 component of the type CustomLabels that the org listed did not come back. The first: CustomLabels. The org lists no component of the type CustomLabel, and such a file holds nothing else, so the snapshot is not partial for it.',
            details: {
              type: 'CustomLabels',
              count: 1,
              components: ['CustomLabels'],
              tier: 'logic',
              holdsNothing: true,
            },
          },
        ]);
      });

      it('is partial when the org lists a label', async () => {
        metadata = await metadataFromSource(WHOLE);
        mock.metadata = metadata;
        metadata.withheld.add('CustomLabels:CustomLabels');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(typeOf(report, 'CustomLabel')).toMatchObject({ listed: 1 });
        expect(report.snapshot.status).toBe('partial');
        expect(notRetrieved(report).map((issue) => [issue.severity, issue.details])).toContainEqual([
          'error',
          { type: 'CustomLabels', count: 1, components: ['CustomLabels'], tier: 'logic' },
        ]);
      });

      it('is partial when the org refuses to say which labels it has', async () => {
        metadata = await metadataFromSource(WITHOUT_LABEL);
        mock.metadata = metadata;
        metadata.withheld.add('CustomLabels:CustomLabels');
        metadata.failing.add('CustomLabel');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('partial');
        expect(
          ofReading(report)
            .filter((issue) => issue.severity === 'error')
            .map((issue) => [issue.code, issue.details['type']]),
        ).toEqual([['LISTING_FAILED', 'CustomLabel']]);
      });
    });

    describe('with a component of a type outside the logic tier', () => {
      beforeEach(async () => {
        metadata = await metadataFromSource(WITH_RESOURCE);
        mock.metadata = metadata;
      });
      const withResource = (): string[] => [...expectedFiles(), ...RESOURCE_FILES].sort();
      const OUTSIDE = 'This is outside the logic tier and does not make the snapshot partial.';

      it('stores it like any other', async () => {
        const dir = workspaceDir();
        const report = await snap(dir);
        expect(report.snapshot.status).toBe('complete');
        expect(stored(dir, 1)).toEqual(withResource());
        expect(typeOf(report, 'StaticResource')).toMatchObject({ listed: 1, retrieved: 1, listing: 'ok' });
        expect(ofReading(report)).toEqual([]);
      });

      it('calls the snapshot complete when the org does not hand it out, and names it in a warning', async () => {
        metadata.withheld.add('StaticResource:Notice');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('complete');
        expect(typeOf(report, 'StaticResource')).toMatchObject({ listed: 1, retrieved: 0 });
        expect(ofReading(report)).toEqual([
          {
            severity: 'warning',
            code: 'RETRIEVE_MESSAGES',
            message:
              "Salesforce made 1 remark about a retrieve. The first: Entity of type 'StaticResource' named 'Notice' cannot be found",
            details: { count: 1, messages: ["Entity of type 'StaticResource' named 'Notice' cannot be found"] },
          },
          {
            severity: 'warning',
            code: 'NOT_RETRIEVED',
            message: `1 component of the type StaticResource that the org listed did not come back. The first: Notice. ${OUTSIDE}`,
            details: { type: 'StaticResource', count: 1, components: ['Notice'], tier: 'other' },
          },
        ]);
        expect(stored(dir, 1)).toEqual(expectedFiles());
      });

      it('calls the snapshot complete when the org refuses to list its type, and says that the number is not known', async () => {
        metadata.failing.add('StaticResource');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('complete');
        expect(typeOf(report, 'StaticResource')).toMatchObject({ listed: 0, retrieved: 0, listing: 'failed' });
        expect(ofReading(report)).toEqual([
          {
            severity: 'warning',
            code: 'LISTING_FAILED',
            message: `The org did not say which components of the type StaticResource it has. INVALID_TYPE: Cannot use: StaticResource in this organization. ${OUTSIDE}`,
            details: { type: 'StaticResource', code: 'INVALID_TYPE', tier: 'other' },
          },
        ]);
      });

      it('is partial for a retrieve that fails with a component of the logic tier in it, and not for one without', async () => {
        // A class and the static resource are two files each, so neither can be retrieved, and each object can.
        metadata.maxFiles = 1;
        const dir = workspaceDir();
        const report = await snap(dir, { tuning: { failuresInARow: 100 } });

        expect(report.snapshot.status).toBe('partial');
        const failed = ofReading(report).filter((issue) => issue.code === 'RETRIEVE_FAILED');
        expect(failed.map((issue) => [issue.severity, issue.details['components'], issue.details['tier']])).toEqual([
          ...failed.slice(0, -1).map((issue) => ['error', issue.details['components'], 'logic']),
          ['warning', ['StaticResource Notice'], 'other'],
        ]);
        expect(failed).toHaveLength(14);
        expect(failed.at(-1)?.message).toBe(
          `Salesforce did not hand out StaticResource Notice. LIMIT_EXCEEDED: Too many files in retrieve call, limit is 1. ${OUTSIDE}`,
        );
        const missing = ofReading(report).filter((issue) => issue.code === 'NOT_RETRIEVED');
        expect(missing.map((issue) => [issue.severity, issue.details['type'], issue.details['tier']])).toEqual([
          ['error', 'ApexClass', 'logic'],
          ['error', 'ApexTrigger', 'logic'],
          ['warning', 'StaticResource', 'other'],
        ]);
      });

      it('is complete when the one retrieve that fails holds nothing of the logic tier', async () => {
        // The org refuses every retrieve that asks for the static resource, down to the one that asks for it alone.
        mock.intercept = (request) =>
          request.body.includes('<retrieve>') && request.body.includes('<name>StaticResource</name>')
            ? soapFault('INVALID_CROSS_REFERENCE_KEY', 'invalid cross reference id')
            : undefined;
        const dir = workspaceDir();
        const report = await snap(dir, { tuning: { failuresInARow: 100, pollMaxMs: 5 } });

        expect(report.snapshot.status).toBe('complete');
        expect(stored(dir, 1)).toEqual(expectedFiles());
        const failed = ofReading(report).filter((issue) => issue.code === 'RETRIEVE_FAILED');
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({
          severity: 'warning',
          details: { count: 1, components: ['StaticResource Notice'], types: ['StaticResource'], tier: 'other' },
        });
        expect(failed[0]?.message.endsWith(OUTSIDE)).toBe(true);
        expect(
          ofReading(report)
            .filter((issue) => issue.severity !== 'info')
            .map((issue) => [issue.severity, issue.code, issue.details['tier']]),
        ).toEqual([
          ['warning', 'RETRIEVE_FAILED', 'other'],
          ['warning', 'NOT_RETRIEVED', 'other'],
        ]);
      });

      it('is not partial for a file it cannot read in the folder of a type outside the logic tier', async () => {
        metadata.extraFiles.set('tabs/Thing.mystery', 'what is this');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('complete');
        expect(stored(dir, 1)).toEqual(withResource());
        expect(ofReading(report)).toEqual([
          {
            severity: 'warning',
            code: 'RESOLVE_FAILED',
            message:
              'tabs/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known. It is counted with the type CustomTab, which is outside the logic tier, and does not make the snapshot partial.',
            details: { at: 'tabs/Thing.mystery', types: ['CustomTab'], tier: 'other' },
          },
        ]);
      });

      it('is partial for a file it cannot read in the folder of a type of the logic tier', async () => {
        metadata.extraFiles.set('classes/Thing.mystery', 'what is this');
        const dir = workspaceDir();
        const report = await snap(dir);

        expect(report.snapshot.status).toBe('partial');
        expect(ofReading(report)).toEqual([
          {
            severity: 'error',
            code: 'RESOLVE_FAILED',
            message:
              'classes/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known.',
            details: { at: 'classes/Thing.mystery', types: ['ApexClass'], tier: 'logic' },
          },
        ]);
      });

      describe('that the configuration leaves out', () => {
        const leavingOut = (types: string): string => `${CONFIG}exclude_types = [${types}]\n`;
        const asked = (): string[] =>
          metadata.calls.filter((call) => call.operation === 'listMetadata').map((call) => call.about);

        it('neither lists nor retrieves it, and says in the coverage that it was not read', async () => {
          // If the org were asked, the snapshot would say so: it refuses to list the type.
          metadata.failing.add('StaticResource');
          const dir = workspaceDir(leavingOut('"StaticResource"'));
          const report = await snap(dir);

          expect(report.snapshot.status).toBe('complete');
          expect(asked()).not.toContain('StaticResource');
          expect(asked()).toContain('ApexClass');
          expect(stored(dir, 1)).toEqual(expectedFiles());
          expect(typeOf(report, 'StaticResource')).toEqual({
            type: 'StaticResource',
            listed: 0,
            retrieved: 0,
            analysed: 0,
            listing: 'excluded',
            note: 'The configuration leaves this type out (exclude_types).',
            packaged: 0,
          });
          expect(ofReading(report)).toEqual([
            {
              severity: 'info',
              code: 'TYPES_EXCLUDED',
              message:
                '1 type is left out of the snapshot, as exclude_types of the source says: StaticResource. The org was not asked for its components.',
              details: { count: 1, types: ['StaticResource'] },
            },
          ]);
        });

        it('leaves a type that lies in folders out with its folders, also when both are named', async () => {
          // The org describes reports and has none. Asked or not, it would be asked for their folders first.
          metadata.emptyTypes.push('Report');
          const dir = workspaceDir(leavingOut('"StaticResource", "ReportFolder", "Report"'));
          const report = await snap(dir);

          expect(report.snapshot.status).toBe('complete');
          expect(asked().filter((about) => /Report|StaticResource/.test(about))).toEqual([]);
          expect(typeOf(report, 'Report')).toMatchObject({ listing: 'excluded' });
          expect(typeOf(report, 'ReportFolder')).toMatchObject({
            listing: 'excluded',
            note: 'The configuration leaves the type Report out (exclude_types), and this type with it.',
          });
          expect(ofReading(report)).toEqual([
            {
              severity: 'info',
              code: 'TYPES_EXCLUDED',
              message:
                '3 types are left out of the snapshot, as exclude_types of the source says: Report, ReportFolder, StaticResource. The org was not asked for their components.',
              details: { count: 3, types: ['Report', 'ReportFolder', 'StaticResource'] },
            },
          ]);
        });

        it('keeps what a snapshot started with when it is continued under another configuration', async () => {
          const dir = workspaceDir(leavingOut('"StaticResource", "Reprot"'));
          metadata.hold = true;
          await failure(() => snap(dir, { tuning: { jobMs: 20 } }));
          metadata.hold = false;
          // The key is taken out, and the org would now be asked for the type.
          writeFileSync(join(dir, 'orglens.toml'), CONFIG);
          const report = await snap(dir);
          expect(asked()).not.toContain('StaticResource');
          expect(report.snapshot).toMatchObject({ id: 1, status: 'complete' });
          expect(typeOf(report, 'StaticResource')).toMatchObject({ listed: 0, retrieved: 0, listing: 'excluded' });
          expect(stored(dir, 1)).toEqual(expectedFiles());
          // What the start said about the key is said once, not again by the run that continues.
          const codes = ofReading(report).map((issue) => issue.code);
          expect(codes.filter((code) => code === 'TYPES_EXCLUDED')).toHaveLength(1);
          expect(codes.filter((code) => code === 'TYPE_NOT_EXCLUDED')).toHaveLength(1);
        });

        it('reads a type it cannot leave out, and says why', async () => {
          metadata.emptyTypes.push('Report');
          const dir = workspaceDir(leavingOut('"Reprot", "ListView", "StaticResource", "ReportFolder"'));
          const report = await snap(dir);

          expect(report.snapshot.status).toBe('complete');
          expect(typeOf(report, 'ListView')).toMatchObject({ listing: 'ok' });
          expect(typeOf(report, 'ReportFolder')).toMatchObject({ listing: 'ok' });
          expect(asked()).toContain('ReportFolder');
          expect(ofReading(report).filter((issue) => issue.code !== 'TYPES_EXCLUDED')).toEqual([
            {
              severity: 'warning',
              code: 'TYPE_NOT_EXCLUDED',
              message:
                'exclude_types of the source names ListView. Its components are parts of a component of the type CustomObject and come with it, so it cannot be left out alone. It was read.',
              details: { type: 'ListView', reason: 'part', of: 'CustomObject' },
            },
            {
              severity: 'warning',
              code: 'TYPE_NOT_EXCLUDED',
              message:
                'exclude_types of the source names ReportFolder. Its components are the folders of the type Report, so it cannot be left out alone. It was read.',
              details: { type: 'ReportFolder', reason: 'folder', of: 'Report' },
            },
            {
              severity: 'warning',
              code: 'TYPE_NOT_EXCLUDED',
              message:
                'exclude_types of the source names Reprot, and the org describes no metadata type of that name. Nothing was left out for it.',
              details: { type: 'Reprot', reason: 'unknown', of: null },
            },
          ]);
        });
      });
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
    expect(ofReading(report).map((issue) => issue.code)).toEqual([
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
