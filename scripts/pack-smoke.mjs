/*
 * Packs both packages the way a release would, installs the tarballs into an
 * empty folder with npm, and runs the installed `orglens` binary.
 *
 * This catches what tests from source cannot: a wrong `files` list, a broken
 * `exports` map, a missing dependency, or a binary that does not start.
 *
 * Run `pnpm run build` first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';

function run(command, args, cwd) {
  // npm and pnpm are .cmd shims on Windows, which need a shell to start.
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: windows });
  if (result.status !== 0) {
    console.error(`$ ${command} ${args.join(' ')}\n${result.stdout}${result.stderr}`);
    throw new Error(`${command} exited with code ${String(result.status)}`);
  }
  return result.stdout;
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

  // No TypeScript source and no build cache may be shipped.
  for (const name of ['@sf-orglens/engine', 'sf-orglens']) {
    const installed = join(app, 'node_modules', name);
    const shipped = readdirSync(installed, { recursive: true }).map(String);
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
