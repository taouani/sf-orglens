/**
 * What the Dependency API of a mock org that holds the fixture project reports.
 *
 * The rows are made from the answer key of the project, which is written by hand: every reference the key has
 * for a formula or for the filter of a roll-up summary, and every reference it has for Apex, where the target
 * is something the project defines. To these come the three rows to an object that the probe of the test org
 * saw and that are not made from the key (`docs/research/phase-1/real-org.md`, section 4). The rows are written the way
 * Salesforce writes them (`mock-dependencies.ts`).
 *
 * The mock reports nothing yet for what Phase 2 reads: flows, workflow rules, record types, field sets, records
 * of custom metadata types and email templates. Which of their pairs Salesforce reports is measured in the test
 * org first. Their rows come with their analysers.
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
    if (reference.phase === 2) continue;
    // Salesforce counts a class, not a method of it.
    const whole = reference.from.includes('#') ? reference.from.slice(0, reference.from.indexOf('#')) : reference.from;
    const from = endOf(whole);
    const to = endOf(reference.to);
    if (from === undefined || to === undefined) continue;
    const apex = from[0] === 'ApexClass' || from[0] === 'ApexTrigger';
    const reported = reference.via === 'formula' || (reference.via === 'filter' && SUMMARIES.has(reference.from));
    if (!apex && !reported) continue;
    if (from[0] === to[0] && from[1] === to[1]) continue;
    pairs.set(`${from.join(':')} ${to.join(':')}`, { from, to, apex });
  }
  return [...pairs.values()];
}

/**
 * The three rows to an object that Salesforce reports and that are not made from the key. The key has no entry
 * for the first two. It has one for the third, as a reference of Phase 2, which is left out above.
 */
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
  // A record of a custom metadata type, to its type.
  [
    ['CustomMetadata', 'Billing_Rule.Default'],
    ['CustomObject', 'Billing_Rule__mdt'],
  ],
];

/** The rows, with the ids the mock org lists the components with. */
export function fixtureDependencyRows(metadata: MockMetadata): MockDependencyRow[] {
  return [
    ...keyedPairs().map(({ from, to }) => dependencyRow(metadata, from, to)),
    ...TO_AN_OBJECT.map(([from, to]) => dependencyRow(metadata, from, to)),
  ];
}
