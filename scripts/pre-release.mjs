/*
 * The steps of the workflow "Pre-release" that need more than a line of shell (decision records 0050 and 0053).
 *
 *   node scripts/pre-release.mjs check <version> <publish> <ref>
 *       Holds a request for a pre-release against the repository, before anything is built. It fails when
 *       the version is not a pre-release version, when a package has another version or does not name this
 *       repository as npm needs it for trusted publishing, when the change log of a package has no section for
 *       the version, when a changeset is waiting, when docs/releases/v<version>.md is missing, does not hold the
 *       line that installs this version or is written in a form `page` cannot keep, or when <publish> is "true"
 *       and <ref> is not the branch main or the release notes still hold the mark "[open]".
 *
 *   node scripts/pre-release.mjs pack <version> <folder>
 *       Packs the two packages into <folder>, and writes SHA256SUMS and notes.md next to them: the release
 *       notes of the repository as GitHub shows them, followed by the checksums. Run `pnpm run build` first.
 *
 *   node scripts/pre-release.mjs page <file>
 *       Prints a file of release notes in the form the page of a release needs. A test holds it.
 *
 *   node scripts/pre-release.mjs try <version> <folder>
 *   node scripts/pre-release.mjs try <version> npm
 *       Installs the version with the line of its release notes, into the global folder of npm, and runs the
 *       binary. With a folder, the line is given a registry on this machine that holds the two packed files of
 *       that folder and sends every other question on to the registry of npm, so the line is tried before
 *       anything is public. With "npm", the line is run as the notes hold it. The libraries the packages need
 *       come from the registry of npm in both cases.
 *
 * No step publishes anything: the workflow does that, with the files `pack` wrote. `check`, `pack` and `page`
 * need no network.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/taouani/sf-orglens';
const PACKAGES = [
  { folder: 'engine', name: '@sf-orglens/engine', tarball: 'sf-orglens-engine' },
  { folder: 'cli', name: 'sf-orglens', tarball: 'sf-orglens' },
];
/** The public registry of npm. A question the stand-in of `try` cannot answer is sent on to it. */
const REGISTRY = 'https://registry.npmjs.org';
/** A version with a pre-release part, such as 0.1.0-next.0. A version without one is not released from here. */
const PRE_RELEASE = /^\d+\.\d+\.\d+-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*$/;
/** Release notes that hold this mark say that something is still to be answered. They are not published. */
const OPEN_MARK = '[open]';

const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
const tarballOf = (pkg, version) => `${pkg.tarball}-${version}.tgz`;
const notesFile = (version) => `docs/releases/v${version}.md`;

/**
 * The one line that installs a version. It names the command line by its exact version, which in turn names the
 * engine by the same exact version: `pnpm pack` writes it in the place of `workspace:*`.
 */
function installLine(version) {
  return `npm install --global ${PACKAGES[1].name}@${version}`;
}

/**
 * The forms of Markdown that `forReleasePage` would damage, each with its line. Release notes are written
 * without them: paragraphs, headings with `#`, lists with `-`, `*` or a number, code blocks between back-ticks
 * and tables with a pipe at the start of each row. A quote of several lines keeps its line breaks.
 */
function formsNotKept(text) {
  const found = [];
  const lines = text.split('\n');
  let inCode = false;
  lines.forEach((line, index) => {
    const say = (what) => found.push(`line ${String(index + 1)}: ${what}`);
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode;
      return;
    }
    if (inCode || line.trim() === '') return;
    const before = index === 0 ? '' : lines[index - 1].trim();
    const after = index === lines.length - 1 ? '' : lines[index + 1].trim();
    const item = /^\s*([-*] |\d+\. )/.test(line);
    if (line.trimStart().startsWith('~~~')) say('a code block between tildes');
    if (/^\s*\+ /.test(line)) say('a list with "+"');
    if (/^\s*\[[^\]]+\]:\s/.test(line)) say('the definition of a link by reference');
    if (/( {2}|\\)$/.test(line)) say('a line break forced with two spaces or a backslash');
    if (/^\s*(=+|-{3,}|\*{3,}|_{3,})\s*$/.test(line) && (before !== '' || after !== '')) {
      say('a rule or an underline that has no empty line on both sides');
    }
    if (/^( {4}|\t)/.test(line) && before === '' && !item) say('a line indented by four spaces after an empty line');
    if (/^\s*:?-+:?\s*(\|\s*:?-+:?\s*)+$/.test(line)) say('a table without a pipe at the start of its rows');
  });
  return found;
}

/**
 * The release notes in the form the page of a release needs. GitHub shows the title of a release itself, and
 * breaks a line there wherever the text has a line break. So the first heading is left out, and the lines of a
 * paragraph or of an item of a list are joined. Code blocks, headings and tables are kept as they are. What
 * `formsNotKept` names is not handled, and `check` refuses notes that hold it.
 */
function forReleasePage(text) {
  const out = [];
  let inCode = false;
  let joinable = false;
  for (const line of text.split('\n')) {
    const fence = line.trimStart().startsWith('```');
    const starts = /^\s*([-*] |\d+\. |#|\||>)/.test(line);
    if (!inCode && !fence && !starts && line.trim() !== '' && joinable) {
      out[out.length - 1] += ` ${line.trim()}`;
    } else {
      out.push(line);
      joinable = !inCode && !fence && line.trim() !== '' && !/^\s*(#|\|)/.test(line);
    }
    if (fence) inCode = !inCode;
  }
  const first = out.findIndex((line) => line.trim() !== '');
  if (first !== -1 && out[first].startsWith('# ')) out.splice(0, first + 1);
  return out.join('\n').trim();
}

function usage() {
  console.error(
    'Usage: node scripts/pre-release.mjs check <version> <publish> <ref>\n' +
      '       node scripts/pre-release.mjs pack <version> <folder>\n' +
      '       node scripts/pre-release.mjs page <file>\n' +
      '       node scripts/pre-release.mjs try <version> <folder>|npm',
  );
  process.exit(2);
}

function check(version, publish, ref) {
  const problems = [];
  if (!PRE_RELEASE.test(version)) {
    problems.push(`"${version}" is not a pre-release version such as 0.1.0-next.0.`);
  }
  if (publish !== 'true' && publish !== 'false') problems.push(`"${publish}" is neither "true" nor "false".`);
  if (publish === 'true' && ref !== 'refs/heads/main') {
    problems.push(`A pre-release is published from the branch main only, and this run is on ${ref}.`);
  }
  for (const pkg of PACKAGES) {
    const manifest = JSON.parse(read(`packages/${pkg.folder}/package.json`));
    if (manifest.name !== pkg.name) problems.push(`packages/${pkg.folder} is named ${String(manifest.name)}.`);
    if (manifest.version !== version) {
      problems.push(`${pkg.name} is at version ${String(manifest.version)}, not ${version}.`);
    }
    // npm holds the repository a package names against the repository of the workflow that publishes it.
    if (manifest.repository?.url !== `git+${REPOSITORY}.git`) {
      problems.push(`packages/${pkg.folder}/package.json does not name git+${REPOSITORY}.git as its repository.`);
    }
    const changeLog = `packages/${pkg.folder}/CHANGELOG.md`;
    if (!existsSync(join(root, changeLog)) || !read(changeLog).split('\n').includes(`## ${version}`)) {
      problems.push(`${changeLog} has no section "## ${version}".`);
    }
  }
  // A changeset that waits was merged after the version was set: its change would be released without an entry
  // in a change log and under a version that another build already has.
  const waiting = readdirSync(join(root, '.changeset')).filter((name) => name.endsWith('.md') && name !== 'README.md');
  if (waiting.length > 0) {
    problems.push(
      `${String(waiting.length)} changeset(s) wait in .changeset (${waiting.join(', ')}). ` +
        'Run `pnpm changeset version` first: the next pre-release has a version of its own.',
    );
  }
  if (!existsSync(join(root, notesFile(version)))) {
    problems.push(`${notesFile(version)} is missing: every pre-release has release notes that were reviewed.`);
  } else {
    const notes = read(notesFile(version));
    if (!notes.split('\n').includes(installLine(version))) {
      problems.push(`${notesFile(version)} does not hold this line of its own:\n  ${installLine(version)}`);
    }
    for (const form of formsNotKept(notes)) {
      problems.push(`${notesFile(version)}, ${form}. The page of a release would not show it as written.`);
    }
    if (publish === 'true' && notes.includes(OPEN_MARK)) {
      problems.push(`${notesFile(version)} still holds the mark "${OPEN_MARK}": something in it waits for an answer.`);
    }
  }
  if (problems.length > 0) {
    for (const text of problems) console.error(`FAIL ${text}`);
    process.exit(1);
  }
  const what = publish === 'true' ? 'can be published' : 'can be packed. Nothing will be published';
  console.log(`Version ${version} ${what}.`);
}

function pack(version, folder) {
  const out = resolve(folder);
  mkdirSync(out, { recursive: true });
  if (readdirSync(out).length > 0) {
    console.error(`FAIL ${out} is not empty.`);
    process.exit(1);
  }
  for (const pkg of PACKAGES) {
    // pnpm is a .cmd shim on Windows and needs a shell to start.
    const result = spawnSync('pnpm', ['pack', '--pack-destination', out], {
      cwd: join(root, 'packages', pkg.folder),
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
      console.error(`${result.stdout}${result.stderr}`);
      console.error(`FAIL pnpm pack of ${pkg.name} ended with ${String(result.status)}.`);
      process.exit(1);
    }
  }
  const expected = PACKAGES.map((pkg) => tarballOf(pkg, version)).sort();
  const packed = readdirSync(out).sort();
  if (packed.join(' ') !== expected.join(' ')) {
    console.error(`FAIL Expected ${expected.join(' and ')}, and found ${packed.join(', ')}.`);
    process.exit(1);
  }
  // The format of `sha256sum`, so that `sha256sum --check SHA256SUMS` reads it.
  const sums = expected
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(join(out, name)))
          .digest('hex')}  ${name}\n`,
    )
    .join('');
  writeFileSync(join(out, 'SHA256SUMS'), sums);
  const notes = forReleasePage(read(notesFile(version)));
  writeFileSync(
    join(out, 'notes.md'),
    `${notes}\n\n## Checksums\n\nThe SHA-256 of the two attached packages, as in the attached file \`SHA256SUMS\`:\n\n` +
      `\`\`\`\n${sums}\`\`\`\n`,
  );
  console.log(`Packed into ${out}:\n${sums}`);
}

function page(file) {
  const text = readFileSync(resolve(file), 'utf8').replaceAll('\r\n', '\n');
  const forms = formsNotKept(text);
  if (forms.length > 0) {
    for (const form of forms) console.error(`FAIL ${file}, ${form}.`);
    process.exit(1);
  }
  console.log(forReleasePage(text));
}

/** Runs one line in a shell, as a person types it. npm and the installed binary are .cmd shims on Windows. */
function run(line, options = {}) {
  return new Promise((done, failed) => {
    const child = spawn(line, { shell: true, stdio: ['ignore', 'pipe', 'inherit'], ...options });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
      process.stdout.write(chunk);
    });
    child.on('error', failed);
    child.on('close', (status) => {
      if (status === 0) done(out);
      else failed(new Error(`\`${line}\` ended with ${String(status)}.`));
    });
  });
}

/** The `package.json` of a packed package: the file `package/package.json` of the archive. */
function manifestOf(tarball) {
  const tar = gunzipSync(readFileSync(tarball));
  for (let at = 0; at + 512 <= tar.length;) {
    const name = tar.toString('utf8', at, at + 100).replace(/\0.*$/s, '');
    const size = Number.parseInt(
      tar
        .toString('utf8', at + 124, at + 136)
        .replace(/\0.*$/s, '')
        .trim() || '0',
      8,
    );
    if (name === 'package/package.json') return JSON.parse(tar.toString('utf8', at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${tarball} holds no package/package.json.`);
}

/**
 * A registry on a free port of this machine that stands in for the one of npm. It answers for the two packages
 * with the packed files of a folder, as the registry will once they are published, and sends every other request
 * on to the registry of npm with a redirect.
 */
function standIn(folder, version) {
  const answers = new Map();
  const server = createServer((request, response) => {
    const url = decodeURIComponent(request.url ?? '').replace(/\?.*$/, '');
    const answer = answers.get(url);
    if (answer === undefined) {
      response.writeHead(307, { location: `${REGISTRY}${request.url ?? ''}` }).end();
    } else {
      response.writeHead(200, { 'content-type': answer.type }).end(answer.body);
    }
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const site = `http://127.0.0.1:${String(server.address().port)}`;
      for (const pkg of PACKAGES) {
        const file = tarballOf(pkg, version);
        const bytes = readFileSync(join(folder, file));
        const dist = {
          tarball: `${site}/-/packed/${file}`,
          integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
          shasum: createHash('sha1').update(bytes).digest('hex'),
        };
        const packument = {
          name: pkg.name,
          'dist-tags': { latest: version, next: version },
          versions: { [version]: { ...manifestOf(join(folder, file)), dist } },
        };
        answers.set(`/${pkg.name}`, { type: 'application/json', body: JSON.stringify(packument) });
        answers.set(`/-/packed/${file}`, { type: 'application/octet-stream', body: bytes });
      }
      done({ server, site });
    });
  });
}

async function tryInstall(version, from) {
  if (!PRE_RELEASE.test(version)) {
    console.error(`FAIL "${version}" is not a pre-release version such as 0.1.0-next.0.`);
    process.exit(1);
  }
  const local = from === 'npm' ? undefined : await standIn(resolve(from), version);
  try {
    const line = installLine(version);
    const where = local === undefined ? '' : ` --registry ${local.site}`;
    console.log(`npm ${(await run('npm --version')).trim()}\n${line}${where}`);
    // The registry of npm can take a moment to show a version that was just published.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await run(`${line}${where} --no-fund`);
        break;
      } catch (error) {
        if (local !== undefined || attempt === 5) throw error;
        console.log(`Attempt ${String(attempt)} failed. Waiting ${String(attempt * 30)} s.`);
        await setTimeout(attempt * 30_000);
      }
    }
    const said = (await run('orglens --version')).trim();
    if (!said.startsWith(`sf-orglens/${version} engine/${version} `)) {
      throw new Error(`The installed binary does not say that it is version ${version}.`);
    }
    const workspace = mkdtempSync(join(tmpdir(), 'orglens-try-'));
    await run('orglens init', { cwd: workspace });
    await run('orglens doctor', { cwd: workspace });
    console.log(`Version ${version} installs with the line of its release notes, and runs.`);
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    local?.server.close();
    local?.server.closeAllConnections();
  }
}

const [step, ...rest] = process.argv.slice(2);
if (step === 'check' && rest.length === 3) {
  check(rest[0], rest[1], rest[2]);
} else if (step === 'pack' && rest.length === 2) {
  pack(rest[0], rest[1]);
} else if (step === 'page' && rest.length === 1) {
  page(rest[0]);
} else if (step === 'try' && rest.length === 2) {
  await tryInstall(rest[0], rest[1]);
} else {
  usage();
}
