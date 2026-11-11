import { readFileSync } from 'node:fs';

/** The version of the installed CLI package. */
export function cliVersion(): string {
  // `../package.json` is the CLI manifest from both `src` and `dist`.
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return manifest.version;
}
