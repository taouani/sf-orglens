/**
 * Holds the analysis of the public codebases to what was checked by hand.
 *
 * Every formula field, default value, validation rule, lookup filter and roll-up summary of the codebases of
 * `fixtures/corpora.toml` was held against the references the analysis reports for it
 * (`docs/research/phase-1/public-codebases.md`). The author of the analyser read the 133 entries that can hold
 * a name one by one, and the 235 default values that are a literal as a list of values. A sub-agent that
 * reviewed the pull request read the 133 again. No person did.
 *
 * The listing that was read is not stored, because it holds the text of the codebases. Its SHA-256 is. When the
 * analysis reports another reference, another place, another tier or another issue for one of these entries,
 * the digest moves and this test fails. Then print the listing at the commit that recorded the digest and at
 * the new one (`pnpm run corpora:listing`), compare the two, check by hand what moved, and record the new
 * digest here and in a note. The listing does not print the origin of a reference.
 *
 * The codebases are not part of this repository. A codebase that was not downloaded (`pnpm run corpora:fetch`)
 * is skipped, so the test needs no network. CI does not download them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import { digestOf, isLiteral, listCodebase, viaOf, type EntryKind } from './corpora/listing.ts';

const root = join(import.meta.dirname, '../../..');
const corpora = join(root, '.corpora');
const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
  corpus: { name: string; paths: string[] }[];
};

/**
 * What was checked on 17 November 2026, at the commits that `fixtures/corpora.toml` pins.
 *
 * - `entries`: the entries by what they are.
 * - `literals`: the default values among them that are a literal, such as `false` or `0`, and can hold no name.
 * - `references`: the references of all entries. Each was checked: none is wrong.
 * - `notFollowed`: the names the analysis did not follow, each with a warning that says why. They are the
 *   references that are missed, and the note names them. It also names what is left out by a rule.
 * - `digest`: the SHA-256 of the listing that was read.
 */
interface Checked {
  readonly entries: Readonly<Partial<Record<EntryKind, number>>>;
  readonly literals: number;
  readonly references: number;
  readonly notFollowed: number;
  readonly digest: string;
}
const CHECKED: Readonly<Record<string, Checked>> = {
  'apex-recipes': {
    entries: { default: 1 },
    literals: 1,
    references: 0,
    notFollowed: 0,
    digest: '763dead7e0066c9d934944ead168752206d7225da9e75e4e33bee68be1c5566f',
  },
  'nebula-logger': {
    entries: { default: 77, formula: 61, rule: 4, summary: 12 },
    literals: 77,
    references: 410,
    notFollowed: 0,
    digest: '4365fb5061f0f6582ec6e162a0d4d76f2c45d4475b61463289e645f4439ee373',
  },
  npsp: {
    entries: { default: 152, filter: 2, formula: 13, rule: 3, summary: 3 },
    literals: 150,
    references: 69,
    notFollowed: 4,
    digest: '2112d75d80f796b71722c9a82555c7b2b7a95521915eafe6a8c5c917607bc6a2',
  },
  pmm: {
    entries: { default: 10, filter: 2, formula: 15, rule: 13 },
    literals: 7,
    references: 137,
    notFollowed: 0,
    digest: 'ac9d3f04b93df69ca952ef7b86799722d704482e809a9286a7e99ebf8d42eadc',
  },
};

describe('the entries of the public codebases that were checked by hand', () => {
  it('have a record for every codebase of the manifest', () => {
    expect(Object.keys(CHECKED).sort()).toEqual(manifest.corpus.map((one) => one.name).sort());
  });

  for (const { name, paths } of manifest.corpus) {
    // A codebase that is not there shows in the report of the run as skipped, not as passed.
    it.skipIf(!existsSync(join(corpora, name)))(
      `are those of ${name}, with the references that were checked`,
      async () => {
        const listing = await listCodebase(join(corpora, name), paths);
        const entries: Partial<Record<EntryKind, number>> = {};
        for (const entry of listing.entries) entries[entry.kind] = (entries[entry.kind] ?? 0) + 1;
        const checked = CHECKED[name];
        // The test above fails for a codebase without a record. This one has nothing to compare with.
        if (checked === undefined) throw new Error(`The codebase "${name}" has no record of a check.`);
        const { digest, ...counts } = checked;

        expect({
          entries,
          literals: listing.entries.filter(
            (entry) => entry.kind === 'default' && isLiteral(entry.text) && entry.references.length === 0,
          ).length,
          references: listing.entries.reduce((sum, entry) => sum + entry.references.length, 0),
          // Of the whole codebase. Every such warning of these codebases is about an entry.
          notFollowed: listing.analysis.issues.filter((issue) => issue.code === 'PATH_NOT_FOLLOWED').length,
        }).toEqual(counts);
        // The listing shows a reference under an entry of its file by its `via`. So it shows every reference
        // once only while a file has one entry, and it hides none only while every reference with one of
        // these `via` is of a file with an entry.
        expect(new Set(listing.entries.map((entry) => entry.file)).size).toBe(listing.entries.length);
        expect(
          listing.analysis.components
            .flatMap((one) => one.references)
            .filter((one) => ['formula', 'filter', 'summary'].includes(viaOf(one))).length,
        ).toBe(counts.references);
        // An entry shows every issue of its component. Each component with an issue has one entry here.
        expect(listing.entries.flatMap((entry) => entry.issues).length).toBe(counts.notFollowed);
        // Every file with an entry belongs to a component of the analysis.
        expect(listing.entries.filter((entry) => entry.key === null)).toEqual([]);
        // The check by hand found every reference right as `confirmed`, and found no other tier.
        const tiers = listing.entries
          .flatMap((entry) => entry.references)
          .filter((line) => !line.includes(' [confirmed, '));
        expect(tiers).toEqual([]);
        expect(digestOf(name, listing)).toBe(digest);
      },
      300_000,
    );
  }
});
