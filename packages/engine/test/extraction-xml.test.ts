/**
 * The reader for the XML of metadata files: what it gives for a file, where it says each value stands, and what
 * it refuses.
 *
 * `extraction-xml-property.test.ts` reads random documents, and `extraction-xml-corpora.test.ts` the files of
 * the public codebases.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  XMLNS_NAMESPACE,
  XSI_NAMESPACE,
  attributeOf,
  childOf,
  childrenOf,
  isNil,
  readXml,
  sourceOf,
} from '../src/extraction/xml.ts';
import type { XmlDocument, XmlElement, XmlIssueCode, XmlText } from '../src/extraction/xml.ts';
import { plainOf, secondOpinion, withAttributeSpaces } from './helpers/xml-opinions.ts';

const root = join(import.meta.dirname, '../../..');
const METADATA = 'http://soap.sforce.com/2006/04/metadata';

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Reads a text that must be read without an issue. */
function read(text: string): XmlDocument {
  const reading = readXml(bytesOf(text));
  expect(reading.issue).toBeNull();
  if (reading.document === null) throw new Error('The file was not read.');
  return reading.document;
}

/** The text of an element that must have one. */
function textOf(element: XmlElement | null): XmlText {
  const text = element?.text ?? null;
  if (text === null) throw new Error('The element has no text.');
  return text;
}

/** What the file holds at the place of a part of a text. */
const written = (document: XmlDocument, text: XmlText, from: number, to?: number): string => {
  const { start, end } = sourceOf(text, from, to);
  return document.text.slice(start, end);
};

describe('reading the XML of a metadata file', () => {
  const FIELD = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">',
    '    <fullName>Late_Fee__c</fullName>',
    '    <formula>IF(TEXT(Status__c) = &apos;Late&apos;, Amount__c * 0.05, 0)</formula>',
    '    <label>Late Fee</label>',
    '</CustomField>',
    '',
  ].join('\n');

  it('gives the elements, their names and their text', () => {
    const document = read(FIELD);
    expect(document.declaration).toEqual({ version: '1.0', encoding: 'UTF-8', standalone: null });
    expect(document.byteOrderMark).toBe(false);
    expect(document.text).toBe(FIELD);
    expect(plainOf(document.root)).toEqual({
      name: 'CustomField',
      attributes: { xmlns: METADATA },
      text: null,
      children: [
        { name: 'fullName', attributes: {}, children: [], text: 'Late_Fee__c' },
        { name: 'formula', attributes: {}, children: [], text: "IF(TEXT(Status__c) = 'Late', Amount__c * 0.05, 0)" },
        { name: 'label', attributes: {}, children: [], text: 'Late Fee' },
      ],
    });
    expect(document.root.namespace).toBe(METADATA);
    expect(childOf(document.root, 'label')?.namespace).toBe(METADATA);
    expect(childOf(document.root, 'missing')).toBeNull();
  });

  it('says where an element stands: its line, its column and its place in the bytes', () => {
    const document = read(FIELD);
    const formula = childOf(document.root, 'formula');
    if (formula === null) throw new Error('No formula.');
    expect(document.place(formula.start)).toEqual({ line: 4, column: 5, offset: FIELD.indexOf('<formula>') });
    expect(document.text.slice(formula.start, formula.end)).toBe(
      '<formula>IF(TEXT(Status__c) = &apos;Late&apos;, Amount__c * 0.05, 0)</formula>',
    );
    expect(document.text.slice(formula.contentStart, formula.contentEnd)).toBe(
      'IF(TEXT(Status__c) = &apos;Late&apos;, Amount__c * 0.05, 0)',
    );
    expect(document.place(document.root.start)).toEqual({ line: 2, column: 1, offset: 39 });
    expect(document.place(document.root.end)).toEqual({ line: 6, column: 15, offset: FIELD.length - 1 });
    expect(document.place(FIELD.length)).toEqual({ line: 7, column: 1, offset: FIELD.length });
  });

  it('finds a character of a formula in the file when a quote before it is written as an entity', () => {
    const document = read(FIELD);
    const formula = textOf(childOf(document.root, 'formula'));
    const name = formula.value.indexOf('Amount__c');
    // In the decoded text the name stands 10 characters earlier than in the file: two entities of 6 for 1.
    expect(name).toBe(29);
    const { start, end } = sourceOf(formula, name, name + 'Amount__c'.length);
    expect(document.text.slice(start, end)).toBe('Amount__c');
    expect(document.place(start)).toEqual({ line: 4, column: 53, offset: FIELD.indexOf('Amount__c') });
    // A character that is written as a reference stands where the reference stands.
    const quote = formula.value.indexOf("'");
    expect(written(document, formula, quote)).toBe('&apos;');
    expect(written(document, formula, quote, quote + 6)).toBe('&apos;Late&apos;');
    // A part without a character is a place, not a piece of the file.
    expect(sourceOf(formula, name, name)).toEqual({ start, end: start });
    expect(sourceOf(formula, formula.value.length, formula.value.length)).toEqual({
      start: formula.end,
      end: formula.end,
    });
    expect(formula.start).toBe(FIELD.indexOf('IF('));
    expect(document.text.slice(formula.start, formula.end)).toBe(
      'IF(TEXT(Status__c) = &apos;Late&apos;, Amount__c * 0.05, 0)',
    );
  });

  it('keeps no table of places for a text that stands in the file as it is', () => {
    const document = read(FIELD);
    const label = textOf(childOf(document.root, 'label'));
    expect(label.starts).toBeNull();
    expect(label.ends).toBeNull();
    expect(written(document, label, 5, 8)).toBe('Fee');
    expect(textOf(childOf(document.root, 'formula')).starts).not.toBeNull();
  });

  it('refuses a part of a text that is not in it', () => {
    const label = textOf(childOf(read(FIELD).root, 'label'));
    expect(() => sourceOf(label, 9)).toThrow(RangeError);
    expect(() => sourceOf(label, -1)).toThrow(RangeError);
    expect(() => sourceOf(label, 3, 2)).toThrow(RangeError);
    expect(() => sourceOf(label, 0.5)).toThrow(RangeError);
    expect(() => read(FIELD).place(FIELD.length + 1)).toThrow(RangeError);
    expect(() => read(FIELD).place(-1)).toThrow(RangeError);
  });

  it('replaces the five entities and character references, and takes a CDATA section as it stands', () => {
    const document = read(
      '<a>&lt;&gt;&amp;&apos;&quot; &#65;&#x42;&#x0000043; &#128512;&#x1F600; <![CDATA[<b> &amp; ]] ]]>&#13;&#10;</a>',
    );
    const text = textOf(document.root);
    expect(text.value).toBe('<>&\'" ABC \u{1F600}\u{1F600} <b> &amp; ]] \r\n');
    expect(written(document, text, 0)).toBe('&lt;');
    expect(written(document, text, 6, 9)).toBe('&#65;&#x42;&#x0000043;');
    // A character outside the basic plane is two code units, and both stand where the reference stands.
    expect(written(document, text, 10)).toBe('&#128512;');
    expect(written(document, text, 11)).toBe('&#128512;');
    expect(written(document, text, 10, 12)).toBe('&#128512;');
    expect(written(document, text, 15, 18)).toBe('<b>');
    expect(written(document, text, 19, 24)).toBe('&amp;');
    // The character before the end of the section ends where it stands, not where the next one starts.
    expect(sourceOf(text, 27).end).toBe(document.text.indexOf(']]>'));
    expect(written(document, text, 28)).toBe('&#13;');
  });

  it('takes an entity that is written with an entity as text', () => {
    expect(textOf(read('<a>&amp;lt; &#38;amp; &amp;#65;</a>').root).value).toBe('&lt; &amp; &#65;');
  });

  it('skips a comment, also inside a text, and one with two hyphens', () => {
    const document = read('<!-- before --><a><!-- x -->one<!-- -- > -->two<!----></a><!-- after -->\n');
    const text = textOf(document.root);
    expect(text.value).toBe('onetwo');
    expect(written(document, text, 0, 3)).toBe('one');
    expect(written(document, text, 3, 6)).toBe('two');
    expect(sourceOf(text, 2).end).toBe(document.text.indexOf('one') + 3);
    expect(document.text.slice(text.start, text.end)).toBe('one<!-- -- > -->two');
  });

  it('reads an element without content, written in both ways', () => {
    const document = read('<a><b/><c></c><d> </d><e\n/></a>');
    expect(plainOf(document.root).children).toEqual([
      { name: 'b', attributes: {}, children: [], text: '' },
      { name: 'c', attributes: {}, children: [], text: '' },
      { name: 'd', attributes: {}, children: [], text: ' ' },
      { name: 'e', attributes: {}, children: [], text: '' },
    ]);
    const [b, c] = document.root.children;
    if (b === undefined || c === undefined) throw new Error('No children.');
    expect([b.start, b.end, b.contentStart, b.contentEnd]).toEqual([3, 7, 7, 7]);
    expect([b.text?.start, b.text?.end]).toEqual([7, 7]);
    expect([c.start, c.end, c.contentStart, c.contentEnd]).toEqual([7, 14, 10, 10]);
    expect([c.text?.start, c.text?.end]).toEqual([10, 10]);
  });

  it('drops the white space between child elements, and keeps it in an element without children', () => {
    const document = read('<a>\n  <b> x </b>\r\n\t<![CDATA[ ]]>&#32;<b>\n</b>\n</a>');
    expect(document.root.text).toBeNull();
    expect(childrenOf(document.root, 'b').map((b) => b.text?.value)).toEqual([' x ', '\n']);
  });
});

describe('line ends, the byte order mark and characters of more than one byte', () => {
  it('counts a line for LF, for CRLF and for a CR alone, and gives a line end in a text as one LF', () => {
    const file = '<a>\r\n<b>one\r\ntwo\rthree\nfour</b>\r<c/>\n</a>';
    const document = read(file);
    const text = textOf(childOf(document.root, 'b'));
    expect(text.value).toBe('one\ntwo\nthree\nfour');
    expect(written(document, text, 3)).toBe('\r\n');
    expect(written(document, text, 7)).toBe('\r');
    expect(written(document, text, 13)).toBe('\n');
    expect(document.place(sourceOf(text, 4).start)).toEqual({ line: 3, column: 1, offset: file.indexOf('two') });
    expect(document.place(sourceOf(text, 8).start)).toEqual({ line: 4, column: 1, offset: file.indexOf('three') });
    expect(document.place(sourceOf(text, 14).start)).toEqual({ line: 5, column: 1, offset: file.indexOf('four') });
    const c = childOf(document.root, 'c');
    expect(document.place(c?.start ?? 0)).toEqual({ line: 6, column: 1, offset: file.indexOf('<c/>') });
    expect(document.place(document.root.end).line).toBe(7);
  });

  it('reads a file with a byte order mark, and counts the mark in the bytes only', () => {
    const file = '<?xml version="1.0"?>\n<a>é</a>';
    const reading = readXml(Uint8Array.of(0xef, 0xbb, 0xbf, ...bytesOf(file)));
    expect(reading.issue).toBeNull();
    const document = reading.document;
    if (document === null) throw new Error('Not read.');
    expect(document.byteOrderMark).toBe(true);
    expect(document.text).toBe(file);
    expect(document.declaration).toEqual({ version: '1.0', encoding: null, standalone: null });
    expect(document.place(0)).toEqual({ line: 1, column: 1, offset: 3 });
    expect(document.place(document.root.start)).toEqual({ line: 2, column: 1, offset: 25 });
    // The é is two bytes.
    expect(document.place(document.root.contentEnd)).toEqual({ line: 2, column: 5, offset: 30 });
    expect(document.place(document.root.end)).toEqual({ line: 2, column: 9, offset: 34 });
  });

  it('counts columns in code units and places in bytes', () => {
    const file = '<a k="ö"><t>é\u20AC\u{1F600}</t><b/>\n<u>\u{1F600}</u><c/></a>';
    const document = read(file);
    const bytes = bytesOf(file);
    const b = childOf(document.root, 'b');
    const c = childOf(document.root, 'c');
    if (b === null || c === null) throw new Error('No children.');
    // ö and é are 2 bytes, the euro sign 3, the face 4 bytes and 2 code units.
    expect(document.place(b.start)).toEqual({ line: 1, column: 21, offset: 26 });
    expect(document.place(c.start)).toEqual({ line: 2, column: 10, offset: 42 });
    for (const element of [document.root, b, c]) {
      const from = document.place(element.start).offset;
      const to = document.place(element.end).offset;
      expect(new TextDecoder().decode(bytes.subarray(from, to))).toBe(document.text.slice(element.start, element.end));
    }
    expect(document.place(file.length).offset).toBe(bytes.length);
  });

  it('reads the three forms of the declaration, and a file without one', () => {
    expect(read('<a/>').declaration).toBeNull();
    expect(read("<?xml version='1.0' encoding='utf-8' standalone='yes' ?><a/>").declaration).toEqual({
      version: '1.0',
      encoding: 'utf-8',
      standalone: true,
    });
    expect(read('<?xml version = "1.0"\n standalone="no"?>\n<a/>').declaration).toEqual({
      version: '1.0',
      encoding: null,
      standalone: false,
    });
  });
});

describe('attributes and namespaces', () => {
  const RECORD = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    '    <label>Default</label>',
    '    <values>',
    '        <field>Max_Amount__c</field>',
    '        <value xsi:type="xsd:double">50000.0</value>',
    '    </values>',
    '    <values>',
    '        <field>Note__c</field>',
    '        <value xsi:nil="true"/>',
    '    </values>',
    '</CustomMetadata>',
  ].join('\n');

  it('reads the attributes of the root and of an element, with the namespace of each', () => {
    const document = read(RECORD);
    expect(document.root.attributes.map(({ name, local, namespace }) => [name, local, namespace])).toEqual([
      ['xmlns', 'xmlns', XMLNS_NAMESPACE],
      ['xmlns:xsi', 'xsi', XMLNS_NAMESPACE],
      ['xmlns:xsd', 'xsd', XMLNS_NAMESPACE],
    ]);
    const [first, second] = childrenOf(document.root, 'values').map((values) => childOf(values, 'value'));
    if (first == null || second == null) throw new Error('No values.');
    const type = attributeOf(first, 'type', XSI_NAMESPACE);
    expect(type?.name).toBe('xsi:type');
    expect(type?.value.value).toBe('xsd:double');
    expect(document.text.slice(type?.start, type?.end)).toBe('xsi:type="xsd:double"');
    expect(document.place(type?.start ?? 0)).toEqual({ line: 6, column: 16, offset: RECORD.indexOf('xsi:type') });
    expect(document.text.slice(type?.value.start, type?.value.end)).toBe('xsd:double');
    // An attribute without prefix is in no namespace, and one is not found under another namespace.
    expect(attributeOf(first, 'type')).toBeNull();
    expect(attributeOf(document.root, 'xmlns', XMLNS_NAMESPACE)?.value.value).toBe(METADATA);
    expect(isNil(first)).toBe(false);
    expect(isNil(second)).toBe(true);
    expect(second.text?.value).toBe('');
  });

  it('knows xsi:nil by its namespace, not by its prefix', () => {
    const document = read(
      `<a xmlns:i="${XSI_NAMESPACE}" xmlns:xsi="urn:other"><b i:nil="1"/><c xsi:nil="true"/><d nil="true"/><e i:nil="false"/></a>`,
    );
    expect(document.root.children.map(isNil)).toEqual([true, false, false, false]);
  });

  it('gives an element the namespace of its prefix, of the default, or none', () => {
    const document = read(
      '<a xmlns="urn:one" xmlns:p="urn:p"><b/><p:c><d xmlns=""><e/></d><p:f xmlns:p="urn:q"/></p:c><g xml:lang="en"/></a>',
    );
    const namespaces = (element: XmlElement): unknown[] => [
      element.name,
      element.local,
      element.namespace,
      ...element.children.map(namespaces),
    ];
    expect(namespaces(document.root)).toEqual([
      'a',
      'a',
      'urn:one',
      ['b', 'b', 'urn:one'],
      ['p:c', 'c', 'urn:p', ['d', 'd', null, ['e', 'e', null]], ['p:f', 'f', 'urn:q']],
      ['g', 'g', 'urn:one'],
    ]);
    const lang = childOf(document.root, 'g')?.attributes[0];
    expect([lang?.local, lang?.namespace]).toEqual(['lang', 'http://www.w3.org/XML/1998/namespace']);
    expect(childOf(document.root, 'c')?.name).toBe('p:c');
  });

  it('reads the value of an attribute as XML means it: a tab and a line end are a space', () => {
    const document = read(`<a one="x\ty\nz\r\nw" two='&quot;&lt;&#9;&#10;"' three = "" four\n=\n'>'/>`);
    const values = Object.fromEntries(document.root.attributes.map((one) => [one.name, one.value.value]));
    expect(values).toEqual({ one: 'x y z w', two: '"<\t\n"', three: '', four: '>' });
    const one = attributeOf(document.root, 'one');
    const two = attributeOf(document.root, 'two');
    if (one === null || two === null) throw new Error('No attributes.');
    expect(written(document, one.value, 5)).toBe('\r\n');
    expect(written(document, one.value, 6)).toBe('w');
    expect(written(document, two.value, 1)).toBe('&lt;');
    expect(document.text.slice(one.start, one.end)).toBe('one="x\ty\nz\r\nw"');
    const three = attributeOf(document.root, 'three');
    expect([three?.value.start, three?.value.end]).toEqual([
      document.text.indexOf('""') + 1,
      document.text.indexOf('""') + 1,
    ]);
  });

  it('reads names with the characters XML allows', () => {
    const document = read('<été_1.x-y a·b="1"><名前/><_a/></été_1.x-y>');
    expect(plainOf(document.root)).toEqual({
      name: 'été_1.x-y',
      attributes: { 'a·b': '1' },
      text: null,
      children: [
        { name: '名前', attributes: {}, children: [], text: '' },
        { name: '_a', attributes: {}, children: [], text: '' },
      ],
    });
  });
});

describe('what the reader refuses', () => {
  const refusals: [what: string, file: string, code: XmlIssueCode, line: number, column: number][] = [
    ['an empty file', '', 'XML_MALFORMED', 1, 1],
    ['white space only', ' \n ', 'XML_MALFORMED', 2, 2],
    ['a comment only', '<!-- x -->', 'XML_MALFORMED', 1, 11],
    ['text before the first element', 'x<a/>', 'XML_MALFORMED', 1, 1],
    ['text after the last element', '<a/>\nx', 'XML_MALFORMED', 2, 1],
    ['a second element at the top', '<a/>\n<b/>', 'XML_MALFORMED', 2, 1],
    ['an end tag at the top', '<a/></a>', 'XML_MALFORMED', 1, 5],
    ['an end tag where nothing is open', '</a>', 'XML_MALFORMED', 1, 1],
    ['an element that is not closed', '<a><b></b>', 'XML_MALFORMED', 1, 11],
    ['an end tag of another element', '<a><b></a></b>', 'XML_MALFORMED', 1, 7],
    ['an end tag in another case', '<a></A>', 'XML_MALFORMED', 1, 4],
    ['an end tag without a name', '<a></>', 'XML_MALFORMED', 1, 4],
    ['an end tag that is not closed', '<a></a', 'XML_MALFORMED', 1, 4],
    ['an end tag with an attribute', '<a></a b="1">', 'XML_MALFORMED', 1, 4],
    ['a tag that is not closed', '<a k="1"', 'XML_MALFORMED', 1, 1],
    ['a "<" without a name', '<a>< b/></a>', 'XML_MALFORMED', 1, 4],
    ['a "<" in a text', '<a>1 < 2</a>', 'XML_MALFORMED', 1, 6],
    ['a name that starts with a digit', '<1a/>', 'XML_MALFORMED', 1, 1],
    ['an attribute without a value', '<a k/>', 'XML_MALFORMED', 1, 4],
    ['an attribute without quotes', '<a k=1/>', 'XML_MALFORMED', 1, 4],
    ['an attribute that is not closed', '<a k="1/>', 'XML_MALFORMED', 1, 6],
    ['an attribute with a "<"', '<a k="<"/>', 'XML_MALFORMED', 1, 7],
    ['an attribute twice', '<a k="1" k="2"/>', 'XML_MALFORMED', 1, 10],
    ['two attributes without a space', '<a k="1"l="2"/>', 'XML_MALFORMED', 1, 9],
    ['something else in a tag', '<a "k"/>', 'XML_MALFORMED', 1, 4],
    ['a "/" in a tag that does not close it', '<a / >', 'XML_MALFORMED', 1, 4],
    ['an "&" alone', '<a>Q & A</a>', 'XML_MALFORMED', 1, 6],
    ['an entity XML does not have', '<a>&nbsp;</a>', 'XML_MALFORMED', 1, 4],
    ['an entity in upper case', '<a>&AMP;</a>', 'XML_MALFORMED', 1, 4],
    ['a reference without a semicolon', '<a>&amp</a>', 'XML_MALFORMED', 1, 4],
    ['a reference without digits', '<a>&#;</a>', 'XML_MALFORMED', 1, 4],
    ['a reference with a wrong digit', '<a>&#x1G;</a>', 'XML_MALFORMED', 1, 4],
    ['a reference to a character XML does not allow', '<a>&#0;</a>', 'XML_MALFORMED', 1, 4],
    ['a reference to half a character', '<a>&#xD800;</a>', 'XML_MALFORMED', 1, 4],
    ['a reference beyond the last character', '<a>&#x110000;</a>', 'XML_MALFORMED', 1, 4],
    ['a reference in an attribute that is none', '<a k="&x"/>', 'XML_MALFORMED', 1, 7],
    ['a character XML does not allow', '<a>\u0001</a>', 'XML_MALFORMED', 1, 4],
    ['the end of a CDATA section in a text', '<a>x]]></a>', 'XML_MALFORMED', 1, 5],
    ['a CDATA section that is not closed', '<a><![CDATA[x</a>', 'XML_MALFORMED', 1, 4],
    ['a CDATA section outside the first element', '<![CDATA[x]]><a/>', 'XML_MALFORMED', 1, 1],
    ['a comment that is not closed', '<a><!-- x</a>', 'XML_MALFORMED', 1, 4],
    ['a "<!" that starts nothing known', '<a><!ELEMENT b></a>', 'XML_MALFORMED', 1, 4],
    ['a declaration after a line', '\n<?xml version="1.0"?><a/>', 'XML_MALFORMED', 2, 1],
    ['a declaration inside an element', '<a><?xml version="1.0"?></a>', 'XML_MALFORMED', 1, 4],
    ['a declaration without a version', '<?xml encoding="UTF-8"?><a/>', 'XML_MALFORMED', 1, 1],
    ['a declaration with nothing in it', '<?xml?><a/>', 'XML_MALFORMED', 1, 1],
    ['a declaration that is not closed', '<?xml version="1.0"><a/>', 'XML_MALFORMED', 1, 1],
    ['a declaration with a wrong order', '<?xml encoding="UTF-8" version="1.0"?><a/>', 'XML_MALFORMED', 1, 1],
    ['a declaration with a wrong standalone', '<?xml version="1.0" standalone="maybe"?><a/>', 'XML_MALFORMED', 1, 1],
    ['a prefix that is not declared', '<a><p:b/></a>', 'XML_MALFORMED', 1, 5],
    ['a prefix of an attribute that is not declared', '<a xsi:nil="true"/>', 'XML_MALFORMED', 1, 4],
    ['a prefix that is declared further in', '<a><b xmlns:p="urn:p"/><p:c/></a>', 'XML_MALFORMED', 1, 25],
    ['a name with two colons', '<a:b:c xmlns:a="urn:a"/>', 'XML_MALFORMED', 1, 2],
    ['a name that ends with a colon', '<a: xmlns:a="urn:a"/>', 'XML_MALFORMED', 1, 2],
    ['a prefix declared as nothing', '<a xmlns:p=""/>', 'XML_MALFORMED', 1, 4],
    ['the prefix xml declared as something else', '<a xmlns:xml="urn:x"/>', 'XML_MALFORMED', 1, 4],
    [
      'the same attribute under two prefixes',
      '<a xmlns:p="urn:p" xmlns:q="urn:p" p:k="1" q:k="2"/>',
      'XML_MALFORMED',
      1,
      44,
    ],
    ['XML of version 1.1', '<?xml version="1.1"?><a/>', 'XML_UNSUPPORTED', 1, 1],
    ['an encoding other than UTF-8', '<?xml version="1.0" encoding="ISO-8859-1"?><a/>', 'XML_UNSUPPORTED', 1, 1],
    ['a document type', '<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', 'XML_UNSUPPORTED', 1, 1],
    ['a document type after the declaration', '<?xml version="1.0"?>\n<!DOCTYPE a>\n<a/>', 'XML_UNSUPPORTED', 2, 1],
    ['a processing instruction before the element', '<?xml-stylesheet href="a.xsl"?><a/>', 'XML_UNSUPPORTED', 1, 1],
    ['a processing instruction in an element', '<a><?php x ?></a>', 'XML_UNSUPPORTED', 1, 4],
    ['a processing instruction after the element', '<a/><?x?>', 'XML_UNSUPPORTED', 1, 5],
    ['text before a child element', '<a>x<b/></a>', 'XML_UNSUPPORTED', 1, 4],
    ['text after a child element', '<a>\n<b/>\n  x\n</a>', 'XML_UNSUPPORTED', 3, 3],
    ['text between child elements, as a reference', '<a><b/>&#65;<b/></a>', 'XML_UNSUPPORTED', 1, 8],
    ['text beside a child element, in a CDATA section', '<a><b/> <![CDATA[x]]></a>', 'XML_UNSUPPORTED', 1, 18],
  ];

  it.each(refusals)('refuses %s', (_what, file, code, line, column) => {
    const reading = readXml(bytesOf(file));
    expect(reading.document).toBeNull();
    expect(reading.issue?.code).toBe(code);
    expect([reading.issue?.place?.line, reading.issue?.place?.column]).toEqual([line, column]);
    expect(reading.issue?.message).toMatch(/^[A-Z].*\.$/s);
  });

  it('names the element in the message, and nothing else of the file', () => {
    expect(readXml(bytesOf('<a><b>secret</a>')).issue?.message).toBe('The end tag of "a" stands where "b" is open.');
    expect(readXml(bytesOf('<a>secret &nbsp;</a>')).issue?.message).toBe(
      'The entity "nbsp" is not known. Without a document type, XML has five: lt, gt, amp, apos and quot.',
    );
    expect(readXml(bytesOf('<a>secret<b/></a>')).issue?.message).toBe(
      'The element "a" holds both text and elements, which is not read.',
    );
  });

  it('refuses bytes that are not UTF-8, without a place', () => {
    expect(readXml(Uint8Array.of(0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e)).issue).toEqual({
      code: 'XML_NOT_UTF8',
      message: 'The bytes of the file are not text in UTF-8.',
      place: null,
    });
    // Half a character at the end, and a surrogate written as three bytes.
    expect(readXml(Uint8Array.of(0x3c, 0x61, 0x2f, 0x3e, 0xc3)).issue?.code).toBe('XML_NOT_UTF8');
    expect(readXml(Uint8Array.of(0x3c, 0x61, 0x3e, 0xed, 0xa0, 0x80, 0x3c, 0x2f, 0x61, 0x3e)).issue?.code).toBe(
      'XML_NOT_UTF8',
    );
  });

  it('refuses UTF-16, with a byte order mark and without one', () => {
    const utf16 = (text: string, bigEndian: boolean): number[] =>
      Array.from(text).flatMap((character) => {
        const code = character.charCodeAt(0);
        return bigEndian ? [code >> 8, code & 0xff] : [code & 0xff, code >> 8];
      });
    for (const [mark, bigEndian] of [
      [[0xfe, 0xff], true],
      [[0xff, 0xfe], false],
    ] as const) {
      expect(readXml(Uint8Array.from([...mark, ...utf16('<a/>', bigEndian)])).issue).toEqual({
        code: 'XML_UNSUPPORTED',
        message: 'The file starts with the byte order mark of UTF-16 or UTF-32. Only UTF-8 is read.',
        place: { offset: 0, line: 1, column: 1 },
      });
    }
    // Without the mark, the zero bytes are characters XML does not allow.
    expect(readXml(Uint8Array.from(utf16('<a/>', false))).issue?.code).toBe('XML_MALFORMED');
  });

  it('refuses a second byte order mark as text before the first element', () => {
    const reading = readXml(Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...bytesOf('<a/>')));
    expect(reading.issue?.code).toBe('XML_MALFORMED');
    expect(reading.issue?.place).toEqual({ offset: 3, line: 1, column: 1 });
  });

  it('gives an issue and no exception for every start of a file', () => {
    const file = readFileSync(
      join(
        root,
        'fixtures/billing-sfdx/force-app/main/default/objects/Invoice__c/validationRules/Void_Needs_Admin.validationRule-meta.xml',
      ),
    );
    const whole = readXml(file);
    expect(whole.issue).toBeNull();
    // The file ends with its end tag and a line end. Cut anywhere before the end of that tag, it is not a file.
    const end = file.lastIndexOf(0x3e);
    const codes = new Set<string>();
    for (let length = 0; length <= end; length += 1) {
      const reading = readXml(file.subarray(0, length));
      expect(reading.document).toBeNull();
      expect(reading.issue?.message).toMatch(/\.$/);
      codes.add(reading.issue?.code ?? '');
    }
    // A file that is cut inside "<?xml" starts like a processing instruction, which is refused unread.
    expect([...codes].sort()).toEqual(['XML_MALFORMED', 'XML_UNSUPPORTED']);
  });

  it('reads a file with elements nested ten thousand deep', () => {
    const depth = 10_000;
    const document = read(`${'<a>'.repeat(depth)}x${'</a>'.repeat(depth)}`);
    let element = document.root;
    let seen = 1;
    while (element.children[0] !== undefined) {
      element = element.children[0];
      seen += 1;
    }
    expect(seen).toBe(depth);
    expect(element.text?.value).toBe('x');
  });
});

describe('the files of the fixture project', () => {
  const files = [
    ...readdirSync(join(root, 'fixtures/billing-sfdx'), { recursive: true, encoding: 'utf8' }).map((path) =>
      join('fixtures/billing-sfdx', path),
    ),
    ...readdirSync(join(root, 'fixtures/formula-negative'), { recursive: true, encoding: 'utf8' }).map((path) =>
      join('fixtures/formula-negative', path),
    ),
  ]
    .filter((path) => path.endsWith('.xml'))
    .sort();

  it('are read without an issue, to what fast-xml-parser reads', () => {
    expect(files.length).toBeGreaterThan(90);
    for (const path of files) {
      const bytes = readFileSync(join(root, path));
      const reading = readXml(bytes);
      expect(reading.issue, path).toBeNull();
      if (reading.document === null) continue;
      expect(withAttributeSpaces(plainOf(reading.document.root)), path).toEqual(
        withAttributeSpaces(secondOpinion(reading.document.text)),
      );
      expect(reading.document.root.namespace, path).toBe(METADATA);
    }
  });

  it('gives a rule its formula with the place of each name in it', () => {
    const path =
      'fixtures/billing-sfdx/force-app/main/default/objects/Invoice__c/validationRules/Void_Needs_Admin.validationRule-meta.xml';
    const document = read(readFileSync(join(root, path), 'utf8'));
    const formula = textOf(childOf(document.root, 'errorConditionFormula'));
    expect(formula.value.split('\n')[2]).toBe("  $Profile.Name <> 'System Administrator',");
    const lines = document.text.split('\n');
    for (const name of ['Status__c', '$Profile.Name', '$User.Department', '$UserRole.Name', '$Organization.Country']) {
      const at = formula.value.indexOf(name);
      const { start, end } = sourceOf(formula, at, at + name.length);
      expect(document.text.slice(start, end)).toBe(name);
      const { line, column } = document.place(start);
      expect(lines[line - 1]?.slice(column - 1, column - 1 + name.length)).toBe(name);
    }
    expect(document.place(sourceOf(formula, formula.value.indexOf('$UserRole')).start)).toEqual({
      line: 9,
      column: 3,
      offset: document.text.indexOf('$UserRole'),
    });
  });
});
