/**
 * Reads every `-meta.xml` file of the public codebases of `fixtures/corpora.toml` with the reader for XML, and
 * compares what it gives with what `fast-xml-parser` gives for the same file.
 *
 * The codebases are not part of this repository. A codebase that was not downloaded (`pnpm run corpora:fetch`)
 * is skipped, so the test needs no network. CI does not download them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { readXml } from '../src/extraction/xml.ts';
import type { XmlElement } from '../src/extraction/xml.ts';
import { plainOf, secondOpinion, withAttributeSpaces } from './helpers/xml-opinions.ts';

const root = join(import.meta.dirname, '../../..');
const corpora = join(root, '.corpora');
const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
  corpus: { name: string }[];
};

/**
 * The `-meta.xml` files of each codebase, counted on 15 November 2026: 11,338 in all. They are all the files of
 * that name in the repository, also outside the package folders that `fixtures/corpora.toml` names: 10,799 are
 * inside them. A codebase is pinned by its commit, so a count moves only when the pin moves.
 */
const FILES: Readonly<Record<string, number>> = { 'apex-recipes': 254, 'nebula-logger': 1416, npsp: 9668 };

/** Every element of a tree, the root first. */
function* elementsOf(element: XmlElement): Generator<XmlElement> {
  yield element;
  for (const child of element.children) yield* elementsOf(child);
}

describe('the metadata files of the public codebases', () => {
  for (const { name } of manifest.corpus) {
    // A codebase that is not there shows in the report of the run as skipped, not as passed.
    it.skipIf(!existsSync(join(corpora, name)))(
      `reads every -meta.xml file of ${name} to what fast-xml-parser reads`,
      () => {
        const files = readdirSync(join(corpora, name), { recursive: true, encoding: 'utf8' })
          .filter((file) => file.endsWith('-meta.xml') && !/^\.git[\\/]/.test(file))
          .sort();
        expect(files.length).toBe(FILES[name]);

        const refused: string[] = [];
        const different: string[] = [];
        const misplaced: string[] = [];
        for (const file of files) {
          const bytes = readFileSync(join(corpora, name, file));
          const { document, issue } = readXml(bytes);
          if (document === null) {
            refused.push(`${file}: ${issue.code} at line ${String(issue.place?.line)}. ${issue.message}`);
            continue;
          }
          const ours = JSON.stringify(withAttributeSpaces(plainOf(document.root)));
          if (ours !== JSON.stringify(withAttributeSpaces(secondOpinion(document.text)))) different.push(file);
          // Every element stands where the reader says: its tag is there, and the bytes hold the same text.
          for (const element of elementsOf(document.root)) {
            const from = document.place(element.start).offset;
            const to = document.place(element.end).offset;
            const there =
              document.text.startsWith(`<${element.name}`, element.start) &&
              document.text.charAt(element.end - 1) === '>' &&
              to - from === Buffer.byteLength(document.text.slice(element.start, element.end));
            if (!there) {
              misplaced.push(`${file}: ${element.name}`);
              break;
            }
          }
        }
        expect(refused).toEqual([]);
        expect(different).toEqual([]);
        expect(misplaced).toEqual([]);
      },
      300_000,
    );
  }
});
