import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFolders } from '../src/sources/folder.ts';
import { normaliseDir, packageDirectories } from '../src/sources/project.ts';
import { byCodeUnit, filterTree, pathDetails } from '../src/sources/tree.ts';
import { codeOf, tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function write(root: string, path: string, content: string | Uint8Array = ''): void {
  const file = join(root, ...path.split('/'));
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
}

describe('reading folders', () => {
  it('lists every file below the folders, sorted by code unit, and nothing else', () => {
    const root = temp.next();
    // No two names differ only in case: on Windows and macOS they would be one file.
    for (const path of ['app/c.cls', 'app/B.cls', 'app/a/deep/x.xml', 'app/é.cls', 'other/y.cls', 'outside.txt']) {
      write(root, path);
    }
    const reading = readFolders(root, ['other', 'app']);
    expect(reading.tree.files).toEqual(['app/B.cls', 'app/a/deep/x.xml', 'app/c.cls', 'app/é.cls', 'other/y.cls']);
    expect(reading).toMatchObject({ missing: [], skipped: [] });
  });

  it('returns the content of a file byte for byte, and of no path it did not list', () => {
    const root = temp.next();
    const content = new Uint8Array([0, 255, 13, 10, 10, 0xef, 0xbb, 0xbf]);
    write(root, 'app/data.bin', content);
    write(root, 'outside.txt', 'secret');
    const { tree } = readFolders(root, ['app']);
    expect(new Uint8Array(tree.read('app/data.bin'))).toEqual(content);
    expect(() => tree.read('outside.txt')).toThrow('not a file of this tree');
    expect(() => tree.read('app/../outside.txt')).toThrow('not a file of this tree');
  });

  it('reports a folder that is not there, and a file where a folder was expected', () => {
    const root = temp.next();
    write(root, 'app/a.cls');
    write(root, 'file');
    expect(readFolders(root, ['app', 'nowhere', 'file'])).toMatchObject({
      tree: { files: ['app/a.cls'] },
      missing: ['file', 'nowhere'],
      skipped: [],
    });
  });

  it('does not follow symbolic links, and reports them', (context) => {
    const root = temp.next();
    const elsewhere = temp.next();
    write(elsewhere, 'secret.cls', 'not part of the source');
    write(root, 'app/a.cls');
    mkdirSync(join(root, 'linked'), { recursive: true });
    try {
      symlinkSync(join(elsewhere, 'secret.cls'), join(root, 'app', 'file-link.cls'));
      symlinkSync(elsewhere, join(root, 'app', 'folder-link'), 'dir');
      symlinkSync(elsewhere, join(root, 'whole'), 'dir');
    } catch {
      // Windows lets only some users create links.
      context.skip();
    }
    const reading = readFolders(root, ['app', 'whole']);
    expect(reading.tree.files).toEqual(['app/a.cls']);
    expect(reading.skipped).toEqual(['app/file-link.cls', 'app/folder-link', 'whole']);
    expect(reading.missing).toEqual([]);
  });
});

describe('trees', () => {
  it('orders names the same way everywhere', () => {
    expect(['b', 'B', 'a', 'é', 'Z', '_', '1'].sort(byCodeUnit)).toEqual(['1', 'B', 'Z', '_', 'a', 'b', 'é']);
  });

  it('filters a tree and refuses to read what was filtered out', () => {
    const root = temp.next();
    write(root, 'app/keep.cls', 'kept');
    write(root, 'app/drop.cls', 'dropped');
    const tree = filterTree(readFolders(root, ['app']).tree, (path) => path.includes('keep'));
    expect(tree.files).toEqual(['app/keep.cls']);
    expect(tree.read('app/keep.cls')).toEqual(Buffer.from(bytes('kept')));
    expect(() => tree.read('app/drop.cls')).toThrow('not a file of this tree');
  });

  it('lists at most fifty paths in the details of an issue, with the exact count', () => {
    const paths = Array.from({ length: 120 }, (_, index) => `f${String(index)}`);
    const details = pathDetails(paths);
    expect(details['count']).toBe(120);
    expect(details['paths']).toHaveLength(50);
    expect(pathDetails(['one'])).toEqual({ count: 1, paths: ['one'] });
  });
});

describe('sfdx-project.json', () => {
  const dirs = (project: unknown): string[] => packageDirectories(bytes(JSON.stringify(project)));

  it('gives the package directories in the order of the file, each once and in one form', () => {
    expect(
      dirs({
        packageDirectories: [
          { path: 'force-app', default: true },
          { path: './packages/core/' },
          { path: 'packages\\billing' },
          { path: 'force-app/' },
        ],
      }),
    ).toEqual(['force-app', 'packages/core', 'packages/billing']);
  });

  it('leaves out a package directory that lies in another one, which is read with it', () => {
    expect(
      dirs({
        packageDirectories: [
          { path: 'force-app/main' },
          { path: 'force-app' },
          { path: 'force-app-extra' },
          { path: 'packages/core/unpackaged' },
          { path: 'packages/core' },
        ],
      }),
    ).toEqual(['force-app', 'force-app-extra', 'packages/core']);
  });

  it.each([
    ['not JSON', bytes('{ packageDirectories: ')],
    ['not UTF-8', new Uint8Array([0x7b, 0xff, 0x7d])],
    ['null', bytes('null')],
    ['no package directories', bytes('{}')],
    ['an empty list', bytes('{"packageDirectories":[]}')],
    ['a list of text', bytes('{"packageDirectories":["force-app"]}')],
    ['a directory without a path', bytes('{"packageDirectories":[{"default":true}]}')],
    ['a path above the project', bytes('{"packageDirectories":[{"path":"../other"}]}')],
    ['an absolute path', bytes('{"packageDirectories":[{"path":"/etc"}]}')],
    ['a path on a drive', bytes('{"packageDirectories":[{"path":"C:\\\\data"}]}')],
    ['the folder of the file itself', bytes('{"packageDirectories":[{"path":"."}]}')],
  ])('refuses %s', (_name, content) => {
    expect(codeOf(() => packageDirectories(content))).toBe('SOURCE_READ_FAILED');
  });

  it.each([
    ['force-app', 'force-app'],
    ['./a//b/', 'a/b'],
    ['a\\b', 'a/b'],
    ['a/./b', 'a/b'],
    ['', null],
    ['.', null],
    ['..', null],
    ['a/../b', null],
    ['/a', null],
    ['c:/a', null],
    ['a\0b', null],
  ])('writes the folder %j as %j', (path, expected) => {
    expect(normaliseDir(path)).toBe(expected);
  });
});
