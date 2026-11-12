/**
 * Turns the zip file of a retrieve into files in source format, the form
 * a repository holds them in.
 *
 * Salesforce hands out metadata in another form than a project keeps it:
 * an object is one file with its fields inside. The Salesforce source
 * library converts between the two, and it writes the result to disk. So
 * the files of a chunk pass through a folder of the workspace, which the
 * caller creates and removes. They are read from there into the snapshot.
 *
 * Paths are the ones below the package directory: `classes/Foo.cls`. An
 * org has no package directory, and none is made up.
 *
 * The library lets the project it finds change the form files are written
 * in, and it needs a project to put custom labels together. It looks for
 * one from the folder it writes to upwards, and from the folder the
 * process runs in, which is often the repository of the user. So the work
 * folder gets a project file of its own with no such settings: what an
 * org is stored as does not depend on where the command runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceComponent } from '@salesforce/source-deploy-retrieve';
import { readFolders } from './folder.ts';
import { loadSourceLibrary } from './library.ts';
import { saidBy } from './org-errors.ts';
import { resolveComponents, type ResolvedComponent } from './resolve.ts';
import { byCodeUnit, type SourceTree } from './tree.ts';

export interface Unpacked {
  /** The files in source format. They are read from the work folder, which has to stay until they are stored. */
  readonly tree: SourceTree;
  /** The components the files make up. Sorted by type, then by full name. */
  readonly components: readonly ResolvedComponent[];
  /** What could not be read as metadata, with the file, the folder or the component it is about. */
  readonly problems: readonly { readonly at: string; readonly message: string }[];
  /** Files that were converted and belong to no component, sorted. */
  readonly unresolved: readonly string[];
}

/** The folder of a zip file that holds what was asked for by name. */
const ZIP_ROOT = 'unpackaged';
/** Where the library puts converted files, below the folder it is given. */
const CONVERTED = 'main/default/';
/** The project file of the work folder. It names the folder the files go to and changes nothing else. */
const PROJECT_FILE = 'sfdx-project.json';
const PROJECT = { packageDirectories: [{ path: 'main', default: true }] };

/**
 * Unpacks the zip file of a retrieve into `workDir`, which must exist and be empty, and reads the result.
 *
 * A file of the zip that the library cannot place is named in `problems`, and everything beside it is
 * converted.
 */
export async function unpackRetrieve(zip: Uint8Array, workDir: string): Promise<Unpacked> {
  const { MetadataConverter, MetadataResolver, RegistryAccess, ZipTreeContainer } = await loadSourceLibrary();
  writeFileSync(join(workDir, PROJECT_FILE), `${JSON.stringify(PROJECT)}\n`);
  mkdirSync(join(workDir, 'main'), { recursive: true });
  const registry = new RegistryAccess(undefined, workDir);
  const container = await ZipTreeContainer.create(Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength));
  const resolver = new MetadataResolver(registry, container, false);
  const problems: { at: string; message: string }[] = [];
  const components: SourceComponent[] = [];

  /** Resolves what is at a path of the zip. A folder that fails is resolved entry by entry, down to the cause. */
  const resolveAt = (path: string): void => {
    try {
      components.push(...resolver.getComponentsFromPath(path));
    } catch (error) {
      const before = problems.length;
      if (container.isDirectory(path)) {
        for (const name of [...container.readDirectory(path)].sort(byCodeUnit)) resolveAt(`${path}/${name}`);
      }
      if (problems.length === before) {
        problems.push({ at: path.slice(ZIP_ROOT.length + 1), message: saidBy(error).split(`${ZIP_ROOT}/`).join('') });
      }
    }
  };
  if (container.exists(ZIP_ROOT) && container.isDirectory(ZIP_ROOT)) {
    for (const name of [...container.readDirectory(ZIP_ROOT)].sort(byCodeUnit)) {
      // The manifest of the retrieve is not metadata.
      if (name !== 'package.xml') resolveAt(`${ZIP_ROOT}/${name}`);
    }
  }
  // What was asked for by name comes in one folder. Anything beside it is not read, and is not passed over either.
  for (const name of [...container.readDirectory('.')].sort(byCodeUnit)) {
    if (name !== ZIP_ROOT) {
      problems.push({
        at: name,
        message: `It is outside the folder "${ZIP_ROOT}" of the zip file, so it was not read.`,
      });
    }
  }

  // The library passes over a file it has no type for, without a word. Every file of the zip has to belong to a
  // component, or it is named here.
  const claimed = new Set<string>();
  for (const component of components) {
    try {
      for (const path of [component.xml, ...component.walkContent()]) {
        if (path !== undefined) claimed.add(path.split('\\').join('/'));
      }
    } catch (error) {
      problems.push({ at: `${component.type.name} ${component.fullName}`, message: saidBy(error) });
    }
  }
  const failed = problems.map((problem) => `${ZIP_ROOT}/${problem.at}`);
  const walk = (dir: string): void => {
    for (const name of [...container.readDirectory(dir)].sort(byCodeUnit)) {
      const path = `${dir}/${name}`;
      if (path === `${ZIP_ROOT}/package.xml` || failed.includes(path)) continue;
      if (container.isDirectory(path)) walk(path);
      else if (!claimed.has(path)) {
        problems.push({
          at: path.slice(ZIP_ROOT.length + 1),
          message: 'The file belongs to no metadata type that is known.',
        });
      }
    }
  };
  if (container.exists(ZIP_ROOT) && container.isDirectory(ZIP_ROOT)) walk(ZIP_ROOT);

  const convert = (some: SourceComponent[]): Promise<unknown> =>
    new MetadataConverter(registry).convert(some, 'source', {
      type: 'directory',
      outputDirectory: workDir,
      genUniqueDir: false,
    });
  if (components.length > 0) {
    try {
      await convert(components);
    } catch {
      // One component that cannot be converted fails the whole call. Each is tried alone, to name the one.
      for (const component of components) {
        try {
          await convert([component]);
        } catch (error) {
          problems.push({ at: `${component.type.name} ${component.fullName}`, message: saidBy(error) });
        }
      }
    }
  }

  const reading = readFolders(workDir, ['main']);
  const files = reading.tree.files
    .filter((path) => path.startsWith(CONVERTED))
    .map((path) => path.slice(CONVERTED.length));
  const known = new Set(files);
  const tree: SourceTree = {
    files,
    read: (path) => {
      if (!known.has(path)) throw new Error(`"${path}" is not a file of this tree.`);
      return reading.tree.read(`${CONVERTED}${path}`);
    },
  };
  for (const path of reading.tree.files.filter((one) => !one.startsWith(CONVERTED))) {
    problems.push({ at: path, message: 'The file was converted to a place where no metadata is expected.' });
  }

  const resolution = await resolveComponents(tree, [''], workDir);
  return {
    tree,
    components: resolution.components,
    problems: [...problems, ...resolution.problems],
    unresolved: resolution.unresolved,
  };
}
