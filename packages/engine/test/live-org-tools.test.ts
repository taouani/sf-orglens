/**
 * The tools of the live-org workflow (`test/live`), against a mock org on
 * this machine. The real runs are the ones of the workflow. These tests
 * cover what a real run cannot be trusted with: that a tool says what
 * happened, and that nothing of the login or of the org reaches its output.
 */
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetadataRequestError } from '../src/sources/org-http.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { fixtureDependencyRows } from './helpers/fixture-dependencies.ts';
import { dependencyRow, mockDependencies, type MockDependencies } from './helpers/mock-dependencies.ts';
import { metadataFromSource, soapFault, type MockMetadata } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { tempDirs } from './helpers/store.ts';
import {
  changedOnce,
  deployFixture,
  DRAFT_CHANGES,
  fixtureWords,
  FLOW_WITH_DRAFT,
  MADE_UP_USER,
  shownProblem,
} from './live/deploy-fixture.ts';
import { everydayWords, publicLog, type PublicLog } from './live/public-log.ts';
import { probeOrg } from './live/probe-org.ts';
import {
  conditionForm,
  failedRequestLines,
  fileDifference,
  flowLines,
  missingLines,
  nameForm,
  objectKind,
  phaseLines,
  placeForm,
  readOrg,
  remarkForm,
  rowsByTypes,
} from './live/read-org.ts';
import type { DependencyRow } from '../src/sources/dependency-api.ts';
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
let dependencies: MockDependencies;

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
  // What the Dependency API of the org reports: the references of the answer key that Salesforce knows of.
  dependencies = mockDependencies(fixtureDependencyRows(metadata));
  mock.dependencies = dependencies;
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

/**
 * A flow, with names of elements of its file, one of their values, or a path of fields. The apostrophe comes in
 * two forms, a name may stand in quotes, and the comma may be missing: the public log would have shown the same
 * words for each.
 */
const FLOW_PROBLEMS: readonly string[] = [
  // The problem as the second deploy of 23 November 2026 printed it.
  'field integrity exception: unknown (When the TriggerType field is set to "RecordBeforeSave", the $Record.Account__r.Is_Key_Account__c field isn\'t supported.)',
  "field integrity exception: unknown (When the triggerType field is set to RecordBeforeSave, the customErrors field isn't supported.)",
  'field integrity exception: unknown (When the triggerType field is set to RecordBeforeSave, the filterFormula field isn’t supported.)',
  "field integrity exception: unknown (When the 'triggerType' field is set to 'RecordBeforeSave', the 'filterFormula' field isn't supported.)",
  'field integrity exception: unknown (When the "triggerType" field is set to "RecordBeforeSave", the "filterFormula" field isn\'t supported.)',
  'field integrity exception: unknown (When the “triggerType” field is set to “RecordBeforeSave”, the ‘filterFormula’ field isn’t supported.)',
  "field integrity exception: unknown (When the triggerType field is set to RecordBeforeSave the filterFormula field isn't supported.)",
  "field integrity exception: unknown (When the isFieldError field is set to true, the fieldSelection field isn't supported.)",
];

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
    // A global variable of a formula, of the fixture project and of the platform.
    'Field $User.Department does not exist. Check spelling.',
    'Field $RecordType.Name does not exist. Check spelling.',
    'Field Status__c is a picklist field. Picklist fields are only supported in certain functions.',
    'Illegal assignment from Decimal to String',
    'Entity is not org-accessible',
    ...FLOW_PROBLEMS,
  ])('shows the known form: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toBe(problem);
  });

  // The form for a flow is written from these words and from nothing else, so every text it takes has to give
  // exactly them. A text that gave other words would be one the run of 23 November 2026 did not see.
  it.each(FLOW_PROBLEMS)(
    'has, for a flow, a form whose everyday words are those of the refused deploy: %s',
    (problem) => {
      expect(everydayWords(problem)).toBe('field … unknown (When the … field is set to … the … field … supported.)');
    },
  );

  it.each([
    // Words the refused deploy would have shown, or a name that is more than one word.
    'field integrity exception: unknown (When the triggerType field is set to RecordBeforeSave, the customErrors field is not supported.)',
    "field integrity exception: unknown (When the Trigger Type field is set to RecordBeforeSave, the customErrors field isn't supported.)",
    "field integrity exception: unknown (When the start element's triggerType field is set to RecordBeforeSave, the customErrors field isn't supported.)",
    // A quote is taken at a name and nowhere else.
    "field integrity exception: unknown (When the 'triggerType field' is set to RecordBeforeSave, the customErrors field isn't supported.)",
  ])('does not take another wording for the form of a flow: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toMatch(/^not shown, because it is not of a known form\. /);
  });

  it.each([
    ['Something Salesforce never said before about https://other.example', '… before …'],
    [
      'Variable does not exist: Amount__c and more that is not of the form',
      '… does not exist: … and more that is not of the …',
    ],
    // A signature is not a place for prose.
    ['Invalid type: the quick brown fox of Initech Corp jumps over the lazy admin', 'Invalid type: the … of … the …'],
    [
      'Illegal assignment from everything the org said about Initech to nothing at all',
      '… from … the org … to … at all',
    ],
    // A name in quotes stays out as a whole, with the everyday words it holds.
    ["Something of the layout named 'Default Use' cannot be found", '… of the … named … cannot be found'],
    // A problem with a formula, as a deploy can report it: what it is about stays out, what kind it is comes out.
    [
      'The default value formula for Region__c uses a function that is not supported: TEXT of the picklist Secret_Plan__c',
      'The default value formula for … a function that is not supported: … of the …',
    ],
  ])('shows of a text of another form its everyday words and nothing else: %s', (problem, everyday) => {
    expect(shownProblem(log, problem, words)).toBe(
      `not shown, because it is not of a known form. ${where} Its everyday words: ${everyday}`,
    );
  });

  it.each(['', undefined, 'Initech 42'])('shows nothing of a text without an everyday word: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toBe(`not shown, because it is not of a known form. ${where}`);
  });

  it.each([
    'Variable does not exist: Secret_Plan__c.Takeover_Date__c',
    'Invalid type: SecretPlan',
    'Invalid type: acme',
    'Illegal assignment from Decimal to Initech',
    "Unexpected token 'SecretPlan'.",
    'Field $Secret.Plan does not exist. Check spelling.',
    // A variable of the platform with a field the fixture project does not hold.
    'Field $User.Secret_Plan__c does not exist. Check spelling.',
    'Field Secret_Plan__c is a picklist field. Picklist fields are only supported in certain functions.',
    'Method does not exist or incorrect signature: void post(List<Secret_Plan__c>) from the type InvoiceService',
    "field integrity exception: unknown (When the triggerType field is set to RecordBeforeSave, the SecretPlan field isn't supported.)",
    "field integrity exception: unknown (When the 'triggerType' field is set to 'SecretPlan', the 'filterFormula' field isn't supported.)",
    // A path as Salesforce wrote one, with one word that is not of the fixture project.
    'field integrity exception: unknown (When the TriggerType field is set to "RecordBeforeSave", the $Record.Account__r.Secret_Plan__c field isn\'t supported.)',
  ])('does not show a known form that names something the fixture project does not hold: %s', (problem) => {
    expect(shownProblem(log, problem, words)).toBe(
      `not shown, because it names something that is not in the fixture project. ${where}`,
    );
  });

  it('shows of a problem about something else than a component of the fixture project only a form without names', () => {
    expect(shownProblem(log, 'Entity is not org-accessible', words, false)).toBe('Entity is not org-accessible');
    const about = `not shown, because it is about something that is not a component of the fixture project. ${where}`;
    expect(shownProblem(log, 'Variable does not exist: Amount__c', words, false)).toBe(about);
    // A name that is an everyday word stays out too: the form is known, so the place is known to hold a name.
    expect(shownProblem(log, 'Invalid type: Settings', words, false)).toBe(about);
    expect(shownProblem(log, 'Variable does not exist: Profile', words, false)).toBe(about);
    expect(shownProblem(log, 'Field $User.Default does not exist. Check spelling.', words, false)).toBe(about);
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

describe('the condition of a query of the Dependency API, as it is printed', () => {
  const address = (where: string, object = 'MetadataComponentDependency'): string => {
    const soql = `SELECT MetadataComponentId, RefMetadataComponentId FROM ${object}${where === '' ? '' : ` WHERE ${where}`}`;
    return `/services/data/v66.0/tooling/query?q=${encodeURIComponent(soql)}`;
  };
  const form = (where: string, log: PublicLog = publicLog(() => undefined)): string =>
    conditionForm(log, address(where));

  it('shows the names of metadata types, and the number of ids in the place of the ids', () => {
    expect(form('')).toBe('no condition');
    expect(form("MetadataComponentType = 'Layout'")).toBe('MetadataComponentType = Layout');
    expect(form("MetadataComponentType NOT IN ('ApexClass', 'Flow')")).toBe(
      'MetadataComponentType NOT IN (ApexClass, Flow)',
    );
    expect(
      form(
        "MetadataComponentType = 'Layout' AND RefMetadataComponentType = 'CustomField' AND MetadataComponentId NOT IN ('00h000000000001AAA', '00h000000000002AAA')",
      ),
    ).toBe(
      'MetadataComponentType = Layout AND RefMetadataComponentType = CustomField AND MetadataComponentId NOT IN (2 ids)',
    );
    expect(form("MetadataComponentType = 'ApexClass' AND MetadataComponentId IN ('01p000000000001AAA')")).toBe(
      'MetadataComponentType = ApexClass AND MetadataComponentId IN (1 id)',
    );
  });

  it('shows a type only where its name has the form of a metadata type and is no word of the login', () => {
    // The type of a row about a record of a custom metadata type is the name of that type, a name of the org.
    expect(form("MetadataComponentType = 'Acme_Rule__mdt'")).toBe('MetadataComponentType = (a type that is not shown)');
    expect(form("RefMetadataComponentType IN ('CustomField', 'Acme_Rule__mdt')")).toBe(
      'RefMetadataComponentType IN (CustomField, (a type that is not shown))',
    );
    // The form is all that is checked: a name of letters and digits is shown, as it is for the types of rows.
    expect(form("MetadataComponentType = 'AcmeRule'")).toBe('MetadataComponentType = AcmeRule');
    const log = publicLog(() => undefined);
    log.forbid('https://acmerule.my.salesforce.example');
    expect(form("MetadataComponentType = 'AcmeRule'", log)).toBe('MetadataComponentType = (a type that is not shown)');
  });

  it('shows nothing of a condition in another form', () => {
    expect(form("MetadataComponentName = 'Acme_Secret'")).toBe('(a condition that is not shown)');
    expect(form("MetadataComponentType = 'Layout' AND MetadataComponentName LIKE 'Acme%'")).toBe(
      'MetadataComponentType = Layout AND (a condition that is not shown)',
    );
    // A value in quotes after a list is no type of the list.
    expect(form("RefMetadataComponentType IN ('CustomField') OR MetadataComponentName IN ('AcmeSecret')")).toBe(
      '(a condition that is not shown)',
    );
    expect(form("MetadataComponentType = 'Layout' OR MetadataComponentName = 'AcmeSecret'")).toBe(
      '(a condition that is not shown)',
    );
    expect(form("MetadataComponentId IN ('00h000000000001AAA') LIMIT 5")).toBe('(a condition that is not shown)');
  });

  it('shows nothing of a request that is no query of the reader', () => {
    const log = publicLog(() => undefined);
    // The next page of an answer has an address without a query.
    expect(conditionForm(log, '/services/data/v66.0/tooling/query/01gAcme00000001AAA-2000')).toBe(
      '(the next page of an answer)',
    );
    expect(conditionForm(log, '/services/data/v66.0/tooling/sobjects/AcmeSecret')).toBe(
      '(a request that is not shown)',
    );
    expect(conditionForm(log, address("Name = 'AcmeSecret'", 'ApexClass'))).toBe('(a request that is not shown)');
    expect(conditionForm(log, '/services/data/v66.0/tooling/query?q=AcmeSecret')).toBe('(a request that is not shown)');
    expect(conditionForm(log, 'http://[')).toBe('(a request that is not shown)');
  });

  describe('the lines about requests that failed', () => {
    const refusedWith = (code: string | null): MetadataRequestError =>
      new MetadataRequestError('refused', code, 'A message of Salesforce about AcmeSecret.');
    const perComponent = (ids: readonly string[]): string =>
      address(
        `MetadataComponentType = 'Layout' AND RefMetadataComponentType = 'CustomField' AND MetadataComponentId IN (${ids.map((id) => `'${id}'`).join(', ')})`,
      );

    it('says nothing when no request failed', () => {
      expect(
        failedRequestLines(
          publicLog(() => undefined),
          [],
        ),
      ).toEqual([]);
    });

    it('counts the different queries of a form and the requests they were, in a fixed order', () => {
      const again = address("MetadataComponentType = 'WorkflowRule'");
      const lines = failedRequestLines(
        publicLog(() => undefined),
        [
          // One query that was sent three times.
          { url: again, error: new MetadataRequestError('unreachable', 'HTTP_503', 'The org could not be reached.') },
          { url: again, error: new MetadataRequestError('unreachable', 'HTTP_503', 'The org could not be reached.') },
          { url: again, error: new MetadataRequestError('unreachable', 'HTTP_503', 'The org could not be reached.') },
          // Two queries of one form: other ids, as many of them.
          { url: perComponent(['00h000000000001AAA', '00h000000000002AAA']), error: refusedWith('MALFORMED_QUERY') },
          { url: perComponent(['00h000000000003AAA', '00h000000000004AAA']), error: refusedWith('MALFORMED_QUERY') },
          // The same form with another code is a line of its own, and so is a failure without a code.
          { url: perComponent(['00h000000000005AAA', '00h000000000006AAA']), error: refusedWith('INVALID_TYPE') },
          { url: address(''), error: refusedWith(null) },
          { url: address(''), error: new Error('A message of a library about AcmeSecret.') },
        ],
      );
      expect(lines).toEqual([
        'Requests of this reading that failed: 8, for 5 different queries. A request that was answered when it was sent again is among them. By the condition of the query, with the number of ids in the place of the ids, and the code of the failure:',
        '- MetadataComponentType = Layout AND RefMetadataComponentType = CustomField AND MetadataComponentId IN (2 ids): INVALID_TYPE. Queries: 1. Requests: 1.',
        '- MetadataComponentType = Layout AND RefMetadataComponentType = CustomField AND MetadataComponentId IN (2 ids): MALFORMED_QUERY. Queries: 2. Requests: 2.',
        '- MetadataComponentType = WorkflowRule: HTTP_503. Queries: 1. Requests: 3.',
        '- no condition: a code that is not shown. Queries: 1. Requests: 2.',
      ]);
      // No id, and no word of a message.
      expect(lines.join('\n')).not.toMatch(/00h0|AcmeSecret|message/);
    });

    it('counts rows by the types of their two ends, and shows no type that is a name of the org', () => {
      const end = (type: string): DependencyRow['from'] => ({
        type,
        id: '00h000000000001AAA',
        name: 'Acme',
        namespace: null,
      });
      const row = (from: string, to: string): DependencyRow => ({ from: end(from), to: end(to) });
      expect(
        rowsByTypes(
          publicLog(() => undefined),
          [
            row('Layout', 'CustomField'),
            row('CustomApplication', 'FlexiPage'),
            row('Layout', 'CustomField'),
            row('Acme_Rule__mdt', 'CustomObject'),
            row('Other_Rule__mdt', 'CustomObject'),
          ],
        ),
      ).toBe('(a type that is not shown) to CustomObject 2, CustomApplication to FlexiPage 1, Layout to CustomField 2');
    });

    it('lists at most 40 forms and says how many more there are', () => {
      const failures = Array.from({ length: 43 }, (_, index) => ({
        url: perComponent(Array.from({ length: index + 1 }, (_ignored, id) => `00h${String(id).padStart(12, '0')}AAA`)),
        error: refusedWith('MALFORMED_QUERY'),
      }));
      const lines = failedRequestLines(
        publicLog(() => undefined),
        failures,
      );
      expect(lines).toHaveLength(42);
      expect(lines[0]).toMatch(/^Requests of this reading that failed: 43, for 43 different queries\. /);
      expect(lines.at(-1)).toBe('- and 3 more forms of a condition.');
    });
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
      '- CustomObject: 1 of 2 did not come back. Forms of the names: a (1). By how the name ends: ends in __c (1).',
      '- ListView: 3 of 4 did not come back. Forms of the names: a.a (3). What stands before the dot, as CustomObject: came back (1), did not come back (1), is not in the list (1). Not in the list: 1 object, by how the name ends: no ending of a custom object (1).',
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
      '- CustomField: 2 of 2 did not come back. Forms of the names: a.a (2). What stands before the dot, as CustomObject: is not in the list (2). Not in the list: 1 object, by how the name ends: no ending of a custom object (1). Came back, not listed, under a name that differs in what stands before its last dot or slash (1).',
      '- LightningComponentBundle: 1 of 1 did not come back. Forms of the names: a (1). Came back, not listed, under a name that differs only in the prefix of a package (1).',
      '- RecordType: 1 of 1 did not come back. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1). Not in the list: 1 object, by how the name ends: no ending of a custom object (1). Came back, not listed, under a name that differs only in upper and lower case (1).',
      '- Report: 1 of 1 did not come back. Forms of the names: a/a%a (1). The folder before the slash, as ReportFolder: is not in the list (1). Came back, not listed, under a name that differs only in how a character is encoded (1).',
      '',
      'Components the org handed out and had not listed, by type:',
      '- CustomField: 1. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1). Not in the list: 1 object, by how the name ends: no ending of a custom object (1).',
      '- LightningComponentBundle: 1. Forms of the names: a (1).',
      '- RecordType: 1. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1). Not in the list: 1 object, by how the name ends: no ending of a custom object (1).',
      '- Report: 1. Forms of the names: a/a.a (1). The folder before the slash, as ReportFolder: is not in the list (1).',
    ]);
  });

  it('says of how many Salesforce remarked that it cannot find them, and what kind of object a name is of', () => {
    const cannot = (type: string, name: string): string => `Entity of type '${type}' named '${name}' cannot be found`;
    const lines = missingLines(
      log,
      [
        item('CustomObject', 'Account', true, true),
        item('CustomObject', 'SecretPlan', true, false),
        item('CustomObject', 'Secret_Plan__x', true, false),
        item('CustomObject', 'Secret_Plan__zz', true, false),
        item('CustomField', 'Takeover.Secret__c', true, false),
        item('CustomField', 'Takeover.Other__c', true, false),
        item('RecordType', 'Hidden__c.Secret', true, false),
        // A short name after a prefix looks like the ending of a custom object. The prefix the org states decides.
        item('LightningComponentBundle', 'sp__plan', true, false, { namespacePrefix: 'sp' }),
        item('LightningComponentBundle', 'plan', false, true),
      ],
      [
        cannot('CustomObject', 'SecretPlan'),
        cannot('CustomObject', 'Takeover'),
        cannot('CustomObject', 'Account'),
        cannot('InstalledPackage', 'sp'),
        'Something else Salesforce said about Takeover',
      ],
    );
    expect(lines).toEqual([
      '',
      'Components the org listed and did not hand out, by type. A name is shown as its form only: "a" stands for letters, digits and underscores.',
      '- CustomField: 2 of 2 did not come back. Forms of the names: a.a (2). What stands before the dot, as CustomObject: is not in the list (2). Not in the list: 1 object, by how the name ends: no ending of a custom object (1). Salesforce remarked of 1 of them that it cannot be found.',
      '- CustomObject: 3 of 4 did not come back. Forms of the names: a (3). By how the name ends: an ending that is not shown (1), ends in __x (1), no ending of a custom object (1). Salesforce remarked of 1 that it cannot be found.',
      '- LightningComponentBundle: 1 of 1 did not come back. Of a package: 1. Forms of the names: a (1). Came back, not listed, under a name that differs only in the prefix of its package (1).',
      '- RecordType: 1 of 1 did not come back. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1). Not in the list: 1 object, by how the name ends: ends in __c (1). Salesforce remarked of 0 of them that it cannot be found.',
      '',
      'Components the org handed out and had not listed, by type:',
      '- LightningComponentBundle: 1. Forms of the names: a (1).',
      '',
      'Other names Salesforce remarked it cannot find, by type: CustomObject, a component that came back all the same (1), InstalledPackage, a name the org did not list (1).',
    ]);
    for (const name of ['Secret', 'Takeover', 'Hidden', 'plan', 'zz']) expect(lines.join('\n')).not.toContain(name);
    expect(['Account', 'Invoice__c', 'A__mdt', 'A_b__Share', 'ns__Thing', 'ns__Thing__c'].map(objectKind)).toEqual([
      'no ending of a custom object',
      'ends in __c',
      'ends in __mdt',
      // An ending no kind of custom object has is part of a name the org chose.
      'an ending that is not shown',
      'an ending that is not shown',
      'ends in __c',
    ]);
  });

  it('says how many missing components a remark of another form names, and shows the remark without the name', () => {
    const lines = missingLines(
      log,
      [
        item('CustomObject', 'SecretPlan', true, false),
        item('CustomObject', 'Takeover', true, false),
        item('CustomObject', 'Plan', true, false),
        // Names that are everyday words, which a remark is shown with.
        item('CustomObject', 'User', true, false),
        item('CustomObject', 'Settings', true, false),
        item('CustomField', 'Hidden.Secret__c', true, false),
        // A name with signs that mean something in a pattern.
        item('Layout', 'Merger-Big (new) $1 Layout', true, false),
      ],
      [
        'Unable to retrieve Merger-Big (new) $1 Layout',
        'You do not have the proper permissions to access SecretPlan.',
        'You do not have the proper permissions to access Takeover.',
        'Not a CustomObject type: Takeover',
        // The name of a field is not the name of its object, and a name inside a longer one is not that name.
        'You do not have the proper permissions to access Hidden.',
        'You do not have the proper permissions to access Hidden.Secret__c_2.',
        'You do not have the proper permissions to access MasterPlan and Plans.',
        // A name with a dot before or after it is one side of another name, and a letter of any script is a letter.
        'You do not have the proper permissions to access Plan.Secret__c, My.Plan and Planä.',
        'You do not have the proper permissions to access User.',
        'Unable to retrieve Settings',
        'Unable to retrieve Hidden.Secret__c.',
        "Entity of type 'CustomObject' named 'Plan' cannot be found",
      ],
    );
    // The remarks as they are shown elsewhere in the log, with a name that is an everyday word.
    expect(everydayWords('You do not have the proper permissions to access User.')).toContain('User');
    expect(everydayWords('Unable to retrieve Settings')).toContain('Settings');
    expect(lines).toEqual([
      '',
      'Components the org listed and did not hand out, by type. A name is shown as its form only: "a" stands for letters, digits and underscores.',
      '- CustomField: 1 of 1 did not come back. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1). Not in the list: 1 object, by how the name ends: no ending of a custom object (1). Salesforce remarked of 0 of them that it cannot be found. A remark of Salesforce of another form holds the name of 1. In everyday words, without the name: Unable to retrieve … (1).',
      '- CustomObject: 5 of 5 did not come back. Forms of the names: a (5). By how the name ends: no ending of a custom object (5). Salesforce remarked of 1 that it cannot be found. A remark of Salesforce of another form holds the name of 4. In everyday words, without the name: You do not have the proper permissions to access … (3), Not a … type: … (1), Unable to retrieve … (1).',
      '- Layout: 1 of 1 did not come back. Forms of the names: a-a (a) $a a (1). A remark of Salesforce of another form holds the name of 1. In everyday words, without the name: Unable to retrieve … (1).',
    ]);
    for (const name of ['Secret', 'Takeover', 'Hidden', 'Plan', 'User', 'Settings', 'Merger', 'Big']) {
      expect(lines.join('\n')).not.toContain(name);
    }
  });

  it('takes what stands before a dot for an object only in the name of a part of an object', () => {
    // A record of custom metadata is named by its type, which is no object of the list and ends as a name does.
    const lines = missingLines(log, [item('CustomMetadata', 'sp__Tag.Secret', true, false)]);
    expect(lines).toEqual([
      '',
      'Components the org listed and did not hand out, by type. A name is shown as its form only: "a" stands for letters, digits and underscores.',
      '- CustomMetadata: 1 of 1 did not come back. Forms of the names: a.a (1). What stands before the dot, as CustomObject: is not in the list (1).',
    ]);
  });

  it('says when the snapshot kept fewer remarks than Salesforce made', () => {
    const remark = "Entity of type 'CustomObject' named 'SecretPlan' cannot be found";
    const items = [item('CustomObject', 'SecretPlan', true, false)];
    expect(missingLines(log, items, [remark], 1).at(-1)).toBe(
      '- CustomObject: 1 of 1 did not come back. Forms of the names: a (1). By how the name ends: no ending of a custom object (1). Salesforce remarked of 1 that it cannot be found.',
    );
    expect(missingLines(log, items, [remark], 70).slice(-2)).toEqual([
      '',
      'Salesforce made 70 remarks about the retrieves, and the snapshot keeps 1 of them. The counts above of what Salesforce remarked can be too low.',
    ]);
    // Nothing is missing: there is no count that could be too low.
    expect(missingLines(log, [item('CustomObject', 'SecretPlan', true, true)], [], 70)).toEqual([]);
  });
});

describe('deploying the fixture project', () => {
  it('sends the whole project as one deploy without tests, and says how it went', async () => {
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(false);
    expect(text().replace(/after \d+ seconds/g, 'after N seconds')).toBe(
      [
        'The deploy of the fixture project ended as Succeeded after N seconds.',
        'Components of the fixture project: 118. Salesforce counted 37, deployed 37 and found errors in 0.',
        'Of the components Salesforce accepted, 18 are new in the org, 19 were changed, and 0 were as they are.',
        'The fixture project is in the test org. No Apex test was run.',
      ].join('\n'),
    );
    // The project, and no draft of a flow: that is a step of its own.
    expect(metadata.deploys).toHaveLength(1);
    for (const deploy of metadata.deploys) {
      expect(deploy.options).toEqual({ rollbackOnError: 'true', singlePackage: 'true', testLevel: 'NoTestRun' });
    }
    // The zip file holds every file of the project, in the layout of the Metadata API, and its list of contents.
    const sent = metadata.deploys[0]?.files ?? [];
    expect(sent).toContain('package.xml');
    expect(sent).toContain('classes/InvoiceService.cls');
    expect(sent).toContain('triggers/InvoiceTrigger.trigger');
    expect(sent).toContain('objects/Invoice__c.object');
    expect(sent).toContain('objects/User.object');
    expect(sent).toContain('labels/CustomLabels.labels');
    expect(sent).toContain('customMetadata/Billing_Rule.Default.md');
    expect(sent).toContain('customPermissions/Approve_Large_Invoices.customPermission');
    expect(sent).toContain('globalValueSets/Billing_Region.globalValueSet');
    expect(sent).toContain('flows/Invoice_Recalculate.flow');
    expect(sent).toContain('workflows/Invoice__c.workflow');
    expectNoSecret(text());
  });

  it('sends the outbound message with the user it logs in as, and no file with the made-up user', async () => {
    // The project names a user that does not exist, because no user name of an org may stand in the repository.
    const inProject = readFileSync(
      join(FIXTURES_DIR, 'billing-sfdx/force-app/main/default/workflows/Invoice__c.workflow-meta.xml'),
      'utf8',
    );
    expect(inProject).toContain(`<integrationUser>${MADE_UP_USER}</integrationUser>`);
    expect(MADE_UP_USER).toMatch(/\.invalid$/);

    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(false);
    const sent = metadata.deploys[0]?.texts ?? new Map<string, string>();
    expect(sent.get('workflows/Invoice__c.workflow')).toBe(inProject.replace(MADE_UP_USER, USERNAME));
    for (const deploy of metadata.deploys) {
      for (const [path, content] of deploy.texts) expect(content.includes(MADE_UP_USER), path).toBe(false);
    }
    // The user is in the file that is sent, and in no line of the log.
    expectNoSecret(text());
  });

  it('sends, when it is asked for the draft, one flow as a draft that reads another field, and not the project', async () => {
    const first = collected();
    await deployFixture(first.log, { env: environment(), pollMs: 5, draft: true });
    expect(first.log.failed).toBe(false);
    expect(first.text().replace(/after \d+ seconds/g, 'after N seconds')).toBe(
      [
        'The deploy of a draft of the flow Invoice_Recalculate ended as Succeeded after N seconds.',
        'Salesforce counted 1, deployed 1 and found errors in 0.',
        'Of the components Salesforce accepted, 0 are new in the org, 1 were changed, and 0 were as they are.',
        'Salesforce took the draft. Whether the flow Invoice_Recalculate now has an active version and a newer draft, and which of the two the org hands out, is for the steps that read the org and ask it about its flows to say.',
      ].join('\n'),
    );
    expectNoSecret(first.text());
    // One deploy, of one flow.
    expect(metadata.deploys).toHaveLength(1);
    const [draft] = metadata.deploys;
    expect(draft?.options).toEqual({ rollbackOnError: 'true', singlePackage: 'true', testLevel: 'NoTestRun' });
    expect(draft?.files).toEqual(['flows/Invoice_Recalculate.flow', 'package.xml']);

    // The project, to hold the draft against the version the project sends as active.
    const { log } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5 });
    expect(log.failed).toBe(false);
    expect(metadata.deploys).toHaveLength(2);
    const project = metadata.deploys[1];
    expect(draft?.texts.get('package.xml')).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
        '    <types>',
        '        <members>Invoice_Recalculate</members>',
        '        <name>Flow</name>',
        '    </types>',
        '    <version>65.0</version>',
        '</Package>',
        '',
      ].join('\n'),
    );
    const active = project?.texts.get('flows/Invoice_Recalculate.flow') ?? '';
    const newer = draft?.texts.get('flows/Invoice_Recalculate.flow') ?? '';
    expect(active).toContain('<status>Active</status>');
    expect(newer).toContain('<status>Draft</status>');
    // Line by line, the draft differs in the three places the tool names, and nowhere else.
    const lines = active.split('\n');
    const changed = newer.split('\n').flatMap((line, at) => (line === lines[at] ? [] : [[lines[at], line]]));
    expect(newer.split('\n')).toHaveLength(lines.length);
    expect(changed.map(([from, to]) => [from?.trim(), to?.trim()])).toEqual([
      [
        '<leftValueReference>invoice.Due_Date__c</leftValueReference>',
        '<leftValueReference>invoice.Paid_Date__c</leftValueReference>',
      ],
      [
        expect.stringMatching(/^<description>Adds up /) as string,
        expect.stringMatching(/^<description>A draft that is newer than the active version\. Adds up /) as string,
      ],
      ['<status>Active</status>', '<status>Draft</status>'],
    ]);
    expect(DRAFT_CHANGES).toHaveLength(3);
    // The field the draft reads is one the active version only holds in a text. So the answer key has no reference
    // from the flow to it, and a row of the Dependency API with that pair can only be of the draft.
    expect(active).not.toMatch(/[.>]Paid_Date__c</);
    const key = loadAnswerKey();
    expect(
      key.references.filter(
        (one) => one.from.startsWith('Flow:invoice_recalculate') && one.to === 'CustomField:invoice__c.paid_date__c',
      ),
    ).toEqual([]);
  });

  it('says when Salesforce refuses the draft, and shows of its problem the everyday words only', async () => {
    metadata.deployProblems.push({
      type: 'Flow',
      fullName: 'Invoice_Recalculate',
      fileName: 'flows/Invoice_Recalculate.flow',
      problem: `The user ${USERNAME} may not change a flow`,
    });
    const { log, text } = collected();
    await deployFixture(log, { env: environment(), pollMs: 5, draft: true });
    expect(log.failed).toBe(true);
    expect(metadata.deploys).toHaveLength(1);
    expect(
      text()
        .replace(/after \d+ seconds/g, 'after N seconds')
        .split('\n'),
    ).toEqual([
      '::error::The deploy of a draft of the flow Invoice_Recalculate ended as Failed after N seconds.',
      'Salesforce counted 1, deployed 0 and found errors in 1.',
      '1. Flow Invoice_Recalculate, file flows/Invoice_Recalculate.flow',
      '   Problem: not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it. Its everyday words: The user … may not … a …',
    ]);
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
      'Components of the fixture project: 118. Salesforce counted 37, deployed 0 and found errors in 5.',
      '1. ApexClass InvoiceService, file classes/InvoiceService.cls, line 14, column 9',
      '   Problem: Variable does not exist: Amount__c',
      '2. ApexClass InvoiceSelector, file classes/InvoiceSelector.cls, line 3, column 1',
      '   Problem: not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it. Its everyday words: The user … of … may not do this',
      '3. CustomObject (a name that is not of the fixture project)',
      '   Problem: Entity is not org-accessible',
      '4. ApexClass (a name that is not of the fixture project), line 2, column 4',
      '   Problem: not shown, because it is about something that is not a component of the fixture project. The page "Deployment Status" in the Setup of the test org shows it.',
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

    const draft = collected();
    await deployFixture(draft.log, { env: environment(), draft: true });
    expect(draft.log.failed).toBe(true);
    expect(draft.text()).toBe(
      [
        '::error::A draft of the flow Invoice_Recalculate was not deployed, because the login to the test org failed: LOGIN_FAILED (JWT_REJECTED).',
        'The message is not shown here. docs/cli.md lists the codes.',
      ].join('\n'),
    );
    expect(metadata.deploys).toEqual([]);
  });

  it('refuses to change a file that does not hold what is to be changed exactly once', () => {
    // The file of the outbound message and the flow that gets a draft are changed this way, before the login.
    expect(changedOnce('<a>one</a>', 'one', 'two', 'The file')).toBe('<a>two</a>');
    expect(changedOnce('<a>one</a>', 'one', '$&$1', 'The file')).toBe('<a>$&$1</a>');
    expect(() => changedOnce('<a>one</a>', 'three', 'two', 'The file')).toThrow(
      'The file does not hold "three" exactly once.',
    );
    expect(() => changedOnce('<a>one</a><b>one</b>', 'one', 'two', 'The file')).toThrow(
      'The file does not hold "one" exactly once.',
    );
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
    const asked = ['deploy', 'checkDeployStatus', 'checkDeployStatus', 'checkDeployStatus', 'checkDeployStatus'];
    expect(metadata.calls.map((call) => call.operation)).toEqual(asked);
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
    // Four times in vain and once with an answer.
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
      'Components: 126 listed by the org, 126 of them retrieved, 0 retrieved that the org had not listed, 0 of a package with a namespace.',
    );
    expect(output).toContain('logged in. The org is read with API version 66.0.');
    expect(output).toMatch(/The snapshot of the test org is complete\. It took \d+\.\d s: /);
    expect(output).toMatch(/Requests to the Metadata API: [1-9]\d*\. Largest memory of the process: \d+ MB\./);
    expect(output).toMatch(/Retrieves: 1 chunk, 1 stored, 0 failed, 0 not ended\. Started more than once: 0\./);
    expect(output).toMatch(/^ApexClass +13 +13 +ok$/m);
    expect(output).toMatch(/^CustomField +57 +57 +ok$/m);
    expect(output).toMatch(/^CustomLabel +1 +1 +ok$/m);
    expect(output).toMatch(/^GlobalValueSet +1 +1 +ok$/m);
    // The one path of a flow that the answer key calls unknown.
    expect(output).toContain('Observations: 1.\n- warning PATH_NOT_FOLLOWED: 1 observation\n');
    const components = fixtureComponents().length;
    expect(output).toContain(
      `Fixture project: ${String(components)} components. Listed by the org: ${String(components)}. Retrieved: ${String(components)}.`,
    );
    const files = fixtureFiles().size;
    // The mock org hands a file out as the Salesforce library writes it, which writes a quote as a reference.
    expect(output).toContain(
      `Files of the fixture project: ${String(files)}. In the snapshot: ${String(files)}. The same byte for byte: ${String(files - 10)}. Different: 10.`,
    );
    expect(output).toContain(
      '- objects/Invoice__c/fields/Summary__c.field-meta.xml: only how characters such as quotes are written differs (391 bytes here, 411 from the org)',
    );
    // The org keeps a definition of each of the six flows, which is a component of its own in the chunk.
    expect(output).toMatch(/^0 +44 +11 +\d+\.\d +1 +done$/m);
    expect(output).toMatch(
      /^Files by folder: classes 26, customMetadata 4, customPermissions 1, email 3, flowDefinitions 6, flows 6, globalValueSets 1, labels 1, objects \d+, triggers 2, workflows 2$/m,
    );
    // The cross-check: the rows of the mock org, held against the analysis by the engine.
    const rows = dependencies.rows.length;
    const cross = output.split('\n');
    expect(
      cross.slice(cross.indexOf('The cross-check with the Dependency API of Salesforce (MetadataComponentDependency)')),
    ).toEqual([
      'The cross-check with the Dependency API of Salesforce (MetadataComponentDependency)',
      `Rows: ${String(rows)}, read with 1 request. No query left a row out.`,
      'Rows that are not compared, from a component of a type that is not analysed or of a flow: 84 (ApexClass (82), ApexTrigger (1), CustomMetadata (1)).',
      'Rows with an end that is no component the org listed: 0. Rows from a component the snapshot does not hold or that was not analysed: 0.',
      'Rows compared: 61, which are 61 pairs of components. The analysis has 59 of them, has 2 as a reference to a part of the object Salesforce names, and missed 0.',
      'References of the analysis of a kind Salesforce reports, for which it has no row: 0.',
      'References of the analysis of kinds the API does not report: 72 (standard-field (25), workflow-rule (18), workflow-action (7), standard-object (6), roll-up-summary (5), field-update (4), controlling-field (2), lookup-filter (2), value-set (2), lookup (1)).',
      expect.stringMatching(
        new RegExp(
          `^Read once more with every answer cut off at 30 rows: \\d+ requests, ${String(rows)} rows, and the engine calls the reading whole\\. Queries still at that number for a single component, or with no smaller part to ask for: 0\\. Queries that failed: 0\\. Queries asked again per component, for more components than one query names: 0\\.$`,
        ),
      ) as string,
      'The parts give the same rows as one query just before.',
    ]);
    // The rows of a component the org did not list were asked for, where one query names every component.
    expect(dependencies.queries.some((soql) => soql.includes('MetadataComponentId NOT IN ('))).toBe(true);
    // The second reading asked per type, per pair of types and per component, and for nothing but the one object.
    expect(
      dependencies.queries.some((soql) =>
        soql.includes(
          "MetadataComponentType = 'ApexClass' AND RefMetadataComponentType = 'CustomField' AND MetadataComponentId IN (",
        ),
      ),
    ).toBe(true);
    for (const soql of dependencies.queries) expect(soql).toContain(' FROM MetadataComponentDependency');
    expectNoSecret(output);
  });

  it('says which pairs of the files of Phase 2 Salesforce reports, by the ids the org listed', async () => {
    const flow = ['Flow', 'Invoice_After_Save'] as const;
    dependencies.rows.push(
      // In the answer key: a field the flow reads, the flow it calls, and the alert it sends.
      dependencyRow(metadata, flow, ['CustomField', 'Invoice__c.Amount__c']),
      dependencyRow(metadata, flow, ['Flow', 'Invoice_Recalculate']),
      dependencyRow(metadata, flow, ['WorkflowAlert', 'Invoice__c.Invoice_Overdue_Alert']),
      dependencyRow(
        metadata,
        ['WorkflowRule', 'Invoice__c.Remind_When_Sent'],
        ['WorkflowFieldUpdate', 'Invoice__c.Set_Sub_Status_Reminder'],
      ),
      // Between components of the fixture project, and not in the answer key.
      dependencyRow(metadata, flow, ['CustomField', 'Invoice__c.Paid_Date__c']),
      // A row from the same flow with an id the org did not list, as the id of a version of a flow may be.
      {
        ...dependencyRow(metadata, flow, ['CustomField', 'Invoice__c.Status__c']),
        MetadataComponentId: '301xx0000000077AAA',
      },
    );
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    const lines = output.split('\n');
    const head = lines.indexOf(
      'The files of Phase 2 of the fixture project in the rows of the Dependency API, held against the pairs of its answer key',
    );
    const end = lines.indexOf('The cross-check with the Dependency API of Salesforce (MetadataComponentDependency)');
    const section = lines.slice(head, end).join('\n');
    expect(head).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(head);
    // What the id of a row is the id of.
    expect(section).toMatch(/^Flow +Flow +4$/m);
    expect(section).toMatch(/^Flow +not listed +1$/m);
    expect(section).toMatch(/^WorkflowRule +WorkflowRule +1$/m);
    // The rows of the mock org from the formulas of field updates, as the test org reports them.
    expect(section).toMatch(/^WorkflowFieldUpdate +WorkflowFieldUpdate +3$/m);
    expect(section).toMatch(/^\(the name of a custom metadata type\) +CustomMetadata +1$/m);
    expect(section).toMatch(/^WorkflowAlert +WorkflowAlert +1$/m);
    // The pairs of the key for these files, and how many of them the rows are.
    expect(section).toContain(
      'The answer key holds 149 pairs of a component and a component it refers to for these files. The Dependency API reports 8 of them.',
    );
    expect(section).toMatch(/^Flow +CustomField +62 +1$/m);
    expect(section).toMatch(/^Flow +Flow +1 +1$/m);
    expect(section).toMatch(/^WorkflowRule +WorkflowFieldUpdate +3 +1$/m);
    expect(section).toMatch(/^WorkflowFieldUpdate +CustomField +8 +3$/m);
    expect(section).toMatch(/^record-of +4 +1$/m);
    expect(section).toMatch(/^action +9 +3$/m);
    expect(section).toContain('- reported  Flow:invoice_after_save -> CustomField:invoice__c.amount__c  (path)');
    expect(section).toContain('- reported  Flow:invoice_after_save -> Flow:invoice_recalculate  (action)');
    // The row with an id the org did not list is no row of the flow for the engine.
    expect(section).toContain('- missing   Flow:invoice_after_save -> CustomField:invoice__c.status__c  (filter)');
    expect(section).toContain(
      '- reported  WorkflowRule:invoice__c.remind_when_sent -> WorkflowFieldUpdate:invoice__c.set_sub_status_reminder  (action)',
    );
    expect(section).toContain(
      '- reported  CustomMetadata:billing_rule.default -> CustomObject:billing_rule__mdt  (record-of)',
    );
    expect(section.split('\n').slice(-3)).toEqual([
      'Pairs the Dependency API reports from a component of the types CustomMetadata, EmailTemplate, FieldSet, Flow, RecordType, WorkflowAlert, WorkflowFieldUpdate, WorkflowOutboundMessage, WorkflowRule, WorkflowTask that the answer key does not hold: 1.',
      '- Flow:invoice_after_save -> CustomField:invoice__c.paid_date__c',
      '',
    ]);
    // The cross-check counts the rows of flows and of a record of a custom metadata type, and compares none of
    // them. It compares the row of the workflow rule, whose pair the analysis has.
    expect(output).toContain(
      'Rows that are not compared, from a component of a type that is not analysed or of a flow: 89 (ApexClass (82), Flow (5), ApexTrigger (1), CustomMetadata (1)).',
    );
    expect(output).toContain(
      'Rows compared: 62, which are 62 pairs of components. The analysis has 60 of them, has 2 as a reference to a part of the object Salesforce names, and missed 0.',
    );
    expectNoSecret(output);
  });

  it('says which version of each flow the org handed out, and which one of the flow with a draft', async () => {
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    // The mock org hands out what the project holds: the version that is sent as active.
    expect(output).toContain(
      [
        'The flows of the fixture project, by the state the file names:',
        'FLOW                   STATE HERE  STATE FROM THE ORG',
        'Invoice_After_Save     Active      Active',
        'Invoice_Before_Save    Active      Active',
        'Invoice_Purge_Void     Draft       Draft',
        'Invoice_Recalculate    Active      Active',
        'Invoice_Review_Screen  Active      Active',
        'Invoice_Sent_Process   Active      Active',
        'Invoice_Recalculate is the flow that the step "draft" sends once more as a draft, which differs in 3 places. The file from the org is the version that was sent as active.',
        '',
      ].join('\n'),
    );

    // The same lines for an org that hands out the draft, a file that is neither, and no file.
    const path = `flows/${FLOW_WITH_DRAFT}.flow-meta.xml`;
    const active = fixtureFiles().get(path)?.toString('utf8') ?? '';
    let draft = active;
    for (const [from, to] of DRAFT_CHANGES) draft = draft.replace(from, to);
    const last = (file: string | null): string | undefined =>
      flowLines(collected().log, (asked) => (asked === path ? file : null)).at(-1);
    expect(last(draft)).toBe(
      'Invoice_Recalculate is the flow that the step "draft" sends once more as a draft, which differs in 3 places. The file from the org is the draft.',
    );
    expect(last(draft.replace('<status>Draft</status>', '<status>Obsolete</status>'))).toBe(
      'Invoice_Recalculate is the flow that the step "draft" sends once more as a draft, which differs in 3 places. The file from the org has 2 of them as the draft has them and 0 as the version that was sent as active.',
    );
    const lines = flowLines(collected().log, (asked) =>
      asked === path ? draft.replace('<status>Draft</status>', '<status>Secret_Plan</status>') : null,
    );
    expect(lines).toContain('Invoice_Recalculate    Active      no state');
    expect(lines).toContain('Invoice_After_Save     Active      no file');
    expect(last(null)).toBe('Invoice_Sent_Process   Active      no file');
  });

  it('says that the snapshot holds the active version, where the org hands out the draft for the name of the flow', async () => {
    // The org of run 21: version 1 is active and version 2 is the draft, which the org hands out for the name.
    const dir = dirs.next();
    cpSync(FIXTURE, join(dir, 'force-app'), { recursive: true });
    const path = `flows/${FLOW_WITH_DRAFT}.flow-meta.xml`;
    const active = fixtureFiles().get(path)?.toString('utf8') ?? '';
    const draft = DRAFT_CHANGES.reduce((text, [from, to]) => text.replace(from, to), active);
    writeFileSync(join(dir, 'force-app/main/default', path), draft);
    const withDraft = await metadataFromSource(join(dir, 'force-app'));
    withDraft.flowVersions.set(FLOW_WITH_DRAFT, { latest: 2, older: new Map([[1, active]]) });
    mock.metadata = withDraft;
    mock.dependencies = mockDependencies(fixtureDependencyRows(withDraft));
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain('Invoice_Recalculate    Active      Active\n');
    expect(output).toContain(
      'Invoice_Recalculate is the flow that the step "draft" sends once more as a draft, which differs in 3 places. The file from the org is the version that was sent as active.',
    );
    expect(output).toContain('- info FLOW_NEWER_VERSION: 1 observation\n');
    expect(output).toMatch(
      /After \d+\.\d s: 1 flow has a latest version that is not active\. The active version of each is asked for by its number\./,
    );
    expectNoSecret(output);
  });

  it('fails when the analysis missed a reference that Salesforce reports, and names the pair', async () => {
    // The formula of this rule does not name the field. For this test, Salesforce says that it does.
    dependencies.rows.push(
      dependencyRow(
        metadata,
        ['ValidationRule', 'Invoice__c.Tax_Rate_Matches_Code'],
        ['CustomField', 'Invoice__c.Amount__c'],
      ),
    );
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toContain(
      'Rows compared: 62, which are 62 pairs of components. The analysis has 59 of them, has 2 as a reference to a part of the object Salesforce names, and missed 1.',
    );
    expect(output).toContain(
      '- missed  ValidationRule:invoice__c.tax_rate_matches_code -> CustomField:invoice__c.amount__c',
    );
    // The analysis of the snapshot has the error, so the snapshot has one observation.
    expect(output).toContain('- error REFERENCE_MISSED: 1 observation');
    expect(output.split('\n').slice(-2)).toEqual([
      '',
      '::error::The analysis missed a reference that Salesforce reports. The lines above name it where it is of the fixture project.',
    ]);
    expectNoSecret(output);
  });

  it('fails when the org has no Dependency API, and says with its code that nothing was compared', async () => {
    mock.dependencies = null;
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toContain('The snapshot of the test org is complete.');
    expect(output).toContain('- warning CROSS_CHECK_NOT_READ: 1 observation');
    expect(output.split('\n').slice(-4)).toEqual([
      'The cross-check with the Dependency API of Salesforce (MetadataComponentDependency)',
      'The Dependency API gave no answer (INVALID_TYPE), after 3 requests. Nothing was compared.',
      '',
      '::error::The analysis of the snapshot was not held against the Dependency API. The lines above say why.',
    ]);
    expectNoSecret(output);
  });

  it('says that rows are missing when the org refuses to be asked per component, and does not fail for it', async () => {
    // The org answers the one query of the snapshot. It refuses the query the second reading needs at the limit.
    dependencies.refuse = (soql) => (soql.includes('MetadataComponentId IN (') ? 'MALFORMED_QUERY' : undefined);
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toMatch(
      /^Read once more with every answer cut off at 30 rows: \d+ requests, \d+ rows, and the engine calls the reading partial\. Queries still at that number for a single component, or with no smaller part to ask for: \d+\. Queries that failed: [1-9]\d* \(MALFORMED_QUERY\)\. Queries asked again per component, for more components than one query names: 0\.$/m,
    );
    // The step says which requests failed: the types, and how many ids, never an id. Every line between the
    // line of the reading and the line about the parts is one of them.
    const lines = output.split('\n');
    const head = lines.findIndex((line) => line.startsWith('Requests of this reading that failed: '));
    const end = lines.findIndex((line) => line.startsWith('The parts lack '));
    expect(lines[head - 1]).toMatch(/^Read once more with every answer cut off at 30 rows: /);
    const counts =
      /^Requests of this reading that failed: (\d+), for (\d+) different quer(?:y|ies)\. A request that was answered when it was sent again is among them\. By the condition of the query, with the number of ids in the place of the ids, and the code of the failure:$/.exec(
        lines[head] ?? '',
      );
    expect(counts).not.toBeNull();
    const listed = lines.slice(head + 1, end);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toEqual([...listed].sort());
    let queries = 0;
    let requests = 0;
    for (const line of listed) {
      const numbers =
        /^- MetadataComponentType = [A-Za-z]+ AND RefMetadataComponentType = [A-Za-z]+ AND MetadataComponentId IN \([1-9]\d* ids?\): MALFORMED_QUERY\. Queries: ([1-9]\d*)\. Requests: ([1-9]\d*)\.$/.exec(
          line,
        );
      expect(numbers, line).not.toBeNull();
      queries += Number(numbers?.[1]);
      requests += Number(numbers?.[2]);
    }
    // The numbers are those of the queries the mock org refused: a refusal is not asked again.
    const refused = dependencies.queries.filter((soql) => soql.includes('MetadataComponentId IN ('));
    expect(new Set(refused).size).toBe(refused.length);
    expect([Number(counts?.[1]), Number(counts?.[2])]).toEqual([refused.length, refused.length]);
    expect([requests, queries]).toEqual([refused.length, refused.length]);
    expect(output).toMatch(
      /^The parts lack [1-9]\d* rows? of the one query just before, and give 0 rows it does not have\.$/m,
    );
    expect(output).toMatch(
      /^The rows the parts lack, by the types of their two ends: (?:[A-Za-z]+ to [A-Za-z]+ [1-9]\d*(?:, )?)+\.$/m,
    );
    expect(output.split('\n').at(-1)).toBe(
      '::warning::The org refused a query the engine asks when a query is at the limit of rows.',
    );
    expectNoSecret(output);
  });

  it('fails when the parts give a row that one query did not give', async () => {
    // The org gets a row between the query for everything and the queries for the parts. For the step that is
    // the same as an engine whose parts give something else than one query.
    const later = dependencyRow(metadata, ['ApexClass', 'InvoiceSelector'], ['CustomField', 'Invoice__c.Region__c']);
    const answer = dependencies.answer.bind(dependencies);
    dependencies.answer = (soql) => {
      if (soql.includes(' WHERE ') && !dependencies.rows.includes(later)) dependencies.rows.push(later);
      return answer(soql);
    };
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output.split('\n').slice(-4)).toEqual([
      'The parts lack 0 rows of the one query just before, and give 1 row it does not have.',
      'The rows only the parts give, by the types of their two ends: ApexClass to CustomField 1.',
      '',
      '::error::Reading the Dependency API in parts gave other rows than one query just before. The lines above say how many. If the org was changed in that moment, a second run tells.',
    ]);
    expectNoSecret(output);
  });

  it('does not read in parts an org that holds fewer rows than the parts are cut off at', async () => {
    dependencies.rows.length = 20;
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output.split('\n').at(-1)).toBe('The org holds fewer than 30 rows, so reading them in parts was not tried.');
    expect(dependencies.queries.every((soql) => !soql.includes(' WHERE '))).toBe(true);
    expectNoSecret(output);
  });

  it('fails when the snapshot is partial, and names the component of the fixture project that is missing', async () => {
    metadata.withheld.add('ApexClass:InvoiceSelector');
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toContain('The snapshot of the test org is partial.');
    expect(output).toMatch(/^ApexClass +13 +12 +ok$/m);
    expect(output).toContain(
      '- error NOT_RETRIEVED: 1 observation, about 1 components, files or remarks. Types: ApexClass',
    );
    expect(output).toContain("- 1 time: Entity of type 'ApexClass' named '(a name)' cannot be found");
    expect(output).toContain('- ApexClass InvoiceSelector: listed, not retrieved');
    expect(output).toContain('- classes/InvoiceSelector.cls: not in the snapshot');
    expect(output).toContain(
      '- ApexClass: 1 of 13 did not come back. State: unmanaged (1). Forms of the names: a (1).',
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
    expect(output).toContain('- and 98 more components.');
    expect(output).toContain('- and 102 more files that are not in the snapshot.');
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
    // The same rows, with the ids this org lists the components with.
    dependencies = mockDependencies(fixtureDependencyRows(more));
    mock.dependencies = dependencies;
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
      '- ApexClass: 1 of 14 did not come back. State: unmanaged (1). Forms of the names: a (1).',
    );
    expect(output).toContain('- CustomObject: 1. Forms of the names: a (1).');
    expect(output).toContain(
      '- 1 time: in (a folder that is not shown), 1 level deep, a name that ends in .txt. In everyday words: The file … to no metadata type that is known.',
    );
    // Each of these observations holds a name of the org in the database. The code is shown, the name is not.
    // A report is of no type of the logic tier, so its listing that failed is a warning.
    expect(output).toContain(
      '- warning LISTING_FAILED: 1 observation. Types: Report. Codes of Salesforce: INSUFFICIENT_ACCESS (1)',
    );
    expect(output).toContain(
      '- error NOT_RETRIEVED: 1 observation, about 1 components, files or remarks. Types: ApexClass',
    );
    expect(output).toContain(
      '- info UNLISTED_COMPONENTS: 1 observation, about 1 components, files or remarks. Types: CustomObject',
    );
    // The file beside the metadata, whose place the engine keeps in the observation. Two lie in a folder of no
    // type that is known, which counts against the logic tier. The third lies in the folder of the documents.
    expect(output).toContain('- error RESOLVE_FAILED: 2 observations');
    expect(output).toContain('- warning RESOLVE_FAILED: 1 observation. Types: Document, DocumentFolder');
    expect(output).toContain(
      '- 1 time: in (a folder that is not shown), 1 level deep, a name that ends in (an ending that is not shown). In everyday words:',
    );
    expect(output).toContain(
      '- 1 time: in documents, 2 levels deep, a name that ends in (an ending that is not shown). In everyday words:',
    );
    expect(output).toContain("- 1 time: Entity of type 'ApexClass' named '(a name)' cannot be found");
    expect(output).toMatch(/^ApexClass +14 +13 +ok$/m);
    expect(output).toMatch(/^Report +0 +0 +failed$/m);
    expect(output).toContain('Fixture project: 118 components. Listed by the org: 118. Retrieved: 118.');
    expectNothingForeign(output);
  });

  it('names no component of the org in what the cross-check found, and counts the pairs it does not name', async () => {
    const more = await withMore();
    const date: readonly [string, string] = ['CustomField', 'Secret_Plan__c.Takeover_Date__c'];
    dependencies.rows.push(
      // From a class of the org, which is of a type that is not analysed.
      dependencyRow(more, ['ApexClass', 'SecretPlan'], date),
      // From a field of the org to a field of the fixture project: a reference the analysis does not have.
      dependencyRow(more, date, ['CustomField', 'Invoice__c.Amount__c']),
      // From a record of a custom metadata type of the org, whose type the API writes in the place of a type.
      {
        ...dependencyRow(more, ['ApexClass', 'SecretPlan'], date),
        MetadataComponentType: 'Secret_Plan__mdt',
        MetadataComponentName: 'Takeover',
        MetadataComponentId: 'm00xx0000000099AAA',
      },
      // A type that is no name of a metadata type.
      {
        ...dependencyRow(more, ['ApexClass', 'SecretPlan'], date),
        MetadataComponentType: 'Hidden_Notes',
        MetadataComponentId: 'a0Zxx0000000099AAA',
      },
    );
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(output).toContain(
      'Rows that are not compared, from a component of a type that is not analysed or of a flow: 87 (ApexClass (83), CustomMetadata (2), (a type that is not shown) (1), ApexTrigger (1)).',
    );
    expect(output).toContain(
      'Rows compared: 62, which are 62 pairs of components. The analysis has 59 of them, has 2 as a reference to a part of the object Salesforce names, and missed 1.',
    );
    expect(output).toContain('- 1 pair has a component that is not of the fixture project, and is not named.');
    expect(output).not.toContain('- missed');
    // The observation of the analysis names the two components in the database. The code is shown, the names are not.
    expect(output).toContain('- error REFERENCE_MISSED: 1 observation');
    expect(log.failed).toBe(true);
    expect(output.split('\n').at(-1)).toBe(
      '::error::The analysis missed a reference that Salesforce reports. The lines above name it where it is of the fixture project.',
    );
    expectNothingForeign(output);
  });

  it('names no flow and no rule of the org among the pairs of the files of Phase 2', () => {
    // The mock org above has no flow of its own, so the rows are made here, with the ids an org would list.
    const listed = [
      { type: 'Flow', fullName: 'Takeover', id: '300xx0000000001AAA' },
      { type: 'WorkflowRule', fullName: 'Secret_Plan__c.Takeover', id: '01Qxx0000000001AAA' },
      { type: 'CustomField', fullName: 'Secret_Plan__c.Takeover_Date__c', id: '00Nxx0000000001AAA' },
      { type: 'Flow', fullName: 'Invoice_After_Save', id: '300xx0000000002AAA' },
      { type: 'CustomField', fullName: 'Invoice__c.Paid_Date__c', id: '00Nxx0000000002AAA' },
    ];
    const end = (at: number, name: string): DependencyRow['from'] => ({
      type: listed[at]?.type ?? '',
      id: listed[at]?.id ?? '',
      name,
      namespace: null,
    });
    const rows: DependencyRow[] = [
      { from: end(0, 'Takeover'), to: end(2, 'Takeover_Date') },
      { from: end(0, 'Takeover'), to: end(4, 'Paid_Date') },
      { from: end(1, 'Takeover'), to: end(4, 'Paid_Date') },
      { from: end(3, 'Invoice_After_Save'), to: end(2, 'Takeover_Date') },
      // The one pair between two components of the fixture project. The answer key does not hold it.
      { from: end(3, 'Invoice_After_Save'), to: end(4, 'Paid_Date') },
    ];
    const { log } = collected();
    const lines = phaseLines(log, rows, listed);
    expect(lines.slice(-3)).toEqual([
      'Pairs the Dependency API reports from a component of the types CustomMetadata, EmailTemplate, FieldSet, Flow, RecordType, WorkflowAlert, WorkflowFieldUpdate, WorkflowOutboundMessage, WorkflowRule, WorkflowTask that the answer key does not hold: 5.',
      '- Flow:invoice_after_save -> CustomField:invoice__c.paid_date__c',
      '- 4 pairs have a component that is not of the fixture project, and are not named.',
    ]);
    expectNothingForeign(lines.join('\n'));
  });

  it('names no component of the org when the retrieves fail one after the other', async () => {
    const more = await withMore();
    // Every retrieve that hands out a file fails, down to the single component, until the snapshot stops.
    more.maxFiles = 0;
    const { log, text } = collected();
    await readOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(true);
    expect(output).toMatch(
      /- error RETRIEVE_FAILED: \d+ observations, about \d+ components, files or remarks\. Types: ApexClass, CustomObject\. Codes of Salesforce: LIMIT_EXCEEDED \(\d+\)/,
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

  /** The object of a field or of a rule, as a query that asks for its name gets it. */
  const object = (name: string): Row => ({ attributes: { type: 'EntityDefinition' }, QualifiedApiName: name });
  /** A custom field. The object is an id of a custom object, or the name of a standard object. */
  const field = (n: number, name: string, table: string, objectName: string, namespace: string | null = null): Row => ({
    Id: id('00N', n),
    DeveloperName: name,
    NamespacePrefix: namespace,
    TableEnumOrId: table.slice(0, 15),
    EntityDefinition: object(objectName),
  });

  /** A small org: parts of the fixture project, and a class, an object and a flow beside it. */
  const tables = (): Record<string, Row[]> => ({
    CustomObject: [
      { Id: INVOICE, DeveloperName: 'Invoice', NamespacePrefix: null },
      { Id: LINE, DeveloperName: 'Invoice_Line', NamespacePrefix: null },
      { Id: PLAN, DeveloperName: 'Secret_Plan', NamespacePrefix: null },
    ],
    CustomField: [
      field(1, 'Amount', INVOICE, 'Invoice__c'),
      field(2, 'Status', INVOICE, 'Invoice__c'),
      field(3, 'Status', LINE, 'Invoice_Line__c'),
      field(4, 'Tier', 'Account', 'Account'),
      field(5, 'Is_Key_Account', 'Account', 'Account'),
      field(6, 'Unused_Field', INVOICE, 'Invoice__c'),
      field(9, 'Takeover_Date', PLAN, 'Secret_Plan__c'),
    ],
    ValidationRule: [
      {
        Id: id('03d', 1),
        ValidationName: 'Locked_When_Paid',
        NamespacePrefix: null,
        EntityDefinitionId: INVOICE.slice(0, 15),
        EntityDefinition: object('Invoice__c'),
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
        // Salesforce does not filter on a standard object as the type of a target, by name or in a list.
        if (target === 'StandardEntity' || (notTargets?.includes("'StandardEntity'") ?? false)) {
          return {
            status: 400,
            body: JSON.stringify([{ message: 'Refused.', errorCode: 'INVALID_TYPE_FOR_OPERATION' }]),
          };
        }
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
        // A row holds only what the query asks for of these two.
        const left = [
          ...(withSymbols ? [] : ['SymbolTable']),
          ...(soql.includes('EntityDefinition.') ? [] : ['EntityDefinition']),
        ];
        answer = answer.map((row) => Object.fromEntries(Object.entries(row).filter(([name]) => !left.includes(name))));
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
    // The rows are read by the reader of the engine. A small org is asked once.
    expect(output).toContain('The reader of the engine sent 1 request.');
    expect(asked.filter((soql) => soql.includes('FROM MetadataComponentDependency'))).toHaveLength(1);
    expect(output).toContain(
      'Different rows in all: 12. No query was cut off or failed in a way that leaves a row out.',
    );
    expect(output).not.toContain('::warning::');
    expect(output).toContain(
      'Rows read to find the names behind the ids: CustomObject 3, CustomField 7, ValidationRule 1, ApexClass 4, ApexTrigger 1, FlowDefinition 0, Flow 0.',
    );
    expect(output).toContain(
      'Rows between two components of the fixture project: 8, which are 8 pairs. Rows with a component that is not of it: 4.',
    );
    expect(output).toContain(
      'The rows with a component that is not of the fixture project, by type: ApexClass to CustomField 2, ApexClass to CustomObject 1, Flow to CustomField 1',
    );
    expect(output).toContain(
      'The answer key holds 343 pairs of a component and a component it refers to. The Dependency API reports 5 of them.',
    );
    expect(output).toMatch(/^ApexClass +CustomField +\d+ +1$/m);
    expect(output).toMatch(/^ApexClass +CustomObject \(of Salesforce\) +\d+ +1$/m);
    expect(output).toMatch(/^ValidationRule +CustomField +19 +1$/m);
    expect(output).toMatch(/^CustomField +GlobalValueSet +2 +0$/m);
    expect(output).toMatch(/^value-set +2 +0$/m);
    expect(output).toMatch(/^formula +\d+ +2$/m);
    expect(output).toMatch(/^probable +\d+ +0$/m);
    expect(output).toContain('- reported  ApexClass:invoiceservice -> CustomField:invoice__c.amount__c  (field, soql)');
    expect(output).toContain('- missing   ApexClass:invoiceservice -> CustomField:invoice__c.status__c  (field, soql)');
    expect(output).toContain('- reported  ApexTrigger:invoicetrigger -> CustomObject:invoice__c  (declaration)');
    expect(output).toContain('- reported  ApexClass:invoiceservicetest -> CustomObject:account  (dml)');
    // Every pair of the key has a line: the list is not cut off.
    expect(output.split('\n').filter((line) => /^- (?:reported|by name|missing) {2,3}\S+ -> /.test(line))).toHaveLength(
      343,
    );
    // Two fields are named Status. The id says which one the row is about.
    expect(output).toContain('Pairs the Dependency API reports that the answer key does not hold: 3.');
    expect(output).toContain('- ApexClass:invoiceservice -> ApexClass:invoiceselector');
    expect(output).toContain('- ApexClass:invoiceservice -> CustomField:invoice_line__c.status__c');
    expect(output).toContain(
      'Fields the answer key calls unreferenced: 13. The Dependency API reports a reference to 1 of them: CustomField:invoice__c.unused_field__c.',
    );
    // Every query names a type of component, never a component.
    for (const soql of asked) for (const name of FOREIGN) expect(soql).not.toContain(name);
    expectNothingForeign(output);
  });

  /**
   * An org with flows: one with an active version and a newer draft, one with one version, one of nothing but a
   * draft, one that is not of the fixture project, and one of a package with the name of a flow of it.
   */
  const withFlows = (): ReturnType<typeof tables> => {
    const org = tables();
    const flowId = (n: number): string => id('300', n);
    const version = (n: number): string => id('301', n);
    org['CustomField']?.push(field(7, 'Paid_Date', INVOICE, 'Invoice__c'));
    org['FlowDefinition'] = [
      // A flow with an active version and a newer draft, one with one version, and one of nothing but a draft.
      {
        Id: flowId(1),
        DeveloperName: 'Invoice_Recalculate',
        NamespacePrefix: null,
        ActiveVersionId: version(11),
        LatestVersionId: version(12),
      },
      {
        Id: flowId(2),
        DeveloperName: 'Invoice_After_Save',
        NamespacePrefix: null,
        ActiveVersionId: version(21),
        LatestVersionId: version(21),
      },
      {
        Id: flowId(3),
        DeveloperName: 'Invoice_Purge_Void',
        NamespacePrefix: null,
        ActiveVersionId: null,
        LatestVersionId: version(31),
      },
      // Not of the fixture project, and one of a package with the name of a flow of it.
      {
        Id: flowId(9),
        DeveloperName: 'Takeover',
        NamespacePrefix: null,
        ActiveVersionId: version(91),
        LatestVersionId: version(91),
      },
      {
        Id: flowId(8),
        DeveloperName: 'Invoice_Before_Save',
        NamespacePrefix: 'hidden',
        ActiveVersionId: version(81),
        LatestVersionId: version(81),
      },
    ];
    org['Flow'] = [
      { Id: version(10), DefinitionId: flowId(1), VersionNumber: 1, Status: 'Obsolete' },
      { Id: version(11), DefinitionId: flowId(1), VersionNumber: 2, Status: 'Active' },
      { Id: version(12), DefinitionId: flowId(1), VersionNumber: 3, Status: 'Draft' },
      { Id: version(21), DefinitionId: flowId(2), VersionNumber: 1, Status: 'Active' },
      { Id: version(31), DefinitionId: flowId(3), VersionNumber: 1, Status: 'Draft' },
      { Id: version(91), DefinitionId: flowId(9), VersionNumber: 4, Status: 'Active' },
      { Id: version(81), DefinitionId: flowId(8), VersionNumber: 1, Status: 'Active' },
    ];
    org['MetadataComponentDependency'] = [
      // The name of a row from a flow is not its API name here: the id says which flow it is.
      dependency('Flow', version(11), 'Recalculate an invoice', 'CustomField', id('00N', 1), 'Amount'),
      dependency('Flow', version(12), 'Recalculate an invoice', 'CustomField', id('00N', 1), 'Amount'),
      dependency('Flow', version(12), 'Recalculate an invoice', 'CustomField', id('00N', 7), 'Paid_Date'),
      dependency('Flow', version(21), 'After an invoice is saved', 'Flow', version(11), 'Recalculate an invoice'),
      dependency('Flow', flowId(2), 'After an invoice is saved', 'CustomField', id('00N', 2), 'Status'),
      dependency('Flow', version(91), 'Takeover', 'CustomField', id('00N', 1), 'Amount'),
      dependency('Flow', id('301', 500), 'Takeover', 'CustomField', id('00N', 1), 'Amount'),
      // A template is named without its folder, and the probe reads no names of templates.
      dependency(
        'WorkflowAlert',
        id('01W', 1),
        'Invoice_Overdue_Alert',
        'EmailTemplate',
        id('00X', 1),
        'Invoice_Overdue',
      ),
      // A rule and its field update, each written with its object: that is the whole name, and no guess.
      dependency(
        'WorkflowRule',
        id('01Q', 1),
        'Invoice__c.Stamp_Code_When_Paid',
        'WorkflowFieldUpdate',
        id('04Y', 1),
        'Invoice__c.Stamp_Legacy_Code',
      ),
    ];
    return org;
  };

  it('says which versions of its flows the org holds, and what the id of a row from a flow stands for', async () => {
    const asked = tooling(withFlows());
    const { log, text } = collected();
    await probeOrg(log, { env: environment(), pollMs: 5 });
    const output = text();
    expect(log.failed).toBe(false);
    expect(asked).toContain(
      'SELECT Id, DeveloperName, NamespacePrefix, ActiveVersionId, LatestVersionId FROM FlowDefinition',
    );
    expect(asked).toContain('SELECT Id, DefinitionId, VersionNumber, Status FROM Flow');
    expect(output).toContain('ApexTrigger 1, FlowDefinition 5, Flow 7.');
    const lines = output.split('\n');
    const head = lines.indexOf('The flows of the fixture project and their versions (FlowDefinition and Flow)');
    expect(lines.slice(head, lines.indexOf('The symbol tables of the compiler (ApexClass.SymbolTable)') - 1)).toEqual([
      'The flows of the fixture project and their versions (FlowDefinition and Flow)',
      'FLOW                   VERSIONS        ACTIVE  LATEST  STATE OF THE LATEST',
      'Invoice_After_Save     1               1       1       Active',
      'Invoice_Before_Save    not in the org',
      'Invoice_Purge_Void     1               none    1       Draft',
      'Invoice_Recalculate    3               2       3       Draft',
      'Invoice_Review_Screen  not in the org',
      'Invoice_Sent_Process   not in the org',
      'Flows the org holds: 5, with 7 versions. Of the fixture project: 3 of 6.',
      'Rows of the Dependency API from a flow: 7. By the type the row writes and what its id stands for: Flow, a flow, not a version: 1; Flow, a version that is not the active one (Draft): 2; Flow, no flow and no version the org named: 1; Flow, the active version of a flow: 3.',
      'Rows to a flow: 1. By the type the row writes and what its id stands for: Flow, the active version of a flow: 1.',
      '- Rows from Invoice_After_Save: the flow itself 1, version 1 (Active) 1',
      '- Rows from Invoice_Purge_Void: none',
      '- Rows from Invoice_Recalculate: version 2 (Active) 1, version 3 (Draft) 2',
      'A draft of Invoice_Recalculate, as the tool that deploys sends it, reads Invoice__c.Paid_Date__c, which the version of the project does not. Rows from that flow to that field: 1, with the id of a version that is not the active one (Draft).',
    ]);
    // A row from a version of a flow is a pair of the flow, by its id.
    expect(output).toContain('- reported  Flow:invoice_recalculate -> CustomField:invoice__c.amount__c  (path)');
    expect(output).toContain('- reported  Flow:invoice_after_save -> Flow:invoice_recalculate  (action)');
    expect(output).toContain('- reported  Flow:invoice_after_save -> CustomField:invoice__c.status__c  (filter)');
    expect(output).toContain('- Flow:invoice_recalculate -> CustomField:invoice__c.paid_date__c\n');
    // Found by two names alone, so not counted as reported.
    expect(output).toContain(
      '- by name   WorkflowAlert:invoice__c.invoice_overdue_alert -> EmailTemplate:billing/invoice_overdue  (template)',
    );
    // Found by two whole names, each with its object.
    expect(output).toContain(
      '- reported  WorkflowRule:invoice__c.stamp_code_when_paid -> WorkflowFieldUpdate:invoice__c.stamp_legacy_code  (action)',
    );
    expect(output).toContain(
      'The rows with a component that is not of the fixture project, by type: Flow to CustomField 2',
    );
    expect(output).not.toContain('::warning::');
    expect(output).not.toContain('Recalculate an invoice');
    expectNothingForeign(output);
  });

  it('says that the flows could not be read when the org refuses the queries for them, and goes on', async () => {
    const asked = tooling(tables(), { faults: { FlowDefinition: 'INVALID_TYPE', Flow: 'INVALID_FIELD' } });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    // A query that asks for no prefix of a package is asked once.
    expect(asked.filter((soql) => soql.endsWith(' FROM Flow'))).toHaveLength(1);
    expect(output).toContain('ApexTrigger 1, FlowDefinition failed (INVALID_TYPE), Flow failed (INVALID_FIELD).');
    expect(output).toContain(
      'The org answered neither the query for its flows (FlowDefinition) nor the one for their versions (Flow). Nothing is known about the flows of the fixture project. The line about the rows read to find the names has the code.',
    );
    expect(output).toContain('Invoice_Recalculate    unknown\n');
    expect(output).not.toContain('not in the org');
    expect(output).toContain(
      'Flows the org holds: unknown, with a number of versions that is not known. Of the fixture project: unknown of 6.',
    );
    expect(output).toContain(
      'The flow Invoice_Recalculate could not be found, because the flows could not be read, so nothing is said about a draft of it.',
    );
    expect(output.split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(output);
  });

  /** The lines of the probe about flows. */
  const aboutFlows = (output: string): string[] => {
    const lines = output.split('\n');
    return lines.slice(
      lines.indexOf('The flows of the fixture project and their versions (FlowDefinition and Flow)') + 1,
      lines.indexOf('The symbol tables of the compiler (ApexClass.SymbolTable)') - 1,
    );
  };

  it('says what the versions alone tell when the org refuses the query for its flows', async () => {
    tooling(withFlows(), { faults: { FlowDefinition: 'INVALID_TYPE' } });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain('ApexTrigger 1, FlowDefinition failed (INVALID_TYPE), Flow 7.');
    // No flow has a name, so no flow of the fixture project is found. A version says by its state whether it is
    // the active one.
    expect(aboutFlows(output)).toEqual([
      'The org did not answer the query for its flows (FlowDefinition). No version can be given to a flow, so nothing is said about the flows of the fixture project. The line about the rows read to find the names has the code.',
      'FLOW                   VERSIONS  ACTIVE  LATEST  STATE OF THE LATEST',
      'Invoice_After_Save     unknown',
      'Invoice_Before_Save    unknown',
      'Invoice_Purge_Void     unknown',
      'Invoice_Recalculate    unknown',
      'Invoice_Review_Screen  unknown',
      'Invoice_Sent_Process   unknown',
      'Flows the org holds: unknown, with 7 versions. Of the fixture project: unknown of 6.',
      'Rows of the Dependency API from a flow: 7. By the type the row writes and what its id stands for: Flow, a version that is not the active one (Draft): 2; Flow, no flow and no version among those the org named, which are not all: 2; Flow, the active version of a flow: 3.',
      'Rows to a flow: 1. By the type the row writes and what its id stands for: Flow, the active version of a flow: 1.',
      'The flow Invoice_Recalculate could not be found, because the flows could not be read, so nothing is said about a draft of it.',
    ]);
    expect(output.split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(output);
  });

  it('says what the flows alone tell when the org refuses the query for their versions', async () => {
    tooling(withFlows(), { faults: { Flow: 'INVALID_FIELD' } });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(output).toContain('ApexTrigger 1, FlowDefinition 5, Flow failed (INVALID_FIELD).');
    // A flow names its active and its latest version, so a row with one of the two ids is still given to the flow.
    expect(aboutFlows(output)).toEqual([
      'The org did not answer the query for the versions of its flows (Flow). Of a flow, only the ids of its active and of its latest version are known, and neither a number nor a state. The line about the rows read to find the names has the code.',
      'FLOW                   VERSIONS        ACTIVE   LATEST   STATE OF THE LATEST',
      'Invoice_After_Save     unknown         unknown  unknown  unknown',
      'Invoice_Before_Save    not in the org',
      'Invoice_Purge_Void     unknown         none     unknown  unknown',
      'Invoice_Recalculate    unknown         unknown  unknown  unknown',
      'Invoice_Review_Screen  not in the org',
      'Invoice_Sent_Process   not in the org',
      'Flows the org holds: 5, with a number of versions that is not known. Of the fixture project: 3 of 6.',
      'Rows of the Dependency API from a flow: 7. By the type the row writes and what its id stands for: Flow, a flow, not a version: 1; Flow, no flow and no version among those the org named, which are not all: 1; Flow, the active version of a flow: 3; Flow, the latest version of a flow, which is not the active one: 2.',
      'Rows to a flow: 1. By the type the row writes and what its id stands for: Flow, the active version of a flow: 1.',
      '- Rows from Invoice_After_Save: the active version 1, the flow itself 1',
      '- Rows from Invoice_Purge_Void: none',
      '- Rows from Invoice_Recalculate: the active version 1, the latest version, which is not the active one 2',
      'A draft of Invoice_Recalculate, as the tool that deploys sends it, reads Invoice__c.Paid_Date__c, which the version of the project does not. Rows from that flow to that field: 1, with the id of the latest version of a flow, which is not the active one.',
    ]);
    // The pairs are found by the two ids a flow names, not by a name.
    expect(output).toContain('- reported  Flow:invoice_recalculate -> CustomField:invoice__c.amount__c  (path)');
    expect(output).toContain('- reported  Flow:invoice_after_save -> Flow:invoice_recalculate  (action)');
    expect(output).toContain('- Flow:invoice_recalculate -> CustomField:invoice__c.paid_date__c\n');
    expectNothingForeign(output);
  });

  describe('asking for the flow with a draft by the numbers of its versions', () => {
    // The mock org makes a definition of every flow. Here the org hands out the one a test gives it, or none.
    beforeEach(() => {
      metadata.withheld.add(`FlowDefinition:${FLOW_WITH_DRAFT}`);
    });
    /** The lines of the probe about the versions by number. */
    const aboutVersions = (output: string): string[] => {
      const lines = output.split('\n');
      const head = lines.findIndex((line) => line.startsWith('The versions of the flow '));
      return head === -1 ? [] : lines.slice(head, lines.indexOf('', head));
    };
    const NAME = `Flow:${FLOW_WITH_DRAFT}`;
    const FILE = `flows/${FLOW_WITH_DRAFT}.flow`;
    const activeFile = (): string => fixtureFiles().get(`${FILE}-meta.xml`)?.toString('utf8') ?? '';
    const draftFile = (): string => DRAFT_CHANGES.reduce((flow, [from, to]) => flow.replace(from, to), activeFile());
    const definitionFile = (active: number | null): string =>
      '<?xml version="1.0" encoding="UTF-8"?>\n<FlowDefinition xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
      (active === null ? '' : `    <activeVersionNumber>${String(active)}</activeVersionNumber>\n`) +
      '</FlowDefinition>\n';
    const size = (file: string): string => String(Buffer.byteLength(file));
    /** The org answers a name with one file. */
    const hands = (fullName: string, path: string, text: string): void => {
      metadata.handedOut.set(fullName, { path, text });
    };
    const definition = (active: number | null): void => {
      hands(
        `FlowDefinition:${FLOW_WITH_DRAFT}`,
        `flowDefinitions/${FLOW_WITH_DRAFT}.flowDefinition`,
        definitionFile(active),
      );
    };
    const HEAD = [
      'The versions of the flow Invoice_Recalculate, asked for by name and by number (retrieves of the Metadata API)',
      'The Tooling API says that the org holds 3 versions of it with a number: 1 (Obsolete), 2 (Active), 3 (Draft). The active one: 2.',
      'Each name is asked for in a retrieve of its own, with API version 66.0.',
    ];
    const DRAFT_BY_NAME = `- Flow Invoice_Recalculate: the retrieve ended as Succeeded. 1 file came back: flows/Invoice_Recalculate.flow, ${size(draftFile())} bytes, with the state Draft: the draft.`;
    const notFound = (fullName: string): string =>
      `- Flow ${fullName}: the retrieve ended as Succeeded. Salesforce remarked that it cannot find it. No file of the flow or of its definition came back.`;
    const SCOPE = ' That is what the test org did, with API version 66.0. No other org and no other version was asked.';
    const requests = (count: number): string =>
      `Requests to the Metadata API for this: ${String(count)}. A request that was sent again after no answer is counted once.`;
    const probed = async (options: { retrieveMs?: number } = {}): Promise<{ lines: string[]; output: string }> => {
      metadata.retrieves.length = 0;
      const { log, text } = collected();
      await probeOrg(log, { env: environment(), pollMs: 2, ...options });
      const output = text();
      expect(log.failed).toBe(false);
      expectNothingForeign(output);
      return { lines: aboutVersions(output), output };
    };

    it('says that the active version comes back for its number, where the org hands out a version by its number', async () => {
      tooling(withFlows());
      // The org of run 21: by the name alone it hands out the draft. Version 1 is no longer to be had.
      hands(NAME, FILE, draftFile());
      definition(2);
      hands(`${NAME}-2`, `flows/${FLOW_WITH_DRAFT}-2.flow`, activeFile());
      hands(`${NAME}-3`, FILE, draftFile());
      const { lines, output } = await probed();
      // One name per retrieve: the active version first, then from the newest down, and the control last.
      expect(metadata.retrieves).toEqual([
        ['Flow:Invoice_Recalculate'],
        ['FlowDefinition:Invoice_Recalculate'],
        ['Flow:Invoice_Recalculate-2'],
        ['Flow:Invoice_Recalculate-3'],
        ['Flow:Invoice_Recalculate-1'],
        ['Flow:Invoice_Recalculate-4'],
      ]);
      expect(lines).toEqual([
        ...HEAD,
        DRAFT_BY_NAME,
        `- FlowDefinition Invoice_Recalculate: the retrieve ended as Succeeded. 1 file came back: flowDefinitions/Invoice_Recalculate.flowDefinition, ${size(definitionFile(2))} bytes, which names version 2 as the active one.`,
        `- Flow Invoice_Recalculate-2: the retrieve ended as Succeeded. 1 file came back: flows/Invoice_Recalculate-2.flow, ${size(activeFile())} bytes, with the state Active: the version that was sent as active.`,
        `- Flow Invoice_Recalculate-3: the retrieve ended as Succeeded. 1 file came back: flows/Invoice_Recalculate.flow, ${size(draftFile())} bytes, with the state Draft: the draft.`,
        notFound('Invoice_Recalculate-1'),
        notFound('Invoice_Recalculate-4'),
        'What it comes to:',
        '- Asked for by its name, Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        '- The file of the FlowDefinition names version 2 as the active one. The Tooling API says 2, which is the same.',
        '- Asked for by the number of its active version (2), Salesforce handed out: flows/Invoice_Recalculate-2.flow, which is the version that was sent as active.',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: no file of the flow, with the remark that what was asked for cannot be found.',
        `The org hands out the active version when it is asked for by its number: by the name alone it gives the draft, by the number of the active version the version that was sent as active, and by a number it holds no version for no file.${SCOPE}`,
        requests(18),
      ]);
      // The part stands after the symbol tables and before the count of the requests to the Tooling API.
      expect(output.indexOf('Triggers asked for')).toBeGreaterThan(-1);
      expect(output.indexOf('The versions of the flow ')).toBeGreaterThan(output.indexOf('Triggers asked for'));
      expect(output.split('\n').at(-1)).toMatch(/^Requests to the Tooling API: \d+\./);
    });

    it('says that the number plays no part, where the org answers every name with the latest version', async () => {
      tooling(withFlows());
      hands(NAME, FILE, draftFile());
      definition(2);
      for (const number of [1, 2, 3, 4]) hands(`${NAME}-${String(number)}`, FILE, draftFile());
      const { lines } = await probed();
      expect(lines.slice(-6)).toEqual([
        '- Asked for by its name, Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        '- The file of the FlowDefinition names version 2 as the active one. The Tooling API says 2, which is the same.',
        '- Asked for by the number of its active version (2), Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        `The org hands out the draft also when it is asked for the number of the active version: the number plays no part.${SCOPE}`,
        requests(18),
      ]);
    });

    it('says that the active version does not come back, where the org knows no name with a number', async () => {
      tooling(withFlows());
      hands(NAME, FILE, draftFile());
      // Salesforce writes 0 for a flow without an active version. That is no number of a version.
      definition(0);
      const { lines } = await probed();
      expect(metadata.retrieves.slice(2)).toEqual([
        ['Flow:Invoice_Recalculate-2'],
        ['Flow:Invoice_Recalculate-3'],
        ['Flow:Invoice_Recalculate-1'],
        ['Flow:Invoice_Recalculate-4'],
      ]);
      expect(lines[4]).toBe(
        `- FlowDefinition Invoice_Recalculate: the retrieve ended as Succeeded. 1 file came back: flowDefinitions/Invoice_Recalculate.flowDefinition, ${size(definitionFile(0))} bytes, which names no active version.`,
      );
      expect(lines.slice(5, 9)).toEqual(
        [2, 3, 1, 4].map((number) => notFound(`Invoice_Recalculate-${String(number)}`)),
      );
      expect(lines.slice(-6)).toEqual([
        '- Asked for by its name, Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        '- The file of the FlowDefinition names no active version. The Tooling API says 2.',
        '- Asked for by the number of its active version (2), Salesforce handed out: no file of the flow, with the remark that what was asked for cannot be found.',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: no file of the flow, with the remark that what was asked for cannot be found.',
        `The org does not hand out the active version when it is asked for by its number: no file came back.${SCOPE}`,
        requests(18),
      ]);
    });

    it('says that it cannot tell, where the org hands out the active version for the name alone', async () => {
      tooling(withFlows());
      // The mock org with the file of the project for the name, and without a definition. It answers one number
      // with a file of another name, one with a file whose state is no word of the Metadata API, and the
      // number of the active version with the file of the project.
      hands(`${NAME}-2`, FILE, activeFile());
      hands(`${NAME}-3`, 'flows/Takeover.flow', draftFile());
      hands(`${NAME}-1`, FILE, draftFile().replace('<status>Draft</status>', '<status>Takeover</status>'));
      const { lines } = await probed();
      expect(lines.slice(3)).toEqual([
        `- Flow Invoice_Recalculate: the retrieve ended as Succeeded. 1 file came back: flows/Invoice_Recalculate.flow, ${size(activeFile())} bytes, with the state Active: the version that was sent as active.`,
        '- FlowDefinition Invoice_Recalculate: the retrieve ended as Succeeded. Salesforce remarked that it cannot find it. No file of the flow or of its definition came back.',
        `- Flow Invoice_Recalculate-2: the retrieve ended as Succeeded. 1 file came back: flows/Invoice_Recalculate.flow, ${size(activeFile())} bytes, with the state Active: the version that was sent as active.`,
        '- Flow Invoice_Recalculate-3: the retrieve ended as Succeeded. No file of the flow or of its definition came back. 1 file with another name came back.',
        expect.stringMatching(
          /^- Flow Invoice_Recalculate-1: the retrieve ended as Succeeded\. 1 file came back: flows\/Invoice_Recalculate\.flow, \d+ bytes, with a state that is not shown: neither of the two: of the 3 places the draft differs in, it has 2 as the draft has them and 0 as the version that was sent as active\.$/,
        ),
        notFound('Invoice_Recalculate-4'),
        'What it comes to:',
        '- Asked for by its name, Salesforce handed out: flows/Invoice_Recalculate.flow, which is the version that was sent as active.',
        '- The file of the FlowDefinition did not come back. The Tooling API says 2.',
        '- Asked for by the number of its active version (2), Salesforce handed out: flows/Invoice_Recalculate.flow, which is the version that was sent as active.',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: no file of the flow, with the remark that what was asked for cannot be found.',
        'This run cannot say whether the active version can be asked for by its number: asked for by its name alone, the org did not hand out the draft, so a version that is asked for by its number cannot be told from the latest one.',
        requests(18),
      ]);
    });

    it('goes by the number of the Tooling API where the definition names another, and says what both gave', async () => {
      tooling(withFlows());
      hands(NAME, FILE, draftFile());
      definition(1);
      hands(`${NAME}-2`, `flows/${FLOW_WITH_DRAFT}-2.flow`, activeFile());
      // A file for the control: the number is not shown to be what decides.
      hands(`${NAME}-4`, FILE, draftFile());
      const { lines } = await probed();
      expect(metadata.retrieves.slice(2)).toEqual([
        ['Flow:Invoice_Recalculate-2'],
        ['Flow:Invoice_Recalculate-1'],
        ['Flow:Invoice_Recalculate-3'],
        ['Flow:Invoice_Recalculate-4'],
      ]);
      expect(lines.slice(-7)).toEqual([
        '- Asked for by its name, Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        '- The file of the FlowDefinition names version 1 as the active one. The Tooling API says 2, which is another number.',
        '- Asked for by the number of its active version (2), Salesforce handed out: flows/Invoice_Recalculate-2.flow, which is the version that was sent as active.',
        '- Asked for by the number the definition names (1), Salesforce handed out: no file of the flow, with the remark that what was asked for cannot be found.',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: flows/Invoice_Recalculate.flow, which is the draft.',
        'By the number of the active version the org handed out the version that was sent as active, and the answer for a number it holds no version for does not confirm that the number is what decides. The lines above say what came back.',
        requests(18),
      ]);
    });

    it('asks for five numbers at most, the active and the newest first, and names the ones it left out', async () => {
      const org = withFlows();
      const flow = id('300', 1);
      const version = (n: number): string => id('301', 100 + n);
      org['Flow'] = [
        ...(org['Flow'] ?? []).filter((row) => row['DefinitionId'] !== flow),
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          Id: version(n),
          DefinitionId: flow,
          VersionNumber: n,
          Status: n === 7 ? 'Active' : n === 8 ? 'Draft' : 'Obsolete',
        })),
        // A version without a number is counted and not asked for.
        { Id: version(9), DefinitionId: flow, VersionNumber: null, Status: 'Takeover' },
      ];
      org['FlowDefinition'] = (org['FlowDefinition'] ?? []).map((row) =>
        row['Id'] === flow ? { ...row, ActiveVersionId: version(7), LatestVersionId: version(8) } : row,
      );
      tooling(org);
      hands(NAME, FILE, draftFile());
      const { lines } = await probed();
      expect(lines[1]).toBe(
        'The Tooling API says that the org holds 8 versions of it with a number: 1 (Obsolete), 2 (Obsolete), 3 (Obsolete), 4 (Obsolete), 5 (Obsolete), 6 (Obsolete), 7 (Active), 8 (Draft). 1 more has no number that can be asked for. The active one: 7.',
      );
      expect(metadata.retrieves.slice(2)).toEqual([
        ['Flow:Invoice_Recalculate-7'],
        ['Flow:Invoice_Recalculate-8'],
        ['Flow:Invoice_Recalculate-6'],
        ['Flow:Invoice_Recalculate-5'],
        ['Flow:Invoice_Recalculate-4'],
        ['Flow:Invoice_Recalculate-9'],
      ]);
      expect(lines).toContain('Not asked for by their number, because at most 5 are: 3 versions, 3, 2, 1.');
      expect(lines.at(-1)).toBe(requests(24));
    });

    it('says that nothing is known of a retrieve that was refused, failed or did not end, and starts no other', async () => {
      tooling(withFlows());
      const tables = mock.intercept;
      let started = 0;
      mock.intercept = (request) => {
        if (!request.body.includes('<retrieve>')) return tables?.(request);
        started += 1;
        // The first retrieve is refused. The others are started.
        return started === 1 ? soapFault('INSUFFICIENT_ACCESS', `no access for ${USERNAME}`) : undefined;
      };
      // The second retrieve never ends.
      metadata.hold = true;
      const first = await probed({ retrieveMs: 10 });
      expect(metadata.retrieves).toEqual([['FlowDefinition:Invoice_Recalculate']]);
      expect(first.lines.slice(3, -1)).toEqual([
        '- Flow Invoice_Recalculate: the retrieve was refused or not answered (INSUFFICIENT_ACCESS).',
        '- FlowDefinition Invoice_Recalculate: the retrieve did not end in time.',
        '- Flow Invoice_Recalculate-2: not asked for, because a retrieve before it did not end in time.',
        '- Flow Invoice_Recalculate-3: not asked for, because a retrieve before it did not end in time.',
        '- Flow Invoice_Recalculate-1: not asked for, because a retrieve before it did not end in time.',
        '- Flow Invoice_Recalculate-4: not asked for, because a retrieve before it did not end in time.',
        'What it comes to:',
        '- Asked for by its name, Salesforce handed out: nothing is known, because the retrieve was refused or not answered (INSUFFICIENT_ACCESS).',
        '- The file of the FlowDefinition: nothing is known, because the retrieve did not end in time. The Tooling API says 2.',
        '- Asked for by the number of its active version (2), Salesforce handed out: nothing is known, because it was not asked for.',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: nothing is known, because it was not asked for.',
        'This run cannot say whether the active version can be asked for by its number: asked for by its name alone, the org did not hand out the draft, so a version that is asked for by its number cannot be told from the latest one.',
      ]);
      expect(first.output.split('\n').at(-1)).toMatch(/^Requests to the Tooling API: \d+\./);

      // The retrieve for the number of the active version is refused: the name alone gave the draft, and still
      // nothing is said about the number.
      mock.intercept = (request) =>
        request.body.includes('<retrieve>') && request.body.includes(`${FLOW_WITH_DRAFT}-2<`)
          ? soapFault('INSUFFICIENT_ACCESS', `no access for ${USERNAME}`)
          : tables?.(request);
      metadata.hold = false;
      hands(NAME, FILE, draftFile());
      const second = await probed();
      expect(second.lines).toContain(
        '- Flow Invoice_Recalculate-2: the retrieve was refused or not answered (INSUFFICIENT_ACCESS).',
      );
      expect(second.lines.slice(-4, -1)).toEqual([
        '- Asked for by the number of its active version (2), Salesforce handed out: nothing is known, because the retrieve was refused or not answered (INSUFFICIENT_ACCESS).',
        '- Asked for by a number the org holds no version for (4), Salesforce handed out: no file of the flow, with the remark that what was asked for cannot be found.',
        'This run does not say whether the active version can be asked for by its number: it was not asked for that way, or the retrieve gave no answer.',
      ]);

      // A retrieve that Salesforce ends as failed: the mock org refuses one that holds a file.
      mock.intercept = tables;
      metadata.handedOut.clear();
      metadata.maxFiles = 0;
      const third = await probed();
      expect(third.lines[3]).toBe('- Flow Invoice_Recalculate: the retrieve ended as Failed (LIMIT_EXCEEDED).');
      expect(third.lines).toContain(
        '- Asked for by its name, Salesforce handed out: nothing is known, because the retrieve ended as Failed (LIMIT_EXCEEDED).',
      );
    });

    it('does not ask where the org did not say which versions of the flow it holds', async () => {
      tooling(withFlows(), { faults: { Flow: 'INVALID_FIELD' } });
      const { lines, output } = await probed();
      expect(metadata.retrieves).toEqual([]);
      expect(lines).toEqual([]);
      expect(output).toContain(
        'The flow Invoice_Recalculate was not asked for by the numbers of its versions: the org did not say that it holds the flow, or which versions of it.',
      );
    });
  });

  it('says what the symbol tables of the compiler hold for the classes of the fixture project', async () => {
    const asked = tooling(tables(), { faults: { 'ApexTrigger.SymbolTable': 'INVALID_FIELD' }, pageSize: 2 });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    // Only classes with a name of the fixture project are asked for. One of them is of a package.
    expect(asked.filter((soql) => soql.includes('SymbolTable FROM ApexClass'))).toEqual([
      expect.stringMatching(/ FROM ApexClass WHERE Name IN \('[A-Za-z]+'(, '[A-Za-z]+'){12}\)$/),
    ]);
    expect(output).toMatch(
      /Classes with a name of the fixture project: 3 in 2 pages, after \d+\.\d s\. With a symbol table: 1\./,
    );
    expect(output).toContain('Classes of the fixture project: 13. Found: 2. With a symbol table: 1.');
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
    expect(output).toContain('Classes of the fixture project: 13. Found: 2. With a symbol table: 1.');
    expectNothingForeign(output);
  });

  it('says when rows are still missing after the engine asked per type and per pair of types', async () => {
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
    // The pair of types that is at the limit cannot be asked for per component here: this tool takes no
    // snapshot, so it has no ids the org listed. What is behind the limit elsewhere is found: beside the 2,000
    // rows of the pair, the 30 rows to the other type of target and 7 of the 12 rows of the small org. The
    // other 5 are of the pair that is cut off.
    expect(output).toContain(
      'Different rows in all: 2037. 1 query was cut off at the limit or failed, so rows are missing.',
    );
    expect(output).toContain(
      'The answer key holds 343 pairs of a component and a component it refers to. The Dependency API reports 4 of them.',
    );
    // The step does not fail for it, and says at its end that the answer is not whole.
    expect(output.split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(output);
  });

  it('counts a query that failed where its rows can be missing', async () => {
    // The first query is at the limit, and the org refuses every query for the rows of the classes: the one for
    // all of them, and the ones for their parts, which the reader asks for then. With no part answered, what is
    // left is the query for all of them, and that one is counted.
    const org = tables();
    org['MetadataComponentDependency'] = [
      ...many(1990, 'Flow', 'CustomField', id('00N', 9), 'Takeover_Date'),
      ...(org['MetadataComponentDependency'] ?? []),
    ];
    tooling(org, {
      fault: (soql) => (soql.includes("MetadataComponentType = 'ApexClass'") ? 'UNKNOWN_EXCEPTION' : undefined),
    });
    const first = collected();
    await probeOrg(first.log, { env: environment() });
    expect(first.log.failed).toBe(false);
    expect(first.text()).toContain(
      '1 query was cut off at the limit or failed (UNKNOWN_EXCEPTION), so rows are missing.',
    );
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
    expect(second.text()).toContain(
      '1 query was cut off at the limit or failed (UNKNOWN_EXCEPTION), so rows are missing.',
    );
    expectNothingForeign(second.text());

    // The classes are at the limit, and no row says of which type a target is.
    org['MetadataComponentDependency'] = many(2100, 'ApexClass', null, id('00N', 9), 'Takeover_Date');
    tooling(org);
    const third = collected();
    await probeOrg(third.log, { env: environment() });
    expect(third.text()).toContain(
      'Different rows in all: 2000. 1 query was cut off at the limit or failed, so rows are missing.',
    );
    expectNothingForeign(third.text());
  });

  it('asks the Dependency API once when the first query gave every row, and tells a field of a package apart', async () => {
    const org = tables();
    // A field of a package with the name of a field of the fixture project.
    org['CustomField']?.push(field(7, 'Amount', INVOICE, 'Invoice__c', 'hidden'));
    org['MetadataComponentDependency']?.push(
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'CustomField', id('00N', 7), 'Amount'),
    );
    const asked = tooling(org, {
      // A query for one type would not be answered to its end. It is never asked: the first query gave every row.
      notDone: (soql) => soql.endsWith("WHERE MetadataComponentType = 'Flow'"),
      // One object has no field for the prefix of a package.
      fault: (soql) => (/NamespacePrefix.* FROM ValidationRule/.test(soql) ? 'INVALID_FIELD' : undefined),
    });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(asked.filter((soql) => soql.includes('FROM MetadataComponentDependency'))).toHaveLength(1);
    expect(output).toContain(
      'Different rows in all: 13. No query was cut off or failed in a way that leaves a row out.',
    );
    expect(output).toContain(
      'Rows read to find the names behind the ids: CustomObject 3, CustomField 8, ValidationRule 1 without NamespacePrefix (INVALID_FIELD), ApexClass 4, ApexTrigger 1, FlowDefinition 0, Flow 0.',
    );
    // The field of the package is not the field of the fixture project.
    expect(output).toContain(
      'Rows between two components of the fixture project: 8, which are 8 pairs. Rows with a component that is not of it: 5.',
    );
    expect(output).not.toContain('::warning::');
    expectNothingForeign(output);
  });

  const RULE_TYPE = id('01I', 3);
  const SECRET_TYPE = id('01I', 8);
  const RULE = id('03d', 2);
  const RECORD = id('m00', 1);

  /**
   * The small org with the custom metadata type of the fixture project, the rule that names a record of it, and
   * a type beside it. A row about a record has the name of the custom metadata type as its type, as the test
   * org gave it on 15 November 2026. That its name is the record alone is an assumption: the log shows no name.
   */
  const withCustomMetadata = (): Record<string, Row[]> => {
    const org = tables();
    org['CustomObject']?.push(
      { Id: RULE_TYPE, DeveloperName: 'Billing_Rule', NamespacePrefix: null },
      { Id: SECRET_TYPE, DeveloperName: 'Secret_Rule', NamespacePrefix: null },
    );
    org['CustomField']?.push(
      field(10, 'Max_Amount', RULE_TYPE, 'Billing_Rule__mdt'),
      field(11, 'Takeover_Limit', SECRET_TYPE, 'Secret_Rule__mdt'),
    );
    org['ValidationRule']?.push({
      Id: RULE,
      ValidationName: 'Large_Amount_Needs_Permission',
      NamespacePrefix: null,
      EntityDefinitionId: INVOICE.slice(0, 15),
      EntityDefinition: object('Invoice__c'),
    });
    org['MetadataComponentDependency']?.push(
      // In the answer key: the field of the type and the record.
      dependency('ValidationRule', RULE, 'Large_Amount_Needs_Permission', 'CustomField', id('00N', 10), 'Max_Amount'),
      dependency('ValidationRule', RULE, 'Large_Amount_Needs_Permission', 'Billing_Rule__mdt', RECORD, 'Default'),
      // Not in the answer key: the type itself, from the rule and from the record.
      dependency('ValidationRule', RULE, 'Large_Amount_Needs_Permission', 'CustomObject', RULE_TYPE, 'Billing_Rule'),
      dependency('Billing_Rule__mdt', RECORD, 'Default', 'CustomObject', RULE_TYPE, 'Billing_Rule'),
      // From a class of the fixture project to a record it does not hold, of its type and of a type beside it,
      // and to a record of its name whose type has a prefix of a package or another type before the dot.
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'BILLING_RULE__MDT', id('m00', 2), 'Takeover'),
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'Secret_Rule__mdt', id('m01', 1), 'Default'),
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'hidden__Billing_Rule__mdt', id('m02', 1), 'Default'),
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'Billing_Rule__mdt', id('m00', 3), 'Secret_Rule.Default'),
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'Secret Rule', id('m03', 1), 'Default'),
      dependency('ApexClass', id('01p', 9), 'SecretPlan', 'CustomField', id('00N', 11), 'Takeover_Limit'),
    );
    return org;
  };

  it('names a custom metadata type as the org does, and finds a record of it by the type and its name', async () => {
    const asked = tooling(withCustomMetadata());
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    expect(asked).toContain(
      'SELECT Id, DeveloperName, NamespacePrefix, TableEnumOrId, EntityDefinition.QualifiedApiName FROM CustomField',
    );
    expect(asked).toContain(
      'SELECT Id, ValidationName, NamespacePrefix, EntityDefinitionId, EntityDefinition.QualifiedApiName FROM ValidationRule',
    );
    expect(output).toContain(
      'Rows read to find the names behind the ids: CustomObject 5, CustomField 9, ValidationRule 2, ApexClass 4, ApexTrigger 1, FlowDefinition 0, Flow 0.',
    );
    expect(output).toContain('Custom objects: 5. A field or a rule of the object gave the name of 5.\n');
    expect(output).toContain(
      '- reported  ValidationRule:invoice__c.large_amount_needs_permission -> CustomField:billing_rule__mdt.max_amount__c  (formula)',
    );
    expect(output).toContain(
      '- reported  ValidationRule:invoice__c.large_amount_needs_permission -> CustomMetadata:billing_rule.default  (formula)',
    );
    expect(output).toMatch(/^ValidationRule +CustomMetadata +1 +1$/m);
    expect(output).toContain(
      '- reported  ValidationRule:invoice__c.locked_when_paid -> CustomField:invoice__c.status__c',
    );
    // A record refers to its type, and the key holds that.
    expect(output).toContain(
      '- reported  CustomMetadata:billing_rule.default -> CustomObject:billing_rule__mdt  (record-of)',
    );
    // The type itself, which the key does not hold as a target of the rule.
    expect(output).toContain('Pairs the Dependency API reports that the answer key does not hold: 4.');
    expect(output).toContain(
      '- ValidationRule:invoice__c.large_amount_needs_permission -> CustomObject:billing_rule__mdt\n',
    );
    // A record that is not of the fixture project is counted, under the type where that is one of the project.
    expect(output).toContain(
      'The rows with a component that is not of the fixture project, by type: ApexClass to (a type that is not shown, and ends in __mdt) 2, ApexClass to (a type that is not shown) 1, ApexClass to billing_rule__mdt (a custom metadata type of the fixture project) 2, ApexClass to CustomField 3, ApexClass to CustomObject 1, Flow to CustomField 1',
    );
    expect(output).not.toContain('CustomMetadata:billing_rule.takeover');
    expect(output).not.toContain('::warning::');
    expect(output).not.toMatch(/secret_rule/i);
    expect(output).not.toContain('BILLING_RULE');
    expectNothingForeign(output);
  });

  it('finds a record whose name holds its type, in the two ways the API may write it', async () => {
    const org = withCustomMetadata();
    org['MetadataComponentDependency'] = [
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'Billing_Rule__mdt', RECORD, 'Billing_Rule.Default'),
      dependency('ApexClass', id('01p', 2), 'InvoiceSelector', 'CustomMetadata', RECORD, 'Billing_Rule.Default'),
      // Not a record of the fixture project, and a name that is the record alone under the type of all records.
      dependency('ApexClass', id('01p', 1), 'InvoiceService', 'CustomMetadata', id('m00', 2), 'Billing_Rule.Takeover'),
      dependency('ApexTrigger', id('01q', 1), 'InvoiceTrigger', 'CustomMetadata', RECORD, 'Default'),
    ];
    tooling(org);
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(output).toContain('Pairs the Dependency API reports that the answer key does not hold: 3.');
    expect(output).toContain('- ApexClass:invoiceservice -> CustomMetadata:billing_rule.default\n');
    expect(output).toContain('- ApexClass:invoiceselector -> CustomMetadata:billing_rule.default\n');
    // One record of the project has that name, so the pair is found, and marked as found by a name.
    expect(output).toContain('- ApexTrigger:invoicetrigger -> CustomMetadata:billing_rule.default  (by name)');
    expect(output).toContain(
      'The rows with a component that is not of the fixture project, by type: ApexClass to CustomMetadata 1',
    );
    expectNothingForeign(output);
  });

  it('says that the answer is not whole when the org refuses the name of the object of a field', async () => {
    const asked = tooling(withCustomMetadata(), {
      fault: (soql) =>
        soql.includes('EntityDefinition.QualifiedApiName FROM CustomField') ? 'INVALID_FIELD' : undefined,
    });
    const { log, text } = collected();
    await probeOrg(log, { env: environment() });
    const output = text();
    expect(log.failed).toBe(false);
    // First without the prefix of a package, then without the name of the object.
    expect(asked.filter((soql) => soql.endsWith('FROM CustomField'))).toEqual([
      'SELECT Id, DeveloperName, NamespacePrefix, TableEnumOrId, EntityDefinition.QualifiedApiName FROM CustomField',
      'SELECT Id, DeveloperName, TableEnumOrId, EntityDefinition.QualifiedApiName FROM CustomField',
      'SELECT Id, DeveloperName, NamespacePrefix, TableEnumOrId FROM CustomField',
    ]);
    expect(output).toContain(
      'CustomField 9 without the name of the object (INVALID_FIELD), ValidationRule 2, ApexClass 4, ApexTrigger 1, FlowDefinition 0, Flow 0.',
    );
    // The rules name the one object they sit on.
    expect(output).toContain(
      'Custom objects: 5. A field or a rule of the object gave the name of 1. The names of the other 4 are built with the ending __c, which is a guess: a custom metadata type ends in __mdt. A pair that rests on such a name is marked "by name".\n',
    );
    // The field of the custom metadata type is then a field of an object the fixture project does not hold.
    expect(output).toContain(
      '- missing   ValidationRule:invoice__c.large_amount_needs_permission -> CustomField:billing_rule__mdt.max_amount__c  (formula)',
    );
    expect(output).toContain(
      '- reported  ValidationRule:invoice__c.locked_when_paid -> CustomField:invoice__c.status__c',
    );
    // A field of an object whose name is built is found, and not counted as reported.
    expect(output).toContain('- ApexClass:invoiceservice -> CustomField:invoice_line__c.status__c  (by name)');
    expect(output.split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(output);
  });

  it('reads without what the org refuses, and stops at a failure that is not about a field', async () => {
    // The rules cannot be asked for with the name of their object. The fields still name the objects.
    const rules = tooling(withCustomMetadata(), {
      fault: (soql) =>
        soql.includes('EntityDefinition.QualifiedApiName FROM ValidationRule') ? 'INVALID_FIELD' : undefined,
    });
    const first = collected();
    await probeOrg(first.log, { env: environment() });
    expect(rules.filter((soql) => soql.endsWith('FROM ValidationRule'))).toHaveLength(3);
    expect(first.text()).toContain('ValidationRule 2 without the name of the object (INVALID_FIELD), ApexClass 4');
    expect(first.text()).toContain('Custom objects: 5. A field or a rule of the object gave the name of 5.\n');
    expect(first.text()).toContain(
      '- reported  ValidationRule:invoice__c.large_amount_needs_permission -> CustomField:billing_rule__mdt.max_amount__c  (formula)',
    );
    expect(first.text().split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(first.text());

    // The fields can be asked for with neither of the two.
    const fields = tooling(withCustomMetadata(), {
      fault: (soql) =>
        /(NamespacePrefix|EntityDefinition\.).* FROM CustomField$/.test(soql) ? 'MALFORMED_QUERY' : undefined,
    });
    const second = collected();
    await probeOrg(second.log, { env: environment() });
    expect(fields.filter((soql) => soql.endsWith('FROM CustomField'))).toHaveLength(4);
    expect(second.text()).toContain(
      'CustomField 9 without NamespacePrefix and the name of the object (MALFORMED_QUERY), ValidationRule 2',
    );
    expectNothingForeign(second.text());

    // A failure that asking for less does not answer: one request, and the rows are missing.
    const down = tooling(withCustomMetadata(), {
      fault: (soql) => (soql.endsWith('FROM CustomField') ? 'REQUEST_TIMEOUT' : undefined),
    });
    const third = collected();
    await probeOrg(third.log, { env: environment() });
    expect(down.filter((soql) => soql.endsWith('FROM CustomField'))).toHaveLength(1);
    expect(third.text()).toContain('CustomField failed (REQUEST_TIMEOUT), ValidationRule 2');
    expect(third.text().split('\n').at(-1)).toMatch(/^::warning::What the Dependency API gave is not whole: /);
    expectNothingForeign(third.text());
  });

  it('keeps the name it builds for an object when the name the org gives does not fit', async () => {
    const run = async (name: string, also?: string): Promise<string> => {
      const org = withCustomMetadata();
      for (const row of org['CustomField'] ?? []) {
        if (row['DeveloperName'] === 'Max_Amount') row['EntityDefinition'] = object(name);
      }
      if (also !== undefined) org['CustomField']?.push(field(12, 'Min_Amount', RULE_TYPE, also));
      tooling(org);
      const { log, text } = collected();
      await probeOrg(log, { env: environment() });
      expectNothingForeign(text());
      return text();
    };
    const pair =
      'ValidationRule:invoice__c.large_amount_needs_permission -> CustomField:billing_rule__mdt.max_amount__c  (formula)';
    const unfit =
      'Custom objects: 5. A field or a rule of the object gave the name of 4. The name of the other one is built with the ending __c, which is a guess: a custom metadata type ends in __mdt. A pair that rests on such a name is marked "by name". For 1 of them the org gave a name that does not fit the object, or more than one name.\n';

    // The name of another object, a name that goes on after the developer name, one with two endings, one
    // without the two underscores, and two fields that name the object differently.
    for (const name of ['Invoice__c', 'Billing_RuleX__mdt', 'Billing_Rule__mdt__x', 'Billing_Rule_mdt']) {
      const output = await run(name);
      expect(output).toContain(unfit);
      expect(output).toContain(`- missing   ${pair}`);
      // The type is then named with the ending of a custom object, which the fixture project does not hold. So
      // no row is about the type: the key names it, as what a record is of, and Salesforce is not seen to.
      expect(output).toContain(
        '- missing   CustomMetadata:billing_rule.default -> CustomObject:billing_rule__mdt  (record-of)',
      );
      expect(output).not.toMatch(/^- (?!missing ).*CustomObject:billing_rule__mdt/m);
    }
    const differing = await run('Billing_Rule__mdt', 'Billing_Rule__c');
    expect(differing).toContain(unfit);
    expect(differing).toContain(`- missing   ${pair}`);
    // The same name twice is one name, in whatever case.
    const twice = await run('Billing_Rule__mdt', 'Billing_Rule__mdt');
    expect(twice).toContain('Custom objects: 5. A field or a rule of the object gave the name of 5.\n');
    expect(twice).toContain(`- reported  ${pair}`);
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
      'The Dependency API reports 2 of them. 2 more are matched by a name alone: the name of a component of a type this step reads no ids for, such as an email template, a part of the workflow rules of an object, a record type or a field set, or the name of a field or of a rule whose object the org did not give, or of a custom object whose ending it did not give. They are marked "by name" and not counted as reported.',
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
    // Six types are asked for by name, each with a pair of types at the limit. The seventh is seen in the
    // answer for every other type, which is at the limit as well, and is not asked for any more.
    expect(output).toContain(
      'Different rows in all: 14000. 7 queries were cut off at the limit or failed, so rows are missing.',
    );
    expect(asked.some((soql) => soql.includes("MetadataComponentType = 'Kind6'"))).toBe(true);
    expect(asked.some((soql) => soql.includes("MetadataComponentType = 'Kind7'"))).toBe(false);
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
    expect(output).toContain('No query of the Dependency API was answered (INVALID_TYPE).');
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
    ...args: string[]
  ): Promise<{ stdout: string; stderr: string; code: number | null }> =>
    new Promise((resolve) => {
      const script = fileURLToPath(new URL(`./live/${tool}`, import.meta.url));
      const child = spawn(process.execPath, ['--no-warnings', script, ...args], { env });
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

  it('deploys the draft of one flow when it is started with "draft", and nothing with another argument', async () => {
    const home = dirs.next();
    const env = { ...environment(), HOME: home, USERPROFILE: home };
    const draft = await run('deploy-fixture.ts', env, 'draft');
    expect(draft.stderr).toBe('');
    expect(draft.stdout).toContain('The deploy of a draft of the flow Invoice_Recalculate ended as Succeeded');
    expect(draft.stdout).not.toContain('The fixture project is in the test org.');
    expect(draft.code).toBe(0);
    expect(metadata.deploys.map((deploy) => deploy.files)).toEqual([['flows/Invoice_Recalculate.flow', 'package.xml']]);
    expectNoSecret(draft.stdout);

    const said = '::error::The tool that deploys takes no argument, or the one argument "draft". Nothing was sent.\n';
    expect(await run('deploy-fixture.ts', env, 'drafts')).toEqual({ code: 1, stderr: '', stdout: said });
    expect(await run('deploy-fixture.ts', env, 'draft', 'draft')).toEqual({ code: 1, stderr: '', stdout: said });
    expect(metadata.deploys).toHaveLength(1);
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
    expect(probed.stdout).toContain('The reader of the engine sent 1 request.\n');
    expect(probed.stdout).toContain(
      'Different rows in all: 0. No query was cut off or failed in a way that leaves a row out.\n',
    );
    expect(probed.stdout).toContain(
      'The answer key holds 343 pairs of a component and a component it refers to. The Dependency API reports 0 of them.\n',
    );
    expect(probed.stdout).toContain('Classes of the fixture project: 13. Found: 0. With a symbol table: 0.\n');
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
