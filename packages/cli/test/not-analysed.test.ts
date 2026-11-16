/**
 * What `status` and `coverage` say about a snapshot that has no analysis.
 *
 * A snapshot is without one when a version before the analysis took it, or when its analysis failed as a
 * whole. A test of the command line cannot make either happen: it reaches the database only through the
 * engine, and the engine analyses every snapshot it stores. So the engine is wrapped here, and hands out the
 * report of a real snapshot the way it reports one that is not analysed. The tests of the engine show that
 * this is the report it gives then (`analyse.test.ts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Engine from '@sf-orglens/engine';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

const engineState = vi.hoisted(() => ({ analysed: true, status: null as 'running' | 'failed' | null }));

vi.mock('@sf-orglens/engine', async (original) => {
  const engine = await original<typeof Engine>();
  return {
    ...engine,
    openWorkspace: async (locator?: Engine.WorkspaceLocator): Promise<Engine.Workspace> => {
      const workspace = await engine.openWorkspace(locator);
      if (engineState.analysed) return workspace;
      return {
        ...workspace,
        coverage: async (source, options) => {
          const report = await workspace.coverage(source, options);
          return {
            ...report,
            snapshot: { ...report.snapshot, status: engineState.status ?? report.snapshot.status },
            types: report.types.map((type) => ({ ...type, analysed: 0 })),
            analysis: null,
            issues: report.issues.filter((issue) => issue.stage === 'read'),
          };
        },
        status: async () => {
          const status = await workspace.status();
          return {
            ...status,
            sources: status.sources.map((source) => ({
              ...source,
              latestSnapshot: source.latestSnapshot === null ? null : { ...source.latestSnapshot, analysis: null },
            })),
          };
        },
      };
    },
  };
});

const dirs = tempDirs();
afterEach(() => {
  engineState.analysed = true;
  engineState.status = null;
  dirs.cleanUp();
});

const OBJECT = 'force-app/main/default/objects/Parcel__c';
const FILES: Readonly<Record<string, string>> = {
  'orglens.toml': 'schema_version = 1\n[sources.work]\nkind = "git"\n[sources.prod]\nkind = "org"\n',
  'sfdx-project.json': '{ "packageDirectories": [{ "path": "force-app" }] }\n',
  [`${OBJECT}/Parcel__c.object-meta.xml`]:
    '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n    <deploymentStatus>Deployed</deploymentStatus>\n    <label>Parcel</label>\n    <nameField>\n        <label>Parcel Name</label>\n        <type>Text</type>\n    </nameField>\n    <pluralLabel>Parcels</pluralLabel>\n    <sharingModel>ReadWrite</sharingModel>\n</CustomObject>\n',
  [`${OBJECT}/fields/Weight__c.field-meta.xml`]:
    '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>Weight__c</fullName>\n    <label>Weight</label>\n    <precision>8</precision>\n    <scale>2</scale>\n    <type>Number</type>\n</CustomField>\n',
};

function projectWorkspace(): string {
  const dir = dirs.next();
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split('/')), content);
  }
  return dir;
}

describe('a snapshot that is not analysed', () => {
  it('is named by the status, with the command that analyses it', async () => {
    const dir = projectWorkspace();
    await orglens(dir, ['snapshot', 'work']);
    expect((await orglens(dir, ['status'])).stdout).toMatch(
      /^work +git +1 +#1 complete, finished \S+ +by engine \S+$/m,
    );

    engineState.analysed = false;
    const status = await orglens(dir, ['status']);
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/^SOURCE {2}KIND {2}SNAPSHOTS {2}LATEST SNAPSHOT +ANALYSED$/m);
    expect(status.stdout).toMatch(/^work +git +1 +#1 complete, finished \S+ +no$/m);
    expect(status.stdout.split('\n').slice(-3)).toEqual([
      'prod    org   0          none',
      'Snapshot #1 of "work" is not analysed. "orglens analyse work" analyses it.',
      '',
    ]);
    expect(await orglensJson(dir, ['status'])).toMatchObject({
      code: 0,
      data: { sources: [{ name: 'work', latestSnapshot: { id: 1, analysis: null } }, { name: 'prod' }] },
    });
  });

  it('is shown by the coverage without numbers of an analysis, with the command that analyses it', async () => {
    const dir = projectWorkspace();
    await orglens(dir, ['snapshot', 'work']);
    engineState.analysed = false;
    const shown = await orglens(dir, ['coverage', 'work']);
    expect(shown).toMatchObject({ code: 0, stderr: '' });
    expect(shown.stdout.split('\n').slice(1)).toEqual([
      '',
      'TYPE          LISTED  RETRIEVED  ANALYSED',
      'CustomField   1       1          0',
      'CustomObject  1       1          0',
      '',
      'SEVERITY  CODE            WHAT',
      'info      COMMIT_UNKNOWN  The snapshot names no commit: the folder is not in a Git repository.',
      '',
      'The snapshot is not analysed. Analyse it with: orglens analyse work --snapshot 1',
      '',
    ]);
    // The exit code says nothing against a snapshot for want of an analysis: the report is what was asked for.
    expect(await orglensJson(dir, ['coverage', 'work'])).toMatchObject({
      code: 0,
      ok: true,
      data: { snapshot: { id: 1, status: 'complete' }, analysis: null },
    });
  });

  it('is not sent to `analyse` when it has not ended or was given up, which `analyse` refuses', async () => {
    const dir = projectWorkspace();
    await orglens(dir, ['snapshot', 'work']);
    engineState.analysed = false;
    const lastLine = async (): Promise<string | undefined> =>
      (await orglens(dir, ['coverage', 'work', '--snapshot', '1'])).stdout.split('\n').at(-2);

    engineState.status = 'running';
    expect(await lastLine()).toBe(
      'The snapshot is not analysed. It has not ended. It is continued and then analysed by: orglens snapshot work',
    );
    engineState.status = 'failed';
    expect(await lastLine()).toBe(
      'The snapshot is not analysed. It was given up, and a snapshot that was given up is never analysed.',
    );
  });
});
