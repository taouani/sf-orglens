/**
 * The one shape every source is read into: a list of files with their
 * content, and what is known about the reading.
 *
 * A folder, a commit of a Git repository and (later) a retrieve from an org
 * all become a `SourceTree`. Everything after that, from resolving
 * components to storing a snapshot, works on this shape and does not know
 * where the files came from.
 */
import type { JsonValue } from '../core/errors.ts';

export interface SourceTree {
  /**
   * The files, by their path inside the source: relative, with forward
   * slashes, without duplicates, sorted by code unit.
   */
  readonly files: readonly string[];
  /** The content of one of `files`, byte for byte. Throws for any other path. */
  read(path: string): Uint8Array;
}

/** A tree, and what was asked for and is not in it. */
export interface TreeReading {
  readonly tree: SourceTree;
  /** The folders that were asked for and do not exist, sorted. */
  readonly missing: readonly string[];
  /**
   * Entries that are not read, sorted: symbolic links, submodules and
   * other repositories inside the source, special files. A folder that was
   * asked for can be among them.
   */
  readonly skipped: readonly string[];
  /** Folders that could not be listed, sorted, each with the code of the system error if it has one. */
  readonly unreadable: readonly { readonly path: string; readonly reason: string | null }[];
  /**
   * Entries whose name is not UTF-8, sorted. They are not read: a path is
   * text everywhere after this. Each is shown with a replacement character
   * where the name is not UTF-8.
   */
  readonly undecodable: readonly string[];
}

/** The code of a system error, such as `EACCES`, or `null` if what was thrown has none. */
export function systemCode(thrown: unknown): string | null {
  const code = (thrown as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : null;
}

/** Something that went wrong or is uncertain while a source was read. Nothing is dropped without one. */
export interface SourceIssue {
  readonly severity: 'error' | 'warning' | 'info';
  /** A stable code in upper case, such as `LINK_SKIPPED`. */
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, JsonValue>>;
}

/** Compares by code unit, so that the order is the same on every system and in every locale. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** At most this many paths are listed in the details of one issue. The count is always exact. */
const PATHS_PER_ISSUE = 50;

/** The details of an issue about a list of paths: the count, and the first paths. */
export function pathDetails(paths: readonly string[]): Readonly<Record<string, JsonValue>> {
  return { count: paths.length, paths: paths.slice(0, PATHS_PER_ISSUE) };
}

/** A tree of the files that pass `keep`, reading from the tree it was made of. */
export function filterTree(tree: SourceTree, keep: (path: string) => boolean): SourceTree {
  const files = tree.files.filter(keep);
  const kept = new Set(files);
  return {
    files,
    read: (path) => {
      if (!kept.has(path)) throw new Error(`"${path}" is not a file of this tree.`);
      return tree.read(path);
    },
  };
}
