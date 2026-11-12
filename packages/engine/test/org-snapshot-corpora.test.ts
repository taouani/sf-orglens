/**
 * Takes a snapshot of a mock org that holds a public codebase of
 * `fixtures/corpora.toml`, and compares it with what the codebase holds
 * on disk. The codebases have metadata types the fixture project lacks.
 *
 * The mock org is not Salesforce: it converts the files with the
 * Salesforce library, in both directions. What this proves is that the
 * inventory, the chunks and the unpacking lose no component and no file
 * on the way, for every type the codebases have.
 *
 * A codebase that was not downloaded (`pnpm run corpora:fetch`) is
 * skipped. CI does not download them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/api/layout.ts';
import { takeOrgSnapshot } from '../src/api/org-snapshot.ts';
import { openWorkspace } from '../src/api/workspace.ts';
import type { OrgSource } from '../src/core/config/config.ts';
import { readLocalSource } from '../src/sources/local.ts';
import { openStore } from '../src/store/open.ts';
import { forgetCliLogins, seedCliLogin } from './helpers/cli-logins.ts';
import { metadataFromSource } from './helpers/mock-metadata.ts';
import { startMockOrg, type MockOrg } from './helpers/mock-org.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';

const root = join(import.meta.dirname, '../../..');
const corpora = join(root, '.corpora');
const manifest = parse(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8')) as {
  corpus: { name: string; paths: string[] }[];
};
const ORG_ID = '00Dxx0000000001EAA';
const dirs = tempDirs();
let mock: MockOrg;

beforeAll(async () => {
  mock = await startMockOrg();
});
afterAll(async () => {
  await mock.close();
});
afterEach(async () => {
  mock.sessions.clear();
  await forgetCliLogins();
  dirs.cleanUp();
});

describe('a snapshot of an org that holds a public codebase', () => {
  for (const { name, paths } of manifest.corpus) {
    const [packageDir = ''] = paths;
    it.skipIf(!existsSync(join(corpora, name)) || paths.length !== 1)(
      `holds every component and every file of ${name}`,
      async () => {
        const onDisk = await readLocalSource(corpora, {
          kind: 'git',
          name,
          description: null,
          repo: name,
          ref: null,
          paths,
          tracks: null,
        });
        const metadata = await metadataFromSource(join(corpora, name, packageDir));
        metadata.pollsBeforeDone = 0;
        mock.metadata = metadata;
        mock.sessions.add('valid-session');
        await seedCliLogin({
          username: 'zoe@example.com',
          alias: 'main',
          orgId: ORG_ID,
          instanceUrl: mock.url,
          accessToken: 'valid-session',
        });

        const dir = dirs.next();
        writeFileSync(
          join(dir, 'orglens.toml'),
          `schema_version = 1\n\n[sources.prod]\nkind = "org"\norg_id = "${ORG_ID}"\n`,
        );
        mkdirSync(join(dir, '.orglens'), { recursive: true });
        const workspace = await openWorkspace({ root: dir, env: {} });
        const source = (await workspace.sources.list()).find((one) => one.name === 'prod') as OrgSource;
        const [driver] = DRIVERS;
        if (driver === undefined) throw new Error('no driver');
        const database = join(dir, '.orglens', 'orglens.db');
        const report = await takeOrgSnapshot({
          paths: workspacePaths(dir),
          source,
          linked: undefined,
          env: {},
          openStore: () => openStore({ path: database, driver }),
          tuning: { pollFirstMs: 1 },
        });

        const store = openStore({ path: database, driver, readOnly: true });
        const stored = store
          .all('SELECT path FROM snapshot_file WHERE snapshot_id = 1 ORDER BY path')
          .map((row) => String(row['path']));
        const components = store
          .all('SELECT type, full_name FROM inventory_item WHERE snapshot_id = 1 AND retrieved = 1')
          .map((row) => `${String(row['type'])}:${String(row['full_name'])}`);
        store.close();

        expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
        expect(report.snapshot.status).toBe('complete');

        // Where a file lies below the package directory is the choice of a project, and an org has one place for
        // it. So files are compared by their names. Three differences are expected:
        // - The content of a static resource is written with the ending its content type calls for.
        // - A project can keep custom labels in several files. An org has one.
        // - A report in a folder that the project has no file for: the mock org does not know the folder.
        const nameOf = (path: string): string => {
          const name = path.slice(path.lastIndexOf('/') + 1);
          const resource = /(?:^|\/)staticresources\//.test(path) && !name.endsWith('.resource-meta.xml');
          return resource ? `staticresources/${name.slice(0, name.lastIndexOf('.'))}` : name;
        };
        const inUnknownFolder = (path: string): boolean => {
          const folder = /^((?:.*\/)?(?:reports|dashboards|documents|email)\/[^/]+)\/[^/]+$/.exec(path)?.[1];
          return (
            folder !== undefined &&
            !onDisk.tree.files.some((one) => one.startsWith(`${folder}.`) && one.endsWith('Folder-meta.xml'))
          );
        };
        const got = new Set(stored.map(nameOf));
        const missing = onDisk.tree.files.filter(
          (path) => !got.has(nameOf(path)) && !path.endsWith('.labels-meta.xml') && !inUnknownFolder(path),
        );
        expect(missing).toEqual([]);
        expect(stored.some((path) => path.endsWith('.labels-meta.xml'))).toBe(
          onDisk.tree.files.some((path) => path.endsWith('.labels-meta.xml')),
        );
        // What the org holds beyond the project: the objects whose parts the project has without the object.
        const expected = new Set(onDisk.tree.files.map(nameOf));
        expect(stored.filter((path) => !expected.has(nameOf(path)) && !path.endsWith('.object-meta.xml'))).toEqual([]);
        // Every component of the project came back, by the name the org listed it under.
        const absent = onDisk.components
          .filter((component) => !component.files.every(inUnknownFolder))
          .map((component) => `${component.type}:${component.fullName}`)
          .filter((one) => !components.includes(one));
        expect(absent).toEqual([]);
      },
      600_000,
    );
  }
});
