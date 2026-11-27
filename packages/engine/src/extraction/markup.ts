/**
 * The reader of the markup of a Lightning component (decision record 0094): the elements of a template, each with
 * its name, its attributes and the element around it, and the place of each. It reads no expression and no text
 * between the tags. It is no parser of HTML: it reads tags as a template of a Lightning web component writes them,
 * with values in quotes, in braces or bare, and attributes without a value, and steps over comments and over what a
 * `script` or a `style` element holds.
 *
 * It works on the text of a file and gives indexes of that text, which the caller turns into places. It throws for
 * nothing a file can hold. Where it cannot go on, as in a comment that is not closed, it says where it stopped, and
 * what it read before is kept.
 */

/** An attribute of an element, as the markup writes it. */
interface MarkupAttribute {
  readonly name: string;
  /** The index of its name. */
  readonly start: number;
  /** The value, without its quotes. `null`: the attribute has no value. */
  readonly value: string | null;
  /** The index of the first character of the value, after a quote. That of the name, where it has no value. */
  readonly valueStart: number;
}

/** An element of the markup. */
interface MarkupElement {
  /** The name of the element, as the markup writes it. */
  readonly name: string;
  /** The index of its name, after the `<`. */
  readonly start: number;
  readonly attributes: readonly MarkupAttribute[];
  /** The index in `elements` of the element that holds it. `-1`: no element holds it. */
  readonly parent: number;
}

export interface MarkupReading {
  /** Every element, in the order of its start tag. */
  readonly elements: readonly MarkupElement[];
  /** Where the reader stopped before the end of the file, and in what. `null`: it read the whole file. */
  readonly stop: { readonly at: number; readonly what: 'comment' | 'tag' } | null;
}

/** The elements that hold nothing and have no end tag. */
const VOID: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** The elements whose content is no markup: it ends only at their end tag. */
const RAW: ReadonlySet<string> = new Set(['script', 'style']);

const isSpace = (code: number): boolean =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
const isLetter = (code: number): boolean => (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a);
/** A character that ends the name of an element or an attribute. */
const endsName = (code: number): boolean =>
  isSpace(code) || code === 0x3e || code === 0x2f || code === 0x3d || code === 0x22 || code === 0x27;

/** Reads the elements of a text of markup. */
export function readMarkup(text: string): MarkupReading {
  const elements: MarkupElement[] = [];
  /** The elements that are open, by their index in `elements`. */
  const open: number[] = [];
  let index = 0;
  const name = (from: number): number => {
    let at = from;
    while (at < text.length && !endsName(text.charCodeAt(at))) at += 1;
    return at;
  };
  const skipSpace = (from: number): number => {
    let at = from;
    while (at < text.length && isSpace(text.charCodeAt(at))) at += 1;
    return at;
  };
  /** The end of a value from `from`, a quote or a brace or neither, and the index after it. */
  const value = (from: number): { value: string; start: number; next: number } | null => {
    const code = text.charCodeAt(from);
    if (code === 0x22 || code === 0x27) {
      const end = text.indexOf(code === 0x22 ? '"' : "'", from + 1);
      if (end === -1) return null;
      return { value: text.slice(from + 1, end), start: from + 1, next: end + 1 };
    }
    let at = from;
    let braces = 0;
    while (at < text.length) {
      const char = text.charCodeAt(at);
      if (char === 0x7b) braces += 1;
      else if (char === 0x7d) braces -= 1;
      else if (braces <= 0 && (isSpace(char) || char === 0x3e || (char === 0x2f && text.charCodeAt(at + 1) === 0x3e)))
        break;
      at += 1;
    }
    if (at >= text.length) return null;
    return { value: text.slice(from, at), start: from, next: at };
  };

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt === -1) break;
    const next = text.charCodeAt(lt + 1);
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) return { elements, stop: { at: lt, what: 'comment' } };
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) return { elements, stop: { at: lt, what: 'comment' } };
      index = end + 3;
    } else if (next === 0x21 || next === 0x3f) {
      // A declaration, such as `<!DOCTYPE html>`, or an instruction, such as `<?xml ... ?>`, which ends at `?>`.
      const close = next === 0x3f ? '?>' : '>';
      const end = text.indexOf(close, lt + 2);
      if (end === -1) return { elements, stop: { at: lt, what: 'tag' } };
      index = end + close.length;
    } else if (next === 0x2f && isLetter(text.charCodeAt(lt + 2))) {
      const end = name(lt + 2);
      const closed = text.slice(lt + 2, end).toLowerCase();
      const gt = text.indexOf('>', end);
      if (gt === -1) return { elements, stop: { at: lt, what: 'tag' } };
      // An end tag closes the element it names and those inside it that were not closed. One that names no open
      // element closes nothing.
      const at = open.findLastIndex((one) => elements[one]?.name.toLowerCase() === closed);
      if (at !== -1) open.length = at;
      index = gt + 1;
    } else if (isLetter(next)) {
      const start = lt + 1;
      const end = name(start);
      const tag = text.slice(start, end);
      const attributes: MarkupAttribute[] = [];
      let at = end;
      let closed = false;
      for (;;) {
        at = skipSpace(at);
        if (at >= text.length) return { elements, stop: { at: lt, what: 'tag' } };
        const code = text.charCodeAt(at);
        if (code === 0x3e) {
          at += 1;
          break;
        }
        if (code === 0x2f) {
          if (text.charCodeAt(at + 1) === 0x3e) {
            closed = true;
            at += 2;
            break;
          }
          at += 1;
          continue;
        }
        const nameEnd = Math.max(name(at), at + 1);
        const attribute = text.slice(at, nameEnd);
        let after = skipSpace(nameEnd);
        if (text.charCodeAt(after) === 0x3d) {
          after = skipSpace(after + 1);
          const read = value(after);
          if (read === null) return { elements, stop: { at: lt, what: 'tag' } };
          attributes.push({ name: attribute, start: at, value: read.value, valueStart: read.start });
          at = read.next;
        } else {
          attributes.push({ name: attribute, start: at, value: null, valueStart: at });
          at = nameEnd;
        }
      }
      elements.push({ name: tag, start, attributes, parent: open.at(-1) ?? -1 });
      const folded = tag.toLowerCase();
      if (RAW.has(folded) && !closed) {
        // Looked for in any case, in the text itself: a text in lower case can be longer than the text.
        const endTag = new RegExp(`</${folded}`, 'gi');
        endTag.lastIndex = at;
        index = endTag.exec(text)?.index ?? text.length;
      } else {
        if (!closed && !VOID.has(folded)) open.push(elements.length - 1);
        index = at;
      }
    } else {
      // A `<` in the text, as in `a < b`.
      index = lt + 1;
    }
  }
  return { elements, stop: null };
}
