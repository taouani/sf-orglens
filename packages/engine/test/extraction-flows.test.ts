/**
 * The analysis of flows: a component for each element and resource, what each resource holds, and the
 * references a flow writes as the name of a field, as the name of a resource and as a merge field.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second lays the flows of
 * `fixtures/flow-negative` over the project and holds the analysis against what `expected.yaml` says. The third
 * runs on small flows that are written here, for what the fixtures do not have.
 */
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import { FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { viaOf } from './helpers/written-source.ts';

const FLOWS = 'force-app/main/default/flows/';

/** A reference as the answer key identifies one, with how the source names its target and what it does. */
const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  const op = reference.attrs?.['op'];
  return `${file}:${String(line)}:${String(column)}:${reference.kind}:${String(reference.to)} ${viaOf(reference)}${typeof op === 'string' ? ` ${op}` : ''}`;
};

describe('the flows of the fixture project', () => {
  const answers = loadAnswerKey();
  const keyed = answers.references.filter((one) => one.file.startsWith(FLOWS));
  const idOfKeyed = (one: (typeof keyed)[number]): string =>
    `${one.id} ${one.via}${one.op === undefined ? '' : ` ${one.op}`}`;
  let analysis: SourceAnalysis;
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    const listed = (await resolveComponents(tree, ['force-app'])).components;
    analysis = analyseSource(tree, listed);
    references = analysis.components.filter((one) => one.key.startsWith('Flow:')).flatMap((one) => one.references);
  });

  it('give every reference of the key, where the key says, and no other', () => {
    expect(keyed.every((one) => one.phase === 2)).toBe(true);
    const found = references.map(idOf).sort();
    // A stretch entry may be missed. Nothing may be found that the key does not hold.
    const must = keyed.filter((one) => !one.stretch).map(idOfKeyed);
    expect(must.filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(keyed.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
  });
});
