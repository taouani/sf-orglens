/*
 * The login step of the workflow `live-org.yml`: logs in to the test org with
 * the key from the secrets of the workflow, through the built `orglens`
 * binary, and says whether that worked.
 *
 * The log of a workflow in a public repository can be read by everyone. This
 * script therefore prints nothing that `orglens`, a Salesforce library or
 * Salesforce has written. It reads the JSON result and prints sentences of
 * its own, with values of these kinds only:
 *
 * - codes of OrgLens and of the network, which have a fixed form,
 * - the API version, which is a number,
 * - names of variables and of secrets, from the list below,
 * - an error code or a description of Salesforce, if it is word for word one
 *   of the texts listed below. Anything else is "not shown".
 *
 * So no text that Salesforce or a library chose reaches the log, whatever
 * it holds. The price is that an answer of Salesforce that is not in the
 * lists has to be looked at on a machine of the maintainer.
 *
 * Run `pnpm run build` first. The command that is started can be replaced,
 * which is how the test runs it from source:
 *
 *   node scripts/live-org-login.mjs [-- <command> <argument>...]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The name of the source the test org is declared as. It gives the variables their names. */
const SOURCE = 'test-org';

/** The variables `orglens` reads for that source, and the secret of the environment `live-org` each one comes from. */
const SETTINGS = [
  { variable: 'ORGLENS_JWT_TEST_ORG_LOGIN_URL', secret: 'ORGLENS_TEST_ORG_LOGIN_URL' },
  { variable: 'ORGLENS_JWT_TEST_ORG_USERNAME', secret: 'ORGLENS_TEST_ORG_USERNAME' },
  { variable: 'ORGLENS_JWT_TEST_ORG_CLIENT_ID', secret: 'ORGLENS_TEST_ORG_CLIENT_ID' },
  { variable: 'ORGLENS_JWT_TEST_ORG_KEY', secret: 'ORGLENS_TEST_ORG_JWT_KEY' },
];

/** Every variable `orglens` can name in a failure of this login. */
const VARIABLES = new Set([...SETTINGS.map(({ variable }) => variable), 'ORGLENS_JWT_TEST_ORG_KEY_FILE']);

/** The error codes of the OAuth token request that are printed. The last one is what `orglens` puts for none. */
const OAUTH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client_id',
  'invalid_client',
  'invalid_request',
  'invalid_app_access',
  'invalid_scope',
  'unsupported_grant_type',
  'inactive_user',
  'inactive_org',
  'rate_limit_exceeded',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'unknown',
]);

/**
 * The descriptions Salesforce is known to give for a refused login with a
 * key, longest first. They are written from its documentation and from
 * memory, and none was seen in an answer of Salesforce by this project yet.
 */
const KNOWN_DESCRIPTIONS = [
  'user is not admin approved to access this app',
  "user hasn't approved this consumer",
  'invalid client credentials',
  'client identifier invalid',
  'expired authorization code',
  'audience is invalid',
  'invalid assertion',
  'invalid subject',
  'inactive user',
  'ip restricted',
];

/** How long one command may take. The slowest login `orglens` can make before it gives up takes about 210 seconds. */
const COMMAND_TIMEOUT_MS = 300_000;

const separator = process.argv.indexOf('--');
const [command, ...commandArgs] =
  separator === -1 ? [process.execPath, join(root, 'packages/cli/dist/bin.js')] : process.argv.slice(separator + 1);

/** A code that OrgLens or the system made: capitals, digits and underscores. Anything else is not printed. */
const code = (value) => (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,59}$/.test(value) ? value : null);

/** An API version, such as `66.0`. */
const version = (value) => (typeof value === 'string' && /^\d{1,3}\.\d$/.test(value) ? value : null);

/** How a command ended, in words that hold nothing the command printed. */
const ending = (result) =>
  result.status === null
    ? `no exit code (${code(result.error?.code) ?? code(result.signal) ?? 'unknown'})`
    : `the exit code ${String(result.status)}`;

/**
 * Runs `orglens` and returns how it ended and its JSON result, if it gave one. Every command but `init`, which
 * takes its folder as an argument, is told which workspace is meant.
 */
function run(args, env) {
  const where = args[0] === 'init' ? [] : ['--workspace', work];
  const result = spawnSync(command, [...commandArgs, ...where, '--json', ...args], {
    cwd: work,
    env,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  });
  let envelope = null;
  try {
    const parsed = JSON.parse(result.stdout);
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.ok === 'boolean') envelope = parsed;
  } catch {
    // Not JSON. What was printed is never shown.
  }
  return { result, envelope };
}

function fail(lines) {
  // The first line becomes an annotation on the page of the run. The log shows it as well.
  console.log(`::error::${lines[0]}`);
  for (const line of lines.slice(1)) console.log(line);
  process.exitCode = 1;
}

/** Sets up an empty workspace with the test org as its one source. These commands connect to nothing. */
function setUp(env) {
  for (const args of [
    ['init', work],
    ['source', 'add', SOURCE, '--kind', 'org'],
  ]) {
    const { result, envelope } = run(args, env);
    if (result.status !== 0 || envelope?.ok !== true) {
      fail([
        `The login to the test org was not tried: "orglens ${args[0] === 'init' ? 'init' : 'source add'}" failed.`,
        `It ended with ${ending(result)}${envelope?.ok === false ? ` and the error ${code(envelope.error?.code) ?? 'unknown'}` : ''}. What it printed is not shown here.`,
      ]);
      return false;
    }
  }
  return true;
}

/** What Salesforce answered to the login, as far as it is one of the known texts. */
function answerOfSalesforce(error, message) {
  if (typeof error !== 'string') return null;
  if (!OAUTH_ERRORS.has(error))
    return 'Answer of Salesforce: not shown, because it is not one of the known error codes.';
  const description = KNOWN_DESCRIPTIONS.find((known) => typeof message === 'string' && message.includes(known));
  return description === undefined
    ? `Answer of Salesforce: ${error}. Its description is not shown, because it is not one of the known texts.`
    : `Answer of Salesforce: ${error} (${description})`;
}

function check() {
  if (command === undefined) {
    fail(['The login to the test org was not tried: no command follows "--".']);
    return;
  }
  const missing = SETTINGS.filter(({ variable }) => (process.env[variable] ?? '').trim() === '');
  if (missing.length > 0) {
    fail([
      'The login to the test org was not tried: secrets are missing.',
      `Not set in the environment "live-org": ${missing.map(({ secret }) => secret).join(', ')}.`,
      'docs/live-org-setup.md says how they are set.',
    ]);
    return;
  }

  // No setting of OrgLens of this machine applies, and only the command that logs in gets the secrets.
  const plain = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^ORGLENS_/i.test(name)));
  if (!setUp(plain)) return;
  const withSecrets = { ...plain };
  for (const { variable } of SETTINGS) withSecrets[variable] = process.env[variable];

  const { result, envelope } = run(['source', 'check', SOURCE], withSecrets);
  if (envelope === null) {
    fail([
      'The login to the test org could not be checked: "orglens source check" did not answer as expected.',
      `It ended with ${ending(result)}. What it printed is not shown here.`,
    ]);
    return;
  }

  if (envelope.ok) {
    if (result.status !== 0) {
      fail([
        `The login to the test org could not be checked: "orglens source check" reported success and ended with ${ending(result)}.`,
      ]);
      return;
    }
    if (envelope.data?.login?.via !== 'jwt-env') {
      fail(['The test org was not logged in to with the key of the workflow, but by another route.']);
      return;
    }
    console.log('The login to the test org worked.');
    console.log(`Login: with the key from the secrets of the workflow`);
    console.log(`API version of the org: ${version(envelope.data?.org?.apiVersion) ?? 'unknown'}`);
    return;
  }

  const error = envelope.error ?? {};
  const details = typeof error.details === 'object' && error.details !== null ? error.details : {};
  const reason = code(details.reason);
  const lines = [
    `The login to the test org failed: ${code(error.code) ?? 'unknown error'}${reason === null ? '' : ` (${reason})`}.`,
  ];
  const answer = answerOfSalesforce(details.error, error.message);
  if (answer !== null) lines.push(answer);
  if (code(details.network) !== null) lines.push(`Network: ${code(details.network)}`);
  if (VARIABLES.has(details.variable)) lines.push(`Variable: ${details.variable}`);
  if (Array.isArray(details.missing)) {
    lines.push(`Not set: ${details.missing.filter((name) => VARIABLES.has(name)).join(', ')}`);
  }
  lines.push(
    'The message of OrgLens is not shown here. docs/live-org-setup.md, section 5, says what each of these codes means.',
    'The variables ORGLENS_JWT_TEST_ORG_… come from the secrets ORGLENS_TEST_ORG_… of the environment "live-org".',
  );
  fail(lines);
}

const work = mkdtempSync(join(tmpdir(), 'orglens-live-org-'));
try {
  check();
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
