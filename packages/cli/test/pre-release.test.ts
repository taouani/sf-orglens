/**
 * The steps of the workflow "Pre-release" that need no network (`scripts/pre-release.mjs`): what `check`
 * accepts and refuses, and the form `page` gives release notes for the page of a release. The steps `pack` and
 * `try` are run by the workflow only.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/pre-release.mjs', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const version = manifest.version;

function run(...args: string[]): { status: number | null; out: string; failures: string[] } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const failures = result.stderr.split('\n').filter((line) => line.startsWith('FAIL '));
  return { status: result.status, out: result.stdout.replaceAll('\r\n', '\n'), failures };
}

let scratch: string;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'orglens-pre-release-'));
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function page(name: string, text: string): ReturnType<typeof run> {
  const file = join(scratch, name);
  writeFileSync(file, text);
  return run('page', file);
}

describe('the check of a request for a pre-release', () => {
  it('finds the change logs and the release notes of the version the packages have', () => {
    // A changeset may wait between two pre-releases. Everything else is in order at every commit.
    const { failures } = run('check', version, 'false', 'refs/heads/any');
    expect(failures.filter((line) => !/^FAIL \d+ changeset\(s\) wait /.test(line))).toEqual([]);
  });

  it('refuses a version without a pre-release part, and a version the packages do not have', () => {
    const plain = run('check', '1.0.0', 'false', 'refs/heads/main');
    expect(plain.status).toBe(1);
    expect(plain.failures).toContain('FAIL "1.0.0" is not a pre-release version such as 0.1.0-next.0.');

    const other = run('check', '9.9.9-next.9', 'false', 'refs/heads/main');
    expect(other.status).toBe(1);
    expect(other.failures).toContain(`FAIL sf-orglens is at version ${version}, not 9.9.9-next.9.`);
    expect(other.failures).toContain('FAIL packages/cli/CHANGELOG.md has no section "## 9.9.9-next.9".');
    expect(other.failures.some((line) => line.startsWith('FAIL docs/releases/v9.9.9-next.9.md is missing'))).toBe(true);
  });

  it('refuses to publish from another branch than main', () => {
    const { status, failures } = run('check', version, 'true', 'refs/heads/other');
    expect(status).toBe(1);
    expect(failures).toContain(
      'FAIL A pre-release is published from the branch main only, and this run is on refs/heads/other.',
    );
  });

  it('refuses an answer about publishing that is neither true nor false', () => {
    const { status, failures } = run('check', version, 'True', 'refs/heads/main');
    expect(status).toBe(1);
    expect(failures).toContain('FAIL "True" is neither "true" nor "false".');
  });
});

describe('release notes on the page of a release', () => {
  it('joins the lines of a paragraph and of an item, and keeps code, headings and tables', () => {
    const notes = [
      '# The title',
      '',
      'A paragraph',
      'of two lines.',
      '',
      '## A heading',
      '',
      '- An item',
      '  of two lines.',
      '  - A nested item',
      '    of two lines.',
      '1. A numbered item',
      '   of two lines.',
      '',
      '```sh',
      'one line',
      'another line',
      '```',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'The last paragraph.',
      '',
    ].join('\n');
    const { status, out } = page('notes.md', notes);
    expect(status).toBe(0);
    expect(out).toBe(
      [
        'A paragraph of two lines.',
        '',
        '## A heading',
        '',
        '- An item of two lines.',
        '  - A nested item of two lines.',
        '1. A numbered item of two lines.',
        '',
        '```sh',
        'one line',
        'another line',
        '```',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        'The last paragraph.',
        '',
      ].join('\n'),
    );
  });

  it('keeps the words of the release notes of this version, and the line that installs it', () => {
    const file = fileURLToPath(new URL(`../../../docs/releases/v${version}.md`, import.meta.url));
    const words = (text: string): string[] => text.split(/\s+/).filter((word) => word !== '');
    const written = readFileSync(file, 'utf8');
    const { status, out } = run('page', file);
    expect(status).toBe(0);
    // Everything but the title, which GitHub shows itself.
    expect(words(out)).toEqual(words(written.slice(written.indexOf('\n'))));
    expect(out.split('\n').filter((line) => line.startsWith('npm install --global '))).toHaveLength(1);
  });

  it.each([
    ['a code block between tildes', '~~~\ncode\n~~~\n'],
    ['a list with "+"', '+ an item\n'],
    ['the definition of a link by reference', 'See [the page][1].\n\n[1]: https://example.com\n'],
    ['a line break forced with two spaces or a backslash', 'A line  \nand the next.\n'],
    ['a rule or an underline that has no empty line on both sides', 'A heading\n=========\n'],
    ['a rule or an underline that has no empty line on both sides', 'Text.\n\n---\nMore text.\n'],
    ['a line indented by four spaces after an empty line', 'Text.\n\n    code\n'],
    ['a table without a pipe at the start of its rows', 'A | B\n--- | ---\n1 | 2\n'],
  ])('refuses %s', (form, notes) => {
    const { status, failures } = page('refused.md', `# The title\n\n${notes}`);
    expect(status).toBe(1);
    expect(failures.some((line) => line.includes(form))).toBe(true);
  });

  it('accepts a rule between empty lines, and an indented line inside a code block', () => {
    const { status, out } = page('accepted.md', '# The title\n\nText.\n\n---\n\n```\n\n    code  \n```\n');
    expect(status).toBe(0);
    expect(out).toBe('Text.\n\n---\n\n```\n\n    code  \n```\n');
  });
});
