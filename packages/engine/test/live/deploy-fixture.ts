/**
 * A step of the live-org workflow: deploys the fixture project to the test
 * org, and says how that went.
 *
 * The fixture project is the only thing that is ever deployed, and the test
 * org is an org that holds nothing else (`docs/live-org-setup.md`). OrgLens
 * itself never changes an org: this is a tool of the tests, not a part of
 * the engine or of the CLI.
 *
 * The project is deployed without running tests. Salesforce compiles the
 * Apex and checks the formulas, which is what the fixture has not been
 * through yet.
 *
 * One file is not sent as the project holds it. The outbound message of the
 * project names a user that does not exist, because no user name of an org
 * may stand in the repository: it is sent with the user this step logs in
 * as.
 *
 * With the argument `draft` the tool sends something else, and not the
 * project: one flow of it, as a draft that differs from the version the
 * project holds, which is active. It is a step of its own, so that the org
 * can be read before and after it. After it the org should hold a flow with
 * an active version and a newer draft. What the documentation says, and what
 * is not verified, is in `docs/live-org-setup.md`.
 *
 *   node --no-warnings packages/engine/test/live/deploy-fixture.ts
 *   node --no-warnings packages/engine/test/live/deploy-fixture.ts draft
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { loadSourceLibrary } from '../../src/sources/library.ts';
import { connectToOrg } from '../../src/sources/org.ts';
import { networkCode } from '../../src/sources/org-errors.ts';
import { asStep } from './own-output.ts';
import { everydayWords, type PublicLog } from './public-log.ts';
import {
  failureLines,
  FIXTURE_DIR,
  FIXTURE_PROJECT,
  fixtureComponents,
  fixtureFiles,
  loginEnvironment,
  SOURCE,
} from './test-org.ts';

/** How long a deploy may take, and how often its state is asked for. */
const DEPLOY_MS = 20 * 60_000;
const POLL_MS = 3_000;
/** How often in a row the state of a deploy is asked for in vain before the step gives up. */
const STATE_TRIES = 5;

/**
 * The user name the outbound message of the project is written with. No user has it: the ending `.invalid` is
 * reserved for names that are not real. The file of the zip that holds it gets the user of the login instead.
 */
export const MADE_UP_USER = 'integration.user@billing-fixture.invalid';
const FILE_WITH_USER = 'workflows/Invoice__c.workflow';

/**
 * The flow that gets a draft, and what the draft says differently, each as what the active version says once
 * and what the draft says there. The draft reads a field that the active version only names in a text, so a row
 * of the Dependency API from the flow to that field can only come from the draft.
 */
export const FLOW_WITH_DRAFT = 'Invoice_Recalculate';
/** The field the draft reads and the active version does not. The answer key has no reference from the flow to it. */
export const DRAFT_ONLY_FIELD = 'Invoice__c.Paid_Date__c';
const DRAFT_FILE = `flows/${FLOW_WITH_DRAFT}.flow`;
export const DRAFT_CHANGES: readonly (readonly [string, string])[] = [
  ['<status>Active</status>', '<status>Draft</status>'],
  ['<description>Adds up', '<description>A draft that is newer than the active version. Adds up'],
  [
    '<leftValueReference>invoice.Due_Date__c</leftValueReference>',
    '<leftValueReference>invoice.Paid_Date__c</leftValueReference>',
  ],
];

/** The states of a deploy, as the Metadata API names them. */
const STATES: ReadonlySet<string> = new Set([
  'Pending',
  'InProgress',
  'Succeeded',
  'SucceededPartial',
  'Failed',
  'Canceling',
  'Canceled',
]);

/** A name in Apex or in a formula, with dots: `Invoice__c.Amount__c`. A global variable of a formula begins with `$`. */
const NAME = String.raw`\$?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*`;
/** A type in Apex: a name, with generics and arrays. A space stands only after a comma, so prose has not this form. */
const TYPE = String.raw`[A-Za-z_][A-Za-z0-9_.]*(?:(?:<|>|, ?|\[\])[A-Za-z0-9_.]*)*`;
/** A type, or a method with its return type and its parameters: `void post(List<Invoice__c>)`. */
const SIGNATURE = `(?:${TYPE} )?${TYPE}(?:\\((?:${TYPE})?\\))?`;
/** A token of Apex or of a formula, as the compiler quotes it. */
const TOKEN = String.raw`[A-Za-z0-9_.;:,(){}\[\]<>=!+*/&|?@-]{1,24}`;

/** A quote that may stand before or after a name. It is part of the form and not of the name. */
const QUOTE = String.raw`['"\u2018\u2019\u201C\u201D]?`;

const form = (text: string): RegExp =>
  new RegExp(
    `^${text.replace(/NAME/g, `(${NAME})`).replace(/SIG/g, `(${SIGNATURE})`).replace(/TOKEN/g, `(${TOKEN})`)}$`,
  );

/**
 * The problems Salesforce is known to report for Apex and for fields, and
 * one it may report for a flow, each as a form the whole text has to have. What stands at a name, a signature
 * or a token is printed if it has that form and nothing else. A problem of
 * another form is "not shown", but for its everyday words: the list is
 * written from memory and from the documentation, and grows with what the
 * test org shows on its page "Deployment Status".
 */
const KNOWN_PROBLEMS: readonly RegExp[] = [
  form('Variable does not exist: NAME'),
  form('Invalid type: SIG'),
  form('Method does not exist or incorrect signature: SIG from the type SIG'),
  form('Static method cannot be referenced from a non static context: SIG from the type SIG'),
  form('Non static method cannot be referenced from a static context: SIG from the type SIG'),
  form('Illegal assignment from SIG to SIG'),
  form('Comparison arguments must be compatible types: SIG, SIG'),
  form('Incompatible types since an instance of SIG is never an instance of SIG'),
  form('Illegal conversion from SIG to SIG'),
  form(
    "No such column 'NAME' on entity 'NAME'\\. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name\\. Please reference your WSDL or the describe call for the appropriate names\\.",
  ),
  form(
    "sObject type 'NAME' is not supported\\. If you are attempting to use a custom object, be sure to append the '__c' after the entity name\\. Please reference your WSDL or the describe call for the appropriate names\\.",
  ),
  form(
    "Didn't understand relationship 'NAME' in (?:field path|FROM part of query call)\\. If you are attempting to use a custom relationship, be sure to append the '__r' after the custom relationship name\\. Please reference your WSDL or the describe call for the appropriate names\\.",
  ),
  form('Field is not writeable: NAME'),
  form('Invalid field NAME for SObject NAME'),
  form('Invalid bind expression type of SIG for column of type SIG'),
  form("Unexpected token 'TOKEN'\\."),
  form("Missing 'TOKEN' at 'TOKEN'"),
  form("Extra 'TOKEN', at 'TOKEN'\\."),
  form("Expecting 'TOKEN' but was: 'TOKEN'"),
  form('Duplicate variable: NAME'),
  form('Duplicate field: NAME'),
  form('Variable is not visible: NAME'),
  form('Type is not visible: SIG'),
  form('Method is not visible: SIG from the type SIG'),
  form('Class NAME must implement the method: SIG'),
  form('Missing return statement required return type: SIG'),
  form('Non-void method might not return a value or might have statement after a return statement\\.'),
  form('Unreachable statement'),
  form('Field NAME does not exist\\. Check spelling\\.'),
  form('Error: Field NAME does not exist\\. Check spelling\\.'),
  form('Field NAME is a picklist field\\. Picklist fields are only supported in certain functions\\.'),
  form("Incorrect parameter type for function 'NAME\\(\\)'\\. Expected SIG, received SIG"),
  form("Incorrect number of parameters for function 'NAME\\(\\)'\\. Expected [0-9-]+, received [0-9]+"),
  form("Syntax error\\. Missing 'TOKEN'"),
  form("Syntax error\\. Found 'TOKEN'"),
  form('Formula result is data type \\(SIG\\), incompatible with expected data type \\(SIG\\)\\.'),
  form('In field: NAME - no SIG named NAME found'),
  form("Must specify 'NAME' for a CustomField of type SIG"),
  form("Can not specify 'NAME' for a CustomField of type SIG"),
  form('Entity is not org-accessible'),
  form('Not available for deploy for this organization'),
  // A flow in which an element is not supported when another element is set to a value. The deploy of
  // 23 November 2026 was refused with a problem of which only the everyday words came out: "field … unknown (When
  // the … field is set to … the … field … supported.)". This form is written from those words, so it is a guess
  // until a run prints a problem with it. Which elements they are, the words do not say. A place takes whatever
  // has the form of a name, and the check of the words below lets through only words of the fixture project and
  // of the platform: names of elements of a flow file and their values are such words. The words came out the
  // same with a name in quotes and without the comma, so the form takes both.
  form(
    `field integrity exception: unknown \\(When the ${QUOTE}NAME${QUOTE} field is set to ${QUOTE}NAME${QUOTE},? the ${QUOTE}NAME${QUOTE} field isn['’]t supported\\.\\)`,
  ),
];

/**
 * Words of Apex, of formulas and of the platform that a problem may name although the fixture project does not
 * hold them, in lower case.
 */
export const PLATFORM_WORDS: ReadonlySet<string> = new Set(
  (
    'void null true false this super string integer decimal double long boolean date datetime time id blob object ' +
    'sobject list set map schema system database test exception type text number percent currency picklist checkbox ' +
    'lookup formula apex class trigger interface enum select from where ' +
    // The global variables of a formula.
    'api custommetadata label objecttype organization permission profile recordtype setup user userrole'
  ).split(' '),
);

const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Every word of the files of the fixture project, in lower case: the names a problem of its deploy can be about. */
export function fixtureWords(): Set<string> {
  const words = new Set<string>();
  for (const [path, content] of fixtureFiles()) {
    for (const [word] of `${path} ${content.toString('utf8')}`.matchAll(WORD)) words.add(word.toLowerCase());
  }
  return words;
}

/**
 * A problem as it may be printed: itself, if its whole text has a known form and every word at a name, a
 * signature or a token is a word of the fixture project or of the platform. Else a sentence that says why not,
 * and of a problem of a form that is not known its everyday words (`everydayWords`): no other word of it comes out.
 * With `names` false, a problem is only printed if its form holds no name at all: that is for a problem about
 * something that is not a component of the fixture project. Of a known form with a name, nothing comes out then.
 */
export function shownProblem(log: PublicLog, problem: unknown, words: ReadonlySet<string>, names = true): string {
  const text = typeof problem === 'string' ? problem.trim() : '';
  const dependent = 'Dependent class is invalid and needs recompilation';
  if (text.startsWith(`${dependent}:`)) return `${dependent}. What follows it is not shown.`;
  const where = 'The page "Deployment Status" in the Setup of the test org shows it.';
  for (const known of KNOWN_PROBLEMS) {
    const found = known.exec(text);
    if (found === null) continue;
    // Every place of a form is filled when the form matches.
    const named = found.slice(1).flatMap((part) => part.match(WORD) ?? []);
    // The form is known and holds a name, so the text is not searched for everyday words: the name could be one.
    if (named.length > 0 && !names) {
      return `not shown, because it is about something that is not a component of the fixture project. ${where}`;
    }
    if (
      !log.clean(text) ||
      named.some((word) => !words.has(word.toLowerCase()) && !PLATFORM_WORDS.has(word.toLowerCase()))
    ) {
      return `not shown, because it names something that is not in the fixture project. ${where}`;
    }
    return text;
  }
  // Of a form that is not known, the words of the list of everyday words say what kind of problem it is.
  const everyday = everydayWords(text);
  return `not shown, because it is not of a known form. ${where}${/[A-Za-z]/.test(everyday) ? ` Its everyday words: ${everyday}` : ''}`;
}

/** One message of a deploy about a component. */
interface DeployMessage {
  readonly fileName?: unknown;
  readonly fullName?: unknown;
  readonly componentType?: unknown;
  readonly lineNumber?: unknown;
  readonly columnNumber?: unknown;
  readonly problem?: unknown;
  readonly problemType?: unknown;
  readonly created?: unknown;
  readonly changed?: unknown;
  readonly deleted?: unknown;
}

const list = (value: unknown): DeployMessage[] =>
  (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]) as DeployMessage[];
const flag = (value: unknown): boolean => value === true || value === 'true';
const number = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** A length of time in words: minutes, or seconds if it is shorter than one. */
const span = (ms: number): string => {
  const [count, unit] = ms >= 60_000 ? [Math.round(ms / 60_000), 'minute'] : [Math.round(ms / 1000), 'second'];
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`;
};

/**
 * The code of a failed request, if it has one that may be printed: of a fault of the Metadata API, which carries
 * its code with a prefix (`sf:INSUFFICIENT_ACCESS`), of an answer that is not one of the API, or of the network.
 */
export function codeOf(log: PublicLog, error: unknown): string | null {
  const said = (error as { errorCode?: unknown } | null)?.errorCode;
  return log.code(typeof said === 'string' ? said.replace(/^.*:/, '') : undefined) ?? log.code(networkCode(error));
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A text with one thing in it said differently. The thing has to stand there exactly once. */
export function changedOnce(text: string, from: string, to: string, where: string): string {
  if (text.split(from).length !== 2) throw new Error(`${where} does not hold "${from}" exactly once.`);
  return text.replace(from, () => to);
}

/**
 * The fixture project in the form the Metadata API takes: a zip file with a manifest. Returns a function that
 * gives the zip file for a user, the names in it, and the zip file of the draft of one flow.
 */
async function fixtureZip(): Promise<{
  forUser: (username: string) => Promise<Buffer>;
  entries: Set<string>;
  draft: Buffer;
}> {
  const { ComponentSet, MetadataConverter } = await loadSourceLibrary();
  const set = ComponentSet.fromSource(FIXTURE_DIR);
  const project = JSON.parse(readFileSync(join(FIXTURE_PROJECT, 'sfdx-project.json'), 'utf8')) as {
    sourceApiVersion?: string;
  };
  if (project.sourceApiVersion !== undefined) {
    set.apiVersion = project.sourceApiVersion;
    set.sourceApiVersion = project.sourceApiVersion;
  }
  const converted = await new MetadataConverter().convert(set, 'metadata', { type: 'zip' });
  if (converted.zipBuffer === undefined) throw new Error('The fixture project could not be converted.');
  const archive = await JSZip.loadAsync(converted.zipBuffer);
  const entries = new Set(Object.keys(archive.files));
  const textOf = async (path: string): Promise<string> => {
    const file = archive.file(path);
    if (file === null) throw new Error(`The fixture project has no file ${path}.`);
    return file.async('string');
  };
  const packed = { type: 'nodebuffer', compression: 'DEFLATE' } as const;

  // Both are worked out before the login, so that a project that does not fit fails before anything is sent.
  const withUser = await textOf(FILE_WITH_USER);
  changedOnce(withUser, MADE_UP_USER, '', FILE_WITH_USER);
  let flow = await textOf(DRAFT_FILE);
  for (const [from, to] of DRAFT_CHANGES) flow = changedOnce(flow, from, to, DRAFT_FILE);
  const manifest =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
    `    <types>\n        <members>${FLOW_WITH_DRAFT}</members>\n        <name>Flow</name>\n    </types>\n` +
    `    <version>${project.sourceApiVersion ?? set.apiVersion ?? ''}</version>\n</Package>\n`;
  const draft = await new JSZip().file('package.xml', manifest).file(DRAFT_FILE, flow).generateAsync(packed);

  return {
    forUser: async (username) => {
      archive.file(FILE_WITH_USER, changedOnce(withUser, MADE_UP_USER, escapeXml(username), FILE_WITH_USER));
      return archive.generateAsync(packed);
    },
    entries,
    draft,
  };
}

type Metadata = Awaited<ReturnType<typeof connectToOrg>>['connection']['metadata'];

/** What is known when a deploy has ended: what is said about it, and whether Salesforce took all of it. */
interface Outcome {
  readonly lines: string[];
  readonly succeeded: boolean;
}

/**
 * Sends one zip file and waits for the org to be done with it. `what` names it in every sentence. Returns
 * nothing when the deploy did not start or its end was not seen: that is said, as a failure of the step.
 */
async function deploy(
  log: PublicLog,
  metadata: Metadata,
  zip: Buffer,
  what: string,
  known: {
    fixture: ReadonlySet<string>;
    entries: ReadonlySet<string>;
    words: ReadonlySet<string>;
    /** What stands before the counts of Salesforce. */
    counted: string;
  },
  options: { pollMs?: number; deployMs?: number },
): Promise<Outcome | undefined> {
  const started = Date.now();
  const limit = options.deployMs ?? DEPLOY_MS;
  let id: string;
  try {
    // All of it or nothing, and no test: Salesforce compiles the Apex and checks the fields.
    const job: { id?: unknown } = await metadata.deploy(zip, {
      rollbackOnError: true,
      singlePackage: true,
      testLevel: 'NoTestRun',
    });
    if (typeof job.id !== 'string' || job.id === '') throw new Error('The org started a deploy and gave no id for it.');
    ({ id } = job as { id: string });
  } catch (error) {
    const code = codeOf(log, error);
    log.fail([
      `The deploy of ${what} could not be started${code === null ? '' : ` (${code})`}. What the org or the library said is not shown here.`,
    ]);
    return undefined;
  }

  // The deploy runs in the org from here on, whatever becomes of this step.
  let result: Record<string, unknown>;
  for (let misses = 0; ;) {
    await pause(options.pollMs ?? POLL_MS);
    if (Date.now() - started > limit) {
      log.fail([
        `The deploy of ${what} did not end within ${span(limit)}.`,
        'It may still be running in the test org.',
      ]);
      return undefined;
    }
    try {
      result = await metadata.checkDeployStatus(id, true);
    } catch (error) {
      misses += 1;
      if (misses < STATE_TRIES) continue;
      const code = codeOf(log, error);
      log.fail([
        `The deploy of ${what} was started, and the org did not say ${String(STATE_TRIES)} times in a row how far it is${code === null ? '' : ` (${code})`}.`,
        'It may still be running in the test org. What the org or the library said is not shown here.',
      ]);
      return undefined;
    }
    misses = 0;
    if (flag(result['done'])) break;
  }

  const state = typeof result['status'] === 'string' && STATES.has(result['status']) ? result['status'] : 'unknown';
  const details = (result['details'] ?? {}) as { componentFailures?: unknown; componentSuccesses?: unknown };
  const failures = list(details.componentFailures);
  const successes = list(details.componentSuccesses).filter((one) => one.fileName !== 'package.xml');
  const seconds = Math.round((Date.now() - started) / 1000);

  const lines = [
    `The deploy of ${what} ended as ${state} after ${String(seconds)} seconds.`,
    `${known.counted}Salesforce counted ${log.count(number(result['numberComponentsTotal']))}, deployed ${log.count(number(result['numberComponentsDeployed']))} and found errors in ${log.count(number(result['numberComponentErrors']))}.`,
  ];
  if (successes.length > 0) {
    const created = successes.filter((one) => flag(one.created)).length;
    const changed = successes.filter((one) => flag(one.changed) && !flag(one.created)).length;
    lines.push(
      `Of the components Salesforce accepted, ${String(created)} are new in the org, ${String(changed)} were changed, and ${String(successes.length - created - changed)} were as they are.`,
    );
  }
  const status = log.code(result['errorStatusCode']);
  if (status !== null) lines.push(`Code of Salesforce for the deploy as a whole: ${status}`);

  failures.forEach((failure, index) => {
    const type = log.name(failure.componentType);
    const name = typeof failure.fullName === 'string' ? failure.fullName : '';
    const ours = type !== null && known.fixture.has(`${type}:${name}`) && log.clean(name);
    const file = typeof failure.fileName === 'string' && known.entries.has(failure.fileName) ? failure.fileName : null;
    const line = number(failure.lineNumber);
    const column = number(failure.columnNumber);
    lines.push(
      `${String(index + 1)}. ${type ?? 'a type that is not shown'} ${ours ? name : '(a name that is not of the fixture project)'}` +
        `${file === null ? '' : `, file ${file}`}${line === null ? '' : `, line ${String(line)}`}${column === null ? '' : `, column ${String(column)}`}` +
        (failure.problemType === 'Warning' ? ', a warning' : ''),
      `   Problem: ${shownProblem(log, failure.problem, known.words, ours)}`,
    );
  });
  return { lines, succeeded: flag(result['success']) && state === 'Succeeded' };
}

/**
 * Deploys the fixture project, or with `draft` the draft of one flow of it and nothing else. Each is one deploy,
 * so that a step of the workflow never waits for two.
 */
export async function deployFixture(
  log: PublicLog,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    pollMs?: number;
    deployMs?: number;
    draft?: boolean;
  } = {},
): Promise<void> {
  const env = loginEnvironment(log, options.env);
  if (env === undefined) return;
  const sent = options.draft === true ? `A draft of the flow ${FLOW_WITH_DRAFT}` : 'The fixture project';

  const { forUser, entries, draft } = await fixtureZip();
  const fixture = new Set(fixtureComponents().map((one) => `${one.type}:${one.fullName}`));
  const known = { fixture, entries, words: fixtureWords(), counted: '' };

  let session: Awaited<ReturnType<typeof connectToOrg>>;
  try {
    session = await connectToOrg(SOURCE, undefined, env);
  } catch (error) {
    log.fail(failureLines(log, `${sent} was not deployed, because the login to the test org failed`, error));
    return;
  }
  log.forbid(session.instanceUrl, session.orgId, session.orgId.slice(0, 15), session.username);
  const { metadata } = session.connection;

  if (options.draft === true) {
    // One flow as a draft. Whether its active version stays as it is, the org has to show.
    const second = await deploy(log, metadata, draft, `a draft of the flow ${FLOW_WITH_DRAFT}`, known, options);
    if (second === undefined) return;
    if (!second.succeeded) {
      log.fail(second.lines);
      return;
    }
    for (const line of second.lines) log.say(line);
    log.say(
      `Salesforce took the draft. Whether the flow ${FLOW_WITH_DRAFT} now has an active version and a newer draft, and which of the two the org hands out, is for the steps that read the org and ask it about its flows to say.`,
    );
    return;
  }

  // The project, with the user of this login as the user of its outbound message.
  const project = await deploy(
    log,
    metadata,
    await forUser(session.username),
    'the fixture project',
    { ...known, counted: `Components of the fixture project: ${String(fixture.size)}. ` },
    options,
  );
  if (project === undefined) return;
  if (!project.succeeded) {
    log.fail(project.lines);
    return;
  }
  for (const line of project.lines) log.say(line);
  log.say('The fixture project is in the test org. No Apex test was run.');
}

if (import.meta.main) {
  const given = process.argv.slice(2);
  await asStep(import.meta.filename, async (log) => {
    if (given.length > 1 || (given[0] !== undefined && given[0] !== 'draft')) {
      log.fail(['The tool that deploys takes no argument, or the one argument "draft". Nothing was sent.']);
      return;
    }
    await deployFixture(log, { draft: given[0] === 'draft' });
  });
}
