import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * A Git repository for a test, driven through the `git` program.
 *
 * The settings that differ between machines are fixed here: who commits,
 * the name of the first branch, and no conversion of line endings, so that
 * what a test writes is what a commit holds.
 *
 * Git is started without any `GIT_` variable of the process that runs the
 * tests, and without the settings of the machine and of the user. Tests are
 * also run by hooks, and Git hands a hook the place of the repository it
 * runs for. With that inherited, a test would commit into that repository.
 */
export interface TestRepo {
  readonly dir: string;
  /** Runs Git in the repository and returns what it printed, without the line end. */
  git(...args: string[]): string;
  /** Writes a file, creating its folders. The path uses forward slashes. */
  write(path: string, content: string | Uint8Array): void;
  /** Commits everything in the working tree and returns the id of the commit. */
  commit(message?: string): string;
}

const SETTINGS = [
  ['user.name', 'OrgLens Test'],
  ['user.email', 'test@example.invalid'],
  ['commit.gpgsign', 'false'],
  ['core.autocrlf', 'false'],
  ['init.defaultBranch', 'main'],
  // A newer Git tidies a repository in a process of its own after a commit, and holds a lock file meanwhile.
  // A test that compares the folder of a repository before and after would see the lock come or go.
  ['maintenance.auto', 'false'],
  ['gc.auto', '0'],
].flatMap(([name, value]) => ['-c', `${String(name)}=${String(value)}`]);

let emptyConfig: string | undefined;

/** The environment of the Git of a test: nothing of Git inherited, no settings of the machine or the user. */
export function testGitEnvironment(): NodeJS.ProcessEnv {
  if (emptyConfig === undefined) {
    const dir = mkdtempSync(join(tmpdir(), 'orglens-gitconfig-'));
    emptyConfig = join(dir, 'config');
    writeFileSync(emptyConfig, '');
    process.on('exit', () => {
      rmSync(dir, { recursive: true, force: true });
    });
  }
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.toUpperCase().startsWith('GIT_')) environment[name] = value;
  }
  return { ...environment, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' };
}

/** Makes a repository in a folder. `sha256` asks for one that names its objects with SHA-256, which an older Git refuses. */
export function createRepo(dir: string, options: { sha256?: boolean } = {}): TestRepo {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]): string => {
    const result = spawnSync('git', [...SETTINGS, ...args], { cwd: dir, encoding: 'utf8', env: testGitEnvironment() });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr || String(result.error)}`);
    }
    return result.stdout.trim();
  };
  git('init', '--quiet', ...(options.sha256 === true ? ['--object-format=sha256'] : []));
  return {
    dir,
    git,
    write: (path, content) => {
      const file = join(dir, ...path.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    },
    commit: (message = 'A commit') => {
      git('add', '--all');
      git('commit', '--quiet', '--allow-empty', '-m', message);
      return git('rev-parse', 'HEAD');
    },
  };
}

/**
 * Every file below a folder with a hash of its content, as one text. Taken
 * of the `.git` folder before and after, it shows any change to a
 * repository: an object that was fetched, an index that was rewritten, a
 * lock that was left behind.
 */
export function folderFingerprint(dir: string): string {
  const lines: string[] = [];
  const walk = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(path, `${name}/`);
      else lines.push(`${name} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
    }
  };
  walk(dir, '');
  return lines.sort().join('\n');
}

/** The files of a minimal Salesforce project: one class, one object with one field. Paths are below `dir`. */
export function projectFiles(dir = 'force-app/main/default'): Record<string, string> {
  const meta = (type: string, body: string): string =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<${type} xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}</${type}>\n`;
  return {
    [`${dir}/classes/Greeter.cls`]:
      "public class Greeter {\n    public String greet() {\n        return 'hello';\n    }\n}\n",
    [`${dir}/classes/Greeter.cls-meta.xml`]: meta(
      'ApexClass',
      '    <apiVersion>65.0</apiVersion>\n    <status>Active</status>\n',
    ),
    [`${dir}/objects/Parcel__c/Parcel__c.object-meta.xml`]: meta(
      'CustomObject',
      '    <deploymentStatus>Deployed</deploymentStatus>\n    <label>Parcel</label>\n    <nameField>\n        <label>Parcel Name</label>\n        <type>Text</type>\n    </nameField>\n    <pluralLabel>Parcels</pluralLabel>\n    <sharingModel>ReadWrite</sharingModel>\n',
    ),
    [`${dir}/objects/Parcel__c/fields/Weight__c.field-meta.xml`]: meta(
      'CustomField',
      '    <fullName>Weight__c</fullName>\n    <label>Weight</label>\n    <precision>8</precision>\n    <scale>2</scale>\n    <type>Number</type>\n',
    ),
  };
}

export const PROJECT_JSON = `${JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '65.0' }, null, 2)}\n`;
