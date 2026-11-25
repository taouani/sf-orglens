/**
 * A reference as a file writes it, before its names are resolved, and the step that resolves it.
 *
 * Reading and resolving are two steps. Reading takes the names with their places out of one file and needs
 * nothing else, so the file can be let go. Resolving needs the model of all objects, which exists only once
 * every file was read. Every reader of this layer hands its names over in this form: the reader of objects,
 * fields, rules, record types and field sets (`objects.ts`), the reader of flows (`flows.ts`), the reader of
 * workflow rules (`workflows.ts`), the reader of records of custom metadata types (`custom-metadata.ts`) and the
 * readers of formulas and of merge fields (`names-in-text.ts`).
 */
import { foldName, type ComponentKey } from '../core/keys.ts';
import { validateReference, type Reference, type ReferenceOrigin } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { namesTakenFor } from './formula-names.ts';
import { walkPath, type FieldFacts, type ObjectModel, type PathHint, type Target } from './model.ts';
import { geolocationField } from './names.ts';
import type { NameAt } from './values.ts';

/**
 * How the source names the target of a reference. It is kept on the reference, so that an answer can say why
 * one component refers to another.
 */
export type Via =
  | 'lookup'
  | 'filter'
  | 'summary'
  | 'controlling-field'
  | 'value-set'
  | 'display-field'
  | 'formula'
  | 'merge-field'
  /** In a flow: the object of a record element, of a start or of a choice set. */
  | 'object'
  /** In a flow: the resource a record element writes or deletes. The reference is to the object it is of. */
  | 'record'
  /**
   * In a flow: a name of a resource with a path, written without braces. Of a field update: the relationship
   * field it goes through to the parent it writes on.
   */
  | 'path'
  /** In a flow: the field a record element sets by its name. The field a field update writes. */
  | 'assignment'
  /** In a flow: a field a query asks for or stores. */
  | 'output'
  | 'sort'
  /** The date field a scheduled path, a time trigger or the due date of a task counts from. */
  | 'time'
  /** What a flow starts: an Apex class, a subflow, an alert. What a workflow rule starts: an action of its object. */
  | 'action'
  /** The email template of an alert. */
  | 'template'
  /**
   * A field in a list: of the recipients of an alert, of the fields an outbound message sends, of the picklists
   * of a record type, of a field set, or of the fields a record of a custom metadata type gives a value.
   */
  | 'listed-field'
  /**
   * A name that stands in a text and is compared with the name of a component: in a flow, and in a value of a
   * record of a custom metadata type that is a text.
   */
  | 'text'
  /** In a flow: the picklist field a set of choices takes its values from. */
  | 'picklist'
  /** The business process of a record type. */
  | 'business-process'
  /** The type a record of a custom metadata type is of. */
  | 'record-of'
  /**
   * A value of a record of a custom metadata type in a field that is a relationship: to the definition of an
   * object, of a field, or to another custom metadata type.
   */
  | 'value'
  /** The page or component that overrides an action of an object, such as the Lightning page of its records. */
  | 'action-override';

/** What a record element of a flow does to the records of an object. `upsert` creates or updates them. */
export type RecordOp = 'lookup' | 'create' | 'update' | 'upsert' | 'delete';

/** What every reference says before its names are resolved. */
interface Raw {
  readonly via: Via;
  /**
   * Set for a name that was found among the tokens of a formula that could not be read as a whole, and for a
   * name in an element of a flow of a kind the reader does not know.
   */
  readonly tier?: 'probable';
  /** For a reference to an object from a record element of a flow: what the element does to its records. */
  readonly op?: RecordOp;
  /** For a reference to a picklist field from a record type: the values it allows, as the file writes them. */
  readonly values?: readonly string[];
}

/** A reference as a file writes it, before its names are resolved. */
export type RawReference = Raw &
  /** The name of an object. `kind` is `references` where nothing else is said. */
  (
    | { readonly form: 'object'; readonly at: NameAt; readonly kind?: 'references' | 'triggers-on' }
    | /** The name of a field of the object the component belongs to. */ { readonly form: 'field'; readonly at: NameAt }
      /**
       * The name of a component of another type. `fullName` is the name it is looked for under, where that is
       * more than the name at the place: the record of a custom metadata type is named with its type. `kind` is
       * `references` where nothing else is said. `orType` is a second type, where the file does not say which of
       * the two the component is of: it is of `orType` where a file of the snapshot defines it so, and none
       * defines it as `type`.
       */
    | {
        readonly form: 'component';
        readonly type: string;
        readonly orType?: string;
        readonly at: NameAt;
        readonly fullName?: string;
        readonly kind?: 'references' | 'calls';
      }
    /**
     * A path of names from an object: relationships, and a field at the end. Every relationship is a read of
     * the field behind it, and `kind` is what the path says about the field at its end. `and` is a second thing
     * it says about that field: an assignment that adds to a field reads it and writes it. `value` is the value
     * of a picklist that a formula compares that field with. The first `silent` names are walked and give no
     * reference: another reference of the same element holds them.
     */
    | {
        readonly form: 'path';
        readonly start: string;
        readonly names: readonly (NameAt & PathHint)[];
        readonly kind: 'reads' | 'writes' | 'references';
        readonly and?: 'writes';
        readonly value?: string;
        readonly silent?: number;
      }
    /**
     * A field of the parent of a record, as a field update that writes on the parent names it: the relationship
     * field of the object `start` by its own name, such as `Invoice__c` and not `Invoice__r`, and the field of
     * the object that relationship leads to. The relationship field is a read, with the via of a path, and the
     * field at the end is written.
     */
    | { readonly form: 'parent-field'; readonly start: string; readonly through: NameAt; readonly at: NameAt }
    /**
     * A record that is written or deleted as a whole: a path of relationships from an object, which can be
     * empty. Every relationship is a read of the field behind it, and the reference goes to the object at the
     * end, at the place `at`.
     */
    | { readonly form: 'record'; readonly start: string; readonly names: readonly NameAt[]; readonly at: NameAt }
    /**
     * A text that is compared with the name of a record type of the object at the end of a path of
     * relationships. It is a reference only if the snapshot holds a record type of that name on that object.
     */
    | { readonly form: 'record-type'; readonly start: string; readonly names: readonly NameAt[]; readonly at: NameAt }
    /**
     * Names that could not be followed, because nothing says which object the name before them holds. `after`
     * is that name, or `null` where the element names nothing that could say it.
     */
    | { readonly form: 'unfollowed'; readonly after: NameAt | null; readonly names: readonly NameAt[] }
    /**
     * A value of a record of a custom metadata type that is one name, or two joined by a dot, given the field
     * `field` of the type `start`. What it names depends on that field, which only the model knows. `record`
     * holds every value of the same record by the folded name of its field: the object of a field is the value
     * of another field, and a text can name a field of an object that the record names.
     */
    | {
        readonly form: 'record-value';
        readonly start: string;
        readonly field: string;
        readonly names: readonly NameAt[];
        readonly record: ReadonlyMap<string, string>;
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
  /**
   * Why it is not read, where the reader knows more than that it is no name: `start` for a name whose first
   * part is nothing the text around it knows, such as a resource that a flow does not hold, `action-type` for an
   * action of a workflow rule of a type that is not known here (the element `type`) or of no type (the element
   * `name`), and `override-type` for an override of an action of an object of a type that is not known here (the
   * element `type`) or of no type (the element `content`).
   */
  readonly why?: 'start' | 'action-type' | 'override-type';
}

/** At most this many characters of a text that is not a name, or of one name, are shown in an issue. */
export const LONGEST_TEXT_SHOWN = 60;
/** The name of an object or of a field, as a value of a record of a custom metadata type holds it. */
const ONE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** The types of a field of a custom metadata type whose value is a text, by their folded names. */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text', 'textarea', 'longtextarea']);

/**
 * What a field of a custom metadata type is a relationship to, by its folded name: `entitydefinition`,
 * `fielddefinition` or another custom metadata type. `null` for a field that is no relationship. The type of the
 * field is compared in any case, as the types of a text are.
 */
const relationshipTo = (facts: FieldFacts | undefined): string | null => {
  const [only, ...others] = facts?.referenceTo ?? [];
  const relationship = foldName(facts?.type ?? '') === 'metadatarelationship';
  return relationship && only !== undefined && others.length === 0 ? foldName(only) : null;
};
/** At most this many characters of a path that was not followed are shown, and this many of its names are kept. */
const LONGEST_PATH_SHOWN = 200;
export const MOST_NAMES_SHOWN = 20;

/**
 * The folded names of the fields that a name of a path that was not followed can turn out to be, on whatever
 * object, as the model resolves a name (`model.ts`): the field at the end of a path, or the field behind a
 * relationship. `Invoice__r` is the field `Invoice__c` and `Account` is `AccountId`. `Level__pr` is the field
 * `Level__pc`, which of an account is `Level__c` of the contact. `Place__Latitude__s` is a part of `Place__c`, and
 * `QueueName` after `Owner:Queue` is the name of a group. A name too many does no harm: it only makes a warning
 * count for more answers (decision record 0074).
 */
export function fieldsANameCanBe(name: string): string[] {
  const folded = foldName(name);
  const names = [folded, `${folded}id`, ...namesTakenFor(name).map(foldName)];
  const whole = geolocationField(name);
  if (whole !== null) names.push(foldName(whole));
  if (/__p?r$/.test(folded)) names.push(`${folded.slice(0, -1)}c`);
  if (/__p[rc]$/.test(folded)) names.push(`${folded.slice(0, -2)}c`);
  return [...new Set(names)];
}

/**
 * The relationship of a lookup field, by the name of the field, in any case: `Invoice__c` is `Invoice__r`, and
 * `AccountId` is `Account`. Any other name is taken for the name of a relationship.
 */
const relationshipOf = (field: string): string =>
  /__p?c$/i.test(field) ? `${field.slice(0, -1)}r` : /[A-Za-z0-9]id$/i.test(field) ? field.slice(0, -2) : field;

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
    kind: Reference['kind'],
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
        attrs: {
          via: one.via,
          ...(one.op === undefined ? {} : { op: one.op }),
          ...(one.values === undefined ? {} : { values: [...one.values] }),
          ...rest,
          ...(target.to === null && object !== undefined ? { object } : {}),
        },
      }),
    );
  };

  /** Says that the names after `last` were not followed, because nothing says which object `last` leads to. */
  const notFollowed = (
    last: NameAt,
    rest: readonly NameAt[],
    leads: 'leads to' | 'holds',
    /** The names are a field of the object at the end, which the file names apart from the relationship. */
    apart = false,
  ): void => {
    // A formula can hold a path of any length. The issue shows the start of what was not followed.
    const names = rest.slice(0, MOST_NAMES_SHOWN).map((at) => at.name);
    const shown = `"${cut(names.join('.'), LONGEST_PATH_SHOWN)}"`;
    const what =
      names.length === 0
        ? 'the record it names is of no known object'
        : apart
          ? `its field ${shown} was not followed`
          : `${shown} after it was not followed`;
    issues.push({
      severity: 'warning',
      code: 'PATH_NOT_FOLLOWED',
      message: `${owner.file}, line ${String(last.line)}: it is not known which object "${cut(last.name, LONGEST_TEXT_SHOWN)}" ${leads}, so ${what}.`,
      componentKey: owner.key,
      details: {
        path: owner.file,
        line: last.line,
        column: last.column,
        [leads === 'holds' ? 'resource' : 'relationship']: last.name,
        notFollowed: names,
        origin,
      },
    });
  };

  /** Says that nothing says which object the names are a field of, so that they were not followed. */
  const nothingSays = (names: readonly NameAt[]): void => {
    const [first] = names;
    if (first === undefined) return;
    issues.push({
      severity: 'warning',
      code: 'PATH_NOT_FOLLOWED',
      message: `${owner.file}, line ${String(first.line)}: nothing says which object "${cut(names.map((at) => at.name).join('.'), LONGEST_PATH_SHOWN)}" is a field of, so it was not followed.`,
      componentKey: owner.key,
      details: {
        path: owner.file,
        line: first.line,
        column: first.column,
        notFollowed: names.slice(0, MOST_NAMES_SHOWN).map((at) => at.name),
        origin,
      },
    });
  };

  /**
   * A value of a record of a custom metadata type. The value of a relationship is a name, at the tier
   * `confirmed`. A text is a name only where it is exactly the name of a field that a file of the snapshot
   * defines, as `Object.Field` or as a field of an object the record names, and then `probable`.
   */
  const recordValue = (one: Extract<RawReference, { form: 'record-value' }>): void => {
    const facts = model.facts(one.start, one.field);
    const [first, second] = one.names;
    if (facts === undefined || first === undefined) return;
    const target = relationshipTo(facts);
    if (target !== null) {
      // Salesforce accepts only a name as the value of a relationship.
      if (second !== undefined) return;
      if (target === 'entitydefinition') add(first, model.object(first.name), 'references', one);
      else if (target === 'fielddefinition') {
        // The name of the field alone. The object is the value of the field the file of the relationship names.
        const controlling = facts.controllingField ?? '';
        const object = one.record.get(foldName(controlling.slice(controlling.lastIndexOf('.') + 1)));
        if (object === undefined || !ONE_NAME.test(object)) nothingSays([first]);
        else add(first, model.field(object, first.name), 'references', one, { object });
      } else if (target.endsWith('__mdt')) {
        // A record of another type, named without its type. A record named with its type and the suffix is of the
        // same type (`analyse.ts`), so it is found under that name where the snapshot holds no other.
        const type = facts.referenceTo[0] ?? '';
        const named = model.component('CustomMetadata', `${type.slice(0, -'__mdt'.length)}.${first.name}`);
        const suffixed = model.component('CustomMetadata', `${type}.${first.name}`);
        add(
          first,
          named.resolution !== 'resolved' && suffixed.resolution === 'resolved' ? suffixed : named,
          'references',
          one,
        );
      }
      return;
    }
    if (!TEXT_TYPES.has(foldName(facts.type ?? ''))) return;
    const text: Raw = { via: 'text', tier: 'probable' };
    if (second !== undefined) {
      const field = model.field(first.name, second.name);
      if (field.resolution === 'resolved') add(second, field, 'references', text);
      return;
    }
    const named = new Map<string, string>();
    for (const [field, value] of one.record) {
      if (relationshipTo(model.facts(one.start, field)) === 'entitydefinition' && ONE_NAME.test(value)) {
        named.set(foldName(value), value);
      }
    }
    for (const object of named.values()) {
      const field = model.field(object, first.name);
      if (field.resolution === 'resolved') add(first, field, 'references', text);
    }
  };

  /**
   * Walks relationships from an object. Gives the object at the end, or `null` where a relationship leads to no
   * known object. With `step`, each relationship is a read of the field behind it, and an issue says where the
   * walk ended. Without, nothing is recorded: another reference holds the same names.
   */
  const through = (start: string, names: readonly NameAt[], step: Raw | null): string | null => {
    let current = start;
    for (const [index, at] of names.entries()) {
      const { field, leadsTo } = model.relationship(current, at.name);
      if (step !== null) add(at, field, 'reads', step, { object: current });
      if (leadsTo === null) {
        if (step !== null) notFollowed(at, names.slice(index + 1), 'leads to');
        return null;
      }
      current = leadsTo;
    }
    return current;
  };

  for (const one of raw) {
    if (one.form === 'object') add(one.at, model.object(one.at.name), one.kind ?? 'references', one);
    else if (one.form === 'field') {
      add(one.at, model.field(owner.object, one.at.name), 'references', one, { object: owner.object });
    } else if (one.form === 'component') {
      const name = one.fullName ?? one.at.name;
      const target = model.component(one.type, name);
      const other =
        one.orType === undefined || target.resolution === 'resolved' ? null : model.component(one.orType, name);
      add(one.at, other?.resolution === 'resolved' ? other : target, one.kind ?? 'references', one);
    } else if (one.form === 'parent-field') {
      const step: Raw = { via: 'path', ...(one.tier === undefined ? {} : { tier: one.tier }) };
      const { field, leadsTo } = model.relationship(one.start, relationshipOf(one.through.name));
      add(one.through, field, 'reads', step, { object: one.start });
      // The parent is never the object itself: the model takes `Parent` for it, which is wrong for the parent of
      // a comment or an email of a case, and a hierarchy field leads there too. Then where it leads is not known.
      if (leadsTo === null || foldName(leadsTo) === foldName(one.start)) {
        notFollowed(one.through, [one.at], 'leads to', true);
      } else add(one.at, model.field(leadsTo, one.at.name), 'writes', one, { object: leadsTo });
    } else if (one.form === 'record') {
      // A relationship on the way is written as in any path of a flow.
      const step: Raw = { via: 'path', ...(one.tier === undefined ? {} : { tier: one.tier }) };
      const object = through(one.start, one.names, step);
      if (object !== null) add(one.at, model.object(object), 'references', one);
    } else if (one.form === 'record-type') {
      // The path that leads to the record type is a reference of its own, which reports what it finds.
      const object = through(one.start, one.names, null);
      const target = object === null ? null : model.component('RecordType', `${object}.${one.at.name}`);
      // A text is a name only where it names something: the snapshot holds the record type, or it is no reference.
      if (target?.resolution === 'resolved') add(one.at, target, 'references', one);
    } else if (one.form === 'unfollowed') {
      if (one.after !== null) notFollowed(one.after, one.names, 'holds');
      else nothingSays(one.names);
    } else if (one.form === 'record-value') {
      recordValue(one);
    } else {
      const silent = one.silent ?? 0;
      const walk = walkPath(
        model,
        one.start,
        one.names.map((at) => at.name),
        one.names,
      );
      walk.steps.forEach((target, index) => {
        const at = one.names[index];
        const on = walk.on[index];
        if (at === undefined || on === undefined || index < silent) return;
        const last = index === one.names.length - 1;
        if (last && foldName(at.name) === 'id') return;
        const value = last && one.value !== undefined ? { value: one.value } : {};
        add(at, target, last ? one.kind : 'reads', one, { object: on, ...value });
        if (last && one.and !== undefined) add(at, target, one.and, one, { object: on });
      });
      const last = one.names[walk.steps.length - 1];
      // Within the silent names, the reference that holds them says what was not followed.
      if (!walk.complete && last !== undefined && walk.steps.length > silent) {
        notFollowed(last, one.names.slice(walk.steps.length), 'leads to');
      }
    }
  }
  return { references, issues };
}
