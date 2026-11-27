/**
 * What a Lightning web component refers to (decision record 0094): what its JavaScript imports and what its templates
 * hold. The readers of the two languages are held by `extraction-javascript.test.ts` and `extraction-markup.test.ts`.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second runs on small components
 * that are written here, for what the fixture does not have.
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import { loadApexReader } from '../src/extraction/apex-reader.ts';
import type { ApexReader } from '../src/extraction/apex-syntax.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { ApexSource, codes, key, viaOf, xml } from './helpers/written-source.ts';

const isBundle = (key: string): boolean => key.startsWith('LightningComponentBundle:');

const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  return `${reference.from} ${file}:${String(line)}:${String(column)}:${reference.kind}:${String(reference.to)} ${viaOf(reference)} ${reference.confidence}`;
};

/** The references of the components of a source as `line:column kind target [name] tier resolution via`. */
const said = (analysis: SourceAnalysis, from = 'LightningComponentBundle:'): string[] =>
  analysis.components
    .filter((one) => one.key.startsWith(from))
    .flatMap((one) => one.references)
    .map((one) => {
      const method = one.attrs?.['method'];
      return `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} [${one.toNameRaw}] ${one.confidence} ${one.resolution} ${viaOf(one)}${typeof method === 'string' ? ` method ${method}` : ''}`;
    });

/** The issues of an analysis as `CODE path:line:column`. */
const placed = (analysis: SourceAnalysis): string[] =>
  analysis.issues.map((one) => {
    const { path, line, column } = (one.details ?? {}) as { path?: string; line?: number; column?: number };
    return `${one.code} ${String(path)}:${String(line)}:${String(column)}`;
  });

let reader: ApexReader;
beforeAll(async () => {
  reader = await loadApexReader();
});

describe('the Lightning web components of the fixture project', () => {
  const answers = loadAnswerKey();
  const keyed = answers.references.filter((one) => one.file.includes('/lwc/'));
  let analysis: SourceAnalysis;
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components, { apex: reader });
    references = analysis.components.filter((one) => isBundle(one.key)).flatMap((one) => one.references);
  });

  it('gives every reference of the key of an import, a tag and an attribute, at its place and tier, and no other', () => {
    expect(keyed).toHaveLength(12);
    expect(keyed.filter((one) => one.stretch)).toEqual([]);
    const wanted = keyed.map((one) =>
      `${one.from} ${one.id} ${one.via} ${one.tier}`.replace(` ${one.id} `, ` ${one.id.replace(/ /g, '')} `),
    );
    expect(references.map(idOf).sort()).toEqual(wanted.sort());
    // The JavaScript is read by one reader and the template by the other.
    for (const reference of references) {
      expect(reference.origin).toBe(reference.location?.file.endsWith('.js') ? 'parser:javascript' : 'parser:markup');
    }
  });

  it('reports none of them where the key forbids a reference, and warns about nothing', () => {
    const forbidden = answers.negatives.filter((one) => one.file.includes('/lwc/'));
    expect(forbidden).toHaveLength(2);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
    expect(analysis.issues.filter((one) => one.componentKey !== null && isBundle(one.componentKey))).toEqual([]);
  });

  it('reads both components with each reader, and leaves the type out of those an answer counts as read', () => {
    expect(analysis.work.slice(4)).toEqual([
      { origin: 'parser:javascript', components: 2, failedFiles: 0 },
      { origin: 'parser:markup', components: 2, failedFiles: 0 },
    ]);
    expect(analysis.types).not.toContain('LightningComponentBundle');
    // A component without references has no attributes either.
    expect(
      analysis.components.find((one) => one.key === key('LightningComponentBundle', 'invoiceBadge')),
    ).toMatchObject({ attrs: null, references: [] });
  });
});

/** A source with an object, two fields, a lookup to `Account`, a label, a permission and a class of methods. */
function project(): ApexSource {
  const source = new ApexSource();
  source.object('Invoice__c', '<label>Invoice</label>');
  source.field('Invoice__c', 'Amount__c', '<type>Currency</type>');
  source.field('Invoice__c', 'Status__c', '<type>Text</type>');
  source.field(
    'Invoice__c',
    'Account__c',
    '<referenceTo>Account</referenceTo>',
    '<relationshipName>Invoices</relationshipName>',
    '<type>Lookup</type>',
  );
  source.field('Account', 'Tier__c', '<type>Text</type>');
  const labels = source.file(
    'labels/CustomLabels.labels-meta.xml',
    xml(
      'CustomLabels',
      '<labels>',
      '    <fullName>Greeting</fullName>',
      '    <language>en_US</language>',
      '    <protected>false</protected>',
      '    <shortDescription>Greeting</shortDescription>',
      '    <value>Hello</value>',
      '</labels>',
    ),
  );
  source.listed.push({ type: 'CustomLabels', fullName: 'CustomLabels', files: [labels] });
  source.listed.push({ type: 'CustomLabel', fullName: 'Greeting', files: [labels] });
  const permission = source.file(
    'customPermissions/Approve.customPermission-meta.xml',
    xml('CustomPermission', '<label>Approve</label>'),
  );
  source.listed.push({ type: 'CustomPermission', fullName: 'Approve', files: [permission] });
  source.apexClass(
    'Ctrl',
    [
      'public with sharing class Ctrl {',
      '    @AuraEnabled(cacheable=true)',
      '    public static String one(Id recordId) { return null; }',
      '    public static String two(Id recordId) { return null; }',
      '    @AuraEnabled',
      '    public static String two(String name) { return null; }',
      '    @AuraEnabled',
      '    public static String three(Id recordId) { return null; }',
      '    @AuraEnabled',
      '    public static String three(String name) { return null; }',
      '    public static String four(Id recordId) { return null; }',
      '    public class Inner {',
      '        @AuraEnabled',
      '        public String five() { return null; }',
      '        @AuraEnabled',
      '        public String none() { return null; }',
      '    }',
      '}',
      '',
    ].join('\n'),
  );
  return source;
}

describe('the analysis of a Lightning web component', () => {
  it('calls the Apex method it imports, the one of its name that is @AuraEnabled, or the class without its code', () => {
    const source = project();
    source.bundle('card', {
      'card.js': [
        "import one from '@salesforce/apex/Ctrl.one';",
        "import two from '@salesforce/apex/Ctrl.two';",
        "import three from '@salesforce/apex/Ctrl.three';",
        "import four from '@salesforce/apex/Ctrl.four';",
        "import none from '@salesforce/apex/Ctrl.none';",
        "import five from '@salesforce/apex/Inner.five';",
        "import other from '@salesforce/apex/Missing.method';",
        "import packaged from '@salesforce/apex/ns.Remote.run';",
        "import later from '@salesforce/apexContinuation/Ctrl.one';",
        "import { refreshApex } from '@salesforce/apex';",
        '',
      ].join('\n'),
    });
    const analysis = analyseSource(source.tree, source.listed, { apex: reader });
    expect(said(analysis)).toEqual([
      '1:40 calls ApexClass:ctrl#method:one(id) [one] confirmed resolved import',
      // Of two methods of a name, only one is @AuraEnabled, which a component can import.
      '2:40 calls ApexClass:ctrl#method:two(string) [two] confirmed resolved import',
      // Two that are, and nothing tells them apart.
      '3:42 calls ApexClass:ctrl#method:three(id) [three] probable resolved import',
      '3:42 calls ApexClass:ctrl#method:three(string) [three] probable resolved import',
      // A method that is not @AuraEnabled is the only one of its name: it is still the method the module names.
      '4:41 calls ApexClass:ctrl#method:four(id) [four] confirmed resolved import',
      // The class has no method of the name, and an inner class is no class a component imports from.
      '5:41 calls ApexClass:ctrl [none] confirmed resolved import method none',
      '6:42 calls null [five] confirmed unresolved import method five',
      '7:45 calls null [method] confirmed unresolved import method method',
      // A class of a package is external.
      '8:50 calls ApexClass:ns__remote [run] confirmed external import method run',
      '9:54 calls ApexClass:ctrl#method:one(id) [one] confirmed resolved import',
    ]);
    expect(analysis.issues).toEqual([]);
    // Without the reader of Apex, the class is there and its methods are not known.
    expect(said(analyseSource(source.tree, source.listed)).slice(0, 2)).toEqual([
      '1:40 calls ApexClass:ctrl [one] confirmed resolved import method one',
      '2:40 calls ApexClass:ctrl [two] confirmed resolved import method two',
    ]);
  });

  it('refers to the objects, fields, labels, permissions and components it imports, also across relationships', () => {
    const source = project();
    source.bundle('other', { 'other.js': 'export default 1;\n' });
    source.bundle('card', {
      'card.js': [
        "import INVOICE from '@salesforce/schema/Invoice__c';",
        "import AMOUNT from '@salesforce/schema/Invoice__c.Amount__c';",
        "import TIER from '@salesforce/schema/Invoice__c.Account__r.Tier__c';",
        "import NAME from '@salesforce/schema/Account.Name';",
        "import MISSING from '@salesforce/schema/Invoice__c.Missing__c';",
        "import GREETING from '@salesforce/label/c.Greeting';",
        "import PACKAGED from '@salesforce/label/ns.Hello';",
        "import APPROVE from '@salesforce/customPermission/Approve';",
        "import { helper } from 'c/other';",
        "import { LightningElement, wire } from 'lwc';",
        "import { NavigationMixin } from 'lightning/navigation';",
        "import { local } from './local';",
        "import USER_ID from '@salesforce/user/Id';",
        "import LOGO from '@salesforce/resourceUrl/logo';",
        "import CHANNEL from '@salesforce/messageChannel/Invoices__c';",
        "import LOCALE from '@salesforce/i18n/locale';",
        "import ID from '@salesforce/schema/Invoice__c.Id';",
        "import BASE from '@salesforce/community/basePath';",
        "import ASSET from '@salesforce/contentAssetUrl/logo';",
        "import SITE from '@salesforce/site/Id';",
        "import { getRecord } from 'lightning/uiRecordApi';",
        "import CLIENT from '@salesforce/client/formFactor';",
        "import ALLOWED from '@salesforce/userPermission/ViewSetup';",
        "import { refreshApex } from '@salesforce/apex';",
        '',
      ].join('\n'),
      'local.js': "export const local = 1; // import X from '@salesforce/schema/Invoice__c.Status__c';\n",
    });
    const analysis = analyseSource(source.tree, source.listed, { apex: reader });
    expect(said(analysis, 'LightningComponentBundle:card')).toEqual([
      '1:41 references CustomObject:invoice__c [Invoice__c] confirmed resolved import',
      '2:51 references CustomField:invoice__c.amount__c [Amount__c] confirmed resolved import',
      // The lookup behind the relationship, and the field at its end.
      '3:49 references CustomField:invoice__c.account__c [Account__r] confirmed resolved import',
      '3:60 references CustomField:account.tier__c [Tier__c] confirmed resolved import',
      '4:46 references CustomField:account.name [Name] confirmed external import',
      '5:52 references null [Missing__c] confirmed unresolved import',
      '6:43 references CustomLabel:greeting [Greeting] confirmed resolved import',
      '7:44 references CustomLabel:ns__hello [Hello] confirmed external import',
      '8:51 references CustomPermission:approve [Approve] confirmed resolved import',
      '9:27 references LightningComponentBundle:other [other] confirmed resolved import',
      // The field `Id` is no component, and its import names the object.
      '17:36 references CustomObject:invoice__c [Invoice__c] confirmed resolved import',
    ]);
    expect(analysis.issues).toEqual([]);
  });

  it('warns about a module and an import of a form it does not know, and reads on', () => {
    const source = project();
    const folder = source.bundle('card', {
      'card.js': [
        "import moment from 'moment';",
        "import WRONG from '@salesforce/schema/Invoice__c.';",
        "import LABEL from '@salesforce/label/Greeting';",
        "import METHOD from '@salesforce/apex/Ctrl';",
        "import ESCAPED from '@salesforce/schema/Invoice\\u005f_c';",
        "const later = import('c/other');",
        "import AMOUNT from '@salesforce/schema/Invoice__c.Amount__c';",
        "import FOUR from '@salesforce/apex/a.B.c.d';",
        "import DEEP from '@salesforce/label/c.A.B';",
        "import NONE from '@salesforce/customPermission/';",
        "import DASHED from 'c/my-thing';",
        '',
      ].join('\n'),
    });
    const analysis = analyseSource(source.tree, source.listed, { apex: reader });
    expect(said(analysis)).toEqual([
      '7:51 references CustomField:invoice__c.amount__c [Amount__c] confirmed resolved import',
    ]);
    const file = `${folder}/card.js`;
    expect(placed(analysis)).toEqual([
      `NAME_NOT_READ ${file}:6:15`,
      `NAME_NOT_READ ${file}:1:21`,
      `NAME_NOT_READ ${file}:2:20`,
      `NAME_NOT_READ ${file}:3:20`,
      `NAME_NOT_READ ${file}:4:21`,
      `NAME_NOT_READ ${file}:5:22`,
      `NAME_NOT_READ ${file}:8:19`,
      `NAME_NOT_READ ${file}:9:19`,
      `NAME_NOT_READ ${file}:10:19`,
      `NAME_NOT_READ ${file}:11:21`,
    ]);
    expect(analysis.issues.map((one) => one.message)).toEqual([
      `${file}, line 6: a module is imported while the code runs, which is not read, so what it names is not known.`,
      `${file}, line 1: "moment" is no module of Salesforce or of the project that is known here, so nothing is read of its import.`,
      `${file}, line 2: "@salesforce/schema/Invoice__c." names no object or field in a form that is known here.`,
      `${file}, line 3: "@salesforce/label/Greeting" names no label in a form that is known here.`,
      `${file}, line 4: "@salesforce/apex/Ctrl" names no Apex method in a form that is known here.`,
      `${file}, line 5: the name of the module "@salesforce/schema/Invoice\\u005f_c" is written with an escape, and is not read.`,
      `${file}, line 8: "@salesforce/apex/a.B.c.d" names no Apex method in a form that is known here.`,
      `${file}, line 9: "@salesforce/label/c.A.B" names no label in a form that is known here.`,
      `${file}, line 10: "@salesforce/customPermission/" names no custom permission in a form that is known here.`,
      `${file}, line 11: "c/my-thing" names no component in a form that is known here.`,
    ]);
    expect(analysis.issues.every((one) => one.severity === 'warning')).toBe(true);
    expect(analysis.work.slice(4)).toEqual([
      { origin: 'parser:javascript', components: 1, failedFiles: 0 },
      { origin: 'parser:markup', components: 0, failedFiles: 0 },
    ]);
  });

  it('refers to the components its templates hold and to the objects and fields that base components name', () => {
    const source = project();
    source.bundle('invoiceBadge', { 'invoiceBadge.html': '<template></template>\n' });
    const folder = source.bundle('card', {
      'card.html': [
        '<template>',
        '    <lightning-record-edit-form object-api-name="Invoice__c">',
        '        <lightning-input-field field-name="Amount__c"></lightning-input-field>',
        '        <lightning-input-field object-api-name="Account" field-name="Status__c"></lightning-input-field>',
        '        <div><lightning-output-field field-name="Account__r.Tier__c"></lightning-output-field></div>',
        '        <c-invoice-badge status={status}></c-invoice-badge>',
        '        <lightning-input label="Amount__c" field-name="Status__c"></lightning-input>',
        '    </lightning-record-edit-form>',
        '    <lightning-record-view-form object-api-name={objectApiName}>',
        '        <lightning-output-field field-name="Status__c"></lightning-output-field>',
        '        <lightning-output-field field-name={field}></lightning-output-field>',
        '    </lightning-record-view-form>',
        '    <lightning-record-form object-api-name="Account" fields={fields}></lightning-record-form>',
        '    <lightning-output-field field-name="Status__c"></lightning-output-field>',
        '    <!-- <c-in-comment></c-in-comment> -->',
        '    <c-missing></c-missing>',
        '    <ns-thing></ns-thing>',
        '    <p>{invoice.Status__c}</p>',
        '    <C-Invoice-Badge></C-Invoice-Badge>',
        '    <lightning-record-view-form object-api-name="Invoice c"></lightning-record-view-form>',
        '</template>',
        '',
      ].join('\n'),
      'card.css': 'c-not-read { color: red; }\n',
    });
    const analysis = analyseSource(source.tree, source.listed, { apex: reader });
    expect(said(analysis, 'LightningComponentBundle:card')).toEqual([
      '2:50 references CustomObject:invoice__c [Invoice__c] probable resolved attribute',
      '3:44 references CustomField:invoice__c.amount__c [Amount__c] probable resolved attribute',
      // A field is of the object of the element around it, not of one its own element names.
      '4:49 references CustomObject:account [Account] probable external attribute',
      '4:70 references CustomField:invoice__c.status__c [Status__c] probable resolved attribute',
      // The form around an element is the one that holds it, however deep.
      '5:50 references CustomField:invoice__c.account__c [Account__r] probable resolved attribute',
      '5:61 references CustomField:account.tier__c [Tier__c] probable resolved attribute',
      '6:12 references LightningComponentBundle:invoicebadge [invoice-badge] confirmed resolved tag',
      // A tag is a component by its name in camel case, whether the snapshot holds it or not.
      '13:45 references CustomObject:account [Account] probable external attribute',
      '16:8 references null [missing] confirmed unresolved tag',
      // A tag is read in lower case.
      '19:8 references LightningComponentBundle:invoicebadge [Invoice-Badge] confirmed resolved tag',
    ]);
    // A field of a form whose object is in braces, and of no form, is of no known object. A base component that is
    // no field, an expression and the content of a comment give nothing.
    const file = `${folder}/card.html`;
    expect(placed(analysis)).toEqual([
      `NAME_NOT_READ ${file}:17:6`,
      `NAME_NOT_READ ${file}:20:50`,
      `PATH_NOT_FOLLOWED ${file}:10:45`,
      `PATH_NOT_FOLLOWED ${file}:14:41`,
    ]);
    expect(analysis.issues.map((one) => one.message)).toEqual([
      `${file}, line 17: the tag "ns-thing" is of a namespace that is not known here, so the component it names is not known.`,
      `${file}, line 20: the object "Invoice c" is not built like the name of one.`,
      `${file}, line 10: nothing says which object "Status__c" is a field of, so it was not followed.`,
      `${file}, line 14: nothing says which object "Status__c" is a field of, so it was not followed.`,
    ]);
    expect(analysis.work.slice(4)).toEqual([
      { origin: 'parser:javascript', components: 0, failedFiles: 0 },
      { origin: 'parser:markup', components: 2, failedFiles: 0 },
    ]);
  });

  it('reads no file of its tests, and counts a file it cannot read to the end or at all for its reader', () => {
    const source = project();
    const folder = source.bundle('card', {
      'card.js': [
        "import AMOUNT from '@salesforce/schema/Invoice__c.Amount__c';",
        'const pattern = /not closed',
        "import STATUS from '@salesforce/schema/Invoice__c.Status__c';",
        '',
      ].join('\n'),
      'card.html': '<template>\n    <c-card></c-card>\n    <!-- open\n',
      'helper.js': new Uint8Array([0x61, 0xc3, 0x28, 0x0a]),
      'utils.js': 'export const one = 1;\n',
      'other.html': new Uint8Array([0x61, 0xc3, 0x28, 0x0a]),
      '__tests__/card.test.js': "import moment from 'moment';\n",
      '__tests__/data/view.html': '<c-unknown-thing></c-unknown-thing>\n',
    });
    const analysis = analyseSource(source.tree, source.listed, { apex: reader });
    expect(said(analysis)).toEqual([
      // The files of a bundle are read in the order of their paths.
      '2:8 references LightningComponentBundle:card [card] confirmed resolved tag',
      '1:51 references CustomField:invoice__c.amount__c [Amount__c] confirmed resolved import',
    ]);
    expect(codes(analysis.issues)).toEqual([
      'error XML_NOT_UTF8',
      'error XML_NOT_UTF8',
      'warning FILE_NOT_READ',
      'warning FILE_NOT_READ',
    ]);
    expect(placed(analysis).slice(2)).toEqual([
      `FILE_NOT_READ ${folder}/card.html:3:5`,
      `FILE_NOT_READ ${folder}/card.js:2:17`,
    ]);
    expect(analysis.issues.slice(2).map((one) => one.message)).toEqual([
      `${folder}/card.html, line 3: a comment is not closed, so the file was not read beyond it. What it names after that is not known.`,
      `${folder}/card.js, line 2: a regular expression is not closed, so the file was not read beyond it. What it names after that is not known.`,
    ]);
    expect(analysis.issues.slice(0, 2).map((one) => one.details?.['path'])).toEqual([
      `${folder}/helper.js`,
      `${folder}/other.html`,
    ]);
    // The component is read, and each file that was not read to its end counts for the reader of its language.
    expect(analysis.work.slice(4)).toEqual([
      { origin: 'parser:javascript', components: 1, failedFiles: 2 },
      { origin: 'parser:markup', components: 1, failedFiles: 2 },
    ]);
    expect(analysis.work[0]?.failedFiles).toBe(0);
  });

  it('reads a bundle that lies below a folder of tests, which is no folder of its own', () => {
    const source = project();
    const folder = 'test/__tests__/lwc/card';
    const files = [
      source.file(`${folder}/card.js-meta.xml`, xml('LightningComponentBundle', '<isExposed>false</isExposed>')),
      source.file(`${folder}/card.js`, "import AMOUNT from '@salesforce/schema/Invoice__c.Amount__c';\n"),
      source.file(`${folder}/__tests__/card.test.js`, "import moment from 'moment';\n"),
    ];
    source.listed.push({ type: 'LightningComponentBundle', fullName: 'card', files: files.sort() });
    const analysis = analyseSource(source.tree, source.listed, { apex: reader });
    expect(said(analysis)).toEqual([
      '1:51 references CustomField:invoice__c.amount__c [Amount__c] confirmed resolved import',
    ]);
    expect(analysis.issues).toEqual([]);
  });
});
