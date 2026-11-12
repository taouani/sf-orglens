/*
 * Takes one snapshot of a source, from a process of its own, so that a test can give the process a home folder
 * and see what is left in it.
 *
 *   node take-snapshot.ts <workspace folder> <source name>
 */
import { openWorkspace } from '../../src/api/workspace.ts';

const [root, name] = process.argv.slice(2);
if (root === undefined || name === undefined)
  throw new Error('usage: take-snapshot.ts <workspace folder> <source name>');

const workspace = await openWorkspace({ root, env: {} });
const report = await workspace.snapshot(name);
process.stdout.write(`${report.snapshot.status} ${String(report.snapshot.files)}\n`);
