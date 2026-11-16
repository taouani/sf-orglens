/**
 * The impact engine: what refers to a component, directly or through others (decision record 0044).
 *
 * The walk goes level by level. The first level holds what refers to the component, the second what refers to
 * the first, and so on. A component is found once, at the level where it is first met, so the path that is kept
 * for it is a shortest one. Among the shortest paths the most certain one is kept, and among those the first
 * in an order that depends on keys and places only, never on a number of the database. The same snapshot gives
 * the same answer on every machine.
 *
 * Each level is one question to the graph for all its components together. A walk from a field that half of an
 * org refers to asks a handful of questions, not one per component.
 */
import { EngineError } from '../core/errors.ts';
import { buildKey, isComponentKey, KNOWN_TYPES, type ComponentKey } from '../core/keys.ts';
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

/** One reference on a path: the component it stands in, the component it names, and where it stands. */
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
  /** The weakest confidence among the references of `path`. */
  readonly confidence: ConfidenceTier;
  /**
   * A shortest chain of references between this component and the one that was asked about, in the order the
   * references follow each other: the `to` of a step is the `from` of the next. For what refers to a
   * component, the chain starts at this component. For what a component refers to, it ends at it.
   */
  readonly path: readonly ImpactStep[];
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
  /** Sorted by depth, then by key. */
  readonly results: readonly ImpactResult[];
  /** Sorted by depth, then by the key they start from, then by place. Always empty for an incoming walk. */
  readonly unresolved: readonly ImpactUnresolved[];
  /** True if the walk stopped at the depth that was asked for and references lead further. */
  readonly beyondDepth: boolean;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const typeOf = (key: ComponentKey): string => key.slice(0, key.indexOf(':'));

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

/** Orders two references of one level by where they stand and what they say. Negative: `a` comes first. */
function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return (
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
 * part of the start and never a result.
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
  for (const component of graph.components(frontier)) {
    known.set(component.id, component);
    if (component.id !== start.id && component.version !== null) parts += 1;
  }

  const componentOf = (id: number | null): GraphComponent => {
    const component = id === null ? undefined : known.get(id);
    if (component === undefined) throw new EngineError('INTERNAL', 'A reference names a component that is not there.');
    return component;
  };
  const keyOf = (id: number | null): ComponentKey => componentOf(id).key;
  const nameless: { link: GraphLink; depth: number }[] = [];
  let beyondDepth = false;

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
    // Several references between the same two components, equally certain: the first by its place is kept.
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
  for (const [id, how] of reached) {
    if (how.link === null) continue;
    const path: ImpactStep[] = [];
    let at: Reached | undefined = how;
    while (at !== undefined && at.link !== null && at.near !== null) {
      path.push(stepOf(edgeOf(at.link)));
      at = reached.get(at.near);
    }
    // Walking back from the result gives the steps from the result to the start. For an outgoing walk the
    // references run the other way.
    if (!incoming) path.reverse();
    results.push({
      ...impactComponent(componentOf(id)),
      depth: how.depth,
      confidence: CONFIDENCE_TIERS[how.confidence] ?? 'possible',
      path,
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

  return { parts, results, unresolved, beyondDepth };
}

/**
 * Finds the component a person names: by its key, by its type and name (`CustomField:Account.Industry`), or
 * by its name alone (`Account.Industry`). Case plays no part.
 *
 * A name alone is looked for in every type of `types` and in every type the engine knows by name. A name that
 * fits components of several types is an error that lists them: the engine does not choose.
 */
export function findComponent(graph: SnapshotGraph, named: string, types: readonly string[]): GraphComponent {
  const text = named.trim();
  const notFound = (): EngineError =>
    new EngineError('COMPONENT_NOT_FOUND', `The snapshot knows no component "${text}".`, {
      hint: 'Name a component by its name, such as Account.Industry, or by its type and name, such as CustomField:Account.Industry.',
      details: { component: text, snapshot: graph.snapshotId },
    });
  if (text === '') throw notFound();

  if (isComponentKey(text)) {
    const found = graph.find(text);
    if (found === undefined) throw notFound();
    return found;
  }
  const colon = text.indexOf(':');
  if (colon !== -1) {
    // A type and a name. A type that is none is said by the error of the key.
    const found = graph.find(buildKey({ type: text.slice(0, colon), fullName: text.slice(colon + 1) }));
    if (found === undefined) throw notFound();
    return found;
  }

  const candidates: GraphComponent[] = [];
  for (const type of [...new Set([...types, ...KNOWN_TYPES])].sort(compareText)) {
    const found = graph.find(buildKey({ type, fullName: text }));
    if (found !== undefined) candidates.push(found);
  }
  const [first, second] = candidates;
  if (first === undefined) throw notFound();
  if (second === undefined) return first;
  const keys = candidates.map((one) => one.key);
  throw new EngineError(
    'COMPONENT_AMBIGUOUS',
    `"${text}" names ${String(keys.length)} components: ${keys.join(', ')}.`,
    {
      hint: `Name the one you mean by its key, such as ${first.key}.`,
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
  readonly listing: 'ok' | 'failed' | 'unlistable';
}

/** A type that an answer does not cover, or covers in part. */
export interface ImpactGap {
  readonly type: string;
  /** How many components of the type the source says it has, and how many of them the snapshot holds. */
  readonly listed: number;
  readonly retrieved: number;
  /** `failed`: the source refused to list the type. `unlistable`: Salesforce never lists it. */
  readonly listing: 'ok' | 'failed' | 'unlistable';
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
}

/**
 * What an answer from a snapshot does not cover, from the counts per type and the errors of the snapshot.
 *
 * Whether a type was analysed is read from the snapshot, not from this version of the engine: a snapshot
 * that an older version analysed covers what that version read.
 */
export function impactGaps(
  types: readonly TypeCount[],
  errors: { readonly read: number; readonly analysis: number },
): ImpactGaps {
  const gap = ({ type, listed, retrieved, listing }: TypeCount): ImpactGap => ({ type, listed, retrieved, listing });
  const sorted = [...types].sort((a, b) => compareText(a.type, b.type));
  return {
    notAnalysed: sorted
      .filter((type) => type.analysed === 0 && (type.listed > 0 || type.retrieved > 0 || type.listing !== 'ok'))
      .map(gap),
    partial: sorted
      .filter((type) => type.analysed > 0 && (type.retrieved < type.listed || type.listing === 'failed'))
      .map(gap),
    readErrors: errors.read,
    analysisErrors: errors.analysis,
  };
}

/** True if an answer covers everything the source holds that can refer to a component. */
export const coversEverything = (gaps: ImpactGaps): boolean =>
  gaps.notAnalysed.length === 0 && gaps.partial.length === 0 && gaps.readErrors === 0 && gaps.analysisErrors === 0;

/**
 * True if an answer may miss something it claims to cover: a component of an analysed type, or a reference of
 * one. A type that is not analysed is named in the answer and is not such a miss.
 */
export const mayMissSomething = (gaps: ImpactGaps): boolean =>
  gaps.partial.length > 0 || gaps.readErrors > 0 || gaps.analysisErrors > 0;
