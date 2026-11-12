/**
 * Changes to `orglens.toml` and to `.orglens/local.toml` made by commands.
 *
 * A file belongs to its authors: it has comments, an order and a layout
 * they chose. So it is never written back from parsed data. A source is
 * added by appending lines, and removed by deleting the lines of its table.
 * The login of a source is set by changing or adding one line of the
 * personal file. Every other line stays byte for byte as it was.
 *
 * Each change is checked before it is returned: the new text is read again,
 * and the sources it declares must be exactly the old ones plus or minus the
 * one that was asked for. A file written in a form this module does not
 * handle (a source as an inline table, or as dotted keys) is refused with
 * `CONFIG_NOT_EDITABLE`, never changed on a guess.
 *
 * These functions work on text. Reading and writing the file is the
 * caller's part.
 */
import { EngineError } from '../errors.ts';
import { hasSecretShape } from '../redact.ts';
import {
  diagnosticsJson,
  LOCAL_CONFIG_FILE,
  readConfig,
  SHARED_CONFIG_FILE,
  SOURCE_NAME,
  type SourceDeclaration,
  type WorkspaceConfig,
} from './config.ts';
import { readLayout } from './layout.ts';

/** Reads the configuration the edit starts from. A file with problems is not edited. */
function readCurrent(text: string): WorkspaceConfig {
  const current = readConfig({ shared: text });
  if (current.ok) return current.config;
  throw new EngineError('CONFIG_INVALID', `${SHARED_CONFIG_FILE} has problems. Fix them before changing the sources.`, {
    details: { diagnostics: diagnosticsJson(current.diagnostics) },
  });
}

const notEditable = (name: string): EngineError =>
  new EngineError(
    'CONFIG_NOT_EDITABLE',
    `The source "${name}" is written in ${SHARED_CONFIG_FILE} in a form OrgLens does not change.`,
    { hint: `Edit ${SHARED_CONFIG_FILE} by hand. OrgLens changes sources written as a [sources.${name}] table.` },
  );

const sameSources = (a: readonly SourceDeclaration[], b: readonly SourceDeclaration[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * The check after every edit: the changed text must be a valid configuration that declares exactly the expected
 * sources, in their order, under the same workspace name. If the reading of the layout was wrong in any way, the
 * edit ends here and nothing is written.
 */
export function verifyEdit(
  changed: string,
  before: WorkspaceConfig,
  expected: readonly SourceDeclaration[],
  name: string,
): WorkspaceConfig {
  const after = readConfig({ shared: changed });
  if (!after.ok || !sameSources(after.config.sources, expected) || after.config.name !== before.name) {
    throw notEditable(name);
  }
  return after.config;
}

/** The keys of a source in the order they are written, with the values that are set. */
function entries(source: SourceDeclaration): [string, string | readonly string[]][] {
  const all: [string, string | readonly string[] | null][] =
    source.kind === 'git'
      ? [
          ['kind', source.kind],
          ['description', source.description],
          // "." is the default and is not written.
          ['repo', source.repo === '.' ? null : source.repo],
          ['ref', source.ref],
          ['paths', source.paths],
          ['tracks', source.tracks],
        ]
      : [
          ['kind', source.kind],
          ['description', source.description],
          ['org_id', source.orgId],
          ['login_url', source.loginUrl],
          ...(source.kind === 'sandbox'
            ? ([
                ['sandbox_of', source.sandboxOf],
                ['sandbox_name', source.sandboxName],
              ] as [string, string | null][])
            : []),
        ];
  return all.filter((entry): entry is [string, string | readonly string[]] => entry[1] !== null);
}

// A JSON string is a valid TOML basic string: the same quotes and the same escapes. The one difference is the
// delete character, which JSON writes as it is and TOML does not allow.
const tomlString = (value: string): string => JSON.stringify(value).replaceAll('\u007f', '\\u007F');

function renderSource(source: SourceDeclaration): string[] {
  return [
    `[sources.${source.name}]`,
    ...entries(source).map(
      ([key, value]) =>
        `${key} = ${typeof value === 'string' ? tomlString(value) : `[${value.map(tomlString).join(', ')}]`}`,
    ),
  ];
}

/**
 * Returns the text of `orglens.toml` with one more source at its end.
 *
 * Fails with `SOURCE_EXISTS` if the name is taken, and with `SOURCE_INVALID`
 * if the declaration breaks a rule, with the rules it breaks in the details.
 */
export function addSourceText(text: string, source: SourceDeclaration): { text: string; source: SourceDeclaration } {
  const before = readCurrent(text);
  if (!SOURCE_NAME.test(source.name)) {
    throw new EngineError(
      'SOURCE_INVALID',
      `"${source.name}" is not a source name. A source name starts with a lower-case letter and has up to 32 lower-case letters, digits and hyphens.`,
    );
  }
  if (before.sources.some((other) => other.name === source.name)) {
    throw new EngineError('SOURCE_EXISTS', `A source named "${source.name}" is already declared.`, {
      hint: `Choose another name, or remove it first with: orglens source remove ${source.name}`,
    });
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let head = text;
  if (head !== '' && !head.endsWith('\n')) head += eol;
  if (head !== '' && !/\n[ \t]*\r?\n$/.test(head)) head += eol;
  const changed = `${head}${renderSource(source).join(eol)}${eol}`;

  const after = readConfig({ shared: changed });
  if (!after.ok) {
    // The file was fine before, so every problem is one of the new source, or of the form of the file.
    const own = after.diagnostics.filter((one) => one.path.startsWith(`sources.${source.name}`));
    if (own.length === 0) throw notEditable(source.name);
    const problems = own.map((one) => {
      const key = one.path.slice(`sources.${source.name}.`.length);
      return { key, message: one.message, text: key === '' ? one.message : `${key}: ${one.message}` };
    });
    throw new EngineError('SOURCE_INVALID', problems[0]?.text ?? 'The source is not valid.', {
      details: { problems },
    });
  }
  const added = after.config.sources.at(-1);
  if (added?.name !== source.name) throw notEditable(source.name);
  verifyEdit(changed, before, [...before.sources, added], source.name);
  return { text: changed, source: added };
}

const isBlank = (line: string): boolean => line.trim() === '';

/**
 * The text without the lines of one table. `undefined` if no table header
 * with this path is in the text.
 *
 * Comments and blank lines after the last value of the table are kept: they
 * usually introduce what follows.
 */
function withoutTable(text: string, path: readonly string[]): string | undefined {
  const lines = text.split('\n');
  const remove = new Set<number>();
  for (const block of readLayout(text).blocks) {
    if (block.path.length !== path.length || block.path.some((part, index) => part !== path[index])) continue;
    // The table ends with its last value. The layout knows that line: a line of a long text can look like a
    // comment, and a comment after the table is not part of it.
    const last = block.contentEndLine;
    for (let line = block.startLine; line <= last; line += 1) remove.add(line);
    // Where a blank line stood before the table and one follows it, the two would now meet. The one before the
    // table is dropped. The one after it can be the end of the file, and that has to keep its line end.
    const blankBefore = block.startLine > 1 && isBlank(lines[block.startLine - 2] ?? '');
    const blankAfter = last < lines.length && isBlank(lines[last] ?? '');
    if (blankBefore && blankAfter) remove.add(block.startLine - 1);
  }
  if (remove.size === 0) return undefined;
  return lines.filter((_line, index) => !remove.has(index + 1)).join('\n');
}

/**
 * Returns the text of `orglens.toml` without the table of one source.
 *
 * Comments and blank lines after the last value of the table are kept: they
 * usually introduce what follows. Fails with `SOURCE_NOT_FOUND`, with
 * `SOURCE_IN_USE` if another source names this one, and with
 * `CONFIG_NOT_EDITABLE` if the source is not written as a table of its own.
 */
export function removeSourceText(text: string, name: string): string {
  const before = readCurrent(text);
  if (!before.sources.some((source) => source.name === name)) {
    const declared = before.sources.map((source) => source.name);
    throw new EngineError('SOURCE_NOT_FOUND', `No source named "${name}" is declared.`, {
      hint: declared.length === 0 ? 'No source is declared yet.' : `Declared sources: ${declared.join(', ')}.`,
    });
  }
  const users = before.sources
    .filter(
      (source) =>
        (source.kind === 'sandbox' && source.sandboxOf === name) || (source.kind === 'git' && source.tracks === name),
    )
    .map((source) => source.name);
  if (users.length > 0) {
    throw new EngineError('SOURCE_IN_USE', `The source "${name}" is referred to by: ${users.join(', ')}.`, {
      hint: `Remove or change ${users.length === 1 ? 'that source' : 'those sources'} first.`,
      details: { usedBy: users },
    });
  }

  const changed = withoutTable(text, ['sources', name]);
  if (changed === undefined) throw notEditable(name);

  verifyEdit(
    changed,
    before,
    before.sources.filter((source) => source.name !== name),
    name,
  );
  return changed;
}

const LOCAL_TEMPLATE = `# ${LOCAL_CONFIG_FILE}: the personal settings of this OrgLens workspace. This file is not committed.
# It never holds a password, a token or a key.
`;

const localNotEditable = (name: string): EngineError =>
  new EngineError(
    'CONFIG_NOT_EDITABLE',
    `The login of the source "${name}" is written in ${LOCAL_CONFIG_FILE} in a form OrgLens does not change.`,
    {
      hint: `Edit ${LOCAL_CONFIG_FILE} by hand. OrgLens changes a login written as the key "login" of a [sources.${name}] table.`,
    },
  );

/** Reads both files as they are before the personal file is changed. Files with problems are not edited. */
function readBoth(shared: string, local: string | undefined): WorkspaceConfig {
  const current = readConfig({ shared, local });
  if (current.ok) return current.config;
  throw new EngineError('CONFIG_INVALID', 'The configuration has problems. Fix them before changing a login.', {
    details: { diagnostics: diagnosticsJson(current.diagnostics) },
  });
}

const sameLogins = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean => {
  const sorted = (logins: Readonly<Record<string, string>>): string =>
    JSON.stringify(Object.entries(logins).sort(([one], [other]) => (one < other ? -1 : 1)));
  return sorted(a) === sorted(b);
};

/** The check after every edit of the personal file: it is valid, and the logins are exactly the expected ones. */
function verifyLocalEdit(
  shared: string,
  changed: string,
  before: WorkspaceConfig,
  expected: Readonly<Record<string, string>>,
  name: string,
): void {
  const after = readConfig({ shared, local: changed });
  if (!after.ok || !sameLogins(after.config.logins, expected) || after.config.store.driver !== before.store.driver) {
    throw localNotEditable(name);
  }
}

// The value of a key on one line: text in double or in single quotes, and what follows it.
const LOGIN_LINE = /^([ \t]*login[ \t]*=[ \t]*)(?:"(?:[^"\\]|\\.)*"|'[^']*')(.*)$/;

/**
 * Returns the text of `.orglens/local.toml` with the Salesforce CLI login
 * of one source set. `local` is the present text of the file, or
 * `undefined` if there is none yet.
 *
 * Fails with `SOURCE_NOT_FOUND`, with `SOURCE_INVALID` for a source of the
 * kind `git` or a login that cannot be one, and with `CONFIG_NOT_EDITABLE`
 * if the login is written in a form this module does not change.
 */
export function linkLoginText(shared: string, local: string | undefined, name: string, login: string): string {
  const before = readBoth(shared, local);
  const source = before.sources.find((one) => one.name === name);
  if (source === undefined) {
    const declared = before.sources.map((one) => one.name);
    throw new EngineError('SOURCE_NOT_FOUND', `No source named "${name}" is declared.`, {
      hint: declared.length === 0 ? 'No source is declared yet.' : `Declared sources: ${declared.join(', ')}.`,
      details: { source: name },
    });
  }
  if (source.kind === 'git') {
    throw new EngineError('SOURCE_INVALID', `The source "${name}" is of the kind "git" and has no login.`, {
      details: { source: name, problems: [] },
    });
  }
  // eslint-disable-next-line no-control-regex -- control characters are what this expression is for
  if (login === '' || login !== login.trim() || login.length > 255 || /[\u0000-\u001f\u007f]/.test(login)) {
    throw new EngineError('SOURCE_INVALID', 'A login is the alias or the user name of a Salesforce CLI login.', {
      details: { source: name, problems: [] },
    });
  }
  if (hasSecretShape(login)) {
    throw new EngineError('SOURCE_INVALID', 'This value looks like a credential. A login is an alias or a user name.', {
      details: { source: name, problems: [] },
    });
  }

  const text = local ?? LOCAL_TEMPLATE;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const line = `login = ${tomlString(login)}`;
  const layout = readLayout(text);
  const blocks = layout.blocks.filter(
    (block) => block.path.length === 2 && block.path[0] === 'sources' && block.path[1] === name,
  );
  const lines = text.split('\n');
  let changed: string;
  if (blocks.length === 0) {
    // A login that is set without a table of its own is written with dotted keys or as an inline table.
    if (before.logins[name] !== undefined) throw localNotEditable(name);
    let head = text;
    if (head !== '' && !head.endsWith('\n')) head += eol;
    if (head !== '' && !/\n[ \t]*\r?\n$/.test(head)) head += eol;
    changed = `${head}[sources.${name}]${eol}${line}${eol}`;
  } else {
    const block = blocks[0];
    if (blocks.length > 1 || block === undefined || block.arrayOfTables) throw localNotEditable(name);
    const written = layout.keys.some(
      (key) => key.length === 3 && key[0] === 'sources' && key[1] === name && key[2] === 'login',
    );
    if (written) {
      const at = layout.positionOf(['sources', name, 'login']).line - 1;
      const present = lines[at] ?? '';
      const carriage = present.endsWith('\r') ? '\r' : '';
      const match = LOGIN_LINE.exec(carriage === '' ? present : present.slice(0, -1));
      if (match === null) throw localNotEditable(name);
      lines[at] = `${match[1] ?? ''}${tomlString(login)}${match[2] ?? ''}${carriage}`;
    } else {
      const header = lines[block.startLine - 1] ?? '';
      lines.splice(block.startLine, 0, `${line}${header.endsWith('\r') ? '\r' : ''}`);
    }
    changed = lines.join('\n');
  }

  verifyLocalEdit(shared, changed, before, { ...before.logins, [name]: login }, name);
  return changed;
}

/**
 * Returns the text of `.orglens/local.toml` without the table of one
 * source, or the text as it is if the file has no such table.
 */
export function unlinkLoginText(shared: string, local: string, name: string): string {
  const before = readBoth(shared, local);
  const changed = withoutTable(local, ['sources', name]);
  if (changed === undefined) {
    if (before.logins[name] !== undefined) throw localNotEditable(name);
    return local;
  }
  const expected = Object.fromEntries(Object.entries(before.logins).filter(([source]) => source !== name));
  verifyLocalEdit(shared, changed, before, expected, name);
  return changed;
}
