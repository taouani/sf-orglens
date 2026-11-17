/*
 * The two steps of the workflow "Pre-release" that need more than a line of shell (decision record 0050).
 *
 *   node scripts/pre-release.mjs check <version> <publish> <ref>
 *       Holds a request for a pre-release against the repository, before anything is built. It fails when
 *       the version is not a pre-release version, when a package has another version, when the change log of a
 *       package has no section for it, when docs/releases/v<version>.md is missing or does not hold the line
 *       that installs this version, or when <publish> is "true" and <ref> is not the branch main.
 *
 *   node scripts/pre-release.mjs pack <version> <folder>
 *       Packs the two packages into <folder>, and writes SHA256SUMS and notes.md next to them: the release
 *       notes of the repository as GitHub shows them, followed by the checksums. Run `pnpm run build` first.
 *
 * Neither step publishes anything, and neither needs the network.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPOSITORY = 'https://github.com/taouani/sf-orglens';
const PACKAGES = [
  { folder: 'engine', name: '@sf-orglens/engine', tarball: 'sf-orglens-engine' },
  { folder: 'cli', name: 'sf-orglens', tarball: 'sf-orglens' },
];
/** A version with a pre-release part, such as 0.1.0-next.0. A version without one is not released from here. */
const PRE_RELEASE = /^\d+\.\d+\.\d+-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*$/;

const read = (path) => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');
const tarballOf = (pkg, version) => `${pkg.tarball}-${version}.tgz`;
const notesFile = (version) => `docs/releases/v${version}.md`;

/** The one line that installs a version. The engine comes first: the command line depends on it. */
function installLine(version) {
  const urls = PACKAGES.map((pkg) => `${REPOSITORY}/releases/download/v${version}/${tarballOf(pkg, version)}`);
  return `npm install --global ${urls.join(' ')}`;
}

/**
 * The release notes in the form the page of a release needs. GitHub shows the title of a release itself, and
 * breaks a line there wherever the text has a line break. So the first heading is left out, and the lines of a
 * paragraph or of an item of a list are joined. Code blocks, headings and tables are kept as they are.
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
      '       node scripts/pre-release.mjs pack <version> <folder>',
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
    const changeLog = `packages/${pkg.folder}/CHANGELOG.md`;
    if (!existsSync(join(root, changeLog)) || !read(changeLog).split('\n').includes(`## ${version}`)) {
      problems.push(`${changeLog} has no section "## ${version}".`);
    }
  }
  if (!existsSync(join(root, notesFile(version)))) {
    problems.push(`${notesFile(version)} is missing: every pre-release has release notes that were reviewed.`);
  } else if (!read(notesFile(version)).split('\n').includes(installLine(version))) {
    problems.push(`${notesFile(version)} does not hold this line of its own:\n  ${installLine(version)}`);
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

const [step, version, ...rest] = process.argv.slice(2);
if (step === 'check' && version !== undefined && rest.length === 2) {
  check(version, rest[0], rest[1]);
} else if (step === 'pack' && version !== undefined && rest.length === 1) {
  pack(version, rest[0]);
} else {
  usage();
}
