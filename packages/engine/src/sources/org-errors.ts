/**
 * The failures of logging in to an org, as engine errors.
 *
 * A job on a build server prints these messages into a log that others
 * read. The words of OrgLens in them never name a token, a key, a host or
 * a user. What Salesforce or the Salesforce libraries say goes through
 * `saidBy` before it becomes part of a message: tokens are removed, what
 * has the form of an address or of a user name is masked, a page is not
 * passed on, and the text is cut to a length.
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
 * - `JWT_USER_HAS_LOGIN`: the user of the key also has a login of the Salesforce CLI on this machine.
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
  | 'JWT_USER_HAS_LOGIN'
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

/**
 * True if what was thrown says that the library tried to renew the session and could not. The library has no
 * name and no code for this, only the start of its message. An answer of the org never starts like this: the
 * library puts what the org said after these words.
 */
export function isFailedRenewal(thrown: unknown): boolean {
  return thrown instanceof Error && thrown.name === 'Error' && thrown.message.startsWith('Unable to refresh session');
}

/** The longest text of Salesforce or of a library that becomes part of a message. */
const SAID_LIMIT = 300;

/**
 * What was thrown, in one line that is safe to show. Tokens are removed. What has the form of an address, of a
 * host of Salesforce or of a user name is masked: the text is not ours, and a message must not name the org or
 * the user. A page is not passed on at all.
 */
export function saidBy(thrown: unknown): string {
  const text = (thrown instanceof Error ? thrown.message : String(thrown)).replace(/\s+/g, ' ').trim();
  if (/<\s*(?:!doctype|html|head|body|meta|script|title)\b/i.test(text)) return 'The answer was a page, not data.';
  const safe = redactText(text)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi, '[address]')
    .replace(/[^\s"'(<]+@[^\s"')>]+/g, '[user]')
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:salesforce|force|salesforce-setup|site)\.com\b/gi, '[address]');
  return safe.length > SAID_LIMIT ? `${safe.slice(0, SAID_LIMIT)}…` : safe;
}
