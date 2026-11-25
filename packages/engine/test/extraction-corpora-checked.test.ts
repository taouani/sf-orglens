/**
 * Holds the analysis of the public codebases to what was checked by hand.
 *
 * Every formula field, default value, validation rule, lookup filter and roll-up summary of the codebases of
 * `fixtures/corpora.toml` was held against the references the analysis reports for it
 * (`docs/research/phase-1/public-codebases.md`). The author of the analyser read the 133 entries that can hold
 * a name one by one, and the 235 default values that are a literal as a list of values. A sub-agent that
 * reviewed the pull request read the 133 again. No person did. The two codebases added on 25 November 2026 were
 * read the same way: 36 entries that can hold a name, 32 of V4S and 4 of Outbound Funds, and 14 literals. So were
 * the 36 entries of Coral Cloud and EDA that can hold a name, and their 79 literals, on the same day.
 *
 * The listing of Phase 2 was checked on 25 November 2026 (`docs/research/phase-2/public-codebases.md`): every flow
 * with each of its elements, every rule and action of a file of workflow rules and every record type was read by
 * hand, and every field set was held against its file by a script. The second half of this file holds that check
 * the same way, by its own digests.
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
import {
  digestOf,
  digestOfMore,
  FLOW_FOLDERS,
  isLiteral,
  LISTED_FILE,
  listCodebase,
  listFlowsAndConfiguration,
  viaOf,
  type EntryKind,
  type MoreKind,
} from './corpora/listing.ts';

const root = join(import.meta.dirname, '../../..');
const corpora = join(root, '.corpora');
const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
  corpus: { name: string; paths: string[] }[];
};

/**
 * What was checked on 17 November 2026, and for V4S and Outbound Funds on 25 November 2026, at the commits that
 * `fixtures/corpora.toml` pins.
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
  // Added on 25 November 2026, with the codebases. V4S is in the metadata format: a file of an object holds its
  // fields and rules, and the listing shows each of them as an entry of its own.
  'volunteers-for-salesforce': {
    entries: { default: 13, filter: 1, formula: 11, rule: 7, summary: 13 },
    literals: 13,
    references: 64,
    notFollowed: 0,
    digest: 'e33e0a266a189d48474076faa5609ded0779467e947d4677beace605c201dd2b',
  },
  'outbound-funds': {
    entries: { default: 1, formula: 1, summary: 3 },
    literals: 1,
    references: 12,
    notFollowed: 0,
    digest: '16342d15d639b476343b6cffa7811f2ee278538a2dc5f5e5c776503652063be4',
  },
  // Added on 25 November 2026, with the codebases, for the check by hand of Phase 2. Three formulas of Coral Cloud
  // are written with the tag broken before its bracket, which the listing did not see until it was told to.
  'coral-cloud': {
    entries: { default: 2, formula: 19, summary: 4 },
    literals: 2,
    references: 49,
    notFollowed: 0,
    digest: '21690bb65eeed086ac8c412acab71c5f6a029b4edb34623d205bc6152f709a15',
  },
  eda: {
    entries: { default: 78, formula: 10, rule: 2 },
    literals: 77,
    references: 76,
    notFollowed: 0,
    digest: '3f523cba8de935d2d90752200c425a2c36fe74c04879b765bcb5fde145bc682b',
  },
};

/**
 * What was checked on 25 November 2026 of Phase 2, in the listing of flows and configuration: every flow with each of
 * its elements, every rule and action of a file of workflow rules, every record type and every field set, in the
 * folders of `FLOW_FOLDERS` or, where a codebase has none there, in its package folders
 * (`docs/research/phase-2/public-codebases.md`).
 *
 * - `entries`: the entries by what they are.
 * - `references`: the references of all entries. Each of the flows, the workflow rules and the record types was
 *   read by hand, and each of the field sets was held against its file by a script: none is wrong.
 * - `issues`: the issues of the entries by their code. Each is a name that is not read, and the note names them.
 * - `digest`: the SHA-256 of the listing that was read.
 */
interface CheckedMore {
  readonly entries: Readonly<Partial<Record<MoreKind, number>>>;
  readonly references: number;
  readonly issues: Readonly<Record<string, number>>;
  readonly digest: string;
}
const CHECKED_MORE: Readonly<Record<string, CheckedMore>> = {
  'apex-recipes': {
    entries: { element: 3, flow: 1 },
    references: 1,
    issues: {},
    digest: '9a83f4d69329e5a22fcd4b4d9ac1c02c8e20a62f2991064234481944381eacbe',
  },
  'nebula-logger': {
    entries: { element: 42, 'field-set': 1, flow: 10 },
    references: 38,
    issues: {},
    digest: '911c3ffdd9ec2d64e323504f156ef78cda966bf3981500954fbb3e4852371817',
  },
  npsp: {
    entries: { 'field-set': 18, workflow: 6 },
    references: 727,
    issues: {},
    digest: '0e250f0d56e8ea3b158b508eb5b004de9911c5cbea3bd7b522ef93e7a680f074',
  },
  // Both flows of PMM hold a token of its build tool before every name of the package: every name has a warning.
  pmm: {
    entries: { element: 21, 'field-set': 7, flow: 2 },
    references: 384,
    issues: { NAME_NOT_READ: 78, PATH_NOT_FOLLOWED: 24 },
    digest: '201a2c57978cbdda732b967853b1508390a7a4fceee9eed6ad1830a97fedd488',
  },
  'volunteers-for-salesforce': {
    entries: { 'field-set': 15, 'record-type': 1, workflow: 17 },
    references: 504,
    issues: {},
    digest: '974423621c8314343787e90b5006bb0ba5a6c36195a868a9438d25a37f497579',
  },
  'outbound-funds': {
    entries: {},
    references: 0,
    issues: {},
    digest: 'a386af5c01d065a6a878d1194a6ef6c05202cc46f0c5660fb2df5c8f1b14e217',
  },
  'coral-cloud': {
    entries: { element: 85, flow: 10 },
    references: 49,
    issues: {},
    digest: '8f44188697a6560bcd755e7522127e9d549cc9ea29148347c86c23fdc9426e07',
  },
  eda: {
    entries: { 'record-type': 8 },
    references: 22,
    issues: {},
    digest: 'e76a0baedb4cc9ff0c3f9d55ecc0d7d783253e82eb621e0910bfc278851726cf',
  },
};

/** The components that have an entry in the listing of Phase 2. A file of workflow rules says nothing of its own. */
const LISTED_TYPES =
  /^(?:Flow|Workflow(?:Alert|FieldUpdate|FlowAction|KnowledgePublish|OutboundMessage|Rule|Send|Task)|RecordType|FieldSet):/;

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
        // The listing shows a reference under an entry of its component by its `via`. So it shows every reference
        // once only while a component has one entry, and it hides none only while every reference with one of
        // these `via` of a file of fields, rules or objects is of a component with an entry. The formulas and the
        // criteria of flows and workflow rules are in files of their own, which the listing does not show.
        expect(new Set(listing.entries.map((entry) => `${entry.file} ${String(entry.key)}`)).size).toBe(
          listing.entries.length,
        );
        expect(
          listing.analysis.components
            .filter((one) => LISTED_FILE.test(one.definition?.path ?? ''))
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

describe('the flows and configuration of the public codebases that were checked by hand', () => {
  it('have a record for every codebase of the manifest', () => {
    expect(Object.keys(CHECKED_MORE).sort()).toEqual(manifest.corpus.map((one) => one.name).sort());
  });

  for (const { name, paths } of manifest.corpus) {
    it.skipIf(!existsSync(join(corpora, name)))(
      `are those of ${name}, with the references that were checked`,
      async () => {
        const listing = await listFlowsAndConfiguration(join(corpora, name), FLOW_FOLDERS[name] ?? paths);
        const checked = CHECKED_MORE[name];
        if (checked === undefined) throw new Error(`The codebase "${name}" has no record of a check.`);
        const { digest, ...counts } = checked;
        const entries: Partial<Record<MoreKind, number>> = {};
        for (const entry of listing.entries) entries[entry.kind] = (entries[entry.kind] ?? 0) + 1;
        const issues: Record<string, number> = {};
        for (const line of listing.entries.flatMap((entry) => entry.issues)) {
          const code = /^\w+ (\w+):/.exec(line)?.[1] ?? line;
          issues[code] = (issues[code] ?? 0) + 1;
        }

        expect({
          entries,
          references: listing.entries.reduce((sum, entry) => sum + entry.references.length, 0),
          issues: Object.fromEntries(Object.entries(issues).sort()),
        }).toEqual(counts);
        // Every component of these types has one entry, and every entry is of a component: nothing of a flow, a file
        // of workflow rules, a record type or a field set is hidden from the listing, and nothing is shown twice.
        const listed = listing.analysis.components.filter((one) => LISTED_TYPES.test(one.key)).map((one) => one.key);
        expect(listing.entries.map((entry) => entry.key).sort()).toEqual([...listed].sort());
        // A file of workflow rules is a component of its own, and refers to nothing: its rules and actions do.
        expect(
          listing.analysis.components.filter((one) => one.key.startsWith('Workflow:')).flatMap((one) => one.references),
        ).toEqual([]);
        // Every issue of the analysis about one of these components stands under its entry.
        const keys = new Set<string>(listed);
        expect(listing.analysis.issues.filter((issue) => keys.has(issue.componentKey ?? '')).length).toBe(
          Object.values(counts.issues).reduce((sum, count) => sum + count, 0),
        );
        // The check by hand found every reference right as `confirmed`, and found no other tier.
        expect(
          listing.entries.flatMap((entry) => entry.references).filter((line) => !line.includes(' [confirmed, ')),
        ).toEqual([]);
        expect(digestOfMore(name, listing)).toBe(digest);
      },
      300_000,
    );
  }
});
