/**
 * The journal of a snapshot of an org: what the org listed, the chunks of
 * the retrieve with the state of each, and what came back.
 *
 * A snapshot of an org is written in many small transactions over minutes.
 * After each of them the database says exactly how far the snapshot is, so
 * that a process that was stopped anywhere is picked up by the next one.
 */
import type { Store } from './open.ts';

/** A component to retrieve. */
export interface ChunkMember {
  readonly type: string;
  readonly fullName: string;
}

/** A component the org listed. */
export interface InventoryRow extends ChunkMember {
  readonly salesforceId: string | null;
  readonly lastModifiedAt: string | null;
  readonly namespacePrefix: string | null;
  readonly manageableState: string | null;
}

/** Stores what the org listed. */
export function addInventory(store: Store, snapshotId: number, items: readonly InventoryRow[]): void {
  for (const item of items) {
    store.run(
      `INSERT INTO inventory_item
         (snapshot_id, type, full_name, salesforce_id, last_modified_at, namespace_prefix, manageable_state)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      snapshotId,
      item.type,
      item.fullName,
      item.salesforceId,
      item.lastModifiedAt,
      item.namespacePrefix,
      item.manageableState,
    );
  }
}

/** What a retrieve asked for, and what Salesforce remarked about it. */
export interface RetrieveAsked {
  /** The members the retrieve named. */
  readonly asked: readonly ChunkMember[];
  /** The members of which Salesforce remarked that it cannot find them. */
  readonly notFound: readonly ChunkMember[];
}

/**
 * Why a component that came back under a name the org had not listed is the component the org listed under
 * another name:
 *
 * - `prefix`: a component of a package. The org lists it as `pkg__thing` and hands out `thing`.
 * - `file-ending`: a document. The org lists it with the ending of its file, as `Folder/name.png`, and the
 *   Salesforce library names it `Folder/name`.
 * - `person-account`: something of person accounts. The org lists it under the object `Account`, as
 *   `Account.thing`, and hands it out under the object `PersonAccount`, as `PersonAccount.thing`.
 * - `folder-path`: a report, a dashboard or a folder of them in a folder that lies in a folder. The org lists it
 *   without the outer folders, as `Sub/thing`, and hands it out under the whole path, as `Top/Sub/thing`.
 */
export type OtherNameRule = 'prefix' | 'file-ending' | 'person-account' | 'folder-path';

/** A component the org listed that came back under another name, as the org lists it. */
export interface FoundUnderAnotherName extends ChunkMember {
  /** The rule that takes what came back for it. */
  readonly rule: OtherNameRule;
}

/** What stands between the prefix of a package and the name of a component. */
const AFTER_PREFIX = '__';
/** The one type whose components the org lists with the ending of their file. */
const DOCUMENT = 'Document';
/** How the name of something of person accounts starts where the org lists it, and where it hands it out. */
const OF_ACCOUNT = 'Account.';
const OF_PERSON_ACCOUNT = 'PersonAccount.';
/**
 * The types whose folders can lie in folders, and the types of those folders. The org lists a component of them
 * without the folders around the innermost one.
 */
const IN_FOLDERS_OF_FOLDERS: ReadonlySet<string> = new Set(['Dashboard', 'DashboardFolder', 'Report', 'ReportFolder']);
/**
 * The types of those folders, each with the type a retrieve asks for a folder under: the type of what it holds. No
 * retrieve names a folder under its own type, and Salesforce remarks on a folder under the other one.
 */
const FOLDER_ASKED_AS: ReadonlyMap<string, string> = new Map([
  ['DashboardFolder', 'Dashboard'],
  ['ReportFolder', 'Report'],
]);

const idOf = (member: ChunkMember): string => `${member.type}\n${member.fullName}`;

/** A member of a retrieve that can be the listed name of a component that came back, with the rule that says so. */
interface Candidate {
  readonly member: ChunkMember;
  readonly rule: OtherNameRule;
}

/** A listed name that stands for a component that came back, and whether it was marked as retrieved before. */
interface ListedName {
  readonly fullName: string;
  readonly retrieved: boolean;
  readonly rule: OtherNameRule;
}

/**
 * The name of a document without the ending of its file: `Folder/name.png` gives `Folder/name`. The name of the
 * file is cut at its first dot, as the Salesforce library does it.
 */
function withoutFileEnding(fullName: string): string {
  const file = fullName.lastIndexOf('/') + 1;
  const dot = fullName.indexOf('.', file);
  return dot > file ? fullName.slice(0, dot) : fullName;
}

/**
 * Notes the components that came back in a retrieve. One that the org had not listed gets a row of its own,
 * marked as not listed.
 *
 * A component can come back under another name than the org lists it with (`OtherNameRule`). A component that
 * came back under a name without a row is taken for a component the org listed when exactly one listed name can
 * stand for it, by one of these rules:
 *
 * - `prefix`: the retrieve asked for a name that is the name that came back behind a prefix and two underscores,
 *   and the org states that prefix as the package of the listed component.
 * - `file-ending`: the type is `Document`, and the retrieve asked for a name that is the name that came back
 *   with an ending behind the name of the file.
 * - `person-account`: the name that came back starts with `PersonAccount.`, and the org lists the same name with
 *   `Account.` in that place. The retrieve asked for that listed name, or for no component of the type at all,
 *   as it is with a part, which comes with its parent.
 * - `folder-path`: the type is a report, a dashboard or a folder of them, and the org lists an end of the name that
 *   came back, behind one of its slashes: `Top/Sub/Monthly` is listed as `Sub/Monthly`, and the folder `Top/Sub` as
 *   `Sub`. For a report or a dashboard, the retrieve asked for that listed name. For a folder, which is asked for
 *   under the type of what it holds, the retrieve asked for no component of the type of the folder.
 *
 * And all of this holds:
 *
 * - the retrieve did not ask for the name that came back, and the org lists nothing under it;
 * - the listed name did not come back itself in the same retrieve;
 * - Salesforce did not remark that it cannot find the listed name, for a folder under the type of what it holds;
 * - no other component that came back in the same retrieve stands for the same listed name.
 *
 * Then the row of the listed name is marked, with the name that came back (decision record 0076), and no row is
 * made for the name that came back. Without `retrieve`
 * no component is taken this way. Returned: the listed names that were found this way for the first time, with
 * their type and the rule.
 */
export function markRetrieved(
  store: Store,
  snapshotId: number,
  components: readonly ChunkMember[],
  retrieve?: RetrieveAsked,
): FoundUnderAnotherName[] {
  const asked = new Set(retrieve?.asked.map(idOf));
  const askedTypes = new Set(retrieve?.asked.map((member) => member.type));
  const notFound = new Set(retrieve?.notFound.map(idOf));
  const cameBack = new Set(components.map(idOf));
  // The members that can come back under another name, by that name. It is read from the members, not from the
  // table, which can hold a hundred thousand rows of a type.
  let byOtherName: Map<string, Candidate[]> | undefined;
  const amongAsked = (component: ChunkMember): readonly Candidate[] => {
    if (byOtherName === undefined) {
      const found = new Map<string, Candidate[]>();
      const add = (fullName: string, member: ChunkMember, rule: OtherNameRule): void => {
        const other = idOf({ type: member.type, fullName });
        found.set(other, [...(found.get(other) ?? []), { member, rule }]);
      };
      for (const member of retrieve?.asked ?? []) {
        const at = member.fullName.indexOf(AFTER_PREFIX);
        if (at > 0) add(member.fullName.slice(at + AFTER_PREFIX.length), member, 'prefix');
        if (member.type === DOCUMENT) {
          const short = withoutFileEnding(member.fullName);
          if (short !== member.fullName) add(short, member, 'file-ending');
        }
      }
      byOtherName = found;
    }
    return byOtherName.get(idOf(component)) ?? [];
  };
  /** The listed names that can stand for a component, each with its rule. */
  const candidatesOf = (component: ChunkMember): readonly Candidate[] => {
    const candidates = [...amongAsked(component)];
    // A name that is worked out from the one that came back counts when the retrieve asked for it, or, where
    // `unasked` says so, for no component of the type at all.
    const unnamed = !askedTypes.has(component.type);
    const offer = (fullName: string, rule: OtherNameRule, unasked: boolean): void => {
      const member = { type: component.type, fullName };
      if (asked.has(idOf(member)) || unasked) candidates.push({ member, rule });
    };
    if (component.fullName.startsWith(OF_PERSON_ACCOUNT)) {
      // A part comes with its parent.
      offer(`${OF_ACCOUNT}${component.fullName.slice(OF_PERSON_ACCOUNT.length)}`, 'person-account', unnamed);
    }
    if (IN_FOLDERS_OF_FOLDERS.has(component.type)) {
      // Every end of the path behind a slash: the org lists the innermost folder, and the report with it. A folder
      // is asked for under the type of what it holds.
      const folder = FOLDER_ASKED_AS.has(component.type) && unnamed;
      let slash = component.fullName.indexOf('/');
      while (slash !== -1) {
        offer(component.fullName.slice(slash + 1), 'folder-path', folder);
        slash = component.fullName.indexOf('/', slash + 1);
      }
    }
    return candidates;
  };
  /** The listed name a component without a row came back for, if the rules above give exactly one. */
  const listedNameOf = (component: ChunkMember): ListedName | undefined => {
    if (retrieve === undefined || asked.has(idOf(component))) return undefined;
    const found: ListedName[] = [];
    for (const { member, rule } of candidatesOf(component)) {
      const row = store.get(
        `SELECT namespace_prefix, retrieved FROM inventory_item
          WHERE snapshot_id = ? AND type = ? AND full_name = ? AND listed = 1`,
        snapshotId,
        member.type,
        member.fullName,
      );
      if (row === undefined) continue;
      // What a name looks like does not decide: the org states the package of a component.
      const prefix = member.fullName.slice(0, member.fullName.indexOf(AFTER_PREFIX));
      if (rule === 'prefix' && row['namespace_prefix'] !== prefix) continue;
      found.push({ fullName: member.fullName, retrieved: Number(row['retrieved']) !== 0, rule });
    }
    // Two listed names that can stand for it, such as two packages with a component of the same short name:
    // nothing says which one came back.
    const [only] = found.length === 1 ? found : [];
    if (only === undefined) return undefined;
    const listed = idOf({ type: component.type, fullName: only.fullName });
    // Salesforce remarks on a name under the type it was asked for under.
    const askedAs = idOf({ type: FOLDER_ASKED_AS.get(component.type) ?? component.type, fullName: only.fullName });
    return notFound.has(askedAs) || cameBack.has(listed) ? undefined : only;
  };

  // The listed name each component stands for, before any row changes. Two components of one retrieve that stand
  // for the same listed name, such as two folders of one name in two folders: nothing says which one it is.
  const standing = components.map((component) => {
    const known = store.get(
      'SELECT 1 AS found FROM inventory_item WHERE snapshot_id = ? AND type = ? AND full_name = ?',
      snapshotId,
      component.type,
      component.fullName,
    );
    const listedAs = known === undefined ? listedNameOf(component) : undefined;
    const listed = listedAs === undefined ? undefined : idOf({ type: component.type, fullName: listedAs.fullName });
    return { component, listedAs, listed };
  });
  const times = new Map<string, number>();
  for (const { listed } of standing) if (listed !== undefined) times.set(listed, (times.get(listed) ?? 0) + 1);

  const underAnotherName: FoundUnderAnotherName[] = [];
  for (const { component, listedAs, listed } of standing) {
    if (listedAs !== undefined && listed !== undefined && times.get(listed) === 1) {
      store.run(
        'UPDATE inventory_item SET retrieved = 1, came_back_as = ? WHERE snapshot_id = ? AND type = ? AND full_name = ?',
        component.fullName,
        snapshotId,
        component.type,
        listedAs.fullName,
      );
      if (!listedAs.retrieved) {
        underAnotherName.push({ type: component.type, fullName: listedAs.fullName, rule: listedAs.rule });
      }
      continue;
    }
    store.run(
      `INSERT INTO inventory_item (snapshot_id, type, full_name, listed, retrieved) VALUES (?, ?, ?, 0, 1)
       ON CONFLICT (snapshot_id, type, full_name) DO UPDATE SET retrieved = 1`,
      snapshotId,
      component.type,
      component.fullName,
    );
  }
  return underAnotherName;
}

/**
 * True if the org listed a component of this type under exactly this name. A name with the prefix of a package
 * is another name.
 */
export function isListed(store: Store, snapshotId: number, member: ChunkMember): boolean {
  return (
    store.get(
      'SELECT 1 FROM inventory_item WHERE snapshot_id = ? AND type = ? AND full_name = ? AND listed = 1',
      snapshotId,
      member.type,
      member.fullName,
    ) !== undefined
  );
}

/**
 * Notes that a component the org listed is not in the snapshot after all, although a retrieve handed out a
 * file for it: the file was not the one the snapshot is to hold.
 */
export function markNotRetrieved(store: Store, snapshotId: number, member: ChunkMember): void {
  store.run(
    'UPDATE inventory_item SET retrieved = 0, came_back_as = NULL WHERE snapshot_id = ? AND type = ? AND full_name = ?',
    snapshotId,
    member.type,
    member.fullName,
  );
}

/** Per type: how many components the org listed, how many of those came back, and how many came back unlisted. */
export function countInventory(
  store: Store,
  snapshotId: number,
): Map<string, { listed: number; retrieved: number; unlisted: number }> {
  const counts = new Map<string, { listed: number; retrieved: number; unlisted: number }>();
  const rows = store.all(
    `SELECT type, SUM(listed) AS listed, SUM(listed AND retrieved) AS retrieved, SUM(NOT listed) AS unlisted
       FROM inventory_item WHERE snapshot_id = ? GROUP BY type`,
    snapshotId,
  );
  for (const row of rows) {
    counts.set(String(row['type']), {
      listed: Number(row['listed']),
      retrieved: Number(row['retrieved']),
      unlisted: Number(row['unlisted']),
    });
  }
  return counts;
}

/** The components of a type that the org listed and that did not come back, sorted by name. */
export function missingComponents(store: Store, snapshotId: number, type: string): string[] {
  return store
    .all(
      `SELECT full_name FROM inventory_item
        WHERE snapshot_id = ? AND type = ? AND listed = 1 AND retrieved = 0 ORDER BY full_name`,
      snapshotId,
      type,
    )
    .map((row) => String(row['full_name']));
}

/** The components of a type that came back although the org had not listed them, sorted by name. */
export function unlistedComponents(store: Store, snapshotId: number, type: string): string[] {
  return store
    .all(
      'SELECT full_name FROM inventory_item WHERE snapshot_id = ? AND type = ? AND listed = 0 ORDER BY full_name',
      snapshotId,
      type,
    )
    .map((row) => String(row['full_name']));
}

/**
 * The parts of a parent that the org listed and that did not come back: the components of the given types whose
 * name is the name of the parent, a dot and a name of their own. Sorted by type and name.
 *
 * Nothing if the org lists the parent itself: then the parent is what is missing. Nothing either if the parent
 * came back, listed or not: its file is in the snapshot, and the file a part comes back in would replace it.
 */
export function missingPartsOf(
  store: Store,
  snapshotId: number,
  parent: ChunkMember,
  partTypes: readonly string[],
): ChunkMember[] {
  const known = store.get(
    `SELECT 1 AS found FROM inventory_item
      WHERE snapshot_id = ? AND type = ? AND full_name = ? AND (listed = 1 OR retrieved = 1)`,
    snapshotId,
    parent.type,
    parent.fullName,
  );
  if (known !== undefined) return [];
  // The names from `Parent.` up to, and without, `Parent/`: the slash is the character after the dot. Read by
  // the primary key, not by a pattern, in which an underscore of the name would stand for any character.
  return [...partTypes].sort().flatMap((type) =>
    store
      .all(
        `SELECT full_name FROM inventory_item
          WHERE snapshot_id = ? AND type = ? AND full_name >= ? AND full_name < ? AND listed = 1 AND retrieved = 0
          ORDER BY full_name`,
        snapshotId,
        type,
        `${parent.fullName}.`,
        `${parent.fullName}/`,
      )
      .map((row) => ({ type, fullName: String(row['full_name']) })),
  );
}

type ChunkStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Chunk {
  readonly seq: number;
  readonly status: ChunkStatus;
  readonly members: readonly ChunkMember[];
  /** How often a retrieve was started for the chunk. */
  readonly attempts: number;
  /** The job at Salesforce that retrieves the chunk, if one was started and its result is not stored yet. */
  readonly jobId: string | null;
}

/** The members of a chunk, as they are stored: grouped by type, to keep thousands of names short. */
function packMembers(members: readonly ChunkMember[]): string {
  const byType = new Map<string, string[]>();
  for (const { type, fullName } of members) {
    const names = byType.get(type);
    if (names === undefined) byType.set(type, [fullName]);
    else names.push(fullName);
  }
  return JSON.stringify([...byType].map(([type, names]) => ({ type, members: names })));
}

function unpackMembers(text: string): ChunkMember[] {
  const groups = JSON.parse(text) as { type: string; members: string[] }[];
  return groups.flatMap(({ type, members }) => members.map((fullName) => ({ type, fullName })));
}

/** Stores the plan of a retrieve: its chunks in order, none started. */
export function addChunks(store: Store, snapshotId: number, chunks: readonly (readonly ChunkMember[])[]): void {
  chunks.forEach((members, seq) => {
    store.run(
      "INSERT INTO retrieve_chunk (snapshot_id, seq, status, members) VALUES (?, ?, 'pending', ?)",
      snapshotId,
      seq,
      packMembers(members),
    );
  });
}

/**
 * The chunk to work on next: one that was started and not finished, or
 * else the first that was not started. `undefined` when none is left.
 */
export function nextChunk(store: Store, snapshotId: number): Chunk | undefined {
  const row = store.get(
    `SELECT seq, status, members, attempts, job_id FROM retrieve_chunk
      WHERE snapshot_id = ? AND status IN ('running', 'pending')
      ORDER BY status = 'running' DESC, seq LIMIT 1`,
    snapshotId,
  );
  if (row === undefined) return undefined;
  return {
    seq: Number(row['seq']),
    status: String(row['status']) as ChunkStatus,
    members: unpackMembers(String(row['members'])),
    attempts: Number(row['attempts']),
    jobId: typeof row['job_id'] === 'string' ? row['job_id'] : null,
  };
}

/** How many chunks a snapshot has in each state. */
export function countChunks(store: Store, snapshotId: number): Record<ChunkStatus, number> & { total: number } {
  const counts = { pending: 0, running: 0, done: 0, failed: 0, total: 0 };
  for (const row of store.all(
    'SELECT status, COUNT(*) AS n FROM retrieve_chunk WHERE snapshot_id = ? GROUP BY status',
    snapshotId,
  )) {
    counts[String(row['status']) as ChunkStatus] = Number(row['n']);
    counts.total += Number(row['n']);
  }
  return counts;
}

/** A retrieve was started for the chunk. From now on its job is what a resumed snapshot asks for. */
export function chunkStarted(store: Store, snapshotId: number, seq: number, jobId: string, at: string): void {
  store.run(
    `UPDATE retrieve_chunk SET status = 'running', job_id = ?, attempts = attempts + 1, started_at = ?, error = NULL
      WHERE snapshot_id = ? AND seq = ?`,
    jobId,
    at,
    snapshotId,
    seq,
  );
}

/** The chunk ended: its files are stored, or it failed for good. */
export function chunkEnded(
  store: Store,
  snapshotId: number,
  seq: number,
  end: { readonly status: 'done' | 'failed'; readonly at: string; readonly error: string | null },
): void {
  store.run(
    'UPDATE retrieve_chunk SET status = ?, job_id = NULL, finished_at = ?, error = ? WHERE snapshot_id = ? AND seq = ?',
    end.status,
    end.at,
    end.error,
    snapshotId,
    seq,
  );
}

/** The job of the chunk is gone. The chunk is to be started again. */
export function chunkForgotten(store: Store, snapshotId: number, seq: number): void {
  store.run(
    "UPDATE retrieve_chunk SET status = 'pending', job_id = NULL WHERE snapshot_id = ? AND seq = ?",
    snapshotId,
    seq,
  );
}

/**
 * Replaces a chunk by two: it keeps the first members, and a new chunk at
 * the end gets the others. Both are to be started.
 */
export function splitChunk(
  store: Store,
  snapshotId: number,
  seq: number,
  halves: readonly [readonly ChunkMember[], readonly ChunkMember[]],
): void {
  store.run(
    "UPDATE retrieve_chunk SET status = 'pending', job_id = NULL, attempts = 0, members = ? WHERE snapshot_id = ? AND seq = ?",
    packMembers(halves[0]),
    snapshotId,
    seq,
  );
  addChunk(store, snapshotId, halves[1]);
}

/** Adds a chunk at the end of the plan of a retrieve. It is to be started. */
export function addChunk(store: Store, snapshotId: number, members: readonly ChunkMember[]): void {
  store.run(
    `INSERT INTO retrieve_chunk (snapshot_id, seq, status, members)
     SELECT ?, COALESCE(MAX(seq), -1) + 1, 'pending', ? FROM retrieve_chunk WHERE snapshot_id = ?`,
    snapshotId,
    packMembers(members),
    snapshotId,
  );
}

/**
 * Sets the number of retrieved components of every type of a snapshot to what the inventory says now: the
 * components the source listed that came back.
 */
export function refreshCoverage(store: Store, snapshotId: number): void {
  store.run(
    `UPDATE snapshot_type_coverage SET retrieved = (
       SELECT COUNT(*) FROM inventory_item i
        WHERE i.snapshot_id = snapshot_type_coverage.snapshot_id AND i.type = snapshot_type_coverage.type
          AND i.listed = 1 AND i.retrieved = 1)
      WHERE snapshot_id = ?`,
    snapshotId,
  );
}
