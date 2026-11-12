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
import type { SourceComponent } from '@salesforce/source-deploy-retrieve';
import { loadSourceLibrary } from './library.ts';
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
   * resolved.
   */
  readonly problems: readonly { readonly at: string; readonly message: string }[];
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

/** Resolves the components below the given folders of a tree. */
export async function resolveComponents(tree: SourceTree, dirs: readonly string[]): Promise<Resolution> {
  const { MetadataResolver, RegistryAccess, TreeContainer } = await loadSourceLibrary();

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

  const resolver = new MetadataResolver(new RegistryAccess(), new Container(), false);
  const problems: { at: string; message: string }[] = [];
  const owner = new Map<string, string>();
  const found = new Map<string, { type: string; fullName: string; files: string[] }>();
  /** Where each component that is not made of parts is defined: the paths of its own file. */
  const definedAt = new Map<string, Set<string>>();

  const idOf = (component: SourceComponent): string => `${component.type.name}\n${component.fullName}`;
  const entryOf = (component: SourceComponent): { type: string; fullName: string; files: string[] } => {
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
      problems.push({ at: `${type} ${fullName}`, message: messageOf(error) });
    }
    // The smaller components first, so that a file goes to the smallest component it belongs to.
    for (const child of children) visit(child, component);

    let content: string[] = [];
    try {
      content = component.walkContent();
    } catch (error) {
      problems.push({ at: `${type} ${fullName}`, message: messageOf(error) });
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
    for (const fsPath of [component.xml, ...content]) {
      // A component that is an element of the file of its parent names that file as its own. It stays the parent's.
      const path = fsPath === undefined || fsPath === (parent ?? component.parent)?.xml ? null : inTree(fsPath);
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
      for (const name of [...(names ?? [])].sort(byCodeUnit)) resolveAt(`${path}/${name}`);
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

  const below = (file: string): boolean => dirs.some((dir) => file.startsWith(`${dir}/`));
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
