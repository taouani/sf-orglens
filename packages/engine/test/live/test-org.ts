/**
 * The test org of the project, for the steps of the live-org workflow that
 * do more than log in: a real Developer Edition org that holds nothing but
 * the fixture project (`docs/live-org-setup.md`).
 *
 * These tools are part of the test tree of the engine. Like a test, they
 * may import the Salesforce libraries and the layers of the engine, which
 * a client may not. They run from source with Node.js itself.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { OrgSource } from '../../src/core/config/config.ts';
import { isEngineError } from '../../src/core/errors.ts';
import type { PublicLog } from './public-log.ts';

const ROOT = join(import.meta.dirname, '../../../..');
/** The package directory of the fixture project. */
export const FIXTURE_PROJECT = join(ROOT, 'fixtures/billing-sfdx');
export const FIXTURE_DIR = join(FIXTURE_PROJECT, 'force-app');
const ANSWER_KEY = join(ROOT, 'fixtures/expected/answer-key.v0.yaml');

/** The name of the source the test org is declared as. It gives the variables of the login their names. */
export const SOURCE_NAME = 'test-org';
export const SOURCE: OrgSource = { name: SOURCE_NAME, kind: 'org', description: null, orgId: null, loginUrl: null };

/** The variables of the login with a key, and the secret of the environment `live-org` each one comes from. */
const SETTINGS = [
  { variable: 'ORGLENS_JWT_TEST_ORG_LOGIN_URL', secret: 'ORGLENS_TEST_ORG_LOGIN_URL' },
  { variable: 'ORGLENS_JWT_TEST_ORG_USERNAME', secret: 'ORGLENS_TEST_ORG_USERNAME' },
  { variable: 'ORGLENS_JWT_TEST_ORG_CLIENT_ID', secret: 'ORGLENS_TEST_ORG_CLIENT_ID' },
  { variable: 'ORGLENS_JWT_TEST_ORG_KEY', secret: 'ORGLENS_TEST_ORG_JWT_KEY' },
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * The environment a tool logs in with: the variables of the login and
 * nothing else of OrgLens. Returns `undefined`, and says why, if a secret is
 * missing. The words of the settings are never printed from then on.
 */
export function loginEnvironment(log: PublicLog, env: Environment = process.env): Environment | undefined {
  const missing = SETTINGS.filter(({ variable }) => (env[variable] ?? '').trim() === '');
  if (missing.length > 0) {
    log.fail([
      'The test org was not logged in to: secrets are missing.',
      `Not set in the environment "live-org": ${missing.map(({ secret }) => secret).join(', ')}.`,
      'docs/live-org-setup.md says how they are set.',
    ]);
    return undefined;
  }
  const own: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (!/^ORGLENS_/i.test(name)) own[name] = value;
  for (const { variable } of SETTINGS) own[variable] = env[variable];
  log.forbid(
    env['ORGLENS_JWT_TEST_ORG_LOGIN_URL'],
    env['ORGLENS_JWT_TEST_ORG_USERNAME'],
    env['ORGLENS_JWT_TEST_ORG_CLIENT_ID'],
  );
  return own;
}

/** What stopped a tool, in lines that may be printed: the codes of an engine error, and no message. */
export function failureLines(log: PublicLog, what: string, error: unknown): string[] {
  if (!isEngineError(error)) {
    const name = error instanceof Error ? log.name(error.name) : null;
    return [`${what}: an error that is not one of OrgLens (${name ?? 'not shown'}). Its message is not shown here.`];
  }
  const details = error.details ?? {};
  const reason = log.code(details['reason']);
  const lines = [`${what}: ${log.code(error.code) ?? 'unknown error'}${reason === null ? '' : ` (${reason})`}.`];
  const said = log.code(details['code']);
  if (said !== null) lines.push(`Code of Salesforce: ${said}`);
  const network = log.code(details['network']);
  if (network !== null) lines.push(`Network: ${network}`);
  if (typeof details['snapshot'] === 'number') lines.push(`Unfinished snapshot: #${String(details['snapshot'])}`);
  lines.push('The message is not shown here. docs/cli.md lists the codes.');
  return lines;
}

/** One component of the fixture project. */
export interface FixtureComponent {
  readonly type: string;
  readonly fullName: string;
}

/** One reference of the answer key of the fixture project. */
interface KeyedReference {
  readonly to: string;
  readonly via: string;
  readonly kind: string;
  /** `confirmed` where the key says nothing. */
  readonly tier?: string;
  readonly stretch?: boolean;
}

/** The answer key of the fixture project, as far as the tools read it (`fixtures/README.md` has the format). */
export interface AnswerKey {
  readonly components?: Readonly<Record<string, readonly string[]>>;
  /** Keys of targets that Salesforce provides. */
  readonly standard?: readonly string[];
  /** Keys of fields that nothing in the project refers to. */
  readonly unreferenced?: readonly string[];
  readonly references?: readonly {
    readonly file: string;
    readonly members: readonly { readonly from: string; readonly refs: readonly KeyedReference[] }[];
  }[];
}

export function answerKey(): AnswerKey {
  return parse(readFileSync(ANSWER_KEY, 'utf8')) as AnswerKey;
}

/** The components of the fixture project, as its answer key lists them. */
export function fixtureComponents(): FixtureComponent[] {
  return Object.entries(answerKey().components ?? {}).flatMap(([type, names]) =>
    names.map((fullName) => ({ type, fullName })),
  );
}

/** The files of the fixture project below its package directory, as a snapshot names them: `classes/Foo.cls`. */
export function fixtureFiles(): Map<string, Buffer> {
  const base = join(FIXTURE_DIR, 'main/default');
  const files = new Map<string, Buffer>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`);
      else files.set(`${prefix}${name}`, readFileSync(path));
    }
  };
  if (existsSync(base)) walk(base, '');
  return files;
}
