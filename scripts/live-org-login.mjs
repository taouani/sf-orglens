/*
 * The login step of the workflow `live-org.yml`: logs in to the test org with
 * the key from the secrets of the workflow, through the built `orglens`
 * binary, and says whether that worked.
 *
 * The log of a workflow in a public repository can be read by everyone. This
 * script therefore never passes on what `orglens` prints. It reads the JSON
 * result and prints a fixed set of facts: whether the login worked, the API
 * version, and for a failure the error code, its reason and a message from
 * which everything that could name the org or the user is removed. It never
 * prints the address of the org, the id of the org, the user name, the client
 * id, a token or the key.
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

const separator = process.argv.indexOf('--');
const [command, ...commandArgs] =
  separator === -1 ? [process.execPath, join(root, 'packages/cli/dist/bin.js')] : process.argv.slice(separator + 1);

/** The values that must not be printed, longest first, so that a value inside another one is not left half hidden. */
function secretTexts() {
  const texts = new Set();
  for (const { variable } of SETTINGS.slice(0, 3)) {
    const value = (process.env[variable] ?? '').trim();
    if (value === '') continue;
    texts.add(value);
    try {
      const address = new URL(value);
      texts.add(address.origin);
      texts.add(address.host);
      texts.add(address.hostname);
    } catch {
      // Not an address.
    }
  }
  return [...texts].filter((text) => text.length >= 4).sort((a, b) => b.length - a.length);
}

/**
 * A text of `orglens` that is safe for a public log. The values of the
 * secrets are removed first. What Salesforce itself says is not known in
 * advance, so anything that has the form of an address, of a user name or of
 * an org id is removed as well.
 */
function publicText(text, secrets) {
  let safe = String(text);
  for (const secret of secrets) safe = safe.replaceAll(secret, '[hidden]');
  return safe
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi, '[address]')
    .replace(/[^\s"'(<]+@[^\s"')>]+/g, '[user]')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:salesforce|force|salesforce-setup|site)\.com\b/gi, '[address]')
    .replace(/\b00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/g, '[org id]')
    .replace(/[\r\n]+/g, ' ');
}

/** A value of the details of an error that is one of a known, short form, or nothing. */
const code = (value) => (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(value) ? value : null);

function run(args, env) {
  return spawnSync(command, [...commandArgs, ...args], { cwd: work, env, encoding: 'utf8', timeout: 120_000 });
}

function fail(lines) {
  // The first line becomes an annotation on the page of the run. The log shows it as well.
  console.log(`::error::${lines[0]}`);
  for (const line of lines.slice(1)) console.log(line);
  process.exitCode = 1;
}

/** Sets up an empty workspace with the test org as its one source. These commands connect to nothing. */
function setUp(env) {
  for (const args of [['init'], ['source', 'add', SOURCE, '--kind', 'org']]) {
    const result = run(args, env);
    if (result.status !== 0) {
      fail([
        `"orglens ${args.join(' ')}" ended with ${result.status === null ? 'no exit code' : `the exit code ${String(result.status)}`}.`,
        publicText(`${result.stdout ?? ''}${result.stderr ?? ''}`, secretTexts()).slice(0, 2000),
      ]);
      return false;
    }
  }
  return true;
}

function check() {
  const missing = SETTINGS.filter(({ variable }) => (process.env[variable] ?? '').trim() === '');
  if (missing.length > 0) {
    fail([
      'The login to the test org was not tried: secrets are missing.',
      `Not set in the environment "live-org": ${missing.map(({ secret }) => secret).join(', ')}.`,
      'docs/live-org-setup.md says how they are set. A secret of an environment is only handed to a run from the branch "main".',
    ]);
    return;
  }

  // Only the command that logs in gets the secrets.
  const plain = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ORGLENS_JWT_')));
  if (!setUp(plain)) return;

  const secrets = secretTexts();
  const result = run(['source', 'check', SOURCE, '--json'], process.env);
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    envelope = null;
  }
  if (envelope === null || typeof envelope !== 'object' || typeof envelope.ok !== 'boolean') {
    fail([
      'The login to the test org could not be checked: "orglens source check" did not answer as expected.',
      `It ended with ${result.status === null ? `no exit code (${code(result.error?.code) ?? 'unknown'})` : `the exit code ${String(result.status)}`}. What it printed is not shown here.`,
    ]);
    return;
  }

  if (envelope.ok) {
    const via = code(envelope.data?.login?.via);
    const apiVersion = code(envelope.data?.org?.apiVersion);
    if (via !== 'jwt-env') {
      fail([`The test org was not logged in to with the key of the workflow, but by the route "${via ?? 'unknown'}".`]);
      return;
    }
    console.log('The login to the test org worked.');
    console.log(`Login: with the key from the secrets of the workflow`);
    console.log(`API version of the org: ${apiVersion ?? 'unknown'}`);
    return;
  }

  const error = envelope.error ?? {};
  const details = typeof error.details === 'object' && error.details !== null ? error.details : {};
  const reason = code(details.reason);
  const lines = [
    `The login to the test org failed: ${code(error.code) ?? 'unknown error'}${reason === null ? '' : ` (${reason})`}.`,
  ];
  if (code(details.error) !== null) lines.push(`Answer of Salesforce: ${code(details.error)}`);
  if (code(details.network) !== null) lines.push(`Network: ${code(details.network)}`);
  if (code(details.variable) !== null) lines.push(`Variable: ${code(details.variable)}`);
  if (Array.isArray(details.missing)) lines.push(`Not set: ${details.missing.map(code).filter(Boolean).join(', ')}`);
  if (typeof error.message === 'string') lines.push(`Message: ${publicText(error.message, secrets)}`);
  if (typeof error.hint === 'string') lines.push(`Hint: ${publicText(error.hint, secrets)}`);
  lines.push(
    `The variables ORGLENS_JWT_TEST_ORG_… come from the secrets ORGLENS_TEST_ORG_… of the environment "live-org". docs/live-org-setup.md says how they are set.`,
  );
  fail(lines);
}

const work = mkdtempSync(join(tmpdir(), 'orglens-live-org-'));
try {
  check();
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
