/**
 * Finds the merge fields of a text: `{!Resource.Path}` in the text of a flow, of an email template or of an
 * email alert. What stands between two of them is left alone.
 *
 * Nothing is said here about what stands between the braces. The caller knows the language of the text: a flow
 * writes a name there, and `formula-names.ts` says what that name stands for.
 */

/** One merge field of a text. Every place counts the code units of the text, from 0. */
export interface MergeField {
  /** What stands between `{!` and `}`, without the white space around it. */
  readonly text: string;
  /** Where that starts. For a merge field that holds nothing, the place of its closing brace. */
  readonly start: number;
  /** Where the merge field starts, at its `{`, and where it ends, after its `}`. */
  readonly open: number;
  readonly close: number;
}

export interface MergeFields {
  /** The merge fields, in the order they stand. */
  readonly fields: readonly MergeField[];
  /** Where a `{!` stands that is not closed. Nothing is read between it and the next merge field. */
  readonly notClosed: readonly number[];
}

const OPENS = '{!';
/** White space before what a merge field holds. */
const SPACE_BEFORE = /^\s*/;

/**
 * Where the merge field that opens at `open` closes: at the next `}`. `null` if a `{` stands before that brace or
 * the text ends before it: the merge field is not closed then. The reader of formulas asks the same question.
 */
export function closeOfMergeField(text: string, open: number): number | null {
  const close = text.indexOf('}', open + OPENS.length);
  if (close === -1) return null;
  const brace = text.indexOf('{', open + OPENS.length);
  return brace !== -1 && brace < close ? null : close;
}

/** What stands between the braces of a merge field that closes at `close`, and where it starts. */
export function insideOfMergeField(text: string, open: number, close: number): { text: string; start: number } {
  const raw = text.slice(open + OPENS.length, close);
  const inside = raw.trim();
  // The white space before what stands there. An empty merge field has its place at the closing brace.
  const before = inside === '' ? raw.length : (SPACE_BEFORE.exec(raw)?.[0].length ?? 0);
  return { text: inside, start: open + OPENS.length + before };
}

/**
 * The merge fields of a text. A brace without `!` after it opens nothing, and a `}` that closes nothing is a
 * character like any other. It never throws for what the text holds.
 */
export function mergeFieldsOf(text: string): MergeFields {
  const fields: MergeField[] = [];
  const notClosed: number[] = [];
  let open = text.indexOf(OPENS);
  while (open !== -1) {
    const close = closeOfMergeField(text, open);
    if (close === null) {
      notClosed.push(open);
      open = text.indexOf(OPENS, open + OPENS.length);
      continue;
    }
    fields.push({ ...insideOfMergeField(text, open, close), open, close: close + 1 });
    open = text.indexOf(OPENS, close + 1);
  }
  return { fields, notClosed };
}
