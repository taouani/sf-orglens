/**
 * The names in a text with merge fields: where a merge field starts and ends, the formula language as a flow
 * writes it, what the name of a merge field stands for, and the references both give once they are resolved.
 *
 * The probes of `fixtures/merge-field-probes.yaml` are read here as a whole. No analyser of flows exists yet, so
 * the last parts say by hand what each resource of a flow of the fixture project is, and hold what the readers
 * find against the answer key.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseKey, type ComponentKey } from '../src/core/keys.ts';
import type { Reference } from '../src/core/references.ts';
import { analyseSource } from '../src/extraction/analyse.ts';
import { namesOfTokens, namesOfTree, parseFormula, type FormulaToken } from '../src/extraction/formula.ts';
import { usesOfMergeField, usesOfName, type MergeStart, type NameUse } from '../src/extraction/formula-names.ts';
import { mergeFieldsOf } from '../src/extraction/merge-fields.ts';
import { buildModel, type FieldFacts, type ObjectModel } from '../src/extraction/model.ts';
import {
  readFormula,
  readFormulaOfMergeFields,
  readMergeFields,
  type StartOf,
} from '../src/extraction/names-in-text.ts';
import { resolveReferences, type RawReference } from '../src/extraction/raw-references.ts';
import { placesIn, valueOf, type PlaceOf } from '../src/extraction/values.ts';
import { readXml, type XmlDocument, type XmlElement } from '../src/extraction/xml.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { HEAD, key, viaOf, XMLNS } from './helpers/written-source.ts';

/** A merge field as `text@start open-close`. */
const fieldsOf = (text: string): string[] =>
  mergeFieldsOf(text).fields.map(
    (field) => `${field.text}@${String(field.start)} ${String(field.open)}-${String(field.close)}`,
  );

/** A second opinion that is no reader: what a regular expression takes for the merge fields of a text. */
const scanned = (text: string): string[] =>
  [...text.matchAll(/\{!([^{}]*)\}/g)].map((found) => (found[1] ?? '').trim());

/** What the first name of a merge field is, from a table of a test. */
const startsOf =
  (table: Readonly<Record<string, string | null>>): StartOf =>
  (first) =>
    Object.hasOwn(table, first) ? { object: table[first] ?? null } : undefined;

const tokenOf = (token: FormulaToken): string => {
  const what = token.kind === 'number' ? '' : token.kind === 'text' ? JSON.stringify(token.value) : token.text;
  const merge = token.kind === 'name' && token.mergeField === true ? ' merge' : '';
  return `${token.kind} ${what} ${String(token.start)}-${String(token.end)}${merge}`.replace('  ', ' ');
};

/** A use as one line: `Invoice__c: Account__r@11 > Name@22`, `CustomLabel X@7`, `object X@12`. */
const useOf = (use: NameUse): string => {
  if (use.form === 'object') return `object ${use.part.name}@${String(use.part.from)}`;
  if (use.form === 'component') return `${use.type} ${use.fullName}@${String(use.part.from)}`;
  const parts = use.parts.map(
    (part) =>
      `${part.name}@${String(part.from)}${part.leadsTo === undefined ? '' : `:${part.leadsTo}`}${part.resolveAs === undefined ? '' : `=${part.resolveAs}`}`,
  );
  return `${use.start}: ${parts.join(' > ')}`;
};

describe('the merge fields of a text', () => {
  it('are found with the place of what they hold, of their first brace and after their last', () => {
    //                0         1         2         3
    //                0123456789012345678901234567890123456
    expect(fieldsOf('Dear {!Contact.Name}, pay {!Total__c}.')).toEqual(['Contact.Name@7 5-20', 'Total__c@28 26-37']);
    expect(fieldsOf('{!a}')).toEqual(['a@2 0-4']);
    expect(fieldsOf('{!a}{!b}')).toEqual(['a@2 0-4', 'b@6 4-8']);
    expect(fieldsOf('no merge field')).toEqual([]);
    expect(fieldsOf('')).toEqual([]);
  });

  it('are given without the white space around what they hold', () => {
    expect(fieldsOf('{!  a.b \n}')).toEqual(['a.b@4 0-10']);
    // What stands between two names is kept: it is the caller that says the whole is no name.
    expect(fieldsOf('{!a b}')).toEqual(['a b@2 0-6']);
    // A merge field that holds nothing has its place at the closing brace.
    expect(fieldsOf('{!}')).toEqual(['@2 0-3']);
    expect(fieldsOf('{!  }')).toEqual(['@4 0-5']);
  });

  it('are opened by a brace and a mark only, and closed by the next brace', () => {
    expect(fieldsOf('{0} { !a} {a} !a} } {')).toEqual([]);
    expect(mergeFieldsOf('{0} { !a} {a} !a} } {').notClosed).toEqual([]);
    expect(fieldsOf('{{!a}}')).toEqual(['a@3 1-5']);
    expect(fieldsOf('{!a}}')).toEqual(['a@2 0-4']);
    expect(fieldsOf('{!a!}')).toEqual(['a!@2 0-5']);
  });

  it('are not read where they are not closed, and the place of each such start is given', () => {
    expect(mergeFieldsOf('x {!a')).toEqual({ fields: [], notClosed: [2] });
    expect(mergeFieldsOf('{!')).toEqual({ fields: [], notClosed: [0] });
    // A brace before the closing one says that the first was not closed.
    expect(mergeFieldsOf('{!a {0}')).toEqual({ fields: [], notClosed: [0] });
    expect(mergeFieldsOf('{!a {!b')).toEqual({ fields: [], notClosed: [0, 4] });
    const mixed = mergeFieldsOf('{!a {!b} {!c');
    expect(mixed.fields.map((field) => field.text)).toEqual(['b']);
    expect(mixed.notClosed).toEqual([0, 9]);
  });

  it('never throws, loses no closed merge field and agrees with a regular expression on any text', () => {
    const piece = fc.constantFrom('{!', '{', '}', '!', 'a', 'b.c', ' ', '\n', '$Record', '😀', '"');
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 24 }), (pieces) => {
        const text = pieces.join('');
        const { fields, notClosed } = mergeFieldsOf(text);
        expect(fields.map((field) => field.text)).toEqual(scanned(text));
        for (const field of fields) {
          expect(text.slice(field.open, field.open + 2)).toBe('{!');
          expect(text.charAt(field.close - 1)).toBe('}');
          expect(text.slice(field.start, field.start + field.text.length)).toBe(field.text);
        }
        // Every `{!` of the text opens a merge field or is told as not closed.
        expect(fields.length + notClosed.length).toBe(text.split('{!').length - 1);
        for (const open of notClosed) expect(text.slice(open, open + 2)).toBe('{!');
      }),
      { numRuns: 500 },
    );
  });
});

describe('a formula as a flow writes it', () => {
  it('has the name of a merge field as a token, at the place of the name', () => {
    //                          0         1         2         3
    //                          0123456789012345678901234567890123456789
    const parsed = parseFormula('IF({!$Record.Amount__c} >= 1, {!var}, 0)', { mergeFields: true });
    expect(parsed.problem).toBeNull();
    expect(parsed.tokens.map(tokenOf)).toEqual([
      'name IF 0-2',
      'mark ( 2-3',
      'name $Record.Amount__c 5-22 merge',
      'mark >= 24-26',
      'number 27-28',
      'mark , 28-29',
      'name var 32-35 merge',
      'mark , 36-37',
      'number 38-39',
      'mark ) 39-40',
    ]);
    expect(parsed.tree === null ? [] : namesOfTree(parsed.tree)).toEqual([
      { text: '$Record.Amount__c', start: 5, mergeField: true },
      { text: 'var', start: 32, mergeField: true },
    ]);
    // The token ends with the name, not with the white space or the brace after it.
    expect(parseFormula('{!  a.b  } + 1', { mergeFields: true }).tokens.map(tokenOf)).toEqual([
      'name a.b 4-7 merge',
      'mark + 11-12',
      'number 13-14',
    ]);
    // So a problem shows the name, and nothing of the braces.
    expect(parseFormula('1 {! a }', { mergeFields: true }).problem).toEqual({
      message: '"a" stands where an operator or the end of the formula is expected.',
      at: 5,
    });
  });

  it('keeps the value a picklist is compared with', () => {
    const { tree } = parseFormula('ISPICKVAL({!$Record.Status__c}, "Draft")', { mergeFields: true });
    expect(tree === null ? [] : namesOfTree(tree)).toEqual([
      { text: '$Record.Status__c', start: 12, value: 'Draft', mergeField: true },
    ]);
  });

  it('takes a merge field for a name whatever it holds: no word, no sign and no call', () => {
    const names = (formula: string): string[] => {
      const { tree, problem } = parseFormula(formula, { mergeFields: true });
      if (tree === null) return [`not read: ${String(problem?.message)}`];
      return namesOfTree(tree).map((name) => `${name.text}${name.mergeField === true ? '' : ' (bare)'}`);
    };
    expect(names('IF({!TRUE}, {!null}, FALSE)')).toEqual(['TRUE', 'null']);
    expect(names('{!NOT} + 1')).toEqual(['NOT']);
    expect(names('NOT {!NOT}')).toEqual(['NOT']);
    expect(names('{!a.b + 1} * 2')).toEqual(['a.b + 1']);
    expect(names('{!} + 1')).toEqual(['']);
    expect(names('{!f}(1)')).toEqual(['not read: "(" stands where an operator or the end of the formula is expected.']);
    // A name outside braces is read as a name, and is not marked.
    expect(names('{!a} + Amount__c')).toEqual(['a', 'Amount__c (bare)']);
  });

  it('leaves a merge field in a text and in a comment alone', () => {
    const { tree } = parseFormula('"{!a}" & /* {!b} */ {!c}', { mergeFields: true });
    expect(tree === null ? [] : namesOfTree(tree).map((name) => name.text)).toEqual(['c']);
  });

  it('says where a merge field is not closed, and still gives the name after it', () => {
    //                          0123456789012345678901
    const parsed = parseFormula('{!a.b * 2 + {! c} + {!', { mergeFields: true });
    expect(parsed.tree).toBeNull();
    expect(parsed.problem).toEqual({ message: 'A merge field is not closed.', at: 0 });
    expect(parsed.tokens.map(tokenOf)).toEqual([
      'name a.b 2-5 merge',
      'mark * 6-7',
      'number 8-9',
      'mark + 10-11',
      'name c 15-16 merge',
      'mark + 18-19',
    ]);
    expect(namesOfTokens(parsed.tokens)).toEqual([
      { text: 'a.b', start: 2, mergeField: true },
      { text: 'c', start: 15, mergeField: true },
    ]);
    // White space may stand between the mark and the name that is taken.
    expect(parseFormula('{!  a + 1', { mergeFields: true }).tokens.map(tokenOf)).toEqual([
      'name a 4-5 merge',
      'mark + 6-7',
      'number 8-9',
    ]);
    // Among the tokens of a formula that was not read, a merge field is a name whatever it holds or precedes.
    const words = parseFormula('{!TRUE} {!f} ( {!not}', { mergeFields: true });
    expect(namesOfTokens(words.tokens).map((name) => name.text)).toEqual(['TRUE', 'f', 'not']);
  });

  it('tells a brace that opens no merge field as a character that is no part of a formula', () => {
    expect(parseFormula('{a} + 1', { mergeFields: true }).problem).toEqual({
      message: 'The character "{" is not part of a formula.',
      at: 0,
    });
    expect(parseFormula('{!a}} + 1', { mergeFields: true }).problem).toEqual({
      message: 'The character "}" is not part of a formula.',
      at: 4,
    });
  });

  it('is not read that way unless it is asked for', () => {
    for (const writing of [undefined, {}, { mergeFields: false }]) {
      const parsed = parseFormula('{!a} + 1', writing);
      expect(parsed.tree).toBeNull();
      expect(parsed.problem).toEqual({ message: 'The character "{" is not part of a formula.', at: 0 });
      // The mark is the operator it always was, and the name is a name that no merge field marks.
      expect(parsed.tokens.map(tokenOf)).toEqual(['mark ! 1-2', 'name a 2-3', 'mark + 5-6', 'number 7-8']);
    }
  });

  it('never throws, and gives every name at the place it says, for any text', () => {
    const piece = fc.constantFrom(
      '{!',
      '{',
      '}',
      '!',
      'a',
      'b.c',
      ' ',
      '(',
      ')',
      ',',
      '+',
      '"',
      '/*',
      '*/',
      '1',
      'NOT',
    );
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 24 }), (pieces) => {
        const text = pieces.join('');
        const parsed = parseFormula(text, { mergeFields: true });
        expect(parsed.tree === null).toBe(parsed.problem !== null);
        const names = parsed.tree === null ? namesOfTokens(parsed.tokens) : namesOfTree(parsed.tree);
        for (const name of names) expect(text.slice(name.start, name.start + name.text.length)).toBe(name.text);
      }),
      { numRuns: 500 },
    );
  });
});

describe('what the name of a merge field stands for', () => {
  const startOf = startsOf({ $Record: 'Invoice__c', varInvoice: 'Invoice__c', varCount: null, $Flow: null });
  const uses = (name: string): string[] | null => usesOfMergeField(name, startOf)?.map(useOf) ?? null;

  it('is a path from the object of the record its first name is', () => {
    expect(uses('$Record.Amount__c')).toEqual(['Invoice__c: Amount__c@8']);
    expect(uses('varInvoice.Account__r.Name')).toEqual(['Invoice__c: Account__r@11 > Name@22']);
    expect(uses('varInvoice.Owner:User.Email')).toEqual(['Invoice__c: Owner@11:User > Email@22']);
    expect(uses('varInvoice.Owner:Queue.QueueName')).toEqual(['Invoice__c: Owner@11:Group > QueueName@23=Name']);
  });

  it('is nothing for a record that is named as a whole, and for a first name that holds no record', () => {
    expect(uses('varInvoice')).toEqual([]);
    expect(uses('$Record')).toEqual([]);
    expect(uses('varCount')).toEqual([]);
    expect(uses('$Flow.CurrentDate')).toEqual([]);
    // Whatever stands after such a name gives nothing, also what is no name.
    expect(uses('$Flow.Current Date')).toEqual([]);
  });

  it('is what the global variable of a formula stands for, where the caller does not know the first name', () => {
    expect(uses('$User.Email')).toEqual(['User: Email@6']);
    expect(uses('$Profile.Name')).toEqual(['Profile: Name@9']);
    expect(uses('$Organization.Country')).toEqual(['Organization: Country@14']);
    expect(uses('$Setup.Billing_Settings__c.Grace_Days__c')).toEqual(['Billing_Settings__c: Grace_Days__c@27']);
    expect(uses('$Label.Overdue_Notice')).toEqual(['CustomLabel Overdue_Notice@7']);
    expect(uses('$Permission.Approve_Large_Invoices')).toEqual(['CustomPermission Approve_Large_Invoices@12']);
    expect(uses('$CustomMetadata.Billing_Rule__mdt.Default.Limit__c')).toEqual([
      'CustomMetadata Billing_Rule.Default@34',
      'Billing_Rule__mdt: Limit__c@42',
    ]);
    expect(uses('$ObjectType.Invoice__c')).toEqual(['object Invoice__c@12']);
    expect(uses('$Api.Session_ID')).toEqual([]);
    expect(uses('$User.UITheme')).toEqual([]);
  });

  it('asks the caller first, so that a flow says what a variable of its own is', () => {
    const asked: string[] = [];
    const own = (first: string): MergeStart | undefined => {
      asked.push(first);
      return first === '$User' ? { object: 'Contact' } : undefined;
    };
    expect(usesOfMergeField('$User.Email', own)?.map(useOf)).toEqual(['Contact: Email@6']);
    expect(usesOfMergeField('$Profile.Name', own)?.map(useOf)).toEqual(['Profile: Name@9']);
    // The first name is handed over as it is written.
    expect(asked).toEqual(['$User', '$Profile']);
  });

  it('is not read for a first name nobody knows, and for a name that is not built like one', () => {
    for (const name of [
      'varOther.Name',
      'varOther',
      '$Orchestration.Instance',
      '$Action.Account.View',
      // The record that holds a lookup: a merge field has no such record.
      '$Source.Amount__c',
      '',
      '.Name',
      'varInvoice.',
      'varInvoice..Name',
      'varInvoice.Amount__c + 1',
      'IF(varCount > 0, 1, 2)',
      'varInvoice.Name:User',
      '1varInvoice.Name',
      '$.Name',
    ]) {
      expect(uses(name), name).toBeNull();
    }
  });

  it('never asks about a first name that is not built like a name', () => {
    const asked: string[] = [];
    const all = (first: string): MergeStart => {
      asked.push(first);
      return { object: 'Invoice__c' };
    };
    expect(usesOfMergeField('a b.Name', all)).toBeNull();
    expect(usesOfMergeField('constructor.Name', all)?.map(useOf)).toEqual(['Invoice__c: Name@12']);
    expect(asked).toEqual(['constructor']);
  });

  it('leaves the name of a formula as it was', () => {
    expect(usesOfName('$Source.Amount__c', 'Invoice__c')?.map(useOf)).toEqual(['Invoice__c: Amount__c@8']);
    expect(usesOfName('Account__r.Name', 'Invoice__c')?.map(useOf)).toEqual(['Invoice__c: Account__r@0 > Name@11']);
  });
});

describe('the merge-field probes', () => {
  const root = parse(readFileSync(join(FIXTURES_DIR, 'merge-field-probes.yaml'), 'utf8')) as {
    starts: Record<string, string | null>;
    texts: { covers: string; text: string; fields: string[]; notClosed?: number; unread?: string[] }[];
    formulas: {
      covers: string;
      formula: string;
      names: string[];
      bare?: string[];
      unread?: string[];
      problem?: boolean;
    }[];
  };
  const startOf = startsOf(root.starts);
  const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify(a) === JSON.stringify(b);

  it('cover each thing once, and what the plan of the phase asks for', () => {
    const covers = [...root.texts, ...root.formulas].map((probe) => probe.covers);
    expect(new Set(covers).size).toBe(covers.length);
    expect(root.texts).toHaveLength(41);
    expect(root.formulas).toHaveLength(33);
    for (const asked of [
      'at the start',
      'at the end',
      'two in a row',
      'not closed',
      'a brace that is no merge field',
    ]) {
      expect(covers, asked).toContain(asked);
    }
  });

  it('are texts whose merge fields are found as each of them lists', () => {
    const wrong: string[] = [];
    for (const probe of root.texts) {
      const { fields, notClosed } = mergeFieldsOf(probe.text);
      const found = fields.map((field) => field.text);
      if (!same(found, probe.fields)) wrong.push(`${probe.covers}: found ${JSON.stringify(found)}`);
      if (notClosed.length !== (probe.notClosed ?? 0)) {
        wrong.push(`${probe.covers}: ${String(notClosed.length)} not closed`);
      }
      // A second opinion on the list that was written by hand.
      if (!same(scanned(probe.text), probe.fields)) wrong.push(`${probe.covers}: the scan differs`);
      const unread = found.filter((name) => usesOfMergeField(name, startOf) === null);
      if (!same(unread, probe.unread ?? [])) wrong.push(`${probe.covers}: not read ${JSON.stringify(unread)}`);
      // The reading says the same, with a place for everything it does not read.
      const reading = readMergeFields(probe.text, startOf, 'text', (from, to) => ({
        name: probe.text.slice(from, to),
        line: 1,
        column: from + 1,
      }));
      if (
        !same(
          reading.unread.map((one) => one.text),
          probe.unread ?? [],
        )
      ) {
        wrong.push(`${probe.covers}: the reading does not read ${JSON.stringify(reading.unread)}`);
      }
      if (reading.notClosed.length !== (probe.notClosed ?? 0)) wrong.push(`${probe.covers}: the reading differs`);
    }
    expect(wrong).toEqual([]);
  });

  it('are formulas that are read as each of them says, with the names it lists', () => {
    const wrong: string[] = [];
    for (const probe of root.formulas) {
      const parsed = parseFormula(probe.formula, { mergeFields: true });
      if ((parsed.tree === null) !== (probe.problem ?? false)) {
        wrong.push(`${probe.covers}: ${parsed.problem?.message ?? 'read as a whole'}`);
        continue;
      }
      const names = parsed.tree === null ? namesOfTokens(parsed.tokens) : namesOfTree(parsed.tree);
      const found = names.map((name) => name.text);
      if (!same(found, probe.names)) wrong.push(`${probe.covers}: read ${JSON.stringify(found)}`);
      const bare = names.filter((name) => name.mergeField !== true).map((name) => name.text);
      if (!same(bare, probe.bare ?? [])) wrong.push(`${probe.covers}: outside braces ${JSON.stringify(bare)}`);
      // Each name stands where the reader says.
      for (const name of names) {
        if (probe.formula.slice(name.start, name.start + name.text.length) !== name.text) {
          wrong.push(`${probe.covers}: ${name.text} is not at ${String(name.start)}`);
        }
      }
      const unread = names
        .filter((name) => name.mergeField === true && usesOfMergeField(name.text, startOf) === null)
        .map((name) => name.text);
      if (!same(unread, probe.unread ?? [])) wrong.push(`${probe.covers}: not read ${JSON.stringify(unread)}`);
      // The reading does not read a name outside braces, and says so with the others it does not read.
      const reading = readFormulaOfMergeFields(probe.formula, startOf, 'expression', (from, to) => ({
        name: probe.formula.slice(from, to),
        line: 1,
        column: from + 1,
      }));
      const expected = names
        .filter((name) => name.mergeField !== true || usesOfMergeField(name.text, startOf) === null)
        .map((name) => name.text);
      if (
        !same(
          reading.unread.map((one) => one.text),
          expected,
        )
      ) {
        wrong.push(`${probe.covers}: the reading does not read ${JSON.stringify(reading.unread)}`);
      }
      if ((reading.problem !== null) !== (probe.problem ?? false)) wrong.push(`${probe.covers}: the reading differs`);
    }
    expect(wrong).toEqual([]);
  });

  it('name only fields and components the fixture project has, where they are read', () => {
    const answerKey = loadAnswerKey();
    const known = new Set<string>([...answerKey.components.map((one) => one.key), ...answerKey.standard]);
    const model = buildModel({
      defined: new Set(answerKey.components.map((one) => one.key)),
      objects: answerKey.components.filter((one) => one.type === 'CustomObject').map((one) => one.fullName),
      namedObjects: ['User', 'Account', 'Profile', 'Organization'],
      fields: new Map<ComponentKey, FieldFacts>([
        [key('CustomField', 'Invoice__c.Account__c'), { type: 'Lookup', referenceTo: ['Account'] }],
      ]),
    });
    const at =
      (text: string): PlaceOf =>
      (from, to) => ({ name: text.slice(from, to), line: 1, column: from + 1 });
    const raw: RawReference[] = [];
    for (const { text } of root.texts) raw.push(...readMergeFields(text, startOf, 'text', at(text)).references);
    for (const { formula } of root.formulas) {
      raw.push(...readFormulaOfMergeFields(formula, startOf, 'expression', at(formula)).references);
    }
    const owner = { key: key('Flow', 'Probe'), file: 'probe', object: 'Invoice__c' };
    const { references, issues } = resolveReferences(model, owner, raw, 'parser:xml');
    expect(issues).toEqual([]);
    expect(references.length).toBeGreaterThan(60);
    // Every one is a component of the project, or a standard field or object the answer key lists.
    const unknown = references.filter((one) => one.to === null || !known.has(one.to)).map((one) => one.toNameRaw);
    expect(unknown).toEqual([]);
  });
});

/** A file with one element `local` that holds `content` as it is written, entities and all. */
function documentWith(local: string, content: string): { document: XmlDocument; element: XmlElement; text: string } {
  const text = [HEAD, `<Flow xmlns="${XMLNS}">`, `    <${local}>${content}</${local}>`, '</Flow>', ''].join('\n');
  const { document } = readXml(Buffer.from(text, 'utf8'));
  const element = document?.root.children[0];
  if (document === null || element === undefined) throw new Error('The file of the test is not read.');
  return { document, element, text };
}

/** A small model: an invoice with a lookup to an account, and a line with a lookup to the invoice. */
function billingModel(): ObjectModel {
  const fields = new Map<ComponentKey, FieldFacts>([
    [key('CustomField', 'Invoice__c.Account__c'), { type: 'Lookup', referenceTo: ['Account'] }],
    [key('CustomField', 'Invoice__c.Amount__c'), { type: 'Currency', referenceTo: [] }],
    [key('CustomField', 'Invoice__c.Status__c'), { type: 'Picklist', referenceTo: [] }],
    [key('CustomField', 'Invoice_Line__c.Invoice__c'), { type: 'MasterDetail', referenceTo: ['Invoice__c'] }],
  ]);
  return buildModel({
    defined: new Set<ComponentKey>([
      ...fields.keys(),
      key('CustomObject', 'Invoice__c'),
      key('CustomObject', 'Invoice_Line__c'),
      key('CustomLabel', 'Overdue_Notice'),
    ]),
    objects: ['Invoice__c', 'Invoice_Line__c', 'Account'],
    namedObjects: ['Account', 'Invoice__c'],
    fields,
  });
}

/** A reference as `line:column kind target [name] resolution tier via`. */
const told = (one: Reference): string =>
  `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} [${one.toNameRaw}] ${one.resolution} ${one.confidence} ${viaOf(one)}`;

/** `line:column` of the nth time `word` stands in a text. */
function placeOf(text: string, word: string, nth = 1): string {
  let at = -1;
  for (let seen = 0; seen < nth; seen += 1) {
    at = text.indexOf(word, at + 1);
    if (at === -1) throw new Error(`The text does not hold "${word}" ${String(nth)} times.`);
  }
  const before = text.slice(0, at).split('\n');
  return `${String(before.length)}:${String((before.at(-1) ?? '').length + 1)}`;
}

describe('the names of a text in a file', () => {
  const owner = { key: key('Flow', 'Probe'), file: 'flows/Probe.flow-meta.xml', object: 'Invoice__c' };
  const startOf = startsOf({ $Record: 'Invoice__c', Each_Line: 'Invoice_Line__c', varCount: null });

  it('are the merge fields of a text, each part at its place in the file, entities and all', () => {
    const { document, element, text } = documentWith(
      'fieldText',
      '&lt;p&gt;Pay {!$Record.Amount__c} to {!$Record.Account__r.Name} &amp; {!$Label.Overdue_Notice}.&lt;/p&gt;\n      Line of {!Each_Line.Invoice__r.Status__c}, count {!varCount}, Amount__c',
    );
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const reading = readMergeFields(value.value, startOf, element.local, placesIn(document, value));
    expect(reading.unread).toEqual([]);
    expect(reading.notClosed).toEqual([]);
    expect(reading.element).toBe('fieldText');
    const { references, issues } = resolveReferences(billingModel(), owner, reading.references, 'parser:xml');
    expect(issues).toEqual([]);
    expect(references.map(told)).toEqual([
      `${placeOf(text, 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed merge-field`,
      `${placeOf(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed merge-field`,
      `${placeOf(text, 'Name')} reads CustomField:account.name [Name] external confirmed merge-field`,
      `${placeOf(text, 'Overdue_Notice')} references CustomLabel:overdue_notice [Overdue_Notice] resolved confirmed merge-field`,
      `${placeOf(text, 'Invoice__r')} reads CustomField:invoice_line__c.invoice__c [Invoice__r] resolved confirmed merge-field`,
      `${placeOf(text, 'Status__c')} reads CustomField:invoice__c.status__c [Status__c] resolved confirmed merge-field`,
    ]);
    // The second line of the element: the place counts in the file, not in the text of the element.
    expect(placeOf(text, 'Invoice__r').startsWith('4:')).toBe(true);
  });

  it('say what is not read and what is not closed, each with its place', () => {
    const { document, element, text } = documentWith(
      'text',
      'A {!varOther.Name}, {!$Record.Amount__c + 1}, {!} and {!$Record.Amount__c',
    );
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const reading = readMergeFields(value.value, startOf, element.local, placesIn(document, value));
    expect(reading.references).toEqual([]);
    const at = (place: string): { line: number; column: number } => {
      const [line, column] = place.split(':').map(Number);
      return { line: line ?? 0, column: column ?? 0 };
    };
    expect(reading.unread).toEqual([
      { element: 'text', text: 'varOther.Name', ...at(placeOf(text, 'varOther')) },
      { element: 'text', text: '$Record.Amount__c + 1', ...at(placeOf(text, '$Record')) },
      { element: 'text', text: '', ...at(placeOf(text, '} and')) },
    ]);
    expect(reading.notClosed).toEqual([at(placeOf(text, '{!$Record', 2))]);
  });

  it('shows at most 60 characters of a merge field that is not read', () => {
    const { document, element } = documentWith('text', `{!${'a'.repeat(59)}😀 b}`);
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const [unread] = readMergeFields(value.value, startOf, 'text', placesIn(document, value)).unread;
    // Never half of a character outside the basic plane.
    expect(unread?.text).toBe('a'.repeat(59));
  });

  it('are the merge fields of a formula of a flow, with the value a picklist is compared with', () => {
    const { document, element, text } = documentWith(
      'expression',
      'IF(ISPICKVAL({!$Record.Status__c}, &quot;Paid&quot;) &amp;&amp; {!varCount} &gt; 0,\n      {!$Record.Account__r.Owner:User.Email}, {!$Setup.Billing_Settings__c.Grace_Days__c})',
    );
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const reading = readFormulaOfMergeFields(value.value, startOf, element.local, placesIn(document, value));
    expect(reading.problem).toBeNull();
    expect(reading.unread).toEqual([]);
    const { references } = resolveReferences(billingModel(), owner, reading.references, 'parser:formula');
    expect(references.map(told)).toEqual([
      `${placeOf(text, 'Status__c')} reads CustomField:invoice__c.status__c [Status__c] resolved confirmed formula`,
      `${placeOf(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed formula`,
      `${placeOf(text, 'Owner')} reads CustomField:account.ownerid [Owner] external confirmed formula`,
      `${placeOf(text, 'Email')} reads CustomField:user.email [Email] external confirmed formula`,
      `${placeOf(text, 'Grace_Days__c')} reads null [Grace_Days__c] unresolved confirmed formula`,
    ]);
    expect(references[0]?.attrs).toEqual({ via: 'formula', value: 'Paid' });
    expect(references.at(-1)?.attrs).toEqual({ via: 'formula', object: 'Billing_Settings__c' });
  });

  it('does not read a name outside braces in a formula of a flow, and says where it stands', () => {
    const { document, element, text } = documentWith('expression', '{!$Record.Amount__c} * Tax_Rate__c + $User.Id');
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const reading = readFormulaOfMergeFields(value.value, startOf, element.local, placesIn(document, value));
    expect(reading.problem).toBeNull();
    expect(reading.references).toHaveLength(1);
    expect(reading.unread.map((one) => `${String(one.line)}:${String(one.column)} ${one.text}`)).toEqual([
      `${placeOf(text, 'Tax_Rate__c')} Tax_Rate__c`,
      `${placeOf(text, '$User')} $User.Id`,
    ]);
  });

  it('keeps a formula of a flow that is not read as a whole, with its names as probable', () => {
    const { document, element, text } = documentWith('expression', '{!$Record.Amount__c} * ({!$Record.Status__c');
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const reading = readFormulaOfMergeFields(value.value, startOf, element.local, placesIn(document, value));
    const [line, column] = placeOf(text, '{!$Record', 2).split(':').map(Number);
    expect(reading.problem).toEqual({ message: 'A merge field is not closed.', line, column });
    const { references } = resolveReferences(billingModel(), owner, reading.references, 'parser:formula');
    expect(references.map(told)).toEqual([
      `${placeOf(text, 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved probable formula`,
      `${placeOf(text, 'Status__c')} reads CustomField:invoice__c.status__c [Status__c] resolved probable formula`,
    ]);
  });

  it('reads the formula of a field as before: plain names from the object it belongs to', () => {
    const { document, element, text } = documentWith('formula', 'Account__r.Name &amp; TEXT(Status__c) &amp; {!x}');
    const value = valueOf(element);
    if (value === null) throw new Error('The element holds nothing.');
    const reading = readFormula(value.value, 'Invoice__c', element.local, placesIn(document, value));
    const [line, column] = placeOf(text, '{!x}').split(':').map(Number);
    expect(reading.problem).toEqual({ message: 'The character "{" is not part of a formula.', line, column });
    const { references } = resolveReferences(billingModel(), owner, reading.references, 'parser:formula');
    expect(references.map(told)).toEqual([
      `${placeOf(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved probable formula`,
      `${placeOf(text, 'Name')} reads CustomField:account.name [Name] external probable formula`,
      `${placeOf(text, 'Status__c')} reads CustomField:invoice__c.status__c [Status__c] resolved probable formula`,
      // Without braces to read, the name in them is a field of the invoice like any other.
      `${placeOf(text, 'x}')} reads CustomField:invoice__c.x [x] external probable formula`,
    ]);
  });
});

/** The elements of a flow that hold a formula. Every other element that holds a text is read for merge fields. */
const FLOW_FORMULAS: ReadonlySet<string> = new Set(['expression', 'formulaExpression', 'filterFormula']);

/**
 * What each first name of a merge field is in the flows of the fixture project, written by hand from the files:
 * the object of a record variable, of the record that starts the flow and of the records a loop goes over, and
 * nothing for a resource that holds no record. The analyser of flows will read this from the flow.
 */
const FLOW_STARTS: Readonly<Record<string, Readonly<Record<string, string | null>>>> = {
  Invoice_After_Save: { $Record: 'Invoice__c', $Flow: null },
  Invoice_Before_Save: { $Record: 'Invoice__c', $Flow: null },
  Invoice_Purge_Void: { $Flow: null },
  Invoice_Recalculate: { invoice: 'Invoice__c', Each_Line: 'Invoice_Line__c', $Flow: null },
  Invoice_Review_Screen: {
    varInvoice: 'Invoice__c',
    Confirmation: null,
    New_Due_Date: null,
    $Flow: null,
  },
  Invoice_Sent_Process: { myVariable_current: 'Invoice__c', myVariable_old: 'Invoice__c' },
};

/** Every element of a tree that holds a text, in the order of the file. */
function* withText(element: XmlElement): Generator<XmlElement> {
  if (element.text !== null) yield element;
  for (const child of element.children) yield* withText(child);
}

describe('the texts of the fixture project', () => {
  const project = join(FIXTURES_DIR, 'billing-sfdx');
  const folder = 'force-app/main/default';
  const answerKey = loadAnswerKey();
  let model: ObjectModel;
  /** What was found, per file, as `line:column kind target [name] tier via`. */
  const found = new Map<string, string[]>();
  const notRead: string[] = [];

  const entry = (line: number, column: number, kind: string, to: string, name: string, tier: string, via: string) =>
    `${String(line)}:${String(column)} ${kind} ${to} [${name}] ${tier} ${via}`;

  /** Resolves what one text gave and keeps it for its file. */
  const keep = (
    file: string,
    object: string,
    raw: readonly RawReference[],
    origin: 'parser:xml' | 'parser:formula',
  ) => {
    const owner = { key: key('Flow', 'Any'), file, object };
    const { references, issues } = resolveReferences(model, owner, raw, origin);
    for (const issue of issues) notRead.push(`${file}: ${issue.code}`);
    const lines = found.get(file) ?? [];
    for (const one of references) {
      const { line = 0, column = 0 } = one.location ?? {};
      lines.push(entry(line, column, one.kind, String(one.to), one.toNameRaw, one.confidence, viaOf(one)));
    }
    found.set(file, lines);
  };

  const documentOf = (file: string): XmlDocument => {
    const { document } = readXml(readFileSync(join(project, file)));
    if (document === null) throw new Error(`${file} is not read.`);
    return document;
  };

  beforeAll(async () => {
    // The model of objects, as the analysis builds it from the objects and fields of the project.
    const tree = readFolders(project, ['force-app']).tree;
    const listed = (await resolveComponents(tree, ['force-app'])).components;
    const { components } = analyseSource(tree, listed);
    const fields = new Map<ComponentKey, FieldFacts>();
    for (const one of components) {
      if (parseKey(one.key).type !== 'CustomField' || one.attrs === null) continue;
      const { type, referenceTo } = one.attrs;
      fields.set(one.key, {
        type: typeof type === 'string' ? type : null,
        referenceTo: Array.isArray(referenceTo) ? referenceTo.map(String) : [],
      });
    }
    model = buildModel({
      // The files of Phase 2 are no component of the analysis yet: the key says what the project defines.
      defined: new Set(answerKey.components.map((one) => one.key)),
      objects: components.filter((one) => parseKey(one.key).type === 'CustomObject').map((one) => one.name),
      namedObjects: [...fields.values()].flatMap((facts) => facts.referenceTo),
      fields,
    });

    for (const [name, starts] of Object.entries(FLOW_STARTS)) {
      const file = `${folder}/flows/${name}.flow-meta.xml`;
      const document = documentOf(file);
      for (const element of withText(document.root)) {
        const value = valueOf(element);
        if (value === null) continue;
        const at = placesIn(document, value);
        if (FLOW_FORMULAS.has(element.local)) {
          const reading = readFormulaOfMergeFields(value.value, startsOf(starts), element.local, at);
          if (reading.problem !== null) notRead.push(`${file}: ${reading.problem.message}`);
          for (const unread of reading.unread) notRead.push(`${file}:${String(unread.line)}: ${unread.text}`);
          keep(file, '', reading.references, 'parser:formula');
        } else {
          const reading = readMergeFields(value.value, startsOf(starts), element.local, at);
          for (const unread of reading.unread) notRead.push(`${file}:${String(unread.line)}: ${unread.text}`);
          for (const open of reading.notClosed) notRead.push(`${file}:${String(open.line)}: not closed`);
          keep(file, '', reading.references, 'parser:xml');
        }
      }
    }

    // The formula of a workflow rule and of a field update has plain names, from the object of the file.
    for (const object of ['Invoice__c', 'Invoice_Line__c']) {
      const file = `${folder}/workflows/${object}.workflow-meta.xml`;
      const document = documentOf(file);
      for (const element of withText(document.root)) {
        const value = valueOf(element);
        if (value === null || element.local !== 'formula') continue;
        const reading = readFormula(value.value, object, element.local, placesIn(document, value));
        if (reading.problem !== null) notRead.push(`${file}: ${reading.problem.message}`);
        for (const unread of reading.unread) notRead.push(`${file}:${String(unread.line)}: ${unread.text}`);
        keep(file, object, reading.references, 'parser:formula');
      }
    }

    // An email template names the object of a record where a flow names a resource.
    const ofObject: StartOf = (first) => (first.startsWith('$') ? undefined : { object: first });
    const meta = `${folder}/email/Billing/Invoice_Overdue.email-meta.xml`;
    const subject = documentOf(meta).root.children.find((child) => child.local === 'subject') ?? null;
    const value = valueOf(subject);
    if (value === null) throw new Error('The email template has no subject.');
    keep(
      meta,
      '',
      readMergeFields(value.value, ofObject, 'subject', placesIn(documentOf(meta), value)).references,
      'parser:xml',
    );
    // The body is no XML: a place in it is counted in the text itself.
    const bodyFile = `${folder}/email/Billing/Invoice_Overdue.email`;
    const body = readFileSync(join(project, bodyFile), 'utf8');
    const inBody: PlaceOf = (from, to) => {
      const before = body.slice(0, from).split('\n');
      return { name: body.slice(from, to), line: before.length, column: (before.at(-1) ?? '').length + 1 };
    };
    const reading = readMergeFields(body, ofObject, '', inBody);
    for (const unread of reading.unread) notRead.push(`${bodyFile}:${String(unread.line)}: ${unread.text}`);
    keep(bodyFile, '', reading.references, 'parser:xml');
  });

  it('give every reference the answer key holds for a formula or a merge field of Phase 2, and no other', () => {
    const expected = new Map<string, string[]>();
    for (const one of answerKey.references) {
      if (one.phase !== 2 || (one.via !== 'formula' && one.via !== 'merge-field')) continue;
      const lines = expected.get(`force-app/${one.file.slice('force-app/'.length)}`) ?? [];
      lines.push(entry(one.line, one.column, one.kind, one.to, one.match, one.tier, one.via));
      expected.set(one.file, lines);
    }
    // 30 entries in the six flows, 12 in the two files of workflow rules and 8 in the email template.
    expect([...expected.values()].flat()).toHaveLength(50);
    expect([...found.keys()].filter((file) => (found.get(file) ?? []).length > 0).sort()).toEqual(
      [...expected.keys()].sort(),
    );
    for (const [file, lines] of expected) {
      expect([...(found.get(file) ?? [])].sort(), file).toEqual([...lines].sort());
    }
  });

  it('read every formula as a whole and every merge field as a name', () => {
    expect(notRead).toEqual([]);
  });

  it('hit no place where the answer key forbids a reference', () => {
    const hit: string[] = [];
    for (const negative of answerKey.negatives) {
      for (const line of found.get(negative.file) ?? []) {
        if (line.startsWith(`${String(negative.line)}:`) && line.includes(` ${negative.not} `)) {
          hit.push(`${negative.file}:${String(negative.line)} ${negative.not}`);
        }
      }
    }
    expect(hit).toEqual([]);
    // The negatives of these files that stand in a text or a formula are there to be missed.
    const inTexts = answerKey.negatives.filter((negative) => found.has(negative.file));
    expect(inTexts.length).toBeGreaterThan(5);
  });
});

describe('the flows of the public codebases', () => {
  const corpora = join(import.meta.dirname, '../../..', '.corpora');
  /** What was checked on 23 November 2026, at the commits that `fixtures/corpora.toml` pins. */
  const CHECKED: Readonly<Record<string, string>> = {
    'apex-recipes': '1 flows, 0 formulas with 0 names, 1 texts with 1 merge fields',
    'nebula-logger': '10 flows, 0 formulas with 0 names, 9 texts with 9 merge fields',
    npsp: '0 flows, 0 formulas with 0 names, 0 texts with 0 merge fields',
    pmm: '2 flows, 7 formulas with 73 names, 0 texts with 0 merge fields',
  };

  const flowsIn = (folder: string): string[] => {
    const files: string[] = [];
    for (const name of readdirSync(folder)) {
      if (name === '.git' || name === 'node_modules') continue;
      const path = join(folder, name);
      if (statSync(path).isDirectory()) files.push(...flowsIn(path));
      else if (name.endsWith('.flow-meta.xml')) files.push(path);
    }
    return files;
  };

  for (const [name, checked] of Object.entries(CHECKED)) {
    it.skipIf(!existsSync(join(corpora, name)))(
      `of ${name} hold no formula that is not read as a whole, no name outside braces and no open merge field`,
      () => {
        const count = { flows: 0, formulas: 0, names: 0, texts: 0, fields: 0 };
        const wrong: string[] = [];
        for (const file of flowsIn(join(corpora, name))) {
          const { document } = readXml(readFileSync(file));
          if (document === null) {
            wrong.push(`${file}: not read`);
            continue;
          }
          count.flows += 1;
          for (const element of withText(document.root)) {
            const text = element.text?.value ?? '';
            if (FLOW_FORMULAS.has(element.local)) {
              count.formulas += 1;
              const { tree, problem } = parseFormula(text, { mergeFields: true });
              if (tree === null) {
                wrong.push(`${file}: ${String(problem?.message)}`);
                continue;
              }
              const names = namesOfTree(tree);
              count.names += names.length;
              if (names.some((one) => one.mergeField !== true)) wrong.push(`${file}: a name outside braces`);
            } else if (text.includes('{!')) {
              const { fields, notClosed } = mergeFieldsOf(text);
              count.texts += 1;
              count.fields += fields.length;
              if (notClosed.length > 0) wrong.push(`${file}: a merge field is not closed`);
              if (JSON.stringify(fields.map((one) => one.text)) !== JSON.stringify(scanned(text))) {
                wrong.push(`${file}: the scan differs`);
              }
              // Every merge field of these flows holds a name, whatever its first name is.
              const any: StartOf = () => ({ object: 'Any' });
              if (fields.some((one) => one.text.includes('.') && usesOfMergeField(one.text, any) === null)) {
                wrong.push(`${file}: a merge field that is no name`);
              }
            }
          }
        }
        expect(wrong).toEqual([]);
        expect(
          `${String(count.flows)} flows, ${String(count.formulas)} formulas with ${String(count.names)} names, ${String(count.texts)} texts with ${String(count.fields)} merge fields`,
        ).toBe(checked);
      },
    );
  }
});
