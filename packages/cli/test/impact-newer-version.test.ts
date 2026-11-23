/**
 * What `impact` says of a flow of the answer whose active version has a newer one beside it, such as a draft
 * (decision record 0066).
 *
 * Only a snapshot of an org can know of a newer version, and the mock org of the command line hands out no version
 * of a flow by its number. So the engine is wrapped here, and hands out a real answer about the fixture project
 * with the note that it gives for such a flow. The tests of the engine show that this is the answer it gives
 * then (`org-snapshot-flow-versions.test.ts`).
 */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Engine from '@sf-orglens/engine';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

vi.mock('@sf-orglens/engine', async (original) => {
  const engine = await original<typeof Engine>();
  return {
    ...engine,
    openWorkspace: async (locator?: Engine.WorkspaceLocator): Promise<Engine.Workspace> => {
      const workspace = await engine.openWorkspace(locator);
      return {
        ...workspace,
        // The flow that was asked about, and the flow of the first result, sorted by flow as the engine sorts them.
        impact: async (source, component, query) => {
          const report = await workspace.impact(source, component, query);
          const [first] = report.results;
          return {
            ...report,
            newerVersions: [
              ...(first === undefined ? [] : [{ flow: first.key, active: 1, newer: 'InvalidDraft' }]),
              { flow: report.component.key, active: 3, newer: 'Draft' },
            ],
          };
        },
      };
    },
  };
});

const dirs = tempDirs();
afterEach(dirs.cleanUp);

const FIXTURE = fileURLToPath(new URL('../../../fixtures/billing-sfdx', import.meta.url));

describe('orglens impact, for a flow with a newer version', () => {
  it('names each such flow below the results, changes neither the exit code nor the rest, and has them in the JSON', async () => {
    const dir = dirs.next();
    cpSync(FIXTURE, join(dir, 'project'), { recursive: true });
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n[sources.fixture]\nkind = "git"\nrepo = "project"\n');
    expect((await orglens(dir, ['snapshot', 'fixture'])).code).toBe(0);

    const shown = await orglens(dir, ['impact', 'Invoice_Recalculate']);
    expect(shown).toMatchObject({ code: 0, stderr: '' });
    const lines = shown.stdout.split('\n');
    const first = lines.findIndex((line) => line.startsWith('Flow:invoice_after_save has a version'));
    // After the table of the results, each in a paragraph of its own, and before what the answer does not cover.
    expect(lines.slice(first - 2, first + 5)).toEqual([
      lines[first - 2],
      '',
      'Flow:invoice_after_save has a version newer than its active version 1, which is InvalidDraft. The answer is about the active version, and the newer one is not analysed.',
      '',
      'Flow:invoice_recalculate has a version newer than its active version 3, which is Draft. The answer is about the active version, and the newer one is not analysed.',
      '',
      'Not analysed yet. A component of these types may refer to it, and is not in the answer:',
    ]);
    expect(lines[first - 2]).toMatch(/^1 +Flow:invoice_after_save#element:recalculate +confirmed +calls /);
    // Without the two lines, the text is the one of the golden file.
    const without = [...lines.slice(0, first - 1), ...lines.slice(first + 3)].join('\n');
    expect(without).toBe(readFileSync(new URL('golden/impact-flow.txt', import.meta.url), 'utf8'));

    const json = await orglensJson(dir, ['impact', 'Invoice_Recalculate']);
    expect(json).toMatchObject({
      code: 0,
      ok: true,
      data: {
        newerVersions: [
          { flow: 'Flow:invoice_after_save', active: 1, newer: 'InvalidDraft' },
          { flow: 'Flow:invoice_recalculate', active: 3, newer: 'Draft' },
        ],
        complete: false,
        mayMiss: false,
      },
    });
  });
});
