/**
 * What an analysis hands on: components, the work of each origin, and what went wrong.
 *
 * The analysers of this layer produce these, and the store writes them (`store/analysis.ts`).
 */
import type { JsonValue } from '../core/errors.ts';
import type { ComponentKey } from '../core/keys.ts';
import type { Reference, ReferenceOrigin } from '../core/references.ts';

/** What an analysis found for one component. */
export interface AnalysedComponent {
  readonly key: ComponentKey;
  /** The name as the source spells it. */
  readonly name: string;
  /**
   * What defines the component in the source: the path of its file, and the SHA-256 of its content. For a
   * component that is a part of a file, the content is that part. `null`: the source names the component and
   * does not define it.
   */
  readonly definition: { readonly path: string; readonly contentHash: Uint8Array } | null;
  /** What the analysis read of the component. `null`: nothing of it was analysed. */
  readonly attrs: Readonly<Record<string, JsonValue>> | null;
  /** The references that start from this component. Each has passed `validateReference`. */
  readonly references: readonly Reference[];
}

/** What the analyser of one origin looked at. The store counts the references itself. */
export interface OriginWork {
  readonly origin: ReferenceOrigin;
  /** Components the analyser looked at. */
  readonly components: number;
  /**
   * Files it tried to read and could not: files that could not be opened, and files its reader refused. A file
   * of a type that the analyser does not read is counted if the analyser opened it, which it does to say what
   * defines a component. For the origin `parser:formula` it is another count: the files with a formula that
   * was not read as a whole. The names of such a formula are recorded all the same.
   */
  readonly failedFiles: number;
}

/**
 * Something that went wrong or is uncertain in an analysis. It has the shape of an issue of a snapshot, and is
 * stored as one of the stage `analysis`.
 */
export interface AnalysisIssue {
  readonly severity: 'error' | 'warning' | 'info';
  /** A stable code in upper case, such as `PATH_NOT_FOLLOWED`. */
  readonly code: string;
  readonly message: string;
  /** The component the issue is about, if it is about one. */
  readonly componentKey: string | null;
  readonly details: Readonly<Record<string, JsonValue>> | null;
}

/**
 * A text as a message shows it: at most `longest` code units of it, and never half of a character outside the
 * basic plane, which a database cannot hold as it is.
 */
export function cut(text: string, longest: number): string {
  const part = text.slice(0, longest);
  return /[\uD800-\uDBFF]$/.test(part) && text.length > longest ? part.slice(0, -1) : part;
}
