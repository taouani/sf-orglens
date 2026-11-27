/**
 * The reader of the markup of a Lightning component (decision record 0094): the elements of a template, their
 * attributes and the element around each, and how it steps over what holds no element. That it reads every template,
 * Aura component and page of the public codebases without stopping is held by `extraction-corpora.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readMarkup, type MarkupReading } from '../src/extraction/markup.ts';

/** Each element as `name<parent` with its attributes as `name=value`, `name` alone where it has no value. */
const shown = (reading: MarkupReading): string[] =>
  reading.elements.map((element) => {
    const parent = element.parent === -1 ? '' : `<${reading.elements[element.parent]?.name ?? '?'}`;
    const attributes = element.attributes.map((one) => (one.value === null ? one.name : `${one.name}=${one.value}`));
    return [`${element.name}${parent}`, ...attributes].join(' ');
  });

describe('the reader of markup', () => {
  it('reads each element with its attributes, written in quotes, in braces, bare or without a value', () => {
    const text = [
      '<template>',
      '    <lightning-card title="Invoices" icon-name=\'standard:account\'>',
      '        <c-invoice-badge status={status} onselect={handle} hidden data-id=one></c-invoice-badge>',
      '        <input value = "a b" disabled/>',
      '        <p class="x">a < b, and a > b</p>',
      "        <c-five 'odd'></c-five>",
      '    </lightning-card>',
      '</template>',
      '',
    ].join('\n');
    const reading = readMarkup(text);
    expect(reading.stop).toBeNull();
    expect(shown(reading)).toEqual([
      'template',
      'lightning-card<template title=Invoices icon-name=standard:account',
      'c-invoice-badge<lightning-card status={status} onselect={handle} hidden data-id=one',
      'input<lightning-card value=a b disabled',
      'p<lightning-card class=x',
      "c-five<lightning-card ' odd '",
    ]);
    // Each place is that of the first character of the name, or of the value after its quote.
    for (const element of reading.elements) {
      expect(text.slice(element.start, element.start + element.name.length)).toBe(element.name);
      for (const attribute of element.attributes) {
        expect(text.slice(attribute.start, attribute.start + attribute.name.length)).toBe(attribute.name);
        const value = attribute.value ?? attribute.name;
        expect(text.slice(attribute.valueStart, attribute.valueStart + value.length)).toBe(value);
      }
    }
  });

  it('opens no element that has no end tag, or that closes itself, and closes those an end tag leaves open', () => {
    const text = [
      '<div><BR><img src=a/><img src="b"><c-one/><span>',
      '<c-two></c-two>',
      '</div>',
      '<C-Three></c-THREE>',
      '</nothing>',
      '<c-four></c-four>',
    ].join('\n');
    expect(shown(readMarkup(text))).toEqual([
      'div',
      'BR<div',
      'img<div src=a',
      'img<div src=b',
      'c-one<div',
      'span<div',
      'c-two<span',
      'C-Three',
      'c-four',
    ]);
  });

  it('steps over comments, declarations, the content of a script or a style, and a brace that holds a space', () => {
    const text = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?instruction a > <c-in-instruction> ?>',
      '<!DOCTYPE html>',
      '<!-- a > b <c-in-comment></c-in-comment> -->',
      '<![CDATA[ a > b <c-in-data> ]]>',
      '<script>if (a <c-in-script) {}</SCRIPT>',
      '<STYLE>p::after { content: "<c-in-style>"; }</style>',
      '<c-after value={a > b ? one : two} label="</c-x>"></c-after>',
    ].join('\n');
    const reading = readMarkup(text);
    expect(shown(reading)).toEqual(['script', 'STYLE', 'c-after value={a > b ? one : two} label=</c-x>']);
    expect(reading.stop).toBeNull();
  });

  it('stops at what is not closed, says where and in what, and keeps what it read before', () => {
    const cases: [string, string, 'comment' | 'tag'][] = [
      ['<c-one></c-one>\n<!-- open\n<c-two></c-two>', '<!--', 'comment'],
      ['<c-one></c-one>\n<![CDATA[ open\n<c-two></c-two>', '<![CDATA[', 'comment'],
      ['<c-one></c-one>\n<!DOCTYPE html\n', '<!DOCTYPE', 'tag'],
      ['<c-one></c-one>\n<c-two value="open></c-two>', '<c-two', 'tag'],
      ['<c-one></c-one>\n<c-two value={open></c-two>', '<c-two', 'tag'],
      ['<c-one></c-one>\n<c-two label', '<c-two', 'tag'],
      ['<c-one></c-one>\n</c-one', '</c-one', 'tag'],
    ];
    for (const [text, at, what] of cases) {
      const reading = readMarkup(text);
      expect(reading.elements.map((one) => one.name)).toEqual(['c-one']);
      expect(reading.stop).toEqual({ at: text.lastIndexOf(at), what });
    }
  });
});
