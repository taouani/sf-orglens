/**
 * A reader for the XML of metadata files that knows where every value stands.
 *
 * It reads a file into a tree of elements. Every element, every attribute and every text says where it stands in
 * the file, and a text says it for each of its characters: the twentieth character of a formula can be found in
 * the file even when a quote before it is written as `&apos;`. An analyser needs that to give a reference its
 * line and column.
 *
 * What it reads is the XML that metadata files hold: elements, attributes, text, the five entities of XML and
 * character references, CDATA sections, comments and the declaration, in UTF-8, with or without a byte order
 * mark, with LF or CRLF. Names are resolved against the namespaces the file declares.
 *
 * What it does not know it refuses, with an issue that says where it stopped, and it gives no tree then. It
 * never repairs a file and never guesses. It refuses a file that is not well-formed, and six things that
 * well-formed XML can hold and metadata files do not: a document type declaration, a processing instruction, an
 * encoding other than UTF-8, a version other than 1.0, an element that holds both text and elements, and
 * elements that are nested more than 256 deep.
 *
 * One thing that XML forbids is read: a comment may hold two hyphens, because people write that.
 *
 * Two things are not kept: comments, and the white space between the child elements of an element.
 *
 * Places are counted in the text of the file, in UTF-16 code units, as a string of JavaScript counts. That text
 * is the file without its byte order mark. `XmlDocument.place` turns such an index into a line, a column and a
 * place in the bytes.
 */

/** Where something stands in a file. */
interface XmlPlace {
  /** The place in the bytes of the file, from 0. A byte order mark counts. */
  readonly offset: number;
  /** The line, from 1. A line ends with LF, with CRLF or with a CR alone. */
  readonly line: number;
  /** The column, from 1, in UTF-16 code units. A byte order mark does not count. */
  readonly column: number;
}

/**
 * A text, or the value of an attribute, as XML means it: references are replaced, a CDATA section is taken as
 * it stands, and a line end is one LF. In the value of an attribute a tab and a line end are a space.
 */
export interface XmlText {
  readonly value: string;
  /** The index in the file of the first character. Of an empty text: where it would stand. */
  readonly start: number;
  /** The index in the file after the last character. */
  readonly end: number;
  /**
   * For each code unit of `value`, the index in the file where it starts and where it ends. Both are `null`
   * when the text stands in the file as it is: the code unit `n` is then at `start + n`. Read them with
   * `sourceOf`.
   */
  readonly starts: Uint32Array | null;
  readonly ends: Uint32Array | null;
}

export interface XmlAttribute {
  /** The name as it is written, with its prefix: `xsi:nil`. */
  readonly name: string;
  /** The name without its prefix: `nil`. */
  readonly local: string;
  /**
   * The namespace the prefix stands for. `null` for a name without prefix, as XML has it. A declaration of a
   * namespace (`xmlns`, `xmlns:xsi`) is an attribute of the namespace `XMLNS_NAMESPACE`.
   */
  readonly namespace: string | null;
  readonly value: XmlText;
  /** The index in the file of the first character of the name. */
  readonly start: number;
  /** The index in the file after the closing quote. */
  readonly end: number;
}

export interface XmlElement {
  /** The name as it is written, with its prefix if it has one. */
  readonly name: string;
  /** The name without its prefix. */
  readonly local: string;
  /** The namespace of the element: that of its prefix, or the default namespace. `null` if there is none. */
  readonly namespace: string | null;
  /** The attributes in the order of the file, the declarations of namespaces among them. */
  readonly attributes: readonly XmlAttribute[];
  /** The child elements in the order of the file. */
  readonly children: readonly XmlElement[];
  /**
   * The text of an element without child elements, as it stands: nothing is trimmed. `null` for an element that
   * has child elements. An element with nothing in it has the empty text, whether it is written as `<a/>`, as
   * `<a></a>` or with a comment only, so a value that is empty and a group without members look the same.
   */
  readonly text: XmlText | null;
  /** The index in the file of the `<` of the start tag. */
  readonly start: number;
  /** The index in the file after the `>` of the end tag, or of the tag itself if it closes itself. */
  readonly end: number;
  /** The index in the file after the `>` of the start tag. Of a tag that closes itself: `end`. */
  readonly contentStart: number;
  /** The index in the file of the `<` of the end tag. Of a tag that closes itself: `end`. */
  readonly contentEnd: number;
}

/** The declaration at the start of a file: `<?xml version="1.0" encoding="UTF-8"?>`. */
interface XmlDeclaration {
  readonly version: string;
  readonly encoding: string | null;
  readonly standalone: boolean | null;
}

/** A file that was read. It holds the whole text of the file for as long as it is held itself. */
export interface XmlDocument {
  readonly root: XmlElement;
  readonly declaration: XmlDeclaration | null;
  /** True if the file starts with the byte order mark of UTF-8. */
  readonly byteOrderMark: boolean;
  /** The file as text, without the byte order mark. Every index of the tree counts in it. */
  readonly text: string;
  /** The place of an index of `text`, from 0 to its length. Throws a `RangeError` for anything else. */
  place(index: number): XmlPlace;
}

/**
 * Why a file was not read.
 *
 * - `XML_NOT_UTF8`: the bytes are not text in UTF-8.
 * - `XML_MALFORMED`: the text is not well-formed XML, or it uses a namespace it does not declare.
 * - `XML_UNSUPPORTED`: the text may be XML, and it holds something this reader does not read.
 */
export type XmlIssueCode = 'XML_NOT_UTF8' | 'XML_MALFORMED' | 'XML_UNSUPPORTED';

interface XmlIssue {
  readonly code: XmlIssueCode;
  /**
   * One sentence or two, in plain words. Of the text of the file it holds names only: of an element, an
   * attribute, a prefix or an entity, each cut after `LONGEST_NAME_SHOWN` characters. In a file that is not
   * well-formed, a name is what stands where a name is expected, which can be a word of a text after a "<" or
   * an "&".
   */
  readonly message: string;
  /** Where the reader stopped. `null` when the bytes are not text, because a line needs text. */
  readonly place: XmlPlace | null;
}

/** A tree or an issue, never both and never neither. */
export type XmlReading =
  { readonly document: XmlDocument; readonly issue: null } | { readonly document: null; readonly issue: XmlIssue };

/** The namespace of the declarations of namespaces. */
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
/** The namespace the prefix `xml` always stands for. */
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
/** The namespace of `xsi:nil` and `xsi:type`. */
export const XSI_NAMESPACE = 'http://www.w3.org/2001/XMLSchema-instance';

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const DOUBLE_QUOTE = 0x22;
const AMPERSAND = 0x26;
const SINGLE_QUOTE = 0x27;
const SLASH = 0x2f;
const SEMICOLON = 0x3b;
const LESS = 0x3c;
const EQUALS = 0x3d;
const GREATER = 0x3e;
const QUESTION = 0x3f;

/**
 * What XML 1.0 allows at the start of a name and inside one (production 4 and 4a of the fifth edition). The
 * part of a name before a colon and the part after it start like a name without a colon (Namespaces in XML).
 */
const PART_START =
  'A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F' +
  '\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}';
// eslint-disable-next-line no-misleading-character-class -- The class lists the combining marks one by one, as XML does.
const NAME = new RegExp(`[:${PART_START}][:${PART_START}\\-.0-9\\u0300-\\u036F\\u203F-\\u2040\\u00B7]*`, 'uy');
const STARTS_LIKE_A_NAME = new RegExp(`^[${PART_START}]`, 'u');

/** A character XML 1.0 does not allow anywhere in a file. A lone surrogate cannot come out of UTF-8. */
// eslint-disable-next-line no-control-regex -- The control characters are what is looked for.
const FORBIDDEN_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

/** One part of the declaration: a name, `=`, and a value in quotes. */
const DECLARATION_PART = /[ \t\r\n]+([A-Za-z]+)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/y;
const DECLARATION_END = /[ \t\r\n]*\?>/y;

/** Something other than the white space of XML. */
const NOT_WHITE_SPACE = /[^ \t\r\n]/;

/** A character reference, in decimal or in hexadecimal. It may have any number of leading zeros. */
const CHARACTER_REFERENCE = /&#(?:0*([0-9]+)|x0*([0-9A-Fa-f]+));/y;

/** The five entities XML has without a document type. A map, so that `constructor` is not one of them. */
const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
]);

/** Elements may be nested this deep. The files of the public codebases go 8 deep. */
const DEEPEST_NESTING = 256;

/** A name is shown in a message up to this many characters. */
const LONGEST_NAME_SHOWN = 60;

/** A name as a message shows it: in quotes, and cut if it is long. */
function shown(name: string): string {
  if (name.length <= LONGEST_NAME_SHOWN) return `"${name}"`;
  return `"${Array.from(name).slice(0, LONGEST_NAME_SHOWN).join('')}..."`;
}

/** Ends the reading. It never leaves `readXml`. */
class Refusal extends Error {
  readonly code: XmlIssueCode;
  readonly index: number;

  constructor(code: XmlIssueCode, message: string, index: number) {
    super(message);
    this.code = code;
    this.index = index;
  }
}

const malformed = (message: string, index: number): never => {
  throw new Refusal('XML_MALFORMED', message, index);
};

const unsupported = (message: string, index: number): never => {
  throw new Refusal('XML_UNSUPPORTED', message, index);
};

const isWhiteSpace = (code: number): boolean => code === SPACE || code === LF || code === TAB || code === CR;

/** A text while it is read. `starts` and `ends` stay `null` as long as the text stands in the file as it is. */
interface Builder {
  value: string;
  start: number;
  end: number;
  starts: number[] | null;
  ends: number[] | null;
}

const builderAt = (index: number): Builder => ({ value: '', start: index, end: index, starts: null, ends: null });

/** From here on the place of every code unit is written down. */
function spell(builder: Builder): { starts: number[]; ends: number[] } {
  if (builder.starts === null || builder.ends === null) {
    builder.starts = Array.from({ length: builder.value.length }, (_, unit) => builder.start + unit);
    builder.ends = builder.starts.map((start) => start + 1);
  }
  return { starts: builder.starts, ends: builder.ends };
}

/** Adds what stands in the file from `from` to `to` and means itself. */
function addLiteral(builder: Builder, text: string, from: number, to: number): void {
  if (builder.starts === null) {
    if (builder.value === '') builder.start = from;
    else if (from !== builder.end) spell(builder);
  }
  if (builder.starts !== null && builder.ends !== null) {
    for (let index = from; index < to; index += 1) {
      builder.starts.push(index);
      builder.ends.push(index + 1);
    }
  }
  builder.value += text.slice(from, to);
  builder.end = to;
}

/** Adds what the file writes from `from` to `to` in another way: a reference, or a line end. */
function addDecoded(builder: Builder, decoded: string, from: number, to: number): void {
  if (builder.value === '' && builder.starts === null) builder.start = from;
  const { starts, ends } = spell(builder);
  // One entry for each code unit: a character outside the basic plane is two.
  for (let units = decoded.length; units > 0; units -= 1) {
    starts.push(from);
    ends.push(to);
  }
  builder.value += decoded;
  builder.end = to;
}

const finished = ({ value, start, end, starts, ends }: Builder): XmlText => ({
  value,
  start,
  end,
  starts: starts === null ? null : Uint32Array.from(starts),
  ends: ends === null ? null : Uint32Array.from(ends),
});

/** An element whose end tag was not read yet. */
interface Open {
  readonly name: string;
  readonly local: string;
  readonly namespace: string | null;
  readonly attributes: readonly XmlAttribute[];
  readonly children: XmlElement[];
  readonly start: number;
  readonly contentStart: number;
  /** The prefixes this element declares, each with the namespace it stood for before, or "" if it stood for none. */
  readonly shadowed: readonly (readonly [prefix: string, before: string])[];
  /** The text read so far since the start tag or the last child element. */
  text: Builder;
}

/** The prefix and the local part of a name. */
function splitName(name: string, index: number): { prefix: string; local: string } {
  const colon = name.indexOf(':');
  if (colon === -1) return { prefix: '', local: name };
  const prefix = name.slice(0, colon);
  const local = name.slice(colon + 1);
  if (prefix === '' || local.includes(':') || !STARTS_LIKE_A_NAME.test(local)) {
    malformed(`The name ${shown(name)} is not a prefix, one colon and a name.`, index);
  }
  return { prefix, local };
}

function parse(text: string): { declaration: XmlDeclaration | null; root: XmlElement } {
  const forbidden = FORBIDDEN_CHARACTER.exec(text);
  if (forbidden !== null) malformed('The file holds a character that XML does not allow.', forbidden.index);

  const length = text.length;
  const at = (index: number): number => text.charCodeAt(index);
  const starts = (index: number, word: string): boolean => text.startsWith(word, index);
  const afterWhiteSpace = (index: number): number => {
    let next = index;
    while (isWhiteSpace(at(next))) next += 1;
    return next;
  };
  const nameAt = (index: number): string | null => {
    NAME.lastIndex = index;
    return NAME.exec(text)?.[0] ?? null;
  };

  /** Reads the reference that starts with the `&` at `index`. */
  const reference = (index: number): { decoded: string; end: number } => {
    CHARACTER_REFERENCE.lastIndex = index;
    const digits = CHARACTER_REFERENCE.exec(text);
    if (digits === null) {
      const name = nameAt(index + 1);
      if (name === null || at(index + 1 + name.length) !== SEMICOLON) {
        return malformed('An "&" that starts no reference. In text, an "&" is written as "&amp;".', index);
      }
      const entity = ENTITIES.get(name);
      if (entity === undefined) {
        return malformed(
          `The entity ${shown(name)} is not known. Without a document type, XML has five: lt, gt, amp, apos and quot.`,
          index,
        );
      }
      return { decoded: entity, end: index + name.length + 2 };
    }
    const end = CHARACTER_REFERENCE.lastIndex;
    const number = digits[1] ?? digits[2] ?? '';
    // A number of any length: one that is too large for a character is refused below like any other.
    const point = Number.parseInt(number, digits[1] === undefined ? 16 : 10);
    const allowed =
      point === TAB ||
      point === LF ||
      point === CR ||
      (point >= SPACE && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
    if (!allowed) malformed('A character reference names a character that XML does not allow.', index);
    return { decoded: String.fromCodePoint(point), end };
  };

  /** Adds the text from `from` to `to`. Inside a CDATA section (`plain`) a reference is not one. */
  const addText = (builder: Builder, from: number, to: number, plain: boolean): void => {
    let run = from;
    let index = from;
    while (index < to) {
      const code = at(index);
      if (code === CR) {
        if (index > run) addLiteral(builder, text, run, index);
        const end = at(index + 1) === LF ? index + 2 : index + 1;
        addDecoded(builder, '\n', index, end);
        index = end;
        run = end;
      } else if (code === AMPERSAND && !plain) {
        if (index > run) addLiteral(builder, text, run, index);
        const { decoded, end } = reference(index);
        addDecoded(builder, decoded, index, end);
        index = end;
        run = end;
      } else if (code === GREATER && !plain && index - 2 >= from && starts(index - 2, ']]')) {
        malformed('The text holds "]]>", which XML allows only at the end of a CDATA section.', index - 2);
      } else {
        index += 1;
      }
    }
    if (to > run) addLiteral(builder, text, run, to);
  };

  /** The index after the comment that starts at `index`. */
  const afterComment = (index: number): number => {
    const end = text.indexOf('-->', index + 4);
    if (end === -1) malformed('A comment is not closed.', index);
    return end + 3;
  };

  /** Skips white space and comments outside the root element. */
  const afterMisc = (index: number): number => {
    let next = afterWhiteSpace(index);
    while (starts(next, '<!--')) next = afterWhiteSpace(afterComment(next));
    return next;
  };

  /** True if the text at `index` is the start of a declaration: `<?xml` and no further character of a name. */
  const declarationAt = (index: number): boolean => starts(index, '<?xml') && nameAt(index + 2) === 'xml';

  /** Refuses the `<` at `index`, which starts neither a tag nor a comment nor a CDATA section. */
  const refuseSpecial = (index: number): never => {
    if (declarationAt(index)) {
      return malformed('The declaration "<?xml" stands somewhere else than at the start of the file.', index);
    }
    if (starts(index, '<?')) return unsupported('The file holds a processing instruction, which is not read.', index);
    if (starts(index, '<!DOCTYPE')) {
      return unsupported('The file holds a document type declaration, which is not read.', index);
    }
    if (starts(index, '<![CDATA[')) return malformed('A CDATA section stands outside the first element.', index);
    if (starts(index, '<!')) return malformed('A "<!" starts neither a comment nor a CDATA section.', index);
    return malformed('After "<" a name must follow.', index);
  };

  // The declaration.
  let position = 0;
  let declaration: XmlDeclaration | null = null;
  if (declarationAt(0)) {
    const parts: [name: string, value: string][] = [];
    position = 5;
    for (;;) {
      DECLARATION_PART.lastIndex = position;
      const part = DECLARATION_PART.exec(text);
      if (part === null) break;
      parts.push([part[1] ?? '', part[2] ?? part[3] ?? '']);
      position = DECLARATION_PART.lastIndex;
    }
    DECLARATION_END.lastIndex = position;
    if (DECLARATION_END.exec(text) === null) malformed('The declaration at the start of the file is not closed.', 0);
    position = DECLARATION_END.lastIndex;
    const order = parts.map(([name]) => name).join(' ');
    if (!['version', 'version encoding', 'version standalone', 'version encoding standalone'].includes(order)) {
      malformed('The declaration must give "version", then "encoding" and "standalone" if it has them.', 0);
    }
    const values = new Map(parts);
    const version = values.get('version') ?? '';
    const encoding = values.get('encoding') ?? null;
    const standalone = values.get('standalone') ?? null;
    if (version !== '1.0') unsupported('The file is not XML of version 1.0.', 0);
    if (encoding !== null && encoding.toLowerCase() !== 'utf-8') {
      unsupported('The declaration names an encoding other than UTF-8.', 0);
    }
    if (standalone !== null && standalone !== 'yes' && standalone !== 'no') {
      malformed('In the declaration, "standalone" is "yes" or "no".', 0);
    }
    declaration = { version, encoding, standalone: standalone === null ? null : standalone === 'yes' };
  }

  position = afterMisc(position);
  if (position >= length) malformed('The file has no element.', length);
  if (at(position) !== LESS) malformed('Text stands before the first element.', position);

  /**
   * The prefixes that are declared where the reader stands, with the namespace of each. The empty prefix is the
   * default. A start tag adds to it and the end tag takes that back, so a file with many prefixes costs no more
   * than its length. A prefix that is no longer declared stays with the namespace "", which no prefix can be
   * declared as: taking it out of the map is slow when the map is large.
   */
  const scope = new Map<string, string>([['xml', XML_NAMESPACE]]);
  /** Takes back what a tag declared. A tag declares a prefix once at most, so the order does not matter. */
  const leave = (shadowed: Open['shadowed']): void => {
    for (const [prefix, before] of shadowed) scope.set(prefix, before);
  };

  /**
   * Reads the start tag at `index`, the tag of an element that stands `depth` elements deep. A tag that closes
   * itself is the whole element.
   */
  const startTag = (index: number, depth: number): { open: Open; closed: boolean; end: number } => {
    const name = nameAt(index + 1);
    if (name === null) return refuseSpecial(index);
    if (depth >= DEEPEST_NESTING) {
      unsupported(`Elements are nested more than ${String(DEEPEST_NESTING)} deep, which is not read.`, index);
    }
    const written: { name: string; value: XmlText; start: number; end: number }[] = [];
    const names = new Set<string>();
    let next = index + 1 + name.length;
    let closed = false;
    for (;;) {
      const here = afterWhiteSpace(next);
      if (here >= length) malformed(`The file ends inside the tag of ${shown(name)}.`, index);
      if (at(here) === GREATER) {
        next = here + 1;
        break;
      }
      if (at(here) === SLASH) {
        if (at(here + 1) !== GREATER) malformed(`In the tag of ${shown(name)}, a "/" is not followed by ">".`, here);
        next = here + 2;
        closed = true;
        break;
      }
      const attribute = nameAt(here);
      if (attribute === null) malformed(`The tag of ${shown(name)} holds something that is not an attribute.`, here);
      else {
        if (here === next) malformed(`In the tag of ${shown(name)}, white space must stand before an attribute.`, here);
        if (names.has(attribute))
          malformed(`The tag of ${shown(name)} has the attribute ${shown(attribute)} twice.`, here);
        names.add(attribute);
        const equals = afterWhiteSpace(here + attribute.length);
        if (at(equals) !== EQUALS) malformed(`The attribute ${shown(attribute)} has no "=".`, here);
        const quote = afterWhiteSpace(equals + 1);
        const mark = at(quote);
        if (mark !== DOUBLE_QUOTE && mark !== SINGLE_QUOTE) {
          malformed(`The value of the attribute ${shown(attribute)} does not stand in quotes.`, here);
        }
        const value = builderAt(quote + 1);
        let run = quote + 1;
        let end = quote + 1;
        for (;;) {
          if (end >= length) malformed(`The value of the attribute ${shown(attribute)} is not closed.`, quote);
          const code = at(end);
          if (code === mark) break;
          if (code === LESS) malformed(`The value of the attribute ${shown(attribute)} holds a "<".`, end);
          if (code === AMPERSAND || code === CR || code === LF || code === TAB) {
            if (end > run) addLiteral(value, text, run, end);
            const decoded = code === AMPERSAND ? reference(end) : null;
            const after = decoded?.end ?? (code === CR && at(end + 1) === LF ? end + 2 : end + 1);
            addDecoded(value, decoded?.decoded ?? ' ', end, after);
            end = after;
            run = after;
          } else {
            end += 1;
          }
        }
        if (end > run) addLiteral(value, text, run, end);
        written.push({ name: attribute, value: finished(value), start: here, end: end + 1 });
        next = end + 1;
      }
    }

    // The namespaces this tag declares, then the names of the tag and of its attributes.
    const shadowed: [prefix: string, before: string][] = [];
    for (const { name: attribute, value, start } of written) {
      if (attribute !== 'xmlns' && !attribute.startsWith('xmlns:')) continue;
      const prefix = attribute === 'xmlns' ? '' : attribute.slice(6);
      if (prefix !== '' && value.value === '')
        malformed(`The prefix ${shown(prefix)} is declared without a namespace.`, start);
      if (
        prefix === 'xmlns' ||
        value.value === XMLNS_NAMESPACE ||
        (prefix === 'xml') !== (value.value === XML_NAMESPACE)
      ) {
        malformed(`The declaration ${shown(attribute)} changes a prefix or uses a namespace that XML reserves.`, start);
      }
      shadowed.push([prefix, scope.get(prefix) ?? '']);
      scope.set(prefix, value.value);
    }
    const namespaceOf = (prefix: string, of: string, where: number): string => {
      const namespace = scope.get(prefix) ?? '';
      if (namespace === '') malformed(`The prefix ${shown(prefix)} of ${shown(of)} is not declared.`, where);
      return namespace;
    };
    const own = splitName(name, index + 1);
    const attributes: XmlAttribute[] = [];
    const resolved = new Set<string>();
    for (const { name: attribute, value, start, end } of written) {
      const { prefix, local } = splitName(attribute, start);
      const namespace =
        attribute === 'xmlns' || prefix === 'xmlns'
          ? XMLNS_NAMESPACE
          : prefix === ''
            ? null
            : namespaceOf(prefix, attribute, start);
      if (namespace !== null) {
        const key = `${namespace} ${local}`;
        if (resolved.has(key)) malformed(`The tag of ${shown(name)} has the attribute ${shown(local)} twice.`, start);
        resolved.add(key);
      }
      attributes.push({ name: attribute, local, namespace, value, start, end });
    }
    // A default namespace that is declared as "" is none.
    const fallback = scope.get('') ?? '';
    const namespace =
      own.prefix === '' ? (fallback === '' ? null : fallback) : namespaceOf(own.prefix, name, index + 1);
    // What a tag that closes itself declares holds for its own names only.
    if (closed) leave(shadowed);
    return {
      open: {
        name,
        local: own.local,
        namespace,
        attributes,
        children: [],
        start: index,
        contentStart: next,
        shadowed,
        text: builderAt(next),
      },
      closed,
      end: next,
    };
  };

  /** An element with child elements holds no text. White space between them is dropped. */
  const noTextBetween = (open: Open): void => {
    const other = NOT_WHITE_SPACE.exec(open.text.value);
    if (other !== null) {
      unsupported(
        `The element ${shown(open.name)} holds both text and elements, which is not read.`,
        open.text.starts?.[other.index] ?? open.text.start + other.index,
      );
    }
  };

  const element = (open: Open, contentEnd: number, end: number, closed: boolean): XmlElement => {
    if (open.children.length > 0) noTextBetween(open);
    return {
      name: open.name,
      local: open.local,
      namespace: open.namespace,
      attributes: open.attributes,
      children: open.children,
      text: open.children.length > 0 ? null : finished(closed ? builderAt(end) : open.text),
      start: open.start,
      end,
      contentStart: closed ? end : open.contentStart,
      contentEnd: closed ? end : contentEnd,
    };
  };

  // The elements. `stack` holds the ones that are open, the innermost last.
  const stack: Open[] = [];
  let root: XmlElement | null = null;
  /** Puts a finished element into the one that is open around it. Gives it back if there is none: it is the root. */
  const placed = (done: XmlElement): XmlElement | null => {
    const parent = stack.at(-1);
    if (parent === undefined) return done;
    parent.children.push(done);
    return null;
  };

  while (root === null) {
    const open = stack.at(-1);
    if (open !== undefined) {
      // Text up to the next tag.
      const tag = text.indexOf('<', position);
      if (tag === -1) malformed(`The file ends before the element ${shown(open.name)} is closed.`, length);
      if (tag > position) addText(open.text, position, tag, false);
      position = tag;
    }
    if (at(position + 1) === SLASH) {
      if (open === undefined) return malformed('An end tag stands where no element is open.', position);
      const name = nameAt(position + 2);
      if (name !== open.name) {
        malformed(
          name === null
            ? 'After "</" a name must follow.'
            : `The end tag of ${shown(name)} stands where ${shown(open.name)} is open.`,
          position,
        );
      }
      const end = afterWhiteSpace(position + 2 + open.name.length);
      if (at(end) !== GREATER) malformed(`The end tag of ${shown(open.name)} is not closed.`, position);
      stack.pop();
      leave(open.shadowed);
      root = placed(element(open, position, end + 1, false));
      position = end + 1;
    } else if (at(position + 1) === BANG && starts(position, '<!--')) {
      position = afterComment(position);
    } else if (at(position + 1) === BANG && starts(position, '<![CDATA[') && open !== undefined) {
      const end = text.indexOf(']]>', position + 9);
      if (end === -1) malformed('A CDATA section is not closed.', position);
      addText(open.text, position + 9, end, true);
      position = end + 3;
    } else if (at(position + 1) === BANG || at(position + 1) === QUESTION) {
      refuseSpecial(position);
    } else {
      const tag = startTag(position, stack.length);
      if (open !== undefined) {
        noTextBetween(open);
        open.text = builderAt(tag.end);
      }
      if (tag.closed) root = placed(element(tag.open, tag.end, tag.end, true));
      else stack.push(tag.open);
      position = tag.end;
    }
  }

  position = afterMisc(position);
  if (position < length) {
    if (at(position) !== LESS) malformed('Text stands after the last element.', position);
    if (at(position + 1) === BANG || at(position + 1) === QUESTION) refuseSpecial(position);
    if (at(position + 1) === SLASH) malformed('An end tag stands where no element is open.', position);
    malformed('The file has more than one element at the top.', position);
  }
  return { declaration, root };
}

/** Makes the function that turns an index of the text into a place. Its tables are made when they are first needed. */
function placer(text: string, markBytes: number, byteLength: number): (index: number) => XmlPlace {
  let lines: number[] | null = null;
  let bytes: Uint32Array | null = null;
  const plain = text.length === byteLength - markBytes;

  const lineStarts = (): number[] => {
    if (lines === null) {
      lines = [0];
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code === LF || (code === CR && text.charCodeAt(index + 1) !== LF)) lines.push(index + 1);
      }
    }
    return lines;
  };

  const byteOf = (index: number): number => {
    if (plain) return markBytes + index;
    if (bytes === null) {
      bytes = new Uint32Array(text.length + 1);
      let offset = markBytes;
      for (let unit = 0; unit < text.length; unit += 1) {
        bytes[unit] = offset;
        const code = text.charCodeAt(unit);
        if (code < 0x80) offset += 1;
        else if (code < 0x800) offset += 2;
        else if (code >= 0xd800 && code <= 0xdbff) {
          // Two code units are one character of four bytes. An index between them counts as the start of it.
          unit += 1;
          bytes[unit] = offset;
          offset += 4;
        } else offset += 3;
      }
      bytes[text.length] = offset;
    }
    return bytes[index] ?? 0;
  };

  return (index) => {
    if (!Number.isInteger(index) || index < 0 || index > text.length) {
      throw new RangeError(`The index ${String(index)} is not in the text of the file.`);
    }
    const starts = lineStarts();
    // The last line that starts at or before the index.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((starts[middle] ?? 0) <= index) low = middle;
      else high = middle - 1;
    }
    return { offset: byteOf(index), line: low + 1, column: index - (starts[low] ?? 0) + 1 };
  };
}

const START_OF_FILE: XmlPlace = { offset: 0, line: 1, column: 1 };

/** A file that is no XML, such as the body of an email template, as text. */
export interface TextDocument {
  /** The file as text, without the byte order mark. */
  readonly text: string;
  /** The place of an index of `text`, as `XmlDocument.place` gives it. */
  place(index: number): XmlPlace;
}

/** The text of a file, or why it is none. */
function decode(
  bytes: Uint8Array,
): { readonly text: string; readonly byteOrderMark: boolean; readonly issue: null } | { readonly issue: XmlIssue } {
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) {
    return {
      issue: {
        code: 'XML_UNSUPPORTED',
        message: 'The file starts with the byte order mark of UTF-16 or UTF-32. Only UTF-8 is read.',
        place: START_OF_FILE,
      },
    };
  }
  const byteOrderMark = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      byteOrderMark ? bytes.subarray(3) : bytes,
    );
    return { text, byteOrderMark, issue: null };
  } catch {
    return { issue: { code: 'XML_NOT_UTF8', message: 'The bytes of the file are not text in UTF-8.', place: null } };
  }
}

/**
 * Reads the bytes of a file that is no XML as text in UTF-8, as `readXml` reads them: a byte order mark of UTF-8
 * is no part of the text, and one of UTF-16 or UTF-32 is refused. It gives the text, or the issue why the bytes
 * are none.
 *
 * `declared` is the encoding the file is said to have elsewhere, such as the `encodingKey` of an email template.
 * Where it is `ISO-8859-1` and the bytes are no UTF-8, they are read in that encoding, one character to a byte.
 * Any other encoding is not read.
 */
export function readText(
  bytes: Uint8Array,
  declared: string | null = null,
): { readonly document: TextDocument; readonly issue: null } | { readonly document: null; readonly issue: XmlIssue } {
  const decoded = decode(bytes);
  if (decoded.issue?.code === 'XML_NOT_UTF8' && declared?.trim().toLowerCase() === 'iso-8859-1') {
    // The decoder of the web reads ISO-8859-1 as windows-1252, which differs only in 32 characters no name holds.
    const text = new TextDecoder('iso-8859-1').decode(bytes);
    return { document: { text, place: placer(text, 0, bytes.length) }, issue: null };
  }
  if (decoded.issue !== null) return { document: null, issue: decoded.issue };
  const { text, byteOrderMark } = decoded;
  return { document: { text, place: placer(text, byteOrderMark ? 3 : 0, bytes.length) }, issue: null };
}

/**
 * Reads the bytes of an XML file. It gives a tree, or the one issue that stopped the reading. It throws for
 * nothing a file can hold.
 */
export function readXml(bytes: Uint8Array): XmlReading {
  const decoded = decode(bytes);
  if (decoded.issue !== null) return { document: null, issue: decoded.issue };
  const { text, byteOrderMark } = decoded;
  const place = placer(text, byteOrderMark ? 3 : 0, bytes.length);
  try {
    const { declaration, root } = parse(text);
    return { document: { root, declaration, byteOrderMark, text, place }, issue: null };
  } catch (thrown) {
    if (!(thrown instanceof Refusal)) throw thrown;
    return { document: null, issue: { code: thrown.code, message: thrown.message, place: place(thrown.index) } };
  }
}

/**
 * Where a part of a text stands in the file: from the start of the code unit `from` to the end of the code unit
 * before `to`. Of an empty part: the place where the code unit `from` starts, or the end of the text.
 *
 * A character that the file writes as a reference starts at its `&` and ends after its `;`. A comment or the
 * marks of a CDATA section between two characters of the part lie inside what is given.
 */
export function sourceOf(text: XmlText, from: number, to: number = from + 1): { start: number; end: number } {
  const length = text.value.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > length) {
    throw new RangeError(`The part from ${String(from)} to ${String(to)} is not in a text of ${String(length)}.`);
  }
  const start = from === length ? text.end : (text.starts?.[from] ?? text.start + from);
  const end = to === from ? start : (text.ends?.[to - 1] ?? text.start + to);
  return { start, end };
}

/**
 * The first child element with this local name, or `null`. The namespace is not looked at: most metadata files
 * declare the namespace of the Metadata API, some that of the Tooling API, and some declare none.
 */
export function childOf(element: XmlElement, local: string): XmlElement | null {
  return element.children.find((child) => child.local === local) ?? null;
}

/** The child elements with this local name, in the order of the file. The namespace is not looked at. */
export function childrenOf(element: XmlElement, local: string): XmlElement[] {
  return element.children.filter((child) => child.local === local);
}

/** The attribute with this local name and namespace, or `null`. A name without prefix has the namespace `null`. */
export function attributeOf(element: XmlElement, local: string, namespace: string | null = null): XmlAttribute | null {
  return element.attributes.find((attribute) => attribute.local === local && attribute.namespace === namespace) ?? null;
}

/** True if the element says that it has no value: `xsi:nil="true"`. */
export function isNil(element: XmlElement): boolean {
  // XML Schema takes away the white space of XML around the value, and no other kind of space.
  const value = attributeOf(element, 'nil', XSI_NAMESPACE)?.value.value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  return value === 'true' || value === '1';
}
