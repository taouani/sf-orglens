/**
 * Reads a formula of Salesforce: the formula of a field, a default value, the condition of a validation rule.
 *
 * Salesforce publishes no grammar of the language. This one follows the grammar of its open-source formula
 * engine for what a token is (names, numbers, texts, comments, operators), and reads a call as any name before
 * a bracket, so that a function Salesforce adds later does not break it. It does not know the functions, their
 * arguments or the kinds of their values: it reads a formula for the names in it.
 *
 * A formula it cannot read is not dropped. It says where it stopped, and gives the tokens it read, those after
 * that place too.
 *
 * A flow writes the same language with one difference: where the formula of a field has a name, it has a merge
 * field, `{!Resource.Path}`. `parseFormula` reads that way of writing when it is asked to.
 */

import { cut } from './analysed.ts';
import { closeOfMergeField, insideOfMergeField } from './merge-fields.ts';

/** A part of a formula. `start` and `end` count the code units of the text of the formula, from 0. */
interface Span {
  readonly start: number;
  readonly end: number;
}

export type FormulaToken = Span &
  /**
   * A name. `mergeField` is set for what stands between the braces of a merge field, which is the name then:
   * the token starts and ends with it, and the braces are part of no token.
   */
  (
    | { readonly kind: 'name'; readonly text: string; readonly mergeField?: true }
    | { readonly kind: 'number' }
    /** A text in quotes. `value` is what stands between them, with what a backslash keeps. */
    | { readonly kind: 'text'; readonly value: string }
    /** An operator, a bracket or a comma. */
    | { readonly kind: 'mark'; readonly text: string }
  );

export type FormulaNode = Span &
  (
    | { readonly kind: 'name'; readonly text: string; readonly mergeField?: true }
    /** `TRUE`, `FALSE` or `NULL`, in any case. */
    | { readonly kind: 'word'; readonly text: string }
    | { readonly kind: 'number' }
    | { readonly kind: 'text'; readonly value: string }
    /** A call. `text` is the name before the bracket, as written. */
    | { readonly kind: 'call'; readonly text: string; readonly args: readonly FormulaNode[] }
    /** An operator with what stands before and after it, or only after it. */
    | { readonly kind: 'operation'; readonly text: string; readonly operands: readonly FormulaNode[] }
  );

/** Why a formula was not read, and where: the code unit of the text of the formula, from 0. */
interface FormulaProblem {
  readonly message: string;
  readonly at: number;
}

export interface ParsedFormula {
  /** The formula as a tree, or `null` if it was not read. */
  readonly tree: FormulaNode | null;
  /**
   * The tokens that were read. A comment or a text that is not closed takes the rest of the formula with it. A
   * character that is no part of a formula is left out, and the tokens after it are read.
   */
  readonly tokens: readonly FormulaToken[];
  /** The problem that stands first in the text, whether it is one of the tokens or one of the tree. */
  readonly problem: FormulaProblem | null;
}

/** A name of a formula: letters, digits and underscores, with dots, and `$`, `:` and `#` as the engine allows them. */
const NAME = /[A-Za-z$][A-Za-z0-9_$:.#]*/y;
const NUMBER = /[0-9]+(?:\.[0-9]*)?|\.[0-9]+/y;
/**
 * White space, as a regular expression of JavaScript knows it: a no-break space and a form feed are among it.
 * The engine knows less: a formula with a no-break space between two names may be one that Salesforce refuses.
 * It is read here, because nothing else can be meant by it.
 */
const SPACE = /\s+/y;
/** The longer marks first. */
const MARKS = [
  '==',
  '<>',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '^',
  '=',
  '<',
  '>',
  '!',
  '&',
  '(',
  ')',
  ',',
];
/** What a backslash stands for with the letter after it. Before any other character it stands for that character. */
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', N: '\n', r: '\r', R: '\r', t: '\t', T: '\t' };

/** How tightly an operator between two values binds. A higher number binds first. */
const BINDS: Readonly<Record<string, number>> = {
  '||': 1,
  '&&': 2,
  '=': 3,
  '==': 3,
  '!=': 3,
  '<>': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '&': 5,
  '*': 6,
  '/': 6,
  '^': 7,
};
const SIGNS: ReadonlySet<string> = new Set(['-', '+', '!']);
const WORDS: ReadonlySet<string> = new Set(['true', 'false', 'null']);

/**
 * Brackets and calls may be nested this deep. Salesforce documents a limit of 3,900 characters for a formula
 * field, and the deepest formula of the public codebases is nested 6 deep.
 */
const DEEPEST_NESTING = 200;

/** At most this many characters of a token are shown in a problem. */
const LONGEST_TOKEN_SHOWN = 40;

/** Ends the reading. It never leaves `parseFormula`. */
class Stop extends Error {
  readonly at: number;

  constructor(message: string, at: number) {
    super(message);
    this.at = at;
  }
}

/** How a formula is written. */
export interface FormulaWriting {
  /**
   * True for the formula of a flow: `{!Resource.Path}` is a name. Without it a brace is no part of a formula. A
   * name outside braces is read as a name in both, and is marked in neither.
   */
  readonly mergeFields?: boolean;
}

/** The tokens of a formula. Comments and white space are no tokens. */
function tokensOf(text: string, mergeFields: boolean): { tokens: FormulaToken[]; problem: FormulaProblem | null } {
  const tokens: FormulaToken[] = [];
  let problem: FormulaProblem | null = null;
  const match = (pattern: RegExp, at: number): string | null => {
    pattern.lastIndex = at;
    return pattern.exec(text)?.[0] ?? null;
  };
  let at = 0;
  while (at < text.length) {
    const space = match(SPACE, at);
    if (space !== null) {
      at += space.length;
      continue;
    }
    const here = text.charAt(at);
    if (text.startsWith('/*', at)) {
      // A backslash keeps the end of a comment inside the comment.
      let end = at + 2;
      while (end < text.length && !text.startsWith('*/', end)) end += text.startsWith('\\*/', end) ? 3 : 1;
      if (end >= text.length) return { tokens, problem: problem ?? { message: 'A comment is not closed.', at } };
      at = end + 2;
      continue;
    }
    if (here === '"' || here === "'") {
      let value = '';
      let end = at + 1;
      while (end < text.length && text.charAt(end) !== here) {
        if (text.charAt(end) === '\\' && end + 1 < text.length) {
          const next = text.charAt(end + 1);
          value += ESCAPES[next] ?? next;
          end += 2;
        } else {
          value += text.charAt(end);
          end += 1;
        }
      }
      if (end >= text.length) return { tokens, problem: problem ?? { message: 'A text is not closed.', at } };
      tokens.push({ kind: 'text', value, start: at, end: end + 1 });
      at = end + 1;
      continue;
    }
    if (mergeFields && text.startsWith('{!', at)) {
      const close = closeOfMergeField(text, at);
      if (close === null) {
        // The name after the braces is still the name of a merge field. The first problem is the one that is told.
        problem ??= { message: 'A merge field is not closed.', at };
        const from = at + 2 + (match(SPACE, at + 2)?.length ?? 0);
        const opened = match(NAME, from);
        if (opened === null) {
          at += 2;
        } else {
          tokens.push({ kind: 'name', text: opened, start: from, end: from + opened.length, mergeField: true });
          at = from + opened.length;
        }
        continue;
      }
      const inside = insideOfMergeField(text, at, close);
      const end = inside.start + inside.text.length;
      tokens.push({ kind: 'name', text: inside.text, start: inside.start, end, mergeField: true });
      at = close + 1;
      continue;
    }
    const name = match(NAME, at);
    if (name !== null) {
      tokens.push({ kind: 'name', text: name, start: at, end: at + name.length });
      at += name.length;
      continue;
    }
    const number = match(NUMBER, at);
    if (number !== null) {
      tokens.push({ kind: 'number', start: at, end: at + number.length });
      at += number.length;
      continue;
    }
    const mark = MARKS.find((one) => text.startsWith(one, at));
    if (mark === undefined) {
      // The names after such a character are still names. The first problem is the one that is told.
      const shown = String.fromCodePoint(text.codePointAt(at) ?? 0);
      // A character that cannot be seen, or half of one, is told by its number.
      const told = /^[\p{C}\p{Z}]$/u.test(shown)
        ? `U+${(shown.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`
        : `"${shown}"`;
      problem ??= { message: `The character ${told} is not part of a formula.`, at };
      at += shown.length;
      continue;
    }
    tokens.push({ kind: 'mark', text: mark, start: at, end: at + mark.length });
    at += mark.length;
  }
  return { tokens, problem };
}

/** Reads a formula. It never throws for what the text holds. */
export function parseFormula(text: string, writing: FormulaWriting = {}): ParsedFormula {
  const { tokens, problem: inTokens } = tokensOf(text, writing.mergeFields === true);

  let next = 0;
  let depth = 0;
  const peek = (): FormulaToken | undefined => tokens[next];
  const isMark = (token: FormulaToken | undefined, mark: string): boolean =>
    token?.kind === 'mark' && token.text === mark;
  const stop = (expected: string): never => {
    const token = peek();
    if (token === undefined) throw new Stop(`The formula ends where ${expected} is expected.`, text.length);
    throw new Stop(
      `"${cut(text.slice(token.start, token.end), LONGEST_TOKEN_SHOWN)}" stands where ${expected} is expected.`,
      token.start,
    );
  };
  const deeper = (at: number): void => {
    depth += 1;
    if (depth > DEEPEST_NESTING) {
      throw new Stop(`The formula is nested more than ${String(DEEPEST_NESTING)} deep.`, at);
    }
  };

  /** A value with the operators after it that bind at least as tightly as `least`. */
  const expression = (least: number): FormulaNode => {
    let left = operand();
    for (;;) {
      const token = peek();
      const binds = token?.kind === 'mark' ? BINDS[token.text] : undefined;
      if (token?.kind !== 'mark' || binds === undefined || binds < least) return left;
      next += 1;
      const right = expression(binds + 1);
      left = { kind: 'operation', text: token.text, operands: [left, right], start: left.start, end: right.end };
    }
  };

  /** A value, with the signs before it. */
  const operand = (): FormulaNode => {
    // The signs before a value are read in a loop, so that many of them do not nest.
    const signs: { text: string; start: number }[] = [];
    for (;;) {
      const token = peek();
      if (token === undefined || token.kind === 'number' || token.kind === 'text') break;
      // `NOT` before a value without a bracket is a sign. Before a bracket it is a call. A merge field is neither.
      const isSign =
        token.kind === 'mark'
          ? SIGNS.has(token.text)
          : token.mergeField !== true && token.text.toLowerCase() === 'not' && !isMark(tokens[next + 1], '(');
      if (!isSign) break;
      signs.push({ text: token.text, start: token.start });
      next += 1;
    }
    let node = value();
    for (const sign of signs.reverse()) {
      node = { kind: 'operation', text: sign.text, operands: [node], start: sign.start, end: node.end };
    }
    return node;
  };

  const value = (): FormulaNode => {
    const token = peek();
    if (token === undefined) return stop('a value');
    if (token.kind === 'number') {
      next += 1;
      return { kind: 'number', start: token.start, end: token.end };
    }
    if (token.kind === 'text') {
      next += 1;
      return { kind: 'text', value: token.value, start: token.start, end: token.end };
    }
    if (token.kind === 'name') {
      next += 1;
      if (token.mergeField === true) {
        // A merge field is a name whatever it holds: never a word of the language, never the name of a call.
        return { kind: 'name', text: token.text, start: token.start, end: token.end, mergeField: true };
      }
      if (!isMark(peek(), '(')) {
        const kind = WORDS.has(token.text.toLowerCase()) ? 'word' : 'name';
        return { kind, text: token.text, start: token.start, end: token.end };
      }
      next += 1;
      deeper(token.start);
      const args: FormulaNode[] = [];
      if (!isMark(peek(), ')')) {
        for (;;) {
          args.push(expression(0));
          if (!isMark(peek(), ',')) break;
          next += 1;
        }
      }
      const close = peek();
      if (close === undefined || !isMark(close, ')')) return stop('a comma or a closing bracket');
      next += 1;
      depth -= 1;
      return { kind: 'call', text: token.text, args, start: token.start, end: close.end };
    }
    if (token.text === '(') {
      next += 1;
      deeper(token.start);
      const inner = expression(0);
      if (!isMark(peek(), ')')) return stop('a closing bracket');
      next += 1;
      depth -= 1;
      return inner;
    }
    return stop('a value');
  };

  try {
    if (tokens.length === 0) throw new Stop('The formula holds no value.', 0);
    const tree = expression(0);
    if (peek() !== undefined) stop('an operator or the end of the formula');
    // The tokens of a text with a problem in them can make a tree all the same. It is not given.
    return inTokens === null ? { tree, tokens, problem: null } : { tree: null, tokens, problem: inTokens };
  } catch (thrown) {
    if (!(thrown instanceof Stop)) throw thrown;
    const inTree = { message: thrown.message, at: thrown.at };
    return { tree: null, tokens, problem: inTokens !== null && inTokens.at <= inTree.at ? inTokens : inTree };
  }
}

/** A name in a formula that stands for something, and what the formula says about it. */
export interface FormulaName {
  /** The name as written, with its dots. */
  readonly text: string;
  /** Where it starts in the text of the formula. */
  readonly start: number;
  /** The value of a picklist that the formula compares the name with, if it does. */
  readonly value?: string;
  /** Set for a name that stands between the braces of a merge field. */
  readonly mergeField?: true;
}

/** The calls that compare a picklist, their first argument, with a value, their second. */
const COMPARES_PICKLIST: ReadonlySet<string> = new Set(['ispickval', 'includes']);

/**
 * The names of a formula that was read, in the order they stand: every name that is not the name of a call and
 * not `TRUE`, `FALSE` or `NULL`. A name in a comment or in a text is not one.
 */
export function namesOfTree(tree: FormulaNode): FormulaName[] {
  const names: FormulaName[] = [];
  // A list in place of recursion: the tree of a long chain of operators leans to one side.
  const open: { node: FormulaNode; value?: string }[] = [{ node: tree }];
  for (let item = open.pop(); item !== undefined; item = open.pop()) {
    const { node, value } = item;
    if (node.kind === 'name') {
      names.push({
        text: node.text,
        start: node.start,
        ...(value === undefined ? {} : { value }),
        ...(node.mergeField === true ? { mergeField: true as const } : {}),
      });
    } else if (node.kind === 'operation') {
      for (const operand of [...node.operands].reverse()) open.push({ node: operand });
    } else if (node.kind === 'call') {
      const [first, second] = node.args;
      const compared =
        COMPARES_PICKLIST.has(node.text.toLowerCase()) && node.args.length === 2 && second?.kind === 'text'
          ? second.value
          : undefined;
      // `PRIORVALUE(Status__c)` in the place of the picklist is the picklist as it was.
      const priorValue = node.text.toLowerCase() === 'priorvalue' && node.args.length === 1 ? value : undefined;
      for (const arg of [...node.args].reverse()) {
        const passed = arg === first ? (compared ?? priorValue) : undefined;
        open.push({ node: arg, ...(passed === undefined ? {} : { value: passed }) });
      }
    }
  }
  return names.sort((a, b) => a.start - b.start);
}

/**
 * The names among the tokens of a formula that was not read as a whole: every name that no bracket follows and
 * that is no word of the language. What they stand for is less certain than in a formula that was read.
 */
export function namesOfTokens(tokens: readonly FormulaToken[]): FormulaName[] {
  const names: FormulaName[] = [];
  tokens.forEach((token, index) => {
    if (token.kind !== 'name') return;
    if (token.mergeField === true) {
      names.push({ text: token.text, start: token.start, mergeField: true });
      return;
    }
    const after = tokens[index + 1];
    if (after?.kind === 'mark' && after.text === '(') return;
    const word = token.text.toLowerCase();
    if (WORDS.has(word) || word === 'not') return;
    names.push({ text: token.text, start: token.start });
  });
  return names;
}
