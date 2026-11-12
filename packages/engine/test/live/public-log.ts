/**
 * What a step of the live-org workflow may print.
 *
 * The log of a workflow in a public repository can be read by everyone, and
 * the test org is a real org. So a step prints sentences of its own, and
 * puts into them only values of a few kinds, each checked by its form here:
 *
 * - numbers,
 * - codes of OrgLens, of Salesforce and of the network (`REQUEST_REFUSED`),
 * - names of metadata types and of the elements of a metadata file, which
 *   are the vocabulary of the Metadata API and the same in every org,
 * - names of folders of the source format (`classes`),
 * - names and paths of the fixture project, which this repository holds.
 *
 * No name of a component that is not of the fixture project is printed.
 * No message of Salesforce, of a Salesforce library or of OrgLens is
 * printed either, with one exception: a tool may list forms a message of
 * Salesforce is known to have, and print a message whose whole text has
 * one of them (`deploy-fixture.ts`, `read-org.ts`). On top of the forms,
 * nothing is printed that contains a word of the settings of the login or
 * of the address or the id of the org.
 */

/** A code: capitals, digits and underscores. */
const CODE = /^[A-Z][A-Z0-9_]{1,59}$/;
/** The name of a metadata type or of an element of a metadata file: letters and digits. */
const NAME = /^[A-Za-z][A-Za-z0-9]{0,79}$/;
/** An API version, such as `66.0`. */
const VERSION = /^\d{1,3}\.\d$/;
/** The form of the id of an org. */
const ORG_ID = /00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?/;

/** Decides what may be printed. One is made per run, from the settings of the login. */
export interface PublicLog {
  /** Adds words that must not be printed, such as the address and the id of the org once they are known. */
  forbid(...values: readonly (string | null | undefined)[]): void;
  /** The value if it is a code that may be printed, else `null`. */
  code(value: unknown): string | null;
  /** The value if it is the name of a metadata type, of an element or of a folder that may be printed, else `null`. */
  name(value: unknown): string | null;
  version(value: unknown): string | null;
  /** A number, or `unknown`. */
  count(value: unknown): string;
  /** True if the text holds none of the forbidden words and nothing of the form of an org id. */
  clean(text: string): boolean;
  /** Prints a line. A line that is not clean is replaced by a line that says so. */
  say(line: string): void;
  /** Prints the first line as an error of the run, and the others after it. The step has failed from then on. */
  fail(lines: readonly string[]): void;
  /** True once `fail` was called. A tool that is run as a program ends with 1 then (`ended`). */
  readonly failed: boolean;
  /** The lines printed so far. For tests. */
  readonly lines: readonly string[];
}

/**
 * The words of a setting that would give the org or the user away: the value itself, the host of an address
 * and its first part, which is the name of the org's domain, and the domain of a user name.
 */
function wordsOf(value: string): string[] {
  const whole = value.trim().toLowerCase();
  const words = [whole];
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#\s]+)/.exec(whole)?.[1];
  if (host !== undefined) words.push(host, host.split('.')[0] ?? '');
  // Not the part before the @: it can be an everyday word, and a line with that word would be lost.
  if (host === undefined && whole.includes('@')) words.push(whole.slice(whole.indexOf('@') + 1));
  return words.filter((word) => word.length >= 4);
}

export function publicLog(print: (line: string) => void = console.log): PublicLog {
  const forbidden = new Set<string>();
  const lines: string[] = [];
  let failed = false;
  const clean = (text: string): boolean => {
    const lower = text.toLowerCase();
    if (ORG_ID.test(text)) return false;
    for (const word of forbidden) if (lower.includes(word)) return false;
    return true;
  };
  const checked =
    (form: RegExp) =>
    (value: unknown): string | null =>
      typeof value === 'string' && form.test(value) && clean(value) ? value : null;
  const say = (line: string): void => {
    const safe = clean(line) ? line : 'A line is not shown here, because it holds a word of the settings of the login.';
    lines.push(safe);
    print(safe);
  };
  return {
    forbid: (...values) => {
      for (const value of values) {
        if (typeof value === 'string') for (const word of wordsOf(value)) forbidden.add(word);
      }
    },
    code: checked(CODE),
    name: checked(NAME),
    version: checked(VERSION),
    count: (value) => (typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : 'unknown'),
    clean,
    say,
    fail: ([first = 'The step failed.', ...others]) => {
      // The first line becomes an annotation on the page of the run. The log shows it as well.
      say(`::error::${first}`);
      for (const line of others) say(line);
      failed = true;
    },
    get failed() {
      return failed;
    },
    lines,
  };
}

/** Ends a tool that was run as a program: with 1 if it failed. */
export function ended(log: PublicLog): void {
  if (log.failed) process.exitCode = 1;
}
