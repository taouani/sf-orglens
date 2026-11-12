/**
 * Connects to the org of a source.
 *
 * The login is found in this order: a key in the environment (`jwt.ts`),
 * the Salesforce CLI login that is linked to the source, the one Salesforce
 * CLI login that belongs to the org the source declares (`logins.ts`).
 *
 * A connection is checked before it is handed out: the org says who is
 * logged in, and that has to be the org the source declares. A login that
 * points at another org than the one that is meant is the mistake that
 * must not go unnoticed: everything read afterwards would be filed under
 * the wrong name.
 *
 * The API version is the newest the org offers. A version set for the
 * Salesforce CLI (`org-api-version`) is not applied: two people reading the
 * same org get the same result.
 *
 * Only metadata is read through a connection. Nothing here queries records.
 */
import type { Connection } from '@salesforce/core';
import { EngineError, isEngineError } from '../core/errors.ts';
import { audiences, jwtVariables, loginWithKey, readJwtSettings, REQUEST_TIMEOUT_MS, type JwtSettings } from './jwt.ts';
import { loadCore, loadJsforce } from './library.ts';
import { chooseCliLogin, listCliLogins, sameOrg, type CliLogin, type OrgLikeSource } from './logins.ts';
import { isFailedRenewal, isInvalidSession, loginFailed, networkCode, saidBy, unreachable } from './org-errors.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/** How a source is logged in: with a key from the environment, or with a login of the Salesforce CLI. */
type LoginRoute = 'jwt-env' | 'linked' | 'org-id';

/** An open connection to the org of a source, and what the org said about it. */
export interface OrgSession {
  /** The connection of the Salesforce library. It stays inside `sources/`. */
  readonly connection: Connection;
  readonly via: LoginRoute;
  /** The alias of the Salesforce CLI login. `null` for a login with a key, and for a login without an alias. */
  readonly alias: string | null;
  readonly username: string;
  /** The id of the org, as the org states it: 18 characters. */
  readonly orgId: string;
  readonly instanceUrl: string;
  /** Such as `66.0`. */
  readonly apiVersion: string;
}

/** The options for every request made here: an answer within the time limit, and few repetitions. */
const REQUEST = { timeout: REQUEST_TIMEOUT_MS, retry: { maxRetries: 2 } } as const;

export function orgMismatch(source: OrgLikeSource, found: string, login: string): EngineError {
  return new EngineError(
    'ORG_MISMATCH',
    `The ${login} belongs to the org ${found}, and the source "${source.name}" declares the org ${source.orgId ?? ''}.`,
    {
      hint: `Use a login of the declared org, or correct "org_id" of the source in orglens.toml.`,
      details: { source: source.name, declared: source.orgId, found },
    },
  );
}

/** The newest API version an org offers, such as `66.0`. Asking needs no login. */
async function newestApiVersion(source: string, instanceUrl: string): Promise<string> {
  const { Connection: Client } = await loadJsforce();
  let answer: unknown;
  try {
    answer = await new Client({ instanceUrl }).request(`${instanceUrl}/services/data`, REQUEST);
  } catch (error) {
    const network = networkCode(error);
    if (network !== null) throw unreachable(source, network, error);
    throw loginFailed(
      'REQUEST_FAILED',
      source,
      `The org of the source "${source}" did not list its API versions. ${saidBy(error)}`,
      {
        cause: error,
      },
    );
  }
  const versions = (Array.isArray(answer) ? answer : [])
    .map((one: unknown) => (one as { version?: unknown } | null)?.version)
    .filter((version): version is string => typeof version === 'string' && /^\d+\.\d+$/.test(version));
  const newest = versions.sort((a, b) => Number(b) - Number(a))[0];
  if (newest === undefined) {
    throw loginFailed('REQUEST_FAILED', source, `The org of the source "${source}" did not list its API versions.`, {
      hint: 'The address of the org may have changed. Log in again with the Salesforce CLI.',
    });
  }
  return newest;
}

/** Asks the org who is logged in. This is the first request that needs the session, so it is where a login fails. */
async function identify(
  source: OrgLikeSource,
  connection: Connection,
  expired: () => EngineError,
): Promise<{ orgId: string }> {
  let answer: unknown;
  try {
    answer = await connection.request(`/services/data/v${connection.getApiVersion()}/`, REQUEST);
  } catch (error) {
    const network = networkCode(error);
    if (network !== null) throw unreachable(source.name, network, error);
    // A session that is not accepted is reported as a code by Salesforce, and one that the library could not
    // renew by the library, in words.
    if (isInvalidSession(error) || isFailedRenewal(error)) throw expired();
    throw loginFailed(
      'REQUEST_FAILED',
      source.name,
      `The org of the source "${source.name}" did not say who is logged in. ${saidBy(error)}`,
      { cause: error },
    );
  }
  // The identity is an address that ends with the id of the org and the id of the user.
  const identity = (answer as { identity?: unknown } | null)?.identity;
  const orgId =
    typeof identity === 'string' ? /\/id\/(00D[A-Za-z0-9]{12,15})\/[A-Za-z0-9]{15,18}$/.exec(identity)?.[1] : undefined;
  if (orgId === undefined) {
    throw loginFailed(
      'REQUEST_FAILED',
      source.name,
      `The org of the source "${source.name}" did not say who is logged in.`,
    );
  }
  return { orgId };
}

/** True if a login of the Salesforce CLI is one of the user of the key. User names do not differ by case. */
const hasLoginOf = (settings: JwtSettings, logins: readonly CliLogin[]): boolean =>
  logins.some((login) => login.username.toLowerCase() === settings.username.toLowerCase());

/**
 * A login with a key is refused for a user who also has a login of the
 * Salesforce CLI on this machine. The library reads the login file of the
 * user of a session it is given, and takes over what it finds: with a
 * refresh token from that file, it would renew a session of the key that
 * the org does not accept with the other login, and write the file. A
 * login with a key must be that and nothing else.
 */
function keyUserHasLogin(source: OrgLikeSource): EngineError {
  const names = jwtVariables(source.name);
  return loginFailed(
    'JWT_USER_HAS_LOGIN',
    source.name,
    `The user of the key for the source "${source.name}" also has a login of the Salesforce CLI on this machine. OrgLens does not use the two together.`,
    {
      hint: `To use the login of the Salesforce CLI, unset ${Object.values(names).join(', ')}. To use the key, log that user out of the Salesforce CLI (sf org logout), or run the job as a user of the machine who has no such login.`,
    },
  );
}

async function connectWithKey(
  source: OrgLikeSource,
  settings: JwtSettings,
  logins: readonly CliLogin[],
): Promise<OrgSession> {
  if (hasLoginOf(settings, logins)) throw keyUserHasLogin(source);
  const token = await loginWithKey(settings, audiences(settings.loginUrl, source.kind));
  if (source.orgId !== null && !sameOrg(source.orgId, token.orgId)) {
    throw orgMismatch(source, token.orgId, 'login with a key');
  }
  const apiVersion = await newestApiVersion(source.name, token.instanceUrl);
  const { AuthInfo, Connection: OrgConnection } = await loadCore();
  let connection: Connection;
  try {
    // Everything the library would otherwise ask the org for is handed to it, and it is given no file to write.
    // No user name beside the session: with one, the library refuses a user who also has a Salesforce CLI login.
    const authInfo = await AuthInfo.create({
      accessTokenOptions: {
        accessToken: token.accessToken,
        instanceUrl: token.instanceUrl,
        loginUrl: settings.loginUrl,
        username: settings.username,
        orgId: token.orgId,
        isDevHub: false,
        namespacePrefix: null,
      },
    });
    // The check above looked at the files. This one asks the library what it made of them: a session and nothing
    // to renew it with. Anything else means that it found a login of the user after all.
    if (!authInfo.isAccessTokenFlow()) throw keyUserHasLogin(source);
    connection = await OrgConnection.create({ authInfo, connectionOptions: { version: apiVersion } });
  } catch (error) {
    if (isEngineError(error)) throw error;
    throw loginFailed(
      'REQUEST_FAILED',
      source.name,
      `The connection to the org of the source "${source.name}" could not be set up. ${saidBy(error)}`,
      { cause: error },
    );
  }
  const { orgId } = await identify(source, connection, () =>
    loginFailed(
      'SESSION_EXPIRED',
      source.name,
      `The org of the source "${source.name}" does not accept the session it has just issued.`,
      { hint: 'The app in the org needs the OAuth scope "api".' },
    ),
  );
  if (source.orgId !== null && !sameOrg(source.orgId, orgId)) throw orgMismatch(source, orgId, 'login with a key');
  return {
    connection,
    via: 'jwt-env',
    alias: null,
    username: settings.username,
    orgId,
    instanceUrl: token.instanceUrl,
    apiVersion,
  };
}

async function connectWithCliLogin(
  source: OrgLikeSource,
  via: 'linked' | 'org-id',
  login: CliLogin,
  alias: string | null,
): Promise<OrgSession> {
  const named = `login "${alias ?? login.username}"`;
  const again = `Log in again with the Salesforce CLI: sf org login web${alias === null ? '' : ` --alias ${alias}`}${login.instanceUrl === null ? '' : ` --instance-url ${login.instanceUrl}`}`;
  if (source.orgId !== null && login.orgId !== null && !sameOrg(source.orgId, login.orgId)) {
    throw orgMismatch(source, login.orgId, named);
  }
  if (login.instanceUrl === null) {
    throw loginFailed('SESSION_EXPIRED', source.name, `The ${named} of the Salesforce CLI has no address of an org.`, {
      hint: again,
    });
  }
  const apiVersion = await newestApiVersion(source.name, login.instanceUrl);
  const { AuthInfo, Connection: OrgConnection } = await loadCore();
  let connection: Connection;
  try {
    const authInfo = await AuthInfo.create({ username: login.username });
    connection = await OrgConnection.create({ authInfo, connectionOptions: { version: apiVersion } });
  } catch (error) {
    if (error instanceof Error && error.name === 'NamedOrgNotFoundError') {
      throw loginFailed(
        'LOGIN_UNKNOWN',
        source.name,
        `The ${named} of the Salesforce CLI is no longer on this machine.`,
        { hint: again, cause: error },
      );
    }
    const network = networkCode(error);
    if (network !== null) throw unreachable(source.name, network, error);
    throw loginFailed(
      'REQUEST_FAILED',
      source.name,
      `The ${named} of the Salesforce CLI could not be used. ${saidBy(error)}`,
      { hint: again, cause: error },
    );
  }
  const { orgId } = await identify(source, connection, () =>
    loginFailed(
      'SESSION_EXPIRED',
      source.name,
      `The ${named} of the Salesforce CLI is no longer valid and could not be renewed.`,
      { hint: again },
    ),
  );
  if (source.orgId !== null && !sameOrg(source.orgId, orgId)) throw orgMismatch(source, orgId, named);
  return {
    connection,
    via,
    alias,
    username: login.username,
    orgId,
    instanceUrl: connection.instanceUrl,
    apiVersion,
  };
}

/**
 * How a source would be logged in, without connecting. For `doctor`, whose
 * report is pasted into issues: `problem` names no login and no user.
 */
export interface LoginPlan {
  readonly source: string;
  readonly via: LoginRoute | 'none';
  /** Why the source cannot be logged in as things are, or `null`. */
  readonly problem: string | null;
}

export function planLogin(
  source: OrgLikeSource,
  linked: string | undefined,
  logins: readonly CliLogin[],
  env: Environment,
): LoginPlan {
  const plan = (via: LoginPlan['via'], problem: string | null): LoginPlan => ({ source: source.name, via, problem });
  try {
    const settings = readJwtSettings(source, env);
    if (settings !== undefined) {
      return plan(
        'jwt-env',
        hasLoginOf(settings, logins)
          ? 'The user of the key also has a login of the Salesforce CLI on this machine.'
          : null,
      );
    }
  } catch (error) {
    // These messages name variables, and never what a variable holds.
    return plan('jwt-env', error instanceof Error ? error.message : String(error));
  }
  const choice = chooseCliLogin(source, linked, logins);
  if (choice.via === 'none') {
    const problems = {
      LOGIN_UNKNOWN: 'The login that is linked to the source is not a Salesforce CLI login on this machine.',
      LOGIN_AMBIGUOUS: `Several Salesforce CLI logins belong to the org of the source. Choose one with: orglens source link ${source.name} <alias>`,
      NO_LOGIN:
        source.orgId === null
          ? `No login is linked to the source, and it declares no org_id. Link one with: orglens source link ${source.name} <alias>`
          : 'No Salesforce CLI login on this machine belongs to the org of the source.',
    } as const;
    return plan('none', problems[choice.reason]);
  }
  const { orgId } = choice.login;
  if (source.orgId !== null && orgId !== null && !sameOrg(source.orgId, orgId)) {
    return plan(choice.via, 'The login belongs to another org than the one the source declares.');
  }
  return plan(choice.via, null);
}

/**
 * Logs in to the org of a source and returns the connection. `linked` is
 * the login the personal file names for the source, if it names one.
 *
 * Fails with `LOGIN_FAILED` or `ORG_MISMATCH`.
 */
export async function connectToOrg(
  source: OrgLikeSource,
  linked: string | undefined,
  env: Environment,
): Promise<OrgSession> {
  const settings = readJwtSettings(source, env);
  const logins = listCliLogins();
  if (settings !== undefined) return connectWithKey(source, settings, logins);
  const choice = chooseCliLogin(source, linked, logins);
  if (choice.via === 'none') {
    throw loginFailed(choice.reason, source.name, choice.message, { hint: choice.hint });
  }
  return connectWithCliLogin(source, choice.via, choice.login, choice.alias);
}
