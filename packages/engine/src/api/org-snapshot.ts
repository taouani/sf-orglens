/**
 * Taking a snapshot of an org or a sandbox.
 *
 * The org is asked what it holds (the inventory), the components are
 * retrieved by name in chunks, and the files of each chunk are stored as
 * soon as they arrive. The database says at every moment how far the
 * snapshot is: a snapshot that was interrupted, by a closed laptop or a
 * network that went away, is picked up by the next run where it stopped.
 *
 * The snapshot is measured against the inventory, and judged over the logic
 * tier (`core/tiers.ts`, decision record 0046). Whatever the org listed of
 * a type of that tier and did not hand out, and every such type it refused
 * to list, is an issue of severity `error`, and the snapshot is `partial`.
 * The same in another type is a warning, and the snapshot stays `complete`.
 *
 * Only metadata is read. Nothing here queries records.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { OrgSource, SandboxSource } from '../core/config/config.ts';
import { EngineError, isEngineError, type JsonValue } from '../core/errors.ts';
import { buildKey } from '../core/keys.ts';
import { tierOf, tierOfAny, type Tier } from '../core/tiers.ts';
import { engineVersion } from '../core/version.ts';
import { flowsNotNamed } from '../engines/cross-check.ts';
import { DEFAULT_CHUNK_WEIGHT, partsWithOwnFiles, planChunks, splitMembers } from '../sources/chunks.ts';
import {
  dependencyLimits,
  readDependencies,
  readFlowVersions,
  type DependencyLimits,
} from '../sources/dependency-api.ts';
import { takeInventory, type NotExcluded } from '../sources/inventory.ts';
import {
  DEFAULT_LIMITS,
  isAboutTheOrg,
  metadataApi,
  MetadataRequestError,
  notFoundIn,
  type MetadataApi,
  type MetadataApiLimits,
  type RetrieveState,
} from '../sources/metadata-api.ts';
import { loginFailed, saidBy, unreachable } from '../sources/org-errors.ts';
import { connectToOrg, type OrgSession } from '../sources/org.ts';
import { unpackRetrieve, type Unpacked } from '../sources/retrieved.ts';
import { byCodeUnit, systemCode } from '../sources/tree.ts';
import { readListedIds, writeDependencies, writeFlowVersions } from '../store/dependencies.ts';
import {
  addChunk,
  addChunks,
  addInventory,
  chunkEnded,
  chunkForgotten,
  chunkStarted,
  countChunks,
  countInventory,
  isListed,
  markNotRetrieved,
  markRetrieved,
  missingComponents,
  missingPartsOf,
  nextChunk,
  refreshCoverage,
  splitChunk,
  unlistedComponents,
  type Chunk,
  type ChunkMember,
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
  removeIssues,
  removeSnapshotFile,
  snapshotTree,
} from '../store/snapshots.ts';
import { analyseStored } from './analysis.ts';
import { activeVersionIn, flowPath, flowsNotActive, versionName, type FlowToFetch } from './flow-versions.ts';
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
 * - `cross-checking`: every chunk is done. The org is asked what its Dependency API knows about references.
 *   It comes once before the first request, and then after every query, with the requests sent and the
 *   different rows read so far.
 * - `analysing`: the snapshot has ended. Its files are analysed now.
 */
export type SnapshotProgress =
  | { readonly step: 'connected'; readonly apiVersion: string }
  | { readonly step: 'listing'; readonly done: number; readonly total: number }
  | { readonly step: 'planned'; readonly snapshot: number; readonly components: number; readonly chunks: number }
  | { readonly step: 'resumed'; readonly snapshot: number; readonly done: number; readonly chunks: number }
  | { readonly step: 'retrieved'; readonly snapshot: number; readonly done: number; readonly chunks: number }
  /** Every chunk is stored, and the active versions of `flows` flows are asked for by their numbers. */
  | { readonly step: 'flow-versions'; readonly snapshot: number; readonly flows: number }
  | { readonly step: 'cross-checking'; readonly snapshot: number; readonly requests: number; readonly rows: number }
  | { readonly step: 'analysing'; readonly snapshot: number };

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
  /** At most this many active versions of flows are asked for in one retrieve (decision record 0062). */
  readonly flowsPerRetrieve: number;
  readonly requests: MetadataApiLimits;
  /** The numbers the Dependency API is read with (`sources/dependency-api.ts`). */
  readonly dependencies: Partial<DependencyLimits>;
}

const DEFAULT_TUNING: OrgSnapshotTuning = {
  chunkWeight: DEFAULT_CHUNK_WEIGHT,
  pollFirstMs: 250,
  pollMaxMs: 5_000,
  jobMs: 30 * 60_000,
  // Halving a chunk of 3,000 members down to the one that fails takes 12 failures in a row.
  failuresInARow: 20,
  startsPerChunk: 3,
  flowsPerRetrieve: 100,
  requests: DEFAULT_LIMITS,
  dependencies: {},
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
  /** False to leave the Dependency API of the org unasked. Default: it is asked. */
  readonly crossCheck?: boolean | undefined;
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
 * A file that holds nothing but parts of one type, by its type, with the type of the parts. An org lists the
 * file of custom labels also when it has no label, and then hands out nothing: the test org did so until it got
 * a label (`docs/research/phase-1/real-org.md`). Such a file is not missing when the org lists no part of it.
 */
const HOLDS_ONLY: Readonly<Record<string, string>> = { CustomLabels: 'CustomLabel' };

/** Why a type that exclude_types of the source names is read all the same, by the reason the inventory gives. */
const NOT_EXCLUDED: Readonly<Record<NotExcluded['reason'], (type: string, of: string) => string>> = {
  unknown: (type) =>
    `exclude_types of the source names ${type}, and the org describes no metadata type of that name. Nothing was left out for it.`,
  part: (type, of) =>
    `exclude_types of the source names ${type}. Its components are parts of a component of the type ${of} and come with it, so it cannot be left out alone. It was read.`,
  folder: (type, of) =>
    `exclude_types of the source names ${type}. Its components are the folders of the type ${of}, so it cannot be left out alone. It was read.`,
  'logic-part': (type, of) =>
    `exclude_types of the source names ${type}. Its part ${of} is of the logic tier, which a snapshot is judged by, so it cannot be left out. It was read.`,
  logic: (type) =>
    `exclude_types of the source names ${type}, which is of the logic tier. A snapshot is judged by that tier, so the type cannot be left out. It was read.`,
};

/**
 * The types the org describes, by the folder a retrieve puts their files in, each with its parts. The org is
 * asked once per run, and only when a file came back in a folder the Salesforce library knows no type for: the
 * library can be older than the org. `refused` holds what the org said if it did not answer: then no folder has
 * a type, and a file in it counts against the logic tier.
 */
interface FoldersOfOrg {
  readonly types: ReadonlyMap<string, readonly string[]>;
  readonly refused: string | null;
}
const foldersOfOrg = new WeakMap<MetadataApi, Promise<FoldersOfOrg>>();
function typesOfFolder(
  api: MetadataApi,
  folder: string,
): Promise<{ readonly types: readonly string[]; readonly refused: string | null }> {
  let folders = foldersOfOrg.get(api);
  if (folders === undefined) {
    folders = api.describe().then(
      (described): FoldersOfOrg => {
        const found = new Map<string, Set<string>>();
        for (const type of described) {
          if (type.directory === null) continue;
          const names = found.get(type.directory) ?? new Set<string>();
          found.set(type.directory, names);
          for (const name of [type.name, ...type.children]) names.add(name);
        }
        return {
          types: new Map([...found].map(([directory, names]) => [directory, [...names].sort(byCodeUnit)])),
          refused: null,
        };
      },
      (error: unknown): FoldersOfOrg => {
        if (isRefusal(error)) return { types: new Map(), refused: saidIn(error) };
        throw error;
      },
    );
    foldersOfOrg.set(api, folders);
  }
  return folders.then((known) => ({ types: known.types.get(folder) ?? [], refused: known.refused }));
}

/** What the message of a file says that is counted by the word of the org. */
const DESCRIBED_BY_ORG =
  'The org describes a type that keeps its files in this folder, and the Salesforce library OrgLens reads with does not know it.';

/** Something missing in the logic tier is an error, which makes the snapshot partial. Elsewhere it is a warning. */
const severityIn = (tier: Tier): 'error' | 'warning' => (tier === 'logic' ? 'error' : 'warning');

/** A text that ends as a sentence does, so that another sentence can follow it. */
function asSentence(text: string): string {
  const trimmed = text.trimEnd();
  return `${trimmed}${/[.!?]$/.test(trimmed) ? '' : '.'}`;
}

/**
 * What the message of an issue says of something that is missing, with the tier it counts against. `of` names
 * the types it is counted with, where the message does not name its type.
 */
function missingIn(tier: Tier, message: string, of: readonly string[] = []): string {
  if (tier === 'logic') return message;
  const sentence = asSentence(message);
  if (of.length === 0) return `${sentence} This is outside the logic tier and does not make the snapshot partial.`;
  const types = of.length === 1 ? `the type ${of[0] ?? ''}, which is` : `the types ${of.join(', ')}, which are`;
  return `${sentence} It is counted with ${types} outside the logic tier, and does not make the snapshot partial.`;
}

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
  let finished = false;
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
        exclude: source.excludeTypes,
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
            const tier = tierOf(type.type);
            issue(
              store,
              id,
              severityIn(tier),
              'LISTING_FAILED',
              missingIn(
                tier,
                `The org did not say which components of the type ${type.type} it has. ${type.reason ?? ''}`.trimEnd(),
              ),
              { type: type.type, code: type.code, tier },
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
        const leftOut = inventory.types.filter((type) => type.listing === 'excluded').map((type) => type.type);
        if (leftOut.length > 0) {
          issue(
            store,
            id,
            'info',
            'TYPES_EXCLUDED',
            `${plural(leftOut.length, 'type is', 'types are')} left out of the snapshot, as exclude_types of the source says: ${leftOut.join(', ')}. The org was not asked for ${leftOut.length === 1 ? 'its' : 'their'} components.`,
            { count: leftOut.length, types: leftOut },
          );
        }
        for (const { type, reason, of } of inventory.notExcluded) {
          issue(store, id, 'warning', 'TYPE_NOT_EXCLUDED', NOT_EXCLUDED[reason](type, of ?? ''), { type, reason, of });
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
    await fetchActiveFlows(store, snapshotId, api, source.name, workDir, tuning, progress);
    if (job.crossCheck !== false) {
      // Before the snapshot ends, so that a snapshot that is interrupted here is continued here.
      const snapshot = snapshotId;
      progress({ step: 'cross-checking', snapshot, requests: 0, rows: 0 });
      await readCrossCheck(store, snapshot, session, api.apiVersion, tuning, (requests, rows) => {
        progress({ step: 'cross-checking', snapshot, requests, rows });
      });
    }
    finish(store, snapshotId);
    finished = true;
    // A snapshot is a large write. The log is moved into the database file now, not by a later reader.
    store.checkpoint();
    progress({ step: 'analysing', snapshot: snapshotId });
    await analyseStored(store, source.name, { id: snapshotId, layout: null });
    store.checkpoint();
    const taken = snapshotReport(store, source.name, snapshotId);
    if (taken === undefined) throw new EngineError('INTERNAL', 'The snapshot was stored and cannot be found.');
    return taken;
  } catch (error) {
    // A snapshot that has ended is not picked up again, whatever happened to its analysis.
    throw finished ? error : stopped(error, source.name, snapshotId);
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
  const notFound = notFoundIn(state.problems);
  const parentOf = notFound.length > 0 ? await partsWithOwnFiles() : new Map<string, string>();
  // A file in a folder the library knows no type for is placed by what the org says about its types.
  const problems: { at: string; message: string; types: readonly string[]; byOrg: boolean }[] = [];
  for (const problem of unpacked.problems) {
    if (problem.types.length > 0 || problem.folder === null) {
      problems.push({ ...problem, byOrg: false });
      continue;
    }
    const org = await typesOfFolder(api, problem.folder);
    if (org.types.length > 0) {
      problems.push({ ...problem, message: `${problem.message} ${DESCRIBED_BY_ORG}`, types: org.types, byOrg: true });
    } else if (org.refused !== null) {
      const message = `${problem.message} The org was asked which type keeps its files in this folder, and did not say: ${org.refused}`;
      problems.push({ ...problem, message, byOrg: false });
    } else problems.push({ ...problem, byOrg: false });
  }
  store.write(() => {
    const twice: string[] = [];
    for (const path of unpacked.tree.files) {
      if (owned.has(path) && putSnapshotFile(store, snapshotId, path, unpacked.tree.read(path))) twice.push(path);
    }
    const withoutPrefix = markRetrieved(store, snapshotId, unpacked.components, { asked: members, notFound });
    for (const type of [...new Set(withoutPrefix.map((component) => component.type))].sort(byCodeUnit)) {
      const names = withoutPrefix.filter((component) => component.type === type).map((one) => one.fullName);
      issue(
        store,
        snapshotId,
        'info',
        'RETRIEVED_WITHOUT_PREFIX',
        `${plural(names.length, 'component', 'components')} of the type ${type} came back under ${names.length === 1 ? 'its' : 'their'} name without the prefix of ${names.length === 1 ? 'its' : 'their'} package. The org lists ${names.length === 1 ? 'it' : 'them'} with the prefix, and the files of the snapshot are named without it. The first: ${names[0] ?? ''}`,
        { type, ...named(names) },
      );
    }
    for (const problem of problems) {
      // What nothing tells the type of counts against the logic tier.
      const tier = tierOfAny(problem.types);
      issue(
        store,
        snapshotId,
        severityIn(tier),
        'RESOLVE_FAILED',
        missingIn(tier, `${problem.at} could not be read as metadata: ${problem.message}`, problem.types),
        { at: problem.at, types: [...problem.types], tier, ...(problem.byOrg ? { describedByOrg: true } : {}) },
      );
    }
    // A parent the org does not list is asked for because the org lists parts of it. If Salesforce cannot find
    // the parent, the parts that did not come back are asked for by their own names, in a retrieve of their own
    // (decision record 0049). Only for a parent whose parts are stored in files of their own: the retrieve of
    // the parts can be split like any other.
    const asked = new Set(members.map((member) => `${member.type}\n${member.fullName}`));
    const parents: string[] = [];
    const byName: ChunkMember[] = [];
    for (const parent of notFound) {
      // Salesforce can make a remark twice. And a remark about a name this retrieve did not ask for, such as
      // the parent of a part that was asked for by its own name, starts nothing.
      const id = `${parent.type}\n${parent.fullName}`;
      if (!asked.delete(id)) continue;
      const partTypes = [...parentOf].filter(([, of]) => of === parent.type).map(([type]) => type);
      const missing = partTypes.length === 0 ? [] : missingPartsOf(store, snapshotId, parent, partTypes);
      if (missing.length === 0) continue;
      parents.push(`${parent.type} ${parent.fullName}`);
      byName.push(...missing);
    }
    if (byName.length > 0) {
      const parts = byName.length;
      byName.sort((a, b) => byCodeUnit(a.type, b.type) || byCodeUnit(a.fullName, b.fullName));
      addChunk(store, snapshotId, byName);
      issue(
        store,
        snapshotId,
        'info',
        'PARTS_ASKED_BY_NAME',
        `Salesforce cannot find ${plural(parents.length, 'component', 'components')} that the org does not list and lists parts of. ${plural(parts, 'part is', 'parts are')} asked for by ${parts === 1 ? 'its' : 'their'} own ${parts === 1 ? 'name' : 'names'} in another retrieve. The first component: ${parents[0] ?? ''}`,
        { ...named(parents), parts },
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
        // One component of the logic tier among them is enough.
        const tier = tierOfAny(members.map((member) => member.type));
        issue(
          store,
          snapshotId,
          severityIn(tier),
          'RETRIEVE_FAILED',
          missingIn(
            tier,
            members.length === 1 && first !== undefined
              ? `Salesforce did not hand out ${first.type} ${first.fullName}. ${said}`
              : `Salesforce did not hand out ${plural(members.length, 'component', 'components')}. ${said}`,
          ),
          {
            ...named(members.map((member) => `${member.type} ${member.fullName}`)),
            types: [...new Set(members.map((member) => member.type))].sort(byCodeUnit),
            said,
            code,
            tier,
          },
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
 * What became of a retrieve of members that are not chunks of the snapshot.
 *
 * - `got`: what came back, with the remarks Salesforce made about members it did not hand out.
 * - `failed`: nothing that can be read came back, and asking for the same again would give nothing either:
 *   Salesforce failed the job, or refused to start it also when it was asked again, or what it handed out cannot
 *   be read. The members are tried in two halves.
 * - `lost`: the job gave no result, also when it was started again: Salesforce no longer knows it, cannot be
 *   asked about it, or did not end it in time.
 */
type BesideOutcome =
  | { readonly kind: 'got'; readonly unpacked: Unpacked; readonly remarks: readonly string[] }
  | { readonly kind: 'failed' | 'lost'; readonly said: string; readonly code: string | null };

/** One retrieve of members that are not chunks of the snapshot, with one job. */
async function retrieveOnce(
  api: MetadataApi,
  members: readonly ChunkMember[],
  source: string,
  dir: string,
  tuning: OrgSnapshotTuning,
): Promise<BesideOutcome> {
  let jobId: string | null = null;
  // A start the org refuses is asked for again after a pause, as for a chunk.
  for (let attempt = 1; jobId === null; attempt += 1) {
    try {
      jobId = await api.startRetrieve(members);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      if (attempt >= tuning.startsPerChunk) {
        return { kind: 'failed', said: `Salesforce did not start the retrieve. ${saidIn(error)}`, code: error.code };
      }
      await pause(tuning.pollMaxMs);
    }
  }
  let zip: Uint8Array | null;
  let remarks: readonly string[];
  try {
    const state = await ended(api, jobId, source, tuning);
    if (!state.succeeded) return { kind: 'failed', said: saidAbout(state), code: state.errorCode };
    remarks = state.problems.map((problem) => saidBy(problem));
    zip = (await api.retrieveState(jobId, true)).zip;
  } catch (error) {
    if (isRefusal(error)) {
      return {
        kind: 'lost',
        said:
          error.code === 'INVALID_CROSS_REFERENCE_KEY'
            ? 'Salesforce no longer knows the retrieve.'
            : `Salesforce did not say how far the retrieve is. ${saidIn(error)}`,
        code: error.code,
      };
    }
    // The job is not kept with the snapshot, so a snapshot that is continued could not wait for it again. A job
    // that does not end in time is started again here, where the job of a chunk stops the snapshot.
    if (isTooSlow(error)) {
      return { kind: 'lost', said: `The retrieve did not end within ${minutes(tuning.jobMs)}.`, code: null };
    }
    throw error;
  }
  if (zip === null)
    return { kind: 'lost', said: 'Salesforce gave no zip file for a retrieve that succeeded.', code: null };
  mkdirSync(dir, { recursive: true });
  try {
    return { kind: 'got', unpacked: await unpackRetrieve(zip, dir), remarks };
  } catch (error) {
    if (isEngineError(error) || isSystemFailure(error)) throw error;
    return { kind: 'failed', said: `What Salesforce handed out could not be read. ${saidBy(error)}`, code: null };
  }
}

/**
 * Retrieves members that are not chunks of the snapshot, with the care a chunk gets: a start the org refuses is
 * asked for again, and a job that gives no result is started again, each up to `startsPerChunk` times. Throws
 * what stops the whole snapshot: an org that cannot be reached, a session that is not accepted, a refusal that
 * holds for the whole org, a failure of this machine.
 */
async function retrieveBeside(
  api: MetadataApi,
  members: readonly ChunkMember[],
  source: string,
  dir: string,
  tuning: OrgSnapshotTuning,
): Promise<BesideOutcome> {
  for (let starts = 1; ; starts += 1) {
    const outcome = await retrieveOnce(api, members, source, dir, tuning);
    if (outcome.kind !== 'lost') return outcome;
    if (starts >= tuning.startsPerChunk) {
      const said = `The retrieve was started ${plural(starts, 'time', 'times')} and gave no result. ${outcome.said}`;
      return { kind: 'lost', said, code: outcome.code };
    }
  }
}

/** Why the snapshot is not asked for the active version of a flow, by the reason `FLOW_VERSION_UNKNOWN` gives. */
const NOT_ASKED: Readonly<Record<string, string>> = {
  'no-definition': 'The snapshot holds no definition of the flow, which would name its active version.',
  excluded:
    'The snapshot holds no definition of the flow, which would name its active version: the source leaves the type FlowDefinition out (exclude_types).',
  'definition-unreadable': 'The file of its definition cannot be read, or names no number that can be read.',
};

/**
 * Puts the active version of a flow in the place of a version that is not active (decision records 0060 and
 * 0062).
 *
 * A flow whose file says that it is not active, and whose definition names an active version, is asked for once
 * more by its name with that number. The file that comes back is taken if it says that it is active, under the
 * path of the flow. The note `FLOW_NEWER_VERSION` says that the flow has a newer version that is not analysed,
 * unless the file came back as the latest version: the flow was made active since its chunk was read. If no such
 * file comes back, the file of the newer version is taken out of the snapshot too: the flow counts as listed and
 * not handed out, and the note `ACTIVE_FLOW_NOT_RETRIEVED` says why. A flow without a definition, and one the org
 * listed under another name than that of its file, is kept as it came, with the warning `FLOW_VERSION_UNKNOWN`.
 *
 * The retrieves are made with the care a chunk gets (`retrieveBeside`). A retrieve that fails is tried in two
 * halves, down to the one flow, and the note `CHUNK_SPLIT` says so. After `failuresInARow` retrieves in a row
 * that gave nothing, the snapshot stops, as it does for chunks.
 *
 * What is done is written with the file it is about, so a snapshot that is interrupted here does not do it twice:
 * the file is active then, or not there.
 */
async function fetchActiveFlows(
  store: Store,
  snapshotId: number,
  api: MetadataApi,
  source: string,
  workDir: string,
  tuning: OrgSnapshotTuning,
  progress: (event: SnapshotProgress) => void,
): Promise<void> {
  const { fetch, unknown } = flowsNotActive(snapshotTree(store, snapshotId));
  const leftOut = readCoverage(store, snapshotId).some(
    (type) => type.type === 'FlowDefinition' && type.listing === 'excluded',
  );
  const asked: FlowToFetch[] = [];
  const notKnown: { message: string; details: Record<string, JsonValue>; flow: string }[] = unknown.map((one) => {
    const reason = one.reason === 'no-definition' && leftOut ? 'excluded' : one.reason;
    return {
      flow: one.flow,
      message: `The flow ${one.flow} came back as a version that is ${one.state}. ${NOT_ASKED[reason] ?? ''} It is analysed as it came, and it is not known whether another version of it is active.`,
      details: { flow: one.flow, state: one.state, reason },
    };
  });
  for (const flow of fetch) {
    // A flow of a package that came back without its prefix is asked for by no name the org was seen to answer.
    if (isListed(store, snapshotId, { type: 'Flow', fullName: flow.flow })) asked.push(flow);
    else {
      notKnown.push({
        flow: flow.flow,
        message: `The flow ${flow.flow} came back as a version that is ${flow.state}. Its definition names version ${String(flow.version)} as active, and the org lists no flow under the name of its file, so that version is not asked for by its number. The flow is analysed as it came, which is not its active version.`,
        details: { flow: flow.flow, state: flow.state, reason: 'not-listed', version: flow.version },
      });
    }
  }
  store.write(() => {
    removeIssues(store, snapshotId, ['FLOW_VERSION_UNKNOWN']);
    for (const { flow, message, details } of notKnown) {
      addIssue(store, snapshotId, {
        severity: 'warning',
        code: 'FLOW_VERSION_UNKNOWN',
        message,
        componentKey: buildKey({ type: 'Flow', fullName: flow }),
        // The type lets an impact answer that covers flows count the warning (`countIssues`).
        details: { ...details, types: ['Flow'] },
      });
    }
  });
  if (asked.length === 0) return;
  progress({ step: 'flow-versions', snapshot: snapshotId, flows: asked.length });

  let seq = 0;
  let failures = 0;
  /** Stops the snapshot after too many retrieves in a row that gave nothing, as `retrieveChunks` does. */
  const stopIfFailing = (said: string, code: string | null): void => {
    if (failures < tuning.failuresInARow) return;
    throw new EngineError(
      'SOURCE_READ_FAILED',
      `${String(failures)} retrieves in a row from the org of the source "${source}" failed. The last: ${said}`,
      { details: { reason: 'RETRIEVES_FAILING', source, said, code } },
    );
  };
  const take = async (flows: readonly FlowToFetch[]): Promise<void> => {
    seq += 1;
    const dir = join(workDir, `flows-${String(seq)}`);
    const members = flows.map(({ flow, version }) => ({ type: 'Flow', fullName: versionName(flow, version) }));
    const got = await retrieveBeside(api, members, source, dir, tuning);
    failures = got.kind === 'got' ? 0 : failures + 1;
    if (got.kind === 'failed' && flows.length > 1) {
      // One version that cannot be handed out fails the retrieve of all. Each half is tried, down to the one.
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      store.write(() => {
        issue(
          store,
          snapshotId,
          'info',
          'CHUNK_SPLIT',
          `A retrieve of the active versions of ${plural(flows.length, 'flow', 'flows')} failed and was tried again in two halves. ${got.said}`,
          { members: flows.length, said: got.said, code: got.code },
        );
      });
      stopIfFailing(got.said, got.code);
      const half = Math.ceil(flows.length / 2);
      await take(flows.slice(0, half));
      await take(flows.slice(half));
      return;
    }
    store.write(() => {
      let takenOut = false;
      for (const { flow, state, version } of flows) {
        const found = got.kind === 'got' ? activeVersionIn(got.unpacked.tree, flow, version) : null;
        const componentKey = buildKey({ type: 'Flow', fullName: flow });
        if (found !== null && found.content !== null) {
          putSnapshotFile(store, snapshotId, flowPath(flow), found.content);
          // A file that came back as the latest version is the active one: the flow was made active since its
          // chunk was read, and has no newer version.
          if (found.latest) continue;
          addIssue(store, snapshotId, {
            severity: 'info',
            code: 'FLOW_NEWER_VERSION',
            message: `The flow ${flow} has a version that is newer than its active version ${String(version)}, and is ${state}. The snapshot holds the active version, and the newer one is not analysed.`,
            componentKey,
            details: { flow, version, newer: state },
          });
          continue;
        }
        removeSnapshotFile(store, snapshotId, flowPath(flow));
        markNotRetrieved(store, snapshotId, { type: 'Flow', fullName: flow });
        takenOut = true;
        const said = got.kind === 'got' ? notActiveSaid(got, flow, version, found) : got.said;
        addIssue(store, snapshotId, {
          severity: 'info',
          code: 'ACTIVE_FLOW_NOT_RETRIEVED',
          message: `The flow ${flow} came back as a version that is ${state}, and its active version ${String(version)} did not come back when it was asked for by its number. ${asSentence(said)} The flow is not in the snapshot, and the newer version is not analysed in its place.`,
          componentKey,
          details: { flow, version, newer: state, said },
        });
      }
      if (takenOut) refreshCoverage(store, snapshotId);
    });
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    if (got.kind !== 'got') stopIfFailing(got.said, got.code);
  };
  for (let at = 0; at < asked.length; at += tuning.flowsPerRetrieve) {
    await take(asked.slice(at, at + tuning.flowsPerRetrieve));
  }
}

/**
 * What a retrieve that came back says about a flow whose active version is not among its files: the states of
 * the files of the flow that did come back, or the remark of Salesforce about the name with the number, and the
 * files it handed out that could not be read as metadata.
 */
function notActiveSaid(
  got: Extract<BesideOutcome, { kind: 'got' }>,
  flow: string,
  version: number,
  found: ReturnType<typeof activeVersionIn> | null,
): string {
  if (found !== null && found.content === null && found.states.length > 0) {
    return `What came back is ${found.states.join(' and ')}.`;
  }
  // A remark of Salesforce names the member it is about. The one about this flow is given, if there is one.
  const remark = got.remarks.find((one) => one.includes(`'${versionName(flow, version)}'`));
  const [problem] = got.unpacked.problems;
  return [
    'No file of it came back.',
    ...(remark === undefined ? [] : [asSentence(`Salesforce remarked: ${remark}`)]),
    ...(problem === undefined
      ? []
      : [
          `${plural(got.unpacked.problems.length, 'file', 'files')} of the retrieve could not be read as metadata. The first: ${problem.at}: ${problem.message}`,
        ]),
  ].join(' ');
}

/**
 * Asks the org what its Dependency API knows about references, and stores the rows with the snapshot (decision
 * record 0045). They are a second opinion on what the analysis finds, and the snapshot does not depend on
 * them: an org that does not answer leaves a warning, and the snapshot goes on.
 *
 * A row from a flow carries the id of a version of the flow, and the org lists a flow with the id of its latest
 * version only. An org that lists a flow is therefore asked first for the ids of the active and the latest version
 * of each flow, which are stored with the rows (decision record 0067).
 */
async function readCrossCheck(
  store: Store,
  snapshotId: number,
  session: OrgSession,
  apiVersion: string,
  tuning: OrgSnapshotTuning,
  onProgress: (requests: number, rows: number) => void,
): Promise<void> {
  const listed = readListedIds(store, snapshotId);
  const limits = dependencyLimits(tuning.dependencies);
  const versions = listed.some((item) => item.type === 'Flow')
    ? await readFlowVersions(session, { apiVersion, limits })
    : null;
  // With the ids the org listed its components with, a query that reaches the limit of rows can be asked again
  // for a part of the components. The ids of the versions of flows are among them: the org does not list the id
  // of an active version that has a newer one.
  const ids = new Map<string, string[]>();
  const add = (type: string, id: string): void => {
    const ofType = ids.get(type);
    if (ofType === undefined) ids.set(type, [id]);
    else ofType.push(id);
  };
  for (const item of listed) if (item.id !== null) add(item.type, item.id);
  for (const flow of versions?.flows ?? []) {
    for (const id of [flow.active, flow.latest]) if (id !== null) add('Flow', id);
  }
  // Both readings count against the daily limit of requests of the org. They are counted together, and the rows
  // are read with the requests that are left.
  const before = versions?.requests ?? 0;
  const reading = await readDependencies(session, {
    apiVersion,
    limits: { ...limits, requestsInAll: limits.requestsInAll - before },
    idsOfType: (type) => ids.get(type) ?? [],
    onProgress: (requests, rows) => {
      onProgress(before + requests, rows);
    },
  });
  const requests = before + reading.requests;
  store.write(() => {
    writeDependencies(store, snapshotId, { ...reading, requests }, now());
    writeFlowVersions(store, snapshotId, versions?.flows ?? []);
    // A snapshot that was interrupted after an earlier reading has the warning of that reading.
    removeIssues(store, snapshotId, ['CROSS_CHECK_NOT_READ', 'CROSS_CHECK_PARTIAL', 'FLOW_VERSIONS_NOT_READ']);
    if (reading.state === 'none') {
      issue(
        store,
        snapshotId,
        'warning',
        'CROSS_CHECK_NOT_READ',
        `The Dependency API of the org gave no answer (${reading.code ?? 'NO_CODE'}). What the analysis of this snapshot finds is not held against what Salesforce knows.`,
        { code: reading.code, requests },
      );
      return;
    }
    // An answer can also be whole and leave out a flow the org listed.
    const notNamed = versions === null ? 0 : flowsNotNamed(listed, versions.flows);
    if (versions !== null && (versions.state !== 'whole' || notNamed > 0)) {
      const which =
        versions.state === 'whole'
          ? `${plural(notNamed, 'flow', 'flows')} it listed`
          : `${versions.state === 'none' ? 'its flows' : 'all of its flows'} (${versions.code ?? 'NO_CODE'})`;
      issue(
        store,
        snapshotId,
        'warning',
        'FLOW_VERSIONS_NOT_READ',
        `The org did not name the versions of ${which}. A row of the Dependency API from the active version of a flow that has a newer version is not compared: the org does not list the id of that version.`,
        {
          code: versions.code,
          state: versions.state,
          flows: versions.flows.length,
          notNamed,
          requests: versions.requests,
        },
      );
    }
    if (reading.state === 'partial') {
      const left = reading.cutOff + reading.failed;
      const said: string[] = [];
      if (left > 0) {
        said.push(
          `${plural(left, 'query', 'queries')} of the Dependency API ${left === 1 ? 'was' : 'were'} cut off at its limit of rows or failed. Rows are missing.`,
        );
      }
      if (reading.unproven > 0) {
        said.push(
          `${plural(reading.unproven, 'query', 'queries')} at the limit of rows ${reading.unproven === 1 ? 'was' : 'were'} asked again component by component. The rows of a component the org did not list may be missing.`,
        );
      }
      issue(
        store,
        snapshotId,
        'warning',
        'CROSS_CHECK_PARTIAL',
        `${said.join(' ')} A reference that Salesforce knows and the analysis missed may go unseen.`,
        {
          cutOff: reading.cutOff,
          failed: reading.failed,
          unproven: reading.unproven,
          code: reading.code,
          rows: reading.rows.length,
        },
      );
    }
  });
}

/**
 * Ends a snapshot whose chunks are all done: counts what came back against
 * what the org listed, names what is missing, and sets the status. The
 * snapshot is partial if something of the logic tier is missing.
 */
function finish(store: Store, snapshotId: number): void {
  store.write(() => {
    const coverage = new Map(readCoverage(store, snapshotId).map((row) => [row.type, row]));
    const counts = countInventory(store, snapshotId);
    for (const [type, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const row = coverage.get(type);
      const notes = [row?.note ?? null];
      if (count.listed > count.retrieved) {
        const missing = missingComponents(store, snapshotId, type);
        const tier = tierOf(type);
        const said = `${plural(missing.length, 'component', 'components')} of the type ${type} that the org listed did not come back. The first: ${missing[0] ?? ''}`;
        // A file of parts that the org lists and has no part for. Whether its parts could be listed is told by
        // the listing of their type, which is an error of its own if it failed.
        const parts = HOLDS_ONLY[type];
        if (parts !== undefined && (counts.get(parts)?.listed ?? 0) === 0) {
          issue(
            store,
            snapshotId,
            'warning',
            'NOT_RETRIEVED',
            `${said}. The org lists no component of the type ${parts}, and such a file holds nothing else, so the snapshot is not partial for it.`,
            { type, ...named(missing), tier, holdsNothing: true },
          );
        } else {
          issue(store, snapshotId, severityIn(tier), 'NOT_RETRIEVED', missingIn(tier, said), {
            type,
            ...named(missing),
            tier,
          });
        }
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
    // What was read decides, and of that what counts against the logic tier: only that is an error. An issue of
    // an analysis says nothing about the reading.
    const complete = !readIssues(store, snapshotId).some((one) => one.stage === 'read' && one.severity === 'error');
    finishSnapshot(store, snapshotId, {
      status: complete ? 'complete' : 'partial',
      finishedAt: now(),
      gitCommit: null,
    });
  });
}
