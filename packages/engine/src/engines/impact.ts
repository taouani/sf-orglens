/**
 * The impact engine: what refers to a component, directly or through others (decision record 0044).
 *
 * The walk goes level by level. The first level holds what refers to the component, the second what refers to
 * the first, and so on. A component is found once, at the level where it is first met, so the chain that is
 * kept for it is a shortest one. Among the shortest chains the most certain one is kept, and among those the
 * first in an order that depends on keys and places only, never on a number of the database. The same snapshot
 * gives the same answer on every machine.
 *
 * A result holds one reference, the one it is found by, and not its whole chain: the other end of that
 * reference is a result too, one level nearer, and holds the next. An answer with all chains written out grows
 * with the number of results times their depth, which was 443 MB of JSON for the largest answer measured.
 *
 * Each level is one question to the graph for all its components together. A walk from a field that half of an
 * org refers to asks a handful of questions, not one per component.
 *
 * A flow runs its elements, so a walk takes a flow and its elements together (decision record 0066). What an
 * element refers to, its flow refers to: where the walk finds an element, it finds the flow beside it, by the
 * same reference, and goes on from the flow to what calls it. The other way round, where a walk of what a
 * component refers to finds a flow, it goes on from the elements of the flow.
 */
import { EngineError } from '../core/errors.ts';
import { buildKey, canonicalType, foldName, isComponentKey, KNOWN_TYPES, type ComponentKey } from '../core/keys.ts';
import {
  CONFIDENCE_TIERS,
  REFERENCE_KINDS,
  REFERENCE_ORIGINS,
  RESOLUTIONS,
  type ConfidenceTier,
  type Reference,
} from '../core/references.ts';
import type { GraphComponent, GraphEdge, GraphLink, SnapshotGraph } from '../store/graph.ts';

/** A component as an answer names it. */
export interface ImpactComponent {
  readonly key: ComponentKey;
  /** The metadata type, as Salesforce names it. */
  readonly type: string;
  /** The name as the source spells it. `null` for a component the snapshot refers to and does not hold. */
  readonly name: string | null;
  /** The file that defines it. `null` for a component no file of the snapshot defines, such as a standard field. */
  readonly file: string | null;
}

/** One reference of a chain: the component it stands in, the component it names, and where it stands. */
export interface ImpactStep {
  readonly from: ComponentKey;
  readonly to: ComponentKey;
  readonly kind: Reference['kind'];
  readonly origin: Reference['origin'];
  readonly confidence: ConfidenceTier;
  readonly resolution: Reference['resolution'];
  /** The place of the reference. All three are `null` for a reference that Salesforce reported without a place. */
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
}

/** A component the walk found. */
export interface ImpactResult extends ImpactComponent {
  /** How many references lie between it and the component that was asked about. `1`: it refers to it directly. */
  readonly depth: number;
  /** The weakest confidence among the references of the chain that leads to it. */
  readonly confidence: ConfidenceTier;
  /**
   * The reference the component is found by: the one at its end of a shortest chain of references between it
   * and the component that was asked about. For what refers to a component, `from` is this component and `to`
   * is one reference nearer. For what a component refers to, it is the other way round.
   *
   * A flow is found by a reference of one of its elements, so for a flow `from` can be that element, which is a
   * result too. For what a component refers to, the nearer end can be an element of a flow that is a result of
   * the depth before.
   *
   * The nearer end is a result of the depth before. At depth 1 it is the component that was asked about, or
   * something it contains, or the flow of an element that was asked about. Going from result to result gives
   * the whole chain.
   */
  readonly reference: ImpactStep;
}

/** A reference of an outgoing walk whose target has no key, so that no component stands for it. */
export interface ImpactUnresolved {
  readonly from: ComponentKey;
  /** The metadata type of the target, and the target as the source writes it. */
  readonly type: string;
  readonly name: string;
  readonly kind: Reference['kind'];
  readonly origin: Reference['origin'];
  readonly confidence: ConfidenceTier;
  readonly resolution: Reference['resolution'];
  readonly file: string | null;
  readonly line: number | null;
  readonly column: number | null;
  /** The depth a component with this name would have. */
  readonly depth: number;
}

export interface ImpactOptions {
  /** `incoming`: what refers to the component. `outgoing`: what the component refers to. Default: `incoming`. */
  readonly direction?: 'incoming' | 'outgoing' | undefined;
  /** How many references away from the component the walk goes at most. Default: as far as references lead. */
  readonly depth?: number | undefined;
  /** References less certain than this are not followed. Default: `possible`, which follows all of them. */
  readonly minConfidence?: ConfidenceTier | undefined;
}

export interface ImpactWalk {
  /** How many components of the snapshot the component contains. The walk starts from them too. */
  readonly parts: number;
  /** The metadata types of the component and of the components of the snapshot it contains, sorted. */
  readonly startTypes: readonly string[];
  /**
   * For an outgoing walk: how many of the component and the results the snapshot refers to and does not hold,
   * such as a standard field. What they refer to is not known. Always 0 for an incoming walk: a component
   * that refers to something is held.
   */
  readonly notHeld: number;
  /**
   * The keys of what the walk starts from, sorted: the component, what it contains, and for an incoming walk from
   * an element of a flow, the flow.
   */
  readonly start: readonly ComponentKey[];
  /**
   * For an outgoing walk: the keys of the elements of the flows it found, which it went on from and which are no
   * results, sorted. Always empty for an incoming walk.
   */
  readonly through: readonly ComponentKey[];
  /** Sorted by depth, then by key. */
  readonly results: readonly ImpactResult[];
  /** Sorted by depth, then by the key they start from, then by place. Always empty for an incoming walk. */
  readonly unresolved: readonly ImpactUnresolved[];
  /** True if the walk stopped at the depth that was asked for and references lead further. */
  readonly beyondDepth: boolean;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const typeOf = (key: ComponentKey): string => key.slice(0, key.indexOf(':'));
/** True for an element of a flow, which the key writes `Flow:<flow>#element:<name>`. */
const isElementOfFlow = (component: GraphComponent): boolean =>
  component.parentId !== null && typeOf(component.key) === 'Flow' && component.key.includes('#element:');
/** True for a flow, and not for an element of one. */
const isFlow = (component: GraphComponent): boolean => typeOf(component.key) === 'Flow' && !component.key.includes('#');

/** A component of the graph, as an answer names it. */
export const impactComponent = (component: GraphComponent): ImpactComponent => ({
  key: component.key,
  type: typeOf(component.key),
  name: component.version?.name ?? null,
  file: component.version?.path ?? null,
});

const placeOf = (edge: GraphEdge): Pick<ImpactStep, 'file' | 'line' | 'column'> => ({
  file: edge.location?.file ?? null,
  line: edge.location?.line ?? null,
  column: edge.location?.column ?? null,
});

/**
 * Orders two references between the same two components. Negative: `a` comes first. The more certain one
 * first, then one with a place before one without, then by where they stand and what they say.
 */
function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return (
    CONFIDENCE_TIERS.indexOf(a.confidence) - CONFIDENCE_TIERS.indexOf(b.confidence) ||
    Number(a.location === undefined) - Number(b.location === undefined) ||
    compareText(a.location?.file ?? '', b.location?.file ?? '') ||
    (a.location?.line ?? 0) - (b.location?.line ?? 0) ||
    (a.location?.column ?? 0) - (b.location?.column ?? 0) ||
    REFERENCE_KINDS.indexOf(a.kind) - REFERENCE_KINDS.indexOf(b.kind) ||
    REFERENCE_ORIGINS.indexOf(a.origin) - REFERENCE_ORIGINS.indexOf(b.origin) ||
    RESOLUTIONS.indexOf(a.resolution) - RESOLUTIONS.indexOf(b.resolution) ||
    compareText(a.toNameRaw, b.toNameRaw)
  );
}

/** A component the walk has reached, and how. */
interface Reached {
  readonly depth: number;
  /** The weakest confidence on the way here, as its place in `CONFIDENCE_TIERS`. */
  readonly confidence: number;
  /** The reference that led here, and the id of the component at its other end, which is one level nearer. */
  readonly link: GraphLink | null;
  readonly near: number | null;
}

/** The best way to a component that a level has shown so far: the references that are equally good. */
interface Candidate {
  readonly confidence: number;
  readonly near: number;
  readonly links: GraphLink[];
}

/**
 * Walks the references of a snapshot from a component and everything it contains.
 *
 * A component that is found is continued from itself, not from what it contains. What the start contains is
 * part of the start and never a result. A flow and its elements are taken together: for what refers to a
 * component, an element that is found brings its flow, which is a result beside it, and an element that is
 * asked about brings its flow into the start. For what a component refers to, a flow that is found brings its
 * elements, which are walked from and are no results.
 *
 * A level reads the two ends and the confidence of every reference it meets, which is enough to say what is
 * found and how certain the way to it is. The rest of a reference is read for the references that are kept,
 * and for those between which only their places can choose.
 */
export function walkImpact(graph: SnapshotGraph, start: GraphComponent, options: ImpactOptions = {}): ImpactWalk {
  const incoming = options.direction !== 'outgoing';
  const weakest = options.minConfidence ?? 'possible';
  const limit = options.depth;

  const reached = new Map<number, Reached>();
  const known = new Map<number, GraphComponent>();
  const origin: Reached = { depth: 0, confidence: 0, link: null, near: null };
  let frontier = [start.id, ...graph.below(start.id)];
  for (const id of frontier) reached.set(id, origin);
  let parts = 0;
  const startTypes = new Set([typeOf(start.key)]);
  for (const component of graph.components(frontier)) {
    known.set(component.id, component);
    if (component.id === start.id || component.version === null) continue;
    parts += 1;
    startTypes.add(typeOf(component.key));
  }
  // What calls the flow of an element runs the element. The flow is no part of the element, and no result.
  if (incoming && isElementOfFlow(start) && start.parentId !== null && !reached.has(start.parentId)) {
    reached.set(start.parentId, origin);
    frontier.push(start.parentId);
    for (const component of graph.components([start.parentId])) known.set(component.id, component);
  }

  const componentOf = (id: number | null): GraphComponent => {
    const component = id === null ? undefined : known.get(id);
    if (component === undefined) throw new EngineError('INTERNAL', 'A reference names a component that is not there.');
    return component;
  };
  const keyOf = (id: number | null): ComponentKey => componentOf(id).key;
  const nameless: { link: GraphLink; depth: number }[] = [];
  let beyondDepth = false;

  /**
   * The flows of the elements a level found, which the level finds as well. A flow is found by the most certain
   * of its elements, and among those by the one whose key comes first, with the way and the reference of that
   * element. A flow that an earlier level found keeps its way. One that this level found by a reference of its
   * own keeps it, unless the way through an element is more certain. Gives the flows that are new to the walk.
   */
  const flowsOfElements = (level: readonly number[], depth: number): number[] => {
    const ways = new Map<number, { readonly element: ComponentKey; readonly how: Reached }>();
    for (const id of level) {
      const element = known.get(id);
      const how = reached.get(id);
      if (element === undefined || how === undefined || !isElementOfFlow(element)) continue;
      const flow = element.parentId;
      if (flow === null) continue;
      const before = reached.get(flow);
      if (before !== undefined && (before.depth < depth || before.confidence <= how.confidence)) continue;
      const best = ways.get(flow);
      if (
        best === undefined ||
        how.confidence < best.how.confidence ||
        (how.confidence === best.how.confidence && compareText(element.key, best.element) < 0)
      ) {
        ways.set(flow, { element: element.key, how });
      }
    }
    const added = [...ways.keys()].filter((flow) => !reached.has(flow));
    for (const [flow, { how }] of ways) reached.set(flow, how);
    for (const component of graph.components(added)) known.set(component.id, component);
    return added;
  };

  /**
   * The elements of the flows a level found. What they refer to, their flow refers to, so the next level walks
   * from them, with the depth and the confidence of their flow. They are no results.
   */
  const elementsOfFlows = (level: readonly number[], depth: number): number[] => {
    const flows = level.filter((id) => {
      const component = known.get(id);
      return component !== undefined && isFlow(component);
    });
    const added: number[] = [];
    for (const element of graph.partsOf(flows)) {
      const flow = element.parentId === null ? undefined : reached.get(element.parentId);
      if (flow === undefined || reached.has(element.id)) continue;
      reached.set(element.id, { depth, confidence: flow.confidence, link: null, near: element.parentId });
      known.set(element.id, element);
      added.push(element.id);
    }
    return added;
  };

  for (let depth = 1; frontier.length > 0; depth += 1) {
    const links = incoming ? graph.linksTo(frontier, weakest) : graph.linksFrom(frontier, weakest);
    const far = (link: GraphLink): number | null => (incoming ? link.fromId : link.toId);
    if (limit !== undefined && depth > limit) {
      beyondDepth = links.some((link) => {
        const id = far(link);
        return id === null || !reached.has(id);
      });
      break;
    }
    const found = new Map<number, Candidate>();
    for (const link of links) {
      const id = far(link);
      if (id === null) {
        nameless.push({ link, depth });
        continue;
      }
      if (reached.has(id)) continue;
      const near = incoming ? link.toId : link.fromId;
      const before = near === null ? undefined : reached.get(near);
      if (near === null || before === undefined) continue;
      const confidence = Math.max(before.confidence, CONFIDENCE_TIERS.indexOf(link.confidence));
      const best = found.get(id);
      // The most certain way first, then the one through the component whose key comes first.
      const order =
        best === undefined
          ? -1
          : confidence - best.confidence || (near === best.near ? 0 : compareText(keyOf(near), keyOf(best.near)));
      if (order < 0) found.set(id, { confidence, near, links: [link] });
      else if (order === 0) best?.links.push(link);
    }
    // Several references between the same two components that make the chain equally certain: the most
    // certain of them is kept, then the first by its place.
    const tied = [...found.values()].filter((candidate) => candidate.links.length > 1);
    const places = new Map<GraphLink, GraphEdge>();
    const details = graph.edges(tied.flatMap((candidate) => candidate.links));
    tied
      .flatMap((candidate) => candidate.links)
      .forEach((link, at) => {
        const edge = details[at];
        if (edge !== undefined) places.set(link, edge);
      });
    frontier = [...found.keys()];
    for (const [id, { confidence, near, links: equal }] of found) {
      let link = equal[0];
      for (const other of equal.slice(1)) {
        const [a, b] = [places.get(other), link === undefined ? undefined : places.get(link)];
        if (a !== undefined && b !== undefined && compareEdges(a, b) < 0) link = other;
      }
      reached.set(id, { depth, confidence, link: link ?? null, near });
    }
    for (const component of graph.components(frontier)) known.set(component.id, component);
    if (incoming) frontier.push(...flowsOfElements(frontier, depth));
    else frontier.push(...elementsOfFlows(frontier, depth));
  }

  // The rest of the references that are part of the answer, read once.
  const kept: GraphLink[] = [];
  for (const how of reached.values()) if (how.link !== null) kept.push(how.link);
  for (const { link } of nameless) kept.push(link);
  const edges = new Map<GraphLink, GraphEdge>();
  graph.edges(kept).forEach((edge, at) => {
    const link = kept[at];
    if (link !== undefined) edges.set(link, edge);
  });
  const edgeOf = (link: GraphLink): GraphEdge => {
    const edge = edges.get(link);
    if (edge === undefined) throw new EngineError('INTERNAL', 'A reference of the answer was not read.');
    return edge;
  };

  const stepOf = (edge: GraphEdge): ImpactStep => ({
    from: keyOf(edge.fromId),
    to: keyOf(edge.toId),
    kind: edge.kind,
    origin: edge.origin,
    confidence: edge.confidence,
    resolution: edge.resolution,
    ...placeOf(edge),
  });

  const results: ImpactResult[] = [];
  const begins: ComponentKey[] = [];
  const through: ComponentKey[] = [];
  let notHeld = !incoming && start.version === null ? 1 : 0;
  for (const [id, how] of reached) {
    if (how === origin) begins.push(keyOf(id));
    else if (how.link === null) through.push(keyOf(id));
    if (how.link === null) continue;
    if (!incoming && componentOf(id).version === null) notHeld += 1;
    results.push({
      ...impactComponent(componentOf(id)),
      depth: how.depth,
      confidence: CONFIDENCE_TIERS[how.confidence] ?? 'possible',
      reference: stepOf(edgeOf(how.link)),
    });
  }
  results.sort((a, b) => a.depth - b.depth || compareText(a.key, b.key));

  const unresolved = nameless
    .map(({ link, depth }): ImpactUnresolved => {
      const edge = edgeOf(link);
      return {
        from: keyOf(edge.fromId),
        type: edge.toType,
        name: edge.toNameRaw,
        kind: edge.kind,
        origin: edge.origin,
        confidence: edge.confidence,
        resolution: edge.resolution,
        ...placeOf(edge),
        depth,
      };
    })
    .sort(
      (a, b) =>
        a.depth - b.depth ||
        compareText(a.from, b.from) ||
        compareText(a.file ?? '', b.file ?? '') ||
        (a.line ?? 0) - (b.line ?? 0) ||
        (a.column ?? 0) - (b.column ?? 0) ||
        compareText(a.name, b.name) ||
        compareText(a.kind, b.kind),
    );

  return {
    parts,
    startTypes: [...startTypes].sort(compareText),
    notHeld,
    start: begins.sort(compareText),
    through: through.sort(compareText),
    results,
    unresolved,
    beyondDepth,
  };
}

/** The component a person named, and the other components its name alone fits. */
export interface FoundComponent {
  readonly component: GraphComponent;
  /**
   * The keys of the other components that the name fits, sorted, where it was a name alone that fits an object
   * and more, or a flow and its definition. Empty for a name that fits one component, and for a key or a type with
   * a name.
   */
  readonly sameName: readonly ComponentKey[];
}

/**
 * The key of an element of a flow that is named after its flow, `Invoice_After_Save.Update_Account`, or `null`
 * for a name of another form. Neither the name of a flow nor that of an element can hold a dot.
 */
function elementKeyOf(name: string): ComponentKey | null {
  const parts = name.split('.');
  const [flow = '', element = ''] = parts;
  if (parts.length !== 2 || flow === '' || element === '') return null;
  try {
    return buildKey({ type: 'Flow', fullName: flow, subs: [{ kind: 'element', name: element }] });
  } catch {
    return null;
  }
}

/**
 * The key a text is, written in any case, or `null` for a text that is no key in any case:
 * `Flow:Invoice_After_Save#element:Update_Account` is the key `Flow:invoice_after_save#element:update_account`.
 */
function keyOfText(text: string): ComponentKey | null {
  const colon = text.indexOf(':');
  if (colon < 1) return null;
  try {
    // Folding writes the escape of a slash in a key in lower case, and a key writes it in upper case.
    const key = `${canonicalType(text.slice(0, colon))}:${foldName(text.slice(colon + 1)).replaceAll('%2f', '%2F')}`;
    return isComponentKey(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * Finds the component a person names: by its key, by its type and name (`CustomField:Account.Industry`), or
 * by its name alone (`Account.Industry`). Case plays no part. An element of a flow is named after its flow,
 * `Invoice_After_Save.Update_Account`, alone or after `Flow:`. Written in lower case after `Flow:`, such a name
 * is also the key of a flow with a dot in its name, which no flow has: it is looked for as an element after that.
 *
 * A name alone is looked for in every type of `types` and in every type the engine knows by name. A name that
 * fits an object and other components means the object, and the others are named with it: the file of the
 * workflow rules of an object has the name of the object (decision record 0064). A name that fits a flow and its
 * definition and nothing else means the flow, and the definition is named with it (decision record 0082). Any
 * other name that fits components of several types and no object is an error that lists them: the engine does not
 * choose.
 */
export function findComponent(graph: SnapshotGraph, named: string, types: readonly string[]): FoundComponent {
  const text = named.trim();
  const notFound = (): EngineError =>
    new EngineError('COMPONENT_NOT_FOUND', `The snapshot knows no component "${text}".`, {
      hint: 'Name a component by its name, such as Account.Industry, or by its type and name, such as CustomField:Account.Industry.',
      details: { component: text, snapshot: graph.snapshotId },
    });
  if (text === '') throw notFound();

  const key = keyOfText(text);
  const byKey = key === null ? undefined : graph.find(key);
  if (byKey !== undefined) return { component: byKey, sameName: [] };
  const colon = text.indexOf(':');
  if (colon !== -1) {
    // A type and a name. A type that is none is said by the error of the key.
    const name = text.slice(colon + 1);
    const typed = buildKey({ type: text.slice(0, colon), fullName: name });
    const element = typeOf(typed) === 'Flow' ? elementKeyOf(name) : null;
    const found = graph.find(typed) ?? (element === null ? undefined : graph.find(element));
    if (found === undefined) throw notFound();
    return { component: found, sameName: [] };
  }

  const candidates: { readonly type: string; readonly found: GraphComponent }[] = [];
  for (const type of [...new Set([...types, ...KNOWN_TYPES])].sort(compareText)) {
    const found = graph.find(buildKey({ type, fullName: text }));
    if (found !== undefined) candidates.push({ type, found });
  }
  const element = elementKeyOf(text);
  const ofFlow = element === null ? undefined : graph.find(element);
  if (ofFlow !== undefined) candidates.push({ type: 'Flow', found: ofFlow });
  candidates.sort((a, b) => compareText(a.found.key, b.found.key));
  const [first, second] = candidates;
  if (first === undefined) throw notFound();
  if (second === undefined) return { component: first.found, sameName: [] };
  const keys = candidates.map((one) => one.found.key);
  const object = candidates.find((one) => one.type === 'CustomObject');
  if (object !== undefined) {
    return { component: object.found, sameName: keys.filter((key) => key !== object.found.key).sort(compareText) };
  }
  // An org lists a definition of every flow under the name of the flow. A name that fits the two and nothing else
  // means the flow (decision record 0082).
  const flow = candidates.find((one) => typeOf(one.found.key) === 'Flow' && !one.found.key.includes('#'));
  if (
    flow !== undefined &&
    candidates.length === 2 &&
    candidates.some((one) => typeOf(one.found.key) === 'FlowDefinition')
  ) {
    return { component: flow.found, sameName: keys.filter((key) => key !== flow.found.key) };
  }
  throw new EngineError(
    'COMPONENT_AMBIGUOUS',
    `"${text}" names ${String(keys.length)} components: ${keys.join(', ')}.`,
    {
      hint: `Name the one you mean by its key, such as ${first.found.key}.`,
      details: { component: text, snapshot: graph.snapshotId, candidates: keys },
    },
  );
}

/** A type of a snapshot with what the snapshot holds of it. */
export interface TypeCount {
  readonly type: string;
  readonly listed: number;
  readonly retrieved: number;
  readonly analysed: number;
  readonly listing: 'ok' | 'failed' | 'unlistable' | 'excluded';
}

/** A type that an answer does not cover, or covers in part. */
export interface ImpactGap {
  readonly type: string;
  /** How many components of the type the source says it has, and how many of them the snapshot holds. */
  readonly listed: number;
  readonly retrieved: number;
  /**
   * `failed`: the source refused to list the type. `unlistable`: Salesforce never lists it. `excluded`: the
   * configuration of the source leaves it out.
   */
  readonly listing: 'ok' | 'failed' | 'unlistable' | 'excluded';
}

/** What an answer does not cover. */
export interface ImpactGaps {
  /**
   * The types of the snapshot that no analyser read. A component of such a type can refer to anything, and no
   * reference of it is in the answer.
   */
  readonly notAnalysed: readonly ImpactGap[];
  /** The analysed types of which the snapshot holds less than the source has. */
  readonly partial: readonly ImpactGap[];
  /**
   * Errors of the reading that name no type: a file or a folder that could not be read. What is missing may
   * be of an analysed type.
   */
  readonly readErrors: number;
  /** Errors of the analysis: a file that could not be read or placed, or a component that could not be analysed. */
  readonly analysisErrors: number;
  /**
   * Warnings of the analysis: a name that was not read, a path that was not followed, a formula that was not
   * read as a whole, a part of a file that was not found. Each can hide a reference.
   */
  readonly analysisWarnings: number;
  /**
   * For what a component refers to: how many of the component and the results the snapshot does not hold,
   * such as a standard field. What they refer to is not known. Always 0 for what refers to a component.
   */
  readonly notHeld: number;
}

/**
 * What an answer from a snapshot does not cover, from the counts per type and the issues of the snapshot.
 *
 * Whether a type was analysed is read from the snapshot, not from this version of the engine: a snapshot
 * that an older version analysed covers what that version read. `analysedTypes` are the types the analysis
 * of the snapshot read. A type among them counts as analysed also when the snapshot holds nothing of it: if
 * the source has components of it, they are missing from an answer that claims to cover the type. `null`
 * for an analysis that did not keep the list: the number of analysed components then decides alone.
 *
 * `unlisted` are the types of which the snapshot holds components that the source did not list. Such a type
 * counts as any other, also where the source listed nothing of it (decision record 0073): its counts are then 0.
 *
 * `ofPackages` counts per type the components of managed packages that the source listed and the snapshot does
 * not hold, where the answer does not count them: they make no type partial (decision record 0076).
 *
 * `notHeld` is 0 here. It is known from a walk.
 */
export function impactGaps(
  types: readonly TypeCount[],
  issues: { readonly read: number; readonly analysis: number; readonly analysisWarnings: number },
  analysedTypes: readonly string[] | null,
  unlisted: ReadonlySet<string> = new Set(),
  ofPackages: ReadonlyMap<string, number> = new Map(),
): ImpactGaps {
  const gap = ({ type, listed, retrieved, listing }: TypeCount): ImpactGap => ({ type, listed, retrieved, listing });
  const sorted = [...types].sort((a, b) => compareText(a.type, b.type));
  const read = new Set(analysedTypes);
  const analysed = (type: TypeCount): boolean => type.analysed > 0 || read.has(type.type);
  const held = (type: TypeCount): boolean => type.listed > 0 || type.retrieved > 0 || unlisted.has(type.type);
  return {
    notAnalysed: sorted.filter((type) => !analysed(type) && (held(type) || type.listing !== 'ok')).map(gap),
    partial: sorted
      .filter(
        (type) =>
          analysed(type) &&
          (type.retrieved + (ofPackages.get(type.type) ?? 0) < type.listed ||
            type.listing === 'failed' ||
            type.listing === 'excluded'),
      )
      .map(gap),
    readErrors: issues.read,
    analysisErrors: issues.analysis,
    analysisWarnings: issues.analysisWarnings,
    notHeld: 0,
  };
}

/** True if nothing is known that an answer could miss. */
export const coversEverything = (gaps: ImpactGaps): boolean =>
  gaps.notAnalysed.length === 0 &&
  gaps.partial.length === 0 &&
  gaps.readErrors === 0 &&
  gaps.analysisErrors === 0 &&
  gaps.analysisWarnings === 0 &&
  gaps.notHeld === 0;

/**
 * True if something of the source was not read that an answer claims to cover: components of an analysed
 * type, or a file or folder of which nothing says what it held. A type that is not analysed is named in the
 * answer and is not such a miss. A warning of the analysis does not make it true either, as it does not make
 * an analysis incomplete (decision record 0043), though the name it is about can be a reference the answer
 * lacks: `coversEverything` is false for it.
 */
export const mayMissSomething = (gaps: ImpactGaps): boolean =>
  gaps.partial.length > 0 || gaps.readErrors > 0 || gaps.analysisErrors > 0;
