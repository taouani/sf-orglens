/**
 * The inventory of an org: every metadata type it describes, and every
 * component it lists of each.
 *
 * The inventory is what a snapshot of an org is measured against. A type
 * whose listing the org refuses is recorded as failed, with what the org
 * said. It is never taken for a type without components.
 *
 * One request lists one type. Salesforce takes three types per request,
 * and then one type it refuses loses the answer for the other two.
 *
 * A type the configuration leaves out is not asked for at all. It is in
 * the inventory as `excluded`, without components.
 */
import { tierOf } from '../core/tiers.ts';
import { isAboutTheOrg, MetadataRequestError, type ListedComponent, type MetadataApi } from './metadata-api.ts';
import { byCodeUnit } from './tree.ts';

/**
 * A type of the inventory.
 *
 * - `top`: its components are retrieved by their own name.
 * - `part`: its components are parts of a component of the type `of`, such as the fields of an object, and come
 *   with it.
 * - `folder`: its components are the folders of the type `of`, such as `ReportFolder` of `Report`. A folder is
 *   retrieved by its name under the type `of`.
 */
interface InventoryType {
  readonly type: string;
  readonly role: 'top' | 'part' | 'folder';
  readonly of: string | null;
  /**
   * - `ok`: the org listed the components of the type.
   * - `failed`: the org refused, for the type or for one of its folders. `reason` says what it said. Components
   *   that were listed before are kept.
   * - `unlistable`: Salesforce does not list components of this type at all.
   * - `excluded`: the configuration leaves the type out, or the type it is a part of or holds the folders of.
   *   The org was not asked, and `reason` says which type the configuration names.
   */
  readonly listing: 'ok' | 'failed' | 'unlistable' | 'excluded';
  readonly reason: string | null;
  /** The code of Salesforce for the refusal `reason` tells of, if it gave one. */
  readonly code: string | null;
}

/**
 * A type the configuration asks to leave out, and that is read all the same.
 *
 * - `unknown`: the org describes no type of the name.
 * - `part`: its components are parts of a component of the type `of` and come with it.
 * - `folder`: its components are the folders of the type `of`, which are needed to list that type.
 * - `logic-part`: a part of it, the type `of`, is of the logic tier, which a snapshot is judged by.
 */
export interface NotExcluded {
  readonly type: string;
  readonly reason: 'unknown' | 'part' | 'folder' | 'logic-part';
  readonly of: string | null;
}

export interface Inventory {
  /** Sorted by type. */
  readonly types: readonly InventoryType[];
  /** What the configuration asks to leave out and cannot be left out, sorted by type. */
  readonly notExcluded: readonly NotExcluded[];
  /** Sorted by type, then by full name. No component is in it twice. */
  readonly items: readonly ListedComponent[];
  /** How many requests it took. */
  readonly requests: number;
}

/** How many listings are asked for at the same time. */
const DEFAULT_CONCURRENCY = 6;

/**
 * When the org refuses more than half of at least this many listings, the refusals are not about the types: the
 * inventory fails, with what the org said first.
 */
const REFUSALS_COUNT_FROM = 10;

/**
 * Types whose folders are a type of another name than the type with `Folder` added. Taken from the documentation
 * of the Metadata API.
 */
const FOLDER_TYPE: Readonly<Record<string, string>> = { EmailTemplate: 'EmailFolder' };

/** The folder that holds what is in no folder. The org does not list it among the folders. */
const UNFILED = 'unfiled$public';
const HAS_UNFILED: ReadonlySet<string> = new Set(['Report', 'EmailTemplate']);

/**
 * Types that are described and cannot be listed: Salesforce answers with no components, whatever the org holds.
 * Standard value sets are the known case.
 */
const UNLISTABLE: Readonly<Record<string, string>> = {
  StandardValueSet: 'Salesforce does not list standard value sets. They are not read yet.',
};

/** Runs the tasks with at most `limit` of them at a time. The first failure ends it: tasks not yet started are skipped. */
async function pool<T>(tasks: readonly T[], limit: number, work: (task: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < tasks.length) {
      const task = tasks[next] as T;
      next += 1;
      try {
        await work(task);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
}

/**
 * Asks the org what it holds.
 *
 * Throws a `MetadataRequestError` if the org cannot be reached, does not accept the session, or refuses for a
 * reason that holds for the whole org, such as a used-up limit of requests: then nothing the org would say about
 * a single type means anything. The same holds when it refuses most of the listings, whatever its reason.
 */
export async function takeInventory(
  api: MetadataApi,
  options: {
    readonly concurrency?: number;
    /**
     * The types to leave out, by name. Only a type that is retrieved by its own name can be left out. Its parts
     * and its folders are left out with it. Any other name is returned in `notExcluded`, and nothing is left
     * out for it.
     */
    readonly exclude?: readonly string[];
    /** Called after every listing, with the number of listings that are done and that are known to be needed. */
    readonly onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<Inventory> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const described = await api.describe();
  let requests = 1;

  /** A refusal: what the org said, and its code for it. */
  interface Failure {
    readonly said: string;
    readonly code: string | null;
  }
  const types = new Map<string, { role: InventoryType['role']; of: string | null; failures: Failure[] }>();
  const add = (type: string, role: InventoryType['role'], of: string | null): void => {
    if (!types.has(type)) types.set(type, { role, of, failures: [] });
  };
  // The type of the folders of a type is a folder type, also if the org describes it on its own: its components
  // are retrieved under the type of what they hold, and say which folders to list.
  for (const type of described) {
    if (type.inFolder) add(FOLDER_TYPE[type.name] ?? `${type.name}Folder`, 'folder', type.name);
  }
  // A type the org describes on its own is retrieved by its own name, also if another type names it as a part.
  for (const type of described) add(type.name, 'top', null);
  for (const type of described) {
    for (const child of type.children) add(child, 'part', type.name);
  }
  const inFolders = new Set(described.filter((type) => type.inFolder).map((type) => type.name));

  // What is left out: the type the configuration names, with its parts and its folders. The value is the name
  // the configuration gave.
  const excluded = new Map<string, string>();
  const notExcluded: NotExcluded[] = [];
  for (const name of [...new Set(options.exclude ?? [])].sort(byCodeUnit)) {
    const entry = types.get(name);
    if (entry === undefined) {
      notExcluded.push({ type: name, reason: 'unknown', of: null });
    } else if (entry.role !== 'top') {
      notExcluded.push({ type: name, reason: entry.role, of: entry.of });
    } else {
      const withIt = [...types].filter(([, other]) => other.role !== 'top' && other.of === name).map(([type]) => type);
      const logic = withIt.sort(byCodeUnit).find((type) => tierOf(type) === 'logic');
      if (logic === undefined) for (const type of [name, ...withIt]) excluded.set(type, name);
      else notExcluded.push({ type: name, reason: 'logic-part', of: logic });
    }
  }

  const items = new Map<string, ListedComponent>();
  let done = 0;
  let total = 0;
  let refusals = 0;
  let firstRefusal: MetadataRequestError | undefined;
  const list = async (type: string, folder?: string): Promise<ListedComponent[]> => {
    requests += 1;
    let listed: ListedComponent[] = [];
    try {
      listed = await api.list(type, folder);
    } catch (error) {
      if (!(error instanceof MetadataRequestError) || error.kind !== 'refused' || isAboutTheOrg(error)) throw error;
      refusals += 1;
      firstRefusal ??= error;
      const said = `${error.code === null ? '' : `${error.code}: `}${error.message}`;
      types
        .get(type)
        ?.failures.push({ said: folder === undefined ? said : `Folder ${folder}: ${said}`, code: error.code });
    }
    for (const item of listed) {
      const id = `${item.type}\n${item.fullName}`;
      if (!items.has(id)) items.set(id, item);
    }
    done += 1;
    options.onProgress?.(done, total);
    return listed;
  };

  // First everything that is listed by its type alone: the types, the parts, and the folders.
  const direct = [...types.keys()]
    .filter((type) => !inFolders.has(type) && !(type in UNLISTABLE) && !excluded.has(type))
    .sort(byCodeUnit);
  total = direct.length;
  const folders = new Map<string, string[]>();
  await pool(direct, concurrency, async (type) => {
    const listed = await list(type);
    const entry = types.get(type);
    if (entry?.role === 'folder' && entry.of !== null) {
      folders.set(entry.of, [...(folders.get(entry.of) ?? []), ...listed.map((item) => item.fullName)]);
    }
  });

  // Then what lies in folders, one listing per folder.
  const inFolder = [...inFolders]
    .filter((type) => !excluded.has(type))
    .sort(byCodeUnit)
    .flatMap((type) => {
      const names = new Set([...(folders.get(type) ?? []), ...(HAS_UNFILED.has(type) ? [UNFILED] : [])]);
      return [...names].sort(byCodeUnit).map((folder) => ({ type, folder }));
    });
  total += inFolder.length;
  await pool(inFolder, concurrency, async ({ type, folder }) => {
    await list(type, folder);
  });

  if (firstRefusal !== undefined && done >= REFUSALS_COUNT_FROM && refusals * 2 > done) {
    throw new MetadataRequestError(
      'refused',
      firstRefusal.code,
      `${firstRefusal.message} The org refused ${String(refusals)} of ${String(done)} requests for the components of a type.`,
      firstRefusal,
    );
  }

  return {
    types: [...types]
      .map(([type, { role, of, failures }]): InventoryType => {
        // A type whose folders could not be listed has an unknown number of components.
        const folderType = FOLDER_TYPE[type] ?? `${type}Folder`;
        const foldersFailed = inFolders.has(type) ? (types.get(folderType)?.failures ?? []) : [];
        const all: Failure[] = [
          ...failures,
          ...foldersFailed.map(({ said, code }) => ({ said: `Its folders could not be listed: ${said}`, code })),
        ];
        const by = excluded.get(type);
        if (by !== undefined) {
          const reason =
            by === type
              ? 'The configuration leaves this type out (exclude_types).'
              : `The configuration leaves the type ${by} out (exclude_types), and this type with it.`;
          return { type, role, of, listing: 'excluded', reason, code: null };
        }
        if (type in UNLISTABLE) {
          return { type, role, of, listing: 'unlistable', reason: UNLISTABLE[type] ?? null, code: null };
        }
        const [first] = all;
        return {
          type,
          role,
          of,
          listing: first === undefined ? 'ok' : 'failed',
          reason: first?.said ?? null,
          code: first?.code ?? null,
        };
      })
      .sort((a, b) => byCodeUnit(a.type, b.type)),
    notExcluded,
    items: [...items.values()].sort((a, b) => byCodeUnit(a.type, b.type) || byCodeUnit(a.fullName, b.fullName)),
    requests,
  };
}
