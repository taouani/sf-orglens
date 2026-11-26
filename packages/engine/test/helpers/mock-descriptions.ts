/**
 * The descriptions a mock org gives of its objects (decision record 0085), in the form of the REST API:
 * `GET /services/data/v<version>/sobjects/<object>/describe`.
 *
 * An object is described from the files of the folder: each custom field with its type, the objects a lookup
 * points at and the name of its relationship, and the child relationships that the lookups of other objects of
 * the folder name. Beside them stand the fields Salesforce gives every object of its kind, and a short list of
 * standard fields of the two standard objects of the fixture project. All of it is written here for the purpose,
 * from the documentation of Salesforce, and none of it was read from an org. A real description holds far more:
 * labels, picklist values and many standard fields. What the engine drops of it is shown by the label each field
 * carries here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Field {
  readonly name: string;
  readonly type: string;
  readonly referenceTo: readonly string[];
  readonly relationshipName: string | null;
}

interface Child {
  readonly relationshipName: string;
  readonly childSObject: string;
  readonly field: string;
}

/** The type of a field in the REST API, by the type of its file. A formula has the type of its result. */
const REST_TYPE: Readonly<Record<string, string>> = {
  AutoNumber: 'string',
  Checkbox: 'boolean',
  Currency: 'currency',
  Date: 'date',
  DateTime: 'datetime',
  Email: 'email',
  Hierarchy: 'reference',
  Html: 'textarea',
  Lookup: 'reference',
  LongTextArea: 'textarea',
  MasterDetail: 'reference',
  // The org describes a relationship of a custom metadata type as a text, which points at nothing (run 32 of
  // "Live org").
  MetadataRelationship: 'string',
  MultiselectPicklist: 'multipicklist',
  Number: 'double',
  Percent: 'percent',
  Phone: 'phone',
  Picklist: 'picklist',
  Summary: 'double',
  Text: 'string',
  TextArea: 'textarea',
  Time: 'time',
  Url: 'url',
};

const lookup = (name: string, to: string, relationshipName: string): Field => ({
  name,
  type: 'reference',
  referenceTo: [to],
  relationshipName,
});
const plain = (name: string, type = 'string'): Field => ({ name, type, referenceTo: [], relationshipName: null });

/** What kind of object an object is, by its name and its file. */
type Kind = 'object' | 'detail' | 'setting' | 'metadata' | 'event';

const audit = (): Field[] => [
  plain('CreatedDate', 'datetime'),
  lookup('CreatedById', 'User', 'CreatedBy'),
  plain('LastModifiedDate', 'datetime'),
  lookup('LastModifiedById', 'User', 'LastModifiedBy'),
  plain('SystemModstamp', 'datetime'),
];

/**
 * The fields Salesforce gives every object of a kind. The owner of a custom object can be a user or a queue, which is
 * a group, and the owner of an account is a user (run 32 of "Live org"). A detail of a master-detail relationship has
 * no owner, a custom setting has the owner of its setting, a custom metadata type has the names of a record of
 * metadata, and a platform event has the fields of an event. A user has neither an owner nor `IsDeleted`.
 */
const SYSTEM: Readonly<Record<Kind, () => Field[]>> = {
  object: () => [
    plain('Id', 'id'),
    plain('IsDeleted', 'boolean'),
    ...audit(),
    { name: 'OwnerId', type: 'reference', referenceTo: ['Group', 'User'], relationshipName: 'Owner' },
  ],
  detail: () => [plain('Id', 'id'), plain('IsDeleted', 'boolean'), ...audit()],
  setting: () => [
    plain('Id', 'id'),
    plain('IsDeleted', 'boolean'),
    {
      name: 'SetupOwnerId',
      type: 'reference',
      referenceTo: ['Organization', 'Profile', 'User'],
      relationshipName: 'SetupOwner',
    },
    ...audit(),
  ],
  metadata: () => [
    plain('Id', 'id'),
    plain('DeveloperName'),
    plain('MasterLabel'),
    plain('Language', 'picklist'),
    plain('NamespacePrefix'),
    plain('Label'),
    plain('QualifiedApiName'),
    plain('SystemModstamp', 'datetime'),
  ],
  event: () => [
    plain('ReplayId'),
    plain('CreatedDate', 'datetime'),
    lookup('CreatedById', 'User', 'CreatedBy'),
    plain('EventUuid'),
  ],
};

/** The standard fields of the standard objects of the fixture project, beside those of every object. */
const STANDARD: Readonly<Record<string, readonly Field[]>> = {
  Account: [
    plain('Name'),
    plain('Industry', 'picklist'),
    plain('Type', 'picklist'),
    plain('Phone', 'phone'),
    lookup('ParentId', 'Account', 'Parent'),
  ],
  User: [
    plain('Name'),
    plain('Username'),
    plain('Email', 'email'),
    plain('Department'),
    plain('IsActive', 'boolean'),
    lookup('ManagerId', 'User', 'Manager'),
    lookup('ProfileId', 'Profile', 'Profile'),
  ],
};

/** The child relationships of the standard objects of the fixture project to standard objects. */
const STANDARD_CHILDREN: Readonly<Record<string, readonly Child[]>> = {
  Account: [
    { relationshipName: 'ChildAccounts', childSObject: 'Account', field: 'ParentId' },
    { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId' },
    { relationshipName: 'Opportunities', childSObject: 'Opportunity', field: 'AccountId' },
  ],
};

/** The fields of every object as the standard objects of the fixture project have them. */
function ownSystem(object: string, fields: readonly Field[]): Field[] {
  if (object === 'User') return fields.filter((field) => field.name !== 'OwnerId' && field.name !== 'IsDeleted');
  if (object === 'Account')
    return fields.map((field) => (field.name === 'OwnerId' ? lookup('OwnerId', 'User', 'Owner') : field));
  return [...fields];
}

const tag = (xml: string, name: string): string | null =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1]?.trim() ?? null;

/** The folders `objects` below `dir`, outside folders whose name starts with a dot and `node_modules`. */
function objectFolders(dir: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at)) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const path = join(at, entry);
      if (!statSync(path).isDirectory()) continue;
      if (entry === 'objects') found.push(path);
      else walk(path);
    }
  };
  walk(dir);
  return found;
}

/** The kind of an object, by its name and the file of the object, which a standard object may not have. */
function kindOf(object: string, file: string): Exclude<Kind, 'detail'> {
  if (/__mdt$/i.test(object)) return 'metadata';
  if (/__e$/i.test(object)) return 'event';
  if (existsSync(file) && tag(readFileSync(file, 'utf8'), 'customSettingsType') !== null) return 'setting';
  return 'object';
}

/** The descriptions of the objects of the folder, by the name of the object. */
export function descriptionsOfFolder(dir: string): Map<string, Record<string, unknown>> {
  const fields = new Map<string, Field[]>();
  const kinds = new Map<string, Exclude<Kind, 'detail'>>();
  const children = new Map<string, Child[]>();
  const details = new Set<string>();
  for (const folder of objectFolders(dir)) {
    for (const object of readdirSync(folder)) {
      if (!statSync(join(folder, object)).isDirectory()) continue;
      const own = fields.get(object) ?? [];
      fields.set(object, own);
      if (kinds.get(object) !== 'setting')
        kinds.set(object, kindOf(object, join(folder, object, `${object}.object-meta.xml`)));
      const fieldDir = join(folder, object, 'fields');
      if (!existsSync(fieldDir)) continue;
      for (const file of readdirSync(fieldDir).filter((one) => one.endsWith('.field-meta.xml'))) {
        const xml = readFileSync(join(fieldDir, file), 'utf8');
        const name = file.slice(0, -'.field-meta.xml'.length);
        const type = tag(xml, 'type') ?? 'Text';
        // A hierarchy field names no object in its file: it always points at a user.
        const to =
          type === 'MetadataRelationship' ? null : (tag(xml, 'referenceTo') ?? (type === 'Hierarchy' ? 'User' : null));
        if (to === null) {
          own.push(plain(name, REST_TYPE[type] ?? 'string'));
          continue;
        }
        if (type === 'MasterDetail') details.add(object);
        own.push(lookup(name, to, name.replace(/__c$/i, '__r')));
        const child = tag(xml, 'relationshipName');
        if (child !== null) {
          children.set(to, [
            ...(children.get(to) ?? []),
            { relationshipName: `${child}__r`, childSObject: object, field: name },
          ]);
        }
      }
    }
  }
  const described = new Map<string, Record<string, unknown>>();
  for (const [object, own] of fields) {
    const kind = kinds.get(object) ?? 'object';
    const custom = /__(c|mdt|e)$/i.test(object);
    const system = SYSTEM[kind === 'object' && details.has(object) ? 'detail' : kind]();
    // A custom object and a custom setting have a name. A custom metadata type and a platform event do not.
    const named = custom && (kind === 'object' || kind === 'setting') ? [plain('Name')] : [];
    const all = [...ownSystem(object, system), ...named, ...(custom ? [] : (STANDARD[object] ?? [])), ...own];
    described.set(object, {
      name: object,
      label: `${object} (a label, which the engine drops)`,
      custom,
      fields: all.map((field) => ({ ...field, label: `${field.name} (a label)`, picklistValues: [] })),
      childRelationships: [...(STANDARD_CHILDREN[object] ?? []), ...(children.get(object) ?? [])].map((child) => ({
        ...child,
        cascadeDelete: false,
      })),
    });
  }
  return described;
}
