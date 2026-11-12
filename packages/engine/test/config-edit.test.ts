import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readConfig, type SourceDeclaration } from '../src/core/config/config.ts';
import { addSourceText, removeSourceText, verifyEdit } from '../src/core/config/edit.ts';
import { readLayout } from '../src/core/config/layout.ts';
import { EngineError } from '../src/core/errors.ts';

const example = readFileSync(new URL('./fixtures/config/orglens.toml', import.meta.url), 'utf8').replaceAll(
  '\r\n',
  '\n',
);

const names = (text: string): string[] => {
  const result = readConfig({ shared: text });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config.sources.map((source) => source.name);
};

const failure = (run: () => unknown): EngineError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    return error as EngineError;
  }
  throw new Error('Expected a failure.');
};

const org = (name: string, more: Partial<SourceDeclaration> = {}): SourceDeclaration =>
  ({ name, kind: 'org', description: null, orgId: null, loginUrl: null, ...more }) as SourceDeclaration;

describe('addSourceText', () => {
  it('appends a table and changes no other byte', () => {
    const { text, source } = addSourceText(example, {
      name: 'dev',
      kind: 'sandbox',
      description: 'Developer "pro" sandbox',
      orgId: '00D000000000003EAA',
      loginUrl: 'https://test.salesforce.com',
      sandboxOf: 'prod',
      sandboxName: 'dev',
    });
    expect(text.startsWith(example)).toBe(true);
    expect(text.slice(example.length)).toBe(
      [
        '',
        '[sources.dev]',
        'kind = "sandbox"',
        String.raw`description = "Developer \"pro\" sandbox"`,
        'org_id = "00D000000000003EAA"',
        'login_url = "https://test.salesforce.com"',
        'sandbox_of = "prod"',
        'sandbox_name = "dev"',
        '',
      ].join('\n'),
    );
    expect(names(text)).toEqual(['prod', 'uat', 'emea-repo', 'apac-repo', 'dev']);
    expect(source).toMatchObject({ name: 'dev', kind: 'sandbox', sandboxOf: 'prod' });
  });

  it('writes a repository with its list of folders, and leaves out what is not set', () => {
    const { text, source } = addSourceText('schema_version = 1\n', {
      name: 'repo',
      kind: 'git',
      description: null,
      repo: '.',
      ref: null,
      paths: ['orgs/emea/', 'orgs/common'],
      tracks: null,
    });
    expect(text).toBe('schema_version = 1\n\n[sources.repo]\nkind = "git"\npaths = ["orgs/emea/", "orgs/common"]\n');
    // A repository other than the default is written.
    expect(
      addSourceText('schema_version = 1\n', {
        name: 'other',
        kind: 'git',
        description: null,
        repo: '../other',
        ref: null,
        paths: null,
        tracks: null,
      }).text,
    ).toBe('schema_version = 1\n\n[sources.other]\nkind = "git"\nrepo = "../other"\n');
    // What comes back is the source as the file is read, with its paths normalised.
    expect(source).toMatchObject({ paths: ['orgs/emea', 'orgs/common'] });
  });

  it('keeps the line ends of the file, and ends a last line that has none', () => {
    const windows = addSourceText('schema_version = 1\r\n# sources follow', org('prod')).text;
    expect(windows).toBe('schema_version = 1\r\n# sources follow\r\n\r\n[sources.prod]\r\nkind = "org"\r\n');
    const unix = addSourceText('schema_version = 1\n\n', org('prod')).text;
    expect(unix).toBe('schema_version = 1\n\n[sources.prod]\nkind = "org"\n');
  });

  it('refuses a name that is taken', () => {
    const error = failure(() => addSourceText(example, org('uat')));
    expect(error.code).toBe('SOURCE_EXISTS');
    expect(error.hint).toContain('orglens source remove uat');
  });

  it.each([
    ['a name that is no source name', org('Prod'), /"Prod" is not a source name/],
    ['a name that would break out of its table', org('x]\n[workspace'), /is not a source name/],
    ['an org id of the wrong shape', org('dev', { orgId: '123' }), /is not an org id/],
    [
      'an org that is declared already',
      org('dev', { orgId: '00D000000000001' }),
      /This is the org of the source "prod"/,
    ],
    [
      'a sandbox of a source that does not exist',
      {
        name: 'dev',
        kind: 'sandbox',
        description: null,
        orgId: null,
        loginUrl: null,
        sandboxOf: 'nope',
        sandboxName: null,
      },
      /"nope" is not the name of a source of kind "org"/,
    ],
    [
      'a folder outside the repository',
      { name: 'r', kind: 'git', description: null, repo: '.', ref: null, paths: ['../x'], tracks: null },
      /must not contain "\.\."/,
    ],
    ['a description with a line break', org('dev', { description: 'a\nb' }), /control characters or line breaks/],
  ] as const)('refuses %s and says which rule it breaks', (_label, source, message) => {
    const error = failure(() => addSourceText(example, source));
    expect(error.code).toBe('SOURCE_INVALID');
    expect(error.message).toMatch(message);
  });

  it('names every broken rule in the details, by key', () => {
    const error = failure(() => addSourceText(example, org('dev', { orgId: 'x', loginUrl: 'http://x.example' })));
    const loginUrl = 'A login URL starts with https:// and contains no spaces.';
    expect(error.details).toEqual({
      problems: [
        {
          key: 'org_id',
          message: expect.stringContaining('is not an org id') as string,
          text: expect.stringMatching(/^org_id: "x" is not an org id/) as string,
        },
        { key: 'login_url', message: loginUrl, text: `login_url: ${loginUrl}` },
      ],
    });
    // The message names the key, so that it says which option was wrong.
    expect(error.message).toMatch(/^org_id: "x" is not an org id/);
  });

  it('reports a character a value cannot hold as a problem of the source, not of the file', () => {
    // The delete character is the one control character JSON writes as it is.
    const error = failure(() => addSourceText(example, org('dev', { description: 'a\x7fb' })));
    expect(error).toMatchObject({
      code: 'SOURCE_INVALID',
      message: 'description: This must not contain control characters or line breaks.',
    });
  });

  it('does not edit a file that has problems of its own', () => {
    const error = failure(() => addSourceText('schema_version = 2\n', org('prod')));
    expect(error.code).toBe('CONFIG_INVALID');
    expect(error.details).toMatchObject({ diagnostics: [{ file: 'orglens.toml', line: 1, path: 'schema_version' }] });
  });

  it('refuses a file whose sources are one inline table', () => {
    const error = failure(() =>
      addSourceText('schema_version = 1\nsources = { prod = { kind = "org" } }\n', org('dev')),
    );
    expect(error.code).toBe('CONFIG_NOT_EDITABLE');
  });
});

describe('removeSourceText', () => {
  it('removes the table of the source and keeps every other line', () => {
    const text = removeSourceText(example, 'apac-repo');
    expect(names(text)).toEqual(['prod', 'uat', 'emea-repo']);
    expect(text).toBe(
      example.replace('[sources.apac-repo]\nkind = "git"\npaths = ["orgs/apac/core", "orgs/apac/extra"]\n', ''),
    );
    // A comment above the table is not part of it, and stays.
    expect(text).toContain('# The APAC folders, read from the working tree.');
  });

  it('removes a table in the middle, with its list over several lines, and leaves one blank line', () => {
    const withoutTracker = example.replace('tracks = "prod"\n', '');
    const text = removeSourceText(removeSourceText(withoutTracker, 'uat'), 'emea-repo');
    expect(names(text)).toEqual(['prod', 'apac-repo']);
    expect(text).toContain(
      'login_url = "https://login.salesforce.com"\n\n# The APAC folders, read from the working tree.\n[sources.apac-repo]\n',
    );
    for (const comment of example.split('\n').filter((line) => line.startsWith('#'))) expect(text).toContain(comment);
    expect(text).toContain('# a production or developer org');
  });

  it('removes the comments between the keys of the source, and keeps the comment above a table', () => {
    const text = [
      'schema_version = 1',
      '',
      '[sources.a]',
      'kind = "org"',
      '# about the description',
      'description = "A"',
      '',
      '# about b',
      '[sources.b]',
      'kind = "org"',
      '',
    ].join('\n');
    expect(removeSourceText(text, 'a')).toBe(
      ['schema_version = 1', '', '# about b', '[sources.b]', 'kind = "org"', ''].join('\n'),
    );
    expect(removeSourceText(text, 'b')).toBe(
      [
        'schema_version = 1',
        '',
        '[sources.a]',
        'kind = "org"',
        '# about the description',
        'description = "A"',
        '',
        '# about b',
        '',
      ].join('\n'),
    );
  });

  it('keeps Windows line ends', () => {
    const text = 'schema_version = 1\r\n\r\n[sources.a]\r\nkind = "org"\r\n\r\n[sources.b]\r\nkind = "org"\r\n';
    expect(removeSourceText(text, 'a')).toBe('schema_version = 1\r\n\r\n[sources.b]\r\nkind = "org"\r\n');
    // The last table of the file: this is the layout "source add" writes.
    expect(removeSourceText(text, 'b')).toBe('schema_version = 1\r\n\r\n[sources.a]\r\nkind = "org"\r\n');
    expect(removeSourceText(removeSourceText(text, 'b'), 'a')).toBe('schema_version = 1\r\n');
  });

  it('removes the last table of a file with and without a line end at its end', () => {
    const text = 'schema_version = 1\n\n[sources.a]\nkind = "org"\n\n[sources.b]\nkind = "org"';
    expect(removeSourceText(text, 'b')).toBe('schema_version = 1\n\n[sources.a]\nkind = "org"\n');
    expect(removeSourceText(`${text}\n`, 'b')).toBe('schema_version = 1\n\n[sources.a]\nkind = "org"\n');
    expect(removeSourceText(`${text}\n\n\n`, 'b')).toBe('schema_version = 1\n\n[sources.a]\nkind = "org"\n\n\n');
  });

  it('removes a long text to its last line, also when that line looks like a comment', () => {
    const text = [
      'schema_version = 1',
      '',
      '[sources.a]',
      'kind = "org"',
      'description = """x \\',
      '# y"""',
      '# a comment after the table',
      '',
      '[sources.b]',
      'kind = "org"',
      '',
    ].join('\n');
    expect(names(text)).toEqual(['a', 'b']);
    expect(removeSourceText(text, 'a')).toBe(
      ['schema_version = 1', '', '# a comment after the table', '', '[sources.b]', 'kind = "org"', ''].join('\n'),
    );
  });

  it('is not fooled by a header inside a multi-line string', () => {
    const text = [
      'schema_version = 1',
      '[sources.a]',
      'kind = "org"',
      'description = """',
      '[sources.b]',
      'still the description"""',
      '[sources.b]',
      'kind = "org"',
      '',
    ].join('\n');
    // The description holds a line break, which the rules refuse, so the file is not edited at all.
    expect(failure(() => removeSourceText(text, 'b')).code).toBe('CONFIG_INVALID');
    expect(readLayout(text).blocks.map((block) => [block.path.join('.'), block.startLine, block.endLine])).toEqual([
      ['sources.a', 2, 6],
      ['sources.b', 7, 9],
    ]);
  });

  it('refuses a source that is not declared', () => {
    const error = failure(() => removeSourceText(example, 'nope'));
    expect(error.code).toBe('SOURCE_NOT_FOUND');
    expect(error.hint).toBe('Declared sources: prod, uat, emea-repo, apac-repo.');
    expect(failure(() => removeSourceText('schema_version = 1\n', 'nope')).hint).toBe('No source is declared yet.');
  });

  it('refuses a source that another one refers to, and names the others', () => {
    const error = failure(() => removeSourceText(example, 'prod'));
    expect(error.code).toBe('SOURCE_IN_USE');
    expect(error.message).toBe('The source "prod" is referred to by: uat, emea-repo.');
    expect(error.details).toEqual({ usedBy: ['uat', 'emea-repo'] });
  });

  it.each([
    ['dotted keys', 'schema_version = 1\nsources.a.kind = "org"\n'],
    ['an inline table', 'schema_version = 1\n[sources]\na = { kind = "org" }\n'],
  ])('refuses a source written as %s, and changes nothing', (_label, text) => {
    expect(failure(() => removeSourceText(text, 'a')).code).toBe('CONFIG_NOT_EDITABLE');
  });
});

describe('verifyEdit', () => {
  const before = readConfig({ shared: example });
  if (!before.ok) throw new Error('The example must be valid.');
  const config = before.config;
  const refused = (changed: string, expected: readonly SourceDeclaration[]): string =>
    failure(() => verifyEdit(changed, config, expected, 'uat')).code;

  it('accepts a text that declares exactly the expected sources', () => {
    expect(verifyEdit(example, config, config.sources, 'uat').sources).toEqual(config.sources);
  });

  it('refuses a text that lost or gained a source, changed one, reordered them or is no longer valid', () => {
    const [prod, uat, ...repos] = config.sources;
    if (prod === undefined || uat === undefined) throw new Error('The example declares prod and uat first.');
    expect(refused(example, [prod, ...repos])).toBe('CONFIG_NOT_EDITABLE');
    expect(refused(example, [...config.sources, org('extra')])).toBe('CONFIG_NOT_EDITABLE');
    expect(refused(example, [uat, prod, ...repos])).toBe('CONFIG_NOT_EDITABLE');
    expect(refused(example.replace('EMEA production', 'changed'), config.sources)).toBe('CONFIG_NOT_EDITABLE');
    expect(refused(`${example}\n[broken`, config.sources)).toBe('CONFIG_NOT_EDITABLE');
  });

  it('refuses a text in which the name of the workspace changed', () => {
    expect(refused(example.replace('acme-salesforce', 'other'), config.sources)).toBe('CONFIG_NOT_EDITABLE');
  });
});

describe('readLayout', () => {
  it('finds keys, tables and quoted names', () => {
    const layout = readLayout(['a = 1', '  [t."x y".z]  # comment', '  k.m = "v"', '[[list]]', 'n = 2'].join('\n'));
    expect(layout.positionOf(['a'])).toEqual({ line: 1, column: 1 });
    expect(layout.positionOf(['t', 'x y', 'z'])).toEqual({ line: 2, column: 3 });
    expect(layout.positionOf(['t', 'x y'])).toEqual({ line: 2, column: 3 });
    expect(layout.positionOf(['t', 'x y', 'z', 'k', 'm'])).toEqual({ line: 3, column: 3 });
    expect(layout.positionOf(['t', 'x y', 'z', 'k', 'm', 4])).toEqual({ line: 3, column: 3 });
    expect(layout.positionOf(['list', 'n'])).toEqual({ line: 5, column: 1 });
    expect(layout.positionOf(['unknown'])).toEqual({ line: 1, column: 1 });
    expect(layout.blocks.map((block) => block.arrayOfTables)).toEqual([false, true]);
    expect(layout.keys.map((key) => key.join('.'))).toEqual(['a', 't.x y.z.k.m', 'list.n']);
  });

  it('does not take lines inside a list, an inline table or a long string for keys', () => {
    const layout = readLayout(
      [
        'list = [',
        '  "[not.a.table]",',
        '  "x = 1", # ]',
        ']',
        'inline = { a = 1,',
        '  b = "}" }',
        "text = '''",
        'k = 1',
        "'''",
        'basic = """ one "" two \\"""',
        'k2 = 2',
        '"""',
        'real = 3',
      ].join('\n'),
    );
    expect(layout.keys.map((key) => key.join('.'))).toEqual(['list', 'inline', 'text', 'basic', 'real']);
    expect(layout.blocks).toEqual([]);
  });

  it('reads brackets and quotes in a literal string and in a comment as text', () => {
    const layout = readLayout(
      ["a = 'it [ is \" text' # and [ this { is a comment", 'b = 1 # """', "c = '#' # [", '[t]', 'd = 2'].join('\n'),
    );
    expect(layout.keys.map((key) => key.join('.'))).toEqual(['a', 'b', 'c', 't.d']);
    expect(layout.blocks.map((block) => block.startLine)).toEqual([4]);
  });

  it('counts the backslashes before the quotes that could end a long string', () => {
    // Two backslashes are an escaped backslash: the quotes after them end the string.
    const ended = readLayout(['a = """x\\\\"""', '[t]', 'b = 1'].join('\n'));
    expect(ended.blocks.map((block) => block.path.join('.'))).toEqual(['t']);
    // Three are an escaped backslash and an escaped quote: the string goes on.
    const open = readLayout(['a = """x\\\\\\"""', '[t]', '"""', 'b = 1'].join('\n'));
    expect(open.blocks).toEqual([]);
    expect(open.keys.map((key) => key.join('.'))).toEqual(['a', 'b']);
  });

  it('knows the last line of the content of a table', () => {
    const layout = readLayout(
      [
        '[a]',
        'k = [',
        '  1,',
        ']',
        '# after',
        '',
        '[b]',
        '# only a comment',
        '[c]',
        'text = """',
        '# inside',
        '"""',
      ].join('\n'),
    );
    expect(layout.blocks.map((block) => [block.startLine, block.contentEndLine, block.endLine])).toEqual([
      [1, 4, 6],
      [7, 7, 8],
      [9, 12, 12],
    ]);
  });
});
