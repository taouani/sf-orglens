/**
 * The check of a name of Apex against what the snapshot knows of objects (decision record 0087).
 *
 * The files of the snapshot come first: the model of objects (`model.ts`) knows the objects and fields they define,
 * the relationships their lookups name and the short lists of what every org has. A snapshot of an org holds the
 * descriptions of its objects as well (decision record 0080), which add the fields and relationships of Salesforce
 * and of packages that no file defines.
 *
 * Each answer says whether the name was checked. A name that a file or a description defines keeps the tier of its
 * syntax, and so does an object that every org has. The lookup field behind a child relationship is defined by the
 * description of the parent object, which names it, also where the org did not describe the child object. A field of Salesforce or of a package that nothing checks is
 * `external` and `probable`, as in a repository, also of an object the org did not describe: the short lists say
 * only that such a name is a field and not a child relationship. A name that an object the org described lacks, and
 * that no file defines, is `unresolved`: the org does not know it, or the user who took the snapshot cannot see it.
 */
import { buildKey, foldName } from '../core/keys.ts';
import type { ObjectDescription } from '../sources/describe.ts';
import { isListedField, standardLookupField, type ObjectModel, type Target } from './model.ts';

/** A name as the check found it. */
export interface Checked {
  readonly target: Target;
  /** A file or a description defines it, or it is an object every org has: it keeps the tier of its syntax. */
  readonly checked: boolean;
  /** It is what it is named as: it is checked, or the short lists name it as a field. */
  readonly known: boolean;
  /** The org described the object, and neither the description nor a file defines the name. */
  readonly notDescribed: boolean;
  /** Where the description lacks the name: the name of the field it lacks, also behind a relationship. */
  readonly lacks?: string;
}

/** A relationship of a record: the lookup field behind it, and the object it leads to. */
interface Relationship {
  readonly field: Checked;
  /** `null` where that is not known, also where the lookup can point at several objects. */
  readonly leadsTo: string | null;
}

/** A child relationship: the lookup field of the child object that defines it, and that object. */
interface ChildRelationship {
  readonly field: Checked;
  readonly object: string;
}

export interface ApexSchema {
  /** Whether a name is that of an object (`ObjectModel.isObject`), or of one the org described. */
  isObject(name: string): boolean;
  object(name: string): Checked;
  /** The field `name` of the object `object`. */
  field(object: string, name: string): Checked;
  /**
   * The relationship `name` of the object `object`, as the files, a description or the rules of the model know it:
   * `Account__r` is the field `Account__c`, and `Owner` the field `OwnerId`.
   */
  relationship(object: string, name: string): Relationship;
  /**
   * Whether a name without `__r` is a relationship of `object`: the description says so, or without one, it is a
   * relationship that every org has (`Owner`, `Account`, `What`).
   */
  isRelationship(object: string, name: string): boolean;
  /** A child relationship of the object `object`, or `null` where nothing defines one of that name. */
  child(object: string, name: string): ChildRelationship | null;
  /** Whether the org described the object. */
  described(object: string): boolean;
}

interface Described {
  readonly name: string;
  /** By folded name. */
  readonly fields: ReadonlyMap<string, ObjectDescription['fields'][number]>;
  /** By the folded name of the relationship. */
  readonly relationships: ReadonlyMap<string, ObjectDescription['fields'][number]>;
  /** By the folded name of the relationship. */
  readonly children: ReadonlyMap<string, ObjectDescription['childRelationships'][number]>;
}

/** The key of a component, or `null` for a name that cannot be one. */
function keyOf(type: 'CustomObject' | 'CustomField', fullName: string): Target['to'] {
  try {
    return buildKey({ type, fullName });
  } catch {
    return null;
  }
}

export function buildApexSchema(model: ObjectModel, descriptions: readonly ObjectDescription[] = []): ApexSchema {
  const byObject = new Map<string, Described>();
  for (const description of descriptions) {
    const fields = new Map<string, ObjectDescription['fields'][number]>();
    const relationships = new Map<string, ObjectDescription['fields'][number]>();
    for (const field of description.fields) {
      fields.set(foldName(field.name), field);
      if (field.relationshipName !== null) relationships.set(foldName(field.relationshipName), field);
    }
    const children = new Map<string, ObjectDescription['childRelationships'][number]>();
    for (const child of description.childRelationships) children.set(foldName(child.relationshipName), child);
    byObject.set(foldName(description.name), { name: description.name, fields, relationships, children });
  }
  const describedOf = (object: string): Described | undefined => byObject.get(foldName(object));

  const object = (name: string): Checked => {
    const target = model.object(name);
    if (target.resolution === 'resolved' || model.knowsObject(name)) {
      return { target, checked: true, known: true, notDescribed: false };
    }
    const described = describedOf(name);
    if (described !== undefined) {
      const to = keyOf('CustomObject', name);
      if (to !== null) {
        return {
          target: { to, toType: 'CustomObject', resolution: 'external' },
          checked: true,
          known: true,
          notDescribed: false,
        };
      }
    }
    return { target, checked: false, known: false, notDescribed: false };
  };

  const field = (objectName: string, name: string): Checked => {
    const target = model.field(objectName, name);
    if (target.resolution === 'resolved') return { target, checked: true, known: true, notDescribed: false };
    const described = describedOf(objectName);
    if (described === undefined) {
      return {
        target,
        checked: false,
        known: target.resolution === 'external' && isListedField(objectName, name),
        notDescribed: false,
      };
    }
    if (described.fields.has(foldName(name))) {
      const to = target.to ?? keyOf('CustomField', `${objectName}.${name}`);
      if (to !== null) {
        return {
          target: { to, toType: 'CustomField', resolution: 'external' },
          checked: true,
          known: true,
          notDescribed: false,
        };
      }
    }
    return {
      target: { to: null, toType: 'CustomField', resolution: 'unresolved' },
      checked: false,
      known: false,
      notDescribed: true,
      lacks: name,
    };
  };

  const relationship = (objectName: string, name: string): Relationship => {
    const fromFiles = model.relationship(objectName, name);
    const described = describedOf(objectName);
    // The files come first: a lookup field that a file defines says where it leads.
    if (fromFiles.field.resolution === 'resolved' || described === undefined) {
      return { field: field(objectName, fieldNameOf(name)), leadsTo: fromFiles.leadsTo };
    }
    const one = described.relationships.get(foldName(name));
    if (one === undefined) return { field: field(objectName, fieldNameOf(name)), leadsTo: null };
    const [only, ...others] = one.referenceTo;
    return { field: field(objectName, one.name), leadsTo: only !== undefined && others.length === 0 ? only : null };
  };

  const isRelationship = (objectName: string, name: string): boolean => {
    const described = describedOf(objectName);
    return described === undefined
      ? standardLookupField(name) !== undefined
      : described.relationships.has(foldName(name));
  };

  const child = (objectName: string, name: string): ChildRelationship | null => {
    const fromFiles = model.childRelationship(objectName, name);
    // A lookup field that a file defines comes first, then the description, then the short lists.
    if (fromFiles?.field.resolution === 'resolved') {
      return {
        field: { target: fromFiles.field, checked: true, known: true, notDescribed: false },
        object: fromFiles.object,
      };
    }
    const one = describedOf(objectName)?.children.get(foldName(name));
    if (one !== undefined) {
      // The description of the parent names the field behind the relationship, so it checks the field also where
      // the org did not describe the child object. A description of the child object that lacks the field wins.
      const behind = field(one.childSObject, one.field);
      if (behind.checked || behind.notDescribed) return { field: behind, object: one.childSObject };
      const to = behind.target.to ?? keyOf('CustomField', `${one.childSObject}.${one.field}`);
      if (to === null) return { field: { ...behind, known: true }, object: one.childSObject };
      return {
        field: {
          target: { to, toType: 'CustomField', resolution: 'external' },
          checked: true,
          known: true,
          notDescribed: false,
        },
        object: one.childSObject,
      };
    }
    if (fromFiles === null) return null;
    return {
      field: { target: fromFiles.field, checked: false, known: true, notDescribed: false },
      object: fromFiles.object,
    };
  };

  return {
    isObject: (name) => model.isObject(name) || describedOf(name) !== undefined,
    object,
    field,
    relationship,
    isRelationship,
    child,
    described: (name) => describedOf(name) !== undefined,
  };
}

/** The field behind a relationship by the rule: `Account__r` is `Account__c`, `Owner` is `OwnerId`. */
function fieldNameOf(name: string): string {
  return /__p?r$/i.test(name) ? `${name.slice(0, -1)}c` : `${name}Id`;
}
