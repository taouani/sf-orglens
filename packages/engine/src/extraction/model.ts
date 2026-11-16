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

  const field = (objectName: string, name: string): Target => {
    const key = keyOf('CustomField', `${objectName}.${name}`);
    if (key === null) return unresolved('CustomField');
    if (defined.has(key)) return resolved(key, 'CustomField');
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
    return plainNamespaceOf(name) === null ? unresolved(type) : external(key, type);
  };

  const relationship = (objectName: string, name: string): { field: Target; leadsTo: string | null } => {
    const custom = /__r$/i.test(name);
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

  return { object, field, component, relationship };
}

/** What walking a path of names gave. */
interface Walk {
  /** The target of each name that was reached, in the order of the path. */
  readonly steps: readonly Target[];
  /** True if the last name was reached. False: it is not known where the last step that was reached leads. */
  readonly complete: boolean;
}

/**
 * Walks a path of names from an object: every name but the last is a relationship, and the last is a field.
 * `['Account__r', 'Owner', 'Email']` from an invoice gives the lookup field of the invoice, the owner field of
 * the account and the email field of the user.
 *
 * The walk stops after a relationship whose end is not known. The names after it have no step.
 */
export function walkPath(model: ObjectModel, start: string, names: readonly string[]): Walk {
  const steps: Target[] = [];
  let current = start;
  for (const [index, name] of names.entries()) {
    if (index === names.length - 1) {
      steps.push(model.field(current, name));
      break;
    }
    const { field, leadsTo } = model.relationship(current, name);
    steps.push(field);
    if (leadsTo === null) return { steps, complete: false };
    current = leadsTo;
  }
  return { steps, complete: true };
}
