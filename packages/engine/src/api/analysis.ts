/**
 * The analysis of a snapshot: the components its files make up and the references between them (decision
 * record 0043).
 *
 * A snapshot is analysed from the files it holds, never from the source: the files of a snapshot do not change,
 * so the same snapshot can be analysed again by a later version of the engine, and a snapshot that was just
 * taken is analysed in the same way as one that was taken long ago.
 *
 * The analysis belongs to the snapshot and is not part of its reading. Whether a snapshot is `complete` or
 * `partial` says what was read. Whether its analysis is complete is said by the analysis.
 */
import { EngineError, isEngineError } from '../core/errors.ts';
import { engineVersion } from '../core/version.ts';
import { analyseSource } from '../extraction/analyse.ts';
import type { AnalysisIssue } from '../extraction/analysed.ts';
import { resolveComponents } from '../sources/resolve.ts';
import { pathDetails } from '../sources/tree.ts';
import { readAnalysis, readOriginCoverage, writeAnalysis } from '../store/analysis.ts';
import type { Store } from '../store/open.ts';
import { snapshotTree, type StoredIssue } from '../store/snapshots.ts';

/** What the analyser of one origin of references looked at and found in a snapshot. */
export interface OriginReport {
  /** Where its references come from, such as `parser:xml` or `parser:formula`. */
  readonly origin: string;
  /** Components the analyser looked at. For `parser:formula`: the components that hold a formula. */
  readonly components: number;
  /**
   * Files the analyser tried to read and could not. For `parser:formula`: the files with a formula that was
   * not read as a whole. The names of such a formula are recorded all the same, as `probable`.
   */
  readonly failedFiles: number;
  /** References it found. */
  readonly references: number;
  /** How many of them name a target that was not found. */
  readonly unresolved: number;
  /** Paths of names it could not walk to their end. What stands behind the point where it stopped has no reference. */
  readonly pathsNotFollowed: number;
}

/** The analysis a snapshot has. */
export interface AnalysisReport {
  /** The version of the engine that analysed the snapshot. */
  readonly engineVersion: string;
  readonly analysedAt: string;
  /** The components of the snapshot, with the parts the analysis found inside files and the objects it only names. */
  readonly components: number;
  readonly references: number;
  /**
   * False if an issue of the analysis is an error: a file of the snapshot could not be read or placed, or a
   * component could not be analysed. An answer that rests on the analysis can then miss something.
   */
  readonly complete: boolean;
  /** In the order of the reference vocabulary. */
  readonly origins: readonly OriginReport[];
}

const now = (): string => new Date().toISOString();

/**
 * Analyses a finished snapshot and stores the result. An analysis the snapshot had before is replaced.
 *
 * A file that cannot be read or understood costs that file, and an issue says so. What this throws is a failure
 * of the analysis as a whole: the database, or a fault of the engine. The snapshot is not changed by either.
 */
async function analyseSnapshot(
  store: Store,
  snapshot: { readonly id: number; readonly kind: 'org' | 'sandbox' | 'git' },
): Promise<void> {
  const tree = snapshotTree(store, snapshot.id);
  // The files of an org are stored as Salesforce lays them out, wherever the command ran. Those of a repository
  // are laid out as its project says, and are resolved as they were when the snapshot was taken.
  const resolution = await resolveComponents(tree, [''], snapshot.kind === 'git' ? undefined : null);
  const analysis = analyseSource(tree, resolution.components);

  const issues: AnalysisIssue[] = [];
  for (const problem of resolution.problems) {
    issues.push({
      severity: 'error',
      code: 'RESOLVE_FAILED',
      message: `${problem.at} could not be read as metadata: ${problem.message}`,
      componentKey: null,
      details: { at: problem.at },
    });
  }
  // Every file of a snapshot belonged to a component when it was stored. One that belongs to none now would be
  // left out without a word.
  if (resolution.unresolved.length > 0) {
    const count = resolution.unresolved.length;
    issues.push({
      severity: 'error',
      code: 'FILES_NOT_PLACED',
      message: `${String(count)} ${count === 1 ? 'file of the snapshot belongs' : 'files of the snapshot belong'} to no metadata component as this version of OrgLens reads them, and ${count === 1 ? 'was' : 'were'} not analysed. The first: ${resolution.unresolved[0] ?? ''}`,
      componentKey: null,
      details: pathDetails(resolution.unresolved),
    });
  }
  for (const issue of analysis.issues) issues.push(issue);

  writeAnalysis(store, snapshot.id, {
    engineVersion: engineVersion(),
    analysedAt: now(),
    components: analysis.components,
    work: analysis.work,
    issues,
  });
}

/**
 * Analyses a snapshot that is stored. If the analysis fails as a whole, the error says that the snapshot is
 * there and how the analysis is tried again.
 */
export async function analyseStored(
  store: Store,
  source: string,
  snapshot: { readonly id: number; readonly kind: 'org' | 'sandbox' | 'git' },
): Promise<void> {
  try {
    await analyseSnapshot(store, snapshot);
  } catch (error) {
    const known = isEngineError(error) ? error : undefined;
    const said = known?.message ?? (error instanceof Error ? error.message : String(error));
    const again = `Analyse it with: orglens analyse ${source} --snapshot ${String(snapshot.id)}`;
    throw new EngineError(
      known?.code ?? 'INTERNAL',
      `Snapshot #${String(snapshot.id)} of the source "${source}" is stored, and its analysis failed. ${said}`,
      {
        hint: known?.hint === undefined ? again : `${known.hint} ${again}`,
        details: { ...known?.details, source, snapshot: snapshot.id },
        cause: error,
      },
    );
  }
}

/** The analysis of a snapshot, or `null` for a snapshot that was not analysed. `issues` are those of the snapshot. */
export function analysisReport(
  store: Store,
  snapshotId: number,
  issues: readonly StoredIssue[],
): AnalysisReport | null {
  const analysis = readAnalysis(store, snapshotId);
  if (analysis === undefined) return null;
  const ofAnalysis = issues.filter((issue) => issue.stage === 'analysis');
  const notFollowed = new Map<string, number>();
  for (const issue of ofAnalysis) {
    const origin = issue.details?.['origin'];
    if (issue.code === 'PATH_NOT_FOLLOWED' && typeof origin === 'string') {
      notFollowed.set(origin, (notFollowed.get(origin) ?? 0) + 1);
    }
  }
  return {
    engineVersion: analysis.engineVersion,
    analysedAt: analysis.analysedAt,
    components: analysis.components,
    references: analysis.references,
    complete: !ofAnalysis.some((issue) => issue.severity === 'error'),
    origins: readOriginCoverage(store, snapshotId).map((one) => ({
      origin: one.origin,
      components: one.components,
      failedFiles: one.failedFiles,
      references: one.references,
      unresolved: one.unresolved,
      pathsNotFollowed: notFollowed.get(one.origin) ?? 0,
    })),
  };
}
