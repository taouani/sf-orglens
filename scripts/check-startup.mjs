/*
 * Measures how long the built `orglens` binary takes for commands that need no org, and holds a budget.
 *
 * The budget is for `orglens status` in a workspace with one source: the command reads the configuration, opens
 * the database and prints. It is the median of repeated runs of a new process, so it includes the start of
 * Node.js itself. `orglens --version` and an empty Node.js program are measured next to it, to show where the
 * time goes.
 *
 * The budget is enforced on Linux, where CI gives comparable numbers. On other systems the numbers are printed
 * and the script succeeds.
 *
 *   ORGLENS_STARTUP_BUDGET_MS   the budget in milliseconds (default 150)
 *   ORGLENS_STARTUP_ENFORCE     "1" enforces the budget on every system, "0" on none
 *
 * Run `pnpm run build` first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'packages/cli/dist/bin.js');

const WARM_UP_RUNS = 3;
const MEASURED_RUNS = 21;
const DEFAULT_BUDGET_MS = 150;

function usage(message) {
  console.error(message);
  process.exit(2);
}

if (!existsSync(bin)) usage('Run "pnpm run build" first: packages/cli/dist is missing.');

const budgetText = process.env['ORGLENS_STARTUP_BUDGET_MS'];
const budget = budgetText === undefined || budgetText === '' ? DEFAULT_BUDGET_MS : Number(budgetText);
if (!Number.isFinite(budget) || budget <= 0) usage('ORGLENS_STARTUP_BUDGET_MS must be a number above 0.');

const enforceText = process.env['ORGLENS_STARTUP_ENFORCE'];
if (enforceText !== undefined && enforceText !== '' && enforceText !== '0' && enforceText !== '1') {
  usage('ORGLENS_STARTUP_ENFORCE must be "0" or "1".');
}
const enforce = enforceText === '1' || (enforceText !== '0' && process.platform === 'linux');

const work = mkdtempSync(join(tmpdir(), 'orglens-startup-'));
// The measured commands must not pick up a workspace or a driver from the environment of the caller.
const env = { ...process.env };
delete env['ORGLENS_WORKSPACE'];
delete env['ORGLENS_SQLITE_DRIVER'];

/** Runs Node.js once and returns the milliseconds the process took. A run that fails ends the script. */
function run(args) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, args, { cwd: work, env, encoding: 'utf8' });
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  if (result.status !== 0) {
    console.error(`$ node ${args.join(' ')}\n${result.stdout}${result.stderr}`);
    throw new Error(`The command exited with code ${String(result.status)}.`);
  }
  return elapsed;
}

function measure(args) {
  for (let count = 0; count < WARM_UP_RUNS; count += 1) run(args);
  const times = Array.from({ length: MEASURED_RUNS }, () => run(args)).sort((a, b) => a - b);
  return { median: times[(MEASURED_RUNS - 1) / 2], fastest: times[0], slowest: times[MEASURED_RUNS - 1] };
}

const show = (label, { median, fastest, slowest }) => {
  const numbers = [median, fastest, slowest].map((value) => `${value.toFixed(0).padStart(4)} ms`);
  console.log(`${label.padEnd(20)} median ${numbers[0]}   fastest ${numbers[1]}   slowest ${numbers[2]}`);
};

try {
  run([bin, 'init', '--name', 'startup-check']);
  run([bin, 'source', 'add', 'repo', '--kind', 'git']);

  console.log(`Node.js ${process.version} on ${process.platform}-${process.arch}, ${String(MEASURED_RUNS)} runs each.`);
  show('empty program', measure(['-e', '']));
  show('orglens --version', measure([bin, '--version']));
  const status = measure([bin, 'status']);
  show('orglens status', status);

  if (!enforce) {
    console.log(`The budget of ${String(budget)} ms for "orglens status" is not enforced on this system.`);
  } else if (status.median > budget) {
    console.error(
      `FAIL "orglens status" took ${status.median.toFixed(0)} ms (median). The budget is ${String(budget)} ms.`,
    );
    process.exitCode = 1;
  } else {
    console.log(`ok: "orglens status" is within the budget of ${String(budget)} ms.`);
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
