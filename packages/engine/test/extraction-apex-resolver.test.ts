/**
 * What the code of Apex refers to (decision record 0087): fields of records, also through relationships, the
 * variables and properties of classes, tokens and DML, checked against the files and the descriptions.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second runs on small classes
 * that are written here, for what the fixture does not have.
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reference } from '../src/core/references.ts';
import type { AnalysisIssue } from '../src/extraction/analysed.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import type { ApexReader } from '../src/extraction/apex-syntax.ts';
import type { ObjectDescription } from '../src/sources/describe.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey, ofMetadata, tierInRepository as repositoryTier } from './helpers/answer-key.ts';
import { ApexSource, viaOf } from './helpers/written-source.ts';

/** The ways of naming a target that this part of the resolver reads. */
const VIAS: ReadonlySet<string> = new Set(['field', 'token', 'dml', 'soql', 'sosl', 'call', 'new']);
/** The way of naming a target in a text (decision record 0090). */
const TEXT: ReadonlySet<string> = new Set(['text']);
const isApexFile = (file: string): boolean => /\.(?:cls|trigger)$/.test(file);
const isApex = (key: string): boolean => key.startsWith('ApexClass:') || key.startsWith('ApexTrigger:');

const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  const op = reference.attrs?.['op'];
  return `${reference.from} ${file}:${String(line)}:${String(column)}:${reference.kind}:${String(reference.to)} ${viaOf(reference)} ${reference.confidence}${typeof op === 'string' ? ` ${op}` : ''}`;
};

let reader: ApexReader;
beforeAll(async () => {
  reader = await loadApexReader();
});

describe('the code of the Apex of the fixture project', () => {
  const answers = loadAnswerKey();
  /** The tier of the key as an analysis of a repository gives it: a field of Salesforce is checked by nothing. */
  const tierInRepository = repositoryTier(answers);
  const keyed = answers.references.filter((one) => isApexFile(one.file) && VIAS.has(one.via));
  const idOfKeyed = (one: (typeof keyed)[number]): string =>
    `${one.from} ${one.id} ${one.via} ${tierInRepository(one)}${one.op === undefined ? '' : ` ${one.op}`}`;
  let analysis: SourceAnalysis;
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components, { apex: reader });
    references = analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) => one.references)
      .filter((one) => VIAS.has(viaOf(one)));
  });

  it('gives every reference of the key of a field, a variable, a token, DML, a query and a call, at its place, and no other', () => {
    expect(keyed).toHaveLength(340);
    expect(keyed.filter((one) => one.stretch)).toEqual([]);
    const found = references.map(idOf).sort();
    expect(keyed.map(idOfKeyed).filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(keyed.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
  });

  it('gives every reference of the key of a name in a text, at its place and tier, and no other', () => {
    const texts = answers.references.filter((one) => isApexFile(one.file) && one.via === 'text');
    const found = analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) => one.references)
      .filter((one) => viaOf(one) === 'text')
      .map(idOf)
      .sort();
    const wanted = texts.filter((one) => !one.stretch).map(idOfKeyed);
    expect(wanted).toHaveLength(50);
    // Of them, the names that a record of custom metadata and a field set hold (decision record 0092).
    expect(texts.filter((one) => !one.stretch && ofMetadata(one))).toHaveLength(7);
    expect(wanted.filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(texts.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
    // Of what the key calls a stretch, the analysis finds the object of a query whose fields are a list, which it does
    // not follow, a list constant of another class and a list that the code fills in, and a field of the map of fields
    // of an object that reaches the line through two variables.
    expect(texts.filter((one) => one.stretch && found.includes(idOfKeyed(one))).map(idOfKeyed)).toEqual([
      'ApexClass:invoiceselector#method:summaries() force-app/main/default/classes/InvoiceSelector.cls:19:43:reads:CustomObject:invoice__c text possible',
      'ApexClass:dynamicaccess#method:statusdescribe() force-app/main/default/classes/DynamicAccess.cls:45:44:references:CustomField:invoice__c.status__c text probable',
      'ApexClass:invoicequeries#method:matching(string,string) force-app/main/default/classes/InvoiceQueries.cls:20:72:reads:CustomObject:invoice__c text possible',
    ]);
    expect(new Set(found).size).toBe(found.length);
  });

  it('reports none of them where the key forbids a reference', () => {
    const forbidden = answers.negatives.filter((one) => isApexFile(one.file));
    expect(forbidden.length).toBeGreaterThan(20);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
  });

  it('warns at each place of Apex that the key does not know, and nowhere else', () => {
    const unknown = answers.unknowns.filter((one) => isApexFile(one.file));
    const warned = analysis.issues.filter((one) => one.componentKey !== null && isApex(one.componentKey));
    const placeOf = (one: AnalysisIssue): string => {
      const { path, line, column } = one.details as { path: string; line: number; column: number };
      return `${path}:${String(line)}:${String(column)}`;
    };
    expect(warned.map(placeOf).sort()).toEqual(
      unknown.map((one) => `${one.file}:${String(one.line)}:${String(one.column)}`).sort(),
    );
    const classes = 'force-app/main/default/classes';
    const at = (file: string, line: number, column: number): Record<string, unknown> => ({
      path: `${classes}/${file}`,
      line,
      column,
    });
    expect(warned.map((one) => [one.componentKey, one.code, one.details])).toEqual([
      // A name of a field read on a record of no known object.
      [
        'ApexClass:dynamicaccess#method:fieldof(sobject)',
        'PATH_NOT_FOLLOWED',
        {
          ...at('DynamicAccess.cls', 10, 28),
          notFollowed: ['Risk_Score__c'],
          endsAt: 'field',
          origin: 'parser:apex',
          via: 'text',
        },
      ],
      // A field the caller names, of a record of no known object: it can be any field.
      [
        'ApexClass:dynamicaccess#method:copyfield(sobject,sobject,string)',
        'PATH_NOT_FOLLOWED',
        { ...at('DynamicAccess.cls', 26, 35), notFollowed: [], origin: 'parser:apex', via: 'text' },
      ],
      [
        'ApexClass:dynamicaccess#method:copyfield(sobject,sobject,string)',
        'PATH_NOT_FOLLOWED',
        { ...at('DynamicAccess.cls', 27, 20), notFollowed: [], origin: 'parser:apex', via: 'text' },
      ],
      // DML on a list of `SObject`.
      [
        'ApexClass:invoiceevents#method:saveall(list<sobject>)',
        'PATH_NOT_FOLLOWED',
        { ...at('InvoiceEvents.cls', 7, 9), op: 'update', notFollowed: [], endsAt: 'object', origin: 'parser:apex' },
      ],
      // An object the caller names.
      [
        'ApexClass:invoiceevents#method:describebyname(string)',
        'PATH_NOT_FOLLOWED',
        { ...at('InvoiceEvents.cls', 40, 47), notFollowed: [], endsAt: 'object', origin: 'parser:apex', via: 'text' },
      ],
      // A class the caller names.
      [
        'ApexClass:invoicenotifications#method:byname(string)',
        'PATH_NOT_FOLLOWED',
        { ...at('InvoiceNotifications.cls', 27, 47), notFollowed: [], origin: 'parser:apex', via: 'text' },
      ],
      // A query of an object and a field that the caller names: each where it enters the text.
      [
        'ApexClass:invoiceselector#method:anyobject(string,string)',
        'PATH_NOT_FOLLOWED',
        { ...at('InvoiceSelector.cls', 28, 66), notFollowed: [], endsAt: 'object', origin: 'parser:apex', via: 'text' },
      ],
      [
        'ApexClass:invoiceselector#method:anyobject(string,string)',
        'PATH_NOT_FOLLOWED',
        { ...at('InvoiceSelector.cls', 28, 43), notFollowed: [], origin: 'parser:apex', via: 'text' },
      ],
    ]);
  });
});

describe('the resolver of Apex', () => {
  const lookup = (to: string, relationship: string): string[] => [
    `<referenceTo>${to}</referenceTo>`,
    `<relationshipName>${relationship}</relationshipName>`,
    '<type>Lookup</type>',
  ];
  /**
   * The analysis of a source of classes and triggers, with the object `Invoice__c`, its fields `Amount__c` and
   * `Status__c`, and its lookup `Account__c` to the account, whose child relationship is `Invoices__r`.
   */
  const analysed = (
    write: (source: ApexSource) => void,
    descriptions?: readonly ObjectDescription[],
  ): SourceAnalysis => {
    const source = new ApexSource();
    source.object('Invoice__c', '<label>Invoice</label>');
    source.field('Invoice__c', 'Amount__c', '<type>Currency</type>');
    source.field('Invoice__c', 'Status__c', '<type>Picklist</type>');
    source.field('Invoice__c', 'Account__c', ...lookup('Account', 'Invoices'));
    write(source);
    return analyseSource(source.tree, source.listed, {
      apex: reader,
      ...(descriptions === undefined ? {} : { descriptions }),
    });
  };
  const code = (...lines: string[]): string => [...lines, ''].join('\n');
  /**
   * What the members refer to beyond the types they use, by the ways of `vias`: `line:column kind target [name] via
   * tier resolution`. A class a text names is used as a type.
   */
  const said = (analysis: SourceAnalysis, vias: ReadonlySet<string> = VIAS): string[] =>
    analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) => one.references)
      .filter((one) => vias.has(viaOf(one)) && (one.kind !== 'uses-type' || viaOf(one) === 'text'))
      .map((one) => {
        const op = one.attrs?.['op'];
        const object = one.attrs?.['object'];
        return [
          `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} [${one.toNameRaw}]`,
          `${viaOf(one)} ${one.confidence} ${one.resolution}`,
          ...(typeof op === 'string' ? [op] : []),
          ...(typeof object === 'string' ? [`of ${object}`] : []),
        ].join(' ');
      });
  /** The warnings as `CODE line:column` with their details but the place. */
  const warned = (issues: readonly AnalysisIssue[]): string[] =>
    issues.map((one) => {
      const { path, line, column, ...rest } = one.details ?? {};
      expect(one.severity).toBe('warning');
      expect(typeof path).toBe('string');
      return `${one.code} ${JSON.stringify(line)}:${JSON.stringify(column)} ${JSON.stringify(rest)}`;
    });

  it('reads and writes a field of a record, also through a relationship, with the tier of what checks it', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Fields',
        code(
          'public class Fields {',
          '    void m(Invoice__c inv, Contact c, Account acc) {',
          '        Decimal a = inv.Amount__c;',
          '        inv.Amount__c = 2;',
          '        inv.Amount__c += 1;',
          '        String n = inv.Account__r.Name;',
          '        String m = inv.Missing__c;',
          '        Id parent = c.AccountId;',
          '        String o = c.Account.Industry;',
          '        String p = inv.Owner.Name;',
          '        Id i = inv.Id;',
          '        Integer j = acc.Contacts.size();',
          '        String q = acc.Industry;',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '3:25 reads CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '4:13 writes CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '5:13 reads CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '5:13 writes CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '6:24 reads CustomField:invoice__c.account__c [Account__r] field confirmed resolved',
      // A field that no file defines is `probable`: in a repository nothing checks it (decision record 0087).
      '6:35 reads CustomField:account.name [Name] field probable external',
      '7:24 reads null [Missing__c] field probable unresolved of Invoice__c',
      // Also one that the short lists name, which says only that it is a field and not a child relationship.
      '8:23 reads CustomField:contact.accountid [AccountId] field probable external',
      '9:22 reads CustomField:contact.accountid [Account] field probable external',
      '9:30 reads CustomField:account.industry [Industry] field probable external',
      // `Owner` is the field `OwnerId` of every object, and leads to a user.
      '10:24 reads CustomField:invoice__c.ownerid [Owner] field probable external',
      '10:30 reads CustomField:user.name [Name] field probable external',
      // The field `Id` gives nothing. A child relationship refers to the lookup field behind it.
      '12:25 references CustomField:contact.accountid [Contacts] field probable external',
      '13:24 reads CustomField:account.industry [Industry] field probable external',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('warns where a relationship leads to no known object, and where a child relationship nothing defines is a list', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Children',
        code(
          'public class Children {',
          '    List<SObject> rows;',
          '    void m(Account acc, Task t) {',
          '        for (Invoice__c inv : acc.Invoices__r) { Decimal a = inv.Amount__c; }',
          '        String w = t.What.Name;',
          '        Id what = t.WhatId;',
          '        Id who = t.Who.Id;',
          '        String g = acc.Partner__r.Name;',
          '        for (SObject one : acc.Things__r) { }',
          '        SObject first = acc.Others__r[0];',
          '        List<SObject> copy = new List<SObject>(acc.Copies__r);',
          '        Boolean has = acc.Checked__r != null;',
          '        rows.addAll(acc.Added__r);',
          '        List<SObject> given = acc.Given__r;',
          '        rows = acc.Assigned__r;',
          '        take(acc.Taken__r);',
          '        Integer n = acc.Partners.size();',
          '        List<List<SObject>> nested = new List<List<SObject>>{ acc.Nested__r };',
          '        Map<Id, List<SObject>> byId = new Map<Id, List<SObject>>{ acc.Id => acc.Mapped__r };',
          '        String o = t.What.Owner.Name;',
          '        acc.Agent__r.Owner.Name = null;',
          "        Object f = acc.Guessed__r.get('Name');",
          '        acc.Cleared__r.clear();',
          '    }',
          '    List<SObject> back(Account acc) { return acc.Returned__r; }',
          '    void take(List<SObject> rows) { }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '4:35 references CustomField:invoice__c.account__c [Invoices__r] field confirmed resolved',
      '4:66 reads CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      // `What` can lead to records of many objects: the field is read, and what stands after it is not followed.
      '5:22 reads CustomField:task.whatid [What] field probable external',
      '6:21 reads CustomField:task.whatid [WhatId] field probable external',
      '7:20 reads CustomField:task.whoid [Who] field probable external',
      // A name of a relationship that nothing defines is taken for the lookup the rule names.
      '8:24 reads null [Partner__r] field probable unresolved of Account',
      '12:27 reads null [Checked__r] field probable unresolved of Account',
      '13:9 reads ApexClass:children#var:rows [rows] field confirmed resolved',
      '15:9 writes ApexClass:children#var:rows [rows] field confirmed resolved',
      '16:9 calls ApexClass:children#method:take(list<sobject>) [take] call confirmed resolved',
      '20:22 reads CustomField:task.whatid [What] field probable external',
      '21:13 reads null [Agent__r] field probable unresolved of Account',
      // `get` with a text and `clear` are methods of a record too: they say nothing of a list.
      '22:24 reads null [Guessed__r] field probable unresolved of Account',
      '23:13 reads null [Cleared__r] field probable unresolved of Account',
    ]);
    const child = (line: number, column: number, name: string): string =>
      `PATH_NOT_FOLLOWED ${String(line)}:${String(column)} {"relationship":"${name}","notFollowed":[],"origin":"parser:apex"}`;
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 5:22 {"relationship":"What","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      'RELATIONSHIP_GUESSED 8:24 {"relationship":"Partner__r","object":"Account","field":"Partner__c"}',
      'PATH_NOT_FOLLOWED 8:24 {"relationship":"Partner__r","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      // Where the code uses the name as a list, it is a child relationship: it is no lookup, and nothing of it is
      // followed. A loop, an index, a constructor, a method of a list, a list it is given to, as a value, to a
      // variable, to a parameter or as what a method gives back.
      child(9, 32, 'Things__r'),
      child(10, 29, 'Others__r'),
      child(11, 52, 'Copies__r'),
      'RELATIONSHIP_GUESSED 12:27 {"relationship":"Checked__r","object":"Account","field":"Checked__c"}',
      child(13, 25, 'Added__r'),
      child(14, 35, 'Given__r'),
      child(15, 20, 'Assigned__r'),
      child(16, 18, 'Taken__r'),
      // So is a name of Salesforce that nothing checks.
      child(17, 25, 'Partners'),
      // And a value of a list of lists or of a map of lists.
      child(18, 67, 'Nested__r'),
      child(19, 81, 'Mapped__r'),
      // Every name after a relationship that is not followed is one of the warning, as for a flow.
      'PATH_NOT_FOLLOWED 20:22 {"relationship":"What","notFollowed":["Owner","Name"],"endsAt":"field","origin":"parser:apex"}',
      'RELATIONSHIP_GUESSED 21:13 {"relationship":"Agent__r","object":"Account","field":"Agent__c"}',
      'PATH_NOT_FOLLOWED 21:13 {"relationship":"Agent__r","notFollowed":["Owner","Name"],"endsAt":"field","origin":"parser:apex"}',
      'RELATIONSHIP_GUESSED 22:24 {"relationship":"Guessed__r","object":"Account","field":"Guessed__c"}',
      // The field that `get` names in a text is read after the relationship, as one after a dot.
      'PATH_NOT_FOLLOWED 22:24 {"relationship":"Guessed__r","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex","via":"text"}',
      'RELATIONSHIP_GUESSED 23:13 {"relationship":"Cleared__r","object":"Account","field":"Cleared__c"}',
      child(25, 50, 'Returned__r'),
    ]);
    expect(analysis.issues.find((one) => one.details?.['line'] === 20)?.message).toBe(
      'classes/Children.cls, line 20: it is not known which object "What" of "Task" leads to, so "Owner.Name" after it was not followed.',
    );
  });

  it('writes the object of DML, with the field an upsert tells records apart by, and warns where nothing says it', () => {
    const analysis = analysed((source) => {
      source.field('Invoice__c', 'External_Id__c', '<externalId>true</externalId>', '<type>Text</type>');
      // A lookup names the object `Vendor__c`, which no file defines.
      source.field('Invoice__c', 'Vendor__c', ...lookup('Vendor__c', 'Invoices'));
      source.apexClass(
        'Writes',
        code(
          'public class Writes {',
          '    void m(Invoice__c inv, List<Invoice__c> invs, List<SObject> rows, Invoice_Event__e evt) {',
          '        insert inv;',
          '        update as user invs;',
          '        upsert invs Invoice__c.External_Id__c;',
          '        delete [SELECT Id FROM PermissionSetAssignment WHERE Id = null];',
          "        insert new PermissionSet(Name = 'x', Label = 'y');",
          '        PermissionSet ps = new PermissionSet();',
          '        undelete ps;',
          '        update rows;',
          '        Database.insert(invs, false);',
          '        Database.upsert(invs, Invoice__c.Status__c, true);',
          '        Database.deleteImmediate(rows);',
          '        EventBus.publish(evt);',
          '        List<Database.SaveResult> results = Database.update(invs);',
          '        merge inv invs[0];',
          '        String error = results[0].getErrors()[0].getMessage();',
          '        Database.delete(new List<Id>{ inv.Id });',
          '        upsert invs Id;',
          '        upsert invs KEY;',
          '        Schema.SObjectField f = Invoice__c.External_Id__c;',
          '        upsert invs f;',
          '        SObject one = new Invoice__c();',
          '        insert one;',
          '        SObject two = new Invoice__c();',
          '        two = rows[0];',
          '        insert two;',
          "        insert new Vendor__c(Name = 'x');",
          '        Database.upsert(invs, Invoice__c.fields.Id);',
          '        System.Database.insert(inv);',
          '        System.EventBus.publish(evt);',
          '        Database.LeadConvert lc = null; insert lc;',
          '    }',
          '    static final Schema.SObjectField KEY = Invoice__c.External_Id__c;',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '3:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved insert',
      '4:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved update',
      '5:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      '5:32 references CustomField:invoice__c.external_id__c [External_Id__c] dml confirmed resolved',
      // A type of Salesforce that DML writes is an object, which nothing checks.
      '6:9 writes CustomObject:permissionsetassignment [PermissionSetAssignment] dml probable external delete',
      '6:32 reads CustomObject:permissionsetassignment [PermissionSetAssignment] soql probable external',
      '7:9 writes CustomObject:permissionset [PermissionSet] dml probable external insert',
      '7:34 writes CustomField:permissionset.name [Name] field probable external',
      '7:46 writes CustomField:permissionset.label [Label] field probable external',
      '9:9 writes CustomObject:permissionset [PermissionSet] dml probable external undelete',
      '11:18 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved insert',
      '12:18 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      '12:31 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '12:42 references CustomField:invoice__c.status__c [Status__c] token confirmed resolved',
      // An object that no file defines keeps its name.
      '14:18 writes null [Invoice_Event__e] dml probable unresolved publish of Invoice_Event__e',
      '15:54 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved update',
      '16:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved merge',
      // `Database.delete` of a list of `Id` writes records of an object nothing says, and the field `Id` gives
      // nothing as the field an upsert tells records apart by.
      '19:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      // A constant and a variable that hold the token of the field stand for it.
      '20:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      '20:21 reads ApexClass:writes#var:key [KEY] field confirmed resolved',
      '20:21 references CustomField:invoice__c.external_id__c [KEY] token confirmed resolved',
      '21:33 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '21:44 references CustomField:invoice__c.external_id__c [External_Id__c] token confirmed resolved',
      '22:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      '22:21 references CustomField:invoice__c.external_id__c [f] token confirmed resolved',
      // A variable that is never assigned again keeps the type of its value, and one that is does not.
      '24:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved insert',
      // An object that a lookup names keeps the tier of its syntax, though no file of the snapshot defines it.
      '28:9 writes null [Vendor__c] dml confirmed unresolved insert of Vendor__c',
      '28:30 writes null [Name] field probable unresolved of Vendor__c',
      '29:18 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      '29:31 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      // `System.Database` and `System.EventBus` are `Database` and `EventBus`.
      '30:25 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved insert',
      '31:25 writes null [Invoice_Event__e] dml probable unresolved publish of Invoice_Event__e',
      '34:44 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '34:55 references CustomField:invoice__c.external_id__c [External_Id__c] token confirmed resolved',
    ]);
    // A list of `SObject`: the warning bears on an answer that holds an object (decision record 0074).
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 10:9 {"op":"update","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 13:18 {"op":"delete","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 18:18 {"op":"delete","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 27:9 {"op":"insert","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      // A type of Salesforce of a namespace is no object.
      'PATH_NOT_FOLLOWED 32:41 {"op":"insert","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
    ]);
  });

  it('reads the tokens of objects and fields, with get and put, and the records of a custom setting', () => {
    const analysis = analysed((source) => {
      source.object('Billing_Settings__c', '<customSettingsType>Hierarchy</customSettingsType>', '<label>B</label>');
      source.field('Billing_Settings__c', 'Enabled__c', '<type>Checkbox</type>');
      source.apexClass(
        'Tokens',
        code(
          'public class Tokens {',
          '    void m(Invoice__c inv, Lead l) {',
          '        Schema.SObjectField amount = Invoice__c.Amount__c;',
          '        SObjectType type = Invoice__c.SObjectType;',
          '        Schema.DescribeFieldResult d = Schema.SObjectType.Invoice__c.fields.Status__c;',
          '        Object c = Lead.fields.Company;',
          '        Object v = inv.get(Invoice__c.Amount__c);',
          "        inv.put(Invoice__c.Status__c, 'Paid');",
          '        Object w = l.get(amount);',
          '        Boolean on = Billing_Settings__c.getInstance().Enabled__c;',
          '        Billing_Settings__c org = Billing_Settings__c.getOrgDefaults();',
          '        org.Enabled__c = true;',
          '        for (Rule__mdt r : Rule__mdt.getAll().values()) { String x = r.Label__c; }',
          '        Map<String, Schema.SObjectField> all = Invoice__c.SObjectType.getDescribe().fields.getMap();',
          '        Object z = Invoice__c.SObjectType.getDescribe().fields.Amount__c;',
          '        SObject made = Invoice__c.SObjectType.newSObject();',
          "        made.put('Amount__c', 1);",
          '        Integer y = inv.Status__c.length();',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '3:38 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '3:49 references CustomField:invoice__c.amount__c [Amount__c] token confirmed resolved',
      '4:28 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '5:59 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '5:77 references CustomField:invoice__c.status__c [Status__c] token confirmed resolved',
      '6:20 references CustomObject:lead [Lead] token confirmed external',
      '6:32 references CustomField:lead.company [Company] token probable external',
      // `get` and `put` with a token read and write the field.
      '7:28 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '7:39 reads CustomField:invoice__c.amount__c [Amount__c] token confirmed resolved',
      '8:17 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '8:28 writes CustomField:invoice__c.status__c [Status__c] token confirmed resolved',
      // Also a token a variable holds, which stands for it.
      '9:26 reads CustomField:invoice__c.amount__c [amount] token confirmed resolved',
      '10:22 references CustomObject:billing_settings__c [Billing_Settings__c] token confirmed resolved',
      '10:56 reads CustomField:billing_settings__c.enabled__c [Enabled__c] field confirmed resolved',
      '11:35 references CustomObject:billing_settings__c [Billing_Settings__c] token confirmed resolved',
      '12:13 writes CustomField:billing_settings__c.enabled__c [Enabled__c] field confirmed resolved',
      // A custom metadata type that no file defines: nothing checks it.
      '13:28 references null [Rule__mdt] token probable unresolved',
      '13:72 reads null [Label__c] field probable unresolved of Rule__mdt',
      '14:48 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '15:20 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '15:64 references CustomField:invoice__c.amount__c [Amount__c] token confirmed resolved',
      // A name in a text is read as a name in a text (decision record 0090).
      '16:24 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '18:25 reads CustomField:invoice__c.status__c [Status__c] field confirmed resolved',
    ]);
    expect(said(analysis, TEXT)).toEqual([
      '17:19 writes CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('reads a variable and a property of a class, of a class it extends and of a class around it, unless a local hides it', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Base',
        code(
          'public virtual class Base {',
          '    protected Invoice__c current;',
          '    public static Integer count = 0;',
          '}',
        ),
      );
      source.apexClass(
        'Child',
        code(
          'public class Child extends Base {',
          '    Invoice__c own;',
          '    public Decimal total {',
          '        get { return own.Amount__c; }',
          '        set { own.Amount__c = value; }',
          '    }',
          '    public class Inner {',
          '        void bump() { count++; Child.count = 2; }',
          '    }',
          '    void m(Invoice__c current) {',
          "        current.Status__c = 'Paid';",
          '        this.current.Amount__c = 1;',
          '        own = current;',
          '        if (true) { Account own = null; String n = own.Name; }',
          '        Decimal t = total;',
          '        total = 3;',
          "        new Child().own.Status__c = 'Draft';",
          '        String s = super.current.Status__c;',
          '    }',
          '}',
        ),
      );
    });
    const from = (analysis2: SourceAnalysis): string[] =>
      analysis2.components
        .filter((one) => isApex(one.key))
        .flatMap((one) =>
          one.references
            .filter((reference) => VIAS.has(viaOf(reference)))
            .map(
              (reference) =>
                `${one.key} ${String(reference.location?.line)}:${String(reference.location?.column)} ${reference.kind} ${String(reference.to)}`,
            ),
        );
    expect(from(analysis)).toEqual([
      'ApexClass:child#inner:inner/method:bump() 8:23 reads ApexClass:base#var:count',
      'ApexClass:child#inner:inner/method:bump() 8:23 writes ApexClass:base#var:count',
      'ApexClass:child#inner:inner/method:bump() 8:38 writes ApexClass:base#var:count',
      // The parameter hides the variable of the class it extends, and `this` does not.
      'ApexClass:child#method:m(invoice__c) 11:17 writes CustomField:invoice__c.status__c',
      'ApexClass:child#method:m(invoice__c) 12:14 reads ApexClass:base#var:current',
      'ApexClass:child#method:m(invoice__c) 12:22 writes CustomField:invoice__c.amount__c',
      'ApexClass:child#method:m(invoice__c) 13:9 writes ApexClass:child#var:own',
      // A local variable of a block hides the variable of the class, with its type.
      'ApexClass:child#method:m(invoice__c) 14:56 reads CustomField:account.name',
      'ApexClass:child#method:m(invoice__c) 15:21 reads ApexClass:child#prop:total',
      'ApexClass:child#method:m(invoice__c) 16:9 writes ApexClass:child#prop:total',
      'ApexClass:child#method:m(invoice__c) 17:13 calls ApexClass:child',
      'ApexClass:child#method:m(invoice__c) 17:21 reads ApexClass:child#var:own',
      'ApexClass:child#method:m(invoice__c) 17:25 writes CustomField:invoice__c.status__c',
      'ApexClass:child#method:m(invoice__c) 18:26 reads ApexClass:base#var:current',
      'ApexClass:child#method:m(invoice__c) 18:34 reads CustomField:invoice__c.status__c',
      // The setter of a property is given the value under the name `value`.
      'ApexClass:child#prop:total 4:22 reads ApexClass:child#var:own',
      'ApexClass:child#prop:total 4:26 reads CustomField:invoice__c.amount__c',
      'ApexClass:child#prop:total 5:15 reads ApexClass:child#var:own',
      'ApexClass:child#prop:total 5:19 writes CustomField:invoice__c.amount__c',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('reads the records of a trigger as those of its object', () => {
    const analysis = analysed((source) => {
      source.apexTrigger(
        'InvoiceTrigger',
        code(
          'trigger InvoiceTrigger on Invoice__c (before update) {',
          '    for (Invoice__c inv : Trigger.new) { inv.Amount__c = 0; }',
          '    Invoice__c old = Trigger.oldMap.get(Trigger.new[0].Id);',
          '    String was = old.Status__c;',
          '    for (SObject one : Trigger.newMap.values()) { Object s = one.get(Invoice__c.Status__c); }',
          '    Integer n = Trigger.new.size();',
          '    Decimal d = Trigger.new[0].Amount__c + Trigger.oldMap.get(old.Id).Amount__c;',
          '    String s = Trigger.old[0].Status__c;',
          '    Decimal v = Trigger.newMap.values()[0].Amount__c;',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '2:46 writes CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '4:22 reads CustomField:invoice__c.status__c [Status__c] field confirmed resolved',
      '5:70 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '5:81 reads CustomField:invoice__c.status__c [Status__c] token confirmed resolved',
      '7:32 reads CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '7:71 reads CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
      '8:31 reads CustomField:invoice__c.status__c [Status__c] field confirmed resolved',
      '9:44 reads CustomField:invoice__c.amount__c [Amount__c] field confirmed resolved',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('checks a name against the descriptions of an org, and warns where a described object lacks it', () => {
    const field = (
      name: string,
      type = 'string',
      referenceTo: readonly string[] = [],
      relationshipName: string | null = null,
    ): ObjectDescription['fields'][number] => ({ name, type, referenceTo, relationshipName });
    const descriptions: ObjectDescription[] = [
      {
        name: 'Account',
        fields: [
          field('Id', 'id'),
          field('Industry'),
          field('Name'),
          field('OwnerId', 'reference', ['User'], 'Owner'),
          field('pkg__Partner__c', 'reference', ['pkg__Partner__c'], 'pkg__Partner__r'),
        ],
        childRelationships: [
          { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId' },
          { relationshipName: 'Invoices__r', childSObject: 'Invoice__c', field: 'Account__c' },
          { relationshipName: 'pkg__Things__r', childSObject: 'pkg__Thing__c', field: 'pkg__Account__c' },
        ],
      },
      {
        name: 'Invoice__c',
        fields: [
          field('Account__c', 'reference', ['Account'], 'Account__r'),
          field('Amount__c', 'currency'),
          field('Id', 'id'),
          field('Name'),
          field('Status__c', 'picklist'),
        ],
        childRelationships: [],
      },
      {
        name: 'pkg__Thing__c',
        fields: [
          field('Id', 'id'),
          field('pkg__Account__c', 'reference', ['Account'], 'pkg__Account__r'),
          field('pkg__Size__c', 'double'),
        ],
        childRelationships: [],
      },
    ];
    const write = (source: ApexSource): void => {
      source.apexClass(
        'Described',
        code(
          'public class Described {',
          '    void m(Invoice__c inv, Account acc, Contact c) {',
          '        String a = inv.Account__r.Name;',
          '        String b = acc.Industry;',
          '        String d = acc.Rating;',
          '        String e = acc.pkg__Partner__r.Name;',
          '        for (pkg__Thing__c t : acc.pkg__Things__r) { Decimal z = t.pkg__Size__c; }',
          '        Id x = c.AccountId;',
          '        String y = c.Department;',
          '        String o = acc.Owner.Name;',
          '        Object tok = Account.Rating;',
          '        Integer n = acc.Contacts.size();',
          '        String g = inv.Ghost__c;',
          '        insert new pkg__Thing__c(pkg__Size__c = 1);',
          '    }',
          '}',
        ),
      );
    };
    const analysis = analysed(write, descriptions);
    expect(said(analysis)).toEqual([
      '3:24 reads CustomField:invoice__c.account__c [Account__r] field confirmed resolved',
      // What a description defines keeps the tier of its syntax.
      '3:35 reads CustomField:account.name [Name] field confirmed external',
      '4:24 reads CustomField:account.industry [Industry] field confirmed external',
      '5:24 reads null [Rating] field probable unresolved of Account',
      '6:24 reads CustomField:account.pkg__partner__c [pkg__Partner__r] field confirmed external',
      // The org did not describe the object the relationship leads to: as in a repository.
      '6:40 reads CustomField:pkg__partner__c.name [Name] field probable external',
      '7:36 references CustomField:pkg__thing__c.pkg__account__c [pkg__Things__r] field confirmed external',
      '7:68 reads CustomField:pkg__thing__c.pkg__size__c [pkg__Size__c] field confirmed external',
      '8:18 reads CustomField:contact.accountid [AccountId] field probable external',
      '9:22 reads CustomField:contact.department [Department] field probable external',
      '10:24 reads CustomField:account.ownerid [Owner] field confirmed external',
      '10:30 reads CustomField:user.name [Name] field probable external',
      '11:22 references CustomObject:account [Account] token confirmed external',
      '11:30 references null [Rating] token probable unresolved of Account',
      // The description of the account names the field behind its child relationship, also of an object the org
      // did not describe.
      '12:25 references CustomField:contact.accountid [Contacts] field confirmed external',
      '13:24 reads null [Ghost__c] field probable unresolved of Invoice__c',
      '14:9 writes CustomObject:pkg__thing__c [pkg__Thing__c] dml confirmed external insert',
      '14:34 writes CustomField:pkg__thing__c.pkg__size__c [pkg__Size__c] field confirmed external',
    ]);
    const missing = (line: number, column: number, object: string, name: string): string =>
      `FIELD_NOT_DESCRIBED ${String(line)}:${String(column)} {"object":"${object}","name":"${name}"}`;
    expect(warned(analysis.issues)).toEqual([
      missing(5, 24, 'Account', 'Rating'),
      missing(11, 30, 'Account', 'Rating'),
      missing(13, 24, 'Invoice__c', 'Ghost__c'),
    ]);
    // Without the descriptions, nothing checks a name that no file defines, and a relationship of a package that no
    // file defines is guessed: it is used as a list in the loop, so it is a child relationship that is not followed.
    const inRepository = analysed(write);
    expect(said(inRepository)).toEqual([
      '3:24 reads CustomField:invoice__c.account__c [Account__r] field confirmed resolved',
      '3:35 reads CustomField:account.name [Name] field probable external',
      '4:24 reads CustomField:account.industry [Industry] field probable external',
      '5:24 reads CustomField:account.rating [Rating] field probable external',
      '6:24 reads CustomField:account.pkg__partner__c [pkg__Partner__r] field probable external',
      '7:68 reads CustomField:pkg__thing__c.pkg__size__c [pkg__Size__c] field probable external',
      '8:18 reads CustomField:contact.accountid [AccountId] field probable external',
      '9:22 reads CustomField:contact.department [Department] field probable external',
      '10:24 reads CustomField:account.ownerid [Owner] field probable external',
      '10:30 reads CustomField:user.name [Name] field probable external',
      '11:22 references CustomObject:account [Account] token confirmed external',
      '11:30 references CustomField:account.rating [Rating] token probable external',
      '12:25 references CustomField:contact.accountid [Contacts] field probable external',
      '13:24 reads null [Ghost__c] field probable unresolved of Invoice__c',
      '14:9 writes CustomObject:pkg__thing__c [pkg__Thing__c] dml probable external insert',
      '14:34 writes CustomField:pkg__thing__c.pkg__size__c [pkg__Size__c] field probable external',
    ]);
    expect(warned(inRepository.issues)).toEqual([
      'RELATIONSHIP_GUESSED 6:24 {"relationship":"pkg__Partner__r","object":"Account","field":"pkg__Partner__c"}',
      'PATH_NOT_FOLLOWED 6:24 {"relationship":"pkg__Partner__r","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 7:36 {"relationship":"pkg__Things__r","notFollowed":[],"origin":"parser:apex"}',
    ]);
  });

  it('takes a name before a dot for a relationship, and a field of the short lists never for a child relationship', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Steps',
        code(
          'public class Steps {',
          '    void m(Lead l, Contact c) {',
          '        String n = l.ConvertedAccount.Name;',
          '        Integer k = c.AccountId.size();',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '3:22 reads CustomField:lead.convertedaccountid [ConvertedAccount] field probable external',
      '4:23 reads CustomField:contact.accountid [AccountId] field probable external',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 3:22 {"relationship":"ConvertedAccount","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
    ]);
  });

  it('takes a file before a description, names the field a described object lacks, and stops at an owner that can be a group', () => {
    const field = (
      name: string,
      type = 'string',
      referenceTo: readonly string[] = [],
      relationshipName: string | null = null,
    ): ObjectDescription['fields'][number] => ({ name, type, referenceTo, relationshipName });
    const descriptions: ObjectDescription[] = [
      {
        name: 'Account',
        fields: [field('Id', 'id'), field('Name')],
        childRelationships: [
          { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId' },
          // The file of the field `Account__c` of the invoice names the relationship, and comes first.
          { relationshipName: 'Invoices__r', childSObject: 'Payment__c', field: 'Account__c' },
        ],
      },
      { name: 'Contact', fields: [field('Id', 'id'), field('LastName')], childRelationships: [] },
      {
        name: 'Invoice__c',
        fields: [
          field('Account__c', 'reference', ['Account'], 'Account__r'),
          field('Id', 'id'),
          field('OwnerId', 'reference', ['Group', 'User'], 'Owner'),
        ],
        childRelationships: [],
      },
    ];
    const analysis = analysed((source) => {
      source.apexClass(
        'Owners',
        code(
          'public class Owners {',
          '    void m(Invoice__c inv, Account acc) {',
          '        String o = inv.Owner.Name;',
          '        Integer c = acc.Contacts.size();',
          '        for (Invoice__c i : acc.Invoices__r) { }',
          '        String p = inv.Partner__r.Name;',
          '    }',
          '}',
        ),
      );
    }, descriptions);
    expect(said(analysis)).toEqual([
      '3:24 reads CustomField:invoice__c.ownerid [Owner] field confirmed external',
      '4:25 references null [Contacts] field probable unresolved of Contact',
      '5:33 references CustomField:invoice__c.account__c [Invoices__r] field confirmed resolved',
      '6:24 reads null [Partner__r] field probable unresolved of Invoice__c',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 3:24 {"relationship":"Owner","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      // The name of the field the description lacks: behind a relationship, the lookup field.
      'FIELD_NOT_DESCRIBED 4:25 {"object":"Contact","name":"AccountId"}',
      'FIELD_NOT_DESCRIBED 6:24 {"object":"Invoice__c","name":"Partner__c"}',
      'PATH_NOT_FOLLOWED 6:24 {"relationship":"Partner__r","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
    ]);
  });

  /** The line `Line__c`, whose lookup `Invoice__c` gives the invoice the child relationship `Lines__r`. */
  const withLines = (source: ApexSource): void => {
    source.object('Line__c', '<label>Line</label>');
    source.field('Line__c', 'Invoice__c', ...lookup('Invoice__c', 'Lines'));
    source.field('Line__c', 'Quantity__c', '<type>Number</type>');
  };

  it('reads the object and every field of a query, with a prefix, in subqueries, and what it binds', () => {
    const analysis = analysed((source) => {
      withLines(source);
      source.apexClass(
        'Queries',
        code(
          'public class Queries {',
          '    Set<Id> ids;',
          '    static final Integer MOST = 10;',
          '    void m(Invoice__c inv, String term) {',
          '        List<Account> a = [SELECT a.Name, Account.Industry FROM Account a WHERE Id IN :ids];',
          '        List<Account> b = [SELECT Id, (SELECT Amount__c, (SELECT Quantity__c FROM Lines__r) FROM Invoices__r) FROM Account];',
          '        List<Invoice__c> c = [SELECT Id FROM Invoice__c WHERE Account__c IN (SELECT Id FROM Account WHERE Industry = :term)];',
          '        List<Invoice__c> d = [SELECT Id FROM Invoice__c WHERE Status__c = :inv.Status__c ORDER BY Account__r.Name LIMIT :MOST];',
          '        update [SELECT Id FROM Invoice__c WHERE Amount__c > 0];',
          '        String n = [SELECT Name FROM Account LIMIT 1].Name;',
          '        List<Invoice__c> o = [SELECT TYPEOF Owner WHEN Group THEN Type ELSE Name END FROM Invoice__c];',
          '        String s = [SELECT Status FROM AsyncApexJob LIMIT 1].Status;',
          '        List<Account> g = [SELECT (SELECT Amount__c FROM a.Invoices__r), (SELECT Status__c FROM Account.Invoices__r) FROM Account a];',
          '        List<Event> w = [SELECT TYPEOF e.What WHEN Account THEN Industry END, e.CreatedBy.Name FROM Event e];',
          '        SObject one = [SELECT Id FROM Invoice__c LIMIT 1];',
          '        update one;',
          '        for (List<SObject> batch : [SELECT Id FROM Invoice__c]) {',
          '            delete batch;',
          '        }',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      // The alias and the name of the object in front of a field are no relationship.
      '5:37 reads CustomField:account.name [Name] soql probable external',
      '5:51 reads CustomField:account.industry [Industry] soql probable external',
      '5:65 reads CustomObject:account [Account] soql confirmed external',
      // A variable that a query binds is named in the query.
      '5:88 reads ApexClass:queries#var:ids [ids] soql confirmed resolved',
      // A subquery through a child relationship reads the object of the relationship, also inside another one.
      '6:47 reads CustomField:invoice__c.amount__c [Amount__c] soql confirmed resolved',
      '6:66 reads CustomField:line__c.quantity__c [Quantity__c] soql confirmed resolved',
      '6:83 reads CustomObject:line__c [Lines__r] soql confirmed resolved',
      '6:83 references CustomField:line__c.invoice__c [Lines__r] soql confirmed resolved',
      '6:98 reads CustomObject:invoice__c [Invoices__r] soql confirmed resolved',
      '6:98 references CustomField:invoice__c.account__c [Invoices__r] soql confirmed resolved',
      '6:116 reads CustomObject:account [Account] soql confirmed external',
      '7:46 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '7:63 reads CustomField:invoice__c.account__c [Account__c] soql confirmed resolved',
      // A subquery of the filter reads its own object.
      '7:93 reads CustomObject:account [Account] soql confirmed external',
      '7:107 reads CustomField:account.industry [Industry] soql probable external',
      '8:46 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '8:63 reads CustomField:invoice__c.status__c [Status__c] soql confirmed resolved',
      // A bound expression is code, whose names stand in the query.
      '8:80 reads CustomField:invoice__c.status__c [Status__c] soql confirmed resolved',
      '8:99 reads CustomField:invoice__c.account__c [Account__r] soql confirmed resolved',
      '8:110 reads CustomField:account.name [Name] soql probable external',
      '8:122 reads ApexClass:queries#var:most [MOST] soql confirmed resolved',
      // The records a query gives are of its object.
      '9:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved update',
      '9:32 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '9:49 reads CustomField:invoice__c.amount__c [Amount__c] soql confirmed resolved',
      '10:28 reads CustomField:account.name [Name] soql probable external',
      '10:38 reads CustomObject:account [Account] soql confirmed external',
      '10:55 reads CustomField:account.name [Name] field probable external',
      // The fields after ELSE are of the one object the relationship leads to, which no WHEN names.
      '11:45 reads CustomField:invoice__c.ownerid [Owner] soql probable external',
      '11:56 reads CustomObject:group [Group] soql probable external',
      '11:67 reads CustomField:group.type [Type] soql probable external',
      '11:77 reads CustomField:user.name [Name] soql probable external',
      '11:91 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      // The records of an object the analysis does not know are kept by its name, as a declared type of it is: a
      // field of them is read in the query, and not after it.
      '12:28 reads CustomField:asyncapexjob.status [Status] soql probable external',
      '12:40 reads CustomObject:asyncapexjob [AsyncApexJob] soql probable external',
      // The alias and the name of the object in front of the relationship of a subquery are no relationship.
      '13:43 reads CustomField:invoice__c.amount__c [Amount__c] soql confirmed resolved',
      '13:60 reads CustomObject:invoice__c [Invoices__r] soql confirmed resolved',
      '13:60 references CustomField:invoice__c.account__c [Invoices__r] soql confirmed resolved',
      '13:82 reads CustomField:invoice__c.status__c [Status__c] soql confirmed resolved',
      '13:105 reads CustomObject:invoice__c [Invoices__r] soql confirmed resolved',
      '13:105 references CustomField:invoice__c.account__c [Invoices__r] soql confirmed resolved',
      '13:123 reads CustomObject:account [Account] soql confirmed external',
      // Nor in front of the relationship of a TYPEOF. A relationship that every org has is followed in a query too.
      '14:42 reads CustomField:event.whatid [What] soql probable external',
      '14:52 reads CustomObject:account [Account] soql confirmed external',
      '14:65 reads CustomField:account.industry [Industry] soql probable external',
      '14:81 reads CustomField:event.createdbyid [CreatedBy] soql probable external',
      '14:91 reads CustomField:user.name [Name] soql probable external',
      '14:101 reads CustomObject:event [Event] soql confirmed external',
      // A query given to one record gives a record of its object, and a loop over it a list of them for each batch.
      '15:39 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '16:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved update',
      '17:52 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '18:13 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved delete',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('warns where a query names what nothing says, and gives rows of no object where it groups them', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Unknowns',
        code(
          'public class Unknowns {',
          '    void m() {',
          '        List<Account> a = [SELECT Id, (SELECT Name, Owner.Name FROM Things__r) FROM Account];',
          '        List<Event> e = [SELECT TYPEOF What WHEN Account THEN Industry ELSE Name, Id END FROM Event];',
          '        List<Event> f = [SELECT TYPEOF What WHEN Account THEN Industry ELSE Id END FROM Event];',
          '        List<Task> t = [SELECT What.Name FROM Task];',
          '        List<SObject> rows = [SELECT Account__c, SUM(Amount__c) total FROM Invoice__c GROUP BY Account__c];',
          '        update rows;',
          '        List<SObject> records = [SELECT Id FROM Invoice__c];',
          '        update records;',
          '        Integer n = [SELECT COUNT() FROM Invoice__c];',
          '        List<Invoice__c> o = [SELECT TYPEOF Owner WHEN User THEN Username ELSE Name END FROM Invoice__c];',
          '        List<Invoice__c> all = [SELECT FIELDS(ALL) FROM Invoice__c LIMIT 200];',
          '        List<Account> s = [SELECT (SELECT Id FROM Ghosts__r WHERE Amount__c > :all[0].Amount__c AND Id IN (SELECT Account__c FROM Invoice__c)) FROM Account];',
          '        List<Contact> c = [SELECT Sponsor.Email FROM Contact];',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '3:85 reads CustomObject:account [Account] soql confirmed external',
      '4:40 reads CustomField:event.whatid [What] soql probable external',
      '4:50 reads CustomObject:account [Account] soql confirmed external',
      '4:63 reads CustomField:account.industry [Industry] soql probable external',
      '4:95 reads CustomObject:event [Event] soql confirmed external',
      '5:40 reads CustomField:event.whatid [What] soql probable external',
      '5:50 reads CustomObject:account [Account] soql confirmed external',
      '5:63 reads CustomField:account.industry [Industry] soql probable external',
      '5:89 reads CustomObject:event [Event] soql confirmed external',
      '6:32 reads CustomField:task.whatid [What] soql probable external',
      '6:47 reads CustomObject:task [Task] soql confirmed external',
      // The alias of an aggregate is no field.
      '7:38 reads CustomField:invoice__c.account__c [Account__c] soql confirmed resolved',
      '7:54 reads CustomField:invoice__c.amount__c [Amount__c] soql confirmed resolved',
      '7:76 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '7:96 reads CustomField:invoice__c.account__c [Account__c] soql confirmed resolved',
      '9:49 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '10:9 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved update',
      '11:42 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '12:45 reads CustomField:invoice__c.ownerid [Owner] soql probable external',
      '12:56 reads CustomObject:user [User] soql confirmed external',
      '12:66 reads CustomField:user.username [Username] soql probable external',
      '12:94 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '13:57 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      // Of a subquery through a child relationship that nothing defines, what it binds and its subqueries of the
      // filter are read.
      '14:87 reads CustomField:invoice__c.amount__c [Amount__c] soql confirmed resolved',
      '14:115 reads CustomField:invoice__c.account__c [Account__c] soql confirmed resolved',
      '14:131 reads CustomObject:invoice__c [Invoice__c] soql confirmed resolved',
      '14:149 reads CustomObject:account [Account] soql confirmed external',
      // A name before a dot is a relationship, also one that nothing names as one.
      '15:35 reads CustomField:contact.sponsorid [Sponsor] soql probable external',
      '15:54 reads CustomObject:contact [Contact] soql confirmed external',
    ]);
    expect(warned(analysis.issues)).toEqual([
      // The lookup field behind a child relationship that nothing defines can have any name.
      'PATH_NOT_FOLLOWED 3:69 {"relationship":"Things__r","notFollowed":["Name","Owner"],"origin":"parser:apex"}',
      // The fields after ELSE are of objects nothing names. `Id` gives no reference where the object is known.
      'PATH_NOT_FOLLOWED 4:40 {"relationship":"What","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 6:32 {"relationship":"What","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      // A row of a query that groups its rows is an `AggregateResult`, of no object.
      'PATH_NOT_FOLLOWED 8:9 {"op":"update","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      // The relationship leads to one object the analysis knows, and the WHEN names it: ELSE is of others.
      'PATH_NOT_FOLLOWED 12:45 {"relationship":"Owner","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      // FIELDS(ALL) reads fields the query does not name, and the warning bears on every answer.
      'PATH_NOT_FOLLOWED 13:40 {"object":"Invoice__c","notFollowed":[],"origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 14:51 {"relationship":"Ghosts__r","notFollowed":["Amount__c"],"origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 15:35 {"relationship":"Sponsor","notFollowed":["Email"],"endsAt":"field","origin":"parser:apex"}',
    ]);
    const messages = analysis.issues.map((one) => one.message);
    expect([...messages.slice(0, 2), messages[5]]).toEqual([
      'classes/Unknowns.cls, line 3: it is not known which object the child relationship "Things__r" of "Account" leads to, so the subquery through it was not followed.',
      'classes/Unknowns.cls, line 4: the fields after ELSE are of the objects that "What" of "Event" leads to beside those after WHEN, which are not known, so "Name" was not followed.',
      'classes/Unknowns.cls, line 13: "FIELDS(ALL)" reads fields of "Invoice__c" that the query does not name, so they were not followed.',
    ]);
  });

  it('reads the objects of a search, with their fields and what the search binds', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Searches',
        code(
          'public class Searches {',
          '    String term;',
          '    void m() {',
          "        List<List<SObject>> r = [FIND :term IN ALL FIELDS RETURNING Invoice__c(Amount__c WHERE Status__c = 'Sent' ORDER BY Account__r.Name), Account, Contact(Contact.LastName)];",
          "        List<List<SObject>> s = [FIND 'x' RETURNING Account(Name WHERE Name != :term)];",
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '4:40 reads ApexClass:searches#var:term [term] sosl confirmed resolved',
      '4:69 reads CustomObject:invoice__c [Invoice__c] sosl confirmed resolved',
      '4:80 reads CustomField:invoice__c.amount__c [Amount__c] sosl confirmed resolved',
      '4:96 reads CustomField:invoice__c.status__c [Status__c] sosl confirmed resolved',
      '4:124 reads CustomField:invoice__c.account__c [Account__r] sosl confirmed resolved',
      '4:135 reads CustomField:account.name [Name] sosl probable external',
      '4:142 reads CustomObject:account [Account] sosl confirmed external',
      '4:151 reads CustomObject:contact [Contact] sosl confirmed external',
      '4:167 reads CustomField:contact.lastname [LastName] sosl probable external',
      // What the filter of a returned object binds is read too.
      '5:53 reads CustomObject:account [Account] sosl confirmed external',
      '5:61 reads CustomField:account.name [Name] sosl probable external',
      '5:72 reads CustomField:account.name [Name] sosl probable external',
      '5:81 reads ApexClass:searches#var:term [term] sosl confirmed resolved',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('checks the names of a query against the descriptions of an org', () => {
    const descriptions: ObjectDescription[] = [
      {
        name: 'Account',
        fields: [
          { name: 'Id', type: 'id', referenceTo: [], relationshipName: null },
          { name: 'Name', type: 'string', referenceTo: [], relationshipName: null },
        ],
        childRelationships: [
          { relationshipName: 'Cases', childSObject: 'Case', field: 'AccountId' },
          { relationshipName: 'Opportunities', childSObject: 'Opportunity', field: 'AccountId' },
        ],
      },
      // The description of the child object lacks the field behind the relationship.
      {
        name: 'Opportunity',
        fields: [{ name: 'Id', type: 'id', referenceTo: [], relationshipName: null }],
        childRelationships: [],
      },
    ];
    const analysis = analysed((source) => {
      source.apexClass(
        'DescribedQueries',
        code(
          'public class DescribedQueries {',
          '    void m() {',
          '        List<Account> a = [SELECT Name, Rating, (SELECT Id FROM Cases), (SELECT Id FROM Ghosts__r) FROM Account];',
          '        List<Account> b = [SELECT (SELECT Id FROM Opportunities) FROM Account];',
          '    }',
          '}',
        ),
      );
    }, descriptions);
    expect(said(analysis)).toEqual([
      '3:35 reads CustomField:account.name [Name] soql confirmed external',
      '3:41 reads null [Rating] soql probable unresolved of Account',
      // The description of the parent names the field behind the child relationship.
      '3:65 reads CustomObject:case [Cases] soql confirmed external',
      '3:65 references CustomField:case.accountid [Cases] soql confirmed external',
      '3:105 reads CustomObject:account [Account] soql confirmed external',
      // The description of the child object lacks the field behind the child relationship.
      '4:51 reads CustomObject:opportunity [Opportunities] soql confirmed external',
      '4:51 references null [Opportunities] soql probable unresolved of Opportunity',
      '4:71 reads CustomObject:account [Account] soql confirmed external',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'FIELD_NOT_DESCRIBED 3:41 {"object":"Account","name":"Rating"}',
      'PATH_NOT_FOLLOWED 3:89 {"relationship":"Ghosts__r","notFollowed":[],"origin":"parser:apex"}',
      'FIELD_NOT_DESCRIBED 4:51 {"object":"Opportunity","name":"AccountId"}',
    ]);
  });

  /** The calls of the members: `from line:column target via tier`, and the method a call names in a class not read. */
  const called = (analysis: SourceAnalysis): string[] =>
    analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) => one.references)
      .filter((one) => one.kind === 'calls')
      .map((one) => {
        const method = one.attrs?.['method'];
        const at = `${String(one.location?.line)}:${String(one.location?.column)}`;
        return `${one.from} ${at} ${String(one.to)} ${viaOf(one)} ${one.confidence}${typeof method === 'string' ? ` ${method}` : ''}`;
      });

  it('calls the method that the name, the number and the types of the arguments choose', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Pricing',
        code(
          'public class Pricing {',
          '    public Decimal round(Decimal amount) { return amount; }',
          '    public Decimal round(Integer amount) { return amount; }',
          '    public String label(Id id) { return null; }',
          '    public String label(String text) { return text; }',
          '    public void take(List<Id> ids) {}',
          '    public void take(Set<Id> ids) {}',
          '    public void take(Invoice__c one) {}',
          '    public void two(Integer a, Decimal b) {}',
          '    public void two(Decimal a, Integer b) {}',
          '    public static void util() {}',
          '    public void util(Integer n) {}',
          '    void m(Invoice__c inv, Id id, Set<Id> ids, Pricing other) {',
          '        Decimal d = 1.5;',
          '        round(1); round(d); round(d * 2 - 1); round(2.5); round(10L);',
          '        round(inv.Amount__c); round(null);',
          "        label(id); label('text'); label(id + 'x');",
          '        take(ids); take(new List<Id>{ id }); take(inv); take(ids.size() > 0 ? null : inv);',
          '        two(1, 1); two(1, 1.5);',
          '        this.round(1); other.label(id); Pricing.util(); util(); util(1);',
          '        Decimal r = round(round(1));',
          '        pick(null, 1); tok(Schema.SObjectType.Invoice__c.fields.Amount__c); tok(Invoice__c.Amount__c);',
          '    }',
          '    public void pick(String a, Integer n) {}',
          '    public void pick(Invoice__c a, Invoice__c b) {}',
          '    public void tok(Schema.SObjectField f) {}',
          '    public void tok(String s) {}',
          '}',
        ),
      );
    });
    const from = 'ApexClass:pricing#method:m(invoice__c,id,set<id>,pricing)';
    const to = (sub: string): string => `ApexClass:pricing#method:${sub}`;
    expect(called(analysis)).toEqual([
      `${from} 15:9 ${to('round(integer)')} call confirmed`,
      `${from} 15:19 ${to('round(decimal)')} call confirmed`,
      // A number with a number gives the wider of them.
      `${from} 15:29 ${to('round(decimal)')} call confirmed`,
      `${from} 15:47 ${to('round(decimal)')} call confirmed`,
      // A Long fits a Decimal and no Integer.
      `${from} 15:59 ${to('round(decimal)')} call confirmed`,
      // The type of a field is not known here, and `null` fits both.
      `${from} 16:9 ${to('round(decimal)')} call probable`,
      `${from} 16:9 ${to('round(integer)')} call probable`,
      `${from} 16:31 ${to('round(decimal)')} call probable`,
      `${from} 16:31 ${to('round(integer)')} call probable`,
      `${from} 17:9 ${to('label(id)')} call confirmed`,
      `${from} 17:20 ${to('label(string)')} call confirmed`,
      // An Id and a text give a text.
      `${from} 17:35 ${to('label(string)')} call confirmed`,
      `${from} 18:9 ${to('take(set<id>)')} call confirmed`,
      `${from} 18:20 ${to('take(list<id>)')} call confirmed`,
      `${from} 18:46 ${to('take(invoice__c)')} call confirmed`,
      `${from} 18:57 ${to('take(invoice__c)')} call confirmed`,
      // Neither fits the arguments as they are, and neither has parameters that fit those of the other.
      `${from} 19:9 ${to('two(decimal,integer)')} call probable`,
      `${from} 19:9 ${to('two(integer,decimal)')} call probable`,
      `${from} 19:20 ${to('two(integer,decimal)')} call confirmed`,
      `${from} 20:14 ${to('round(integer)')} call confirmed`,
      `${from} 20:30 ${to('label(id)')} call confirmed`,
      `${from} 20:49 ${to('util()')} call confirmed`,
      `${from} 20:57 ${to('util()')} call confirmed`,
      `${from} 20:65 ${to('util(integer)')} call confirmed`,
      // What a method gives back chooses the method it is given to.
      `${from} 21:21 ${to('round(decimal)')} call confirmed`,
      `${from} 21:27 ${to('round(integer)')} call confirmed`,
      // `null` fits both, and the other argument only one. The field of a describe is a token or its describe, as
      // the code takes it, and no text.
      `${from} 22:9 ${to('pick(string,integer)')} call confirmed`,
      `${from} 22:24 ${to('tok(schema.sobjectfield)')} call confirmed`,
      `${from} 22:77 ${to('tok(schema.sobjectfield)')} call confirmed`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('calls each override and implementation of a method that a value of a class or an interface calls', () => {
    const analysis = analysed((source) => {
      source.apexClass('Notifier', code('public interface Notifier {', '    void send(Invoice__c inv);', '}'));
      source.apexClass(
        'LoudNotifier',
        code('public interface LoudNotifier extends Notifier {', '    void shout();', '}'),
      );
      source.apexClass(
        'Base',
        code(
          'public virtual class Base implements Notifier {',
          '    public virtual void send(Invoice__c inv) {}',
          '    public void fixed() {}',
          '    public static void tool() {}',
          '    public virtual void run() { send(null); fixed(); }',
          '}',
        ),
      );
      source.apexClass(
        'Child',
        code(
          'public class Child extends Base {',
          '    public override void send(Invoice__c inv) { super.send(inv); }',
          '    public void fixed(Integer n) {}',
          '}',
        ),
      );
      source.apexClass(
        'Loud',
        code(
          'public class Loud implements LoudNotifier {',
          '    public void send(Invoice__c inv) {}',
          '    public void shout() {}',
          '}',
        ),
      );
      source.apexClass(
        'Caller',
        code(
          'public class Caller {',
          '    void m(Notifier n, Base b, Child c, LoudNotifier l, Invoice__c inv) {',
          '        n.send(inv);',
          '        b.send(inv);',
          '        c.send(inv);',
          '        b.fixed(); c.fixed(); c.fixed(1); Base.tool();',
          '        l.send(inv); l.shout();',
          '    }',
          '}',
        ),
      );
    });
    expect(called(analysis)).toEqual([
      'ApexClass:base#method:run() 5:33 ApexClass:base#method:send(invoice__c) call confirmed',
      // A call without anything in front is a call on the value the method runs on.
      'ApexClass:base#method:run() 5:33 ApexClass:child#method:send(invoice__c) call probable',
      'ApexClass:base#method:run() 5:45 ApexClass:base#method:fixed() call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 3:11 ApexClass:base#method:send(invoice__c) call probable',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 3:11 ApexClass:child#method:send(invoice__c) call probable',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 3:11 ApexClass:loud#method:send(invoice__c) call probable',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 3:11 ApexClass:notifier#method:send(invoice__c) call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 4:11 ApexClass:base#method:send(invoice__c) call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 4:11 ApexClass:child#method:send(invoice__c) call probable',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 5:11 ApexClass:child#method:send(invoice__c) call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 6:11 ApexClass:base#method:fixed() call confirmed',
      // A method that is not virtual is overridden by none, and one of a class it extends is called on the class.
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 6:22 ApexClass:base#method:fixed() call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 6:33 ApexClass:child#method:fixed(integer) call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 6:48 ApexClass:base#method:tool() call confirmed',
      // A method of an interface that the interface extends.
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 7:11 ApexClass:loud#method:send(invoice__c) call probable',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 7:11 ApexClass:notifier#method:send(invoice__c) call confirmed',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 7:24 ApexClass:loud#method:shout() call probable',
      'ApexClass:caller#method:m(notifier,base,child,loudnotifier,invoice__c) 7:24 ApexClass:loudnotifier#method:shout() call confirmed',
      // `super` calls the method of the class it extends, and no override.
      'ApexClass:child#method:send(invoice__c) 2:55 ApexClass:base#method:send(invoice__c) call confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('chooses a method among those of the type the code declares, and runs it as the class of the value has it', () => {
    const analysis = analysed((source) => {
      source.apexClass('Shape', code('public interface Shape {', '    String area(Object o);', '}'));
      source.apexClass(
        'Square',
        code(
          'public virtual class Square implements Shape {',
          '    public virtual String area(Object o) { return null; }',
          '    public String area(String s) { return s; }',
          '}',
        ),
      );
      source.apexClass(
        'Tiny',
        code('public class Tiny extends Square {', '    public override String area(Object o) { return null; }', '}'),
      );
      source.apexClass(
        'Circle',
        code('public class Circle implements Shape {', '    public String area(Object o) { return null; }', '}'),
      );
      source.apexClass(
        'Draw',
        code(
          'public class Draw {',
          '    void m() {',
          "        Shape s = new Square(); s.area('x');",
          '        Square q = new Tiny(); q.area(1);',
          '        Shape again = new Circle(); again = new Square(); again.area(1);',
          '    }',
          '}',
        ),
      );
    });
    const from = 'ApexClass:draw#method:m()';
    expect(called(analysis)).toEqual([
      `${from} 3:23 ApexClass:square new confirmed`,
      // `Shape` has one `area`, which a text fits as an `Object`: the object is a `Square`, or of a class that extends
      // it, so its method runs, or the one of `Tiny`, and never that of `Circle`.
      `${from} 3:35 ApexClass:shape#method:area(object) call confirmed`,
      `${from} 3:35 ApexClass:square#method:area(object) call probable`,
      `${from} 3:35 ApexClass:tiny#method:area(object) call probable`,
      `${from} 4:24 ApexClass:tiny new confirmed`,
      `${from} 4:34 ApexClass:square#method:area(object) call confirmed`,
      `${from} 4:34 ApexClass:tiny#method:area(object) call probable`,
      `${from} 5:27 ApexClass:circle new confirmed`,
      `${from} 5:49 ApexClass:square new confirmed`,
      // A variable that is given a value twice is of the type it declares.
      `${from} 5:65 ApexClass:circle#method:area(object) call probable`,
      `${from} 5:65 ApexClass:shape#method:area(object) call confirmed`,
      `${from} 5:65 ApexClass:square#method:area(object) call probable`,
      `${from} 5:65 ApexClass:tiny#method:area(object) call probable`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('runs a method that a class has from the class it extends, and keeps the declared type of a value it is given', () => {
    const analysis = analysed((source) => {
      source.apexClass('Shape', code('public interface Shape {', '    String area();', '}'));
      source.apexClass(
        'Square',
        code(
          'public virtual class Square implements Shape {',
          '    public virtual String area() { return null; }',
          '}',
        ),
      );
      source.apexClass(
        'Tiny',
        code(
          'public virtual class Tiny extends Square {',
          '    public override String area() { return super.area(); }',
          '}',
        ),
      );
      source.apexClass(
        'Micro',
        code('public class Micro extends Tiny {', '    public override String area() { return null; }', '}'),
      );
      source.apexClass(
        'Circle',
        code('public class Circle implements Shape {', '    public String area() { return null; }', '}'),
      );
      // Apex refuses a static method of the signature of one it would override, and none is taken for one.
      source.apexClass(
        'Odd',
        code('public class Odd extends Square {', '    public static String area() { return null; }', '}'),
      );
      source.apexClass('Factory', '(hidden)');
      source.apexClass('Selector', code('public interface Selector {', '    List<SObject> byId(Set<Id> ids);', '}'));
      source.apexClass('AccountSelector', code('public interface AccountSelector extends Selector {', '}'));
      source.apexClass(
        'BaseSelector',
        code(
          'public abstract class BaseSelector implements Selector {',
          '    public virtual List<SObject> byId(Set<Id> ids) { return null; }',
          '}',
        ),
      );
      source.apexClass(
        'Accounts',
        code('public class Accounts extends BaseSelector implements AccountSelector {', '}'),
      );
      source.apexClass(
        'Draw',
        code(
          'public class Draw {',
          '    void desc(Shape x) {}',
          '    void desc(Square x) {}',
          '    void keep(SObject one) {}',
          '    void keep(Account one) {}',
          '    void m(Boolean flag, AccountSelector sel, Set<Id> ids, List<Square> squares, Square maybe, Shape any) {',
          '        sel.byId(ids);',
          '        Shape s = flag ? new Square() : new Circle(); s.area();',
          '        Shape u = new Square(); desc(flag ? u : null); desc(u ?? null);',
          '        List<SObject> recs = [SELECT Id FROM Account]; keep(recs[0]); keep(recs.get(0));',
          '        Map<Id, SObject> byId = new Map<Id, Account>(); keep(byId.get(null)); keep(byId.values()[0]);',
          '        for (Shape each : squares) { each = new Circle(); each.area(); }',
          '        Shape w = flag ? new Square() : Factory.make(); w.area();',
          '        Shape v = maybe ?? new Circle(); v.area();',
          '        Square q = (Square) any; q.area();',
          '    }',
          '}',
        ),
      );
    });
    const from = 'ApexClass:draw#method:m(boolean,accountselector,set<id>,list<square>,square,shape)';
    expect(called(analysis)).toEqual([
      // The object of a class that implements the interface runs the method of the class it extends.
      `${from} 7:13 ApexClass:baseselector#method:byid(set<id>) call probable`,
      `${from} 7:13 ApexClass:selector#method:byid(set<id>) call confirmed`,
      // A conditional is of the closest type both of its values are of.
      `${from} 8:30 ApexClass:square new confirmed`,
      `${from} 8:45 ApexClass:circle new confirmed`,
      `${from} 8:57 ApexClass:circle#method:area() call probable`,
      `${from} 8:57 ApexClass:micro#method:area() call probable`,
      `${from} 8:57 ApexClass:shape#method:area() call confirmed`,
      `${from} 8:57 ApexClass:square#method:area() call probable`,
      `${from} 8:57 ApexClass:tiny#method:area() call probable`,
      // Apex chooses by the type the code declares, also of a conditional, an item of a list and a value of a map.
      `${from} 9:23 ApexClass:square new confirmed`,
      `${from} 9:33 ApexClass:draw#method:desc(shape) call confirmed`,
      `${from} 9:56 ApexClass:draw#method:desc(shape) call confirmed`,
      `${from} 10:56 ApexClass:draw#method:keep(sobject) call confirmed`,
      `${from} 10:71 ApexClass:draw#method:keep(sobject) call confirmed`,
      `${from} 11:57 ApexClass:draw#method:keep(sobject) call confirmed`,
      `${from} 11:79 ApexClass:draw#method:keep(sobject) call confirmed`,
      // The variable of a loop that the loop assigns is of the type it declares.
      `${from} 12:49 ApexClass:circle new confirmed`,
      `${from} 12:64 ApexClass:circle#method:area() call probable`,
      `${from} 12:64 ApexClass:micro#method:area() call probable`,
      `${from} 12:64 ApexClass:shape#method:area() call confirmed`,
      `${from} 12:64 ApexClass:square#method:area() call probable`,
      `${from} 12:64 ApexClass:tiny#method:area() call probable`,
      // A value of a class and one of no known type are of no known class, so the variable is of the type it declares.
      `${from} 13:30 ApexClass:square new confirmed`,
      `${from} 13:49 ApexClass:factory call confirmed make`,
      `${from} 13:59 ApexClass:circle#method:area() call probable`,
      `${from} 13:59 ApexClass:micro#method:area() call probable`,
      `${from} 13:59 ApexClass:shape#method:area() call confirmed`,
      `${from} 13:59 ApexClass:square#method:area() call probable`,
      `${from} 13:59 ApexClass:tiny#method:area() call probable`,
      `${from} 14:32 ApexClass:circle new confirmed`,
      `${from} 14:44 ApexClass:circle#method:area() call probable`,
      `${from} 14:44 ApexClass:micro#method:area() call probable`,
      `${from} 14:44 ApexClass:shape#method:area() call confirmed`,
      `${from} 14:44 ApexClass:square#method:area() call probable`,
      `${from} 14:44 ApexClass:tiny#method:area() call probable`,
      // A cast to a class keeps the class, not the type of what it casts.
      `${from} 15:36 ApexClass:micro#method:area() call probable`,
      `${from} 15:36 ApexClass:square#method:area() call confirmed`,
      `${from} 15:36 ApexClass:tiny#method:area() call probable`,
      // `super` calls the method of the class it extends, and none that overrides it below.
      'ApexClass:tiny#method:area() 2:50 ApexClass:square#method:area() call confirmed',
    ]);
    expect(analysis.issues.map((one) => one.code)).toEqual(['APEX_NO_CODE']);
  });

  it('takes the types of Salesforce, a cast, a class literal, a field that get reads and the name of an enum value', () => {
    const analysis = analysed((source) => {
      source.apexClass('Level', code('public enum Level { LOW, HIGH }'));
      source.apexClass(
        'Log',
        code(
          'public class Log {',
          '    public void add(Database.SaveResult r) {}',
          '    public void add(Database.DeleteResult r) {}',
          '    public void err(String m, Exception e) {}',
          '    public void err(String m, Database.SaveResult r) {}',
          '    public void put(List<SObject> rows) {}',
          '    public void put(List<Invoice__c> rows) {}',
          '    public void rec(Id id) {}',
          '    public void rec(SObject one) {}',
          '    public void kind(Type t) {}',
          '    public void kind(List<Type> ts) {}',
          '    public void text(Object o) {}',
          '    public void text(String s) {}',
          '    public void desc(Schema.SObjectType t) {}',
          '    public void desc(String name) {}',
          '    public void level(Level lv) {}',
          '    public void level(String lv) {}',
          '    public void note(Set<Id> ids, String m) {}',
          '    public void note(Set<String> ids, String m) {}',
          '    void m(System.Database.SaveResult saved, List<Invoice__c> rows, Map<String, Object> input, Invoice__c inv, Level lv) {',
          '        add(saved);',
          "        try { add(saved); } catch (System.Exception e) { err('x', e); }",
          '        put((List<SObject>) rows); put(rows);',
          "        rec((String) input.get('id'));",
          '        kind(Invoice__c.class);',
          "        text(inv.get('Status__c'));",
          '        desc(inv.getSObjectType());',
          '        level(lv.name()); level(lv); level(Level.values()[0]);',
          '        note(new Set<Id>(), inv.Status__c); text(Label.Saved); text(System.Label.Saved);',
          '    }',
          '}',
        ),
      );
    });
    const from = 'ApexClass:log#method:m(database.saveresult,list<invoice__c>,map<string,object>,invoice__c,level)';
    const to = (sub: string): string => `ApexClass:log#method:${sub}`;
    expect(called(analysis)).toEqual([
      // A type of Salesforce of a namespace fits itself, and the one that fits as it is is chosen over others, of
      // which it is not known whether they take it.
      `${from} 21:9 ${to('add(database.saveresult)')} call confirmed`,
      `${from} 22:15 ${to('add(database.saveresult)')} call confirmed`,
      `${from} 22:58 ${to('err(string,exception)')} call confirmed`,
      // A cast says the type an overload is chosen by.
      `${from} 23:9 ${to('put(list<sobject>)')} call confirmed`,
      `${from} 23:36 ${to('put(list<invoice__c>)')} call confirmed`,
      // A text can be an `Id`, and is no record.
      `${from} 24:9 ${to('rec(id)')} call confirmed`,
      `${from} 25:9 ${to('kind(type)')} call confirmed`,
      // `get` of a record gives an `Object`.
      `${from} 26:9 ${to('text(object)')} call confirmed`,
      `${from} 27:9 ${to('desc(schema.sobjecttype)')} call confirmed`,
      `${from} 28:9 ${to('level(string)')} call confirmed`,
      `${from} 28:27 ${to('level(level)')} call confirmed`,
      `${from} 28:38 ${to('level(level)')} call confirmed`,
      // A parameter that both take as a text does not tell them apart, and a custom label is a text.
      `${from} 29:9 ${to('note(set<id>,string)')} call confirmed`,
      `${from} 29:45 ${to('text(string)')} call confirmed`,
      `${from} 29:64 ${to('text(string)')} call confirmed`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('knows the types that choose an overload: of a class, an enum, a text, a date, a collection and an operation', () => {
    const analysis = analysed((source) => {
      source.apexClass('Level', code('public enum Level { LOW, HIGH }'));
      source.apexClass('Base', code('public virtual class Base {', '}'));
      source.apexClass('Child', code('public class Child extends Base {', '}'));
      source.apexClass(
        'Nightly',
        code(
          'public class Nightly implements Schedulable {',
          '    public void execute(SchedulableContext ctx) {}',
          '}',
        ),
      );
      source.apexClass(
        'Pick',
        code(
          'public class Pick {',
          '    public void base(Base b) {}',
          '    public void base(String s) {}',
          '    public void num(Integer n) {}',
          '    public void num(String s) {}',
          '    public void lvl(Level l) {}',
          '    public void lvl(String s) {}',
          '    public void text(Object o) {}',
          '    public void text(String s) {}',
          '    public void at(Datetime t) {}',
          '    public void at(String s) {}',
          '    public void walk(Iterable<Invoice__c> rows) {}',
          '    public void walk(List<Invoice__c> rows) {}',
          '    public void keyed(Map<Id, Invoice__c> rows) {}',
          '    public void keyed(Map<Id, Account> rows) {}',
          '    public Integer pair(Integer n) { return n; }',
          '    public String pair(Long n) { return null; }',
          '    public void flag(Boolean b) {}',
          '    public void flag(String s) {}',
          '    public void tok(Schema.SObjectType t) {}',
          '    public void tok(String s) {}',
          '    void m(Level lv, Date d, List<Invoice__c> rows, Map<Id, Invoice__c> byId, Invoice__c inv, String s, List<String> names, PermissionSet ps) {',
          '        base(new Child()); Schedulable job = new Nightly(); job.execute(null);',
          "        num(lv.ordinal()); lvl(Level.valueOf('LOW'));",
          "        text(String.format('{0}', names)); text(String.join(names, ','));",
          '        at(d); at(d + 1);',
          '        walk(rows); keyed(byId);',
          '        num(pair(inv.Amount__c)); flag(!String.isBlank(s)); tok(Invoice__c.getSObjectType());',
          '        obj(ps); two(null, s);',
          '    }',
          '    public void obj(SObject o) {}',
          '    public void obj(String s) {}',
          '    public void two(String a, String b) {}',
          '    public void two(Id a, Id b) {}',
          '}',
        ),
      );
    });
    const from =
      'ApexClass:pick#method:m(level,date,list<invoice__c>,map<id,invoice__c>,invoice__c,string,list<string>,permissionset)';
    const to = (sub: string): string => `ApexClass:pick#method:${sub}`;
    expect(called(analysis)).toEqual([
      // An object of a class fits a class it extends, and a variable of an interface of Salesforce runs the class of
      // the object it is given.
      `${from} 23:9 ${to('base(base)')} call confirmed`,
      `${from} 23:18 ApexClass:child new confirmed`,
      `${from} 23:50 ApexClass:nightly new confirmed`,
      `${from} 23:65 ApexClass:nightly#method:execute(schedulablecontext) call confirmed`,
      // `ordinal()` of an enum is a number, `valueOf` a value of the enum, and `format` and `join` of `String` texts.
      `${from} 24:9 ${to('num(integer)')} call confirmed`,
      `${from} 24:28 ${to('lvl(level)')} call confirmed`,
      `${from} 25:9 ${to('text(string)')} call confirmed`,
      `${from} 25:44 ${to('text(string)')} call confirmed`,
      // A date fits a time, and a date with a number is a date.
      `${from} 26:9 ${to('at(datetime)')} call confirmed`,
      `${from} 26:16 ${to('at(datetime)')} call confirmed`,
      // A list fits an `Iterable` as a wider type, and a map the map of its types.
      `${from} 27:9 ${to('walk(list<invoice__c>)')} call confirmed`,
      `${from} 27:21 ${to('keyed(map<id,invoice__c>)')} call confirmed`,
      // Methods that give back types of their own give a value of no known type.
      `${from} 28:9 ${to('num(integer)')} call probable`,
      `${from} 28:9 ${to('num(string)')} call probable`,
      `${from} 28:13 ${to('pair(integer)')} call probable`,
      `${from} 28:13 ${to('pair(long)')} call probable`,
      // `!` gives a Boolean, and `getSObjectType()` of an object its token.
      `${from} 28:35 ${to('flag(boolean)')} call confirmed`,
      `${from} 28:61 ${to('tok(schema.sobjecttype)')} call confirmed`,
      // A type of Salesforce that is no object the analysis knows can be one, and no text. `null` makes no method
      // more specific, so where a text may be an `Id` it is not known which is chosen.
      `${from} 29:9 ${to('obj(sobject)')} call confirmed`,
      `${from} 29:18 ${to('two(id,id)')} call probable`,
      `${from} 29:18 ${to('two(string,string)')} call probable`,
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('calls the constructor that a new chooses, or the class where it declares none', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Made',
        code(
          'public class Made {',
          '    public Made() {}',
          '    public Made(String name) { this(); }',
          "    public Made(Integer size) { this('x'); }",
          '}',
        ),
      );
      source.apexClass('Plain', code('public class Plain {', '}'));
      source.apexClass('Parent', code('public virtual class Parent {', '    public Parent(Integer n) {}', '}'));
      source.apexClass('Kid', code('public class Kid extends Parent {', '    public Kid() { super(1); }', '}'));
      source.apexClass('Bare', code('public virtual class Bare {', '}'));
      source.apexClass('OnBare', code('public class OnBare extends Bare {', '    public OnBare() { super(); }', '}'));
      source.apexClass(
        'Maker',
        code(
          'public class Maker {',
          '    public class Inner {}',
          '    Plain kept = new Plain();',
          '    void m() {',
          "        Made a = new Made(); Made b = new Made('n'); Made c = new Made(3);",
          '        Inner i = new Inner(); Maker.Inner j = new Maker.Inner();',
          '        List<Plain> l = new List<Plain>(); Http h = new Http(); Account acc = new Account();',
          '        new Made().toString();',
          '    }',
          '}',
        ),
      );
      source.apexTrigger(
        'OnInvoice',
        code(
          'trigger OnInvoice on Invoice__c (before insert) {',
          '    class Totals {}',
          '    Totals t = new Totals();',
          '}',
        ),
      );
    });
    expect(called(analysis)).toEqual([
      'ApexClass:kid#ctor:() 2:20 ApexClass:parent#ctor:(integer) call confirmed',
      'ApexClass:made#ctor:(integer) 4:33 ApexClass:made#ctor:(string) call confirmed',
      'ApexClass:made#ctor:(string) 3:32 ApexClass:made#ctor:() call confirmed',
      'ApexClass:maker#method:m() 5:22 ApexClass:made#ctor:() new confirmed',
      'ApexClass:maker#method:m() 5:43 ApexClass:made#ctor:(string) new confirmed',
      'ApexClass:maker#method:m() 5:67 ApexClass:made#ctor:(integer) new confirmed',
      'ApexClass:maker#method:m() 6:23 ApexClass:maker#inner:inner new confirmed',
      'ApexClass:maker#method:m() 6:52 ApexClass:maker#inner:inner new confirmed',
      'ApexClass:maker#method:m() 8:13 ApexClass:made#ctor:() new confirmed',
      'ApexClass:maker#var:kept 3:22 ApexClass:plain new confirmed',
      // A class that declares no constructor is called itself, also by `super()`.
      'ApexClass:onbare#ctor:() 2:23 ApexClass:bare call confirmed',
      'ApexTrigger:oninvoice 3:20 ApexTrigger:oninvoice#inner:totals new confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('calls an exception for the constructors that every exception has, beside those it declares', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Failed',
        code(
          'public virtual class Failed extends Exception {',
          '    public Failed(Integer code) { this(String.valueOf(code)); }',
          '    public Failed(String m, Integer code) { this(m); }',
          '}',
        ),
      );
      source.apexClass(
        'Worse',
        code('public class Worse extends Failed {', "    public Worse(Boolean b) { super('x'); }", '}'),
      );
      source.apexClass(
        'Coded',
        code('public class Coded extends Exception {', '    public Coded(String m, Integer code) {}', '}'),
      );
      source.apexClass('Named', code('public class Named extends Exception {', '    public Named(String m) {}', '}'));
      source.apexClass(
        'Raises',
        code(
          'public class Raises {',
          '    void m(Exception cause) {',
          "        Exception a = new Failed('text'); Exception b = new Failed(1); Exception c = new Failed(cause);",
          "        Exception d = new Failed('m', 2); Exception e = new Failed('m', cause); Exception f = new Worse('x');",
          "        Exception g = new Coded(cause.getMessage()); Exception h = new Named('m');",
          '    }',
          '}',
        ),
      );
    });
    const from = 'ApexClass:raises#method:m(exception)';
    expect(called(analysis)).toEqual([
      // A message, a cause, or both choose a constructor of Salesforce, which calls the class.
      `${from} 3:27 ApexClass:failed new confirmed`,
      `${from} 3:61 ApexClass:failed#ctor:(integer) new confirmed`,
      `${from} 3:90 ApexClass:failed new confirmed`,
      `${from} 4:27 ApexClass:failed#ctor:(string,integer) new confirmed`,
      `${from} 4:61 ApexClass:failed new confirmed`,
      `${from} 4:99 ApexClass:worse new confirmed`,
      // `this(message)` of an exception calls a constructor of Salesforce, and `super(message)` the class it extends.
      // Whichever constructor of Salesforce the arguments choose, it calls the class, and one the exception declares
      // stands for the one of Salesforce of its signature.
      `${from} 5:27 ApexClass:coded new confirmed`,
      `${from} 5:72 ApexClass:named#ctor:(string) new confirmed`,
      'ApexClass:worse#ctor:(boolean) 2:31 ApexClass:failed call confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('calls a class whose code is not there by its name, and names the method', () => {
    const analysis = analysed((source) => {
      source.apexClass('Hidden', '(hidden)');
      source.apexClass('ns__Packaged', '(hidden)');
      source.apexClass(
        'OnHidden',
        code(
          'public class OnHidden extends Hidden {',
          '    public OnHidden() { super(1); }',
          '    void x() { super.go(); }',
          '}',
        ),
      );
      source.apexClass('Broken', code('public class Broken {', '    void x( {', '}'));
      source.apexClass('ns__Open', code('public class Open {', '    public static void go() {}', '}'));
      // A variable of the name of the prefix is a variable.
      source.apexClass(
        'KeepsNs',
        code('public class KeepsNs {', '    Object ns;', '    void n() { ns.Packaged.start(); }', '}'),
      );
      source.apexClass(
        'UsesHidden',
        code(
          'public class UsesHidden {',
          '    void m() {',
          '        Hidden.run(); Hidden h = new Hidden(); h.go(1);',
          '        ns.Packaged.start(); ns.Packaged p = new ns.Packaged(); p.stop();',
          '        Unknown.run(); other.Packaged.start();',
          '        Broken.run(); ns.Open.go();',
          '    }',
          '    void n(Object ns) { ns.Packaged.start(); }',
          '}',
        ),
      );
    });
    const from = 'ApexClass:useshidden#method:m()';
    expect(called(analysis)).toEqual([
      // `super` of a class whose code is not read calls the class.
      'ApexClass:onhidden#ctor:() 2:25 ApexClass:hidden call confirmed',
      'ApexClass:onhidden#method:x() 3:22 ApexClass:hidden call confirmed go',
      `${from} 3:16 ApexClass:hidden call confirmed run`,
      `${from} 3:38 ApexClass:hidden new confirmed`,
      `${from} 3:50 ApexClass:hidden call confirmed go`,
      `${from} 4:21 ApexClass:ns__packaged call confirmed start`,
      `${from} 4:50 ApexClass:ns__packaged new confirmed`,
      `${from} 4:67 ApexClass:ns__packaged call confirmed stop`,
      // A class that the parser cannot read is called as one whose code is not there.
      `${from} 6:16 ApexClass:broken call confirmed run`,
      // A class of a package whose code is read is named so too.
      `${from} 6:31 ApexClass:ns__open#method:go() call confirmed`,
    ]);
    // Code names a class of a managed package after the prefix of its namespace, as a type too.
    const uses = analysis.components
      .filter((one) => one.key === from)
      .flatMap((one) => one.references)
      .filter((one) => one.kind === 'uses-type')
      .map((one) => `${String(one.location?.line)}:${String(one.location?.column)} ${String(one.to)}`);
    expect(uses).toEqual(['3:23 ApexClass:hidden', '4:30 ApexClass:ns__packaged']);
    expect(analysis.issues.map((one) => one.code).sort()).toEqual(['APEX_MALFORMED', 'APEX_NO_CODE', 'APEX_NO_CODE']);
  });

  it('reads an enum where code names a value of it, also in a switch on it', () => {
    const analysis = analysed((source) => {
      source.apexClass('Color', code('public enum Color {', '    RED, GREEN', '}'));
      source.apexClass(
        'Modes',
        code(
          'public class Modes {',
          '    public enum Mode { FAST, SAFE }',
          '    static Integer FAST = 1;',
          '    void m(Mode mo, Color co) {',
          '        Mode a = Mode.FAST; Color c = Color.RED; Integer n = Modes.FAST; Integer o = Mode.values().size();',
          '        switch on mo {',
          '            when FAST { }',
          '            when SAFE { }',
          '            when else { }',
          '        }',
          '        switch on co { when RED, GREEN { } }',
          '        switch on Trigger.operationType { when BEFORE_INSERT { } }',
          '        switch on n { when 1, 2 { } when null { } }',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis)).toEqual([
      '5:23 reads ApexClass:modes#inner:mode [FAST] field confirmed resolved',
      '5:45 reads ApexClass:color [RED] field confirmed resolved',
      '5:68 reads ApexClass:modes#var:fast [FAST] field confirmed resolved',
      // A value of an enum stands alone after `when`, also beside a variable of its name.
      '7:18 reads ApexClass:modes#inner:mode [FAST] field confirmed resolved',
      '8:18 reads ApexClass:modes#inner:mode [SAFE] field confirmed resolved',
      '11:29 reads ApexClass:color [RED] field confirmed resolved',
      '11:34 reads ApexClass:color [GREEN] field confirmed resolved',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('calls in what a query binds, and not itself, a method of Salesforce or a value of no known class', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Misc',
        code(
          'public class Misc {',
          '    public class Oops extends Exception {}',
          '    static Set<Id> ids() { return null; }',
          '    static Integer depth(Integer n) { return n == 0 ? 0 : depth(n - 1); }',
          '    public class Inner {',
          '        void m() { ids(); }',
          '    }',
          '    void m(Oops e, Object o) {',
          '        List<Account> a = [SELECT Id FROM Account WHERE Id IN :ids()];',
          '        String s = e.getMessage() + o.toString();',
          '        new Http().send(null);',
          "        throw new Oops('x');",
          '    }',
          '}',
        ),
      );
    });
    expect(called(analysis)).toEqual([
      'ApexClass:misc#inner:inner/method:m() 6:20 ApexClass:misc#method:ids() call confirmed',
      // A call that a query binds is a call.
      'ApexClass:misc#method:m(misc.oops,object) 9:64 ApexClass:misc#method:ids() call confirmed',
      // A class that declares no constructor is called itself, also where the class it extends has some.
      'ApexClass:misc#method:m(misc.oops,object) 12:19 ApexClass:misc#inner:oops new confirmed',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('reads a query that the code builds as a text, each name where the code writes it, and follows its branches', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Texts',
        code(
          'public class Texts {',
          "    static final String FIELDS = 'Amount__c, Status__c';",
          "    static String objectName() { return 'Invoice__c'; }",
          '    void m(Boolean late) {',
          "        String q = 'SELECT Id, ' + FIELDS;",
          "        q += ' FROM ' + objectName();",
          '        if (late) {',
          "            q += ' WHERE Account__r.Name != null';",
          '        } else {',
          "            q += ' WHERE Status__c = \\'Paid\\'';",
          '        }',
          '        List<SObject> rows = Database.query(q);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // The names of a constant stand where the member uses it, and so do those of a text a method gives back.
      '5:36 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '5:36 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '6:25 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      // Each branch adds its own text, and the query can be either.
      '8:26 reads CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '8:37 reads CustomField:account.name [Name] text probable external',
      '10:26 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([]);
  });

  it('follows a text through the branches of the code, and not past a branch that returns', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Ways',
        code(
          'public class Ways {',
          '    void m(Invoice__c inv, Boolean b, List<Integer> items, String other) {',
          "        String name = 'Amount__c';",
          "        if (b) { name = 'Status__c'; return; }",
          '        Object one = inv.get(name);',
          "        for (Integer i : items) { name = 'Account__c'; }",
          '        Object two = inv.get(name);',
          "        try { name = 'Name'; } catch (Exception e) { name += ''; }",
          '        Object three = inv.get(name);',
          '        switch on other {',
          "            when 'a' { name = 'Id'; }",
          '        }',
          '        Object four = inv.get(name);',
          '        name = other;',
          '        Object five = inv.get(name);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // `Status__c` is the text only in a branch that returns, so it is read nowhere.
      '3:24 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      // A loop runs once or not at all, and a clause of a `try` can start before or after the block.
      '6:43 reads CustomField:invoice__c.account__c [Account__c] text probable resolved',
      '8:23 reads CustomField:invoice__c.name [Name] text probable external',
      // A text that is not known names a field of the object, which is not known either.
      '15:31 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([]);
  });

  it('reads the names that get, put and their relatives, the map of fields and the describe calls are given', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'ByName',
        code(
          'public class ByName {',
          '    void m(Invoice__c inv, SObject any, String field) {',
          "        Object a = inv.get('Amount__c');",
          "        inv.put('Status__c', 'Paid');",
          "        SObject acc = inv.getSObject('Account__r');",
          "        Object n = acc.get('Name');",
          "        inv.putSObject('Account__r', null);",
          "        List<SObject> lines = inv.getSObjects('Lines__r');",
          '        Object b = inv.get(field);',
          "        Object c = any.get('Amount__c');",
          '        Object d = any.get(field);',
          "        Schema.SObjectField f = Schema.SObjectType.Invoice__c.fields.getMap().get('Status__c');",
          '        Schema.SObjectField g = Invoice__c.SObjectType.getDescribe().fields.getMap().get(field);',
          "        Schema.SObjectType t = Schema.getGlobalDescribe().get('Invoice__c');",
          '        Schema.SObjectType u = Schema.getGlobalDescribe().get(field);',
          "        List<Schema.DescribeSObjectResult> r = Schema.describeSObjects(new List<String>{ 'Account', field });",
          '        List<Schema.DescribeSObjectResult> s = Schema.describeSObjects(new List<String>(any.getPopulatedFieldsAsMap().keySet()));',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      '3:29 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '4:18 writes CustomField:invoice__c.status__c [Status__c] text probable resolved',
      // A relationship by its name, and what is read of the record it leads to.
      '5:39 reads CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '6:29 reads CustomField:account.name [Name] text probable external',
      '7:25 writes CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '9:28 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '12:84 references CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '13:90 references CustomObject:invoice__c [Invoice__c] text possible resolved',
      '14:64 references CustomObject:invoice__c [Invoice__c] text probable resolved',
      '16:91 references CustomObject:account [Account] text probable external',
    ]);
    expect(warned(analysis.issues)).toEqual([
      // A child relationship nothing defines, of a record of no known object, and of a name of no known field.
      'PATH_NOT_FOLLOWED 8:48 {"relationship":"Lines__r","notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 10:29 {"notFollowed":["Amount__c"],"endsAt":"field","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 11:28 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      // An object of no known name, also in a list that the code does not write out.
      'PATH_NOT_FOLLOWED 15:63 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 16:101 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 17:76 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
    ]);
  });

  it('reads a text that a method gives back with what each call gives for its parameters, and a class a text names', () => {
    const analysis = analysed((source) => {
      source.apexClass('Handler', 'public class Handler { }\n');
      source.apexClass(
        'Queries',
        code(
          'public class Queries {',
          "    public static final String OBJ = 'Invoice__c';",
          "    static final String HANDLER = 'Handler';",
          "    static String select(String fields) { return 'SELECT ' + fields + ' FROM ' + OBJ; }",
          '    void m(String f) {',
          "        List<SObject> a = Database.query(select('Amount__c'));",
          '        List<SObject> b = Database.query(select(f));',
          "        String names = String.join(new List<String>{ 'Amount__c', 'Status__c' }, ', ');",
          "        List<SObject> c = Database.query('SELECT ' + names + ' FROM Invoice__c');",
          "        String format = 'SELECT {0} FROM {1} WHERE Name = \\'\\'{2}\\'\\'';",
          "        List<SObject> d = Database.query(String.format(format, new List<Object>{ 'Status__c', OBJ, f }));",
          "        List<SObject> e = Database.query('SELECT Id FROM ' + OBJ.toLowerCase() + ' WHERE Name = \\'' + String.escapeSingleQuotes(f) + '\\'');",
          '        Type one = Type.forName(HANDLER);',
          '        Type two = Type.forName(f);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // The text of the method stands at the call, and what a call gives for a parameter where it gives it.
      '6:42 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '6:50 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '7:42 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '7:49 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      // The items of a list that is joined, and of one that a format is given. Two quotes are one in a format.
      '8:55 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '8:68 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '9:69 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '10:52 reads CustomField:invoice__c.name [Name] text probable external',
      '11:83 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '11:95 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      // A text in other letters, and a value in quotes, which names nothing.
      '12:62 reads CustomObject:invoice__c [invoice__c] text probable resolved',
      '12:90 reads CustomField:invoice__c.name [Name] text probable external',
      '13:33 uses-type ApexClass:handler [Handler] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 14:33 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('fills what is not known of a query by what stands around it, and says where it cannot follow one', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Holes',
        code(
          'public class Holes {',
          '    void m(String f, String ns, Integer n, String cond, String dir) {',
          "        List<SObject> a = Database.query('SELECT ' + f + ' FROM Invoice__c');",
          "        List<SObject> b = Database.query('SELECT Id FROM Invoice__c WHERE ' + cond);",
          "        List<SObject> c = Database.query('SELECT Id FROM Invoice__c WHERE Status__c = ' + f + ' LIMIT ' + n);",
          "        List<SObject> d = Database.query('SELECT Id FROM Invoice__c WHERE ' + ns + '__Amount__c > 0');",
          "        List<SObject> e = Database.query('SELECT Id FROM Invoice__c ORDER BY Status__c ' + dir);",
          "        List<SObject> g = Database.query('SELECT Amount__c FROM ' + f + ' WHERE Status__c = null');",
          "        List<SObject> h = Database.query('SELECT Id, (SELECT Id FROM ' + f + ') FROM Invoice__c');",
          "        List<SObject> i = Database.query('SELECT Id FROM Invoice__c WHERE');",
          '        List<SObject> j = Database.query(f);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // A field of the select list, a condition and a prefix of a name: each a field of the object.
      '3:54 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '3:65 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '4:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '4:79 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      // A value, a number and a direction name nothing.
      '5:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '5:75 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '6:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '6:79 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '7:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '7:78 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '9:86 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      // A text that is no query: the object after `FROM` is read, with what is not known of it.
      '10:58 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([
      // The object of a query, the child relationship of a subquery and a whole query that are not known.
      'PATH_NOT_FOLLOWED 8:69 {"notFollowed":["Amount__c","Status__c"],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 9:74 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 11:42 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('reads a search built as a text, and what a query of a text binds unless the code hands the binds over', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Searches',
        code(
          'public class Searches {',
          '    Decimal least;',
          '    void m(String term) {',
          "        List<List<SObject>> s = Search.query('FIND :term RETURNING Invoice__c(Amount__c WHERE Status__c = :term)');",
          "        List<SObject> a = Database.query('SELECT Id FROM Invoice__c WHERE Amount__c > :least');",
          "        Map<String, Object> binds = new Map<String, Object>{ 'least' => least };",
          "        List<SObject> b = Database.queryWithBinds('SELECT Id FROM Invoice__c WHERE Amount__c > :least', binds, AccessLevel.USER_MODE);",
          '        List<List<SObject>> c = Search.query(term);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, new Set(['text', 'field']))).toEqual([
      '4:68 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '4:79 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '4:95 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '5:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '5:75 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      // What the query binds is read as code, with the via of the text.
      '5:88 reads ApexClass:searches#var:least [least] text probable resolved',
      // The binds of `queryWithBinds` are the map the code hands over, which is read as code.
      '6:73 reads ApexClass:searches#var:least [least] field confirmed resolved',
      '7:67 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '7:84 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 8:46 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('reads a search in braces, and a token that a text names as a name in a text, also in get, put and upsert', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Braces',
        code(
          'public class Braces {',
          '    void m(Invoice__c inv, String term, List<Invoice__c> rows) {',
          "        List<List<SObject>> a = Search.query('FIND {Acme} IN ALL FIELDS RETURNING Invoice__c(Amount__c)');",
          "        List<List<SObject>> b = Search.query('FIND {' + term + '} RETURNING Invoice__c(Status__c)');",
          "        Object c = inv.get(Schema.SObjectType.Invoice__c.fields.getMap().get('Amount__c'));",
          "        Schema.SObjectField f = Schema.SObjectType.Invoice__c.fields.getMap().get('Status__c');",
          "        inv.put(f, 'Paid');",
          '        Database.upsert(rows, f);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, new Set([...VIAS, 'text']))).toEqual([
      // The braces of a search hold its words, whether the code knows them or not.
      '3:83 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '3:94 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '4:77 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '4:88 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      // A token that a text names is a name in a text where the code reads or writes it: where the text stands, or
      // where the code uses the token.
      '5:47 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '5:79 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '6:52 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '6:84 references CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '7:17 writes CustomField:invoice__c.status__c [f] text probable resolved',
      '8:18 writes CustomObject:invoice__c [Invoice__c] dml confirmed resolved upsert',
      '8:31 references CustomField:invoice__c.status__c [f] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([]);
  });

  it('keeps what a branch knows of a text where another way does not know it, and a null names nothing', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Nulls',
        code(
          'public class Nulls {',
          "    static String pick(Boolean b) { if (b) return null; return 'Amount__c'; }",
          '    void m(Invoice__c inv, Boolean b, String other) {',
          "        String q = 'SELECT Id FROM Invoice__c';",
          '        if (b) q = inv.Account__r.Name;',
          '        List<SObject> a = Database.query(q);',
          '        String w;',
          "        if (b) w = ' WHERE Amount__c > 0';",
          "        List<SObject> c = Database.query('SELECT Id FROM Invoice__c' + w);",
          '        String n = null;',
          "        List<SObject> d = Database.query('SELECT Status__c FROM Invoice__c' + n);",
          '        Object e = inv.get(pick(b));',
          '        Object g = inv.get(null);',
          '        Integer i = 5;',
          '        i++;',
          "        Object h = inv.get('Field' + i + '__c');",
          '        Integer k = 1;',
          '        k += 2;',
          "        Object l = inv.get('Field' + k + '__c');",
          "        Object o = inv.get(-k + '__c');",
          '        Integer m = 3;',
          "        Object p = inv.get('Field' + -m + '__c');",
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // The way that knows the text is read, and a warning stands for the other.
      '4:36 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      // A variable that is null adds nothing, and a method that gives null gives its other text.
      '8:28 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '9:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '11:50 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '11:65 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '12:28 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      // A number that the code works out with `++`, `+=` or `-` is not known.
      '16:38 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '19:38 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '20:29 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '22:39 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 6:42 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('reads each body of a property, a clause of a try from where its block stops, and do once at least', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Bodies',
        code(
          'public class Bodies {',
          '    Invoice__c inv;',
          '    public Object v {',
          '        get { return null; }',
          "        set { String f = 'Amount__c'; if (value != null) { f = 'Status__c'; } Object x = inv.get(f); }",
          '    }',
          '    void m(Boolean b) {',
          "        String f = 'Amount__c';",
          '        try {',
          "            f = 'Status__c';",
          "            f = 'Name';",
          '            m(b);',
          '        } catch (Exception e) {',
          '            Object x = inv.get(f);',
          '        }',
          "        String g = 'Amount__c';",
          '        try {',
          '            return;',
          '        } catch (Exception e) {',
          "            g = 'Status__c';",
          '        }',
          '        Object y = inv.get(g);',
          '    }',
          '    void n(Boolean b) {',
          "        String f = 'Amount__c';",
          "        do { f = 'Status__c'; } while (b);",
          '        Object x = inv.get(f);',
          "        String g = 'Amount__c';",
          "        while (b) { g = 'Status__c'; }",
          '        Object y = inv.get(g);',
          "        String h = 'Amount__c';",
          "        for (Integer i = 0; i < 2; i++) { h = 'Status__c'; }",
          '        Object z = inv.get(h);',
          "        String s = 'Amount__c';",
          '        switch on s {',
          "            when 'a' { s = 'Status__c'; }",
          "            when else { s = 'Name'; }",
          '        }',
          '        Object w = inv.get(s);',
          "        String t = 'Amount__c';",
          "        if (b) { t = 'Status__c'; throw new IllegalArgumentException(); }",
          '        Object u = inv.get(t);',
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // A clause of a try starts from the texts before the block or after any statement of it: here each of three.
      '8:21 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '10:18 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '11:18 reads CustomField:invoice__c.name [Name] text probable external',
      // A block that returns goes on only in its clause.
      '20:18 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      // `do` runs its body once at least, `while` and `for` once or not at all.
      '26:19 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '28:21 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '29:26 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '31:21 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '32:48 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      // A switch with `when else` runs one of its ways, and a way that throws does not go on.
      '36:29 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '37:30 reads CustomField:invoice__c.name [Name] text probable external',
      '40:21 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      // The setter starts with nothing of the getter, which returns.
      '5:27 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '5:65 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([]);
  });

  it('reads the methods of a text, a ternary, a cast, overrides that give a text, and more than a value can be', () => {
    const analysis = analysed((source) => {
      source.apexClass('Base', "public virtual class Base { public virtual String name() { return 'Amount__c'; } }\n");
      source.apexClass(
        'Child',
        "public class Child extends Base { public override String name() { return 'Status__c'; } }\n",
      );
      source.apexClass(
        'Methods',
        code(
          'public class Methods {',
          '    void m(Invoice__c inv, Boolean a, Boolean b, Boolean c, Boolean d, Boolean e, String f, Base base) {',
          "        Object o1 = inv.get(' Amount__c '.trim());",
          "        Object o2 = inv.get('status__c'.toUpperCase());",
          "        Object o3 = inv.get('Amount__cX'.removeEnd('X'));",
          "        Object o4 = inv.get('XStatus__c'.removeStart('X'));",
          "        Object o5 = inv.get(String.valueOf('Amount__c'));",
          "        Object o6 = inv.get(String.escapeSingleQuotes('Status__c'));",
          "        Object o7 = inv.get(a ? 'Amount__c' : 'Status__c');",
          "        Object o8 = inv.get(f ?? 'Status__c');",
          "        Object o9 = inv.get((String) 'Amount__c');",
          '        Object o10 = inv.get(base.name());',
          "        String many = 'SELECT Id FROM Invoice__c WHERE Id != null';",
          "        if (a) many += ' AND Amount__c > 0';",
          "        if (b) many += ' AND Status__c = null';",
          "        if (c) many += ' AND Account__c = null';",
          "        if (d) many += ' AND Name = null';",
          "        if (e) many += ' AND Id = null';",
          '        List<SObject> o11 = Database.query(many);',
          "        Object o12 = inv.Account__r.get('Na' + f);",
          "        Object o13 = inv.Thing__r.get('Na' + f);",
          "        Object o14 = inv.get('' + + 'Amount__c');",
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      '3:31 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '4:30 reads CustomField:invoice__c.status__c [STATUS__C] text probable resolved',
      '5:30 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '6:31 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '7:45 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '8:56 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '9:34 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '9:48 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '10:29 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '10:35 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '11:39 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      // Each override that the value can run gives its text, at the call.
      '12:35 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '12:35 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      // Of a value of more texts than are followed, the first are read, and a warning stands for the others.
      '13:39 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '14:30 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '15:30 reads CustomField:invoice__c.status__c [Status__c] text probable resolved',
      '16:30 reads CustomField:invoice__c.account__c [Account__c] text probable resolved',
      '17:30 reads CustomField:invoice__c.name [Name] text probable external',
      '20:48 reads CustomObject:account [Account] text possible external',
      // `+` before a text changes nothing.
      '22:38 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 19:44 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      // A text put together with `+` is a text that `get` of a record takes, so the relationship is a lookup.
      'RELATIONSHIP_GUESSED 21:26 {"relationship":"Thing__r","object":"Invoice__c","field":"Thing__c"}',
      'PATH_NOT_FOLLOWED 21:46 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('reads what a query of an object it does not know names, and a text it cannot read as a query', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Unread',
        code(
          'public class Unread {',
          '    Decimal least;',
          '    void m(String f, String rel, String obj, Boolean b) {',
          "        List<SObject> a = Database.query('SELECT Amount__c, (SELECT Status__c FROM Lines__r) FROM ' + f);",
          "        List<SObject> c = Database.query('SELECT Id, (SELECT Id FROM Account) FROM Invoice__c WHERE');",
          "        List<SObject> d = Database.query('SELECT Id FROM');",
          "        List<SObject> e = Database.query('SELECT Id FROM ' + f + ' WHERE');",
          "        List<SObject> g = Database.query('SELECT Id FROM Nothing__c WHERE');",
          "        String tail = b ? ' FROM Invoice__c' : ' FROM';",
          "        List<SObject> h = Database.query('SELECT ' + f + tail);",
          "        String w = b ? ' WHERE Amount__c > 0' : ' WHERE';",
          "        List<SObject> i = Database.query('SELECT Id FROM Invoice__c' + w);",
          "        List<SObject> j = Database.query('SELECT TYPEOF ' + rel + ' WHEN Account THEN Name END FROM Invoice__c');",
          "        List<SObject> k = Database.query('SELECT Account__r.' + f + ' FROM Invoice__c');",
          "        List<List<SObject>> l = Search.query('FIND \\'x\\' RETURNING ' + obj + '(Name)');",
          "        List<List<SObject>> n = Search.query('FIND :f RETURNING Invoice__c(Id WHERE Amount__c > :least)');",
          "        Object o = ((SObject) null).get('Id');",
          "        List<SObject> p = Database.query('SELECT TYPEOF What WHEN Account THEN Name END FROM ' + obj);",
          "        List<SObject> q = Database.query('SELECT Id, (SELECT ' + f + ', Name FROM Things__r) FROM Invoice__c');",
          '    }',
          '}',
        ),
      );
    });
    expect(said(analysis, TEXT)).toEqual([
      // The object after the `FROM` outside brackets of a text that is no query.
      '5:84 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      // A text that is no query, where another text of the same value is one with the same part that is not known.
      '9:34 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '10:54 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      // The higher tier of two texts.
      '11:32 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '12:58 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      // A part that is not known in a TYPEOF, and after a relationship, names a field of the object.
      '13:61 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '13:101 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '14:50 reads CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '14:65 reads CustomObject:account [Account] text possible external',
      '14:76 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      // What a search of a text binds is read as code.
      '16:65 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
      '16:85 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '16:98 reads ApexClass:unread#var:least [least] text probable resolved',
      '19:99 reads CustomObject:invoice__c [Invoice__c] text probable resolved',
    ]);
    expect(warned(analysis.issues)).toEqual([
      // What a query of an object that is not known names, also in a subquery and a TYPEOF.
      'PATH_NOT_FOLLOWED 4:103 {"notFollowed":["Amount__c","Lines__r","Status__c"],"endsAt":"object","origin":"parser:apex","via":"text"}',
      // A text the code shows that is no query, and one that is known in part.
      'PATH_NOT_FOLLOWED 6:43 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 7:62 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 15:72 {"notFollowed":["Name"],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 18:98 {"notFollowed":["What","Name"],"endsAt":"object","origin":"parser:apex","via":"text"}',
      // A subquery through a child relationship nothing defines keeps its names, and not what fills a part of it.
      'PATH_NOT_FOLLOWED 19:83 {"relationship":"Things__r","notFollowed":["Name"],"origin":"parser:apex","via":"text"}',
    ]);
    const message = (line: number): string | undefined =>
      analysis.issues.find((one) => one.details?.['line'] === line)?.message;
    expect(message(6)).toContain('the text of the query could not be read as a query');
    expect(message(7)).toContain('the text of the query is known only in part here');
    expect(message(11)).toBeUndefined();
  });

  it('widens a warning that meets another at one place, as the parts of a text a method gives back', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Builder',
        code(
          'public class Builder {',
          '    static String fieldName;',
          "    static String build() { return 'SELECT ' + fieldName + ' FROM ' + Builder.class.getName(); }",
          '    void m() {',
          '        List<SObject> rows = Database.query(build());',
          '    }',
          '}',
        ),
      );
    });
    // The field and the object stand both at the call: what the query reads can be anything.
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 5:45 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('takes back nothing of the member it reads where a method it works a text out of uses a child relationship', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'GuessA',
        code(
          'public class GuessA {',
          '    void m(Invoice__c inv) {',
          '        Object xxxxxxx = inv.Thing__r.Name; Object y = inv.get(GuessB.f(inv));',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'GuessB',
        code(
          'public class GuessB {',
          '    public static String f(Invoice__c inv) {',
          "        for (SObject x : inv.Thing__r) { } return 'Amount__c';",
          '    }',
          '}',
        ),
      );
    });
    expect(warned(analysis.issues)).toEqual([
      'RELATIONSHIP_GUESSED 3:30 {"relationship":"Thing__r","object":"Invoice__c","field":"Thing__c"}',
      'PATH_NOT_FOLLOWED 3:30 {"relationship":"Thing__r","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 3:30 {"relationship":"Thing__r","notFollowed":[],"origin":"parser:apex"}',
    ]);
    // The guess stays with the member that made it, and the warning about the list with the method that has it.
    const of = (code: string, notFollowed: number): unknown =>
      analysis.issues.find(
        (one) =>
          one.code === code &&
          (code !== 'PATH_NOT_FOLLOWED' ||
            (Array.isArray(one.details?.['notFollowed']) && one.details['notFollowed'].length === notFollowed)),
      )?.details?.['path'];
    expect(of('RELATIONSHIP_GUESSED', 0)).toMatch(/GuessA\.cls$/);
    expect(of('PATH_NOT_FOLLOWED', 0)).toMatch(/GuessB\.cls$/);
  });

  /** What each member names in a text, and what each warns about: `member line:column ...` (decision record 0091). */
  const byMember = (analysis: SourceAnalysis): string[] => [
    ...analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) =>
        one.references
          .filter((reference) => viaOf(reference) === 'text')
          .map(
            (reference) =>
              `${one.key.replace(/^ApexClass:/, '')} ${String(reference.location?.line)}:${String(reference.location?.column)} ${reference.kind} ${String(reference.to)} ${reference.confidence}`,
          ),
      ),
    ...analysis.issues.map((one) => {
      const { line, column, notFollowed } = one.details ?? {};
      return `${String(one.componentKey).replace(/^ApexClass:/, '')} ${one.code} ${JSON.stringify(line)}:${JSON.stringify(column)} ${JSON.stringify(notFollowed)}`;
    }),
  ];

  it('reads at each call what a method does with a text it is given, and reports it where the call gives the text', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Reader',
        code(
          'public class Reader {',
          '    public static Object read(Invoice__c inv, String field) {',
          '        return inv.get(field);',
          '    }',
          '    public static Object any(SObject record, String field) {',
          '        return record.get(field);',
          '    }',
          '    public static List<SObject> rows(String fields) {',
          "        return Database.query('SELECT ' + fields + ' FROM Invoice__c');",
          '    }',
          '    public static List<SObject> of(String objectName) {',
          "        return Database.query('SELECT Amount__c FROM ' + objectName);",
          '    }',
          '    public static Object twice(Invoice__c inv, String field) {',
          '        return read(inv, field);',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'Caller',
        code(
          'public class Caller {',
          '    void m(Invoice__c inv, String unknown) {',
          "        Reader.read(inv, 'Amount__c');",
          "        Reader.any(inv, 'Status__c');",
          "        Reader.rows('Amount__c, Status__c');",
          "        Reader.of('Invoice__c');",
          "        Reader.twice(inv, 'Status__c');",
          '        Reader.read(inv, unknown);',
          '        Reader.read(inv, null);',
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // The names a call gives are the caller's, where their characters stand.
      'caller#method:m(invoice__c,string) 3:27 reads CustomField:invoice__c.amount__c probable',
      'caller#method:m(invoice__c,string) 5:22 reads CustomField:invoice__c.amount__c probable',
      'caller#method:m(invoice__c,string) 5:33 reads CustomField:invoice__c.status__c probable',
      // Of an object the call names, what the method writes is the caller's too, and stands at the call.
      'caller#method:m(invoice__c,string) 6:16 reads CustomField:invoice__c.amount__c probable',
      'caller#method:m(invoice__c,string) 6:20 reads CustomObject:invoice__c probable',
      // Also through a method that hands the text on.
      'caller#method:m(invoice__c,string) 7:28 reads CustomField:invoice__c.status__c probable',
      // A text the caller does not know is a part not known where it enters: of the object of the record.
      'caller#method:m(invoice__c,string) 8:26 reads CustomObject:invoice__c possible',
      // A method keeps the names it writes itself, and says nothing of a text every call gives it.
      'reader#method:rows(string) 9:59 reads CustomObject:invoice__c probable',
      // The record is of the object the method declares, which says nothing here.
      'caller#method:m(invoice__c,string) PATH_NOT_FOLLOWED 4:26 ["Status__c"]',
    ]);
  });

  it('keeps the warnings of a method that code outside the snapshot can call, or that no call is known of', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Open',
        code(
          'public class Open {',
          '    @AuraEnabled public static Object lightning(Invoice__c inv, String field) { return inv.get(field); }',
          '    public static Object alone(Invoice__c inv, String field) { return inv.get(field); }',
          '    public static Object hidden(Invoice__c inv, String field) { return inv.get(field); }',
          '    public static Object typed(Invoice__c inv, Object field, String o) { return inv.get((String) field); }',
          '}',
        ),
      );
      source.apexClass(
        'Job',
        code(
          'public class Job implements Schedulable {',
          '    public void execute(SchedulableContext context) { }',
          '    public Object run(Invoice__c inv, String field) { return inv.get(field); }',
          '}',
        ),
      );
      source.apexClass(
        'World',
        code(
          'global class World {',
          '    public static Object read(Invoice__c inv, String field) { return inv.get(field); }',
          '}',
        ),
      );
      source.apexClass(
        'OpenCaller',
        code(
          'public class OpenCaller {',
          '    void m(Invoice__c inv, Handler handler) {',
          "        Open.lightning(inv, 'Amount__c');",
          "        Open.hidden(inv, 'Amount__c');",
          "        handler.hidden(inv, 'Status__c');",
          "        Open.typed(inv, 'Amount__c', null);",
          "        new Job().run(inv, 'Status__c');",
          "        World.read(inv, 'Status__c');",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // A method of Lightning, one no call is known of, one that may be called on a value of no known class, one
      // that takes the text as an object, one of a class Salesforce runs and one of a global class keep theirs.
      'job#method:run(invoice__c,string) 3:70 reads CustomObject:invoice__c possible',
      'open#method:alone(invoice__c,string) 3:79 reads CustomObject:invoice__c possible',
      'open#method:hidden(invoice__c,string) 4:80 reads CustomObject:invoice__c possible',
      'open#method:lightning(invoice__c,string) 2:96 reads CustomObject:invoice__c possible',
      'open#method:typed(invoice__c,object,string) 5:98 reads CustomObject:invoice__c possible',
      // Each call of the snapshot still reports what it gives, but a text given as an object.
      'opencaller#method:m(invoice__c,handler) 3:30 reads CustomField:invoice__c.amount__c probable',
      'opencaller#method:m(invoice__c,handler) 4:27 reads CustomField:invoice__c.amount__c probable',
      'opencaller#method:m(invoice__c,handler) 7:29 reads CustomField:invoice__c.status__c probable',
      'opencaller#method:m(invoice__c,handler) 8:26 reads CustomField:invoice__c.status__c probable',
      'world#method:read(invoice__c,string) 2:78 reads CustomObject:invoice__c possible',
    ]);
  });

  it('reads what a constructor, an override and a method that calls itself do with a text, and a class a text names', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Base',
        code(
          'public virtual class Base {',
          '    public Base(Invoice__c inv, String field) { inv.put(field, 1); }',
          '    public virtual Object read(Invoice__c inv, String field) { return null; }',
          '}',
        ),
      );
      source.apexClass(
        'Child',
        code(
          'public class Child extends Base {',
          "    public Child() { super(null, 'Status__c'); }",
          '    public override Object read(Invoice__c inv, String field) { return inv.get(field); }',
          '}',
        ),
      );
      source.apexClass(
        'Again',
        code(
          'public class Again {',
          '    static Object walk(Invoice__c inv, String field, Integer depth) {',
          "        if (depth > 0) return walk(inv, 'Amount__c', depth - 1);",
          '        return inv.get(field);',
          '    }',
          '    public static Object make(String name) { return Type.forName(name).newInstance(); }',
          '}',
        ),
      );
      source.apexClass(
        'Uses',
        code(
          'public class Uses {',
          '    void m(Invoice__c inv, Base base) {',
          "        new Base(inv, 'Amount__c');",
          "        base.read(inv, 'Status__c');",
          "        Again.make('Child');",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // A method that calls itself reports what it gives itself, and keeps its own warning: no other call is known.
      'again#method:walk(invoice__c,string,integer) 3:42 reads CustomField:invoice__c.amount__c probable',
      'again#method:walk(invoice__c,string,integer) 4:24 reads CustomObject:invoice__c possible',
      // A constructor that calls the one of the class it extends.
      'child#ctor:() 2:35 writes CustomField:invoice__c.status__c probable',
      'uses#method:m(invoice__c,base) 3:24 writes CustomField:invoice__c.amount__c probable',
      // The override that the value can run reads the text too.
      'uses#method:m(invoice__c,base) 4:25 reads CustomField:invoice__c.status__c probable',
      'uses#method:m(invoice__c,base) 5:21 uses-type ApexClass:child probable',
    ]);
  });

  it('reads again what a relationship, a token, an object, a search and a query of a text are given', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Sinks',
        code(
          'public class Sinks {',
          '    public static Object rel(Invoice__c inv, String name) { return inv.getSObject(name); }',
          '    public static Object token(String name) { return Schema.SObjectType.Invoice__c.fields.getMap().get(name); }',
          '    public static Object type(String name) { return Schema.getGlobalDescribe().get(name); }',
          "    public static Object found(String obj) { return Search.query('FIND {x} RETURNING ' + obj + '(Amount__c)'); }",
          "    public static Object what(String field) { return Database.query('SELECT What.' + field + ' FROM Task'); }",
          '    public static Object items(String name) { return Schema.describeSObjects(new List<String>{ name }); }',
          '}',
        ),
      );
      source.apexClass(
        'SinkCaller',
        code(
          'public class SinkCaller {',
          '    void m(Invoice__c inv) {',
          "        Sinks.rel(inv, 'Account__r');",
          "        Sinks.token('Status__c');",
          "        Sinks.type('Invoice__c');",
          "        Sinks.found('Invoice__c');",
          "        Sinks.what('Name');",
          "        Sinks.items('Invoice__c');",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      'sinkcaller#method:m(invoice__c) 3:25 reads CustomField:invoice__c.account__c probable',
      'sinkcaller#method:m(invoice__c) 4:22 references CustomField:invoice__c.status__c probable',
      'sinkcaller#method:m(invoice__c) 5:21 references CustomObject:invoice__c probable',
      // The object of the search is the caller's, so the field the method names after it is too, at the call.
      'sinkcaller#method:m(invoice__c) 6:15 reads CustomField:invoice__c.amount__c probable',
      'sinkcaller#method:m(invoice__c) 6:22 reads CustomObject:invoice__c probable',
      'sinkcaller#method:m(invoice__c) 8:22 references CustomObject:invoice__c probable',
      'sinks#method:what(string) 6:77 reads CustomField:task.whatid probable',
      'sinks#method:what(string) 6:101 reads CustomObject:task probable',
      // A name the caller gives after a relationship of the method that leads to no known object.
      'sinkcaller#method:m(invoice__c) PATH_NOT_FOLLOWED 7:15 ["Name"]',
    ]);
  });

  it('leaves to a method what it names and warns about itself, and gives the caller what its text makes of it', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Own',
        code(
          'public class Own {',
          "    public static Object pre(Invoice__c inv, String rest) { return inv.get('Status' + rest); }",
          "    public static Object either(Invoice__c inv, String field, Boolean flag) { return inv.get(flag ? 'Amount__c' : field); }",
          '    public static Object of(Task t, String field) { return t.What.get(field); }',
          "    public static Object guessed(String cond) { return Database.query('SELECT What.Name FROM Task WHERE ' + cond); }",
          "    public static Object bound(String obj, String term) { return Database.query('SELECT Id FROM ' + obj + ' WHERE Name = :term'); }",
          "    public static Object rest(String clause) { return Database.query('SELECT Id FROM Invoice__c ' + clause); }",
          '}',
        ),
      );
      source.apexClass(
        'OwnCaller',
        code(
          'public class OwnCaller {',
          '    static String term;',
          '    void m(Invoice__c inv, Task t) {',
          "        Own.pre(inv, '__c');",
          "        Own.either(inv, 'Status__c', true);",
          "        Own.of(t, 'Name');",
          "        Own.guessed('Subject = null');",
          "        Own.bound('Invoice__c', 'x');",
          "        Own.rest('WHERE');",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      'own#method:either(invoice__c,string,boolean) 3:102 reads CustomField:invoice__c.amount__c probable',
      'own#method:guessed(string) 5:79 reads CustomField:task.whatid probable',
      'own#method:guessed(string) 5:94 reads CustomObject:task probable',
      'own#method:rest(string) 7:86 reads CustomObject:invoice__c probable',
      // A name that the method starts and the call ends is the caller's, at the call.
      'owncaller#method:m(invoice__c,task) 4:13 reads CustomField:invoice__c.status__c probable',
      // Of the texts a value can be, the caller reports the one it gives.
      'owncaller#method:m(invoice__c,task) 5:26 reads CustomField:invoice__c.status__c probable',
      'owncaller#method:m(invoice__c,task) 7:22 reads CustomField:task.subject probable',
      // Of an object the caller names, the field the method names is the caller's too. What the query binds is code
      // of the method: the caller reads none of it.
      'owncaller#method:m(invoice__c,task) 8:13 reads CustomField:invoice__c.name probable',
      'owncaller#method:m(invoice__c,task) 8:20 reads CustomObject:invoice__c probable',
      // A text the call makes into one that is no query: the object after FROM, with what is not known of it.
      'owncaller#method:m(invoice__c,task) 9:13 reads CustomObject:invoice__c possible',
      // The method keeps its own warning, which the caller does not repeat.
      'own#method:guessed(string) PATH_NOT_FOLLOWED 5:79 ["Name"]',
      // The relationship of the method stands at the call, with the name the caller gives after it.
      'owncaller#method:m(invoice__c,task) PATH_NOT_FOLLOWED 6:13 ["Name"]',
    ]);
  });

  it('keeps what a method does not know itself, also where a parameter stands at the same place', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Dflt',
        code(
          'public class Dflt {',
          '    public static Object read(Invoice__c inv, String field) {',
          '        if (field == null) field = inv.Status__c;',
          '        return inv.get(field);',
          '    }',
          '    public static Object any(SObject rec, String field) {',
          '        String f = field;',
          "        if (f == null) f = String.valueOf(rec.get('Name'));",
          '        return rec.get(f);',
          '    }',
          '    public static Object suffix(Invoice__c inv, String field) {',
          '        return inv.get(field + inv.Status__c);',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'DfltCaller',
        code(
          'public class DfltCaller {',
          '    void m(Invoice__c inv, SObject rec) {',
          "        Dflt.read(inv, 'Amount__c');",
          "        Dflt.any(rec, 'Amount__c');",
          "        Dflt.suffix(inv, 'Amount');",
          "        DfltMid.pass(inv, 'Amount');",
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'DfltMid',
        code(
          'public class DfltMid {',
          '    public static Object pass(Invoice__c inv, String g) { return Dflt.suffix(inv, g); }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // On one way the method knows nothing of the field, whatever a call gives: it says so itself.
      'dflt#method:read(invoice__c,string) 4:24 reads CustomObject:invoice__c possible',
      // A name that holds a parameter and a part of the method that is not known: the method says it, the call not.
      'dflt#method:suffix(invoice__c,string) 12:24 reads CustomObject:invoice__c possible',
      'dfltcaller#method:m(invoice__c,sobject) 3:25 reads CustomField:invoice__c.amount__c probable',
      'dflt#method:any(sobject,string) PATH_NOT_FOLLOWED 8:52 ["Name"]',
      'dflt#method:any(sobject,string) PATH_NOT_FOLLOWED 9:24 []',
      'dfltcaller#method:m(invoice__c,sobject) PATH_NOT_FOLLOWED 4:24 ["Amount__c"]',
    ]);
  });

  it('reads a method that calls itself, or that methods call each other, without what they do again', () => {
    const write =
      (first: string, second: string) =>
      (source: ApexSource): void => {
        source.apexClass(
          'Rec',
          code(
            'public class Rec {',
            '    public static Object read(Invoice__c inv, String f) {',
            "        if (!f.endsWith('__c')) return read(inv, f + '__c');",
            '        return inv.get(f);',
            '    }',
            '}',
          ),
        );
        source.apexClass(
          'Mut',
          code(
            'public class Mut {',
            '    public static Object a(Invoice__c inv, String f, Boolean again) {',
            '        if (again) return b(inv, f);',
            '        return inv.get(f);',
            '    }',
            '    public static Object b(Invoice__c inv, String f) { return a(inv, f, false); }',
            '}',
          ),
        );
        // Which of the two methods is worked out first changes nothing.
        source.apexClass(
          first,
          code(`public class ${first} {`, "    void m(Invoice__c inv) { Mut.a(inv, 'Amount__c', true); }", '}'),
        );
        source.apexClass(
          second,
          code(`public class ${second} {`, "    void m(Invoice__c inv) { Mut.b(inv, 'Status__c'); }", '}'),
        );
        source.apexClass(
          'RecCaller',
          code('public class RecCaller {', "    void m(Invoice__c inv) { Rec.read(inv, 'Amount'); }", '}'),
        );
        source.apexClass(
          'Tri',
          code(
            'public class Tri {',
            '    public static Object a(Invoice__c inv, String f, Integer n) {',
            '        if (n > 0) return b(inv, f, n);',
            '        return inv.get(f);',
            '    }',
            '    public static Object b(Invoice__c inv, String f, Integer n) { inv.get(f); return c(inv, f, n); }',
            '    public static Object c(Invoice__c inv, String f, Integer n) { return a(inv, f, n - 1); }',
            '}',
          ),
        );
        source.apexClass(
          'TriCaller',
          code('public class TriCaller {', "    void m(Invoice__c inv) { Tri.a(inv, 'Amount__c', 1); }", '}'),
        );
      };
    const one = byMember(analysed(write('ACaller', 'BCaller')));
    const other = byMember(analysed(write('BCaller', 'ACaller')));
    expect(one).toEqual([
      // The call of a, as a reads the text without b.
      'acaller#method:m(invoice__c) 2:42 reads CustomField:invoice__c.amount__c probable',
      // a and b call each other: each says what it does not know, and b hands its text to a, which the call of b
      // does not follow.
      'mut#method:a(invoice__c,string,boolean) 4:24 reads CustomObject:invoice__c possible',
      'mut#method:b(invoice__c,string) 6:70 reads CustomObject:invoice__c possible',
      // A method that calls itself reads again what it does at its own call, and says what it does not know there.
      'rec#method:read(invoice__c,string) 3:50 reads CustomObject:invoice__c possible',
      'rec#method:read(invoice__c,string) 4:24 reads CustomObject:invoice__c possible',
      'reccaller#method:m(invoice__c) 2:45 reads CustomField:invoice__c.amount probable',
      // Three methods in a ring are one group, whichever of them closes it.
      'tri#method:a(invoice__c,string,integer) 3:34 reads CustomObject:invoice__c possible',
      'tri#method:a(invoice__c,string,integer) 4:24 reads CustomObject:invoice__c possible',
      'tri#method:b(invoice__c,string,integer) 6:75 reads CustomObject:invoice__c possible',
      'tri#method:c(invoice__c,string,integer) 7:81 reads CustomObject:invoice__c possible',
      'tricaller#method:m(invoice__c) 2:42 reads CustomField:invoice__c.amount__c probable',
    ]);
    expect(
      other
        .map((line) =>
          line
            .replace(/^acaller/, 'X')
            .replace(/^bcaller/, 'acaller')
            .replace(/^X/, 'bcaller'),
        )
        .sort(),
    ).toEqual([...one].sort());
  });

  it('keeps the warnings of a method that code outside the snapshot can reach in every way the record names', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'More',
        code(
          'public class More {',
          '    @RemoteAction public static Object remote(Invoice__c inv, String field) { return inv.get(field); }',
          '    @HttpPost public static Object posted(Invoice__c inv, String field) { return inv.get(field); }',
          '    @NamespaceAccessible public static Object shared(Invoice__c inv, String field) { return inv.get(field); }',
          '    @InvocableMethod public static Object flow(Invoice__c inv, String field) { return inv.get(field); }',
          '    webservice static Object soap(Invoice__c inv, String field) { return inv.get(field); }',
          '    global static Object everywhere(Invoice__c inv, String field) { return inv.get(field); }',
          '    public void setField(String value) { Invoice__c inv; inv.get(value); }',
          '}',
        ),
      );
      source.apexClass(
        'Outer',
        code(
          'global class Outer {',
          '    public class Inner {',
          '        public Object read(Invoice__c inv, String field) { return inv.get(field); }',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'JobBase',
        code(
          'public virtual class JobBase implements Schedulable {',
          '    public void execute(SchedulableContext c) { }',
          '}',
        ),
      );
      source.apexClass(
        'JobChild',
        code(
          'public class JobChild extends JobBase {',
          '    public Object run(Invoice__c inv, String field) { return inv.get(field); }',
          '    Object hidden(Invoice__c inv, String field) { return inv.get(field); }',
          "    public Object go(Invoice__c inv) { return hidden(inv, 'Status__c'); }",
          '    public static Object stat(Invoice__c inv, String field) { return inv.get(field); }',
          '}',
        ),
      );
      source.apexClass(
        'SvcBase',
        code(
          'public virtual class SvcBase {',
          '    public virtual Object call(String action, Map<String, Object> args) {',
          '        return Schema.getGlobalDescribe().get(action);',
          '    }',
          '}',
        ),
      );
      source.apexClass('Svc', code('public class Svc extends SvcBase implements Callable {', '}'));
      source.apexClass(
        'Plugin',
        code('global interface Plugin {', '    Object run(Invoice__c inv, String field);', '}'),
      );
      source.apexClass(
        'Impl',
        code(
          'public class Impl implements Plugin {',
          '    public Object run(Invoice__c inv, String field) { return inv.get(field); }',
          '}',
        ),
      );
      source.apexClass(
        'MoreCaller',
        code(
          'public class MoreCaller {',
          '    void m(Invoice__c inv, SvcBase base, Plugin plugin) {',
          "        More.remote(inv, 'Amount__c');",
          "        More.posted(inv, 'Amount__c');",
          "        More.shared(inv, 'Amount__c');",
          "        More.flow(inv, 'Amount__c');",
          "        More.soap(inv, 'Amount__c');",
          "        More.everywhere(inv, 'Amount__c');",
          "        new More().setField('Amount__c');",
          "        new Outer.Inner().read(inv, 'Amount__c');",
          "        new JobChild().run(inv, 'Amount__c');",
          "        base.call('Invoice__c', null);",
          "        plugin.run(inv, 'Amount__c');",
          '    }',
          '    void n(Invoice__c inv, SvcBase2 base) {',
          "        JobChild.stat(inv, 'Amount__c');",
          "        base.call('Invoice__c', null);",
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'SvcBase2',
        code(
          'public virtual class SvcBase2 {',
          '    public virtual Object call(String action, Map<String, Object> args) {',
          '        return Schema.getGlobalDescribe().get(action);',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'Svc2',
        code(
          'public class Svc2 extends SvcBase2 implements Callable {',
          '    public override Object call(String action, Map<String, Object> args) { return null; }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // A method of a class that implements a global interface, of a class that extends one Salesforce runs, a
      // method of each annotation, of `webservice` and `global`, a public setter, a method of an inner class of a
      // global class and a method that a class offers to code outside, which extends its class and implements
      // Callable: each keeps what it says.
      'impl#method:run(invoice__c,string) 2:70 reads CustomObject:invoice__c possible',
      // A private method only its class calls.
      'jobchild#method:go(invoice__c) 4:60 reads CustomField:invoice__c.status__c probable',
      'jobchild#method:run(invoice__c,string) 2:70 reads CustomObject:invoice__c possible',
      'more#method:everywhere(invoice__c,string) 7:84 reads CustomObject:invoice__c possible',
      'more#method:flow(invoice__c,string) 5:95 reads CustomObject:invoice__c possible',
      'more#method:posted(invoice__c,string) 3:90 reads CustomObject:invoice__c possible',
      'more#method:remote(invoice__c,string) 2:94 reads CustomObject:invoice__c possible',
      'more#method:setfield(string) 8:66 reads CustomObject:invoice__c possible',
      'more#method:shared(invoice__c,string) 4:101 reads CustomObject:invoice__c possible',
      'more#method:soap(invoice__c,string) 6:82 reads CustomObject:invoice__c possible',
      // Each call of the snapshot still reports what it gives, also through an interface.
      'morecaller#method:m(invoice__c,svcbase,plugin) 3:27 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 4:27 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 5:27 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 6:25 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 7:25 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 8:31 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 9:30 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 10:38 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 11:34 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 12:20 references CustomObject:invoice__c probable',
      'morecaller#method:m(invoice__c,svcbase,plugin) 13:26 reads CustomField:invoice__c.amount__c probable',
      // A static method of a class that Salesforce runs, and a method that the class which offers it declares again:
      // only the snapshot calls them.
      'morecaller#method:n(invoice__c,svcbase2) 16:29 reads CustomField:invoice__c.amount__c probable',
      'morecaller#method:n(invoice__c,svcbase2) 17:20 references CustomObject:invoice__c probable',
      'outer#inner:inner/method:read(invoice__c,string) 3:75 reads CustomObject:invoice__c possible',
      'svcbase#method:call(string,map<string,object>) PATH_NOT_FOLLOWED 3:47 []',
    ]);
  });

  it('says nothing of a parameter that every call gives, also through this(...), a bind and a call of another number', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Ctor',
        code(
          'public class Ctor {',
          "    public Ctor(Invoice__c inv) { this(inv, 'Amount__c'); }",
          '    public Ctor(Invoice__c inv, String field) { inv.put(field, 1); }',
          '}',
        ),
      );
      source.apexClass(
        'Bound',
        code(
          'public class Bound {',
          '    static Integer depth(Invoice__c inv, String field) { inv.get(field); return 1; }',
          "    void m(Invoice__c inv) { List<Invoice__c> rows = [SELECT Id FROM Invoice__c LIMIT :depth(inv, 'Status__c')]; }",
          '}',
        ),
      );
      source.apexClass(
        'Other',
        code(
          'public class Other {',
          '    public static Object shown(Invoice__c inv, String field) { return inv.get(field); }',
          '    public static Object make(String space, String name) { return Type.forName(space, name).newInstance(); }',
          '    public static Object twice(Invoice__c inv, String field) { inv.get(field); return inv.get(field); }',
          '}',
        ),
      );
      source.apexClass('Child2', code('public class Child2 {', '}'));
      source.apexClass(
        'OtherCaller',
        code(
          'public class OtherCaller {',
          '    void m(Invoice__c inv, Handler handler) {',
          '        new Ctor(inv);',
          "        Other.shown(inv, 'Amount__c');",
          '        handler.shown(inv);',
          "        Other.make('', 'Child2');",
          "        Other.twice(inv, 'Status__c');",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // A method called only in a bind of a query, a constructor called only through this(...), a method of which
      // a call of another number of arguments is made on a value of no known class, and a namespace and a class
      // that a call gives: each method says nothing, and the calls say what they give.
      'bound#method:m(invoice__c) 3:100 reads CustomField:invoice__c.status__c probable',
      'ctor#ctor:(invoice__c) 2:46 writes CustomField:invoice__c.amount__c probable',
      'othercaller#method:m(invoice__c,handler) 4:27 reads CustomField:invoice__c.amount__c probable',
      'othercaller#method:m(invoice__c,handler) 6:25 uses-type ApexClass:child2 probable',
      // Two uses of the method that are one at the call.
      'othercaller#method:m(invoice__c,handler) 7:27 reads CustomField:invoice__c.status__c probable',
    ]);
  });

  /**
   * The custom metadata type `Rule__mdt`, with fields of a text, a long text, a number and a relationship to an object,
   * and three records: `Late`, `Open`, and `Blank`, which gives its field of a text no value.
   */
  const rules = (source: ApexSource): void => {
    source.object('Rule__mdt', '<label>Rule</label>');
    source.field('Rule__mdt', 'Field__c', '<type>Text</type>');
    source.field('Rule__mdt', 'Note__c', '<type>LongTextArea</type>');
    source.field('Rule__mdt', 'Label__c', '<type>TextArea</type>');
    source.field('Rule__mdt', 'Kind__c', '<type>Picklist</type>');
    source.field('Rule__mdt', 'Count__c', '<type>Number</type>');
    source.field(
      'Rule__mdt',
      'Object__c',
      '<referenceTo>EntityDefinition</referenceTo>',
      '<type>MetadataRelationship</type>',
    );
    source.metadataRecord('Rule', 'Late', {
      Field__c: 'Amount__c',
      Count__c: '3',
      Object__c: 'Invoice__c',
      Note__c: 'Handler',
      Kind__c: 'Status__c',
    });
    source.metadataRecord('Rule', 'Open', { Field__c: 'Status__c', Label__c: 'Status__c' });
    source.metadataRecord('Rule', 'Blank', {});
    // A few sources name a record after its type with the suffix.
    source.metadataRecord('Rule__mdt', 'Suffixed', { Field__c: 'Amount__c' });
    source.apexClass('Handler', code('public class Handler {', '}'));
  };

  it('reads the texts that records of a custom metadata type hold, of the record the code names or of every one', () => {
    const analysis = analysed((source) => {
      rules(source);
      source.apexClass(
        'Reads',
        code(
          'public class Reads {',
          '    Object one(Invoice__c inv) {',
          "        return inv.get(Rule__mdt.getInstance('Late').Field__c);",
          '    }',
          '    void every(Invoice__c inv) {',
          '        for (Rule__mdt rule : Rule__mdt.getAll().values()) inv.get(rule.Field__c);',
          '    }',
          '    void queried(Invoice__c inv) {',
          '        for (Rule__mdt rule : [SELECT Field__c FROM Rule__mdt]) inv.get(rule.Field__c);',
          '    }',
          '    void mapped(Invoice__c inv, Boolean flag) {',
          '        Map<String, Rule__mdt> rules = Rule__mdt.getAll();',
          "        Rule__mdt rule = flag ? rules.get('Open') : Rule__mdt.getInstance('Late');",
          '        inv.get(rule.Field__c);',
          '    }',
          '    void missing(Invoice__c inv) {',
          "        inv.get(Rule__mdt.getInstance('Gone').Field__c);",
          "        inv.get(Rule__mdt.getInstance('Blank').Field__c);",
          "        inv.get(Rule__mdt.getInstance('Not a name').Field__c);",
          '    }',
          '    void notText(Invoice__c inv) {',
          "        inv.get(String.valueOf(Rule__mdt.getInstance('Late').Count__c));",
          "        Schema.getGlobalDescribe().get(Rule__mdt.getInstance('Late').Object__c);",
          "        Type.forName(Rule__mdt.getInstance('Late').Note__c);",
          '    }',
          '    void setting(Invoice__c inv) {',
          "        inv.get(Settings__c.getInstance('Late').Field__c);",
          '    }',
          '    void more(Invoice__c inv, Boolean flag, Rule__mdt any) {',
          "        Rule__mdt open = Rule__mdt.getInstance('Open');",
          '        inv.get(open.Field__c);',
          "        Rule__mdt either = flag ? Rule__mdt.getInstance('Open') : any;",
          '        inv.get(either.Field__c);',
          "        Rule__mdt half = flag ? Rule__mdt.getInstance('Late') : Rule__mdt.getInstance('Gone');",
          '        inv.get(half.Field__c);',
          "        inv.get(Rule__mdt.getInstance('Late').Field__c.toLowerCase());",
          '    }',
          '    void chained(Invoice__c inv, Id id) {',
          '        inv.get(Rule__mdt.getAll().values()[0].Field__c);',
          "        inv.get(Rule__mdt.getInstance('Open').Label__c);",
          "        inv.get(Rule__mdt.getInstance('Suffixed').Field__c);",
          '        inv.get(Rule__mdt.getInstance(id).Field__c);',
          "        Rule__mdt made = new Rule__mdt(Field__c = 'Amount__c');",
          '        inv.get(made.Field__c);',
          "        Rule__mdt mixed = id == null ? made : Rule__mdt.getInstance('Open');",
          '        inv.get(mixed.Field__c);',
          "        Rule__mdt late = Rule__mdt.getInstance('Late');",
          "        late.Field__c = 'Status__c';",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // Of every record, of a list of `getAll()` and of an id. A long text and a text area hold names, and a record
      // named after its type with the suffix is found.
      'reads#method:chained(invoice__c,id) 39:48 reads CustomField:invoice__c.amount__c probable',
      'reads#method:chained(invoice__c,id) 39:48 reads CustomField:invoice__c.status__c probable',
      'reads#method:chained(invoice__c,id) 40:40 references CustomMetadata:rule.open probable',
      'reads#method:chained(invoice__c,id) 40:47 reads CustomField:invoice__c.status__c probable',
      'reads#method:chained(invoice__c,id) 41:40 references CustomMetadata:rule__mdt.suffixed probable',
      'reads#method:chained(invoice__c,id) 41:51 reads CustomField:invoice__c.amount__c probable',
      'reads#method:chained(invoice__c,id) 42:43 reads CustomField:invoice__c.amount__c probable',
      'reads#method:chained(invoice__c,id) 42:43 reads CustomField:invoice__c.status__c probable',
      // A record the code makes holds what the code puts in it, which is not followed, also beside a named one. A
      // field that is written reads nothing.
      'reads#method:chained(invoice__c,id) 44:22 reads CustomObject:invoice__c possible',
      'reads#method:chained(invoice__c,id) 45:70 references CustomMetadata:rule.open probable',
      'reads#method:chained(invoice__c,id) 46:23 reads CustomField:invoice__c.status__c probable',
      'reads#method:chained(invoice__c,id) 46:23 reads CustomObject:invoice__c possible',
      'reads#method:chained(invoice__c,id) 47:49 references CustomMetadata:rule.late probable',
      // Of every record, where the code reads them all, from `getAll()` or from a query. `Blank` gives no value.
      'reads#method:every(invoice__c) 6:73 reads CustomField:invoice__c.amount__c probable',
      'reads#method:every(invoice__c) 6:73 reads CustomField:invoice__c.status__c probable',
      // Of each record the code names, through a map of `getAll()` and a branch.
      'reads#method:mapped(invoice__c,boolean) 13:44 references CustomMetadata:rule.open probable',
      'reads#method:mapped(invoice__c,boolean) 13:76 references CustomMetadata:rule.late probable',
      'reads#method:mapped(invoice__c,boolean) 14:22 reads CustomField:invoice__c.amount__c probable',
      'reads#method:mapped(invoice__c,boolean) 14:22 reads CustomField:invoice__c.status__c probable',
      // A record the snapshot does not hold, and one that gives the field no value, hold a text that is not known. A
      // text that is no name names no record, and the code gets none.
      'reads#method:missing(invoice__c) 17:40 references null probable',
      'reads#method:missing(invoice__c) 17:47 reads CustomObject:invoice__c possible',
      'reads#method:missing(invoice__c) 18:40 references CustomMetadata:rule.blank probable',
      'reads#method:missing(invoice__c) 18:48 reads CustomObject:invoice__c possible',
      // A local keeps the record its value names. Of a branch, a record that is not named can be any, and a record
      // the snapshot does not hold holds a text that is not known. A method of a text keeps the names it holds.
      'reads#method:more(invoice__c,boolean,rule__mdt) 30:49 references CustomMetadata:rule.open probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 31:22 reads CustomField:invoice__c.status__c probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 32:58 references CustomMetadata:rule.open probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 33:24 reads CustomField:invoice__c.amount__c probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 33:24 reads CustomField:invoice__c.status__c probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 34:56 references CustomMetadata:rule.late probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 34:88 references null probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 35:22 reads CustomField:invoice__c.amount__c probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 35:22 reads CustomObject:invoice__c possible',
      'reads#method:more(invoice__c,boolean,rule__mdt) 36:40 references CustomMetadata:rule.late probable',
      'reads#method:more(invoice__c,boolean,rule__mdt) 36:47 reads CustomField:invoice__c.amount__c probable',
      // A number and a relationship to an object hold no name by the files of their fields. A long text does.
      'reads#method:nottext(invoice__c) 22:55 references CustomMetadata:rule.late probable',
      'reads#method:nottext(invoice__c) 22:62 reads CustomObject:invoice__c possible',
      'reads#method:nottext(invoice__c) 23:63 references CustomMetadata:rule.late probable',
      'reads#method:nottext(invoice__c) 24:45 references CustomMetadata:rule.late probable',
      'reads#method:nottext(invoice__c) 24:52 uses-type ApexClass:handler probable',
      // The record is named where its name stands, and what it holds stands where the code reads the field.
      'reads#method:one(invoice__c) 3:47 references CustomMetadata:rule.late probable',
      'reads#method:one(invoice__c) 3:54 reads CustomField:invoice__c.amount__c probable',
      'reads#method:queried(invoice__c) 9:78 reads CustomField:invoice__c.amount__c probable',
      'reads#method:queried(invoice__c) 9:78 reads CustomField:invoice__c.status__c probable',
      // A record of a custom setting is data, which the snapshot does not hold.
      'reads#method:setting(invoice__c) 27:49 reads CustomObject:invoice__c possible',
      'reads#method:nottext(invoice__c) PATH_NOT_FOLLOWED 23:70 []',
    ]);
    // A record the snapshot does not hold keeps its type.
    const gone = (line: number): unknown[] => {
      const one = analysis.components
        .flatMap((component) => component.references)
        .find((reference) => reference.toType === 'CustomMetadata' && reference.location?.line === line);
      return [one?.toNameRaw, one?.to, one?.resolution, one?.attrs?.['object']];
    };
    expect(gone(17)).toEqual(['Gone', null, 'unresolved', 'Rule__mdt']);
    expect(gone(34)).toEqual(['Late', 'CustomMetadata:rule.late', 'resolved', undefined]);
  });

  it('reads a record that a method is handed the name of at each call, and what a method gives of any record', () => {
    const analysis = analysed((source) => {
      rules(source);
      source.fieldSet('Invoice__c', 'Summary', ['Amount__c']);
      source.fieldSet('Invoice__c', 'Other', ['Status__c']);
      source.apexClass(
        'Lookup',
        code(
          'public class Lookup {',
          '    static Rule__mdt rule(String name) { return Rule__mdt.getInstance(name); }',
          '    static Schema.FieldSet fieldSet(String name) {',
          '        return Schema.SObjectType.Invoice__c.fieldSets.getMap().get(name);',
          '    }',
          '    static String fieldOf(String name) { return Rule__mdt.getInstance(name).Field__c; }',
          "    static Rule__mdt orLate(String name) { return Rule__mdt.getInstance(name != null ? name : 'Late'); }",
          '    static Schema.FieldSet orSummary(String name) {',
          "        return Schema.SObjectType.Invoice__c.fieldSets.getMap().get(name != null ? name : 'Summary');",
          '    }',
          "    static Rule__mdt prefixed(String name) { return Rule__mdt.getInstance('La' + name); }",
          '    static Schema.FieldSet prefixedSet(String name) {',
          "        return Schema.SObjectType.Invoice__c.fieldSets.getMap().get('Sum' + name);",
          '    }',
          '    static Schema.FieldSet mixed(Invoice__c inv, String name) {',
          '        return Schema.SObjectType.Invoice__c.fieldSets.getMap().get(inv.Status__c + name);',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'LookupCaller',
        code(
          'public class LookupCaller {',
          '    void m(Invoice__c inv) {',
          "        Lookup.rule('Late');",
          "        Lookup.fieldSet('Summary');",
          "        inv.get(Lookup.fieldOf('Open'));",
          "        Lookup.orLate('Open');",
          "        Lookup.orSummary('Other');",
          "        Lookup.prefixed('te');",
          "        Lookup.prefixedSet('mary');",
          "        Lookup.mixed(inv, 'Other');",
          '    }',
          '}',
        ),
      );
    });
    expect(byMember(analysis)).toEqual([
      // What a method names itself beside what a call hands it is the method's, once, and so is what it does not know
      // itself in front of what a call hands it.
      'lookup#method:mixed(invoice__c,string) 16:73 reads CustomObject:invoice__c possible',
      'lookup#method:orlate(string) 7:96 references CustomMetadata:rule.late probable',
      'lookup#method:orsummary(string) 9:92 reads CustomField:invoice__c.amount__c probable',
      'lookup#method:orsummary(string) 9:92 references FieldSet:invoice__c.summary probable',
      // The record and the field set a call names are the caller's, where the call names them.
      'lookupcaller#method:m(invoice__c) 3:22 references CustomMetadata:rule.late probable',
      'lookupcaller#method:m(invoice__c) 4:26 reads CustomField:invoice__c.amount__c probable',
      'lookupcaller#method:m(invoice__c) 4:26 references FieldSet:invoice__c.summary probable',
      // What a method gives back of a record it is handed the name of is what any record of the type holds.
      'lookupcaller#method:m(invoice__c) 5:24 reads CustomField:invoice__c.amount__c probable',
      'lookupcaller#method:m(invoice__c) 5:24 reads CustomField:invoice__c.status__c probable',
      'lookupcaller#method:m(invoice__c) 5:33 references CustomMetadata:rule.open probable',
      'lookupcaller#method:m(invoice__c) 6:24 references CustomMetadata:rule.open probable',
      'lookupcaller#method:m(invoice__c) 7:27 reads CustomField:invoice__c.status__c probable',
      'lookupcaller#method:m(invoice__c) 7:27 references FieldSet:invoice__c.other probable',
      // A name that the characters of a call and of the method make is the caller's, where the call stands.
      'lookupcaller#method:m(invoice__c) 8:16 references CustomMetadata:rule.late probable',
      'lookupcaller#method:m(invoice__c) 9:16 reads CustomField:invoice__c.amount__c probable',
      'lookupcaller#method:m(invoice__c) 9:16 references FieldSet:invoice__c.summary probable',
    ]);
  });

  it('reads a field set that the code names, with the fields it holds, where the code names it', () => {
    const analysis = analysed((source) => {
      source.fieldSet('Invoice__c', 'Summary', ['Amount__c', 'Account__r.Name'], ['Status__c']);
      source.apexClass(
        'Sets',
        code(
          'public class Sets {',
          '    void byName() {',
          "        Schema.FieldSet one = Schema.SObjectType.Invoice__c.fieldSets.getMap().get('Summary');",
          "        Schema.FieldSet two = Schema.SObjectType.Invoice__c.fieldSets.getMap().get('summary');",
          '    }',
          '    void byToken() {',
          '        List<Schema.FieldSetMember> members = Schema.SObjectType.Invoice__c.FieldSets.Summary.getFields();',
          '    }',
          '    void described(String name) {',
          '        Map<String, Schema.FieldSet> sets = Invoice__c.SObjectType.getDescribe().fieldSets.getMap();',
          '        sets.get(name);',
          "        sets.get('Gone');",
          '    }',
          '    void unknownObject(String objectName, String name) {',
          "        Schema.getGlobalDescribe().get(objectName).getDescribe().fieldSets.getMap().get('Summary');",
          '        Schema.getGlobalDescribe().get(objectName).getDescribe().fieldSets.getMap().get(name);',
          '        Schema.FieldSet one = Schema.getGlobalDescribe().get(objectName).getDescribe().fieldSets.Summary;',
          '    }',
          '}',
        ),
      );
    });
    expect([...said(analysis, new Set(['text', 'token'])), ...warned(analysis.issues)]).toEqual([
      // The fields the field set holds, not those it offers, are read where the code names it, also through a
      // relationship, whichever case its name has.
      '3:50 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '3:85 reads CustomField:account.name [Name] text probable external',
      '3:85 reads CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '3:85 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '3:85 references FieldSet:invoice__c.summary [Summary] text probable resolved',
      '4:50 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '4:85 reads CustomField:account.name [Name] text probable external',
      '4:85 reads CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '4:85 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '4:85 references FieldSet:invoice__c.summary [summary] text probable resolved',
      // A field set named as a token is referred to as a token. What it holds are names in texts.
      '7:66 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '7:87 reads CustomField:account.name [Name] text probable external',
      '7:87 reads CustomField:invoice__c.account__c [Account__r] text probable resolved',
      '7:87 reads CustomField:invoice__c.amount__c [Amount__c] text probable resolved',
      '7:87 references FieldSet:invoice__c.summary [Summary] token confirmed resolved',
      // A name that is not known, and a field set the snapshot does not hold, read fields of the object.
      '10:45 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '11:18 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '12:19 reads CustomObject:invoice__c [Invoice__c] text possible resolved',
      '12:19 references null [Gone] text probable unresolved of Invoice__c',
      // Of an object nothing says, a field set is not followed: by a name in a text, by one that is not known, and by
      // a token.
      'PATH_NOT_FOLLOWED 15:40 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 15:90 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 16:40 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 16:89 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 17:62 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 17:98 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
    ]);
  });

  it('reads every record where a way of a branch is of no known type, and a map of records as a map', () => {
    const analysis = analysed((source) => {
      rules(source);
      source.object('Other__mdt', '<label>Other</label>');
      source.field('Other__mdt', 'Field__c', '<type>Text</type>');
      source.apexClass(
        'Branches',
        code(
          'public class Branches {',
          '    static void process(Map<String, Rule__mdt> rules) {}',
          '    static void process(List<String> names) {}',
          '    void m(Invoice__c inv, Boolean flag, pkg.Provider p) {',
          "        Rule__mdt a = flag ? Rule__mdt.getInstance('Open') : p.rule();",
          '        inv.get(a.Field__c);',
          "        Rule__mdt b = flag ? p.rule() : Rule__mdt.getInstance('Open');",
          '        inv.get(b.Field__c);',
          "        Rule__mdt c = Rule__mdt.getInstance('Open') ?? p.rule();",
          '        inv.get(c.Field__c);',
          "        Rule__mdt twice = Rule__mdt.getInstance('Open');",
          "        twice = Rule__mdt.getInstance('Late');",
          '        inv.get(twice.Field__c);',
          '        inv.get(Rule__mdt.getInstance(null).Field__c);',
          "        inv.get(Rule__mdt.getInstance('Late').Kind__c);",
          "        inv.get(Other__mdt.getInstance('Any').Field__c);",
          '        process(Rule__mdt.getAll());',
          '        sets(Schema.SObjectType.Invoice__c.fieldSets.getMap());',
          '    }',
          '    static void sets(Map<String, Schema.FieldSet> sets) {}',
          '    static void sets(List<String> names) {}',
          '}',
        ),
      );
    });
    expect([...byMember(analysis), ...said(analysis, new Set(['call']))]).toEqual([
      // A way of a branch that is of no known type can be any record, in either order and with `??`.
      'branches#method:m(invoice__c,boolean,pkg.provider) 5:53 references CustomMetadata:rule.open probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 6:19 reads CustomField:invoice__c.amount__c probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 6:19 reads CustomField:invoice__c.status__c probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 7:64 references CustomMetadata:rule.open probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 8:19 reads CustomField:invoice__c.amount__c probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 8:19 reads CustomField:invoice__c.status__c probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 9:46 references CustomMetadata:rule.open probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 10:19 reads CustomField:invoice__c.amount__c probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 10:19 reads CustomField:invoice__c.status__c probable',
      // A local assigned twice keeps its declared type: any record. `null` names none.
      'branches#method:m(invoice__c,boolean,pkg.provider) 11:50 references CustomMetadata:rule.open probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 12:40 references CustomMetadata:rule.late probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 13:23 reads CustomField:invoice__c.amount__c probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 13:23 reads CustomField:invoice__c.status__c probable',
      // A picklist holds no text that is read, and a type the snapshot holds no record of gives none.
      'branches#method:m(invoice__c,boolean,pkg.provider) 15:40 references CustomMetadata:rule.late probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 15:47 reads CustomObject:invoice__c possible',
      'branches#method:m(invoice__c,boolean,pkg.provider) 16:41 references null probable',
      'branches#method:m(invoice__c,boolean,pkg.provider) 16:47 reads CustomObject:invoice__c possible',
      // The map of `getAll()` is a map of records by their names, and that of field sets a map of field sets.
      '17:9 calls ApexClass:branches#method:process(map<string,rule__mdt>) [process] call confirmed resolved',
      '18:9 calls ApexClass:branches#method:sets(map<string,schema.fieldset>) [sets] call confirmed resolved',
    ]);
  });

  it('reads what a method makes of an empty text that a call hands it, and the field sets of a map', () => {
    const analysis = analysed((source) => {
      rules(source);
      source.fieldSet('Invoice__c', 'Summary', ['Amount__c']);
      source.apexClass(
        'Empty',
        code(
          'public class Empty {',
          "    static Object lit(Invoice__c inv, String prefix) { return inv.get(prefix + 'Amount__c'); }",
          '    static Object held(Invoice__c inv, String prefix) {',
          "        return inv.get(prefix + Rule__mdt.getInstance('Open').Field__c);",
          '    }',
          '    void sets() {',
          '        Map<String, Schema.FieldSet> all = Schema.SObjectType.Invoice__c.fieldSets.getMap();',
          '        for (Schema.FieldSet one : all.values()) one.getFields();',
          "        all.get('');",
          "        all.get('No such set');",
          '        all.keySet();',
          '        Schema.FieldSet gone = Schema.SObjectType.Invoice__c.fieldSets.Gone;',
          '    }',
          '}',
        ),
      );
      source.apexClass(
        'EmptyCaller',
        code(
          'public class EmptyCaller {',
          '    void m(Invoice__c inv) {',
          "        Empty.lit(inv, '');",
          "        Empty.held(inv, '');",
          '    }',
          '}',
        ),
      );
    });
    expect([...byMember(analysis), ...said(analysis, new Set(['token']))]).toEqual([
      // The method names the record itself.
      'empty#method:held(invoice__c,string) 4:56 references CustomMetadata:rule.open probable',
      // Every field set of a map can be read. A known text that is no name names none, and the names of the field
      // sets are no field set.
      'empty#method:sets() 8:40 reads CustomObject:invoice__c possible',
      // A field set the snapshot does not hold, named by a token.
      'empty#method:sets() 12:72 reads CustomObject:invoice__c possible',
      // A name the method makes of an empty text that a call hands it is the caller's, where the call stands.
      'emptycaller#method:m(invoice__c) 3:15 reads CustomField:invoice__c.amount__c probable',
      'emptycaller#method:m(invoice__c) 4:15 reads CustomField:invoice__c.status__c probable',
      '4:33 references CustomObject:rule__mdt [Rule__mdt] token confirmed resolved',
      '7:63 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '12:51 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '12:72 references null [Gone] token probable unresolved of Invoice__c',
    ]);
  });

  it('says which step found each name of a text, and which warnings a text leads to', () => {
    const analysis = analysed((source) => {
      rules(source);
      source.fieldSet('Invoice__c', 'Summary', ['Amount__c']);
      source.apexClass(
        'Steps',
        code(
          'public class Steps {',
          "    static final String FIELD = 'Amount__c';",
          "    static String given() { return 'Status__c'; }",
          '    static Object take(Invoice__c inv, String f) { return inv.get(f); }',
          '    void written(Invoice__c inv) {',
          "        inv.get('Amount__c');",
          "        String local = 'Status__c';",
          '        inv.get(local);',
          "        Database.query('SELECT Amount__c FROM Invoice__c');",
          "        Type.forName('Steps');",
          '    }',
          '    void built(Invoice__c inv, Boolean flag) {',
          "        inv.get('Amount' + '__c');",
          '        inv.get(FIELD);',
          '        inv.get(given());',
          "        take(inv, 'Amount__c');",
          "        inv.get(flag ? 'Amount__c' : 'Status__c');",
          '    }',
          '    void held(Invoice__c inv) {',
          "        inv.get(Rule__mdt.getInstance('Late').Field__c);",
          "        Database.query('SELECT ' + Rule__mdt.getInstance('Open').Field__c + ' FROM Invoice__c');",
          "        take(inv, Rule__mdt.getInstance('Late').Field__c);",
          "        Schema.SObjectType.Invoice__c.fieldSets.getMap().get('Summary');",
          '        Schema.SObjectType.Invoice__c.FieldSets.Summary.getFields();',
          '        inv.get(rule());',
          '    }',
          "    static String rule() { return Rule__mdt.getInstance('Late').Field__c; }",
          '    void unknown(Invoice__c inv, String any, List<SObject> rows, Task t) {',
          "        Database.query('SELECT ' + any + ' FROM Invoice__c');",
          '        Database.query(any);',
          "        Schema.getGlobalDescribe().get(any).getDescribe().fieldSets.getMap().get('Summary');",
          '        insert rows;',
          '        SObject what = t.What;',
          '        Object name = what.Name;',
          "        Object subject = what.get('Subject');",
          '        SObject who = t.Who;',
          "        Object title = who.get('Title');",
          '        Object called = who.Name;',
          '        SObject same = t.What;',
          '        Object one = same.Name;',
          "        Object two = same.get('Name');",
          "        Database.query('SELECT Guess__r.Name FROM Account');",
          '    }',
          '    void mixed(Invoice__c inv) {',
          "        inv.getSObject('Account' + '__r');",
          "        inv.getSObject('Account__r');",
          "        Schema.SObjectType.Invoice__c.fields.getMap().get('Amount' + '__c');",
          "        Schema.SObjectType.Invoice__c.fields.getMap().get('Amount__c');",
          "        Schema.getGlobalDescribe().get('Invoice' + '__c');",
          "        Schema.getGlobalDescribe().get('Invoice__c');",
          "        Type.forName('Ste' + 'ps');",
          "        String cls = 'Steps';",
          '        Type.forName(cls);',
          "        Type.forName('Ste' + 'ps');",
          '    }',
          '}',
        ),
      );
    });
    const stepped = [
      ...analysis.components
        .filter((one) => isApex(one.key))
        .flatMap((one) => one.references)
        .filter((one) => viaOf(one) === 'text')
        .map(
          (one) =>
            `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} ${one.confidence} ${JSON.stringify(one.attrs?.['step'])}`,
        ),
      ...warned(analysis.issues),
    ];
    expect(stepped).toEqual([
      // A text the code builds of more than one literal, a constant, a text a method gives back and a text a call
      // hands a method are built, also where the parts are literals.
      '13:18 reads CustomField:invoice__c.amount__c probable "built"',
      '14:17 reads CustomField:invoice__c.amount__c probable "built"',
      '15:17 reads CustomField:invoice__c.status__c probable "built"',
      '16:20 reads CustomField:invoice__c.amount__c probable "built"',
      // Each way of a branch that is one literal is written.
      '17:25 reads CustomField:invoice__c.amount__c probable "written"',
      '17:39 reads CustomField:invoice__c.status__c probable "written"',
      // A name that a field of a record of custom metadata holds is of metadata where the code reads the field, also
      // in a query and in a text a call hands a method. The name of the record is written.
      '20:40 references CustomMetadata:rule.late probable "written"',
      '20:47 reads CustomField:invoice__c.amount__c probable "metadata"',
      '21:59 references CustomMetadata:rule.open probable "written"',
      '21:66 reads CustomField:invoice__c.status__c probable "metadata"',
      '21:84 reads CustomObject:invoice__c probable "built"',
      '22:42 references CustomMetadata:rule.late probable "written"',
      '22:49 reads CustomField:invoice__c.amount__c probable "metadata"',
      // The fields a field set shows are of metadata, whether a text or a token names the field set.
      '23:63 reads CustomField:invoice__c.amount__c probable "metadata"',
      '23:63 references FieldSet:invoice__c.summary probable "written"',
      '24:49 reads CustomField:invoice__c.amount__c probable "metadata"',
      // So is a text of metadata that a method gives back, where the code uses it.
      '25:17 reads CustomField:invoice__c.amount__c probable "metadata"',
      // Each text has its own step, also one after another of the other step: a relationship, a field of a describe,
      // an object of the org and a class.
      '45:25 reads CustomField:invoice__c.account__c probable "built"',
      '46:25 reads CustomField:invoice__c.account__c probable "written"',
      '47:60 references CustomField:invoice__c.amount__c probable "built"',
      '48:60 references CustomField:invoice__c.amount__c probable "written"',
      '49:41 references CustomObject:invoice__c probable "built"',
      '50:41 references CustomObject:invoice__c probable "written"',
      '51:23 uses-type ApexClass:steps probable "built"',
      '52:23 uses-type ApexClass:steps probable "written"',
      '54:23 uses-type ApexClass:steps probable "built"',
      '27:58 references CustomMetadata:rule.late probable "written"',
      // A part that is not known is a possible reference, which the analysis counts apart.
      '29:36 reads CustomObject:invoice__c possible "built"',
      '29:49 reads CustomObject:invoice__c probable "built"',
      '42:32 reads null probable "written"',
      '42:51 reads CustomObject:account probable "written"',
      // A class that `Type.forName` is given as a literal is written, and so is a literal of a variable or a query.
      '10:23 uses-type ApexClass:steps probable "written"',
      '6:18 reads CustomField:invoice__c.amount__c probable "written"',
      '7:25 reads CustomField:invoice__c.status__c probable "written"',
      '9:32 reads CustomField:invoice__c.amount__c probable "written"',
      '9:47 reads CustomObject:invoice__c probable "written"',
      // A path that a text leads to and is not followed says so, and DML on records of no known object does not.
      'PATH_NOT_FOLLOWED 30:24 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 31:40 {"notFollowed":[],"endsAt":"object","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 31:83 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 32:9 {"op":"insert","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      // A warning that a name of a text and a name of the code meet at says so, whichever comes first, also where the
      // text adds no name to it.
      'PATH_NOT_FOLLOWED 33:26 {"relationship":"What","notFollowed":["Name","Subject"],"endsAt":"field","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 36:25 {"relationship":"Who","notFollowed":["Title","Name"],"endsAt":"field","origin":"parser:apex","via":"text"}',
      'PATH_NOT_FOLLOWED 39:26 {"relationship":"What","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex","via":"text"}',
      // Another warning of a text does not.
      'RELATIONSHIP_GUESSED 42:32 {"relationship":"Guess__r","object":"Account","field":"Guess__c"}',
      'PATH_NOT_FOLLOWED 42:32 {"relationship":"Guess__r","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex","via":"text"}',
    ]);
    // A reference of another way has no step.
    expect(
      analysis.components
        .flatMap((one) => one.references)
        .filter((one) => viaOf(one) !== 'text' && one.attrs?.['step'] !== undefined),
    ).toEqual([]);
    // The analysis counts them: a name of each step, and the possible references and the paths of texts apart.
    expect(analysis.work.find((row) => row.origin === 'parser:apex')?.texts).toEqual({
      written: 18,
      metadata: 6,
      built: 11,
      possible: 1,
      pathsNotFollowed: 7,
    });
  });

  it('takes the step of a name from the characters of its own text, whatever the code reads in between', () => {
    const analysis = analysed((source) => {
      rules(source);
      source.metadataRecord('Rule', 'Pre', { Field__c: 'Status' });
      source.metadataRecord('Rule', 'Suf', { Field__c: '__c' });
      source.metadataRecord('Rule', 'Fmt', { Field__c: 'SELECT Amount__c FROM {0}' });
      source.apexClass('Aaa', code('public class Aaa {', '    void a() { String s = Held.q(); }', '}'));
      source.apexClass(
        'Held',
        code(
          'public class Held {',
          "    static final String Q = 'SELECT Field__c, Label__c FROM Rule__mdt';",
          "    static final String KIND = Rule__mdt.getInstance('Late').Field__c;",
          "    static final String TERM = Rule__mdt.getInstance('Open').Field__c;",
          "    public static String q() { Database.query('SELECT Field__c, Label__c FROM Rule__mdt'); return ''; }",
          '    void constant() { Database.query(Q); }',
          '    void bound() {',
          "        String q = 'SELECT Amount__c FROM Invoice__c';",
          "        q += ' WHERE Status__c = :KIND';",
          '        Database.query(q);',
          '    }',
          '    void searched(String more) {',
          "        Search.query('FIND :TERM IN ALL FIELDS RETURNING Invoice__c(Amount__c)' + more);",
          '    }',
          '    void joined(Invoice__c inv) {',
          "        inv.get(Rule__mdt.getInstance('Pre').Field__c + '__c');",
          "        inv.get('Status' + Rule__mdt.getInstance('Suf').Field__c);",
          '    }',
          '    void sets() { Schema.SObjectType.Invoice__c.fieldSets.getMap().values(); }',
          "    void relationship(Task t) { SObject w = t.getSObject('What'); Object n = w.Name; }",
          '    static Object take(Invoice__c inv, String f) { return inv.get(f); }',
          "    void readFirst(Invoice__c inv) { String f = 'Amount__c'; inv.get(f); take(inv, f); }",
          "    void handedFirst(Invoice__c inv) { String f = 'Status__c'; take(inv, f); inv.get(f); }",
          "    void format() { Database.query(String.format(Rule__mdt.getInstance('Fmt').Field__c, new List<String>{ 'Invoice__c' })); }",
          '}',
        ),
      );
    });
    const stepped = [
      ...analysis.components
        .filter((one) => isApex(one.key))
        .flatMap((one) => one.references.map((reference) => ({ from: one.key, reference })))
        .filter(({ reference }) => viaOf(reference) === 'text')
        .map(
          ({ from, reference }) =>
            `${from.replace(/^ApexClass:held#/, '')} ${String(reference.location?.line)}:${String(reference.location?.column)} ${reference.kind} ${String(reference.to)} ${reference.confidence} ${JSON.stringify(reference.attrs?.['step'])}`,
        ),
      ...warned(analysis.issues),
    ];
    expect(stepped).toEqual([
      // What a query binds is read as code in the middle of its text, also a constant that reads metadata: the names of
      // the text after it keep the step of the text, as the variable the text binds does.
      'method:bound() 8:28 reads CustomField:invoice__c.amount__c probable "built"',
      'method:bound() 8:43 reads CustomObject:invoice__c probable "built"',
      'method:bound() 9:22 reads CustomField:invoice__c.status__c probable "built"',
      'method:bound() 9:35 reads ApexClass:held#var:kind probable "built"',
      // A field of a record of custom metadata that a query names holds no text there.
      'method:constant() 6:38 reads CustomField:rule__mdt.field__c probable "built"',
      'method:constant() 6:38 reads CustomField:rule__mdt.label__c probable "built"',
      'method:constant() 6:38 reads CustomObject:rule__mdt probable "built"',
      // The characters of a field keep their mark when the code cuts the text, here as the format of String.format.
      'method:format() 24:73 references CustomMetadata:rule.fmt probable "written"',
      'method:format() 24:79 reads CustomField:invoice__c.amount__c probable "metadata"',
      'method:format() 24:108 reads CustomObject:invoice__c probable "built"',
      // A reference made twice at one place keeps the step of the first.
      'method:handedfirst(invoice__c) 23:52 reads CustomField:invoice__c.status__c probable "built"',
      // A name that metadata holds only a part of is built, whichever part comes first.
      'method:joined(invoice__c) 16:40 references CustomMetadata:rule.pre probable "written"',
      'method:joined(invoice__c) 16:46 reads CustomField:invoice__c.status__c probable "built"',
      'method:joined(invoice__c) 17:18 reads CustomField:invoice__c.status__c probable "built"',
      'method:joined(invoice__c) 17:51 references CustomMetadata:rule.suf probable "written"',
      // A method that another class works out first is the same.
      'method:q() 5:55 reads CustomField:rule__mdt.field__c probable "written"',
      'method:q() 5:65 reads CustomField:rule__mdt.label__c probable "written"',
      'method:q() 5:79 reads CustomObject:rule__mdt probable "written"',
      'method:readfirst(invoice__c) 22:50 reads CustomField:invoice__c.amount__c probable "written"',
      'method:relationship(task) 20:59 reads CustomField:task.whatid probable "written"',
      // So does what a search binds.
      'method:searched(string) 13:29 reads ApexClass:held#var:term probable "built"',
      'method:searched(string) 13:58 reads CustomObject:invoice__c probable "built"',
      'method:searched(string) 13:69 reads CustomField:invoice__c.amount__c probable "built"',
      // Every field set of the object is metadata too.
      'method:sets() 19:68 reads CustomObject:invoice__c possible "metadata"',
      'var:kind 3:55 references CustomMetadata:rule.late probable "written"',
      'var:term 4:55 references CustomMetadata:rule.open probable "written"',
      'PATH_NOT_FOLLOWED 13:83 {"notFollowed":[],"origin":"parser:apex","via":"text"}',
      // A path after a relationship that a text names is of a text, also where the code names what comes after it.
      'PATH_NOT_FOLLOWED 20:59 {"relationship":"What","notFollowed":["Name"],"endsAt":"field","origin":"parser:apex","via":"text"}',
    ]);
  });

  it('keeps each use of a text once, so that a chain of calls is read in time', () => {
    const lines = ['public class Chain {', '    static Object c0(Invoice__c inv, String f) { return inv.get(f); }'];
    for (let depth = 1; depth <= 24; depth += 1) {
      lines.push(
        `    static void c${String(depth)}(Invoice__c inv, String f) { c${String(depth - 1)}(inv, f); c${String(depth - 1)}(inv, f); }`,
      );
    }
    lines.push("    void m(Invoice__c inv) { c24(inv, 'Amount__c'); }", '}');
    const analysis = analysed((source) => {
      source.apexClass('Chain', code(...lines));
    });
    expect(byMember(analysis)).toEqual([
      // 24 methods, each of which calls the next twice: what the first does is read once at the call.
      'chain#method:m(invoice__c) 27:40 reads CustomField:invoice__c.amount__c probable',
    ]);
  });
});
