/**
 * Reads folders of the disk as they are.
 *
 * Symbolic links are not followed. A link can point outside the source, and
 * a snapshot must hold nothing that the source does not. Each link that was
 * left out is reported.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodeUnit, type TreeReading } from './tree.ts';

/**
 * Lists every file below the given folders of `root`. The folders are
 * relative to `root`, with forward slashes. Contents are read later, one
 * file at a time, when the tree is asked for them.
 */
export function readFolders(root: string, dirs: readonly string[]): TreeReading {
  const files: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  const onDisk = (path: string): string => join(root, ...path.split('/'));

  const walk = (dir: string): void => {
    for (const entry of readdirSync(onDisk(dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else skipped.push(path);
    }
  };

  for (const dir of dirs) {
    const stat = lstatSync(onDisk(dir), { throwIfNoEntry: false });
    if (stat === undefined) missing.push(dir);
    else if (stat.isSymbolicLink()) skipped.push(dir);
    else if (!stat.isDirectory()) missing.push(dir);
    else walk(dir);
  }

  files.sort(byCodeUnit);
  const known = new Set(files);
  return {
    tree: {
      files,
      read: (path) => {
        if (!known.has(path)) throw new Error(`"${path}" is not a file of this tree.`);
        return readFileSync(onDisk(path));
      },
    },
    missing: missing.sort(byCodeUnit),
    skipped: skipped.sort(byCodeUnit),
  };
}
