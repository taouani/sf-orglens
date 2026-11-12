/*
 * Adds one source to a workspace, from a process of its own. The tests start several of these at the same moment
 * to see that no change is lost.
 *
 *   node add-source.ts <workspace folder> <source name>
 */
import { openWorkspace } from '../../src/api/workspace.ts';

const [root, name] = process.argv.slice(2);
if (root === undefined || name === undefined) throw new Error('usage: add-source.ts <workspace folder> <source name>');

const workspace = await openWorkspace({ root, env: {} });
await workspace.sources.add({ name, kind: 'org' });
