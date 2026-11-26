/**
 * What `impact` and `coverage` say of the components of a managed package installed in the org (decision record
 * 0076).
 *
 * Only a snapshot of an org has components of a package, and the mock org of the command line holds Apex classes
 * only, which no analyser of this phase reads. So the engine is wrapped here: it answers about the fixture project,
 * and the components a test names are of the package `pkg`, left out of what refers to a component unless
 * `packages` is asked for, as the engine does. The tests of the engine show that this is the answer it gives for a
 * flow of a package (`org-packages.test.ts`).
 */
import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Engine from '@sf-orglens/engine';
import { orglens, orglensJson, tempDirs } from './helpers/run.ts';

/** The keys a test puts into the package: a key and every key that starts with it and a `#`. */
const packaged = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock('@sf-orglens/engine', async (original) => {
  const engine = await original<typeof Engine>();
  const of = (key: string): string | null =>
    packaged.keys.some((one) => key === one || key.startsWith(`${one}#`)) ? 'pkg' : null;
  return {
    ...engine,
    openWorkspace: async (locator?: Engine.WorkspaceLocator): Promise<Engine.Workspace> => {
      const workspace = await engine.openWorkspace(locator);
      return {
        ...workspace,
        impact: async (source, component, query) => {
          const report = await workspace.impact(source, component, { ...query, packages: true });
          const found = report.results.map((result) => ({ ...result, package: of(result.key) }));
          const leaveOut = report.direction === 'incoming' && query?.packages !== true;
          const results = leaveOut ? found.filter((result) => result.package === null) : found;
          return {
            ...report,
            component: { ...report.component, package: of(report.component.key) },
            results,
            packagesLeftOut: found.length - results.length,
          };
        },
        coverage: async (source, options) => {
          const report = await workspace.coverage(source, options);
          const flows = packaged.keys.filter((key) => key.startsWith('Flow:')).length;
          return {
            ...report,
            types: report.types.map((type) => ({ ...type, packaged: type.type === 'Flow' ? flows : 0 })),
          };
        },
      };
    },
  };
});

const dirs = tempDirs();
afterEach(dirs.cleanUp);
beforeEach(() => {
  packaged.keys = ['Flow:invoice_recalculate'];
});

const FIXTURE = fileURLToPath(new URL('../../../fixtures/billing-sfdx', import.meta.url));

async function workspace(): Promise<string> {
  const dir = dirs.next();
  cpSync(FIXTURE, join(dir, 'project'), { recursive: true });
  writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n[sources.fixture]\nkind = "git"\nrepo = "project"\n');
  expect((await orglens(dir, ['snapshot', 'fixture'])).code).toBe(0);
  return dir;
}

describe('orglens impact, with components of a managed package', () => {
  it('says how many it left out of what refers to a component, and that --packages keeps them', async () => {
    const dir = await workspace();
    const shown = await orglens(dir, ['impact', 'Account.Credit_Limit__c']);
    expect(shown).toMatchObject({ code: 0, stderr: '' });
    await expect(shown.stdout).toMatchFileSnapshot('golden/impact-packages-left-out.txt');

    const kept = await orglens(dir, ['impact', 'Account.Credit_Limit__c', '--packages']);
    expect(kept).toMatchObject({ code: 0, stderr: '' });
    await expect(kept.stdout).toMatchFileSnapshot('golden/impact-packages-kept.txt');

    const json = await orglensJson(dir, ['impact', 'Account.Credit_Limit__c']);
    expect(json).toMatchObject({ code: 0, ok: true, data: { component: { package: null }, packagesLeftOut: 2 } });
    const all = await orglensJson(dir, ['impact', 'Account.Credit_Limit__c', '--packages']);
    const results = (all.data as Engine.ImpactReport).results;
    expect(results.filter((result) => result.package !== null).map((result) => [result.key, result.package])).toEqual([
      ['Flow:invoice_recalculate', 'pkg'],
      ['Flow:invoice_recalculate#element:compare_totals', 'pkg'],
    ]);
    expect(all.data).toMatchObject({ packagesLeftOut: 0 });
  });

  it('says when only components of packages refer to it, and counts one as one', async () => {
    const dir = await workspace();
    // A flow and its element write the field, and so does a method of each of two classes.
    packaged.keys = ['Flow:invoice_after_save', 'ApexClass:invoiceservice', 'ApexClass:invoicetriggerhandler'];
    const lines = (await orglens(dir, ['impact', 'Account.Risk_Score__c'])).stdout.split('\n');
    expect(lines.slice(lines.indexOf('') + 1, lines.indexOf('') + 3)).toEqual([
      'Nothing of the org itself that was analysed refers to it.',
      '4 components of managed packages refer to it as well, and are left out. --packages keeps them.',
    ]);
    expect(lines).not.toContain('REFERS TO can name a component of a managed package, which is left out.');

    packaged.keys = ['ValidationRule:invoice__c.amount_within_credit_limit'];
    const one = (await orglens(dir, ['impact', 'Account.Credit_Limit__c'])).stdout.split('\n');
    expect(one).toContain(
      '1 component of a managed package refers to it as well, and is left out. --packages keeps it.',
    );
    // Nothing is found through the rule, so no reference names it.
    expect(one).not.toContain('REFERS TO can name a component of a managed package, which is left out.');
  });

  it('says of the component that was asked about that it is of a package, and leaves nothing out of what it refers to', async () => {
    const dir = await workspace();
    const about = (await orglens(dir, ['impact', 'Invoice_Recalculate'])).stdout.split('\n');
    expect(about.slice(0, 2)).toEqual([
      'What refers to Flow:invoice_recalculate (Invoice_Recalculate), in snapshot #1 of "fixture".',
      'It is of the managed package pkg, which is installed in the org.',
    ]);

    const outgoing = (await orglens(dir, ['impact', 'Invoice_After_Save', '--outgoing'])).stdout.split('\n');
    const header = outgoing.find((line) => line.startsWith('DEPTH'));
    expect(header).toMatch(/^DEPTH +COMPONENT +PACKAGE +CONFIDENCE +KIND +REFERRED TO BY +WHERE$/);
    expect(outgoing.find((line) => line.includes(' Flow:invoice_recalculate '))).toMatch(
      /^1 +Flow:invoice_recalculate +pkg +confirmed +calls /,
    );
    expect(outgoing.join('\n')).not.toContain('left out');
  });
});

describe('orglens coverage, with components of a managed package', () => {
  it('shows how many of the listed components of each type are of a package, where any is', async () => {
    const dir = await workspace();
    const lines = (await orglens(dir, ['coverage', 'fixture'])).stdout.split('\n');
    const header = lines.findIndex((line) => line.startsWith('TYPE'));
    expect(lines[header]).toMatch(/^TYPE +LISTED +OF PACKAGES +RETRIEVED +ANALYSED$/);
    expect(lines.slice(header + 1).find((line) => line.startsWith('Flow '))).toMatch(/^Flow +\d+ +1 +\d+ +\d+$/);
    expect(lines.slice(header + 1).find((line) => line.startsWith('ApexClass '))).toMatch(/^ApexClass +\d+ +0 +/);

    packaged.keys = [];
    const without = (await orglens(dir, ['coverage', 'fixture'])).stdout.split('\n');
    expect(without.find((line) => line.startsWith('TYPE'))).toMatch(/^TYPE +LISTED +RETRIEVED +ANALYSED$/);
  });
});
