import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as engine from '../src/index.ts';

describe('engine public API', () => {
  it('reports the version of its own package', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(engine.engineVersion()).toBe(manifest.version);
  });

  // The public surface is pinned in a golden file. A change to the API shows
  // up as a diff of that file in review, never as a silent side effect.
  it('exports exactly the names listed in the golden file', async () => {
    const surface = Object.keys(engine).sort();
    await expect(`${JSON.stringify(surface, null, 2)}\n`).toMatchFileSnapshot('./golden/api-surface.json');
  });
});
