import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EngineError, ERROR_CODES, type ErrorCode } from '@sf-orglens/engine';
import { createWriter, EXIT, printable, table } from '../src/output.ts';
import { matchesSchema, orglens, orglensJson, outputSchema, tempDirs } from './helpers/run.ts';

const dirs = tempDirs();
afterEach(dirs.cleanUp);

/** A workspace named "test" in a new folder. */
async function workspace(): Promise<string> {
  const dir = dirs.next();
  expect((await orglens(dir, ['init', '--name', 'test'])).code).toBe(0);
  return dir;
}

const config = (dir: string): string => readFileSync(join(dir, 'orglens.toml'), 'utf8');

describe('orglens init', () => {
  it('creates a workspace in the current folder and says what it wrote', async () => {
    const dir = dirs.next();
    const run = await orglens(dir, ['init']);
    expect(run).toEqual({
      code: 0,
      stderr: '',
      stdout: [
        `Created a workspace in ${dir}.`,
        '  created orglens.toml',
        '  created .orglens/.gitignore',
        '  created .orglens/orglens.db',
        'Next: declare an org, a sandbox or a repository folder with "orglens source add".',
        '',
      ].join('\n'),
    });
    const again = await orglens(dir, ['init']);
    expect(again.stdout).toBe(`The workspace in ${dir} is complete. Nothing was changed.\n`);
    expect(again.code).toBe(0);
  });

  it('completes a workspace that came with a repository', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n');
    const run = await orglens(dir, ['init']);
    expect(run.stdout).toBe(
      `Completed the workspace in ${dir}. orglens.toml was not changed.\n  created .orglens/.gitignore\n  created .orglens/orglens.db\n`,
    );
  });

  it('takes the folder as an argument, from --workspace or from ORGLENS_WORKSPACE', async () => {
    const base = dirs.next();
    const byArgument = await orglensJson(base, ['init', 'one', '--name', 'One']);
    expect(byArgument).toMatchObject({
      code: 0,
      command: 'init',
      ok: true,
      data: {
        root: join(base, 'one'),
        created: ['orglens.toml', '.orglens/.gitignore', '.orglens/orglens.db'],
        existing: false,
      },
      warnings: [],
      error: null,
    });
    expect(config(join(base, 'one'))).toContain('name = "One"');

    const other = dirs.next();
    expect((await orglensJson(base, ['init', '--workspace', join(other, 'two')])).data).toMatchObject({
      root: join(other, 'two'),
    });
    expect((await orglensJson(base, ['init'], { ORGLENS_WORKSPACE: join(other, 'three') })).data).toMatchObject({
      root: join(other, 'three'),
    });
  });

  it('rejects a folder that is given twice', async () => {
    const run = await orglens(dirs.next(), ['init', 'one', '--workspace', 'two']);
    expect(run).toEqual({
      code: 2,
      stdout: '',
      stderr: 'error: The folder was given twice: as an argument and with --workspace. Give it once.\n',
    });
  });

  it('refuses a folder inside a workspace', async () => {
    const dir = await workspace();
    mkdirSync(join(dir, 'inner'));
    // The workspace above is named by its real path: on macOS the folder for temporary files is a link.
    const root = realpathSync(dir);
    const run = await orglens(join(dir, 'inner'), ['init']);
    expect(run).toEqual({
      code: 2,
      stdout: '',
      stderr: `error: This folder is inside the workspace at ${root}.\nhint: One workspace covers all folders below it. Declare the sources there.\n`,
    });
    const json = await orglensJson(join(dir, 'inner'), ['init']);
    expect(json).toMatchObject({ code: 2, ok: false, data: null, command: 'init' });
    expect(json.error).toMatchObject({ code: 'WORKSPACE_EXISTS', details: { root } });
  });
});

describe('orglens source', () => {
  it('adds, lists and removes sources', async () => {
    const dir = await workspace();
    const before = config(dir);
    expect(await orglens(dir, ['source', 'list'])).toEqual({
      code: 0,
      stderr: '',
      stdout: 'No sources are declared. Declare one with "orglens source add".\n',
    });

    const add = await orglens(dir, [
      'source',
      'add',
      'prod',
      '--kind',
      'org',
      '--org-id',
      '00D000000000009',
      '--description',
      'Production',
    ]);
    expect(add).toEqual({ code: 0, stderr: '', stdout: 'Added the source "prod" (org) to orglens.toml.\n' });
    await orglens(dir, ['source', 'add', 'uat', '--kind', 'sandbox', '--sandbox-of', 'prod', '--sandbox-name', 'uat']);
    const git = await orglensJson(dir, [
      'source',
      'add',
      'emea',
      '--kind=git',
      '--ref',
      'main',
      '--path',
      'core',
      '--path',
      'emea',
      '--tracks',
      'prod',
    ]);
    expect(git).toMatchObject({
      code: 0,
      command: 'source add',
      data: {
        source: {
          name: 'emea',
          kind: 'git',
          description: null,
          repo: '.',
          ref: 'main',
          paths: ['core', 'emea'],
          tracks: 'prod',
        },
      },
    });

    const list = await orglens(dir, ['source', 'list']);
    expect(list.stdout).toBe(
      [
        'NAME  KIND     POINTS AT                                       DESCRIPTION',
        'prod  org      org id 00D000000000009                          Production',
        'uat   sandbox  sandbox of prod, sandbox name uat',
        'emea  git      repo ., ref main, paths core emea, tracks prod',
        '',
      ].join('\n'),
    );
    const listed = await orglensJson(dir, ['source', 'list']);
    expect((listed.data as { sources: { name: string }[] }).sources.map((source) => source.name)).toEqual([
      'prod',
      'uat',
      'emea',
    ]);

    const inUse = await orglens(dir, ['source', 'remove', 'prod']);
    expect(inUse).toEqual({
      code: 2,
      stdout: '',
      stderr: 'error: The source "prod" is referred to by: uat, emea.\nhint: Remove or change those sources first.\n',
    });
    expect((await orglensJson(dir, ['source', 'remove', 'emea'])).data).toEqual({ removed: 'emea' });
    expect((await orglens(dir, ['source', 'remove', 'uat'])).stdout).toBe(
      'Removed the source "uat" from orglens.toml. Snapshots of it stay in the database.\n',
    );
    expect((await orglens(dir, ['source', 'remove', 'prod'])).code).toBe(0);
    expect(config(dir)).toBe(before);
  });

  it('rejects an option that belongs to another kind of source, before anything is read', async () => {
    const run = await orglens(dirs.next(), ['source', 'add', 'prod', '--kind', 'org', '--path', 'force-app']);
    expect(run).toEqual({
      code: 2,
      stdout: '',
      stderr: 'error: --path does not apply to a source of kind "org".\nhint: It applies to: --kind git.\n',
    });
    const json = await orglensJson(dirs.next(), ['source', 'add', 'repo', '--kind', 'git', '--org-id', 'x']);
    expect(json.error).toEqual({
      code: 'USAGE',
      message: '--org-id does not apply to a source of kind "git".',
      hint: 'It applies to: --kind org, --kind sandbox.',
      details: {},
    });
  });

  it('rejects every option that belongs to another kind of source', async () => {
    const options: readonly (readonly [string, readonly string[]])[] = [
      ['--org-id', ['git']],
      ['--login-url', ['git']],
      ['--sandbox-of', ['org', 'git']],
      ['--sandbox-name', ['org', 'git']],
      ['--repo', ['org', 'sandbox']],
      ['--ref', ['org', 'sandbox']],
      ['--path', ['org', 'sandbox']],
      ['--tracks', ['org', 'sandbox']],
    ];
    const dir = await workspace();
    const before = config(dir);
    for (const [option, kinds] of options) {
      for (const kind of kinds) {
        const run = await orglens(dir, ['source', 'add', 'one', '--kind', kind, option, 'x']);
        expect(run, `${option} with --kind ${kind}`).toMatchObject({ code: 2, stdout: '' });
        expect(run.stderr).toContain(`${option} does not apply to a source of kind "${kind}".`);
      }
    }
    expect(config(dir)).toBe(before);
  });

  it('names every problem of a source that breaks a rule, with the key it belongs to', async () => {
    const dir = await workspace();
    const run = await orglens(dir, [
      'source',
      'add',
      's',
      '--kind',
      'org',
      '--org-id',
      'bad',
      '--login-url',
      'http://x',
    ]);
    expect(run.code).toBe(2);
    expect(run.stderr.split('\n')).toEqual([
      expect.stringMatching(/^error: org_id: "bad" is not an org id/) as string,
      '  login_url: A login URL starts with https:// and contains no spaces.',
      '',
    ]);
  });

  it('reports a source that breaks a rule, one that exists and one that does not', async () => {
    const dir = await workspace();
    await orglens(dir, ['source', 'add', 'prod', '--kind', 'org']);
    const text = config(dir);

    const invalid = await orglensJson(dir, ['source', 'add', 'Prod 2', '--kind', 'org']);
    expect(invalid).toMatchObject({ code: 2, ok: false, command: 'source add' });
    expect(invalid.error?.code).toBe('SOURCE_INVALID');
    expect((await orglensJson(dir, ['source', 'add', 'prod', '--kind', 'git'])).error?.code).toBe('SOURCE_EXISTS');
    const missing = await orglensJson(dir, ['source', 'remove', 'nobody']);
    expect(missing.code).toBe(2);
    expect(missing.error?.code).toBe('SOURCE_NOT_FOUND');
    expect(config(dir)).toBe(text);
  });

  it('needs a workspace', async () => {
    const run = await orglens(dirs.next(), ['source', 'list']);
    expect(run).toEqual({
      code: 2,
      stdout: '',
      stderr:
        'error: No orglens.toml in this folder or in a folder above it.\nhint: Create a workspace with: orglens init\n',
    });
  });
});

describe('orglens status', () => {
  it('shows the workspace, the database and the sources', async () => {
    const dir = await workspace();
    await orglens(dir, ['source', 'add', 'prod', '--kind', 'org']);
    const run = await orglens(join(dir, '.orglens'), ['status']);
    expect(run.code).toBe(0);
    expect(run.stdout.replace(/\d+ KiB/, 'N KiB')).toBe(
      [
        `Workspace  test (${dir})`,
        'Config     orglens.toml',
        'Database   .orglens/orglens.db, schema version 1, N KiB, node:sqlite',
        '',
        'SOURCE  KIND  SNAPSHOTS  LATEST SNAPSHOT',
        'prod    org   0          none',
        '',
      ].join('\n'),
    );

    const json = await orglensJson(dirs.next(), ['status', '--workspace', dir]);
    expect(json).toMatchObject({
      code: 0,
      command: 'status',
      ok: true,
      data: {
        root: dir,
        name: 'test',
        configFiles: ['orglens.toml'],
        store: { state: 'ready', schemaVersion: 1, driver: 'node:sqlite' },
        sources: [{ name: 'prod', kind: 'org', snapshots: 0, latestSnapshot: null }],
      },
    });
  });

  it('describes a database that is not there, and a workspace without sources', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n');
    const run = await orglens(dir, ['status'], { ORGLENS_SQLITE_DRIVER: 'better-sqlite3' });
    expect(run.code).toBe(0);
    const lines = run.stdout.split('\n');
    expect(lines[0]).toBe(`Workspace  ${dir}`);
    expect(lines[2]).toMatch(/^Database {3}\.orglens\/orglens\.db: missing\. \S/);
    expect(lines[4]).toBe('No sources are declared. Declare one with "orglens source add".');
  });

  it('lists every problem of an invalid configuration, and exits with 2', async () => {
    const dir = dirs.next();
    writeFileSync(
      join(dir, 'orglens.toml'),
      'schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "x"\nextra = 1\n[store]\n',
    );
    const run = await orglens(dir, ['status']);
    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    const lines = run.stderr.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^error: orglens\.toml:4:1: sources\.prod\.org_id: .* \(and 2 more\)$/);
    expect(lines[1]).toMatch(/^ {2}orglens\.toml:5:1: sources\.prod\.extra: /);
    expect(lines[2]).toMatch(/^ {2}orglens\.toml:6:1: store: /);

    const json = await orglensJson(dir, ['status']);
    expect(json.code).toBe(2);
    expect(json.error?.code).toBe('CONFIG_INVALID');
    expect(json.error?.details['diagnostics']).toHaveLength(3);
  });

  it('names an environment variable that holds a wrong value, without a position', async () => {
    const dir = await workspace();
    const env = { ORGLENS_SQLITE_DRIVER: 'sqlite9', OTHER: '1' };
    await orglens(dir, ['source', 'add', 'prod', '--kind', 'org']);
    writeFileSync(join(dir, 'orglens.toml'), `${config(dir)}surprise = 1\n`);
    const run = await orglens(dir, ['status'], env);
    expect(run.code).toBe(2);
    const lines = run.stderr.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '  environment: ORGLENS_SQLITE_DRIVER: "sqlite9" is not allowed here. Use one of "node:sqlite", "better-sqlite3".',
    );
  });
});

describe('orglens doctor', () => {
  it('reports every check and exits with 0 when none failed', async () => {
    const dir = await workspace();
    const run = await orglens(dir, ['doctor']);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    const lines = run.stdout.trimEnd().split('\n');
    expect(lines[0]).toMatch(/^OrgLens engine \d+\.\d+\.\d+/);
    expect(lines[2]).toMatch(/^STATUS +CHECK +FINDING$/);
    expect(lines.slice(3, 9).map((line) => line.split(/ +/).slice(0, 2))).toEqual([
      ['ok', 'node'],
      ['ok', 'sqlite'],
      ['ok', 'sqlite-fallback'],
      ['ok', 'workspace'],
      ['ok', 'config'],
      ['ok', 'store'],
    ]);
    expect(lines.at(-1)).toBe('OrgLens can run here.');
  });

  it('works without a workspace', async () => {
    const run = await orglens(dirs.next(), ['doctor']);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('skipped  workspace');
    const json = await orglensJson(dirs.next(), ['doctor']);
    expect(json).toMatchObject({ code: 0, command: 'doctor', ok: true, data: { ok: true } });
  });

  it('says how many checks deserve a look', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n');
    const run = await orglens(dir, ['doctor']);
    expect(run.code).toBe(0);
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe('OrgLens can run here. 1 check deserves a look.');
  });

  it('exits with 1 when a check failed, and still gives the whole report', async () => {
    const dir = dirs.next();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 7\n');
    const run = await orglens(dir, ['doctor']);
    expect(run.code).toBe(1);
    expect(run.stderr).toBe('');
    expect(run.stdout).toMatch(/\nfailed +config +1 problem in the configuration\. First: orglens\.toml:1:1: /);
    expect(run.stdout.trimEnd().split('\n').at(-1)).toBe('1 check failed.');

    const json = await orglensJson(dir, ['doctor']);
    expect(json).toMatchObject({ code: 1, ok: true, error: null, data: { ok: false } });
  });
});

describe('the --json contract', () => {
  it('reports what the argument parser rejects as an envelope', async () => {
    const dir = dirs.next();
    const unknown = await orglensJson(dir, ['statu']);
    expect(unknown).toMatchObject({ code: 2, command: null, ok: false, data: null });
    expect(unknown.error).toMatchObject({ code: 'USAGE', message: "unknown command 'statu'\n(Did you mean status?)" });
    expect((await orglensJson(dir, ['source', 'add', 'x'])).error?.message).toBe(
      "required option '--kind <kind>' not specified",
    );
    expect((await orglensJson(dir, ['source', 'add', 'x', '--kind', 'file'])).error?.code).toBe('USAGE');
    expect((await orglensJson(dir, ['source'])).error).toEqual({
      code: 'USAGE',
      message: 'The command is not complete.',
      hint: 'Add --help to see the commands.',
      details: {},
    });
  });

  it('writes the same rejection as text without --json', async () => {
    const run = await orglens(dirs.next(), ['source', 'remove']);
    expect(run).toEqual({ code: 2, stdout: '', stderr: "error: missing required argument 'name'\n" });
    const group = await orglens(dirs.next(), ['source']);
    expect(group.code).toBe(2);
    expect(group.stdout).toBe('');
    expect(group.stderr).toContain('Usage: orglens source');
  });

  it('accepts --json before and after the command, and not after "--"', async () => {
    const dir = await workspace();
    const before = await orglens(dir, ['--json', 'source', 'list']);
    expect(JSON.parse(before.stdout)).toMatchObject({ command: 'source list', ok: true });
    const literal = await orglens(dir, ['source', 'remove', '--', '--json']);
    expect(literal.stdout).toBe('');
    expect(literal.stderr).toMatch(/^error: /);
    // What the argument parser rejects is reported as text too: nothing asked for JSON.
    const rejected = await orglens(dir, ['source', 'remove', '--', '--json', 'more']);
    expect(rejected).toMatchObject({ code: 2, stdout: '' });
    expect(rejected.stderr).toMatch(/^error: too many arguments/);
  });

  it('has an exit code for every error code, and the schema lists the same codes', () => {
    const inSchema = (outputSchema['$defs'] as { error: { properties: { code: { enum: string[] } } } }).error.properties
      .code.enum;
    expect([...inSchema].sort()).toEqual([...Object.keys(ERROR_CODES), 'USAGE'].sort());
    expect(EXIT).toEqual({ ok: 0, failure: 1, usage: 2, gate: 3, connection: 4, partial: 5 });
  });

  it('ends with the documented exit code for every error code', () => {
    // The table of docs/cli.md, written out once more: what the user did wrong is 2, what failed is 1.
    const usage: readonly ErrorCode[] = [
      'KEY_INVALID',
      'CONFIG_INVALID',
      'CONFIG_NOT_EDITABLE',
      'WORKSPACE_NOT_FOUND',
      'WORKSPACE_EXISTS',
      'SOURCE_NOT_FOUND',
      'SOURCE_EXISTS',
      'SOURCE_INVALID',
      'SOURCE_IN_USE',
    ];
    const silent = createWriter({ stdout: () => undefined, stderr: () => undefined, cwd: '', env: {} }, true);
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      expect(silent.fail('status', new EngineError(code, 'x')), code).toBe(usage.includes(code) ? 2 : 1);
    }
    // A code this version does not know, from a newer copy of the engine, is a failure and never a success.
    const unknown = Object.assign(new EngineError('INTERNAL', 'x'), { code: 'NOT_YET_KNOWN' });
    expect(silent.fail('status', unknown)).toBe(1);
  });

  it('takes one answer to whether JSON was asked for, also when --json stands where a value is expected', async () => {
    const dir = await workspace();
    // The parser takes "--json" for the folder here. The answer is still JSON, because --json is on the line.
    const run = await orglens(dir, ['--workspace', '--json', 'status']);
    expect(run.stderr).toBe('');
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_FOUND' } });
    expect(run.code).toBe(2);
  });

  it('has a schema that refuses what the output never is', () => {
    const good = {
      schemaVersion: 1,
      command: 'source remove',
      ok: true,
      data: { removed: 'prod' },
      warnings: [],
      error: null,
    };
    expect(matchesSchema(good)).toBe(true);
    expect(matchesSchema({ ...good, extra: 1 })).toBe(false);
    expect(matchesSchema({ ...good, data: { removed: 'prod', more: 1 } })).toBe(false);
    expect(matchesSchema({ ...good, command: 'status' })).toBe(false);
    expect(matchesSchema({ ...good, ok: false })).toBe(false);
    expect(matchesSchema({ ...good, schemaVersion: 2 })).toBe(false);
    const withoutWarnings = Object.fromEntries(Object.entries(good).filter(([key]) => key !== 'warnings'));
    expect(matchesSchema(withoutWarnings)).toBe(false);
    const source = { name: 'prod', kind: 'org', description: null, orgId: null, loginUrl: null };
    const added = { ...good, command: 'source add', data: { source } };
    expect(matchesSchema(added)).toBe(true);
    expect(matchesSchema({ ...added, data: { source: { ...source, repo: '.' } } })).toBe(false);
    expect(matchesSchema({ ...added, data: { source: { ...source, kind: 'git' } } })).toBe(false);
  });
});

describe('text that comes from outside', () => {
  const ESCAPE = '\x1b';
  const CSI = String.fromCodePoint(0x9b);
  const OVERRIDE = String.fromCodePoint(0x202e);
  const hostile = `red ${ESCAPE}[31m and ${CSI}2J and ${OVERRIDE}`;

  function capture(json: boolean): { writer: ReturnType<typeof createWriter>; written: () => string } {
    let written = '';
    const add = (text: string): void => {
      written += text;
    };
    return { writer: createWriter({ stdout: add, stderr: add, cwd: '.', env: {} }, json), written: () => written };
  }

  it('cannot send control sequences to the terminal, in a result or in an error', () => {
    const result = capture(false);
    expect(result.writer.succeed('status', { data: null, lines: [hostile, 'next'] })).toBe(0);
    expect(result.written()).toBe('red \ufffd[31m and \ufffd2J and \ufffd\nnext\n');

    const failure = capture(false);
    expect(failure.writer.fail('status', new EngineError('STORE_FAILED', hostile, { hint: `${ESCAPE}c` }))).toBe(1);
    expect(failure.written()).toBe('error: red \ufffd[31m and \ufffd2J and \ufffd\nhint: \ufffdc\n');
  });

  it('keeps the value in JSON, written with escapes only', () => {
    const { writer, written } = capture(true);
    writer.succeed('status', { data: { text: hostile, separators: String.fromCodePoint(0x2028, 0x2029) }, lines: [] });
    for (const unsafe of [ESCAPE, CSI]) expect(written()).not.toContain(unsafe);
    expect(written()).toContain('red \\u001b[31m and \\u009b2J');
    expect(written()).toContain('\\u2028\\u2029');
    expect((JSON.parse(written()) as { data: { text: string } }).data.text).toBe(hostile);
  });

  it('keeps tabs, and replaces line feeds and the rest', () => {
    expect(printable(`a\tb\nc${ESCAPE}d\re${String.fromCodePoint(0x7f)}`)).toBe('a\tb\ufffdc\ufffdd\ufffde\ufffd');
  });

  it('cannot add lines of its own to the output', async () => {
    // A line of a result and a message of an error, each with a line feed in it.
    const forged = 'x\nerror: all is well\nhint: run this';
    const result = capture(false);
    result.writer.succeed('status', { data: null, lines: [forged, 'second line'] });
    expect(result.written().split('\n')).toEqual(['x\ufffderror: all is well\ufffdhint: run this', 'second line', '']);
    const failed = capture(false);
    failed.writer.fail('status', new EngineError('STORE_FAILED', forged, { hint: forged }));
    expect(failed.written().split('\n')).toHaveLength(3);

    // The same through a real file: a key with line feeds in its name.
    const dir = await workspace();
    writeFileSync(join(dir, 'orglens.toml'), 'schema_version = 1\n"a\\nerror: all is well\\nhint: run this" = 1\n');
    const run = await orglens(dir, ['status']);
    expect(run.code).toBe(2);
    expect(run.stderr.split('\n').filter((line) => /^(error|hint):/.test(line))).toHaveLength(1);
    // A folder with a line feed in its name is refused before it can be listed.
    writeFileSync(
      join(dir, 'orglens.toml'),
      'schema_version = 1\n[sources.repo]\nkind = "git"\npaths = ["a\\nerror: forged"]\n',
    );
    const list = await orglens(dir, ['source', 'list']);
    expect(list).toMatchObject({ code: 2, stdout: '' });
    expect(list.stderr.split('\n').filter((line) => line.startsWith('error:'))).toHaveLength(1);
  });

  it('never shows a credential that was pasted into the file', async () => {
    const dir = await workspace();
    // Made up, and assembled from pieces so that no scanner takes this file for a leak.
    const token = ['00D000000000001', '!', 'AQEAQ', 'z'.repeat(30)].join('');
    writeFileSync(join(dir, 'orglens.toml'), `schema_version = 1\n[sources.prod]\nkind = "org"\norg_id = "${token}"\n`);
    const text = await orglens(dir, ['status']);
    const json = await orglens(dir, ['status', '--json']);
    expect(text.code).toBe(2);
    expect(json.code).toBe(2);
    for (const output of [text.stderr, json.stdout]) {
      expect(output).toContain('looks like a credential');
      expect(output).not.toContain('AQEAQ');
    }
    const doctor = await orglens(dir, ['doctor', '--json']);
    expect(doctor.stdout).not.toContain('AQEAQ');
  });

  it('reports a failure that is not an engine error as a bug, with exit code 1', () => {
    const text = capture(false);
    expect(text.writer.fail(null, new TypeError('x is not a function'))).toBe(1);
    expect(text.written()).toBe('error: x is not a function\nhint: This is a bug in OrgLens. Please report it.\n');
    const json = capture(true);
    expect(json.writer.fail(null, 'thrown text')).toBe(1);
    const envelope: unknown = JSON.parse(json.written());
    expect(envelope).toMatchObject({ command: null, ok: false, error: { code: 'INTERNAL', message: 'thrown text' } });
    expect(matchesSchema(envelope)).toBe(true);
  });
});

describe('table', () => {
  it('pads every column but the last', () => {
    expect(
      table(
        ['A', 'LONGER', 'C'],
        [
          ['one', 'x', ''],
          ['2', 'yy', 'end'],
        ],
      ),
    ).toEqual(['A    LONGER  C', 'one  x', '2    yy      end']);
  });
});
