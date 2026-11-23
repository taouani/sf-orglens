/**
 * `orglens impact`: the text a person reads, the JSON a script reads, and the exit codes.
 *
 * The answers themselves are tested in the engine. Here the fixture project is asked through the command line,
 * and what is printed is held against golden files.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

const dirs = tempDirs();
afterEach(dirs.cleanUp);

const FIXTURE = fileURLToPath(new URL('../../../fixtures/billing-sfdx', import.meta.url));
const OBJECTS = 'project/force-app/main/default/objects';
const AMOUNT = 'CustomField:invoice__c.amount__c';

/**
 * Takes away the one flow of the fixture project whose analysis has a warning: a path it does not follow, which
 * the answer key lists among what is not known. A warning counts for every answer of a snapshot, so a test of
 * an answer that is complete, or of a number of warnings, asks a project without that flow.
 */
const withoutTheWarning = (dir: string): void => {
  rmSync(join(dir, 'project/force-app/main/default/flows/Invoice_After_Save.flow-meta.xml'));
};

/** A workspace with a copy of the fixture project as its only source, `fixture`, and one snapshot of it. */
async function fixtureWorkspace(change: (dir: string) => void = () => undefined, more = ''): Promise<string> {
  const dir = dirs.next();
  cpSync(FIXTURE, join(dir, 'project'), { recursive: true });
  writeFileSync(
    join(dir, 'orglens.toml'),
    `schema_version = 1\n[sources.fixture]\nkind = "git"\nrepo = "project"\n${more}`,
  );
  change(dir);
  const taken = await orglens(dir, ['snapshot', 'fixture']);
  expect(taken.stderr).toBe('');
  return dir;
}

/** The types of the fixture project that no analyser reads yet, as the answer prints them. */
const NOT_ANALYSED = [
  'TYPE              LISTED  RETRIEVED',
  'ApexClass         13      13',
  'ApexTrigger       1       1',
  'CustomLabel       1       1',
  'CustomLabels      1       1',
  'CustomPermission  1       1',
  'EmailFolder       1       1',
  'EmailTemplate     1       1',
  'GlobalValueSet    1       1',
];

describe('orglens impact', () => {
  it.each([
    ['a field that formulas and rules read', 'Invoice__c.Amount__c', 'amount'],
    ['a field of a standard object', 'Account.Tier__c', 'account-tier'],
    ['a standard field', 'User.Department', 'standard-field'],
    // The file of workflow rules of the object has the name of the object. The name alone means the object.
    ['an object', 'Invoice__c', 'object'],
    ['a field that nothing refers to', 'Invoice__c.Unused_Field__c', 'unreferenced'],
    ['a field that is reached through a chain of formulas', 'Invoice_Line__c.Quantity__c', 'chain'],
    // A flow is found beside its elements, and what calls it after them.
    ['a flow', 'Invoice_Recalculate', 'flow'],
    // An element is named after its flow. What calls the flow runs the element.
    ['an element of a flow', 'Invoice_Recalculate.Set_Amount', 'element'],
  ])('prints the answer for %s as its golden file says', async (_what, component, file) => {
    const dir = await fixtureWorkspace();
    const shown = await orglens(dir, ['impact', component]);
    expect(shown).toMatchObject({ code: 0, stderr: '' });
    await expect(shown.stdout).toMatchFileSnapshot(`./golden/impact-${file}.txt`);
    // The same answer as JSON, which is checked against the schema.
    const json = await orglensJson(dir, ['impact', component]);
    expect(json).toMatchObject({ code: 0, command: 'impact', ok: true, error: null });
    const data = json.data as { results: { key: string; depth: number }[] };
    for (const result of data.results) {
      expect(shown.stdout).toMatch(new RegExp(`^${String(result.depth)} +${result.key.replaceAll('.', '\\.')} `, 'm'));
    }
  });

  it('names the other components that have the name of the object, in the text and in the JSON', async () => {
    // A custom tab of an object has the name of the object too, as the file of its workflow rules has.
    const dir = await fixtureWorkspace((at) => {
      const tabs = join(at, 'project/force-app/main/default/tabs');
      mkdirSync(tabs);
      writeFileSync(
        join(tabs, 'Invoice__c.tab-meta.xml'),
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">',
          '    <customObject>true</customObject>',
          '    <motif>Custom20: Airplane</motif>',
          '</CustomTab>',
          '',
        ].join('\n'),
      );
    });
    expect((await orglens(dir, ['impact', 'Invoice__c'])).stdout.split('\n')[1]).toBe(
      'The name also fits CustomTab:invoice__c, Workflow:invoice__c. The answer is about the object. To ask about another, name it by its key.',
    );
    expect((await orglensJson(dir, ['impact', 'Invoice__c'])).data).toMatchObject({
      component: { key: 'CustomObject:invoice__c' },
      sameName: ['CustomTab:invoice__c', 'Workflow:invoice__c'],
    });
    // Named by its key, the object is all the question names, and the line is not there.
    const byKey = await orglens(dir, ['impact', 'CustomObject:Invoice__c']);
    expect(byKey.stdout).not.toMatch(/also fits/);
    expect((await orglensJson(dir, ['impact', 'CustomObject:Invoice__c'])).data).toMatchObject({ sameName: [] });
  });

  it('says in its first lines that the answer is not complete, before the answer', async () => {
    const dir = await fixtureWorkspace();
    const lines = (await orglens(dir, ['impact', 'Account.Tier__c'])).stdout.split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'What refers to CustomField:account.tier__c (Account.Tier__c), in snapshot #1 of "fixture".',
      'The answer is not complete: 8 types are not analysed yet, and the analysis had 1 warning. The details are below the answer.',
      '',
      '9 components refer to it, 5 of them directly.',
      'A flow is listed with the reference of one of its elements, which is listed after it.',
      '',
    ]);
    expect(lines.slice(-(NOT_ANALYSED.length + 4))).toEqual([
      'Not analysed yet. A component of these types may refer to it, and is not in the answer:',
      ...NOT_ANALYSED,
      '',
      'The analysis had 1 warning: a name was not read, a path was not followed, or a part of a file was not found. A reference may be missing for each. See: orglens coverage fixture --snapshot 1',
      '',
    ]);
  });

  it('takes a depth, a least confidence and a direction, and says what it was asked', async () => {
    const dir = await fixtureWorkspace();
    const near = await orglens(dir, ['impact', 'invoice_line__c.quantity__c', '--depth', '2']);
    expect(near.code).toBe(0);
    const lines = near.stdout.split('\n');
    expect(lines[0]).toBe(
      'What refers to CustomField:invoice_line__c.quantity__c (Invoice_Line__c.Quantity__c), in snapshot #1 of "fixture", to a depth of 2.',
    );
    expect(lines).toContain('13 components refer to it, 9 of them directly.');
    expect(lines).toContain(
      'The answer stops at depth 2, and references lead further. Ask again with a larger --depth, or without it.',
    );
    expect(await orglensJson(dir, ['impact', 'Invoice_Line__c.Quantity__c', '--depth=2'])).toMatchObject({
      data: { depth: 2, beyondDepth: true, minConfidence: 'possible', direction: 'incoming' },
    });

    const strict = await orglens(dir, ['impact', AMOUNT, '--min-confidence', 'confirmed', '--depth', '1']);
    expect(strict.stdout.split('\n')[0]).toBe(
      `What refers to ${AMOUNT} (Invoice__c.Amount__c), in snapshot #1 of "fixture", to a depth of 1, over references that are at least confirmed.`,
    );
    expect(strict.stdout).toContain('26 components refer to it, all of them directly.');

    const quiet = await fixtureWorkspace(withoutTheWarning);
    const outgoing = await orglens(quiet, ['impact', 'Invoice__c.Total__c', '--outgoing']);
    expect(outgoing).toMatchObject({ code: 0, stderr: '' });
    expect(outgoing.stdout.split('\n')).toEqual([
      'What CustomField:invoice__c.total__c (Invoice__c.Total__c) refers to, in snapshot #1 of "fixture".',
      'The answer is complete: the snapshot holds every component in it, and each was analysed, without an error or a warning.',
      '',
      'It refers to 2 components, directly.',
      '',
      'DEPTH  COMPONENT                           CONFIDENCE  KIND   REFERRED TO BY                   WHERE',
      `1      CustomField:invoice__c.amount__c    confirmed   reads  CustomField:invoice__c.total__c  force-app/main/default/objects/Invoice__c/fields/Total__c.field-meta.xml:4`,
      `1      CustomField:invoice__c.tax_rate__c  confirmed   reads  CustomField:invoice__c.total__c  force-app/main/default/objects/Invoice__c/fields/Total__c.field-meta.xml:4`,
      '',
    ]);

    // An element that calls a flow refers to what the elements of that flow refer to. They have no line.
    const called = (await orglens(dir, ['impact', 'Invoice_After_Save.Recalculate', '--outgoing'])).stdout.split('\n');
    expect(called).toContain(
      'A flow refers to what its elements refer to: REFERRED TO BY can name an element of a listed flow, which is not listed itself.',
    );
    expect(called.some((line) => /^2 .* Flow:invoice_recalculate#element:\S+ /.test(line))).toBe(true);
    expect(called.filter((line) => /^\d+ +Flow:invoice_recalculate#element:/.test(line))).toEqual([]);
    expect(outgoing.stdout).not.toContain('REFERRED TO BY can name');

    // A class is not analysed yet. The empty answer says so, and is no finding.
    const apex = await orglens(quiet, ['impact', 'InvoiceService', '--outgoing']);
    expect(apex.stdout.split('\n')).toEqual([
      'What ApexClass:invoiceservice (InvoiceService) refers to, in snapshot #1 of "fixture".',
      'The answer is not complete: 1 type is not analysed yet. The details are below the answer.',
      'ApexClass is not analysed yet: what the component itself refers to is not known.',
      '',
      'It refers to no component, as far as it was analysed.',
      '',
      'Not analysed yet. What the components of these types in the answer refer to is not known:',
      'TYPE       LISTED  RETRIEVED',
      'ApexClass  13      13',
      '',
    ]);
  });

  it('lists the names a component refers to that have no component, and says what the analysis did not follow', async () => {
    const dir = await fixtureWorkspace((root) => {
      withoutTheWarning(root);
      // A field that no file defines, a standard field, and a relationship that no file defines: the path
      // behind it is not followed, which is the warning.
      writeFileSync(
        join(root, OBJECTS, 'Invoice__c', 'fields', 'Guess__c.field-meta.xml'),
        '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n' +
          '    <fullName>Guess__c</fullName>\n    <formula>Gone__c + Amount__c + LEN(Name) + Mystery__r.Size__c</formula>\n' +
          '    <label>Guess</label>\n    <precision>16</precision>\n    <scale>2</scale>\n    <type>Number</type>\n</CustomField>\n',
      );
    });
    const shown = await orglens(dir, ['impact', 'Invoice__c.Guess__c', '--outgoing']);
    expect(shown).toMatchObject({ code: 0, stderr: '' });
    const lines = shown.stdout.split('\n');
    expect(lines.slice(0, 2)).toEqual([
      'What CustomField:invoice__c.guess__c (Invoice__c.Guess__c) refers to, in snapshot #1 of "fixture".',
      'The answer is not complete: the analysis had 1 warning, and the snapshot does not hold 1 component of the answer, so what it refers to is not known. The details are below the answer.',
    ]);
    const guess = 'force-app/main/default/objects/Invoice__c/fields/Guess__c.field-meta.xml:4';
    expect(lines.slice(3)).toEqual([
      'It refers to 2 components, directly.',
      '',
      'DEPTH  COMPONENT                         CONFIDENCE  KIND   REFERRED TO BY                   WHERE',
      `1      CustomField:invoice__c.amount__c  confirmed   reads  CustomField:invoice__c.guess__c  ${guess}`,
      `1      CustomField:invoice__c.name       confirmed   reads  CustomField:invoice__c.guess__c  ${guess}`,
      '',
      '2 references name something that has no component in the snapshot:',
      'DEPTH  FROM                             KIND   TYPE         NAME        WHERE',
      `1      CustomField:invoice__c.guess__c  reads  CustomField  Gone__c     ${guess}`,
      `1      CustomField:invoice__c.guess__c  reads  CustomField  Mystery__r  ${guess}`,
      '',
      'The analysis had 1 warning: a name was not read, a path was not followed, or a part of a file was not found. A reference may be missing for each. See: orglens coverage fixture --snapshot 1',
      '',
      'The snapshot does not hold 1 component of the answer, such as a standard field or a component of a package. What it refers to is not known.',
      '',
    ]);
    // The same as JSON, which is checked against the schema.
    const json = await orglensJson(dir, ['impact', 'Invoice__c.Guess__c', '--outgoing']);
    expect(json).toMatchObject({
      code: 0,
      ok: true,
      data: {
        direction: 'outgoing',
        unresolved: [
          { from: 'CustomField:invoice__c.guess__c', type: 'CustomField', name: 'Gone__c', depth: 1, line: 4 },
          { from: 'CustomField:invoice__c.guess__c', type: 'CustomField', name: 'Mystery__r', depth: 1, line: 4 },
        ],
        complete: false,
        mayMiss: false,
        notCovered: { notAnalysed: [], partial: [], analysisWarnings: 1, notHeld: 1 },
      },
    });
    // The warning is about the whole snapshot, so the other direction is not complete either.
    expect((await orglens(dir, ['impact', 'Invoice__c.Amount__c'])).stdout.split('\n')[1]).toBe(
      'The answer is not complete: 8 types are not analysed yet, and the analysis had 1 warning. The details are below the answer.',
    );
  });

  it('ends with 5 when the answer may miss something of a type it covers', async () => {
    const dir = await fixtureWorkspace((root) => {
      writeFileSync(
        join(root, OBJECTS, 'Invoice__c', 'fields', 'Total__c.field-meta.xml'),
        '<CustomField xmlns="x"><label>Total',
      );
    });
    const shown = await orglens(dir, ['impact', 'Invoice__c.Amount__c']);
    expect(shown).toMatchObject({ code: 5, stderr: '' });
    const lines = shown.stdout.split('\n');
    expect(lines[1]).toBe(
      'The answer is not complete: 8 types are not analysed yet, and the analysis had 1 error and 1 warning. The details are below the answer.',
    );
    // The 28 of the project without the field that could not be read, and without the one that reads it.
    expect(lines).toContain('26 components refer to it, 25 of them directly.');
    expect(lines.slice(-5)).toEqual([
      '',
      'The analysis had 1 error: something of an analysed type was not read. See: orglens coverage fixture --snapshot 1',
      '',
      'The analysis had 1 warning: a name was not read, a path was not followed, or a part of a file was not found. A reference may be missing for each. See: orglens coverage fixture --snapshot 1',
      '',
    ]);
    expect(await orglensJson(dir, ['impact', 'Invoice__c.Amount__c'])).toMatchObject({
      code: 5,
      ok: true,
      error: null,
      data: { complete: false, mayMiss: true, notCovered: { analysisErrors: 1, readErrors: 0, partial: [] } },
    });
  });

  it('ends with 5 when a folder of the source was not read', async () => {
    const dir = await fixtureWorkspace(withoutTheWarning, 'paths = ["force-app", "not-there"]\n');
    const shown = await orglens(dir, ['impact', 'Invoice__c.Amount__c']);
    expect(shown).toMatchObject({ code: 5, stderr: '' });
    const lines = shown.stdout.split('\n');
    expect(lines[1]).toBe(
      'The answer is not complete: 8 types are not analysed yet, and 1 error of the reading names no type, so what is missing may be of an analysed type. The details are below the answer.',
    );
    expect(lines.slice(-3)).toEqual([
      '',
      '1 error of the reading names no type: a file or a folder could not be read. See: orglens coverage fixture --snapshot 1',
      '',
    ]);
  });

  it('ends with 2 for a name that fits no component, or several', async () => {
    const dir = await fixtureWorkspace((root) => {
      // A rule with the name of a field.
      const rules = join(root, OBJECTS, 'Invoice__c', 'validationRules');
      cpSync(join(rules, 'Locked_When_Paid.validationRule-meta.xml'), join(rules, 'Amount__c.validationRule-meta.xml'));
    });
    expect(await orglens(dir, ['impact', 'Invoice__c.Nope__c'])).toEqual({
      code: 2,
      stdout: '',
      stderr:
        'error: The snapshot knows no component "Invoice__c.Nope__c".\n' +
        'hint: Name a component by its name, such as Account.Industry, or by its type and name, such as CustomField:Account.Industry.\n',
    });
    expect(await orglens(dir, ['impact', 'Invoice__c.Amount__c'])).toEqual({
      code: 2,
      stdout: '',
      stderr:
        `error: "Invoice__c.Amount__c" names 2 components: ${AMOUNT}, ValidationRule:invoice__c.amount__c.\n` +
        `hint: Name the one you mean by its key, such as ${AMOUNT}.\n`,
    });
    expect(await orglensJson(dir, ['impact', 'Invoice__c.Amount__c'])).toMatchObject({
      code: 2,
      command: 'impact',
      ok: false,
      data: null,
      error: {
        code: 'COMPONENT_AMBIGUOUS',
        details: { candidates: [AMOUNT, 'ValidationRule:invoice__c.amount__c'], snapshot: 1 },
      },
    });
    // The key says which one is meant.
    expect((await orglens(dir, ['impact', AMOUNT])).code).toBe(0);
    expect(await orglensJson(dir, ['impact', 'NotAType?:x'])).toMatchObject({
      code: 2,
      error: { code: 'KEY_INVALID' },
    });
  });

  it('asks the only source of the workspace, and wants to be told which one when there are several', async () => {
    const dir = await fixtureWorkspace();
    expect((await orglens(dir, ['impact', AMOUNT, '--source', 'fixture'])).stdout).toBe(
      (await orglens(dir, ['impact', AMOUNT])).stdout,
    );
    expect(await orglens(dir, ['impact', AMOUNT, '--source', 'nowhere'])).toMatchObject({
      code: 2,
      stderr:
        'error: No source "nowhere" is declared in orglens.toml.\nhint: See the sources with: orglens source list\n',
    });
    expect((await orglens(dir, ['source', 'add', 'prod', '--kind', 'org'])).code).toBe(0);
    expect(await orglens(dir, ['impact', AMOUNT])).toEqual({
      code: 2,
      stdout: '',
      stderr:
        'error: The workspace declares 2 sources. Say which one is meant with --source <name>.\n' +
        'hint: The sources: fixture, prod\n',
    });
    expect((await orglens(dir, ['impact', AMOUNT, '--source', 'fixture'])).code).toBe(0);
    expect(await orglens(dir, ['impact', AMOUNT, '--source', 'prod'])).toMatchObject({
      code: 2,
      stderr: 'error: There is no snapshot of the source "prod" yet.\nhint: Take one with: orglens snapshot prod\n',
    });

    const empty = dirs.next();
    await orglens(empty, ['init']);
    expect(await orglens(empty, ['impact', AMOUNT])).toEqual({
      code: 2,
      stdout: '',
      stderr: 'error: The workspace declares no source.\nhint: Declare one with: orglens source add\n',
    });
  });

  it('asks the snapshot that is named', async () => {
    const dir = await fixtureWorkspace();
    expect(await orglensJson(dir, ['impact', AMOUNT, '--snapshot', '1'])).toMatchObject({
      code: 0,
      data: { snapshot: { id: 1, source: 'fixture', kind: 'git', status: 'complete' } },
    });
    expect(await orglensJson(dir, ['impact', AMOUNT, '--snapshot', '2'])).toMatchObject({
      code: 2,
      error: { code: 'SNAPSHOT_NOT_FOUND', details: { source: 'fixture', snapshot: 2 } },
    });
  });

  it('rejects a command line it cannot act on, before anything is read', async () => {
    const dir = await fixtureWorkspace();
    for (const [args, message] of [
      [['--depth', '0'], '--depth takes a whole number from 1, and "0" is not one.'],
      [['--depth', 'all'], '--depth takes a whole number from 1, and "all" is not one.'],
      [['--depth', '1.5'], '--depth takes a whole number from 1, and "1.5" is not one.'],
      [['--snapshot', 'latest'], '--snapshot takes the number of a snapshot, and "latest" is not one.'],
    ] as const) {
      const usage = await orglensJson(dir, ['impact', AMOUNT, ...args]);
      expect(usage).toMatchObject({ code: 2, command: 'impact', ok: false, error: { code: 'USAGE', message } });
    }
    const tier = await orglens(dir, ['impact', AMOUNT, '--min-confidence', 'certain']);
    expect(tier).toMatchObject({ code: 2, stdout: '' });
    expect(tier.stderr).toMatch(/^error: option '--min-confidence <tier>' argument 'certain' is invalid/);
    const nothing = await orglens(dir, ['impact']);
    expect(nothing).toMatchObject({ code: 2, stdout: '' });
    expect(nothing.stderr).toMatch(/^error: missing required argument 'component'/);
  });
});
