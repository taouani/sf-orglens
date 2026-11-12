/**
 * What OrgLens reads of `sfdx-project.json`: the package directories.
 *
 * The file is read as JSON here, not through the Salesforce library. That
 * library looks for the project from the current folder, reads the global
 * configuration with it, and cannot read the file of a commit.
 */
import { EngineError } from '../core/errors.ts';

export const PROJECT_FILE = 'sfdx-project.json';

const UTF8 = new TextDecoder('utf-8', { fatal: true });

function invalid(message: string): EngineError {
  return new EngineError('SOURCE_READ_FAILED', `${PROJECT_FILE}: ${message}`, {
    hint: 'Correct the file, or name the folders of the source with "paths" in orglens.toml.',
    details: { reason: 'PROJECT_FILE_INVALID' },
  });
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
  let project: unknown;
  try {
    project = JSON.parse(UTF8.decode(content));
  } catch {
    throw invalid('The file is not JSON in UTF-8.');
  }
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
