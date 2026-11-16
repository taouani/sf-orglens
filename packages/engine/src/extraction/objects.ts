/**
 * What the XML of an object, a field and a validation rule says: the attributes later steps need, and the
 * references that are written as names in elements: the target of a lookup, the fields of a lookup filter and
 * of a roll-up summary, the controlling field and the value set of a picklist, the controlling field of a
 * relationship to a field definition, and the field a validation rule shows its message at.
 *
 * Reading and resolving are two steps. Reading takes the names with their places out of one file and needs
 * nothing else, so the file can be let go. Resolving needs the model of all objects, which exists only once
 * every file was read.
 *
 * The formula of a field, its default value and the condition of a rule are text in another language.
 * `formula.ts` reads that language, `formula-names.ts` says what a name of it stands for, and this file gives
 * each name its place in the file.
 */
import type { JsonValue } from '../core/errors.ts';
import { foldName, type ComponentKey } from '../core/keys.ts';
import { validateReference, type Reference, type ReferenceOrigin } from '../core/references.ts';
import { cut, type AnalysisIssue } from './analysed.ts';
import { namesOfTokens, namesOfTree, parseFormula } from './formula.ts';
import { usesOfName, type NamePart } from './formula-names.ts';
import { GLOBAL_OBJECTS, walkPath, type FieldFacts, type ObjectModel, type PathHint, type Target } from './model.ts';
import { childOf, childrenOf, isNil, sourceOf, type XmlDocument, type XmlElement, type XmlText } from './xml.ts';

/**
 * How the source names the target of a reference. It is kept on the reference, so that an answer can say why
 * one component refers to another.
 */
type Via = 'lookup' | 'filter' | 'summary' | 'controlling-field' | 'value-set' | 'display-field' | 'formula';

/** A name as a file writes it, and where it stands. Lines and columns start at 1. */
interface NameAt {
  readonly name: string;
  readonly line: number;
  readonly column: number;
}

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

/** Something in a file that this reader does not read as a name. */
interface Unread {
  /** The element that holds it. */
  readonly element: string;
  /** What stands there, cut after `LONGEST_TEXT_SHOWN` characters. */
  readonly text: string;
  readonly line: number;
  readonly column: number;
}

/** What one formula says. */
interface FormulaReading {
  /** The element that holds the formula. */
  readonly element: string;
  readonly references: readonly RawReference[];
  /** The names of the formula that are not read. */
  readonly unread: readonly Unread[];
  /** Why the formula was not read as a whole, and where. `null` if it was. */
  readonly problem: { readonly message: string; readonly line: number; readonly column: number } | null;
}

/** What one element of an object, a field or a rule says. */
export interface ElementReading {
  readonly attrs: Readonly<Record<string, JsonValue>>;
  /** Of a field: what a path through it needs. */
  readonly facts: FieldFacts | null;
  /** The references that are written as names in elements. */
  readonly references: readonly RawReference[];
  readonly unread: readonly Unread[];
  /** The formulas of the element. */
  readonly formulas: readonly FormulaReading[];
}

/** At most this many characters of a text that is not a name, or of one name, are shown in an issue. */
const LONGEST_TEXT_SHOWN = 60;
/** At most this many characters of a path that was not followed are shown, and this many of its names are kept. */
const LONGEST_PATH_SHOWN = 200;
const MOST_NAMES_SHOWN = 20;
/** A name of an object, a field or a relationship, or a global variable. */
const NAME = /^\$?[A-Za-z][A-Za-z0-9_]*$/;
const XML_SPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;

/** The text of an element without the white space around it, and where it starts in the text of the element. */
interface Value {
  readonly value: string;
  readonly text: XmlText;
  readonly offset: number;
}

function valueOf(element: XmlElement | null): Value | null {
  const text = element?.text ?? null;
  if (element === null || text === null || isNil(element)) return null;
  const raw = text.value;
  const value = raw.replace(XML_SPACE, '');
  if (value === '') return null;
  return { value, text, offset: raw.indexOf(value) };
}

const textOf = (element: XmlElement | null): string | null => valueOf(element)?.value ?? null;
const child = (element: XmlElement | null, local: string): XmlElement | null =>
  element === null ? null : childOf(element, local);
const children = (element: XmlElement | null, local: string): XmlElement[] =>
  element === null ? [] : childrenOf(element, local);

/** Reads one file: its values, with the place of each part of a value. */
class Reader {
  readonly references: RawReference[] = [];
  readonly unread: Unread[] = [];
  readonly formulas: FormulaReading[] = [];
  readonly #document: XmlDocument;

  constructor(document: XmlDocument) {
    this.#document = document;
  }

  /** The part of a value from `from` to `to`, as a name with its place. */
  #at(value: Value, from = 0, to = value.value.length): NameAt {
    // The place where the part starts. A part can be empty: the end of `Contact.` is one.
    const start = value.offset + from;
    const { line, column } = this.#document.place(sourceOf(value.text, start, start).start);
    return { name: value.value.slice(from, to), line, column };
  }

  #refuse(element: XmlElement, value: Value): void {
    const { name, line, column } = this.#at(value);
    this.unread.push({ element: element.local, text: cut(name, LONGEST_TEXT_SHOWN), line, column });
  }

  /** A value that is one name. */
  name(element: XmlElement | null, make: (at: NameAt) => RawReference): void {
    const value = valueOf(element);
    if (element === null || value === null) return;
    if (!NAME.test(value.value) || value.value.startsWith('$')) this.#refuse(element, value);
    else this.references.push(make(this.#at(value)));
  }

  /**
   * A value that is a path: `Contact.AccountId`, `$Source.Account__c`, `$User.Department`. It starts with the
   * name of an object, or with a global variable that stands for one. `$Source` is the object that holds the
   * field. The object is not a reference: the reference goes to the field.
   */
  path(element: XmlElement | null, own: string, kind: 'reads' | 'references', via: Via): void {
    const value = valueOf(element);
    if (element === null || value === null) return;
    const names: NameAt[] = [];
    let from = 0;
    for (const part of value.value.split('.')) {
      names.push(this.#at(value, from, from + part.length));
      from += part.length + 1;
    }
    const [first, ...rest] = names;
    const variable = first?.name.startsWith('$') === true ? first.name.toLowerCase() : null;
    const start = variable === null ? first?.name : variable === '$source' ? own : GLOBAL_OBJECTS.get(variable);
    if (
      start === undefined ||
      rest.length === 0 ||
      names.some((one) => !NAME.test(one.name)) ||
      rest.some((one) => one.name.startsWith('$'))
    ) {
      this.#refuse(element, value);
      return;
    }
    this.references.push({ form: 'path', start, names: rest, kind, via });
  }

  /**
   * A value that is a formula. `own` is the object the formula belongs to. A formula that cannot be read as a
   * whole still gives the names among its tokens, each marked as less certain.
   */
  formula(element: XmlElement | null, own: string): void {
    const value = valueOf(element);
    if (element === null || value === null) return;
    const parsed = parseFormula(value.value);
    const references: RawReference[] = [];
    const unread: Unread[] = [];
    const tier = parsed.tree === null ? { tier: 'probable' as const } : {};
    const placed = (start: number, part: NamePart): NameAt & PathHint => {
      const { leadsTo, resolveAs } = part;
      return {
        ...this.#at(value, start + part.from, start + part.from + part.name.length),
        ...(leadsTo === undefined ? {} : { leadsTo }),
        ...(resolveAs === undefined ? {} : { resolveAs }),
      };
    };
    for (const name of parsed.tree === null ? namesOfTokens(parsed.tokens) : namesOfTree(parsed.tree)) {
      const uses = usesOfName(name.text, own);
      if (uses === null) {
        const { line, column } = this.#at(value, name.start, name.start);
        unread.push({ element: element.local, text: cut(name.text, LONGEST_TEXT_SHOWN), line, column });
        continue;
      }
      for (const use of uses) {
        if (use.form === 'object') {
          references.push({ form: 'object', at: placed(name.start, use.part), via: 'formula', ...tier });
        } else if (use.form === 'component') {
          const { type, fullName } = use;
          references.push({
            form: 'component',
            type,
            fullName,
            at: placed(name.start, use.part),
            via: 'formula',
            ...tier,
          });
        } else {
          references.push({
            form: 'path',
            start: use.start,
            names: use.parts.map((part) => placed(name.start, part)),
            kind: 'reads',
            via: 'formula',
            ...(name.value === undefined ? {} : { value: name.value }),
            ...tier,
          });
        }
      }
    }
    let problem: FormulaReading['problem'] = null;
    if (parsed.problem !== null) {
      const { line, column } = this.#at(value, parsed.problem.at, parsed.problem.at);
      problem = { message: parsed.problem.message, line, column };
    }
    this.formulas.push({ element: element.local, references, unread, problem });
  }
}

/** What the element of a field says. `object` is the name of the object the field belongs to. */
export function readField(document: XmlDocument, element: XmlElement, object: string): ElementReading {
  const reader = new Reader(document);
  const type = textOf(childOf(element, 'type'));
  const referenceTo: string[] = [];
  for (const target of childrenOf(element, 'referenceTo')) {
    const name = textOf(target);
    if (name !== null) referenceTo.push(name);
    reader.name(target, (at) => ({ form: 'object', at, via: 'lookup' }));
  }

  for (const item of children(child(element, 'lookupFilter'), 'filterItems')) {
    reader.path(childOf(item, 'field'), object, 'reads', 'filter');
    reader.path(childOf(item, 'valueField'), object, 'reads', 'filter');
  }

  reader.path(childOf(element, 'summarizedField'), object, 'reads', 'summary');
  for (const item of childrenOf(element, 'summaryFilterItems')) {
    reader.path(childOf(item, 'field'), object, 'reads', 'filter');
  }
  reader.path(childOf(element, 'summaryForeignKey'), object, 'references', 'summary');
  // A field of a custom metadata type that points at a field of an object names the field that says which object.
  reader.path(childOf(element, 'metadataRelationshipControllingField'), object, 'references', 'controlling-field');

  // A picklist names its controlling field in `valueSet`. Files written before API version 38 use `picklist`.
  for (const group of [childOf(element, 'valueSet'), childOf(element, 'picklist')]) {
    reader.name(child(group, 'controllingField'), (at) => ({ form: 'field', at, via: 'controlling-field' }));
    reader.name(child(group, 'valueSetName'), (at) => ({
      form: 'component',
      type: 'GlobalValueSet',
      at,
      via: 'value-set',
    }));
  }

  reader.formula(childOf(element, 'formula'), object);
  reader.formula(childOf(element, 'defaultValue'), object);

  const relationshipName = textOf(childOf(element, 'relationshipName'));
  return {
    attrs: {
      ...(type === null ? {} : { type }),
      ...(referenceTo.length === 0 ? {} : { referenceTo }),
      ...(relationshipName === null ? {} : { relationshipName }),
      ...(textOf(childOf(element, 'formula')) === null ? {} : { formula: true }),
    },
    facts: { type, referenceTo },
    references: reader.references,
    unread: reader.unread,
    formulas: reader.formulas,
  };
}

/** What the element of a validation rule says. `object` is the name of the object the rule belongs to. */
export function readRule(document: XmlDocument, element: XmlElement, object: string): ElementReading {
  const reader = new Reader(document);
  reader.formula(childOf(element, 'errorConditionFormula'), object);
  reader.name(childOf(element, 'errorDisplayField'), (at) => ({ form: 'field', at, via: 'display-field' }));
  const active = textOf(childOf(element, 'active'));
  return {
    attrs: active === 'true' || active === 'false' ? { active: active === 'true' } : {},
    facts: null,
    references: reader.references,
    unread: reader.unread,
    formulas: reader.formulas,
  };
}

/** What the element of an object says. Its fields and rules are read on their own. */
export function readObject(element: XmlElement): ElementReading {
  const customSettingsType = textOf(childOf(element, 'customSettingsType'));
  return {
    attrs: customSettingsType === null ? {} : { customSettingsType },
    facts: null,
    references: [],
    unread: [],
    formulas: [],
  };
}

/** The component the names of a file are resolved for. */
interface Owner {
  readonly key: ComponentKey;
  /** The file the names stand in. */
  readonly file: string;
  /** The name of the object the component belongs to. */
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
          },
        });
      }
    }
  }
  return { references, issues };
}
