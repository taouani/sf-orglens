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

type SourceKind = 'org' | 'sandbox' | 'git';
export type SnapshotStatus = 'running' | 'complete' | 'partial' | 'failed';
type IssueSeverity = 'error' | 'warning' | 'info';

interface DeclaredSource {
  readonly name: string;
  readonly kind: SourceKind;
  /** The id of the org, as the org states it. Not set for a Git source. */
  readonly orgId?: string | undefined;
}

/**
 * Refuses a source whose name the database knows as something else, and
 * returns its row if it has one. Nothing is written.
 *
 * The name is what ties snapshots together. A name that was used for a
 * source of another kind is refused: its snapshots would be compared with
 * the new ones as if they were readings of the same thing. For the same
 * reason, a name whose snapshots are of one org is refused for another org.
 */
export function checkSource(store: Store, source: DeclaredSource): { id: number; orgId: string | null } | undefined {
  const row = store.get('SELECT id, kind, org_id FROM source WHERE name = ?', source.name);
  if (row === undefined) return undefined;
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
  const orgId = typeof row['org_id'] === 'string' ? row['org_id'] : null;
  if (source.orgId !== undefined && orgId !== null && orgId !== source.orgId) {
    throw new EngineError(
      'ORG_MISMATCH',
      `The database holds snapshots of the source "${source.name}" from the org ${orgId}, and the login belongs to the org ${source.orgId}.`,
      {
        hint: 'Snapshots of two orgs under one name would be compared as if they were one org. Give the other org a source of its own in orglens.toml.',
        details: { source: source.name, declared: orgId, found: source.orgId },
      },
    );
  }
  return { id: Number(row['id']), orgId };
}

/**
 * The row of a declared source, created if this is its first snapshot. The
 * first snapshot of an org sets which org the name stands for.
 */
export function ensureSource(store: Store, source: DeclaredSource & { readonly createdAt: string }): number {
  const row = checkSource(store, source);
  if (row === undefined) {
    return store.run(
      'INSERT INTO source (name, kind, org_id, created_at) VALUES (?, ?, ?, ?)',
      source.name,
      source.kind,
      source.orgId ?? null,
      source.createdAt,
    ).lastInsertRowid;
  }
  if (source.orgId !== undefined && row.orgId === null) {
    store.run('UPDATE source SET org_id = ? WHERE id = ?', source.orgId, row.id);
  }
  return row.id;
}

export interface NewSnapshot {
  readonly sourceId: number;
  readonly status: SnapshotStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly engineVersion: string;
  /** The Salesforce API version an org is read with. */
  readonly apiVersion?: string | undefined;
  readonly gitCommit: string | null;
}

export function insertSnapshot(store: Store, snapshot: NewSnapshot): number {
  return store.run(
    `INSERT INTO snapshot (source_id, status, started_at, finished_at, engine_version, api_version, git_commit)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    snapshot.sourceId,
    snapshot.status,
    snapshot.startedAt,
    snapshot.finishedAt,
    snapshot.engineVersion,
    snapshot.apiVersion ?? null,
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

/**
 * Adds one file to a snapshot that is still being taken, or replaces it.
 * Returns true if the snapshot held a file at the path already.
 */
export function putSnapshotFile(store: Store, snapshotId: number, path: string, content: Uint8Array): boolean {
  const blob = putBlob(store, content);
  const held = store.get('SELECT 1 FROM snapshot_file WHERE snapshot_id = ? AND path = ?', snapshotId, path);
  store.run(
    `INSERT INTO snapshot_file (snapshot_id, path, blob_id) VALUES (?, ?, ?)
     ON CONFLICT (snapshot_id, path) DO UPDATE SET blob_id = excluded.blob_id`,
    snapshotId,
    path,
    blob.id,
  );
  return held !== undefined;
}

export interface TypeCoverage {
  readonly type: string;
  /** How many components of the type the source says it has. */
  readonly listed: number;
  /** How many of them are in the snapshot with all their files. */
  readonly retrieved: number;
  /** How many of them were analysed. */
  readonly analysed: number;
  /**
   * - `ok`: the source said which components of the type it has.
   * - `failed`: it refused to. `listed` counts what it had said before, and the true number is not known.
   * - `unlistable`: it never lists components of this type.
   */
  readonly listing: 'ok' | 'failed' | 'unlistable';
  readonly note: string | null;
}

/** Stores the coverage of a type, or replaces it while the snapshot is still being taken. */
export function addCoverage(store: Store, snapshotId: number, coverage: TypeCoverage): void {
  store.run(
    `INSERT INTO snapshot_type_coverage (snapshot_id, type, listed, retrieved, analysed, listing, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (snapshot_id, type) DO UPDATE SET listed = excluded.listed, retrieved = excluded.retrieved,
       analysed = excluded.analysed, listing = excluded.listing, note = excluded.note`,
    snapshotId,
    coverage.type,
    coverage.listed,
    coverage.retrieved,
    coverage.analysed,
    coverage.listing,
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

const SELECT_SNAPSHOT = `SELECT n.id AS id, s.name AS source, s.kind AS kind, n.status AS status,
            n.started_at AS started_at, n.finished_at AS finished_at, n.engine_version AS engine_version,
            n.api_version AS api_version, n.git_commit AS git_commit,
            (SELECT COUNT(*) FROM snapshot_file f WHERE f.snapshot_id = n.id) AS files,
            (SELECT COALESCE(SUM(b.raw_size), 0) FROM snapshot_file f JOIN blob b ON b.id = f.blob_id
              WHERE f.snapshot_id = n.id) AS bytes
       FROM snapshot n JOIN source s ON s.id = n.source_id
      WHERE s.name = ?`;

function record(row: Readonly<Record<string, unknown>>): SnapshotRecord {
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

/**
 * A snapshot of a source: the one with the given id, or the latest one
 * that was finished. One that is still being taken, or that was given up,
 * is not the latest: it is found by its id only. Returns `undefined` if
 * the source has no such snapshot.
 */
export function readSnapshot(store: Store, source: string, id?: number): SnapshotRecord | undefined {
  const row =
    id === undefined
      ? store.get(`${SELECT_SNAPSHOT} AND n.status IN ('complete', 'partial') ORDER BY n.id DESC LIMIT 1`, source)
      : store.get(`${SELECT_SNAPSHOT} AND n.id = ?`, source, id);
  return row === undefined ? undefined : record(row);
}

/** The snapshot of a source that is being taken, or that was interrupted. There is at most one. */
export function readRunningSnapshot(store: Store, source: string): SnapshotRecord | undefined {
  const row = store.get(`${SELECT_SNAPSHOT} AND n.status = 'running'`, source);
  return row === undefined ? undefined : record(row);
}

/** The coverage of a snapshot, sorted by type. */
export function readCoverage(store: Store, snapshotId: number): TypeCoverage[] {
  return store
    .all(
      'SELECT type, listed, retrieved, analysed, listing, note FROM snapshot_type_coverage WHERE snapshot_id = ? ORDER BY type',
      snapshotId,
    )
    .map((row) => ({
      type: String(row['type']),
      listed: Number(row['listed']),
      retrieved: Number(row['retrieved']),
      analysed: Number(row['analysed']),
      listing: String(row['listing']) as TypeCoverage['listing'],
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
