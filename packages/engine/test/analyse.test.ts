/**
 * `analyse`: the analysis of a snapshot that is already stored, from the files it holds (decision record 0043).
 *
 * The tests of `snapshot.test.ts` and `org-snapshot.test.ts` cover the analysis that a new snapshot gets. These
 * cover a snapshot that has none, one whose analysis is replaced, and an analysis that fails or is incomplete.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoverageReport } from '../src/api/snapshot.ts';
import { openWorkspace, type Workspace } from '../src/api/workspace.ts';
import { PARTS_NOTE } from '../src/store/analysis.ts';
import { MIGRATIONS } from '../src/store/migrate.ts';
import { openStore, type Store } from '../src/store/open.ts';
import { readLocalSource } from '../src/sources/local.ts';
import {
  addCoverage,
  addIssue,
  addSnapshotFile,
  ensureSource,
  finishSnapshot,
  insertSnapshot,
  readSnapshot,
} from '../src/store/snapshots.ts';
import { FIXTURES_DIR } from './helpers/answer-key.ts';
import { besidesKnownGap } from './helpers/known-gap.ts';
import { insertSnapshotBeforeLayout } from './helpers/old-store.ts';
import { DRIVERS, tempDirs } from './helpers/store.ts';
import { storedComponents, storedReferences } from './helpers/stored-analysis.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const OBJECTS = 'project/force-app/main/default/objects';

interface Failure {
  code: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

async function failure(run: () => Promise<unknown>): Promise<Failure> {
  try {
    await run();
  } catch (error) {
    return (error as { toJSON: () => Failure }).toJSON();
  }
  throw new Error('did not throw');
}

/** The events in the log of a workspace, in the order they were written. */
function loggedEvents(root: string): { event: string; fields: Record<string, unknown> }[] {
  const folder = join(root, '.orglens', 'logs');
  return readdirSync(folder)
    .sort()
    .flatMap((file) => readFileSync(join(folder, file), 'utf8').trim().split('\n'))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((fields) => ({ event: String(fields['event']), fields }));
}

/** A report without the moment of its analysis, which is the one thing a second analysis changes. */
const timeless = (report: CoverageReport): unknown => ({
  ...report,
  analysis: report.analysis === null ? null : { ...report.analysis, analysedAt: 'TIME' },
});

describe.each(DRIVERS.map((driver) => [driver.name, driver] as const))(
  'the analysis of a stored snapshot with %s',
  (driverName, driver) => {
    const env = { ORGLENS_SQLITE_DRIVER: driverName };

    /** A workspace with a copy of the fixture project as the source `fixture`, and an org that is only declared. */
    async function setUp(): Promise<{ root: string; database: string; workspace: Workspace }> {
      const root = temp.next();
      cpSync(join(FIXTURES_DIR, 'billing-sfdx'), join(root, 'project'), { recursive: true });
      writeFileSync(
        join(root, 'orglens.toml'),
        'schema_version = 1\n[sources.fixture]\nkind = "git"\nrepo = "project"\n[sources.prod]\nkind = "org"\n',
      );
      return {
        root,
        database: join(root, '.orglens', 'orglens.db'),
        workspace: await openWorkspace({ root, env }),
      };
    }

    function inStore<T>(database: string, work: (store: Store) => T, readOnly = true): T {
      const store = openStore({ path: database, driver, readOnly });
      try {
        return readOnly ? work(store) : store.write(() => work(store));
      } finally {
        store.close();
      }
    }

    /** What the analysis of a snapshot left in the tables. */
    const analysisOf = (database: string, snapshot: number): unknown =>
      inStore(database, (store) => ({
        components: storedComponents(store, snapshot),
        references: storedReferences(store, snapshot),
      }));

    /** How many rows the tables have that snapshots share. */
    const shared = (database: string): Record<string, number> =>
      inStore(database, (store) =>
        Object.fromEntries(
          ['component', 'component_version', 'reference', 'file_path'].map((table) => [
            table,
            Number(store.get(`SELECT COUNT(*) AS n FROM ${table}`)?.['n']),
          ]),
        ),
      );

    it('analyses the latest snapshot again, or the one that is named, and replaces only the analysis', async () => {
      const { root, database, workspace } = await setUp();
      const taken = await workspace.snapshot('fixture');
      expect(taken.analysis).toMatchObject({ components: 345, references: 656, complete: true });
      const stored = analysisOf(database, 1);
      const rows = shared(database);

      const again = await workspace.analyse('fixture');
      expect(timeless(again)).toEqual(timeless(taken));
      expect(again.analysis?.analysedAt).toMatch(UTC);
      expect(Date.parse(again.analysis?.analysedAt ?? '')).toBeGreaterThanOrEqual(
        Date.parse(taken.analysis?.analysedAt ?? ''),
      );
      // The same components and references, and not one row more: what did not change is not stored twice.
      expect(analysisOf(database, 1)).toEqual(stored);
      expect(shared(database)).toEqual(rows);
      expect(await workspace.coverage('fixture')).toEqual(again);

      // A second snapshot with one rule less. The latest is analysed, or the one that is named.
      rmSync(join(root, OBJECTS, 'Invoice__c', 'validationRules', 'Void_Needs_Admin.validationRule-meta.xml'));
      const second = await workspace.snapshot('fixture');
      expect(second).toMatchObject({ snapshot: { id: 2 }, analysis: { components: 344, complete: true } });
      expect(timeless(await workspace.analyse('fixture'))).toEqual(timeless(second));
      expect(timeless(await workspace.analyse('fixture', { snapshot: 1 }))).toEqual(timeless(taken));
      expect(analysisOf(database, 1)).toEqual(stored);
      expect((await workspace.status()).sources[0]).toMatchObject({
        name: 'fixture',
        snapshots: 2,
        latestSnapshot: { id: 2, analysis: { engineVersion: second.snapshot.engineVersion } },
      });
    });

    it('analyses a snapshot that a database of Phase 0 holds to what a new snapshot gives', async () => {
      const { root, database, workspace } = await setUp();
      mkdirSync(join(root, '.orglens'), { recursive: true });
      // A database as the engine of Phase 0 left it: schema version 2, no table for an analysis, and a snapshot
      // of the fixture project, written with the statements of that engine.
      const declared = {
        kind: 'git',
        name: 'fixture',
        description: null,
        repo: 'project',
        ref: null,
        paths: null,
        tracks: null,
      } as const;
      const reading = await readLocalSource(root, declared);
      const at = '2026-11-13T09:30:00.000Z';
      const old = openStore({ path: database, driver, migrations: MIGRATIONS.slice(0, 2) });
      old.write(() => {
        const sourceId = ensureSource(old, { name: 'fixture', kind: 'git', createdAt: at });
        const id = insertSnapshotBeforeLayout(old, {
          sourceId,
          status: 'running',
          startedAt: at,
          finishedAt: null,
          engineVersion: '0.1.0',
          gitCommit: null,
        });
        for (const path of reading.tree.files) addSnapshotFile(old, id, path, reading.tree.read(path));
        const types = new Map<string, number>();
        for (const component of reading.components) types.set(component.type, (types.get(component.type) ?? 0) + 1);
        for (const [type, count] of types) {
          addCoverage(old, id, { type, listed: count, retrieved: count, analysed: 0, listing: 'ok', note: null });
        }
        for (const issue of reading.issues)
          addIssue(old, id, { ...issue, componentKey: null, details: issue.details ?? null });
        finishSnapshot(old, id, { status: 'complete', finishedAt: at, gitCommit: null });
      });
      expect(old.schemaVersion).toBe(2);
      old.close();

      expect((await workspace.status()).store.state).toBe('outdated');
      expect(await failure(() => workspace.coverage('fixture'))).toMatchObject({
        code: 'STORE_OUTDATED',
        hint: 'Run a command that writes to the workspace, such as "orglens analyse" or "orglens snapshot", to update it.',
      });

      // `analyse` migrates the database and analyses the snapshot it finds there.
      const analysed = await workspace.analyse('fixture');
      expect(analysed.snapshot).toMatchObject({ id: 1, status: 'complete', files: 177 });
      expect((await workspace.status()).store).toMatchObject({ state: 'ready', schemaVersion: MIGRATIONS.length });

      const fresh = await workspace.snapshot('fixture');
      expect(fresh.snapshot).toMatchObject({ id: 2, status: 'complete', files: 177 });
      expect(analysisOf(database, 1)).toEqual(analysisOf(database, 2));
      expect(analysed.analysis).toEqual({ ...fresh.analysis, analysedAt: expect.stringMatching(UTC) as string });
      expect(analysed.types).toEqual(fresh.types);
      expect(analysed.issues).toEqual(fresh.issues);
      expect(analysed.analysis).toMatchObject({ components: 345, references: 656, complete: true });
    });

    it('keeps a snapshot whose analysis fails as a whole, says how it is analysed, and keeps an analysis it had', async () => {
      const { root, database, workspace } = await setUp();
      const first = await workspace.snapshot('fixture');
      // From here on the database refuses to store an analysis.
      const direct = new DatabaseSync(database);
      direct.exec(
        `CREATE TRIGGER refuse_analysis BEFORE INSERT ON snapshot_analysis
         BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`,
      );
      direct.close();

      const failed = await failure(() => workspace.snapshot('fixture'));
      expect(failed.message).toMatch(/^Snapshot #2 of the source "fixture" is stored, and its analysis failed\. /);
      expect(failed.hint).toMatch(/Analyse it with: orglens analyse fixture --snapshot 2$/);
      expect(failed).toMatchObject({ code: 'STORE_FAILED', details: { source: 'fixture', snapshot: 2 } });
      // The message of SQLite is the one that would leave the engine without the snapshot, with its code.
      expect(failed.message).toMatch(
        /A statement on the workspace database failed\. SQLite says: refused for the test$/,
      );

      // The snapshot is there, complete in what was read, and nothing of an analysis is.
      const unanalysed = await workspace.coverage('fixture');
      expect(unanalysed.snapshot).toMatchObject({ id: 2, status: 'complete', files: first.snapshot.files });
      expect(unanalysed.analysis).toBeNull();
      expect(unanalysed.types.filter((type) => type.analysed > 0)).toEqual([]);
      expect(unanalysed.types.map((type) => type.type)).toEqual(
        first.types.filter((type) => type.note !== PARTS_NOTE).map((type) => type.type),
      );
      // What the reading said is still there. What the analysis said, a warning about a flow and one about DML of
      // Apex, is not.
      expect(first.issues.filter((issue) => issue.stage === 'analysis').map((issue) => issue.code)).toEqual([
        'PATH_NOT_FOLLOWED',
        'PATH_NOT_FOLLOWED',
      ]);
      expect(unanalysed.issues).toEqual(first.issues.filter((issue) => issue.stage !== 'analysis'));
      expect(analysisOf(database, 2)).toEqual({ components: [], references: [] });
      expect((await workspace.status()).sources[0]?.latestSnapshot).toMatchObject({ id: 2, analysis: null });

      // An analysis that fails as a whole leaves the one the snapshot had.
      const again = await failure(() => workspace.analyse('fixture', { snapshot: 1 }));
      expect(again.message).toMatch(/^Snapshot #1 of the source "fixture" is stored, and its analysis failed\. /);
      expect(await workspace.coverage('fixture', { snapshot: 1 })).toEqual(first);
      // The log says of both that the snapshot is stored and not analysed.
      expect(
        loggedEvents(root)
          .filter((one) => one.event.startsWith('snapshot.'))
          .map(
            (one) =>
              `${one.event} ${String(one.fields['snapshot'])} ${typeof one.fields['code'] === 'string' ? one.fields['code'] : ''}`,
          ),
      ).toEqual(['snapshot.taken 1 ', 'snapshot.not_analysed 2 STORE_FAILED', 'snapshot.not_analysed 1 STORE_FAILED']);

      inStore(database, (store) => store.run('DROP TRIGGER refuse_analysis'), false);
      const analysed = await workspace.analyse('fixture');
      expect(analysed.snapshot.id).toBe(2);
      expect(analysed.analysis).toEqual({ ...first.analysis, analysedAt: expect.stringMatching(UTC) as string });
      expect(analysed.types).toEqual(first.types);
      expect(analysisOf(database, 2)).toEqual(analysisOf(database, 1));
    });

    it('places the files of a repository as they were read, whatever folder it is analysed from', async () => {
      const { database, workspace } = await setUp();
      const taken = await workspace.snapshot('fixture');
      expect(inStore(database, (store) => readSnapshot(store, 'fixture')?.layout)).toBeNull();

      // The command runs in a folder whose project gives every custom label a file of its own. The fixture
      // project holds its labels in one file, and is analysed so all the same.
      const elsewhere = temp.next();
      writeFileSync(
        join(elsewhere, 'sfdx-project.json'),
        JSON.stringify({
          packageDirectories: [{ path: 'force-app' }],
          sourceBehaviorOptions: ['decomposeCustomLabelsBeta2'],
        }),
      );
      const startedIn = process.cwd();
      process.chdir(elsewhere);
      try {
        expect(timeless(await workspace.analyse('fixture'))).toEqual(timeless(taken));
        const second = await workspace.snapshot('fixture');
        expect(second.analysis).toEqual({ ...taken.analysis, analysedAt: expect.stringMatching(UTC) as string });
        expect(second.types).toEqual(taken.types);
      } finally {
        process.chdir(startedIn);
      }
    });

    it('keeps the layout a project asks for with its snapshot, and analyses with it after the project changed', async () => {
      const root = temp.next();
      const label = (name: string): string =>
        `<?xml version="1.0" encoding="UTF-8"?>\n<CustomLabel xmlns="http://soap.sforce.com/2006/04/metadata">\n    <fullName>${name}</fullName>\n    <language>en_US</language>\n    <protected>false</protected>\n    <shortDescription>${name}</shortDescription>\n    <value>${name}</value>\n</CustomLabel>\n`;
      mkdirSync(join(root, 'force-app', 'labels'), { recursive: true });
      writeFileSync(join(root, 'force-app', 'labels', 'Greeting.label-meta.xml'), label('Greeting'));
      writeFileSync(join(root, 'force-app', 'labels', 'Farewell.label-meta.xml'), label('Farewell'));
      const projectFile = (options: readonly string[]): string =>
        `${JSON.stringify({ packageDirectories: [{ path: 'force-app' }], sourceBehaviorOptions: options })}\n`;
      writeFileSync(join(root, 'sfdx-project.json'), projectFile(['decomposeCustomLabelsBeta2']));
      writeFileSync(join(root, 'orglens.toml'), 'schema_version = 1\n[sources.work]\nkind = "git"\n');
      const workspace = await openWorkspace({ root, env });

      const taken = await workspace.snapshot('work');
      expect(taken.snapshot).toMatchObject({ status: 'complete', files: 2 });
      expect(taken.analysis).toMatchObject({ components: 2, complete: true });
      expect(taken.types.map(({ type, listed }) => `${type} ${String(listed)}`)).toEqual(['CustomLabel 2']);
      const database = join(root, '.orglens', 'orglens.db');
      expect(inStore(database, (store) => readSnapshot(store, 'work')?.layout)).toEqual({
        presets: ['decomposeCustomLabelsBeta2'],
        customizations: null,
      });

      // The project no longer asks for it. The snapshot is analysed as it was read.
      writeFileSync(join(root, 'sfdx-project.json'), projectFile([]));
      expect(timeless(await workspace.analyse('work'))).toEqual(timeless(taken));
    });

    it('says what stands in the way: no such source, no database, no snapshot, a snapshot that did not end', async () => {
      const { database, workspace } = await setUp();
      expect(await failure(() => workspace.analyse('nowhere'))).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
      expect(await failure(() => workspace.analyse('fixture'))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'There is no snapshot of the source "fixture" yet.',
        hint: 'Take one with: orglens snapshot fixture',
      });
      // Asking does not create a database.
      expect(existsSync(database)).toBe(false);

      await workspace.snapshot('fixture');
      expect(await failure(() => workspace.analyse('prod'))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'There is no snapshot of the source "prod" yet.',
      });
      expect(await failure(() => workspace.analyse('fixture', { snapshot: 7 }))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'The source "fixture" has no snapshot 7.',
      });

      // A snapshot of the org that was interrupted, and one that was given up.
      const [running, givenUp] = inStore(
        database,
        (store) => {
          const sourceId = ensureSource(store, { name: 'prod', kind: 'org', createdAt: '2026-01-31T09:30:00.000Z' });
          return (['running', 'failed'] as const).map((status) =>
            insertSnapshot(store, {
              sourceId,
              status,
              startedAt: '2026-01-31T09:30:00.000Z',
              finishedAt: null,
              engineVersion: '0.0.0',
              apiVersion: '66.0',
              gitCommit: null,
            }),
          );
        },
        false,
      );
      expect(await failure(() => workspace.analyse('prod'))).toMatchObject({
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'There is no snapshot of the source "prod" yet.',
      });
      expect(await failure(() => workspace.analyse('prod', { snapshot: running }))).toEqual({
        code: 'SNAPSHOT_NOT_FOUND',
        message: `Snapshot ${String(running)} of the source "prod" has not ended, so it cannot be analysed.`,
        hint: 'It is continued and then analysed by: orglens snapshot prod',
        details: { source: 'prod', snapshot: running, status: 'running' },
      });
      expect(await failure(() => workspace.analyse('prod', { snapshot: givenUp }))).toEqual({
        code: 'SNAPSHOT_NOT_FOUND',
        message: `Snapshot ${String(givenUp)} of the source "prod" was given up. It holds a part of the source at most and is not analysed.`,
        hint: 'The latest snapshot of each source is shown by: orglens status',
        details: { source: 'prod', snapshot: givenUp, status: 'failed' },
      });
      expect(analysisOf(database, running ?? 0)).toEqual({ components: [], references: [] });
    });

    it('calls an analysis incomplete when a file cannot be read as XML, and the snapshot complete all the same', async () => {
      const { root, workspace } = await setUp();
      const field = 'force-app/main/default/objects/Invoice__c/fields/Legacy_Code__c.field-meta.xml';
      writeFileSync(join(root, 'project', ...field.split('/')), '<CustomField xmlns="x"><label>Legacy');
      const report = await workspace.snapshot('fixture');

      // Everything the source holds was read. What one file says was not understood.
      expect(report.snapshot.status).toBe('complete');
      expect(report.analysis).toMatchObject({ components: 345, complete: false });
      expect(report.analysis?.origins[0]).toMatchObject({ origin: 'parser:xml', failedFiles: 1 });
      const errors = report.issues.filter((issue) => issue.severity === 'error');
      expect(errors).toHaveLength(1);
      // The issue names the file. Which component the file is was not read from it.
      expect(errors[0]).toMatchObject({ stage: 'analysis', component: null, details: { path: field } });
      expect(errors[0]?.code).toMatch(/^XML_/);
      // The issues of the reading stand first.
      expect(report.issues.map((issue) => issue.stage).join(' ')).toMatch(/^(?:read )*(?:analysis ?)+$/);
    });

    it('says that a file of the snapshot belongs to no component, and calls the analysis incomplete', async () => {
      const { database, workspace } = await setUp();
      const taken = await workspace.snapshot('fixture');
      // A file that a later version of the engine does not take for metadata any more.
      const stray = 'force-app/main/default/classes/notes.txt';
      inStore(
        database,
        (store) => {
          addSnapshotFile(store, 1, stray, Buffer.from('not metadata'));
        },
        false,
      );

      const report = await workspace.analyse('fixture');
      expect(report.snapshot.status).toBe('complete');
      expect(report.analysis).toMatchObject({ components: 345, references: 656, complete: false });
      expect(besidesKnownGap(report.issues.filter((issue) => issue.stage === 'analysis'))).toEqual([
        {
          stage: 'analysis',
          severity: 'error',
          code: 'FILES_NOT_PLACED',
          message: `1 file of the snapshot belongs to no metadata component, and was not analysed. A file of its component is missing from the snapshot, or this version of OrgLens places it differently. The first: ${stray}`,
          component: null,
          details: { count: 1, paths: [stray] },
        },
      ]);

      // The issues of an analysis go with it when it is replaced.
      inStore(database, (store) => store.run('DELETE FROM snapshot_file WHERE path = ?', stray), false);
      expect(timeless(await workspace.analyse('fixture'))).toEqual(timeless(taken));
    });

    it('says which file of the snapshot the database no longer holds as it was stored', async () => {
      const { database, workspace } = await setUp();
      const taken = await workspace.snapshot('fixture');
      const field = 'force-app/main/default/objects/Invoice__c/fields/Legacy_Code__c.field-meta.xml';
      // The content of one file is damaged in the database.
      const direct = new DatabaseSync(database);
      direct
        .prepare("UPDATE blob SET body = x'00' WHERE id = (SELECT blob_id FROM snapshot_file WHERE path = ?)")
        .run(field);
      direct.close();

      const report = await workspace.analyse('fixture');
      expect(report.snapshot).toEqual(taken.snapshot);
      expect(report.analysis).toMatchObject({ components: 345, complete: false });
      expect(besidesKnownGap(report.issues.filter((issue) => issue.stage === 'analysis'))).toEqual([
        {
          stage: 'analysis',
          severity: 'error',
          code: 'FILE_UNREADABLE',
          message: `${field} could not be read.`,
          component: null,
          details: { path: field },
        },
      ]);
      // The field is known and nothing of it was read. The others are analysed as before.
      const analysed = (one: CoverageReport): number | undefined =>
        one.types.find((type) => type.type === 'CustomField')?.analysed;
      expect([analysed(taken), analysed(report)]).toEqual([59, 58]);
    });

    it('counts the parts it finds inside the file of an object, which the source does not list', async () => {
      const root = temp.next();
      const object = `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
    <deploymentStatus>Deployed</deploymentStatus>
    <fields>
        <fullName>Weight__c</fullName>
        <label>Weight</label>
        <precision>8</precision>
        <scale>2</scale>
        <type>Number</type>
    </fields>
    <fields>
        <fullName>Heavy__c</fullName>
        <formula>Weight__c &gt; 100</formula>
        <label>Heavy</label>
        <type>Checkbox</type>
    </fields>
    <label>Parcel</label>
    <nameField>
        <label>Parcel Name</label>
        <type>Text</type>
    </nameField>
    <pluralLabel>Parcels</pluralLabel>
    <sharingModel>ReadWrite</sharingModel>
    <validationRules>
        <fullName>Weight_Is_Positive</fullName>
        <active>true</active>
        <errorConditionFormula>Weight__c &lt;= 0</errorConditionFormula>
        <errorMessage>The weight must be more than nothing.</errorMessage>
    </validationRules>
</CustomObject>
`;
      // A repository in the format of the Metadata API: one file for an object with everything in it.
      mkdirSync(join(root, 'src', 'objects'), { recursive: true });
      writeFileSync(join(root, 'src', 'objects', 'Parcel__c.object'), object);
      writeFileSync(
        join(root, 'sfdx-project.json'),
        '{ "packageDirectories": [{ "path": "src", "default": true }] }\n',
      );
      writeFileSync(join(root, 'orglens.toml'), 'schema_version = 1\n[sources.work]\nkind = "git"\n');
      const workspace = await openWorkspace({ root, env });
      const report = await workspace.snapshot('work');

      expect(report.snapshot).toMatchObject({ status: 'complete', files: 1 });
      expect(report.analysis).toMatchObject({ components: 4, references: 2, complete: true });
      const types = [
        { type: 'CustomField', listed: 0, retrieved: 0, analysed: 2, listing: 'ok', note: PARTS_NOTE, packaged: 0 },
        { type: 'CustomObject', listed: 1, retrieved: 1, analysed: 1, listing: 'ok', note: null, packaged: 0 },
        { type: 'ValidationRule', listed: 0, retrieved: 0, analysed: 1, listing: 'ok', note: PARTS_NOTE, packaged: 0 },
      ];
      expect(report.types).toEqual(types);
      // A second analysis counts them once more, not twice.
      expect((await workspace.analyse('work')).types).toEqual(types);
    });
  },
);
