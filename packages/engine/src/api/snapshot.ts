/**
 * Taking a snapshot of a source, and reporting what a snapshot covers.
 *
 * A snapshot of a Git source is written in one transaction: it is in the
 * database with all its files, or not at all. A reading that could not get
 * everything is stored as `partial`, with an issue for each thing that is
 * missing, so that an incomplete picture is never taken for a complete one.
 */
import type { SourceDeclaration } from '../core/config/config.ts';
import { EngineError, type JsonValue } from '../core/errors.ts';
import { engineVersion } from '../core/version.ts';
import { readLocalSource } from '../sources/local.ts';
import { byCodeUnit, pathDetails, systemCode } from '../sources/tree.ts';
import type { Store } from '../store/open.ts';
import {
  addCoverage,
  addIssue,
  addSnapshotFile,
  ensureSource,
  finishSnapshot,
  insertSnapshot,
  readCoverage,
  readIssues,
  readSnapshot,
  type SnapshotIssue as StoredIssue,
} from '../store/snapshots.ts';

export interface SnapshotInfo {
  readonly id: number;
  /** The name of the source. */
  readonly source: string;
  readonly kind: 'org' | 'sandbox' | 'git';
  /**
   * - `complete`: everything the source holds was read.
   * - `partial`: something is missing. The issues of severity `error` say what.
   * - `running`, `failed`: a snapshot of an org that has not ended, or that ended without a result.
   */
  readonly status: 'running' | 'complete' | 'partial' | 'failed';
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** The version of the engine that took it. */
  readonly engineVersion: string;
  /** The commit whose content a snapshot of a Git source holds, if it holds exactly that. */
  readonly commit: string | null;
  readonly files: number;
  /** The size of the files together, in bytes. */
  readonly bytes: number;
}

export interface TypeCoverage {
  /** The metadata type, as Salesforce names it. */
  readonly type: string;
  /** How many components of the type the source says it has. */
  readonly listed: number;
  /** How many of them are in the snapshot with all their files. */
  readonly retrieved: number;
  /** How many of them were analysed. */
  readonly analysed: number;
  readonly note: string | null;
}

export interface SnapshotIssue {
  readonly severity: 'error' | 'warning' | 'info';
  /** A stable code in upper case. */
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, JsonValue>>;
}

/** What a snapshot holds, per metadata type, and everything that was observed while it was taken. */
export interface CoverageReport {
  readonly snapshot: SnapshotInfo;
  /** Sorted by type. */
  readonly types: readonly TypeCoverage[];
  readonly issues: readonly SnapshotIssue[];
}

function report(store: Store, source: string, id?: number): CoverageReport | undefined {
  const snapshot = readSnapshot(store, source, id);
  if (snapshot === undefined) return undefined;
  return {
    snapshot: {
      id: snapshot.id,
      source: snapshot.source,
      kind: snapshot.kind,
      status: snapshot.status,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      engineVersion: snapshot.engineVersion,
      commit: snapshot.gitCommit,
      files: snapshot.files,
      bytes: snapshot.bytes,
    },
    types: readCoverage(store, snapshot.id),
    issues: readIssues(store, snapshot.id).map(({ severity, code, message, details }) => ({
      severity,
      code,
      message,
      details: details ?? {},
    })),
  };
}

/** The error for a source without a snapshot, or without the snapshot that was asked for. */
export function noSnapshot(source: string, id?: number): EngineError {
  return new EngineError(
    'SNAPSHOT_NOT_FOUND',
    id === undefined
      ? `There is no snapshot of the source "${source}" yet.`
      : `The source "${source}" has no snapshot ${String(id)}.`,
    {
      hint:
        id === undefined
          ? `Take one with: orglens snapshot ${source}`
          : 'The latest snapshot of each source is shown by: orglens status',
      details: { source, snapshot: id ?? null },
    },
  );
}

/** The coverage of the latest snapshot of a source, or of the one with the given id. */
export function coverageOf(store: Store, source: string, id?: number): CoverageReport {
  const found = report(store, source, id);
  if (found === undefined) throw noSnapshot(source, id);
  return found;
}

const now = (): string => new Date().toISOString();

/**
 * Reads a source and stores what was read as a new snapshot.
 *
 * `openStore` is called once the source has been read, so a source that
 * cannot be read leaves the database as it was.
 */
export async function takeSnapshot(
  workspaceRoot: string,
  source: SourceDeclaration,
  openStore: () => Store,
): Promise<CoverageReport> {
  if (source.kind !== 'git') {
    throw new EngineError(
      'SOURCE_READ_FAILED',
      `This version of OrgLens cannot read a source of the kind "${source.kind}" yet.`,
      {
        hint: 'Snapshots of repository folders work. Snapshots of orgs and sandboxes are being built.',
        details: { reason: 'KIND_NOT_READABLE', source: source.name, kind: source.kind },
      },
    );
  }
  const startedAt = now();
  const reading = await readLocalSource(workspaceRoot, source);

  const store = openStore();
  try {
    const id = store.write(() => {
      const sourceId = ensureSource(store, { name: source.name, kind: source.kind, createdAt: startedAt });
      const snapshotId = insertSnapshot(store, {
        sourceId,
        // Set for good below, in the same transaction.
        status: 'running',
        startedAt,
        finishedAt: null,
        engineVersion: engineVersion(),
        gitCommit: null,
      });

      const issues: StoredIssue[] = reading.issues.map((issue) => ({
        ...issue,
        componentKey: null,
        details: issue.details ?? null,
      }));
      const unreadable = new Set<string>();
      const changed: string[] = [];
      for (const path of reading.tree.files) {
        try {
          const content = reading.tree.read(path);
          // The file was compared with the commit earlier and is read again here. What is stored decides.
          if (reading.holds?.(path, content) === false) changed.push(path);
          addSnapshotFile(store, snapshotId, path, content);
        } catch (error) {
          // A file that was listed and cannot be read: it was deleted in the meantime, or may not be read.
          if (error instanceof EngineError) throw error;
          unreadable.add(path);
          const reason = systemCode(error);
          issues.push({
            severity: 'error',
            code: 'FILE_UNREADABLE',
            // The message of the system names the file by its path on this machine, so only its code is kept.
            message: `${path} could not be read${reason === null ? '' : ` (${reason})`}.`,
            componentKey: null,
            details: { path, reason },
          });
        }
      }

      // Folders that named a commit hold it only if every file that was stored is still the file of the commit.
      const moved = reading.holds !== null && (changed.length > 0 || unreadable.size > 0);
      if (moved) {
        const count = changed.length + unreadable.size;
        issues.push({
          severity: 'info',
          code: 'CHANGED_WHILE_READ',
          message: `The snapshot names no commit: ${String(count)} ${count === 1 ? 'file was' : 'files were'} changed or removed while the snapshot was taken.`,
          componentKey: null,
          details: pathDetails([...changed, ...unreadable].sort(byCodeUnit)),
        });
      }

      const types = new Map<string, { listed: number; retrieved: number }>();
      for (const component of reading.components) {
        const count = types.get(component.type) ?? { listed: 0, retrieved: 0 };
        types.set(component.type, count);
        count.listed += 1;
        if (!component.files.some((file) => unreadable.has(file))) count.retrieved += 1;
      }
      for (const [type, count] of types) {
        addCoverage(store, snapshotId, { type, ...count, analysed: 0, note: null });
      }
      for (const issue of issues) addIssue(store, snapshotId, issue);

      const complete = !issues.some((issue) => issue.severity === 'error');
      finishSnapshot(store, snapshotId, {
        status: complete ? 'complete' : 'partial',
        finishedAt: now(),
        gitCommit: moved ? null : reading.commit,
      });
      return snapshotId;
    });
    // A snapshot is a large write. The log is moved into the database file now, not by a later reader.
    store.checkpoint();
    const taken = report(store, source.name, id);
    if (taken === undefined) throw new EngineError('INTERNAL', 'The snapshot was stored and cannot be found.');
    return taken;
  } finally {
    store.close();
  }
}
