/**
 * Logging in to an org with a private key from the environment: the login
 * for a job that runs without a person, such as a build server.
 *
 * The variables carry the name of the source, in upper case and with `_`
 * for `-`. For a source `prod`:
 *
 * - `ORGLENS_JWT_PROD_USERNAME`: the user to log in as;
 * - `ORGLENS_JWT_PROD_CLIENT_ID`: the consumer key of the app in the org;
 * - `ORGLENS_JWT_PROD_KEY`: the private key in PEM form, or
 *   `ORGLENS_JWT_PROD_KEY_FILE`: the path of a file that holds it;
 * - `ORGLENS_JWT_PROD_LOGIN_URL`: where to log in. Without it, the
 *   `login_url` of the source is used, and without that the address of
 *   Salesforce for the kind of the source.
 *
 * As soon as one of them is set, the source is logged in with the key and
 * no login of the Salesforce CLI is considered: half a set of variables is
 * an error, not a reason to use the login of whoever runs the job.
 *
 * OrgLens signs the request itself and asks Salesforce for a token. The
 * Salesforce library can do that as well, and it writes the result into a
 * file of the home folder with the path of the key. Here nothing is
 * written: the token lives in the memory of the process and is gone with
 * it.
 */
import { createPrivateKey, createSign, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadJsforce } from './library.ts';
import type { OrgLikeSource } from './logins.ts';
import { loginFailed, networkCode, saidBy, unreachable } from './org-errors.ts';
import { systemCode } from './tree.ts';

type Environment = Readonly<Record<string, string | undefined>>;

const PRODUCTION = 'https://login.salesforce.com';
const SANDBOX = 'https://test.salesforce.com';

/** How long Salesforce may take the signed request for valid, in seconds. Salesforce accepts at most five minutes. */
const ASSERTION_SECONDS = 180;

/** A request that has no answer after this time is given up. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** The names of the variables for one source. */
export function jwtVariables(sourceName: string): {
  readonly loginUrl: string;
  readonly username: string;
  readonly clientId: string;
  readonly key: string;
  readonly keyFile: string;
} {
  const prefix = `ORGLENS_JWT_${sourceName.toUpperCase().replaceAll('-', '_')}_`;
  return {
    loginUrl: `${prefix}LOGIN_URL`,
    username: `${prefix}USERNAME`,
    clientId: `${prefix}CLIENT_ID`,
    key: `${prefix}KEY`,
    keyFile: `${prefix}KEY_FILE`,
  };
}

/** What the environment says about the login of one source. The key itself is read when it is used. */
export interface JwtSettings {
  readonly source: string;
  /** Scheme and host, without a path. */
  readonly loginUrl: string;
  readonly username: string;
  readonly clientId: string;
  readonly key: { readonly text: string } | { readonly file: string };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Scheme and host of an address to log in at or to send requests to, or
 * `null` if it cannot be one. A token is sent there, so it has to be
 * `https`. Plain `http` is taken for this machine itself, where a test
 * server answers.
 */
export function originOf(address: string): string | null {
  if (!URL.canParse(address)) return null;
  const url = new URL(address);
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
  if (!secure || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null;
  return url.origin;
}

/**
 * Reads the variables of a source. `undefined` if none of them is set.
 * Fails with `LOGIN_FAILED` if some are missing or cannot be used.
 */
export function readJwtSettings(source: OrgLikeSource, env: Environment): JwtSettings | undefined {
  const names = jwtVariables(source.name);
  const value = (name: string): string | undefined => {
    const text = env[name]?.trim();
    return text === undefined || text === '' ? undefined : text;
  };
  const username = value(names.username);
  const clientId = value(names.clientId);
  const keyFile = value(names.keyFile);
  const loginUrl = value(names.loginUrl);
  // A key is not trimmed: it is taken as it was given.
  const keyText = value(names.key) === undefined ? undefined : env[names.key];
  if ([username, clientId, keyFile, loginUrl, keyText].every((one) => one === undefined)) return undefined;

  const missing = [
    ...(username === undefined ? [names.username] : []),
    ...(clientId === undefined ? [names.clientId] : []),
    ...(keyText === undefined && keyFile === undefined ? [names.key] : []),
  ];
  if (username === undefined || clientId === undefined || missing.length > 0) {
    throw loginFailed(
      'JWT_INCOMPLETE',
      source.name,
      `The login with a key for the source "${source.name}" is not complete. Not set: ${missing.join(', ')}.`,
      {
        hint: `Set ${names.username}, ${names.clientId}, and ${names.key} or ${names.keyFile}. To use a login of the Salesforce CLI, unset ${Object.values(names).join(', ')}.`,
        details: { missing },
      },
    );
  }
  const invalid = (variable: string, message: string): Error =>
    loginFailed('JWT_INVALID', source.name, message, { details: { variable } });
  if (keyText !== undefined && keyFile !== undefined) {
    throw invalid(names.keyFile, `Both ${names.key} and ${names.keyFile} are set. Set one of them.`);
  }

  let origin: string | null;
  if (loginUrl !== undefined) {
    origin = originOf(loginUrl);
    if (origin === null) {
      throw invalid(
        names.loginUrl,
        `${names.loginUrl} is not a login URL. It starts with https:// and has no user, query or fragment.`,
      );
    }
  } else {
    origin =
      (source.loginUrl === null ? null : originOf(source.loginUrl)) ??
      (source.kind === 'sandbox' ? SANDBOX : PRODUCTION);
  }

  return {
    source: source.name,
    loginUrl: origin,
    username,
    clientId,
    key: keyText === undefined ? { file: keyFile ?? '' } : { text: keyText },
  };
}

/** Reads the private key. A failure names the variable and never the content. */
function privateKey(settings: JwtSettings): KeyObject {
  const names = jwtVariables(settings.source);
  const variable = 'text' in settings.key ? names.key : names.keyFile;
  const invalid = (message: string, cause?: unknown): Error =>
    loginFailed('JWT_INVALID', settings.source, message, { details: { variable }, cause });

  let pem: string;
  if ('text' in settings.key) {
    // A variable set in one line carries the line ends of the key as the two characters \ and n, and a secret
    // that was pasted often has a line end or a blank around it. A key in PEM form holds no backslash of its own.
    pem = settings.key.text.replace(/\\r\\n|\\n|\\r/g, '\n').trim();
  } else {
    try {
      pem = readFileSync(settings.key.file, 'utf8');
    } catch (error) {
      const reason = systemCode(error);
      throw invalid(
        `The file that ${names.keyFile} names could not be read${reason === null ? '' : ` (${reason})`}.`,
        error,
      );
    }
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: 'pem' });
  } catch {
    // What the library says about the key is not passed on: nothing about a key belongs in a message.
    throw invalid(
      `${variable} does not hold a private key in PEM form. It starts with "-----BEGIN PRIVATE KEY-----" or "-----BEGIN RSA PRIVATE KEY-----" and has no passphrase.`,
    );
  }
  if (key.asymmetricKeyType !== 'rsa') {
    throw invalid(`${variable} holds a key that is not an RSA key. Salesforce accepts RSA keys for this login.`);
  }
  return key;
}

const base64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The signed request: who asks (the app), for whom (the user), of whom (the audience), valid for a short time. */
function assertion(settings: JwtSettings, key: KeyObject, audience: string, now: Date): string {
  const body = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({
    iss: settings.clientId,
    sub: settings.username,
    aud: audience,
    exp: Math.floor(now.getTime() / 1000) + ASSERTION_SECONDS,
  })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key, 'base64url')}`;
}

/**
 * The audiences to name in the request, in the order they are tried.
 *
 * Salesforce documents its two general addresses as the audience, also for
 * a login at the own address of an org. Which of the two an org wants is
 * not always what the kind of the source suggests, so the other is tried
 * after it, and the address of the org last.
 *
 * At a host that is not one of Salesforce, only that host is named. A
 * request signed for Salesforce is a login for whoever receives it, for as
 * long as it is valid.
 */
export function audiences(loginUrl: string, kind: OrgLikeSource['kind']): string[] {
  const host = new URL(loginUrl).hostname;
  if (!/(?:^|\.)(?:salesforce|force)\.com$/.test(host)) return [loginUrl];
  const general = kind === 'sandbox' ? [SANDBOX, PRODUCTION] : [PRODUCTION, SANDBOX];
  return [...new Set([...general, loginUrl])];
}

/** A session in an org: what a login with a key returns. */
export interface OrgToken {
  readonly accessToken: string;
  /** Scheme and host of the org. */
  readonly instanceUrl: string;
  readonly orgId: string;
}

/** The refusal in an answer of the token service, if the answer is one. */
function refusal(thrown: unknown): { error: string; description: string } | null {
  if (!(thrown instanceof Error)) return null;
  try {
    const answer = JSON.parse(thrown.message) as unknown;
    if (typeof answer !== 'object' || answer === null) return null;
    const { error, error_description: description } = answer as Record<string, unknown>;
    if (typeof error !== 'string') return null;
    return { error, description: typeof description === 'string' ? description : '' };
  } catch {
    return null;
  }
}

/**
 * Logs in with the key and returns the session. Nothing is written
 * anywhere. `audienceList` are the audiences to try, in order
 * (`audiences`).
 */
export async function loginWithKey(
  settings: JwtSettings,
  audienceList: readonly string[],
  now: () => Date = () => new Date(),
): Promise<OrgToken> {
  const key = privateKey(settings);
  const { Connection } = await loadJsforce();
  // The client of the library is used for this one request as well, so that a proxy is handled in one way.
  const client = new Connection({ instanceUrl: settings.loginUrl });

  let refused: { error: string; description: string } | undefined;
  for (const audience of audienceList) {
    let answer: unknown;
    try {
      answer = await client.request(
        {
          method: 'POST',
          url: `${settings.loginUrl}/services/oauth2/token`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: assertion(settings, key, audience, now()),
          }).toString(),
        },
        { timeout: REQUEST_TIMEOUT_MS, retry: { maxRetries: 0 } },
      );
    } catch (error) {
      const network = networkCode(error);
      if (network !== null) throw unreachable(settings.source, network, error);
      const said = refusal(error);
      if (said === null) {
        throw loginFailed(
          'REQUEST_FAILED',
          settings.source,
          `The login with a key for the source "${settings.source}" failed. The login address did not answer like Salesforce. ${saidBy(error)}`,
          { hint: 'Check the login URL.', cause: error },
        );
      }
      // The first refusal is the one for the audience that fits the kind of the source. One that is not about
      // the audience says more than one that is.
      if (refused === undefined || (/audience/i.test(refused.description) && !/audience/i.test(said.description))) {
        refused = said;
      }
      // Salesforce answers `invalid_grant` to a wrong audience, and to much else. Any other answer is final.
      if (said.error !== 'invalid_grant') break;
      continue;
    }

    const { access_token: accessToken, instance_url: instance, id } = (answer ?? {}) as Record<string, unknown>;
    const instanceUrl = typeof instance === 'string' ? originOf(instance) : null;
    // The identity is an address that ends with the id of the org and the id of the user.
    const orgId =
      typeof id === 'string' ? (/\/id\/(00D[A-Za-z0-9]{12,15})\/[A-Za-z0-9]{15,18}$/.exec(id)?.[1] ?? null) : null;
    if (typeof accessToken !== 'string' || accessToken === '' || instanceUrl === null || orgId === null) {
      throw loginFailed(
        'REQUEST_FAILED',
        settings.source,
        `The login with a key for the source "${settings.source}" was answered without a session, an address or an org id.`,
      );
    }
    return { accessToken, instanceUrl, orgId };
  }

  const names = jwtVariables(settings.source);
  const said = refused ?? { error: 'unknown', description: '' };
  throw loginFailed(
    'JWT_REJECTED',
    settings.source,
    `Salesforce refused the login with a key for the source "${settings.source}": ${saidBy(new Error(`${said.error}${said.description === '' ? '' : ` (${said.description})`}`))}`,
    {
      hint: `Check ${names.username} and ${names.clientId}, that the certificate of the key is uploaded to the app, that the user is allowed to use the app, and that the login URL is the one of the org.`,
      details: { error: saidBy(new Error(said.error)) },
    },
  );
}
