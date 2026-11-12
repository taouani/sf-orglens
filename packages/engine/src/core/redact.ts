/**
 * Removes credentials from data before it is written to a log.
 *
 * OrgLens keeps no credential store, and its logs must never become one.
 * Three nets are used together:
 *
 * 1. In an object, a field whose name says it holds a secret is masked
 *    whatever its text.
 * 2. In any string, a value that follows a label which says the same
 *    (`refreshToken":"..."`, `SF_CLIENT_SECRET=...`, `<password>...`) is masked.
 * 3. In any string, the shapes of known secrets are masked wherever they
 *    stand, because a token also turns up inside an error message or a URL.
 *
 * Masking too much is accepted, with one limit: a component key such as
 * `NamedCredential:billing`, a count and a flag are diagnostics of this
 * product and stay readable.
 *
 * What this does not catch: a secret with no label and no known shape. No
 * pattern can. The rule that nothing which holds a credential is passed to
 * the logger stays in force, and this module is the second line behind it.
 */

export const REDACTED = '[REDACTED]';

/** A string longer than this is cut before it is scanned and written. */
const MAX_STRING_LENGTH = 16_384;
/** Objects nested deeper than this are replaced by a marker. */
const MAX_DEPTH = 32;
/** One call copies at most this many values. It bounds the output for data with many shared parts. */
const MAX_NODES = 20_000;

/**
 * Words that mark a name as the name of a secret. A name is compared in
 * lower case with `-`, `_`, `.` and spaces removed.
 */
const SECRET_WORDS = [
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'authorization',
  'cookie',
  'session',
  'sessionid',
  'apikey',
  'privatekey',
  'assertion',
  'authurl',
];
/** Names that are secrets only as a whole: `sid` must not mask `inside`. */
const SECRET_WHOLE_NAMES: ReadonlySet<string> = new Set(['sid', 'jwt', 'pem', 'pwd', 'auth', 'bearer']);

/** In an object, a field is secret if its name contains one of the words. `credential` is one more word there. */
const SECRET_FIELD = new RegExp(`(?:${[...SECRET_WORDS, 'credential'].join('|')})`);
/**
 * In text, a label is secret only if it ends with one of the words, so that
 * `token_type=Bearer` and the key `OauthTokenExchangeHandler:x` stay readable.
 */
const SECRET_LABEL = new RegExp(`(?:${SECRET_WORDS.join('|')})$`);

const foldLabel = (name: string): string => name.replace(/[-_.\s]/g, '').toLowerCase();

function isSecretField(name: string): boolean {
  const folded = foldLabel(name);
  return SECRET_WHOLE_NAMES.has(folded) || SECRET_FIELD.test(folded);
}

function isSecretLabel(name: string): boolean {
  const folded = foldLabel(name);
  return SECRET_WHOLE_NAMES.has(folded) || SECRET_LABEL.test(folded);
}

/** Labels whose value runs to the end of the line when it is not quoted: HTTP headers. */
const HEADER_LABELS: ReadonlySet<string> = new Set(['authorization', 'proxyauthorization', 'cookie', 'setcookie']);

/**
 * Shapes of secrets inside free text. Each match is replaced as a whole.
 * Every pattern starts at a boundary, which keeps the scan linear in the
 * length of the text.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  // PEM blocks: private keys and certificates. An unfinished block is masked to the end of the text.
  /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g,
  // Salesforce CLI auth URL: force://<client id>:<secret>:<refresh token>@<host>
  /force:\/\/[^\s"'<>]+/g,
  // Salesforce session id or access token: <org id>!<token>, also with the "!" encoded for a URL.
  /(?<![A-Za-z0-9])00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?(?:!|%21)[A-Za-z0-9._\-+/=%]{16,}/g,
  // Salesforce refresh token.
  /(?<![A-Za-z0-9])5Aep[A-Za-z0-9._]{20,}/g,
  // JSON Web Token: three base64url parts.
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // A bearer token on its own.
  /(?<![A-Za-z0-9])bearer\s+[A-Za-z0-9._~\-+/=!]{16,}/gi,
  // Basic credentials on their own: base64, told from prose by a digit or a base64 sign.
  /(?<![A-Za-z0-9])Basic\s+(?=[A-Za-z]*[0-9+/=])[A-Za-z0-9+/=]{16,}/g,
];

/** The user and password part of a URL: `https://user:password@host`. The scheme and the host are kept. */
const URL_USER_INFO = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@"'<>]+@/g;

/** An XML element with text content. The element name is the label. */
const XML_ELEMENT = /<([A-Za-z_][A-Za-z0-9_.:-]*)>([^<]+)<\/\1>/g;

/**
 * A label and the separator after it: `name=`, `name: `, `"name":`, `\"name\":`.
 * The label starts at a boundary, so each run of name characters is tried once.
 */
const LABEL = /(?<![A-Za-z0-9_.-])([A-Za-z0-9_.-]+)(?:\\{0,3}["'])?\s*[:=]\s*/g;
const OPENING_QUOTE = /(\\{0,3})(["'])/y;
const UNQUOTED_VALUE = /[^\s&"'<>]+/y;
const REST_OF_LINE = /[^\r\n]+/y;

/** Finds the end of the value that starts at `start`, and where its text begins. */
function valueSpan(text: string, start: number, label: string): { from: number; to: number } | undefined {
  OPENING_QUOTE.lastIndex = start;
  const quote = OPENING_QUOTE.exec(text);
  if (quote !== null) {
    // A quoted value is masked up to the same quote, written with the same number of backslashes.
    const from = start + quote[0].length;
    let close = text.indexOf(quote[0], from);
    while (quote[1] === '' && close > 0 && text[close - 1] === '\\') close = text.indexOf(quote[0], close + 1);
    if (close === -1) {
      // No closing quote: the rest of the line is the value.
      REST_OF_LINE.lastIndex = from;
      const rest = REST_OF_LINE.exec(text);
      return rest === null ? undefined : { from, to: from + rest[0].length };
    }
    return close === from ? undefined : { from, to: close };
  }
  const pattern = HEADER_LABELS.has(foldLabel(label)) ? REST_OF_LINE : UNQUOTED_VALUE;
  pattern.lastIndex = start;
  const value = pattern.exec(text);
  return value === null ? undefined : { from: start, to: start + value[0].length };
}

/** Masks the value behind every label that names a secret. */
function maskLabelled(text: string): string {
  let result = '';
  let copied = 0;
  LABEL.lastIndex = 0;
  for (let match = LABEL.exec(text); match !== null; match = LABEL.exec(text)) {
    // After a label that is no secret the scan goes on inside its value, which can hold a label of its own.
    if (!isSecretLabel(match[1] ?? '')) continue;
    const span = valueSpan(text, LABEL.lastIndex, match[1] ?? '');
    if (span === undefined) continue;
    result += text.slice(copied, span.from) + REDACTED;
    copied = span.to;
    LABEL.lastIndex = span.to;
  }
  return result + text.slice(copied);
}

function cut(text: string): string {
  if (text.length <= MAX_STRING_LENGTH) return text;
  // The last word is dropped with the cut, so that half a token is never left standing at the end.
  // Room is left for the note, so that the result is not cut again when it is masked a second time.
  const kept = text.slice(0, MAX_STRING_LENGTH - 64).replace(/\S*$/, '');
  return `${kept}[cut, ${String(text.length)} characters]`;
}

/**
 * Masks every secret found in a string. Masking a masked string changes
 * nothing. A very long string is cut first.
 */
export function redactText(text: string): string {
  let result = cut(text);
  for (const shape of SECRET_SHAPES) result = result.replace(shape, REDACTED);
  result = result.replace(URL_USER_INFO, `$1${REDACTED}@`);
  result = result.replace(XML_ELEMENT, (element: string, name: string) =>
    isSecretLabel(name) ? `<${name}>${REDACTED}</${name}>` : element,
  );
  return maskLabelled(result);
}

interface Walk {
  readonly path: WeakSet<object>;
  nodes: number;
}

/**
 * Returns a copy of a value that is safe to write to a log and safe to pass
 * to `JSON.stringify`: secrets masked, errors turned into plain objects,
 * cycles cut, values JSON cannot express replaced by a description, and the
 * size bounded. It never throws: a value that cannot be read is replaced by
 * a marker.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, { path: new WeakSet(), nodes: 0 }, 0);
}

/** A field with a secret name is masked when it holds text or a structure. A number, a flag or nothing is kept. */
function redactField(name: string, item: unknown, walk: Walk, depth: number): unknown {
  const holdsData = typeof item === 'string' || (typeof item === 'object' && item !== null);
  return isSecretField(name) && holdsData ? REDACTED : redactValue(item, walk, depth);
}

function redactValue(value: unknown, walk: Walk, depth: number): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (typeof value !== 'object' || value === null) return value;

  if (walk.path.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[too deep]';
  walk.nodes += 1;
  if (walk.nodes > MAX_NODES) return '[too large]';

  walk.path.add(value);
  try {
    return redactObject(value, walk, depth + 1);
  } catch {
    // A getter that throws, a proxy that refuses, a revoked proxy.
    return '[unreadable]';
  } finally {
    walk.path.delete(value);
  }
}

function redactObject(value: object, walk: Walk, depth: number): unknown {
  if (value instanceof String) return redactText(value.valueOf());
  if (value instanceof Number || value instanceof Boolean) return value.valueOf();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[binary, ${String(value.byteLength)} bytes]`;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, walk, depth));
  if (value instanceof Error) return redactError(value, walk, depth);
  if (value instanceof Set) return [...value].map((item) => redactValue(item, walk, depth));
  if (value instanceof Map) {
    // A map with text keys is a record, and its keys are field names.
    const entries = [...value.entries()];
    if (entries.every(([key]) => typeof key === 'string')) {
      return Object.fromEntries(entries.map(([key, item]) => [key, redactField(key as string, item, walk, depth)]));
    }
    return entries.map((entry) => redactValue(entry, walk, depth));
  }

  const copy: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) copy[name] = redactField(name, item, walk, depth);
  return copy;
}

function redactError(error: Error, walk: Walk, depth: number): Record<string, unknown> {
  const copy: Record<string, unknown> = { name: redactText(error.name), message: redactText(error.message) };
  // Own enumerable fields first (code, hint, details, ...), so that a secret-looking one is masked.
  for (const [name, item] of Object.entries(error)) {
    if (name === 'name' || name === 'message' || name === 'stack' || name === 'cause') continue;
    copy[name] = redactField(name, item, walk, depth);
  }
  if (typeof error.stack === 'string') copy['stack'] = redactText(error.stack);
  if (error.cause !== undefined) copy['cause'] = redactValue(error.cause, walk, depth);
  return copy;
}
