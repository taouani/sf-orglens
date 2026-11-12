/**
 * The metadata of a mock org: what it describes, what it lists, and what
 * it hands out when it is asked to retrieve.
 *
 * The metadata is read from a folder in source format with the Salesforce
 * source library, and a retrieve is answered with a zip file in the form
 * Salesforce uses, which the same library writes. So the engine is tested
 * against the real form of both ends, and a test needs no recorded answer
 * of a real org.
 *
 * A test can make the org behave badly: fail the listing of a type, list a
 * component it does not hand out, refuse a retrieve that is too large, or
 * never finish one.
 */
import type * as SourceLibrary from '@salesforce/source-deploy-retrieve';
import type { SourceComponent } from '@salesforce/source-deploy-retrieve';
import JSZip from 'jszip';

const NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

const escapeXml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unescapeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const envelope = (inner: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="${NAMESPACE}"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;

/** The answer of Salesforce to a request it refuses: status 500 and a fault. */
export const soapFault = (code: string, message: string): { status: number; body: string; type: string } => ({
  status: 500,
  type: 'text/xml',
  body: `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="${NAMESPACE}"><soapenv:Body><soapenv:Fault><faultcode>sf:${code}</faultcode><faultstring>${escapeXml(`${code}: ${message}`)}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
});

interface DescribedType {
  readonly name: string;
  readonly directoryName: string;
  readonly suffix: string | null;
  readonly inFolder: boolean;
  readonly children: readonly string[];
}

interface Listed {
  readonly type: string;
  readonly fullName: string;
  readonly fileName: string;
  /** For a component in a folder: the folder. */
  readonly folder: string | null;
}

interface RetrieveJob {
  readonly id: string;
  /** Type and full name of every member that was asked for. */
  readonly members: readonly { readonly type: string; readonly fullName: string }[];
  /** How often the status was asked for. */
  polls: number;
}

/** One request to the Metadata API, as a test sees it. */
interface MetadataCall {
  readonly operation: string;
  /** `listMetadata`: the type, with the folder after a slash. `retrieve`: the number of members. Else empty. */
  readonly about: string;
  /** `checkRetrieveStatus`: the id of the job. `retrieve`: the id it was given. Else `null`. */
  readonly job: string | null;
}

export interface MockMetadata {
  /** Types the org describes although it has no component of them. */
  readonly emptyTypes: string[];
  /** Types whose listing the org refuses. */
  readonly failing: Set<string>;
  /** Components the org lists and does not hand out, as `Type:FullName`. */
  readonly withheld: Set<string>;
  /** Parents the org does not list although it lists their parts, as `Type:FullName`. */
  readonly unlistedParents: Set<string>;
  /** A retrieve of more files than this fails. */
  maxFiles: number;
  /** How often a retrieve answers "in progress" before it is done. */
  pollsBeforeDone: number;
  /** While this is true, no retrieve gets done. */
  hold: boolean;
  /** Jobs the org has forgotten: asking for one is answered with a fault. */
  readonly forgotten: Set<string>;
  /** Every request to the Metadata API, in order. */
  readonly calls: MetadataCall[];
  /** The members of every retrieve that was started, in order, each as `Type:FullName`. */
  readonly retrieves: string[][];
  /** Answers one request to the Metadata API. */
  answer(body: string): Promise<{ status: number; body: string; type: string }>;
}

async function library(): Promise<typeof SourceLibrary> {
  // As the engine does before it loads the library: no log file in the home folder.
  process.env['SF_DISABLE_LOG_FILE'] = 'true';
  return import('@salesforce/source-deploy-retrieve');
}

const key = (type: string, fullName: string): string => `${type}:${fullName}`;

/** The metadata of an org that holds what the folder holds. `dir` is a folder in source format. */
export async function metadataFromSource(dir: string): Promise<MockMetadata> {
  const { ComponentSet, MetadataConverter, RegistryAccess } = await library();
  const registry = new RegistryAccess();
  const top = ComponentSet.fromSource(dir).getSourceComponents().toArray();

  const described = new Map<string, DescribedType>();
  /** The type of the folders of a type, such as `ReportFolder` of `Report`, or `null`. */
  const folderTypeOf = (name: string): string | null => {
    const id = registry.getTypeByName(name).folderType;
    return id === undefined ? null : (registry.getRegistry().types[id]?.name ?? null);
  };
  const describe = (name: string): void => {
    if (described.has(name)) return;
    const type = registry.getTypeByName(name);
    // An org does not describe the type of the folders. It says of the type they hold that it lies in folders.
    if (type.folderContentType !== undefined) {
      describe(registry.getRegistry().types[type.folderContentType]?.name ?? name);
      return;
    }
    described.set(name, {
      name: type.name,
      directoryName: type.directoryName,
      suffix: type.suffix ?? null,
      inFolder: type.folderType !== undefined,
      children: Object.values(type.children?.types ?? {}).map((child) => child.name),
    });
  };

  const listed: Listed[] = [];
  /** What a retrieve of a member hands out: the component, or the parts of one that has no file of its own. */
  const owners = new Map<string, SourceComponent[]>();
  const list = (component: SourceComponent, file: SourceComponent): void => {
    if (listed.some((item) => item.type === component.type.name && item.fullName === component.fullName)) return;
    listed.push({
      type: component.type.name,
      fullName: component.fullName,
      fileName: `${file.type.directoryName}/${file.fullName}${file.type.suffix === undefined ? '' : `.${file.type.suffix}`}`,
      folder: component.type.folderType !== undefined ? (component.fullName.split('/')[0] ?? null) : null,
    });
  };
  for (const component of top) {
    // A part without the file of its parent, such as a custom field of a standard object: the org has the parent.
    const owner = component.parent ?? component;
    describe(owner.type.name);
    const id = key(owner.type.name, owner.fullName);
    owners.set(id, [...(owners.get(id) ?? []), component]);
    list(owner, owner);
    for (const part of owner === component ? component.getChildren() : [component]) list(part, owner);
  }

  let issued = 0;
  const jobs = new Map<string, RetrieveJob>();

  const properties = (tag: string, item: Listed, index: number): string =>
    `<${tag}><createdById>005xx000000001AAAA</createdById><createdByName>Mock User</createdByName>` +
    `<createdDate>2026-01-15T10:00:00.000Z</createdDate><fileName>${escapeXml(item.fileName)}</fileName>` +
    `<fullName>${escapeXml(item.fullName)}</fullName><id>0Axxx${String(index).padStart(10, '0')}AAA</id>` +
    `<lastModifiedById>005xx000000001AAAA</lastModifiedById><lastModifiedByName>Mock User</lastModifiedByName>` +
    `<lastModifiedDate>2026-02-0${String(1 + (index % 9))}T08:30:00.000Z</lastModifiedDate>` +
    `<manageableState>unmanaged</manageableState><type>${item.type}</type></${tag}>`;

  /** The zip file of a retrieve, and what the org says about members it does not have. */
  const zipOf = async (
    job: RetrieveJob,
  ): Promise<{ zip: Buffer; files: number; problems: string[]; found: Listed[] }> => {
    const problems: string[] = [];
    const components: SourceComponent[] = [];
    const found: Listed[] = [];
    for (const member of job.members) {
      const id = key(member.type, member.fullName);
      // A folder is asked for under the type of what it holds.
      const folderType = folderTypeOf(member.type);
      const asFolder = folderType === null ? id : key(folderType, member.fullName);
      const owned = owners.get(id) ?? owners.get(asFolder);
      if (owned === undefined || metadata.withheld.has(id)) {
        problems.push(`Entity of type '${member.type}' named '${member.fullName}' cannot be found`);
        continue;
      }
      components.push(...owned);
      found.push(...listed.filter((item) => [id, asFolder].includes(key(item.type, item.fullName))));
    }
    const out = new JSZip();
    let files = 0;
    if (components.length > 0) {
      const set = new ComponentSet(components);
      set.apiVersion = '66.0';
      set.sourceApiVersion = '66.0';
      const converted = await new MetadataConverter().convert(set, 'metadata', { type: 'zip' });
      const flat = await JSZip.loadAsync(converted.zipBuffer ?? Buffer.alloc(0));
      for (const [path, entry] of Object.entries(flat.files)) {
        if (entry.dir) continue;
        out.file(`unpackaged/${path}`, await entry.async('nodebuffer'));
        if (path !== 'package.xml') files += 1;
      }
    } else {
      out.file('unpackaged/package.xml', `<?xml version="1.0" encoding="UTF-8"?><Package xmlns="${NAMESPACE}"/>`);
    }
    return { zip: await out.generateAsync({ type: 'nodebuffer' }), files, problems, found };
  };

  const ok = (inner: string): { status: number; body: string; type: string } => ({
    status: 200,
    type: 'text/xml',
    body: envelope(inner),
  });

  const metadata: MockMetadata = {
    emptyTypes: [],
    failing: new Set(),
    withheld: new Set(),
    unlistedParents: new Set(),
    maxFiles: 10_000,
    pollsBeforeDone: 1,
    hold: false,
    forgotten: new Set(),
    calls: [],
    retrieves: [],
    answer: async (body) => {
      const operation = /<soapenv:Body[^>]*>\s*<(\w+)/.exec(body)?.[1] ?? '';
      const one = (tag: string, text = body): string | null => {
        const value = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1];
        return value === undefined ? null : unescapeXml(value);
      };

      if (operation === 'describeMetadata') {
        metadata.calls.push({ operation, about: '', job: null });
        for (const name of metadata.emptyTypes) describe(name);
        const objects = [...described.values()]
          .map(
            (type) =>
              `<metadataObjects>${type.children.map((child) => `<childXmlNames>${child}</childXmlNames>`).join('')}` +
              `<directoryName>${type.directoryName}</directoryName><inFolder>${String(type.inFolder)}</inFolder>` +
              `<metaFile>false</metaFile>${type.suffix === null ? '' : `<suffix>${type.suffix}</suffix>`}` +
              `<xmlName>${type.name}</xmlName></metadataObjects>`,
          )
          .join('');
        return ok(
          `<describeMetadataResponse><result>${objects}<organizationNamespace></organizationNamespace>` +
            `<partialSaveAllowed>true</partialSaveAllowed><testRequired>false</testRequired></result></describeMetadataResponse>`,
        );
      }

      if (operation === 'listMetadata') {
        const type = one('type') ?? '';
        const folder = one('folder');
        metadata.calls.push({ operation, about: folder === null ? type : `${type}/${folder}`, job: null });
        if (metadata.failing.has(type)) return soapFault('INVALID_TYPE', `Cannot use: ${type} in this organization`);
        const items = listed.filter(
          (item) =>
            item.type === type &&
            (folder === null || item.folder === folder) &&
            !metadata.unlistedParents.has(key(item.type, item.fullName)),
        );
        return ok(
          `<listMetadataResponse>${items.map((item) => properties('result', item, listed.indexOf(item))).join('')}</listMetadataResponse>`,
        );
      }

      if (operation === 'retrieve') {
        const members: { type: string; fullName: string }[] = [];
        for (const [, types] of body.matchAll(/<types>(.*?)<\/types>/gs)) {
          const type = one('name', types) ?? '';
          for (const [, name] of (types ?? '').matchAll(/<members>([^<]*)<\/members>/g)) {
            members.push({ type, fullName: unescapeXml(name ?? '') });
          }
        }
        issued += 1;
        const id = `09Sxx${String(issued).padStart(10, '0')}AAA`;
        jobs.set(id, { id, members, polls: 0 });
        metadata.calls.push({ operation, about: String(members.length), job: id });
        metadata.retrieves.push(members.map((member) => key(member.type, member.fullName)));
        return ok(
          `<retrieveResponse><result><done>false</done><id>${id}</id><state>Queued</state></result></retrieveResponse>`,
        );
      }

      if (operation === 'checkRetrieveStatus') {
        const id = one('asyncProcessId') ?? '';
        const withZip = one('includeZip') !== 'false';
        metadata.calls.push({ operation, about: withZip ? 'zip' : '', job: id });
        const job = jobs.get(id);
        if (job === undefined || metadata.forgotten.has(id)) {
          return soapFault('INVALID_CROSS_REFERENCE_KEY', `invalid cross reference id: ${id}`);
        }
        job.polls += 1;
        const result = (inner: string): { status: number; body: string; type: string } =>
          ok(`<checkRetrieveStatusResponse><result>${inner}</result></checkRetrieveStatusResponse>`);
        if (metadata.hold || job.polls <= metadata.pollsBeforeDone) {
          return result(`<done>false</done><id>${id}</id><status>InProgress</status><success>false</success>`);
        }
        const { zip, files, problems, found } = await zipOf(job);
        if (files > metadata.maxFiles) {
          return result(
            `<done>true</done><errorMessage>LIMIT_EXCEEDED: Too many files in retrieve call, limit is ${String(metadata.maxFiles)}.</errorMessage>` +
              `<errorStatusCode>LIMIT_EXCEEDED</errorStatusCode><id>${id}</id><status>Failed</status><success>false</success>`,
          );
        }
        return result(
          `<done>true</done>${found.map((item) => properties('fileProperties', item, listed.indexOf(item))).join('')}` +
            `<id>${id}</id>${problems.map((problem) => `<messages><fileName>unpackaged/package.xml</fileName><problem>${escapeXml(problem)}</problem></messages>`).join('')}` +
            `<status>Succeeded</status><success>true</success>${withZip ? `<zipFile>${zip.toString('base64')}</zipFile>` : ''}`,
        );
      }

      metadata.calls.push({ operation, about: '', job: null });
      return soapFault('UNKNOWN_EXCEPTION', `The mock org does not know the operation ${operation}`);
    },
  };
  return metadata;
}
