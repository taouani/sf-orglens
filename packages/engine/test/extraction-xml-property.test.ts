/**
 * The reader for XML against random documents.
 *
 * A document is made as names and values first, and then written as a file in one of many ways: with entities,
 * character references, CDATA sections and comments, with LF, CRLF or CR, with white space inside tags, with a
 * byte order mark. While it is written, the writer notes where every element and every character of a value
 * stands. The reader must give back the names and values, the ones `fast-xml-parser` gives, and the places.
 *
 * `fast-xml-parser` is the second opinion for values only. It knows no places.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { XMLNS_NAMESPACE, readXml, sourceOf } from '../src/extraction/xml.ts';
import type { XmlDocument, XmlElement, XmlText } from '../src/extraction/xml.ts';
import { plainOf, secondOpinion, withAttributeSpaces } from './helpers/xml-opinions.ts';
import type { PlainElement } from './helpers/xml-opinions.ts';

/** An element before it is written: its name, its attributes, and its children or its text. */
interface Model {
  readonly name: string;
  readonly attributes: readonly (readonly [name: string, value: string])[];
  readonly children: readonly Model[];
  /** Only read when there are no children. */
  readonly text: string;
}

/** Where one code unit of a value was written: from `start` to `end` in the file. */
type Span = readonly [start: number, end: number];

/** What the writer knows about an attribute it wrote. */
interface WrittenAttribute {
  /** Where the name starts, and where the closing quote ends. */
  readonly start: number;
  readonly end: number;
  /** Where an empty value stands: after the opening quote. */
  readonly empty: number;
  readonly value: readonly Span[];
}

/** What the writer knows about an element it wrote. */
interface Written {
  readonly model: Model;
  readonly start: number;
  readonly end: number;
  /** After the start tag and before the end tag. Of a tag that closes itself: both are its end. */
  readonly contentStart: number;
  readonly contentEnd: number;
  /** The place of each code unit of the text, for an element without children. */
  readonly text: readonly Span[];
  /** Where an empty text stands: after the start tag, or after a tag that closes itself. */
  readonly empty: number;
  readonly attributes: readonly WrittenAttribute[];
  readonly children: readonly Written[];
}

const NAMES = ['a', 'b', 'Field', 'fullName', 'p:x', 'p:y', 'été', 'a-b.c_1', '名前', '_x'];
const ATTRIBUTES = ['k', 'id', 'p:k', 'p:nil', 'été', 'a-b'];
/** The characters a value is made of: every kind that is written in a special way, and some that are not. */
const CHARACTERS = [
  ...Array.from('ab Z09_$.,:;()[]]]>><<&&\'\'""\n\n\t\r'),
  '\u00E9',
  '\u20AC',
  '\u{1F600}',
  '\u00A0',
  '-',
  '!',
  '?',
  '/',
  '=',
];

const value = fc.array(fc.constantFrom(...CHARACTERS), { maxLength: 24 }).map((characters) => characters.join(''));

const model: fc.Arbitrary<Model> = fc.letrec<{ element: Model }>((tie) => ({
  element: fc.record({
    name: fc.constantFrom(...NAMES),
    attributes: fc
      .uniqueArray(fc.constantFrom(...ATTRIBUTES), { maxLength: 3 })
      .chain((names) => fc.tuple(...names.map((name) => fc.tuple(fc.constant(name), value)))),
    children: fc.oneof({ depthSize: 'small' }, fc.constant([]), fc.array(tie('element'), { maxLength: 4 })),
    text: value,
  }),
})).element;

/** A small generator of numbers, so that one seed gives one way of writing. */
function chooser(seed: number): (below: number) => number {
  let state = seed >>> 0;
  return (below) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) % below;
  };
}

const ENTITY: Readonly<Record<string, string>> = { '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' };

/** Writes a model as a file and notes where everything stands. */
function write(
  root: Model,
  seed: number,
): { file: string; written: Written; mark: boolean; plain: PlainElement; fallback: string | null } {
  const choose = chooser(seed);
  const one = <T>(...options: readonly T[]): T => options[choose(options.length)] as T;
  let file = '';
  const put = (text: string): Span => {
    const start = file.length;
    file += text;
    return [start, file.length];
  };
  // After a CR that was written alone, an LF would make one line end of the two.
  const lineEnd = (): string => (file.endsWith('\r') ? one('\r\n', '\r') : one('\n', '\n', '\r\n', '\r'));
  const space = (): string => one('', '', ' ', '  ', '\t', lineEnd(), `${lineEnd()}    `);
  const comment = (): void => {
    put(`<!--${one('', ' x ', ' a -- b ', ' <b> & </b> ', ' > ', `${lineEnd()}two lines${lineEnd()}`)}-->`);
  };
  const reference = (character: string): string => {
    const point = character.codePointAt(0) ?? 0;
    const zeros = one('', '', '0', '000');
    return choose(2) === 0
      ? `&#${zeros}${String(point)};`
      : `&#x${zeros}${one(point.toString(16), point.toString(16).toUpperCase())};`;
  };

  /** Writes the characters of a text. Each code unit gets the place of what stands for it. */
  const text = (decoded: string): Span[] => {
    const spans: Span[] = [];
    const characters = Array.from(decoded);
    let index = 0;
    while (index < characters.length) {
      const character = characters[index] ?? '';
      const way = choose(10);
      if (way === 0) comment();
      if (way === 1 && character !== '\r') {
        // A CDATA section with this character and some after it. It cannot hold its own end, nor a CR as itself.
        let run = character;
        while (
          choose(3) > 0 &&
          index + 1 < characters.length &&
          characters[index + 1] !== '\r' &&
          !`${run}${characters[index + 1] ?? ''}`.includes(']]>')
        ) {
          index += 1;
          run += characters[index] ?? '';
        }
        put('<![CDATA[');
        for (const inside of run) {
          const span = put(inside === '\n' ? lineEnd() : inside);
          if (inside.length === 2) spans.push([span[0], span[0] + 1], [span[0] + 1, span[1]]);
          else spans.push(span);
        }
        put(']]>');
        index += 1;
        continue;
      }
      const entity = ENTITY[character];
      // A ">" after "]]" would end a CDATA section that is not there, so it is not written as itself then.
      const asItself =
        character !== '<' && character !== '&' && character !== '\r' && !(character === '>' && file.endsWith(']]'));
      let span: Span;
      if (entity !== undefined && (way < 6 || !asItself) && way !== 9) span = put(`&${entity};`);
      else if (!asItself || way >= 8) span = put(reference(character));
      else if (character === '\n') span = put(lineEnd());
      else span = put(character);
      if (character.length === 2 && span[1] - span[0] === 2) spans.push([span[0], span[0] + 1], [span[0] + 1, span[1]]);
      else spans.push(...Array.from({ length: character.length }, () => span));
      index += 1;
    }
    if (choose(12) === 0) comment();
    return spans;
  };

  /** Writes the value of an attribute between two quotes of one kind. */
  const attributeValue = (decoded: string, quote: string): Span[] => {
    const spans: Span[] = [];
    for (const character of decoded) {
      const entity = ENTITY[character];
      const way = choose(8);
      let span: Span;
      if (character === '\t' || character === '\n' || character === '\r') span = put(reference(character));
      else if (character === ' ' && way === 0) span = put(one('\t', lineEnd()));
      else if (character === '<' || character === '&' || character === quote) {
        span = put(way < 5 && entity !== undefined ? `&${entity};` : reference(character));
      } else if (way === 7) span = put(entity === undefined ? reference(character) : `&${entity};`);
      else span = put(character);
      if (character.length === 2 && span[1] - span[0] === 2) spans.push([span[0], span[0] + 1], [span[0] + 1, span[1]]);
      else spans.push(...Array.from({ length: character.length }, () => span));
    }
    return spans;
  };

  const element = (node: Model, declarations: readonly (readonly [string, string])[]): Written => {
    const start = file.length;
    put(`<${node.name}`);
    const attributes: WrittenAttribute[] = [];
    for (const [name, decoded] of [...declarations, ...node.attributes]) {
      put(one(' ', ' ', '  ', '\t', lineEnd(), `${lineEnd()}  `));
      const from = file.length;
      put(`${name}${one('', '', ' ')}=${one('', '', ' ', lineEnd())}`);
      const quote = one('"', '"', "'");
      put(quote);
      const empty = file.length;
      const spans = attributeValue(decoded, quote);
      put(quote);
      attributes.push({ start: from, end: file.length, empty, value: spans });
    }
    put(one('', '', ' ', lineEnd()));
    const withoutContent = node.children.length === 0 && node.text === '';
    if (withoutContent && choose(2) === 0) {
      put('/>');
      const end = file.length;
      return {
        model: node,
        start,
        end,
        contentStart: end,
        contentEnd: end,
        text: [],
        empty: end,
        attributes,
        children: [],
      };
    }
    put('>');
    const empty = file.length;
    let spans: Span[] = [];
    const children: Written[] = [];
    if (node.children.length === 0) spans = text(node.text);
    else {
      for (const child of node.children) {
        put(space());
        if (choose(8) === 0) comment();
        children.push(element(child, []));
      }
      put(space());
    }
    const contentEnd = file.length;
    put(`</${node.name}${one('', '', '', ' ', lineEnd())}>`);
    return {
      model: node,
      start,
      end: file.length,
      contentStart: empty,
      contentEnd,
      text: spans,
      empty,
      attributes,
      children,
    };
  };

  // What stands before the first element.
  put(
    one(
      '',
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<?xml version='1.0'?>",
      '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>',
    ),
  );
  put(one('', lineEnd(), lineEnd()));
  if (choose(6) === 0) {
    comment();
    put(lineEnd());
  }
  // The prefix p is always declared. A default namespace is declared in half of the files.
  const declarations: (readonly [string, string])[] = [['xmlns:p', 'urn:p']];
  if (choose(2) === 0) declarations.unshift(['xmlns', 'urn:default']);
  const written = element(root, declarations);
  put(one('', lineEnd(), `${lineEnd()}${lineEnd()}`));
  if (choose(6) === 0) comment();

  const plain = (node: Model, extra: readonly (readonly [string, string])[]): PlainElement => ({
    name: node.name,
    attributes: Object.fromEntries([...extra, ...node.attributes]),
    children: node.children.map((child) => plain(child, [])),
    text: node.children.length > 0 ? null : node.text,
  });
  const fallback = declarations.some(([name]) => name === 'xmlns') ? 'urn:default' : null;
  return { file, written, mark: choose(4) === 0, plain: plain(root, declarations), fallback };
}

const encode = (file: string, mark: boolean): Uint8Array => {
  const bytes = new TextEncoder().encode(file);
  return mark ? Uint8Array.of(0xef, 0xbb, 0xbf, ...bytes) : bytes;
};

/** The line and the column of an index, counted without the reader: by cutting the text before it into lines. */
function lineAndColumn(file: string, index: number): { line: number; column: number } {
  const lines = file.slice(0, index).split(/\r\n|\r|\n/);
  return { line: lines.length, column: (lines.at(-1) ?? '').length + 1 };
}

/** Checks every place the reader gives for a text against the places the writer noted. */
function checkText(file: string, text: XmlText, spans: readonly Span[], empty: number): void {
  expect(text.value.length).toBe(spans.length);
  for (const [unit, [start, end]] of spans.entries()) expect(sourceOf(text, unit)).toEqual({ start, end });
  expect([text.start, text.end]).toEqual(spans.length === 0 ? [empty, empty] : [spans[0]?.[0], spans.at(-1)?.[1]]);
  // A text that stands in the file as it is has no table. A line end that is written as a CR is not as it is.
  const asItIs =
    spans.every(([start, end], unit) => start === (spans[0]?.[0] ?? 0) + unit && end === start + 1) &&
    file.slice(text.start, text.end) === text.value;
  expect(text.starts === null).toBe(asItIs);
  expect(text.ends === null).toBe(asItIs);
}

function checkElement(
  document: XmlDocument,
  bytes: Uint8Array,
  element: XmlElement,
  written: Written,
  fallback: string | null,
): void {
  const file = document.text;
  expect([element.start, element.end]).toEqual([written.start, written.end]);
  expect([element.contentStart, element.contentEnd]).toEqual([written.contentStart, written.contentEnd]);
  expect(file.startsWith(`<${written.model.name}`, element.start)).toBe(true);
  expect(file.charAt(element.end - 1)).toBe('>');
  // The place of the start: line and column as counted by hand, and the bytes hold the same text.
  const from = document.place(element.start);
  const to = document.place(element.end);
  expect({ line: from.line, column: from.column }).toEqual(lineAndColumn(file, element.start));
  expect(new TextDecoder().decode(bytes.subarray(from.offset, to.offset))).toBe(file.slice(element.start, element.end));
  // Names and namespaces.
  const [prefix, local] = written.model.name.includes(':') ? written.model.name.split(':') : ['', written.model.name];
  expect(element.local).toBe(local);
  expect(element.namespace).toBe(prefix === 'p' ? 'urn:p' : fallback);
  // Attributes: each value with its places, in the order of the file.
  expect(element.attributes.length).toBe(written.attributes.length);
  for (const [index, attribute] of element.attributes.entries()) {
    const noted = written.attributes[index];
    if (noted === undefined) throw new Error('The reader gives an attribute that was not written.');
    expect([attribute.start, attribute.end]).toEqual([noted.start, noted.end]);
    expect(file.startsWith(attribute.name, attribute.start)).toBe(true);
    checkText(file, attribute.value, noted.value, noted.empty);
    expect(attribute.namespace).toBe(
      attribute.name.startsWith('xmlns') ? XMLNS_NAMESPACE : attribute.name.startsWith('p:') ? 'urn:p' : null,
    );
  }
  // The content.
  expect(element.children.length).toBe(written.children.length);
  if (written.children.length === 0) {
    if (element.text === null) throw new Error('An element without children has no text.');
    checkText(file, element.text, written.text, written.empty);
  } else {
    expect(element.text).toBeNull();
  }
  for (const [index, child] of element.children.entries()) {
    const other = written.children[index];
    if (other !== undefined) checkElement(document, bytes, child, other, fallback);
  }
}

describe('reading random documents', () => {
  it('gives back the names and values that were written, and the place of each', () => {
    fc.assert(
      fc.property(model, fc.integer(), (root, seed) => {
        const { file, written, mark, plain, fallback } = write(root, seed);
        const bytes = encode(file, mark);
        const reading = readXml(bytes);
        expect(reading.issue).toBeNull();
        if (reading.document === null) return;
        expect(reading.document.byteOrderMark).toBe(mark);
        expect(reading.document.text).toBe(file);
        expect(plainOf(reading.document.root)).toEqual(plain);
        checkElement(reading.document, bytes, reading.document.root, written, fallback);
      }),
      { numRuns: 1500 },
    );
  });

  it('gives the values that fast-xml-parser gives', () => {
    fc.assert(
      fc.property(model, fc.integer(), (root, seed) => {
        const { file } = write(root, seed);
        const reading = readXml(encode(file, false));
        expect(reading.issue).toBeNull();
        if (reading.document === null) return;
        expect(withAttributeSpaces(plainOf(reading.document.root))).toEqual(withAttributeSpaces(secondOpinion(file)));
      }),
      { numRuns: 1500 },
    );
  });

  it('gives a tree or an issue, and no exception, for a document with a character changed', () => {
    const change = fc.record({
      at: fc.nat(),
      remove: fc.integer({ min: 0, max: 3 }),
      insert: fc.constantFrom('', '<', '>', '&', '"', "'", '/', '!', '?', ']', '-', ' ', ';', '#', 'x', '=', ':', '\r'),
    });
    fc.assert(
      fc.property(model, fc.integer(), fc.array(change, { minLength: 1, maxLength: 3 }), (root, seed, changes) => {
        let { file } = write(root, seed);
        for (const { at, remove, insert } of changes) {
          const index = at % (file.length + 1);
          file = `${file.slice(0, index)}${insert}${file.slice(index + remove)}`;
        }
        const reading = readXml(encode(file, false));
        expect(reading.document === null).toBe(reading.issue !== null);
        if (reading.issue !== null) {
          // The place of an issue is in the file.
          const place = reading.issue.place;
          expect(place === null || (place.offset >= 0 && place.offset <= new TextEncoder().encode(file).length)).toBe(
            true,
          );
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('gives a tree or an issue, and no exception, for any bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        const reading = readXml(bytes);
        expect(reading.document === null).toBe(reading.issue !== null);
      }),
      { numRuns: 2000 },
    );
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom(...Array.from('<>/a b="\'&;#x1!-[]?:CDATA\n')), { maxLength: 40 })
          .map((parts) => parts.join('')),
        (file) => {
          const reading = readXml(new TextEncoder().encode(file));
          expect(reading.document === null).toBe(reading.issue !== null);
        },
      ),
      { numRuns: 5000 },
    );
  });
});
