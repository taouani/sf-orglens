/**
 * Scores the references a parser and the resolver find in the fixture project against the answer key.
 *
 * A reported reference and an entry of the key match when they name the same file, line, column and target. The
 * kind is judged apart: among the matches, how many have the kind of the key. So a read that is reported as a
 * write costs accuracy of read and write, and neither recall nor precision.
 *
 * - Recall counts the entries of the key in Apex files that are not marked `stretch`.
 * - Precision counts every reported reference, except one that matches a `stretch` entry.
 * - A negative is hit when any reference to its target is reported on its line.
 * - An unknown of the key is found when an unknown is reported at its place.
 */
import { loadAnswerKey } from '../../../packages/engine/test/helpers/answer-key.ts';
import type { Analysis, Found } from './resolver.ts';

type Key = ReturnType<typeof loadAnswerKey>;
type KeyReference = Key['references'][number];

interface Pair {
  readonly key: KeyReference;
  readonly found: Found;
}

export interface Score {
  /** Entries of the key in Apex files that are not stretch. */
  readonly expected: number;
  /** Of them, the ones that were reported. */
  readonly matched: readonly Pair[];
  readonly missed: readonly KeyReference[];
  /** Stretch entries that were reported. */
  readonly stretch: readonly Pair[];
  /** Reported references the key does not have. */
  readonly extra: readonly Found[];
  readonly recall: number;
  readonly precision: number;
  /** Of the matches, the ones whose kind differs from the key. */
  readonly wrongKind: readonly Pair[];
  readonly kindAccuracy: number;
  readonly wrongFrom: readonly Pair[];
  readonly wrongVia: readonly Pair[];
  readonly wrongTier: readonly Pair[];
  readonly wrongOp: readonly Pair[];
  /** Negatives of the key a reported reference hits. */
  readonly negativesHit: readonly Found[];
  readonly negatives: number;
  readonly unknownsExpected: number;
  readonly unknownsFound: number;
  /** Unknowns that were reported where the key has none. */
  readonly unknownsExtra: readonly string[];
}

const isApex = (file: string): boolean => file.endsWith('.cls') || file.endsWith('.trigger');
const placeOf = (entry: { file: string; line: number; column: number }): string =>
  `${entry.file}:${String(entry.line)}:${String(entry.column)}`;

export function score(analysis: Analysis, key: Key = loadAnswerKey()): Score {
  const entries = key.references.filter((entry) => isApex(entry.file));
  const taken = new Set<KeyReference>();
  const pairs: Pair[] = [];
  const left: Found[] = [];
  // First the references that agree with an entry in kind too, then the ones that agree only in place and target.
  for (const found of analysis.references) {
    const entry = entries.find(
      (candidate) =>
        !taken.has(candidate) &&
        placeOf(candidate) === placeOf(found) &&
        candidate.to === found.to &&
        candidate.kind === found.kind,
    );
    if (entry === undefined) left.push(found);
    else {
      taken.add(entry);
      pairs.push({ key: entry, found });
    }
  }
  const extra: Found[] = [];
  for (const found of left) {
    const entry = entries.find(
      (candidate) => !taken.has(candidate) && placeOf(candidate) === placeOf(found) && candidate.to === found.to,
    );
    if (entry === undefined) extra.push(found);
    else {
      taken.add(entry);
      pairs.push({ key: entry, found });
    }
  }
  const matched = pairs.filter((pair) => !pair.key.stretch);
  const stretch = pairs.filter((pair) => pair.key.stretch);
  const expected = entries.filter((entry) => !entry.stretch);
  const missed = expected.filter((entry) => !taken.has(entry));
  const wrongKind = matched.filter((pair) => pair.key.kind !== pair.found.kind);
  const negativesHit = analysis.references.filter((found) =>
    key.negatives.some(
      (negative) => negative.file === found.file && negative.line === found.line && negative.not === found.to,
    ),
  );
  const unknownPlaces = new Set(key.unknowns.map(placeOf));
  const reportedPlaces = new Set(analysis.unknowns.map(placeOf));
  return {
    expected: expected.length,
    matched,
    missed,
    stretch,
    extra,
    recall: matched.length / expected.length,
    precision: matched.length / (matched.length + extra.length),
    wrongKind,
    kindAccuracy: (matched.length - wrongKind.length) / matched.length,
    wrongFrom: matched.filter((pair) => pair.key.from !== pair.found.from),
    wrongVia: matched.filter((pair) => pair.key.via !== pair.found.via),
    wrongTier: matched.filter((pair) => pair.key.tier !== pair.found.tier),
    wrongOp: matched.filter((pair) => pair.key.op !== pair.found.op),
    negativesHit,
    negatives: key.negatives.length,
    unknownsExpected: key.unknowns.length,
    unknownsFound: [...unknownPlaces].filter((place) => reportedPlaces.has(place)).length,
    unknownsExtra: [...reportedPlaces].filter((place) => !unknownPlaces.has(place)).sort(),
  };
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const show = (found: Found): string =>
  `${placeOf(found)} ${found.match} ${found.kind} ${found.to} via ${found.via} ${found.tier} from ${found.from}`;

/** The score as lines of text, with every difference named. */
export function report(name: string, result: Score): string[] {
  const lines = [
    name,
    `  recall     ${String(result.matched.length)} of ${String(result.expected)} (${percent(result.recall)})`,
    `  precision  ${String(result.matched.length)} of ${String(result.matched.length + result.extra.length)} (${percent(result.precision)})`,
    `  kind       ${String(result.matched.length - result.wrongKind.length)} of ${String(result.matched.length)} (${percent(result.kindAccuracy)})`,
    `  stretch    ${String(result.stretch.length)} found`,
    `  negatives  ${String(result.negativesHit.length)} hit of ${String(result.negatives)}`,
    `  unknowns   ${String(result.unknownsFound)} of ${String(result.unknownsExpected)}, ${String(result.unknownsExtra.length)} more`,
    `  from ${String(result.wrongFrom.length)} wrong, via ${String(result.wrongVia.length)} wrong, tier ${String(result.wrongTier.length)} wrong, op ${String(result.wrongOp.length)} wrong`,
  ];
  for (const entry of result.missed) {
    lines.push(`  missed      ${placeOf(entry)} ${entry.match} ${entry.kind} ${entry.to} via ${entry.via}`);
  }
  for (const found of result.extra) lines.push(`  extra       ${show(found)}`);
  for (const pair of result.wrongKind) lines.push(`  wrong kind  ${show(pair.found)}, the key says ${pair.key.kind}`);
  for (const pair of result.wrongFrom) lines.push(`  wrong from  ${show(pair.found)}, the key says ${pair.key.from}`);
  for (const pair of result.wrongVia) lines.push(`  wrong via   ${show(pair.found)}, the key says ${pair.key.via}`);
  for (const pair of result.wrongTier) lines.push(`  wrong tier  ${show(pair.found)}, the key says ${pair.key.tier}`);
  for (const pair of result.wrongOp) {
    lines.push(`  wrong op    ${show(pair.found)} ${pair.found.op ?? '-'}, the key says ${pair.key.op ?? '-'}`);
  }
  for (const found of result.negativesHit) lines.push(`  negative    ${show(found)}`);
  for (const place of result.unknownsExtra) lines.push(`  unknown     ${place}`);
  return lines;
}
