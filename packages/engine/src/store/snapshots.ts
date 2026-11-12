/**
 * Writing and reading snapshots: the files of one reading of a source, how
 * much of each metadata type it holds, and what went wrong.
 *
 * A snapshot is never changed after it is finished. Its files are blobs
 * shared with every other snapshot that holds the same content.
 */
import { EngineError, type JsonValue } from '../core/errors.ts';
import { putBlob } from './blobs.ts';
import type { Store } from './open.ts';

export type SourceKind = 'org' | 'sandbox' | 'git';
export type SnapshotStatus = 'running' | 'complete' | 'partial' | 'failed';
type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * The row of a declared source, created if this is its first snapshot.
 *
 * The name is what ties snapshots together. A name that was used for a
 * source of another kind is refused: its snapshots would be compared with
 * the new ones as if they were readings of the same thing.
 */
export function ensureSource(store: Store, source: { name: string; kind: SourceKind; createdAt: string }): number {
  const row = store.get('SELECT id, kind FROM source WHERE name = ?', source.name);
  if (row === undefined) {
    return store.run(
      'INSERT INTO source (name, kind, created_at) VALUES (?, ?, ?)',
      source.name,
      source.kind,
      source.createdAt,
    ).lastInsertRowid;
  }
  if (row['kind'] !== source.kind) {
    throw new EngineError(
      'SOURCE_INVALID',
      `The database holds snapshots of a source "${source.name}" of the kind "${String(row['kind'])}".`,
      {
        hint: `Give the ${source.kind} source another name in orglens.toml.`,
        details: { source: source.name, problems: [] },
      },
    );
  }
  return Number(row['id']);
}

export interface NewSnapshot {
  readonly sourceId: number;
  readonly status: SnapshotStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly engineVersion: string;
  readonly gitCommit: string | null;
}

export function insertSnapshot(store: Store, snapshot: NewSnapshot): number {
  return store.run(
    `INSERT INTO snapshot (source_id, status, started_at, finished_at, engine_version, git_commit)
     VALUES (?, ?, ?, ?, ?, ?)`,
    snapshot.sourceId,
    snapshot.status,
    snapshot.startedAt,
    snapshot.finishedAt,
    snapshot.engineVersion,
    snapshot.gitCommit,
  ).lastInsertRowid;
}

/**
 * Sets how a snapshot ended, and the commit it holds. Whether it holds
 * exactly one commit is known only once its files are stored.
 */
export function finishSnapshot(
  store: Store,
  id: number,
  end: { readonly status: SnapshotStatus; readonly finishedAt: string; readonly gitCommit: string | null },
): void {
  store.run(
    'UPDATE snapshot SET status = ?, finished_at = ?, git_commit = ? WHERE id = ?',
    end.status,
    end.finishedAt,
    end.gitCommit,
    id,
  );
}

/** Adds one file to a snapshot. The path is the one inside the source, with forward slashes. */
export function addSnapshotFile(store: Store, snapshotId: number, path: string, content: Uint8Array): void {
  const blob = putBlob(store, content);
  store.run('INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (?, ?, ?)', snapshotId, path, blob.id);
}

export interface TypeCoverage {
  readonly type: string;
  /** How many components of the type the source says it has. */
  readonly listed: number;
  /** How many of them are in the snapshot with all their files. */
  readonly retrieved: number;
  /** How many of them were analysed. */
  readonly analysed: number;
  readonly note: string | null;
}

export function addCoverage(store: Store, snapshotId: number, coverage: TypeCoverage): void {
  store.run(
    'INSERT INTO snapshot_type_coverage (snapshot_id, type, listed, retrieved, analysed, note) VALUES (?, ?, ?, ?, ?, ?)',
    snapshotId,
    coverage.type,
    coverage.listed,
    coverage.retrieved,
    coverage.analysed,
    coverage.note,
  );
}

export interface SnapshotIssue {
  readonly severity: IssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly componentKey: string | null;
  readonly details: Readonly<Record<string, JsonValue>> | null;
}

export function addIssue(store: Store, snapshotId: number, issue: SnapshotIssue): void {
  store.run(
    'INSERT INTO snapshot_issue (snapshot_id, severity, code, component_key, message, details) VALUES (?, ?, ?, ?, ?, ?)',
    snapshotId,
    issue.severity,
    issue.code,
    issue.componentKey,
    issue.message,
    issue.details === null ? null : JSON.stringify(issue.details),
  );
}

export interface SnapshotRecord {
  readonly id: number;
  readonly source: string;
  readonly kind: SourceKind;
  readonly status: SnapshotStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly engineVersion: string;
  readonly apiVersion: string | null;
  readonly gitCommit: string | null;
  /** The number of files, and the sum of their sizes in bytes. */
  readonly files: number;
  readonly bytes: number;
}

/** The value of a text column that may be empty. */
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * A snapshot of a source: the one with the given id, or the latest. Returns
 * `undefined` if the source has no snapshot, or none with that id.
 */
export function readSnapshot(store: Store, source: string, id?: number): SnapshotRecord | undefined {
  const select = `SELECT n.id AS id, s.name AS source, s.kind AS kind, n.status AS status, n.started_at AS started_at,
            n.finished_at AS finished_at, n.engine_version AS engine_version, n.api_version AS api_version,
            n.git_commit AS git_commit,
            (SELECT COUNT(*) FROM snapshot_file f WHERE f.snapshot_id = n.id) AS files,
            (SELECT COALESCE(SUM(b.raw_size), 0) FROM snapshot_file f JOIN blob b ON b.id = f.blob_id
              WHERE f.snapshot_id = n.id) AS bytes
       FROM snapshot n JOIN source s ON s.id = n.source_id
      WHERE s.name = ?`;
  const row =
    id === undefined
      ? store.get(`${select} ORDER BY n.id DESC LIMIT 1`, source)
      : store.get(`${select} AND n.id = ?`, source, id);
  if (row === undefined) return undefined;
  return {
    id: Number(row['id']),
    source: String(row['source']),
    kind: String(row['kind']) as SourceKind,
    status: String(row['status']) as SnapshotStatus,
    startedAt: String(row['started_at']),
    finishedAt: text(row['finished_at']),
    engineVersion: String(row['engine_version']),
    apiVersion: text(row['api_version']),
    gitCommit: text(row['git_commit']),
    files: Number(row['files']),
    bytes: Number(row['bytes']),
  };
}

/** The coverage of a snapshot, sorted by type. */
export function readCoverage(store: Store, snapshotId: number): TypeCoverage[] {
  return store
    .all(
      'SELECT type, listed, retrieved, analysed, note FROM snapshot_type_coverage WHERE snapshot_id = ? ORDER BY type',
      snapshotId,
    )
    .map((row) => ({
      type: String(row['type']),
      listed: Number(row['listed']),
      retrieved: Number(row['retrieved']),
      analysed: Number(row['analysed']),
      note: text(row['note']),
    }));
}

/** The issues of a snapshot, in the order they were recorded. */
export function readIssues(store: Store, snapshotId: number): SnapshotIssue[] {
  return store
    .all(
      'SELECT severity, code, component_key, message, details FROM snapshot_issue WHERE snapshot_id = ? ORDER BY id',
      snapshotId,
    )
    .map((row) => ({
      severity: String(row['severity']) as IssueSeverity,
      code: String(row['code']),
      message: String(row['message']),
      componentKey: text(row['component_key']),
      details: typeof row['details'] === 'string' ? (JSON.parse(row['details']) as Record<string, JsonValue>) : null,
    }));
}
