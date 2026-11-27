/**
 * The analysis of Apex classes and triggers (decision record 0084): a component for each class and trigger and for
 * each of their members, and the references of their declarations and of the types they use.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second runs on small classes
 * that are written here, for what the fixture does not have.
 */
import { hash } from 'node:crypto';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildKey, type ComponentKey, parentKey, parseKey } from '../src/core/keys.ts';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import { buildApexTypes, resolveApex, type TypeUse } from '../src/extraction/apex.ts';
import type { ApexReader } from '../src/extraction/apex-syntax.ts';
import { buildModel } from '../src/extraction/model.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { ApexSource, codes, viaOf } from './helpers/written-source.ts';

const GOLDEN = join(import.meta.dirname, 'golden');
/** The kinds of reference this analysis gives: those of declarations and of uses of a type. */
const KINDS: ReadonlySet<string> = new Set(['extends', 'implements', 'uses-type', 'triggers-on']);
const isApexFile = (file: string): boolean => /\.(?:cls|trigger)$/.test(file);
const isApex = (key: string): boolean => key.startsWith('ApexClass:') || key.startsWith('ApexTrigger:');

/** A reference as the answer key says one: where it starts, where it stands, what it is, and how sure. */
const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  return `${reference.from} ${file}:${String(line)}:${String(column)}:${reference.kind}:${String(reference.to)} ${viaOf(reference)} ${reference.confidence}`;
};

let reader: ApexReader;
beforeAll(async () => {
  reader = await loadApexReader();
});

describe('the Apex of the fixture project', () => {
  const answers = loadAnswerKey();
  const keyed = answers.references.filter((one) => isApexFile(one.file) && KINDS.has(one.kind));
  const idOfKeyed = (one: (typeof keyed)[number]): string => `${one.from} ${one.id} ${one.via} ${one.tier}`;
  let analysis: SourceAnalysis;
  let apex: AnalysedComponent[];
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components, { apex: reader });
    apex = analysis.components.filter((one) => isApex(one.key));
    references = apex.flatMap((one) => one.references).filter((one) => KINDS.has(one.kind));
  });

  it('gives every reference of the key of a declaration and of a use of a type, at its place, and no other', () => {
    expect(keyed).toHaveLength(137);
    expect(keyed.filter((one) => one.stretch)).toEqual([]);
    const found = references.map(idOf).sort();
    expect(keyed.map(idOfKeyed).filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(keyed.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
  });

  it('says that each is read from Apex, and where it points at an object or a class of the project', () => {
    const standard = new Set<string>(answers.standard);
    for (const one of references) {
      expect(one.origin, idOf(one)).toBe('parser:apex');
      expect(one.to, idOf(one)).not.toBeNull();
      // A target the project does not hold is an object Salesforce provides, and the key lists it.
      expect(one.resolution === 'resolved' || standard.has(String(one.to)), idOf(one)).toBe(true);
    }
    // A trigger refers to its object with the events it runs on.
    expect(references.filter((one) => one.kind === 'triggers-on').map((one) => [one.from, one.attrs])).toEqual([
      ['ApexTrigger:invoicelinetrigger', { via: 'declaration', events: ['before insert', 'before update'] }],
      [
        'ApexTrigger:invoicetrigger',
        { via: 'declaration', events: ['before insert', 'before update', 'after update'] },
      ],
    ]);
  });

  it('reports no such reference where the key forbids one', () => {
    const forbidden = answers.negatives.filter((one) => isApexFile(one.file));
    expect(forbidden.length).toBeGreaterThan(0);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
  });

  it('has a component for every class, trigger and member the key names, with its definition', () => {
    const keys = new Map(apex.map((one) => [one.key as string, one]));
    const named = answers.references.flatMap((one) =>
      isApexFile(one.file) ? [one.from, ...(isApex(one.to) ? [one.to] : [])] : isApex(one.to) ? [one.to] : [],
    );
    expect(named.length).toBeGreaterThan(300);
    for (const one of new Set(named)) {
      const component = keys.get(one);
      expect(component, one).toBeDefined();
      expect(component?.attrs, one).not.toBeNull();
      expect(component?.definition, one).not.toBeNull();
    }
    expect(apex.filter((one) => !one.key.includes('#')).map((one) => one.name)).toEqual(
      answers.components.filter((one) => isApex(one.key)).map((one) => one.fullName),
    );
  });

  it('lists every component of Apex as its golden file says', async () => {
    const said = apex.map((one) => `${one.key}  ${one.name}  ${JSON.stringify(one.attrs)}`);
    await expect(`${said.join('\n')}\n`).toMatchFileSnapshot(join(GOLDEN, 'apex-components.txt'));
    for (const one of apex.filter((component) => component.key.includes('#'))) {
      // A member is of the file of its class, and its definition is its own part of that file.
      const top = apex.find((component) => component.key === parseKey(one.key).type + ':' + parseKey(one.key).name);
      expect(one.definition?.path, one.key).toBe(top?.definition?.path.replace(/-meta\.xml$/, ''));
      expect(
        apex.some((component) => component.key === parentKey(one.key)),
        one.key,
      ).toBe(true);
    }
  });

  it('are counted for the reader of Apex, and are not yet among the types that are read', () => {
    // An answer counts classes and triggers as not analysed while their code is read only in part.
    expect(analysis.types.filter((type) => type.startsWith('Apex'))).toEqual([]);
    expect(analysis.work.find((row) => row.origin === 'parser:apex')).toEqual({
      origin: 'parser:apex',
      components: apex.length,
      failedFiles: 0,
    });
    // The issues of the code are those of the resolver (`extraction-apex-resolver.test.ts`): DML on a list of
    // `SObject`, and names in texts that the code does not know, the 8 unknown places of the key.
    expect(
      analysis.issues
        .filter((issue) => issue.componentKey !== null && isApex(issue.componentKey))
        .map((one) => one.code),
    ).toEqual(Array<string>(8).fill('PATH_NOT_FOLLOWED'));
  });
});

describe('the analysis of Apex', () => {
  /** The analysis of a source of classes and triggers, with the object `Invoice__c`. */
  const analysed = (write: (source: ApexSource) => void): SourceAnalysis => {
    const source = new ApexSource();
    source.object('Invoice__c', '<label>Invoice</label>');
    write(source);
    return analyseSource(source.tree, source.listed, { apex: reader });
  };
  /** The components of Apex of an analysis, with their attributes. */
  const membersOf = (analysis: SourceAnalysis): string[] =>
    analysis.components
      .filter((one) => isApex(one.key))
      .map((one) => `${one.key} ${one.name} ${JSON.stringify(one.attrs)}`);
  /** The types the components use, and what they extend and implement: not the calls, which the resolver reads. */
  const usesOf = (analysis: SourceAnalysis): string[] =>
    analysis.components
      .filter((one) => isApex(one.key))
      .flatMap((one) =>
        one.references
          .filter((reference) => reference.kind !== 'calls')
          .map(
            (reference) =>
              `${one.key} ${String(reference.location?.line)}:${String(reference.location?.column)} ${reference.kind} ${String(reference.to)} [${reference.toNameRaw}] ${viaOf(reference)} ${reference.confidence} ${reference.resolution}`,
          ),
      );

  it('writes a type in a signature as written, without System, and an inner type with its class', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Signatures',
        [
          'public class Signatures {',
          '    public class Row { }',
          '    public enum Mode { FAST }',
          '    public Signatures(System.Type t, Row r) { }',
          '    void take(List<Row> rows, Map<String, Mode> modes, Row[] more, Schema.Account a) { }',
          '    void take(Signatures.Row r) { }',
          '}',
          '',
        ].join('\n'),
      );
    });
    expect(membersOf(analysis)).toEqual([
      'ApexClass:signatures Signatures {"kind":"class"}',
      'ApexClass:signatures#ctor:(type,signatures.row) Signatures.Signatures(System.Type, Row) {}',
      'ApexClass:signatures#inner:mode Signatures.Mode {"kind":"enum"}',
      'ApexClass:signatures#inner:row Signatures.Row {"kind":"class"}',
      'ApexClass:signatures#method:take(list<signatures.row>,map<string,signatures.mode>,list<signatures.row>,schema.account) Signatures.take(List<Row>, Map<String,Mode>, Row[], Schema.Account) {}',
      'ApexClass:signatures#method:take(signatures.row) Signatures.take(Signatures.Row) {}',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('makes a component of each variable, of the property, of each kind of initialiser and of a class in a trigger', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Parts',
        [
          'public class Parts {',
          '    Integer a = 1, b;',
          '    static { Invoice__c zero; }',
          '    { b = 3; }',
          '    static { Invoice__c first; }',
          '    public String label { get; set; }',
          '}',
          '',
        ].join('\n'),
      );
      source.apexTrigger(
        'OnInvoice',
        [
          'trigger OnInvoice on Invoice__c (before insert, after   delete) {',
          '    class Helper { void run(Invoice__c record) { } }',
          '}',
          '',
        ].join('\n'),
      );
    });
    expect(membersOf(analysis)).toEqual([
      'ApexClass:parts Parts {"kind":"class"}',
      'ApexClass:parts#init:instance Parts.{} {}',
      'ApexClass:parts#init:static Parts.static {} {}',
      'ApexClass:parts#prop:label Parts.label {}',
      'ApexClass:parts#var:a Parts.a {}',
      'ApexClass:parts#var:b Parts.b {}',
      'ApexTrigger:oninvoice OnInvoice {"object":"Invoice__c","events":["before insert","after delete"]}',
      'ApexTrigger:oninvoice#inner:helper OnInvoice.Helper {"kind":"class"}',
      'ApexTrigger:oninvoice#inner:helper/method:run(invoice__c) OnInvoice.Helper.run(Invoice__c) {}',
    ]);
    // The two static initialisers are one component: its definition is the text of both, and it uses what both use.
    expect(analysis.components.find((one) => one.key === 'ApexClass:parts#init:static')?.definition).toEqual({
      path: 'classes/Parts.cls',
      contentHash: hash('sha256', 'static { Invoice__c zero; }\nstatic { Invoice__c first; }', 'buffer'),
    });
    expect(usesOf(analysis)).toEqual([
      // The instance initialiser sets the variable `b`, which the resolver reads (`extraction-apex-resolver.test.ts`).
      'ApexClass:parts#init:instance 4:7 writes ApexClass:parts#var:b [b] field confirmed resolved',
      'ApexClass:parts#init:static 3:14 uses-type CustomObject:invoice__c [Invoice__c] type confirmed resolved',
      'ApexClass:parts#init:static 5:14 uses-type CustomObject:invoice__c [Invoice__c] type confirmed resolved',
      'ApexTrigger:oninvoice 1:22 triggers-on CustomObject:invoice__c [Invoice__c] declaration confirmed resolved',
      'ApexTrigger:oninvoice#inner:helper/method:run(invoice__c) 2:29 uses-type CustomObject:invoice__c [Invoice__c] type confirmed resolved',
    ]);
  });

  it('gives a member the text it spans as its definition, which changes with nothing else', () => {
    const versions = ['void a() { }', 'void a() { Integer i; }'].map((first) => {
      const source = new ApexSource();
      source.apexClass('Spans', `public class Spans {\n    ${first}\n    @TestVisible void b() { }\n}\n`);
      const analysis = analyseSource(source.tree, source.listed, { apex: reader });
      return new Map(analysis.components.map((one) => [one.key as string, one.definition]));
    });
    const [before, after] = versions;
    expect(after?.get('ApexClass:spans#method:a()')?.contentHash).not.toEqual(
      before?.get('ApexClass:spans#method:a()')?.contentHash,
    );
    expect(after?.get('ApexClass:spans#method:b()')).toEqual(before?.get('ApexClass:spans#method:b()'));
    // The annotation stands in the text of the method.
    expect(before?.get('ApexClass:spans#method:b()')).toEqual({
      path: 'classes/Spans.cls',
      contentHash: hash('sha256', '@TestVisible void b() { }', 'buffer'),
    });
  });

  it('marks a test class with all its members, and a test method of either kind', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Tested',
        [
          '@IsTest(SeeAllData=false)',
          'private class Tested {',
          '    static Integer count;',
          '    static { count = 0; }',
          '    class Helper { void help() { } }',
          '    static void make() { }',
          '}',
          '',
        ].join('\n'),
      );
      source.apexClass(
        'OldStyle',
        [
          'public class OldStyle {',
          '    static testMethod void old() { }',
          '    @isTest static void annotated() { }',
          '    @TestVisible static void visible() { }',
          '}',
          '',
        ].join('\n'),
      );
    });
    expect(membersOf(analysis)).toEqual([
      'ApexClass:oldstyle OldStyle {"kind":"class"}',
      'ApexClass:oldstyle#method:annotated() OldStyle.annotated() {"test":true}',
      'ApexClass:oldstyle#method:old() OldStyle.old() {"test":true}',
      'ApexClass:oldstyle#method:visible() OldStyle.visible() {}',
      'ApexClass:tested Tested {"kind":"class","test":true}',
      'ApexClass:tested#init:static Tested.static {} {"test":true}',
      'ApexClass:tested#inner:helper Tested.Helper {"kind":"class","test":true}',
      'ApexClass:tested#inner:helper/method:help() Tested.Helper.help() {"test":true}',
      'ApexClass:tested#method:make() Tested.make() {"test":true}',
      'ApexClass:tested#var:count Tested.count {"test":true}',
    ]);
  });

  it('refers to a class, an inner type and an object it uses as a type, and to nothing of Salesforce or itself', () => {
    const analysis = analysed((source) => {
      source.apexClass('Base', 'public virtual class Base {\n    public class Inner { }\n}\n');
      source.apexClass('Pages', 'public class Pages implements Iterable<Pages> {\n    Pages next;\n}\n');
      source.apexClass('Failure', 'public class Failure extends Exception { }\n');
      source.apexClass(
        'Catches',
        [
          'public class Catches {',
          '    void m() {',
          '        try { } catch (Failure e) { } catch (Exception e) { }',
          '        Object stub = Test.createStub(Pages.class, null);',
          '    }',
          '    Type t = Base.Inner.class;',
          '}',
          '',
        ].join('\n'),
      );
      source.apexClass('Able', 'public interface Able { }\n');
      source.apexClass(
        'Uses',
        [
          'public class Uses extends Base implements Able, Database.Batchable<Invoice__c> {',
          '    public class Own { }',
          '    Base.Inner inner;',
          '    Own own = new Own();',
          '    Database.SaveResult result;',
          '    Schema.Account account = new Account();',
          '    void m(Object o) {',
          '        Base b = (Base) o;',
          '        Boolean is = o instanceof Uses;',
          '        Invoice__c[] many = new Invoice__c[3];',
          '        List<Contact> people = new List<Contact>();',
          '        Quote__c q;',
          '        Opportunity_Thing x;',
          "        Type t = Type.forName('Base');",
          "        Type u = Type.forName('', 'Base.Inner');",
          "        Type v = System.Type.forName(null, 'Able');",
          "        Type w = Type.forName('NoSuchClass');",
          "        Type z = Type.forName('ns', 'Able');",
          '    }',
          '}',
          '',
        ].join('\n'),
      );
    });
    expect(usesOf(analysis).filter((one) => one.startsWith('ApexClass:uses'))).toEqual([
      'ApexClass:uses 1:27 extends ApexClass:base [Base] declaration confirmed resolved',
      'ApexClass:uses 1:43 implements ApexClass:able [Able] declaration confirmed resolved',
      'ApexClass:uses 1:68 uses-type CustomObject:invoice__c [Invoice__c] type confirmed resolved',
      'ApexClass:uses#method:m(object) 8:9 uses-type ApexClass:base [Base] type confirmed resolved',
      'ApexClass:uses#method:m(object) 8:19 uses-type ApexClass:base [Base] type confirmed resolved',
      'ApexClass:uses#method:m(object) 9:35 uses-type ApexClass:uses [Uses] type confirmed resolved',
      'ApexClass:uses#method:m(object) 10:9 uses-type CustomObject:invoice__c [Invoice__c] type confirmed resolved',
      'ApexClass:uses#method:m(object) 10:33 uses-type CustomObject:invoice__c [Invoice__c] type confirmed resolved',
      'ApexClass:uses#method:m(object) 11:14 uses-type CustomObject:contact [Contact] type confirmed external',
      'ApexClass:uses#method:m(object) 11:41 uses-type CustomObject:contact [Contact] type confirmed external',
      // An object that no file defines, of no package and not one every org has: nothing checks it (decision record
      // 0087).
      'ApexClass:uses#method:m(object) 12:9 uses-type null [Quote__c] type probable unresolved',
      'ApexClass:uses#method:m(object) 14:32 uses-type ApexClass:base [Base] text probable resolved',
      'ApexClass:uses#method:m(object) 15:36 uses-type ApexClass:base#inner:inner [Base.Inner] text probable resolved',
      'ApexClass:uses#method:m(object) 16:45 uses-type ApexClass:able [Able] text probable resolved',
      'ApexClass:uses#var:account 6:5 uses-type CustomObject:account [Schema.Account] type confirmed external',
      'ApexClass:uses#var:account 6:34 uses-type CustomObject:account [Account] new confirmed external',
      'ApexClass:uses#var:inner 3:5 uses-type ApexClass:base#inner:inner [Base.Inner] type confirmed resolved',
      'ApexClass:uses#var:own 4:5 uses-type ApexClass:uses#inner:own [Own] type confirmed resolved',
    ]);
    // A class that names itself as a type has no reference to itself. A member of it that names it has one.
    expect(usesOf(analysis).filter((one) => one.startsWith('ApexClass:pages'))).toEqual([
      'ApexClass:pages#var:next 2:5 uses-type ApexClass:pages [Pages] type confirmed resolved',
    ]);
    // A class that is caught, and a class literal. `Exception` is of Salesforce.
    expect(usesOf(analysis).filter((one) => /^ApexClass:(?:catches|failure)/.test(one))).toEqual([
      'ApexClass:catches#method:m() 3:24 uses-type ApexClass:failure [Failure] type confirmed resolved',
      'ApexClass:catches#method:m() 4:39 uses-type ApexClass:pages [Pages] type confirmed resolved',
      'ApexClass:catches#var:t 6:14 uses-type ApexClass:base#inner:inner [Base.Inner] type confirmed resolved',
    ]);
  });

  it('keeps a use of a type once for its kind, its target and its place', () => {
    const model = buildModel({
      defined: new Set<ComponentKey>(),
      objects: ['Invoice__c'],
      namedObjects: [],
      fields: new Map(),
    });
    const owner = buildKey({ type: 'ApexClass', fullName: 'Twice' });
    const use: TypeUse = { name: 'Invoice__c', at: { line: 2, column: 5 }, kind: 'uses-type', via: 'type' };
    const references = resolveApex(
      model,
      buildApexTypes({ units: [], inner: new Map() }),
      { key: owner, unit: owner, file: 'classes/Twice.cls' },
      [use, use, { ...use, via: 'new' }, { ...use, at: { line: 3, column: 5 } }],
    );
    expect(
      references.map((one) => `${String(one.location?.line)}:${String(one.location?.column)} ${viaOf(one)}`),
    ).toEqual(['2:5 type', '3:5 type']);
  });

  it('gives each member its key once, and leaves out a second one with what it holds', () => {
    const analysis = analysed((source) => {
      source.apexClass(
        'Twice',
        [
          'public class Twice {',
          '    void m(Invoice__c a) { }',
          '    void M(Invoice__c b) { }',
          '    class Inner { void one() { } }',
          '    class INNER { void two() { } }',
          '}',
          '',
        ].join('\n'),
      );
    });
    expect(membersOf(analysis)).toEqual([
      'ApexClass:twice Twice {"kind":"class"}',
      'ApexClass:twice#inner:inner Twice.Inner {"kind":"class"}',
      'ApexClass:twice#inner:inner/method:one() Twice.Inner.one() {}',
      'ApexClass:twice#method:m(invoice__c) Twice.m(Invoice__c) {}',
    ]);
    expect(codes(analysis.issues)).toEqual(['error KEY_COLLISION', 'error KEY_COLLISION']);
  });
});
