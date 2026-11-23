/**
 * A reference as a file writes it, before its names are resolved, and the step that resolves it.
 *
 * Reading and resolving are two steps. Reading takes the names with their places out of one file and needs
 * nothing else, so the file can be let go. Resolving needs the model of all objects, which exists only once
 * every file was read. Every reader of this layer hands its names over in this form: the reader of objects,
 * fields and rules (`objects.ts`) and the readers of formulas and of merge fields (`names-in-text.ts`).
 */
import { foldName, type ComponentKey } from '../core/keys.ts';
import { validateReference, type Reference, type ReferenceOrigin } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { walkPath, type ObjectModel, type PathHint, type Target } from './model.ts';
import type { NameAt } from './values.ts';

/**
 * How the source names the target of a reference. It is kept on the reference, so that an answer can say why
 * one component refers to another.
 */
export type Via =
  'lookup' | 'filter' | 'summary' | 'controlling-field' | 'value-set' | 'display-field' | 'formula' | 'merge-field';

/** What every reference says before its names are resolved. */
interface Raw {
  readonly via: Via;
  /** Set for a name that was found among the tokens of a formula that could not be read as a whole. */
  readonly tier?: 'probable';
}

/** A reference as a file writes it, before its names are resolved. */
export type RawReference = Raw &
  (
    | /** The name of an object. */ { readonly form: 'object'; readonly at: NameAt }
    | /** The name of a field of the object the component belongs to. */ { readonly form: 'field'; readonly at: NameAt }
      /**
       * The name of a component of another type. `fullName` is the name it is looked for under, where that is
       * more than the name at the place: the record of a custom metadata type is named with its type.
       */
    | { readonly form: 'component'; readonly type: string; readonly at: NameAt; readonly fullName?: string }
    /**
     * A path of names from an object: relationships, and a field at the end. Every relationship is a read of
     * the field behind it, and `kind` is what the path says about the field at its end. `value` is the value
     * of a picklist that a formula compares that field with.
     */
    | {
        readonly form: 'path';
        readonly start: string;
        readonly names: readonly (NameAt & PathHint)[];
        readonly kind: 'reads' | 'references';
        readonly value?: string;
      }
  );

/** Something in a file that a reader does not read as a name. */
export interface Unread {
  /** The element that holds it. */
  readonly element: string;
  /** What stands there, cut after `LONGEST_TEXT_SHOWN` characters. */
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** At most this many characters of a text that is not a name, or of one name, are shown in an issue. */
export const LONGEST_TEXT_SHOWN = 60;
/** At most this many characters of a path that was not followed are shown, and this many of its names are kept. */
const LONGEST_PATH_SHOWN = 200;
const MOST_NAMES_SHOWN = 20;

/** The component the names of a file are resolved for. */
interface Owner {
  readonly key: ComponentKey;
  /** The file the names stand in. */
  readonly file: string;
  /** The name of the object the component belongs to. A name of the form `field` is looked for on it. */
  readonly object: string;
}

/**
 * Resolves the names one element holds against the model. Gives one reference for each name that was reached,
 * and an issue for each path that could not be walked to its end. `origin` is the reader that found the names.
 *
 * The field `Id` at the end of a path gives no reference: it cannot be changed or deleted, so nothing depends
 * on it in a way that matters. The relationships before it are read all the same.
 */
export function resolveReferences(
  model: ObjectModel,
  owner: Owner,
  raw: readonly RawReference[],
  origin: ReferenceOrigin,
): { references: Reference[]; issues: AnalysisIssue[] } {
  const references: Reference[] = [];
  const issues: AnalysisIssue[] = [];
  /**
   * `more` is what the reference says beyond how the source names its target: for a field that was not found,
   * and so has no key, the object it was looked for on.
   */
  const add = (
    at: NameAt,
    target: Target,
    kind: 'reads' | 'references',
    one: Raw,
    more: Readonly<Record<string, string>> = {},
  ): void => {
    const { object, ...rest } = more;
    references.push(
      validateReference({
        from: owner.key,
        to: target.to,
        toType: target.toType,
        toNameRaw: at.name,
        kind,
        origin,
        confidence: one.tier ?? 'confirmed',
        resolution: target.resolution,
        location: { file: owner.file, line: at.line, column: at.column },
        attrs: { via: one.via, ...rest, ...(target.to === null && object !== undefined ? { object } : {}) },
      }),
    );
  };

  for (const one of raw) {
    if (one.form === 'object') add(one.at, model.object(one.at.name), 'references', one);
    else if (one.form === 'field') {
      add(one.at, model.field(owner.object, one.at.name), 'references', one, { object: owner.object });
    } else if (one.form === 'component') {
      add(one.at, model.component(one.type, one.fullName ?? one.at.name), 'references', one);
    } else {
      const walk = walkPath(
        model,
        one.start,
        one.names.map((at) => at.name),
        one.names,
      );
      walk.steps.forEach((target, index) => {
        const at = one.names[index];
        const on = walk.on[index];
        if (at === undefined || on === undefined) return;
        const last = index === one.names.length - 1;
        if (last && foldName(at.name) === 'id') return;
        const value = last && one.value !== undefined ? { value: one.value } : {};
        add(at, target, last ? one.kind : 'reads', one, { object: on, ...value });
      });
      const last = one.names[walk.steps.length - 1];
      if (!walk.complete && last !== undefined) {
        // A formula can hold a path of any length. The issue shows the start of what was not followed.
        const rest = one.names.slice(walk.steps.length, walk.steps.length + MOST_NAMES_SHOWN).map((at) => at.name);
        issues.push({
          severity: 'warning',
          code: 'PATH_NOT_FOLLOWED',
          message: `${owner.file}, line ${String(last.line)}: it is not known which object "${cut(last.name, LONGEST_TEXT_SHOWN)}" leads to, so "${cut(rest.join('.'), LONGEST_PATH_SHOWN)}" after it was not followed.`,
          componentKey: owner.key,
          details: {
            path: owner.file,
            line: last.line,
            column: last.column,
            relationship: last.name,
            notFollowed: rest,
            origin,
          },
        });
      }
    }
  }
  return { references, issues };
}
