/**
 * The value of an element of XML as a reader of names needs it: the text without the white space around it, and
 * the place in the file of every part of it.
 */
import { isNil, sourceOf, type XmlDocument, type XmlElement, type XmlText } from './xml.ts';

/** A name as a file writes it, and where it stands. Lines and columns start at 1. */
export interface NameAt {
  readonly name: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Gives the part of a value from `from` to `to` as a name with its place. Both count the code units of the
 * value, from 0. A part can be empty: the end of `Contact.` is one, and it has a place all the same.
 */
export type PlaceOf = (from: number, to: number) => NameAt;

/** The text of an element without the white space around it, and where it starts in the text of the element. */
export interface Value {
  readonly value: string;
  readonly text: XmlText;
  readonly offset: number;
}

const XML_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/** The value of an element. `null` for no element, for one that is nil and for one that holds only white space. */
export function valueOf(element: XmlElement | null): Value | null {
  const text = element?.text ?? null;
  if (element === null || text === null || isNil(element)) return null;
  const raw = text.value;
  const value = raw.replace(XML_SPACE, '');
  if (value === '') return null;
  return { value, text, offset: raw.indexOf(value) };
}

export const textOf = (element: XmlElement | null): string | null => valueOf(element)?.value ?? null;

/** The places of the parts of one value of a document. */
export function placesIn(document: XmlDocument, value: Value): PlaceOf {
  return (from, to) => {
    // The place where the part starts.
    const start = value.offset + from;
    const { line, column } = document.place(sourceOf(value.text, start, start).start);
    return { name: value.value.slice(from, to), line, column };
  };
}
