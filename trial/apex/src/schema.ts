/**
 * What the resolver knows about objects and fields: the custom objects and custom fields of a project in source
 * format, read from its `objects` folders.
 *
 * Standard objects and standard fields have no file in a project. The trial knows them by two rules, which are
 * written down here so that they can be judged:
 *
 * - A type name is an object when the project has a folder for it, when it ends like a custom object, or when
 *   it is in the short list of standard objects below.
 * - A name without a custom ending that stands where a field stands is a standard field of the object in front
 *   of it. No list of standard fields is consulted, so a name that does not exist is not noticed.
 * - A child relationship is known only when a lookup field of the project defines it. `Contacts` of `Account` is
 *   not known, and neither is the target of a lookup field that comes from a package the project does not hold.
 *   The resolver reports both as unknown.
 *
 * The production resolver needs the description of the org, or a bundled list, in their place.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface FieldInfo {
  /** The name as written in the project. */
  readonly name: string;
  /** The object a lookup or master-detail field points at, as written. */
  readonly referenceTo: string | undefined;
}

interface ChildRelationship {
  /** The object that holds the lookup field, as written. */
  readonly object: string;
  /** The lookup field, as written. */
  readonly field: string;
}

interface ObjectInfo {
  readonly name: string;
  /** Custom fields by their name in lower case. */
  readonly fields: Map<string, FieldInfo>;
  /** Child relationships by their name in lower case, as a query writes it: `lines__r`. */
  readonly children: Map<string, ChildRelationship>;
}

export interface Schema {
  /** The objects of the project by their name in lower case. A standard object is here when it has custom fields. */
  readonly objects: Map<string, ObjectInfo>;
}

/** Standard objects a type name is taken for. Not complete: the common ones of sales, service and the platform. */
const STANDARD_OBJECTS = new Set(
  `account accountcontactrelation accountteammember asset attachment campaign campaignmember case casecomment
  contact contentdocument contentdocumentlink contentversion contract contractlineitem emailmessage entitlement
  event feeditem group groupmember lead note opportunity opportunitycontactrole opportunitylineitem order
  orderitem organization permissionset permissionsetassignment pricebook2 pricebookentry product2 profile
  quote quotelineitem recordtype task user userrole workorder workorderlineitem`.split(/\s+/),
);

const CUSTOM_OBJECT_ENDING = /__(c|mdt|e|x|b|kav|share|history|feed|changeevent)$/;

/** Where a standard relationship points, when its name is not the name of a standard object. */
const STANDARD_TARGETS = new Map([
  ['owner', 'User'],
  ['createdby', 'User'],
  ['lastmodifiedby', 'User'],
  ['manager', 'User'],
  ['reportsto', 'Contact'],
]);

/** Whether a simple type name is the name of an object. */
export function isObjectName(schema: Schema, name: string): boolean {
  const lower = name.toLowerCase();
  return schema.objects.has(lower) || CUSTOM_OBJECT_ENDING.test(lower) || STANDARD_OBJECTS.has(lower);
}

/** Whether a name without a custom ending is known as a standard relationship, such as `Owner` or `Account`. */
export function isStandardRelationship(name: string): boolean {
  const lower = name.toLowerCase();
  return STANDARD_TARGETS.has(lower) || STANDARD_OBJECTS.has(lower) || lower === 'parent';
}

/** The object a standard relationship points at, or `undefined` when the trial does not know it. */
export function standardTarget(object: string, relationship: string): string | undefined {
  const lower = relationship.toLowerCase();
  if (lower === 'parent') return object;
  return STANDARD_TARGETS.get(lower) ?? (STANDARD_OBJECTS.has(lower) ? relationship : undefined);
}

function element(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim();
}

function folders(dir: string, name: string, found: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) continue;
    if (entry === name) found.push(path);
    else folders(path, name, found);
  }
}

/** Reads the custom fields of every `objects` folder under the given folders. */
export function readSchema(roots: readonly string[]): Schema {
  const objects = new Map<string, ObjectInfo>();
  const objectOf = (name: string): ObjectInfo => {
    const lower = name.toLowerCase();
    let info = objects.get(lower);
    if (info === undefined) {
      info = { name, fields: new Map(), children: new Map() };
      objects.set(lower, info);
    }
    return info;
  };
  const lookups: { object: string; field: string; referenceTo: string; relationship: string }[] = [];
  const objectFolders: string[] = [];
  for (const root of roots) folders(root, 'objects', objectFolders);
  for (const folder of objectFolders.sort()) {
    for (const objectName of readdirSync(folder).sort()) {
      const fieldsDir = join(folder, objectName, 'fields');
      let files: string[];
      try {
        files = readdirSync(fieldsDir).sort();
      } catch {
        // An object without a folder of fields is still an object of the project.
        if (statSync(join(folder, objectName)).isDirectory()) objectOf(objectName);
        continue;
      }
      const info = objectOf(objectName);
      for (const file of files) {
        if (!file.endsWith('.field-meta.xml')) continue;
        const xml = readFileSync(join(fieldsDir, file), 'utf8');
        const name = element(xml, 'fullName') ?? file.slice(0, -'.field-meta.xml'.length);
        const referenceTo = element(xml, 'referenceTo');
        info.fields.set(name.toLowerCase(), { name, referenceTo });
        const relationship = element(xml, 'relationshipName');
        if (referenceTo !== undefined && relationship !== undefined) {
          lookups.push({ object: objectName, field: name, referenceTo, relationship });
        }
      }
    }
  }
  for (const lookup of lookups) {
    // The child relationship of a custom field is written with `__r` in a query and in Apex.
    const name = lookup.field.toLowerCase().endsWith('__c') ? `${lookup.relationship}__r` : lookup.relationship;
    objectOf(lookup.referenceTo).children.set(name.toLowerCase(), { object: lookup.object, field: lookup.field });
  }
  return { objects };
}
