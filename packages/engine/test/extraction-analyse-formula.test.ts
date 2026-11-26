/**
 * What the analysis makes of a formula in a file: the formula of a field, its default value and the condition of
 * a validation rule.
 *
 * The first part runs on small sources that are written here. A place it expects is found by searching the text
 * of the file for the word, never counted by hand. The second part lays the formulas of
 * `fixtures/formula-negative` over the fixture project and holds the analysis against what `expected.yaml` says.
 * The formulas of the project itself are scored against the answer key in `extraction-analyse.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { codes, HEAD, key, Source, valueOf, viaOf, XMLNS } from './helpers/written-source.ts';

/** Where the nth whole word `word` stands in a text, as `line:column`, found by searching the text. */
function placeIn(text: string, word: string, nth = 1): string {
  let seen = 0;
  for (const [index, line] of text.split('\n').entries()) {
    for (let inLine = 1; ; inLine += 1) {
      const column = columnOf(line, word, inLine);
      if (column === undefined) break;
      seen += 1;
      if (seen === nth) return `${String(index + 1)}:${String(column)}`;
    }
  }
  throw new Error(`The text does not hold "${word}" ${String(nth)} times.`);
}

/** A reference as `line:column kind target [name] resolution tier`. */
const line = (one: Reference): string =>
  `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} [${one.toNameRaw}] ${one.resolution} ${one.confidence}`;

/** A source with an invoice, an account and what a formula of the invoice can name. */
function billing(): Source {
  const source = new Source();
  source.object('Account');
  source.field('Account', 'Tier__c', '<type>Picklist</type>');
  source.object('Invoice__c');
  source.field('Invoice__c', 'Account__c', '<referenceTo>Account</referenceTo>', '<type>Lookup</type>');
  source.field('Invoice__c', 'Amount__c', '<type>Currency</type>');
  source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
  source.field('Invoice__c', 'Tax_Rate__c', '<type>Percent</type>');
  return source;
}

/** Analyses a source with one more field of the invoice, whose formula is `formula` as the file writes it. */
function withFormula(formula: string, source = billing()): { analysis: SourceAnalysis; file: string; text: string } {
  const file = source.field('Invoice__c', 'Probe__c', `<formula>${formula}</formula>`, '<type>Text</type>');
  const text = Buffer.from(source.files.get(file) ?? []).toString('utf8');
  return { analysis: source.analyse(), file, text };
}

const probe = key('CustomField', 'Invoice__c.Probe__c');
const referencesOf = (analysis: SourceAnalysis, from: string = probe): readonly Reference[] =>
  analysis.components.find((one) => one.key === from)?.references ?? [];

describe('the formulas of a source', () => {
  it('are the formula of a field, its default value and the condition of a rule, each name at its place', () => {
    const source = billing();
    const total = source.field(
      'Invoice__c',
      'Total__c',
      '<formula>Amount__c * (1 + Tax_Rate__c)</formula>',
      '<type>Currency</type>',
    );
    const code = source.field(
      'Invoice__c',
      'Code__c',
      '<defaultValue>$User.Department &amp; "-" &amp; TEXT(Amount__c)</defaultValue>',
      '<type>Text</type>',
    );
    const rule = source.rule(
      'Invoice__c',
      'Not_Negative',
      '<active>true</active>',
      '<errorConditionFormula>AND(',
      '  Amount__c &lt; 0,',
      '  NOT(ISBLANK(Account__c))',
      ')</errorConditionFormula>',
      '<errorDisplayField>Amount__c</errorDisplayField>',
    );
    const analysis = source.analyse();
    const text = (file: string): string => Buffer.from(source.files.get(file) ?? []).toString('utf8');
    const told = (from: string): string[] =>
      referencesOf(analysis, from).map((one) => `${line(one)} ${viaOf(one)} ${one.origin}`);

    expect(told(key('CustomField', 'Invoice__c.Total__c'))).toEqual([
      `${placeIn(text(total), 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed formula parser:formula`,
      `${placeIn(text(total), 'Tax_Rate__c')} reads CustomField:invoice__c.tax_rate__c [Tax_Rate__c] resolved confirmed formula parser:formula`,
    ]);
    // An entity of XML is one character of the formula and five of the file: the place is that in the file.
    expect(told(key('CustomField', 'Invoice__c.Code__c'))).toEqual([
      `${placeIn(text(code), 'Department')} reads CustomField:user.department [Department] external confirmed formula parser:formula`,
      `${placeIn(text(code), 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed formula parser:formula`,
    ]);
    // The references of the formula follow those that are written in XML.
    expect(told(key('ValidationRule', 'Invoice__c.Not_Negative'))).toEqual([
      `${placeIn(text(rule), 'Amount__c', 2)} references CustomField:invoice__c.amount__c [Amount__c] resolved confirmed display-field parser:xml`,
      `${placeIn(text(rule), 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed formula parser:formula`,
      `${placeIn(text(rule), 'Account__c')} reads CustomField:invoice__c.account__c [Account__c] resolved confirmed formula parser:formula`,
    ]);
    // Four spaces before every line of the file, two in the formula, and the twelve characters of two calls.
    expect(placeIn(text(rule), 'Account__c')).toBe('7:19');
    expect(analysis.issues).toEqual([]);
    // Two objects, seven fields and a rule were read. Three of them hold a formula.
    expect(analysis.work).toEqual([
      { origin: 'parser:xml', components: 10, failedFiles: 0 },
      { origin: 'parser:formula', components: 3, failedFiles: 0 },
      { origin: 'parser:flow', components: 0, failedFiles: 0 },
    ]);
    // Only the formula of a field makes it a formula field. A default value does not.
    const attrs = (fullName: string): unknown =>
      analysis.components.find((one) => one.key === key('CustomField', fullName))?.attrs;
    expect(attrs('Invoice__c.Total__c')).toEqual({ type: 'Currency', formula: true });
    expect(attrs('Invoice__c.Code__c')).toEqual({ type: 'Text' });
  });

  it('counts a default value that names nothing as a formula, and makes no reference of it', () => {
    const source = billing();
    source.field('Invoice__c', 'Is_Open__c', '<defaultValue>false</defaultValue>', '<type>Checkbox</type>');
    source.field('Invoice__c', 'Kind__c', '<defaultValue>"Standard"</defaultValue>', '<type>Text</type>');
    source.field('Invoice__c', 'Day__c', '<defaultValue>TODAY() + 30</defaultValue>', '<type>Date</type>');
    const analysis = source.analyse();
    expect(analysis.components.flatMap((one) => one.references).filter((one) => viaOf(one) === 'formula')).toEqual([]);
    expect(analysis.issues).toEqual([]);
    expect(analysis.work[1]).toEqual({ origin: 'parser:formula', components: 3, failedFiles: 0 });
  });

  it('take an element without a value for no formula', () => {
    const source = billing();
    source.field('Invoice__c', 'Empty__c', '<formula></formula>', '<defaultValue>  </defaultValue>');
    source.field('Invoice__c', 'Closed__c', '<formula/>', '<type>Text</type>');
    source.fieldFile(
      'Invoice__c',
      'Nil__c',
      [
        HEAD,
        `<CustomField xmlns="${XMLNS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
        '    <fullName>Nil__c</fullName>',
        '    <formula xsi:nil="true"/>',
        '</CustomField>',
        '',
      ].join('\n'),
    );
    source.rule('Invoice__c', 'No_Condition', '<active>true</active>');
    const analysis = source.analyse();
    expect(analysis.issues).toEqual([]);
    expect(analysis.work[1]).toEqual({ origin: 'parser:formula', components: 0, failedFiles: 0 });
    expect(analysis.components.find((one) => one.key === key('CustomField', 'Invoice__c.Empty__c'))?.attrs).toEqual({});
  });

  it('are read where they stand: over lines, in a CDATA section, behind a comment of XML', () => {
    const source = billing();
    const file = source.fieldFile(
      'Invoice__c',
      'Probe__c',
      [
        HEAD,
        `<CustomField xmlns="${XMLNS}">`,
        '    <fullName>Probe__c</fullName>',
        '    <formula><!-- why --><![CDATA[IF(Amount__c < 0 && Tax_Rate__c > 0,',
        '  "a",',
        '  /* Status__c',
        '     is not read */',
        ']]>  TEXT(Status__c)',
        ')</formula>',
        '</CustomField>',
        '',
      ].join('\n'),
    );
    const analysis = source.analyse();
    const text = Buffer.from(source.files.get(file) ?? []).toString('utf8');
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed`,
      `${placeIn(text, 'Tax_Rate__c')} reads CustomField:invoice__c.tax_rate__c [Tax_Rate__c] resolved confirmed`,
      `${placeIn(text, 'Status__c', 2)} reads CustomField:invoice__c.status__c [Status__c] resolved confirmed`,
    ]);
    expect(placeIn(text, 'Status__c', 2)).toBe('8:11');
    expect(analysis.issues).toEqual([]);
  });

  it('are read in the file of an object as an org hands it out, with the object of the file as their own', () => {
    const source = new Source();
    const file = source.object(
      'Invoice__c',
      '<fields>',
      '    <fullName>Amount__c</fullName>',
      '    <type>Currency</type>',
      '</fields>',
      '<fields>',
      '    <fullName>Double__c</fullName>',
      '    <formula>Amount__c * 2</formula>',
      '    <type>Currency</type>',
      '</fields>',
      '<validationRules>',
      '    <fullName>Positive</fullName>',
      '    <active>true</active>',
      '    <errorConditionFormula>Double__c &lt; 0</errorConditionFormula>',
      '</validationRules>',
    );
    const analysis = source.analyse();
    const text = Buffer.from(source.files.get(file) ?? []).toString('utf8');
    expect(referencesOf(analysis, key('CustomField', 'Invoice__c.Double__c')).map(line)).toEqual([
      `${placeIn(text, 'Amount__c', 2)} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed`,
    ]);
    expect(referencesOf(analysis, key('ValidationRule', 'Invoice__c.Positive')).map(line)).toEqual([
      `${placeIn(text, 'Double__c', 2)} reads CustomField:invoice__c.double__c [Double__c] resolved confirmed`,
    ]);
    expect(analysis.issues).toEqual([]);
    expect(analysis.work[1]).toEqual({ origin: 'parser:formula', components: 2, failedFiles: 0 });
  });
});

describe('a name in a formula', () => {
  it('is found in any case, and the reference keeps it as written', () => {
    const { analysis } = withFormula('amount__C + TAX_RATE__C');
    expect(referencesOf(analysis).map((one) => `${String(one.to)} [${one.toNameRaw}]`)).toEqual([
      'CustomField:invoice__c.amount__c [amount__C]',
      'CustomField:invoice__c.tax_rate__c [TAX_RATE__C]',
    ]);
  });

  it('that is a path reads the field behind every relationship and the field at the end', () => {
    const { analysis, text } = withFormula('Account__r.Owner.Email &amp; Account__r.Tier__c');
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed`,
      `${placeIn(text, 'Owner')} reads CustomField:account.ownerid [Owner] external confirmed`,
      `${placeIn(text, 'Email')} reads CustomField:user.email [Email] external confirmed`,
      `${placeIn(text, 'Account__r', 2)} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed`,
      `${placeIn(text, 'Tier__c')} reads CustomField:account.tier__c [Tier__c] resolved confirmed`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('that walks the relationship of a person account reads the lookup of the contact, from every object that shows it', () => {
    // An org with person accounts hands out parts of the account under `PersonAccount` and `BusinessAccount` too.
    for (const object of ['Account', 'PersonAccount', 'BusinessAccount']) {
      const source = billing();
      source.field('Contact', 'Mentor__c', '<referenceTo>User</referenceTo>', '<type>Lookup</type>');
      const file = source.field(
        object,
        'Probe__c',
        '<formula>Mentor__pr.Email &amp; Mentor__pc</formula>',
        '<type>Text</type>',
      );
      const text = Buffer.from(source.files.get(file) ?? []).toString('utf8');
      const analysis = source.analyse();
      expect(referencesOf(analysis, key('CustomField', `${object}.Probe__c`)).map(line)).toEqual([
        `${placeIn(text, 'Mentor__pr')} reads CustomField:contact.mentor__c [Mentor__pr] resolved confirmed`,
        `${placeIn(text, 'Email')} reads CustomField:user.email [Email] external confirmed`,
        `${placeIn(text, 'Mentor__pc')} reads CustomField:contact.mentor__c [Mentor__pc] resolved confirmed`,
      ]);
      expect(analysis.issues).toEqual([]);
    }
  });

  it('goes where the formula says the owner leads: to a user, or to a queue, which is a group', () => {
    const { analysis, text } = withFormula('Owner:User.Email &amp; Owner:Queue.QueueName &amp; Owner:Queue.Email');
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Owner')} reads CustomField:invoice__c.ownerid [Owner] external confirmed`,
      `${placeIn(text, 'Email')} reads CustomField:user.email [Email] external confirmed`,
      `${placeIn(text, 'Owner', 2)} reads CustomField:invoice__c.ownerid [Owner] external confirmed`,
      // The name of a group. The reference keeps the name the formula has for it.
      `${placeIn(text, 'QueueName')} reads CustomField:group.name [QueueName] external confirmed`,
      `${placeIn(text, 'Owner', 3)} reads CustomField:invoice__c.ownerid [Owner] external confirmed`,
      `${placeIn(text, 'Email', 2)} reads CustomField:group.email [Email] external confirmed`,
    ]);
  });

  it('gives no reference for the field Id, and reads the relationships before it', () => {
    const { analysis, text } = withFormula('Id &amp; Account__r.Id &amp; $User.Id &amp; Account__r.Owner.ID');
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed`,
      `${placeIn(text, 'Account__r', 2)} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed`,
      `${placeIn(text, 'Owner')} reads CustomField:account.ownerid [Owner] external confirmed`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('gives no reference for Id in a path that is written in XML either', () => {
    const source = billing();
    source.field(
      'Invoice__c',
      'Approver__c',
      '<lookupFilter>',
      '    <filterItems><field>User.ManagerId</field><valueField>$User.Id</valueField></filterItems>',
      '    <filterItems><field>User.Id</field><valueField>$Source.Account__r.OwnerId</valueField></filterItems>',
      '</lookupFilter>',
      '<referenceTo>User</referenceTo>',
      '<type>Lookup</type>',
    );
    const analysis = source.analyse();
    expect(
      referencesOf(analysis, key('CustomField', 'Invoice__c.Approver__c')).map(
        (one) => `${one.kind} ${String(one.to)} ${viaOf(one)}`,
      ),
    ).toEqual([
      'references CustomObject:user lookup',
      'reads CustomField:user.managerid filter',
      'reads CustomField:invoice__c.account__c filter',
      'reads CustomField:account.ownerid filter',
    ]);
  });

  it('keeps the value a picklist is compared with, on the field at the end of the path only', () => {
    const { analysis } = withFormula(
      'IF(ISPICKVAL(Status__c, "Paid"), 1, 0) + IF(ISPICKVAL(Account__r.Tier__c, \'Gold\'), 1, 0)' +
        ' + IF(ISPICKVAL(PRIORVALUE(Status__c), "Void"), 1, 0) + IF(INCLUDES(Gone__c, "A;B"), 1, 0)',
    );
    expect(referencesOf(analysis).map((one) => `${String(one.to)} ${JSON.stringify(one.attrs)}`)).toEqual([
      'CustomField:invoice__c.status__c {"via":"formula","value":"Paid"}',
      'CustomField:invoice__c.account__c {"via":"formula"}',
      'CustomField:account.tier__c {"via":"formula","value":"Gold"}',
      'CustomField:invoice__c.status__c {"via":"formula","value":"Void"}',
      // A field that is not found says which object it was looked for on, and keeps the value.
      'null {"via":"formula","value":"A;B","object":"Invoice__c"}',
    ]);
    expect(referencesOf(analysis).map(valueOf)).toEqual(['Paid', null, 'Gold', 'Void', 'A;B']);
  });

  it('is unresolved when it is custom and nothing defines it, and external with the prefix of a package', () => {
    const { analysis, text } = withFormula(
      'Gone__c + ns__Score__c + Account__r.Gone__c + Account__r.ns__Rating__c + Gone__r.Name + Nmae',
    );
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Gone__c')} reads null [Gone__c] unresolved confirmed`,
      `${placeIn(text, 'ns__Score__c')} reads CustomField:invoice__c.ns__score__c [ns__Score__c] external confirmed`,
      `${placeIn(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed`,
      `${placeIn(text, 'Gone__c', 2)} reads null [Gone__c] unresolved confirmed`,
      `${placeIn(text, 'Account__r', 2)} reads CustomField:invoice__c.account__c [Account__r] resolved confirmed`,
      `${placeIn(text, 'ns__Rating__c')} reads CustomField:account.ns__rating__c [ns__Rating__c] external confirmed`,
      `${placeIn(text, 'Gone__r')} reads null [Gone__r] unresolved confirmed`,
      // A typing error in the name of a standard field is not found: any standard name is taken as one.
      `${placeIn(text, 'Nmae')} reads CustomField:invoice__c.nmae [Nmae] external confirmed`,
    ]);
    expect(
      referencesOf(analysis)
        .filter((one) => one.to === null)
        .map((one) => one.attrs),
    ).toEqual([
      { via: 'formula', object: 'Invoice__c' },
      { via: 'formula', object: 'Account' },
      { via: 'formula', object: 'Invoice__c' },
    ]);
    // What stands behind a relationship that leads nowhere is not followed, and an issue says so.
    expect(analysis.issues).toEqual([
      {
        severity: 'warning',
        code: 'PATH_NOT_FOLLOWED',
        message: `objects/Invoice__c/fields/Probe__c.field-meta.xml, line 4: it is not known which object "Gone__r" leads to, so "Name" after it was not followed.`,
        componentKey: probe,
        details: {
          path: 'objects/Invoice__c/fields/Probe__c.field-meta.xml',
          line: 4,
          column: Number(placeIn(text, 'Gone__r').split(':')[1]),
          relationship: 'Gone__r',
          notFollowed: ['Name'],
          endsAt: 'field',
          origin: 'parser:formula',
        },
      },
    ]);
  });
});

describe('a global variable in a formula', () => {
  /** A source with a label, a permission, a custom setting, a custom metadata type and one record of it. */
  function withGlobals(): Source {
    const source = billing();
    const add = (type: string, fullName: string, path: string): void => {
      source.listed.push({ type, fullName, files: [source.file(path, `<${type}/>`)] });
    };
    add('CustomLabel', 'Overdue', 'labels/Overdue.label-meta.xml');
    add('CustomPermission', 'Approve', 'customPermissions/Approve.customPermission-meta.xml');
    add('CustomMetadata', 'Rule.Standard', 'customMetadata/Rule.Standard.md-meta.xml');
    source.object('Rule__mdt');
    source.field('Rule__mdt', 'Limit__c', '<type>Number</type>');
    source.object('Settings__c', '<customSettingsType>Hierarchy</customSettingsType>');
    source.field('Settings__c', 'Days__c', '<type>Number</type>');
    source.object('Tax_Code__c');
    source.field('Tax_Code__c', 'Rate__c', '<type>Percent</type>');
    return source;
  }

  it('is a reference to the label, the permission and the record of a custom metadata type it names', () => {
    const { analysis, text } = withFormula(
      'IF($Permission.Approve, $Label.Overdue, TEXT($CustomMetadata.Rule__mdt.Standard.Limit__c))',
      withGlobals(),
    );
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Approve')} references CustomPermission:approve [Approve] resolved confirmed`,
      `${placeIn(text, 'Overdue')} references CustomLabel:overdue [Overdue] resolved confirmed`,
      // The record, and the field of its type. The type itself is no reference.
      `${placeIn(text, 'Standard')} references CustomMetadata:rule.standard [Standard] resolved confirmed`,
      `${placeIn(text, 'Limit__c')} reads CustomField:rule__mdt.limit__c [Limit__c] resolved confirmed`,
    ]);
    expect(referencesOf(analysis).map((one) => one.attrs)).toEqual(
      Array.from({ length: 4 }, () => ({ via: 'formula' })),
    );
    expect(analysis.issues).toEqual([]);
  });

  it('is a read of the field it names: of a custom setting, of the user, of a record type, of an object', () => {
    const { analysis, text } = withFormula(
      '$Setup.Settings__c.Days__c + VLOOKUP($ObjectType.Tax_Code__c.Fields.Rate__c, $ObjectType.Tax_Code__c.Fields.Name, "DE")' +
        ' &amp; $User.Manager.Email &amp; $Profile.Name &amp; $UserRole.Name &amp; $Organization.Country &amp; $RecordType.DeveloperName',
      withGlobals(),
    );
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Days__c')} reads CustomField:settings__c.days__c [Days__c] resolved confirmed`,
      `${placeIn(text, 'Rate__c')} reads CustomField:tax_code__c.rate__c [Rate__c] resolved confirmed`,
      `${placeIn(text, 'Name')} reads CustomField:tax_code__c.name [Name] external confirmed`,
      `${placeIn(text, 'Manager')} reads CustomField:user.managerid [Manager] external confirmed`,
      `${placeIn(text, 'Email')} reads CustomField:user.email [Email] external confirmed`,
      `${placeIn(text, 'Name', 2)} reads CustomField:profile.name [Name] external confirmed`,
      `${placeIn(text, 'Name', 3)} reads CustomField:userrole.name [Name] external confirmed`,
      `${placeIn(text, 'Country')} reads CustomField:organization.country [Country] external confirmed`,
      `${placeIn(text, 'DeveloperName')} reads CustomField:recordtype.developername [DeveloperName] external confirmed`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('is a reference to the object when $ObjectType names no field', () => {
    const { analysis, text } = withFormula('f($ObjectType.Tax_Code__c) &amp; f($ObjectType.Gone__c)', withGlobals());
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Tax_Code__c')} references CustomObject:tax_code__c [Tax_Code__c] resolved confirmed`,
      `${placeIn(text, 'Gone__c')} references null [Gone__c] unresolved confirmed`,
    ]);
  });

  it('is unresolved without a key when nothing defines what it names, and external with the prefix of a package', () => {
    const { analysis } = withFormula(
      '$Label.Gone &amp; $Label.ns__Notice &amp; TEXT($Permission.Gone) &amp; TEXT($CustomMetadata.Rule__mdt.Gone.Limit__c)' +
        ' &amp; TEXT($Setup.Gone__c.Days__c) &amp; TEXT($Setup.Settings__c.Gone__c) &amp; TEXT($CustomMetadata.ns__Rule__mdt.Std.ns__Limit__c)',
      withGlobals(),
    );
    expect(
      referencesOf(analysis).map(
        (one) =>
          `${one.kind} ${one.toType} ${String(one.to)} [${one.toNameRaw}] ${one.resolution} ${JSON.stringify(one.attrs)}`,
      ),
    ).toEqual([
      'references CustomLabel null [Gone] unresolved {"via":"formula"}',
      'references CustomLabel CustomLabel:ns__notice [ns__Notice] external {"via":"formula"}',
      'references CustomPermission null [Gone] unresolved {"via":"formula"}',
      'references CustomMetadata null [Gone] unresolved {"via":"formula"}',
      'reads CustomField CustomField:rule__mdt.limit__c [Limit__c] resolved {"via":"formula"}',
      'reads CustomField null [Days__c] unresolved {"via":"formula","object":"Gone__c"}',
      'reads CustomField null [Gone__c] unresolved {"via":"formula","object":"Settings__c"}',
      'references CustomMetadata CustomMetadata:ns__rule.std [Std] external {"via":"formula"}',
      'reads CustomField CustomField:ns__rule__mdt.ns__limit__c [ns__Limit__c] external {"via":"formula"}',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('gives no reference and no issue when it names nothing that can change', () => {
    const { analysis } = withFormula('$Api.Session_ID &amp; TEXT($System.OriginDateTime)');
    expect(referencesOf(analysis)).toEqual([]);
    expect(analysis.issues).toEqual([]);
  });

  it('is not read when this reader does not know it, which an issue says, and the rest of the formula is', () => {
    const { analysis, file, text } = withFormula('IF(Amount__c &gt; 0, $Action.Account.View, $Label)');
    expect(referencesOf(analysis).map(line)).toEqual([
      `${placeIn(text, 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved confirmed`,
    ]);
    const column = (word: string): number => Number(placeIn(text, word).split(':')[1]);
    expect(analysis.issues).toEqual([
      {
        severity: 'warning',
        code: 'NAME_NOT_READ',
        message: `${file}, line 4: the formula in "formula" holds "$Action.Account.View", which is not read as a name.`,
        componentKey: probe,
        // The place of the variable: the word after the dollar sign, less one.
        details: { path: file, line: 4, column: column('Action') - 1, element: 'formula' },
      },
      {
        severity: 'warning',
        code: 'NAME_NOT_READ',
        message: `${file}, line 4: the formula in "formula" holds "$Label", which is not read as a name.`,
        componentKey: probe,
        details: { path: file, line: 4, column: column('Label') - 1, element: 'formula' },
      },
    ]);
    // The formula itself was read: the file is not among those with a formula that was not.
    expect(analysis.work[1]).toEqual({ origin: 'parser:formula', components: 1, failedFiles: 0 });
  });

  it('shows at most 60 characters of a name it does not read', () => {
    const long = `$Action.${'x'.repeat(80)}`;
    const { analysis, file } = withFormula(long);
    expect(analysis.issues.map((issue) => issue.message)).toEqual([
      `${file}, line 4: the formula in "formula" holds "${long.slice(0, 60)}", which is not read as a name.`,
    ]);
  });
});

describe('a formula that is not read as a whole', () => {
  it('gives an issue with the place it stopped at, and the names among its tokens as probable', () => {
    const source = billing();
    const file = source.rule(
      'Invoice__c',
      'Broken',
      '<active>true</active>',
      '<errorConditionFormula>AND(',
      '  Amount__c &gt; 0,',
      '  ISPICKVAL(Status__c, "Paid"),',
      '  $Label.Gone = "x" +* Account__r.Tier__c',
      ')</errorConditionFormula>',
      '<errorDisplayField>Amount__c</errorDisplayField>',
    );
    const analysis = source.analyse();
    const text = Buffer.from(source.files.get(file) ?? []).toString('utf8');
    const rule = key('ValidationRule', 'Invoice__c.Broken');
    expect(
      referencesOf(analysis, rule).map((one) => `${line(one)} ${one.origin} ${JSON.stringify(one.attrs)}`),
    ).toEqual([
      // What is written in XML is as certain as in any other file.
      `${placeIn(text, 'Amount__c', 2)} references CustomField:invoice__c.amount__c [Amount__c] resolved confirmed parser:xml {"via":"display-field"}`,
      `${placeIn(text, 'Amount__c')} reads CustomField:invoice__c.amount__c [Amount__c] resolved probable parser:formula {"via":"formula"}`,
      // Without a tree, the value a picklist is compared with is not known.
      `${placeIn(text, 'Status__c')} reads CustomField:invoice__c.status__c [Status__c] resolved probable parser:formula {"via":"formula"}`,
      `${placeIn(text, 'Gone')} references null [Gone] unresolved probable parser:formula {"via":"formula"}`,
      `${placeIn(text, 'Account__r')} reads CustomField:invoice__c.account__c [Account__r] resolved probable parser:formula {"via":"formula"}`,
      `${placeIn(text, 'Tier__c')} reads CustomField:account.tier__c [Tier__c] resolved probable parser:formula {"via":"formula"}`,
    ]);
    const [, stopLine = '', stopColumn = ''] = /^(\d+):(\d+)$/.exec(placeIn(text, '+* Account__r'.slice(0, 1))) ?? [];
    expect(stopLine).toBe('8');
    expect(analysis.issues).toEqual([
      {
        severity: 'warning',
        code: 'FORMULA_NOT_READ',
        message: `${file}, line 8: the formula in "errorConditionFormula" was not read as a whole. "*" stands where a value is expected. The names in it are recorded as probable.`,
        componentKey: rule,
        // The star stands directly behind the plus sign.
        details: { path: file, line: 8, column: Number(stopColumn) + 1, element: 'errorConditionFormula' },
      },
    ]);
    expect(analysis.work).toEqual([
      { origin: 'parser:xml', components: 8, failedFiles: 0 },
      { origin: 'parser:formula', components: 1, failedFiles: 1 },
      { origin: 'parser:flow', components: 0, failedFiles: 0 },
    ]);
  });

  it('is counted once as a file, however many formulas of it are not read', () => {
    const source = billing();
    source.field('Invoice__c', 'Twice__c', '<formula>Amount__c +</formula>', '<defaultValue>(Amount__c</defaultValue>');
    source.object(
      'Order__c',
      '<fields><fullName>A__c</fullName><formula>1 +</formula></fields>',
      '<fields><fullName>B__c</fullName><formula>2 +</formula></fields>',
      '<fields><fullName>C__c</fullName><formula>3</formula></fields>',
    );
    const analysis = source.analyse();
    expect(codes(analysis.issues)).toEqual(Array.from({ length: 4 }, () => 'warning FORMULA_NOT_READ'));
    // Four components with a formula in two files.
    expect(analysis.work[1]).toEqual({ origin: 'parser:formula', components: 4, failedFiles: 2 });
    expect(analysis.issues.map((issue) => issue.details?.['element'])).toEqual([
      'formula',
      'defaultValue',
      'formula',
      'formula',
    ]);
  });

  it('says where a formula ends too early: behind its last character, also at the end of a line', () => {
    const source = billing();
    const file = source.field('Invoice__c', 'Open__c', '<formula>IF(Amount__c &gt; 0,', '  1</formula>');
    const analysis = source.analyse();
    expect(analysis.issues).toEqual([
      {
        severity: 'warning',
        code: 'FORMULA_NOT_READ',
        message: `${file}, line 5: the formula in "formula" was not read as a whole. The formula ends where a comma or a closing bracket is expected. The names in it are recorded as probable.`,
        componentKey: key('CustomField', 'Invoice__c.Open__c'),
        // Four spaces before the line, two in it, and the digit: the end tag starts at column 8.
        details: { path: file, line: 5, column: 8, element: 'formula' },
      },
    ]);
  });
});

describe('a formula that a stranger wrote', () => {
  it('costs nothing but itself when it holds a name that every object of JavaScript has', () => {
    const source = billing();
    source.field(
      'Invoice__c',
      'Probe__c',
      '<defaultValue>Owner:Queue.Constructor &amp; Owner:constructor.Name &amp; constructor.toString</defaultValue>',
      '<referenceTo>Account</referenceTo>',
      '<type>Lookup</type>',
    );
    const analysis = source.analyse();
    expect(
      referencesOf(analysis).map((one) => `${one.kind} ${String(one.to)} [${one.toNameRaw}] ${viaOf(one)}`),
    ).toEqual([
      'references CustomObject:account [Account] lookup',
      'reads CustomField:invoice__c.ownerid [Owner] formula',
      'reads CustomField:group.constructor [Constructor] formula',
      'reads CustomField:invoice__c.ownerid [Owner] formula',
      'reads CustomField:constructor.name [Name] formula',
      'reads CustomField:invoice__c.constructorid [constructor] formula',
    ]);
    // Nothing fails. Where a relationship that is named `constructor` leads is not known, as for any such name.
    expect(codes(analysis.issues)).toEqual(['warning PATH_NOT_FOLLOWED']);
    expect(analysis.components.find((one) => one.key === probe)?.attrs).toMatchObject({ type: 'Lookup' });
  });

  it('is read when it names a field more often than a call of JavaScript takes arguments', () => {
    const names = 150_000;
    const { analysis } = withFormula(`${'Amount__c+'.repeat(names)}1`);
    expect(analysis.issues).toEqual([]);
    expect(referencesOf(analysis)).toHaveLength(names);
  }, 60_000);

  it('gets an issue of a bounded length for a path of any length that is not followed', () => {
    const { analysis, file } = withFormula(`Gone__r${'.Parent'.repeat(5000)}.Name`);
    const twenty = Array.from({ length: 20 }, () => 'Parent');
    expect(analysis.issues).toHaveLength(1);
    // The first twenty names that were not followed are kept and shown.
    expect(analysis.issues[0]?.message).toBe(
      `${file}, line 4: it is not known which object "Gone__r" leads to, so "${twenty.join('.')}" after it was not followed.`,
    );
    expect(analysis.issues[0]?.details).toMatchObject({ relationship: 'Gone__r', notFollowed: twenty });

    // Of long names, 60 characters of the relationship and 200 of what stands after it are shown.
    const relationship = `${'G'.repeat(100)}__r`;
    const long = withFormula(`${relationship}${`.${'P'.repeat(50)}`.repeat(30)}`);
    expect(long.analysis.issues.map((issue) => issue.message)).toEqual([
      `${long.file}, line 4: it is not known which object "${'G'.repeat(60)}" leads to, so "${`${'P'.repeat(50)}.`.repeat(4).slice(0, 200)}" after it was not followed.`,
    ]);
    expect(long.analysis.issues[0]?.details).toMatchObject({ relationship });
  });

  it('never costs its component the analysis, whatever it holds', () => {
    const pieces = fc.constantFrom(
      ...['Amount__c', 'Account__r.Tier__c', 'Owner:Queue.QueueName', 'Owner:User.', 'constructor', '$User.Id'],
      ...['$Label.Gone', '$CustomMetadata.Rule__mdt.Std.Limit__c', '$ObjectType.Account', '$Setup.', '$Action.X'],
      ...['IF', 'ISPICKVAL', 'PRIORVALUE', 'NOT', 'TRUE', '1', '.5', '"t"', "'t'", '"', '/*', '*/', '\\'],
      ...['(', ')', ',', '+', '*', '=', '&amp;&amp;', '&amp;', '&lt;', '&gt;', '!', ' ', '\n', '.', ':', '#', '@', '['],
    );
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 25 }), (parts) => {
        const source = billing();
        source.field('Invoice__c', 'Probe__c', `<formula>${parts.join('')}</formula>`, '<type>Text</type>');
        source.rule('Invoice__c', 'Rule', `<errorConditionFormula>${parts.join('')}</errorConditionFormula>`);
        const analysis = source.analyse();
        const allowed = ['warning FORMULA_NOT_READ', 'warning NAME_NOT_READ', 'warning PATH_NOT_FOLLOWED'];
        expect(codes(analysis.issues).filter((code) => !allowed.includes(code))).toEqual([]);
        // The field keeps its analysis: its type is known.
        expect(analysis.components.find((one) => one.key === probe)?.attrs).toMatchObject({ type: 'Text' });
        for (const one of referencesOf(analysis)) expect(one.origin).toBe('parser:formula');
      }),
      { seed: 20261116, numRuns: 500 },
    );
  });

  it('is not counted when its file could not be read, or was refused', () => {
    const source = billing();
    source.fieldFile('Invoice__c', 'Refused__c', '<CustomField><formula>Amount__c</formula>');
    source.broken.add(source.field('Invoice__c', 'Unreadable__c', '<formula>Amount__c</formula>'));
    source.field('Invoice__c', 'Read__c', '<formula>Amount__c</formula>');
    const analysis = source.analyse();
    expect(codes(analysis.issues).sort()).toEqual(['error FILE_UNREADABLE', 'error XML_MALFORMED']);
    // Two objects and six fields were read, and one of them holds a formula.
    expect(analysis.work).toEqual([
      { origin: 'parser:xml', components: 8, failedFiles: 2 },
      { origin: 'parser:formula', components: 1, failedFiles: 0 },
      { origin: 'parser:flow', components: 0, failedFiles: 0 },
    ]);
  });
});

describe('the formulas that cannot be deployed, laid over the fixture project', () => {
  interface Place {
    readonly line: number;
    readonly match: string;
    readonly nth?: number;
  }
  interface Expected {
    readonly file: string;
    readonly from: string;
    readonly parses: boolean;
    readonly refs?: readonly (Place & { kind: string; to: string; tier?: string })[];
    readonly unresolved?: readonly Place[];
    readonly external?: readonly Place[];
    readonly negatives?: readonly (Place & { not: string })[];
  }
  const dir = join(FIXTURES_DIR, 'formula-negative');
  const expected = (parse(readFileSync(join(dir, 'expected.yaml'), 'utf8')) as { files: Expected[] }).files;
  const inProject = (file: string): string => `force-app/main/default/${file}`;
  let analysis: SourceAnalysis;
  let alone: SourceAnalysis;

  beforeAll(async () => {
    const project = readFolders(join(FIXTURES_DIR, loadAnswerKey().project), ['force-app']).tree;
    const extra = readFolders(dir, ['objects']).tree;
    const laid = new Map(extra.files.map((path) => [inProject(path), path]));
    const tree: SourceTree = {
      files: [...project.files, ...laid.keys()].sort(),
      read: (path) => {
        const from = laid.get(path);
        return from === undefined ? project.read(path) : extra.read(from);
      },
    };
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    alone = analyseSource(project, (await resolveComponents(project, ['force-app'])).components);
  });

  /** The place of an entry of `expected.yaml` in its file, as `line:column`. */
  const placeOf = (file: string, place: Place): string => {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    return `${String(place.line)}:${String(columnOf(lines[place.line - 1] ?? '', place.match, place.nth ?? 1))}`;
  };

  it('gives each of the ten files a component, and leaves the analysis of the project as it was', () => {
    expect(expected).toHaveLength(10);
    expect(analysis.components).toHaveLength(alone.components.length + 10);
    const added = new Set(expected.map((entry) => entry.from));
    expect(analysis.components.filter((one) => !added.has(one.key))).toEqual(alone.components);
    expect(analysis.components.filter((one) => added.has(one.key)).map((one) => one.definition?.path)).toEqual(
      [...expected].sort((a, b) => (a.from < b.from ? -1 : 1)).map((entry) => inProject(entry.file)),
    );
  });

  it('finds what each file is expected to hold, with the tier of the file, and nothing else', () => {
    for (const entry of expected) {
      const found = referencesOf(analysis, entry.from).map((one) => {
        const place = `${String(one.location?.line)}:${String(one.location?.column)}`;
        return one.resolution === 'resolved'
          ? `${place} ${one.kind} ${String(one.to)} ${one.confidence}`
          : `${place} ${one.resolution} [${one.toNameRaw}]${one.to === null ? '' : ' with a key'}`;
      });
      const wanted = [
        ...(entry.refs ?? []).map(
          (ref) => `${placeOf(entry.file, ref)} ${ref.kind} ${ref.to} ${ref.tier ?? 'confirmed'}`,
        ),
        // A name that nothing defines has no key. A name of a package has one.
        ...(entry.unresolved ?? []).map((one) => `${placeOf(entry.file, one)} unresolved [${one.match}]`),
        ...(entry.external ?? []).map((one) => `${placeOf(entry.file, one)} external [${one.match}] with a key`),
      ];
      expect(found.sort(), entry.file).toEqual(wanted.sort());
      for (const one of referencesOf(analysis, entry.from)) {
        expect(one, entry.file).toMatchObject({ origin: 'parser:formula', attrs: { via: 'formula' } });
        expect(one.location?.file, entry.file).toBe(inProject(entry.file));
      }
    }
  });

  it('reports no reference where a file forbids one', () => {
    for (const entry of expected) {
      for (const negative of entry.negatives ?? []) {
        const hit = referencesOf(analysis, entry.from).filter(
          (one) => one.location?.line === negative.line && one.to === negative.not,
        );
        expect(hit, entry.file).toEqual([]);
      }
    }
  });

  it('says of each formula that does not parse that it was not read, and of no other', () => {
    const notRead = analysis.issues.filter((issue) => issue.code === 'FORMULA_NOT_READ');
    expect(notRead.map((issue) => issue.componentKey).sort()).toEqual(
      expected
        .filter((entry) => !entry.parses)
        .map((entry) => entry.from)
        .sort(),
    );
    // What each of them says after its file and its line.
    const said = notRead.map((issue) => issue.message.replace(/^.*\/([^/,]+), line (\d+): /, '$1, line $2: '));
    const whole = (file: string, at: number, element: string, problem: string): string =>
      `${file}, line ${String(at)}: the formula in "${element}" was not read as a whole. ${problem} The names in it are recorded as probable.`;
    expect(said).toEqual([
      whole(
        'Bad_Open_Call__c.field-meta.xml',
        4,
        'formula',
        'The formula ends where a comma or a closing bracket is expected.',
      ),
      whole('Bad_Open_Comment__c.field-meta.xml', 4, 'formula', 'A comment is not closed.'),
      whole('Bad_Open_Text__c.field-meta.xml', 4, 'formula', 'A text is not closed.'),
      whole('Bad_Two_Operators__c.field-meta.xml', 4, 'formula', '"*" stands where a value is expected.'),
      whole(
        'Bad_Extra_Bracket.validationRule-meta.xml',
        8,
        'errorConditionFormula',
        '")" stands where an operator or the end of the formula is expected.',
      ),
    ]);
    // One more issue: the relationship that the object does not have. The project has one issue of its own,
    // in a flow.
    const others = analysis.issues.filter((issue) => issue.code !== 'FORMULA_NOT_READ');
    expect(others.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)}`).sort()).toEqual([
      'warning PATH_NOT_FOLLOWED CustomField:invoice__c.missing_relationship__c',
      'warning PATH_NOT_FOLLOWED Flow:invoice_after_save#element:check_result',
    ]);
    // Ten more components were read, and each holds a formula. Five files hold one that was not read. The
    // flows of the project are counted as they are without the ten.
    expect(analysis.work).toEqual([
      { origin: 'parser:xml', components: 108, failedFiles: 0 },
      { origin: 'parser:formula', components: 57, failedFiles: 5 },
      alone.work[2],
    ]);
  });
});
