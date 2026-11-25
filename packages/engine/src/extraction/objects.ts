/**
 * What the XML of an object, a field, a validation rule, a record type and a field set says: the attributes later
 * steps need, and the references that are written as names in elements: the page or component that overrides an
 * action of an object (decision record 0070), the target of a lookup, the fields of a lookup filter and of a
 * roll-up summary, the controlling field and the value set of a picklist, the controlling field of a relationship
 * to a field definition, the field a validation rule shows its message at, the picklists and the business process
 * of a record type, and the fields of a field set (decision record 0065).
 *
 * Only the reading is done here. The names are resolved against the model of all objects, which exists only
 * once every file was read (`raw-references.ts`).
 *
 * The formula of a field, its default value and the condition of a rule are text in another language.
 * `names-in-text.ts` reads them, and this file says where each of them stands.
 */
import type { JsonValue } from '../core/errors.ts';
import { foldName } from '../core/keys.ts';
import { cut } from './analysed.ts';
import { GLOBAL_OBJECTS, type FieldFacts } from './model.ts';
import { readFormula, type FormulaReading, type MergeFieldsReading } from './names-in-text.ts';
import { LONGEST_TEXT_SHOWN, type RawReference, type Unread, type Via } from './raw-references.ts';
import { placesIn, textOf, valueOf, type NameAt, type Value } from './values.ts';
import { childOf, childrenOf, type XmlDocument, type XmlElement } from './xml.ts';

/** What one element of a file says: an object, a field, a rule, a flow or an element of a flow. */
export interface ElementReading {
  readonly attrs: Readonly<Record<string, JsonValue>>;
  /** Of a field: what a path through it needs. */
  readonly facts: FieldFacts | null;
  /** The references that are written as names in elements. */
  readonly references: readonly RawReference[];
  readonly unread: readonly Unread[];
  /** The formulas of the element. */
  readonly formulas: readonly FormulaReading[];
  /** The texts of the element that hold merge fields. Only an element of a flow has such texts. */
  readonly texts?: readonly MergeFieldsReading[];
  /** Of an element of a flow: the elements in it, or itself, that are of a kind the reader does not know. */
  readonly unknown?: readonly { readonly element: string; readonly line: number; readonly column: number }[];
}

/** A name of an object, a field or a relationship, or a global variable. */
const NAME = /^\$?[A-Za-z][A-Za-z0-9_]*$/;

const child = (element: XmlElement | null, local: string): XmlElement | null =>
  element === null ? null : childOf(element, local);
const children = (element: XmlElement | null, local: string): XmlElement[] =>
  element === null ? [] : childrenOf(element, local);

/**
 * Reads one file: its values, with the place of each part of a value. The readers of workflow rules, report types
 * and quick actions use it too.
 */
export class Reader {
  readonly references: RawReference[] = [];
  readonly unread: Unread[] = [];
  readonly formulas: FormulaReading[] = [];
  readonly #document: XmlDocument;

  constructor(document: XmlDocument) {
    this.#document = document;
  }

  /** The part of a value from `from` to `to`, as a name with its place. */
  #at(value: Value, from = 0, to = value.value.length): NameAt {
    return placesIn(this.#document, value)(from, to);
  }

  /** The parts of a value between its dots, each with its place. */
  #parts(value: Value): NameAt[] {
    const names: NameAt[] = [];
    let from = 0;
    for (const part of value.value.split('.')) {
      names.push(this.#at(value, from, from + part.length));
      from += part.length + 1;
    }
    return names;
  }

  #refuse(element: XmlElement, value: Value, why?: Unread['why']): void {
    const { name, line, column } = this.#at(value);
    const text = cut(name, LONGEST_TEXT_SHOWN);
    this.unread.push({ element: element.local, text, line, column, ...(why === undefined ? {} : { why }) });
  }

  /** A value that is not read, for a reason the caller knows where it gives one. */
  refuse(element: XmlElement | null, why?: Unread['why']): void {
    const value = valueOf(element);
    if (element !== null && value !== null) this.#refuse(element, value, why);
  }

  /** A value that is one name. */
  name(element: XmlElement | null, make: (at: NameAt) => RawReference): void {
    const at = this.nameAt(element);
    if (at !== null) this.references.push(make(at));
  }

  /** A value that is one name, with its place. `null` for no value, and for a value that is no name, which is not read. */
  nameAt(element: XmlElement | null): NameAt | null {
    const value = valueOf(element);
    if (element === null || value === null) return null;
    if (!NAME.test(value.value) || value.value.startsWith('$')) {
      this.#refuse(element, value);
      return null;
    }
    return this.#at(value);
  }

  /**
   * A value that is the name of a component, whatever characters it holds, such as the name of a business
   * process, which can hold a space. A name that cannot be a key is not found, and is no reason for a warning.
   */
  wholeName(element: XmlElement | null, make: (at: NameAt) => RawReference): void {
    const value = valueOf(element);
    if (element !== null && value !== null) this.references.push(make(this.#at(value)));
  }

  /**
   * A value that is one name or two joined by a dot, such as `Amount__c` or `Account.Amount__c`, each part with
   * its place. `null` for no value and for anything else, which is not read and is no reason for a warning: the
   * value of a text can be any text.
   */
  namesIn(element: XmlElement | null): NameAt[] | null {
    const value = valueOf(element);
    if (element === null || value === null) return null;
    const names = this.#parts(value);
    return names.length <= 2 && names.every((one) => NAME.test(one.name) && !one.name.startsWith('$')) ? names : null;
  }

  /**
   * A value that is a path of names joined by dots, such as `Account__r.Tier__c`, each name with its place. `null`
   * for no value, and for a value with a part that is no name, which is not read.
   */
  pathOf(element: XmlElement | null): NameAt[] | null {
    const value = valueOf(element);
    if (element === null || value === null) return null;
    const names = this.#parts(value);
    if (names.some((one) => !NAME.test(one.name) || one.name.startsWith('$'))) {
      this.#refuse(element, value);
      return null;
    }
    return names;
  }

  /**
   * A value that names a field of the object `own`, by its name or through relationships: `Amount__c`,
   * `Account__r.Tier__c`. Every name before the last is a relationship.
   */
  fieldPath(element: XmlElement | null, own: string, kind: 'reads' | 'references', via: Via): void {
    const names = this.pathOf(element);
    if (names !== null) this.references.push({ form: 'path', start: own, names, kind, via });
  }

  /**
   * A value that names a component in a folder, such as the email template `Billing/Invoice_Overdue`. The
   * reference stands at the name after the folder. A folder can hold a `$`, as `unfiled$public` does.
   */
  inFolder(element: XmlElement | null, type: string, via: Via): void {
    const value = valueOf(element);
    if (element === null || value === null) return;
    const slash = value.value.indexOf('/');
    const folder = value.value.slice(0, slash);
    const name = value.value.slice(slash + 1);
    if (slash < 1 || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(folder) || !NAME.test(name) || name.startsWith('$')) {
      this.#refuse(element, value);
      return;
    }
    const at = this.#at(value, slash + 1);
    this.references.push({ form: 'component', type, at, fullName: value.value, via });
  }

  /**
   * A value that is a path: `Contact.AccountId`, `$Source.Account__c`, `$User.Department`. It starts with the
   * name of an object, or with a global variable that stands for one. `$Source` is the object that holds the
   * field. The object is not a reference: the reference goes to the field.
   */
  path(element: XmlElement | null, own: string, kind: 'reads' | 'references', via: Via): void {
    const value = valueOf(element);
    if (element === null || value === null) return;
    const names = this.#parts(value);
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
    this.formulas.push(readFormula(value.value, own, element.local, placesIn(this.#document, value)));
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
  const controllingField = textOf(childOf(element, 'metadataRelationshipControllingField'));
  return {
    attrs: {
      ...(type === null ? {} : { type }),
      ...(referenceTo.length === 0 ? {} : { referenceTo }),
      ...(relationshipName === null ? {} : { relationshipName }),
      ...(textOf(childOf(element, 'formula')) === null ? {} : { formula: true }),
    },
    facts: {
      type,
      referenceTo,
      ...(controllingField === null ? {} : { controllingField }),
      ...(relationshipName === null ? {} : { relationshipName }),
    },
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

/**
 * What the element of a record type says. `object` is the name of the object the record type belongs to. A
 * record type refers to each picklist field whose values it limits, with the values it allows as they are
 * written, and to its business process.
 */
export function readRecordType(document: XmlDocument, element: XmlElement, object: string): ElementReading {
  const reader = new Reader(document);
  for (const group of childrenOf(element, 'picklistValues')) {
    const values = childrenOf(group, 'values').flatMap((one) => textOf(childOf(one, 'fullName')) ?? []);
    reader.name(childOf(group, 'picklist'), (at) => ({ form: 'field', at, via: 'listed-field', values }));
  }
  // A business process belongs to the object, and its name can hold a space.
  reader.wholeName(childOf(element, 'businessProcess'), (at) => ({
    form: 'component',
    type: 'BusinessProcess',
    at,
    fullName: `${object}.${at.name}`,
    via: 'business-process',
  }));
  const active = textOf(childOf(element, 'active'));
  return {
    attrs: active === 'true' || active === 'false' ? { active: active === 'true' } : {},
    facts: null,
    references: reader.references,
    unread: reader.unread,
    formulas: reader.formulas,
  };
}

/**
 * What the element of a field set says. `object` is the name of the object the field set belongs to. Each field
 * it lists, available or shown, is read, also through relationships.
 */
export function readFieldSet(document: XmlDocument, element: XmlElement, object: string): ElementReading {
  const reader = new Reader(document);
  for (const group of element.children) {
    if (group.local !== 'availableFields' && group.local !== 'displayedFields') continue;
    reader.fieldPath(childOf(group, 'field'), object, 'reads', 'listed-field');
  }
  return { attrs: {}, facts: null, references: reader.references, unread: reader.unread, formulas: reader.formulas };
}

/**
 * What overrides an action of an object, by the folded name of the type of the override: a Lightning page, a
 * Visualforce page, an s-control or a Lightning component. The file does not say whether a Lightning component is
 * an Aura component or a Lightning web component, so it is of the second type where only that is defined.
 */
const OVERRIDDEN_BY: ReadonlyMap<string, { readonly type: string; readonly orType?: string }> = new Map([
  ['flexipage', { type: 'FlexiPage' }],
  ['visualforce', { type: 'ApexPage' }],
  ['scontrol', { type: 'Scontrol' }],
  ['lightningcomponent', { type: 'AuraDefinitionBundle', orType: 'LightningComponentBundle' }],
]);
/**
 * The types of an override that name nothing: `standard`, the behaviour of Salesforce, and `default`, which a file
 * writes for an action that is not overridden, and which the documentation of Salesforce calls an override that an
 * installed package provides.
 */
const NOT_OVERRIDDEN: ReadonlySet<string> = new Set(['standard', 'default']);

/**
 * What the element of an object says. Its fields and rules are read on their own. An object refers to the page or
 * component that each override of one of its actions names, whatever the action and the form factor.
 */
export function readObject(document: XmlDocument, element: XmlElement): ElementReading {
  const reader = new Reader(document);
  for (const override of childrenOf(element, 'actionOverrides')) {
    const type = childOf(override, 'type');
    const kind = textOf(type);
    // Salesforce writes the types in lowercase in its documentation, and files write them with capitals.
    if (kind !== null && NOT_OVERRIDDEN.has(foldName(kind))) continue;
    const by = kind === null ? undefined : OVERRIDDEN_BY.get(foldName(kind));
    // An override of a type that is not known here names nothing that could be found: it is not read, and a
    // warning says so. So does one without a type, which Salesforce refuses.
    if (by === undefined) reader.refuse(kind === null ? childOf(override, 'content') : type, 'override-type');
    else reader.name(childOf(override, 'content'), (at) => ({ form: 'component', ...by, at, via: 'action-override' }));
  }
  const customSettingsType = textOf(childOf(element, 'customSettingsType'));
  return {
    attrs: customSettingsType === null ? {} : { customSettingsType },
    facts: null,
    references: reader.references,
    unread: reader.unread,
    formulas: reader.formulas,
  };
}
