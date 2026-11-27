/**
 * The texts that Apex builds, as the resolver of Apex follows them (decision record 0090): what the code knows of a
 * text, piece by piece, with the place of each character, so that a name in a text is reported where it stands.
 *
 * A text is characters the code knows and parts it does not know. The characters of a literal of the member that is
 * read stand each at its own column. The characters of a constant and of a text that a method gives back stand all
 * at the place where the member uses them, as the answer key has them, and nowhere until then. A part that is not
 * known stands where it enters the text. A value can be one of several texts, as a variable that a branch changes:
 * at most `MOST_TEXTS` of them are followed, and of a value of more, a text that is not known stands for the last.
 */
import type { Pos } from './apex-syntax.ts';

/** What a part of a text that is not known is: a number, a Boolean, a date or a time make no name. */
export type HoleOf = 'number' | 'boolean' | 'date' | 'datetime' | 'text';

type Piece =
  | {
      readonly k: 'chars';
      readonly text: string;
      /** The place of the first character, and of every one where `columns` is not given. `undefined`: not used yet. */
      readonly at: Pos | undefined;
      /** The column of each character, where they stand each at its own, on the line of `at`. */
      readonly columns?: readonly number[];
    }
  | {
      readonly k: 'hole';
      readonly at: Pos | undefined;
      /** The parameter of a method whose text it is: a call gives what stands there. */
      readonly param?: number;
      /**
       * The parameter of the member that is read, whose text it is, where it is read as it is called: the calls may
       * read what stands there (decision record 0091).
       */
      readonly arg?: number;
      readonly of: HoleOf;
    };

export type Text = readonly Piece[];
/** The texts a value can be. */
export type Texts = readonly Text[];

/** The most texts a value is followed as. */
export const MOST_TEXTS = 16;

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };

/** The text of a literal, as `raw` writes it after the quote at `at`, each character at its column. */
export function literalText(at: Pos, raw: string): Text {
  let text = '';
  const columns: number[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const column = at.column + 1 + index;
    const char = raw.charAt(index);
    if (char === '\\' && index + 1 < raw.length) {
      const next = raw.charAt(index + 1);
      const hex = raw.slice(index + 2, index + 6);
      if (next === 'u' && /^[0-9a-f]{4}$/i.test(hex)) {
        text += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
      } else {
        text += ESCAPES[next] ?? next;
        index += 1;
      }
    } else text += char;
    columns.push(column);
  }
  return text === '' ? [] : [{ k: 'chars', text, at: { line: at.line, column: at.column + 1 }, columns }];
}

/** The text of a word of the code, such as a number, each character at its column. */
export function wordText(at: Pos, word: string): Text {
  return [
    { k: 'chars', text: word, at, columns: Array.from({ length: word.length }, (_, index) => at.column + index) },
  ];
}

export const holeText = (at: Pos | undefined, of: HoleOf, param?: number): Text => [
  param === undefined ? { k: 'hole', at, of } : { k: 'hole', at, of, param },
];

/**
 * A text that metadata of the snapshot holds, such as the value of a field of a record of a custom metadata type: all
 * its characters stand at `at`, where the code reads it (decision record 0092).
 */
export const heldText = (text: string, at: Pos): Text => [{ k: 'chars', text, at }];

/** The text of a parameter of the member that is read, which its calls may give: a part not known yet. */
export const argText = (of: HoleOf, arg: number): Text => [{ k: 'hole', at: undefined, of, arg }];

/** Whether a text holds a parameter of a method, which a call gives. */
export const holdsParam = (texts: Texts): boolean =>
  texts.some((text) => text.some((piece) => piece.k === 'hole' && piece.param !== undefined));

/**
 * The places where a parameter of the member that is read entered the texts (`argText`, `args`), and those where
 * another part that is not known did (`others`). Two parts can stand at one place, as where a variable is a parameter
 * on one way of a branch and not known on the other.
 */
export function holePlaces(texts: Texts): { readonly args: Pos[]; readonly others: Pos[] } {
  const args: Pos[] = [];
  const others: Pos[] = [];
  for (const text of texts) {
    for (const piece of text) {
      if (piece.k === 'hole' && piece.at !== undefined) (piece.arg === undefined ? others : args).push(piece.at);
    }
  }
  return { args, others };
}

/**
 * The place of the first part of a text that is not known, where it is a parameter of the member that is read and the
 * text holds another part that is not known and is no parameter, other than at `at`: what is said about the text
 * stands there, and the text is not known whatever a call gives.
 */
export function argBesideOther(text: Text, at?: Pos): Pos | undefined {
  const first = text.find((piece) => piece.k === 'hole');
  if (first?.k !== 'hole' || first.arg === undefined || first.at === undefined) return undefined;
  const other = text.some(
    (piece) =>
      piece.k === 'hole' &&
      piece.arg === undefined &&
      piece.param === undefined &&
      (at === undefined || piece.at?.line !== at.line || piece.at.column !== at.column),
  );
  return other ? first.at : undefined;
}

/** Whether a text holds characters that stand somewhere other than `at`. */
export const charsBeside = (text: Text, at: Pos): boolean =>
  text.some(
    (piece) =>
      piece.k === 'chars' && piece.at !== undefined && (piece.at.line !== at.line || piece.at.column !== at.column),
  );

/**
 * The texts of a value as they enter a text at `at`: a part that a way of a branch did not know, which has no place
 * yet, stands there.
 */
export function placed(texts: Texts, at: Pos | undefined): Texts {
  const loose = (piece: Piece): boolean => piece.k === 'hole' && piece.at === undefined && piece.param === undefined;
  if (at === undefined || !texts.some((text) => text.some(loose))) return texts;
  return texts.map((text) => text.map((piece) => (loose(piece) ? { ...piece, at } : piece)));
}

const keyOf = (text: Text): string => JSON.stringify(text);

/** A text that is not known, which stands for the texts of a value beyond the first of them. */
const OTHERS: Text = [{ k: 'hole', at: undefined, of: 'text' }];
const OTHERS_KEY = keyOf(OTHERS);

/**
 * The texts, each once. Of more than `MOST_TEXTS`, the first of them are kept, and a text that is not known stands
 * for the others where the value enters a text, so that `MOST_TEXTS` are followed.
 */
export function distinct(texts: readonly Text[]): Texts {
  const seen = new Map<string, Text>();
  for (const text of texts) {
    const key = keyOf(text);
    if (!seen.has(key)) seen.set(key, text);
    if (seen.size > MOST_TEXTS) break;
  }
  if (seen.size <= MOST_TEXTS) return [...seen.values()];
  seen.delete(OTHERS_KEY);
  return [...[...seen.values()].slice(0, MOST_TEXTS - 1), OTHERS];
}

/** Each text of `a` followed by each text of `b`. */
export function joined(a: Texts, b: Texts): Texts {
  const [first, second] = [distinct(a), distinct(b)];
  return distinct(first.flatMap((one) => second.map((other) => [...one, ...other])));
}

/** The texts of a value that is one of several. */
export function either(all: readonly Texts[]): Texts {
  return distinct(all.flat());
}

/**
 * The texts of a constant or of what a method gives back, as the member that uses them has them: every character
 * stands at `at`, and the text a parameter stands for is the text the call gives (`args`).
 */
export function usedAt(texts: Texts, at: Pos, args: readonly (Texts | undefined)[] = []): Texts {
  let all: Texts = [];
  for (const text of texts) {
    let made: Texts = [[]];
    for (const piece of text) {
      if (piece.k === 'hole' && piece.param !== undefined) {
        made = joined(made, args[piece.param] ?? [holeText(at, piece.of)]);
      } else {
        const moved: Piece =
          piece.k === 'chars' ? { k: 'chars', text: piece.text, at } : { k: 'hole', at, of: piece.of };
        made = made.map((start) => [...start, moved]);
      }
    }
    all = distinct([...all, ...made]);
  }
  return all;
}

/** The place of the character `index` of a piece of characters. */
const placeIn = (piece: Extract<Piece, { k: 'chars' }>, index: number): Pos | undefined =>
  piece.at === undefined
    ? undefined
    : piece.columns === undefined
      ? piece.at
      : { line: piece.at.line, column: piece.columns[index] ?? piece.at.column };

/** The characters from `start` to `end` of a piece of characters, with their places. */
function slice(piece: Extract<Piece, { k: 'chars' }>, start: number, end = piece.text.length): Piece[] {
  if (end <= start) return [];
  const columns = piece.columns?.slice(start, end);
  const at = placeIn(piece, start);
  return [{ k: 'chars', text: piece.text.slice(start, end), at, ...(columns === undefined ? {} : { columns }) }];
}

/** The text, with each piece of characters changed by `change`, which keeps its length. */
export function mapped(text: Text, change: (chars: string) => string): Text {
  return text.map((piece) => (piece.k === 'chars' ? { ...piece, text: change(piece.text) } : piece));
}

/** The text without the white space it starts and ends with, as far as its characters say. */
export function trimmed(text: Text): Text {
  const pieces = [...text];
  // Pieces of white space alone go, up to the first piece that holds more or is not known.
  while (pieces[0]?.k === 'chars') {
    const first = pieces[0];
    const start = first.text.length - first.text.trimStart().length;
    pieces.splice(0, 1, ...slice(first, start));
    if (start < first.text.length) break;
  }
  for (let last = pieces.at(-1); last?.k === 'chars'; last = pieces.at(-1)) {
    const end = last.text.trimEnd().length;
    pieces.splice(pieces.length - 1, 1, ...slice(last, 0, end));
    if (end > 0) break;
  }
  return pieces;
}

/** The text without `end` at its end, where its last characters are `end`, also over several pieces. */
export function withoutEnd(text: Text, end: string): Text {
  if (end === '') return text;
  const pieces = [...text];
  let left = end;
  while (left !== '') {
    const last = pieces.at(-1);
    if (last?.k !== 'chars') return text;
    const take = Math.min(left.length, last.text.length);
    if (last.text.slice(last.text.length - take) !== left.slice(left.length - take)) return text;
    pieces.splice(pieces.length - 1, 1, ...slice(last, 0, last.text.length - take));
    left = left.slice(0, left.length - take);
  }
  return pieces;
}

/** The text without `start` at its start, where its first characters are `start`, also over several pieces. */
export function withoutStart(text: Text, start: string): Text {
  if (start === '') return text;
  const pieces = [...text];
  let left = start;
  while (left !== '') {
    const first = pieces[0];
    if (first?.k !== 'chars') return text;
    const take = Math.min(left.length, first.text.length);
    if (first.text.slice(0, take) !== left.slice(0, take)) return text;
    pieces.splice(0, 1, ...slice(first, take));
    left = left.slice(take);
  }
  return pieces;
}

/** The text with a backslash in front of each single quote, as `String.escapeSingleQuotes` gives it. */
export function escaped(text: Text): Text {
  return text.flatMap((piece): Piece[] => {
    if (piece.k !== 'chars' || !piece.text.includes("'")) return [piece];
    const pieces: Piece[] = [];
    let from = 0;
    for (let index = piece.text.indexOf("'"); index !== -1; index = piece.text.indexOf("'", index + 1)) {
      pieces.push(...slice(piece, from, index));
      const at = placeIn(piece, index);
      pieces.push({ k: 'chars', text: "\\'", at, ...(at === undefined ? {} : { columns: [at.column, at.column] }) });
      from = index + 1;
    }
    pieces.push(...slice(piece, from));
    return pieces;
  });
}

/** The whole text of characters a text is, or `undefined` where a part of it is not known. */
export function known(text: Text): string | undefined {
  let whole = '';
  for (const piece of text) {
    if (piece.k === 'hole') return undefined;
    whole += piece.text;
  }
  return whole;
}

/**
 * The texts of `String.format(format, args)`, which reads the format as Java's `MessageFormat` does: each `{0}`,
 * `{1}` is the text of that item of the arguments, or a part that is not known. Two single quotes are one, and a
 * single quote starts or ends a part that is taken as it is.
 */
export function formatted(format: Text, items: readonly (Texts | undefined)[] | undefined, at: Pos): Texts {
  let made: Texts = [[]];
  const add = (parts: Texts): void => {
    made = joined(made, parts);
  };
  let quoted = false;
  for (const piece of format) {
    if (piece.k === 'hole') {
      add([[piece]]);
      continue;
    }
    let from = 0;
    let index = 0;
    while (index < piece.text.length) {
      const char = piece.text.charAt(index);
      if (char === "'") {
        add([slice(piece, from, index)]);
        // `''` is a quote. One alone starts or ends a part taken as it is, and is no character of the text.
        if (piece.text.charAt(index + 1) === "'") {
          add([slice(piece, index, index + 1)]);
          index += 2;
        } else {
          quoted = !quoted;
          index += 1;
        }
        from = index;
        continue;
      }
      const item = quoted ? null : /^\{(\d+)\}/.exec(piece.text.slice(index));
      if (item !== null) {
        add([slice(piece, from, index)]);
        const given = items?.[Number(item[1])];
        add(given ?? [holeText(placeIn(piece, index) ?? at, 'text')]);
        index += item[0].length;
        from = index;
        continue;
      }
      index += 1;
    }
    add([slice(piece, from)]);
  }
  return distinct(made);
}

/** A name that a text is as a whole, with the place of its first character. */
export interface NameInText {
  readonly text: string;
  readonly at: Pos | undefined;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * What a text that should be one name is: the name, where its characters are known and are one name, or the place
 * of what is not known in it, or of its first character where they are no name.
 */
export function nameIn(text: Text): { readonly name: NameInText } | { readonly unknown: Pos | undefined } {
  const whole = known(text);
  // An empty piece of characters, which a call that gives an empty text leaves, stands nowhere in the name.
  const first = text.find((piece) => piece.k !== 'chars' || piece.text !== '') ?? text[0];
  const start = first === undefined ? undefined : first.k === 'chars' ? placeIn(first, 0) : first.at;
  if (whole !== undefined && NAME.test(whole)) return { name: { text: whole, at: start } };
  const hole = text.find((piece) => piece.k === 'hole');
  return { unknown: hole?.at ?? start };
}

/** A part that is not known of a text that was put together to be read as a query or a search. */
interface Filled {
  /** Where the filler stands in the text. */
  readonly start: number;
  readonly end: number;
  readonly at: Pos | undefined;
  /** Inside a literal of the query: what stands there is no name. */
  readonly quoted: boolean;
  /** A name stands for it in the text, which can be a field or an object. */
  readonly named: boolean;
}

export interface Composed {
  /** The text on one line, with a filler for each part that is not known. */
  readonly source: string;
  /** The place of each character of the text. */
  readonly places: readonly (Pos | undefined)[];
  readonly filled: readonly Filled[];
}

/** The word that ends `before`, in lower case, or its last character that is no part of a word. */
function lastWord(before: string): string {
  const trimmed = before.trimEnd();
  const word = /[A-Za-z_][A-Za-z0-9_]*$/.exec(trimmed)?.[0];
  return (word ?? trimmed.slice(-1)).toLowerCase();
}

/** The word that starts `after`, in lower case, or its first character that is no part of a word. */
function firstWord(after: string): string {
  const trimmed = after.trimStart();
  const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed)?.[0];
  return (word ?? trimmed.slice(0, 1)).toLowerCase();
}

/** The words and characters after which a part that is not known is a condition, a value, a list or a number. */
const CONDITION_AFTER: ReadonlySet<string> = new Set(['where', 'and', 'or', 'not', 'having', '(']);
const VALUE_AFTER: ReadonlySet<string> = new Set(['=', '<', '>', 'like']);
const LIST_AFTER: ReadonlySet<string> = new Set(['in', 'includes', 'excludes']);
const NUMBER_AFTER: ReadonlySet<string> = new Set(['limit', 'offset']);
/** What makes the part before it the field of a condition. */
const OPERATOR_NEXT = /^\s*(?:[=!<>]|(?:in|not|like|includes|excludes)\b)/i;
/** The words and characters after which a query or a search needs more: anything else can end one. */
const NEEDS_MORE: ReadonlySet<string> = new Set([
  ...CONDITION_AFTER,
  ...VALUE_AFTER,
  ...LIST_AFTER,
  ...NUMBER_AFTER,
  'select',
  'from',
  'by',
  'group',
  'order',
  'with',
  'using',
  'scope',
  'returning',
  'find',
  'typeof',
  'when',
  'then',
  'else',
  'nulls',
  'for',
  ',',
  '!',
  ':',
  '.',
]);
/** The last clause of a query is its `ORDER BY`, and its last item ends in a name or a bracket. */
const ORDERED = /\border\s+by\s+(?:(?!\b(?:limit|offset|for|where|from|select)\b)[^)])*[A-Za-z0-9_)]\s+$/i;
/** The last clause of a query is its select list, and it ends in a name. */
const SELECTED = /\bselect\s+(?:(?!\bfrom\b).)*[A-Za-z0-9]$/i;

/**
 * What fills a part that is not known of a text of a query or a search, by what stands around it, and whether it
 * names something. A part in a literal of the query, or in the braces of a search, is a word of it, and a bind after
 * a colon is no name of the query. A part that stands in a name is part of the name, as the prefix of a namespace in
 * `ns + '__Field__c'`, but after a whole name in the select list it is more of the list, and after a whole name or
 * value at the end of the text it is the rest of the query, which can be nothing. Otherwise it is a number where a
 * number is, and a value after an operator, which is never a name. Before `FROM`, it ends the select list, or is it.
 * At the start of a query that has no `FROM` after it, it is the start of the query up to its object. After `WHERE`
 * and its relatives it is a condition, and elsewhere a name, which the reader takes for a field, an object or an
 * alias.
 */
function fillerOf(
  piece: Extract<Piece, { k: 'hole' }>,
  where: { readonly quoted: boolean; readonly braced: boolean },
  before: string,
  after: string,
  name: string,
): { readonly filler: string; readonly named: boolean } {
  const word = lastWord(before);
  const next = firstWord(after);
  const value = (filler: string): { filler: string; named: boolean } => ({ filler, named: false });
  if (where.quoted || where.braced) return value('x');
  if (word === ':') {
    // `LAST_N_DAYS:` takes a number, and anything else after a colon is a bind of Apex.
    return /[A-Za-z]_N_[A-Za-z_]*\s*:\s*$/i.test(before) ? value('0') : value(name);
  }
  const atEnd = after.trim() === '';
  if (/^[A-Za-z0-9_]/.test(after)) return { filler: name, named: true };
  if (/[A-Za-z0-9_]$/.test(before)) {
    if (SELECTED.test(before)) return { filler: `, ${name}`, named: true };
    if (atEnd && !NEEDS_MORE.has(word)) return { filler: '', named: true };
    return { filler: name, named: true };
  }
  if (piece.of === 'number' || NUMBER_AFTER.has(word)) return value('0');
  if (piece.of === 'boolean') return value('true');
  if (piece.of === 'date') return value('2000-01-01');
  if (piece.of === 'datetime') return value('2000-01-01T00:00:00Z');
  if (VALUE_AFTER.has(word)) return value('null');
  if (LIST_AFTER.has(word)) return value(next === 'fields' ? 'ALL' : '(null)');
  if (word === '(' && LIST_AFTER.has(lastWord(before.trimEnd().slice(0, -1)))) return value('null');
  if (word === 'with') return value('SECURITY_ENFORCED');
  if (word === 'scope') return value('Everything');
  if (word === 'find') return value("'x'");
  // The direction after a field of `ORDER BY`.
  if (ORDERED.test(before) && !/\b(?:asc|desc|nulls|first|last)\s*$/i.test(before)) return value('ASC');
  if (atEnd && before.trim() !== '' && !NEEDS_MORE.has(word)) return { filler: '', named: true };
  if (next === 'from' && word !== 'select' && word !== ',') return { filler: `SELECT ${name}`, named: true };
  if (before.trim() === '' && next !== 'select' && next !== 'find') {
    return { filler: /\bfrom\b/i.test(after) ? `SELECT ${name}` : `SELECT ${name} FROM ${name}x`, named: true };
  }
  // A condition, unless an operator follows, which makes it the field of one. A bracket opens a condition only
  // where it stands where a condition can, and is otherwise the list of a function or of an object of a search.
  const opens = word !== '(' || /(?:^|\b(?:where|and|or|not|having)|\()\s*\($/i.test(before.trimEnd());
  if (CONDITION_AFTER.has(word) && opens && !OPERATOR_NEXT.test(after))
    return { filler: `${name} != null`, named: true };
  return { filler: name, named: true };
}

/**
 * A text put together to be read as a query or a search. A part that is not known is filled with what can stand
 * there (`fillerOf`). The text is put on one line, and each character keeps its place.
 */
export function composed(text: Text): Composed {
  let source = '';
  const places: (Pos | undefined)[] = [];
  const filled: Filled[] = [];
  let quoted = false;
  // In the braces after `FIND`, which the reader of the engine knows as a literal in quotes, as a search in brackets
  // writes it. Each character in them is a letter, so that none ends the literal.
  let braced = false;
  // A backslash in the braces takes the next character as it is.
  let escaping = false;
  text.forEach((piece, index) => {
    if (piece.k === 'chars') {
      for (let at = 0; at < piece.text.length; at += 1) {
        const char = piece.text.charAt(at);
        places.push(placeIn(piece, at));
        if (braced) {
          const closes = char === '}' && !escaping;
          escaping = !escaping && char === '\\';
          braced = !closes;
          source += closes ? "'" : 'x';
          continue;
        }
        if (char === '{' && !quoted && lastWord(source) === 'find') {
          braced = true;
          source += "'";
          continue;
        }
        if (char === "'" && !source.endsWith('\\')) quoted = !quoted;
        source += /\s/.test(char) ? ' ' : char;
      }
      return;
    }
    // The characters up to the next part that is not known.
    let after = '';
    for (const next of text.slice(index + 1)) {
      if (next.k === 'hole') break;
      after += next.text;
    }
    const { filler, named } = fillerOf(
      piece,
      { quoted, braced },
      source,
      after,
      `zzOrgLensHole${String(filled.length)}`,
    );
    filled.push({ start: source.length, end: source.length + filler.length, at: piece.at, quoted, named });
    source += filler;
    places.push(...Array.from({ length: filler.length }, () => piece.at));
  });
  return { source, places, filled };
}
