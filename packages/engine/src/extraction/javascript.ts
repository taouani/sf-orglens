/**
 * The reader of the JavaScript of a Lightning component (decision record 0094). It reads what a module imports and
 * what it exports from another module, and nothing else: the names of the modules, each with the place of its first
 * character. It is no parser of JavaScript. It knows enough of the language to step over what holds no import: a
 * comment, a string, a template, a regular expression and the code between them.
 *
 * It works on the text of a file and gives indexes of that text, which the caller turns into places. It throws for
 * nothing a file can hold. Where it cannot go on, as at a string that is not closed, it says where it stopped, and
 * what it read before is kept.
 */

/** A module a file imports or exports from, as the file names it. */
interface ModuleImport {
  /** The name of the module, as the text of its string gives it. */
  readonly specifier: string;
  /** The index of the first character of the name, after the quote. */
  readonly start: number;
  /** The index of the quote that closes the name. */
  readonly end: number;
  /**
   * Whether the string writes a character with an escape, as `@`. Then the characters of the name do not each
   * stand at their own column, and the name is not read.
   */
  readonly escaped: boolean;
}

/** What a file of JavaScript imports, and what of it is not read. */
export interface ModuleReading {
  readonly imports: readonly ModuleImport[];
  /**
   * Forms of an import that are not read, by the index where they start: `import(...)`, which imports a module
   * while the code runs, and an import or an export whose clause is of no form the reader knows.
   */
  readonly unread: readonly { readonly what: 'dynamic' | 'clause'; readonly start: number }[];
  /** Where the reader stopped before the end of the file, and at what. `null`: it read the whole file. */
  readonly stop: { readonly at: number; readonly what: 'string' | 'comment' | 'template' | 'expression' } | null;
}

type TokenKind = 'name' | 'string' | 'number' | 'punctuator' | 'template' | 'regex';

interface Token {
  readonly kind: TokenKind;
  /** The name, the punctuator, or the value of a string. Empty for the other kinds. */
  readonly text: string;
  readonly start: number;
  /** Of a string: the index after the quote that closes it. */
  readonly end?: number;
  /** Of a string: whether it writes a character with an escape. */
  readonly escaped?: boolean;
}

/**
 * The names after which a slash starts a regular expression and not a division: they end no value. Any other name
 * ends one, as a variable or `this` does, and so does any name after a `.`, which is a property, as `a.return`.
 */
const BEFORE_EXPRESSION: ReadonlySet<string> = new Set([
  'await',
  'case',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
]);

/** The punctuators after which a slash divides: they end a value. After any other, a slash starts an expression. */
const END_A_VALUE: ReadonlySet<string> = new Set([')', ']', '}']);

const isNameStart = (code: number): boolean =>
  (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) || code === 0x24 || code === 0x5f || code >= 0x80;
const isNamePart = (code: number): boolean => isNameStart(code) || (code >= 0x30 && code <= 0x39);
const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;
const isLineEnd = (code: number): boolean => code === 0x0a || code === 0x0d || code === 0x2028 || code === 0x2029;

/** Thrown where the reader cannot go on. */
class Stop extends Error {
  readonly at: number;
  readonly what: 'string' | 'comment' | 'template' | 'expression';
  constructor(at: number, what: 'string' | 'comment' | 'template' | 'expression') {
    super(what);
    this.at = at;
    this.what = what;
  }
}

/** The tokens of a text, one at a time. A template stands for its text up to the next `${` or its end. */
function tokens(text: string): () => Token | null {
  let index = 0;
  /**
   * For each brace that is open: the index of the template whose code it opens (`${`), or `null` for a block or an
   * object.
   */
  const braces: (number | null)[] = [];
  /** Whether a slash here starts a regular expression. */
  let expressionNext = true;
  /** Whether the token before is a `.`. */
  let afterDot = false;

  /**
   * Steps over the text of a template from `from`, after a backtick or a `}` that closes `${`. `origin` is the index
   * of the backtick that opens the template.
   */
  const templateText = (from: number, start: number, origin: number): Token => {
    let at = from;
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (code === 0x5c) at += 2;
      else if (code === 0x60) {
        index = at + 1;
        expressionNext = false;
        return { kind: 'template', text: '', start };
      } else if (code === 0x24 && text.charCodeAt(at + 1) === 0x7b) {
        braces.push(origin);
        index = at + 2;
        expressionNext = true;
        return { kind: 'template', text: '', start };
      } else at += 1;
    }
    throw new Stop(origin, 'template');
  };

  const string = (quote: number, start: number): Token => {
    let value = '';
    let escaped = false;
    let at = start + 1;
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (code === quote) {
        index = at + 1;
        expressionNext = false;
        return { kind: 'string', text: value, start, end: index, escaped };
      }
      // A string may hold U+2028 and U+2029, and no other end of a line.
      if (code === 0x0a || code === 0x0d) break;
      if (code === 0x5c) {
        escaped = true;
        if (text.startsWith('\r\n', at + 1)) {
          // A line that goes on after a backslash, with the two characters that end a line on Windows.
          at += 3;
          continue;
        }
        // The character after the backslash, as itself. A name of a module holds no escape that means more.
        value += text.charAt(at + 1);
        at += 2;
      } else {
        value += text.charAt(at);
        at += 1;
      }
    }
    throw new Stop(start, 'string');
  };

  const regex = (start: number): Token => {
    let at = start + 1;
    let inClass = false;
    while (at < text.length) {
      const code = text.charCodeAt(at);
      if (isLineEnd(code)) break;
      if (code === 0x5c) at += 2;
      else {
        if (code === 0x5b) inClass = true;
        else if (code === 0x5d) inClass = false;
        else if (code === 0x2f && !inClass) {
          at += 1;
          while (at < text.length && isNamePart(text.charCodeAt(at))) at += 1;
          index = at;
          expressionNext = false;
          return { kind: 'regex', text: '', start };
        }
        at += 1;
      }
    }
    throw new Stop(start, 'expression');
  };

  const read = (): Token | null => {
    for (;;) {
      if (index >= text.length) {
        // The file ends in the code of a template.
        const open = braces.find((one) => one !== null);
        if (open !== undefined) throw new Stop(open, 'template');
        return null;
      }
      const start = index;
      const code = text.charCodeAt(index);
      const after = text.charCodeAt(index + 1);
      if (code === 0x20 || code === 0x09 || code === 0x0b || code === 0x0c || code === 0xa0 || code === 0xfeff) {
        index += 1;
      } else if (isLineEnd(code)) {
        index += 1;
      } else if (code === 0x2f && after === 0x2f) {
        while (index < text.length && !isLineEnd(text.charCodeAt(index))) index += 1;
      } else if (code === 0x2f && after === 0x2a) {
        const end = text.indexOf('*/', index + 2);
        if (end === -1) throw new Stop(start, 'comment');
        index = end + 2;
      } else if (start === 0 && code === 0x23 && after === 0x21) {
        // A line that names the program to run the file with.
        while (index < text.length && !isLineEnd(text.charCodeAt(index))) index += 1;
      } else if (code === 0x27 || code === 0x22) {
        return string(code, start);
      } else if (code === 0x60) {
        return templateText(index + 1, start, start);
      } else if (isNameStart(code) || code === 0x23 || code === 0x5c) {
        // A private name starts with `#`, and a name can start with an escape of a character.
        index += 1;
        while (index < text.length) {
          const next = text.charCodeAt(index);
          if (next === 0x5c) index += 2;
          else if (isNamePart(next)) index += 1;
          else break;
        }
        const name = text.slice(start, index);
        expressionNext = !afterDot && BEFORE_EXPRESSION.has(name);
        return { kind: 'name', text: name, start };
      } else if (isDigit(code) || (code === 0x2e && isDigit(after))) {
        index += 1;
        while (index < text.length) {
          const next = text.charCodeAt(index);
          const sign = (next === 0x2b || next === 0x2d) && /[eE]/.test(text.charAt(index - 1));
          if (isNamePart(next) || next === 0x2e || sign) index += 1;
          else break;
        }
        expressionNext = false;
        return { kind: 'number', text: '', start };
      } else if (code === 0x2f) {
        if (expressionNext) return regex(start);
        index += 1;
        expressionNext = true;
        return { kind: 'punctuator', text: '/', start };
      } else if (code === 0x7d && typeof braces.at(-1) === 'number') {
        const origin = braces.pop() ?? start;
        return templateText(index + 1, start, origin);
      } else {
        const char = text.charAt(index);
        if ((code === 0x2b || code === 0x2d) && after === code) {
          // `++` and `--` after a value leave it a value, and before one they leave the expression to come.
          index += 2;
          return { kind: 'punctuator', text: char + char, start };
        }
        index += 1;
        if (code === 0x7b) braces.push(null);
        else if (code === 0x7d) braces.pop();
        expressionNext = !END_A_VALUE.has(char);
        return { kind: 'punctuator', text: char, start };
      }
    }
  };

  return () => {
    const token = read();
    afterDot = token !== null && token.kind === 'punctuator' && token.text === '.';
    return token;
  };
}

/**
 * Reads what a module imports. An import is `import ... from 'name'` or `import 'name'`, and an export from another
 * module is `export ... from 'name'`. A name that is a property, as in `this.import` or `{ import: 1 }`, starts none,
 * and neither does a method named `import`, as `import(rows) { ... }` in a class.
 */
export function readModule(text: string): ModuleReading {
  const imports: ModuleImport[] = [];
  const unread: { what: 'dynamic' | 'clause'; start: number }[] = [];
  const next = tokens(text);
  /**
   * What is read: code, the start of an import or an export, its clause, the name after `from`, or what `import(`
   * holds, with the depth of its parentheses.
   */
  let state: 'code' | 'import' | 'export' | 'clause' | 'from' | 'call' = 'code';
  let parentheses = 0;
  let clauseOf: 'import' | 'export' = 'import';
  let statement = 0;
  let depth = 0;
  /** Whether the braces of the clause were closed. */
  let closed = false;
  let previous: Token | null = null;
  const add = (token: Token): void => {
    imports.push({
      specifier: token.text,
      start: token.start + 1,
      end: (token.end ?? token.start) - 1,
      escaped: token.escaped === true,
    });
  };
  try {
    for (let token = next(); token !== null; previous = token, token = next()) {
      const { kind, text: value } = token;
      if (state === 'import') {
        state = 'code';
        if (kind === 'string') add(token);
        else if (kind === 'punctuator' && value === '(') {
          state = 'call';
          parentheses = 1;
        } else if (kind === 'name' || (kind === 'punctuator' && (value === '*' || value === '{'))) {
          state = 'clause';
          depth = value === '{' ? 1 : 0;
          closed = false;
        }
        // `import.meta`, and `import` as the name of a property: no import.
        continue;
      }
      if (state === 'call') {
        if (parentheses > 0) {
          if (kind === 'punctuator' && value === '(') parentheses += 1;
          else if (kind === 'punctuator' && value === ')') parentheses -= 1;
          continue;
        }
        // `import(...)` imports a module while the code runs, unless a block follows it: then it declares a method
        // named `import`. The token is code again.
        if (!(kind === 'punctuator' && value === '{')) unread.push({ what: 'dynamic', start: statement });
        state = 'code';
      }
      if (state === 'export') {
        state = 'code';
        if (kind === 'punctuator' && (value === '*' || value === '{')) {
          state = 'clause';
          depth = value === '{' ? 1 : 0;
          closed = false;
        }
        continue;
      }
      if (state === 'clause') {
        if (closed && !(kind === 'name' && value === 'from')) {
          // After the braces of a clause comes `from`. An export without it, as `export { a, b }`, exports what the
          // module declares itself, and the token is code again.
          if (clauseOf === 'import') unread.push({ what: 'clause', start: statement });
          state = 'code';
        } else {
          if (kind === 'punctuator' && value === '{') depth += 1;
          else if (kind === 'punctuator' && value === '}') {
            depth -= 1;
            closed = depth === 0;
          } else if (kind === 'name' && value === 'from' && depth === 0) state = 'from';
          else if (
            kind === 'name' ||
            kind === 'string' ||
            (kind === 'punctuator' && (value === ',' || value === '*'))
          ) {
            // A name, `as`, `default`, `type`, or a name of a module namespace written as a string.
          } else {
            // A clause ends at its braces or at `from`. Any other end is of no known form.
            unread.push({ what: 'clause', start: statement });
            state = 'code';
          }
          if (depth < 0) {
            unread.push({ what: 'clause', start: statement });
            state = 'code';
          }
          continue;
        }
      }
      if (state === 'from') {
        state = 'code';
        if (kind === 'string') add(token);
        else unread.push({ what: 'clause', start: statement });
        continue;
      }
      const property = previous !== null && previous.kind === 'punctuator' && previous.text === '.';
      if (kind === 'name' && (value === 'import' || value === 'export') && !property) {
        state = value;
        clauseOf = value;
        statement = token.start;
      }
    }
    // A file can end after `export { a, b }` without a semicolon.
    if ((state === 'clause' && !(closed && clauseOf === 'export')) || state === 'from') {
      unread.push({ what: 'clause', start: statement });
    }
    if (state === 'call') unread.push({ what: 'dynamic', start: statement });
    return { imports, unread, stop: null };
  } catch (thrown) {
    if (!(thrown instanceof Stop)) throw thrown;
    return { imports, unread, stop: { at: thrown.at, what: thrown.what } };
  }
}
