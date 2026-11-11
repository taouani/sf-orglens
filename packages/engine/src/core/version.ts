import { readFileSync } from 'node:fs';

interface PackageManifest {
  readonly version: string;
}

function isPackageManifest(value: unknown): value is PackageManifest {
  return typeof value === 'object' && value !== null && typeof (value as { version?: unknown }).version === 'string';
}

/**
 * Reads the `version` field of a `package.json` file.
 *
 * The version is read at run time instead of being imported, so the compiled
 * output never contains a stale copy and the manifest stays outside `rootDir`.
 */
export function readPackageVersion(manifestUrl: URL): string {
  const manifest: unknown = JSON.parse(readFileSync(manifestUrl, 'utf8'));
  if (!isPackageManifest(manifest)) {
    throw new Error(`No version field in ${manifestUrl.href}`);
  }
  return manifest.version;
}

let cached: string | undefined;

/** The version of the installed engine package. */
export function engineVersion(): string {
  // `../../package.json` is the engine manifest from both `src/core` and `dist/core`.
  cached ??= readPackageVersion(new URL('../../package.json', import.meta.url));
  return cached;
}
