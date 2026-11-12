/**
 * Taking a snapshot of an org or a sandbox.
 *
 * The org is asked what it holds (the inventory), the components are
 * retrieved by name in chunks, and the files of each chunk are stored as
 * soon as they arrive. The database says at every moment how far the
 * snapshot is: a snapshot that was interrupted, by a closed laptop or a
 * network that went away, is picked up by the next run where it stopped.
 *
 * The snapshot is measured against the inventory. Whatever the org listed
 * and did not hand out, and every type it refused to list, is an issue of
 * severity `error`, and the snapshot is `partial`.
 *
 * Only metadata is read. Nothing here queries records.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { OrgSource, SandboxSource } from '../core/config/config.ts';
import { EngineError, isEngineError, type JsonValue } from '../core/errors.ts';
import { engineVersion } from '../core/version.ts';
import { DEFAULT_CHUNK_WEIGHT, planChunks, splitMembers } from '../sources/chunks.ts';
import { takeInventory } from '../sources/inventory.ts';
import {
  DEFAULT_LIMITS,
  isAboutTheOrg,
  metadataApi,
  MetadataRequestError,
  type MetadataApi,
  type MetadataApiLimits,
  type RetrieveState,
} from '../sources/metadata-api.ts';
import { loginFailed, saidBy, unreachable } from '../sources/org-errors.ts';
import { connectToOrg } from '../sources/org.ts';
import { unpackRetrieve, type Unpacked } from '../sources/retrieved.ts';
import { systemCode } from '../sources/tree.ts';
import {
  addChunks,
  addInventory,
  chunkEnded,
  chunkForgotten,
  chunkStarted,
  countChunks,
  countInventory,
  markRetrieved,
  missingComponents,
  nextChunk,
  refreshCoverage,
  splitChunk,
  unlistedComponents,
  type Chunk,
} from '../store/journal.ts';
import type { Store } from '../store/open.ts';
import {
  addCoverage,
  addIssue,
  checkSource,
  ensureSource,
  finishSnapshot,
  insertSnapshot,
  putSnapshotFile,
  readCoverage,
  readIssues,
  readRunningSnapshot,
} from '../store/snapshots.ts';
import type { WorkspacePaths } from './layout.ts';
import { snapshotReport, type CoverageReport } from './snapshot.ts';

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * What a snapshot of an org is doing, told while it is taken.
 *
 * - `connected`: the login worked. `apiVersion` is the version the org is read with.
 * - `listing`: the org is asked what it holds. `done` of `total` requests are answered. `total` grows while
 *   folders are found.
 * - `planned`: the inventory is stored. The snapshot has a number and a number of chunks to retrieve.
 * - `resumed`: a snapshot that was interrupted is continued. `done` of its `chunks` are stored already.
 * - `retrieved`: a chunk is stored. `chunks` grows when a chunk has to be split.
 */
export type SnapshotProgress =
  | { readonly step: 'connected'; readonly apiVersion: string }
  | { readonly step: 'listing'; readonly done: number; readonly total: number }
  | { readonly step: 'planned'; readonly snapshot: number; readonly components: number; readonly chunks: number }
  | { readonly step: 'resumed'; readonly snapshot: number; readonly done: number; readonly chunks: number }
  | { readonly step: 'retrieved'; readonly snapshot: number; readonly done: number; readonly chunks: number };

/** The numbers a snapshot of an org works with. A test sets them to make things happen that are rare. */
export interface OrgSnapshotTuning {
  /** The weight a chunk is filled up to (`sources/chunks.ts`). */
  readonly chunkWeight: number;
  /** The pause before the state of a retrieve is asked for the first time. It doubles up to `pollMaxMs`. */
  readonly pollFirstMs: number;
  readonly pollMaxMs: number;
  /** How long this process waits for one retrieve to end. */
  readonly jobMs: number;
  /** After this many retrieves in a row that failed, the snapshot stops and can be resumed. */
  readonly failuresInARow: number;
  /**
   * How often a retrieve is started in all, when its job gives no result: Salesforce no longer knows it, or it
   * never ends. Also how often the start of a retrieve is asked for when the org refuses it, with a pause of
   * `pollMaxMs` in between.
   */
  readonly startsPerChunk: number;
  readonly requests: MetadataApiLimits;
}

const DEFAULT_TUNING: OrgSnapshotTuning = {
  chunkWeight: DEFAULT_CHUNK_WEIGHT,
  pollFirstMs: 250,
  pollMaxMs: 5_000,
  jobMs: 30 * 60_000,
  // Halving a chunk of 3,000 members down to the one that fails takes 12 failures in a row.
  failuresInARow: 20,
  startsPerChunk: 3,
  requests: DEFAULT_LIMITS,
};

export interface OrgSnapshotJob {
  readonly paths: WorkspacePaths;
  readonly source: OrgSource | SandboxSource;
  /** The login the personal file names for the source, if it names one. */
  readonly linked: string | undefined;
  readonly env: Environment;
  /** Called once the org has accepted the login, so that a login that fails leaves the database as it was. */
  readonly openStore: () => Store;
  /** True to give up a snapshot that was interrupted and start a new one. */
  readonly restart?: boolean | undefined;
  readonly onProgress?: ((event: SnapshotProgress) => void) | undefined;
  readonly tuning?: Partial<OrgSnapshotTuning> | undefined;
}

/**
 * Types whose components hold the access to other components. Salesforce
 * hands out such a component with the access to the components of the same
 * retrieve only, so what a chunked retrieve gets of it is a part.
 */
const ACCESS_TYPES: ReadonlySet<string> = new Set(['Profile', 'PermissionSet']);
const ACCESS_NOTE = 'Holds only a part of the access settings.';

/** At most this many names or messages are listed in the details of one issue. The count is always exact. */
const NAMES_PER_ISSUE = 50;

const now = (): string => new Date().toISOString();
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;
const minutes = (ms: number): string => plural(Math.round(ms / 60_000), 'minute', 'minutes');

/** The locks this process holds. A second snapshot of a source in the same process is refused like one of another process. */
const heldHere = new Set<string>();

function alreadyRunning(source: string, file: string): EngineError {
  return new EngineError('SNAPSHOT_RUNNING', `Another process is taking a snapshot of the source "${source}".`, {
    hint: `Wait for it to end. If no other OrgLens command is running, delete ${file}.`,
    details: { source },
  });
}

/** True if a process with this id exists on this machine. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process exists and belongs to another user.
    return systemCode(error) === 'EPERM';
  }
}

/**
 * Takes the lock of a source: a file with the id of this process. A file
 * left by a process that no longer exists is taken over.
 *
 * Looking at the file and writing it happen inside a write transaction of
 * the database, which only one process can be in. So two processes that
 * find the lock of a dead process cannot both take it.
 */
function holdLock(store: Store, file: string, source: string): () => void {
  // One workspace can be reached by two paths, through a link. The lock is one.
  const id = join(realpathSync(dirname(file)), basename(file));
  if (heldHere.has(id)) throw alreadyRunning(source, file);
  store.write(() => {
    let holder: string | null = null;
    try {
      holder = readFileSync(file, 'utf8').trim();
    } catch (error) {
      if (systemCode(error) !== 'ENOENT') throw error;
    }
    if (holder !== null && /^[1-9][0-9]*$/.test(holder) && Number(holder) !== process.pid && isAlive(Number(holder))) {
      throw alreadyRunning(source, file);
    }
    writeFileSync(file, `${String(process.pid)}\n`);
  });
  heldHere.add(id);
  return () => {
    heldHere.delete(id);
    // Only the lock of this process is removed. If the file was deleted by hand and another process has taken
    // the lock since, the file is the lock of that process.
    let holder: string | null = null;
    try {
      holder = readFileSync(file, 'utf8').trim();
    } catch {
      // The file is gone, or cannot be read: there is nothing of this process to remove.
    }
    if (holder === String(process.pid)) rmSync(file, { force: true });
  };
}

/** What Salesforce said about a retrieve that failed, in one line. */
function saidAbout(state: RetrieveState): string {
  const code = state.errorCode ?? 'UNKNOWN';
  if (state.errorMessage === null) return code;
  return state.errorMessage.startsWith(code) ? state.errorMessage : `${code}: ${state.errorMessage}`;
}

/**
 * True if the org answered a request with a refusal that is about what was asked for, not about the org as a
 * whole. The snapshot goes on with its other requests.
 */
const isRefusal = (error: unknown): error is MetadataRequestError =>
  error instanceof MetadataRequestError && error.kind === 'refused' && !isAboutTheOrg(error);

/** What the org said when it refused, with its code. */
const saidIn = (error: MetadataRequestError): string =>
  `${error.code === null ? '' : `${error.code}: `}${error.message}`;

/** True for the failure of a job that did not end in the time this process waits for one. */
const isTooSlow = (error: unknown): boolean =>
  isEngineError(error) && error.code === 'SOURCE_READ_FAILED' && error.details?.['reason'] === 'RETRIEVE_TOO_SLOW';

/** True for a failure of the file system of this machine: no permission, a full disk. It is not about the org. */
const isSystemFailure = (error: unknown): boolean => {
  const { code, syscall } = (error ?? {}) as { code?: unknown; syscall?: unknown };
  return error instanceof Error && typeof code === 'string' && typeof syscall === 'string';
};

/**
 * Turns what stopped a snapshot into the error the caller gets. With the
 * number of a snapshot that was begun, the hint says that it is resumed.
 */
function stopped(error: unknown, source: string, snapshot: number | undefined): unknown {
  let known: EngineError;
  if (isEngineError(error)) {
    known = error;
  } else if (!(error instanceof MetadataRequestError)) {
    return error;
  } else if (error.kind === 'unreachable') {
    known = unreachable(source, error.code ?? 'UNKNOWN', error);
  } else if (error.kind === 'session') {
    known = loginFailed(
      'SESSION_EXPIRED',
      source,
      `The org of the source "${source}" no longer accepts the login, and it could not be renewed.`,
      { hint: 'Log in again.', cause: error },
    );
  } else {
    known = new EngineError(
      'SOURCE_READ_FAILED',
      `The org of the source "${source}" refused a request for its metadata. ${error.code === null ? '' : `${error.code}: `}${error.message}`,
      { details: { reason: 'REQUEST_REFUSED', source, code: error.code }, cause: error },
    );
  }
  if (snapshot === undefined || known.code === 'SNAPSHOT_RUNNING') return known;
  const again = `Run the command again: snapshot #${String(snapshot)} is picked up where it stopped. With --restart it is given up and a new one is taken.`;
  return new EngineError(known.code, known.message, {
    hint: known.hint === undefined ? again : `${known.hint} ${again}`,
    details: { ...known.details, snapshot },
    cause: known.cause,
  });
}

/** Asks for the state of a retrieve until it has ended. */
async function ended(
  api: MetadataApi,
  jobId: string,
  source: string,
  tuning: OrgSnapshotTuning,
): Promise<RetrieveState> {
  const deadline = Date.now() + tuning.jobMs;
  for (let wait = tuning.pollFirstMs; ; wait = Math.min(wait * 2, tuning.pollMaxMs)) {
    await pause(wait);
    const state = await api.retrieveState(jobId, false);
    if (state.done) return state;
    if (Date.now() >= deadline) {
      throw new EngineError(
        'SOURCE_READ_FAILED',
        `A retrieve from the org of the source "${source}" did not end within ${minutes(tuning.jobMs)}.`,
        { details: { reason: 'RETRIEVE_TOO_SLOW', source } },
      );
    }
  }
}

function issue(
  store: Store,
  snapshotId: number,
  severity: 'error' | 'warning' | 'info',
  code: string,
  message: string,
  details: Readonly<Record<string, JsonValue>>,
): void {
  addIssue(store, snapshotId, { severity, code, message, componentKey: null, details });
}

const named = (names: readonly string[]): Readonly<Record<string, JsonValue>> => ({
  count: names.length,
  components: names.slice(0, NAMES_PER_ISSUE),
});

/**
 * Reads an org or a sandbox and stores what was read as a snapshot, or
 * continues the snapshot of the source that was interrupted.
 *
 * Fails with `LOGIN_FAILED`, `ORG_MISMATCH`, `SNAPSHOT_RUNNING` or
 * `SOURCE_READ_FAILED`. After a failure the snapshot stays in the database
 * as `running`, and the next call continues it.
 */
export async function takeOrgSnapshot(job: OrgSnapshotJob): Promise<CoverageReport> {
  const { source, paths } = job;
  const tuning: OrgSnapshotTuning = { ...DEFAULT_TUNING, ...job.tuning };
  const progress = job.onProgress ?? ((): void => undefined);
  const startedAt = now();

  const session = await connectToOrg(source, job.linked, job.env);
  progress({ step: 'connected', apiVersion: session.apiVersion });

  const store = job.openStore();
  const workDir = paths.temporaryDir(source.name);
  let release: (() => void) | undefined;
  let snapshotId: number | undefined;
  let api: MetadataApi | undefined;
  try {
    release = holdLock(store, paths.snapshotLockFile(source.name), source.name);
    // Whatever an earlier run left behind is of a chunk that was not stored.
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });

    const declared = { name: source.name, kind: source.kind, orgId: session.orgId };
    // The snapshot that was interrupted, if it is to be continued. One that is not is ended as failed.
    const interrupted = store.write(() => {
      checkSource(store, declared);
      const running = readRunningSnapshot(store, source.name);
      if (running === undefined) return undefined;
      const sameEngine = running.engineVersion === engineVersion();
      if (job.restart !== true && sameEngine) return running;
      issue(
        store,
        running.id,
        'info',
        'SNAPSHOT_GIVEN_UP',
        sameEngine
          ? 'The snapshot was interrupted and was given up, because a new one was asked for with --restart.'
          : `The snapshot was interrupted and was given up, because it was begun by another version of OrgLens (${running.engineVersion}).`,
        { engineVersion: running.engineVersion },
      );
      finishSnapshot(store, running.id, { status: 'failed', finishedAt: now(), gitCommit: null });
      return undefined;
    });

    if (interrupted === undefined) {
      api = await metadataApi(session.connection, session.apiVersion, tuning.requests);
      const inventory = await takeInventory(api, {
        onProgress: (done, total) => {
          progress({ step: 'listing', done, total });
        },
      });
      const chunks = planChunks(inventory, tuning.chunkWeight);
      const listed = new Map<string, number>();
      for (const item of inventory.items) listed.set(item.type, (listed.get(item.type) ?? 0) + 1);

      snapshotId = store.write(() => {
        const id = insertSnapshot(store, {
          sourceId: ensureSource(store, { ...declared, createdAt: startedAt }),
          status: 'running',
          startedAt,
          finishedAt: null,
          engineVersion: engineVersion(),
          apiVersion: session.apiVersion,
          gitCommit: null,
        });
        addInventory(
          store,
          id,
          inventory.items.map((item) => ({
            type: item.type,
            fullName: item.fullName,
            salesforceId: item.id,
            lastModifiedAt: item.lastModifiedAt,
            namespacePrefix: item.namespacePrefix,
            manageableState: item.manageableState,
          })),
        );
        for (const type of inventory.types) {
          addCoverage(store, id, {
            type: type.type,
            listed: listed.get(type.type) ?? 0,
            retrieved: 0,
            analysed: 0,
            listing: type.listing,
            note: type.reason,
          });
          if (type.listing === 'failed') {
            issue(
              store,
              id,
              'error',
              'LISTING_FAILED',
              `The org did not say which components of the type ${type.type} it has. ${type.reason ?? ''}`.trimEnd(),
              { type: type.type, code: type.code },
            );
          } else if (type.listing === 'unlistable') {
            issue(
              store,
              id,
              'warning',
              'TYPE_NOT_READ',
              `Components of the type ${type.type} are not in the snapshot. ${type.reason ?? ''}`.trimEnd(),
              { type: type.type },
            );
          }
        }
        const access = [...ACCESS_TYPES].filter((type) => (listed.get(type) ?? 0) > 0).sort();
        if (access.length > 0) {
          issue(
            store,
            id,
            'warning',
            'ACCESS_INCOMPLETE',
            `Components of the ${access.length === 1 ? 'type' : 'types'} ${access.join(' and ')} hold only a part of the access settings: Salesforce hands such a component out with the access to the components of the same retrieve, and the org is retrieved in chunks. Reading access completely is not built yet.`,
            { types: access },
          );
        }
        addChunks(store, id, chunks);
        return id;
      });
      progress({ step: 'planned', snapshot: snapshotId, components: inventory.items.length, chunks: chunks.length });
    } else {
      snapshotId = interrupted.id;
      // A snapshot is of one API version from start to end, also if the org has a newer one by now.
      api = await metadataApi(session.connection, interrupted.apiVersion ?? session.apiVersion, tuning.requests);
      const counts = countChunks(store, snapshotId);
      store.write(() => {
        issue(
          store,
          interrupted.id,
          'info',
          'SNAPSHOT_RESUMED',
          `The snapshot was interrupted and continued at ${now()}. What it holds was read from the org at more than one time.`,
          { chunksDone: counts.done + counts.failed, chunks: counts.total },
        );
      });
      progress({ step: 'resumed', snapshot: snapshotId, done: counts.done + counts.failed, chunks: counts.total });
    }

    await retrieveChunks(store, snapshotId, api, source.name, workDir, tuning, progress);
    finish(store, snapshotId);
    // A snapshot is a large write. The log is moved into the database file now, not by a later reader.
    store.checkpoint();
    const taken = snapshotReport(store, source.name, snapshotId);
    if (taken === undefined) throw new EngineError('INTERNAL', 'The snapshot was stored and cannot be found.');
    return taken;
  } catch (error) {
    throw stopped(error, source.name, snapshotId);
  } finally {
    try {
      // Requests that are still under way, such as listings beside the one that failed, end here.
      await api?.close();
    } catch {
      // The connections end with the process at the latest.
    }
    // The work folder belongs to the process that holds the lock. A command that was refused the lock leaves it
    // alone: it is the folder of the snapshot that runs.
    if (release !== undefined) {
      rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      release();
    }
    store.close();
  }
}

/**
 * What became of one retrieve.
 *
 * - `stored`: its files are in the snapshot.
 * - `failed`: it gave no files, and asking for the same again would give none: Salesforce failed the job or
 *   refused to start it, or what it handed out cannot be read. The chunk is tried in two halves.
 * - `lost`: its job gave no result: Salesforce no longer knows it, cannot be asked about it, or never ended it.
 *   The chunk is started again, a few times.
 */
type Outcome =
  | { readonly kind: 'stored' }
  | { readonly kind: 'failed'; readonly said: string; readonly code: string | null }
  | { readonly kind: 'lost'; readonly said: string; readonly code: string | null };

/**
 * Retrieves one chunk and stores its files. Throws what stops the whole snapshot: an org that cannot be reached,
 * a session that is not accepted, a refusal that holds for the whole org, a job of this run that does not end, a
 * failure of this machine.
 */
async function retrieveChunk(
  store: Store,
  snapshotId: number,
  chunk: Chunk,
  api: MetadataApi,
  source: string,
  workDir: string,
  tuning: OrgSnapshotTuning,
): Promise<Outcome> {
  const { seq, members } = chunk;
  // A job of an earlier run. This process has not waited for it yet.
  const resumed = chunk.jobId !== null;
  let jobId = chunk.jobId;
  // A start the org refuses is asked for again after a pause: the org may be busy for a moment. A refusal that
  // stays is taken for one of this retrieve, and its halves are tried.
  for (let attempt = 1; jobId === null; attempt += 1) {
    try {
      jobId = await api.startRetrieve(members);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      if (attempt >= tuning.startsPerChunk) {
        return { kind: 'failed', said: `Salesforce did not start the retrieve. ${saidIn(error)}`, code: error.code };
      }
      await pause(tuning.pollMaxMs);
      continue;
    }
    const started = jobId;
    store.write(() => {
      chunkStarted(store, snapshotId, seq, started, now());
    });
  }

  let state: RetrieveState;
  let zip: Uint8Array | null = null;
  try {
    state = await ended(api, jobId, source, tuning);
    if (state.succeeded) zip = (await api.retrieveState(jobId, true)).zip;
  } catch (error) {
    if (isRefusal(error)) {
      // The job ended long ago, or the org was refreshed since, or the org says something else about it. In
      // every case its result is not to be had.
      return {
        kind: 'lost',
        said:
          error.code === 'INVALID_CROSS_REFERENCE_KEY'
            ? 'Salesforce no longer knows the retrieve.'
            : `Salesforce did not say how far the retrieve is. ${saidIn(error)}`,
        code: error.code,
      };
    }
    // A job that did not end in an earlier run and does not end in this one either is not waited for a third time.
    if (resumed && isTooSlow(error)) {
      return {
        kind: 'lost',
        said: `The retrieve did not end within ${minutes(tuning.jobMs)}, also after the snapshot was continued.`,
        code: null,
      };
    }
    throw error;
  }
  if (!state.succeeded) return { kind: 'failed', said: saidAbout(state), code: state.errorCode };
  if (zip === null) {
    return { kind: 'lost', said: 'Salesforce gave no zip file for a retrieve that succeeded.', code: null };
  }

  const dir = join(workDir, `chunk-${String(seq)}`);
  mkdirSync(dir, { recursive: true });
  let unpacked: Unpacked;
  try {
    unpacked = await unpackRetrieve(zip, dir);
  } catch (error) {
    if (isEngineError(error) || isSystemFailure(error)) throw error;
    // Something that is not a zip file, for example. The next run would get the same, so the chunk does not stay
    // in the way: it is handled like a retrieve that Salesforce failed.
    return { kind: 'failed', said: `What Salesforce handed out could not be read. ${saidBy(error)}`, code: null };
  }
  const owned = new Set(unpacked.components.flatMap((component) => component.files));
  const messages = state.problems.map((problem) => saidBy(problem));
  store.write(() => {
    const twice: string[] = [];
    for (const path of unpacked.tree.files) {
      if (owned.has(path) && putSnapshotFile(store, snapshotId, path, unpacked.tree.read(path))) twice.push(path);
    }
    markRetrieved(store, snapshotId, unpacked.components);
    for (const problem of unpacked.problems) {
      issue(
        store,
        snapshotId,
        'error',
        'RESOLVE_FAILED',
        `${problem.at} could not be read as metadata: ${problem.message}`,
        { at: problem.at },
      );
    }
    const other = unpacked.tree.files.filter((path) => !owned.has(path));
    if (other.length > 0) {
      issue(
        store,
        snapshotId,
        'warning',
        'FILES_NOT_METADATA',
        `${plural(other.length, 'file is', 'files are')} not part of a metadata component and not in the snapshot.`,
        { count: other.length, paths: other.slice(0, NAMES_PER_ISSUE) },
      );
    }
    if (twice.length > 0) {
      issue(
        store,
        snapshotId,
        'warning',
        'FILE_RETRIEVED_TWICE',
        `${plural(twice.length, 'file', 'files')} came back in two retrieves. The snapshot holds what came last.`,
        { count: twice.length, paths: twice.slice(0, NAMES_PER_ISSUE) },
      );
    }
    if (messages.length > 0) {
      issue(
        store,
        snapshotId,
        'warning',
        'RETRIEVE_MESSAGES',
        `Salesforce made ${plural(messages.length, 'remark', 'remarks')} about a retrieve. The first: ${messages[0] ?? ''}`,
        { count: messages.length, messages: messages.slice(0, NAMES_PER_ISSUE) },
      );
    }
    refreshCoverage(store, snapshotId);
    chunkEnded(store, snapshotId, seq, { status: 'done', at: now(), error: null });
  });
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  return { kind: 'stored' };
}

/** Retrieves every chunk of a snapshot that is not stored yet, one after the other. */
async function retrieveChunks(
  store: Store,
  snapshotId: number,
  api: MetadataApi,
  source: string,
  workDir: string,
  tuning: OrgSnapshotTuning,
  progress: (event: SnapshotProgress) => void,
): Promise<void> {
  let failures = 0;
  for (let chunk = nextChunk(store, snapshotId); chunk !== undefined; chunk = nextChunk(store, snapshotId)) {
    const { seq, members } = chunk;
    /** Gives the chunk up: its components are not in the snapshot, and an issue says why. */
    const fail = (said: string, code: string | null): void => {
      store.write(() => {
        chunkEnded(store, snapshotId, seq, { status: 'failed', at: now(), error: said });
        const first = members[0];
        issue(
          store,
          snapshotId,
          'error',
          'RETRIEVE_FAILED',
          members.length === 1 && first !== undefined
            ? `Salesforce did not hand out ${first.type} ${first.fullName}. ${said}`
            : `Salesforce did not hand out ${plural(members.length, 'component', 'components')}. ${said}`,
          { ...named(members.map((member) => `${member.type} ${member.fullName}`)), said, code },
        );
      });
    };
    // How often a retrieve is started for the chunk, with the one of this turn.
    const starts = chunk.attempts + (chunk.jobId === null ? 1 : 0);

    const outcome = await retrieveChunk(store, snapshotId, chunk, api, source, workDir, tuning);
    if (outcome.kind === 'lost') {
      if (starts >= tuning.startsPerChunk) {
        fail(
          `The retrieve was started ${plural(starts, 'time', 'times')} and gave no result. ${outcome.said}`,
          outcome.code,
        );
      } else {
        store.write(() => {
          chunkForgotten(store, snapshotId, seq);
        });
        continue;
      }
    } else if (outcome.kind === 'stored') {
      failures = 0;
    } else {
      failures += 1;
      const { said, code } = outcome;
      const [first, second] = splitMembers(members);
      if (second.length === 0) {
        fail(said, code);
      } else {
        // Salesforce says how large a retrieve is only by failing it. Half of it is tried, down to the one
        // component that cannot be handed out.
        store.write(() => {
          splitChunk(store, snapshotId, seq, [first, second]);
          issue(
            store,
            snapshotId,
            'info',
            'CHUNK_SPLIT',
            `A retrieve of ${plural(members.length, 'component', 'components')} failed and was tried again in two halves. ${said}`,
            { members: members.length, said, code },
          );
        });
      }
      if (failures >= tuning.failuresInARow) {
        throw new EngineError(
          'SOURCE_READ_FAILED',
          `${String(failures)} retrieves in a row from the org of the source "${source}" failed. The last: ${said}`,
          { details: { reason: 'RETRIEVES_FAILING', source, said, code } },
        );
      }
    }
    const counts = countChunks(store, snapshotId);
    progress({ step: 'retrieved', snapshot: snapshotId, done: counts.done + counts.failed, chunks: counts.total });
  }
}

/**
 * Ends a snapshot whose chunks are all done: counts what came back against
 * what the org listed, names what is missing, and sets the status.
 */
function finish(store: Store, snapshotId: number): void {
  store.write(() => {
    const coverage = new Map(readCoverage(store, snapshotId).map((row) => [row.type, row]));
    for (const [type, count] of [...countInventory(store, snapshotId)].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const row = coverage.get(type);
      const notes = [row?.note ?? null];
      if (count.listed > count.retrieved) {
        const missing = missingComponents(store, snapshotId, type);
        issue(
          store,
          snapshotId,
          'error',
          'NOT_RETRIEVED',
          `${plural(missing.length, 'component', 'components')} of the type ${type} that the org listed did not come back. The first: ${missing[0] ?? ''}`,
          { type, ...named(missing) },
        );
      }
      if (count.unlisted > 0) {
        const unlisted = unlistedComponents(store, snapshotId, type);
        notes.push(`${plural(unlisted.length, 'component', 'components')} more came back that the org had not listed.`);
        issue(
          store,
          snapshotId,
          'info',
          'UNLISTED_COMPONENTS',
          `${plural(unlisted.length, 'component', 'components')} of the type ${type} came back that the org had not listed. ${unlisted.length === 1 ? 'It is' : 'They are'} in the snapshot. The first: ${unlisted[0] ?? ''}`,
          { type, ...named(unlisted) },
        );
      }
      if (ACCESS_TYPES.has(type) && count.retrieved > 0) notes.push(ACCESS_NOTE);
      const note = notes.filter((one) => one !== null).join(' ');
      addCoverage(store, snapshotId, {
        type,
        listed: count.listed,
        retrieved: count.retrieved,
        analysed: 0,
        listing: row?.listing ?? 'ok',
        note: note === '' ? null : note,
      });
    }
    const complete = !readIssues(store, snapshotId).some((one) => one.severity === 'error');
    finishSnapshot(store, snapshotId, {
      status: complete ? 'complete' : 'partial',
      finishedAt: now(),
      gitCommit: null,
    });
  });
}
