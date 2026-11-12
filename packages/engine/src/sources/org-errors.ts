/**
 * The failures of logging in to an org, as engine errors.
 *
 * What Salesforce or the Salesforce libraries say is passed through
 * `redactText` before it becomes part of a message. A message here never
 * names a token, a key, a host or a user: a job on a build server prints
 * it into a log that others read.
 */
import { EngineError, type JsonValue } from '../core/errors.ts';
import { redactText } from '../core/redact.ts';

/**
 * Why a login failed, in the details of the error `LOGIN_FAILED`.
 *
 * - `NO_LOGIN`: nothing says which login the source uses, or no login belongs to its org.
 * - `LOGIN_AMBIGUOUS`: several logins belong to the org of the source.
 * - `LOGIN_UNKNOWN`: the login that is linked to the source is not on this machine.
 * - `JWT_INCOMPLETE`: some of the variables for a login with a key are set and others are missing.
 * - `JWT_INVALID`: a variable for a login with a key holds something that cannot be used.
 * - `JWT_REJECTED`: Salesforce refused the login with the key.
 * - `SESSION_EXPIRED`: the login is no longer valid and could not be renewed.
 * - `ORG_UNREACHABLE`: no answer came from the org.
 * - `REQUEST_FAILED`: the org answered with something else than expected.
 */
export type LoginFailure =
  | 'NO_LOGIN'
  | 'LOGIN_AMBIGUOUS'
  | 'LOGIN_UNKNOWN'
  | 'JWT_INCOMPLETE'
  | 'JWT_INVALID'
  | 'JWT_REJECTED'
  | 'SESSION_EXPIRED'
  | 'ORG_UNREACHABLE'
  | 'REQUEST_FAILED';

export function loginFailed(
  reason: LoginFailure,
  source: string,
  message: string,
  options: { hint?: string; details?: Readonly<Record<string, JsonValue>>; cause?: unknown } = {},
): EngineError {
  return new EngineError('LOGIN_FAILED', message, {
    ...(options.hint === undefined ? {} : { hint: options.hint }),
    details: { reason, source, ...options.details },
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  });
}

/** What was thrown and what caused it, the outermost first. A chain that runs in a circle ends. */
function chain(thrown: unknown): { name: string; code: string | null; message: string }[] {
  const links: { name: string; code: string | null; message: string }[] = [];
  let current: unknown = thrown;
  for (let depth = 0; depth < 6 && typeof current === 'object' && current !== null; depth += 1) {
    const { name, code, errorCode, message, cause } = current as Record<string, unknown>;
    const stated = typeof code === 'string' ? code : typeof errorCode === 'string' ? errorCode : null;
    links.push({
      name: typeof name === 'string' ? name : '',
      code: stated,
      message: typeof message === 'string' ? message : '',
    });
    current = cause;
  }
  return links;
}

// The codes of the system and of the HTTP client for a connection that did not come about, and of a certificate
// that was not accepted.
const NETWORK_CODE = /^(?:E[A-Z]{3,}|EAI_[A-Z]+|UND_ERR_[A-Z_]+|[A-Z_]*CERT[A-Z_]*|SELF_SIGNED[A-Z_]*)$/;

/**
 * The code of the network failure in what was thrown, or `null` if it is
 * not a network failure. `TIMEOUT` stands for a request that was given up.
 */
export function networkCode(thrown: unknown): string | null {
  const links = chain(thrown);
  for (const link of links) {
    if (link.name === 'AbortError' || link.name === 'TimeoutError') return 'TIMEOUT';
    // The Salesforce library looks the host up before it connects.
    if (link.name === 'DomainNotFoundError') return 'ENOTFOUND';
    if (link.code !== null && NETWORK_CODE.test(link.code)) return link.code;
  }
  // The HTTP client of Node.js says no more than this when it has no cause to name.
  return links.some((link) => link.message === 'fetch failed') ? 'FETCH_FAILED' : null;
}

export function unreachable(source: string, code: string, cause: unknown): EngineError {
  return loginFailed(
    'ORG_UNREACHABLE',
    source,
    code === 'TIMEOUT'
      ? `The org of the source "${source}" did not answer in time.`
      : `The org of the source "${source}" could not be reached (${code}).`,
    {
      hint: 'Check the network connection, the proxy settings and the login URL of the source.',
      details: { network: code },
      cause,
    },
  );
}

/** True if what was thrown says that the session is not valid: the answer of Salesforce to a token it does not accept. */
export function isInvalidSession(thrown: unknown): boolean {
  return chain(thrown).some((link) => link.code === 'INVALID_SESSION_ID' || link.name === 'INVALID_SESSION_ID');
}

/** What was thrown, in one line that is safe to show. */
export function saidBy(thrown: unknown): string {
  const text = thrown instanceof Error ? thrown.message : String(thrown);
  return redactText(text.replace(/\s+/g, ' ').trim());
}
