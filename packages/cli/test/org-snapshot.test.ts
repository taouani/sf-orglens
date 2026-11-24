/**
 * `orglens snapshot` of an org, against a mock org on this machine that
 * holds two Apex classes, and whose Dependency API reports one reference
 * between them. The tests of the engine cover what can go wrong in a
 * retrieve and what the cross-check finds. These cover what a person and a
 * script see of it.
 */
import { generateKeyPairSync } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { engineVersion } from '@sf-orglens/engine';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

const ORG_ID = '00Dxx0000000001EAA';

/** A key pair made for the test. No key is ever kept in the repository. */
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const dirs = tempDirs();
let mock: MockOrg;

beforeAll(async () => {
  mock = await startMockOrg(pair.publicKey);
});
afterAll(async () => {
  await mock.close();
});
afterEach(() => {
  mock.paths.length = 0;
  mock.operations.length = 0;
  mock.withheld = [];
  mock.unlisted = [];
  mock.extraFiles = {};
  mock.extraTypes = [];
  mock.listed.length = 0;
  mock.retrieveFault = null;
  mock.queries.length = 0;
  // The home folder of the test process is an empty folder of its own (tools/vitest-setup.js).
  rmSync(join(homedir(), '.sfdx'), { recursive: true, force: true });
  dirs.cleanUp();
});

/** A workspace that declares the mock org as `prod`, and the variables of a job that logs in to it with a key. */
function setUp(): { dir: string; env: Record<string, string> } {
  mock.classes = {
    Greeter: "public class Greeter {\n    public String greet() { return 'Hello'; }\n}\n",
    GreeterTest: '@IsTest\nprivate class GreeterTest {}\n',
  };
  // The test class refers to the class it tests. The ids are the ones the org lists the two classes with.
  mock.dependencies = [
    {
      MetadataComponentId: '01pxx0000000001AAA',
      MetadataComponentName: 'GreeterTest',
      MetadataComponentNamespace: null,
      MetadataComponentType: 'ApexClass',
      RefMetadataComponentId: '01pxx0000000000AAA',
      RefMetadataComponentName: 'Greeter',
      RefMetadataComponentNamespace: null,
      RefMetadataComponentType: 'ApexClass',
    },
  ];
  const dir = dirs.next();
  writeFileSync(join(dir, 'orglens.toml'), `schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`);
  return {
    dir,
    env: {
      ORGLENS_JWT_PROD_LOGIN_URL: mock.url,
      ORGLENS_JWT_PROD_USERNAME: 'ci@example.com',
      ORGLENS_JWT_PROD_CLIENT_ID: 'client-id',
      ORGLENS_JWT_PROD_KEY: pair.privateKey,
    },
  };
}

const TIME = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/g;

/** What the analysis says about Apex classes, which no analyser of this phase reads. */
const classesAnalysed = (components: string): string[] => [
  `Analysed by engine ${engineVersion()}: ${components}, 0 references.`,
  '',
  'ORIGIN          COMPONENTS  REFERENCES  NOT RESOLVED  PATHS NOT FOLLOWED  FILES NOT READ',
  'parser:xml      0           0           0             0                   0',
  'parser:formula  0           0           0             0                   0',
  'parser:flow     0           0           0             0                   0',
  '',
];

/**
 * What the cross-check says: the one row is from a class, and no analyser of this phase reads classes, so it
 * is counted and not compared.
 */
const CROSS_CHECKED = [
  'Cross-check: the Dependency API of Salesforce reports 1 row. No answer shows that a row is missing.',
  '1 row is from a component of a type that is not analysed, and is not compared: ApexClass 1.',
  'No row was compared.',
  '',
];

describe('orglens snapshot of an org', () => {
  it('reads the org, says on the standard error stream how far it is, and reports what it stored', async () => {
    const { dir, env } = setUp();
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run).toEqual({
      code: 0,
      stderr: [
        'Logged in to the org of "prod". It is read with API version 66.0.',
        'Asking the org what it holds: 1 of 1 request answered.',
        'Snapshot #1: the org lists 2 components. They are retrieved in 1 chunk.',
        'Snapshot #1: 1 of 1 chunk is stored.',
        'Snapshot #1: every chunk is done. Asking the Dependency API of Salesforce which references it knows.',
        'Snapshot #1: its files are stored. Analysing them.',
        '',
      ].join('\n'),
      stdout: [
        'Snapshot #1 of "prod" is complete: 2 components in 4 files (456 bytes).',
        '',
        'TYPE       LISTED  RETRIEVED  ANALYSED',
        'ApexClass  2       2          0',
        '',
        ...classesAnalysed('2 components'),
        ...CROSS_CHECKED,
      ].join('\n'),
    });
    // The Dependency API is asked for the one object that holds its rows, and for nothing else: the query for every
    // row, one for each of the 17 types that are known to refer, and one for the rest (decision record 0069).
    expect(mock.queries).toHaveLength(19);
    expect(mock.queries[0]).toMatch(/^SELECT [A-Za-z, ]+ FROM MetadataComponentDependency$/);
    for (const query of mock.queries.slice(1)) {
      expect(query).toMatch(/^SELECT [A-Za-z, ]+ FROM MetadataComponentDependency WHERE MetadataComponentType /);
    }
    expect(new Set(mock.paths.filter((path) => path.includes('/query')))).toEqual(
      new Set(['/services/data/v66.0/tooling/query']),
    );
    expect(mock.operations).toEqual([
      'describeMetadata',
      'listMetadata',
      'retrieve',
      'checkRetrieveStatus',
      'checkRetrieveStatus',
    ]);

    const coverage = await orglens(dir, ['coverage', 'prod']);
    expect(coverage.stdout.replace(TIME, 'TIME').split('\n')[0]).toBe(
      'Snapshot #1 of "prod", taken TIME, is complete: 2 components in 4 files (456 bytes).',
    );
    const status = await orglens(dir, ['status']);
    expect(status.stdout).toMatch(/^SOURCE {2}KIND {2}SNAPSHOTS {2}LATEST SNAPSHOT +ANALYSED$/m);
    expect(status.stdout.replace(TIME, 'TIME')).toContain(
      `prod    org   1          #1 complete, finished TIME  by engine ${engineVersion()}\n`,
    );
  });

  it('writes one line of JSON that matches the schema, and nothing else, with --json', async () => {
    const { dir, env } = setUp();
    const json = await orglensJson(dir, ['snapshot', 'prod'], env);
    expect(json).toMatchObject({
      code: 0,
      command: 'snapshot',
      ok: true,
      data: {
        snapshot: {
          id: 1,
          source: 'prod',
          kind: 'org',
          status: 'complete',
          apiVersion: '66.0',
          commit: null,
          files: 4,
        },
        types: [{ type: 'ApexClass', listed: 2, retrieved: 2, analysed: 0, listing: 'ok', note: null }],
        analysis: { engineVersion: engineVersion(), components: 2, references: 0, complete: true },
        crossCheck: {
          state: 'whole',
          requests: 19,
          rows: 1,
          queriesCutOff: 0,
          queriesFailed: 0,
          code: null,
          comparison: {
            rows: 1,
            rowsNotAnalysed: 1,
            notAnalysed: [{ type: 'ApexClass', rows: 1 }],
            rowsNotMatched: 0,
            rowsNotHeld: 0,
            rowsCompared: 0,
            pairs: 0,
            agreed: 0,
            coveredByPart: 0,
            missed: [],
            onlyOrgLens: [],
            notReported: [],
          },
        },
        issues: [],
      },
    });
    expect((await orglensJson(dir, ['coverage', 'prod'])).data).toEqual(json.data);
    expect(await orglensJson(dir, ['status'])).toMatchObject({
      data: {
        sources: [
          {
            name: 'prod',
            snapshots: 1,
            latestSnapshot: { id: 1, analysis: { engineVersion: engineVersion() } },
            unfinishedSnapshot: null,
          },
        ],
      },
    });
    // The output of a job is read by others: it names neither the user nor the address of the org.
    for (const secret of ['ci@example.com', '127.0.0.1', 'the-session', 'client-id']) {
      expect(JSON.stringify(json)).not.toContain(secret);
    }
  });

  it('ends with 5 when the org did not hand out what it listed, and names it', async () => {
    const { dir, env } = setUp();
    mock.withheld = ['GreeterTest'];
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(5);
    expect(run.stdout).toBe(
      [
        'Snapshot #1 of "prod" is partial, something is missing: 1 component in 2 files (245 bytes).',
        '',
        'TYPE       LISTED  RETRIEVED  ANALYSED',
        'ApexClass  2       1          0',
        '',
        'SEVERITY  CODE               WHAT',
        "warning   RETRIEVE_MESSAGES  Salesforce made 1 remark about a retrieve. The first: Entity of type 'ApexClass' named 'GreeterTest' cannot be found",
        'error     NOT_RETRIEVED      1 component of the type ApexClass that the org listed did not come back. The first: GreeterTest',
        '',
        ...classesAnalysed('1 component'),
        ...CROSS_CHECKED,
      ].join('\n'),
    );
  });

  it('ends with 0 when what is missing is of a type outside the logic tier, and says that something is', async () => {
    const { dir, env } = setUp();
    // A file in the folder of custom tabs that is no custom tab.
    mock.extraFiles = { 'tabs/Thing.mystery': 'What is this?\n' };
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      [
        'Snapshot #1 of "prod" is complete for the logic tier: 2 components in 4 files (456 bytes). Something of other types is missing, and the warnings below say what.',
        '',
        'TYPE       LISTED  RETRIEVED  ANALYSED',
        'ApexClass  2       2          0',
        '',
        'SEVERITY  CODE            WHAT',
        'warning   RESOLVE_FAILED  tabs/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known. It is counted with the type CustomTab, which is outside the logic tier, and does not make the snapshot partial.',
        '',
        ...classesAnalysed('2 components'),
        ...CROSS_CHECKED,
      ].join('\n'),
    );
    const coverage = await orglens(dir, ['coverage', 'prod'], env);
    expect(coverage.code).toBe(0);
    const LACKS =
      'is complete for the logic tier: 2 components in 4 files (456 bytes). Something of other types is missing, and the warnings below say what.';
    expect(coverage.stdout.split('\n')[0]?.replace(/taken \S+,/, 'taken TIME,')).toBe(
      `Snapshot #1 of "prod", taken TIME, ${LACKS}`,
    );
    const analysed = await orglens(dir, ['analyse', 'prod'], env);
    expect(analysed.code).toBe(0);
    expect(analysed.stdout.split('\n')[0]).toBe(
      `Snapshot #1 of "prod" was analysed from the files it holds. It ${LACKS}`,
    );
    const { data } = await orglensJson(dir, ['coverage', 'prod']);
    expect(data).toMatchObject({
      snapshot: { status: 'complete' },
      issues: [
        {
          severity: 'warning',
          code: 'RESOLVE_FAILED',
          stage: 'read',
          details: { at: 'tabs/Thing.mystery', types: ['CustomTab'], tier: 'other' },
        },
      ],
    });
  });

  it('shows one row for a code of the reading that comes once for each flow, and the JSON has each issue', async () => {
    const { dir, env } = setUp();
    // Two flows come back whose latest version is a draft, and the org hands out no definition of either.
    const draft = (label: string): string =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata">\n    <label>${label}</label>\n    <status>Draft</status>\n</Flow>\n`;
    mock.extraFiles = { 'flows/Alpha.flow': draft('Alpha'), 'flows/Beta.flow': draft('Beta') };
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(0);
    const rows = run.stdout.split('\n').filter((line) => line.includes('FLOW_VERSION_UNKNOWN'));
    expect(rows).toEqual([
      expect.stringMatching(
        /^warning +FLOW_VERSION_UNKNOWN +2 flows\. The first: The flow Alpha came back as a version that is Draft\. The snapshot holds no definition of the flow, which would name its active version\. It is analysed as it came, and it is not known whether another version of it is active\.$/,
      ),
    ]);
    const { data } = await orglensJson(dir, ['coverage', 'prod']);
    const issues = (data as { issues: { code: string; stage: string; component: string | null }[] }).issues;
    expect(
      issues
        .filter((issue) => issue.code === 'FLOW_VERSION_UNKNOWN')
        .map(({ stage, component }) => ({ stage, component })),
    ).toEqual([
      { stage: 'read', component: 'Flow:alpha' },
      { stage: 'read', component: 'Flow:beta' },
    ]);
  });

  it('shows one row for the files that could not be read for the same reason, and the JSON has each issue', async () => {
    const { dir, env } = setUp();
    // Three files in the folder of custom tabs that are no custom tab, and one in the folder of applications.
    mock.extraFiles = {
      'applications/Thing.mystery': 'What is this?\n',
      'tabs/First.mystery': 'And this?\n',
      'tabs/Second.mystery': 'And this one?\n',
      'tabs/Third.mystery': 'Or this?\n',
    };
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(0);
    const rows = run.stdout.split('\n').filter((line) => line.includes('RESOLVE_FAILED'));
    expect(rows).toEqual([
      'warning   RESOLVE_FAILED  applications/Thing.mystery could not be read as metadata: The file belongs to no metadata type that is known. It is counted with the type CustomApplication, which is outside the logic tier, and does not make the snapshot partial.',
      'warning   RESOLVE_FAILED  3 issues of this kind. The first: tabs/First.mystery could not be read as metadata: The file belongs to no metadata type that is known. It is counted with the type CustomTab, which is outside the logic tier, and does not make the snapshot partial.',
    ]);
    // The report of the snapshot that is stored says the same.
    const coverage = await orglens(dir, ['coverage', 'prod'], env);
    expect(coverage.stdout.split('\n').filter((line) => line.includes('RESOLVE_FAILED'))).toEqual(rows);
    const { data } = await orglensJson(dir, ['coverage', 'prod']);
    const issues = (data as { issues: { code: string; details: { at?: string; types?: string[] } }[] }).issues;
    expect(
      issues
        .filter((issue) => issue.code === 'RESOLVE_FAILED')
        .map(({ details }) => `${details.at ?? ''} ${(details.types ?? []).join()}`),
    ).toEqual([
      'applications/Thing.mystery CustomApplication',
      'tabs/First.mystery CustomTab',
      'tabs/Second.mystery CustomTab',
      'tabs/Third.mystery CustomTab',
    ]);
  });

  it('keeps the files apart whose type nothing tells, by their folder, and the files of other types that say the same', async () => {
    const { dir, env } = setUp();
    // Two folders that neither the Salesforce library nor the org knows a type for, and two it knows types of
    // the logic tier for. A message about a file of that tier does not name its types.
    mock.extraFiles = {
      'aaa/One.mystery': 'What is this?\n',
      'aaa/Two.mystery': 'And this?\n',
      'classes/Thing.mystery': 'And this one?\n',
      'objects/Thing.mystery': 'Or this?\n',
      'zzz/Three.mystery': 'Or this one?\n',
    };
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(5);
    const said = 'could not be read as metadata: The file belongs to no metadata type that is known.';
    expect(run.stdout.split('\n').filter((line) => line.includes('RESOLVE_FAILED'))).toEqual([
      `error     RESOLVE_FAILED  2 issues of this kind. The first: aaa/One.mystery ${said}`,
      `error     RESOLVE_FAILED  classes/Thing.mystery ${said}`,
      `error     RESOLVE_FAILED  objects/Thing.mystery ${said}`,
      `error     RESOLVE_FAILED  zzz/Three.mystery ${said}`,
    ]);
    const { data } = await orglensJson(dir, ['coverage', 'prod']);
    const issues = (data as { issues: { code: string; details: { at?: string; types?: string[] } }[] }).issues;
    expect(
      issues
        .filter((issue) => issue.code === 'RESOLVE_FAILED')
        .map(({ details }) => [details.at, (details.types ?? ['none told']).length > 0]),
    ).toEqual([
      ['aaa/One.mystery', false],
      ['aaa/Two.mystery', false],
      ['classes/Thing.mystery', true],
      ['objects/Thing.mystery', true],
      ['zzz/Three.mystery', false],
    ]);
  });

  it('shows one row for the files of a folder that the Salesforce library says the same of, each with its own name', async () => {
    const { dir, env } = setUp();
    // A file with the ending of a file beside a source file, and no source file: the library cannot place it,
    // and says of every file of the folder that it cannot tell its type, with the path of the file.
    mock.extraFiles = {
      'mysteries/A.mystery': 'What is this?\n',
      'mysteries/B.mystery': 'And this?\n',
      'mysteries/Stray.mystery-meta.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<Mystery/>\n',
    };
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(5);
    expect(run.stdout.split('\n').filter((line) => line.includes('RESOLVE_FAILED'))).toEqual([
      'error     RESOLVE_FAILED  3 issues of this kind. The first: mysteries/A.mystery could not be read as metadata: mysteries/A.mystery: Could not infer a metadata type',
    ]);
  });

  it('leaves out the types that orglens.toml names, and says in the report that they were not read', async () => {
    const { dir, env } = setUp();
    mock.extraTypes = ['Dashboard', 'Report'];
    writeFileSync(
      join(dir, 'orglens.toml'),
      `schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\nexclude_types = ["Report", "Reprot"]\n`,
    );
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      [
        'Snapshot #1 of "prod" is complete: 2 components in 4 files (456 bytes).',
        '',
        'TYPE       LISTED    RETRIEVED  ANALYSED',
        'ApexClass  2         2          0',
        'Report     left out  0          0',
        '',
        '1 more type has no components.',
        '',
        'SEVERITY  CODE               WHAT',
        'info      TYPES_EXCLUDED     1 type is left out of the snapshot, as exclude_types of the source says: Report. The org was not asked for its components.',
        'warning   TYPE_NOT_EXCLUDED  exclude_types of the source names Reprot, and the org describes no metadata type of that name. Nothing was left out for it.',
        '',
        ...classesAnalysed('2 components'),
        ...CROSS_CHECKED,
      ].join('\n'),
    );
    // The org was asked for the two types that are read.
    expect([...mock.listed].sort()).toEqual(['ApexClass', 'Dashboard']);
    const { data } = await orglensJson(dir, ['status']);
    expect(data).toMatchObject({ sources: [{ name: 'prod', excludeTypes: ['Report', 'Reprot'] }] });
    // The coverage says the same later, as text and as JSON that matches the schema.
    const coverage = await orglensJson(dir, ['coverage', 'prod']);
    expect((coverage.data as { types: unknown[] }).types).toContainEqual({
      type: 'Report',
      listed: 0,
      retrieved: 0,
      analysed: 0,
      listing: 'excluded',
      note: 'The configuration leaves this type out (exclude_types).',
    });
    expect((await orglens(dir, ['coverage', 'prod'])).stdout).toContain('Report     left out  0          0');
  });

  it('counts what the snapshot holds, with a component that came back although the org had not listed it', async () => {
    const { dir, env } = setUp();
    mock.unlisted = ['GreeterTest'];
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      [
        'Snapshot #1 of "prod" is complete: 2 components in 4 files (456 bytes).',
        '',
        'TYPE       LISTED  RETRIEVED             ANALYSED',
        'ApexClass  1       1 (and 1 not listed)  0',
        '',
        'SEVERITY  CODE                 WHAT',
        'info      UNLISTED_COMPONENTS  1 component of the type ApexClass came back that the org had not listed. It is in the snapshot. The first: GreeterTest',
        '',
        ...classesAnalysed('2 components'),
        ...CROSS_CHECKED,
      ].join('\n'),
    );
  });

  it('leaves the Dependency API unasked with --no-cross-check, and says so', async () => {
    const { dir, env } = setUp();
    const run = await orglens(dir, ['snapshot', 'prod', '--no-cross-check'], env);
    expect(run.code).toBe(0);
    expect(run.stderr.split('\n').slice(-3)).toEqual([
      'Snapshot #1: 1 of 1 chunk is stored.',
      'Snapshot #1: its files are stored. Analysing them.',
      '',
    ]);
    expect(run.stdout.split('\n').slice(-3)).toEqual([
      '',
      'The Dependency API of Salesforce was not asked for this snapshot. Its analysis is not cross-checked.',
      '',
    ]);
    expect(mock.queries).toEqual([]);
    expect(await orglensJson(dir, ['coverage', 'prod'])).toMatchObject({ data: { crossCheck: null, issues: [] } });
  });

  it('takes the snapshot of an org without the Dependency API all the same, and says that nothing was compared', async () => {
    const { dir, env } = setUp();
    mock.dependencies = null;
    const run = await orglens(dir, ['snapshot', 'prod'], env);
    // A snapshot is not partial for it: every file was read. The analysis is not held against anything.
    expect(run.code).toBe(0);
    expect(run.stdout.split('\n').slice(5)).toEqual([
      'SEVERITY  CODE                  WHAT',
      'warning   CROSS_CHECK_NOT_READ  The Dependency API of the org gave no answer (INVALID_TYPE). What the analysis of this snapshot finds is not held against what Salesforce knows.',
      '',
      ...classesAnalysed('2 components'),
      'Cross-check: the Dependency API of Salesforce gave no answer (INVALID_TYPE). Nothing was compared.',
      '',
    ]);
    expect(await orglensJson(dir, ['coverage', 'prod'])).toMatchObject({
      code: 0,
      data: {
        snapshot: { status: 'complete' },
        analysis: { complete: true },
        crossCheck: { state: 'none', rows: 0, code: 'INVALID_TYPE', comparison: null },
        issues: [{ stage: 'read', severity: 'warning', code: 'CROSS_CHECK_NOT_READ' }],
      },
    });
  });

  it('keeps a snapshot that was interrupted, shows it in the status, and continues it or gives it up', async () => {
    const { dir, env } = setUp();
    mock.retrieveFault = 'REQUEST_LIMIT_EXCEEDED';
    const stopped = await orglens(dir, ['snapshot', 'prod'], env);
    expect(stopped.code).toBe(1);
    expect(stopped.stdout).toBe('');
    expect(stopped.stderr.split('\n').slice(-3)).toEqual([
      'error: The org of the source "prod" refused a request for its metadata. REQUEST_LIMIT_EXCEEDED: The org is busy',
      'hint: Run the command again: snapshot #1 is picked up where it stopped. With --restart it is given up and a new one is taken.',
      '',
    ]);
    const json = await orglensJson(dir, ['snapshot', 'prod'], env);
    expect(json).toMatchObject({
      code: 1,
      ok: false,
      error: {
        code: 'SOURCE_READ_FAILED',
        details: { reason: 'REQUEST_REFUSED', source: 'prod', code: 'REQUEST_LIMIT_EXCEEDED', snapshot: 1 },
      },
    });

    const status = await orglens(dir, ['status']);
    expect(status.stdout.replace(TIME, 'TIME').split('\n').slice(-4)).toEqual([
      'SOURCE  KIND  SNAPSHOTS  LATEST SNAPSHOT  ANALYSED',
      'prod    org   0          none',
      'Snapshot #1 of "prod" was begun TIME and has not ended: 0 of 1 chunk is stored. "orglens snapshot prod" continues it.',
      '',
    ]);
    expect(await orglensJson(dir, ['status'])).toMatchObject({
      data: {
        sources: [{ snapshots: 0, latestSnapshot: null, unfinishedSnapshot: { id: 1, chunksDone: 0, chunks: 1 } }],
      },
    });
    expect((await orglens(dir, ['coverage', 'prod'])).stderr).toContain(
      'There is no snapshot of the source "prod" yet.',
    );

    mock.retrieveFault = null;
    const continued = await orglens(dir, ['snapshot', 'prod'], env);
    expect(continued.code).toBe(0);
    expect(continued.stderr.split('\n')).toEqual([
      'Logged in to the org of "prod". It is read with API version 66.0.',
      'Snapshot #1 was interrupted and is continued: 0 of 1 chunk is stored.',
      'Snapshot #1: 1 of 1 chunk is stored.',
      'Snapshot #1: every chunk is done. Asking the Dependency API of Salesforce which references it knows.',
      'Snapshot #1: its files are stored. Analysing them.',
      '',
    ]);
    expect(continued.stdout.replace(TIME, 'TIME').split('\n')).toEqual([
      'Snapshot #1 of "prod" is complete: 2 components in 4 files (456 bytes).',
      '',
      'TYPE       LISTED  RETRIEVED  ANALYSED',
      'ApexClass  2       2          0',
      '',
      'SEVERITY  CODE              WHAT',
      // It was continued twice: once by the run that asked for JSON and was refused as well, once by this one.
      ...Array.from(
        { length: 2 },
        () =>
          'info      SNAPSHOT_RESUMED  The snapshot was interrupted and continued at TIME. What it holds was read from the org at more than one time.',
      ),
      '',
      ...classesAnalysed('2 components'),
      ...CROSS_CHECKED,
    ]);

    // With --restart an interrupted snapshot is given up. Here there is none, and a new one is taken.
    mock.retrieveFault = 'REQUEST_LIMIT_EXCEEDED';
    await orglens(dir, ['snapshot', 'prod'], env);
    mock.retrieveFault = null;
    const restarted = await orglensJson(dir, ['snapshot', 'prod', '--restart'], env);
    expect(restarted).toMatchObject({ code: 0, data: { snapshot: { id: 3, status: 'complete' }, issues: [] } });
    expect(await orglensJson(dir, ['coverage', 'prod', '--snapshot', '2'])).toMatchObject({
      data: { snapshot: { id: 2, status: 'failed' }, issues: [{ code: 'SNAPSHOT_GIVEN_UP' }] },
    });
  });

  it('ends with 4 and stores nothing when the login does not work', async () => {
    const { dir, env } = setUp();
    mock.refusal = "user hasn't approved this consumer";
    try {
      const run = await orglensJson(dir, ['snapshot', 'prod'], env);
      expect(run).toMatchObject({
        code: 4,
        ok: false,
        error: { code: 'LOGIN_FAILED', details: { reason: 'JWT_REJECTED' } },
      });
      expect(mock.operations).toEqual([]);
    } finally {
      mock.refusal = null;
    }
  });
});
