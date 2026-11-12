/*
 * Proves that the layer rules are enforced, by breaking them on purpose.
 *
 * The script writes probe files with forbidden imports into the source tree,
 * runs each tool once over all of them, checks that every probe is rejected
 * by the expected rule, and removes the probes again. Control probes with
 * allowed imports must pass, so a rule that rejects too much is caught too.
 *
 * Mechanisms checked:
 *   1. the package `exports` map, through the TypeScript compiler and through Node.js at run time
 *      (it guards the client-to-engine boundary only),
 *   2. the ESLint rule `orglens/layers` (tools/eslint-plugin-orglens.js),
 *   3. the dependency-cruiser rules (.dependency-cruiser.cjs).
 *
 * Every dependency-cruiser rule and every message of the ESLint rule must be
 * hit by at least one probe. A rule added without a probe fails this script.
 *
 * Run `pnpm run build` first: the compiler check needs the engine's declaration files.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import orglensPlugin from '../tools/eslint-plugin-orglens.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { layers, salesforceLayer, salesforcePackages, clientForbiddenPackages } = require('../layers.cjs');
const cruiserConfig = require('../.dependency-cruiser.cjs');

const ESLINT_RULE = 'orglens/layers';
const MARK = '__probe_';
const ENGINE = 'packages/engine/src';
const CLI = 'packages/cli';

/**
 * The layer order and the restricted packages are part of the architecture, so they are stated here a
 * second time on purpose. Loosening layers.cjs alone fails this script.
 */
const EXPECTED_LAYERS = ['core', 'sources', 'extraction', 'store', 'engines', 'api'];
const EXPECTED_SALESFORCE_LAYER = 'sources';
const EXPECTED_SALESFORCE_PACKAGES = ['@salesforce', '@jsforce', 'jsforce'];
const EXPECTED_CLIENT_FORBIDDEN = ['node:sqlite', 'better-sqlite3', 'fast-xml-parser'];

const failures = [];
let passed = 0;
function note(ok, message, detail) {
  if (ok) {
    passed += 1;
  } else {
    console.log(`FAIL ${message}`);
    if (detail) console.log(detail);
    failures.push(message);
  }
}

/** Runs a dev tool's JavaScript entry point with the current Node.js, without a shell. */
function runTool(packageName, binPath, args) {
  const entry = join(root, 'node_modules', packageName, binPath);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
}

const tsc = (project) => runTool('typescript', 'bin/tsc', ['-p', project, '--noEmit', '--pretty', 'false']);
const eslint = (args) => runTool('eslint', 'bin/eslint.js', ['--no-warn-ignored', ...args]);
const depcruise = (args) =>
  runTool('dependency-cruiser', 'bin/dependency-cruiser.mjs', [
    'packages',
    '--config',
    '.dependency-cruiser.cjs',
    ...args,
  ]);

// ---------------------------------------------------------------------------
// Probe definitions
// ---------------------------------------------------------------------------

/**
 * A probe is one file. `eslint` is the message id the ESLint rule must report
 * for it, `cruise` the dependency-cruiser rule, `tsc` the compiler error code.
 * A probe with `clean: true` must be accepted by ESLint and dependency-cruiser.
 */
const probes = [];
const probe = (file, source, expect = {}) => probes.push({ file, source: `${source}\n`, ...expect });
const target = (layer) => `${MARK}target__.ts`.replace('target', `target_${layer}`);

// One importable file per layer, with no imports of its own.
for (const layer of layers) {
  probe(`${ENGINE}/${layer}/${target(layer)}`, `export const probeTarget = '${layer}';`, { clean: true });
}

// Every ordered pair of layers: the forward import is rejected, the backward import is accepted.
layers.forEach((earlier, i) => {
  for (const later of layers.slice(i + 1)) {
    probe(
      `${ENGINE}/${earlier}/${MARK}forward_${later}__.ts`,
      `export { probeTarget } from '../${later}/${target(later)}';`,
      { eslint: 'forwardImport', cruise: `layer-${earlier}-no-forward-imports` },
    );
    probe(
      `${ENGINE}/${later}/${MARK}backward_${earlier}__.ts`,
      `export { probeTarget } from '../${earlier}/${target(earlier)}';`,
      { clean: true },
    );
  }
});

const forward = { eslint: 'forwardImport', cruise: 'layer-core-no-forward-imports' };
const apiTarget = `api/${target('api')}`;

// Ways of writing a forward import that a textual check would miss.
probe(`${ENGINE}/core/${MARK}dot_segment__.ts`, `export { probeTarget } from './../${apiTarget}';`, forward);
probe(`${ENGINE}/core/${MARK}detour__.ts`, `export { probeTarget } from '../core/../${apiTarget}';`, forward);
probe(`${ENGINE}/core/${MARK}dynamic__.ts`, `export const load = () => import('../${apiTarget}');`, forward);
probe(`${ENGINE}/core/${MARK}type_only__.ts`, `export type Probe = typeof import('../${apiTarget}');`, forward);
probe(
  `${ENGINE}/core/${MARK}require__.ts`,
  [
    "import { createRequire } from 'node:module';",
    'const require = createRequire(import.meta.url);',
    `export const loaded: unknown = require('../${apiTarget}');`,
  ].join('\n'),
  forward,
);

// A folder inside one layer may share its name with another layer.
probe(`${ENGINE}/core/store/${MARK}inner__.ts`, "export const inner = 'core/store';", { clean: true });
probe(`${ENGINE}/core/sub/${MARK}sibling__.ts`, `export { inner } from '../store/${MARK}inner__.ts';`, { clean: true });

// The engine entry point re-exports the api layer, so no layer may import it.
for (const layer of layers) {
  probe(`${ENGINE}/${layer}/${MARK}entry__.ts`, "export * from '../index.ts';", {
    eslint: 'entryImport',
    cruise: 'layers-never-import-the-entry-point',
  });
}
probe(`${ENGINE}/core/${MARK}self__.ts`, "export * from '@sf-orglens/engine';", {
  eslint: 'engineSelfImport',
  cruise: 'layers-never-import-the-entry-point',
});

// Nothing lives in packages/engine/src outside the layer folders.
probe(`${ENGINE}/${MARK}stray_file__.ts`, 'export const stray = 1;', { eslint: 'strayFile' });
probe(`${ENGINE}/util/${MARK}stray__.ts`, `export { probeTarget } from '../${apiTarget}';`, {
  eslint: 'strayFile',
  cruise: 'engine-source-only-in-layers-outbound',
});
probe(`${ENGINE}/core/${MARK}uses_stray__.ts`, `export { probeTarget } from '../util/${MARK}stray__.ts';`, {
  eslint: 'strayImport',
  cruise: 'engine-source-only-in-layers',
});

// Circular imports. dependency-cruiser reports a cycle once, from the file it reached first.
probe(`${ENGINE}/core/${MARK}cycle_a__.ts`, `export { b } from './${MARK}cycle_b__.ts';\nexport const a = 1;`, {
  cruise: 'no-circular',
  cruiseAlsoFrom: `${ENGINE}/core/${MARK}cycle_b__.ts`,
});
probe(`${ENGINE}/core/${MARK}cycle_b__.ts`, `export { a } from './${MARK}cycle_a__.ts';\nexport const b = 2;`);

// An import that cannot be resolved cannot be checked, so it is rejected.
probe(`${ENGINE}/core/${MARK}missing__.ts`, "export * from './no-such-file.ts';", { cruise: 'not-to-unresolvable' });

// The engine never imports a client.
probe(`${ENGINE}/api/${MARK}client__.ts`, "export { versionLine } from '../../../cli/src/main.ts';", {
  eslint: 'engineImportsClient',
  cruise: 'engine-never-imports-clients',
});

// Only the sources layer imports the Salesforce libraries.
const salesforce = { eslint: 'salesforceImport', cruise: 'salesforce-sdk-only-in-sources' };
for (const layer of layers) {
  const expect = layer === salesforceLayer ? { clean: true } : salesforce;
  probe(`${ENGINE}/${layer}/${MARK}salesforce__.ts`, "export * from '@salesforce/core';", expect);
}
salesforcePackages.forEach((name, index) => {
  probe(`${ENGINE}/store/${MARK}sf_package_${String(index)}__.ts`, `export * from '${name}';`, salesforce);
  probe(
    `${ENGINE}/store/${MARK}sf_subpath_${String(index)}__.ts`,
    `export * from '${name}/lib/anything.js';`,
    salesforce,
  );
  probe(`${CLI}/src/${MARK}sf_package_${String(index)}__.ts`, `export * from '${name}';`, salesforce);
});
probe(`${ENGINE}/store/${MARK}sf_dynamic__.ts`, "export const load = () => import('@salesforce/core');", salesforce);
probe(`${CLI}/src/${MARK}sf_dynamic__.ts`, "export const load = () => import('@salesforce/core');", salesforce);

// Clients use the engine by its package name only, and never the store or the parsers.
probe(`${CLI}/src/${MARK}allowed__.ts`, "export { engineVersion } from '@sf-orglens/engine';", {
  clean: true,
  tscClean: true,
});
probe(`${CLI}/src/${MARK}subpath__.ts`, "export { engineVersion } from '@sf-orglens/engine/dist/core/version.js';", {
  eslint: 'clientInternalImport',
  // Without the `exports` map this path would resolve and the compiler would accept it.
  // dependency-cruiser does not follow imports into dist/, so it has nothing to say here.
  tsc: 'TS2307',
});
probe(`${CLI}/src/${MARK}relative_src__.ts`, "export { engineVersion } from '../../engine/src/core/version.ts';", {
  eslint: 'clientInternalImport',
  cruise: 'clients-use-engine-api-only',
});
probe(`${CLI}/src/${MARK}relative_dist__.ts`, "export { engineVersion } from '../../engine/dist/core/version.js';", {
  eslint: 'clientInternalImport',
});
probe(
  `${CLI}/src/${MARK}relative_dynamic__.ts`,
  "export const load = () => import('../../engine/src/core/version.ts');",
  {
    eslint: 'clientInternalImport',
    cruise: 'clients-use-engine-api-only',
  },
);
probe(`${CLI}/test/${MARK}from_test__.ts`, "export { engineVersion } from '../../engine/src/core/version.ts';", {
  eslint: 'clientInternalImport',
});
clientForbiddenPackages.forEach((name, index) => {
  probe(`${CLI}/src/${MARK}forbidden_${String(index)}__.ts`, `export * from '${name}';`, {
    eslint: 'clientForbiddenImport',
    // `sqlite` is listed only because dependency-cruiser reports `node:sqlite` under that name.
    ...(name === 'sqlite' ? {} : { cruise: 'clients-never-use-store-or-parsers' }),
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toPosix = (path) => path.split(sep).join('/');

function findProbes(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) findProbes(path, found);
    else if (entry.name.startsWith(MARK)) found.push(path);
  }
  return found;
}

/** Removes every probe file, and every folder that only existed to hold one. */
function removeProbes() {
  for (const file of findProbes(join(root, 'packages'))) {
    rmSync(file, { force: true });
    let dir = dirname(file);
    while (dir.startsWith(join(root, 'packages')) && readdirSync(dir).length === 0) {
      rmSync(dir, { recursive: true });
      dir = dirname(dir);
    }
  }
}

function parseJson(label, text) {
  try {
    return JSON.parse(text);
  } catch {
    note(false, `${label} did not print JSON`, text.slice(0, 2000));
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

if (!existsSync(join(root, 'packages/engine/dist/index.d.ts'))) {
  console.error('Run "pnpm run build" first: packages/engine/dist is missing.');
  process.exit(2);
}

note(
  JSON.stringify(layers) === JSON.stringify(EXPECTED_LAYERS),
  `layers.cjs lists the layers in the agreed order (${EXPECTED_LAYERS.join(', ')})`,
);
note(
  salesforceLayer === EXPECTED_SALESFORCE_LAYER,
  `only the ${EXPECTED_SALESFORCE_LAYER} layer may import Salesforce libraries`,
);
for (const name of EXPECTED_SALESFORCE_PACKAGES) {
  note(salesforcePackages.includes(name), `layers.cjs restricts the Salesforce package ${name}`);
}
for (const name of EXPECTED_CLIENT_FORBIDDEN) {
  note(clientForbiddenPackages.includes(name), `layers.cjs keeps ${name} away from clients`);
}

removeProbes(); // left over from an interrupted run

// The clean tree passes every tool, so a rejected probe is rejected because of the probe.
for (const [label, result] of [
  ['tsc packages/engine', tsc('packages/engine')],
  ['tsc packages/cli', tsc(CLI)],
  ['eslint packages', eslint(['packages'])],
  ['depcruise', depcruise(['--output-type', 'err'])],
]) {
  note(result.status === 0, `clean tree passes ${label}`, result.output);
}

// Only the layer folders and index.ts exist in the engine source folder.
const engineEntries = readdirSync(join(root, ENGINE)).sort();
note(
  JSON.stringify(engineEntries) === JSON.stringify([...layers, 'index.ts'].sort()),
  `${ENGINE} contains only the layer folders and index.ts`,
  `found: ${engineEntries.join(', ')}`,
);

// The exports map at run time: the entry point loads, a deep path does not.
const importFromCli = (specifier) =>
  spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)});`], {
    cwd: join(root, CLI),
    encoding: 'utf8',
  });
note(importFromCli('@sf-orglens/engine').status === 0, 'Node.js loads the engine entry point from the CLI package');
const deepImport = importFromCli('@sf-orglens/engine/dist/core/version.js');
note(
  deepImport.status !== 0 && deepImport.stderr.includes('ERR_PACKAGE_PATH_NOT_EXPORTED'),
  'Node.js refuses a deep import into the engine (ERR_PACKAGE_PATH_NOT_EXPORTED)',
  deepImport.stderr,
);

process.on('SIGINT', () => {
  removeProbes();
  process.exit(130);
});

function writeProbes(selected) {
  for (const { file, source } of selected) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
}

let eslintReport;
let cruiseReport;
let tscOutput;
try {
  writeProbes(probes);
  eslintReport = parseJson('eslint', eslint(['--format', 'json', ...probes.map((p) => p.file)]).stdout);
  cruiseReport = parseJson('depcruise', depcruise(['--output-type', 'json']).stdout);
  // The compiler stops at the first project-level error, so it gets only the probes meant for it.
  removeProbes();
  writeProbes(probes.filter((p) => p.tsc || p.tscClean));
  tscOutput = tsc(CLI).output;
} finally {
  removeProbes();
}

const eslintByFile = new Map();
for (const result of eslintReport ?? []) {
  const ids = result.messages.filter((m) => m.ruleId === ESLINT_RULE).map((m) => m.messageId);
  eslintByFile.set(toPosix(relative(root, result.filePath)), ids);
}
const cruiseByFile = new Map();
for (const violation of cruiseReport?.summary?.violations ?? []) {
  const names = cruiseByFile.get(violation.from) ?? [];
  names.push(violation.rule.name);
  cruiseByFile.set(violation.from, names);
}
const tscErrors = (tscOutput ?? '').split('\n').filter((line) => line.includes('error TS'));

for (const p of probes) {
  const eslintIds = eslintByFile.get(p.file);
  const cruiseNames = cruiseByFile.get(p.file) ?? [];
  const compilerLines = tscErrors.filter((line) => toPosix(line).startsWith(p.file));
  if (eslintIds === undefined) {
    note(false, `${p.file}: ESLint did not lint the probe`);
    continue;
  }
  if (p.clean) {
    note(eslintIds.length === 0, `${p.file}: ESLint accepts an allowed import`, `reported: ${eslintIds.join(', ')}`);
    // An allowed import of a package that is not installed is still unresolvable.
    const real = cruiseNames.filter((name) => !(name === 'not-to-unresolvable' && p.source.includes('@salesforce/')));
    note(real.length === 0, `${p.file}: dependency-cruiser accepts an allowed import`, `reported: ${real.join(', ')}`);
  }
  if (p.tscClean) {
    note(compilerLines.length === 0, `${p.file}: the compiler accepts an allowed import`, compilerLines.join('\n'));
  }
  if (p.eslint) {
    note(
      eslintIds.includes(p.eslint),
      `${p.file}: ESLint reports ${p.eslint}`,
      `reported: ${eslintIds.join(', ') || 'nothing'}`,
    );
  }
  if (p.cruise) {
    note(
      cruiseNames.includes(p.cruise) || (cruiseByFile.get(p.cruiseAlsoFrom) ?? []).includes(p.cruise),
      `${p.file}: dependency-cruiser reports ${p.cruise}`,
      `reported: ${cruiseNames.join(', ') || 'nothing'}`,
    );
  }
  if (p.tsc) {
    note(
      compilerLines.some((line) => line.includes(`error ${p.tsc}:`)),
      `${p.file}: the compiler reports ${p.tsc}`,
      compilerLines.join('\n') || 'no compiler error for this file',
    );
  }
}

// Every rule has at least one probe.
const probedMessages = new Set(probes.map((p) => p.eslint).filter(Boolean));
for (const messageId of Object.keys(orglensPlugin.rules.layers.meta.messages)) {
  note(probedMessages.has(messageId), `ESLint message "${messageId}" has a probe`);
}
const probedRules = new Set(probes.map((p) => p.cruise).filter(Boolean));
for (const rule of cruiserConfig.forbidden) {
  note(probedRules.has(rule.name), `dependency-cruiser rule "${rule.name}" has a probe`);
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} boundary check(s) failed, ${String(passed)} passed.`);
  process.exit(1);
}
console.log(`All ${String(passed)} boundary checks passed (${String(probes.length)} probe files).`);
