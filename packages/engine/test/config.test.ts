import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDiagnostic, readConfig, type ConfigDiagnostic, type ConfigInput } from '../src/core/config/config.ts';

const example = readFileSync(new URL('./fixtures/config/orglens.toml', import.meta.url), 'utf8').replaceAll(
  '\r\n',
  '\n',
);

const diagnosticsOf = (input: ConfigInput): readonly ConfigDiagnostic[] => {
  const result = readConfig(input);
  return result.ok ? [] : result.diagnostics;
};

/** The example with one piece of text replaced. The piece must be there, or the test is wrong. */
const changed = (from: string, to: string): string => {
  expect(example, `the example contains ${from}`).toContain(from);
  return example.replace(from, to);
};

describe('readConfig', () => {
  it('reads the example file', () => {
    const result = readConfig({ shared: example });
    expect(result).toEqual({
      ok: true,
      config: {
        name: 'acme-salesforce',
        sources: [
          {
            name: 'prod',
            kind: 'org',
            description: 'EMEA production',
            orgId: '00D000000000001EAA',
            loginUrl: 'https://login.salesforce.com',
          },
          {
            name: 'uat',
            kind: 'sandbox',
            description: 'UAT full-copy sandbox',
            orgId: '00D000000000002EAA',
            loginUrl: null,
            sandboxOf: 'prod',
            sandboxName: 'uat',
          },
          {
            name: 'emea-repo',
            kind: 'git',
            description: 'EMEA folders of the monorepo',
            repo: '.',
            ref: 'main',
            paths: ['orgs/emea/main', 'orgs/emea/shared', 'orgs/common'],
            tracks: 'prod',
          },
          {
            name: 'apac-repo',
            kind: 'git',
            description: null,
            repo: '.',
            ref: null,
            paths: ['orgs/apac/core', 'orgs/apac/extra'],
            tracks: null,
          },
        ],
        store: { driver: 'node:sqlite', driverSetBy: 'default' },
        logins: {},
        unusedLogins: [],
      },
    });
  });

  it('reads the smallest file there is', () => {
    expect(readConfig({ shared: 'schema_version = 1\n' })).toEqual({
      ok: true,
      config: {
        name: null,
        sources: [],
        store: { driver: 'node:sqlite', driverSetBy: 'default' },
        logins: {},
        unusedLogins: [],
      },
    });
  });

  it('reads a file with Windows line ends', () => {
    const result = readConfig({ shared: example.replaceAll('\n', '\r\n') });
    expect(result.ok).toBe(true);
  });

  it('normalises what can be written in two ways', () => {
    const result = readConfig({
      shared: 'schema_version = 1\n[sources.r]\nkind = "git"\nrepo = "../other/"\npaths = ["a/b/", "c"]\n',
    });
    expect(result.ok && result.config.sources[0]).toMatchObject({ repo: '../other', paths: ['a/b', 'c'] });
  });

  // Each case: what is wrong, the file, the key and position the message must name, and a piece of the message.
  const invalid: readonly (readonly [label: string, text: string, at: string, message: RegExp])[] = [
    [
      'a key with a typing mistake',
      changed('name = "acme-salesforce"', 'nmae = "acme"'),
      '7:1: workspace.nmae',
      /Unknown key "nmae"\. Known keys: name\./,
    ],
    [
      'an unknown table',
      `${example}\n[snapshots]\nkeep_last = 10\n`,
      '42:1: snapshots',
      /Unknown key "snapshots"\. Known keys: schema_version, workspace, sources\./,
    ],
    [
      'a key that would hold a credential',
      changed('kind = "org"', 'kind = "org"\npassword = "x"'),
      '14:1: sources.prod.password',
      /Unknown key "password"/,
    ],
    [
      'no schema version',
      example.replace('schema_version = 1\n', ''),
      '1:1: schema_version',
      /needs the line schema_version = 1 before its first table/,
    ],
    [
      'a newer schema version',
      changed('schema_version = 1', 'schema_version = 2'),
      '4:1: schema_version',
      /reads schema_version 1 only\. The file says 2\./,
    ],
    [
      'a schema version as text',
      changed('schema_version = 1', 'schema_version = "1"'),
      '4:1: schema_version',
      /The file says "1"\./,
    ],
    [
      'a workspace name that is not text',
      changed('name = "acme-salesforce"', 'name = 7'),
      '7:1: workspace.name',
      /must be text in quotes/,
    ],
    [
      'an empty workspace name',
      changed('name = "acme-salesforce"', 'name = " "'),
      '7:1: workspace.name',
      /1 to 64 characters/,
    ],
    [
      'a workspace that is not a table',
      example.replace(/\[workspace\]\nname = .*\n/, 'workspace = "acme"\n'),
      '6:1: workspace',
      /must be a table/,
    ],
    [
      'a source name in upper case',
      changed('[sources.uat]', '[sources.UAT]'),
      '18:1: sources.UAT',
      /"UAT" is not a source name/,
    ],
    [
      'a source name that is too long',
      changed('[sources.uat]', `[sources.${'u'.repeat(33)}]`),
      `18:1: sources.${'u'.repeat(33)}`,
      /not a source name/,
    ],
    [
      'a source without a kind',
      changed('kind = "sandbox"\n', ''),
      '18:1: sources.uat.kind',
      /A source needs a kind\. Use one of "org", "sandbox", "git"\./,
    ],
    [
      'an unknown kind',
      changed('kind = "sandbox"', 'kind = "scratch"'),
      '19:1: sources.uat.kind',
      /"scratch" is not allowed here/,
    ],
    [
      'an org id of the wrong shape',
      changed('00D000000000001EAA', '001000000000001EAA'),
      '15:1: sources.prod.org_id',
      /is not an org id/,
    ],
    [
      'an org id of the wrong length',
      changed('00D000000000001EAA', '00D000000000001E'),
      '15:1: sources.prod.org_id',
      /15 or 18 letters and digits/,
    ],
    [
      'the same org twice',
      changed('00D000000000002EAA', '00D000000000001'),
      '21:1: sources.uat.org_id',
      /This is the org of the source "prod"/,
    ],
    [
      'a login URL without TLS',
      changed('https://login.salesforce.com', 'http://login.salesforce.com'),
      '16:1: sources.prod.login_url',
      /starts with https:\/\//,
    ],
    [
      'a login URL that is no URL',
      changed('https://login.salesforce.com', 'login.salesforce.com'),
      '16:1: sources.prod.login_url',
      /starts with https:\/\//,
    ],
    [
      'a login URL with spaces around it',
      changed('https://login.salesforce.com', ' https://login.salesforce.com '),
      '16:1: sources.prod.login_url',
      /starts with https:\/\/ and contains no spaces/,
    ],
    [
      'a login URL without the two slashes',
      changed('https://login.salesforce.com', 'https:login.salesforce.com'),
      '16:1: sources.prod.login_url',
      /starts with https:\/\//,
    ],
    [
      'a login URL with an empty query',
      changed('https://login.salesforce.com', 'https://login.salesforce.com/?'),
      '16:1: sources.prod.login_url',
      /no user name, no query and no fragment/,
    ],
    [
      'a login URL with an empty fragment',
      changed('https://login.salesforce.com', 'https://login.salesforce.com/#'),
      '16:1: sources.prod.login_url',
      /no user name, no query and no fragment/,
    ],
    [
      'a folder with a line break in its name',
      changed('"orgs/common"', '"orgs/common\\nerror: forged"'),
      '30:1: sources.emea-repo.paths[2]',
      /must not contain control characters or line breaks/,
    ],
    [
      'a repository that goes up and comes back down',
      changed('repo = "."', 'repo = "../a/../b"'),
      '28:1: sources.emea-repo.repo',
      /must not contain "\.\."/,
    ],
    [
      'a login URL with a query',
      changed('https://login.salesforce.com', 'https://login.salesforce.com/?un=someone'),
      '16:1: sources.prod.login_url',
      /no user name, no query and no fragment/,
    ],
    [
      'a sandbox of a source that does not exist',
      changed('sandbox_of = "prod"', 'sandbox_of = "production"'),
      '22:1: sources.uat.sandbox_of',
      /"production" is not the name of a source of kind "org"/,
    ],
    [
      'a sandbox of a repository',
      changed('sandbox_of = "prod"', 'sandbox_of = "emea-repo"'),
      '22:1: sources.uat.sandbox_of',
      /not the name of a source of kind "org"/,
    ],
    [
      'a sandbox key on an org',
      changed('description = "EMEA production"', 'sandbox_of = "uat"'),
      '14:1: sources.prod.sandbox_of',
      /Unknown key "sandbox_of"\. Known keys: kind, description, org_id, login_url\./,
    ],
    [
      'a sandbox name with punctuation',
      changed('sandbox_name = "uat"', 'sandbox_name = "uat-2"'),
      '23:1: sources.uat.sandbox_name',
      /1 to 10 letters and digits/,
    ],
    [
      'an org key on a repository',
      changed('ref = "main"', 'org_id = "00D000000000003EAA"'),
      '29:1: sources.emea-repo.org_id',
      /Unknown key "org_id"\. Known keys: kind, description, repo, ref, paths, tracks\./,
    ],
    [
      'an absolute repository path',
      changed('repo = "."', 'repo = "/srv/repo"'),
      '28:1: sources.emea-repo.repo',
      /relative, not absolute\. The repository is "\." or a path relative to the workspace\./,
    ],
    [
      'a repository path with a drive letter',
      changed('repo = "."', 'repo = "C:/repo"'),
      '28:1: sources.emea-repo.repo',
      /relative, not absolute/,
    ],
    [
      'a repository path that leaves and returns',
      changed('repo = "."', 'repo = "a/../b"'),
      '28:1: sources.emea-repo.repo',
      /must not contain "\.\."/,
    ],
    [
      'a ref that would be read as an option',
      changed('ref = "main"', 'ref = "--upload-pack=x"'),
      '29:1: sources.emea-repo.ref',
      /is not a branch, tag or commit/,
    ],
    [
      'a ref with a space',
      changed('ref = "main"', 'ref = "my branch"'),
      '29:1: sources.emea-repo.ref',
      /is not a branch, tag or commit/,
    ],
    [
      'paths that are not a list',
      changed('paths = ["orgs/apac/core", "orgs/apac/extra"]', 'paths = "orgs/apac"'),
      '40:1: sources.apac-repo.paths',
      /a list with at least one folder/,
    ],
    [
      'an empty list of paths',
      changed('paths = ["orgs/apac/core", "orgs/apac/extra"]', 'paths = []'),
      '40:1: sources.apac-repo.paths',
      /a list with at least one folder/,
    ],
    [
      'an absolute path',
      changed('"orgs/common"', '"/etc/orgs"'),
      '30:1: sources.emea-repo.paths[2]',
      /relative, not absolute/,
    ],
    [
      'a path that leaves the repository',
      changed('"orgs/common"', '"../other"'),
      '30:1: sources.emea-repo.paths[2]',
      /must not contain "\.\."/,
    ],
    [
      'a path with a backslash',
      changed('"orgs/common"', String.raw`"orgs\\common"`),
      '30:1: sources.emea-repo.paths[2]',
      /forward slashes/,
    ],
    [
      'a path from the home folder',
      changed('"orgs/common"', '"~/orgs"'),
      '30:1: sources.emea-repo.paths[2]',
      /"~" is not expanded/,
    ],
    [
      'a path that is a number',
      changed('"orgs/common"', '7'),
      '30:1: sources.emea-repo.paths[2]',
      /A path is text in quotes/,
    ],
    [
      'the same path twice, in another case',
      changed('"orgs/common"', '"Orgs/EMEA/main"'),
      '30:1: sources.emea-repo.paths[2]',
      /is the same folder as "orgs\/emea\/main"/,
    ],
    [
      'a path inside another',
      changed('"orgs/common"', '"orgs/emea/main/default"'),
      '30:1: sources.emea-repo.paths[2]',
      /one lies inside the other/,
    ],
    [
      'a path around another',
      changed('"orgs/common"', '"orgs"'),
      '30:1: sources.emea-repo.paths[2]',
      /one lies inside the other/,
    ],
    [
      'a repository that tracks nothing known',
      changed('tracks = "prod"', 'tracks = "live"'),
      '35:1: sources.emea-repo.tracks',
      /"live" is not the name of an org or sandbox source/,
    ],
    [
      'a repository that tracks a repository',
      changed('tracks = "prod"', 'tracks = "apac-repo"'),
      '35:1: sources.emea-repo.tracks',
      /not the name of an org or sandbox source/,
    ],
    [
      'a description that is too long',
      changed('"EMEA production"', `"${'x'.repeat(201)}"`),
      '14:1: sources.prod.description',
      /at most 200 characters/,
    ],
    [
      'a description with a line break',
      changed('"EMEA production"', String.raw`"EMEA\nproduction"`),
      '14:1: sources.prod.description',
      /control characters or line breaks/,
    ],
    [
      'a description that is a date',
      changed('"EMEA production"', '2026-11-12'),
      '14:1: sources.prod.description',
      /must be text in quotes/,
    ],
    ['sources that are not a table', 'schema_version = 1\nsources = ["prod"]\n', '2:1: sources', /must be a table/],
    [
      'a source that is not a table',
      'schema_version = 1\n[sources]\nprod = "org"\n',
      '3:1: sources.prod',
      /must be a table/,
    ],
  ];

  it.each(invalid)('refuses %s', (_label, text, at, message) => {
    const diagnostics = diagnosticsOf({ shared: text });
    expect(diagnostics.map(formatDiagnostic)).toHaveLength(1);
    const [first] = diagnostics;
    if (first === undefined) throw new Error('no diagnostic');
    const line = formatDiagnostic(first);
    expect(line.startsWith(`orglens.toml:${at}: `), line).toBe(true);
    expect(line).toMatch(message);
  });

  it('refuses a login URL with a user name twice: as a credential, and as more than the address of the login page', () => {
    const text = changed('https://login.salesforce.com', 'https://someone@login.salesforce.com');
    const lines = diagnosticsOf({ shared: text }).map(formatDiagnostic);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^orglens\.toml:16:1: sources\.prod\.login_url: This value looks like a credential/);
    expect(lines[1]).toMatch(/^orglens\.toml:16:1: sources\.prod\.login_url: .*no user name, no query and no fragment/);
  });

  it('has more than twenty cases of an invalid file, as the plan asks', () => {
    expect(invalid.length).toBeGreaterThanOrEqual(40);
  });

  // Made-up values, assembled from pieces so that no scanner takes this file for a leak.
  const secrets: readonly (readonly [string, string])[] = [
    ['a session id', ['00D000000000001', '!', 'AQEAQ', 'x'.repeat(30)].join('')],
    ['a private key', ['-----BEGIN', ' PRIVATE KEY-----', 'TUlJRXZRSUJBREFOQmdrcWhraUc5'].join('')],
    [
      'a Salesforce CLI auth URL',
      ['force', '://', 'PlatformCLI::', '5Aep861', 'x'.repeat(30), '@acme.my.salesforce.example'].join(''),
    ],
    ['a refresh token', ['5Aep', '861', 'q'.repeat(40)].join('')],
    ['a URL with a password', ['https://', 'someone', ':', 'made-up', '@git.example/o/r.git'].join('')],
  ];

  it.each(secrets)('refuses %s as a value, under any key', (_label, secret) => {
    const diagnostics = diagnosticsOf({ shared: changed('"EMEA production"', JSON.stringify(secret)) });
    expect(diagnostics.map(formatDiagnostic)).toEqual([
      'orglens.toml:14:1: sources.prod.description: This value looks like a credential. A configuration file must never hold one.',
    ]);
    // The value itself is never repeated in a message.
    expect(JSON.stringify(diagnostics)).not.toContain(secret.slice(0, 12));
    const inList = diagnosticsOf({ shared: changed('"orgs/common"', JSON.stringify(secret)) });
    expect(inList.some((one) => one.path === 'sources.emea-repo.paths[2]' && one.message.includes('credential'))).toBe(
      true,
    );
  });

  it('does not take a sentence about passwords for a credential', () => {
    expect(readConfig({ shared: changed('"EMEA production"', '"password: ask the admin team"') }).ok).toBe(true);
    expect(
      readConfig({ shared: changed('"EMEA production"', '"Owned by the token bearer infrastructure-team"') }).ok,
    ).toBe(true);
  });

  it.each(secrets)('never repeats %s in a message, whatever key it was pasted under', (label, secret) => {
    // Of a URL only the user and the password are secret. The host may be shown.
    const tail = label === 'a URL with a password' ? 'made-up' : secret.slice(-12);
    const quoted = JSON.stringify(secret);
    const texts = [
      changed('"00D000000000001EAA"', quoted),
      changed('kind = "org"', `kind = ${quoted}`),
      changed('ref = "main"', `ref = ${quoted}`),
      changed('tracks = "prod"', `tracks = ${quoted}`),
      changed('sandbox_of = "prod"', `sandbox_of = ${quoted}`),
      changed('[sources.prod]', `[sources.${quoted}]`),
      changed('description = "EMEA production"', `${quoted} = 1`),
    ];
    for (const shared of texts) {
      const diagnostics = diagnosticsOf({ shared });
      expect(diagnostics.length).toBeGreaterThan(0);
      const written = JSON.stringify([diagnostics, diagnostics.map(formatDiagnostic)]);
      expect(written).not.toContain(tail);
      expect(written).not.toContain(secret.slice(0, 20));
    }
    const fromEnvironment = diagnosticsOf({ shared: example, env: { ORGLENS_SQLITE_DRIVER: secret } });
    expect(JSON.stringify(fromEnvironment)).not.toContain(tail);
  });

  it('accepts a repository above the workspace or next to it', () => {
    for (const repo of ['..', '../', '../..', '../other', '../../group/other/']) {
      const result = readConfig({ shared: changed('repo = "."', `repo = "${repo}"`) });
      expect(result.ok, repo).toBe(true);
    }
    const sources = readConfig({ shared: changed('repo = "."', 'repo = "../"') });
    expect(sources.ok && sources.config.sources.find((source) => source.name === 'emea-repo')).toMatchObject({
      repo: '..',
    });
  });

  it('reports a syntax error with its line and column, and nothing else', () => {
    const diagnostics = diagnosticsOf({ shared: changed('[sources.uat]', '[sources.uat') });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ file: 'orglens.toml', line: 18, path: '' });
    expect(diagnostics[0]?.message).toMatch(/^This is not valid TOML: /);
    expect(diagnostics[0]?.message).not.toContain('\n');
  });

  it('reports a source that is declared twice as a syntax error of the second one', () => {
    const diagnostics = diagnosticsOf({ shared: `${example}\n[sources.prod]\nkind = "org"\n` });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ file: 'orglens.toml', line: 42, path: '' });
  });

  it('reports all problems of a file together, in the order of the checks', () => {
    const text = changed('kind = "sandbox"', 'kind = "sandbox"\ncolour = "red"')
      .replace('00D000000000001EAA', 'x')
      .replace('ref = "main"', 'ref = "a b"');
    expect(diagnosticsOf({ shared: text }).map((one) => one.path)).toEqual([
      'sources.prod.org_id',
      'sources.uat.colour',
      'sources.emea-repo.ref',
    ]);
  });

  describe('the local file and the environment', () => {
    const shared = 'schema_version = 1\n';

    it('takes the driver from the local file, and from the environment before that', () => {
      const local = '[store]\ndriver = "better-sqlite3"\n';
      expect(readConfig({ shared, local })).toMatchObject({
        config: { store: { driver: 'better-sqlite3', driverSetBy: 'local' } },
      });
      expect(readConfig({ shared, local, env: { ORGLENS_SQLITE_DRIVER: 'node:sqlite' } })).toMatchObject({
        config: { store: { driver: 'node:sqlite', driverSetBy: 'environment' } },
      });
      expect(readConfig({ shared, env: { ORGLENS_SQLITE_DRIVER: 'better-sqlite3', OTHER: 'x' } })).toMatchObject({
        config: { store: { driver: 'better-sqlite3', driverSetBy: 'environment' } },
      });
      expect(readConfig({ shared, local: '', env: { ORGLENS_SQLITE_DRIVER: '' } })).toMatchObject({
        config: { store: { driver: 'node:sqlite', driverSetBy: 'default' } },
      });
    });

    it.each([
      [
        'an unknown driver',
        '[store]\ndriver = "sqlite3"\n',
        '.orglens/local.toml:2:1: store.driver: "sqlite3" is not allowed here. Use one of "node:sqlite", "better-sqlite3".',
      ],
      [
        'an unknown key',
        '[store]\npath = "/tmp/x.db"\n',
        '.orglens/local.toml:2:1: store.path: Unknown key "path". Known keys: driver.',
      ],
    ])('refuses %s in the local file', (_label, local, expected) => {
      expect(diagnosticsOf({ shared, local }).map(formatDiagnostic)).toEqual([expected]);
    });

    describe('the login of a source', () => {
      const sources =
        'schema_version = 1\n[sources.prod]\nkind = "org"\n[sources.uat]\nkind = "sandbox"\n[sources.repo]\nkind = "git"\n';
      const read = (local: string): string[] => diagnosticsOf({ shared: sources, local }).map(formatDiagnostic);

      it('is read for an org and a sandbox, by alias or by user name', () => {
        const local = '[sources.prod]\nlogin = "acme prod"\n\n[sources.uat]\nlogin = "zoe@example.com"\n';
        expect(readConfig({ shared: sources, local })).toMatchObject({
          ok: true,
          config: { logins: { prod: 'acme prod', uat: 'zoe@example.com' } },
        });
        expect(readConfig({ shared: sources, local: '[sources.prod]\n' })).toMatchObject({ config: { logins: {} } });
        expect(readConfig({ shared: sources, local: 'sources.prod.login = "a"\n' })).toMatchObject({
          config: { logins: { prod: 'a' } },
        });
      });

      it('is kept and not used for a source the shared file does not declare', () => {
        // The shared file is changed by others. A source that a colleague removed must not break every command.
        const local = '[sources.prod]\nlogin = "main"\n\n[sources.gone]\nlogin = "old"\n\n[sources.left]\n';
        expect(readConfig({ shared: sources, local })).toMatchObject({
          ok: true,
          config: { logins: { prod: 'main' }, unusedLogins: ['gone'] },
        });
        expect(read('[sources.gone]\nlogin = ""\n')).toEqual([
          '.orglens/local.toml:2:1: sources.gone.login: A login is the alias or the user name of a Salesforce CLI login.',
        ]);
      });

      it.each([
        [
          'a repository',
          '[sources.repo]\nlogin = "main"\n',
          '.orglens/local.toml:2:1: sources.repo.login: A source of kind "git" has no login. Remove this key.',
        ],
        [
          'a key of the shared file',
          '[sources.prod]\nkind = "org"\n',
          '.orglens/local.toml:2:1: sources.prod.kind: Unknown key "kind". Known keys: login.',
        ],
        [
          'a login that is empty',
          '[sources.prod]\nlogin = ""\n',
          '.orglens/local.toml:2:1: sources.prod.login: A login is the alias or the user name of a Salesforce CLI login.',
        ],
        [
          'a login with a blank at its end',
          '[sources.prod]\nlogin = "main "\n',
          '.orglens/local.toml:2:1: sources.prod.login: A login is the alias or the user name of a Salesforce CLI login.',
        ],
        [
          'a login that is not text',
          '[sources.prod]\nlogin = 7\n',
          '.orglens/local.toml:2:1: sources.prod.login: This must be text in quotes.',
        ],
        [
          'a name no source can have',
          '[sources.Prod]\nlogin = "main"\n',
          '.orglens/local.toml:1:1: sources.Prod: "Prod" cannot be the name of a source. Remove this table, or correct the name.',
        ],
        ['sources that are not tables', 'sources = 1\n', '.orglens/local.toml:1:1: sources: This must be a table.'],
      ])('is refused for %s', (_label, local, expected) => {
        expect(read(local)).toEqual([expected]);
      });

      it('is refused when it holds what looks like a credential', () => {
        const local =
          '[sources.prod]\nlogin = "force://PlatformCLI::5Aep861abcdefghijklmnopqrstuvwxyz@acme.my.salesforce.com"\n';
        const diagnostics = read(local);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain('sources.prod.login');
        expect(diagnostics[0]).not.toContain('5Aep861');
      });

      it('is not held against a shared file that has problems of its own', () => {
        const broken = sources.replace('kind = "org"', 'kind = "organisation"');
        const diagnostics = diagnosticsOf({ shared: broken, local: '[sources.prod]\nlogin = "main"\n' });
        expect(diagnostics.map((one) => one.file)).toEqual(['orglens.toml']);
      });
    });

    it('refuses a local file that is not valid TOML', () => {
      const diagnostics = diagnosticsOf({ shared, local: '[store\n' });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ file: '.orglens/local.toml', line: 1, path: '' });
    });

    it('refuses an unknown driver in the environment, and says where it comes from', () => {
      expect(diagnosticsOf({ shared, env: { ORGLENS_SQLITE_DRIVER: 'fast' } }).map(formatDiagnostic)).toEqual([
        'environment: ORGLENS_SQLITE_DRIVER: "fast" is not allowed here. Use one of "node:sqlite", "better-sqlite3".',
      ]);
    });

    it('reports the problems of both files together', () => {
      const diagnostics = diagnosticsOf({ shared: 'schema_version = 3\n', local: 'x = 1\n' });
      expect(diagnostics.map((one) => one.file)).toEqual(['orglens.toml', '.orglens/local.toml']);
    });
  });
});
