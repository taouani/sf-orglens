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
 * The comparison is for the types the analysis read. A row from a component of another type is counted and not
 * compared. A row from a flow carries the id of a version of the flow, and is compared only where that is the
 * version the snapshot holds (decision record 0067).
 *
 * Nothing here reads a database or an org.
 */
import type { JsonValue } from '../core/errors.ts';
import { buildKey, parentKey, parseKey, type ComponentKey } from '../core/keys.ts';
import type { AnalysedComponent, AnalysisIssue } from '../extraction/analysed.ts';
import type { DependencyEnd, DependencyRow, FlowVersionIds } from '../sources/dependency-api.ts';
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
  | 'custom-metadata'
  | 'record-type'
  | 'subflow'
  | 'name-in-text'
  | 'global-variable'
  | 'action-override'
  | 'report-type'
  | 'quick-action'
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
  /**
   * Rows from a version of a flow that is not the one the snapshot holds, such as a draft beside the active
   * version. They are not compared.
   */
  readonly rowsOtherVersion: number;
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
  /**
   * The ids of the active and of the latest version of each flow, as the org named them when it was asked.
   * Empty where it was not asked or did not answer: a row from a flow is then matched by the id the org listed the
   * flow with, which is the id of its latest version.
   */
  readonly flowVersions: readonly FlowVersionIds[];
  /**
   * The keys of the flows whose active version the snapshot holds in the place of a newer one, as the note
   * `FLOW_NEWER_VERSION` says. Of any other flow it holds the version that came for its name, the latest.
   */
  readonly newerVersions: readonly string[];
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
  /**
   * The components the org listed without an id, by type and full name: the name the snapshot holds one under,
   * and the name the org listed it with where that is another.
   */
  const withoutId = new Map<string, ComponentKey>();
  for (const item of listed) {
    const key = keyOf(item.type, item.fullName);
    if (key === null) continue;
    if (item.id === null || item.id === '') {
      for (const name of item.listedAs === undefined ? [item.fullName] : [item.listedAs, item.fullName]) {
        withoutId.set(`${item.type.toLowerCase()}\u0000${name.toLowerCase()}`, key);
      }
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

/**
 * A version of a flow, as a row names it: the flow, and whether it is the version the snapshot holds. The key is
 * `null` for an id the org named for two flows: it stands for no version, and a row with it is not matched.
 */
interface FlowVersion {
  readonly key: ComponentKey | null;
  readonly held: boolean;
}

/**
 * Finds the flow that the end of a row stands for where its id is that of a version of a flow (decision record
 * 0067): by the ids the org named the active and the latest version with, and else by the id it listed the flow
 * with, which is that of its latest version. The flow is the one the org listed with the id of its latest version,
 * under the name of the listing, which is the name of the component the snapshot holds. Only a flow that the org
 * did not list with that id goes by the name `FlowDefinition` gives it. The version the snapshot holds is the
 * active one where a newer one is noted, and else the latest. `null`: the end is no version of a flow the org
 * named or listed.
 */
export function versionMatcher(
  listed: readonly ListedId[],
  versions: readonly FlowVersionIds[],
  newerVersions: readonly string[],
): (end: DependencyEnd) => FlowVersion | null {
  /** The flows the org listed, by the id it listed each with. */
  const listedFlows = new Map<string, ComponentKey>();
  for (const item of listed) {
    const key = item.type === 'Flow' && item.id !== null ? keyOf('Flow', item.fullName) : null;
    if (key !== null && item.id !== null) listedFlows.set(shortId(item.id), key);
  }
  const byId = new Map<string, { readonly key: ComponentKey; readonly versions: Set<'active' | 'latest'> }>();
  /** Ids the org named for two flows. An id stands for one version of one flow, so such an id says nothing. */
  const twice = new Set<string>();
  const add = (id: string | null, key: ComponentKey, version: 'active' | 'latest'): void => {
    if (id === null || id === '') return;
    const known = byId.get(shortId(id));
    if (known !== undefined && known.key !== key) twice.add(shortId(id));
    const one = known ?? { key, versions: new Set<'active' | 'latest'>() };
    one.versions.add(version);
    byId.set(shortId(id), one);
  };
  for (const flow of versions) {
    // `FlowDefinition` gives the name of a flow and the prefix of its package in two fields. The name they make
    // need not be the one the listing writes, so the listing is asked first.
    const key = (flow.latest === null ? undefined : listedFlows.get(shortId(flow.latest))) ?? keyOf('Flow', flow.flow);
    if (key === null) continue;
    add(flow.active, key, 'active');
    add(flow.latest, key, 'latest');
  }
  // Where the org named no version of a flow, the id it listed the flow with is that of the latest one.
  for (const [id, key] of listedFlows) if (!byId.has(id)) add(id, key, 'latest');
  const activeHeld = new Set(newerVersions);

  return (end) => {
    if (end.type !== 'Flow') return null;
    if (twice.has(shortId(end.id))) return { key: null, held: false };
    const found = byId.get(shortId(end.id));
    if (found === undefined) return null;
    return { key: found.key, held: found.versions.has(activeHeld.has(found.key) ? 'active' : 'latest') };
  };
}

/**
 * How many of the flows the org listed it named no version of. A flow is named where the id the org listed it
 * with is one the org named for a version, or where its name is one the org named.
 */
export function flowsNotNamed(listed: readonly ListedId[], versions: readonly FlowVersionIds[]): number {
  const ids = new Set<string>();
  const names = new Set<ComponentKey>();
  for (const flow of versions) {
    for (const id of [flow.active, flow.latest]) if (id !== null) ids.add(shortId(id));
    const key = keyOf('Flow', flow.flow);
    if (key !== null) names.add(key);
  }
  return listed.filter((item) => {
    if (item.type !== 'Flow') return false;
    if (item.id !== null && ids.has(shortId(item.id))) return false;
    const key = keyOf('Flow', item.fullName);
    return key === null || !names.has(key);
  }).length;
}

/** What the analysis knows of one pair: the references from the one component to the other. */
interface Found {
  readonly vias: Set<string>;
  readonly origins: Set<string>;
}

/** True if the references of a pair are all of one way. */
const only = (vias: ReadonlySet<string>, via: string): boolean => vias.size === 1 && vias.has(via);

/**
 * Why the API does not report a pair of the analysis, or `null` if it is of a kind the API reports. `isSetting`
 * says of the key of an object whether it is a custom setting.
 */
function notReported(
  from: AnalysedComponent,
  to: string,
  found: Found,
  isSetting: (key: string) => boolean,
): NotReportedReason | null {
  if (isStandardField(to)) return 'standard-field';
  if (isStandardObject(to)) return 'standard-object';
  const type = typeOf(from.key);
  // Of a flow, the test org reports every custom field and custom object, whatever names it, and what an action
  // starts. It does not report a flow that the flow starts, a record type whose name a condition compares a text
  // with, and a field of a custom setting or a custom permission that only formulas of the flow name, through
  // `$Setup` and `$Permission` (decision record 0067).
  if (type === 'Flow') {
    if (typeOf(to) === 'Flow') return 'subflow';
    if (only(found.vias, 'text')) return 'name-in-text';
    const parent = typeOf(to) === 'CustomField' ? parentKey(to as ComponentKey) : undefined;
    const global = typeOf(to) === 'CustomPermission' || (parent !== undefined && isSetting(parent));
    return global && only(found.vias, 'formula') ? 'global-variable' : null;
  }
  if (type === 'ValidationRule' && from.attrs?.['active'] === false) return 'inactive-rule';
  // Of a file of workflow rules, the test org reports the custom fields the formula of a field update reads, and
  // nothing else: not what a rule reads or starts, not what an alert, an outbound message or a task names, not the
  // field an update writes and not the relationship that leads to the parent it writes on.
  if (type === 'WorkflowRule') return 'workflow-rule';
  if (type === 'WorkflowAlert' || type === 'WorkflowOutboundMessage' || type === 'WorkflowTask') {
    return 'workflow-action';
  }
  if (type === 'WorkflowFieldUpdate') return found.origins.has('parser:formula') ? null : 'field-update';
  // Of a record of a custom metadata type, the test org reports the type it is a record of, and nothing else: not
  // the fields it gives a value, not what a value names. Of a record type, nothing: not the picklist fields whose
  // values it limits. Of a field set, every custom field, also across a relationship.
  if (type === 'CustomMetadata') return found.vias.has('record-of') ? null : 'custom-metadata';
  if (type === 'RecordType') return 'record-type';
  if (type === 'FieldSet') return null;
  // Of an email template, the test org reports the custom fields its merge fields name, and the object they are
  // of. Of a report type it reports nothing. Of a quick action it reports the object it creates records of and the
  // field `targetParentField`, which is `assignment` as a field a predefined value sets is, and the object was
  // measured for one action of one kind: a pair of a quick action without a row is counted and not listed too
  // (decision record 0077).
  if (type === 'EmailTemplate') return null;
  if (type === 'ReportType') return 'report-type';
  if (type === 'QuickAction') return 'quick-action';
  // Of an object, a large org reported the Lightning page that overrides one of its actions. Whether the API
  // reports a Visualforce page, a Lightning component or an s-control that does was not measured (decision record
  // 0070).
  if (only(found.vias, 'action-override')) return typeOf(to) === 'FlexiPage' ? null : 'action-override';
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

/** Compares the rows of the Dependency API with the references of an analysis. */
export function crossCheck(input: CrossCheckInput): CrossCheck {
  const analysedTypes = new Set(input.analysedTypes);
  const listed = listedMatcher(input.listed);
  const versionOf = versionMatcher(input.listed, input.flowVersions, input.newerVersions);
  /** A flow is found by the id of any version of it: what refers to a flow refers to the flow. */
  const match = (end: DependencyEnd): ComponentKey | null => {
    const version = versionOf(end);
    return version === null ? listed(end) : version.key;
  };

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
  /** True for the key of an object the analysis read as a custom setting. */
  const isSetting = (key: string): boolean => typeof components.get(key)?.attrs?.['customSettingsType'] === 'string';

  const notAnalysed = new Map<string, number>();
  let rowsNotMatched = 0;
  let rowsNotHeld = 0;
  let rowsOtherVersion = 0;
  let rowsCompared = 0;
  const reported = new Map<string, CrossCheckPair>();
  for (const row of input.rows) {
    const version = versionOf(row.from);
    const from = version === null ? listed(row.from) : version.key;
    // The type of the component that refers, as the snapshot names it. Without a match, the type the API
    // writes is taken: a row of a class is of a class whether its id is known or not.
    // A record of a custom metadata type has the name of that type as its type, which is no type.
    const type = from !== null ? typeOf(from) : /__mdt$/i.test(row.from.type) ? 'CustomMetadata' : row.from.type;
    if (!analysedTypes.has(type)) {
      notAnalysed.set(type, (notAnalysed.get(type) ?? 0) + 1);
      continue;
    }
    // A row of another version of a flow than the one the snapshot holds says nothing about the one it holds. A
    // flow the snapshot does not hold at all is counted as such below. Here `from` is the flow of the version.
    if (version?.held === false && from !== null && analysed(from)) {
      rowsOtherVersion += 1;
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
      const reason = notReported(component, to, one, isSetting);
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
    rowsOtherVersion,
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
