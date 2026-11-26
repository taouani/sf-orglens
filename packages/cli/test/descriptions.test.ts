/**
 * What `snapshot` and `coverage` say about the descriptions of the objects of a snapshot of an org (decision record
 * 0085).
 *
 * The mock org of the tests of the command line holds Apex classes and no object, so a snapshot of it asks for no
 * description. A test of the command line reaches the database only through the engine. So the engine is wrapped
 * here: it hands out the report of a real snapshot of a repository as one of an org, with the descriptions a test
 * sets, and tells the progress of describing a test sets. The tests of the engine show that a snapshot of an org
 * asks for them (`org-descriptions.test.ts`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Engine from '@sf-orglens/engine';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

const engineState = vi.hoisted(() => ({
  descriptions: undefined as Engine.DescriptionsReport | null | undefined,
  /** The progress of describing that a snapshot tells, as `[done, total]`, with the time before each in ms. */
  progress: [] as (readonly [number, number, number])[],
}));

vi.mock('@sf-orglens/engine', async (original) => {
  const engine = await original<typeof Engine>();
  const asOrg = (report: Engine.CoverageReport): Engine.CoverageReport => {
    const { descriptions } = engineState;
    if (descriptions === undefined) return report;
    return { ...report, snapshot: { ...report.snapshot, kind: 'org', commit: null }, descriptions, issues: [] };
  };
  return {
    ...engine,
    openWorkspace: async (locator?: Engine.WorkspaceLocator): Promise<Engine.Workspace> => {
      const workspace = await engine.openWorkspace(locator);
      return {
        ...workspace,
        snapshot: async (source, options) => {
          for (const [done, total, after] of engineState.progress) {
            await new Promise((resolve) => setTimeout(resolve, after));
            options?.onProgress?.({ step: 'describing', snapshot: 1, done, total });
          }
          return asOrg(await workspace.snapshot(source, options));
        },
        coverage: async (source, options) => asOrg(await workspace.coverage(source, options)),
      };
    },
  };
});

const dirs = tempDirs();
afterEach(() => {
  engineState.descriptions = undefined;
  engineState.progress = [];
  dirs.cleanUp();
});

const FILES: Readonly<Record<string, string>> = {
  'orglens.toml': 'schema_version = 1\n[sources.work]\nkind = "git"\n',
  'sfdx-project.json': '{ "packageDirectories": [{ "path": "force-app" }] }\n',
  'force-app/main/default/classes/Parcel.cls': 'public class Parcel {}\n',
  'force-app/main/default/classes/Parcel.cls-meta.xml':
    '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>66.0</apiVersion>\n    <status>Active</status>\n</ApexClass>\n',
};

function project(): string {
  const dir = dirs.next();
  for (const [path, content] of Object.entries(FILES)) {
    mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split('/')), content);
  }
  return dir;
}

const WHOLE: Engine.DescriptionsReport = {
  state: 'whole',
  readAt: '2026-02-01T08:30:00.000Z',
  requests: 12,
  asked: 12,
  described: 12,
  unknown: 0,
  failed: 0,
  code: null,
};

/** The last line of the coverage, which is the one about the descriptions. */
async function lastLine(dir: string): Promise<string | undefined> {
  const shown = await orglens(dir, ['coverage', 'work']);
  expect(shown).toMatchObject({ code: 0, stderr: '' });
  return shown.stdout.split('\n').at(-2);
}

describe('the descriptions of the objects of a snapshot, as the command line shows them', () => {
  it('says how many objects the org described, and what it did not describe', async () => {
    const dir = project();
    expect(await orglens(dir, ['snapshot', 'work'])).toMatchObject({ code: 0 });
    // A snapshot of a repository says nothing about descriptions.
    expect(await lastLine(dir)).not.toMatch(/describ/);

    engineState.descriptions = WHOLE;
    expect(await lastLine(dir)).toBe('Descriptions: the org described the 12 objects the snapshot holds a file of.');
    engineState.descriptions = { ...WHOLE, asked: 1, described: 1, requests: 1 };
    expect(await lastLine(dir)).toBe('Descriptions: the org described the object the snapshot holds a file of.');

    engineState.descriptions = { ...WHOLE, state: 'partial', described: 9, unknown: 1, failed: 2, code: 'TIMEOUT' };
    expect(await lastLine(dir)).toBe(
      'Descriptions: the org described 9 of the 12 objects the snapshot holds a file of: it does not know 1, and gave no description of 2 (TIMEOUT).',
    );
    engineState.descriptions = { ...WHOLE, state: 'none', described: 0, unknown: 12 };
    expect(await lastLine(dir)).toBe(
      'Descriptions: the org described 0 of the 12 objects the snapshot holds a file of: it does not know 12.',
    );
    engineState.descriptions = { ...WHOLE, state: 'partial', described: 11, failed: 1, code: 'INVALID_SESSION_ID' };
    expect(await lastLine(dir)).toBe(
      'Descriptions: the org described 11 of the 12 objects the snapshot holds a file of: it gave no description of 1 (INVALID_SESSION_ID).',
    );

    // A snapshot that an earlier version took was not described. One that holds no object asked for nothing.
    engineState.descriptions = null;
    expect(await lastLine(dir)).toBe(
      'The org was not asked to describe its objects for this snapshot: an earlier version of OrgLens took it.',
    );
    engineState.descriptions = { ...WHOLE, asked: 0, described: 0, requests: 0 };
    expect(await lastLine(dir)).not.toMatch(/describ/);

    // The JSON output has the report as the engine gives it.
    engineState.descriptions = WHOLE;
    expect(await orglensJson(dir, ['coverage', 'work'])).toMatchObject({ data: { descriptions: WHOLE } });
  });

  it('says on the standard error stream when it asks the org to describe the objects, and how far it is', async () => {
    const dir = project();
    engineState.descriptions = WHOLE;
    // The first line after a while comes once the time between two lines has passed.
    engineState.progress = [
      [0, 12, 0],
      [1, 12, 0],
      [2, 12, 0],
    ];
    const run = await orglens(dir, ['snapshot', 'work']);
    expect(run.code).toBe(0);
    expect(run.stderr.split('\n').filter((line) => line.includes('describ'))).toEqual([
      'Snapshot #1: asking the org to describe the 12 objects the snapshot holds a file of.',
    ]);

    // A snapshot of an org that holds no object says nothing of it.
    engineState.progress = [[0, 0, 0]];
    const none = await orglens(project(), ['snapshot', 'work']);
    expect(none.stderr).not.toMatch(/describ/);
  });
});
