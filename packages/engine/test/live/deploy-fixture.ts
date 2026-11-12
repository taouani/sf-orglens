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
 *   node --no-warnings packages/engine/test/live/deploy-fixture.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { loadSourceLibrary } from '../../src/sources/library.ts';
import { connectToOrg } from '../../src/sources/org.ts';
import { ownOutputOnly } from './own-output.ts';
import { ended, publicLog, type PublicLog } from './public-log.ts';
import { failureLines, FIXTURE_DIR, FIXTURE_PROJECT, fixtureComponents, loginEnvironment, SOURCE } from './test-org.ts';

/** How long a deploy may take, and how often its state is asked for. */
const DEPLOY_MS = 20 * 60_000;
const POLL_MS = 3_000;

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

/** A name in Apex or in a formula, with dots: `Invoice__c.Amount__c`. */
const NAME = String.raw`[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*`;
/** A type or a signature in Apex: names, generics, brackets and commas. */
const SIGNATURE = String.raw`[A-Za-z_][A-Za-z0-9_.<>,()\[\] ]{0,160}`;
/** A token of Apex or of a formula, as the compiler quotes it. */
const TOKEN = String.raw`[A-Za-z0-9_.;:,(){}\[\]<>=!+*/&|?@-]{1,24}`;

const form = (text: string): RegExp =>
  new RegExp(
    `^${text.replace(/NAME/g, `(${NAME})`).replace(/SIG/g, `(${SIGNATURE})`).replace(/TOKEN/g, `(${TOKEN})`)}$`,
  );

/**
 * The problems Salesforce is known to report for Apex and for fields, each
 * as a form the whole text has to have. What stands at a name, a signature
 * or a token is printed if it has that form and nothing else. A problem of
 * another form is "not shown": the list is written from memory and from the
 * documentation, and grows with what the test org shows on its page
 * "Deployment Status".
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
  form('Dependent class is invalid and needs recompilation:[\\s\\S]*'),
];

/** A problem as it may be printed: itself, if its whole text has a known form, else a sentence that says so. */
export function shownProblem(log: PublicLog, problem: unknown): string {
  const text = typeof problem === 'string' ? problem.trim() : '';
  const dependent = 'Dependent class is invalid and needs recompilation';
  if (text.startsWith(`${dependent}:`)) return `${dependent}. What follows it is not shown.`;
  return KNOWN_PROBLEMS.some((known) => known.test(text)) && log.clean(text)
    ? text
    : 'not shown, because it is not of a known form. The page "Deployment Status" in the Setup of the test org shows it.';
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

/** The fixture project in the form the Metadata API takes: a zip file with a manifest. Returns it with the names in it. */
async function fixtureZip(): Promise<{ zip: Buffer; entries: Set<string> }> {
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
  const zip = converted.zipBuffer;
  if (zip === undefined) throw new Error('The fixture project could not be converted.');
  const entries = new Set(Object.keys((await JSZip.loadAsync(zip)).files));
  return { zip, entries };
}

export async function deployFixture(
  log: PublicLog,
  options: { env?: Readonly<Record<string, string | undefined>>; pollMs?: number; deployMs?: number } = {},
): Promise<void> {
  const env = loginEnvironment(log, options.env);
  if (env === undefined) return;

  const { zip, entries } = await fixtureZip();
  const fixture = new Set(fixtureComponents().map((one) => `${one.type}:${one.fullName}`));

  let session: Awaited<ReturnType<typeof connectToOrg>>;
  try {
    session = await connectToOrg(SOURCE, undefined, env);
  } catch (error) {
    log.fail(
      failureLines(log, 'The fixture project was not deployed, because the login to the test org failed', error),
    );
    return;
  }
  log.forbid(session.instanceUrl, session.orgId, session.orgId.slice(0, 15), session.username);
  const { metadata } = session.connection;

  const started = Date.now();
  let result: Record<string, unknown>;
  try {
    // The whole project or nothing, and no test: Salesforce compiles the Apex and checks the fields.
    const job: { id?: unknown } = await metadata.deploy(zip, {
      rollbackOnError: true,
      singlePackage: true,
      testLevel: 'NoTestRun',
    });
    const id = typeof job.id === 'string' ? job.id : '';
    if (id === '') throw new Error('The org started a deploy and gave no id for it.');
    for (;;) {
      await pause(options.pollMs ?? POLL_MS);
      result = await metadata.checkDeployStatus(id, true);
      if (flag(result['done'])) break;
      if (Date.now() - started > (options.deployMs ?? DEPLOY_MS)) {
        log.fail([
          `The deploy of the fixture project did not end within ${String(Math.round((options.deployMs ?? DEPLOY_MS) / 60_000))} minutes.`,
          'It may still be running in the test org.',
        ]);
        return;
      }
    }
  } catch (error) {
    // A fault of the Metadata API carries its code with a prefix: `sf:INSUFFICIENT_ACCESS`.
    const said = (error as { errorCode?: unknown } | null)?.errorCode;
    const fault = log.code(typeof said === 'string' ? said.replace(/^.*:/, '') : undefined);
    log.fail([
      `The deploy of the fixture project could not be made${fault === null ? '' : ` (${fault})`}. What the org or the library said is not shown here.`,
    ]);
    return;
  }

  const state = typeof result['status'] === 'string' && STATES.has(result['status']) ? result['status'] : 'unknown';
  const details = (result['details'] ?? {}) as { componentFailures?: unknown; componentSuccesses?: unknown };
  const failures = list(details.componentFailures);
  const successes = list(details.componentSuccesses).filter((one) => one.fileName !== 'package.xml');
  const seconds = Math.round((Date.now() - started) / 1000);

  const lines = [
    `The deploy of the fixture project ended as ${state} after ${String(seconds)} seconds.`,
    `Components of the fixture project: ${String(fixture.size)}. Salesforce counted ${log.count(number(result['numberComponentsTotal']))}, deployed ${log.count(number(result['numberComponentsDeployed']))} and found errors in ${log.count(number(result['numberComponentErrors']))}.`,
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
    const known = type !== null && fixture.has(`${type}:${name}`) && log.clean(name);
    const file = typeof failure.fileName === 'string' && entries.has(failure.fileName) ? failure.fileName : null;
    const line = number(failure.lineNumber);
    const column = number(failure.columnNumber);
    lines.push(
      `${String(index + 1)}. ${type ?? 'a type that is not shown'} ${known ? name : '(a name that is not of the fixture project)'}` +
        `${file === null ? '' : `, file ${file}`}${line === null ? '' : `, line ${String(line)}`}${column === null ? '' : `, column ${String(column)}`}` +
        (failure.problemType === 'Warning' ? ', a warning' : ''),
      `   Problem: ${shownProblem(log, failure.problem)}`,
    );
  });

  if (flag(result['success']) && state === 'Succeeded') {
    for (const line of lines) log.say(line);
    log.say('The fixture project is in the test org. No Apex test was run.');
  } else {
    log.fail(lines);
  }
}

if (import.meta.main) {
  const log = publicLog(ownOutputOnly());
  await deployFixture(log);
  ended(log);
}
