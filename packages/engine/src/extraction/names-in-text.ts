/**
 * The names in a text of another language, as references before they are resolved: the names of a formula, and
 * the merge fields of a text.
 *
 * `formula.ts` reads the formula language and `merge-fields.ts` finds the merge fields of a text.
 * `formula-names.ts` says what a name stands for. This file gives each part of a name its place in the file,
 * through the function its caller hands it, and says what was not read.
 *
 * Five ways of writing are read. The formula of a field, of a rule and of a workflow rule has plain names, each
 * a path from the object the formula belongs to. The formula of a predefined value of a quick action has plain
 * names that start with the object of the action, as a merge field starts with something the text around it
 * knows. The formula of a flow has merge fields where that one has names. A text with merge fields, such as a
 * message of a flow or the subject of an email, is no formula: only what stands between the braces of a merge
 * field is read, and it is read as one name. And a flow writes such a name without braces where an element holds
 * nothing else, as in `elementReference`.
 */
import { cut } from './analysed.ts';
import { namesOfTokens, namesOfTree, parseFormula, type FormulaName } from './formula.ts';
import { usesOfMergeField, usesOfName, type MergeStart, type NamePart, type NameUse } from './formula-names.ts';
import { mergeFieldsOf, type MergeForm } from './merge-fields.ts';
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

/** What the text around a name says of it. */
interface Said {
  readonly via: Via;
  readonly tier?: 'probable';
  /** The value of a picklist the name is compared with. */
  readonly value?: string;
  /** What is said of the field at the end of a path. A read where nothing is said. */
  readonly kind?: 'reads' | 'writes';
  /** A second thing that is said of that field. */
  readonly and?: 'writes';
}

/**
 * Why a name of a merge field is not read, where more is known than that it is no name: its first part is
 * built like a name and is nothing the text around it knows.
 */
function whyNot(name: string, startOf: StartOf): { readonly why?: 'start' } {
  const [first = ''] = name.split('.', 1);
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(first) && startOf(first) === undefined ? { why: 'start' } : {};
}

/** The uses of one name as references. `start` is where the name starts in the value. */
function referencesOf(uses: readonly NameUse[], start: number, at: PlaceOf, said: Said): RawReference[] {
  const { value, kind, and, ...raw } = said;
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
    if (use.form === 'unfollowed') {
      return { form: 'unfollowed', after: placed(use.after), names: use.parts.map(placed), ...raw };
    }
    return {
      form: 'path',
      start: use.start,
      names: use.parts.map(placed),
      kind: kind ?? 'reads',
      ...(and === undefined ? {} : { and }),
      ...raw,
      ...(value === undefined ? {} : { value }),
    };
  });
}

/**
 * Reads a formula whose names `usesOf` knows. `whyOf` says why a name it does not know is not read. `given` is
 * the tier of every name, where the caller knows that they are less certain.
 */
function reading(
  text: string,
  mergeFields: boolean,
  usesOf: (name: FormulaName) => readonly NameUse[] | null,
  element: string,
  at: PlaceOf,
  whyOf: (name: FormulaName) => { readonly why?: 'start' } = () => ({}),
  given?: 'probable',
  via: Via = 'formula',
): FormulaReading {
  const parsed = parseFormula(text, { mergeFields });
  const references: RawReference[] = [];
  const unread: Unread[] = [];
  const tier = parsed.tree === null || given !== undefined ? { tier: 'probable' as const } : {};
  for (const name of parsed.tree === null ? namesOfTokens(parsed.tokens) : namesOfTree(parsed.tree)) {
    const uses = usesOf(name);
    if (uses === null) {
      const { line, column } = at(name.start, name.start);
      unread.push({ element, text: cut(name.text, LONGEST_TEXT_SHOWN), line, column, ...whyOf(name) });
      continue;
    }
    const value = name.value === undefined ? {} : { value: name.value };
    // One at a time: a formula can hold more names than a call takes arguments.
    for (const reference of referencesOf(uses, name.start, at, { via, ...tier, ...value })) {
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
 * Reads a formula with plain names whose first name is something the caller knows, as the formula of a predefined
 * value of a quick action names a field of the record the action runs on: `Opportunity.Name`. `startOf` says what
 * the first name is. A name whose first name it does not know is not read, and the reading says so. A first name
 * that starts with `$` and that it does not know is a global variable, as in a formula of a field.
 */
export function readFormulaOfStarts(text: string, startOf: StartOf, element: string, at: PlaceOf): FormulaReading {
  const usesOf = (name: FormulaName): readonly NameUse[] | null => usesOfMergeField(name.text, startOf);
  return reading(text, false, usesOf, element, at, (name) => whyNot(name.text, startOf));
}

/**
 * Reads a formula as a flow writes it, with merge fields where the formula of a field has names. `startOf` says
 * what the first name of a merge field is. A name outside braces is no name of such a formula: it is not read,
 * and the reading says so. `tier` is given where every name of the formula is less certain, as in an element of
 * a kind the reader of flows does not know.
 */
export function readFormulaOfMergeFields(
  text: string,
  startOf: StartOf,
  element: string,
  at: PlaceOf,
  tier?: 'probable',
): FormulaReading {
  const usesOf = (name: FormulaName): readonly NameUse[] | null =>
    name.mergeField === true ? usesOfMergeField(name.text, startOf) : null;
  const whyOf = (name: FormulaName): { readonly why?: 'start' } =>
    name.mergeField === true ? whyNot(name.text, startOf) : {};
  return reading(text, true, usesOf, element, at, whyOf, tier);
}

/**
 * Reads the merge fields of a text that is no formula. What stands between two merge fields is left alone, and
 * what stands in one is read as one name. A merge field that holds anything else, a call or an operator, is not
 * read, and the reading says so. `form` says how the text writes its merge fields.
 *
 * With `expressions` set to `formula`, a merge field that holds more than a name is read as a formula with plain
 * names whose first names `startOf` knows, as an email template writes `{!IF(ISBLANK(Case.Reason), ...)}`. One
 * that cannot be read as a formula is not read, and the reading says so.
 */
export function readMergeFields(
  text: string,
  startOf: StartOf,
  element: string,
  at: PlaceOf,
  tier?: 'probable',
  form: MergeForm = 'classic',
  expressions?: 'formula',
): MergeFieldsReading {
  const { fields, notClosed } = mergeFieldsOf(text, form);
  const references: RawReference[] = [];
  const unread: Unread[] = [];
  const said: Said = { via: 'merge-field', ...(tier === undefined ? {} : { tier }) };
  const usesOf = (name: FormulaName): readonly NameUse[] | null => usesOfMergeField(name.text, startOf);
  const whyOf = (name: FormulaName): { readonly why?: 'start' } => whyNot(name.text, startOf);
  for (const field of fields) {
    const uses = usesOfMergeField(field.text, startOf);
    if (uses !== null) {
      for (const reference of referencesOf(uses, field.start, at, said)) references.push(reference);
      continue;
    }
    if (expressions === 'formula') {
      // The places of the formula count from the start of what the merge field holds.
      const within: PlaceOf = (from, to) => at(field.start + from, field.start + to);
      const read = reading(field.text, false, usesOf, element, within, whyOf, tier, 'merge-field');
      if (read.problem === null) {
        references.push(...read.references);
        unread.push(...read.unread);
        continue;
      }
    }
    const { line, column } = at(field.start, field.start);
    unread.push({ element, text: cut(field.text, LONGEST_TEXT_SHOWN), line, column, ...whyNot(field.text, startOf) });
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

/**
 * Reads a name that stands alone in an element of a flow, without braces: what a merge field holds between its
 * braces. `said` is what the element says of it: how the name is written, and whether the field at its end is
 * read or written.
 *
 * Gives the references, which are none for a name that stands for nothing that can change, or `null` for a name
 * that is not read, with the reason where one is known.
 */
export function readResourceName(
  text: string,
  startOf: StartOf,
  at: PlaceOf,
  said: Said,
): { readonly references: readonly RawReference[] | null; readonly why?: 'start' } {
  const uses = usesOfMergeField(text, startOf);
  if (uses === null) return { references: null, ...whyNot(text, startOf) };
  return { references: referencesOf(uses, 0, at, said) };
}
