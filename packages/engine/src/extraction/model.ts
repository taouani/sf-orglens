/**
 * The model of objects that names are resolved against: for each object its fields, and for each relationship
 * the field behind it and the object it leads to.
 *
 * It is built from what a snapshot holds and from two things no file says: the rule that a standard relationship
 * `Xyz` is the field `XyzId`, and a short table of relationships that every org has. It never guesses. A name
 * it does not find is `unresolved` or `external`, and a relationship whose end it does not know leads nowhere,
 * which the caller records.
 */
import { EngineError } from '../core/errors.ts';
import { buildKey, foldName, type ComponentKey } from '../core/keys.ts';
import { geolocationField, isCustomName, namespaceOf, plainNamespaceOf } from './names.ts';

/** What became of a name: the component it stands for, if that has a key, and how certain that is. */
export interface Target {
  /** `null` for a name that has no key: a custom name that was not found. */
  readonly to: ComponentKey | null;
  readonly toType: string;
  /**
   * - `resolved`: a file of the snapshot defines the component.
   * - `external`: no file defines it and it has a key all the same: Salesforce provides it, or a package that
   *   is not in the snapshot, or the snapshot holds only parts of it.
   * - `unresolved`: a custom name that nothing in the snapshot defines.
   */
  readonly resolution: 'resolved' | 'unresolved' | 'external';
}

/** What the file of a field says that a path needs. */
export interface FieldFacts {
  /** The type as the file says it, such as `Lookup`. `null` if the file names none. */
  readonly type: string | null;
  /** The objects the field points at, as the file names them. */
  readonly referenceTo: readonly string[];
  /**
   * Of a relationship of a custom metadata type to the definition of a field: the field of the same type whose
   * value says which object the field is of, as the file names it (`Billing_Rule__mdt.Object__c`).
   */
  readonly controllingField?: string;
}

export interface ObjectModel {
  /** The object of this name. */
  object(name: string): Target;
  /** The field `name` of the object `object`. */
  field(object: string, name: string): Target;
  /** A component whose name has no suffix and no parent, such as a global value set. */
  component(type: string, name: string): Target;
  /**
   * A step through a relationship: the field behind it, and the name of the object it leads to. `leadsTo` is
   * `null` when that is not known. `Account__r` is the field `Account__c`, and `Owner` is the field `OwnerId`.
   */
  relationship(object: string, name: string): { readonly field: Target; readonly leadsTo: string | null };
  /** What the file of the field `name` of the object `object` says. `undefined` where no file defines the field. */
  facts(object: string, name: string): FieldFacts | undefined;
}

export interface ModelInput {
  /** The keys of the components that a file of the snapshot defines. */
  readonly defined: ReadonlySet<ComponentKey>;
  /** The names of the objects the snapshot has a component for, defined or not. */
  readonly objects: Iterable<string>;
  /** Names that a file uses as the name of an object, such as the target of a lookup. */
  readonly namedObjects: Iterable<string>;
  /** What is known of each field that a file defines. */
  readonly fields: ReadonlyMap<ComponentKey, FieldFacts>;
}

/** A custom field of a contact as a person account shows it: `Level__pc` of the account is `Level__c` of the contact. */
const PERSON_ACCOUNT_FIELD = /__pc$/i;

/**
 * The objects that show the fields of the contact of a person account, by folded name: the account, and the two
 * objects under which an org with person accounts hands out parts of the account (decision record 0075).
 */
const PERSON_ACCOUNT_OBJECTS: ReadonlySet<string> = new Set(['account', 'personaccount', 'businessaccount']);

/** The object of the record that holds a relationship. */
const SELF = '';

/**
 * Where the relationships lead that every org has, by their folded name. A relationship named like a standard
 * object leads to that object: `Contact.Account` is an account.
 *
 * `Owner` is taken as a user. The owner of a record of some objects can be a queue, and a formula says so with
 * `Owner:Queue`. `Parent` is taken as the object itself, which is wrong for the few objects whose parent is of
 * another kind (an attachment, a note, a share).
 */
const STANDARD_RELATIONSHIPS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    owner: 'User',
    createdby: 'User',
    lastmodifiedby: 'User',
    manager: 'User',
    recordtype: 'RecordType',
    parent: SELF,
    masterrecord: SELF,
    reportsto: 'Contact',
    account: 'Account',
    asset: 'Asset',
    businesshours: 'BusinessHours',
    campaign: 'Campaign',
    case: 'Case',
    contact: 'Contact',
    contract: 'Contract',
    individual: 'Individual',
    lead: 'Lead',
    opportunity: 'Opportunity',
    order: 'Order',
    pricebook2: 'Pricebook2',
    product2: 'Product2',
    profile: 'Profile',
    user: 'User',
    userrole: 'UserRole',
  }),
);

/**
 * The objects behind the global variables that stand for a record: `$User.Department` is a field of the user.
 * By the folded name of the variable.
 */
export const GLOBAL_OBJECTS: ReadonlyMap<string, string> = new Map(
  Object.entries({ $user: 'User', $profile: 'Profile', $userrole: 'UserRole', $organization: 'Organization' }),
);

/** The key of a component, or `null` for a name that cannot be one, such as a name with a control character. */
function keyOf(type: string, fullName: string): ComponentKey | null {
  try {
    return buildKey({ type, fullName });
  } catch (error) {
    if (error instanceof EngineError && error.code === 'KEY_INVALID') return null;
    throw error;
  }
}

export function buildModel(input: ModelInput): ObjectModel {
  const { defined, fields } = input;
  /** The objects with a component, and the names used for objects, by folded name with the spelling of the source. */
  const objects = new Map<string, string>();
  for (const name of input.objects) objects.set(foldName(name), name);
  const named = new Map<string, string>(objects);
  for (const name of input.namedObjects) if (!named.has(foldName(name))) named.set(foldName(name), name);

  const resolved = (to: ComponentKey, toType: string): Target => ({ to, toType, resolution: 'resolved' });
  const external = (to: ComponentKey, toType: string): Target => ({ to, toType, resolution: 'external' });
  const unresolved = (toType: string): Target => ({ to: null, toType, resolution: 'unresolved' });

  const object = (name: string): Target => {
    const key = keyOf('CustomObject', name);
    if (key === null) return unresolved('CustomObject');
    if (defined.has(key)) return resolved(key, 'CustomObject');
    // The snapshot holds parts of the object and not its file, Salesforce provides it, or a package does.
    if (objects.has(foldName(name)) || !isCustomName(name) || namespaceOf(name) !== null) {
      return external(key, 'CustomObject');
    }
    return unresolved('CustomObject');
  };

  const field = (written: string, writtenName: string): Target => {
    // Some objects show custom fields that belong to another: a task and an event those of `Activity`, and an
    // account, as `PersonAccount` and `BusinessAccount`, those of the contact of a person account, spelled `__pc`.
    const folded = foldName(written);
    const custom = isCustomName(writtenName);
    const ofActivity = custom && (folded === 'task' || folded === 'event');
    const ofContact = custom && PERSON_ACCOUNT_OBJECTS.has(folded) && PERSON_ACCOUNT_FIELD.test(writtenName);
    const objectName = ofActivity ? 'Activity' : ofContact ? 'Contact' : written;
    const name = ofContact ? `${writtenName.slice(0, -2)}c` : writtenName;
    const key = keyOf('CustomField', `${objectName}.${name}`);
    if (key === null) return unresolved('CustomField');
    if (defined.has(key)) return resolved(key, 'CustomField');
    if (ofContact) {
      // The snapshot holds no such field of the contact. It can hold the field as the account shows it, in a file
      // of its own, as the file of the object `PersonAccount` can.
      const shown = keyOf('CustomField', `${written}.${writtenName}`);
      if (shown !== null && defined.has(shown)) return resolved(shown, 'CustomField');
    }
    const whole = geolocationField(name);
    const wholeKey = whole === null ? null : keyOf('CustomField', `${objectName}.${whole}`);
    if (wholeKey !== null && defined.has(wholeKey)) return resolved(wholeKey, 'CustomField');

    if (!objects.has(foldName(objectName)) && isCustomName(objectName)) {
      // The object is not in the snapshot. A package explains that, and nothing else does.
      return namespaceOf(objectName) === null ? unresolved('CustomField') : external(key, 'CustomField');
    }
    if (isCustomName(name) && namespaceOf(name) === null) return unresolved('CustomField');
    return external(key, 'CustomField');
  };

  const component = (type: string, name: string): Target => {
    const key = keyOf(type, name);
    if (key === null) return unresolved(type);
    if (defined.has(key)) return resolved(key, type);
    // A name with a parent, such as the alert `Invoice__c.Overdue`, says with its own part whether it is of a
    // package: the suffix of the object is no prefix. The record of a custom metadata type is named with its
    // type, which is written without a suffix, and is of a package when its type is.
    const own = type === 'CustomMetadata' ? name : name.slice(name.lastIndexOf('.') + 1);
    return plainNamespaceOf(own) === null ? unresolved(type) : external(key, type);
  };

  const relationship = (objectName: string, name: string): { field: Target; leadsTo: string | null } => {
    // `Level__pr` is the relationship of the field `Level__pc`, which a person account shows of its contact.
    const custom = /__p?r$/i.test(name);
    const behind = field(objectName, custom ? `${name.slice(0, -1)}c` : `${name}Id`);
    const facts = behind.to === null ? undefined : fields.get(behind.to);
    const [only, ...others] = facts?.referenceTo ?? [];
    if (only !== undefined && others.length === 0) return { field: behind, leadsTo: only };
    // A hierarchy field names no object: it points at the object it is a field of.
    if (facts?.type === 'Hierarchy') return { field: behind, leadsTo: objectName };
    if (custom) return { field: behind, leadsTo: null };
    const folded = foldName(name);
    const known = named.get(folded) ?? STANDARD_RELATIONSHIPS.get(folded);
    return { field: behind, leadsTo: known === undefined ? null : known === SELF ? objectName : known };
  };

  const factsOf = (objectName: string, name: string): FieldFacts | undefined => {
    const target = field(objectName, name);
    return target.resolution === 'resolved' && target.to !== null ? fields.get(target.to) : undefined;
  };

  return { object, field, component, relationship, facts: factsOf };
}

/** What the source says about one name of a path beyond the name. */
export interface PathHint {
  /** Of a relationship: the object it leads to, as `Owner:User` says in a formula. It is believed before the model. */
  readonly leadsTo?: string;
  /** Of the field at the end: the name it is looked for under, where the source has another name for it. */
  readonly resolveAs?: string;
}

/** What walking a path of names gave. */
interface Walk {
  /** The target of each name that was reached, in the order of the path. */
  readonly steps: readonly Target[];
  /** For each of them, the name of the object it was looked for on. */
  readonly on: readonly string[];
  /** True if the last name was reached. False: it is not known where the last step that was reached leads. */
  readonly complete: boolean;
}

/**
 * Walks a path of names from an object: every name but the last is a relationship, and the last is a field.
 * `['Account__r', 'Owner', 'Email']` from an invoice gives the lookup field of the invoice, the owner field of
 * the account and the email field of the user.
 *
 * The walk stops after a relationship whose end is not known. The names after it have no step. `said` holds, for
 * the name at the same index, what the source says beyond the name.
 */
export function walkPath(
  model: ObjectModel,
  start: string,
  names: readonly string[],
  said: readonly (PathHint | undefined)[] = [],
): Walk {
  const steps: Target[] = [];
  const on: string[] = [];
  let current = start;
  for (const [index, name] of names.entries()) {
    on.push(current);
    const hint = said[index];
    if (index === names.length - 1) {
      steps.push(model.field(current, hint?.resolveAs ?? name));
      break;
    }
    const { field, leadsTo } = model.relationship(current, name);
    steps.push(field);
    const next = hint?.leadsTo ?? leadsTo;
    if (next === null) return { steps, on, complete: false };
    current = next;
  }
  return { steps, on, complete: true };
}
