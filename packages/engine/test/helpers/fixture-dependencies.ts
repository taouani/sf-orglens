/**
 * What the Dependency API of a mock org that holds the fixture project reports.
 *
 * The rows are made from the answer key of the project, which is written by hand: every reference the key has
 * for a formula or for the filter of a roll-up summary, and every reference it has for Apex, where the target
 * is something the project defines. A row names a class and a flow, not a member or an element of one, at either
 * end. What the API reports from a Lightning component, an Aura component, a Visualforce page and a named credential
 * was not measured, and the mock reports nothing from them. To these come three rows to an object that the probe of
 * the test org saw (`docs/research/phase-1/real-org.md`, section 4, and `docs/research/phase-2/real-org.md`,
 * section 3) and that the key has no entry for. The rows are written the way Salesforce writes them
 * (`mock-dependencies.ts`).
 *
 * Of the files of Phase 2, the mock reports what the test org reports (`docs/research/phase-2/real-org.md`,
 * section 3): of a flow, every custom field and custom object and what an action starts, but not a flow it starts,
 * not a record type a condition names in a text, and not a field of a custom setting or a custom permission that
 * only a formula of the flow names; of the workflow rules, the custom fields the formula of a field update reads,
 * and nothing else of a rule or an action; of a record of a custom metadata type, the type it is a record of, and
 * nothing else; of a field set, its custom fields; of a record type, nothing; of an email template, the custom
 * fields of its merge fields and the object they are of. What the API reports of a report type and of a quick
 * action was not measured, and the mock reports nothing of them. A row from a flow carries the id the org lists
 * the flow with, which is that of its latest version: the project has one version of each flow.
 *
 * The mock reports more than Salesforce does in two places that the engine treats as "not reported": the
 * formula of a rule that is not active, and the formula in a default value. A test that needs the difference
 * takes rows out.
 */
import { loadAnswerKey } from './answer-key.ts';
import { dependencyRow, type MockDependencyRow, type MockEnd } from './mock-dependencies.ts';
import type { MockMetadata } from './mock-metadata.ts';

/** The roll-up summaries of the project. Salesforce reports the fields in the filter of one. */
const SUMMARIES: ReadonlySet<string> = new Set([
  'CustomField:invoice__c.lines_total__c',
  'CustomField:invoice__c.open_billable_total__c',
]);

/** A pair of components of the project that the mock org reports. `apex`: the one that refers is Apex. */
export interface KeyedPair {
  readonly from: MockEnd;
  readonly to: MockEnd;
  readonly apex: boolean;
}

/** The custom setting of the project. A flow reads its fields through `$Setup`. */
const SETTING = 'CustomField:billing_settings__c.';

/**
 * Of the references of a flow in the key, those the test org reports, where their target is custom: not to a flow
 * it starts, not a name in a text, and not to a field of the custom setting or a custom permission in a formula.
 * A pair is reported where one of its references is.
 */
const reportedOfFlow = (reference: { readonly to: string; readonly via: string }): boolean =>
  !reference.to.startsWith('Flow:') &&
  reference.via !== 'text' &&
  !(reference.via === 'formula' && (reference.to.startsWith(SETTING) || reference.to.startsWith('CustomPermission:')));

/** Of the references of Phase 2 in the key, those the test org reports, where their target is custom. */
const reportedOfPhase2 = (reference: { readonly from: string; readonly to: string; readonly via: string }): boolean =>
  (reference.from.startsWith('Flow:') && reportedOfFlow(reference)) ||
  (reference.from.startsWith('WorkflowFieldUpdate:') && reference.via === 'formula') ||
  (reference.from.startsWith('CustomMetadata:') && reference.via === 'record-of') ||
  reference.from.startsWith('FieldSet:') ||
  reference.from.startsWith('EmailTemplate:');

/** The pairs of the answer key the mock org reports. A pair is reported once. */
export function keyedPairs(): KeyedPair[] {
  const key = loadAnswerKey();
  const components = new Map(key.components.map((one) => [one.key as string, one]));
  const endOf = (componentKey: string): MockEnd | undefined => {
    const component = components.get(componentKey);
    return component === undefined ? undefined : [component.type, component.fullName];
  };
  const pairs = new Map<string, KeyedPair>();
  for (const reference of key.references) {
    if (reference.phase === 2 && !reportedOfPhase2(reference)) continue;
    // Salesforce counts a class, not a method of it, and a flow, not an element of it, at either end of a row.
    const whole = (key: string): string => (key.includes('#') ? key.slice(0, key.indexOf('#')) : key);
    const from = endOf(whole(reference.from));
    const to = endOf(whole(reference.to));
    if (from === undefined || to === undefined) continue;
    const apex = from[0] === 'ApexClass' || from[0] === 'ApexTrigger';
    const reported =
      reference.phase === 2 ||
      reference.via === 'formula' ||
      (reference.via === 'filter' && SUMMARIES.has(reference.from));
    if (!apex && !reported) continue;
    if (from[0] === to[0] && from[1] === to[1]) continue;
    pairs.set(`${from.join(':')} ${to.join(':')}`, { from, to, apex });
  }
  return [...pairs.values()];
}

/** The three rows to an object that Salesforce reports and that the key has no entry for. */
const TO_AN_OBJECT: readonly (readonly [MockEnd, MockEnd])[] = [
  // The object behind $ObjectType in VLOOKUP, and the custom metadata type behind $CustomMetadata.
  [
    ['ValidationRule', 'Invoice__c.Tax_Rate_Matches_Code'],
    ['CustomObject', 'Tax_Code__c'],
  ],
  [
    ['ValidationRule', 'Invoice__c.Large_Amount_Needs_Permission'],
    ['CustomObject', 'Billing_Rule__mdt'],
  ],
  // The object whose fields the merge fields of the email template name (`docs/research/phase-2/real-org.md`,
  // section 3).
  [
    ['EmailTemplate', 'Billing/Invoice_Overdue'],
    ['CustomObject', 'Invoice__c'],
  ],
];

/** The rows, with the ids the mock org lists the components with. */
export function fixtureDependencyRows(metadata: MockMetadata): MockDependencyRow[] {
  return [
    ...keyedPairs().map(({ from, to }) => dependencyRow(metadata, from, to)),
    ...TO_AN_OBJECT.map(([from, to]) => dependencyRow(metadata, from, to)),
  ];
}
