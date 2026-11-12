/*
 * Takes one snapshot of a source, from a process of its own, so that a test can give the process a home folder
 * and see what is left in it, or stop the process on its way.
 *
 *   node take-snapshot.ts <workspace folder> <source name> [--environment]
 *
 * With `--environment` the workspace reads the variables of the process, which is how a login with a key is
 * found. Without it, no variable reaches the workspace.
 */
import { openWorkspace } from '../../src/api/workspace.ts';

const [root, name, flag] = process.argv.slice(2);
if (root === undefined || name === undefined)
  throw new Error('usage: take-snapshot.ts <workspace folder> <source name> [--environment]');

const workspace = await openWorkspace({ root, env: flag === '--environment' ? process.env : {} });
const report = await workspace.snapshot(name);
process.stdout.write(`${report.snapshot.status} ${String(report.snapshot.files)}\n`);
