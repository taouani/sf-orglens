/**
 * `.forceignore`: the files of a project that are not part of the org.
 *
 * A repository is read as the Salesforce CLI would deploy it, so what the
 * file excludes is left out of the snapshot. The rules are evaluated here,
 * with the library the Salesforce library uses, and not by the Salesforce
 * library itself: that one reads the file from the disk only, and asks the
 * disk whether a path is a folder. Neither works for a commit that is not
 * checked out.
 *
 * Two things follow the Salesforce library exactly: without a
 * `.forceignore` nothing is excluded, and with one, its default rules come
 * first. A test compares the default rules with those of the installed
 * library. One thing differs: the file is searched from a package directory
 * upwards to the root of the source, and not above it.
 */
import ignoreModule from 'ignore';

// The package is CommonJS. Its function is the `default` of what an import of it gives.
const ignore = ignoreModule.default;

export const FORCEIGNORE_FILE = '.forceignore';

/** The rules the Salesforce library puts in front of every `.forceignore`. */
export const DEFAULT_RULES: readonly string[] = [
  '**/*.dup',
  '**/.*',
  '!.sf',
  '**/.sf/**',
  '!**/.sf/orgs',
  '!**/.sf/orgs/**',
  '**/.sf/orgs/*/**',
  '!**/.sf/orgs/*/remoteMetadata',
  '!**/.sf/orgs/*/remoteMetadata/**',
  '**/package2-descriptor.json',
  '**/package2-manifest.json',
];

const UTF8 = new TextDecoder('utf-8');

/** The places a `.forceignore` for a folder can be at, the nearest first: in the folder, then in each folder above. */
export function ignoreFileCandidates(dir: string): string[] {
  const segments = dir.split('/');
  const candidates: string[] = [];
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    candidates.push([...segments.slice(0, depth), FORCEIGNORE_FILE].join('/'));
  }
  return candidates;
}

/**
 * The test "is this file excluded" for one `.forceignore`. `at` is the path
 * of the `.forceignore` inside the source. Paths that are not below its
 * folder are never excluded.
 */
export function ignoreRules(at: string, content: Uint8Array): (path: string) => boolean {
  const base = at.slice(0, -FORCEIGNORE_FILE.length);
  const rules = ignore().add(`${DEFAULT_RULES.join('\n')}\n${UTF8.decode(content)}`);
  return (path) => path.startsWith(base) && path.length > base.length && rules.ignores(path.slice(base.length));
}
