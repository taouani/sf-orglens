/**
 * The cross-check: what the Dependency API of Salesforce reports for an org, held against the references an
 * analysis found in the snapshot of that org (decision records 0034 and 0045).
 *
 * A row of the API names two components. It is matched to two components of the snapshot by the ids the org
 * listed them with. A name is taken only where there is no id: for a standard object, which the API itself
 * names in the place of an id, and for a component the org listed without one. A pair that Salesforce reports
 * and the analysis lacks is a reference that was missed. A pair the analysis has and Salesforce lacks is
 * counted only where the API is known to report that kind of reference, and is no error: the API does not see
 * everything.
 *
 * The comparison is for the types the analysis read, without the flows, whose rows are not compared yet. A row
 * from a component of another type is counted and not compared.
 *
 * Nothing here reads a database or an org.
 */
import type { JsonValue } from '../core/errors.ts';
import { buildKey, parentKey, parseKey, type ComponentKey } from '../core/keys.ts';
import type { AnalysedComponent, AnalysisIssue } from '../extraction/analysed.ts';
import type { DependencyEnd, DependencyRow } from '../sources/dependency-api.ts';
import type { ListedId } from '../store/dependencies.ts';

/** A component, and a component it refers to. */
export interface CrossCheckPair {
  readonly from: string;
  readonly to: string;
}

/** Why a pair that only the analysis has says nothing against it: the API does not report that kind. */
export type NotReportedReason =
  | 'standard-field'
  | 'standard-object'
  | 'inactive-rule'
  | 'lookup'
  | 'lookup-filter'
  | 'roll-up-summary'
  | 'controlling-field'
  | 'value-set'
  | 'display-field'
  | 'default-value'
  | 'workflow-rule'
  | 'workflow-action'
  | 'field-update'
  | 'other';

/** What the comparison of the rows of the Dependency API with an analysis found. */
export interface CrossCheck {
  /** The rows of the API the snapshot holds. */
  readonly rows: number;
  /** Rows from a component of a type the analysis does not read. They are not compared. */
  readonly rowsNotAnalysed: number;
  /** The same, per type as the API writes it, sorted by type. */
  readonly notAnalysed: readonly { readonly type: string; readonly rows: number }[];
  /** Rows of which one end is no component the org listed, so that it could not be matched. Not compared. */
  readonly rowsNotMatched: number;
  /** Rows from a component of an analysed type that the snapshot does not hold or that was not analysed. */
  readonly rowsNotHeld: number;
  /** Rows that were compared, and the different pairs of components they are. */
  readonly rowsCompared: number;
  readonly pairs: number;
  /** Pairs the analysis has as well. */
  readonly agreed: number;
  /**
   * Pairs to an object for which the analysis has a reference from the same component to something the object
   * contains, such as a field of it, and none to the object itself.
   */
  readonly coveredByPart: number;
  /** Pairs Salesforce reports and the analysis lacks, sorted. Each is an error of the analysis. */
  readonly missed: readonly CrossCheckPair[];
  /**
   * Pairs the analysis has, of a kind the API is known to report, for which no row was compared, sorted. Either
   * the analysis found a reference that is none, or the API left one out, or the row is one that is missing or
   * could not be matched.
   */
  readonly onlyOrgLens: readonly CrossCheckPair[];
  /** Pairs the analysis has without a row, of a kind the API does not report. Per reason, sorted by reason. */
  readonly notReported: readonly { readonly reason: NotReportedReason; readonly pairs: number }[];
}

export interface CrossCheckInput {
  readonly rows: readonly DependencyRow[];
  /** What the org listed, with the id of each component. */
  readonly listed: readonly ListedId[];
  /** The components of the analysis, with their references. */
  readonly components: readonly AnalysedComponent[];
  /** The types the analysis read. */
  readonly analysedTypes: readonly string[];
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The ids of an org have 15 characters, or 18 with three more that repeat the case of the first 15. */
const shortId = (id: string): string => id.slice(0, 15);
const typeOf = (key: string): string => key.slice(0, key.indexOf(':'));
/** The component a key belongs to as Salesforce counts components: a class, not a method of it. */
const whole = (key: string): string => (key.includes('#') ? key.slice(0, key.indexOf('#')) : key);

function keyOf(type: string, fullName: string): ComponentKey | null {
  try {
    return buildKey({ type, fullName });
  } catch {
    return null;
  }
}

/** True for the key of a field that Salesforce provides: its own name has no ending of a custom field. */
function isStandardField(key: string): boolean {
  if (typeOf(key) !== 'CustomField') return false;
  const { name } = parseKey(key);
  return !/__(?:c|pc)$/.test(name.slice(name.lastIndexOf('.') + 1));
}

/** True for the key of an object that Salesforce provides: its name has no ending such as `__c` or `__mdt`. */
const isStandardObject = (key: string): boolean =>
  typeOf(key) === 'CustomObject' && !/__[a-z]+$/.test(parseKey(key).name);

/** Finds the components of the snapshot that the ends of rows stand for. */
export function listedMatcher(listed: readonly ListedId[]): (end: DependencyEnd) => ComponentKey | null {
  const byId = new Map<string, { readonly type: string; readonly key: ComponentKey }[]>();
  /** The components the org listed without an id, by type and full name. */
  const withoutId = new Map<string, ComponentKey>();
  for (const item of listed) {
    const key = keyOf(item.type, item.fullName);
    if (key === null) continue;
    if (item.id === null || item.id === '') {
      withoutId.set(`${item.type.toLowerCase()}\u0000${item.fullName.toLowerCase()}`, key);
    } else {
      const sameId = byId.get(shortId(item.id)) ?? [];
      sameId.push({ type: item.type, key });
      byId.set(shortId(item.id), sameId);
    }
  }
  const named = (type: string, fullName: string): ComponentKey | null =>
    withoutId.get(`${type.toLowerCase()}\u0000${fullName.toLowerCase()}`) ?? null;

  return (end) => {
    const sameId = byId.get(shortId(end.id));
    if (sameId !== undefined) {
      // An id stands for one component. Should the org list it under two types, the type of the row decides,
      // and without a type that fits the id says nothing.
      if (sameId.length === 1) return sameId[0]?.key ?? null;
      const ofType = sameId.filter((one) => one.type === end.type);
      return ofType.length === 1 ? (ofType[0]?.key ?? null) : null;
    }
    // A standard object has no id. The API writes its name in the place of one, so the name is what
    // Salesforce identifies it by, and no guess.
    if (end.type === 'StandardEntity') return keyOf('CustomObject', end.name);
    // A custom object always has an id. The API names it without its ending, which can be the name of a
    // standard object: `Order` for `Order__c`. So a custom object is never taken by its name.
    if (end.type === 'CustomObject') return null;
    // What is left is a component the org listed without an id. Its type and full name are all there is. A
    // component that was listed with an id is found by that id or not at all: a row with another id is no
    // row about it. The API names a field and a rule without their object, so they find nothing here.
    const name = end.namespace === null ? end.name : `${end.namespace}__${end.name}`;
    // A record of a custom metadata type: the type of the row is the name of the custom metadata type.
    const recordType = /^(.+)__mdt$/i.exec(end.type)?.[1];
    if (recordType !== undefined) return named('CustomMetadata', `${recordType}.${name}`);
    return named(end.type, name);
  };
}

/** What the analysis knows of one pair: the references from the one component to the other. */
interface Found {
  readonly vias: Set<string>;
  readonly origins: Set<string>;
}

/** Why the API does not report a pair of the analysis, or `null` if it is of a kind the API reports. */
function notReported(from: AnalysedComponent, to: string, found: Found): NotReportedReason | null {
  if (isStandardField(to)) return 'standard-field';
  if (isStandardObject(to)) return 'standard-object';
  const type = typeOf(from.key);
  if (type === 'ValidationRule' && from.attrs?.['active'] === false) return 'inactive-rule';
  // Of a file of workflow rules, the test org reports the custom fields the formula of a field update reads, and
  // nothing else: not what a rule reads or starts, not what an alert, an outbound message or a task names, not the
  // field an update writes and not the relationship that leads to the parent it writes on.
  if (type === 'WorkflowRule') return 'workflow-rule';
  if (type === 'WorkflowAlert' || type === 'WorkflowOutboundMessage' || type === 'WorkflowTask') {
    return 'workflow-action';
  }
  if (type === 'WorkflowFieldUpdate') return found.origins.has('parser:formula') ? null : 'field-update';
  if (found.origins.has('parser:formula')) {
    // A formula of a rule or of a formula field. A field without a formula has one in its default value, and
    // whether the API reports something custom there was not measured.
    return type === 'ValidationRule' || from.attrs?.['formula'] === true ? null : 'default-value';
  }
  // The fields in the filter of a roll-up summary are reported. Those in the filter of a lookup are not.
  if (found.vias.has('filter')) return from.attrs?.['type'] === 'Summary' ? null : 'lookup-filter';
  if (found.vias.has('summary')) return 'roll-up-summary';
  if (found.vias.has('lookup')) return 'lookup';
  if (found.vias.has('controlling-field')) return 'controlling-field';
  if (found.vias.has('value-set')) return 'value-set';
  if (found.vias.has('display-field')) return 'display-field';
  return 'other';
}

const pairId = (from: string, to: string): string => `${from}\u0000${to}`;

/**
 * Types the analysis reads and whose rows are not compared yet. A row from a flow carries the id of a version,
 * and the org lists a flow with the id of its latest version, which need not be the one that is analysed
 * (decision record 0060). Their rows are counted with those of the types that are not read.
 */
const NOT_COMPARED_YET: ReadonlySet<string> = new Set(['Flow']);

/** Compares the rows of the Dependency API with the references of an analysis. */
export function crossCheck(input: CrossCheckInput): CrossCheck {
  const analysedTypes = new Set(input.analysedTypes.filter((type) => !NOT_COMPARED_YET.has(type)));
  const match = listedMatcher(input.listed);

  // What the analysis found, as pairs of whole components.
  const components = new Map<string, AnalysedComponent>();
  const found = new Map<string, Map<string, Found>>();
  for (const component of input.components) {
    const from = whole(component.key);
    if (from === component.key) components.set(from, component);
    for (const reference of component.references) {
      if (reference.to === null) continue;
      const to = whole(reference.to);
      if (to === from) continue;
      const targets = found.get(from) ?? new Map<string, Found>();
      const one = targets.get(to) ?? { vias: new Set<string>(), origins: new Set<string>() };
      const via = reference.attrs?.['via'];
      if (typeof via === 'string') one.vias.add(via);
      one.origins.add(reference.origin);
      targets.set(to, one);
      found.set(from, targets);
    }
  }
  /** True for a component the snapshot holds and the analysis read. */
  const analysed = (key: string): boolean => {
    const component = components.get(key);
    if (component === undefined) return false;
    return component.definition !== null && component.attrs !== null;
  };

  const notAnalysed = new Map<string, number>();
  let rowsNotMatched = 0;
  let rowsNotHeld = 0;
  let rowsCompared = 0;
  const reported = new Map<string, CrossCheckPair>();
  for (const row of input.rows) {
    const from = match(row.from);
    // The type of the component that refers, as the snapshot names it. Without a match, the type the API
    // writes is taken: a row of a class is of a class whether its id is known or not.
    // A record of a custom metadata type has the name of that type as its type, which is no type.
    const type = from !== null ? typeOf(from) : /__mdt$/i.test(row.from.type) ? 'CustomMetadata' : row.from.type;
    if (!analysedTypes.has(type)) {
      notAnalysed.set(type, (notAnalysed.get(type) ?? 0) + 1);
      continue;
    }
    const to = match(row.to);
    if (from === null || to === null) {
      rowsNotMatched += 1;
    } else if (!analysed(from)) {
      rowsNotHeld += 1;
    } else {
      rowsCompared += 1;
      if (from !== to) reported.set(pairId(from, to), { from, to });
    }
  }

  let agreed = 0;
  let coveredByPart = 0;
  const missed: CrossCheckPair[] = [];
  for (const pair of reported.values()) {
    const targets = found.get(pair.from);
    if (targets?.has(pair.to) === true) {
      agreed += 1;
    } else if (
      typeOf(pair.to) === 'CustomObject' &&
      [...(targets?.keys() ?? [])].some((target) => parentKey(target as ComponentKey) === pair.to)
    ) {
      coveredByPart += 1;
    } else {
      missed.push(pair);
    }
  }

  const onlyOrgLens: CrossCheckPair[] = [];
  const reasons = new Map<NotReportedReason, number>();
  for (const [from, targets] of found) {
    const component = components.get(from);
    if (component === undefined || !analysed(from) || !analysedTypes.has(typeOf(from))) continue;
    for (const [to, one] of targets) {
      if (reported.has(pairId(from, to))) continue;
      const reason = notReported(component, to, one);
      if (reason === null) onlyOrgLens.push({ from, to });
      else reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  const byPair = (a: CrossCheckPair, b: CrossCheckPair): number => compare(a.from, b.from) || compare(a.to, b.to);
  return {
    rows: input.rows.length,
    rowsNotAnalysed: [...notAnalysed.values()].reduce((sum, count) => sum + count, 0),
    notAnalysed: [...notAnalysed].sort(([a], [b]) => compare(a, b)).map(([type, rows]) => ({ type, rows })),
    rowsNotMatched,
    rowsNotHeld,
    rowsCompared,
    pairs: reported.size,
    agreed,
    coveredByPart,
    missed: missed.sort(byPair),
    onlyOrgLens: onlyOrgLens.sort(byPair),
    notReported: [...reasons].sort(([a], [b]) => compare(a, b)).map(([reason, pairs]) => ({ reason, pairs })),
  };
}

/** The issues of an analysis that a comparison gives: one error for every pair that was missed. */
export function crossCheckIssues(result: CrossCheck): AnalysisIssue[] {
  return result.missed.map(({ from, to }) => ({
    severity: 'error',
    code: 'REFERENCE_MISSED',
    message: `Salesforce reports that ${from} refers to ${to}, and the analysis found no such reference.`,
    componentKey: from,
    details: { from, to, origin: 'dependency-api' } satisfies Record<string, JsonValue>,
  }));
}
