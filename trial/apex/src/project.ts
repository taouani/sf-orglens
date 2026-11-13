/**
 * Reads the Apex files of a project in source format: every `.cls` and every `.trigger` under a folder.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { SourceFile } from './resolver.ts';
import type { SyntaxAdapter } from './syntax.ts';

export interface ApexFile {
  /** The path inside the project, with forward slashes. */
  readonly path: string;
  readonly kind: 'class' | 'trigger';
  readonly source: string;
}

function walk(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.cls') || entry.endsWith('.trigger')) found.push(path);
  }
}

/** The Apex files under a folder, sorted by path. Line ends are made LF, as the engine does for every text. */
export function readApexFiles(root: string): ApexFile[] {
  const paths: string[] = [];
  walk(root, paths);
  return paths.map((path) => ({
    path: relative(root, path).split(sep).join('/'),
    kind: path.endsWith('.trigger') ? 'trigger' : 'class',
    source: readFileSync(path, 'utf8').replaceAll('\r\n', '\n'),
  }));
}

/** Parses every file with one parser. */
export function parseFiles(files: readonly ApexFile[], adapter: SyntaxAdapter): SourceFile[] {
  return files.map((file) => ({ path: file.path, unit: adapter.parseUnit(file.source, file.kind) }));
}
