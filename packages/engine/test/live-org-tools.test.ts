/**
 * The tools of the live-org workflow (`test/live`), against a mock org on
 * this machine. The real runs are the ones of the workflow. These tests
 * cover what a real run cannot be trusted with: that a tool says what
 * happened, and that nothing of the login or of the org reaches its output.
 */
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { metadataFromSource, soapFault, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { tempDirs } from './helpers/store.ts';
import { deployFixture, fixtureWords, shownProblem } from './live/deploy-fixture.ts';
import { publicLog, type PublicLog } from './live/public-log.ts';
import { probeOrg } from './live/probe-org.ts';
import {
  everydayWords,
  fileDifference,
  missingLines,
  nameForm,
  placeForm,
  readOrg,
  remarkForm,
} from './live/read-org.ts';
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

  it('does not take the first word of an address that every org is logged in to for a word of the org', () => {
    const { log, text } = collected();
    log.forbid('https://login.salesforce.com', 'https://test.salesforce.com');
    log.say('The login to the test org failed.');
    expect(text()).toBe('The login to the test org failed.');
  });

  it('keeps one line one line', () => {
    const { log, text } = collected();
    log.say('first\n::error::second\r\nthird');
    expect(text()).toBe('first ::error::second third');
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
  const words = fixtureWords();
  const where = 'The page "Deployment Status" in the Setup of the test org shows it.';

  it.each([
    'Variable does not exist: Amount__c',
    'Invalid type: InvoiceSelector',
    'Method does not exist or incorrect signature: void post(List<Invoice__c>) from the type InvoiceService',
    'Method does not exist or incorrect signature: void post(Map<Id, List<Invoice__c>>, String) from the type InvoiceService',
    "No such column 'Total__c' on entity 'Invoice__c'. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name. Please reference your WSDL or the describe call for the appropriate names.",
    "Unexpected token '}'.",
    "Missing ';' at 'return'",
    'Field Amount__c does not exist. Check spelling.',
    'Illegal assignment from Decimal to String',
    'Entity is not org-accessible',
  ])('shows the known form: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toBe(problem);
  });

  it.each([
    'Something Salesforce never said before about https://other.example',
    'Variable does not exist: Amount__c and more that is not of the form',
    // A signature is not a place for prose.
    'Invalid type: the quick brown fox of Initech Corp jumps over the lazy admin',
    'Illegal assignment from everything the org said about Initech to nothing at all',
    '',
    undefined,
  ])('does not show a text of another form: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toBe(`not shown, because it is not of a known form. ${where}`);
  });

  it.each([
    'Variable does not exist: Secret_Plan__c.Takeover_Date__c',
    'Invalid type: SecretPlan',
    'Invalid type: acme',
    'Illegal assignment from Decimal to Initech',
    "Unexpected token 'SecretPlan'.",
    'Method does not exist or incorrect signature: void post(List<Secret_Plan__c>) from the type InvoiceService',
  ])('does not show a known form that names something the fixture project does not hold: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toBe(
      `not shown, because it names something that is not in the fixture project. ${where}`,
    );
  });

  it('shows of a problem about something else than a component of the fixture project only a form without names', () => {
    expect(shownProblem(log, 'Entity is not org-accessible', words, false)).toBe('Entity is not org-accessible');
    expect(shownProblem(log, 'Variable does not exist: Amount__c', words, false)).toBe(
      `not shown, because it is not of a known form. ${where}`,
    );
  });

  it('shows of a class that has to be compiled again only that it is one', () => {
    expect(
      shownProblem(log, 'Dependent class is invalid and needs recompilation:\n Class Other : whatever', words),
    ).toBe('Dependent class is invalid and needs recompilation. What follows it is not shown.');
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
      'a remark of a form that is not known. Its everyday words: …',
    );
  });
});

describe('a text that is not ours, in everyday words', () => {
  it('keeps the words of the list, and leaves out names, numbers and what stands in quotes', () => {
    expect(
      everydayWords('Load of metadata from db failed for metadata of type:Report and file name:SECRET_PLANS/Takeover.'),
    ).toBe('Load of metadata from db failed for metadata of … and file …');
    expect(everydayWords("The folder 'All Files' cannot be found in Secret_Plan__c 42 times.")).toBe(
      'The folder … cannot be found in …',
    );
    // A name that is made of everyday words is not taken apart at its underscores.
    expect(everydayWords('Standard_Value_Set is unknown (not found).')).toBe('… is unknown (not found).');
    expect(everydayWords('')).toBe('');
  });

  it('keeps the names it is given, such as the names of metadata types', () => {
    expect(everydayWords('Entity type CustomObject is unknown', new Set(['CustomObject']))).toBe(
      'Entity type CustomObject is unknown',
    );
    expect(everydayWords('Entity type CustomObject is unknown')).toBe('Entity type … is unknown');
    // Only where the word "type" stands before it: a component can have the name of a type.
    expect(everydayWords('Entity Queue named Dashboard cannot be found', new Set(['Queue', 'Dashboard']))).toBe(
      'Entity … named … cannot be found',
    );
  });

  it('leaves out what stands in any kind of quotes or in brackets, and a path with spaces in it', () => {
    expect(everydayWords('The package \u201CManaged Package Settings\u201D is not installed')).toBe(
      'The package … is not installed',
    );
    expect(everydayWords('The folder `Custom Settings` and the file [Error Record] cannot be found')).toBe(
      'The folder … and the file … cannot be found',
    );
    // The apostrophe of a word is no quote: the name in quotes after it stays hidden.
    expect(everydayWords("Can't retrieve 'Custom Settings' because it doesn't exist")).toBe(
      '… retrieve … because it … exist',
    );
    // A quote without a partner ends the text.
    expect(everydayWords('The file "Custom Error Record is unknown')).toBe('The file …');
    expect(
      everydayWords('Could not read /tmp/x/layouts/Account-Custom Error Record Layout.layout-meta.xml as metadata.'),
    ).toBe('Could not read … as metadata.');
    expect(everydayWords('The path C:\\work\\Standard Value Set.txt is invalid')).toBe('The path … is invalid');
  });
});

describe('the place of something that could not be read as metadata', () => {
  it('shows a folder and an ending only if they are words of the source format', () => {
    const { log } = collected();
    expect(placeForm(log, 'reports/SECRET_PLANS/Takeover.report-meta.xml')).toBe(
      'in reports, 2 levels deep, a name that ends in .report-meta.xml',
    );
    expect(placeForm(log, 'documents/Deals/Plan.AcmeTakeover')).toBe(
      'in documents, 2 levels deep, a name that ends in (an ending that is not shown)',
    );
    expect(placeForm(log, 'HiddenNotes/Budget.MergerWithGlobex')).toBe(
      'in (a folder that is not shown), 1 level deep, a name that ends in (an ending that is not shown)',
    );
    expect(placeForm(log, 'Takeover.txt')).toBe(
      'in (a folder that is not shown), 0 levels deep, a name that ends in .txt',
    );
    expect(placeForm(log, '/Takeover')).toBe(
      'in (a folder that is not shown), 1 level deep, a name that ends in (an ending that is not shown)',
    );
  });

  it('shows of a component its type and the form of its name', () => {
    const { log } = collected();
    expect(placeForm(log, 'QuickAction Account.AcmeTakeover')).toBe(
      'a component of the type QuickAction, with a name of the form a.a',
    );
    expect(placeForm(log, 'CustomMetadata Config.Secret Deal')).toBe(
      'a component of the type CustomMetadata, with a name of the form a.a a',
    );
    // A word before a space that is no metadata type is the start of a name.
    expect(placeForm(log, 'Takeover Plans/Budget.txt')).toBe(
      'a component of the type (not shown), with a name of the form a/a.a',
    );
  });
});

describe('the form of a name', () => {
  it('says how a name is built and nothing of the name', () => {
    expect(nameForm('SecretPlan')).toBe('a');
    expect(nameForm('Account.Secret_Plan')).toBe('a.a');
    expect(nameForm('unfiled$public/Takeover_2026')).toBe('unfiled$public/a');
    expect(nameForm('SECRET_PLANS/Take%2Eover')).toBe('a/a%a');
    expect(nameForm('Übernahme-Plan (alt)')).toBe('?a-a (a)');
    expect(nameForm('a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z')).toBe(
      'a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.…',
    );
  });
});

describe('what is said about components that are missing', () => {
  const { log } = collected();
  const item = (type: string, fullName: string, listed: boolean, retrieved: boolean, more: object = {}) => ({
    type,
    fullName,
    listed,
    retrieved,
    namespacePrefix: null,
    manageableState: null,
    ...more,
  });

  it('says nothing when everything the org listed came back and nothing else', () => {
    expect(missingLines(log, [item('ApexClass', 'SecretPlan', true, true)])).toEqual([]);
  });

  it('says how many are missing, how their names are built, and whether what they belong to came back', () => {
    const lines = missingLines(log, [
      item('CustomObject', 'Account', true, true),
      item('CustomObject', 'Secret_Plan__c', true, false),
      item('ListView', 'Account.Secret_View', true, false),
      item('ListView', 'Secret_Plan__c.All', true, false),
      item('ListView', 'Takeover.All', true, false),
      item('ListView', 'Account.Kept', true, true),
      item('ReportFolder', 'SECRET_PLANS', true, true),
      item('Report', 'SECRET_PLANS/Takeover', true, false),
      item('Report', 'unfiled$public/Takeover', true, false),
      item('Report', 'hidden_notes/Takeover', true, false, { namespacePrefix: 'sp', manageableState: 'installed' }),
    ]);
    expect(lines).toEqual([
      '',
      'Components the org listed and did not hand out, by type. A name is shown as its form only: "a" stands for letters, digits and underscores.',
      '- CustomObject: 1 of 2 did not come back. Forms of the names: a (1).',
      '- ListView: 3 of 4 did not come back. Forms of the names: a.a (3). What stands before the dot, as CustomObject: came back (1), did not come back (1), is not in the list (1).',
      '- Report: 3 of 3 did not come back. Of a package: 1. State: none (2), installed (1). Forms of the names: a/a (2), unfiled$public/a (1). The folder before the slash, as ReportFolder: came back (1), is not in the list (1), is the folder of unfiled items (1).',
    ]);
    for (const name of ['Secret', 'SECRET', 'Takeover', 'hidden', 'Kept']) expect(lines.join('\n')).not.toContain(name);
  });

  it('says when a component came back under a name that is nearly the one the org listed', () => {
    const lines = missingLines(log, [
      item('RecordType', 'Account.Secret_Plan', true, false),
      item('RecordType', 'account.secret_plan', false, true),
      item('Report', 'SECRET_PLANS/Take%2Eover', true, false),
      item('Report', 'SECRET_PLANS/Take.over', false, true),
      item('LightningComponentBundle', 'sp__takeover', true, false),
      item('LightningComponentBundle', 'takeover', false, true),
      item('CustomField', 'Account.Secret_Plan__c', true, false),
      item('CustomField', 'Person.Secret_Plan__c', false, true),
      item('CustomField', 'Account.Other__c', true, false),
    ]);
    expect(lines).toEqual([
      '',
      'Components the org listed and did not hand out, by type. A name is shown as its form only: "a" stands for letters, digits and underscores.',
      '- CustomField: 2 of 2 did not come back. Forms of the names: a.a (2). What stands before the dot, as CustomObject: is not in the list (2). Came back, not listed, under a name that differs in what stands before its last dot or slash (1).',
      '- LightningComponentBundle: 1 of 1 did not come back. Forms of the names: a (1). Came back, not listed, under a name that differs only in the prefix of a package (1).',
      '- RecordType: 1 of 1 did not come back. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1). Came back, not listed, under a name that differs only in upper and lower case (1).',
      '- Report: 1 of 1 did not come back. Forms of the names: a/a%a (1). The folder before the slash, as ReportFolder: is not in the list (1). Came back, not listed, under a name that differs only in how a character is encoded (1).',
      '',
      'Components the org handed out and had not listed, by type:',
      '- CustomField: 1. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1).',
      '- LightningComponentBundle: 1. Forms of the names: a (1).',
      '- RecordType: 1. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1).',
      '- Report: 1. Forms of the names: a/a.a (1). The folder before the slash, as ReportFolder: is not in the list (1).',
    ]);
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
      {
        type: 'ApexClass',
        fullName: 'SecretPlan',
        fileName: 'classes/SecretPlan.cls',
        line: 2,
        column: 4,
        problem: 'Variable does not exist: Amount__c',
      },
      {
        type: 'ApexClass',
        fullName: 'InvoiceBatch',
        fileName: 'classes/InvoiceBatch.cls',
        line: 5,
        column: 2,
        problem: 'Invalid type: SecretPlan',
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
      'Components of the fixture project: 52. Salesforce counted 16, deployed 0 and found errors in 5.',
      '1. ApexClass InvoiceService, file classes/InvoiceService.cls, line 14, column 9',
      '   Problem: Variable does not exist: Amount__c',
      '2. ApexClass InvoiceSelector, file classes/InvoiceSelector.cls, line 3, column 1',
      '   Problem: not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it.',
      '3. CustomObject (a name that is not of the fixture project)',
      '   Problem: Entity is not org-accessible',
      '4. ApexClass (a name that is not of the fixture project), line 2, column 4',
      '   Problem: not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it.',
      '5. ApexClass InvoiceBatch, file classes/InvoiceBatch.cls, line 5, column 2',
      '   Problem: not shown, because it names something that is not in the fixture project. The page "Deployment Status" in the Setup of the test org shows it.',
    ]);
    expectNoSecret(text());
    expect(text()).not.toContain('Secret_Plan');
    expect(text()).not.toContain('SecretPlan');
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
      '::error::The deploy of the fixture project could not be started (INSUFFICIENT_ACCESS). What the org or the library said is not shown here.',
    );
    expectNoSecret(text());
  });

  /** Answers the requests for the state of a deploy that `fails` says so of with "service unavailable". */
  const stateUnavailable = (fails: (asked: number) => boolean): (() => number) => {
    let asked = 0;
    mock.intercept = (request) => {
      if (!request.body.includes('checkDeployStatus')) return undefined;
      asked += 1;
      return fails(asked) ? { status: 503, type: 'text/plain', body: `No service for ${USERNAME}` } : undefined;
    };
    return () => asked;
  };

  it('asks for the state of the deploy until it has ended', async () => {
    metadata.pollsBeforeDone = 3;
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(false);
    expect(metadata.calls.map((call) => call.operation)).toEqual([
      'deploy',
      'checkDeployStatus',
      'checkDeployStatus',
      'checkDeployStatus',
      'checkDeployStatus',
    ]);
    expect(text()).toContain('The fixture project is in the test org.');
  });

  it('gives up a deploy that does not end in time, and says that it may still run', async () => {
    metadata.hold = true;
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 20, deployMs: 1_000 });
    expect(log.failed).toBe(true);
    expect(text()).toBe(
      [
        '::error::The deploy of the fixture project did not end within 1 second.',
        'It may still be running in the test org.',
      ].join('\n'),
    );
    expect(metadata.calls.filter((call) => call.operation === 'checkDeployStatus').length).toBeGreaterThan(5);
  });

  it('asks again when the org does not say how far the deploy is, and goes on when it does', async () => {
    const asked = stateUnavailable((count) => count <= 4);
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(false);
    expect(asked()).toBe(5);
    expect(text()).toContain('The deploy of the fixture project ended as Succeeded');
  });

  it('says that the deploy was started when the org stops saying how far it is', async () => {
    const asked = stateUnavailable(() => true);
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(true);
    expect(asked()).toBe(5);
    expect(text()).toBe(
      [
        '::error::The deploy of the fixture project was started, and the org did not say 5 times in a row how far it is (ERROR_HTTP_503).',
        'It may still be running in the test org. What the org or the library said is not shown here.',
      ].join('\n'),
    );
    expect(metadata.deploys).toHaveLength(1);
    expectNoSecret(text());
  });
});

describe('reading the test org', () => {
  it('takes a snapshot and says in numbers what it holds, with the fixture project found in it', async () => {
    const { log, text } = collected();
    const tmp = dirs.next();
    await readOrg(log, { env: environment(), tmp });
    // The workspace with the files of the org is gone.
    expect(readdirSync(tmp)).toEqual([]);
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain(
      'Components: 53 listed by the org, 53 of them retrieved, 0 retrieved that the org had not listed, 0 of a package with a namespace.',
    );
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
    expect(output).toContain("- 1 time: Entity of type 'ApexClass' named '(a name)' cannot be found");
    expect(output).toContain('- ApexClass InvoiceSelector: listed, not retrieved');
    expect(output).toContain('- classes/InvoiceSelector.cls: not in the snapshot');
    expect(output).toContain(
      '- ApexClass: 1 of 12 did not come back. State: unmanaged (1). Forms of the names: a (1).',
    );
    expect(output.split('\n').slice(-2)).toEqual([
      '',
      '::error::The fixture project is not whole in the snapshot of the test org. The lines above say what is missing.',
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

describe('reading an org that holds more than the fixture project', () => {
  /** Names of components that are not of the fixture project. None may ever stand in the output. */
  const FOREIGN = [
    'SecretPlan',
    'SECRET_PLANS',
    'Secret_Plan',
    'Takeover',
    'hidden_notes',
    'HiddenNotes',
    'Globex',
    'Deals',
    'Budget',
  ];

  /** A mock org that holds the fixture project and, beside it, a class, an object with a field, and a report in a folder. */
  async function withMore(): Promise<MockMetadata> {
    const dir = dirs.next();
    cpSync(FIXTURE, join(dir, 'force-app'), { recursive: true });
    const base = join(dir, 'force-app/main/default');
    const xml = (type: string, inner: string): string =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<${type} xmlns="http://soap.sforce.com/2006/04/metadata">${inner}</${type}>\n`;
    const write = (path: string, content: string): void => {
      mkdirSync(join(base, path, '..'), { recursive: true });
      writeFileSync(join(base, path), content);
    };
    write('classes/SecretPlan.cls', 'public class SecretPlan {}\n');
    write('classes/SecretPlan.cls-meta.xml', xml('ApexClass', '<apiVersion>65.0</apiVersion><status>Active</status>'));
    write(
      'objects/Secret_Plan__c/Secret_Plan__c.object-meta.xml',
      xml(
        'CustomObject',
        '<deploymentStatus>Deployed</deploymentStatus><label>Secret Plan</label><nameField><label>Name</label><type>Text</type></nameField><pluralLabel>Secret Plans</pluralLabel><sharingModel>ReadWrite</sharingModel>',
      ),
    );
    write(
      'objects/Secret_Plan__c/fields/Takeover_Date__c.field-meta.xml',
      xml('CustomField', '<fullName>Takeover_Date__c</fullName><label>Takeover Date</label><type>Date</type>'),
    );
    write('reports/SECRET_PLANS.reportFolder-meta.xml', xml('ReportFolder', '<name>Secret plans</name>'));
    write('reports/SECRET_PLANS/Takeover.report-meta.xml', xml('Report', '<name>Takeover</name>'));
    const more = await metadataFromSource(join(dir, 'force-app'));
    more.pollsBeforeDone = 0;
    mock.metadata = more;
    return more;
  }

  const expectNothingForeign = (output: string): void => {
    for (const name of FOREIGN) expect(output).not.toContain(name);
    expectNoSecret(output);
  };

  it('names no component of the org in a partial snapshot, whatever was observed', async () => {
    const more = await withMore();
    more.withheld.add('ApexClass:SecretPlan');
    more.unlistedParents.add('CustomObject:Secret_Plan__c');
    more.extraFiles.set('hidden_notes/Takeover.txt', 'not metadata');
    // Files whose folder and ending are made of letters alone, as a name of a type or of a code is.
    more.extraFiles.set('HiddenNotes/Budget.MergerWithGlobex', 'not metadata');
    more.extraFiles.set('documents/Deals/Plan.AcmeTakeover', 'not metadata');
    // The org refuses to list one folder.
    mock.intercept = (request) =>
      request.body.includes('<folder>SECRET_PLANS</folder>')
        ? soapFault('INSUFFICIENT_ACCESS', 'insufficient access rights on SECRET_PLANS')
        : undefined;
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    // The fixture project is whole in the snapshot. What the org holds beside it and does not hand out is a warning.
    expect(log.failed).toBe(false);
    expect(output.split('\n').at(-1)).toBe(
      '::warning::The snapshot of the test org is not complete, and the fixture project is whole in it. The observations above say what is missing.',
    );
    expect(output).toContain('The snapshot of the test org is partial.');
    // What is missing is described without a name.
    expect(output).toContain(
      '- ApexClass: 1 of 13 did not come back. State: unmanaged (1). Forms of the names: a (1).',
    );
    expect(output).toContain('- CustomObject: 1. Forms of the names: a (1).');
    expect(output).toContain(
      '- 1 time: in (a folder that is not shown), 1 level deep, a name that ends in .txt. In everyday words: The file … to no metadata type that is known.',
    );
    // Each of these observations holds a name of the org in the database. The code is shown, the name is not.
    expect(output).toContain(
      '- error LISTING_FAILED: 1 observation. Types: Report. Codes of Salesforce: INSUFFICIENT_ACCESS (1)',
    );
    expect(output).toContain(
      '- error NOT_RETRIEVED: 1 observation, about 1 components, files or remarks. Types: ApexClass',
    );
    expect(output).toContain(
      '- info UNLISTED_COMPONENTS: 1 observation, about 1 components, files or remarks. Types: CustomObject',
    );
    // The file beside the metadata, whose place the engine keeps in the observation.
    expect(output).toContain('- error RESOLVE_FAILED: 3 observations');
    expect(output).toContain(
      '- 1 time: in (a folder that is not shown), 1 level deep, a name that ends in (an ending that is not shown). In everyday words:',
    );
    expect(output).toContain(
      '- 1 time: in documents, 2 levels deep, a name that ends in (an ending that is not shown). In everyday words:',
    );
    expect(output).toContain("- 1 time: Entity of type 'ApexClass' named '(a name)' cannot be found");
    expect(output).toMatch(/^ApexClass +13 +12 +ok$/m);
    expect(output).toMatch(/^Report +0 +0 +failed$/m);
    expect(output).toContain('Fixture project: 52 components. Listed by the org: 52. Retrieved: 52.');
    expectNothingForeign(output);
  });

  it('names no component of the org when the retrieves fail one after the other', async () => {
    const more = await withMore();
    // Every component with more than one file fails, down to the single component, until the snapshot stops.
    more.maxFiles = 1;
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toMatch(
      /- error RETRIEVE_FAILED: \d+ observations, about \d+ components, files or remarks\. Codes of Salesforce: LIMIT_EXCEEDED \(\d+\)/,
    );
    expect(output).toMatch(/- info CHUNK_SPLIT: \d+ observations\. Codes of Salesforce: LIMIT_EXCEEDED \(\d+\)/);
    expect(output.split('\n').slice(-4)).toEqual([
      '::error::The snapshot of the test org did not end: SOURCE_READ_FAILED (RETRIEVES_FAILING).',
      'Code of Salesforce: LIMIT_EXCEEDED',
      'Unfinished snapshot: #1',
      'The message is not shown here. docs/cli.md lists the codes.',
    ]);
    expectNothingForeign(output);
  });
});

describe('asking the org what Salesforce knows about references', () => {
  type Row = Record<string, unknown>;
  /** An id of 18 characters, as the Tooling API gives it. */
  const id = (prefix: string, n: number): string => `${prefix}${String(n).padStart(12, '0')}AAA`;
  const INVOICE = id('01I', 1);
  const LINE = id('01I', 2);
  const PLAN = id('01I', 9);
  const FOREIGN = ['SecretPlan', 'Secret_Plan', 'Takeover', 'hidden'];

  const dependency = (
    type: string,
    from: string,
    name: string,
    refType: string,
    to: string,
    refName: string,
    namespace: string | null = null,
  ): Row => ({
    MetadataComponentId: from,
    MetadataComponentName: name,
    MetadataComponentNamespace: namespace,
    MetadataComponentType: type,
    RefMetadataComponentId: to,
    RefMetadataComponentName: refName,
    RefMetadataComponentNamespace: null,
    RefMetadataComponentType: refType,
  });

  /** What the compiler holds for a class: one variable, one method, and two classes it refers to. */
  const symbolTable = (name: string): Row => ({
    id: name,
    key: name,
    name,
    namespace: null,
    constructors: [],
    interfaces: [],
    innerClasses: [],
    properties: [],
    tableDeclaration: { name, type: name, modifiers: ['public'], location: { line: 1, column: 14 }, references: [] },
    variables: [
      {
        name: 'invoice',
        type: 'Invoice__c',
        location: { line: 8, column: 20 },
        references: [
          { line: 9, column: 9 },
          { line: 10, column: 9 },
        ],
      },
    ],
    methods: [
      {
        name: 'openInvoices',
        returnType: 'List<Invoice__c>',
        parameters: [{ name: 'accountId', type: 'Id' }],
        modifiers: ['public', 'static'],
        location: { line: 7, column: 36 },
        references: [{ line: 30, column: 16 }],
      },
    ],
    externalReferences: [
      {
        name: 'InvoiceSelector',
        namespace: null,
        methods: [{ name: 'byStatus', references: [{ line: 12, column: 32 }] }],
        variables: [],
        references: [],
      },
      {
        name: 'SecretPlan',
        namespace: null,
        methods: [],
        variables: [{ name: 'Amount__c', references: [{ line: 14, column: 5 }] }],
        references: [],
      },
    ],
  });

  /** A small org: parts of the fixture project, and a class, an object and a flow beside it. */
  const tables = (): Record<string, Row[]> => ({
    CustomObject: [
      { Id: INVOICE, DeveloperName: 'Invoice', NamespacePrefix: null },
      { Id: LINE, DeveloperName: 'Invoice_Line', NamespacePrefix: null },
      { Id: PLAN, DeveloperName: 'Secret_Plan', NamespacePrefix: null },
    ],
    CustomField: [
      { Id: id('00N', 1), DeveloperName: 'Amount', NamespacePrefix: null, TableEnumOrId: INVOICE.slice(0, 15) },
      { Id: id('00N', 2), DeveloperName: 'Status', NamespacePrefix: null, TableEnumOrId: INVOICE.slice(0, 15) },
      { Id: id('00N', 3), DeveloperName: 'Status', NamespacePrefix: null, TableEnumOrId: LINE.slice(0, 15) },
      { Id: id('00N', 4), DeveloperName: 'Tier', NamespacePrefix: null, TableEnumOrId: 'Account' },
      { Id: id('00N', 5), DeveloperName: 'Is_Key_Account', NamespacePrefix: null, TableEnumOrId: 'Account' },
      { Id: id('00N', 6), DeveloperName: 'Unused_Field', NamespacePrefix: null, TableEnumOrId: INVOICE.slice(0, 15) },
      { Id: id('00N', 9), DeveloperName: 'Takeover_Date', NamespacePrefix: null, TableEnumOrId: PLAN.slice(0, 15) },
    ],
    ValidationRule: [
      {
        Id: id('03d', 1),
        ValidationName: 'Locked_When_Paid',
        NamespacePrefix: null,
        EntityDefinitionId: INVOICE.slice(0, 15),
      },
    ],
    ApexClass: [
      { Id: id('01p', 1), Name: 'InvoiceService', NamespacePrefix: null, SymbolTable: symbolTable('InvoiceService') },
      { Id: id('01p', 2), Name: 'InvoiceSelector', NamespacePrefix: null, SymbolTable: null },
      { Id: id('01p', 9), Name: 'SecretPlan', NamespacePrefix: null, SymbolTable: symbolTable('SecretPlan') },
      // A class of a package with the name of a class of the fixture project.
      { Id: id('01p', 8), Name: 'InvoiceService', NamespacePrefix: 'hidden', SymbolTable: null },
    ],
    ApexTrigger: [{ Id: id('01q', 1), Name: 'InvoiceTrigger', NamespacePrefix: null }],
    MetadataComponentDependency: [
      // In the answer key.
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'CustomField', id('00N', 1), 'Amount'),
      dependency('ValidationRule', id('03d', 1), 'Locked_When_Paid', 'CustomField', id('00N', 2), 'Status'),
      dependency('CustomField', id('00N', 5), 'Is_Key_Account', 'CustomField', id('00N', 4), 'Tier'),
      dependency('ApexTrigger', id('01q', 1), 'InvoiceTrigger', 'CustomObject', INVOICE, 'Invoice'),
      // A class the org has no row for is found by its name, and a standard object by its name.
      dependency('ApexClass', id('01p', 3), 'InvoiceServiceTest', 'StandardEntity', 'Account', 'Account'),
      // Between components of the fixture project, and not in the answer key.
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'CustomField', id('00N', 3), 'Status'),
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'ApexClass', id('01p', 2), 'InvoiceSelector'),
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'CustomField', id('00N', 6), 'Unused_Field'),
      // With a component that is not of the fixture project.
      dependency('ApexClass', id('01p', 9), 'SecretPlan', 'CustomObject', PLAN, 'Secret_Plan'),
      dependency('ApexClass', id('01p', 9), 'SecretPlan', 'CustomField', id('00N', 9), 'Takeover_Date'),
      dependency('Flow', id('301', 1), 'Takeover', 'CustomField', id('00N', 1), 'Amount'),
      dependency('ApexClass', id('01p', 8), 'InvoiceService', 'CustomField', id('00N', 1), 'Amount', 'hidden'),
    ],
  });

  /** Rows of components that are not of the fixture project, each of another component of one type. */
  const many = (count: number, type: string, refType: string | null, to: string, refName: string): Row[] =>
    Array.from({ length: count }, (_, index) => ({
      ...dependency(type, id('01p', 100 + index), `SecretPlan${String(index)}`, refType ?? '', to, refName),
      RefMetadataComponentType: refType,
    }));

  /**
   * Makes the mock org answer the Tooling API from tables. It knows the filters the tool uses, gives at most
   * 2,000 rows of the Dependency API, and refuses the objects in `faults`, each with the code that is given.
   */
  function tooling(
    rows: Record<string, Row[]>,
    options: {
      faults?: Record<string, string>;
      /** The code the org refuses a query with, by its text. */
      fault?: (soql: string) => string | undefined;
      /** A query whose answer does not say that it has ended, and names no next page. */
      notDone?: (soql: string) => boolean;
      pageSize?: number;
    } = {},
  ) {
    const later = new Map<string, Row[]>();
    const asked: string[] = [];
    mock.intercept = (request) => {
      const found = /\/tooling\/query(?:\/(.+))?$/.exec(request.path);
      if (found === null) return undefined;
      let answer: Row[];
      let open = false;
      if (found[1] !== undefined) {
        answer = later.get(found[1]) ?? [];
      } else {
        const soql = request.query.get('q') ?? '';
        asked.push(soql);
        const object = /FROM (\w+)/.exec(soql)?.[1] ?? '';
        const withSymbols = soql.includes('SymbolTable');
        const fault = options.fault?.(soql) ?? options.faults?.[withSymbols ? `${object}.SymbolTable` : object];
        open = options.notDone?.(soql) ?? false;
        if (fault !== undefined) {
          return {
            status: 400,
            body: JSON.stringify([{ message: `Refused for ${USERNAME} at ${mock.url}`, errorCode: fault }]),
          };
        }
        const type = /(?<!Ref)MetadataComponentType = '(\w+)'/.exec(soql)?.[1];
        const notTypes = /(?<!Ref)MetadataComponentType NOT IN \(([^)]*)\)/.exec(soql)?.[1];
        const target = /RefMetadataComponentType = '(\w+)'/.exec(soql)?.[1];
        const notTargets = /RefMetadataComponentType NOT IN \(([^)]*)\)/.exec(soql)?.[1];
        const names = /\bName IN \(([^)]*)\)/.exec(soql)?.[1];
        const without = (list: string | undefined, value: unknown): boolean =>
          !(list?.includes(`'${String(value)}'`) ?? false);
        answer = (rows[object] ?? []).filter(
          (row) =>
            (names === undefined || !without(names, row['Name'])) &&
            (type === undefined || row['MetadataComponentType'] === type) &&
            without(notTypes, row['MetadataComponentType']) &&
            (target === undefined || row['RefMetadataComponentType'] === target) &&
            without(notTargets, row['RefMetadataComponentType']),
        );
        if (object === 'MetadataComponentDependency') answer = answer.slice(0, 2000);
        if (!withSymbols) {
          answer = answer.map((row) =>
            Object.fromEntries(Object.entries(row).filter(([name]) => name !== 'SymbolTable')),
          );
        }
      }
      const size = options.pageSize ?? answer.length;
      const rest = answer.slice(size);
      let next: string | undefined;
      if (rest.length > 0) {
        const locator = `01gPAGE-${String(later.size)}`;
        later.set(locator, rest);
        next = `/services/data/v66.0/tooling/query/${locator}`;
      }
      return {
        status: 200,
        body: JSON.stringify({
          size: answer.length - rest.length,
          totalSize: answer.length,
          done: rest.length === 0 && !open,
          nextRecordsUrl: next,
          records: answer.slice(0, size),
        }),
      };
    };
    return asked;
  }

  const expectNothingForeign = (output: string): void => {
    for (const name of FOREIGN) expect(output).not.toContain(name);
    expectNoSecret(output);
  };

  it('says which pairs of the answer key the Dependency API reports, and counts the rest of the org', async () => {
    const asked = tooling(tables());
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain('One query without a filter: 12 rows in 1 page.');
    expect(output).toMatch(/^ApexClass +8 +ok$/m);
    expect(output).toMatch(/^Flow +1 +ok$/m);
    expect(output).toMatch(/^ValidationRule +1 +ok$/m);
    expect(output).toContain(
      'Different rows in all: 12. No query was cut off or failed in a way that leaves a row out.',
    );
    expect(output).not.toContain('::warning::');
    expect(output).toContain(
      'Rows read to find the names behind the ids: CustomObject 3, CustomField 7, ValidationRule 1, ApexClass 4, ApexTrigger 1.',
    );
    expect(output).toContain(
      'Rows between two components of the fixture project: 8, which are 8 pairs. Rows with a component that is not of it: 4.',
    );
    expect(output).toContain(
      'The rows with a component that is not of the fixture project, by type: ApexClass to CustomField 2, ApexClass to CustomObject 1, Flow to CustomField 1',
    );
    expect(output).toContain(
      'The answer key holds 137 pairs of a component and a component it refers to. The Dependency API reports 5 of them.',
    );
    expect(output).toMatch(/^ApexClass +CustomField +\d+ +1$/m);
    expect(output).toMatch(/^ApexClass +CustomObject \(of Salesforce\) +\d+ +1$/m);
    expect(output).toMatch(/^ValidationRule +CustomField +11 +1$/m);
    expect(output).toMatch(/^formula +\d+ +2$/m);
    expect(output).toMatch(/^probable +\d+ +0$/m);
    expect(output).toContain('- reported  ApexClass:invoiceservice -> CustomField:invoice__c.amount__c  (field, soql)');
    expect(output).toContain('- missing   ApexClass:invoiceservice -> CustomField:invoice__c.status__c  (field, soql)');
    expect(output).toContain('- reported  ApexTrigger:invoicetrigger -> CustomObject:invoice__c  (declaration)');
    expect(output).toContain('- reported  ApexClass:invoiceservicetest -> CustomObject:account  (dml)');
    // Two fields are named Status. The id says which one the row is about.
    expect(output).toContain('Pairs the Dependency API reports that the answer key does not hold: 3.');
    expect(output).toContain('- ApexClass:invoiceservice -> ApexClass:invoiceselector');
    expect(output).toContain('- ApexClass:invoiceservice -> CustomField:invoice_line__c.status__c');
    expect(output).toContain(
      'Fields the answer key calls unreferenced: 4. The Dependency API reports a reference to 1 of them: CustomField:invoice__c.unused_field__c.',
    );
    // Every query names a type of component, never a component.
    for (const soql of asked) for (const name of FOREIGN) expect(soql).not.toContain(name);
    expectNothingForeign(output);
  });

  it('says what the symbol tables of the compiler hold for the classes of the fixture project', async () => {
    const asked = tooling(tables(), { faults: { 'ApexTrigger.SymbolTable': 'INVALID_FIELD' }, pageSize: 2 });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    // Only classes with a name of the fixture project are asked for. One of them is of a package.
    expect(asked.filter((soql) => soql.includes('SymbolTable FROM ApexClass'))).toEqual([
      expect.stringMatching(/ FROM ApexClass WHERE Name IN \('[A-Za-z]+'(, '[A-Za-z]+'){11}\)$/),
    ]);
    expect(output).toMatch(
      /Classes with a name of the fixture project: 3 in 2 pages, after \d+\.\d s\. With a symbol table: 1\./,
    );
    expect(output).toContain('Classes of the fixture project: 12. Found: 2. With a symbol table: 1.');
    expect(output).toMatch(/^InvoiceSelector +no symbol table$/m);
    expect(output).toMatch(/^InvoiceService +1 +0 +0 +1 +0 +2 +5$/m);
    expect(output).toContain(
      'Fields of a symbol table: constructors, externalReferences, id, innerClasses, interfaces, key, methods, name, namespace, properties, tableDeclaration, variables.',
    );
    expect(output).toContain(
      'Places of use the symbol tables hold (entries of "references"): 5. External references: 2.',
    );
    expect(output).toContain('- InvoiceService to InvoiceSelector: methods 1, variables 0, places 1');
    // The class beside the fixture project is not named, also where a class of the fixture project refers to it.
    expect(output).toContain('- InvoiceService to (not shown): methods 0, variables 1, places 1');
    expect(output).toContain(
      'Texts in the symbol tables that name a custom field of the fixture project: 1. That name one of its custom objects and no field: 2.',
    );
    expect(output).toContain(
      '- externalReferences.variables.name: 1 with a field, 0 with an object only, for example Amount__c',
    );
    expect(output).toContain(
      '- methods.returnType: 0 with a field, 1 with an object only, for example List<Invoice__c>',
    );
    expect(output).toContain('- InvoiceService.openInvoices(Id): List<Invoice__c>');
    expect(output).toContain('Triggers cannot be asked for with a symbol table (INVALID_FIELD).');
    expect(output).toMatch(/Requests to the Tooling API: \d+\. A request the library sent again/);
    expectNothingForeign(output);
  });

  it('asks for every class when the org refuses the query by the names of the classes', async () => {
    tooling(tables(), { fault: (soql) => (soql.includes('Name IN') ? 'MALFORMED_QUERY' : undefined) });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain(
      'The query for the classes by their names failed (MALFORMED_QUERY). Every class of the org is asked for.',
    );
    expect(output).toMatch(/Classes: 4 in 1 page, after \d+\.\d s\. With a symbol table: 2\./);
    expect(output).toContain('Classes of the fixture project: 12. Found: 2. With a symbol table: 1.');
    expectNothingForeign(output);
  });

  it('asks again per pair of types where a query is at the limit of 2,000 rows, and says when rows are still missing', async () => {
    const org = tables();
    org['MetadataComponentDependency'] = [
      ...many(2050, 'ApexClass', 'CustomField', id('00N', 9), 'Takeover_Date'),
      // Behind the limit: a type of target that the first queries do not show, and the rows of the fixture project.
      ...many(30, 'ApexClass', 'CustomLabel', id('101', 1), 'Takeover'),
      ...(org['MetadataComponentDependency'] ?? []),
    ];
    tooling(org);
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain(
      'One query without a filter: 2000 rows in 1 page. That is the limit of 2000 rows: the org may hold more.',
    );
    expect(output).toMatch(/^ApexClass +2000 +at the limit, asked again per type of the target$/m);
    expect(output).toMatch(/^ {2}to CustomField +2000 +at the limit: rows are missing$/m);
    expect(output).toMatch(/^ {2}to every other type +33 +ok$/m);
    // The types the limit hid are found: the flow, the trigger, the rule and the field that refer.
    expect(output).toMatch(/^Flow +1 +ok$/m);
    expect(output).toMatch(/^ApexTrigger +1 +ok$/m);
    expect(output).toContain('1 query was cut off at the limit or failed, so rows are missing.');
    expect(output).toContain(
      'The answer key holds 137 pairs of a component and a component it refers to. The Dependency API reports 4 of them.',
    );
    // The step does not fail for it, and says at its end that the answer is not whole.
    expect(output.split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(output);
  });

  it('counts a query that failed where its rows can be missing', async () => {
    // The first query is at the limit, and the org refuses the query for the rows of the classes.
    const org = tables();
    org['MetadataComponentDependency'] = [
      ...many(1990, 'Flow', 'CustomField', id('00N', 9), 'Takeover_Date'),
      ...(org['MetadataComponentDependency'] ?? []),
    ];
    tooling(org, {
      fault: (soql) => (soql.endsWith("WHERE MetadataComponentType = 'ApexClass'") ? 'UNKNOWN_EXCEPTION' : undefined),
    });
    const first = collected();
    await probeOrg(first.log, { env: environment() });
    expect(first.log.failed).toBe(false);
    expect(first.text()).toMatch(/^ApexClass +failed \(UNKNOWN_EXCEPTION\): rows may be missing$/m);
    expect(first.text()).toContain('1 query was cut off at the limit or failed, so rows are missing.');
    expect(first.text().split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(first.text());

    // The classes are at the limit, and the org refuses the query for one type of target.
    org['MetadataComponentDependency'] = [
      ...many(2050, 'ApexClass', 'CustomField', id('00N', 9), 'Takeover_Date'),
      ...(tables()['MetadataComponentDependency'] ?? []),
    ];
    tooling(org, {
      fault: (soql) => (soql.endsWith("RefMetadataComponentType = 'CustomField'") ? 'UNKNOWN_EXCEPTION' : undefined),
    });
    const second = collected();
    await probeOrg(second.log, { env: environment() });
    expect(second.log.failed).toBe(false);
    expect(second.text()).toMatch(/^ {2}to CustomField +failed \(UNKNOWN_EXCEPTION\): rows are missing$/m);
    expect(second.text()).toContain('query was cut off at the limit or failed, so rows are missing.');
    expectNothingForeign(second.text());

    // The classes are at the limit, and no row says of which type a target is.
    org['MetadataComponentDependency'] = many(2100, 'ApexClass', null, id('00N', 9), 'Takeover_Date');
    tooling(org);
    const third = collected();
    await probeOrg(third.log, { env: environment() });
    expect(third.text()).toMatch(/^ApexClass +2000 +at the limit, asked again per type of the target$/m);
    expect(third.text()).toMatch(/^ {2}to a type +no type of a target is known: rows are missing$/m);
    expect(third.text()).toContain('query was cut off at the limit or failed, so rows are missing.');
    expectNothingForeign(third.text());
  });

  it('does not count a query that failed when the first query gave every row', async () => {
    const org = tables();
    // A field of a package with the name of a field of the fixture project.
    org['CustomField']?.push({
      Id: id('00N', 7),
      DeveloperName: 'Amount',
      NamespacePrefix: 'hidden',
      TableEnumOrId: INVOICE.slice(0, 15),
    });
    org['MetadataComponentDependency']?.push(
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'CustomField', id('00N', 7), 'Amount'),
    );
    tooling(org, {
      // The answer for the flows does not say that it has ended. One object has no field for the prefix of a package.
      notDone: (soql) => soql.endsWith("WHERE MetadataComponentType = 'Flow'"),
      fault: (soql) => (/NamespacePrefix.* FROM ValidationRule/.test(soql) ? 'INVALID_FIELD' : undefined),
    });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toMatch(/^Flow +failed \(NOT_DONE\)$/m);
    expect(output).toContain(
      'Different rows in all: 13. No query was cut off or failed in a way that leaves a row out.',
    );
    expect(output).toContain(
      'Rows read to find the names behind the ids: CustomObject 3, CustomField 8, ValidationRule 1 without NamespacePrefix (INVALID_FIELD), ApexClass 4, ApexTrigger 1.',
    );
    // The field of the package is not the field of the fixture project.
    expect(output).toContain(
      'Rows between two components of the fixture project: 8, which are 8 pairs. Rows with a component that is not of it: 5.',
    );
    expect(output).not.toContain('::warning::');
    expectNothingForeign(output);
  });

  it('marks a pair that only the name of a field gives, and does not count it as reported', async () => {
    tooling(tables(), { faults: { CustomField: 'INVALID_TYPE' } });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain('CustomField failed (INVALID_TYPE)');
    // Without the object of a field, the row could be about a field of that name of any object.
    expect(output).toContain(
      'The Dependency API reports 2 of them. 2 more are matched by the name of a field or of a rule alone, because the org gave no object for the id. They are marked "by name" and not counted as reported.',
    );
    expect(output).toContain('- by name   ApexClass:invoiceservice -> CustomField:invoice__c.amount__c  (field, soql)');
    expect(output).toContain('- reported  ApexTrigger:invoicetrigger -> CustomObject:invoice__c  (declaration)');
    expect(output).toMatch(/^ApexClass +CustomField +\d+ +0$/m);
    expect(output).toContain('- ApexClass:invoiceservice -> CustomField:invoice__c.unused_field__c  (by name)');
    expect(output.split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(output);
  });

  it('stops asking for types the limit hides after a number of rounds, and says that rows are missing', async () => {
    // Seven types the tool does not know, each at the limit: every answer shows one more.
    const org = tables();
    org['MetadataComponentDependency'] = Array.from({ length: 7 }, (_, kind) =>
      many(2000, `Kind${String(kind + 1)}`, 'CustomField', id('00N', 9), 'Takeover_Date'),
    ).flat();
    const asked = tooling(org);
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toMatch(/^Kind6 +2000 +at the limit, asked again per type of the target$/m);
    expect(output).not.toMatch(/^Kind7 /m);
    expect(output).toMatch(/^every other type +2000 +at the limit: rows are missing$/m);
    expect(output).toContain('7 queries were cut off at the limit or failed, so rows are missing.');
    expect(asked.filter((soql) => /(?<!Ref)MetadataComponentType NOT IN/.test(soql))).toHaveLength(6);
    expectNothingForeign(output);
  });

  it('fails with the codes of Salesforce when the org answers neither', async () => {
    tooling(tables(), {
      faults: { MetadataComponentDependency: 'INVALID_TYPE', 'ApexClass.SymbolTable': 'INSUFFICIENT_ACCESS' },
    });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toContain('One query without a filter failed (INVALID_TYPE).');
    expect(output).toContain('No query of the Dependency API was answered.');
    expect(output).toContain('The classes could not be read with their symbol tables (INSUFFICIENT_ACCESS).');
    expect(output.split('\n').at(-1)).toBe(
      '::error::The org did not answer either of the two. The codes above say why.',
    );
    expectNothingForeign(output);
  });

  it('fails with the code of the login when the org cannot be logged in to', async () => {
    mock.key = null;
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    expect(log.failed).toBe(true);
    expect(text()).toMatch(/^::error::The test org was not asked, because the login to it failed: LOGIN_FAILED/);
    expectNoSecret(text());
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

  it('asks the org about references from source, prints nothing but its own lines, and ends with 0', async () => {
    const home = dirs.next();
    // An org that has no row of either kind.
    mock.intercept = (request) =>
      request.path.includes('/tooling/query')
        ? { status: 200, body: JSON.stringify({ size: 0, totalSize: 0, done: true, records: [] }) }
        : undefined;
    const probed = await run('probe-org.ts', { ...environment(), HOME: home, USERPROFILE: home });
    expect(probed.stderr).toBe('');
    expect(probed.stdout).toContain('One query without a filter: 0 rows in 1 page.\n');
    expect(probed.stdout).toContain(
      'The answer key holds 137 pairs of a component and a component it refers to. The Dependency API reports 0 of them.\n',
    );
    expect(probed.stdout).toContain('Classes of the fixture project: 12. Found: 0. With a symbol table: 0.\n');
    expect(probed.code).toBe(0);
    expectNoSecret(probed.stdout);
  });

  it('lets only the lines of the log of the tool out, whatever else is written or thrown', async () => {
    const noisy = fileURLToPath(new URL('./helpers/noisy-tool.ts', import.meta.url));
    const start = (...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> =>
      new Promise((resolve) => {
        // Without --no-warnings, to see that a warning of Node.js itself does not come out either.
        const child = spawn(process.execPath, [noisy, ...args], { env: process.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('close', (code) => {
          resolve({ stdout, stderr, code });
        });
      });
    // The tool writes to both streams and to their file descriptors, starts a process that writes, and warns.
    const own = 'A line of the tool itself.\nTwo lines ::error::in one.\n';
    expect(await start('the-secret-of-the-org', 'quiet')).toEqual({ code: 0, stderr: '', stdout: own });
    expect(await start('the-secret-of-the-org')).toEqual({
      code: 1,
      stderr: '',
      stdout: `${own}::error::The step ended with an error that was not handled (RangeError). Its message is not shown here.\n`,
    });
    expect(await start('the-secret-of-the-org', 'reject')).toEqual({
      code: 1,
      stderr: '',
      stdout: `${own}::error::The step ended with a failure that was not handled (TypeError). Its message is not shown here.\n`,
    });
    // A tool that ends without a word, as one that is killed does, is still reported as failed.
    expect(await start('the-secret-of-the-org', 'wait')).toEqual({
      code: 1,
      stderr: '',
      stdout: `${own}::error::The step ended with the exit code 3 and said nothing about it.\n`,
    });
  });

  it('ends with 1 and an error of its own when the step fails', async () => {
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
