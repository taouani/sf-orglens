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
import { FIXTURES_DIR, loadAnswerKey, tierInRepository as repositoryTier } from './helpers/answer-key.ts';
import { ApexSource, viaOf } from './helpers/written-source.ts';

/** The ways of naming a target that this part of the resolver reads. */
const VIAS: ReadonlySet<string> = new Set(['field', 'token', 'dml']);
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

  it('gives every reference of the key of a field, a variable, a token and DML, at its place, and no other', () => {
    expect(keyed).toHaveLength(185);
    expect(keyed.filter((one) => one.stretch)).toEqual([]);
    const found = references.map(idOf).sort();
    expect(keyed.map(idOfKeyed).filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(keyed.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
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

  it('warns where the key says that what DML writes is not known, and nowhere else', () => {
    // The other places the key does not know are of queries, of names in texts and of calls: parts C and D and work
    // package 5 read them.
    const unknown = answers.unknowns.filter((one) => one.match === 'update' && isApexFile(one.file));
    expect(unknown.map((one) => `${one.file}:${String(one.line)}:${String(one.column)}`)).toEqual([
      'force-app/main/default/classes/InvoiceEvents.cls:7:9',
    ]);
    expect(
      analysis.issues
        .filter((one) => one.componentKey !== null && isApex(one.componentKey))
        .map((one) => [one.componentKey, one.code, one.details]),
    ).toEqual([
      [
        'ApexClass:invoiceevents#method:saveall(list<sobject>)',
        'PATH_NOT_FOLLOWED',
        {
          path: 'force-app/main/default/classes/InvoiceEvents.cls',
          line: 7,
          column: 9,
          op: 'update',
          notFollowed: [],
          endsAt: 'object',
          origin: 'parser:apex',
        },
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
  /** What the members refer to beyond the types they use: `line:column kind target [name] via tier resolution`. */
  const said = (analysis: SourceAnalysis): string[] =>
    analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) => one.references)
      .filter((one) => VIAS.has(viaOf(one)))
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
      '31:44 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '31:55 references CustomField:invoice__c.external_id__c [External_Id__c] token confirmed resolved',
    ]);
    // A list of `SObject`: the warning bears on an answer that holds an object (decision record 0074).
    expect(warned(analysis.issues)).toEqual([
      'PATH_NOT_FOLLOWED 10:9 {"op":"update","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 13:18 {"op":"delete","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 18:18 {"op":"delete","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
      'PATH_NOT_FOLLOWED 27:9 {"op":"insert","notFollowed":[],"endsAt":"object","origin":"parser:apex"}',
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
      // A name in a text is read with the names in texts (work package 5).
      '16:24 references CustomObject:invoice__c [Invoice__c] token confirmed resolved',
      '18:25 reads CustomField:invoice__c.status__c [Status__c] field confirmed resolved',
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
});
