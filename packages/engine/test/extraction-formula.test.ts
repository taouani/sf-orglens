/**
 * The reader of the formula language: its tokens, the tree it builds, the problems it reports, the names it
 * finds, and what a name stands for.
 *
 * The probes of `fixtures/formula-probes.yaml` are read here as a whole. What the analysis makes of a formula
 * in a file is tested in `extraction-analyse.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  namesOfTokens,
  namesOfTree,
  parseFormula,
  type FormulaName,
  type FormulaNode,
  type FormulaToken,
} from '../src/extraction/formula.ts';
import { usesOfName, type NamePart, type NameUse } from '../src/extraction/formula-names.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';

/** A tree as one line: `(+ a (* b 1))`, a call as `IF[a, b]`, a text in quotes as its value. */
const show = (node: FormulaNode): string => {
  if (node.kind === 'name') return node.text;
  if (node.kind === 'word') return `<${node.text}>`;
  if (node.kind === 'number') return '#';
  if (node.kind === 'text') return JSON.stringify(node.value);
  if (node.kind === 'call') return `${node.text}[${node.args.map(show).join(', ')}]`;
  return `(${node.text} ${node.operands.map(show).join(' ')})`;
};
const treeOf = (formula: string): string => {
  const { tree, problem } = parseFormula(formula);
  if (tree === null) throw new Error(`Not read: ${String(problem?.message)}`);
  return show(tree);
};
const problemOf = (formula: string): string => {
  const { tree, problem } = parseFormula(formula);
  expect(tree === null).toBe(problem !== null);
  return problem === null ? 'none' : `${String(problem.at)}: ${problem.message}`;
};
const tokenOf = (token: FormulaToken): string => {
  const what = token.kind === 'number' ? '' : token.kind === 'text' ? JSON.stringify(token.value) : token.text;
  return `${token.kind} ${what} ${String(token.start)}-${String(token.end)}`.replace('  ', ' ');
};
const namesOf = (formula: string): string[] => {
  const { tree } = parseFormula(formula);
  if (tree === null) throw new Error('Not read.');
  return namesOfTree(tree).map(
    (name: FormulaName) => `${name.text}@${String(name.start)}${name.value === undefined ? '' : `=${name.value}`}`,
  );
};

describe('the tokens of a formula', () => {
  it('are names, numbers, texts and marks, each with its place', () => {
    //                         0         1         2
    //                         0123456789012345678901234567
    const parsed = parseFormula('IF(Amount__c >= 1.5, "a", $User.Id)');
    expect(parsed.tokens.map(tokenOf)).toEqual([
      'name IF 0-2',
      'mark ( 2-3',
      'name Amount__c 3-12',
      'mark >= 13-15',
      'number 16-19',
      'mark , 19-20',
      'text "a" 21-24',
      'mark , 24-25',
      'name $User.Id 26-34',
      'mark ) 34-35',
    ]);
    expect(parsed.problem).toBeNull();
  });

  it('take the longer mark where two start alike', () => {
    const marks = (formula: string): string[] =>
      parseFormula(formula)
        .tokens.filter((token) => token.kind === 'mark')
        .map((token) => token.text);
    expect(marks('a <= b <> c == d != e >= f && g || h')).toEqual(['<=', '<>', '==', '!=', '>=', '&&', '||']);
    expect(marks('a < b = c > d & e ! f')).toEqual(['<', '=', '>', '&', '!']);
    // No space is needed between two marks.
    expect(marks('a<-b')).toEqual(['<', '-']);
  });

  it('read a number with or without digits on either side of its point', () => {
    const numbers = (formula: string): string[] =>
      parseFormula(formula)
        .tokens.filter((token) => token.kind === 'number')
        .map((token) => formula.slice(token.start, token.end));
    expect(numbers('1 + 1.5 + 2. + .25 + 007')).toEqual(['1', '1.5', '2.', '.25', '007']);
    // A digit starts no name, so a number ends where a letter starts.
    expect(parseFormula('1a').tokens.map(tokenOf)).toEqual(['number 0-1', 'name a 1-2']);
  });

  it('read a name with dots, a dollar sign, a colon and a number sign as one', () => {
    const names = (formula: string): string[] =>
      parseFormula(formula)
        .tokens.filter((token) => token.kind === 'name')
        .map((token) => token.text);
    expect(names('Account__r.Owner.Email & $Setup.Rates__c.Limit__c & Owner:User.Name & AMOUNT:SUM & a#b')).toEqual([
      'Account__r.Owner.Email',
      '$Setup.Rates__c.Limit__c',
      'Owner:User.Name',
      'AMOUNT:SUM',
      'a#b',
    ]);
  });

  it('keep in the value of a text what a backslash keeps, in either kind of quotes', () => {
    const values = (formula: string): string[] =>
      parseFormula(formula).tokens.flatMap((token) => (token.kind === 'text' ? [token.value] : []));
    expect(values(String.raw`"it's" & 'say "hi"' & 'it\'s' & "a\"b" & "a\\b" & "\n\t\r" & "\N\T\R" & "\q"`)).toEqual([
      "it's",
      'say "hi"',
      "it's",
      'a"b',
      'a\\b',
      '\n\t\r',
      '\n\t\r',
      'q',
    ]);
    expect(values('""')).toEqual(['']);
    // A text may run over lines, and holds what looks like a comment or a name.
    expect(values('"one\ntwo" & "/* no comment */" & "Amount__c"')).toEqual([
      'one\ntwo',
      '/* no comment */',
      'Amount__c',
    ]);
  });

  it('leave out comments and white space', () => {
    expect(parseFormula('/* first */ a /* "text" Amount__c */ + /**/ b').tokens.map(tokenOf)).toEqual([
      'name a 12-13',
      'mark + 37-38',
      'name b 44-45',
    ]);
    // A backslash keeps the end of a comment inside the comment.
    expect(parseFormula(String.raw`a /* one \*/ two */ + b`).tokens.map(tokenOf)).toEqual([
      'name a 0-1',
      'mark + 20-21',
      'name b 22-23',
    ]);
    // A tab, both ends of a line, a form feed and a no-break space.
    const spaced = 'a\t+\r\nb\n+\fc\u00A0+ d';
    expect(parseFormula(spaced).problem).toBeNull();
    expect(parseFormula(spaced).tokens.map(tokenOf)).toEqual([
      'name a 0-1',
      'mark + 2-3',
      'name b 5-6',
      'mark + 7-8',
      'name c 9-10',
      'mark + 11-12',
      'name d 13-14',
    ]);
  });
});

describe('the tree of a formula', () => {
  it('binds a product before a sum, a sum before a comparison, and that before AND and OR', () => {
    expect(treeOf('a + b * c')).toBe('(+ a (* b c))');
    expect(treeOf('a * b + c')).toBe('(+ (* a b) c)');
    expect(treeOf('a ^ b * c')).toBe('(* (^ a b) c)');
    expect(treeOf('a + b > c - d')).toBe('(> (+ a b) (- c d))');
    expect(treeOf('a & b = c')).toBe('(= (& a b) c)');
    expect(treeOf('a < b = c > d')).toBe('(= (< a b) (> c d))');
    expect(treeOf('a = b && c <> d || e == f')).toBe('(|| (&& (= a b) (<> c d)) (== e f))');
    expect(treeOf('a || b && c')).toBe('(|| a (&& b c))');
  });

  it('reads operators that bind alike from the left', () => {
    expect(treeOf('a - b - c')).toBe('(- (- a b) c)');
    expect(treeOf('a / b * c')).toBe('(* (/ a b) c)');
    expect(treeOf('a ^ b ^ c')).toBe('(^ (^ a b) c)');
  });

  it('gives brackets no node of their own', () => {
    expect(treeOf('(a + b) * c')).toBe('(* (+ a b) c)');
    expect(treeOf('((a))')).toBe('a');
    const { tree } = parseFormula('(a)');
    // The place of a value in brackets is that of the value.
    expect(tree).toEqual({ kind: 'name', text: 'a', start: 1, end: 2 });
  });

  it('reads the signs before a value, the innermost last', () => {
    expect(treeOf('-a')).toBe('(- a)');
    expect(treeOf('- - a')).toBe('(- (- a))');
    expect(treeOf('!a && +b')).toBe('(&& (! a) (+ b))');
    expect(treeOf('-a * b')).toBe('(* (- a) b)');
    expect(treeOf('a - -b')).toBe('(- a (- b))');
    expect(treeOf('-(a + b)')).toBe('(- (+ a b))');
    expect(parseFormula('-a').tree).toMatchObject({ kind: 'operation', text: '-', start: 0, end: 2 });
  });

  it('reads NOT before a value as a sign, and before a bracket as a call', () => {
    expect(treeOf('NOT a')).toBe('(NOT a)');
    expect(treeOf('not Not a')).toBe('(not (Not a))');
    expect(treeOf('NOT a && b')).toBe('(&& (NOT a) b)');
    expect(treeOf('NOT(a)')).toBe('NOT[a]');
    expect(treeOf('NOT (a)')).toBe('NOT[a]');
    expect(treeOf('NOT ISBLANK(a)')).toBe('(NOT ISBLANK[a])');
  });

  it('reads any name before a bracket as a call, with any number of arguments', () => {
    expect(treeOf('NOW()')).toBe('NOW[]');
    expect(treeOf('IF(a > 0, MAX(a, b, 1), "none")')).toBe('IF[(> a #), MAX[a, b, #], "none"]');
    expect(treeOf('A_Function_Of_Next_Year (a)')).toBe('A_Function_Of_Next_Year[a]');
    expect(treeOf('f(g(h(a)))')).toBe('f[g[h[a]]]');
    expect(parseFormula('f( a )').tree).toMatchObject({ kind: 'call', start: 0, end: 6 });
  });

  it('knows TRUE, FALSE and NULL in any case as words, not as names', () => {
    expect(treeOf('IF(TRUE, false, Null)')).toBe('IF[<TRUE>, <false>, <Null>]');
    expect(namesOf('IF(TRUE, false, Null)')).toEqual([]);
    // Before a bracket a word is a call like any other name.
    expect(treeOf('TRUE()')).toBe('TRUE[]');
    // A longer name is a name.
    expect(treeOf('TRUE_Value__c')).toBe('TRUE_Value__c');
  });

  it('reads a chain of many thousand operators and signs without running out of stack', () => {
    const terms = 20_000;
    const sum = parseFormula(Array.from({ length: terms }, () => 'a').join(' + '));
    expect(sum.problem).toBeNull();
    expect(sum.tree === null ? 0 : namesOfTree(sum.tree).length).toBe(terms);
    const signs = parseFormula(`${'-'.repeat(terms)}a`);
    expect(signs.problem).toBeNull();
    expect(signs.tree === null ? 0 : namesOfTree(signs.tree).length).toBe(1);
    const args = parseFormula(`CASE(${Array.from({ length: terms }, () => 'a').join(', ')})`);
    expect(args.tree === null ? 0 : namesOfTree(args.tree).length).toBe(terms);
  });
});

describe('a formula that is not read', () => {
  it('says what stands where something else is expected, and where', () => {
    expect(problemOf('a + * b')).toBe('4: "*" stands where a value is expected.');
    expect(problemOf('a b')).toBe('2: "b" stands where an operator or the end of the formula is expected.');
    expect(problemOf('f(a))')).toBe('4: ")" stands where an operator or the end of the formula is expected.');
    expect(problemOf('f(a b)')).toBe('4: "b" stands where a comma or a closing bracket is expected.');
    expect(problemOf('(a, b)')).toBe('2: "," stands where a closing bracket is expected.');
    expect(problemOf('f(, a)')).toBe('2: "," stands where a value is expected.');
    expect(problemOf('f(a,)')).toBe('4: ")" stands where a value is expected.');
    expect(problemOf(')')).toBe('0: ")" stands where a value is expected.');
    expect(problemOf('a = = b')).toBe('4: "=" stands where a value is expected.');
    expect(problemOf('NOT')).toBe('3: The formula ends where a value is expected.');
  });

  it('says where the formula ends too early', () => {
    expect(problemOf('a +')).toBe('3: The formula ends where a value is expected.');
    expect(problemOf('f(a')).toBe('3: The formula ends where a comma or a closing bracket is expected.');
    expect(problemOf('(a')).toBe('2: The formula ends where a closing bracket is expected.');
    expect(problemOf('f(')).toBe('2: The formula ends where a value is expected.');
    expect(problemOf('')).toBe('0: The formula holds no value.');
    expect(problemOf(' /* only a comment */ ')).toBe('0: The formula holds no value.');
  });

  it('says where a text or a comment starts that is not closed, and keeps the tokens before it', () => {
    const text = parseFormula('a & "no end');
    expect(text.problem).toEqual({ message: 'A text is not closed.', at: 4 });
    expect(text.tokens.map(tokenOf)).toEqual(['name a 0-1', 'mark & 2-3']);
    expect(problemOf(String.raw`'it\'`)).toBe('0: A text is not closed.');
    expect(problemOf('"a\\')).toBe('0: A text is not closed.');
    const comment = parseFormula('a /* no end');
    expect(comment.problem).toEqual({ message: 'A comment is not closed.', at: 2 });
    expect(comment.tokens.map(tokenOf)).toEqual(['name a 0-1']);
    expect(problemOf('/*/')).toBe('0: A comment is not closed.');
    expect(problemOf(String.raw`/* \*/`)).toBe('0: A comment is not closed.');
  });

  it('names the first character that is no part of a formula, and reads the tokens after it', () => {
    const parsed = parseFormula('a @ b ; c');
    expect(parsed.tree).toBeNull();
    expect(parsed.problem).toEqual({ message: 'The character "@" is not part of a formula.', at: 2 });
    expect(parsed.tokens.map(tokenOf)).toEqual(['name a 0-1', 'name b 4-5', 'name c 8-9']);
    expect(problemOf('f([a])')).toBe('2: The character "[" is not part of a formula.');
    expect(problemOf('{!a}')).toBe('0: The character "{" is not part of a formula.');
    // An unclosed text after such a character does not hide it.
    expect(problemOf('a # "b')).toBe('2: The character "#" is not part of a formula.');
    // A character outside the basic plane is one character, and one that cannot be seen is told by its number.
    expect(problemOf('a + \u{1F600}')).toBe('4: The character "\u{1F600}" is not part of a formula.');
    expect(parseFormula('\u{1F600}a').tokens.map(tokenOf)).toEqual(['name a 2-3']);
    expect(problemOf('a + \u0007')).toBe('4: The character U+0007 is not part of a formula.');
    expect(problemOf('a + \uD83D')).toBe('4: The character U+D83D is not part of a formula.');
  });

  it('shows at most 40 characters of a token, and never half a character', () => {
    const long = `"${'x'.repeat(38)}\u{1F600} and more"`;
    const { problem } = parseFormula(`a ${long}`);
    expect(problem?.message).toBe(
      `""${'x'.repeat(38)}" stands where an operator or the end of the formula is expected.`,
    );
  });

  it('reads brackets and calls that are nested 200 deep, and no deeper', () => {
    const nested = (depth: number): string => `${'('.repeat(depth)}a${')'.repeat(depth)}`;
    const calls = (depth: number): string => `${'f('.repeat(depth)}a${')'.repeat(depth)}`;
    expect(problemOf(nested(200))).toBe('none');
    expect(problemOf(calls(200))).toBe('none');
    expect(problemOf(nested(201))).toBe('200: The formula is nested more than 200 deep.');
    expect(problemOf(calls(201))).toBe('400: The formula is nested more than 200 deep.');
    // A formula that closes what it opens is not deep, however often it does.
    expect(problemOf(Array.from({ length: 500 }, () => 'f((a))').join(' + '))).toBe('none');
    // Far too deep is refused as well, and does not run out of stack.
    expect(problemOf(nested(100_000))).toBe('200: The formula is nested more than 200 deep.');
  });

  it('never throws, and gives a tree or a problem, whatever the text holds', () => {
    const pieces = fc.constantFrom(
      ...['a', 'Amount__c', '$User.Id', 'IF', 'NOT', 'TRUE', '1', '.5', '"t"', "'t'", '"', "'", '\\', '/*', '*/'],
      ...['(', ')', ',', '+', '-', '*', '/', '^', '=', '==', '<>', '!=', '<=', '>=', '&&', '||', '!', '&', '<', '>'],
      ...[' ', '\n', '@', '[', ']', '{', '}', '.', ':', '#', '$', '\u00E9', '\u{1F600}', '\uD83D'],
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 40 }), (parts) => {
        const text = parts.join('');
        const parsed = parseFormula(text);
        expect(parsed.tree === null).toBe(parsed.problem !== null);
        // Every token lies in the text, after the one before it.
        let end = 0;
        for (const token of parsed.tokens) {
          expect(token.start).toBeGreaterThanOrEqual(end);
          expect(token.end).toBeGreaterThan(token.start);
          end = token.end;
        }
        expect(end).toBeLessThanOrEqual(text.length);
        if (parsed.problem !== null) {
          expect(parsed.problem.at).toBeGreaterThanOrEqual(0);
          expect(parsed.problem.at).toBeLessThanOrEqual(text.length);
        }
        // The names of a tree are names among the tokens, each where its token stands.
        const tokens = new Map(parsed.tokens.map((token) => [token.start, token]));
        const names = parsed.tree === null ? namesOfTokens(parsed.tokens) : namesOfTree(parsed.tree);
        for (const name of names) expect(tokens.get(name.start)).toMatchObject({ kind: 'name', text: name.text });
        if (parsed.tree !== null) {
          expect(names.map((name) => name.start)).toEqual(namesOfTokens(parsed.tokens).map((name) => name.start));
        }
      }),
      { seed: 20261116, numRuns: 3000 },
    );
  });
});

describe('the names of a formula', () => {
  it('are every name that is no call and no word, in the order they stand, each with its place', () => {
    expect(namesOf('IF(b > a, c.d, MAX(a, $User.Id)) /* e */ & "f"')).toEqual([
      'b@3',
      'a@7',
      'c.d@10',
      'a@19',
      '$User.Id@22',
    ]);
    expect(namesOf('1 + 2')).toEqual([]);
  });

  it('carry the value a picklist is compared with', () => {
    expect(namesOf('ISPICKVAL(Status__c, "Paid")')).toEqual(['Status__c@10=Paid']);
    expect(namesOf("ispickval(Account__r.Tier__c, 'Gold')")).toEqual(['Account__r.Tier__c@10=Gold']);
    expect(namesOf('INCLUDES(Channels__c, "Email")')).toEqual(['Channels__c@9=Email']);
    expect(namesOf('ISPICKVAL(Status__c, "")')).toEqual(['Status__c@10=']);
    // The picklist as it was before the change.
    expect(namesOf('ISPICKVAL(PRIORVALUE(Status__c), "Paid")')).toEqual(['Status__c@21=Paid']);
    expect(namesOf('OR(ISPICKVAL(Status__c, "Paid"), ISPICKVAL(Status__c, "Void"))')).toEqual([
      'Status__c@13=Paid',
      'Status__c@43=Void',
    ]);
  });

  it('carry no value where the formula does not compare a picklist with a text', () => {
    // The value is a field, a label or a call.
    expect(namesOf('ISPICKVAL(Status__c, Other__c)')).toEqual(['Status__c@10', 'Other__c@21']);
    expect(namesOf('ISPICKVAL(Status__c, $Label.Paid)')).toEqual(['Status__c@10', '$Label.Paid@21']);
    expect(namesOf('ISPICKVAL(Status__c, TEXT(a))')).toEqual(['Status__c@10', 'a@26']);
    // One argument, or three.
    expect(namesOf('ISPICKVAL(Status__c)')).toEqual(['Status__c@10']);
    expect(namesOf('ISPICKVAL(Status__c, "Paid", "Void")')).toEqual(['Status__c@10']);
    // Another call, and a name deeper inside the first argument.
    expect(namesOf('CONTAINS(Status__c, "Paid")')).toEqual(['Status__c@9']);
    expect(namesOf('ISPICKVAL(IF(a, b, c), "Paid")')).toEqual(['a@13', 'b@16', 'c@19']);
    expect(namesOf('ISPICKVAL(PRIORVALUE(a, b), "Paid")')).toEqual(['a@21', 'b@24']);
    expect(namesOf('PRIORVALUE(Status__c)')).toEqual(['Status__c@11']);
  });

  it('are found among the tokens of a formula that was not read: no call, no word, no NOT', () => {
    const { tree, tokens } = parseFormula('IF(NOT a > 0, TRUE, b.c) ) + "d" + e f(');
    expect(tree).toBeNull();
    expect(namesOfTokens(tokens)).toEqual([
      { text: 'a', start: 7 },
      { text: 'b.c', start: 20 },
      { text: 'e', start: 35 },
    ]);
  });
});

describe('what a name of a formula stands for', () => {
  const part = (one: NamePart): string =>
    `${one.name}@${String(one.from)}${one.leadsTo === undefined ? '' : `>${one.leadsTo}`}${one.resolveAs === undefined ? '' : `=${one.resolveAs}`}`;
  const use = (one: NameUse): string =>
    one.form === 'path'
      ? `path from ${one.start}: ${one.parts.map(part).join(' ')}`
      : one.form === 'component'
        ? `${one.type} ${one.fullName} at ${part(one.part)}`
        : `object at ${part(one.part)}`;
  const uses = (name: string, own = 'Invoice__c'): string[] | null => usesOfName(name, own)?.map(use) ?? null;

  it('is a path from the object of the formula when it starts with no variable', () => {
    expect(uses('Amount__c')).toEqual(['path from Invoice__c: Amount__c@0']);
    expect(uses('Account__r.Owner.Email')).toEqual(['path from Invoice__c: Account__r@0 Owner@11 Email@17']);
    expect(uses('Name', 'Account')).toEqual(['path from Account: Name@0']);
  });

  it('takes the kind of record a relationship is said to lead to', () => {
    expect(uses('Owner:User.Email')).toEqual(['path from Invoice__c: Owner@0>User Email@11']);
    expect(uses('Account__r.Owner:User.Manager.Email')).toEqual([
      'path from Invoice__c: Account__r@0 Owner@11>User Manager@22 Email@30',
    ]);
    // A queue is a group, and its name is called QueueName in a formula only.
    expect(uses('Owner:Queue.QueueName')).toEqual(['path from Invoice__c: Owner@0>Group QueueName@12=Name']);
    expect(uses('owner:queue.queuename')).toEqual(['path from Invoice__c: owner@0>Group queuename@12=Name']);
    expect(uses('Owner:Queue.Email')).toEqual(['path from Invoice__c: Owner@0>Group Email@12']);
    // The name is another one only directly behind the queue.
    expect(uses('Owner:Queue.Owner.QueueName')).toEqual(['path from Invoice__c: Owner@0>Group Owner@12 QueueName@18']);
    expect(uses('Owner:User.QueueName')).toEqual(['path from Invoice__c: Owner@0>User QueueName@11']);
  });

  it('is a path from the object behind a global variable', () => {
    expect(uses('$User.Department')).toEqual(['path from User: Department@6']);
    expect(uses('$user.Manager.Email')).toEqual(['path from User: Manager@6 Email@14']);
    expect(uses('$Profile.Name')).toEqual(['path from Profile: Name@9']);
    expect(uses('$UserRole.Name')).toEqual(['path from UserRole: Name@10']);
    expect(uses('$Organization.Country')).toEqual(['path from Organization: Country@14']);
    expect(uses('$RecordType.DeveloperName')).toEqual(['path from RecordType: DeveloperName@12']);
    // The record that holds a lookup, as its filter calls it.
    expect(uses('$Source.Amount__c')).toEqual(['path from Invoice__c: Amount__c@8']);
  });

  it('is a custom label or a custom permission behind its variable', () => {
    expect(uses('$Label.Overdue_Notice')).toEqual(['CustomLabel Overdue_Notice at Overdue_Notice@7']);
    expect(uses('$LABEL.ns__Notice')).toEqual(['CustomLabel ns__Notice at ns__Notice@7']);
    expect(uses('$Permission.Approve_Large_Invoices')).toEqual([
      'CustomPermission Approve_Large_Invoices at Approve_Large_Invoices@12',
    ]);
  });

  it('is a field of a custom setting behind $Setup, and the setting is no use of its own', () => {
    expect(uses('$Setup.Billing_Settings__c.Grace_Days__c')).toEqual([
      // 7 characters of the variable with its dot, 19 of the setting, and one more dot.
      'path from Billing_Settings__c: Grace_Days__c@27',
    ]);
  });

  it('is a record of a custom metadata type and a field of the type behind $CustomMetadata', () => {
    expect(uses('$CustomMetadata.Billing_Rule__mdt.Default.Max_Amount__c')).toEqual([
      'CustomMetadata Billing_Rule.Default at Default@34',
      'path from Billing_Rule__mdt: Max_Amount__c@42',
    ]);
    expect(uses('$CustomMetadata.ns__Rule__mdt.ns__Std.ns__Max__c')).toEqual([
      'CustomMetadata ns__Rule.ns__Std at ns__Std@30',
      'path from ns__Rule__mdt: ns__Max__c@38',
    ]);
  });

  it('is an object behind $ObjectType, or a field of it', () => {
    expect(uses('$ObjectType.Tax_Code__c')).toEqual(['object at Tax_Code__c@12']);
    expect(uses('$ObjectType.Tax_Code__c.Fields.Rate__c')).toEqual(['path from Tax_Code__c: Rate__c@31']);
    expect(uses('$objecttype.Account.fields.Name')).toEqual(['path from Account: Name@27']);
  });

  it('is nothing that can change behind $Api and $System', () => {
    expect(uses('$Api.Session_ID')).toEqual([]);
    expect(uses('$System.OriginDateTime')).toEqual([]);
    expect(uses('$api')).toEqual([]);
  });

  it('is not read when it is built in another way, or stands behind a variable that is not known', () => {
    for (const name of [
      // Variables of buttons, pages and reports.
      '$Action.Account.View',
      '$SControl.Header_Snippet',
      '$Resource.Logo',
      'AMOUNT:SUM',
      // Too few names, or too many.
      '$User',
      '$Label',
      '$Label.A.B',
      '$Permission',
      '$Setup',
      '$Setup.Billing_Settings__c',
      '$CustomMetadata.Billing_Rule__mdt.Default',
      '$CustomMetadata.Billing_Rule__mdt',
      '$ObjectType',
      '$ObjectType.Account.Name',
      '$ObjectType.Account.Fields',
      '$ObjectType.Account.Fields.Name.More',
      '$ObjectType.Account.Other.Name',
      // No names.
      'a..b',
      'a.',
      '.a',
      'a.1b',
      'a#b',
      'a$b',
      '$',
      '$$User.Name',
      '$User.$Profile.Name',
      '$Label.A:B',
      'Owner:.Name',
      'Owner:User:Queue.Name',
    ]) {
      expect(uses(name), name).toBeNull();
    }
  });
});

describe('the formula probes', () => {
  const root = parse(readFileSync(join(FIXTURES_DIR, 'formula-probes.yaml'), 'utf8')) as {
    object: string;
    probes: { covers: string; formula: string; names: string[]; where?: string }[];
  };

  it('are all read without a problem, with the names each of them lists', () => {
    expect(root.probes).toHaveLength(178);
    const wrong: string[] = [];
    for (const probe of root.probes) {
      const { tree, problem } = parseFormula(probe.formula);
      if (tree === null) {
        wrong.push(`${probe.covers}: ${String(problem?.message)}`);
        continue;
      }
      const names = namesOfTree(tree);
      if (JSON.stringify(names.map((name) => name.text)) !== JSON.stringify(probe.names)) {
        wrong.push(`${probe.covers}: read ${names.map((name) => name.text).join(', ')}`);
      }
      // Each name stands where the reader says.
      for (const name of names) {
        if (!probe.formula.startsWith(name.text, name.start)) wrong.push(`${probe.covers}: place of ${name.text}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('hold no name that is not read, except in formulas of reports, buttons and pages', () => {
    const notRead: string[] = [];
    for (const probe of root.probes) {
      const { tree } = parseFormula(probe.formula);
      for (const name of tree === null ? [] : namesOfTree(tree)) {
        if (usesOfName(name.text, root.object) === null) {
          notRead.push(`${probe.covers}${probe.where === undefined ? '' : ` (${probe.where})`}: ${name.text}`);
        }
      }
    }
    expect(notRead).toEqual([
      'INCLUDE (elsewhere): $SControl.Header_Snippet',
      'LINKTO (elsewhere): $Action.Account.View',
      'URLFOR (elsewhere): $Action.Account.View',
      'PARENTGROUPVAL (elsewhere): AMOUNT:SUM',
      'PREVGROUPVAL (elsewhere): AMOUNT:SUM',
    ]);
  });
});
