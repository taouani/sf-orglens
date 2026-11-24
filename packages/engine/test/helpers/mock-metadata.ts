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
 *
 * The org lists three kinds of components under another name than the one
 * the library gives them, as an org does (decision records 0071 and 0072): a
 * document with the ending of its file, what belongs to person accounts
 * under the object `Account`, and a report, a dashboard or a folder of them
 * that lies in a folder inside a folder without the outer folders. It is
 * asked for them by the listed name and hands out the files of the folder.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
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
  /** The name the Salesforce library gives the component, which is the name of its files in the folder. */
  readonly fullName: string;
  /** The name the org lists it with, before the prefix of a package. */
  readonly listedName: string;
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

/** What an org says about one component of a deploy that it does not accept. */
interface DeployProblem {
  readonly type: string;
  readonly fullName: string;
  readonly fileName: string;
  readonly line?: number;
  readonly column?: number;
  readonly problem: string;
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
  /**
   * Components of a package, as `Type:FullName`, with the prefix of the package. The org lists such a component
   * as `prefix__FullName` and hands it out under the name it has in the project, without the prefix.
   */
  readonly packaged: Map<string, string>;
  /**
   * Types the org describes beside the ones of the project, such as a type the Salesforce library does not know:
   * the name, the folder of its files, and the types of its parts.
   */
  readonly unknownTypes: Map<string, { readonly directory: string; readonly children?: readonly string[] }>;
  /** A retrieve of more files than this fails. */
  maxFiles: number;
  /** How often a retrieve answers "in progress" before it is done. */
  pollsBeforeDone: number;
  /** While this is true, no retrieve gets done. */
  hold: boolean;
  /** Jobs the org has forgotten: asking for one is answered with a fault. */
  readonly forgotten: Set<string>;
  /** Files the org puts into the zip file of every retrieve beside what was asked for: path below `unpackaged`, and content. */
  readonly extraFiles: Map<string, string>;
  /**
   * What the org hands out for a name beside what the folder holds, such as a version of a flow asked for by its
   * number: `Type:FullName` to the path below `unpackaged` and the content of the one file it answers with.
   */
  readonly handedOut: Map<string, { readonly path: string; readonly text: string }>;
  /**
   * The versions of a flow beside the one of the folder, by the name of the flow: the file of the folder is the
   * version `latest`, and `older` holds the text of earlier versions by their numbers. A flow that is not named
   * here has one version, the one of the folder, and is known by its name alone. For a flow that is named here
   * the org answers for a name with a number as run 22 of "Live org" showed: the latest version comes back under
   * the name of the flow (`flows/Name.flow`), an older one under the name with its number (`flows/Name-1.flow`),
   * and a number the flow does not have is not found. The definition of the flow names the version whose text is
   * active.
   */
  readonly flowVersions: Map<string, { readonly latest: number; readonly older: ReadonlyMap<number, string> }>;
  /** What the org finds wrong in a deploy. While it holds something, a deploy fails and changes nothing. */
  readonly deployProblems: DeployProblem[];
  /** Every deploy that was started, in order: the files of its zip file, their content as text, and its options. */
  readonly deploys: {
    readonly files: string[];
    readonly texts: ReadonlyMap<string, string>;
    readonly options: Readonly<Record<string, string>>;
  }[];
  /** Every request to the Metadata API, in order. */
  readonly calls: MetadataCall[];
  /** The members of every retrieve that was started, in order, each as `Type:FullName`. */
  readonly retrieves: string[][];
  /** The id the org lists a component with, or `null` for a component it does not list. */
  idOf(type: string, fullName: string): string | null;
  /**
   * The id of a version of a flow of the folder: for the latest version the id the org lists the flow with, and
   * for an older one an id of its own, which no listing holds, as the test org showed (decision record 0060).
   * `null` for a version the flow does not have.
   */
  versionIdOf(flow: string, version: number): string | null;
  /**
   * The rows of `FlowDefinition` that the Tooling API gives for the flows of the folder: the name, the prefix of the
   * package, the id of the definition, of the active version and of the latest one.
   */
  flowDefinitionRows(): Record<string, string | null>[];
  /** Answers one request to the Metadata API. */
  answer(body: string): Promise<{ status: number; body: string; type: string }>;
}

async function library(): Promise<typeof SourceLibrary> {
  // As the engine does before it loads the library: no log file in the home folder.
  process.env['SF_DISABLE_LOG_FILE'] = 'true';
  return import('@salesforce/source-deploy-retrieve');
}

const key = (type: string, fullName: string): string => `${type}:${fullName}`;

/**
 * The types of which an org lists what belongs to person accounts under the object `Account`: a record type, as
 * https://github.com/mdapi-issues/listmetadata-recordtype-personaccount shows, and the two kinds of rules, as a
 * snapshot of a large org showed. The org hands each out under the object `PersonAccount`.
 */
const LISTED_UNDER_ACCOUNT = new Set(['RecordType', 'MatchingRule', 'DuplicateRule']);

/**
 * The name of a component of such a type, or of the file it lies in, as the org lists it: `PersonAccount.Client`
 * as `Account.Client`, and the file `PersonAccount` as `Account`. Any other name is listed as it is. A folder that
 * holds `Account.Client` beside `PersonAccount.Client` is not provided for: the org would list one name twice.
 */
const underAccount = (type: string, name: string): string =>
  LISTED_UNDER_ACCOUNT.has(type) && /^PersonAccount(?:\.|$)/.test(name) ? name.slice('Person'.length) : name;

/**
 * The types an org lists without the folders around the innermost one, as a snapshot of a large org showed:
 * reports and dashboards, and the folders of both.
 */
const LISTED_BY_INNERMOST_FOLDER = new Set(['Dashboard', 'DashboardFolder', 'Report', 'ReportFolder']);

/**
 * The name of a component of such a type as the org lists it. `folders`: how many folders the listed name keeps,
 * which is none for a folder and one for what lies in it. `Top/Sub/Monthly` is listed as `Sub/Monthly`, and the
 * folder `Top/Sub` as `Sub`. Any other name is listed as it is.
 */
const byInnermostFolder = (type: string, name: string, folders: 0 | 1): string =>
  LISTED_BY_INNERMOST_FOLDER.has(type)
    ? name
        .split('/')
        .slice(-1 - folders)
        .join('/')
    : name;

/** The metadata of an org that holds what the folder holds. `dir` is a folder in source format. */
export async function metadataFromSource(dir: string): Promise<MockMetadata> {
  const { ComponentSet, MetadataConverter, RegistryAccess, SourceComponent: Component } = await library();
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
  /**
   * The parts by their own names. A retrieve of a part hands out the file of its parent with the parts that
   * were asked for and nothing else of the parent: each part is kept here with a parent that has no file.
   * Whether Salesforce does the same is not verified.
   */
  const parts = new Map<string, SourceComponent>();
  const alone = (part: SourceComponent, owner: SourceComponent): SourceComponent =>
    new Component({
      name: part.name,
      type: part.type,
      ...(part.xml === undefined ? {} : { xml: part.xml }),
      parent: new Component({ name: owner.name, type: owner.type }),
    });
  const list = (component: SourceComponent, file: SourceComponent): void => {
    if (listed.some((item) => item.type === component.type.name && item.fullName === component.fullName)) return;
    const type = component.type.name;
    // The folder a component lies in is the innermost one: the org lists what a folder holds by that name.
    const folder = component.type.folderType !== undefined ? (component.fullName.split('/').at(-2) ?? null) : null;
    // An org lists a document with the ending of its file, and its file under that name.
    if (type === 'Document' && folder !== null && component.content !== undefined) {
      const listedName = `${folder}/${basename(component.content)}`;
      listed.push({ type, fullName: component.fullName, listedName, fileName: `documents/${listedName}`, folder });
      return;
    }
    listed.push({
      type,
      fullName: component.fullName,
      listedName: byInnermostFolder(type, underAccount(type, component.fullName), folder === null ? 0 : 1),
      fileName: `${file.type.directoryName}/${underAccount(type, file.fullName)}${file.type.suffix === undefined ? '' : `.${file.type.suffix}`}`,
      folder,
    });
  };
  for (const component of top) {
    // A part without the file of its parent, such as a custom field of a standard object: the org has the parent.
    const owner = component.parent ?? component;
    describe(owner.type.name);
    const id = key(owner.type.name, owner.fullName);
    owners.set(id, [...(owners.get(id) ?? []), component]);
    list(owner, owner);
    for (const part of owner === component ? component.getChildren() : [component]) {
      list(part, owner);
      parts.set(key(part.type.name, part.fullName), alone(part, owner));
    }
  }

  // An org keeps a definition of every flow, and lists it and hands it out: run 19 of "Live org" saw 7 flows and 7
  // definitions. A flow of the folder without the file of its definition gets one here. What the org writes in it
  // for a flow without an active version was not seen: here it names no number then.
  const flows = new Map(top.filter((one) => one.type.name === 'Flow').map((one) => [one.fullName, one]));
  const defined = new Set(top.filter((one) => one.type.name === 'FlowDefinition').map((one) => one.fullName));
  const madeDefinitions = new Set<string>();
  for (const name of flows.keys()) {
    if (defined.has(name)) continue;
    describe('FlowDefinition');
    madeDefinitions.add(name);
    listed.push({
      type: 'FlowDefinition',
      fullName: name,
      listedName: name,
      fileName: `flowDefinitions/${name}.flowDefinition`,
      folder: null,
    });
  }
  const isActive = (text: string): boolean => text.includes('<status>Active</status>');
  /** The number of the version of a flow whose text is active, or `null`. */
  const activeVersionOf = (name: string): number | null => {
    const flow = flows.get(name);
    const versions = metadata.flowVersions.get(name);
    const latest = versions?.latest ?? 1;
    let active = flow?.xml !== undefined && isActive(readFileSync(flow.xml, 'utf8')) ? latest : (null as number | null);
    for (const [number, text] of versions?.older ?? []) if (active === null && isActive(text)) active = number;
    return active;
  };
  const definitionOf = (name: string): string => {
    const active = activeVersionOf(name);
    const number = active === null ? '' : `    <activeVersionNumber>${String(active)}</activeVersionNumber>\n`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<FlowDefinition xmlns="${NAMESPACE}">\n${number}</FlowDefinition>\n`;
  };

  let issued = 0;
  const jobs = new Map<string, RetrieveJob>();
  const deployJobs = new Map<string, { readonly files: string[]; polls: number }>();

  const idOf = (index: number): string => `0Axxx${String(index).padStart(10, '0')}AAA`;
  /** The name the org lists a component with: its listed name, or that with the prefix of its package. */
  const listedAs = (item: Listed): string => {
    const prefix = metadata.packaged.get(key(item.type, item.fullName));
    return prefix === undefined ? item.listedName : `${prefix}__${item.listedName}`;
  };
  const properties = (tag: string, item: Listed, index: number): string => {
    const prefix = metadata.packaged.get(key(item.type, item.fullName));
    return (
      `<${tag}><createdById>005xx000000001AAAA</createdById><createdByName>Mock User</createdByName>` +
      `<createdDate>2026-01-15T10:00:00.000Z</createdDate><fileName>${escapeXml(item.fileName)}</fileName>` +
      `<fullName>${escapeXml(listedAs(item))}</fullName><id>${idOf(index)}</id>` +
      `<lastModifiedById>005xx000000001AAAA</lastModifiedById><lastModifiedByName>Mock User</lastModifiedByName>` +
      `<lastModifiedDate>2026-02-0${String(1 + (index % 9))}T08:30:00.000Z</lastModifiedDate>` +
      `<manageableState>${prefix === undefined ? 'unmanaged' : 'installed'}</manageableState>` +
      (prefix === undefined ? '' : `<namespacePrefix>${prefix}</namespacePrefix>`) +
      `<type>${item.type}</type></${tag}>`
    );
  };

  /** The zip file of a retrieve, and what the org says about members it does not have. */
  const zipOf = async (
    job: RetrieveJob,
  ): Promise<{ zip: Buffer; files: number; problems: string[]; found: Listed[] }> => {
    const problems: string[] = [];
    const components: SourceComponent[] = [];
    const found: Listed[] = [];
    const beside: { readonly path: string; readonly text: string }[] = [];
    for (let asked of job.members) {
      const other = metadata.handedOut.get(key(asked.type, asked.fullName));
      if (other !== undefined) {
        beside.push(other);
        continue;
      }
      if (asked.type === 'FlowDefinition' && madeDefinitions.has(asked.fullName)) {
        if (metadata.withheld.has(key(asked.type, asked.fullName))) {
          problems.push(`Entity of type '${asked.type}' named '${asked.fullName}' cannot be found`);
        } else {
          beside.push({ path: `flowDefinitions/${asked.fullName}.flowDefinition`, text: definitionOf(asked.fullName) });
          found.push(...listed.filter((item) => item.type === asked.type && item.fullName === asked.fullName));
        }
        continue;
      }
      // A name of a flow holds no hyphen, so what follows the last one is the number of a version.
      const [, flow, number] = asked.type === 'Flow' ? (/^(.+)-([1-9][0-9]*)$/.exec(asked.fullName) ?? []) : [];
      const versions = flow === undefined ? undefined : metadata.flowVersions.get(flow);
      if (flow !== undefined && number !== undefined && versions !== undefined && flows.has(flow)) {
        const older = versions.older.get(Number(number));
        if (Number(number) === versions.latest) {
          asked = { type: 'Flow', fullName: flow };
        } else if (older === undefined) {
          problems.push(`Entity of type '${asked.type}' named '${asked.fullName}' cannot be found`);
          continue;
        } else {
          beside.push({ path: `flows/${asked.fullName}.flow`, text: older });
          continue;
        }
      }
      // A component the org lists under another name than the folder has for it is asked for by the listed name.
      const inProject = listed.find((item) => item.type === asked.type && listedAs(item) === asked.fullName);
      const member = { type: asked.type, fullName: inProject?.fullName ?? asked.fullName };
      const id = key(member.type, member.fullName);
      // A folder is asked for under the type of what it holds, by the name the org lists it with.
      const folderType = folderTypeOf(member.type);
      const folderInProject = listed.find((item) => item.type === folderType && listedAs(item) === asked.fullName);
      const asFolder = folderType === null ? id : key(folderType, folderInProject?.fullName ?? member.fullName);
      const part = parts.get(id);
      const owned = owners.get(id) ?? owners.get(asFolder) ?? (part === undefined ? undefined : [part]);
      // The org knows a component of a package by its name with the prefix only.
      const shortName = inProject === undefined && metadata.packaged.has(id);
      if (owned === undefined || metadata.withheld.has(id) || shortName) {
        problems.push(`Entity of type '${asked.type}' named '${asked.fullName}' cannot be found`);
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
    for (const [path, text] of metadata.extraFiles) out.file(`unpackaged/${path}`, text);
    // What the org hands out beside the files of the project counts against the limit as they do.
    for (const { path, text } of beside) {
      out.file(`unpackaged/${path}`, text);
      files += 1;
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
    packaged: new Map(),
    unknownTypes: new Map(),
    maxFiles: 10_000,
    pollsBeforeDone: 1,
    hold: false,
    forgotten: new Set(),
    extraFiles: new Map(),
    handedOut: new Map(),
    flowVersions: new Map(),
    deployProblems: [],
    deploys: [],
    calls: [],
    retrieves: [],
    idOf: (type, fullName) => {
      const index = listed.findIndex((item) => item.type === type && item.fullName === fullName);
      return index === -1 ? null : idOf(index);
    },
    versionIdOf: (flow, version) => {
      const index = listed.findIndex((item) => item.type === 'Flow' && item.fullName === flow);
      const versions = metadata.flowVersions.get(flow);
      if (index === -1) return null;
      if (version === (versions?.latest ?? 1)) return idOf(index);
      if (versions?.older.has(version) !== true) return null;
      return `301xx${String(index).padStart(5, '0')}${String(version).padStart(5, '0')}AAA`;
    },
    flowDefinitionRows: () =>
      [...flows.keys()].map((name) => {
        const prefix = metadata.packaged.get(key('Flow', name)) ?? null;
        const active = activeVersionOf(name);
        return {
          Id: metadata.idOf('FlowDefinition', name),
          DeveloperName: name,
          NamespacePrefix: prefix,
          ActiveVersionId: active === null ? null : metadata.versionIdOf(name, active),
          LatestVersionId: metadata.versionIdOf(name, metadata.flowVersions.get(name)?.latest ?? 1),
        };
      }),
    answer: async (body) => {
      const operation = /<soapenv:Body[^>]*>\s*<(\w+)/.exec(body)?.[1] ?? '';
      const one = (tag: string, text = body): string | null => {
        const value = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1];
        return value === undefined ? null : unescapeXml(value);
      };

      if (operation === 'describeMetadata') {
        metadata.calls.push({ operation, about: '', job: null });
        for (const name of metadata.emptyTypes) describe(name);
        const unknown = [...metadata.unknownTypes].map(([name, { directory, children }]): DescribedType => ({
          name,
          directoryName: directory,
          suffix: null,
          inFolder: false,
          children: [...(children ?? [])],
        }));
        const objects = [...described.values(), ...unknown]
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

      if (operation === 'deploy') {
        const zip = await JSZip.loadAsync(Buffer.from(one('ZipFile') ?? '', 'base64'));
        const files = Object.entries(zip.files)
          .filter(([, entry]) => !entry.dir)
          .map(([path]) => path)
          .sort();
        const texts = new Map<string, string>();
        for (const path of files) texts.set(path, (await zip.file(path)?.async('string')) ?? '');
        const options: Record<string, string> = {};
        for (const [, name = '', value = ''] of (
          /<DeployOptions>(.*?)<\/DeployOptions>/s.exec(body)?.[1] ?? ''
        ).matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
          options[name] = unescapeXml(value);
        }
        issued += 1;
        const id = `0Afxx${String(issued).padStart(10, '0')}AAA`;
        deployJobs.set(id, { files, polls: 0 });
        metadata.deploys.push({ files, texts, options });
        metadata.calls.push({ operation, about: String(files.length), job: id });
        return ok(
          `<deployResponse><result><done>false</done><id>${id}</id><state>Queued</state></result></deployResponse>`,
        );
      }

      if (operation === 'checkDeployStatus') {
        const id = one('asyncProcessId') ?? '';
        metadata.calls.push({ operation, about: '', job: id });
        const job = deployJobs.get(id);
        if (job === undefined) return soapFault('INVALID_CROSS_REFERENCE_KEY', `invalid cross reference id: ${id}`);
        job.polls += 1;
        const result = (inner: string): { status: number; body: string; type: string } =>
          ok(`<checkDeployStatusResponse><result>${inner}</result></checkDeployStatusResponse>`);
        if (metadata.hold || job.polls <= metadata.pollsBeforeDone) {
          return result(
            `<checkOnly>false</checkOnly><done>false</done><id>${id}</id><status>InProgress</status><success>false</success>`,
          );
        }
        // One component per file that is not the file beside another one, as Salesforce counts them roughly.
        const components = job.files.filter((path) => path !== 'package.xml' && !path.endsWith('-meta.xml'));
        const failed = metadata.deployProblems.length > 0;
        const failures = metadata.deployProblems
          .map(
            (problem) =>
              `<componentFailures><changed>false</changed>${problem.column === undefined ? '' : `<columnNumber>${String(problem.column)}</columnNumber>`}` +
              `<componentType>${problem.type}</componentType><created>false</created><createdDate>2026-03-01T09:00:00.000Z</createdDate>` +
              `<deleted>false</deleted><fileName>${escapeXml(problem.fileName)}</fileName><fullName>${escapeXml(problem.fullName)}</fullName>` +
              `${problem.line === undefined ? '' : `<lineNumber>${String(problem.line)}</lineNumber>`}<problem>${escapeXml(problem.problem)}</problem>` +
              `<problemType>Error</problemType><success>false</success></componentFailures>`,
          )
          .join('');
        const success = (path: string, index: number): string =>
          `<componentSuccesses><changed>true</changed><componentType>${path === 'package.xml' ? '' : 'ApexClass'}</componentType>` +
          `<created>${String(path !== 'package.xml' && index % 2 === 0)}</created><createdDate>2026-03-01T09:00:00.000Z</createdDate><deleted>false</deleted>` +
          `<fileName>${escapeXml(path)}</fileName><fullName>${escapeXml(path)}</fullName><success>true</success></componentSuccesses>`;
        const successes = failed ? '' : ['package.xml', ...components].map(success).join('');
        return result(
          `<checkOnly>false</checkOnly><details>${failures}${successes}</details><done>true</done><id>${id}</id>` +
            `<numberComponentErrors>${String(metadata.deployProblems.length)}</numberComponentErrors>` +
            `<numberComponentsDeployed>${String(failed ? 0 : components.length)}</numberComponentsDeployed>` +
            `<numberComponentsTotal>${String(components.length)}</numberComponentsTotal>` +
            `<numberTestErrors>0</numberTestErrors><numberTestsCompleted>0</numberTestsCompleted><numberTestsTotal>0</numberTestsTotal>` +
            `<rollbackOnError>true</rollbackOnError><status>${failed ? 'Failed' : 'Succeeded'}</status><success>${String(!failed)}</success>`,
        );
      }

      metadata.calls.push({ operation, about: '', job: null });
      return soapFault('UNKNOWN_EXCEPTION', `The mock org does not know the operation ${operation}`);
    },
  };
  return metadata;
}
