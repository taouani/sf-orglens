/**
 * The tools of the live-org workflow (`test/live`), against a mock org on
 * this machine. The real runs are the ones of the workflow. These tests
 * cover what a real run cannot be trusted with: that a tool says what
 * happened, and that nothing of the login or of the org reaches its output.
 */
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { metadataFromSource, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { tempDirs } from './helpers/store.ts';
import { deployFixture, shownProblem } from './live/deploy-fixture.ts';
import { publicLog, type PublicLog } from './live/public-log.ts';
import { fileDifference, readOrg, remarkForm } from './live/read-org.ts';
import { fixtureComponents, fixtureFiles } from './live/test-org.ts';

const FIXTURE = join(FIXTURES_DIR, 'billing-sfdx', 'force-app');
const ORG_ID = '00Dxx0000000001EAA';
const USERNAME = 'ci.user@orglens-test.example';
const CLIENT_ID = '3MVG9clientidofthetestorg';

/** A key pair made for the test. No key is ever kept in the repository. */
const pair = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const dirs = tempDirs();
let mock: MockOrg;
let metadata: MockMetadata;

beforeAll(async () => {
  mock = await startMockOrg({ orgId: ORG_ID });
});
afterAll(async () => {
  await mock.close();
});
beforeEach(async () => {
  metadata = await metadataFromSource(FIXTURE);
  metadata.pollsBeforeDone = 0;
  mock.metadata = metadata;
  mock.key = { username: USERNAME, clientId: CLIENT_ID, publicKey: pair.publicKey };
});
afterEach(() => {
  mock.requests.length = 0;
  mock.sessions.clear();
  mock.key = null;
  mock.intercept = null;
  dirs.cleanUp();
});

/** The variables the workflow gives a step, for the mock org. */
const environment = (): Record<string, string | undefined> => ({
  ...process.env,
  ORGLENS_JWT_TEST_ORG_LOGIN_URL: mock.url,
  ORGLENS_JWT_TEST_ORG_USERNAME: USERNAME,
  ORGLENS_JWT_TEST_ORG_CLIENT_ID: CLIENT_ID,
  ORGLENS_JWT_TEST_ORG_KEY: pair.privateKey,
});

/** What must never stand in the output of a tool. */
const secrets = (): string[] => [
  mock.url,
  new URL(mock.url).host,
  '127.0.0.1',
  USERNAME,
  'orglens-test.example',
  CLIENT_ID,
  ORG_ID,
  ORG_ID.slice(0, 15),
  'session-',
  'PRIVATE KEY',
  'Mock User',
];

function expectNoSecret(output: string): void {
  for (const secret of secrets()) expect(output).not.toContain(secret);
}

const collected = (): { log: PublicLog; text: () => string } => {
  const log = publicLog(() => undefined);
  return { log, text: () => log.lines.join('\n') };
};

describe('what a step of the live-org workflow may print', () => {
  it('prints a line of its own, and replaces a line that holds a word of the settings', () => {
    const printed: string[] = [];
    const log = publicLog((line) => printed.push(line));
    log.forbid('https://acme-dev-ed.my.salesforce.example', 'jane@acme.example', '3MVG9secretclient', null, undefined);
    log.say('Deployed: 12 of 12.');
    log.say('The org is at acme-dev-ed.my.salesforce.example.');
    log.say('The domain is ACME-DEV-ED.');
    log.say('The user is someone@acme.example.');
    log.say('The app is 3MVG9secretclient.');
    log.say('The org is 00D5e000000abcd and no other.');
    const hidden = 'A line is not shown here, because it holds a word of the settings of the login.';
    expect(printed).toEqual(['Deployed: 12 of 12.', hidden, hidden, hidden, hidden, hidden]);
    expect(log.lines).toEqual(printed);
    expect(log.failed).toBe(false);
  });

  it('does not lose every line to an everyday word in a user name or to a short word', () => {
    const { log, text } = collected();
    log.forbid('test@org.example', 'abc');
    log.say('The test org was read. abc');
    expect(text()).toBe('The test org was read. abc');
  });

  it('takes a value only in the form of its kind', () => {
    const { log } = collected();
    log.forbid('https://acme.example');
    expect(log.code('REQUEST_LIMIT_EXCEEDED')).toBe('REQUEST_LIMIT_EXCEEDED');
    expect(log.code('Request limit exceeded for acme')).toBeNull();
    expect(log.code(undefined)).toBeNull();
    expect(log.name('CustomField')).toBe('CustomField');
    expect(log.name('Invoice__c')).toBeNull();
    expect(log.name('Acme')).toBeNull();
    expect(log.name('two words')).toBeNull();
    expect(log.version('68.0')).toBe('68.0');
    expect(log.version('68.0 of acme')).toBeNull();
    expect(log.count(12)).toBe('12');
    expect(log.count('12')).toBe('unknown');
  });

  it('marks the first line of a failure as the error of the run', () => {
    const { log, text } = collected();
    log.fail(['The step failed for a reason.', 'More about it.']);
    expect(text()).toBe('::error::The step failed for a reason.\nMore about it.');
    expect(log.failed).toBe(true);
  });
});

describe('a problem of a deploy, as it is printed', () => {
  const { log } = collected();
  log.forbid('https://acme.example');

  it.each([
    'Variable does not exist: Amount__c',
    'Invalid type: InvoiceLine',
    'Method does not exist or incorrect signature: void post(List<Invoice__c>) from the type InvoiceService',
    "No such column 'Total__c' on entity 'Invoice__c'. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name. Please reference your WSDL or the describe call for the appropriate names.",
    "Unexpected token '}'.",
    "Missing ';' at 'return'",
    'Field Amount__c does not exist. Check spelling.',
    'Illegal assignment from Decimal to String',
  ])('shows the known form: %s', (problem) => {
    expect(shownProblem(log, problem)).toBe(problem);
  });

  it.each([
    'Something Salesforce never said before about https://other.example',
    'Variable does not exist: Amount__c and more that is not of the form',
    'Invalid type: acme',
    '',
    undefined,
  ])('does not show another text: %s', (problem) => {
    expect(shownProblem(log, problem)).toBe(
      'not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it.',
    );
  });

  it('shows of a class that has to be compiled again only that it is one', () => {
    expect(shownProblem(log, 'Dependent class is invalid and needs recompilation:\n Class Other : whatever')).toBe(
      'Dependent class is invalid and needs recompilation. What follows it is not shown.',
    );
  });
});

describe('how a file that came back differs', () => {
  const { log } = collected();
  const difference = (path: string, ours: string, theirs: string): string | null =>
    fileDifference(log, path, Buffer.from(ours), Buffer.from(theirs));

  it('says nothing of two files that are the same', () => {
    expect(difference('classes/A.cls', 'class A {}\n', 'class A {}\n')).toBeNull();
  });

  it('tells line ends and white space from content', () => {
    expect(difference('classes/A.cls', 'class A {\n}\n', 'class A {\r\n}\r\n')).toBe(
      'only the line ends differ (12 bytes here, 14 from the org)',
    );
    expect(difference('classes/A.cls', 'class A {\n}\n', 'class A {  \n}')).toBe(
      'only white space at the end of lines or of the file differs (12 bytes here, 13 from the org)',
    );
    expect(difference('classes/A.cls', 'class A {\n  Integer a;\n}\n', 'class A {\n  Integer b;\n}\n')).toBe(
      '1 line differs of 3 (25 bytes here, 25 from the org)',
    );
    expect(difference('classes/A.cls', 'class A {\n}\n', 'class A {\n  // more\n}\n')).toBe(
      '2 lines here, 3 from the org (12 bytes here, 22 from the org)',
    );
  });

  it('names the elements an org added to a metadata file or left out, and nothing of their values', () => {
    const ours =
      '<CustomField><fullName>A__c</fullName><label>A</label><description>secret words</description></CustomField>';
    const theirs =
      '<CustomField><fullName>A__c</fullName><externalId>false</externalId><label>A</label><trackTrending>false</trackTrending></CustomField>';
    expect(difference('objects/X__c/fields/A__c.field-meta.xml', ours, theirs)).toBe(
      'the org added externalId (1), trackTrending (1); the org left out description (1); 107 bytes here, 134 from the org',
    );
    expect(difference('a.xml', '<a><b>1</b><c>2</c></a>', '<a><c>2</c><b>1</b></a>')).toBe(
      'the same elements, in another order or with other values (23 bytes here, 23 from the org)',
    );
    expect(difference('a.xml', "<a><b>it's</b></a>", '<a><b>it&apos;s</b></a>')).toBe(
      'only how characters such as quotes are written differs (18 bytes here, 23 from the org)',
    );
    expect(difference('a.xml', '<a><b>1</b></a>', '<a>\n    <b>1</b>\n</a>')).toBe(
      'only white space between elements differs (15 bytes here, 21 from the org)',
    );
  });
});

describe('a remark of Salesforce about a retrieve, as it is printed', () => {
  const { log } = collected();
  it('shows the form and the type, and never the name', () => {
    expect(remarkForm(log, "Entity of type 'ApexClass' named 'SecretPlan' cannot be found")).toBe(
      "Entity of type 'ApexClass' named '(a name)' cannot be found",
    );
    expect(remarkForm(log, "Entity of type 'Secret Plan' named 'X' cannot be found")).toBe(
      "Entity of type '(not shown)' named '(a name)' cannot be found",
    );
    expect(remarkForm(log, 'Something else about SecretPlan')).toBe(
      'a remark of a form that is not known, and not shown',
    );
  });
});

describe('deploying the fixture project', () => {
  it('sends the whole project as one deploy without tests, and says how it went', async () => {
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(false);
    expect(text().replace(/after \d+ seconds/, 'after N seconds')).toBe(
      [
        'The deploy of the fixture project ended as Succeeded after N seconds.',
        'Components of the fixture project: 52. Salesforce counted 16, deployed 16 and found errors in 0.',
        'Of the components Salesforce accepted, 8 are new in the org, 8 were changed, and 0 were as they are.',
        'The fixture project is in the test org. No Apex test was run.',
      ].join('\n'),
    );
    expect(metadata.deploys).toHaveLength(1);
    expect(metadata.deploys[0]?.options).toEqual({
      rollbackOnError: 'true',
      singlePackage: 'true',
      testLevel: 'NoTestRun',
    });
    // The zip file holds every file of the project, in the layout of the Metadata API, and its list of contents.
    const sent = metadata.deploys[0]?.files ?? [];
    expect(sent).toContain('package.xml');
    expect(sent).toContain('classes/InvoiceService.cls');
    expect(sent).toContain('triggers/InvoiceTrigger.trigger');
    expect(sent).toContain('objects/Invoice__c.object');
    expectNoSecret(text());
  });

  it('names what Salesforce did not accept: the component and the place, and the problem if its form is known', async () => {
    metadata.deployProblems.push(
      {
        type: 'ApexClass',
        fullName: 'InvoiceService',
        fileName: 'classes/InvoiceService.cls',
        line: 14,
        column: 9,
        problem: 'Variable does not exist: Amount__c',
      },
      {
        type: 'ApexClass',
        fullName: 'InvoiceSelector',
        fileName: 'classes/InvoiceSelector.cls',
        line: 3,
        column: 1,
        problem: `The user ${USERNAME} of ${mock.url} may not do this`,
      },
      {
        type: 'CustomObject',
        fullName: 'Secret_Plan__c',
        fileName: 'objects/Secret_Plan__c.object',
        problem: 'Entity is not org-accessible',
      },
    );
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(true);
    expect(
      text()
        .replace(/after \d+ seconds/, 'after N seconds')
        .split('\n')
        .slice(0, 2)
        .concat(text().split('\n').slice(2)),
    ).toEqual([
      '::error::The deploy of the fixture project ended as Failed after N seconds.',
      'Components of the fixture project: 52. Salesforce counted 16, deployed 0 and found errors in 3.',
      '1. ApexClass InvoiceService, file classes/InvoiceService.cls, line 14, column 9',
      '   Problem: Variable does not exist: Amount__c',
      '2. ApexClass InvoiceSelector, file classes/InvoiceSelector.cls, line 3, column 1',
      '   Problem: not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it.',
      '3. CustomObject (a name that is not of the fixture project), line 0, column 0',
      '   Problem: Entity is not org-accessible',
    ]);
    expectNoSecret(text());
    expect(text()).not.toContain('Secret_Plan');
  });

  it('says which secrets are missing, and asks the org nothing', async () => {
    const { log, text } = collected();
    await deployFixture(log, {
      env: { ...environment(), ORGLENS_JWT_TEST_ORG_KEY: ' ', ORGLENS_JWT_TEST_ORG_USERNAME: undefined },
    });
    expect(log.failed).toBe(true);
    expect(text()).toBe(
      [
        '::error::The test org was not logged in to: secrets are missing.',
        'Not set in the environment "live-org": ORGLENS_TEST_ORG_USERNAME, ORGLENS_TEST_ORG_JWT_KEY.',
        'docs/live-org-setup.md says how they are set.',
      ].join('\n'),
    );
    expect(mock.requests).toEqual([]);
  });

  it('says with codes only that the login failed', async () => {
    mock.key = null;
    const { log, text } = collected();
    await deployFixture(log, { env: environment() });
    expect(log.failed).toBe(true);
    expect(text()).toBe(
      [
        '::error::The fixture project was not deployed, because the login to the test org failed: LOGIN_FAILED (JWT_REJECTED).',
        'The message is not shown here. docs/cli.md lists the codes.',
      ].join('\n'),
    );
    expect(metadata.deploys).toEqual([]);
    expectNoSecret(text());
  });

  it('says that the org refused the deploy, with the code of the fault and without its text', async () => {
    mock.intercept = (request) =>
      /<(?:\w+:)?deploy[\s>]/.test(request.body)
        ? {
            status: 500,
            type: 'text/xml',
            body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>sf:INSUFFICIENT_ACCESS</faultcode><faultstring>INSUFFICIENT_ACCESS: the user ${USERNAME} may not deploy</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
          }
        : undefined;
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(true);
    expect(text()).toBe(
      '::error::The deploy of the fixture project could not be made (INSUFFICIENT_ACCESS). What the org or the library said is not shown here.',
    );
  });
});

describe('reading the test org', () => {
  it('takes a snapshot and says in numbers what it holds, with the fixture project found in it', async () => {
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain('logged in. The org is read with API version 66.0.');
    expect(output).toMatch(/The snapshot of the test org is complete\. It took \d+\.\d s: /);
    expect(output).toMatch(/Requests to the Metadata API: [1-9]\d*\. Largest memory of the process: \d+ MB\./);
    expect(output).toMatch(/Retrieves: 1 chunk, 1 stored, 0 failed, 0 not ended\. Started more than once: 0\./);
    expect(output).toMatch(/^ApexClass +12 +12 +ok$/m);
    expect(output).toMatch(/^CustomField +31 +31 +ok$/m);
    expect(output).toContain('Observations: 0.');
    const components = fixtureComponents().length;
    expect(output).toContain(
      `Fixture project: ${String(components)} components. Listed by the org: ${String(components)}. Retrieved: ${String(components)}.`,
    );
    const files = fixtureFiles().size;
    // The mock org hands a file out as the Salesforce library writes it, which writes a quote as a reference.
    expect(output).toContain(
      `Files of the fixture project: ${String(files)}. In the snapshot: ${String(files)}. The same byte for byte: ${String(files - 5)}. Different: 5.`,
    );
    expect(output).toContain(
      '- objects/Invoice__c/fields/Summary__c.field-meta.xml: only how characters such as quotes are written differs (391 bytes here, 411 from the org)',
    );
    expect(output).toMatch(/^0 +16 +3 +\d+\.\d +1 +done$/m);
    expect(output).toMatch(/^Files by folder: classes 24, objects \d+, triggers 2$/m);
    expectNoSecret(output);
  });

  it('fails when the snapshot is partial, and names the component of the fixture project that is missing', async () => {
    metadata.withheld.add('ApexClass:InvoiceSelector');
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toContain('The snapshot of the test org is partial.');
    expect(output).toMatch(/^ApexClass +12 +11 +ok$/m);
    expect(output).toContain(
      '- error NOT_RETRIEVED: 1 observation, about 1 components, files or remarks. Types: ApexClass',
    );
    expect(output).toContain("- 1 times: Entity of type 'ApexClass' named '(a name)' cannot be found");
    expect(output).toContain('- ApexClass InvoiceSelector: listed, not retrieved');
    expect(output).toContain('- classes/InvoiceSelector.cls: not in the snapshot');
    expect(output.split('\n').slice(-2)).toEqual([
      '',
      '::error::The snapshot of the test org is not complete. The observations above say what is missing.',
    ]);
    expectNoSecret(output);
  });

  it('says with codes that the org refused, and what the snapshot holds so far', async () => {
    metadata.failing.add('ApexTrigger');
    mock.intercept = (request) =>
      request.body.includes('<retrieve')
        ? {
            status: 500,
            type: 'text/xml',
            body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>sf:REQUEST_LIMIT_EXCEEDED</faultcode><faultstring>REQUEST_LIMIT_EXCEEDED: TotalRequests Limit exceeded for ${USERNAME}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
          }
        : undefined;
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toMatch(/Retrieves: 1 chunk, 0 stored, 0 failed, 1 not ended\./);
    expect(output).toMatch(/^ApexTrigger +0 +0 +failed$/m);
    expect(output).toContain('- and 32 more components.');
    expect(output).toContain('- and 45 more files that are not in the snapshot.');
    expect(output).toContain(
      '- error LISTING_FAILED: 1 observation. Types: ApexTrigger. Codes of Salesforce: INVALID_TYPE (1)',
    );
    expect(output.split('\n').slice(-5)).toEqual([
      '',
      '::error::The snapshot of the test org did not end: SOURCE_READ_FAILED (REQUEST_REFUSED).',
      'Code of Salesforce: REQUEST_LIMIT_EXCEEDED',
      'Unfinished snapshot: #1',
      'The message is not shown here. docs/cli.md lists the codes.',
    ]);
    expectNoSecret(output);
  });
});

describe('a tool of the live-org workflow as a program', () => {
  /** Starts a tool from source, as the workflow does. It must not block this process, which is where the mock org answers. */
  const run = (
    tool: string,
    env: Record<string, string | undefined>,
  ): Promise<{ stdout: string; stderr: string; code: number | null }> =>
    new Promise((resolve) => {
      const script = fileURLToPath(new URL(`./live/${tool}`, import.meta.url));
      const child = spawn(process.execPath, ['--no-warnings', script], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('close', (code) => {
        resolve({ stdout, stderr, code });
      });
    });

  it('deploys and reads from source, prints nothing but its own lines, and ends with 0', async () => {
    const home = dirs.next();
    const env = { ...environment(), HOME: home, USERPROFILE: home };
    const deployed = await run('deploy-fixture.ts', env);
    expect(deployed.stderr).toBe('');
    expect(deployed.stdout).toContain('The fixture project is in the test org. No Apex test was run.\n');
    expect(deployed.code).toBe(0);
    expectNoSecret(deployed.stdout);

    const read = await run('read-org.ts', env);
    expect(read.stderr).toBe('');
    expect(read.stdout).toContain('The snapshot of the test org is complete.');
    expect(read.code).toBe(0);
    expectNoSecret(read.stdout);
  });

  it('prints only what the tool itself printed, whatever a library writes or throws', async () => {
    const noisy = fileURLToPath(new URL('./helpers/noisy-tool.ts', import.meta.url));
    const start = (...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> =>
      new Promise((resolve) => {
        // Without --no-warnings, to see that a warning of Node.js itself is dropped as well.
        const child = spawn(process.execPath, [noisy, ...args], { env: process.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('close', (code) => {
          resolve({ stdout, stderr, code });
        });
      });
    expect(await start('the-secret-of-the-org')).toEqual({
      code: 1,
      stderr: '',
      stdout:
        'A line of the tool itself.\n::error::The step ended with an error that was not handled (RangeError). Its message is not shown here.\n',
    });
    expect(await start('the-secret-of-the-org', 'reject')).toEqual({
      code: 1,
      stderr: '',
      stdout:
        'A line of the tool itself.\n::error::The step ended with a failure that was not handled (TypeError). Its message is not shown here.\n',
    });
  });

  it('ends with 1 and an error of its own when the step fails, and when something throws that nobody caught', async () => {
    const home = dirs.next();
    const failed = await run('read-org.ts', {
      ...environment(),
      HOME: home,
      USERPROFILE: home,
      ORGLENS_JWT_TEST_ORG_KEY: '',
    });
    expect(failed.code).toBe(1);
    expect(failed.stderr).toBe('');
    expect(failed.stdout.split('\n')[0]).toBe('::error::The test org was not logged in to: secrets are missing.');

    mock.key = null;
    const refused = await run('deploy-fixture.ts', { ...environment(), HOME: home, USERPROFILE: home });
    expect(refused.code).toBe(1);
    expect(refused.stderr).toBe('');
    expect(refused.stdout).toBe(
      '::error::The fixture project was not deployed, because the login to the test org failed: LOGIN_FAILED (JWT_REJECTED).\nThe message is not shown here. docs/cli.md lists the codes.\n',
    );
  });
});
