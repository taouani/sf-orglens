/**
 * The texts that the resolver of Apex follows (decision record 0090): pieces of characters, each with its place,
 * and parts that are not known.
 */
import { describe, expect, it } from 'vitest';
import {
  composed,
  distinct,
  escaped,
  formatted,
  holeText,
  joined,
  known,
  literalText,
  MOST_TEXTS,
  nameIn,
  trimmed,
  usedAt,
  withoutEnd,
  withoutStart,
  wordText,
  type Text,
} from '../src/extraction/apex-texts.ts';

/** Each character of the characters a text knows with its column, and a part that is not known as `?`. */
const placed = (text: Text): string =>
  text
    .map((piece) => {
      if (piece.k === 'hole') return `?${String(piece.at?.line)}:${String(piece.at?.column)}`;
      return Array.from({ length: piece.text.length }, (_, index) => piece.text.charAt(index))
        .map((char, index) => `${char}${String(piece.columns?.[index] ?? piece.at?.column)}`)
        .join(' ');
    })
    .join(' | ');

describe('a text of Apex', () => {
  it('is the text of a literal, each character at its column, with the escapes of Apex read', () => {
    // The quote stands at column 10: the first character at 11.
    const text = literalText({ line: 3, column: 10 }, String.raw`a\'b\nA`);
    expect(known(text)).toBe("a'b\nA");
    expect(placed(text)).toBe("a11 '12 b14 \n15 A17");
    expect(literalText({ line: 1, column: 1 }, '')).toEqual([]);
    expect(placed(wordText({ line: 2, column: 5 }, '42'))).toBe('45 26');
  });

  it('is joined to another, as each of several texts, up to a number of them', () => {
    const a = literalText({ line: 1, column: 1 }, 'a');
    const b = literalText({ line: 1, column: 5 }, 'b');
    expect(joined([a, b], [b])?.map(known)).toEqual(['ab', 'bb']);
    expect(distinct([a, a, b])?.map(known)).toEqual(['a', 'b']);
    const many = Array.from({ length: MOST_TEXTS + 1 }, (_, index) =>
      literalText({ line: 1, column: 1 }, String(index)),
    );
    expect(distinct(many)).toBeUndefined();
    expect(distinct(many.slice(1))).toHaveLength(MOST_TEXTS);
  });

  it('stands where a member uses it, when it is a constant or what a method gives, with what the call gives', () => {
    const template: Text = [...literalText({ line: 1, column: 1 }, 'SELECT '), ...holeText(undefined, 'text', 0)];
    const at = { line: 9, column: 4 };
    const given = literalText({ line: 9, column: 20 }, 'Id');
    expect(usedAt([template], at, [[given]])?.map(placed)).toEqual(['S4 E4 L4 E4 C4 T4  4 | I21 d22']);
    // A parameter the call gives nothing for is not known, and stands at the call.
    expect(usedAt([template], at)?.map(placed)).toEqual(['S4 E4 L4 E4 C4 T4  4 | ?9:4']);
  });

  it('is changed as the methods of a text change it, and keeps the place of each character', () => {
    const text = literalText({ line: 1, column: 1 }, "  it's  ");
    expect(placed(trimmed(text))).toBe("i4 t5 '6 s7");
    expect(placed(withoutEnd(trimmed(text), "'s"))).toBe('i4 t5');
    expect(placed(withoutStart(trimmed(text), 'it'))).toBe("'6 s7");
    expect(withoutEnd(text, 'no')).toBe(text);
    expect(placed(escaped(trimmed(text)))).toBe("i4 t5 | \\6 '6 | s7");
  });

  it('is formatted as Java formats a message: two quotes are one, and one quote keeps what follows as it is', () => {
    const format = literalText({ line: 1, column: 1 }, "{0} = ''{1}'' '{2}' {3}");
    const items = [[literalText({ line: 2, column: 1 }, 'Name')], undefined];
    expect(formatted(format, items, { line: 2, column: 1 })?.map(known)).toEqual([undefined]);
    const texts = formatted(format, items, { line: 2, column: 1 }) ?? [];
    expect(texts.map((text) => text.map((piece) => (piece.k === 'hole' ? '?' : piece.text)).join(''))).toEqual([
      "Name = '?' {2} ?",
    ]);
  });

  it('is a name where its characters are one name, and says where it is not known otherwise', () => {
    expect(nameIn(literalText({ line: 1, column: 1 }, 'Amount__c'))).toEqual({
      name: { text: 'Amount__c', at: { line: 1, column: 2 } },
    });
    expect(nameIn(literalText({ line: 1, column: 1 }, 'Account.Name'))).toEqual({ unknown: { line: 1, column: 2 } });
    expect(
      nameIn([...literalText({ line: 1, column: 1 }, 'ns__'), ...holeText({ line: 4, column: 8 }, 'text')]),
    ).toEqual({
      unknown: { line: 4, column: 8 },
    });
  });

  it.each([
    // In the select list, as a field, and a condition after `WHERE`, or the field of one before an operator.
    ["SELECT ? FROM Invoice__c WHERE ? AND ? = 'x'", "SELECT h0 FROM Invoice__c WHERE h1 != null AND h2 = 'x'"],
    // A value after an operator, a list after `IN`, a number after `LIMIT`, and a text in quotes.
    [
      "SELECT Id FROM A WHERE B = ? AND C IN ? AND D = '?' LIMIT ?",
      "SELECT Id FROM A WHERE B = null AND C IN (null) AND D = 'x' LIMIT 0",
    ],
    // Part of a name, a direction of the order and `WITH`.
    [
      'SELECT Id FROM A WHERE ?__B__c > 0 WITH ? ORDER BY Name ?',
      'SELECT Id FROM A WHERE h0__B__c > 0 WITH SECURITY_ENFORCED ORDER BY Name ASC',
    ],
    // The start of a query, with or without its object, and the list of a function or of an object of a search.
    ['? FROM A', 'SELECT h0 FROM A'],
    ['? WHERE B = 1', 'SELECT h0 FROM h0x WHERE B = 1'],
    ['FIND ? RETURNING A(?)', 'FIND {x} RETURNING A(h1)'],
  ])('is filled where it is not known, as what can stand there: %s', (written, filled) => {
    const text: Text = written
      .split('?')
      .flatMap((part, index) => [
        ...(index === 0 ? [] : holeText({ line: 1, column: index }, 'text')),
        ...literalText({ line: 1, column: 0 }, part),
      ]);
    expect(composed(text).source.replace(/zzOrgLensHole/g, 'h')).toBe(filled);
  });

  it('is put on one line, each character with its place, and says which parts stand for a name', () => {
    const text: Text = [
      ...literalText({ line: 1, column: 1 }, 'SELECT\n'),
      ...holeText({ line: 2, column: 7 }, 'text'),
      ...literalText({ line: 3, column: 1 }, ' FROM A LIMIT '),
      ...holeText({ line: 4, column: 3 }, 'number'),
    ];
    const put = composed(text);
    expect(put.source).toBe('SELECT zzOrgLensHole0 FROM A LIMIT 0');
    expect(put.places[0]).toEqual({ line: 1, column: 2 });
    expect(put.places[7]).toEqual({ line: 2, column: 7 });
    expect(put.filled).toEqual([
      { start: 7, end: 21, at: { line: 2, column: 7 }, quoted: false, named: true },
      { start: 35, end: 36, at: { line: 4, column: 3 }, quoted: false, named: false },
    ]);
  });
});
