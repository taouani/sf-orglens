/**
 * What the components of a type that no analyser reads can name, where the Metadata API shows it (decision
 * record 0073). An impact answer about what refers to a component leaves a type of this table out of the types it
 * does not cover when the components of the type can name nothing the answer is about.
 *
 * Each line is read from the type of the Metadata API as `@jsforce/jsforce-node` 3.13.1 declares it, in
 * `lib/api/metadata/schema.d.ts`, which is made from the description of the Metadata API (its WSDL). Version 3.13.4,
 * which the engine uses now, has the same file, byte for byte. `fields` are the paths of every field of the type, of
 * the types it is built on and of the types of its fields, as declared there. A test holds them against that file, so a
 * version of the library that changes one of these types fails it. `names` are the types of component that a value of
 * those fields can name. Where a field can name something that is no type of component, such as a user, `why` says so.
 * Where it was not plain whether a field names a component, its type is in `names`: a type too many keeps a type on the
 * list, and a type too few would drop it.
 *
 * A type that is not here stays in the list for every question. A type that is analysed is never in that list,
 * and a test fails when a type of the table is analysed. A line can name a type that is analysed, as a sharing
 * reason names its object: `namingTypes` is told which types are analysed.
 */

/** A line of the table. */
export interface NameableType {
  /** The types of component that the components of this type can name. Empty: none. */
  readonly names: readonly string[];
  /** Every field of the type, as a path, in the order of the code units. */
  readonly fields: readonly string[];
  /** Why the fields name these types and no other, in a sentence or two. */
  readonly why: string;
}

/** The fields of a folder, which the four types of folders share: `Folder` and nothing more. */
const FOLDER_FIELDS = [
  'accessType',
  'folderShares',
  'folderShares.accessLevel',
  'folderShares.sharedTo',
  'folderShares.sharedToType',
  'fullName',
  'name',
  'publicFolderAccess',
  'sharedTo',
  'sharedTo.allCustomerPortalUsers',
  'sharedTo.allInternalUsers',
  'sharedTo.allPartnerUsers',
  'sharedTo.channelProgramGroup',
  'sharedTo.channelProgramGroups',
  'sharedTo.group',
  'sharedTo.groups',
  'sharedTo.guestUser',
  'sharedTo.managerSubordinates',
  'sharedTo.managers',
  'sharedTo.portalRole',
  'sharedTo.portalRoleAndSubordinates',
  'sharedTo.queue',
  'sharedTo.role',
  'sharedTo.roleAndSubordinates',
  'sharedTo.roleAndSubordinatesInternal',
  'sharedTo.roles',
  'sharedTo.rolesAndSubordinates',
  'sharedTo.territories',
  'sharedTo.territoriesAndSubordinates',
  'sharedTo.territory',
  'sharedTo.territoryAndSubordinates',
];

/** What a folder can name through those it is shared with. */
const SHARED_WITH = ['CustomSite', 'Group', 'Network', 'Queue', 'Role', 'Territory', 'Territory2'];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The line of a type of folder. A folder names folders of its own type too, `why` says how. */
function folder(type: string, why: string): NameableType {
  return {
    names: [...SHARED_WITH, type].sort(byCodeUnit),
    fields: FOLDER_FIELDS,
    why: `A folder names those it is shared with: groups, queues, roles and territories, and the guest user of a site. A user, a manager and a group of a channel programme are no components. ${why}`,
  };
}

/** A folder of reports or dashboards in a folder has the path of the folders around it in its name (record 0072). */
const NESTED = 'A folder in a folder has the names of the folders around it in its own.';
/** Of the other folders, the author does not know that one can lie in another, and does not rule it out. */
const NOT_KNOWN = 'Whether a folder of this type can lie in another is not known here, so it names its own type.';

/** The table, by the name of the type in the Metadata API. */
export const WHAT_A_TYPE_CAN_NAME: ReadonlyMap<string, NameableType> = new Map<string, NameableType>([
  [
    'ApexTestSuite',
    { names: ['ApexClass'], fields: ['fullName', 'testClassName'], why: 'A suite names the test classes it runs.' },
  ],
  [
    'ContentAsset',
    {
      names: ['Network', 'WaveApplication'],
      fields: [
        'content',
        'format',
        'fullName',
        'isVisibleByExternalUsers',
        'language',
        'masterLabel',
        'originNetwork',
        'relationships',
        'relationships.insightsApplication',
        'relationships.insightsApplication.access',
        'relationships.insightsApplication.isManagingWorkspace',
        'relationships.insightsApplication.name',
        'relationships.network',
        'relationships.network.access',
        'relationships.network.isManagingWorkspace',
        'relationships.network.name',
        'relationships.organization',
        'relationships.organization.access',
        'relationships.organization.isManagingWorkspace',
        'relationships.organization.name',
        'relationships.workspace',
        'relationships.workspace.access',
        'relationships.workspace.isManagingWorkspace',
        'relationships.workspace.name',
        'versions',
        'versions.version',
        'versions.version.number',
        'versions.version.pathOnClient',
        'versions.version.zipEntry',
      ],
      why: 'An asset is a file. Its relationships name the sites and the apps of analytics it is shared with, a library and the org. A library and the org are no components.',
    },
  ],
  [
    'CspTrustedSite',
    {
      names: [],
      fields: ['context', 'description', 'endpointUrl', 'fullName', 'isActive'],
      why: 'An address on the web that pages may load from.',
    },
  ],
  [
    'CustomLabel',
    {
      names: [],
      fields: ['categories', 'fullName', 'language', 'protected', 'shortDescription', 'value'],
      why: 'A label is a text and words about it.',
    },
  ],
  [
    'CustomLabels',
    {
      names: ['CustomLabel'],
      fields: [
        'fullName',
        'labels',
        'labels.categories',
        'labels.fullName',
        'labels.language',
        'labels.protected',
        'labels.shortDescription',
        'labels.value',
      ],
      why: 'The file holds the labels and nothing else.',
    },
  ],
  [
    'CustomNotificationType',
    {
      names: [],
      fields: ['customNotifTypeName', 'description', 'desktop', 'fullName', 'masterLabel', 'mobile'],
      why: 'A name, and where a notification of the type is shown.',
    },
  ],
  [
    'CustomPermission',
    {
      names: ['ConnectedApp', 'CustomPermission'],
      fields: [
        'connectedApp',
        'description',
        'fullName',
        'label',
        'requiredPermission',
        'requiredPermission.customPermission',
        'requiredPermission.dependency',
      ],
      why: 'A permission names the connected app it belongs to and the custom permissions it needs.',
    },
  ],
  ['DashboardFolder', folder('DashboardFolder', NESTED)],
  [
    'Document',
    {
      names: ['DocumentFolder'],
      fields: ['content', 'description', 'fullName', 'internalUseOnly', 'keywords', 'name', 'public'],
      why: 'A document is a file and words about it. Its full name begins with the name of its folder.',
    },
  ],
  ['DocumentFolder', folder('DocumentFolder', NOT_KNOWN)],
  ['EmailFolder', folder('EmailFolder', NOT_KNOWN)],
  [
    'GlobalValueSet',
    {
      names: [],
      fields: [
        'customValue',
        'customValue.color',
        'customValue.default',
        'customValue.description',
        'customValue.fullName',
        'customValue.isActive',
        'customValue.label',
        'description',
        'fullName',
        'masterLabel',
        'sorted',
      ],
      why: 'A value set holds its values, which are its own.',
    },
  ],
  [
    'GlobalValueSetTranslation',
    {
      names: ['GlobalValueSet'],
      fields: ['fullName', 'valueTranslation', 'valueTranslation.masterLabel', 'valueTranslation.translation'],
      why: 'A translation is named after the global value set whose values it translates.',
    },
  ],
  [
    'Group',
    {
      names: [],
      fields: ['doesIncludeBosses', 'fullName', 'name'],
      why: 'A name, and whether the managers of its members belong to the group. Who is in it is no metadata.',
    },
  ],
  [
    'Letterhead',
    {
      names: ['Document'],
      fields: [
        'available',
        'backgroundColor',
        'bodyColor',
        'bottomLine',
        'bottomLine.color',
        'bottomLine.height',
        'description',
        'footer',
        'footer.backgroundColor',
        'footer.height',
        'footer.horizontalAlignment',
        'footer.logo',
        'footer.verticalAlignment',
        'fullName',
        'header',
        'header.backgroundColor',
        'header.height',
        'header.horizontalAlignment',
        'header.logo',
        'header.verticalAlignment',
        'middleLine',
        'middleLine.color',
        'middleLine.height',
        'name',
        'topLine',
        'topLine.color',
        'topLine.height',
      ],
      why: 'Colours and sizes, and the logo of the header and the footer, which can be a document.',
    },
  ],
  [
    'PermissionSetGroup',
    {
      names: ['MutingPermissionSet', 'PermissionSet'],
      fields: ['description', 'fullName', 'label', 'mutingPermissionSets', 'permissionSets', 'status'],
      why: 'A group names the permission sets it holds and those that mute them.',
    },
  ],
  [
    'PlatformCachePartition',
    {
      names: [],
      fields: [
        'description',
        'fullName',
        'isDefaultPartition',
        'masterLabel',
        'platformCachePartitionTypes',
        'platformCachePartitionTypes.allocatedCapacity',
        'platformCachePartitionTypes.allocatedPurchasedCapacity',
        'platformCachePartitionTypes.allocatedTrialCapacity',
        'platformCachePartitionTypes.cacheType',
      ],
      why: 'Sizes of the cache.',
    },
  ],
  [
    'RemoteSiteSetting',
    {
      names: [],
      fields: ['description', 'disableProtocolSecurity', 'fullName', 'isActive', 'url'],
      why: 'An address on the web that the org may call.',
    },
  ],
  ['ReportFolder', folder('ReportFolder', NESTED)],
  [
    'SharingReason',
    {
      names: ['CustomObject'],
      fields: ['fullName', 'label'],
      why: 'A label. A reason belongs to the object it is named after.',
    },
  ],
  [
    'StaticResource',
    {
      names: [],
      fields: ['cacheControl', 'content', 'contentType', 'description', 'fullName'],
      why: 'A static resource is a file and words about it.',
    },
  ],
]);

/**
 * Of the types an answer about what refers to a component does not cover, the ones that matter for it: a type
 * whose components can name a type of the answer, or about which the table says nothing. The types of the answer
 * are those of the component asked about, of what it contains and of the results, and every type that stays. The
 * last holds for a chain through components that are not analysed: what can name such a component can refer to
 * the component asked about through it. Once a type stays, every type of `analysed` is of the answer too: a
 * component that is analysed and is no result can refer to a component of the type that stays, and through it to
 * the component asked about. The order of `types` is kept.
 */
export function namingTypes<T extends { readonly type: string }>(
  types: readonly T[],
  answer: Iterable<string>,
  analysed: Iterable<string>,
): T[] {
  const near = new Set(answer);
  const behind = [...analysed];
  const kept = new Set<string>();
  let more = true;
  while (more) {
    more = false;
    for (const { type } of types) {
      if (kept.has(type)) continue;
      const line = WHAT_A_TYPE_CAN_NAME.get(type);
      if (line === undefined || line.names.some((one) => near.has(one))) {
        if (kept.size === 0) for (const one of behind) near.add(one);
        kept.add(type);
        near.add(type);
        more = true;
      }
    }
  }
  return types.filter(({ type }) => kept.has(type));
}
