/**
 * Reads the public codebases of `fixtures/corpora.toml` and compares the
 * components found with what the resolver of Salesforce finds when it reads
 * the same folders from disk itself.
 *
 * The codebases are not part of this repository. A codebase that was not
 * downloaded (`pnpm run corpora:fetch`) is skipped, so the test needs no
 * network. CI does not download them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MetadataResolver, type SourceComponent } from '@salesforce/source-deploy-retrieve';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { readLocalSource } from '../src/sources/local.ts';

const root = join(import.meta.dirname, '../../..');
const corpora = join(root, '.corpora');
const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
  corpus: { name: string; paths: string[] }[];
};

describe('the public codebases', () => {
  for (const { name, paths } of manifest.corpus) {
    // A codebase that is not there shows in the report of the run as skipped, not as passed.
    it.skipIf(!existsSync(join(corpora, name)))(
      `reads ${name} to the components the resolver of Salesforce finds`,
      async () => {
        const reading = await readLocalSource(corpora, {
          kind: 'git',
          name,
          description: null,
          repo: name,
          ref: null,
          paths,
          tracks: null,
        });
        const ours = new Set(reading.components.map((component) => `${component.type}:${component.fullName}`));

        const theirs = new Set<string>();
        const visit = (component: SourceComponent): void => {
          theirs.add(`${component.type.name}:${component.fullName}`);
          component.getChildren().forEach(visit);
        };
        for (const dir of reading.dirs) {
          new MetadataResolver().getComponentsFromPath(join(corpora, name, dir)).forEach(visit);
        }

        expect(theirs.size).toBeGreaterThan(100);
        expect([...ours].filter((one) => !theirs.has(one))).toEqual([]);
        expect([...theirs].filter((one) => !ours.has(one))).toEqual([]);
        // Every file that is stored belongs to a component, and nothing failed to resolve.
        expect(reading.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      },
      120_000,
    );
  }
});
