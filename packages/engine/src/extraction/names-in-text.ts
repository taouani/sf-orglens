/**
 * The names in a text of another language, as references before they are resolved: the names of a formula, and
 * the merge fields of a text.
 *
 * `formula.ts` reads the formula language and `merge-fields.ts` finds the merge fields of a text.
 * `formula-names.ts` says what a name stands for. This file gives each part of a name its place in the file,
 * through the function its caller hands it, and says what was not read.
 *
 * Three ways of writing are read. The formula of a field, of a rule and of a workflow rule has plain names, each
 * a path from the object the formula belongs to. The formula of a flow has merge fields where that one has names.
 * A text with merge fields, such as a message of a flow or the subject of an email, is no formula: only what
 * stands between the braces of a merge field is read, and it is read as one name.
 */
import { cut } from './analysed.ts';
import { namesOfTokens, namesOfTree, parseFormula, type FormulaName } from './formula.ts';
import { usesOfMergeField, usesOfName, type MergeStart, type NamePart, type NameUse } from './formula-names.ts';
import { mergeFieldsOf } from './merge-fields.ts';
import type { PathHint } from './model.ts';
import { LONGEST_TEXT_SHOWN, type RawReference, type Unread, type Via } from './raw-references.ts';
import type { NameAt, PlaceOf } from './values.ts';

/** What one formula says. */
export interface FormulaReading {
  /** The element that holds the formula. */
  readonly element: string;
  readonly references: readonly RawReference[];
  /** The names of the formula that are not read. */
  readonly unread: readonly Unread[];
  /** Why the formula was not read as a whole, and where. `null` if it was. */
  readonly problem: { readonly message: string; readonly line: number; readonly column: number } | null;
}

/** What the merge fields of one text say. */
export interface MergeFieldsReading {
  /** The element that holds the text. */
  readonly element: string;
  readonly references: readonly RawReference[];
  /** The merge fields that are not read as a name. */
  readonly unread: readonly Unread[];
  /** Where a merge field opens that is not closed. Nothing is read of it. */
  readonly notClosed: readonly { readonly line: number; readonly column: number }[];
}

/**
 * What the first name of a merge field is. `undefined` for a name the caller does not know. The name comes as
 * the text writes it: a caller for whom capitals make no difference folds them itself.
 */
export type StartOf = (first: string) => MergeStart | undefined;

/** The uses of one name as references. `start` is where the name starts in the value. */
function referencesOf(
  uses: readonly NameUse[],
  start: number,
  at: PlaceOf,
  said: { readonly via: Via; readonly tier?: 'probable'; readonly value?: string },
): RawReference[] {
  const { value, ...raw } = said;
  const placed = (part: NamePart): NameAt & PathHint => {
    const { leadsTo, resolveAs } = part;
    return {
      ...at(start + part.from, start + part.from + part.name.length),
      ...(leadsTo === undefined ? {} : { leadsTo }),
      ...(resolveAs === undefined ? {} : { resolveAs }),
    };
  };
  return uses.map((use): RawReference => {
    if (use.form === 'object') return { form: 'object', at: placed(use.part), ...raw };
    if (use.form === 'component') {
      const { type, fullName } = use;
      return { form: 'component', type, fullName, at: placed(use.part), ...raw };
    }
    return {
      form: 'path',
      start: use.start,
      names: use.parts.map(placed),
      kind: 'reads',
      ...raw,
      ...(value === undefined ? {} : { value }),
    };
  });
}

/** Reads a formula whose names `usesOf` knows. */
function reading(
  text: string,
  mergeFields: boolean,
  usesOf: (name: FormulaName) => readonly NameUse[] | null,
  element: string,
  at: PlaceOf,
): FormulaReading {
  const parsed = parseFormula(text, { mergeFields });
  const references: RawReference[] = [];
  const unread: Unread[] = [];
  const tier = parsed.tree === null ? { tier: 'probable' as const } : {};
  for (const name of parsed.tree === null ? namesOfTokens(parsed.tokens) : namesOfTree(parsed.tree)) {
    const uses = usesOf(name);
    if (uses === null) {
      const { line, column } = at(name.start, name.start);
      unread.push({ element, text: cut(name.text, LONGEST_TEXT_SHOWN), line, column });
      continue;
    }
    const value = name.value === undefined ? {} : { value: name.value };
    // One at a time: a formula can hold more names than a call takes arguments.
    for (const reference of referencesOf(uses, name.start, at, { via: 'formula', ...tier, ...value })) {
      references.push(reference);
    }
  }
  let problem: FormulaReading['problem'] = null;
  if (parsed.problem !== null) {
    const { line, column } = at(parsed.problem.at, parsed.problem.at);
    problem = { message: parsed.problem.message, line, column };
  }
  return { element, references, unread, problem };
}

/**
 * Reads a formula with plain names: the formula of a field, its default value, the condition of a rule. `own`
 * is the object the formula belongs to, `element` the element that holds it, and `at` gives the places of its
 * parts. A formula that cannot be read as a whole still gives the names among its tokens, each marked as less
 * certain.
 */
export function readFormula(text: string, own: string, element: string, at: PlaceOf): FormulaReading {
  return reading(text, false, (name) => usesOfName(name.text, own), element, at);
}

/**
 * Reads a formula as a flow writes it, with merge fields where the formula of a field has names. `startOf` says
 * what the first name of a merge field is. A name outside braces is no name of such a formula: it is not read,
 * and the reading says so.
 */
export function readFormulaOfMergeFields(text: string, startOf: StartOf, element: string, at: PlaceOf): FormulaReading {
  const usesOf = (name: FormulaName): readonly NameUse[] | null =>
    name.mergeField === true ? usesOfMergeField(name.text, startOf) : null;
  return reading(text, true, usesOf, element, at);
}

/**
 * Reads the merge fields of a text that is no formula. What stands between two merge fields is left alone, and
 * what stands in one is read as one name. A merge field that holds anything else, a call or an operator, is not
 * read, and the reading says so.
 */
export function readMergeFields(text: string, startOf: StartOf, element: string, at: PlaceOf): MergeFieldsReading {
  const { fields, notClosed } = mergeFieldsOf(text);
  const references: RawReference[] = [];
  const unread: Unread[] = [];
  for (const field of fields) {
    const uses = usesOfMergeField(field.text, startOf);
    if (uses === null) {
      const { line, column } = at(field.start, field.start);
      unread.push({ element, text: cut(field.text, LONGEST_TEXT_SHOWN), line, column });
      continue;
    }
    for (const reference of referencesOf(uses, field.start, at, { via: 'merge-field' })) references.push(reference);
  }
  return {
    element,
    references,
    unread,
    notClosed: notClosed.map((open) => {
      const { line, column } = at(open, open);
      return { line, column };
    }),
  };
}
