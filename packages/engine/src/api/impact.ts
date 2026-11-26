/**
 * The answer to an impact question about one snapshot (decision record 0044).
 *
 * The engine walks the references. This module finds the snapshot and the component, refuses a snapshot that
 * has no analysis, and puts next to the answer what the answer does not cover.
 */
import { EngineError } from '../core/errors.ts';
import { parentKey, type ComponentKey } from '../core/keys.ts';
import { isConfidenceTier, type ConfidenceTier } from '../core/references.ts';
import { namingTypes } from '../engines/can-name.ts';
import { warningsThatBear } from '../engines/warnings.ts';
import {
  coversEverything,
  findComponent,
  impactComponent,
  impactGaps,
  mayMissSomething,
  walkImpact,
  type ImpactComponent,
  type ImpactGaps,
  type ImpactResult,
  type ImpactUnresolved,
} from '../engines/impact.ts';
import { readAnalysis } from '../store/analysis.ts';
import { sqlGraph } from '../store/graph.ts';
import { countInventory } from '../store/journal.ts';
import type { Store } from '../store/open.ts';
import { countMissingOfPackagesNothingNames, readPackages } from '../store/packages.ts';
import {
  countIssues,
  readAnalysisWarnings,
  readCoverage,
  readIssuesOf,
  readSnapshot,
  type SnapshotRecord,
} from '../store/snapshots.ts';
import { noSnapshot } from './snapshot.ts';

export interface ImpactQuery {
  /** The snapshot to ask. Default: the latest finished snapshot of the source. */
  readonly snapshot?: number | undefined;
  /** How many references away from the component the answer goes at most. Default: as far as references lead. */
  readonly depth?: number | undefined;
  /** References less certain than this are not followed. Default: `possible`, which follows all of them. */
  readonly minConfidence?: ConfidenceTier | undefined;
  /** True to ask what the component refers to, in place of what refers to it. */
  readonly outgoing?: boolean | undefined;
  /**
   * True to keep the components of managed packages among what refers to the component, which an answer leaves
   * out otherwise (decision record 0076). It changes nothing for what the component refers to.
   */
  readonly packages?: boolean | undefined;
}

/** A component of an answer, with the managed package it is of (decision record 0076). */
export interface ImpactReportComponent extends ImpactComponent {
  /**
   * The prefix of the managed package installed in the org that the component is of, as the org lists it. `null`
   * for a component of the org's own, also of the org's own namespace, and for every component of a snapshot of a
   * repository.
   */
  readonly package: string | null;
}

/** A result of an answer, with the managed package it is of (decision record 0076). */
export interface ImpactReportResult extends ImpactResult {
  /** As `ImpactReportComponent.package` says. */
  readonly package: string | null;
}

/** What refers to a component, or what it refers to, in one snapshot. */
export interface ImpactReport {
  readonly snapshot: {
    readonly id: number;
    /** The name of the source. */
    readonly source: string;
    readonly kind: 'org' | 'sandbox' | 'git';
    /** `partial`: something of the source is missing in the snapshot. `notCovered` says whether that matters here. */
    readonly status: 'complete' | 'partial';
    /** When the snapshot was read, and the version of the engine that analysed it. */
    readonly finishedAt: string | null;
    readonly analysedBy: string;
  };
  /** The component that was asked about. */
  readonly component: ImpactReportComponent;
  /**
   * The keys of the other components of the same name, sorted, where the component was named by its name alone
   * and the name fits an object and more: the answer is about the object (decision record 0064). Also where it
   * fits a flow and its definition and nothing else: the answer is about the flow (decision record 0082). Empty for
   * a name that fits one component, and for a key or a type with a name.
   */
  readonly sameName: readonly ComponentKey[];
  /** How many components of the snapshot it contains. The answer is about them too. */
  readonly parts: number;
  /**
   * For an element of a flow, the flow. A flow runs its elements, so an answer about what refers to the element
   * holds what refers to the flow (decision record 0066). `null` for any other component.
   */
  readonly elementOf: ComponentKey | null;
  /** `incoming`: `results` holds what refers to the component. `outgoing`: what the component refers to. */
  readonly direction: 'incoming' | 'outgoing';
  /** The depth that was asked for. `null`: no limit. */
  readonly depth: number | null;
  /** True if the answer stops at `depth` and references lead further. */
  readonly beyondDepth: boolean;
  readonly minConfidence: ConfidenceTier;
  /**
   * Sorted by depth, then by key. What the component contains is never among them. Each holds the reference it
   * is found by, whose other end is a result of the depth before, or the component and what it contains. A flow
   * is found beside its element, by the reference of the element: `ImpactResult.reference` says what that does to
   * the two ends (decision record 0066).
   *
   * For `incoming`, a component of a managed package is left out unless the question keeps it (decision records
   * 0056 and 0076). The walk goes on through it all the same, so the nearer end of a reference can be such a
   * component, which is no result then. For `outgoing`, a component of a package is a target and is never left out.
   */
  readonly results: readonly ImpactReportResult[];
  /** How many components of managed packages the answer found and left out of `results`. `0` when it keeps them. */
  readonly packagesLeftOut: number;
  /** For `outgoing`: the references to a name that has no key, so that no component stands for it. */
  readonly unresolved: readonly ImpactUnresolved[];
  /**
   * The flows of the answer whose active version, which the snapshot holds, has a newer version beside it, such
   * as a draft, sorted by flow: the flow that was asked about or the flow of the element that was, and the flows
   * among the results. The newer version is not analysed, and the answer does not hold what it would change
   * (decision record 0060). Only a snapshot of an org can know of one.
   */
  readonly newerVersions: readonly NewerVersion[];
  /**
   * True if nothing is known that the answer could miss: every type of the snapshot that could be in it was
   * analysed, the snapshot holds every component of them, and the reading and the analysis had neither an
   * error nor, for the analysis, a warning. False says that the answer is what was found, and that
   * `notCovered` names what could not be looked at.
   */
  readonly complete: boolean;
  /**
   * For `incoming`, `notAnalysed` leaves out a type whose components can name no type of the answer, as the
   * table of `engines/can-name.ts` says (decision record 0073). For `outgoing`, it holds only the types of the
   * component, of what it contains and of the results: what a component refers to does not depend on the other
   * types. `notHeld` counts the component and the results that the snapshot does not hold.
   */
  readonly notCovered: ImpactGaps;
  /**
   * True if something of the source was not read that the answer claims to cover: `notCovered.partial` is not
   * empty, or one of the two counts of errors is not zero. A type that is not analysed yet does not make it
   * true, and neither does a warning of the analysis.
   */
  readonly mayMiss: boolean;
}

/** A flow whose active version the snapshot holds, and which has a newer version that is not analysed. */
export interface NewerVersion {
  readonly flow: ComponentKey;
  /** The number of the active version. */
  readonly active: number;
  /** The state of the newer version, as its file names it, such as `Draft`. */
  readonly newer: string;
}

/** The flow a key is of: the flow itself, or the flow of an element. `null` for a key of another type. */
function flowOf(key: ComponentKey): ComponentKey | null {
  if (!key.startsWith('Flow:')) return null;
  return key.includes('#') ? (parentKey(key) ?? null) : key;
}

/**
 * The flows among these that have a newer version than the active one the snapshot holds, from the notes the
 * snapshot keeps of them (decision record 0062).
 */
function newerVersionsOf(store: Store, snapshotId: number, flows: ReadonlySet<ComponentKey>): NewerVersion[] {
  const found = new Map<ComponentKey, NewerVersion>();
  for (const note of readIssuesOf(store, snapshotId, 'FLOW_NEWER_VERSION')) {
    const flow = note.componentKey as ComponentKey | null;
    const active = note.details?.['version'];
    const newer = note.details?.['newer'];
    if (flow === null || !flows.has(flow) || typeof active !== 'number' || typeof newer !== 'string') continue;
    found.set(flow, { flow, active, newer });
  }
  return [...found.values()].sort((a, b) => (a.flow < b.flow ? -1 : a.flow > b.flow ? 1 : 0));
}

/**
 * The finished snapshot of a source that a question is about. One that has not ended, or that was given up,
 * holds a part of the source at most and answers nothing.
 */
export function finishedSnapshot(
  store: Store,
  source: string,
  id: number | undefined,
  purpose: 'analysed' | 'asked',
): SnapshotRecord & { readonly status: 'complete' | 'partial' } {
  const snapshot = readSnapshot(store, source, id);
  if (snapshot === undefined) throw noSnapshot(source, id);
  const { status } = snapshot;
  if (status === 'complete' || status === 'partial') return { ...snapshot, status };
  // Only reached with the number of a snapshot: the latest one is always one that has ended.
  const running = status === 'running';
  const then = purpose === 'analysed' ? 'it cannot be analysed' : 'nothing can be asked of it';
  throw new EngineError(
    'SNAPSHOT_NOT_FOUND',
    running
      ? `Snapshot ${String(snapshot.id)} of the source "${source}" has not ended, so ${then}.`
      : `Snapshot ${String(snapshot.id)} of the source "${source}" was given up. It holds a part of the source at most and is not analysed.`,
    {
      hint: running
        ? `It is continued and then analysed by: orglens snapshot ${source}`
        : 'The latest snapshot of each source is shown by: orglens status',
      details: { source, snapshot: snapshot.id, status },
    },
  );
}

/** Answers an impact question from the database. Reads only. */
export function impactOf(store: Store, source: string, component: string, query: ImpactQuery = {}): ImpactReport {
  const { depth } = query;
  if (depth !== undefined && (!Number.isSafeInteger(depth) || depth < 1)) {
    throw new EngineError('INTERNAL', 'The depth of an impact question is a whole number from 1.');
  }
  if (query.minConfidence !== undefined && !isConfidenceTier(query.minConfidence)) {
    throw new EngineError('INTERNAL', 'The least confidence of an impact question is a confidence tier.');
  }
  const snapshot = finishedSnapshot(store, source, query.snapshot, 'asked');
  const analysis = readAnalysis(store, snapshot.id);
  if (analysis === undefined) {
    throw new EngineError(
      'SNAPSHOT_NOT_ANALYSED',
      `Snapshot ${String(snapshot.id)} of the source "${source}" was not analysed, so nothing is known about what refers to what in it.`,
      {
        hint: `Analyse it with: orglens analyse ${source} --snapshot ${String(snapshot.id)}`,
        details: { source, snapshot: snapshot.id },
      },
    );
  }

  const types = readCoverage(store, snapshot.id);
  const graph = sqlGraph(store, snapshot.id);
  const { component: start, sameName } = findComponent(
    graph,
    component,
    types.map((one) => one.type),
  );
  const direction = query.outgoing === true ? 'outgoing' : 'incoming';
  const minConfidence = query.minConfidence ?? 'possible';
  const walk = walkImpact(graph, start, { direction, depth, minConfidence });
  // What refers to a component of the org leaves out a component of a package as the thing that refers, unless
  // the question keeps it. What the walk found through it stays. What a component refers to is a target, which a
  // component of a package stays (decision records 0056 and 0076).
  const packages = readPackages(store, snapshot.id);
  const found = walk.results.map((result) => ({ ...result, package: packages.of(result.key) }));
  const leaveOut = direction === 'incoming' && query.packages !== true;
  const results = leaveOut ? found.filter((result) => result.package === null) : found;
  // What an answer claims to cover: the types the analysis read, and every type of which it analysed a
  // component. A warning of the reading about one of them counts. Every type this version analyses is of the
  // logic tier (decision record 0068), and no snapshot is known to hold such a warning: the rule is there for later.
  const covered = [
    ...new Set([...(analysis.types ?? []), ...types.filter((one) => one.analysed > 0).map((one) => one.type)]),
  ];
  // A type of which the snapshot holds components that the source did not list counts, also where the source
  // listed none of it (decision record 0073).
  const unlisted = new Set(
    [...countInventory(store, snapshot.id)].filter(([, count]) => count.unlisted > 0).map(([type]) => type),
  );
  // A warning of the analysis counts where the reference it says may be missing could be one of the answer
  // (decision record 0074). A warning of the reading about a version of a flow counts as before.
  const { read, analysis: analysisErrors, readWarnings } = countIssues(store, snapshot.id, covered);
  const bearing = warningsThatBear(readAnalysisWarnings(store, snapshot.id), walk, direction).length;
  const issues = { read, analysis: analysisErrors, analysisWarnings: readWarnings + bearing };
  // A component of a package that the org listed and did not hand out makes no type partial where no reference of
  // the snapshot names it: no chain of references goes through it. An answer that keeps the components of
  // packages as the thing that refers counts every one, as it can be a result (decision record 0076).
  const keepsPackages = direction === 'incoming' && query.packages === true;
  const ofPackages = keepsPackages ? new Map<string, number>() : countMissingOfPackagesNothingNames(store, snapshot.id);
  const gaps = impactGaps(types, issues, analysis.types, unlisted, ofPackages);
  // What a component refers to is known once the component is analysed, whatever else the snapshot holds. For
  // that question, a type counts only if the component, something it contains or a result is of it. And what
  // a component refers to that the snapshot does not hold is not known at all. For what refers to a component,
  // a type counts unless what its components can name is known and none of it is of the answer. Once one counts,
  // what is analysed and no result can refer to the component through it (decision record 0073).
  const walked = new Set([...walk.startTypes, ...walk.results.map((result) => result.type)]);
  const notCovered =
    direction === 'incoming'
      ? { ...gaps, notAnalysed: namingTypes(gaps.notAnalysed, walked, covered) }
      : { ...gaps, notAnalysed: gaps.notAnalysed.filter((gap) => walked.has(gap.type)), notHeld: walk.notHeld };

  const flows = new Set(
    [start.key, ...results.map((result) => result.key)].map(flowOf).filter((flow) => flow !== null),
  );
  const isElement = start.key.startsWith('Flow:') && start.key.includes('#element:');

  return {
    snapshot: {
      id: snapshot.id,
      source: snapshot.source,
      kind: snapshot.kind,
      status: snapshot.status,
      finishedAt: snapshot.finishedAt,
      analysedBy: analysis.engineVersion,
    },
    component: { ...impactComponent(start), package: packages.of(start.key) },
    sameName,
    parts: walk.parts,
    elementOf: isElement ? (flowOf(start.key) ?? null) : null,
    direction,
    depth: depth ?? null,
    beyondDepth: walk.beyondDepth,
    minConfidence,
    results,
    packagesLeftOut: found.length - results.length,
    unresolved: walk.unresolved,
    newerVersions: newerVersionsOf(store, snapshot.id, flows),
    complete: coversEverything(notCovered),
    notCovered,
    mayMiss: mayMissSomething(notCovered),
  };
}
