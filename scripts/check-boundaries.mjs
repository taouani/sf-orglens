/*
 * Proves that the layer rules are enforced, by breaking them on purpose.
 *
 * For each case this script writes one probe file with a forbidden import
 * into the source tree, runs the tool that should reject it, checks that the
 * tool failed for the expected reason, and removes the probe again.
 *
 * Three independent mechanisms are checked:
 *   1. the package `exports` map, through the TypeScript compiler,
 *   2. the ESLint `no-restricted-imports` rules,
 *   3. the dependency-cruiser rules.
 *
 * It also runs each tool on the clean tree first, so a failure of a probe is
 * known to come from the probe.
 *
 * Run `pnpm run build` first: the compiler check needs the engine's declaration files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Runs a dev tool's JavaScript entry point with the current Node.js, without a shell. */
function runTool(packageName, binPath, args) {
  const entry = join(root, 'node_modules', packageName, binPath);
  const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const tools = {
  tsc: (project) => runTool('typescript', 'bin/tsc', ['-p', project, '--noEmit']),
  eslint: (file) => runTool('eslint', 'bin/eslint.js', ['--no-warn-ignored', file]),
  depcruise: () =>
    runTool('dependency-cruiser', 'bin/dependency-cruiser.mjs', [
      'packages',
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'err',
    ]),
};

const PROBE = '__boundary_probe__.ts';

/**
 * Each case: where the probe goes, what it contains, and for each tool the
 * text its output must contain when it rejects the probe.
 */
const cases = [
  {
    name: 'client imports an engine internal by package subpath',
    dir: 'packages/cli/src',
    source: "export { engineVersion } from '@sf-orglens/engine/core/version.js';\n",
    expect: {
      tsc: { project: 'packages/cli', text: 'TS2307' },
      eslint: { text: 'no-restricted-imports' },
    },
  },
  {
    name: 'client imports an engine internal by relative path',
    dir: 'packages/cli/src',
    source: "export { engineVersion } from '../../engine/src/core/version.ts';\n",
    expect: {
      tsc: { project: 'packages/cli', text: 'error TS' },
      eslint: { text: 'no-restricted-imports' },
      depcruise: { text: 'clients-use-engine-api-only' },
    },
  },
  {
    name: 'client imports a Salesforce library',
    dir: 'packages/cli/src',
    source: "export * from '@salesforce/core';\n",
    expect: {
      eslint: { text: 'no-restricted-imports' },
      depcruise: { text: 'salesforce-sdk-only-in-sources' },
    },
  },
  {
    name: 'core layer imports from the api layer',
    dir: 'packages/engine/src/core',
    source: "export { engineVersion } from '../api/index.ts';\n",
    expect: {
      eslint: { text: 'no-restricted-imports' },
      depcruise: { text: 'layer-core-no-forward-imports' },
    },
  },
  {
    name: 'store layer imports from the engines layer',
    dir: 'packages/engine/src/store',
    source: "export * from '../engines/impact.ts';\n",
    expect: {
      eslint: { text: 'no-restricted-imports' },
    },
  },
  {
    name: 'store layer imports a Salesforce library',
    dir: 'packages/engine/src/store',
    source: "export * from '@salesforce/core';\n",
    expect: {
      eslint: { text: 'no-restricted-imports' },
      depcruise: { text: 'salesforce-sdk-only-in-sources' },
    },
  },
  {
    name: 'engine imports a client package',
    dir: 'packages/engine/src/api',
    source: "export * from '../../../cli/src/main.ts';\n",
    expect: {
      depcruise: { text: 'engine-never-imports-clients' },
    },
  },
];

const failures = [];
const note = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

function invoke(tool, probePath, expectation) {
  if (tool === 'tsc') return tools.tsc(expectation.project);
  if (tool === 'eslint') return tools.eslint(probePath);
  return tools.depcruise();
}

if (!existsSync(join(root, 'packages/engine/dist/index.d.ts'))) {
  console.error('Run "pnpm run build" first: packages/engine/dist is missing.');
  process.exit(2);
}

// Baseline: the clean tree passes every tool.
for (const [label, result] of [
  ['tsc packages/engine', tools.tsc('packages/engine')],
  ['tsc packages/cli', tools.tsc('packages/cli')],
  ['eslint packages', tools.eslint('packages')],
  ['depcruise', tools.depcruise()],
]) {
  note(result.status === 0, `clean tree passes ${label}`);
  if (result.status !== 0) console.log(result.output);
}

for (const testCase of cases) {
  const probePath = join(testCase.dir, PROBE);
  const absolute = join(root, probePath);
  if (existsSync(absolute)) {
    console.error(`Refusing to overwrite ${probePath}. Remove it and run again.`);
    process.exit(2);
  }
  try {
    writeFileSync(absolute, testCase.source);
    for (const [tool, expectation] of Object.entries(testCase.expect)) {
      const result = invoke(tool, probePath, expectation);
      const rejected = result.status !== 0 && result.output.includes(expectation.text);
      note(rejected, `${testCase.name}: ${tool} rejects it (${expectation.text})`);
      if (!rejected) console.log(`  exit code ${String(result.status)}\n${result.output}`);
    }
  } finally {
    rmSync(absolute, { force: true });
  }
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} boundary check(s) failed.`);
  process.exit(1);
}
console.log('\nAll boundary checks passed.');
