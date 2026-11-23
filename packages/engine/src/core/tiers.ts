/**
 * The logic tier of metadata: the types a snapshot of an org is judged by.
 *
 * A snapshot of an org reads every type the org lists. It is `complete` when everything it should hold of the
 * types of this list came back and could be read. What is missing of another type is named in a warning and
 * leaves the snapshot complete (decision records 0004, 0038 and 0046).
 *
 * The names are those of the Metadata API. The list is the one of record 0004, word for word, with the three
 * types record 0038 adds: custom labels, custom permissions and global value sets. Every type an analyser reads
 * is on it too (decision records 0058 and 0068): a type joins with the version that analyses it, and a test holds
 * the types the analysis reads against the list. A type is on it or not by its own name: a part of an object
 * that is not named here, such as a list view, is not of the tier although the object is.
 */
const LOGIC_TIER: ReadonlySet<string> = new Set([
  // Objects, fields including formulas, validation rules, record types and field sets. A custom metadata type
  // is a custom object.
  'CustomObject',
  'CustomField',
  'ValidationRule',
  'RecordType',
  'FieldSet',
  // The records of custom metadata types.
  'CustomMetadata',
  // Apex classes and triggers.
  'ApexClass',
  'ApexTrigger',
  // Flows, and workflow rules with the file that holds them.
  'Flow',
  'Workflow',
  'WorkflowRule',
  // The actions of a workflow rule that are analysed (record 0068). The other actions are outside the tier.
  'WorkflowAlert',
  'WorkflowFieldUpdate',
  'WorkflowOutboundMessage',
  'WorkflowTask',
  // Profiles, permission sets and permission set groups.
  'Profile',
  'PermissionSet',
  'PermissionSetGroup',
  // Lightning web components and Aura components.
  'LightningComponentBundle',
  'AuraDefinitionBundle',
  'NamedCredential',
  // Added by record 0038. Custom labels are one file, and each label is a component of its own.
  'CustomLabels',
  'CustomLabel',
  'CustomPermission',
  'GlobalValueSet',
]);

/** Where a metadata type stands: in the logic tier, or in any other. */
export type Tier = 'logic' | 'other';

/** The tier of a metadata type, by the name the Metadata API gives it. */
export const tierOf = (type: string): Tier => (LOGIC_TIER.has(type) ? 'logic' : 'other');

/**
 * The tier that something missing counts against, by the types it can be of. Something whose type cannot be
 * told counts against the logic tier, and so does something that can be of a type of the tier.
 */
export const tierOfAny = (types: readonly string[]): Tier =>
  types.length > 0 && types.every((type) => tierOf(type) === 'other') ? 'other' : 'logic';

/** The types of the logic tier, sorted. */
export const logicTierTypes = (): string[] => [...LOGIC_TIER].sort();
