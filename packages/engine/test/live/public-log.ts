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
 * one of them (`deploy-fixture.ts`, `read-org.ts`). Of a message in
 * another form, a tool may show the words of a short list of everyday
 * words and nothing else, and of a name of the org how it is built
 * (`everydayWords` here and `nameForm` in `read-org.ts`). Of a file that
 * could not be read as metadata, a tool may show the first folder and the ending
 * where they are words of the source format (`placeForm`). Of a symbol
 * table of a class of the fixture project, a tool may show the names of
 * its fields, and a text whose every word is one of the fixture project
 * or of Apex (`probe-org.ts`). Of a query of the Dependency API that
 * failed, a tool may show the condition: its three fields, the names of
 * metadata types, and the number of ids in the place of the ids
 * (`conditionForm` in `read-org.ts`). On top of the forms,
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

/** The addresses of Salesforce that are the same for every org. */
const SHARED_HOSTS: ReadonlySet<string> = new Set(['login.salesforce.com', 'test.salesforce.com']);

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
  /** True once `fail` was called. A tool that is run as a program ends with 1 then (`own-output.ts`). */
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
  // The two addresses every org can be logged in to give no org away, and their first part is an everyday word.
  if (host !== undefined && !SHARED_HOSTS.has(host)) words.push(host, host.split('.')[0] ?? '');
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
  const say = (text: string): void => {
    // One line stays one line.
    const line = text.replace(/[\r\n]+/g, ' ');
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

/**
 * Words a message of Salesforce or of a library is made of whatever it is about, in lower case. A message of a
 * form that is not known is shown in these words only (`everydayWords`).
 */
const EVERYDAY_WORDS: ReadonlySet<string> = new Set(
  (
    'a an the of in on at to for from with without by into as and or not no nor is are was were be been being it ' +
    'its this that these those there here if when while because than then so but all any each every some one ' +
    'more most only also already still currently can cannot could may might must should will would do does did ' +
    'done has have had please you your we our unable failed fail fails failure error errors warning warnings ' +
    'problem invalid valid unknown known missing found find exist exists existing available unavailable ' +
    'supported unsupported enabled disabled allowed required requires need needs ensure check correct ' +
    'incorrect proper improper insufficient too many much large larger small limit limits exceeded maximum ' +
    'minimum size number count during before after retrieve retrieved retrieving retrieval retrievable deploy ' +
    'deployed load loaded loading read reading write access accessible permission permissions input output ' +
    'received request requested result results entity entities type types name named names file files folder ' +
    'folders metadata component components package packages packaged namespace managed unmanaged installed ' +
    'organization org api version versions object objects field fields record records standard custom value ' +
    'values set sets translation translations translated language languages setting settings feature features ' +
    'license licenses user users profile profiles id ids db database capitalization member members wildcard ' +
    'manifest zip xml parse parsed parsing resolve resolved element elements expected unexpected ' +
    'duplicate empty null undefined defined registry suffix directory path content parent child children ' +
    // Words of a problem with a formula, which a deploy reports.
    'formula formulas function functions parameter parameters default syntax reference references referenced ' +
    'use used'
  ).split(' '),
);

/** What stands in quotes or in brackets in a message is a name or a value: straight and curly quotes, backticks. */
const QUOTED = /'[^']*'|"[^"]*"|\u2018[^\u2019]*\u2019|\u201C[^\u201D]*\u201D|`[^`]*`|\[[^\]]*\]/g;
/** A quote that has no partner. */
const QUOTE = /['"\u2018\u2019\u201C\u201D`[\]]/;
/** The end of the name of a file: a dot and an ending. */
const FILE_END = /\.[A-Za-z0-9]+(?:-meta\.xml)?[.,:;)]*$/;
/** A path with spaces in it is looked for over this many words at most. */
const PATH_WORDS = 12;

/**
 * A text that is not ours, in the words of a short list of everyday words and nothing else: every other word,
 * every number, everything in quotes or brackets and every path of a file is left out and shown as `…`. `names`
 * are words that are kept as well where they follow the word "type", such as the names of the metadata types.
 *
 * It says what kind of message it is. No word comes out that is not of the list. A name that stands in a message
 * without quotes and holds words of the list can leave those words behind: "Error" of a layout that is called
 * "Error Layout".
 */
export function everydayWords(said: unknown, names: ReadonlySet<string> = new Set()): string {
  // The apostrophe of "can't" is no quote: the word is left out as a whole.
  let plain = (typeof said === 'string' ? said : '')
    .replace(/(?<=[A-Za-z])['\u2019](?=[A-Za-z])/g, '\u0001')
    .replace(QUOTED, ' \u0000 ');
  // A quote without a partner: what follows may be a name, so the text ends there.
  const open = plain.search(QUOTE);
  if (open !== -1) plain = `${plain.slice(0, open)} \u0000`;
  const words = plain
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 60);
  const kept: string[] = [];
  const leaveOut = (): void => {
    if (kept.at(-1) !== '…') kept.push('…');
  };
  let afterType = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    if (/[/\\]/.test(word) && !FILE_END.test(word)) {
      // A path whose folders or file have spaces in their names goes on to the word with the ending of the file.
      const end = words.slice(index + 1, index + 1 + PATH_WORDS).findIndex((later) => FILE_END.test(later));
      if (end !== -1) index += end + 1;
      leaveOut();
      afterType = false;
      continue;
    }
    const [, opening = '', core = '', closing = ''] = /^(\(?)(.*?)([.,:;)]*)$/.exec(word) ?? [];
    const letters = /^[A-Za-z]+$/.test(core);
    if (letters && (EVERYDAY_WORDS.has(core.toLowerCase()) || (afterType && names.has(core)))) {
      kept.push(`${opening}${core}${closing}`);
    } else {
      leaveOut();
    }
    afterType = letters && core.toLowerCase() === 'type';
  }
  return kept.join(' ');
}
