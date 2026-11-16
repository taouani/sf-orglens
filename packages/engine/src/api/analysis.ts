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
import { EngineError } from '../core/errors.ts';
import { engineVersion } from '../core/version.ts';
import { analyseSource } from '../extraction/analyse.ts';
import type { AnalysisIssue } from '../extraction/analysed.ts';
import type { ProjectLayout } from '../sources/project.ts';
import { resolveComponents } from '../sources/resolve.ts';
import { pathDetails } from '../sources/tree.ts';
import { readAnalysis, readOriginCoverage, writeAnalysis } from '../store/analysis.ts';
import type { Store } from '../store/open.ts';
import { snapshotTree, type StoredIssue } from '../store/snapshots.ts';
import { asEngineError } from './boundary.ts';

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

/** A snapshot as the analysis needs it: its number, and the layout its files were read with. */
interface Analysable {
  readonly id: number;
  /** `null` for a snapshot of an org, whose files are stored as Salesforce lays them out. */
  readonly layout: ProjectLayout | null;
}

/**
 * Analyses a finished snapshot and stores the result. An analysis the snapshot had before is replaced.
 *
 * A file that cannot be read or understood costs that file, and an issue says so. What this throws is a failure
 * of the analysis as a whole: the database, or a fault of the engine. The snapshot is not changed by either.
 */
async function analyseSnapshot(store: Store, snapshot: Analysable): Promise<void> {
  const tree = snapshotTree(store, snapshot.id);
  // The files are placed with the layout the snapshot keeps: the one its source had when it was read. Neither
  // the folder the command runs in nor the source as it is today plays a part.
  const resolution = await resolveComponents(tree, [''], snapshot.layout);
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
  // Every file of a snapshot was stored as a file of a component. One that belongs to none now would be left
  // out without a word. It is a file whose component lost another file while the source was read, such as a
  // class whose -meta.xml file went away, or a file that another version of the library places differently.
  if (resolution.unresolved.length > 0) {
    const count = resolution.unresolved.length;
    issues.push({
      severity: 'error',
      code: 'FILES_NOT_PLACED',
      message: `${String(count)} ${count === 1 ? 'file of the snapshot belongs' : 'files of the snapshot belong'} to no metadata component, and ${count === 1 ? 'was' : 'were'} not analysed. A file of ${count === 1 ? 'its' : 'their'} component is missing from the snapshot, or this version of OrgLens places ${count === 1 ? 'it' : 'them'} differently. The first: ${resolution.unresolved[0] ?? ''}`,
      componentKey: null,
      details: pathDetails(resolution.unresolved),
    });
  }
  for (const issue of analysis.issues) issues.push(issue);

  writeAnalysis(store, snapshot.id, {
    engineVersion: engineVersion(),
    analysedAt: now(),
    types: analysis.types,
    components: analysis.components,
    work: analysis.work,
    issues,
  });
}

/** The errors that say that the analysis of a stored snapshot failed as a whole. */
const analysisFailures = new WeakSet<EngineError>();

/** Whether an error says that a snapshot is stored and that its analysis failed as a whole. */
export const isAnalysisFailure = (error: unknown): error is EngineError =>
  error instanceof EngineError && analysisFailures.has(error);

/**
 * Analyses a snapshot that is stored. If the analysis fails as a whole, the error says that the snapshot is
 * there and how the analysis is tried again.
 */
export async function analyseStored(store: Store, source: string, snapshot: Analysable): Promise<void> {
  try {
    await analyseSnapshot(store, snapshot);
  } catch (error) {
    // The same error as the one that would leave the engine for it: with its code, and with a message of
    // another program redacted.
    const known = asEngineError(error);
    const again = `Analyse it with: orglens analyse ${source} --snapshot ${String(snapshot.id)}`;
    const failure = new EngineError(
      known.code,
      `Snapshot #${String(snapshot.id)} of the source "${source}" is stored, and its analysis failed. ${known.message}`,
      {
        hint: known.hint === undefined ? again : `${known.hint} ${again}`,
        details: { ...known.details, source, snapshot: snapshot.id },
        cause: error,
      },
    );
    analysisFailures.add(failure);
    throw failure;
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
