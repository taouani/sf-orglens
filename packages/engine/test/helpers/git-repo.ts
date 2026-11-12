import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * A Git repository for a test, driven through the `git` program.
 *
 * The settings that differ between machines are fixed here: who commits,
 * the name of the first branch, and no conversion of line endings, so that
 * what a test writes is what a commit holds.
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
].flatMap(([name, value]) => ['-c', `${String(name)}=${String(value)}`]);

export function createRepo(dir: string): TestRepo {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]): string => {
    const result = spawnSync('git', [...SETTINGS, ...args], { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr || String(result.error)}`);
    }
    return result.stdout.trim();
  };
  git('init', '--quiet');
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
