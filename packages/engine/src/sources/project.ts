/**
 * What OrgLens reads of `sfdx-project.json`: the package directories, and
 * the settings that change how the files of the project are laid out.
 *
 * The file is read as JSON here, not through the Salesforce library. That
 * library looks for the project from the current folder, reads the global
 * configuration with it, and cannot read the file of a commit.
 */
import { EngineError, type JsonValue } from '../core/errors.ts';

export const PROJECT_FILE = 'sfdx-project.json';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function invalid(
  message: string,
  hint = 'Correct the file, or name the folders of the source with "paths" in orglens.toml.',
): EngineError {
  return new EngineError('SOURCE_READ_FAILED', `${PROJECT_FILE}: ${message}`, {
    hint,
    details: { reason: 'PROJECT_FILE_INVALID' },
  });
}

function parse(content: Uint8Array, hint?: string): unknown {
  try {
    return JSON.parse(UTF8.decode(content));
  } catch {
    throw invalid('The file is not JSON in UTF-8.', hint);
  }
}

/**
 * A folder of a source in the one form used everywhere: relative, forward
 * slashes, no `.` or `..`, nothing at the end. Returns `null` for a path
 * that is not a folder below the root.
 */
export function normaliseDir(path: string): string | null {
  if (path.includes('\0') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return null;
  return segments.join('/');
}

/** The package directories a project file declares, in the order of the file, without those that lie in another one. */
export function packageDirectories(content: Uint8Array): string[] {
  const project = parse(content);
  const declared = (project as { packageDirectories?: unknown } | null)?.packageDirectories;
  if (!Array.isArray(declared) || declared.length === 0) {
    throw invalid('It has no "packageDirectories".');
  }
  const dirs: string[] = [];
  for (const one of declared as unknown[]) {
    const path = (one as { path?: unknown } | null)?.path;
    const dir = typeof path === 'string' ? normaliseDir(path) : null;
    if (dir === null) {
      throw invalid(
        `The package directory ${JSON.stringify(path)} is not a folder below the folder of the file. OrgLens does not read the folder of the file itself.`,
      );
    }
    // On Windows and macOS two such folders are one, and every file of it would be read under two names.
    const twin = dirs.find((other) => other !== dir && other.toLowerCase() === dir.toLowerCase());
    if (twin !== undefined) {
      throw invalid(`The package directories "${twin}" and "${dir}" differ only in upper and lower case.`);
    }
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  // A folder inside another one that is declared is read with that one. Read twice, its files would be there twice.
  return dirs.filter((dir) => !dirs.some((outer) => dir.startsWith(`${outer}/`)));
}

/**
 * How a project lays out its files where it differs from the way Salesforce hands them out. A project file can
 * ask for it, and the Salesforce library then finds other components in the same files: with one setting every
 * custom label has a file of its own, without it they all stand in one.
 *
 * A snapshot of a Git source keeps this beside its files, so that the files are read in the same way whenever
 * and wherever they are analysed.
 */
export interface ProjectLayout {
  /** The names under `sourceBehaviorOptions` and under the older `registryPresets`, each once, in that order. */
  readonly presets: readonly string[];
  /** `registryCustomizations` as the file has it: types of metadata the project describes itself. */
  readonly customizations: Readonly<Record<string, JsonValue>> | null;
}

const LAYOUT_HINT = 'Correct the file. It decides which files make up which component.';

/** The layout a project file asks for, or `null` if it asks for none. */
export function projectLayout(content: Uint8Array): ProjectLayout | null {
  const project = parse(content, LAYOUT_HINT);
  if (typeof project !== 'object' || project === null || Array.isArray(project)) return null;
  const settings = project as Readonly<Record<string, unknown>>;

  const presets: string[] = [];
  // The library reads the older name first. The order decides which setting wins where two of them disagree.
  for (const key of ['registryPresets', 'sourceBehaviorOptions']) {
    const names = settings[key];
    if (names === undefined) continue;
    if (!Array.isArray(names) || !(names as unknown[]).every((name) => typeof name === 'string')) {
      throw invalid(`"${key}" is not a list of names.`, LAYOUT_HINT);
    }
    for (const name of names as string[]) if (!presets.includes(name)) presets.push(name);
  }

  const described = settings['registryCustomizations'];
  if (described !== undefined && (typeof described !== 'object' || described === null || Array.isArray(described))) {
    throw invalid('"registryCustomizations" is not a table.', LAYOUT_HINT);
  }
  const customizations = described === undefined ? null : (described as Readonly<Record<string, JsonValue>>);
  return presets.length === 0 && customizations === null ? null : { presets, customizations };
}
