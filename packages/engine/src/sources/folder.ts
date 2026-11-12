/**
 * Reads folders of the disk as they are.
 *
 * Symbolic links are not followed. A link can point outside the source, and
 * a snapshot must hold nothing that the source does not. A folder that is a
 * Git repository of its own, such as a submodule that is checked out, is
 * not read either: a commit of the source does not hold its files. Each
 * entry that was left out is reported.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byCodeUnit, systemCode, type TreeReading } from './tree.ts';

const UTF8 = new TextDecoder('utf-8', { fatal: true });
const GIT_FOLDER = Buffer.from('.git');

/**
 * Lists every file below the given folders of `root`. The folders are
 * relative to `root`, with forward slashes. Contents are read later, one
 * file at a time, when the tree is asked for them.
 */
export function readFolders(root: string, dirs: readonly string[]): TreeReading {
  const files: string[] = [];
  const missing: string[] = [];
  const skipped: string[] = [];
  const unreadable: { path: string; reason: string | null }[] = [];
  const undecodable: string[] = [];
  const onDisk = (path: string): string => join(root, ...path.split('/'));

  const walk = (dir: string): void => {
    let entries;
    try {
      // Names are taken as bytes: on Linux a name need not be text.
      entries = readdirSync(onDisk(dir), { withFileTypes: true, encoding: 'buffer' });
    } catch (error) {
      unreadable.push({ path: dir, reason: systemCode(error) });
      return;
    }
    if (entries.some((entry) => entry.name.equals(GIT_FOLDER))) {
      skipped.push(dir);
      return;
    }
    for (const entry of entries) {
      let name: string;
      try {
        name = UTF8.decode(entry.name);
      } catch {
        undecodable.push(`${dir}/${entry.name.toString('utf8')}`);
        continue;
      }
      const path = `${dir}/${name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
      else skipped.push(path);
    }
  };

  for (const dir of dirs) {
    let stat;
    try {
      stat = lstatSync(onDisk(dir), { throwIfNoEntry: false });
    } catch (error) {
      unreadable.push({ path: dir, reason: systemCode(error) });
      continue;
    }
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
    unreadable: unreadable.sort((a, b) => byCodeUnit(a.path, b.path)),
    undecodable: undecodable.sort(byCodeUnit),
  };
}
