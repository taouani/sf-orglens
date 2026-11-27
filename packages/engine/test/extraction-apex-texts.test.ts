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
  placed as placedAt,
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
    // `\u0041` is one character, at the column of its backslash.
    expect(placed(literalText({ line: 1, column: 0 }, String.raw`x\u0041y`))).toBe('x1 A2 y8');
  });

  it('is joined to another, as each of several texts, up to a number of them', () => {
    const a = literalText({ line: 1, column: 1 }, 'a');
    const b = literalText({ line: 1, column: 5 }, 'b');
    expect(joined([a, b], [b]).map(known)).toEqual(['ab', 'bb']);
    expect(distinct([a, a, b]).map(known)).toEqual(['a', 'b']);
    const many = Array.from({ length: MOST_TEXTS + 1 }, (_, index) =>
      literalText({ line: 1, column: 1 }, String(index)),
    );
    // Of more, the first are kept, and a text that is not known stands for the others where the value is used.
    expect(distinct(many).map(placed)).toEqual([...many.slice(0, MOST_TEXTS - 1).map(placed), '?undefined:undefined']);
    expect(distinct(many.slice(1))).toHaveLength(MOST_TEXTS);
    expect(joined(many, many)).toHaveLength(MOST_TEXTS);
  });

  it('stands where a member uses it, when it is a constant or what a method gives, with what the call gives', () => {
    const template: Text = [...literalText({ line: 1, column: 1 }, 'SELECT '), ...holeText(undefined, 'text', 0)];
    const at = { line: 9, column: 4 };
    const given = literalText({ line: 9, column: 20 }, 'Id');
    expect(usedAt([template], at, [[given]]).map(placed)).toEqual(['S4 E4 L4 E4 C4 T4  4 | I21 d22']);
    // A parameter the call gives nothing for is not known, and stands at the call.
    expect(usedAt([template], at).map(placed)).toEqual(['S4 E4 L4 E4 C4 T4  4 | ?9:4']);
  });

  it('is changed as the methods of a text change it, and keeps the place of each character', () => {
    const text = literalText({ line: 1, column: 1 }, "  it's  ");
    expect(placed(trimmed(text))).toBe("i4 t5 '6 s7");
    expect(placed(withoutEnd(trimmed(text), "'s"))).toBe('i4 t5');
    expect(placed(withoutStart(trimmed(text), 'it'))).toBe("'6 s7");
    expect(withoutEnd(text, 'no')).toBe(text);
    expect(placed(escaped(trimmed(text)))).toBe("i4 t5 | \\6 '6 | s7");
    // Across the pieces of a text put together: a piece of spaces only, and an end or a start in two pieces.
    const two: Text = [
      ...literalText({ line: 1, column: 1 }, ' '),
      ...literalText({ line: 2, column: 1 }, ' Name, '),
      ...literalText({ line: 3, column: 1 }, ', '),
    ];
    expect(placed(trimmed(two))).toBe('N3 a4 m5 e6 ,7  8 | ,2');
    expect(placed(withoutEnd(two, ', , '))).toBe(' 2 |  2 N3 a4 m5 e6');
    expect(placed(withoutStart(two, '  Na'))).toBe('m5 e6 ,7  8 | ,2  3');
  });

  it('places a part that a branch does not know where the value enters a text', () => {
    const texts = [[...literalText({ line: 1, column: 1 }, 'a'), ...holeText(undefined, 'text')]];
    expect(placedAt(texts, { line: 5, column: 2 }).map(placed)).toEqual(['a2 | ?5:2']);
    // A part of a parameter is given by the call, and one that has a place keeps it.
    const kept = [[...holeText(undefined, 'text', 0), ...holeText({ line: 1, column: 1 }, 'text')]];
    expect(placedAt(kept, { line: 5, column: 2 })).toBe(kept);
  });

  it('is formatted as Java formats a message: two quotes are one, and one quote keeps what follows as it is', () => {
    const format = literalText({ line: 1, column: 1 }, "{0} = ''{1}'' '{2}' {3}");
    const items = [[literalText({ line: 2, column: 1 }, 'Name')], undefined];
    expect(formatted(format, items, { line: 2, column: 1 }).map(known)).toEqual([undefined]);
    const texts = formatted(format, items, { line: 2, column: 1 });
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
    ['FIND ? RETURNING A(?)', "FIND 'x' RETURNING A(h1)"],
    // The braces of a search are a literal in quotes, as a search in brackets writes it, with a part in them.
    ['FIND {?} RETURNING A', "FIND 'x' RETURNING A"],
    ['FIND {Acme} IN ? FIELDS RETURNING A', "FIND 'xxxx' IN ALL FIELDS RETURNING A"],
    // More of the select list after a whole name, and nothing after the end of a query.
    ['SELECT Name? FROM A', 'SELECT Name, h0 FROM A'],
    ['SELECT Id FROM A?', 'SELECT Id FROM A'],
    ['SELECT Id FROM A WHERE B = 1 ?', 'SELECT Id FROM A WHERE B = 1 '],
    // A direction after the last of several fields of the order, a scope, a number of days and a bind.
    ['SELECT Id FROM A ORDER BY Name, CreatedDate ?', 'SELECT Id FROM A ORDER BY Name, CreatedDate ASC'],
    ['SELECT Id FROM A USING SCOPE ?', 'SELECT Id FROM A USING SCOPE Everything'],
    ['SELECT Id FROM A WHERE CreatedDate = LAST_N_DAYS:?', 'SELECT Id FROM A WHERE CreatedDate = LAST_N_DAYS:0'],
    ['SELECT Id FROM A WHERE Id IN :?', 'SELECT Id FROM A WHERE Id IN :h0'],
    // A value in the brackets of a list.
    ['SELECT Id FROM A WHERE B IN (?)', 'SELECT Id FROM A WHERE B IN (null)'],
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

  it('fills a number in a name as a part of the name, and keeps a quote that a backslash escapes in a literal', () => {
    const name: Text = [
      ...literalText({ line: 1, column: 1 }, 'SELECT Field'),
      ...holeText({ line: 1, column: 20 }, 'number'),
      ...literalText({ line: 1, column: 30 }, '__c FROM A'),
    ];
    expect(composed(name).source).toBe('SELECT FieldzzOrgLensHole0__c FROM A');
    expect(composed(name).filled[0]?.named).toBe(true);
    const quote: Text = [
      ...literalText({ line: 1, column: 1 }, String.raw`SELECT Id FROM A WHERE B = 'it\\\'s `),
      ...holeText({ line: 1, column: 40 }, 'text'),
      ...literalText({ line: 1, column: 50 }, "'"),
    ];
    // The quote after the backslash does not end the literal, so the part is in it.
    expect(composed(quote).source).toBe("SELECT Id FROM A WHERE B = 'it\\'s x'");
    expect(composed(quote).filled[0]?.quoted).toBe(true);
  });
});
