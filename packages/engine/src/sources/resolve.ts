/**
 * Turns a tree of files into metadata components, with the Salesforce
 * library that the Salesforce CLI uses for it.
 *
 * The library is loaded here and only when a tree is resolved: importing it
 * costs about half a second. It works on the tree it is handed and never
 * touches the disk for it. Files that `.forceignore` excludes are removed
 * from the tree before, so the library is told to apply no ignore file of
 * its own.
 */
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type * as Library from '@salesforce/source-deploy-retrieve';
import type { SourceComponent } from '@salesforce/source-deploy-retrieve';
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
  /** What the library could not make sense of, with the folder or the component it was working on. */
  readonly problems: readonly { readonly at: string; readonly message: string }[];
}

let library: Promise<typeof Library> | undefined;

/** Loads the Salesforce library once. It is told beforehand not to write a log file into the home folder. */
function loadLibrary(): Promise<typeof Library> {
  process.env['SF_DISABLE_LOG_FILE'] ??= 'true';
  library ??= import('@salesforce/source-deploy-retrieve');
  return library;
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
  const { MetadataResolver, RegistryAccess, TreeContainer } = await loadLibrary();

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

  const visit = (component: SourceComponent, parent?: SourceComponent): void => {
    const type = component.type.name;
    const fullName = component.fullName;
    const id = `${type}\n${fullName}`;
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
    const entry = found.get(id) ?? { type, fullName, files: [] };
    found.set(id, entry);
    for (const fsPath of [component.xml, ...content]) {
      // A component that is an element of the file of its parent names that file as its own. It stays the parent's.
      const path = fsPath === undefined || fsPath === parent?.xml ? null : inTree(fsPath);
      if (path === null || !files.has(path) || owner.has(path)) continue;
      owner.set(path, id);
      entry.files.push(path);
    }
  };

  for (const dir of dirs) {
    if (!folders.has(dir)) continue;
    try {
      for (const component of resolver.getComponentsFromPath(join(VIRTUAL_ROOT, ...dir.split('/')))) visit(component);
    } catch (error) {
      problems.push({ at: dir, message: messageOf(error) });
    }
  }

  const below = (file: string): boolean => dirs.some((dir) => file.startsWith(`${dir}/`));
  return {
    components: [...found.values()]
      .map((component) => ({ ...component, files: component.files.sort(byCodeUnit) }))
      .sort((a, b) => byCodeUnit(a.type, b.type) || byCodeUnit(a.fullName, b.fullName)),
    unresolved: tree.files.filter((file) => below(file) && !owner.has(file)),
    problems,
  };
}
