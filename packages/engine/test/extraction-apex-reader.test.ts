/**
 * The reader of Apex (`extraction/apex-reader.ts`): what it makes of a file, where it says that it cannot read
 * one, and that its grammar is loaded once. A second parser holds the whole model in
 * `extraction-apex-adapters.test.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import type { ApexReader, Expr, Member, Stmt, TypeDecl, Unit } from '../src/extraction/apex-syntax.ts';
import { PROBES, probeSource, readApexFiles } from './helpers/apex-sources.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';

let reader: ApexReader;
beforeAll(async () => {
  reader = await loadApexReader();
});

/** The place of the `nth` occurrence of a word in a text of one line, as the model gives it. */
const at = (source: string, word: string, nth = 1): { line: number; column: number } => {
  let index = -1;
  for (let found = 0; found < nth; found += 1) index = source.indexOf(word, index + 1);
  if (index === -1) throw new Error(`"${word}" is not in the text.`);
  return { line: 1, column: index + 1 };
};

const onlyType = (unit: Unit): TypeDecl => {
  expect(unit.problems).toEqual([]);
  const [type] = unit.types;
  if (type === undefined || unit.types.length !== 1) throw new Error('The file has not one type.');
  return type;
};

const methodBody = (member: Member | undefined): readonly Stmt[] => {
  if (member?.kind !== 'method' || member.body?.kind !== 'block') throw new Error('No method with a body.');
  return member.body.stmts;
};

/** An expression in a few words, for a comparison that does not hold every place. */
const shown = (expr: Expr): string => {
  if (expr.kind === 'name') return expr.name.text;
  if (expr.kind === 'string') return `'${expr.raw}'`;
  if (expr.kind === 'literal') return expr.text.toLowerCase();
  return expr.kind;
};

describe('the reader of Apex', () => {
  it('is loaded once', async () => {
    expect(await loadApexReader()).toBe(reader);
    expect(reader.name).toBe('web-tree-sitter-sfapex');
  });

  it('reads every Apex file of the fixture project without a problem', () => {
    const files = readApexFiles(join(FIXTURES_DIR, 'billing-sfdx'));
    expect(files.map((file) => file.kind).sort()).toEqual([...Array<string>(28).fill('class'), 'trigger', 'trigger']);
    for (const file of files) expect(reader.parseUnit(file.source, file.kind).problems, file.path).toEqual([]);
  });

  it.each(PROBES)('reads $name', (probe) => {
    const { source, kind } = probeSource(probe);
    expect(reader.parseUnit(source, kind).problems).toEqual([]);
  });

  it('says that it has a problem with a file that is not Apex, and does not throw', () => {
    const folder = join(FIXTURES_DIR, 'parser-negative');
    const files = readdirSync(folder).filter((file) => file.endsWith('.cls'));
    expect(files).toHaveLength(5);
    for (const file of files) {
      const unit = reader.parseUnit(readFileSync(join(folder, file), 'utf8'), 'class');
      expect(unit.problems.length, file).toBeGreaterThan(0);
    }
  });

  it('keeps the class a class extends, the interfaces it implements, and those an interface extends', () => {
    const source =
      'public virtual class A extends Base implements I1, Outer.I2 { interface J extends K, L { void m(); } enum Color { RED, GREEN } }';
    const type = onlyType(reader.parseUnit(source, 'class'));
    expect(type.name).toEqual({ text: 'A', at: at(source, 'A') });
    expect(type.extends).toEqual([{ name: 'Base', args: [], array: 0, at: at(source, 'Base') }]);
    expect(type.implements).toEqual([
      { name: 'I1', args: [], array: 0, at: at(source, 'I1') },
      { name: 'Outer.I2', args: [], array: 0, at: at(source, 'Outer') },
    ]);
    const [inner, color] = type.members;
    if (inner?.kind !== 'type' || color?.kind !== 'type') throw new Error('The class holds no inner types.');
    expect(inner.decl).toMatchObject({ kind: 'interface', implements: [] });
    expect(inner.decl.extends.map((one) => one.name)).toEqual(['K', 'L']);
    expect(color.decl).toMatchObject({ kind: 'enum', extends: [], implements: [] });
    expect(color.decl.values.map((value) => value.text)).toEqual(['RED', 'GREEN']);
  });

  it('gives a class without extends and implements empty lists', () => {
    const type = onlyType(reader.parseUnit('public class A { }', 'class'));
    expect({ extends: type.extends, implements: type.implements }).toEqual({ extends: [], implements: [] });
  });

  it('keeps the values of a when beside the type it binds', () => {
    const source =
      "public class S { void m(Object o, String s, Color c) { switch on s { when 'a', 'b' { } when null { } when else { } } switch on o { when Account a { } } switch on c { when RED, GREEN { } } } }";
    const [onText, onObject, onEnum] = methodBody(onlyType(reader.parseUnit(source, 'class')).members[0]);
    if (onText?.kind !== 'switch' || onObject?.kind !== 'switch' || onEnum?.kind !== 'switch')
      throw new Error('The method holds no three switches.');
    expect(onText.whens.map((when) => when.values.map(shown))).toEqual([["'a'", "'b'"], ['null'], []]);
    expect(onText.whens.map((when) => when.binding)).toEqual([undefined, undefined, undefined]);
    expect(onObject.whens).toHaveLength(1);
    expect(onObject.whens[0]?.values).toEqual([]);
    expect(onObject.whens[0]?.binding).toEqual({
      type: { name: 'Account', args: [], array: 0, at: at(source, 'Account') },
      name: { text: 'a', at: at(source, 'a {') },
    });
    expect(onEnum.whens.map((when) => when.values.map(shown))).toEqual([['RED', 'GREEN']]);
  });

  it('keeps a class that a trigger declares', () => {
    const unit = reader.parseUnit(
      'trigger InvoiceTrigger on Invoice__c (before insert) { Helper.run(); class Inner { void m() { } } }',
      'trigger',
    );
    expect(unit.problems).toEqual([]);
    expect(unit.types).toEqual([]);
    expect(unit.trigger?.name.text).toBe('InvoiceTrigger');
    expect(unit.trigger?.object.text).toBe('Invoice__c');
    expect(unit.trigger?.body.map((stmt) => stmt.kind)).toEqual(['expr']);
    expect(
      unit.trigger?.members.map((member) => (member.kind === 'type' ? member.decl.name.text : member.kind)),
    ).toEqual(['Inner']);
  });

  it('counts a column in UTF-16 units, also behind a character of two units', () => {
    const source = "public class C { void m(Invoice__c inv) { String e = '\u{1F600}\u{1F600}'; inv.Amount__c = 1; } }";
    const [, assignment] = methodBody(onlyType(reader.parseUnit(source, 'class')).members[0]);
    if (assignment?.kind !== 'expr' || assignment.expr.kind !== 'assign' || assignment.expr.left.kind !== 'dot')
      throw new Error('No assignment to a field.');
    expect(assignment.expr.left.name).toEqual({ text: 'Amount__c', at: at(source, 'Amount__c') });
  });

  it('reads a file that starts with a byte order mark, with the places of the text without it', () => {
    const type = onlyType(reader.parseUnit('﻿public class Marked { }', 'class'));
    expect(type.name).toEqual({ text: 'Marked', at: { line: 1, column: 14 } });
  });

  it('gives the problems in the order of the text, without quoting the source', () => {
    const source = [
      'public class Broken {',
      '    void first() {',
      '        Integer secretValue = ;',
      '    }',
      '    void second() {',
      '        if (secretCondition {',
      '    }',
      '}',
      '',
    ].join('\n');
    const { problems } = reader.parseUnit(source, 'class');
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems[0]?.at.line).toBe(3);
    const places = problems.map(({ at: place }) => place.line * 1000 + place.column);
    expect(places).toEqual([...places].sort((a, b) => a - b));
    for (const problem of problems) expect(problem.message).not.toMatch(/secret/i);
  });

  it('says that a file holds something beside the one type or trigger it declares', () => {
    const cases = [
      { source: "public class A { } System.debug('x');", kind: 'class', word: 'System' },
      { source: 'Integer i = 1; public class A { }', kind: 'class', word: 'Integer' },
      { source: 'public class A { } public class B { }', kind: 'class', word: 'public class B' },
      { source: 'public class A { } trigger T on Account (before insert) { }', kind: 'trigger', word: 'public' },
    ] as const;
    for (const { source, kind, word } of cases) {
      const message = `The file holds something beside the ${kind === 'class' ? 'type' : 'trigger'} it declares.`;
      expect(reader.parseUnit(source, kind).problems, source).toEqual([{ at: at(source, word), message }]);
    }
    // A comment is no declaration.
    expect(reader.parseUnit('/* head */ public class A { } // tail', 'class').problems).toEqual([]);
  });

  it('reads an operator that is written with a space inside it', () => {
    const source = 'public class C { void m(Integer a) { Boolean b = a > = 0; } }';
    const [local] = methodBody(onlyType(reader.parseUnit(source, 'class')).members[0]);
    if (local?.kind !== 'local' || local.vars[0]?.init?.kind !== 'binary') throw new Error('No comparison.');
    expect(local.vars[0].init.op).toBe('>=');
  });

  it('says that a file declares nothing', () => {
    expect(reader.parseUnit('', 'class').problems).toEqual([
      { at: { line: 1, column: 1 }, message: 'The file declares no type.' },
    ]);
    expect(reader.parseUnit('// only a comment\n', 'class').problems).toEqual([
      { at: { line: 1, column: 1 }, message: 'The file declares no type.' },
    ]);
    expect(reader.parseUnit('public class C { }', 'trigger').problems).toContainEqual({
      at: { line: 1, column: 1 },
      message: 'The file declares no trigger.',
    });
  });

  it('reads a query that is built as text, and refuses text that is not one query', () => {
    const query = reader.parseQuery(
      'SELECT Id, Account__r.Name FROM Invoice__c WHERE Status__c = :status ORDER BY Name',
    );
    expect(query?.from.map((part) => part.text)).toEqual(['Invoice__c']);
    expect(query?.fields.map((path) => path.map((part) => part.text).join('.'))).toEqual([
      'Id',
      'Account__r.Name',
      'Status__c',
      'Name',
    ]);
    expect(query?.binds.map(shown)).toEqual(['status']);
    // The places are places in the text: the first line, and the column of the word.
    expect(query?.from[0]?.at).toEqual({ line: 1, column: 33 });
    expect(reader.parseQuery('SELECT Id FROM Account WHERE Name = ')).toBeUndefined();
    expect(reader.parseQuery('SELECT Id FROM Account]; delete [SELECT Id FROM Contact')).toBeUndefined();
    expect(reader.parseQuery('SELECT Id FROM Account];} class Z{Object z=[SELECT Name FROM Contact')).toBeUndefined();
    expect(reader.parseQuery('this is not a query')).toBeUndefined();
    // A file read after a query has the places of its own text.
    expect(onlyType(reader.parseUnit('public class After { }', 'class')).name.at).toEqual({ line: 1, column: 14 });
  });

  it('says whether a query gives records, rows of aggregates or a number, and that an alias is no field', () => {
    const read = (text: string): unknown => {
      const query = reader.parseQuery(text);
      return [query?.gives, query?.fields.map((path) => path.map((part) => part.text).join('.'))];
    };
    expect(read('SELECT Id, toLabel(Status__c) FROM Invoice__c')).toEqual(['records', ['Id', 'Status__c']]);
    expect(read('SELECT COUNT() FROM Invoice__c WHERE Amount__c > 0')).toEqual(['count', ['Amount__c']]);
    expect(read('SELECT COUNT(Id) n FROM Invoice__c')).toEqual(['aggregates', ['Id']]);
    expect(read('SELECT FORMAT(SUM(Amount__c)) total FROM Invoice__c')).toEqual(['aggregates', ['Amount__c']]);
    expect(read('SELECT Account__c a FROM Invoice__c GROUP BY Account__c')).toEqual([
      'aggregates',
      ['Account__c', 'Account__c'],
    ]);
    // `FIELDS()` names no field: it is kept apart, with its parameter in upper case.
    const every = reader.parseQuery('SELECT Name, FIELDS(custom) FROM Invoice__c LIMIT 200');
    expect([every?.fields.length, every?.everyField]).toEqual([1, [{ text: 'CUSTOM', at: { line: 1, column: 14 } }]]);
    // A subquery of the filter gives what its own select list says.
    const nested = reader.parseQuery('SELECT COUNT() FROM Account WHERE Id IN (SELECT AccountId FROM Contact)');
    expect([nested?.gives, nested?.nested[0]?.gives]).toEqual(['count', 'records']);
  });
});
