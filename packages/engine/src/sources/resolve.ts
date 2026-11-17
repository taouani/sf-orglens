/**
 * Turns a tree of files into metadata components, with the Salesforce
 * library that the Salesforce CLI uses for it.
 *
 * The library is loaded only when a tree is resolved (`library.ts`). It
 * works on the tree it is handed and never touches the disk for it. Files
 * that `.forceignore` excludes are removed from the tree before, so the
 * library is told to apply no ignore file of its own.
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { MetadataRegistry, SourceComponent } from '@salesforce/source-deploy-retrieve';
import { EngineError } from '../core/errors.ts';
import { loadRegistryVariants, loadSourceLibrary } from './library.ts';
import { PROJECT_FILE, type ProjectLayout } from './project.ts';
import { byCodeUnit, type SourceTree } from './tree.ts';

/** A metadata component found in a tree. */
export interface ResolvedComponent {
  /** The metadata type as Salesforce names it, such as `ApexClass` or `CustomField`. */
  readonly type: string;
  /** The full name, such as `Invoice__c.Amount__c`. */
  readonly fullName: string;
  /**
   * The files that are this component and no smaller one, sorted. A field
   * of an object owns its file, and the object does not. A component that
   * is an element inside the file of its parent, such as a custom label,
   * owns none.
   */
  readonly files: readonly string[];
  /**
   * For a component that is an element inside the file of its parent, such as a custom label: that file, the
   * name of the elements that hold the components of this type, and the name of the element inside one of
   * them that holds its name. Not set for a component with files of its own.
   */
  readonly within?: { readonly file: string; readonly element: string; readonly nameElement: string };
}

export interface Resolution {
  /** Sorted by type, then by full name. */
  readonly components: readonly ResolvedComponent[];
  /** Files of the tree that belong to no component, sorted. */
  readonly unresolved: readonly string[];
  /**
   * What the library could not make sense of, with the file, the folder or
   * the component it was working on. A failure is narrowed down to the
   * smallest folder or file that causes it, and everything beside that is
   * resolved. `type` is set where the problem is about a component: the type of that component.
   */
  readonly problems: readonly { readonly at: string; readonly message: string; readonly type?: string }[];
  /**
   * Components that are defined in more than one place, such as a class of
   * one name in two package directories, each with the files that define
   * it. Only components without parts are looked at. One that is made of
   * parts, such as an object with its fields or the file of the custom
   * labels, may lie in several folders, and whether two files of the object
   * itself contradict each other is not checked.
   */
  readonly duplicates: readonly {
    readonly type: string;
    readonly fullName: string;
    readonly paths: readonly string[];
  }[];
}

/**
 * The folder the library believes the tree is in. It is never read: the
 * library builds paths with the functions of the operating system, and an
 * absolute folder keeps those paths apart from the current folder.
 */
const VIRTUAL_ROOT = resolve(sep, 'orglens-source');

/** What the library says went wrong, with its paths shown as paths of the source. */
const messageOf = (thrown: unknown): string =>
  (thrown instanceof Error ? thrown.message : String(thrown)).split(`${VIRTUAL_ROOT}${sep}`).join('');

/**
 * The description of the metadata types with the settings of a project on top of it.
 *
 * The library is handed the settings themselves and never a folder: asked for a folder, it reads the project
 * file that is there now, and without one it reads that of the folder the process runs in.
 */
async function registryOf(layout: ProjectLayout): Promise<MetadataRegistry> {
  const [{ presetMap }, { getEffectiveRegistry }] = await Promise.all([loadSourceLibrary(), loadRegistryVariants()]);
  const presets = layout.presets.map((name) => {
    const preset = presetMap.get(name);
    if (preset === undefined) {
      throw new EngineError(
        'SOURCE_READ_FAILED',
        `The files are laid out with the project setting "${name}", which this version of OrgLens does not know.`,
        {
          hint: `It stands under "sourceBehaviorOptions" or "registryPresets" in ${PROJECT_FILE}. Known are: ${[...presetMap.keys()].sort(byCodeUnit).join(', ')}.`,
          details: { reason: 'LAYOUT_UNKNOWN', setting: name },
        },
      );
    }
    return preset;
  });
  try {
    // An empty list of presets would send the library to the project of the current folder, so none is passed.
    return getEffectiveRegistry({
      ...(presets.length > 0 ? { presets } : {}),
      registryCustomizations: (layout.customizations ?? {}) as MetadataRegistry,
    });
  } catch (error) {
    throw new EngineError(
      'SOURCE_READ_FAILED',
      `The "registryCustomizations" of ${PROJECT_FILE} are refused: ${messageOf(error)}`,
      { hint: 'Correct them in the project file.', details: { reason: 'LAYOUT_INVALID' }, cause: error },
    );
  }
}

/**
 * Resolves the components below the given folders of a tree. The folder `''` is the tree itself.
 *
 * A project can change how its files are laid out, with settings in its `sfdx-project.json`. `layout` holds
 * them. With `null` the files are laid out as Salesforce hands them out, which is how the files of an org are
 * stored. No project file is read here, and the folder the process runs in plays no part.
 */
export async function resolveComponents(
  tree: SourceTree,
  dirs: readonly string[],
  layout: ProjectLayout | null = null,
): Promise<Resolution> {
  const { MetadataResolver, RegistryAccess, TreeContainer, registry } = await loadSourceLibrary();

  // Every folder of the tree with the names in it, from the list of files.
  const folders = new Map<string, Set<string>>([['', new Set()]]);
  const files = new Set(tree.files);
  for (const file of tree.files) {
    const segments = file.split('/');
    segments.forEach((name, depth) => {
      const folder = segments.slice(0, depth).join('/');
      let names = folders.get(folder);
      if (names === undefined) folders.set(folder, (names = new Set()));
      names.add(name);
    });
  }

  /** The path inside the tree of a path the library uses, or `null` for a path outside the tree. */
  const inTree = (fsPath: string): string | null => {
    const path = relative(VIRTUAL_ROOT, resolve(VIRTUAL_ROOT, fsPath));
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) return null;
    return path.split(sep).join('/');
  };

  class Container extends TreeContainer {
    exists(fsPath: string): boolean {
      const path = inTree(fsPath);
      return path !== null && (files.has(path) || folders.has(path));
    }
    isDirectory(fsPath: string): boolean {
      const path = inTree(fsPath);
      return path !== null && folders.has(path);
    }
    readDirectory(fsPath: string): string[] {
      const path = inTree(fsPath);
      const names = path === null ? undefined : folders.get(path);
      if (names === undefined) throw new Error(`${fsPath} is not a folder of the source.`);
      return [...names];
    }
    readFileSync(fsPath: string): Buffer {
      const path = inTree(fsPath);
      if (path === null || !files.has(path)) throw new Error(`${fsPath} is not a file of the source.`);
      try {
        return Buffer.from(tree.read(path));
      } catch (error) {
        // The message of the system names the file by its path on this machine, so only its code is kept.
        const code = (error as { code?: unknown } | null)?.code;
        throw new Error(`${path} could not be read${typeof code === 'string' ? ` (${code})` : ''}.`, { cause: error });
      }
    }
    readFile(fsPath: string): Promise<Buffer> {
      try {
        return Promise.resolve(this.readFileSync(fsPath));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    stream(fsPath: string): Readable {
      throw new Error(`${fsPath}: a source is not read as a stream.`);
    }
  }

  const types = new RegistryAccess(layout === null ? registry : await registryOf(layout));
  const resolver = new MetadataResolver(types, new Container(), false);
  const problems: { at: string; message: string; type?: string }[] = [];
  const owner = new Map<string, string>();
  interface Found {
    type: string;
    fullName: string;
    files: string[];
    within?: NonNullable<ResolvedComponent['within']>;
  }
  const found = new Map<string, Found>();
  /** Where each component that is not made of parts is defined: the paths of its own file. */
  const definedAt = new Map<string, Set<string>>();

  const idOf = (component: SourceComponent): string => `${component.type.name}\n${component.fullName}`;
  const entryOf = (component: SourceComponent): Found => {
    const id = idOf(component);
    let entry = found.get(id);
    if (entry === undefined) {
      found.set(id, (entry = { type: component.type.name, fullName: component.fullName, files: [] }));
    }
    return entry;
  };

  const visit = (component: SourceComponent, parent?: SourceComponent): void => {
    const type = component.type.name;
    const fullName = component.fullName;
    const id = idOf(component);
    let children: SourceComponent[] = [];
    try {
      children = component.getChildren();
    } catch (error) {
      problems.push({ at: `${type} ${fullName}`, message: messageOf(error), type });
    }
    // The smaller components first, so that a file goes to the smallest component it belongs to.
    for (const child of children) visit(child, component);

    let content: string[] = [];
    try {
      content = component.walkContent();
    } catch (error) {
      problems.push({ at: `${type} ${fullName}`, message: messageOf(error), type });
    }
    // A component whose parts lie in several folders is found once per folder. Its files are put together.
    const entry = entryOf(component);
    // A component without parts has one definition. A second one at another path is a second component of the
    // same name. A component with parts is left alone: Salesforce puts an object together from several folders,
    // and projects in use have the file of the object itself in more than one of them.
    const definition = component.xml === undefined ? null : inTree(component.xml);
    if (definition !== null && component.type.children === undefined) {
      let paths = definedAt.get(id);
      if (paths === undefined) definedAt.set(id, (paths = new Set()));
      paths.add(definition);
    }
    // A component that is an element of the file of its parent names that file as its own. It stays the parent's.
    const parentFile = (parent ?? component.parent)?.xml;
    const { xmlElementName, uniqueIdElement } = component.type;
    if (component.xml !== undefined && component.xml === parentFile && xmlElementName !== undefined) {
      const file = inTree(component.xml);
      if (file !== null && files.has(file)) {
        entry.within = { file, element: xmlElementName, nameElement: uniqueIdElement ?? 'fullName' };
      }
    }
    for (const fsPath of [component.xml, ...content]) {
      const path = fsPath === undefined || fsPath === parentFile ? null : inTree(fsPath);
      if (path === null || !files.has(path) || owner.has(path)) continue;
      owner.set(path, id);
      entry.files.push(path);
    }
  };

  /** Files and folders the library failed on. They are named in a problem and not counted as unresolved again. */
  const failed: string[] = [];

  /**
   * Resolves what is at a path. The library gives up on a whole folder for
   * one file it cannot place, so a folder that fails is resolved entry by
   * entry, down to the file or the folder that is the cause.
   */
  const resolveAt = (path: string): void => {
    const names = folders.get(path);
    // Walking a folder, the library reads a component from its -meta.xml file and from nothing else. Asked for
    // another file by name, it would make a component of an Apex file that has no -meta.xml file.
    if (names === undefined && !path.endsWith('-meta.xml')) return;
    let components: SourceComponent[];
    try {
      components = resolver.getComponentsFromPath(join(VIRTUAL_ROOT, ...path.split('/')));
    } catch (error) {
      const before = problems.length;
      for (const name of [...(names ?? [])].sort(byCodeUnit)) resolveAt(path === '' ? name : `${path}/${name}`);
      if (problems.length === before) {
        // A file, or a folder in which nothing fails on its own: this is what the library cannot read.
        problems.push({ at: path, message: messageOf(error) });
        failed.push(path);
      }
      return;
    }
    for (const component of components) visit(component);
  };

  for (const dir of dirs) {
    if (folders.has(dir)) resolveAt(dir);
  }

  const below = (file: string): boolean => dirs.some((dir) => dir === '' || file.startsWith(`${dir}/`));
  const inFailed = (file: string): boolean => failed.some((at) => file === at || file.startsWith(`${at}/`));
  return {
    components: [...found.values()]
      .map((component) => ({ ...component, files: component.files.sort(byCodeUnit) }))
      .sort((a, b) => byCodeUnit(a.type, b.type) || byCodeUnit(a.fullName, b.fullName)),
    unresolved: tree.files.filter((file) => below(file) && !owner.has(file) && !inFailed(file)),
    problems,
    duplicates: [...definedAt]
      .filter(([, paths]) => paths.size > 1)
      .map(([id, paths]) => {
        const [type = '', fullName = ''] = id.split('\n');
        return { type, fullName, paths: [...paths].sort(byCodeUnit) };
      })
      .sort((a, b) => byCodeUnit(a.type, b.type) || byCodeUnit(a.fullName, b.fullName)),
  };
}
