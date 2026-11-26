/*
 * Packs both packages the way a release would, installs the tarballs into an
 * empty folder with npm, and runs the installed `orglens` binary.
 *
 * This catches what tests from source cannot: a wrong `files` list, a broken
 * `exports` map, a missing dependency, or a binary that does not start. The
 * installed binary also takes a snapshot of the fixture project, and of the
 * project with a class that does not parse: the grammar of Apex is a file of
 * its own in a dependency, and is found only where the package is installed.
 *
 * Run `pnpm run build` first.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';

/** Quotes one argument for cmd.exe. Paths with spaces would otherwise be split. */
const quote = (text) => (/[\s"&|<>^()]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text);

/** Runs a program and returns what it wrote. An exit code other than 0 is a failure. */
function run(command, args, cwd) {
  return started(command, args, cwd).stdout;
}

/** Runs a program and returns what it wrote and its exit code. An exit code other than 0 and those `allowed` is a failure. */
function started(command, args, cwd, allowed = []) {
  // npm and pnpm are .cmd shims on Windows and need a shell to start. A shell joins its arguments
  // without quoting, so they are quoted here. Node.js itself is started directly, without a shell.
  const viaShell = windows && command !== process.execPath;
  const result = viaShell
    ? spawnSync([command, ...args].map(quote).join(' '), { cwd, encoding: 'utf8', shell: true })
    : spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowed.includes(result.status)) {
    console.error(`$ ${command} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
    throw new Error(`${command} exited with code ${String(result.status)}`);
  }
  return result;
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

if (!existsSync(join(root, 'packages/cli/dist/bin.js'))) {
  console.error('Run "pnpm run build" first: packages/cli/dist is missing.');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'orglens-pack-'));
try {
  const tarballs = join(work, 'tarballs');
  for (const pkg of ['engine', 'cli']) {
    run('pnpm', ['pack', '--pack-destination', tarballs], join(root, 'packages', pkg));
  }
  const packed = readdirSync(tarballs).filter((name) => name.endsWith('.tgz'));
  if (packed.length !== 2) throw new Error(`Expected 2 tarballs, found ${String(packed.length)}`);
  console.log(`packed: ${packed.join(', ')}`);

  const app = join(work, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), '{ "name": "orglens-pack-smoke", "private": true }\n');
  run('npm', ['install', '--no-audit', '--no-fund', ...packed.map((name) => join(tarballs, name))], app);

  // Each package ships its licence, notice and readme, and no TypeScript source or build cache.
  const rootNotice = readFileSync(join(root, 'NOTICE'), 'utf8');
  const rootLicense = readFileSync(join(root, 'LICENSE'), 'utf8');
  for (const name of ['@sf-orglens/engine', 'sf-orglens']) {
    const installed = join(app, 'node_modules', name);
    const shipped = readdirSync(installed, { recursive: true }).map(String);
    for (const required of ['LICENSE', 'NOTICE', 'README.md', 'package.json']) {
      if (!shipped.includes(required)) fail(`${name} does not ship ${required}`);
    }
    if (shipped.includes('NOTICE') && readFileSync(join(installed, 'NOTICE'), 'utf8') !== rootNotice) {
      fail(`${name} ships a NOTICE that differs from the one at the repository root`);
    }
    if (shipped.includes('LICENSE') && readFileSync(join(installed, 'LICENSE'), 'utf8') !== rootLicense) {
      fail(`${name} ships a LICENSE that differs from the one at the repository root`);
    }
    // Source maps must carry their sources, because the TypeScript files are not shipped.
    for (const map of shipped.filter((file) => file.endsWith('.js.map'))) {
      if (!('sourcesContent' in JSON.parse(readFileSync(join(installed, map), 'utf8')))) {
        fail(`${name}: ${map} points at sources that are not in the package`);
      }
    }
    if (shipped.some((file) => file.endsWith('.d.ts.map'))) fail(`${name} ships declaration maps without sources`);
    const unwanted = shipped.filter(
      (file) => (file.endsWith('.ts') && !file.endsWith('.d.ts')) || file.endsWith('.tsbuildinfo'),
    );
    if (unwanted.length > 0) fail(`${name} ships files it should not: ${unwanted.join(', ')}`);
    const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
    if (JSON.stringify(manifest).includes('workspace:')) fail(`${name} still has a workspace: dependency`);
    if (JSON.stringify(manifest.exports ?? {}).includes('/src/')) fail(`${name} exports point at src/`);
  }

  const expectedVersion = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version;
  const versionLine = run('npm', ['exec', '--offline', '--', 'orglens', '--version'], app).trim();
  console.log(`orglens --version: ${versionLine}`);
  if (!versionLine.startsWith(`sf-orglens/${expectedVersion} engine/`)) {
    fail(`unexpected version line: ${versionLine}`);
  }

  const help = run('npm', ['exec', '--offline', '--', 'orglens', '--help'], app);
  if (!help.includes('Usage: orglens')) fail('help output has no usage line');

  // The installed binary creates a workspace and reports on it, and its output matches the envelope.
  const workspace = join(app, 'workspace');
  mkdirSync(workspace);
  const orglensWithStatus = (allowed, ...args) =>
    started('npm', ['exec', '--offline', '--', 'orglens', '--workspace', workspace, ...args], app, allowed);
  const orglens = (...args) => orglensWithStatus([], ...args).stdout.trim();
  const lastLine = (text) => text.split('\n').at(-1) ?? '';
  orglens('init', '--json');
  orglens('source', 'add', 'repo', '--kind', 'git', '--json');
  const status = JSON.parse(lastLine(orglens('status', '--json')));
  if (status.ok !== true || status.data?.store?.state !== 'ready' || status.data?.sources?.[0]?.name !== 'repo') {
    fail(`unexpected status of a new workspace: ${JSON.stringify(status)}`);
  }
  const doctor = JSON.parse(lastLine(orglens('doctor', '--json')));
  if (doctor.data?.ok !== true) fail(`doctor found a problem in a new workspace: ${JSON.stringify(doctor.data)}`);

  // The installed binary reads a project with the Salesforce library it was installed with. This is where a
  // dependency that is missing from the package would show.
  cpSync(join(root, 'fixtures/billing-sfdx'), join(workspace, 'project'), { recursive: true });
  orglens('source', 'add', 'fixture', '--kind', 'git', '--repo', 'project', '--json');
  const snapshot = JSON.parse(lastLine(orglens('snapshot', 'fixture', '--json')));
  const components = (snapshot.data?.types ?? []).reduce((sum, type) => sum + type.retrieved, 0);
  // How many components the fixture has is the business of the tests. Here it matters that they were found at all.
  if (snapshot.data?.snapshot?.status !== 'complete' || components === 0) {
    fail(`unexpected snapshot of the fixture project: ${JSON.stringify(snapshot)}`);
  } else {
    console.log(`orglens snapshot: ${String(components)} components in ${String(snapshot.data.snapshot.files)} files`);
  }
  const malformed = (report) => (report.data?.issues ?? []).filter((issue) => issue.code === 'APEX_MALFORMED');
  if (snapshot.data?.analysis?.complete !== true || malformed(snapshot).length > 0) {
    fail(`the analysis of the fixture project is not complete: ${JSON.stringify(snapshot.data?.analysis)}`);
  }

  // The installed binary loads the grammar of Apex and parses with it: a class that does not parse is an error of
  // the analysis, at the line the parser stops at, and the snapshot ends with 5, since its analysis is incomplete.
  const classes = join(workspace, 'project/force-app/main/default/classes');
  writeFileSync(join(classes, 'SmokeBroken.cls'), 'public class SmokeBroken {\n    Integer x = ;\n}\n');
  writeFileSync(
    join(classes, 'SmokeBroken.cls-meta.xml'),
    readFileSync(
      join(
        classes,
        readdirSync(classes).find((name) => name.endsWith('.cls-meta.xml')),
      ),
      'utf8',
    ),
  );
  const second = orglensWithStatus([5], 'snapshot', 'fixture', '--json');
  if (second.status !== 5) fail(`the snapshot with a class that does not parse ended with ${String(second.status)}`);
  const broken = JSON.parse(lastLine(second.stdout.trim()));
  const [issue, ...more] = malformed(broken);
  if (issue?.component !== 'ApexClass:smokebroken' || issue.details?.line !== 2 || more.length > 0) {
    fail(`the class that does not parse is not the one error of Apex: ${JSON.stringify(malformed(broken))}`);
  } else {
    console.log(`orglens snapshot: ${issue.message}`);
  }

  // The schema of the JSON output is shipped and can be found by its package path.
  writeFileSync(
    join(app, 'schema-probe.mjs'),
    "import { readFileSync } from 'node:fs';\n" +
      "import { fileURLToPath } from 'node:url';\n" +
      "const file = fileURLToPath(import.meta.resolve('sf-orglens/schemas/output.schema.json'));\n" +
      "console.log(JSON.parse(readFileSync(file, 'utf8')).properties.schemaVersion.const);\n",
  );
  const schemaVersion = run(process.execPath, ['schema-probe.mjs'], app).trim();
  if (schemaVersion !== String(status.schemaVersion)) {
    fail(`the shipped schema is for version ${schemaVersion}, the output says ${String(status.schemaVersion)}`);
  }

  // The engine must be importable by its package name from a plain program.
  writeFileSync(
    join(app, 'probe.mjs'),
    "import { engineVersion } from '@sf-orglens/engine';\nconsole.log(engineVersion());\n",
  );
  const engineVersion = run(process.execPath, ['probe.mjs'], app).trim();
  if (engineVersion !== expectedVersion) fail(`engine import returned ${engineVersion}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (process.exitCode === 1) {
  console.error('\nPack smoke test failed.');
} else {
  console.log('\nPack smoke test passed.');
}
