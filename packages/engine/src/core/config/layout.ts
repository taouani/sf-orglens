/**
 * Where things are in the text of a TOML file.
 *
 * The TOML parser gives values without positions. Two features need
 * positions: a message about a wrong value names its line and column, and
 * `source remove` deletes the lines of one table and leaves every other
 * line, with its comments, untouched.
 *
 * This is a reader of layout, not a second TOML parser. It is only used on
 * text the parser has accepted. It knows table headers, the keys that start
 * a line, strings and brackets. It does not look inside inline tables and
 * arrays: a path that ends in one gets the position of the key that holds it.
 */

interface TextPosition {
  /** Starts at 1. */
  readonly line: number;
  /** Starts at 1, counted in UTF-16 code units like the positions of the TOML parser. */
  readonly column: number;
}

/** One table header and the lines up to the next header. */
interface TableBlock {
  readonly path: readonly string[];
  /** The line of the header. Starts at 1. */
  readonly startLine: number;
  /** The last line before the next header, or the last line of the file. */
  readonly endLine: number;
  /** The last line that belongs to the header or to a key and its value. Comments and blank lines after it do not. */
  readonly contentEndLine: number;
  /** True for `[[name]]`. */
  readonly arrayOfTables: boolean;
}

export interface TomlLayout {
  /** The position of a key or a table. An unknown path gets the position of its nearest known parent. */
  positionOf(path: readonly (string | number)[]): TextPosition;
  /** The table headers in the order of the file. */
  readonly blocks: readonly TableBlock[];
  /** Paths of the keys written at the start of a line, in the order of the file, with the table they are in. */
  readonly keys: readonly (readonly string[])[];
}

const BARE_KEY = /[A-Za-z0-9_-]+/y;
const SEPARATOR = '\u0000';

/** Reads a dotted key such as `a."b c".d` at `start`. Returns its parts and the index after it. */
function readKey(line: string, start: number): { parts: string[]; end: number } | undefined {
  const parts: string[] = [];
  let at = start;
  for (;;) {
    while (line[at] === ' ' || line[at] === '\t') at += 1;
    const quote = line[at];
    if (quote === '"' || quote === "'") {
      let end = at + 1;
      while (end < line.length && line[end] !== quote) end += quote === '"' && line[end] === '\\' ? 2 : 1;
      if (end >= line.length) return undefined;
      const raw = line.slice(at + 1, end);
      try {
        parts.push(quote === '"' ? (JSON.parse(`"${raw}"`) as string) : raw);
      } catch {
        // An escape JSON does not have. The raw text is close enough for a position.
        parts.push(raw);
      }
      at = end + 1;
    } else {
      BARE_KEY.lastIndex = at;
      const bare = BARE_KEY.exec(line);
      if (bare === null) return undefined;
      parts.push(bare[0]);
      at += bare[0].length;
    }
    while (line[at] === ' ' || line[at] === '\t') at += 1;
    if (line[at] !== '.') return { parts, end: at };
    at += 1;
  }
}

/** What is still open at the end of a line: a multi-line string, or brackets of an array or inline table. */
interface Open {
  text: '"""' | "'''" | undefined;
  depth: number;
}

/** Moves over the text of a value and records what it leaves open. */
function scanValue(line: string, start: number, open: Open): void {
  let at = start;
  while (at < line.length) {
    if (open.text !== undefined) {
      const close = line.indexOf(open.text, at);
      if (close === -1) return;
      // In a basic string a backslash escapes the quote after it, unless the backslash is escaped itself:
      // an odd number of backslashes before the quotes means that the first quote belongs to the text.
      if (open.text === '"""') {
        let backslashes = 0;
        while (line[close - 1 - backslashes] === '\\') backslashes += 1;
        if (backslashes % 2 === 1) {
          at = close + 1;
          continue;
        }
      }
      at = close + 3;
      // Up to two more quotes can belong to the string.
      while (line[at] === open.text[0]) at += 1;
      open.text = undefined;
      continue;
    }
    const char = line[at];
    if (char === '#') return;
    if (line.startsWith('"""', at) || line.startsWith("'''", at)) {
      open.text = line.slice(at, at + 3) as '"""' | "'''";
      at += 3;
    } else if (char === '"') {
      at += 1;
      while (at < line.length && line[at] !== '"') at += line[at] === '\\' ? 2 : 1;
      at += 1;
    } else if (char === "'") {
      const close = line.indexOf("'", at + 1);
      at = close === -1 ? line.length : close + 1;
    } else {
      if (char === '[' || char === '{') open.depth += 1;
      if (char === ']' || char === '}') open.depth -= 1;
      at += 1;
    }
  }
}

/** Reads the layout of a TOML text. */
export function readLayout(text: string): TomlLayout {
  const lines = text.split('\n');
  const positions = new Map<string, TextPosition>();
  const blocks: {
    path: string[];
    startLine: number;
    endLine: number;
    contentEndLine: number;
    arrayOfTables: boolean;
  }[] = [];
  const keys: string[][] = [];
  const open: Open = { text: undefined, depth: 0 };
  let table: string[] = [];

  const remember = (path: readonly string[], position: TextPosition): void => {
    // Every prefix of a path is known where the path is first written.
    for (let length = 1; length <= path.length; length += 1) {
      const id = path.slice(0, length).join(SEPARATOR);
      if (!positions.has(id)) positions.set(id, position);
    }
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (open.text !== undefined || open.depth > 0) {
      // A line inside a value that spans lines, whatever it looks like.
      scanValue(line, 0, open);
      const current = blocks.at(-1);
      if (current !== undefined) current.contentEndLine = lineNumber;
      return;
    }
    let at = 0;
    while (line[at] === ' ' || line[at] === '\t') at += 1;
    const first = line[at];
    if (first === undefined || first === '#' || first === '\r') return;

    if (first === '[') {
      const arrayOfTables = line[at + 1] === '[';
      const key = readKey(line, at + (arrayOfTables ? 2 : 1));
      if (key === undefined) return;
      table = key.parts;
      remember(table, { line: lineNumber, column: at + 1 });
      const previous = blocks.at(-1);
      if (previous !== undefined) previous.endLine = lineNumber - 1;
      blocks.push({
        path: table,
        startLine: lineNumber,
        endLine: lines.length,
        contentEndLine: lineNumber,
        arrayOfTables,
      });
      return;
    }

    const key = readKey(line, at);
    if (key?.end === undefined || line[key.end] !== '=') return;
    const path = [...table, ...key.parts];
    remember(path, { line: lineNumber, column: at + 1 });
    keys.push(path);
    const current = blocks.at(-1);
    if (current !== undefined) current.contentEndLine = lineNumber;
    scanValue(line, key.end + 1, open);
  });

  return {
    blocks,
    keys,
    positionOf(path) {
      const names = path.map(String);
      for (let length = names.length; length > 0; length -= 1) {
        const position = positions.get(names.slice(0, length).join(SEPARATOR));
        if (position !== undefined) return position;
      }
      return { line: 1, column: 1 };
    },
  };
}
