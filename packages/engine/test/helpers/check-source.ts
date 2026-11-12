/*
 * Checks one source of a workspace, from a process of its own, so that a test can give the process a home folder
 * and an environment, and see what is left in the home folder afterwards.
 *
 *   node check-source.ts <workspace folder> <source name>
 */
import { openWorkspace } from '../../src/api/workspace.ts';

const [root, name] = process.argv.slice(2);
if (root === undefined || name === undefined)
  throw new Error('usage: check-source.ts <workspace folder> <source name>');

const workspace = await openWorkspace({ root });
process.stdout.write(`${JSON.stringify(await workspace.sources.check(name))}\n`);
