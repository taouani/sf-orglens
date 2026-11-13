import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Git for the tests of the CLI. The tests of the engine have a larger
 * helper of the same kind. A client may not reach into the engine, and that
 * holds for its tests too, so the few lines are here again.
 *
 * Git is started without any `GIT_` variable of the process that runs the
 * tests, and without the settings of the machine and of the user. Tests are
 * also run by hooks, and Git hands a hook the place of the repository it
 * runs for. With that inherited, a test would commit into that repository.
 */
const SETTINGS = [
  'user.name=OrgLens Test',
  'user.email=test@example.invalid',
  'commit.gpgsign=false',
  'core.autocrlf=false',
  // No tidying in a process of its own after a commit: it holds a lock file in the repository for a moment.
  'maintenance.auto=false',
  'gc.auto=0',
  'init.defaultBranch=main',
].flatMap((one) => ['-c', one]);

/**
 * Makes the folder a Git repository with one commit of everything in it,
 * and returns the id of the commit. `emptyDir` is a folder of the test, for
 * a settings file with nothing in it.
 */
export function commitAll(dir: string, emptyDir: string): string {
  const config = join(emptyDir, 'gitconfig');
  writeFileSync(config, '');
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' };
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.toUpperCase().startsWith('GIT_')) env[name] = value;
  }
  const git = (...args: string[]): string => {
    const result = spawnSync('git', [...SETTINGS, ...args], { cwd: dir, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || String(result.error)}`);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'A commit');
  return git('rev-parse', 'HEAD');
}

/** The name of the variable programs are found with. On Windows it is usually written `Path`. */
const PATH_NAME = Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';

/**
 * Runs `work` with a search path on which there is no `git`, and puts the
 * path back when `work` has ended. The engine finds Git with the
 * environment of this process.
 */
export async function withoutGit<T>(emptyDir: string, work: () => Promise<T>): Promise<T> {
  const before = process.env[PATH_NAME];
  process.env[PATH_NAME] = emptyDir;
  try {
    return await work();
  } finally {
    if (before === undefined) Reflect.deleteProperty(process.env, PATH_NAME);
    else process.env[PATH_NAME] = before;
  }
}
