/**
 * Two views of an XML file that can be compared: what the reader of the engine gives, and what
 * `fast-xml-parser` gives, the library the Salesforce libraries bring. The second is the second opinion in the
 * tests of the reader. It knows no places, so only names and values are compared.
 */
import { XMLParser } from 'fast-xml-parser';
import type { XmlElement } from '../../src/extraction/xml.ts';

/** An element as names and values only. */
export interface PlainElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly PlainElement[];
  /** The text of an element without child elements, `null` for one that has some. */
  readonly text: string | null;
}

/** What the reader of the engine gives, without places. */
export function plainOf(element: XmlElement): PlainElement {
  return {
    name: element.name,
    attributes: Object.fromEntries(element.attributes.map((attribute) => [attribute.name, attribute.value.value])),
    children: element.children.map(plainOf),
    text: element.text?.value ?? null,
  };
}

/**
 * `fast-xml-parser` leaves a tab and a line end in the value of an attribute as they are, where XML says that
 * each is a space. For a comparison, both sides are brought to spaces. A tab that a file writes as `&#9;` becomes
 * a space as well then, on both sides.
 */
export function withAttributeSpaces(element: PlainElement): PlainElement {
  return {
    ...element,
    attributes: Object.fromEntries(
      Object.entries(element.attributes).map(([name, value]) => [name, value.replace(/[\t\n\r]/g, ' ')]),
    ),
    children: element.children.map(withAttributeSpaces),
  };
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  ignoreDeclaration: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  // Without this, a character reference such as `&#65;` is left as it is written.
  htmlEntities: true,
});

type Entry = Readonly<Record<string, unknown>>;

const isEntry = (value: unknown): value is Entry => typeof value === 'object' && value !== null;

function plainOfEntry(entry: Entry): PlainElement {
  const name = Object.keys(entry).find((key) => key !== ':@');
  if (name === undefined || name === '#text') throw new Error('fast-xml-parser gave an entry that is no element.');
  const content = entry[name];
  const inside = (Array.isArray(content) ? content : []).filter(isEntry);
  const children = inside.filter((one) => !('#text' in one)).map(plainOfEntry);
  const text = inside
    .filter((one) => '#text' in one)
    .map((one) => String(one['#text']))
    .join('');
  if (children.length > 0 && /[^ \t\r\n]/.test(text)) {
    throw new Error(`fast-xml-parser gave text and elements inside "${name}".`);
  }
  const attributes = entry[':@'];
  return {
    name,
    attributes: Object.fromEntries(
      Object.entries(isEntry(attributes) ? attributes : {}).map(([key, value]) => [key, String(value)]),
    ),
    children,
    text: children.length > 0 ? null : text,
  };
}

/** What `fast-xml-parser` gives for the text of a file. It throws for a file with text beside elements. */
export function secondOpinion(text: string): PlainElement {
  const top: unknown = parser.parse(text);
  const elements = (Array.isArray(top) ? top : []).filter(isEntry).filter((one) => !('#text' in one));
  const [root, ...others] = elements;
  if (root === undefined || others.length > 0) throw new Error('fast-xml-parser gave no single element at the top.');
  return plainOfEntry(root);
}
