/**
 * Removes credentials from data before it is written to a log.
 *
 * OrgLens keeps no credential store, and its logs must never become one.
 * Two nets are used together: a field whose name says it holds a secret is
 * masked whatever its value, and any string is scanned for the shapes of
 * known secrets, because a token can also turn up inside an error message
 * or a URL.
 */

export const REDACTED = '[REDACTED]';

/**
 * Field names whose values are always masked. A name is compared in lower
 * case with its separators removed. Masking too much is accepted: a field
 * called `tokenCount` is masked as well.
 */
const SECRET_FIELD_PARTS =
  /(token|secret|password|passwd|authorization|cookie|sessionid|apikey|privatekey|assertion|credential|authurl)/;
/** Names that are secrets only as a whole word: `sid` must not mask `inside`. */
const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set(['sid', 'jwt', 'key', 'pem']);

/** Shapes of secrets inside free text. Each match is replaced as a whole. */
const SECRET_SHAPES: readonly RegExp[] = [
  // PEM blocks: private keys and certificates. An unfinished block is masked to the end of the text.
  /-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g,
  // Salesforce CLI auth URL: force://<client id>:<secret>:<refresh token>@<host>
  /force:\/\/[^\s"'<>]+/g,
  // Salesforce session id or access token: <org id>!<token>
  /00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?![A-Za-z0-9._\-+/=]{16,}/g,
  // JSON Web Token: three base64url parts.
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  // A bearer token on its own.
  /\b[Bb]earer\s+[A-Za-z0-9._\-+/=!]{16,}/g,
];

/**
 * Secrets that are recognised by the label in front of them, in a URL, a
 * form body, a header or JSON text. The label (the first group) is kept and
 * the value is masked.
 */
const LABELLED_SECRETS: readonly RegExp[] = [
  /\b((?:access_token|refresh_token|id_token|client_secret|assertion|password|session_?id|sid)["']?\s*[:=]\s*["']?)[^&\s"'<>,;}]+/gi,
  /\b(authorization["']?\s*[:=]\s*["']?)(?:[A-Za-z]+\s+)?[^\s"',;}]+/gi,
];

/** Masks every secret found in a string. Masking a masked string changes nothing. */
export function redactText(text: string): string {
  let result = text;
  for (const shape of SECRET_SHAPES) result = result.replace(shape, REDACTED);
  for (const labelled of LABELLED_SECRETS) result = result.replace(labelled, `$1${REDACTED}`);
  return result;
}

function isSecretField(name: string): boolean {
  const folded = name.replace(/[-_.\s]/g, '').toLowerCase();
  return SECRET_FIELD_NAMES.has(folded) || SECRET_FIELD_PARTS.test(folded);
}

/**
 * Returns a copy of a value that is safe to write to a log and safe to pass
 * to `JSON.stringify`: secrets masked, errors turned into plain objects,
 * cycles cut, and values JSON cannot express replaced by a description.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`;
  if (typeof value !== 'object' || value === null) return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[binary, ${String(value.byteLength)} bytes]`;
    if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
    if (value instanceof Error) return redactError(value, seen);
    if (value instanceof Map || value instanceof Set) return redactValue([...value], seen);

    const copy: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value)) {
      copy[name] = isSecretField(name) && item !== null && item !== undefined ? REDACTED : redactValue(item, seen);
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

function redactError(error: Error, seen: WeakSet<object>): Record<string, unknown> {
  const copy: Record<string, unknown> = { name: error.name, message: redactText(error.message) };
  // Own enumerable fields first (code, hint, details, ...), so that a secret-looking one is masked.
  for (const [name, item] of Object.entries(error)) {
    if (name === 'name' || name === 'message' || name === 'stack' || name === 'cause') continue;
    copy[name] = isSecretField(name) && item !== null && item !== undefined ? REDACTED : redactValue(item, seen);
  }
  if (typeof error.stack === 'string') copy['stack'] = redactText(error.stack);
  if (error.cause !== undefined) copy['cause'] = redactValue(error.cause, seen);
  return copy;
}
