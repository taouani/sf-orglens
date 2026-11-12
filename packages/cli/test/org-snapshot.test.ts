/**
 * `orglens snapshot` of an org, against a mock org on this machine that
 * holds two Apex classes. The tests of the engine cover what can go wrong
 * in a retrieve. These cover what a person and a script see of it.
 */
import { generateKeyPairSync } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
  mock.retrieveFault = null;
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
        '',
      ].join('\n'),
      stdout: [
        'Snapshot #1 of "prod" is complete: 2 components in 4 files (456 bytes).',
        '',
        'TYPE       LISTED  RETRIEVED  ANALYSED',
        'ApexClass  2       2          0',
        '',
      ].join('\n'),
    });
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
    expect(status.stdout.replace(TIME, 'TIME')).toContain(
      ['SOURCE  KIND  SNAPSHOTS  LATEST SNAPSHOT', 'prod    org   1          #1 complete, finished TIME', ''].join(
        '\n',
      ),
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
        issues: [],
      },
    });
    expect((await orglensJson(dir, ['coverage', 'prod'])).data).toEqual(json.data);
    expect(await orglensJson(dir, ['status'])).toMatchObject({
      data: { sources: [{ name: 'prod', snapshots: 1, latestSnapshot: { id: 1 }, unfinishedSnapshot: null }] },
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
        'Snapshot #1 of "prod" is partial, something is missing: 2 components in 2 files (245 bytes).',
        '',
        'TYPE       LISTED  RETRIEVED  ANALYSED',
        'ApexClass  2       1          0',
        '',
        'SEVERITY  CODE               WHAT',
        "warning   RETRIEVE_MESSAGES  Salesforce made 1 remark about a retrieve. The first: Entity of type 'ApexClass' named 'GreeterTest' cannot be found",
        'error     NOT_RETRIEVED      1 component of the type ApexClass that the org listed did not come back. The first: GreeterTest',
        '',
      ].join('\n'),
    );
  });

  it('keeps a snapshot that was interrupted, shows it in the status, and continues it or gives it up', async () => {
    const { dir, env } = setUp();
    mock.retrieveFault = 'UNKNOWN_EXCEPTION';
    const stopped = await orglens(dir, ['snapshot', 'prod'], env);
    expect(stopped.code).toBe(1);
    expect(stopped.stdout).toBe('');
    expect(stopped.stderr.split('\n').slice(-3)).toEqual([
      'error: The org of the source "prod" refused a request for its metadata. UNKNOWN_EXCEPTION: The org is busy',
      'hint: Run the command again: snapshot #1 is picked up where it stopped. With --restart it is given up and a new one is taken.',
      '',
    ]);
    const json = await orglensJson(dir, ['snapshot', 'prod'], env);
    expect(json).toMatchObject({
      code: 1,
      ok: false,
      error: {
        code: 'SOURCE_READ_FAILED',
        details: { reason: 'REQUEST_REFUSED', source: 'prod', code: 'UNKNOWN_EXCEPTION', snapshot: 1 },
      },
    });

    const status = await orglens(dir, ['status']);
    expect(status.stdout.replace(TIME, 'TIME').split('\n').slice(-4)).toEqual([
      'SOURCE  KIND  SNAPSHOTS  LATEST SNAPSHOT',
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
    ]);

    // With --restart an interrupted snapshot is given up. Here there is none, and a new one is taken.
    mock.retrieveFault = 'UNKNOWN_EXCEPTION';
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
