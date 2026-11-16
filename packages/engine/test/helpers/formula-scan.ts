/**
 * A second opinion on the names of a formula. It is written without the reader of the engine, so that the two
 * can be held against each other. It shares two things with the reader: which characters a name is made of, and
 * that a backslash before the end of a comment keeps the comment open. So it checks what the reader does with
 * tokens, not what a token is.
 */

/** The words of the formula language that are no names. */
const WORDS = new Set(['true', 'false', 'null', 'not']);

/**
 * The names of a formula, found in the simplest way: the formula without its comments and its texts, and in it
 * every word that no bracket follows. It is not a parser. It is a second opinion on what a probe lists by hand.
 */
export function scanNames(formula: string): string[] {
  let code = '';
  for (let at = 0; at < formula.length;) {
    const here = formula[at] ?? '';
    if (formula.startsWith('/*', at)) {
      // A backslash keeps the end of a comment inside it.
      at += 2;
      while (at < formula.length && !formula.startsWith('*/', at)) at += formula.startsWith('\\*/', at) ? 3 : 1;
      at += 2;
      code += ' ';
    } else if (here === '"' || here === "'") {
      at += 1;
      while (at < formula.length && formula[at] !== here) at += formula[at] === '\\' ? 2 : 1;
      at += 1;
      code += ' ';
    } else {
      code += here;
      at += 1;
    }
  }
  const names: string[] = [];
  for (const found of code.matchAll(/[A-Za-z$][A-Za-z0-9_$:.#]*/g)) {
    const after = code.slice(found.index + found[0].length).trimStart();
    if (!after.startsWith('(') && !WORDS.has(found[0].toLowerCase())) names.push(found[0]);
  }
  return names;
}
