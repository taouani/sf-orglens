/**
 * The answer to an impact question about one snapshot (decision record 0044).
 *
 * The engine walks the references. This module finds the snapshot and the component, refuses a snapshot that
 * has no analysis, and puts next to the answer what the answer does not cover.
 */
import { EngineError } from '../core/errors.ts';
import type { ComponentKey } from '../core/keys.ts';
import { isConfidenceTier, type ConfidenceTier } from '../core/references.ts';
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
import type { Store } from '../store/open.ts';
import { countIssues, readCoverage, readSnapshot, type SnapshotRecord } from '../store/snapshots.ts';
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
  readonly component: ImpactComponent;
  /**
   * The keys of the other components of the same name, sorted, where the component was named by its name alone
   * and the name fits an object and more: the answer is about the object (decision record 0064). Empty for a
   * name that fits one component, and for a key or a type with a name.
   */
  readonly sameName: readonly ComponentKey[];
  /** How many components of the snapshot it contains. The answer is about them too. */
  readonly parts: number;
  /** `incoming`: `results` holds what refers to the component. `outgoing`: what the component refers to. */
  readonly direction: 'incoming' | 'outgoing';
  /** The depth that was asked for. `null`: no limit. */
  readonly depth: number | null;
  /** True if the answer stops at `depth` and references lead further. */
  readonly beyondDepth: boolean;
  readonly minConfidence: ConfidenceTier;
  /**
   * Sorted by depth, then by key. What the component contains is never among them. Each holds the reference it
   * is found by, whose other end is a result of the depth before, or the component and what it contains.
   */
  readonly results: readonly ImpactResult[];
  /** For `outgoing`: the references to a name that has no key, so that no component stands for it. */
  readonly unresolved: readonly ImpactUnresolved[];
  /**
   * True if nothing is known that the answer could miss: every type of the snapshot was analysed, the snapshot
   * holds every component of them, and the reading and the analysis had neither an error nor, for the
   * analysis, a warning. False says that the answer is what was found, and that `notCovered` names what could
   * not be looked at.
   */
  readonly complete: boolean;
  /**
   * For `outgoing`, `notAnalysed` holds only the types of the component, of what it contains and of the
   * results: what a component refers to does not depend on the other types. `notHeld` counts the component
   * and the results that the snapshot does not hold.
   */
  readonly notCovered: ImpactGaps;
  /**
   * True if something of the source was not read that the answer claims to cover: `notCovered.partial` is not
   * empty, or one of the two counts of errors is not zero. A type that is not analysed yet does not make it
   * true, and neither does a warning of the analysis.
   */
  readonly mayMiss: boolean;
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
  // What an answer claims to cover: the types the analysis read, and every type of which it analysed a
  // component. The actions of a workflow rule are among them and outside the logic tier (decision record 0063),
  // so a warning of the reading about one of them counts.
  const covered = [
    ...new Set([...(analysis.types ?? []), ...types.filter((one) => one.analysed > 0).map((one) => one.type)]),
  ];
  const gaps = impactGaps(types, countIssues(store, snapshot.id, covered), analysis.types);
  // What a component refers to is known once the component is analysed, whatever else the snapshot holds. For
  // that question, a type counts only if the component, something it contains or a result is of it. And what
  // a component refers to that the snapshot does not hold is not known at all.
  const walked = new Set([...walk.startTypes, ...walk.results.map((result) => result.type)]);
  const notCovered =
    direction === 'incoming'
      ? gaps
      : { ...gaps, notAnalysed: gaps.notAnalysed.filter((gap) => walked.has(gap.type)), notHeld: walk.notHeld };

  return {
    snapshot: {
      id: snapshot.id,
      source: snapshot.source,
      kind: snapshot.kind,
      status: snapshot.status,
      finishedAt: snapshot.finishedAt,
      analysedBy: analysis.engineVersion,
    },
    component: impactComponent(start),
    sameName,
    parts: walk.parts,
    direction,
    depth: depth ?? null,
    beyondDepth: walk.beyondDepth,
    minConfidence,
    results: walk.results,
    unresolved: walk.unresolved,
    complete: coversEverything(notCovered),
    notCovered,
    mayMiss: mayMissSomething(notCovered),
  };
}
