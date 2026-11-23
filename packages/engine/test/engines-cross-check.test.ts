/**
 * The comparison of the rows of the Dependency API with the references of an analysis (`engines/cross-check.ts`).
 *
 * The rows are written here the way Salesforce writes them: a field and a rule without their object, a custom
 * object without its ending, a standard object as `StandardEntity` with its name as its id, and a record of a
 * custom metadata type with the name of that type as its type.
 */
import { describe, expect, it } from 'vitest';
import type { JsonValue } from '../src/core/errors.ts';
import { buildKey, type ComponentKey } from '../src/core/keys.ts';
import { validateReference, type Reference } from '../src/core/references.ts';
import {
  crossCheck,
  crossCheckIssues,
  flowsNotNamed,
  versionMatcher,
  type CrossCheckInput,
} from '../src/engines/cross-check.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import type { DependencyEnd, DependencyRow } from '../src/sources/dependency-api.ts';
import type { ListedId } from '../src/store/dependencies.ts';

const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });

/** What the org lists, with the ids it gives. Two objects have a field of the same name. */
const LISTED: ListedId[] = [
  { type: 'CustomObject', fullName: 'Invoice__c', id: '01Ixx0000000001AAA' },
  { type: 'CustomObject', fullName: 'Payment__c', id: '01Ixx0000000002AAA' },
  { type: 'CustomObject', fullName: 'Billing_Rule__mdt', id: '01Ixx0000000003AAA' },
  { type: 'CustomObject', fullName: 'Account', id: null },
  { type: 'CustomField', fullName: 'Invoice__c.Amount__c', id: '00Nxx0000000001AAA' },
  { type: 'CustomField', fullName: 'Invoice__c.Total__c', id: '00Nxx0000000002AAA' },
  { type: 'CustomField', fullName: 'Invoice__c.Account__c', id: '00Nxx0000000003AAA' },
  { type: 'CustomField', fullName: 'Payment__c.Amount__c', id: '00Nxx0000000004AAA' },
  { type: 'CustomField', fullName: 'Invoice__c.Status__c', id: '00Nxx0000000005AAA' },
  { type: 'CustomField', fullName: 'Billing_Rule__mdt.Rate__c', id: '00Nxx0000000006AAA' },
  { type: 'ValidationRule', fullName: 'Invoice__c.Amount_Positive', id: '03dxx0000000001AAA' },
  { type: 'ValidationRule', fullName: 'Invoice__c.Old_Rule', id: '03dxx0000000002AAA' },
  { type: 'CustomMetadata', fullName: 'Billing_Rule.Default', id: 'm00xx0000000001AAA' },
  { type: 'ApexClass', fullName: 'InvoiceService', id: '01pxx0000000001AAA' },
];

const INVOICE = key('CustomObject', 'Invoice__c');
const ACCOUNT = key('CustomObject', 'Account');
const AMOUNT = key('CustomField', 'Invoice__c.Amount__c');
const TOTAL = key('CustomField', 'Invoice__c.Total__c');
const LOOKUP = key('CustomField', 'Invoice__c.Account__c');
const STATUS = key('CustomField', 'Invoice__c.Status__c');
const PAYMENT_AMOUNT = key('CustomField', 'Payment__c.Amount__c');
const RATE = key('CustomField', 'Billing_Rule__mdt.Rate__c');
const ACCOUNT_NAME = key('CustomField', 'Account.Name');
const POSITIVE = key('ValidationRule', 'Invoice__c.Amount_Positive');
const OLD_RULE = key('ValidationRule', 'Invoice__c.Old_Rule');
const RECORD = key('CustomMetadata', 'Billing_Rule.Default');

const TYPES = ['CustomField', 'CustomObject', 'ValidationRule'];

/** The end of a row for a component the org lists, as Salesforce writes it. */
function end(type: string, fullName: string, more: Partial<DependencyEnd> = {}): DependencyEnd {
  const id = LISTED.find((one) => one.type === type && one.fullName === fullName)?.id ?? null;
  const last = fullName.slice(fullName.lastIndexOf('.') + 1);
  if (type === 'CustomObject' && id === null)
    return { type: 'StandardEntity', id: fullName, name: fullName, namespace: null };
  const written =
    type === 'CustomMetadata'
      ? { type: `${fullName.slice(0, fullName.indexOf('.'))}__mdt`, name: last }
      : { type, name: last.replace(/__(?:c|mdt)$/, '') };
  return { ...written, id: id ?? '0Zzxx0000000000AAA', namespace: null, ...more };
}
const row = (from: DependencyEnd, to: DependencyEnd): DependencyRow => ({ from, to });

function reference(from: ComponentKey, to: ComponentKey, more: Partial<Reference> = {}): Reference {
  return validateReference({
    from,
    to,
    toType: to.slice(0, to.indexOf(':')),
    toNameRaw: to.slice(to.indexOf(':') + 1),
    kind: 'reads',
    origin: 'parser:formula',
    confidence: 'confirmed',
    resolution: 'resolved',
    location: { file: 'objects/x.xml', line: 1, column: 1 },
    ...more,
  });
}
/** A reference from the definition of a component, such as the object a lookup goes to. */
const defined = (from: ComponentKey, to: ComponentKey, via: string): Reference =>
  reference(from, to, { kind: 'references', origin: 'parser:xml', attrs: { via } });

function component(
  componentKey: ComponentKey,
  attrs: Record<string, JsonValue> | null,
  references: readonly Reference[] = [],
  held = true,
): AnalysedComponent {
  return {
    key: componentKey,
    name: componentKey,
    definition: held ? { path: 'objects/x.xml', contentHash: new Uint8Array(32) } : null,
    attrs,
    references,
  };
}

const input = (rows: readonly DependencyRow[], components: readonly AnalysedComponent[]): CrossCheckInput => ({
  rows,
  listed: LISTED,
  components,
  analysedTypes: TYPES,
  flowVersions: [],
  newerVersions: [],
});

describe('the comparison of the rows of the Dependency API with an analysis', () => {
  it('finds the pairs both have, and names the pair the analysis lacks', () => {
    const rows = [
      row(end('ValidationRule', 'Invoice__c.Amount_Positive'), end('CustomField', 'Invoice__c.Amount__c')),
      row(end('CustomField', 'Invoice__c.Total__c'), end('CustomField', 'Invoice__c.Amount__c')),
      row(end('CustomField', 'Invoice__c.Total__c'), end('CustomField', 'Invoice__c.Status__c')),
    ];
    const result = crossCheck(
      input(rows, [
        component(POSITIVE, { active: true }, [reference(POSITIVE, AMOUNT)]),
        // The analysis read the formula of the field and found one of the two fields it names.
        component(TOTAL, { type: 'Currency', formula: true }, [reference(TOTAL, AMOUNT)]),
        component(AMOUNT, { type: 'Currency' }),
        component(STATUS, { type: 'Picklist' }),
      ]),
    );
    expect(result).toEqual({
      rows: 3,
      rowsNotAnalysed: 0,
      notAnalysed: [],
      rowsNotMatched: 0,
      rowsNotHeld: 0,
      rowsOtherVersion: 0,
      rowsCompared: 3,
      pairs: 3,
      agreed: 2,
      coveredByPart: 0,
      missed: [{ from: TOTAL, to: STATUS }],
      onlyOrgLens: [],
      notReported: [],
    });
    expect(crossCheckIssues(result)).toEqual([
      {
        severity: 'error',
        code: 'REFERENCE_MISSED',
        message: `Salesforce reports that ${TOTAL} refers to ${STATUS}, and the analysis found no such reference.`,
        componentKey: TOTAL,
        details: { from: TOTAL, to: STATUS, origin: 'dependency-api' },
      },
    ]);
  });

  it('matches an end by the id the org listed, in either length, and never by the name of a field alone', () => {
    // Two objects have a field `Amount`. The row names the one of the payment by its id.
    const toPayment = end('CustomField', 'Payment__c.Amount__c');
    const analysis = [component(TOTAL, { formula: true }, [reference(TOTAL, AMOUNT)]), component(PAYMENT_AMOUNT, {})];
    expect(crossCheck(input([row(end('CustomField', 'Invoice__c.Total__c'), toPayment)], analysis))).toMatchObject({
      rowsCompared: 1,
      agreed: 0,
      missed: [{ from: TOTAL, to: PAYMENT_AMOUNT }],
      // What the analysis has instead is a reference Salesforce has no row for.
      onlyOrgLens: [{ from: TOTAL, to: AMOUNT }],
    });
    // The id with 15 characters is the same component.
    const short = { ...toPayment, id: toPayment.id.slice(0, 15) };
    expect(crossCheck(input([row(end('CustomField', 'Invoice__c.Total__c'), short)], analysis)).missed).toEqual([
      { from: TOTAL, to: PAYMENT_AMOUNT },
    ]);
    // An id the org did not list is no component, whatever the name says: `Amount` is the name of two fields.
    const unknown = { ...toPayment, id: '00Nxx0000000999AAA' };
    expect(crossCheck(input([row(end('CustomField', 'Invoice__c.Total__c'), unknown)], analysis))).toMatchObject({
      rowsNotMatched: 1,
      rowsCompared: 0,
      pairs: 0,
      missed: [],
    });
    // The same for the component that refers.
    const from = { ...end('CustomField', 'Invoice__c.Total__c'), id: '00Nxx0000000998AAA' };
    expect(crossCheck(input([row(from, end('CustomField', 'Invoice__c.Amount__c'))], analysis))).toMatchObject({
      rowsNotMatched: 1,
      rowsNotAnalysed: 0,
      rowsCompared: 0,
    });
  });

  it('takes a standard object by its name, and a record of a custom metadata type by its id', () => {
    const rule = end('ValidationRule', 'Invoice__c.Amount_Positive');
    const record = end('CustomMetadata', 'Billing_Rule.Default');
    expect(record).toMatchObject({ type: 'Billing_Rule__mdt', name: 'Default' });
    const analysis = [
      component(POSITIVE, { active: true }, [reference(POSITIVE, ACCOUNT), reference(POSITIVE, RECORD)]),
      component(TOTAL, { formula: true }, [reference(TOTAL, RECORD)]),
    ];
    const rows = [row(rule, end('CustomObject', 'Account')), row(rule, record)];
    expect(crossCheck(input(rows, analysis))).toMatchObject({ rowsCompared: 2, pairs: 2, agreed: 2, missed: [] });

    // A component the org listed with an id is found by that id or not at all. A row with another id is no row
    // about it, whatever its type and its name say.
    const other = row(end('CustomField', 'Invoice__c.Total__c'), { ...record, id: 'm00xx0000000777AAA' });
    expect(crossCheck(input([other], analysis))).toMatchObject({ rowsNotMatched: 1, rowsCompared: 0 });
    const service = { type: 'ApexClass', id: '01pxx0000000777AAA', name: 'InvoiceService', namespace: null };
    expect(
      crossCheck({
        ...input([row(service, end('CustomField', 'Invoice__c.Amount__c'))], []),
        analysedTypes: ['ApexClass'],
      }),
    ).toMatchObject({ rowsNotMatched: 1, rowsNotHeld: 0 });

    // A record the org listed without an id has its type and its name, and nothing else.
    const listed: ListedId[] = [...LISTED, { type: 'CustomMetadata', fullName: 'Billing_Rule.Other', id: null }];
    const unlisted = { type: 'Billing_Rule__mdt', id: 'm00xx0000000778AAA', name: 'Other', namespace: null };
    expect(crossCheck({ ...input([row(rule, unlisted)], analysis), listed })).toMatchObject({
      rowsCompared: 1,
      missed: [{ from: POSITIVE, to: key('CustomMetadata', 'Billing_Rule.Other') }],
    });
  });

  it('never takes a custom object by its name, which can be the name of a standard object', () => {
    // The org has the standard object `Order` and a custom object `Order__c`. The API names the custom one
    // without its ending.
    const listed: ListedId[] = [
      ...LISTED,
      { type: 'CustomObject', fullName: 'Order', id: null },
      { type: 'CustomObject', fullName: 'Order__c', id: '01Ixx0000000009AAA' },
    ];
    const rule = end('ValidationRule', 'Invoice__c.Amount_Positive');
    const analysis = [component(POSITIVE, { active: true }, [reference(POSITIVE, key('CustomObject', 'Order__c'))])];
    const custom = { type: 'CustomObject', id: '01Ixx0000000009AAA', name: 'Order', namespace: null };
    expect(crossCheck({ ...input([row(rule, custom)], analysis), listed })).toMatchObject({ agreed: 1, missed: [] });
    // With an id the org did not list, it is no component: not the custom object, and not the standard one.
    const unknown = { ...custom, id: '01Ixx0000000010AAA' };
    expect(crossCheck({ ...input([row(rule, unknown)], analysis), listed })).toMatchObject({
      rowsNotMatched: 1,
      rowsCompared: 0,
      missed: [],
    });
    // The standard object is named as one.
    const standard = { type: 'StandardEntity', id: 'Order', name: 'Order', namespace: null };
    expect(crossCheck({ ...input([row(rule, standard)], analysis), listed })).toMatchObject({
      missed: [{ from: POSITIVE, to: key('CustomObject', 'Order') }],
    });
  });

  it('lets the type of the row decide where the org lists one id under two types', () => {
    const listed: ListedId[] = [
      ...LISTED,
      { type: 'CustomTab', fullName: 'Invoice__c', id: '00Nxx0000000001AAA' },
      { type: 'Layout', fullName: 'Invoice__c-Invoice Layout', id: '00Nxx0000000002AAA' },
    ];
    const analysis = [component(TOTAL, { formula: true }, [reference(TOTAL, AMOUNT)])];
    const rows = [row(end('CustomField', 'Invoice__c.Total__c'), end('CustomField', 'Invoice__c.Amount__c'))];
    expect(crossCheck({ ...input(rows, analysis), listed })).toMatchObject({ rowsCompared: 1, agreed: 1, missed: [] });
    // A row whose type is neither of the two says nothing about which it is.
    const odd = [
      row(end('CustomField', 'Invoice__c.Total__c'), { ...end('CustomField', 'Invoice__c.Amount__c'), type: 'Odd' }),
    ];
    expect(crossCheck({ ...input(odd, analysis), listed })).toMatchObject({ rowsNotMatched: 1, rowsCompared: 0 });
  });

  it('counts a row to an object as covered when the analysis has a reference to a part of that object', () => {
    const rule = end('ValidationRule', 'Invoice__c.Amount_Positive');
    const rows = [
      // The object in $ObjectType, the custom metadata type behind $CustomMetadata, and a standard object.
      row(rule, end('CustomObject', 'Invoice__c')),
      row(rule, end('CustomObject', 'Billing_Rule__mdt')),
      row(rule, end('CustomObject', 'Account')),
      // An object of which the analysis has no part for this rule.
      row(rule, end('CustomObject', 'Payment__c')),
    ];
    expect(end('CustomObject', 'Billing_Rule__mdt')).toMatchObject({ type: 'CustomObject', name: 'Billing_Rule' });
    const result = crossCheck(
      input(rows, [
        component(POSITIVE, { active: true }, [
          reference(POSITIVE, AMOUNT),
          reference(POSITIVE, RECORD),
          reference(POSITIVE, ACCOUNT_NAME, { resolution: 'external' }),
        ]),
      ]),
    );
    expect(result).toMatchObject({
      rowsCompared: 4,
      pairs: 4,
      agreed: 0,
      coveredByPart: 3,
      missed: [{ from: POSITIVE, to: key('CustomObject', 'Payment__c') }],
    });
    // The reference to the part is one of a kind Salesforce reports, and it has no row of its own here.
    expect(result.onlyOrgLens).toEqual([
      { from: POSITIVE, to: AMOUNT },
      { from: POSITIVE, to: RECORD },
    ]);
    expect(result.notReported).toEqual([{ reason: 'standard-field', pairs: 1 }]);
    // A reference to the object itself agrees, and is not counted as covered.
    const direct = crossCheck(
      input(rows.slice(0, 1), [component(POSITIVE, { active: true }, [reference(POSITIVE, INVOICE)])]),
    );
    expect(direct).toMatchObject({ agreed: 1, coveredByPart: 0, missed: [] });
  });

  it('counts the rows of a type the analysis does not read under that type, and compares none of them', () => {
    const service = end('ApexClass', 'InvoiceService');
    const rows = [
      row(service, end('CustomField', 'Invoice__c.Amount__c')),
      row(service, end('CustomField', 'Invoice__c.Total__c')),
      // A class the org did not list: its type is still the one the API writes.
      row({ ...service, id: '01pxx0000000999AAA', name: 'Other' }, end('CustomField', 'Invoice__c.Amount__c')),
      // A record of a custom metadata type that refers to its type: its type is a name of the org.
      row(end('CustomMetadata', 'Billing_Rule.Default'), end('CustomObject', 'Billing_Rule__mdt')),
      row(
        { type: 'Other_Setting__mdt', id: 'm01xx0000000001AAA', name: 'One', namespace: null },
        end('CustomObject', 'Billing_Rule__mdt'),
      ),
      row({ type: 'Flow', id: '301xx0000000001AAA', name: 'Remind', namespace: null }, end('CustomObject', 'Account')),
    ];
    const result = crossCheck(input(rows, [component(AMOUNT, {}), component(TOTAL, {})]));
    expect(result).toMatchObject({
      rows: 6,
      rowsNotAnalysed: 6,
      // Sorted by type. No name of a custom metadata type stands in the place of a type.
      notAnalysed: [
        { type: 'ApexClass', rows: 3 },
        { type: 'CustomMetadata', rows: 2 },
        { type: 'Flow', rows: 1 },
      ],
      rowsCompared: 0,
      pairs: 0,
      missed: [],
    });
  });

  describe('of a flow', () => {
    const REMIND = key('Flow', 'Remind');
    const DECIDE = buildKey({ type: 'Flow', fullName: 'Remind', subs: [{ kind: 'element', name: 'Decide' }] });
    /** The active version of the flow, whose id the org does not list, and a newer draft, which it lists. */
    const ACTIVE_ID = '301xx0000000001AAA';
    const DRAFT_ID = '301xx0000000002AAA';
    const VERSIONS = [{ flow: 'Remind', active: ACTIVE_ID, latest: DRAFT_ID }];
    const version = (id: string): DependencyEnd => ({ type: 'Flow', id, name: 'Remind', namespace: null });
    const ofFlow = (to: ComponentKey, via: string, more: Partial<Reference> = {}): Reference =>
      reference(DECIDE, to, { origin: 'parser:flow', attrs: { via }, ...more });
    const flowInput = (
      rows: readonly DependencyRow[],
      components: readonly AnalysedComponent[],
      more: Partial<CrossCheckInput> = {},
    ): CrossCheckInput => ({
      ...input(rows, components),
      listed: [...LISTED, { type: 'Flow', fullName: 'Remind', id: DRAFT_ID }],
      analysedTypes: [...TYPES, 'Flow'],
      ...more,
    });
    // The active version reads the amount. The draft reads the total as well.
    const rows = [
      row(version(ACTIVE_ID), end('CustomField', 'Invoice__c.Amount__c')),
      row(version(DRAFT_ID), end('CustomField', 'Invoice__c.Amount__c')),
      row(version(DRAFT_ID), end('CustomField', 'Invoice__c.Total__c')),
    ];
    // The analysis of the version the snapshot holds. Its references stand at an element, and are of the flow:
    // Salesforce counts a flow, not an element of it.
    const analysis = [component(REMIND, { status: 'Active' }), component(DECIDE, {}, [ofFlow(AMOUNT, 'path')])];

    it('compares the rows of the version the snapshot holds, and counts those of another version', () => {
      // The snapshot holds the active version, as the note of a newer one says.
      const held = crossCheck(flowInput(rows, analysis, { flowVersions: VERSIONS, newerVersions: [REMIND] }));
      expect(held).toMatchObject({
        rows: 3,
        rowsNotAnalysed: 0,
        rowsNotMatched: 0,
        rowsNotHeld: 0,
        rowsOtherVersion: 2,
        rowsCompared: 1,
        pairs: 1,
        agreed: 1,
        missed: [],
        onlyOrgLens: [],
      });
      // Without that note, the snapshot holds the version that came for the name of the flow, the latest one: here
      // the draft. A reference of the draft that the analysis lacks is then an error of it.
      const latest = crossCheck(flowInput(rows, analysis, { flowVersions: VERSIONS }));
      expect(latest).toMatchObject({
        rowsOtherVersion: 1,
        rowsCompared: 2,
        pairs: 2,
        agreed: 1,
        missed: [{ from: REMIND, to: TOTAL }],
      });
    });

    it('takes the id the org listed a flow with for its latest version where the org named no version', () => {
      // The rows of the active version name an id that nothing names: they cannot be matched.
      const held = crossCheck(flowInput(rows, analysis, { newerVersions: [REMIND] }));
      expect(held).toMatchObject({ rowsOtherVersion: 2, rowsNotMatched: 1, rowsCompared: 0, missed: [] });
      // A flow without a newer version: the version the org listed is the one the snapshot holds.
      expect(crossCheck(flowInput(rows.slice(1, 2), analysis))).toMatchObject({ rowsCompared: 1, agreed: 1 });
    });

    it('finds a flow by the id of any of its versions, in either length, and knows which one the snapshot holds', () => {
      const versionOf = versionMatcher(flowInput([], []).listed, VERSIONS, [REMIND]);
      expect(versionOf(version(ACTIVE_ID))).toEqual({ key: REMIND, held: true });
      expect(versionOf(version(ACTIVE_ID.slice(0, 15)))).toEqual({ key: REMIND, held: true });
      expect(versionOf(version(DRAFT_ID))).toEqual({ key: REMIND, held: false });
      // The listed id is that of the latest version, also where the org named no version.
      expect(versionMatcher(flowInput([], []).listed, [], [])(version(DRAFT_ID))).toEqual({ key: REMIND, held: true });
      // Only an end of the type Flow is a version of a flow.
      expect(versionOf({ ...version(ACTIVE_ID), type: 'ApexClass' })).toBeNull();
      expect(versionOf(version('301xx0000000009AAA'))).toBeNull();
      // An id the org names for two flows stands for neither.
      const twice = [...VERSIONS, { flow: 'Other', active: ACTIVE_ID, latest: null }];
      expect(versionMatcher([], twice, [])(version(ACTIVE_ID))).toEqual({ key: null, held: false });
      expect(crossCheck(flowInput(rows.slice(0, 1), analysis, { flowVersions: twice }))).toMatchObject({
        rowsNotMatched: 1,
        rowsCompared: 0,
      });
      // Also where the org listed a flow with that id: the rows of the draft are not matched, and so are not held
      // against the analysis of the active version.
      const listedTwice = [...VERSIONS, { flow: 'Other', active: DRAFT_ID, latest: null }];
      expect(
        crossCheck(flowInput(rows, analysis, { flowVersions: listedTwice, newerVersions: [REMIND] })),
      ).toMatchObject({ rowsNotMatched: 2, rowsOtherVersion: 0, rowsCompared: 1, agreed: 1, missed: [] });
    });

    it('takes a flow under the name the org listed it with, where FlowDefinition writes its name otherwise', () => {
      // `FlowDefinition` gives the prefix of a package in a field of its own, and the listing need not write it.
      const prefixed = [{ flow: 'acme__Remind', active: ACTIVE_ID, latest: DRAFT_ID }];
      const { listed } = flowInput([], []);
      expect(versionMatcher(listed, prefixed, [REMIND])(version(ACTIVE_ID))).toEqual({ key: REMIND, held: true });
      expect(crossCheck(flowInput(rows, analysis, { flowVersions: prefixed, newerVersions: [REMIND] }))).toEqual(
        crossCheck(flowInput(rows, analysis, { flowVersions: VERSIONS, newerVersions: [REMIND] })),
      );
      // A flow the org did not list with the id of its latest version goes by the name the org named it with, and
      // the id it listed a flow with is that of the latest version of the flow it listed.
      const elsewhere = [{ flow: 'acme__Remind', active: ACTIVE_ID, latest: '301xx0000000003AAA' }];
      expect(versionMatcher(listed, elsewhere, [])(version(ACTIVE_ID))).toEqual({
        key: key('Flow', 'acme__Remind'),
        held: false,
      });
      expect(versionMatcher(listed, elsewhere, [])(version(DRAFT_ID))).toEqual({ key: REMIND, held: true });
    });

    it('counts the flows the org listed and named no version of, by the id it listed them with or their name', () => {
      const listed: ListedId[] = [
        { type: 'Flow', fullName: 'Remind', id: DRAFT_ID },
        { type: 'Flow', fullName: 'Caller', id: '301xx0000000005AAA' },
        { type: 'ApexClass', fullName: 'InvoiceService', id: '01pxx0000000001AAA' },
      ];
      expect(flowsNotNamed(listed, [])).toBe(2);
      expect(flowsNotNamed(listed, VERSIONS)).toBe(1);
      expect(flowsNotNamed(listed, [{ flow: 'acme__Remind', active: null, latest: DRAFT_ID.slice(0, 15) }])).toBe(1);
      expect(flowsNotNamed(listed, [...VERSIONS, { flow: 'Caller', active: null, latest: null }])).toBe(0);
    });

    it('takes a row to a flow as a row to the flow, whichever version of it the row names', () => {
      // A flow that starts the flow above as a subflow. It has one version, which the org lists.
      const CALLER = key('Flow', 'Caller');
      const CALL = buildKey({ type: 'Flow', fullName: 'Caller', subs: [{ kind: 'element', name: 'Call' }] });
      const caller: DependencyEnd = { type: 'Flow', id: '301xx0000000005AAA', name: 'Caller', namespace: null };
      const result = crossCheck(
        flowInput(
          [row(caller, version(ACTIVE_ID)), row(caller, version(DRAFT_ID))],
          [
            ...analysis,
            component(CALLER, { status: 'Active' }),
            component(CALL, {}, [
              reference(CALL, REMIND, { kind: 'calls', origin: 'parser:flow', attrs: { via: 'action' } }),
            ]),
          ],
          {
            listed: [...flowInput([], []).listed, { type: 'Flow', fullName: 'Caller', id: caller.id }],
            flowVersions: VERSIONS,
            newerVersions: [REMIND],
          },
        ),
      );
      expect(result).toMatchObject({ rowsOtherVersion: 0, rowsCompared: 2, pairs: 1, agreed: 1, missed: [] });
    });

    it('counts the rows of a flow the snapshot does not hold as such, of whichever version', () => {
      const result = crossCheck(
        flowInput(rows, [component(REMIND, null, [], false)], { flowVersions: VERSIONS, newerVersions: [REMIND] }),
      );
      expect(result).toMatchObject({ rowsNotHeld: 3, rowsOtherVersion: 0, rowsCompared: 0, missed: [] });
    });

    it('says of every reference of a flow without a row whether Salesforce reports that kind', () => {
      const SETTING = key('CustomObject', 'Settings__c');
      const GRACE = key('CustomField', 'Settings__c.Grace__c');
      const FEE = key('CustomField', 'Settings__c.Fee__c');
      const PERMISSION = key('CustomPermission', 'Approve');
      const CREDIT_NOTE = key('RecordType', 'Invoice__c.Credit_Note');
      const components = [
        component(REMIND, { status: 'Active' }),
        component(DECIDE, {}, [
          // A custom field in a formula, a subflow, and a record type a condition compares a text with.
          ofFlow(AMOUNT, 'formula'),
          ofFlow(key('Flow', 'Other'), 'action', { kind: 'calls' }),
          ofFlow(CREDIT_NOTE, 'text', { kind: 'references', confidence: 'probable' }),
          // A custom permission and a field of a custom setting that only a formula names.
          ofFlow(PERMISSION, 'formula', { kind: 'references' }),
          ofFlow(FEE, 'formula'),
          // A field of the custom setting that a condition names as well.
          ofFlow(GRACE, 'formula'),
          ofFlow(GRACE, 'path'),
          ofFlow(ACCOUNT_NAME, 'path', { resolution: 'external' }),
        ]),
        component(SETTING, { customSettingsType: 'Hierarchy' }),
      ];
      const result = crossCheck(flowInput([], components));
      expect(result.onlyOrgLens).toEqual([
        { from: REMIND, to: AMOUNT },
        { from: REMIND, to: GRACE },
      ]);
      expect(result.notReported).toEqual([
        { reason: 'global-variable', pairs: 2 },
        { reason: 'name-in-text', pairs: 1 },
        { reason: 'standard-field', pairs: 1 },
        { reason: 'subflow', pairs: 1 },
      ]);
      expect(crossCheckIssues(result)).toEqual([]);
    });
  });

  it('does not compare a row from a component the snapshot does not hold or that was not analysed', () => {
    const rows = [
      row(end('CustomField', 'Invoice__c.Total__c'), end('CustomField', 'Invoice__c.Amount__c')),
      row(end('CustomField', 'Invoice__c.Status__c'), end('CustomField', 'Invoice__c.Amount__c')),
      row(end('ValidationRule', 'Invoice__c.Amount_Positive'), end('CustomField', 'Invoice__c.Amount__c')),
    ];
    const result = crossCheck(
      input(rows, [
        // Named by another component and not in the snapshot.
        component(TOTAL, null, [], false),
        // In the snapshot, and its file could not be analysed.
        component(STATUS, null),
        // The rule is no component of the analysis at all.
        component(AMOUNT, {}),
      ]),
    );
    expect(result).toMatchObject({ rowsNotHeld: 3, rowsCompared: 0, pairs: 0, missed: [] });
    expect(crossCheckIssues(result)).toEqual([]);
  });

  it('counts a pair once however many rows give it, and no pair of a component with itself', () => {
    const total = end('CustomField', 'Invoice__c.Total__c');
    const amount = end('CustomField', 'Invoice__c.Amount__c');
    const result = crossCheck(
      input(
        [row(total, amount), row(total, { ...amount, id: amount.id.slice(0, 15) }), row(total, total)],
        [component(TOTAL, { formula: true }, [reference(TOTAL, AMOUNT), reference(TOTAL, TOTAL)])],
      ),
    );
    expect(result).toMatchObject({ rows: 3, rowsCompared: 3, pairs: 1, agreed: 1, missed: [], onlyOrgLens: [] });
  });

  it('says of every reference without a row whether Salesforce reports that kind, and counts the others by reason', () => {
    const components = [
      // A formula field: its formula is reported. A standard field and a standard object in it are not.
      component(TOTAL, { type: 'Currency', formula: true }, [
        reference(TOTAL, AMOUNT),
        reference(TOTAL, ACCOUNT_NAME, { resolution: 'external' }),
        reference(TOTAL, ACCOUNT, { resolution: 'external' }),
      ]),
      // A field without a formula has one in its default value.
      component(AMOUNT, { type: 'Currency' }, [reference(AMOUNT, RATE)]),
      // A lookup: the object it goes to, the field its filter reads, and the field it shows.
      component(LOOKUP, { type: 'Lookup' }, [
        defined(LOOKUP, INVOICE, 'lookup'),
        defined(LOOKUP, STATUS, 'filter'),
        defined(LOOKUP, AMOUNT, 'display-field'),
      ]),
      // A roll-up summary: the field it sums is not reported, the field in its filter is.
      component(PAYMENT_AMOUNT, { type: 'Summary' }, [
        defined(PAYMENT_AMOUNT, AMOUNT, 'summary'),
        defined(PAYMENT_AMOUNT, STATUS, 'filter'),
      ]),
      // A picklist: its controlling field and its value set.
      component(STATUS, { type: 'Picklist' }, [
        defined(STATUS, LOOKUP, 'controlling-field'),
        defined(STATUS, RATE, 'value-set'),
        defined(STATUS, TOTAL, 'something-else'),
      ]),
      // A rule that is active is reported, one that is not active is not.
      component(POSITIVE, { active: true }, [reference(POSITIVE, AMOUNT)]),
      component(OLD_RULE, { active: false }, [reference(OLD_RULE, AMOUNT)]),
    ];
    const result = crossCheck(input([], components));
    expect(result.onlyOrgLens).toEqual([
      { from: TOTAL, to: AMOUNT },
      { from: PAYMENT_AMOUNT, to: STATUS },
      { from: POSITIVE, to: AMOUNT },
    ]);
    expect(result.notReported).toEqual([
      { reason: 'controlling-field', pairs: 1 },
      { reason: 'default-value', pairs: 1 },
      { reason: 'display-field', pairs: 1 },
      { reason: 'inactive-rule', pairs: 1 },
      { reason: 'lookup', pairs: 1 },
      { reason: 'lookup-filter', pairs: 1 },
      { reason: 'other', pairs: 1 },
      { reason: 'roll-up-summary', pairs: 1 },
      { reason: 'standard-field', pairs: 1 },
      { reason: 'standard-object', pairs: 1 },
      { reason: 'value-set', pairs: 1 },
    ]);
    // Nothing that only the analysis has is an error of it.
    expect(result.missed).toEqual([]);
    expect(crossCheckIssues(result)).toEqual([]);
  });

  it('compares the type of a record and the custom fields of a field set, and nothing else of the three', () => {
    const TYPE = key('CustomObject', 'Billing_Rule__mdt');
    const SET = key('FieldSet', 'Invoice__c.Summary');
    const KIND = key('RecordType', 'Invoice__c.Credit_Note');
    const listedField = { origin: 'parser:xml', attrs: { via: 'listed-field' } } as const;
    const components = [
      // A record: its type is reported. The field it gives a value, the object a value names and a name in a
      // text are not.
      component(RECORD, {}, [
        defined(RECORD, TYPE, 'record-of'),
        defined(RECORD, RATE, 'listed-field'),
        defined(RECORD, INVOICE, 'value'),
        reference(RECORD, AMOUNT, {
          kind: 'references',
          origin: 'parser:xml',
          confidence: 'probable',
          attrs: { via: 'text' },
        }),
      ]),
      // A field set: its custom fields are reported, a standard one is not.
      component(SET, {}, [
        reference(SET, AMOUNT, listedField),
        reference(SET, ACCOUNT_NAME, { ...listedField, resolution: 'external' }),
      ]),
      // A record type: nothing, not the picklist whose values it limits.
      component(KIND, { active: true }, [defined(KIND, STATUS, 'listed-field')]),
    ];
    const analysedTypes = [...TYPES, 'CustomMetadata', 'FieldSet', 'RecordType'];
    const result = crossCheck({ ...input([], components), analysedTypes });
    expect(result.onlyOrgLens).toEqual([
      { from: RECORD, to: TYPE },
      { from: SET, to: AMOUNT },
    ]);
    expect(result.notReported).toEqual([
      { reason: 'custom-metadata', pairs: 3 },
      { reason: 'record-type', pairs: 1 },
      { reason: 'standard-field', pairs: 1 },
    ]);
    // The row from the record to its type, which Salesforce writes with the name of the type as its type.
    const rows = [row(end('CustomMetadata', 'Billing_Rule.Default'), end('CustomObject', 'Billing_Rule__mdt'))];
    expect(crossCheck({ ...input(rows, components), analysedTypes })).toMatchObject({
      rowsNotAnalysed: 0,
      rowsCompared: 1,
      agreed: 1,
      missed: [],
      onlyOrgLens: [{ from: SET, to: AMOUNT }],
    });
  });

  it('leaves out of both lists what a component of a type that was not analysed refers to, and a name without a target', () => {
    const record = component(RECORD, {}, [reference(RECORD, RATE)]);
    const unresolved = validateReference({
      from: TOTAL,
      to: null,
      toType: 'CustomField',
      toNameRaw: 'Dicsount__c',
      kind: 'reads',
      origin: 'parser:formula',
      confidence: 'confirmed',
      resolution: 'unresolved',
      location: { file: 'objects/x.xml', line: 1, column: 1 },
    });
    const result = crossCheck(input([], [record, component(TOTAL, { formula: true }, [unresolved])]));
    expect(result).toMatchObject({ onlyOrgLens: [], notReported: [] });
  });

  it('adds up: every row is counted once, and every pair is agreed, covered or missed', () => {
    const rule = end('ValidationRule', 'Invoice__c.Amount_Positive');
    const rows = [
      row(rule, end('CustomField', 'Invoice__c.Amount__c')),
      row(rule, end('CustomObject', 'Invoice__c')),
      row(rule, end('CustomField', 'Invoice__c.Status__c')),
      row(rule, { ...end('CustomField', 'Invoice__c.Status__c'), id: '00Nxx0000000999AAA' }),
      row(end('ValidationRule', 'Invoice__c.Old_Rule'), end('CustomField', 'Invoice__c.Amount__c')),
      row(end('ApexClass', 'InvoiceService'), end('CustomField', 'Invoice__c.Amount__c')),
    ];
    const result = crossCheck(input(rows, [component(POSITIVE, { active: true }, [reference(POSITIVE, AMOUNT)])]));
    expect(result).toMatchObject({ rows: 6, rowsNotAnalysed: 1, rowsNotMatched: 1, rowsNotHeld: 1, rowsCompared: 3 });
    const { rowsNotAnalysed, rowsNotMatched, rowsNotHeld, rowsOtherVersion, rowsCompared } = result;
    expect(rowsNotAnalysed + rowsNotMatched + rowsNotHeld + rowsOtherVersion + rowsCompared).toBe(result.rows);
    expect(result.agreed + result.coveredByPart + result.missed.length).toBe(result.pairs);
    expect(result).toMatchObject({ pairs: 3, agreed: 1, coveredByPart: 1, missed: [{ from: POSITIVE, to: STATUS }] });
    // The same rows in another order give the same result.
    expect(
      crossCheck(input([...rows].reverse(), [component(POSITIVE, { active: true }, [reference(POSITIVE, AMOUNT)])])),
    ).toEqual(result);
    // The result is plain data, as it is stored.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('names a component of a package with the prefix of the package', () => {
    const listed: ListedId[] = [
      { type: 'CustomObject', fullName: 'pkg__Order__c', id: null },
      { type: 'ApexClass', fullName: 'pkg__Service', id: null },
    ];
    // Without an id, a row finds only what the org listed under exactly the type and the name the row gives.
    const rows = [
      row(
        { type: 'ApexClass', id: '01pxx0000000042AAA', name: 'Service', namespace: 'pkg' },
        end('CustomField', 'Invoice__c.Amount__c'),
      ),
    ];
    expect(
      crossCheck({
        rows,
        listed: [...LISTED, ...listed],
        components: [],
        analysedTypes: [...TYPES, 'ApexClass'],
        flowVersions: [],
        newerVersions: [],
      }),
    ).toMatchObject({
      // The class is found by its name with the prefix, and the snapshot holds no analysis of it.
      rowsNotMatched: 0,
      rowsNotHeld: 1,
    });
  });
});
