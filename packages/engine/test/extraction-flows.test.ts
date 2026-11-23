/**
 * The analysis of flows: a component for each element and resource, what each resource holds, and the
 * references a flow writes as the name of a field, as the name of a resource and as a merge field.
 *
 * The first part runs on the fixture project and is measured with its answer key. The second lays the flows of
 * `fixtures/flow-negative` over the project and holds the analysis against what `expected.yaml` says. The third
 * runs on small flows that are written here, for what the fixtures do not have.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parentKey } from '../src/core/keys.ts';
import type { Reference } from '../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../src/extraction/analyse.ts';
import type { AnalysedComponent } from '../src/extraction/analysed.ts';
import { readFolders } from '../src/sources/folder.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import type { SourceTree } from '../src/sources/tree.ts';
import { columnOf, FIXTURES_DIR, loadAnswerKey } from './helpers/answer-key.ts';
import { codes, key, Source, viaOf } from './helpers/written-source.ts';

const FLOWS = 'force-app/main/default/flows/';
const GOLDEN = join(import.meta.dirname, 'golden');

const opOf = (reference: Reference): string => {
  const op = reference.attrs?.['op'];
  return typeof op === 'string' ? ` ${op}` : '';
};

/** A reference as the answer key says one: where it starts, where it stands, what it is, and how sure. */
const idOf = (reference: Reference): string => {
  const { file, line, column } = reference.location ?? { file: '', line: 0, column: 0 };
  const where = `${file}:${String(line)}:${String(column)}`;
  return `${reference.from} ${where}:${reference.kind}:${String(reference.to)} ${viaOf(reference)}${opOf(reference)} ${reference.confidence}`;
};

/** The components of flows of an analysis: the flows and their elements. */
const ofFlows = (analysis: SourceAnalysis): AnalysedComponent[] =>
  analysis.components.filter((one) => one.key.startsWith('Flow:'));

describe('the flows of the fixture project', () => {
  const answers = loadAnswerKey();
  const keyed = answers.references.filter((one) => one.file.startsWith(FLOWS));
  const idOfKeyed = (one: (typeof keyed)[number]): string =>
    `${one.from} ${one.id} ${one.via}${one.op === undefined ? '' : ` ${one.op}`} ${one.tier}`;
  let analysis: SourceAnalysis;
  let flows: AnalysedComponent[];
  let references: readonly Reference[];

  beforeAll(async () => {
    const tree = readFolders(join(FIXTURES_DIR, answers.project), ['force-app']).tree;
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    flows = ofFlows(analysis);
    references = flows.flatMap((one) => one.references);
  });

  it('give every reference of the key, from the element and with the tier the key says, and no other', () => {
    expect(keyed).toHaveLength(126);
    expect(keyed.every((one) => one.phase === 2)).toBe(true);
    const found = references.map(idOf).sort();
    // A stretch entry may be missed. Nothing may be found that the key does not hold.
    const must = keyed.filter((one) => !one.stretch).map(idOfKeyed);
    expect(must.filter((id) => !found.includes(id))).toEqual([]);
    const all = new Set(keyed.map(idOfKeyed));
    expect(found.filter((id) => !all.has(id))).toEqual([]);
    expect(new Set(found).size).toBe(found.length);
    // The two stretch entries are found as well: every entry of the key is.
    expect(found).toHaveLength(keyed.length);
  });

  it('say where each name was read: in a formula by the reader of formulas, elsewhere by the reader of flows', () => {
    for (const one of references) {
      expect(one.origin, idOf(one)).toBe(viaOf(one) === 'formula' ? 'parser:formula' : 'parser:flow');
      expect(one.resolution, idOf(one)).not.toBe('unresolved');
      expect(one.to, idOf(one)).not.toBeNull();
    }
    expect(references.filter((one) => one.origin === 'parser:formula')).not.toHaveLength(0);
    // A target the project does not hold is one Salesforce provides, and the key lists it as such.
    const standard = new Set<string>(answers.standard);
    for (const one of references.filter((reference) => reference.resolution === 'external')) {
      expect(standard.has(String(one.to)), idOf(one)).toBe(true);
    }
  });

  it('report no reference where the key forbids one', () => {
    const forbidden = answers.negatives.filter((one) => one.file.startsWith(FLOWS));
    expect(forbidden).toHaveLength(22);
    for (const negative of forbidden) {
      const hit = references.filter(
        (one) => one.location?.file === negative.file && one.location.line === negative.line && one.to === negative.not,
      );
      expect(hit.map(idOf), `${negative.file}:${String(negative.line)}`).toEqual([]);
    }
  });

  it('say what they do not know where the key says "unknown", and guess nothing there', () => {
    const unknown = answers.unknowns.filter((one) => one.file.startsWith(FLOWS));
    expect(unknown).toHaveLength(1);
    const issues = analysis.issues.filter((issue) => issue.componentKey?.startsWith('Flow:'));
    expect(
      issues.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)} ${issue.message}`),
    ).toEqual(
      unknown.map(
        (one) =>
          `warning PATH_NOT_FOLLOWED ${one.from} ${one.file}, line ${String(one.line)}: it is not known which object "Recalculate" holds, so "invoice.${one.match}" after it was not followed.`,
      ),
    );
    for (const one of unknown) {
      expect(
        references.filter((reference) => reference.location?.file === one.file && reference.location.line === one.line),
      ).toEqual([]);
      expect(issues[0]?.details).toEqual({
        path: one.file,
        line: one.line,
        column: one.column - 'Recalculate.invoice.'.length,
        resource: 'Recalculate',
        notFollowed: ['invoice', one.match],
        origin: 'parser:flow',
      });
    }
  });

  it('are a component each, with a component for every element and resource', async () => {
    const said = flows.map((one) => `${one.key}  ${one.name}  ${JSON.stringify(one.attrs)}`);
    await expect(`${said.join('\n')}\n`).toMatchFileSnapshot(join(GOLDEN, 'flow-components.txt'));
    const own = flows.filter((one) => !one.key.includes('#'));
    expect(own.map((one) => one.name)).toEqual(
      answers.components.filter((one) => one.type === 'Flow').map((one) => one.fullName),
    );
    for (const one of flows.filter((flow) => flow.key.includes('#'))) {
      const flow = own.find((candidate) => candidate.key === parentKey(one.key));
      // An element is of the file of its flow, and its definition is its own part of that file.
      expect(one.definition?.path, one.key).toBe(flow?.definition?.path);
      expect(one.definition?.contentHash, one.key).not.toEqual(flow?.definition?.contentHash);
      expect(one.name, one.key).toMatch(new RegExp(`^${String(flow?.name)}\\.[A-Za-z_$-]`));
    }
    // Every reference starts from a component of the analysis, and a flow itself holds few: its elements do.
    const keys = new Set(flows.map((one) => one.key));
    expect(references.every((one) => keys.has(one.from))).toBe(true);
    expect(own.map((one) => `${one.name} ${String(one.references.length)}`)).toEqual([
      'Invoice_After_Save 0',
      'Invoice_Before_Save 0',
      'Invoice_Purge_Void 0',
      'Invoice_Recalculate 0',
      'Invoice_Review_Screen 0',
      'Invoice_Sent_Process 1',
    ]);
  });

  it('are counted for the reader of flows', () => {
    expect(analysis.types).toContain('Flow');
    expect(analysis.work.find((row) => row.origin === 'parser:flow')).toEqual({
      origin: 'parser:flow',
      components: flows.length,
      failedFiles: 0,
    });
    expect(flows).toHaveLength(61);
  });
});

describe('the flows that cannot be deployed', () => {
  interface Place {
    readonly line: number;
    readonly match: string;
  }
  interface Expected {
    readonly file: string;
    readonly flow: string;
    readonly reads: boolean;
    readonly unknown?: readonly (Place & { element: string })[];
    readonly refs?: readonly (Place & {
      from: string;
      kind: string;
      to: string;
      via: string;
      op?: string;
      tier?: string;
    })[];
    readonly unresolved?: readonly (Place & { from: string })[];
    readonly negatives?: readonly (Place & { not: string })[];
  }
  const dir = join(FIXTURES_DIR, 'flow-negative');
  const expected = (parse(readFileSync(join(dir, 'expected.yaml'), 'utf8')) as { files: Expected[] }).files;
  const inProject = (file: string): string => `force-app/main/default/${file}`;
  let analysis: SourceAnalysis;
  let alone: SourceAnalysis;

  beforeAll(async () => {
    const project = readFolders(join(FIXTURES_DIR, loadAnswerKey().project), ['force-app']).tree;
    const extra = readFolders(dir, ['flows']).tree;
    const laid = new Map(extra.files.map((path) => [inProject(path), path]));
    const tree: SourceTree = {
      files: [...project.files, ...laid.keys()].sort(),
      read: (path) => {
        const from = laid.get(path);
        return from === undefined ? project.read(path) : extra.read(from);
      },
    };
    analysis = analyseSource(tree, (await resolveComponents(tree, ['force-app'])).components);
    alone = analyseSource(project, (await resolveComponents(project, ['force-app'])).components);
  });

  /** The place of an entry of `expected.yaml` in its file, as `line:column`. */
  const placeOf = (file: string, place: Place): string => {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    return `${String(place.line)}:${String(columnOf(lines[place.line - 1] ?? '', place.match, 1))}`;
  };
  const of = (entry: Expected): AnalysedComponent[] =>
    analysis.components.filter((one) => one.key === entry.flow || one.key.startsWith(`${entry.flow}#`));
  const placeIn = (one: Reference): string => `${String(one.location?.line)}:${String(one.location?.column)}`;

  it('are a component each, and leave the analysis of the project as it was', () => {
    expect(expected.map((entry) => entry.flow)).toEqual(['Flow:missing_field', 'Flow:unknown_element', 'Flow:cut_off']);
    const added = analysis.components.filter((one) => expected.some((entry) => of(entry).includes(one)));
    expect(analysis.components.filter((one) => !added.includes(one))).toEqual(alone.components);
    for (const entry of expected) {
      expect(of(entry).every((one) => one.definition?.path === inProject(entry.file))).toBe(true);
    }
    // A file that cannot be read gives the flow its row, and no element.
    expect(expected.map((entry) => of(entry).length)).toEqual([5, 5, 1]);
  });

  it('give the references each file is expected to hold, and no other to a component', () => {
    for (const entry of expected) {
      const found = of(entry)
        .flatMap((one) => one.references)
        .filter((one) => one.to !== null)
        .map(
          (one) =>
            `${one.from} ${placeIn(one)} ${one.kind} ${String(one.to)} ${viaOf(one)}${opOf(one)} ${one.confidence}`,
        );
      const wanted = (entry.refs ?? []).map(
        (ref) =>
          `${ref.from} ${placeOf(entry.file, ref)} ${ref.kind} ${ref.to} ${ref.via}${ref.op === undefined ? '' : ` ${ref.op}`} ${ref.tier ?? 'confirmed'}`,
      );
      expect(found.sort(), entry.file).toEqual(wanted.sort());
    }
  });

  it('report every name that nothing defines, at its place', () => {
    for (const entry of expected) {
      // A field, an object or a relationship that nothing defines is a reference without a target.
      const references = of(entry)
        .flatMap((one) => one.references)
        .filter((one) => one.to === null)
        .map((one) => `${one.from} ${placeIn(one)} [${one.toNameRaw}] ${one.resolution}`);
      // A resource the flow does not have is an issue: nothing says what the name would be a reference to.
      const resources = analysis.issues
        .filter(
          (issue) => issue.code === 'RESOURCE_NOT_FOUND' && of(entry).some((one) => one.key === issue.componentKey),
        )
        .map((issue) => {
          const { line, column } = issue.details as { line: number; column: number };
          return `${String(issue.componentKey)} ${String(line)}:${String(column)}`;
        });
      const wanted = (entry.unresolved ?? []).map((one) => ({
        reference: `${one.from} ${placeOf(entry.file, one)} [${one.match}] unresolved`,
        resource: `${one.from} ${placeOf(entry.file, one)}`,
      }));
      const missed = wanted.filter((one) => !references.includes(one.reference) && !resources.includes(one.resource));
      expect(missed, entry.file).toEqual([]);
      expect(resources, entry.file).toEqual(
        entry.file.includes('Missing_Field') ? ['Flow:missing_field#element:check 24:39'] : [],
      );
      // One name more than the file lists: the field of the object that does not exist. It is looked for on
      // that object, which is why it is not found, and is not guessed to be the field of another.
      const listed = new Set(wanted.map((one) => one.reference));
      expect(
        references.filter((one) => !listed.has(one)),
        entry.file,
      ).toEqual(
        entry.file.includes('Missing_Field')
          ? ['Flow:missing_field#element:save_nothing 65:20 [Amount__c] unresolved']
          : [],
      );
    }
  });

  it('report no reference where a file forbids one', () => {
    for (const entry of expected) {
      for (const negative of entry.negatives ?? []) {
        const hit = of(entry)
          .flatMap((one) => one.references)
          .filter((one) => one.location?.line === negative.line && one.to === negative.not);
        expect(hit, `${entry.file}:${String(negative.line)}`).toEqual([]);
      }
    }
  });

  it('say of the element of an unknown kind that it is one, and read what is in it as probable', () => {
    const unknown = expected.flatMap((entry) => (entry.unknown ?? []).map((one) => ({ ...one, file: entry.file })));
    expect(unknown).toHaveLength(1);
    const issues = analysis.issues.filter((issue) => issue.code === 'FLOW_ELEMENT_UNKNOWN');
    expect(issues.map((issue) => `${issue.severity} ${String(issue.componentKey)} ${issue.message}`)).toEqual(
      unknown.map(
        (one) =>
          `warning ${one.element} ${inProject(one.file)}, line ${String(one.line)}: "${one.match}" is no kind of element of a flow that is known here. The names of resources and the merge fields in it are recorded as probable.`,
      ),
    );
    const beam = analysis.components.find((one) => one.key === unknown[0]?.element);
    expect(beam?.attrs).toEqual({ kind: 'unknown', element: 'recordTeleports', active: true });
    expect(beam?.references.map((one) => one.confidence)).toEqual(['probable', 'probable', 'probable']);
  });

  it('say of the file that cannot be read that it was not, and count it for the reader of flows', () => {
    const added = analysis.issues.filter((issue) => !alone.issues.some((one) => one.message === issue.message));
    expect(added.map((issue) => `${issue.severity} ${issue.code} ${String(issue.componentKey)}`).sort()).toEqual([
      'error XML_MALFORMED null',
      'warning FLOW_ELEMENT_UNKNOWN Flow:unknown_element#element:beam',
      'warning PATH_NOT_FOLLOWED Flow:missing_field#element:check',
      'warning RESOURCE_NOT_FOUND Flow:missing_field#element:check',
    ]);
    const cutOff = analysis.components.find((one) => one.key === 'Flow:cut_off');
    expect(cutOff).toMatchObject({ name: 'Cut_Off', attrs: null, references: [] });
    expect(added.find((issue) => issue.code === 'RESOURCE_NOT_FOUND')?.message).toBe(
      `${inProject('flows/Missing_Field.flow-meta.xml')}, line 24: the element "elementReference" holds "No_Such_Resource.Amount__c", and the flow has no resource "No_Such_Resource". It is not read.`,
    );
    expect(added.find((issue) => issue.code === 'PATH_NOT_FOLLOWED')?.message).toBe(
      `${inProject('flows/Missing_Field.flow-meta.xml')}, line 21: it is not known which object "Nowhere__r" leads to, so "Name" after it was not followed.`,
    );
    const [xml, formula, flow] = alone.work;
    expect(analysis.work).toEqual([
      xml,
      formula,
      { origin: 'parser:flow', components: (flow?.components ?? 0) + 10, failedFiles: 1 },
    ]);
  });
});
