/**
 * The grammar of Apex is loaded only by an analysis of a snapshot that holds Apex, once in a process, and a load
 * that fails is tried again (decision record 0083). The package of the parser is replaced by one that counts
 * the loads and can be told to fail. Everything else is the real thing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { createRepo, PROJECT_JSON, projectFiles, type TestRepo } from './helpers/git-repo.ts';
import { tempDirs } from './helpers/store.ts';

const grammar = vi.hoisted(() => ({ loads: 0, fail: false }));
vi.mock('web-tree-sitter-sfapex', async (importOriginal) => {
  const actual = await importOriginal<{ getApexParser: () => Promise<unknown> }>();
  return {
    ...actual,
    getApexParser: async (): Promise<unknown> => {
      grammar.loads += 1;
      if (grammar.fail) throw new Error('The grammar is not there.');
      return actual.getApexParser();
    },
  };
});

const temp = tempDirs();
afterEach(() => {
  temp.cleanUp();
});

const CLASSES = 'force-app/main/default/classes';
const META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>65.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n';

/** A repository that is also the workspace, with the files that are given and one source `work` of its folder. */
async function setUp(files: Record<string, string>): Promise<{ repo: TestRepo; workspace: Workspace }> {
  const repo = createRepo(temp.next());
  for (const [path, content] of Object.entries({ ...files, 'sfdx-project.json': PROJECT_JSON })) {
    repo.write(path, content);
  }
  repo.write('orglens.toml', ['schema_version = 1', '[sources.work]', 'kind = "git"', ''].join('\n'));
  return { repo, workspace: await openWorkspace({ root: repo.dir, env: {} }) };
}

const withoutApex = (): Record<string, string> =>
  Object.fromEntries(Object.entries(projectFiles()).filter(([path]) => !path.includes('/classes/')));

describe('the grammar of Apex', () => {
  it('is loaded only for a snapshot that holds Apex, once, and again after a load that failed', async () => {
    // A snapshot without Apex, and the commands that read it, do not load it.
    const plain = await setUp(withoutApex());
    const report = await plain.workspace.snapshot('work');
    expect(report.types.map((type) => type.type)).not.toContain('ApexClass');
    expect(report.analysis?.complete).toBe(true);
    await plain.workspace.status();
    await plain.workspace.coverage('work');
    await plain.workspace.impact('work', 'Parcel__c.Weight__c');
    expect(grammar.loads).toBe(0);

    // A load that fails fails the analysis as a whole. The snapshot is stored, and its analysis can be tried again.
    const { workspace } = await setUp({
      ...projectFiles(),
      [`${CLASSES}/Broken.cls`]: 'public class Broken {\n    void m() {\n        Integer x = ;\n    }\n}\n',
      [`${CLASSES}/Broken.cls-meta.xml`]: META,
    });
    grammar.fail = true;
    const failure = await workspace.snapshot('work').then(
      () => null,
      (error: unknown) => (error as { toJSON: () => { code: string; message: string } }).toJSON(),
    );
    expect(failure?.code).toBe('INTERNAL');
    expect(failure?.message).toContain('The parser of Apex could not be loaded: The grammar is not there.');
    expect(grammar.loads).toBe(1);

    grammar.fail = false;
    const analysed = await workspace.analyse('work', { snapshot: 1 });
    expect(grammar.loads).toBe(2);
    expect(analysed.analysis?.complete).toBe(false);
    expect(analysed.issues.filter((issue) => issue.stage === 'analysis')).toMatchObject([
      {
        severity: 'error',
        code: 'APEX_MALFORMED',
        component: 'ApexClass:broken',
        details: { path: `${CLASSES}/Broken.cls`, line: 3 },
      },
    ]);

    // Another snapshot in the same process uses the grammar that is loaded.
    await workspace.snapshot('work');
    expect(grammar.loads).toBe(2);
  });
});
